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
