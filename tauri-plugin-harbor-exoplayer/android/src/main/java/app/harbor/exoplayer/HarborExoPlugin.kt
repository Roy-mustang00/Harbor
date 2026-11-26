package app.harbor.exoplayer

import android.app.Activity
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

/**
 * Tauri plugin shell for Harbor's native Android player. All playback work
 * lives in [HarborExoBridge]; this class only attaches the bridge to the
 * WebView when Tauri loads the plugin (the `load` hook runs as the WebView
 * is created, so `window.HarborExo` exists before the web UI can ask for
 * it), and tears the bridge down with the activity so playback cannot
 * outlive the app screen.
 */
@TauriPlugin
class HarborExoPlugin(private val activity: Activity) : Plugin(activity) {

    private var bridge: HarborExoBridge? = null

    override fun load(webView: WebView) {
        super.load(webView)
        val created = HarborExoBridge(activity, webView)
        bridge = created
        webView.addJavascriptInterface(created, "HarborExo")
    }

    override fun onDestroy(activity: AppCompatActivity) {
        bridge?.shutdown()
        bridge = null
    }
}
