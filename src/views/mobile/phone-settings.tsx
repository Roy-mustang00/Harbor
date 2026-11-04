import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Blocks,
  Captions,
  Download,
  Gauge,
  Home,
  Image,
  KeyRound,
  Languages,
  LayoutGrid,
  Play,
  SlidersHorizontal,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import {
  getSportsConsentServerSnapshot,
  getSportsConsentSnapshot,
  resetSportsConsent,
  subscribeSportsConsent,
} from "@/lib/sports/consent";
import {
  bpConnectedNames,
  bpSettingsCategories,
  bpSettingsControls,
  type BpCatId,
  type BpControl,
} from "@/views/big-picture/bp-settings-catalog";
import { useBpSettingsWriter } from "@/views/big-picture/bp-settings-commit";
import { isPhoneBackActive, pushPhoneBack } from "./phone-back";
import {
  AccountKeysSection,
  AddonsSection,
  DiagnosticsSection,
  GroupDivider,
  NavRow,
  OptionListRow,
  SettingsGroup,
  StorageSection,
  ToggleRow,
  TorrentSection,
  ValueRow,
} from "./phone-settings-sections";

// Stage 2 slice 4: the standalone phone shell's settings screen, reached
// from the Profile tab. Phase A renders the Big Picture settings catalog
// (bp-settings-catalog.ts — the same categories, options and commit logic
// the TV surface uses, so both surfaces write one settings model) as touch
// rows. Phase B adds the general sections BP deliberately omits — account &
// keys, addons, downloads & storage, torrent engine, diagnostics — from
// phone-settings-sections.tsx. Mounted only by MobileProfile in standalone
// mode; the desktop settings view and BP settings are untouched.
//
// Two catalog controls do not translate to a phone and are adapted here:
// - "push: connect" opens this screen's Account & keys section instead of
//   BP's QR pairing pane (the phone is the device being set up), and its
//   detail line reports the real connection summary rather than the TV
//   copy inviting a phone scan.
// - "action: leave" (Leave Big Picture) is not rendered: there is no Big
//   Picture session to leave in the phone entry.

type SettingsView =
  | { kind: "root" }
  | { kind: "catalog"; id: BpCatId }
  | { kind: "account" }
  | { kind: "addons" }
  | { kind: "storage" }
  | { kind: "torrent" }
  | { kind: "diagnostics" }
  | { kind: "live" };

const CAT_ICONS: Record<BpCatId, ReactNode> = {
  picture: <Image size={20} strokeWidth={2} />,
  language: <Languages size={20} strokeWidth={2} />,
  subtitles: <Captions size={20} strokeWidth={2} />,
  playback: <Play size={20} strokeWidth={2} />,
  home: <Home size={20} strokeWidth={2} />,
  services: <LayoutGrid size={20} strokeWidth={2} />,
  setup: <Wrench size={20} strokeWidth={2} />,
  interface: <SlidersHorizontal size={20} strokeWidth={2} />,
};

export function PhoneSettings({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { user } = useAuth();
  const { settings, overscan, commit } = useBpSettingsWriter();
  const consent = useSyncExternalStore(
    subscribeSportsConsent,
    getSportsConsentSnapshot,
    getSportsConsentServerSnapshot,
  );
  const [view, setView] = useState<SettingsView>({ kind: "root" });

  // Hardware Back steps this screen's own navigation before closing it,
  // mirroring the layer order the rest of the shell uses: registered once,
  // read through refs, so it stays a single entry on the phone-back stack
  // for the screen's whole lifetime.
  const viewRef = useRef(view);
  viewRef.current = view;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isPhoneBackActive()) return;
    return pushPhoneBack(() => {
      if (viewRef.current.kind !== "root") {
        setView({ kind: "root" });
        return true;
      }
      onCloseRef.current();
      return true;
    });
  }, []);

  const connected = bpConnectedNames({
    tmdbKey: settings.tmdbKey,
    stremioName: user?.email ?? null,
    harborName: null,
  });
  const categories = bpSettingsCategories(settings, t, overscan, connected);

  const title =
    view.kind === "root"
      ? t("Settings")
      : view.kind === "catalog"
        ? (categories.find((c) => c.id === view.id)?.label ?? t("Settings"))
        : view.kind === "account"
          ? t("Account & API keys")
          : view.kind === "addons"
            ? t("Addons")
            : view.kind === "storage"
              ? t("Downloads & storage")
              : view.kind === "torrent"
                ? t("Torrent engine")
                : view.kind === "diagnostics"
                  ? t("Diagnostics")
                  : t("Live TV playlists");

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-canvas">
      <header
        className="flex items-center gap-2 px-3 pb-1"
        style={{
          paddingTop: "calc(var(--harbor-safe-top, env(safe-area-inset-top, 0px)) + 10px)",
        }}
      >
        <button
          type="button"
          aria-label={t("Back")}
          onClick={() => {
            if (view.kind !== "root") setView({ kind: "root" });
            else onClose();
          }}
          className="flex h-12 w-12 items-center justify-center rounded-full text-ink transition-colors active:bg-raised/60"
        >
          <ArrowLeft size={21} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-center text-[19px] font-semibold text-ink">{title}</h1>
        <span className="h-12 w-12" />
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4"
        style={{
          paddingBottom:
            "calc(var(--harbor-safe-bottom, env(safe-area-inset-bottom, 0px)) + 28px)",
        }}
      >
        <div className="flex flex-col gap-6">
          {view.kind === "root" && (
            <>
              <SettingsGroup title={t("General")}>
                <NavRow
                  icon={<KeyRound size={20} strokeWidth={2} />}
                  label={t("Account & API keys")}
                  detail={connected.length > 0 ? connected.join(", ") : t("Not connected")}
                  onClick={() => setView({ kind: "account" })}
                />
                <GroupDivider />
                <NavRow
                  icon={<Blocks size={20} strokeWidth={2} />}
                  label={t("Addons")}
                  onClick={() => setView({ kind: "addons" })}
                />
                <GroupDivider />
                <NavRow
                  icon={<Download size={20} strokeWidth={2} />}
                  label={t("Downloads & storage")}
                  onClick={() => setView({ kind: "storage" })}
                />
                <GroupDivider />
                <NavRow
                  icon={<Zap size={20} strokeWidth={2} />}
                  label={t("Torrent engine")}
                  onClick={() => setView({ kind: "torrent" })}
                />
                <GroupDivider />
                <NavRow
                  icon={<Gauge size={20} strokeWidth={2} />}
                  label={t("Diagnostics")}
                  onClick={() => setView({ kind: "diagnostics" })}
                />
              </SettingsGroup>

              <SettingsGroup title={t("Preferences")}>
                {categories.map((cat, i) => (
                  <div key={cat.id}>
                    {i > 0 && <GroupDivider />}
                    <NavRow
                      icon={CAT_ICONS[cat.id]}
                      label={cat.label}
                      detail={cat.summary}
                      onClick={() => setView({ kind: "catalog", id: cat.id })}
                    />
                  </div>
                ))}
              </SettingsGroup>
            </>
          )}

          {view.kind === "catalog" && (
            <CatalogControls
              controls={bpSettingsControls(
                view.id,
                settings,
                t,
                overscan,
                consent.status !== "declined",
              )}
              commit={commit}
              connected={connected}
              onPush={(pane) =>
                setView(pane === "connect" ? { kind: "account" } : { kind: "live" })
              }
            />
          )}

          {view.kind === "account" && <AccountKeysSection />}
          {view.kind === "addons" && <AddonsSection />}
          {view.kind === "storage" && <StorageSection />}
          {view.kind === "torrent" && <TorrentSection />}
          {view.kind === "diagnostics" && <DiagnosticsSection />}
          {view.kind === "live" && <LivePlaylistsView />}
        </div>
      </div>
    </div>
  );
}

function CatalogControls({
  controls,
  commit,
  connected,
  onPush,
}: {
  controls: BpControl[];
  commit: (controlId: string, value: string) => void;
  connected: string[];
  onPush: (pane: "connect" | "live") => void;
}) {
  const t = useT();
  const visible = controls.filter(
    (c) => !(c.kind === "action" && c.id === "leave"),
  );
  return (
    <SettingsGroup>
      {visible.map((control, i) => {
        return (
          <div key={control.id}>
            {i > 0 && <GroupDivider />}
            {control.kind === "options" && (
              <OptionListRow
                label={control.label}
                value={control.value}
                options={control.options}
                onSelect={(v) => commit(control.id, v)}
              />
            )}
            {control.kind === "multi" && (
              <div className="flex flex-col">
                <span className="px-4 pb-1 pt-3.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  {control.label}
                </span>
                {control.items.map((item) => (
                  <ToggleRow
                    key={item.value}
                    label={item.label}
                    detail={item.on && item.rank > 0 ? `#${item.rank}` : undefined}
                    on={item.on}
                    onChange={() => commit(control.id, item.value)}
                  />
                ))}
              </div>
            )}
            {control.kind === "push" && (
              <NavRow
                label={control.label}
                detail={
                  control.pane === "connect"
                    ? connected.length > 0
                      ? connected.join(", ")
                      : t("Not connected")
                    : control.detail
                }
                onClick={() => onPush(control.pane)}
              />
            )}
            {control.kind === "action" && (
              <ValueRow
                label={control.label}
                onClick={() => {
                  // BP pairs this with a jump to the Sports tab; the phone
                  // shell has no Sports tab to land on, so the press does
                  // the part that matters here — the consent (and with it
                  // the notice) is reset and will be asked again.
                  if (control.id === "sportsNotice") resetSportsConsent();
                }}
              />
            )}
          </div>
        );
      })}
    </SettingsGroup>
  );
}

function LivePlaylistsView() {
  const t = useT();
  const { settings, update } = useSettings();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const playlists = settings.iptvPlaylists;

  const add = () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      setError(t("URL must start with https://"));
      return;
    }
    setError(null);
    update({
      iptvPlaylists: [
        ...playlists,
        {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim() || u,
          url: u,
          kind: "m3u" as const,
        },
      ],
    });
    setName("");
    setUrl("");
  };

  return (
    <>
      <SettingsGroup title={t("Playlists")}>
        {playlists.length === 0 && <ValueRow label={t("No playlists yet")} />}
        {playlists.map((p, i) => (
          <div key={p.id}>
            {i > 0 && <GroupDivider />}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14.5px] font-medium text-ink">{p.name}</span>
                <span className="truncate text-[12px] text-ink-subtle">{p.url}</span>
              </span>
              <button
                type="button"
                aria-label={t("Remove")}
                onClick={() =>
                  update({ iptvPlaylists: playlists.filter((x) => x.id !== p.id) })
                }
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-ink-subtle active:bg-raised/60"
              >
                <Trash2 size={17} strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title={t("Add a playlist")}>
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Name")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl border border-edge-soft bg-canvas/60 px-3.5 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("M3U link")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl border border-edge-soft bg-canvas/60 px-3.5 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
          />
          <button
            type="button"
            disabled={!url.trim()}
            onClick={add}
            className="flex h-12 items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {t("Add")}
          </button>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </SettingsGroup>
    </>
  );
}
