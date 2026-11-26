package app.harbor.exoplayer

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native Media3/ExoPlayer backend for Harbor's phone player, exposed to the
 * WebView as the `HarborExo` JavaScript interface. The video renders into a
 * [PlayerView] inserted behind the (transparent) WebView so the web UI draws
 * its controls on top — the same division of labour as the desktop app's mpv
 * bridge: native owns decoding, rendering and the system actuators the
 * WebView cannot reach (orientation, window brightness); every visible
 * control lives in the web layer.
 *
 * Contract (implemented on the TS side by `src/lib/player/exoplayer.ts`):
 * every `@JavascriptInterface` method takes strings (a JSON payload for
 * `load`, stringified primitives elsewhere) and returns `"ok"` or
 * `"error:<message>"`; `getState` returns the current snapshot JSON.
 * Events travel back through `window.__HARBOR_EXO_EVENT__(<json string>)`
 * as `{type:"state", snapshot}`, `{type:"error", code, message}` and
 * `{type:"ended"}` envelopes.
 *
 * `@JavascriptInterface` methods run on a WebView worker thread; every
 * ExoPlayer interaction is posted to the main thread (see [post]). The
 * snapshot is rebuilt on the main thread by the [Player.Listener] callbacks
 * plus a 500 ms ticker while playing, and kept in a volatile field so
 * `getState` never blocks.
 *
 * Stage 1 scope: init/load/play/pause/seek/stop, speed/volume/mute,
 * visibility, resize mode, window brightness, state + error + ended events.
 * Track enumeration/selection and sidecar-subtitle management arrive with
 * stage 3; PiP with stage 4.
 */
class HarborExoBridge(
    private val activity: Activity,
    private val webView: WebView,
) {

    private val mainHandler = Handler(Looper.getMainLooper())

    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var httpFactory: DefaultHttpDataSource.Factory? = null

    // Main-thread confined playback bookkeeping.
    private var loadInFlight = false
    private var firstFrameReady = false
    private var endedEmitted = false
    private var currentVolume = 1.0f
    private var muted = false
    private var savedOrientation: Int? = null

    @Volatile
    private var lastError: String? = null

    @Volatile
    private var lastErrorCodeName: String? = null

    @Volatile
    private var stateJson: String = emptyStateJson()

    private val ticker = object : Runnable {
        override fun run() {
            emitState()
            if (player?.isPlaying == true) {
                mainHandler.postDelayed(this, TICK_MS)
            }
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY || playbackState == Player.STATE_ENDED) {
                loadInFlight = false
            }
            if (playbackState == Player.STATE_ENDED && !endedEmitted) {
                endedEmitted = true
                emitEvent(JSONObject().put("type", "ended").toString())
            }
            emitState()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) startTicker()
            emitState()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            emitState()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            emitState()
        }

        override fun onRenderedFirstFrame() {
            firstFrameReady = true
            loadInFlight = false
            emitState()
        }

        override fun onPlaybackParametersChanged(parameters: PlaybackParameters) {
            emitState()
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            emitState()
        }

        override fun onVolumeChanged(volume: Float) {
            emitState()
        }

        override fun onPlayerError(error: PlaybackException) {
            loadInFlight = false
            lastError = error.message
            lastErrorCodeName = PlaybackException.getErrorCodeName(error.errorCode)
            val event = JSONObject()
                .put("type", "error")
                .put("code", lastErrorCodeName)
                .put("message", lastError ?: "playback error")
            emitEvent(event.toString())
            emitState()
        }
    }

    // ---- JS contract ------------------------------------------------------

    /** Create the player and its view (idempotent). The TS availability probe. */
    @JavascriptInterface
    fun init(): String = post { ensurePlayer() }

    /**
     * Load and play a stream. Payload JSON:
     * `{url, startSec?, speed?, startPaused?, headers?: {name: value},
     *   subs?: [{url, lang?, label?, mime?}]}`.
     * Media3 infers HLS/DASH/progressive from the URL via its factories.
     */
    @JavascriptInterface
    fun load(json: String): String {
        val opts: JSONObject
        val url: String
        try {
            opts = JSONObject(json)
            url = opts.getString("url")
        } catch (e: Exception) {
            return "error:invalid load payload: ${e.message}"
        }
        val startSec = opts.optDouble("startSec", 0.0)
        val speed = opts.optDouble("speed", 1.0)
        val startPaused = opts.optBoolean("startPaused", false)
        val headers = parseHeaders(opts.optJSONObject("headers"))
        val subConfigs = try {
            buildSubConfigs(opts.optJSONArray("subs"))
        } catch (e: Exception) {
            return "error:cannot build media item: ${e.message}"
        }

        return post {
            ensurePlayer()
            val p = player ?: return@post
            lastError = null
            lastErrorCodeName = null
            endedEmitted = false
            firstFrameReady = false
            loadInFlight = true
            httpFactory?.setDefaultRequestProperties(headers)
            val item = MediaItem.Builder()
                .setUri(url)
                .setSubtitleConfigurations(subConfigs)
                .build()
            p.setMediaItem(item)
            p.setPlaybackParameters(
                PlaybackParameters(speed.toFloat().coerceAtLeast(MIN_SPEED)),
            )
            if (startSec > 0.0) p.seekTo((startSec * 1000).toLong())
            p.prepare()
            p.playWhenReady = !startPaused
            setVisibleInternal(true)
            lockLandscape()
            emitState()
        }
    }

    @JavascriptInterface
    fun play(): String = post { player?.play() }

    @JavascriptInterface
    fun pause(): String = post { player?.pause() }

    /**
     * Stop playback and release the player; the view hides, the WebView goes
     * opaque again and the orientation lock is restored. Idempotent — the
     * bridge is the single owner of the player, and this is called from the
     * JS detach path and from [shutdown].
     */
    @JavascriptInterface
    fun stop(): String = post {
        stopTicker()
        loadInFlight = false
        lastError = null
        lastErrorCodeName = null
        player?.release()
        player = null
        playerView?.player = null
        setVisibleInternal(false)
        restoreOrientation()
        emitState()
    }

    @JavascriptInterface
    fun seek(seconds: String): String {
        val sec = seconds.toDoubleOrNull() ?: return "error:bad seconds"
        return post { player?.seekTo((sec * 1000).toLong()) }
    }

    @JavascriptInterface
    fun setSpeed(rate: String): String {
        val r = rate.toFloatOrNull() ?: return "error:bad rate"
        return post {
            player?.setPlaybackParameters(PlaybackParameters(r.coerceAtLeast(MIN_SPEED)))
        }
    }

    @JavascriptInterface
    fun setVolume(value: String): String {
        val v = value.toFloatOrNull()?.coerceIn(0f, 1f) ?: return "error:bad volume"
        return post {
            currentVolume = v
            if (!muted) player?.volume = v
            emitState()
        }
    }

    @JavascriptInterface
    fun setMuted(value: String): String {
        val m = value.equals("true", ignoreCase = true)
        return post {
            muted = m
            player?.volume = if (m) 0f else currentVolume
            emitState()
        }
    }

    /** Show or hide the video surface without stopping playback. */
    @JavascriptInterface
    fun setVisible(value: String): String {
        val show = value.equals("true", ignoreCase = true)
        return post { setVisibleInternal(show) }
    }

    @JavascriptInterface
    fun setResize(mode: String): String = post {
        playerView?.resizeMode = when (mode) {
            "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            "zoom" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    /** Window brightness actuator (the WebView cannot reach it). -1 restores the system level. */
    @JavascriptInterface
    fun setWindowBrightness(value: String): String {
        val v = value.toFloatOrNull() ?: return "error:bad brightness"
        return post {
            val attrs = activity.window.attributes
            attrs.screenBrightness = if (v < 0f) {
                WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            } else {
                v.coerceIn(0f, 1f)
            }
            activity.window.attributes = attrs
        }
    }

    /** Synchronous snapshot pull (used at attach and after any missed event). */
    @JavascriptInterface
    fun getState(): String = stateJson

    // ---- Lifecycle (called from the plugin, main thread) -------------------

    /** Release everything and remove the view. Called when the activity is destroyed. */
    fun shutdown() {
        mainHandler.post {
            stopTicker()
            player?.release()
            player = null
            playerView?.let { view ->
                (view.parent as? ViewGroup)?.removeView(view)
            }
            playerView = null
            restoreOrientation()
            webView.setBackgroundColor(WEBVIEW_BG)
        }
    }

    // ---- Internals (main thread unless noted) -------------------------------

    private fun ensurePlayer() {
        if (player == null) {
            val factory = DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
            httpFactory = factory
            val mediaSourceFactory =
                DefaultMediaSourceFactory(activity).setDataSourceFactory(factory)
            val exo = ExoPlayer.Builder(activity)
                .setMediaSourceFactory(mediaSourceFactory)
                .build()
            exo.addListener(playerListener)
            player = exo
        }
        if (playerView == null) {
            val view = PlayerView(activity)
            view.useController = true
            view.keepScreenOn = true
            view.setBackgroundColor(Color.BLACK)
            view.visibility = View.GONE
            view.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            // Behind the WebView: index 0 of its parent (a FrameLayout in the
            // Tauri activity), falling back to the activity's content root.
            val parent = (webView.parent as? ViewGroup)
                ?: (activity.findViewById<View>(android.R.id.content) as? ViewGroup)
            parent?.addView(view, 0)
            playerView = view
        }
        playerView?.player = player
    }

    private fun setVisibleInternal(show: Boolean) {
        val view = playerView ?: return
        if (show) {
            view.visibility = View.VISIBLE
            webView.setBackgroundColor(Color.TRANSPARENT)
        } else {
            view.visibility = View.GONE
            webView.setBackgroundColor(WEBVIEW_BG)
        }
    }

    private fun lockLandscape() {
        if (savedOrientation == null) {
            savedOrientation = activity.requestedOrientation
        }
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    private fun restoreOrientation() {
        savedOrientation?.let { activity.requestedOrientation = it }
        savedOrientation = null
    }

    private fun startTicker() {
        mainHandler.removeCallbacks(ticker)
        mainHandler.postDelayed(ticker, TICK_MS)
    }

    private fun stopTicker() {
        mainHandler.removeCallbacks(ticker)
    }

    private fun buildStateJson(): JSONObject {
        val p = player
        val playbackState = p?.playbackState ?: Player.STATE_IDLE
        val status = when {
            lastError != null -> "error"
            p == null -> "idle"
            playbackState == Player.STATE_ENDED -> "ended"
            loadInFlight -> "loading"
            p.isPlaying -> "playing"
            playbackState == Player.STATE_BUFFERING ->
                if (p.playWhenReady) "playing" else "paused"
            playbackState == Player.STATE_READY ->
                if (firstFrameReady) "paused" else "ready"
            else -> "idle"
        }
        val durationMs = p?.duration ?: C.TIME_UNSET
        val bufferedMs = p?.bufferedPosition ?: C.TIME_UNSET
        val state = JSONObject()
        state.put("status", status)
        state.put("positionSec", ((p?.currentPosition ?: 0L).coerceAtLeast(0L)) / 1000.0)
        state.put("durationSec", if (durationMs == C.TIME_UNSET) 0.0 else durationMs / 1000.0)
        state.put("bufferedSec", if (bufferedMs == C.TIME_UNSET) 0.0 else bufferedMs / 1000.0)
        state.put("buffering", playbackState == Player.STATE_BUFFERING)
        state.put("firstFrameReady", firstFrameReady)
        state.put("volume", currentVolume.toDouble())
        state.put("muted", muted)
        state.put("rate", (p?.playbackParameters?.speed ?: 1.0f).toDouble())
        state.put("videoWidth", p?.videoSize?.width ?: 0)
        state.put("videoHeight", p?.videoSize?.height ?: 0)
        state.put("errorCodeName", lastErrorCodeName)
        state.put("errorMessage", lastError)
        return state
    }

    private fun emitState() {
        val snapshot = buildStateJson()
        stateJson = snapshot.toString()
        val event = JSONObject()
            .put("type", "state")
            .put("snapshot", snapshot)
        emitEvent(event.toString())
    }

    private fun emitEvent(payload: String) {
        // JSONObject.quote produces a valid JS string literal for the payload.
        val js = "window.__HARBOR_EXO_EVENT__ && " +
            "window.__HARBOR_EXO_EVENT__(${JSONObject.quote(payload)})"
        mainHandler.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (e: Exception) {
                // The WebView is already gone; events simply stop arriving.
            }
        }
    }

    /**
     * Run [block] on the main thread and report its outcome as the JS return
     * value ("ok" / "error:<message>"). Bridge methods arrive on a WebView
     * worker thread; player calls are main-thread only.
     */
    private fun post(block: () -> Unit): String {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return try {
                block()
                "ok"
            } catch (e: Exception) {
                "error:${e.message}"
            }
        }
        val latch = CountDownLatch(1)
        var failure: String? = null
        mainHandler.post {
            try {
                block()
            } catch (e: Exception) {
                failure = e.message
            } finally {
                latch.countDown()
            }
        }
        return try {
            if (latch.await(POST_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                failure?.let { "error:$it" } ?: "ok"
            } else {
                "error:timeout"
            }
        } catch (e: InterruptedException) {
            "error:interrupted"
        }
    }

    private fun parseHeaders(obj: JSONObject?): Map<String, String> {
        if (obj == null) return emptyMap()
        val out = HashMap<String, String>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            out[key] = obj.optString(key)
        }
        return out
    }

    private fun buildSubConfigs(
        arr: JSONArray?,
    ): List<MediaItem.SubtitleConfiguration> {
        if (arr == null) return emptyList()
        val out = ArrayList<MediaItem.SubtitleConfiguration>()
        for (i in 0 until arr.length()) {
            val entry = arr.optJSONObject(i) ?: continue
            val subUrl = entry.optString("url")
            if (subUrl.isEmpty()) continue
            val mime = entry.optString("mime").ifEmpty { guessSubMime(subUrl) }
            val builder = MediaItem.SubtitleConfiguration.Builder(Uri.parse(subUrl))
                .setMimeType(mime)
                .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            val lang = entry.optString("lang")
            if (lang.isNotEmpty()) builder.setLanguage(lang)
            val label = entry.optString("label")
            if (label.isNotEmpty()) builder.setLabel(label)
            out.add(builder.build())
        }
        return out
    }

    private fun guessSubMime(url: String): String {
        val clean = url.substringBefore('?').lowercase()
        return when {
            clean.endsWith(".vtt") -> MimeTypes.TEXT_VTT
            clean.endsWith(".ass") || clean.endsWith(".ssa") -> MimeTypes.TEXT_SSA
            clean.endsWith(".ttml") || clean.endsWith(".dfxp") -> MimeTypes.APPLICATION_TTML
            else -> MimeTypes.APPLICATION_SUBRIP
        }
    }

    private fun emptyStateJson(): String {
        val state = JSONObject()
        state.put("status", "idle")
        state.put("positionSec", 0.0)
        state.put("durationSec", 0.0)
        state.put("bufferedSec", 0.0)
        state.put("buffering", false)
        state.put("firstFrameReady", false)
        state.put("volume", 1.0)
        state.put("muted", false)
        state.put("rate", 1.0)
        state.put("videoWidth", 0)
        state.put("videoHeight", 0)
        return state.toString()
    }

    companion object {
        private const val USER_AGENT = "Harbor/1.0 (Android; ExoPlayer)"
        private const val TICK_MS = 500L
        private const val POST_TIMEOUT_SEC = 10L
        private const val MIN_SPEED = 0.1f

        // The app window background (src-tauri/tauri.conf.json backgroundColor
        // [8, 9, 10, 255]); restored when the player hides so the WebView is
        // opaque again outside playback.
        private val WEBVIEW_BG = Color.rgb(8, 9, 10)
    }
}
