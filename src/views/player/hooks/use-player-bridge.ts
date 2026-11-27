import { useEffect, useRef, useState, type RefObject } from "react";
import {
  emptySnapshot,
  initialPlayerSnapshot,
  type PlayerBridge,
  type PlayerSnapshot,
} from "@/lib/player/bridge";
import { probeMpv } from "@/lib/player/mpv";
import { createExoPlayerBridge, probeExoPlayer } from "@/lib/player/exoplayer";
import { isPhoneBackActive } from "@/views/mobile/phone-back";
import { externalMpvEnabled } from "@/lib/player/external-mpv";
import { mergeMpvOptions } from "@/lib/player/mpv-tuning";
import { anime4kPackComplete, repairAnime4kPack } from "@/lib/anime4k";
import { metaIsAnime } from "@/lib/player/anime-src";
import { fullShaderChain, type Anime4kChoice } from "./use-anime4k";
import { generalShaderKey, shaderCompanionOptions } from "@/lib/player/shader-chain";
import type { PlayerSrc } from "@/lib/view";
import type { Settings } from "@/lib/settings";
import { setPlaybackClock, setPlaybackStatus } from "@/lib/player/playback-clock";
import { isLinuxDesktop, isMacDesktop, isWindowsDesktop } from "@/lib/platform";
import { isLivePlaybackSrc } from "@/lib/player/live-src";
import { readEmbedRect } from "@/lib/player/embed-rect";
import { svpEnsureRunning, svpStatus } from "@/lib/svp";
import { isSvpActiveForMedia } from "@/lib/player/svp-policy";
import { ensureNativeMemory } from "@/lib/native-memory";
import { pickBridge } from "../player-utils";

function snapChangedIgnoringClock(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
  return (
    a.status !== b.status ||
    a.buffering !== b.buffering ||
    a.firstFrameReady !== b.firstFrameReady ||
    a.durationSec !== b.durationSec ||
    a.volume !== b.volume ||
    a.muted !== b.muted ||
    a.rate !== b.rate ||
    a.audioTracks !== b.audioTracks ||
    a.subtitleTracks !== b.subtitleTracks ||
    a.chapters !== b.chapters ||
    a.subDelaySec !== b.subDelaySec ||
    a.audioDelaySec !== b.audioDelaySec ||
    a.subText !== b.subText ||
    a.subStartSec !== b.subStartSec ||
    a.secondarySubText !== b.secondarySubText ||
    a.noAudio !== b.noAudio ||
    a.audioNormalize !== b.audioNormalize ||
    a.videoWidth !== b.videoWidth ||
    a.videoHeight !== b.videoHeight ||
    a.videoSourceWidth !== b.videoSourceWidth ||
    a.videoSourceHeight !== b.videoSourceHeight ||
    a.hdrGamma !== b.hdrGamma ||
    a.errorMessage !== b.errorMessage ||
    a.errorCode !== b.errorCode
  );
}

export function usePlayerBridge(params: {
  bridgeRef: RefObject<PlayerBridge | null>;
  videoMountRef: RefObject<HTMLDivElement | null>;
  src: PlayerSrc;
  settings: Settings;
}) {
  const { bridgeRef, videoMountRef, src, settings } = params;

  const [snap, setSnap] = useState<PlayerSnapshot>(initialPlayerSnapshot);
  const prevSnapRef = useRef<PlayerSnapshot>(emptySnapshot);
  const [engine, setEngine] = useState<"html5" | "mpv">("html5");
  const [autoFallbackTried, setAutoFallbackTried] = useState(false);

  const hdrOpaqueWindow = isWindowsDesktop() && settings.playerHdrOpaqueWindow;
  const embedActive = settings.playerMpvEmbed && !hdrOpaqueWindow;
  const isAnimeSrc = metaIsAnime(src.meta) || !!src.isAnime;
  const anime4kWanted = settings.playerAnime4k && (!settings.playerAnime4kAnimeOnly || isAnimeSrc);
  // mpv only compiles a shader chain whose files it can open, and it drops the
  // rest without a word. Presets that name a kernel the installed pack predates
  // would silently run short, so the gap is filled before the chain is built
  // rather than only when the settings panel happens to be open.
  const anime4kNeeded = anime4kWanted && !!settings.playerAnime4kFolder;
  const [anime4kPack, setAnime4kPack] = useState<boolean | null>(anime4kNeeded ? null : true);
  // Enabling Anime4K after the player mounted still gets the pack checked; the
  // initial state only probes when it was already wanted at mount.
  const anime4kChecked = useRef(anime4kNeeded);
  useEffect(() => {
    if (anime4kNeeded && !anime4kChecked.current) {
      anime4kChecked.current = true;
      setAnime4kPack(null);
    }
  }, [anime4kNeeded]);
  useEffect(() => {
    if (anime4kPack !== null) return;
    let active = true;
    anime4kPackComplete()
      .then((complete) => {
        if (!active) return;
        if (complete) {
          setAnime4kPack(true);
          return;
        }
        // Stay pending while the pack is topped up: starting the bridge first
        // and flipping the flag when the repair lands would restart mpv
        // mid-playback.
        void repairAnime4kPack().then(() => {
          if (active) setAnime4kPack(true);
        });
      })
      .catch(() => {
        if (active) setAnime4kPack(true);
      });
    return () => {
      active = false;
    };
  }, [anime4kPack]);
  const anime4kOn = anime4kWanted && anime4kPack === true;
  const anime4kPending = anime4kPack === null;
  const svpRequested = isSvpActiveForMedia(settings, src.meta);
  const [svpRuntimeReady, setSvpRuntimeReady] = useState<boolean | null>(
    isLinuxDesktop() && svpRequested ? null : true,
  );
  useEffect(() => {
    if (!svpRequested || !isLinuxDesktop()) {
      setSvpRuntimeReady(true);
      return;
    }
    let active = true;
    setSvpRuntimeReady(null);
    void svpStatus()
      .then((status) => {
        if (active)
          setSvpRuntimeReady(status.supported && status.ready && status.loadable !== false);
      })
      .catch(() => {
        if (active) setSvpRuntimeReady(false);
      });
    return () => {
      active = false;
    };
  }, [svpRequested, settings.svpVpyPath]);
  const svpPending = svpRequested && svpRuntimeReady === null;
  const svpOn = svpRequested && svpRuntimeReady === true;
  useEffect(() => {
    if (svpOn) void svpEnsureRunning().catch(() => {});
  }, [svpOn]);
  const isLiveLike = isLivePlaybackSrc(src);
  const externalMpv = externalMpvEnabled(settings);
  // "exoplayer" is the Android native engine (phone player only); this
  // desktop/Big Picture player has no such bridge, so it resolves as "auto".
  const chosenEngine =
    isLiveLike && !src.notWebReady ? "html5" : autoFallbackTried ? "mpv" : settings.playerEngine === "exoplayer" ? "auto" : settings.playerEngine;
  // Phone shell only: the native Media3 bridge (lib/player/exoplayer), the
  // same one the phone shell's local-play sheet uses, takes over stream
  // playback when the user selected it. The gate is the phone entry's own
  // activation flag (main-phone.tsx arms it at boot; desktop and Big
  // Picture never do), so outside the phone shell "exoplayer" keeps
  // resolving as "auto" above. The live carve-out matches the other
  // engines: a web-ready live source stays on html5. The bridge reports
  // as "html5" to this view's engine consumers — the pickBridge precedent
  // for the external-mpv bridge — so every mpv-only surface stays off,
  // while the bridge's own capabilities() still reports "exoplayer".
  const phoneNativeExo =
    isPhoneBackActive() &&
    settings.playerEngine === "exoplayer" &&
    !(isLiveLike && !src.notWebReady);
  const bridgeKey = `${chosenEngine}|${phoneNativeExo}|${anime4kOn}|${embedActive}|${anime4kOn ? settings.playerAnime4kShaders.join(",") : ""}|${generalShaderKey(settings)}|${svpOn}|${svpOn ? settings.svpVpyPath : ""}|${externalMpv ? `ext:${settings.playerExternalMpvPath}:${settings.playerExternalMpvArgs}` : ""}`;
  const [bridgeReady, setBridgeReady] = useState(false);
  useEffect(() => {
    if (svpPending || anime4kPending) return;
    const host = videoMountRef.current;
    if (!host) return;
    let cancelled = false;
    let off: (() => void) | null = null;
    let bridge: PlayerBridge | null = null;
    setBridgeReady(false);
    (async () => {
      const want = chosenEngine;
      const getEmbedRect = () => readEmbedRect(videoMountRef.current);
      // Size manual buffer modes from the real machine, not the fallback.
      await ensureNativeMemory();
      const { bridge: pickedBridge, engine: pickedEngine } = await pickBridge(want, src.notWebReady === true, {
        anime4k: anime4kOn,
        hdrToSdr: settings.playerHdrToSdr,
        rtxHdr: settings.playerRtxHdr && !settings.playerHdrToSdr && !svpOn,
        rtxVsr: settings.playerRtxVsr && !svpOn,
        embed: embedActive,
        d3d11Flip: settings.playerD3d11Flip,
        renderer: settings.mpvRenderer,
        forceYuv420p: settings.mpvForceYuv420p,
        anime4kShaders: fullShaderChain(
          settings,
          src,
          (settings.playerAnime4kOverride as Anime4kChoice) || "auto",
        ),
        macEdr: isMacDesktop() && embedActive && settings.playerMacEdr && !settings.playerHdrToSdr,
        separateDisplay:
          settings.playerSeparateDisplay.mode === "explicit"
            ? settings.playerSeparateDisplay.monitor
            : null,
        separateCoverTaskbar: settings.playerSeparateCoverTaskbar,
        extraOptions: [
          mergeMpvOptions(settings, svpOn, { anime4k: anime4kOn }),
          shaderCompanionOptions(settings),
        ]
          .filter(Boolean)
          .join("\n"),
        getEmbedRect,
        external: externalMpv
          ? {
              binary: settings.playerExternalMpvPath,
              args: settings.playerExternalMpvArgs,
              title: [src.title, src.subtitle].filter(Boolean).join(" - "),
            }
          : null,
      });
      if (cancelled) return;
      // Phone shell + native engine selected: swap the resolved bridge for
      // the ExoPlayer one before anything attaches. The resolved bridge was
      // never attached, so discarding it is side-effect free; if the native
      // probe fails the resolved bridge stays and playback is not blocked.
      let choose = pickedBridge;
      let chosen = pickedEngine;
      if (phoneNativeExo) {
        const probe = probeExoPlayer();
        if (probe.available) {
          choose = createExoPlayerBridge();
          chosen = "html5";
        } else {
          console.warn(
            "[harbor] native ExoPlayer requested but probe failed; using the resolved engine instead. Reason:",
            probe.error,
          );
        }
      }
      bridge = choose;
      bridge.attach(host);
      bridgeRef.current = bridge;
      setEngine(chosen);
      off = bridge.subscribe((s) => {
        setPlaybackClock(s.positionSec, s.bufferedSec);
        setPlaybackStatus(s.status);
        if (snapChangedIgnoringClock(prevSnapRef.current, s)) {
          prevSnapRef.current = s;
          setSnap(s);
        }
      });
      setBridgeReady(true);
    })();
    return () => {
      cancelled = true;
      setBridgeReady(false);
      off?.();
      bridge?.destroy();
      bridgeRef.current = null;
      setPlaybackClock(0, 0);
      setPlaybackStatus("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeKey, svpPending, anime4kPending]);

  useEffect(() => {
    if (engine !== "html5") return;
    if (autoFallbackTried) return;
    if (settings.playerEngine !== "auto") return;
    if (snap.errorCode !== "decode" && snap.errorCode !== "codec" && !snap.noAudio) return;
    (async () => {
      const probe = await probeMpv();
      if (probe.available) setAutoFallbackTried(true);
    })();
  }, [engine, autoFallbackTried, snap.errorCode, snap.noAudio, settings.playerEngine]);

  useEffect(() => {
    if (!bridgeReady || engine !== "mpv") return;
    bridgeRef.current?.setHdrToSdr?.(
      settings.playerHdrToSdr,
      settings.playerDisplayPanel === "oled",
    );
  }, [bridgeReady, engine, settings.playerHdrToSdr, settings.playerDisplayPanel, bridgeRef]);

  return { snap, engine, bridgeReady, bridgeKey, embedActive, svpActive: svpOn };
}
