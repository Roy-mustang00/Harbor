import {
  initialPlayerSnapshot,
  type PlayerBridge,
  type PlayerCapabilities,
  type PlayerSnapshot,
  type PlayerSource,
  type TrackInfo,
} from "./bridge";

/**
 * The TS side of Harbor's native Android player. The Kotlin half lives in
 * the tauri-plugin-harbor-exoplayer crate (android/): a Media3 ExoPlayer
 * rendering into a PlayerView inserted behind the transparent WebView,
 * exposed as `window.HarborExo`. The transport deliberately mirrors the
 * desktop mpv pattern — direct bridge-object calls (string in, string out)
 * for commands and a global event function for state — because playback
 * commands are high-frequency and should not pay invoke round-trips.
 * This module is a fourth implementation of the PlayerBridge interface in
 * bridge.ts, next to mpv.ts, external-mpv.ts and html5.
 *
 * Stage 1: the bridge skeleton. Track enumeration/selection and sidecar
 * subtitle management are stage 3 (the snapshot's track lists stay empty
 * until then); PiP is stage 4.
 */

type HarborExoNative = {
  init(): string;
  load(json: string): string;
  play(): string;
  pause(): string;
  stop(): string;
  seek(seconds: string): string;
  setSpeed(rate: string): string;
  setVolume(value: string): string;
  setMuted(muted: string): string;
  setVisible(visible: string): string;
  setResize(mode: string): string;
  setWindowBrightness(value: string): string;
  getState(): string;
};

declare global {
  interface Window {
    HarborExo?: HarborExoNative;
    __HARBOR_EXO_EVENT__?: (json: string) => void;
  }
}

type ExoSnapshotJson = {
  status?: string;
  positionSec?: number;
  durationSec?: number;
  bufferedSec?: number;
  buffering?: boolean;
  firstFrameReady?: boolean;
  volume?: number;
  muted?: boolean;
  rate?: number;
  videoWidth?: number;
  videoHeight?: number;
  errorCodeName?: string | null;
  errorMessage?: string | null;
};

type ExoEventJson =
  | { type: "state"; snapshot: ExoSnapshotJson }
  | { type: "tracks"; audio?: TrackInfo[]; subtitles?: TrackInfo[] }
  | { type: "error"; code?: string | null; message?: string | null }
  | { type: "ended" };

export type ExoProbe = { available: boolean; error?: string };

function nativeBridge(): HarborExoNative | null {
  if (typeof window === "undefined") return null;
  return window.HarborExo ?? null;
}

/** Media3 PlaybackException names onto the snapshot's errorCode union. */
function mapErrorCode(name: string | null | undefined): PlayerSnapshot["errorCode"] {
  if (!name) return null;
  if (name.includes("DECODER_INIT") || name.includes("DECODER_QUERY")) return "codec";
  if (name.startsWith("ERROR_CODE_IO")) return "network";
  if (name.startsWith("ERROR_CODE_PARSING") || name.startsWith("ERROR_CODE_MANIFEST"))
    return "source";
  if (name.startsWith("ERROR_CODE_DECOD") || name.startsWith("ERROR_CODE_DECODING"))
    return "decode";
  return "unknown";
}

const PLAYER_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "loading",
  "ready",
  "playing",
  "paused",
  "ended",
  "error",
]);

/**
 * One-shot availability check, mirroring probeMpv()'s convention: the
 * native object must exist and answer an init + getState round-trip with a
 * parseable snapshot. Checked once per player mount, never at shell boot.
 */
export function probeExoPlayer(): ExoProbe {
  const exo = nativeBridge();
  if (!exo) {
    return {
      available: false,
      error: "window.HarborExo is not installed (the Android player plugin is not loaded)",
    };
  }
  try {
    const init = exo.init();
    if (typeof init === "string" && init.startsWith("error:")) {
      return { available: false, error: init };
    }
    const state = JSON.parse(exo.getState()) as ExoSnapshotJson;
    if (!state || typeof state.status !== "string") {
      return { available: false, error: "HarborExo.getState returned an unexpected payload" };
    }
    return { available: true };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function createExoPlayerBridge(): PlayerBridge {
  let snap: PlayerSnapshot = initialPlayerSnapshot();
  const listeners = new Set<(s: PlayerSnapshot) => void>();
  let destroyed = false;

  const emit = () => {
    const next: PlayerSnapshot = { ...snap };
    listeners.forEach((l) => l(next));
  };

  const call = (fn: (x: HarborExoNative) => string) => {
    const x = nativeBridge();
    if (!x || destroyed) return;
    try {
      fn(x);
    } catch {
      // A bridge that is going away with its WebView must not take the UI
      // down with it; state events simply stop arriving.
    }
  };

  const applyNative = (s: ExoSnapshotJson) => {
    snap = {
      ...snap,
      status:
        s.status && PLAYER_STATUSES.has(s.status)
          ? (s.status as PlayerSnapshot["status"])
          : snap.status,
      positionSec: s.positionSec ?? snap.positionSec,
      durationSec: s.durationSec ?? snap.durationSec,
      bufferedSec: s.bufferedSec ?? snap.bufferedSec,
      buffering: s.buffering ?? snap.buffering,
      firstFrameReady: s.firstFrameReady ?? snap.firstFrameReady,
      volume: s.volume ?? snap.volume,
      muted: s.muted ?? snap.muted,
      rate: s.rate ?? snap.rate,
      videoWidth: s.videoWidth ?? snap.videoWidth,
      videoHeight: s.videoHeight ?? snap.videoHeight,
      videoSourceWidth: s.videoWidth ?? snap.videoSourceWidth,
      videoSourceHeight: s.videoHeight ?? snap.videoSourceHeight,
      errorMessage: s.errorMessage ?? null,
      errorCode: mapErrorCode(s.errorCodeName),
    };
    emit();
  };

  const onEvent = (json: string) => {
    if (destroyed) return;
    let ev: ExoEventJson;
    try {
      ev = JSON.parse(json) as ExoEventJson;
    } catch {
      return;
    }
    if (ev.type === "state" && ev.snapshot) {
      applyNative(ev.snapshot);
    } else if (ev.type === "error") {
      snap = {
        ...snap,
        status: "error",
        errorMessage: ev.message ?? snap.errorMessage,
        errorCode: mapErrorCode(ev.code) ?? snap.errorCode,
      };
      emit();
    } else if (ev.type === "ended") {
      if (snap.status !== "ended") {
        snap = { ...snap, status: "ended" };
        emit();
      }
    }
    // "tracks" events arrive with stage 3; until then the snapshot's track
    // lists stay empty and the track setters below are honest no-ops.
  };

  if (typeof window !== "undefined") window.__HARBOR_EXO_EVENT__ = onEvent;

  return {
    attach() {
      // Nothing to mount in the DOM: the video surface is the native
      // PlayerView behind the WebView. Pull a fresh snapshot so a UI that
      // attaches mid-playback starts from the truth.
      const x = nativeBridge();
      if (!x) return;
      try {
        applyNative(JSON.parse(x.getState()) as ExoSnapshotJson);
      } catch {
        // The probe and load paths surface real errors; a stale snapshot
        // pull is not one of them.
      }
    },
    detach() {
      // Leaving the player screen stops the native player: the bridge is
      // its single owner, and audio must not outlive the overlay.
      call((x) => x.stop());
    },
    async load(src: PlayerSource) {
      const x = nativeBridge();
      if (!x) {
        snap = {
          ...snap,
          status: "error",
          errorCode: "source",
          errorMessage: "The native Android player is not available on this device.",
        };
        emit();
        return;
      }
      snap = {
        ...snap,
        status: "loading",
        positionSec: 0,
        durationSec: 0,
        bufferedSec: 0,
        buffering: false,
        firstFrameReady: false,
        videoWidth: 0,
        videoHeight: 0,
        videoSourceWidth: 0,
        videoSourceHeight: 0,
        errorCode: null,
        errorMessage: null,
      };
      emit();
      const payload = {
        url: src.url,
        startSec: src.startAtSec ?? 0,
        speed: 1,
        startPaused: src.startPaused === true,
        headers: src.headers ?? {},
        subs: (src.subtitles ?? []).map((s) => ({
          url: s.url,
          lang: s.lang ?? "",
          label: s.lang ?? "",
        })),
      };
      let result: string;
      try {
        result = x.load(JSON.stringify(payload));
      } catch (e) {
        result = `error:${e instanceof Error ? e.message : String(e)}`;
      }
      if (typeof result === "string" && result.startsWith("error:")) {
        snap = {
          ...snap,
          status: "error",
          errorCode: "source",
          errorMessage: result.slice("error:".length),
        };
        emit();
      }
    },
    async play() {
      call((x) => x.play());
    },
    pause() {
      call((x) => x.pause());
    },
    seek(sec) {
      call((x) => x.seek(String(sec)));
    },
    setVolume(v) {
      call((x) => x.setVolume(String(v)));
    },
    setMuted(m) {
      call((x) => x.setMuted(m ? "true" : "false"));
    },
    setRate(r) {
      call((x) => x.setSpeed(String(r)));
    },
    // Stage 3 (tracks and sidecar subtitles): the Kotlin bridge does not
    // expose these yet, so they stay honest no-ops instead of pretending —
    // the same posture external-mpv takes for controls it cannot offer.
    setAudioTrack() {},
    setSubtitleTrack() {},
    setSecondarySubtitleTrack() {},
    setSubVisible() {},
    setSubDelay() {},
    setAudioDelay() {},
    setPanscan() {},
    setVideoZoom() {},
    setAspectOverride() {},
    setStretch() {},
    setVideoEq() {},
    setAnime4kShaders() {},
    async addSubtitle() {
      return false;
    },
    getSelectedTrackCues: () => null,
    getSelectedTrackUrl: () => null,
    setAudioNormalize() {},
    async screenshot() {
      return { ok: false, error: "Screenshots are not supported by the native Android player." };
    },
    setAbLoop() {},
    // PiP is stage 4 (it needs a manifest patch on the generated app).
    async requestPiP() {},
    async exitPiP() {},
    // The native player is fullscreen by construction (the overlay is the
    // screen, and load locks sensor-landscape), so these are no-ops.
    async requestFullscreen() {},
    async exitFullscreen() {},
    capabilities(): PlayerCapabilities {
      return {
        engine: "exoplayer",
        pictureInPicture: false,
        airplay: false,
        chromecast: false,
        hdrPassthrough: true,
        hardwareDecode: true,
      };
    },
    subscribe(l) {
      listeners.add(l);
      l({ ...snap });
      return () => {
        listeners.delete(l);
      };
    },
    destroy() {
      call((x) => x.stop());
      destroyed = true;
      listeners.clear();
      if (typeof window !== "undefined" && window.__HARBOR_EXO_EVENT__ === onEvent) {
        delete window.__HARBOR_EXO_EVENT__;
      }
    },
  };
}
