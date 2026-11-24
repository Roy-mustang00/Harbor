import { useEffect } from "react";

type PhoneBackHandler = () => boolean;

const handlers: PhoneBackHandler[] = [];

// The phone shell's back chain, mirroring the Big Picture one in
// views/big-picture/bp-back.ts. Layers (detail sheet, dialogs, the shell's own
// tab fallback) register here on mount; Android's hardware Back walks the
// stack from the top and stops at the first handler that consumes it. A
// handler that returns false is skipped, so a layer can decline (e.g. a sheet
// that is already closing) without eating the press.
//
// The chain is inert until the phone entry activates it. Shell components are
// shared with the web-remote habitat (App.tsx), where nothing may register:
// an always-on registration there would stack handlers nobody calls and this
// module would claim the shared __harborBack global that bp-back.ts owns in
// the desktop/TV bundles. main-phone.tsx calls activatePhoneBack() at boot;
// layers gate their registration on isPhoneBackActive().
let active = false;

export function activatePhoneBack(): void {
  active = true;
  if (typeof window !== "undefined") {
    (window as unknown as { __harborBack?: () => boolean }).__harborBack = runPhoneBack;
  }
}

export function isPhoneBackActive(): boolean {
  return active;
}

export function pushPhoneBack(fn: PhoneBackHandler): () => void {
  handlers.push(fn);
  return () => {
    const at = handlers.indexOf(fn);
    if (at >= 0) handlers.splice(at, 1);
  };
}

export function runPhoneBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    if (handlers[i]()) return true;
  }
  return false;
}

// --- System Back delivery ---------------------------------------------------
//
// Two channels can deliver one physical Back press (button or edge-swipe
// gesture) to this chain, and a press must be answered exactly once:
//
// 1. Tauri's back-button plugin bridge (main-phone.tsx registers
//    onBackButtonPress → dispatchPhoneBack). Registering that listener takes
//    over Android's default behaviour, so the press is consumed natively
//    whether or not it ever reaches JS.
// 2. A WebView-history sentinel (usePhoneHistoryBackGuard below, the same
//    pattern as manga-remote/use-history-guard.ts): the guard keeps one
//    sentinel entry on the history stack, so a press the system routes to
//    webview history surfaces as popstate and runs the chain here. While the
//    chain consumes the press the sentinel is re-armed for the next one.
//
// dispatchPhoneBack dedupes the channels: if both deliver the same press,
// the second delivery inside the window is treated as consumed without
// walking the chain again (a re-walk would, e.g., dismiss the exit confirm
// the first delivery just opened).
const DISPATCH_DEDUPE_MS = 250;
let lastDispatchAt = 0;

export function dispatchPhoneBack(): boolean {
  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_DEDUPE_MS) return true;
  lastDispatchAt = now;
  return runPhoneBack();
}

// Keeps the history sentinel armed while `active` (the standalone shell
// body). Inert everywhere else: the web habitat never activates the chain,
// and the manga reader route — which runs its own history guard — does not
// mount the shell body, so the two guards never stack.
export function usePhoneHistoryBackGuard(active: boolean): void {
  useEffect(() => {
    if (!active || !isPhoneBackActive() || typeof window === "undefined") return;
    const sentinel = { harborPhoneBackGuard: true };
    try {
      window.history.pushState(sentinel, "");
    } catch {
      return;
    }
    const onPop = () => {
      if (dispatchPhoneBack()) {
        try {
          window.history.pushState(sentinel, "");
        } catch {
          /* history unavailable; the plugin bridge remains as the channel */
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      try {
        const st = window.history.state as { harborPhoneBackGuard?: boolean } | null;
        if (st && st.harborPhoneBackGuard) window.history.back();
      } catch {
        /* nothing to unwind */
      }
    };
  }, [active]);
}
