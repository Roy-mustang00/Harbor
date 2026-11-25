import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  HelpCircle,
  LogOut,
  MonitorSmartphone,
  Settings,
  Users,
} from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useProfiles } from "@/lib/profiles";
import { useT } from "@/lib/i18n";
import { MobileWhosWatching } from "./mobile-whos-watching";
import { useMobileRemote } from "./mobile-remote";
import { setMobileRemoteStyle, useMobileRemoteStyle, type MobileRemoteStyle } from "./remote-style";
import { HARBOR_BUGS_BASE } from "@/lib/config/endpoints";
import { openUrl } from "@/lib/window";
import { isPhoneBackActive, pushPhoneBack } from "./phone-back";

// Lazy on purpose: the settings screen's graph (BP settings catalog, addon
// store, downloads store, torrent engine client) loads only when a
// standalone user first opens it — the shell's boot graph and the
// web-remote bundle stay exactly as they were.
const PhoneSettings = lazy(() =>
  import("./phone-settings").then((m) => ({ default: m.PhoneSettings })),
);

const PhoneProfileManager = lazy(() =>
  import("./phone-profiles").then((m) => ({ default: m.PhoneProfileManager })),
);

// The desktop settings' Licenses panel is the app's legal surface
// (acknowledgements, built-on credits, licence texts, independence
// notice). Lazy so its asset graph loads only when the row is opened.
const LicensesPanel = lazy(() =>
  import("@/views/settings/licenses-panel").then((m) => ({
    default: m.LicensesPanel,
  })),
);

export function MobileProfile({
  onOpenRemote,
  standalone = false,
}: {
  onOpenRemote: () => void;
  /** Standalone phone app: no host, so no remote-style picker or Remote row. */
  standalone?: boolean;
}) {
  const t = useT();
  const { user, signOut } = useAuth();
  const { activeProfile } = useProfiles();
  const { snapshot } = useMobileRemote();
  const remote = snapshot.profile;
  const name = remote?.name || activeProfile?.name || user?.email?.split("@")[0] || t("Guest");
  const avatar = remote?.avatar ?? activeProfile?.avatar ?? null;
  const color = remote?.color ?? activeProfile?.color ?? "oklch(0.78 0.13 60)";
  const [switching, setSwitching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);

  return (
    <div
      className="flex h-full flex-col gap-6 px-5"
      style={{
        paddingTop: "calc(var(--harbor-safe-top, env(safe-area-inset-top, 0px)) + 16px)",
      }}
    >
      <header className="flex items-center justify-center">
        <h1 className="font-display text-[22px] font-medium text-ink">{t("Profile")}</h1>
      </header>

      <button
        type="button"
        onClick={() => setSwitching(true)}
        className="flex flex-col items-center gap-3 transition-transform active:scale-[0.98]"
      >
        <span
          className="flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-full text-[30px] font-bold text-white shadow-[0_10px_28px_-10px_rgba(0,0,0,0.6)]"
          style={{ background: avatar ? undefined : color }}
        >
          {avatar ? (
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="text-[18px] font-semibold text-ink">{name}</span>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-accent">
          <Users size={14} strokeWidth={2.4} />
          {t("Switch profile")}
        </span>
      </button>

      {!standalone && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            {t("Remote style")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <StylePreview kind="dpad" label={t("D-pad")} />
            <StylePreview kind="minimal" label={t("Touchpad")} />
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-edge-soft/70 bg-elevated/40">
        {standalone && (
          <>
            <Row
              icon={<Users size={20} strokeWidth={2} />}
              label={t("Manage profiles")}
              onClick={() => setManaging(true)}
            />
            <Divider />
            <Row
              icon={<Settings size={20} strokeWidth={2} />}
              label={t("Settings")}
              onClick={() => setSettingsOpen(true)}
            />
            <Divider />
          </>
        )}
        {!standalone && (
          <>
            <Row
              icon={<MonitorSmartphone size={20} strokeWidth={2} />}
              label={t("Remote")}
              onClick={onOpenRemote}
            />
            <Divider />
          </>
        )}
        <Row
          icon={<HelpCircle size={20} strokeWidth={2} />}
          label={t("Help & feedback")}
          href={HARBOR_BUGS_BASE}
        />
        <Divider />
        <Row
          icon={<FileText size={20} strokeWidth={2} />}
          label={t("Legal")}
          onClick={() => setLegalOpen(true)}
        />
        {user && (
          <>
            <Divider />
            <Row
              icon={<LogOut size={20} strokeWidth={2} />}
              label={t("Sign out")}
              danger
              onClick={signOut}
            />
          </>
        )}
      </section>

      {switching && (
        <MobileWhosWatching
          onClose={() => setSwitching(false)}
          standalone={standalone}
          onManageProfiles={
            standalone
              ? () => {
                  setSwitching(false);
                  setManaging(true);
                }
              : undefined
          }
        />
      )}
      {standalone && settingsOpen && (
        <Suspense fallback={null}>
          <PhoneSettings onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      {standalone && managing && (
        <Suspense fallback={null}>
          <PhoneProfileManager onClose={() => setManaging(false)} />
        </Suspense>
      )}
      {legalOpen && (
        <Suspense fallback={null}>
          <LegalSheet onClose={() => setLegalOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

// Full-screen legal sheet: the same LicensesPanel the desktop settings
// show (its styles live in index.css, which the phone entry loads).
// Previously the Legal row's onClick was a no-op.
function LegalSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isPhoneBackActive()) return;
    return pushPhoneBack(() => {
      onCloseRef.current();
      return true;
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-canvas animate-fade-in">
      <header
        className="flex items-center gap-2 px-3 pb-1"
        style={{
          paddingTop: "calc(var(--harbor-safe-top, env(safe-area-inset-top, 0px)) + 10px)",
        }}
      >
        <button
          type="button"
          aria-label={t("Back")}
          onClick={onClose}
          className="flex h-12 w-12 items-center justify-center rounded-full text-ink transition-colors active:bg-raised/60"
        >
          <ArrowLeft size={21} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-center text-[19px] font-semibold text-ink">{t("Legal")}</h1>
        <span className="h-12 w-12" />
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4"
        style={{
          paddingBottom:
            "calc(var(--harbor-safe-bottom, env(safe-area-inset-bottom, 0px)) + 28px)",
        }}
      >
        <div className="flex flex-col gap-8">
          <LicensesPanel />
        </div>
      </div>
    </div>
  );
}

function StylePreview({ kind, label }: { kind: MobileRemoteStyle; label: string }) {
  const active = useMobileRemoteStyle() === kind;
  return (
    <button
      type="button"
      onClick={() => setMobileRemoteStyle(kind)}
      className={`relative flex flex-col items-center gap-3 rounded-2xl border bg-surface/50 p-4 transition-colors ${
        active ? "border-accent ring-1 ring-accent" : "border-edge-soft/70"
      }`}
    >
      {active && (
        <span className="absolute end-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-canvas">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      <span className="flex h-[104px] w-full items-center justify-center rounded-xl bg-canvas/60">
        {kind === "dpad" ? <DpadGlyph /> : <TouchpadGlyph />}
      </span>
      <span className={`text-[13.5px] font-semibold ${active ? "text-ink" : "text-ink-muted"}`}>
        {label}
      </span>
    </button>
  );
}

function DpadGlyph() {
  return (
    <span className="relative grid h-[74px] w-[74px] place-items-center rounded-full bg-elevated/70 ring-1 ring-edge-soft/70">
      <span className="absolute top-1.5 h-0 w-0 border-x-[5px] border-b-[7px] border-x-transparent border-b-ink-muted" />
      <span className="absolute bottom-1.5 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-ink-muted" />
      <span className="absolute start-1.5 h-0 w-0 border-y-[5px] border-e-[7px] border-y-transparent border-e-ink-muted" />
      <span className="absolute end-1.5 h-0 w-0 border-y-[5px] border-s-[7px] border-y-transparent border-s-ink-muted" />
      <span className="h-7 w-7 rounded-full bg-raised" />
    </span>
  );
}

function TouchpadGlyph() {
  return (
    <span className="relative flex h-[62px] w-[74px] items-center justify-center rounded-2xl bg-elevated/70 ring-1 ring-edge-soft/70">
      <span className="h-2 w-2 rounded-full bg-ink-muted" />
      <span className="absolute h-[3px] w-8 -rotate-[18deg] rounded-full bg-ink-subtle/50" />
    </span>
  );
}

/* `href` renders a real anchor rather than a button calling window.open. This
   screen is where the setup flow lands people, and a programmatic open that a
   mobile browser does not credit as a user gesture can navigate the current
   tab instead, which is how a viewer ends up outside Harbor with no way back. */
function Row({
  icon,
  label,
  onClick,
  href,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const skin =
    "flex w-full items-center gap-3.5 px-4 py-3.5 text-start transition-colors active:bg-raised/60";
  const inner = (
    <>
      <span className={danger ? "text-danger" : "text-ink-muted"}>{icon}</span>
      <span className={`flex-1 text-[15px] font-medium ${danger ? "text-danger" : "text-ink"}`}>
        {label}
      </span>
      {!danger && <ChevronRight size={18} strokeWidth={2.2} className="text-ink-subtle" />}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (!("__TAURI_INTERNALS__" in window)) return;
          e.preventDefault();
          openUrl(href);
        }}
        className={skin}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={skin}>
      {inner}
    </button>
  );
}

function Divider() {
  return <span className="mx-4 block h-px bg-edge-soft/60" />;
}
