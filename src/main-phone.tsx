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
  // Deferred for the same reason as the TV entry: nothing reads the subtitle
  // cache until a stream plays, so it must not sit in front of first paint.
  void import("@/lib/subtitles/subtitle-cache")
    .then((m) => m.initSubtitleCache())
    .catch(() => {});
}

void mount();
