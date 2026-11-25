import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import {
  installFromUrl,
  isAddonEnabled,
  loadInstalled,
  setAddonEnabled,
  uninstallAddon,
  type InstalledAddon,
} from "@/lib/addon-store";
import {
  cancelDownload,
  pauseDownload,
  removeDownload,
  resumeDownload,
  useDownloads,
  type DownloadItem,
} from "@/lib/download/downloads-store";
import {
  torrentEngineHardReset,
  torrentEngineRestart,
  torrentEngineSelfTest,
  torrentEngineSetOptions,
  torrentEngineStatus,
  type EngineStatus,
  type SelfTestResult,
} from "@/lib/torrent/local-engine";
import { useAnilist } from "@/lib/anilist/provider";
import { useMal } from "@/lib/mal/provider";
import { useSimkl } from "@/lib/simkl/provider";
import { useLetterboxd } from "@/lib/stremboxd/provider";
import { useTrakt } from "@/lib/trakt/provider";
import { openUrl } from "@/lib/window";

// Stage 2 slice 4, phase B: the "general" sections the Big Picture settings
// catalog deliberately does not carry (account & keys, addons, downloads &
// storage, torrent engine, diagnostics), rendered as touch rows for the
// standalone phone shell. Everything here writes through the one shared
// settings model (useSettings) or Tauri commands registered in
// src-tauri/src/mobile.rs — nothing desktop-only is invoked. This module is
// imported only by phone-settings.tsx, which only the standalone shell
// mounts, so the web-remote habitat never loads it.
//
// The shared row primitives live here (not in phone-settings.tsx) so the
// catalog renderer there and the sections here stay one visual language
// without an import cycle.

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function SettingsGroup({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <h2 className="px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-2xl border border-edge-soft/70 bg-elevated/40">
        {children}
      </div>
      {footer && <p className="px-1 text-[12.5px] leading-relaxed text-ink-subtle">{footer}</p>}
    </section>
  );
}

export function GroupDivider() {
  return <span className="mx-4 block h-px bg-edge-soft/60" />;
}

export function NavRow({
  icon,
  label,
  detail,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-start transition-colors active:bg-raised/60"
    >
      {icon && <span className="shrink-0 text-ink-muted">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium text-ink">{label}</span>
        {detail && <span className="truncate text-[12.5px] text-ink-subtle">{detail}</span>}
      </span>
      <ChevronRight size={18} strokeWidth={2.2} className="shrink-0 text-ink-subtle" />
    </button>
  );
}

export function ValueRow({
  label,
  value,
  danger,
  onClick,
}: {
  label: string;
  value?: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={`min-w-0 flex-1 text-[15px] font-medium ${danger ? "text-danger" : "text-ink"}`}
      >
        {label}
      </span>
      {value && (
        <span className="max-w-[55%] truncate text-[13.5px] text-ink-subtle">{value}</span>
      )}
    </>
  );
  const skin = "flex w-full items-center gap-3.5 px-4 py-3.5 text-start";
  if (!onClick) return <div className={skin}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={`${skin} transition-colors active:bg-raised/60`}>
      {body}
    </button>
  );
}

export function ToggleRow({
  label,
  detail,
  on,
  onChange,
}: {
  label: string;
  detail?: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 px-4 py-3.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium text-ink">{label}</span>
        {detail && <span className="text-[12.5px] text-ink-subtle">{detail}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${
          on ? "bg-accent" : "bg-raised"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export function OptionListRow({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-start transition-colors active:bg-raised/60"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">{label}</span>
        <span className="max-w-[50%] truncate text-[13.5px] text-ink-subtle">
          {current?.label ?? value}
        </span>
        <ChevronDown
          size={18}
          strokeWidth={2.2}
          className={`shrink-0 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="flex flex-col pb-1.5">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onSelect(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 py-3.5 pe-4 ps-11 text-start transition-colors active:bg-raised/60"
              >
                <span
                  className={`min-w-0 flex-1 truncate text-[14.5px] ${
                    selected ? "font-semibold text-ink" : "text-ink-muted"
                  }`}
                >
                  {o.label}
                </span>
                {selected && <Check size={16} strokeWidth={2.6} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const INPUT_SKIN =
  "min-w-0 flex-1 rounded-xl border border-edge-soft bg-canvas/60 px-3.5 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-accent";

export function KeyField({
  label,
  value,
  onSave,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <span className="text-[15px] font-medium text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (dirty) onSave(draft.trim());
          }}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={INPUT_SKIN}
        />
        {dirty && (
          <button
            type="button"
            aria-label={label}
            onClick={() => onSave(draft.trim())}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-transform active:scale-95"
          >
            <Check size={17} strokeWidth={2.6} />
          </button>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account & API keys                                                  */
/* ------------------------------------------------------------------ */

export function AccountKeysSection() {
  const t = useT();
  const { user, signIn, signInWithKey, signOut } = useAuth();
  const { settings, update } = useSettings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authKeyDraft, setAuthKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsGroup title={t("Stremio account")}>
        {user ? (
          <>
            <ValueRow label={t("Signed in as")} value={user.email || user._id} />
            <GroupDivider />
            <ValueRow label={t("Sign out")} danger onClick={signOut} />
          </>
        ) : (
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("Email")}
              type="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={INPUT_SKIN}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("Password")}
              type="password"
              className={INPUT_SKIN}
            />
            <button
              type="button"
              disabled={busy || !email.trim() || !password}
              onClick={() => void run(() => signIn(email.trim(), password))}
              className="flex h-11 items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {t("Sign in")}
            </button>
            <span className="pt-1 text-center text-[12.5px] text-ink-subtle">{t("or")}</span>
            <input
              value={authKeyDraft}
              onChange={(e) => setAuthKeyDraft(e.target.value)}
              placeholder={t("Stremio auth key")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={INPUT_SKIN}
            />
            <button
              type="button"
              disabled={busy || !authKeyDraft.trim()}
              onClick={() => void run(() => signInWithKey(authKeyDraft))}
              className="flex h-11 items-center justify-center rounded-full border border-edge-soft bg-surface text-[14.5px] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {t("Sign in with key")}
            </button>
            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Metadata keys")}>
        <KeyField
          label="TMDB"
          value={settings.tmdbKey}
          onSave={(v) => update({ tmdbKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="RPDB"
          value={settings.rpdbKey}
          onSave={(v) => update({ rpdbKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="TVDB"
          value={settings.tvdbKey}
          onSave={(v) => update({ tvdbKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="OMDB"
          value={settings.omdbKey}
          onSave={(v) => update({ omdbKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="Fanart.tv"
          value={settings.fanartKey}
          onSave={(v) => update({ fanartKey: v })}
          placeholder={t("API key")}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Debrid services")}>
        <KeyField
          label="Real-Debrid"
          value={settings.rdKey}
          onSave={(v) => update({ rdKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="TorBox"
          value={settings.tbKey}
          onSave={(v) => update({ tbKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="AllDebrid"
          value={settings.adKey}
          onSave={(v) => update({ adKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="Premiumize"
          value={settings.pmKey}
          onSave={(v) => update({ pmKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label="Debrid-Link"
          value={settings.dlKey}
          onSave={(v) => update({ dlKey: v })}
          placeholder={t("API key")}
        />
      </SettingsGroup>

      <TrackersSection />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Addons                                                              */
/* ------------------------------------------------------------------ */

export function AddonsSection() {
  const t = useT();
  const [installed, setInstalled] = useState<InstalledAddon[]>(() => loadInstalled());
  const [, setTick] = useState(0);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setInstalled(loadInstalled());
    setTick((n) => n + 1);
  }, []);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await installFromUrl(url);
      setUrl("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: InstalledAddon) => {
    setConfirmRemove(null);
    try {
      await uninstallAddon(a.id, a.transportUrl);
    } catch {
      /* the local removal already landed; account sync is best-effort */
    }
    refresh();
  };

  return (
    <>
      <SettingsGroup title={t("Add addon")}>
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("Manifest URL")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={INPUT_SKIN}
          />
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={() => void add()}
            className="flex h-11 items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {t("Install")}
          </button>
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("Installed addons")}>
        {installed.length === 0 && <ValueRow label={t("No addons installed")} />}
        {installed.map((a, i) => {
          const enabled = isAddonEnabled(a.transportUrl);
          const confirming = confirmRemove === a.transportUrl;
          return (
            <div key={a.transportUrl}>
              {i > 0 && <GroupDivider />}
              <div className="flex items-center gap-3 px-4 py-3">
                {a.manifest?.logo ? (
                  <img
                    src={a.manifest.logo}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg object-contain"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-[14px] font-bold text-ink-muted">
                    {(a.manifest?.name ?? a.id).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14.5px] font-medium text-ink">
                    {a.manifest?.name ?? a.id}
                  </span>
                  <span className="truncate text-[12px] text-ink-subtle">
                    {a.manifest?.version ? `v${a.manifest.version} · ` : ""}
                    {a.id}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={a.manifest?.name ?? a.id}
                  onClick={() => {
                    setAddonEnabled(a.transportUrl, !enabled);
                    refresh();
                  }}
                  className={`flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${
                    enabled ? "bg-accent" : "bg-raised"
                  }`}
                >
                  <span
                    className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  aria-label={t("Remove")}
                  onClick={() => {
                    if (confirming) void remove(a);
                    else setConfirmRemove(a.transportUrl);
                  }}
                  className={`flex h-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                    confirming
                      ? "bg-danger px-3 text-[13px] font-semibold text-white"
                      : "w-9 text-ink-subtle active:bg-raised/60"
                  }`}
                >
                  {confirming ? t("Remove") : <Trash2 size={17} strokeWidth={2} />}
                </button>
              </div>
            </div>
          );
        })}
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Downloads & storage                                                 */
/* ------------------------------------------------------------------ */

const DOWNLOAD_STATUS_KEY: Record<DownloadItem["status"], string> = {
  downloading: "Downloading",
  paused: "Paused",
  done: "Done",
  error: "Error",
  canceled: "Canceled",
  interrupted: "Interrupted",
};

export function StorageSection() {
  const t = useT();
  const { settings } = useSettings();
  const downloads = useDownloads();
  const [dir, setDir] = useState<string>(settings.downloadDir);
  const [tempBytes, setTempBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (settings.downloadDir) {
      setDir(settings.downloadDir);
      return;
    }
    let live = true;
    void invoke<string>("harbor_download_dir")
      .then((d) => {
        if (live) setDir(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [settings.downloadDir]);

  const loadTemp = useCallback(() => {
    void invoke<number>("temp_usage_bytes")
      .then((n) => setTempBytes(typeof n === "number" ? n : 0))
      .catch(() => setTempBytes(null));
  }, []);
  useEffect(loadTemp, [loadTemp]);

  const clearTemp = async () => {
    setClearing(true);
    setClearFailed(false);
    try {
      await invoke<number>("temp_clear");
      loadTemp();
    } catch {
      setClearFailed(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <SettingsGroup title={t("Downloads")}>
        {downloads.length === 0 && <ValueRow label={t("No downloads yet")} />}
        {downloads.map((d, i) => {
          const pct =
            d.totalBytes && d.totalBytes > 0
              ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100))
              : null;
          const confirming = confirmDelete === d.id;
          return (
            <div key={d.id}>
              {i > 0 && <GroupDivider />}
              <div className="flex flex-col gap-2 px-4 py-3.5">
                <span className="flex items-start gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14.5px] font-medium text-ink">{d.title}</span>
                    <span className="truncate text-[12.5px] text-ink-subtle">
                      {t(DOWNLOAD_STATUS_KEY[d.status])}
                      {pct !== null ? ` · ${pct}%` : ""}
                      {d.totalBytes ? ` · ${formatBytes(d.totalBytes)}` : ""}
                      {d.status === "error" && d.error ? ` · ${d.error}` : ""}
                    </span>
                  </span>
                  {d.status === "downloading" && d.canPause !== false && (
                    <button
                      type="button"
                      aria-label={t("Pause")}
                      onClick={() => pauseDownload(d.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-raised/60"
                    >
                      <Pause size={17} strokeWidth={2} />
                    </button>
                  )}
                  {d.status === "paused" && (
                    <button
                      type="button"
                      aria-label={t("Resume")}
                      onClick={() => void resumeDownload(d.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-raised/60"
                    >
                      <Play size={17} strokeWidth={2} />
                    </button>
                  )}
                  {(d.status === "downloading" || d.status === "paused") && (
                    <button
                      type="button"
                      aria-label={t("Cancel")}
                      onClick={() => cancelDownload(d.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-raised/60"
                    >
                      <X size={17} strokeWidth={2} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t("Delete")}
                    onClick={() => {
                      if (confirming) {
                        setConfirmDelete(null);
                        void removeDownload(d.id).catch(() => {});
                      } else {
                        setConfirmDelete(d.id);
                      }
                    }}
                    className={`flex h-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                      confirming
                        ? "bg-danger px-3 text-[13px] font-semibold text-white"
                        : "w-9 text-ink-subtle active:bg-raised/60"
                    }`}
                  >
                    {confirming ? t("Delete") : <Trash2 size={17} strokeWidth={2} />}
                  </button>
                </span>
                {(d.status === "downloading" || d.status === "paused") && (
                  <span className="block h-1.5 overflow-hidden rounded-full bg-raised">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${pct ?? Math.round((d.ratio || 0) * 100)}%` }}
                    />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t("Storage")}>
        <ValueRow label={t("Download folder")} value={dir || undefined} />
        <GroupDivider />
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-medium text-ink">{t("Temporary files")}</span>
            <span className="text-[12.5px] text-ink-subtle">
              {tempBytes === null ? t("Unavailable") : formatBytes(tempBytes)}
            </span>
          </span>
          <button
            type="button"
            disabled={clearing || tempBytes === null || tempBytes === 0}
            onClick={() => void clearTemp()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-edge-soft bg-surface px-3.5 text-[13.5px] font-semibold text-ink transition-transform active:scale-95 disabled:opacity-40"
          >
            <Trash2 size={15} strokeWidth={2} />
            {t("Clear now")}
          </button>
        </div>
        {clearFailed && (
          <p role="alert" className="px-4 pb-3 text-[13px] text-danger">
            {t("Could not clear temporary files.")}
          </p>
        )}
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Torrent engine                                                      */
/* ------------------------------------------------------------------ */

const RETENTIONS: Array<{ h: number; key: string }> = [
  { h: 0, key: "Off" },
  { h: 12, key: "12 hours" },
  { h: 24, key: "1 day" },
  { h: 72, key: "3 days" },
  { h: 168, key: "1 week" },
  { h: 876000, key: "Forever" },
];

const CACHE_LIMITS: Array<{ gb: number; key: string }> = [
  { gb: 0, key: "Unlimited" },
  { gb: 10, key: "10 GB" },
  { gb: 20, key: "20 GB" },
  { gb: 25, key: "25 GB" },
  { gb: 50, key: "50 GB" },
  { gb: 100, key: "100 GB" },
];

export function TorrentSection() {
  const t = useT();
  const { settings, update } = useSettings();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void torrentEngineStatus().then(setStatus);
  }, []);
  useEffect(refresh, [refresh]);

  const statusText = settings.torrentsDisabled
    ? t("Off")
    : status === null
      ? t("Unavailable")
      : status.last_error
        ? status.last_error
        : status.ready
          ? `${t("Ready")} · ${t("Port")} ${status.port ?? "—"} · ${status.active_torrents} ${t("active")}`
          : t("Starting");

  const setRetention = (h: number) => {
    update({ streamCacheRetentionHours: h });
    void torrentEngineSetOptions(settings.streamCacheDir || null, h, settings.streamCacheMaxGb, false);
  };
  const setMaxGb = (gb: number) => {
    update({ streamCacheMaxGb: gb });
    void torrentEngineSetOptions(settings.streamCacheDir || null, settings.streamCacheRetentionHours, gb, false);
  };

  return (
    <>
      <SettingsGroup title={t("Local engine")}>
        <ToggleRow
          label={t("Torrent engine")}
          detail={statusText}
          on={!settings.torrentsDisabled}
          onChange={(on) => update({ torrentsDisabled: !on })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Full downloads")}
          detail={t("Keep whole torrent files instead of streaming pieces only.")}
          on={settings.torrentFullDownload}
          onChange={(on) => update({ torrentFullDownload: on })}
        />
        <GroupDivider />
        <ValueRow
          label={t("Restart engine")}
          onClick={() => {
            setBusy(true);
            void torrentEngineRestart()
              .then(setStatus)
              .finally(() => setBusy(false));
          }}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Stream cache")}>
        <OptionListRow
          label={t("Keep cached files for")}
          value={String(settings.streamCacheRetentionHours)}
          options={RETENTIONS.map((r) => ({ value: String(r.h), label: t(r.key) }))}
          onSelect={(v) => setRetention(Number(v))}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Cache size limit")}
          value={String(settings.streamCacheMaxGb)}
          options={CACHE_LIMITS.map((c) => ({ value: String(c.gb), label: t(c.key) }))}
          onSelect={(v) => setMaxGb(Number(v))}
        />
        <GroupDivider />
        <ValueRow
          label={t("Cache folder")}
          value={settings.streamCacheDir || t("Default")}
        />
        <GroupDivider />
        <ValueRow
          label={confirmClear ? t("Tap again to clear the cache") : t("Clear stream cache")}
          danger={confirmClear}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            setBusy(true);
            void torrentEngineHardReset()
              .then(setStatus)
              .finally(() => setBusy(false));
          }}
        />
      </SettingsGroup>
      {busy && <p className="px-1 text-[12.5px] text-ink-subtle">{t("Working…")}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

type NativeMem = { harborRss: number; webviewRss: number; total: number; totalPhys: number };

export function DiagnosticsSection() {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  const [mem, setMem] = useState<NativeMem | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SelfTestResult | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (live) setVersion(v);
      } catch {
        if (live) setVersion("");
      }
      try {
        const m = await invoke<NativeMem>("harbor_process_memory");
        if (live) setMem(m);
      } catch {
        /* memory readout is best-effort */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const runTest = async () => {
    setTesting(true);
    try {
      setResult(await torrentEngineSelfTest());
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <SettingsGroup title={t("About")}>
        <ValueRow label={t("App version")} value={version ?? undefined} />
        <GroupDivider />
        <ValueRow
          label={t("Memory use")}
          value={mem ? formatBytes(mem.total) : undefined}
        />
        {mem && mem.totalPhys > 0 && (
          <>
            <GroupDivider />
            <ValueRow label={t("Device memory")} value={formatBytes(mem.totalPhys)} />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Engine self-test")}>
        <ValueRow
          label={testing ? t("Running…") : t("Run self-test")}
          onClick={() => {
            if (!testing) void runTest();
          }}
        />
        {result && (
          <>
            <GroupDivider />
            <ValueRow
              label={result.pass ? t("All checks passed") : t("Some checks failed")}
              value={undefined}
            />
            {result.steps.map((s) => (
              <div key={s.label}>
                <GroupDivider />
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className={s.ok ? "text-accent" : "text-danger"}>
                    {s.ok ? (
                      <Check size={16} strokeWidth={2.6} />
                    ) : (
                      <X size={16} strokeWidth={2.6} />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px] font-medium text-ink">{s.label}</span>
                    <span className="text-[12.5px] leading-relaxed text-ink-subtle">{s.detail}</span>
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Trackers — connect flows                                            */
/* ------------------------------------------------------------------ */

// The tracker providers are all mounted in the phone entry
// (main-phone.tsx) and their connect flows are shared with the desktop
// panels: Trakt/Simkl are device-code dances, AniList/MAL open an
// authorize URL and take a pasted code, Letterboxd (Stremboxd) signs in
// with username/password (+ TOTP). These rows drive those same provider
// hooks — no parallel auth state.

function DeviceCodeBlock({ code, url }: { code: string; url: string }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-3.5">
      <span className="text-center text-[13px] leading-relaxed text-ink-subtle">
        {t("Go to {url} and enter this code:", { url })}
      </span>
      <span className="text-[26px] font-bold tracking-[0.2em] text-ink">{code}</span>
      <button
        type="button"
        onClick={() => openUrl(url)}
        className="flex h-10 items-center justify-center rounded-full bg-ink px-5 text-[14px] font-semibold text-canvas transition-transform active:scale-[0.97]"
      >
        {t("Open")}
      </button>
    </div>
  );
}

function TraktTracker() {
  const t = useT();
  const { isConnected, username, connectState, beginConnect, cancelConnect, disconnect } =
    useTrakt();
  return (
    <div className="flex flex-col">
      <ValueRow
        label="Trakt"
        value={isConnected ? (username ?? t("Connected")) : t("Not connected")}
      />
      {isConnected ? (
        <ValueRow label={t("Disconnect")} danger onClick={disconnect} />
      ) : connectState.kind === "awaiting" ? (
        <>
          <DeviceCodeBlock
            code={connectState.device.userCode}
            url={connectState.device.verificationUrl}
          />
          <ValueRow label={t("Cancel")} onClick={cancelConnect} />
        </>
      ) : connectState.kind === "starting" ? (
        <ValueRow label={t("Working…")} />
      ) : (
        <>
          {connectState.kind === "error" && (
            <p className="px-4 pb-1 text-[13px] text-danger">{connectState.message}</p>
          )}
          {connectState.kind === "expired" && (
            <p className="px-4 pb-1 text-[13px] text-danger">
              {t("The code expired. Try again.")}
            </p>
          )}
          {connectState.kind === "denied" && (
            <p className="px-4 pb-1 text-[13px] text-danger">
              {t("The sign-in was denied.")}
            </p>
          )}
          <ValueRow label={t("Connect")} onClick={() => void beginConnect()} />
        </>
      )}
    </div>
  );
}

function SimklTracker() {
  const t = useT();
  const { isConnected, username, connectState, beginConnect, cancelConnect, disconnect } =
    useSimkl();
  return (
    <div className="flex flex-col">
      <ValueRow
        label="Simkl"
        value={isConnected ? (username ?? t("Connected")) : t("Not connected")}
      />
      {isConnected ? (
        <ValueRow label={t("Disconnect")} danger onClick={disconnect} />
      ) : connectState.kind === "awaiting" ? (
        <>
          <DeviceCodeBlock
            code={connectState.pin.userCode}
            url={connectState.pin.verificationUrl}
          />
          <ValueRow label={t("Cancel")} onClick={cancelConnect} />
        </>
      ) : connectState.kind === "starting" ? (
        <ValueRow label={t("Working…")} />
      ) : (
        <>
          {connectState.kind === "error" && (
            <p className="px-4 pb-1 text-[13px] text-danger">{connectState.message}</p>
          )}
          {connectState.kind === "expired" && (
            <p className="px-4 pb-1 text-[13px] text-danger">
              {t("The code expired. Try again.")}
            </p>
          )}
          <ValueRow label={t("Connect")} onClick={() => void beginConnect()} />
        </>
      )}
    </div>
  );
}

function CodePasteTracker({
  name,
  isConnected,
  userName,
  connectState,
  beginConnect,
  submitCode,
  cancelConnect,
  disconnect,
  autoSync,
  onAutoSync,
}: {
  name: string;
  isConnected: boolean;
  userName: string | null;
  connectState:
    | { kind: "idle" }
    | { kind: "needs-code" }
    | { kind: "verifying" }
    | { kind: "error"; message: string }
    | { kind: "success" };
  beginConnect: () => void;
  submitCode: (code: string) => void;
  cancelConnect: () => void;
  disconnect: () => void;
  autoSync: boolean;
  onAutoSync: (v: boolean) => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-col">
      <ValueRow
        label={name}
        value={isConnected ? (userName ?? t("Connected")) : t("Not connected")}
      />
      {isConnected ? (
        <>
          <ToggleRow label={t("Auto-sync")} on={autoSync} onChange={onAutoSync} />
          <ValueRow label={t("Disconnect")} danger onClick={disconnect} />
        </>
      ) : connectState.kind === "needs-code" ? (
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <span className="text-[13px] leading-relaxed text-ink-subtle">
            {t("Approve in the browser, then paste the code you were given.")}
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("Code")}
            autoCapitalize="none"
            autoCorrect="off"
            className={INPUT_SKIN}
          />
          <span className="flex gap-2.5">
            <button
              type="button"
              onClick={cancelConnect}
              className="flex h-11 flex-1 items-center justify-center rounded-full border border-edge-soft bg-surface text-[14.5px] font-semibold text-ink transition-transform active:scale-[0.98]"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={!code.trim()}
              onClick={() => submitCode(code.trim())}
              className="flex h-11 flex-1 items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {t("Submit code")}
            </button>
          </span>
        </div>
      ) : connectState.kind === "verifying" ? (
        <ValueRow label={t("Working…")} />
      ) : (
        <>
          {connectState.kind === "error" && (
            <p className="px-4 pb-1 text-[13px] text-danger">{connectState.message}</p>
          )}
          <ValueRow label={t("Connect")} onClick={beginConnect} />
        </>
      )}
    </div>
  );
}

function AnilistTracker() {
  const { settings, update } = useSettings();
  const anilist = useAnilist();
  return (
    <CodePasteTracker
      name="AniList"
      isConnected={anilist.isConnected}
      userName={anilist.userName}
      connectState={anilist.connectState}
      beginConnect={anilist.beginConnect}
      submitCode={anilist.submitCode}
      cancelConnect={anilist.cancelConnect}
      disconnect={anilist.disconnect}
      autoSync={settings.anilistAutoSync}
      onAutoSync={(v) => update({ anilistAutoSync: v })}
    />
  );
}

function MalTracker() {
  const { settings, update } = useSettings();
  const mal = useMal();
  return (
    <CodePasteTracker
      name="MyAnimeList"
      isConnected={mal.isConnected}
      userName={mal.userName}
      connectState={mal.connectState}
      beginConnect={mal.beginConnect}
      submitCode={mal.submitCode}
      cancelConnect={mal.cancelConnect}
      disconnect={mal.disconnect}
      autoSync={settings.malAutoSync}
      onAutoSync={(v) => update({ malAutoSync: v })}
    />
  );
}

function LetterboxdTracker() {
  const t = useT();
  const { session, isFullConnected, username, login, disconnect } = useLetterboxd();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = isFullConnected || !!session;

  const doLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await login(
        user.trim(),
        password,
        needsTotp && totp.trim() ? totp.trim() : undefined,
      );
      if (res.kind === "2fa") setNeedsTotp(true);
      else if (res.kind === "error") setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <ValueRow
        label="Letterboxd"
        value={connected ? (username || t("Connected")) : t("Not connected")}
      />
      {connected ? (
        <ValueRow label={t("Disconnect")} danger onClick={disconnect} />
      ) : (
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder={t("Username")}
            autoCapitalize="none"
            autoCorrect="off"
            className={INPUT_SKIN}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("Password")}
            type="password"
            className={INPUT_SKIN}
          />
          {needsTotp && (
            <input
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder={t("Two-factor code")}
              inputMode="numeric"
              autoCapitalize="none"
              autoCorrect="off"
              className={INPUT_SKIN}
            />
          )}
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !user.trim() || !password}
            onClick={() => void doLogin()}
            className="flex h-11 items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? t("Working…") : t("Sign in")}
          </button>
        </div>
      )}
    </div>
  );
}

function TrackersSection() {
  const t = useT();
  return (
    <SettingsGroup
      title={t("Trackers")}
      footer={t(
        "Sign-ins use the same flows as the desktop app. Letterboxd public catalogs are configured on desktop.",
      )}
    >
      <TraktTracker />
      <GroupDivider />
      <SimklTracker />
      <GroupDivider />
      <AnilistTracker />
      <GroupDivider />
      <MalTracker />
      <GroupDivider />
      <LetterboxdTracker />
    </SettingsGroup>
  );
}
