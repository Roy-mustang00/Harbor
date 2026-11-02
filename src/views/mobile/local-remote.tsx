import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Info } from "lucide-react";
import type { Meta } from "@/lib/cinemeta";
import { useAuth } from "@/lib/auth";
import { useProfiles, type Profile } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import {
  getSession as getAnilistSession,
  isAuthenticated as isAnilistAuthenticated,
  subscribeSession as subscribeAnilistSession,
} from "@/lib/anilist/session";
import {
  getSession as getMalSession,
  isAuthenticated as isMalAuthenticated,
  subscribeSession as subscribeMalSession,
} from "@/lib/mal/session";
import { runLibraryAction } from "@/lib/remote/library-commands";
import { useLibrarySnapshot } from "@/lib/remote/library-snapshot";
import {
  idleSnapshot,
  type RemoteCommand,
  type RemoteProfile,
  type RemoteSnapshot,
  type RemoteTrackers,
} from "@/lib/remote/protocol";
import {
  getSession as getSimklSession,
  subscribeSession as subscribeSimklSession,
} from "@/lib/simkl/session";
import {
  getSession as getTraktSession,
  subscribeSession as subscribeTraktSession,
} from "@/lib/trakt/session";
import { LocalPlaySheet, type LocalPlayRequest } from "./local-play";
import { MobileRemoteContext, type MobileRemoteValue } from "./mobile-remote";

type PlayOpts = { season?: number; episode?: number; resume?: boolean };

function toRemoteProfile(p: Profile): RemoteProfile {
  return { id: p.id, name: p.name, avatar: p.avatar, color: p.color };
}

// Tracker connection state without the tracker React providers (the phone
// entry does not mount TraktProvider & friends). Each tracker's session
// lives in a module store — the providers are only a React facade over
// getSession/subscribeSession — so read the stores directly and mirror the
// providers' own isConnected formulas (host-mount.tsx feeds the same flags
// into its snapshot from the provider side).
function useLocalTrackers(): RemoteTrackers {
  const { authKey } = useAuth();
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const unsubs = [
      subscribeTraktSession(bump),
      subscribeSimklSession(bump),
      subscribeAnilistSession(bump),
      subscribeMalSession(bump),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, []);
  const trakt = !!getTraktSession();
  const simkl = !!getSimklSession();
  const stremio = !!authKey;
  const anilist = !!getAnilistSession() && isAnilistAuthenticated();
  const mal = !!getMalSession() && isMalAuthenticated();
  return useMemo(
    () => ({ trakt, simkl, stremio, anilist, mal }),
    [trakt, simkl, stremio, anilist, mal],
  );
}

// The standalone phone shell's answer to MobileRemoteProvider: same
// MobileRemoteValue shape, no WebSocket, no host. The "host" is this device,
// so the snapshot is synthesized from local stores (idle=false with no media
// loaded: the session is live, nothing is playing — the now-playing bar
// additionally requires a mediaId, so it stays hidden, while the detail
// sheet's library actions read as online and stay enabled).
//
// Commands split three ways:
// - libraryAction executes on-device via the exact function the desktop host
//   runs for remote phones (src/lib/remote/library-commands.ts) — the local
//   libs it drives (watchlist, watched, favorites, tracker lists) are the
//   phone's own stores already.
// - setProfile switches the local active profile (who's-watching).
// - Everything else is host-only (transport, nav, cast, manga sessions) and
//   declines, exactly as an unreachable host did.
// snapshot.library is built on-device by useLibrarySnapshot — the same
// assembly the desktop host uses (src/lib/remote/library-snapshot.ts) — so
// the Library tab, the detail sheet's favorites/watchlist/watched initial
// state, and the search/detail "on this device" badges all read real data.
// snapshot.trackers mirrors the providers' connection flags from the
// session stores, which is what unhides the detail sheet's tracker rows.
// Play runs locally (local-play.tsx): pipeline → resolveStream → HTML5
// overlay. openOnHost (person pages) has no phone surface yet and stays a
// notice stub. No WS client, no settings-key sync (local settings are the
// source on-device).
export function LocalMobileRemoteProvider({ children }: { children: ReactNode }) {
  const { profiles, activeProfile, selectProfile } = useProfiles();
  const { settings } = useSettings();
  const trackers = useLocalTrackers();
  const localeKey = `${settings.tmdbLanguage}:${settings.tmdbImageLangs.join(",")}:${settings.translateTitles}:${settings.translateDescriptions}`;
  const library = useLibrarySnapshot({
    enabled: true,
    bookmarkedOnly: settings.libraryBookmarkedOnly,
    tmdbKey: settings.tmdbKey,
    localeKey,
    traktConnected: trackers.trakt,
  });
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const [playState, setPlayState] = useState<{ seq: number; request: LocalPlayRequest } | null>(
    null,
  );

  const snapshot: RemoteSnapshot = useMemo(
    () =>
      idleSnapshot({
        idle: false,
        profile: activeProfile ? toRemoteProfile(activeProfile) : null,
        profiles: profiles.map(toRemoteProfile),
        library: library ?? undefined,
        trackers,
      }),
    [profiles, activeProfile, library, trackers],
  );

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 2200);
  }, []);

  const playOnHost = useCallback((meta: Meta, opts?: PlayOpts) => {
    setPlayState((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      request: { meta, season: opts?.season, episode: opts?.episode },
    }));
  }, []);

  const openOnHost = useCallback(
    (_meta: Meta) => {
      showFlash("That page is coming to the phone app in the next update");
    },
    [showFlash],
  );

  const sendCommand = useCallback(
    (command: RemoteCommand): boolean => {
      switch (command.action) {
        case "libraryAction":
          void runLibraryAction(command).catch((err) => {
            console.error("[harbor] local library action failed", err);
          });
          return true;
        case "setProfile":
          return selectProfile(command.id);
        default:
          return false;
      }
    },
    [selectProfile],
  );

  const value = useMemo<MobileRemoteValue>(
    () => ({ connected: true, snapshot, playOnHost, openOnHost, sendCommand }),
    [snapshot, playOnHost, openOnHost, sendCommand],
  );

  return (
    <MobileRemoteContext.Provider value={value}>
      {children}
      {playState && (
        <LocalPlaySheet
          key={playState.seq}
          request={playState.request}
          onClose={() => setPlayState(null)}
        />
      )}
      {flash && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          <div className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-canvas shadow-[0_8px_28px_-8px_rgba(0,0,0,0.6)] backdrop-blur-xl animate-fade-in">
            <Info size={16} strokeWidth={2.4} />
            {flash}
          </div>
        </div>
      )}
    </MobileRemoteContext.Provider>
  );
}
