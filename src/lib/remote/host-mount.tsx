import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { discoverCastDevices } from "@/lib/cast";
import { getPlaybackPosition, subscribePlaybackClock } from "@/lib/player/playback-clock";
import { useSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { useTrakt } from "@/lib/trakt/provider";
import { useSimkl } from "@/lib/simkl/provider";
import { useAnilist } from "@/lib/anilist/provider";
import { useMal } from "@/lib/mal/provider";
import {
  buildRemoteSnapshot,
  dispatchRemoteCommand,
  setRemoteCastDiscovering,
  setRemoteCastDevices,
  setRemoteHostConfig,
  setRemoteHostName,
  setRemoteLibrary,
  setRemoteTrackers,
  subscribeRemoteSession,
} from "./session";
import {
  buildRemoteMangaState,
  dispatchMangaCommand,
  isMangaCommand,
  subscribeRemoteManga,
} from "./manga-session";
import { subscribeMangaBookmarks } from "@/lib/manga-bookmarks";
import { installTextEntryListeners } from "./text-entry";
import { REMOTE_PROTO, parseClientMessage, type RemoteServerMessage } from "./protocol";
import { useLibrarySnapshot } from "./library-snapshot";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function broadcast(msg: RemoteServerMessage) {
  if (!isTauri) return;
  void invoke("remote_ws_broadcast", { payload: JSON.stringify(msg) }).catch(() => {});
}

function pushSnapshot(force = false) {
  const snapshot = { ...buildRemoteSnapshot(getPlaybackPosition()), manga: buildRemoteMangaState() };
  if (!force) {
    const { updatedAt: _ignored, ...rest } = snapshot;
    void _ignored;
    const json = JSON.stringify(rest);
    if (json === lastSnapshotJson && Date.now() - lastSnapshotAt < SNAPSHOT_HEARTBEAT_MS) return;
    lastSnapshotJson = json;
  } else {
    lastSnapshotJson = "";
  }
  lastSnapshotAt = Date.now();
  broadcast({ t: "snapshot", snapshot });
}

const SKIP_SNAPSHOT = new Set(["nav", "setText", "ping"]);

let lastSnapshotJson = "";
let lastSnapshotAt = 0;
const SNAPSHOT_HEARTBEAT_MS = 5000;

/**
 * Host-side remote control plane. Mount only in the Tauri desktop shell.
 * Relays WS commands to the active player/cast binding and pushes snapshots.
 */
export function RemoteHostMount() {
  const { settings } = useSettings();
  const enabled = settings.serveWebUi || settings.remoteControlEnabled;
  const localeKey = `${settings.tmdbLanguage}:${settings.tmdbImageLangs.join(",")}:${settings.translateTitles}:${settings.translateDescriptions}`;
  const { isConnected: traktConnected } = useTrakt();
  const hostLibrary = useLibrarySnapshot({
    enabled,
    bookmarkedOnly: settings.libraryBookmarkedOnly,
    tmdbKey: settings.tmdbKey,
    localeKey,
    traktConnected,
  });
  const { authKey } = useAuth();
  const { isConnected: simklConnected } = useSimkl();
  const { isConnected: anilistConnected } = useAnilist();
  const { isConnected: malConnected } = useMal();
  const timerRef = useRef<number>(0);

  // Snapshot construction is synchronous, so keep its locale configuration current
  // during render instead of waiting for an effect that may run after a client joins.
  setRemoteHostConfig({
    tmdbKey: settings.tmdbKey,
    rpdbKey: settings.rpdbKey,
    tvdbKey: settings.tvdbKey,
    tmdbLanguage: settings.tmdbLanguage,
    tmdbImageLangs: settings.tmdbImageLangs,
    translateTitles: settings.translateTitles,
    translateDescriptions: settings.translateDescriptions,
  });

  useEffect(() => {
    if (isTauri && enabled) pushSnapshot();
  }, [settings.tmdbKey, settings.rpdbKey, settings.tvdbKey, localeKey, enabled]);

  useEffect(() => {
    setRemoteTrackers({
      trakt: traktConnected,
      simkl: simklConnected,
      stremio: !!authKey,
      anilist: anilistConnected,
      mal: malConnected,
    });
    if (isTauri && enabled) pushSnapshot();
  }, [traktConnected, simklConnected, anilistConnected, malConnected, authKey, enabled]);

  useEffect(() => {
    setRemoteLibrary(hostLibrary);
    if (isTauri && enabled) pushSnapshot();
  }, [hostLibrary, enabled]);

  useEffect(() => {
    if (!isTauri) return;
    void invoke<{ name: string }>("harbor_lan_identity")
      .then((id) => {
        setRemoteHostName(id.name);
        if (enabled) pushSnapshot();
      })
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!isTauri || !enabled) return;

    let cancelled = false;
    const unsubs: Array<() => void> = [];

    void listen<{ clientId: number; raw: string }>("remote://cmd", (e) => {
      const raw = e.payload?.raw;
      if (!raw) return;
      const msg = parseClientMessage(raw);
      if (!msg) {
        broadcast({ t: "error", message: "invalid message" });
        return;
      }
      if (msg.t === "hello") {
        broadcast({ t: "hello", proto: REMOTE_PROTO, server: "harbor-remote" });
        pushSnapshot(true);
        return;
      }
      if (msg.t === "cmd") {
        void (async () => {
          try {
            if (msg.command.action === "castDiscover") {
              setRemoteCastDiscovering(true);
              setRemoteCastDevices([]);
              try {
                const devices = await discoverCastDevices();
                setRemoteCastDevices(devices);
              } finally {
                setRemoteCastDiscovering(false);
              }
              pushSnapshot();
              return;
            }
            if (msg.command.action === "ping") {
              broadcast({ t: "pong", at: Date.now() });
              return;
            }
            if (isMangaCommand(msg.command.action)) {
              await dispatchMangaCommand(msg.command);
              return;
            }
            await dispatchRemoteCommand(msg.command);
            // nav/setText: focusin/out + 400ms tick cover textEntry; skip churn.
            if (!SKIP_SNAPSHOT.has(msg.command.action)) pushSnapshot();
          } catch (err) {
            const message = err instanceof Error ? err.message : "remote command failed";
            broadcast({ t: "error", message });
            pushSnapshot();
          }
        })();
      }
    }).then((u) => {
      if (cancelled) u();
      else unsubs.push(u);
    });

    void listen<{ action: string }>("remote://client", (e) => {
      if (e.payload?.action === "join") {
        broadcast({ t: "hello", proto: REMOTE_PROTO, server: "harbor-remote" });
        pushSnapshot(true);
      }
    }).then((u) => {
      if (cancelled) u();
      else unsubs.push(u);
    });

    unsubs.push(subscribeRemoteSession(() => pushSnapshot()));
    let mangaRaf = 0;
    const pushMangaCoalesced = () => {
      if (mangaRaf) return;
      mangaRaf = requestAnimationFrame(() => {
        mangaRaf = 0;
        pushSnapshot();
      });
    };
    unsubs.push(subscribeRemoteManga(pushMangaCoalesced));
    unsubs.push(subscribeMangaBookmarks(pushMangaCoalesced));
    unsubs.push(() => {
      if (mangaRaf) cancelAnimationFrame(mangaRaf);
    });
    unsubs.push(
      subscribePlaybackClock(() => {
        // throttle via shared interval below
      }),
    );

    const onFocusChange = () => pushSnapshot();
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    unsubs.push(() => {
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
    });
    unsubs.push(installTextEntryListeners());

    setRemoteCastDiscovering(true);
    void discoverCastDevices()
      .then((devices) => {
        if (!cancelled) {
          setRemoteCastDevices(devices);
        }
      })
      .finally(() => {
        if (!cancelled) setRemoteCastDiscovering(false);
      });

    timerRef.current = window.setInterval(() => {
      pushSnapshot();
    }, 400);

    pushSnapshot();

    return () => {
      cancelled = true;
      window.clearInterval(timerRef.current);
      for (const u of unsubs) u();
    };
  }, [enabled]);

  return null;
}
