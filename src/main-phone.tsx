import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { AuthProvider } from "@/lib/auth";
import { hydrateCustomThemes } from "@/lib/custom-themes";
import { getUiLanguage } from "@/lib/i18n/store";
import { ensureUiLocale } from "@/lib/i18n/load-locale";
import { applyOsDataset, isAndroid } from "@/lib/platform";
import { ProfilesProvider } from "@/lib/profiles";
import { SearchProvider } from "@/lib/search-context";
import { loadSecrets } from "@/lib/secret-store";
import { SettingsProvider } from "@/lib/settings";
import { MobileShell } from "@/views/mobile/mobile-shell";
import { activatePhoneBack, runPhoneBack } from "@/views/mobile/phone-back";
import "@/index.css";
import "flag-icons/css/flag-icons.min.css";

// The Android phone entry. index-tv.html stays the configured window URL for
// every Android device; its boot script redirects non-TV Android here before
// anything renders, so televisions never load this file and phones never lay
// Big Picture over the touch shell. Like main-tv.tsx, this entry must not
// import main.tsx/App.tsx or the TV entry: each bundle stays separate.
//
// The provider stack is only what the mobile subtree actually consumes
// (settings, profiles, auth, search), in the same relative order App.tsx
// nests them. MobileShell mounts standalone here: its local provider
// (local-remote.tsx) replaces the WebSocket remote provider — library
// actions and profile switches execute on-device, and the browse, search
// and detail screens read the local data libraries as they always have.

// index-phone.html inherits the desktop page's boot contract: #root starts
// inert + data-startup-hidden behind the opaque #harbor-boot splash, and only
// the entry can lift it (main.tsx does so from App's onReady chain, which this
// entry does not have). Without these two helpers the shell mounts invisibly
// behind a splash that nothing ever dismisses — the phone build's first boot
// hung on the sail for exactly this reason.
// Same key and panel id as the pre-bundle script in index-phone.html, so a
// failure recorded before the bundle loads and one found by the bundle share
// one on-screen surface (and one next-launch note). The panel is created
// here too so this helper works even if the inline script ever stops
// running; the CSS for #harbor-boot-error lives in index-phone.html.
const BOOT_ERROR_KEY = "harbor.phone-boot-error.v1";

function revealRoot() {
  const root = document.getElementById("root");
  if (root instanceof HTMLElement) {
    root.removeAttribute("data-startup-hidden");
    root.inert = false;
  }
}

function dismissBootSplash() {
  revealRoot();
  try {
    window.localStorage.removeItem(BOOT_ERROR_KEY);
  } catch {
    /* a stale previous-boot note is harmless; the cover still goes away */
  }
  const boot = document.getElementById("harbor-boot");
  if (boot) {
    boot.classList.add("gone");
    window.setTimeout(() => boot.remove(), 280);
  }
  document.getElementById("harbor-boot-chrome")?.remove();
}

function showBootError(message: string) {
  try {
    window.localStorage.setItem(BOOT_ERROR_KEY, message.slice(0, 2000));
  } catch {
    /* storage can throw; the panel below is the part that matters */
  }
  const boot = document.getElementById("harbor-boot");
  if (!boot) return;
  let panel = document.getElementById("harbor-boot-error");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "harbor-boot-error";
    boot.appendChild(panel);
  }
  boot.style.pointerEvents = "auto";
  panel.textContent = "";
  const text = document.createElement("div");
  text.textContent = message;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload app";
  reload.addEventListener("click", () => window.location.reload());
  panel.append(text, reload);
}

// No error boundary existed anywhere in the phone path: a render/commit
// throw in a provider or in MobileShell unmounted React to an empty #root
// and the old failsafe revealed that empty root with no message. The
// boundary renders a plain, provider-free fallback (inline styles only, so
// it survives even if index.css failed to load) and lifts the boot cover,
// so the next device test shows the failure instead of a blank screen.
class PhoneBootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[harbor] phone shell failed to render", error);
    try {
      window.localStorage.setItem(
        BOOT_ERROR_KEY,
        String(error?.stack || error?.message || error).slice(0, 2000),
      );
    } catch {
      /* the fallback below is the visible part */
    }
    dismissBootSplash();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100%",
          padding: 20,
          boxSizing: "border-box",
          background: "#111214",
          color: "#e9ecf2",
          font: "14px/1.55 system-ui, sans-serif",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>
          The phone app failed to start
        </div>
        <div style={{ marginBottom: 12 }}>
          Showing this instead of a blank screen so the failure can be reported. Tap Reload to
          try again.
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 18px",
            border: 0,
            borderRadius: 8,
            background: "#e8aa6c",
            color: "#111214",
            font: "600 14px system-ui, sans-serif",
            cursor: "pointer",
          }}
        >
          Reload app
        </button>
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: "#1c1e25",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
          }}
        >
          {String(error.stack || error.message || error).slice(0, 2000)}
        </pre>
      </div>
    );
  }
}

applyOsDataset();

// Arm the phone-back chain before anything mounts: shell layers gate their
// handler registration on this, and it is what claims __harborBack for this
// entry (the module stays inert when merely imported by shared shell code).
activatePhoneBack();

// Android hardware Back, same bridge as the TV entry: the SPA keeps no page
// history for the system to consume, so the stock activity would finish the
// app on the first press. Layers of the phone shell register with
// phone-back.ts; until they do (later slices), a press falls through and
// keeps today's behaviour.
if (isAndroid()) {
  void onBackButtonPress(() => {
    runPhoneBack();
  }).catch(() => {});
}

async function mount() {
  performance.mark("harbor:mount-start");
  await Promise.all([loadSecrets(), hydrateCustomThemes().catch(() => {})]);
  performance.mark("harbor:secrets-done");
  // Only the selected language, and only if it is not the one compiled in.
  await ensureUiLocale(getUiLanguage());
  performance.mark("harbor:locale-done");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PhoneBootErrorBoundary>
        <SettingsProvider syncTorrentEnginePolicy>
          <ProfilesProvider>
            <AuthProvider>
              <SearchProvider>
                <MobileShell standalone />
              </SearchProvider>
            </AuthProvider>
          </ProfilesProvider>
        </SettingsProvider>
      </PhoneBootErrorBoundary>
    </StrictMode>,
  );
  performance.mark("harbor:render-called");
  // First frame handed to React: lift the boot cover (see the helpers above).
  requestAnimationFrame(() => requestAnimationFrame(dismissBootSplash));
  // Deferred for the same reason as the TV entry: nothing reads the subtitle
  // cache until a stream plays, so it must not sit in front of first paint.
  void import("@/lib/subtitles/subtitle-cache")
    .then((m) => m.initSubtitleCache())
    .catch(() => {});
}

// Failsafe: if a pre-render await ever hangs on-device, say so on the
// screen rather than stranding the user on the splash forever. The old
// version revealed an empty root with no message; the boot cover now
// carries the diagnostic panel (with Reload) instead. Guarded on an empty
// root so a slow-but-progressing boot that renders after 15 s is not
// mislabelled — its render dismisses the cover and clears the note.
window.setTimeout(() => {
  const boot = document.getElementById("harbor-boot");
  const root = document.getElementById("root");
  if (boot && (!root || root.childNodes.length === 0)) {
    console.error("[harbor] phone startup timed out; showing boot error");
    showBootError(
      "Boot timed out: the phone shell did not render within 15 seconds. Tap Reload to try again.",
    );
  }
}, 15000);

void mount().catch((err) => {
  // Never strand the user on the splash: log the failure and show it on
  // the boot cover (with Reload) instead of revealing an empty root.
  console.error("[harbor] phone startup failed", err);
  showBootError(
    `Phone startup failed: ${String((err as Error)?.message || err).slice(0, 500)}`,
  );
});
