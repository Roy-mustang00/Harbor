import { StrictMode } from "react";
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
import { runPhoneBack } from "@/views/mobile/phone-back";
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
// nests them. The shell's remote provider still mounts inside MobileShell in
// this slice; it finds no host on-device and stays inert while the browse,
// search and detail screens read the local data libraries.

// index-phone.html inherits the desktop page's boot contract: #root starts
// inert + data-startup-hidden behind the opaque #harbor-boot splash, and only
// the entry can lift it (main.tsx does so from App's onReady chain, which this
// entry does not have). Without these two helpers the shell mounts invisibly
// behind a splash that nothing ever dismisses — the phone build's first boot
// hung on the sail for exactly this reason.
function revealRoot() {
  const root = document.getElementById("root");
  if (root instanceof HTMLElement) {
    root.removeAttribute("data-startup-hidden");
    root.inert = false;
  }
}

function dismissBootSplash() {
  revealRoot();
  const boot = document.getElementById("harbor-boot");
  if (boot) {
    boot.classList.add("gone");
    window.setTimeout(() => boot.remove(), 280);
  }
  document.getElementById("harbor-boot-chrome")?.remove();
}

applyOsDataset();

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
      <SettingsProvider syncTorrentEnginePolicy>
        <ProfilesProvider>
          <AuthProvider>
            <SearchProvider>
              <MobileShell />
            </SearchProvider>
          </AuthProvider>
        </ProfilesProvider>
      </SettingsProvider>
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

// Failsafe: if a pre-render await ever hangs on-device, lift the boot cover
// rather than stranding the user on the splash forever. Fires long after any
// healthy boot (which removes #harbor-boot within the first frames), so on a
// good boot it is a no-op.
window.setTimeout(() => {
  if (document.getElementById("harbor-boot")) {
    console.error("[harbor] phone startup timed out; revealing root");
    dismissBootSplash();
  }
}, 15000);

void mount().catch((err) => {
  // Never strand the user on the splash: log the failure where it can be
  // seen and lift the cover so whatever did mount stays reachable.
  console.error("[harbor] phone startup failed", err);
  dismissBootSplash();
});
