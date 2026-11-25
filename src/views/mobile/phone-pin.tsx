import { useEffect, useRef } from "react";
import { PinEntry } from "@/components/profile-picker/pin-entry";
import { isPhoneBackActive, pushPhoneBack } from "./phone-back";

// Full-screen PIN pad for the phone shell, wrapping the profile picker's
// shared PinEntry (same 4-digit pad, same set/verify flows the desktop
// picker uses) in a touch sheet. Used for profile unlock on switch,
// profile PIN set/change/remove, kid parent PINs, and parental controls.
// Sits above the settings/profile layers (z-[80]) and takes the top of the
// phone-back stack while mounted, so Back cancels the PIN entry first.
export function PinSheet({
  title,
  subtitle,
  mode,
  verify,
  onComplete,
  onCancel,
}: {
  title: string;
  subtitle: string;
  mode: "set" | "verify";
  verify?: (pin: string) => Promise<boolean>;
  onComplete: (pin: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    if (!isPhoneBackActive()) return;
    return pushPhoneBack(() => {
      onCancelRef.current();
      return true;
    });
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] flex flex-col overflow-y-auto bg-canvas px-5 animate-fade-in"
      style={{
        paddingTop: "calc(var(--harbor-safe-top, env(safe-area-inset-top, 0px)) + 28px)",
        paddingBottom: "calc(var(--harbor-safe-bottom, env(safe-area-inset-bottom, 0px)) + 28px)",
      }}
    >
      <div className="my-auto w-full">
        <PinEntry
          title={title}
          subtitle={subtitle}
          mode={mode}
          verify={verify}
          onComplete={onComplete}
          onBack={onCancel}
        />
      </div>
    </div>
  );
}
