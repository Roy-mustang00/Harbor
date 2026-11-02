import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { AlertTriangle, Loader2, Play, RefreshCw, X } from "lucide-react";
import type { Meta } from "@/lib/cinemeta";
import { useAuth } from "@/lib/auth";
import { useDebridClients } from "@/lib/debrid/registry";
import { useT } from "@/lib/i18n";
import { savePlayback } from "@/lib/playback-history";
import { useSettings } from "@/lib/settings";
import { registerStreamProxy, unregisterStreamProxy } from "@/lib/stream-proxy";
import { resolvePlaybackRedirect } from "@/lib/streams/playback-redirect";
import { resolveStream } from "@/lib/streams/resolve";
import type { ScoredStream } from "@/lib/streams/types";
import { formatBytes } from "@/lib/together/source-descriptor";
import type { PlayEpisode } from "@/lib/view";
import {
  formatStreamQuality,
  streamIdentity,
  streamIsCached,
} from "@/views/play-picker/picker-utils";
import { useAddons } from "@/views/play-picker/use-addons";
import { useAnimeAltTitles } from "@/views/play-picker/use-anime-alt-titles";
import { useImdbId } from "@/views/play-picker/use-imdb-id";
import { usePipelineResult } from "@/views/play-picker/use-pipeline-result";
import { useStreamIds } from "@/views/play-picker/use-stream-ids";
import { isPhoneBackActive, pushPhoneBack } from "./phone-back";

export type LocalPlayRequest = { meta: Meta; season?: number; episode?: number };

type Playing = { url: string; label: string };

// The standalone shell's Play path. Big Picture and the desktop picker run
// the stream pipeline (streams_run_pipeline) and hand the winner to the mpv
// player view through useView; neither exists in the phone entry (no view
// router, and the mpv commands are not registered in the mobile builder).
// This sheet runs the same pipeline composition the play-picker hooks use —
// addons, imdb id, stream ids, pipeline — resolves the tapped stream with
// the same resolveStream the desktop pick handler uses (debrid, on-device
// torrent engine, completed downloads), and plays the resulting URL in a
// plain HTML5 <video> overlay (hls.js for HLS, like the app's own html5
// bridge). What that honestly covers today: direct MP4/HLS and debrid or
// torrent-engine HTTP URLs in web-playable containers. MKV and other
// non-web containers surface a format error instead of playing — those wait
// for the native (Kotlin) player stage, which replaces this overlay's
// engine, not the pipeline work above it.
export function LocalPlaySheet({
  request,
  onClose,
}: {
  request: LocalPlayRequest;
  onClose: () => void;
}) {
  const t = useT();
  const { meta } = request;
  const { settings } = useSettings();
  const { authKey } = useAuth();
  const debrids = useDebridClients();
  const { addons } = useAddons(authKey, settings);
  const resolvedImdb = useImdbId(meta, settings.tmdbKey);
  const episode: PlayEpisode | undefined = useMemo(
    () =>
      request.season != null && request.episode != null
        ? { season: request.season, episode: request.episode }
        : undefined,
    [request.season, request.episode],
  );
  const streamIds = useStreamIds(meta, episode, resolvedImdb.id);
  const animeTitles = useAnimeAltTitles(meta);
  // Same filter posture Big Picture starts from (use-bp-streams): strict
  // only when the user set it, off disables pipeline filtering entirely.
  const [strictMode] = useState(settings.streamFilterLevel === "strict");
  const filterDisabled = settings.streamFilterLevel === "off";
  const { result, loading, pipelineDone, resolveError, addonQuorum, refresh } = usePipelineResult({
    meta,
    episode,
    imdbId: resolvedImdb.id,
    imdbIdVerified: resolvedImdb.verified,
    streamIds,
    addons,
    debrids,
    settings,
    strictMode,
    filterDisabled,
    animeTitles,
  });
  const streams = useMemo(() => result?.picker.all ?? [], [result]);

  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<ScoredStream>>(new Set());
  const [pickError, setPickError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const proxyRef = useRef<string | null>(null);

  const releaseProxy = useCallback(() => {
    if (proxyRef.current) {
      void unregisterStreamProxy(proxyRef.current).catch(() => {});
      proxyRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      acRef.current?.abort();
      releaseProxy();
    },
    [releaseProxy],
  );

  // Back closes the sheet (the player overlay, when open, registers above
  // this and takes the press first).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isPhoneBackActive()) return;
    return pushPhoneBack(() => {
      closeRef.current();
      return true;
    });
  }, []);

  const pick = useCallback(
    async (s: ScoredStream) => {
      if (resolvingKey) return;
      setPickError(null);
      setResolvingKey(streamIdentity(s));
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const hint = episode
          ? { season: episode.season, episode: episode.episode }
          : undefined;
        const allowP2pFallback = settings.streamMode !== "addons" || !!s.infoHash;
        const r = await resolveStream(
          s,
          debrids,
          ac.signal,
          true,
          false,
          hint,
          allowP2pFallback,
          true,
        );
        if (ac.signal.aborted) return;
        if (!r.ok) {
          setFailed((prev) => new Set(prev).add(s));
          setPickError(t("This stream could not be resolved. Try another one."));
          return;
        }
        let url = r.data.url;
        if (r.via === "direct") {
          url = await resolvePlaybackRedirect({
            url,
            headers: r.data.headers,
            signal: ac.signal,
          });
          if (ac.signal.aborted) return;
        }
        if (!/^https?:\/\//i.test(url)) {
          // A completed download resolves to a filesystem path; a WebView
          // <video> cannot open those. Say so instead of failing silently.
          setFailed((prev) => new Set(prev).add(s));
          setPickError(
            t(
              "This source is a file stored on this device. Playing local files in the app arrives with the native player.",
            ),
          );
          return;
        }
        if (r.data.headers && Object.keys(r.data.headers).length > 0) {
          // The web player cannot send the source's required headers; the
          // on-device proxy (proxy_register, registered on mobile) replays
          // them, exactly as the desktop pick handler arranges.
          const proxied = await registerStreamProxy(r.data.url, r.data.headers);
          if (ac.signal.aborted) {
            void unregisterStreamProxy(proxied.sessionId).catch(() => {});
            return;
          }
          releaseProxy();
          proxyRef.current = proxied.sessionId;
          url = proxied.url;
        }
        savePlayback(
          meta.id,
          {
            infoHash: s.infoHash ?? null,
            fileIdx: r.data.fileIdx ?? s.fileIdx ?? null,
            addonId: s.addonId ?? null,
            url: r.data.url,
            title: meta.name,
            parsedTitle: s.parsedTitle ?? null,
            resolution: s.resolution ?? null,
            releaseGroup: s.releaseGroupNormalized ?? null,
            source: s.source ?? null,
            audioLanguages: s.audioLanguages ?? null,
            size: s.size ?? null,
            bingeGroup: s.behaviorHints?.bingeGroup ?? null,
            cachedSlugs: Object.entries(s.cached ?? {})
              .filter(([, v]) => v === true)
              .map(([k]) => k),
          },
          episode?.season,
          episode?.episode,
        );
        setPlaying({ url, label: s.title || s.parsedTitle || s.name || meta.name });
      } catch {
        if (!ac.signal.aborted) {
          setFailed((prev) => new Set(prev).add(s));
          setPickError(t("This stream could not be resolved. Try another one."));
        }
      } finally {
        if (!ac.signal.aborted) setResolvingKey(null);
      }
    },
    [debrids, episode, meta, releaseProxy, resolvingKey, settings.streamMode, t],
  );

  const subtitle = episode
    ? t("Season {season} · Episode {episode}", {
        season: episode.season,
        episode: episode.episode,
      })
    : meta.releaseInfo || undefined;

  const sheet = (
    <div className="fixed inset-0 z-[65] flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label={t("Close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        className="relative flex max-h-[85vh] flex-col rounded-t-3xl bg-canvas"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)" }}
      >
        <div className="flex flex-col items-center gap-2 pt-3">
          <span className="h-1 w-9 rounded-full bg-edge" />
        </div>
        <div className="flex items-start gap-3 px-5 pb-2 pt-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-[16px] font-semibold text-ink">{meta.name}</p>
            <p className="text-[12.5px] text-ink-subtle">
              {subtitle ? `${subtitle} · ` : ""}
              {t("Choose a stream")}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            aria-label={t("Search again")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink-muted ring-1 ring-edge-soft transition-transform active:scale-95"
          >
            <RefreshCw size={16} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink-muted ring-1 ring-edge-soft transition-transform active:scale-95"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {pickError && (
            <div className="mx-2 mb-2 flex items-start gap-2 rounded-2xl bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-ink-muted ring-1 ring-edge-soft">
              <AlertTriangle size={15} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <span>{pickError}</span>
            </div>
          )}
          {streams.map((s) => (
            <StreamRow
              key={streamIdentity(s)}
              stream={s}
              cached={streamIsCached(s, debrids)}
              resolving={resolvingKey === streamIdentity(s)}
              failed={failed.has(s)}
              onPick={() => void pick(s)}
            />
          ))}
          {streams.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              {resolveError ? (
                <>
                  <AlertTriangle size={22} strokeWidth={1.9} className="text-ink-subtle" />
                  <p className="text-[13.5px] leading-relaxed text-ink-muted">{resolveError}</p>
                </>
              ) : pipelineDone ? (
                <p className="text-[13.5px] leading-relaxed text-ink-muted">
                  {t("No streams found for this title.")}
                </p>
              ) : (
                <>
                  <Loader2 size={22} className="animate-spin text-ink-subtle" />
                  <p className="text-[13.5px] text-ink-muted">
                    {addonQuorum.total > 0
                      ? t("Finding streams… {settled} of {total} addons answered", {
                          settled: addonQuorum.settled,
                          total: addonQuorum.total,
                        })
                      : t("Finding streams…")}
                  </p>
                </>
              )}
            </div>
          )}
          {loading && streams.length > 0 && (
            <p className="flex items-center justify-center gap-2 py-3 text-[12.5px] text-ink-subtle">
              <Loader2 size={13} className="animate-spin" />
              {t("More addons are still answering…")}
            </p>
          )}
        </div>

        <p className="px-6 pt-1 text-center text-[11.5px] leading-relaxed text-ink-subtle">
          {t(
            "The web player handles MP4 and HLS streams. MKV and some other formats need the native player, coming in a later update.",
          )}
        </p>
      </div>
      {playing && (
        <LocalPlayerOverlay
          title={meta.name}
          subtitle={subtitle}
          url={playing.url}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
  return typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet;
}

function StreamRow({
  stream: s,
  cached,
  resolving,
  failed,
  onPick,
}: {
  stream: ScoredStream;
  cached: boolean;
  resolving: boolean;
  failed: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const title = s.title || s.parsedTitle || s.name || s.addonName;
  const size = s.size ? formatBytes(s.size) : "";
  const parts = [
    s.addonName,
    formatStreamQuality(s),
    size,
    s.seeders != null ? t("{count} seeders", { count: s.seeders }) : null,
    cached ? t("Cached") : null,
  ].filter((p): p is string => !!p);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={resolving}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start transition-colors active:bg-surface ${
        failed ? "opacity-50" : ""
      }`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink ring-1 ring-edge-soft">
        {resolving ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Play size={15} className="fill-current" strokeWidth={0} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">
          {title}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-subtle">
          <span>{parts.join(" · ")}</span>
          {s.container === "mkv" && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-muted ring-1 ring-edge-soft">
              MKV
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function LocalPlayerOverlay({
  title,
  subtitle,
  url,
  onClose,
}: {
  title: string;
  subtitle?: string;
  url: string;
  onClose: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const isHls = /\.m3u8($|\?)/i.test(url);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHls) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    // No MSE (older WebView): let the element try the URL natively.
    video.src = url;
    return undefined;
  }, [url, isHls]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isPhoneBackActive()) return;
    return pushPhoneBack(() => {
      closeRef.current();
      return true;
    });
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div
        className="flex items-center gap-3 px-4 pb-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-[14.5px] font-semibold text-white">{title}</p>
          {subtitle && <p className="text-[12px] text-white/60">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-transform active:scale-95"
        >
          <X size={17} strokeWidth={2.2} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {failed ? (
          <div className="flex max-w-[300px] flex-col items-center gap-3 px-6 text-center">
            <AlertTriangle size={26} strokeWidth={1.8} className="text-white/70" />
            <p className="text-[14px] leading-relaxed text-white/85">
              {t(
                "This stream's format cannot play in the web player. MKV and some other formats need the native player, coming in a later update — try another stream for now.",
              )}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white px-5 py-2.5 text-[13.5px] font-semibold text-black transition-transform active:scale-95"
            >
              {t("Back to streams")}
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={isHls ? undefined : url}
            autoPlay
            controls
            playsInline
            onError={() => setFailed(true)}
            className="max-h-full w-full"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
