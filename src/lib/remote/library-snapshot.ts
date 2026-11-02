import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocalLibrary, localEntryToMeta } from "@/lib/local-library";
import { useMediaFavorites } from "@/lib/media-favorites";
import {
  mediaServerConnections,
  subscribeMediaServerConnections,
} from "@/lib/media-server/connections";
import { mediaServerItems } from "@/lib/media-server/index-store";
import { groupMediaServerTitles } from "@/lib/media-server/selectors";
import { subscribeMediaServerSyncProgress } from "@/lib/media-server/sync";
import { library, libraryMetaType, type LibraryItem } from "@/lib/stremio";
import { fetchWatchedHistory, type HistoryItem } from "@/lib/trakt/history";
import { traktItemToMeta } from "@/lib/trakt/to-meta";
import type { TraktItem } from "@/lib/trakt/types";
import { fetchWatchlist } from "@/lib/trakt/watchlist";
import { readLocalEntries, subscribeWatchlist, type LocalEntry } from "@/lib/watchlist";
import { hydrateLibraryMeta } from "@/views/library/hydrate-meta";
import type { RemoteLibrary, RemoteLibraryItem } from "./protocol";

// Builds the RemoteLibrary shape (watchlist / history / favorites / local /
// mediaServers) from this device's own data libraries. This is the exact
// assembly the desktop host runs in host-mount.tsx to feed remote phones —
// extracted so the standalone phone shell builds its own library on-device
// (LocalMobileRemoteProvider) from the same code instead of a copy. Every
// source is a frontend library whose transport (harbor_fetch, the Stremio
// datastore, the local-library store, media_server_request) is registered
// in the mobile builder, so the hook is habitat-neutral; the one habitat
// difference is how "Trakt is connected" is known, which the caller passes
// in (TraktProvider state on desktop, the session store on the phone).

const LIBRARY_CAP = 60;

type Dated = { item: RemoteLibraryItem; date: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function parseTs(s?: string | null): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

function idExists(map: Map<string, Dated>, id: string): boolean {
  for (const v of map.values()) if (v.item.id === id) return true;
  return false;
}

function isBookmark(i: LibraryItem, bookmarkedOnly: boolean): boolean {
  if (i.removed) return false;
  if (i.state?.flaggedWatched === 1) return false;
  if ((i.state?.timeOffset ?? 0) > 0) return false;
  if (bookmarkedOnly && i.temp) return false;
  return true;
}

function isWatched(i: LibraryItem): boolean {
  if (i.removed && !i.temp) return false;
  return i.state?.flaggedWatched === 1 || (i.state?.timeOffset ?? 0) > 0;
}

function capped(map: Map<string, Dated>): RemoteLibraryItem[] {
  return [...map.values()]
    .sort((a, b) => b.date - a.date)
    .slice(0, LIBRARY_CAP)
    .map((d) => d.item);
}

function mergeWatchlist(
  local: LocalEntry[],
  stremio: LibraryItem[],
  trakt: TraktItem[],
): RemoteLibraryItem[] {
  const byKey = new Map<string, Dated>();
  for (const i of stremio) {
    const item: RemoteLibraryItem = {
      id: i._id,
      type: libraryMetaType(i.type),
      name: i.name,
      poster: i.poster,
      background: i.background,
    };
    const key = `${i.type}:${norm(i.name ?? "")}`;
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { item, date: parseTs(i._mtime) });
    else if (!cur.item.id.startsWith("tt") && item.id.startsWith("tt"))
      byKey.set(key, { item, date: parseTs(i._mtime) });
  }
  for (const t of trakt) {
    const m = traktItemToMeta(t);
    if (!m) continue;
    const key = `${m.type}:${norm(m.name ?? "")}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      item: { id: m.id, type: m.type, name: m.name, poster: m.poster, background: m.background },
      date: parseTs(t.contextDate),
    });
  }
  for (const e of local) {
    if (idExists(byKey, e.id)) continue;
    const key = e.name ? `${e.type}:${norm(e.name)}` : `local:${e.id}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      item: { id: e.id, type: e.type, name: e.name || e.id, poster: e.poster },
      date: e.addedAt || 0,
    });
  }
  return capped(byKey);
}

function mergeHistory(stremio: LibraryItem[], trakt: HistoryItem[]): RemoteLibraryItem[] {
  const byId = new Map<string, Dated>();
  for (const i of stremio) {
    byId.set(i._id, {
      item: {
        id: i._id,
        type: libraryMetaType(i.type),
        name: i.name,
        poster: i.poster,
        background: i.background,
      },
      date: parseTs(i.state?.lastWatched ?? i._mtime),
    });
  }
  for (const h of trakt) {
    const id = h.type === "movie" ? h.imdb : h.showImdb;
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      item: { id, type: h.type === "movie" ? "movie" : "series", name: h.title },
      date: parseTs(h.watchedAt),
    });
  }
  return capped(byId);
}

function useStremioLibrary(enabled: boolean): LibraryItem[] {
  const { authKey } = useAuth();
  const [items, setItems] = useState<LibraryItem[]>([]);
  useEffect(() => {
    if (!enabled || !authKey) {
      setItems([]);
      return;
    }
    let alive = true;
    library(authKey)
      .then((r) => {
        if (alive) setItems(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, authKey]);
  return items;
}

function useTraktData(
  enabled: boolean,
  isConnected: boolean,
): { watchlist: TraktItem[]; history: HistoryItem[] } {
  const [watchlist, setWatchlist] = useState<TraktItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useEffect(() => {
    if (!enabled || !isConnected) {
      setWatchlist([]);
      setHistory([]);
      return;
    }
    let alive = true;
    Promise.allSettled([fetchWatchlist(), fetchWatchedHistory(200)]).then((r) => {
      if (!alive) return;
      if (r[0].status === "fulfilled") setWatchlist(r[0].value);
      if (r[1].status === "fulfilled") setHistory(r[1].value);
    });
    return () => {
      alive = false;
    };
  }, [enabled, isConnected]);
  return { watchlist, history };
}

function useLocalWatchlist(): LocalEntry[] {
  const [entries, setEntries] = useState<LocalEntry[]>(() => readLocalEntries());
  useEffect(() => {
    const tick = () => setEntries(readLocalEntries());
    window.addEventListener("storage", tick);
    const unsub = subscribeWatchlist(tick);
    return () => {
      window.removeEventListener("storage", tick);
      unsub();
    };
  }, []);
  return entries;
}

function useFavoriteItems(): RemoteLibraryItem[] {
  const { items } = useMediaFavorites();
  return useMemo(
    () =>
      [...items.values()]
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, LIBRARY_CAP)
        .map((e) => ({ id: e.id, type: e.type, name: e.name, poster: e.poster })),
    [items],
  );
}

function useLocalLibraryItems(tmdbKey: string, localeKey: string): RemoteLibraryItem[] {
  const files = useLocalLibrary();
  const [items, setItems] = useState<RemoteLibraryItem[]>([]);
  useEffect(() => {
    let alive = true;
    const byId = new Map<
      string,
      {
        base: NonNullable<ReturnType<typeof localEntryToMeta>>;
        tmdbId?: number;
        imdbId?: string;
      }
    >();
    for (const file of files) {
      const meta = localEntryToMeta(file);
      if (meta) {
        const previous = byId.get(meta.id);
        byId.set(meta.id, {
          base: meta,
          tmdbId: file.tmdbId ?? previous?.tmdbId,
          imdbId: file.imdbId ?? previous?.imdbId,
        });
      }
    }
    void Promise.all(
      [...byId.values()].slice(0, LIBRARY_CAP).map(async ({ base, tmdbId, imdbId }) => {
        const type = base.type === "series" ? "series" : "movie";
        const hydrated = await hydrateLibraryMeta(base.id, type, tmdbKey || null).catch(() => null);
        return {
          id: hydrated?.id ?? base.id,
          type: hydrated?.type ?? base.type,
          tmdbId,
          imdbId,
          name: hydrated?.name || base.name,
          poster: hydrated?.poster || base.poster,
          background: hydrated?.background,
          local: true,
        } satisfies RemoteLibraryItem;
      }),
    ).then((next) => {
      if (alive) setItems(next);
    });
    return () => {
      alive = false;
    };
  }, [files, tmdbKey, localeKey]);
  return items;
}

function useMediaServerItems(
  enabled: boolean,
  tmdbKey: string,
  localeKey: string,
): RemoteLibraryItem[] {
  const [items, setItems] = useState<RemoteLibraryItem[]>([]);
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    let alive = true;
    const load = async () => {
      const connections = mediaServerConnections().filter((connection) => connection.enabled);
      const byConnection = new Map(connections.map((connection) => [connection.id, connection]));
      const titles = groupMediaServerTitles(
        (await mediaServerItems()).filter((item) => byConnection.has(item.connectionId)),
      ).slice(0, LIBRARY_CAP);
      const next = await Promise.all(
        titles.map(async (title) => {
          const canonicalId =
            title.identity.tmdbId != null
              ? `tmdb:${title.kind === "movie" ? "movie" : "tv"}:${title.identity.tmdbId}`
              : (title.identity.imdbId ?? title.key);
          const meta = await hydrateLibraryMeta(canonicalId, title.kind, tmdbKey || null).catch(
            () => null,
          );
          const providers = [
            ...new Set(
              title.connectionIds
                .map((id) => byConnection.get(id)?.provider)
                .filter((provider): provider is "jellyfin" | "emby" | "plex" => !!provider),
            ),
          ];
          return {
            id: meta?.id ?? canonicalId,
            type: meta?.type ?? title.kind,
            tmdbId: title.identity.tmdbId,
            imdbId: title.identity.imdbId,
            name: meta?.name || title.fallbackTitle,
            poster: meta?.poster,
            background: meta?.background,
            mediaServerProviders: providers,
          } satisfies RemoteLibraryItem;
        }),
      );
      if (alive) setItems(next);
    };
    void load().catch(() => {
      if (alive) setItems([]);
    });
    const unsubConnections = subscribeMediaServerConnections(() => void load());
    const unsubSync = subscribeMediaServerSyncProgress((progress) => {
      if (!progress.active) void load();
    });
    return () => {
      alive = false;
      unsubConnections();
      unsubSync();
    };
  }, [enabled, tmdbKey, localeKey]);
  return items;
}

export function useLibrarySnapshot({
  enabled,
  bookmarkedOnly,
  tmdbKey,
  localeKey,
  traktConnected,
}: {
  enabled: boolean;
  bookmarkedOnly: boolean;
  tmdbKey: string;
  localeKey: string;
  traktConnected: boolean;
}): RemoteLibrary | null {
  const stremio = useStremioLibrary(enabled);
  const trakt = useTraktData(enabled, traktConnected);
  const local = useLocalWatchlist();
  const favorites = useFavoriteItems();
  const localLibrary = useLocalLibraryItems(tmdbKey, localeKey);
  const mediaServers = useMediaServerItems(enabled, tmdbKey, localeKey);
  return useMemo(() => {
    if (!enabled) return null;
    const bookmarks = stremio.filter((i) => isBookmark(i, bookmarkedOnly));
    const watched = stremio.filter(isWatched);
    return {
      watchlist: mergeWatchlist(local, bookmarks, trakt.watchlist),
      history: mergeHistory(watched, trakt.history),
      favorites,
      local: localLibrary,
      mediaServers,
    };
  }, [
    enabled,
    bookmarkedOnly,
    stremio,
    trakt.watchlist,
    trakt.history,
    local,
    favorites,
    localLibrary,
    mediaServers,
  ]);
}
