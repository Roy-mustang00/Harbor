import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Lock,
  Plus,
} from "lucide-react";
import { AVATAR_CATALOG, avatarUrl } from "@/lib/avatars/catalog";
import { useT } from "@/lib/i18n";
import { hashProfilePassword, verifyProfilePassword } from "@/lib/profile-password";
import {
  nextProfileColor,
  PROFILE_COLORS,
  useProfiles,
  type KidConfig,
  type Profile,
} from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { isPhoneBackActive, pushPhoneBack } from "./phone-back";
import { useTabBarScrollRef } from "./tab-bar-autohide";
import { PinSheet } from "./phone-pin";
import {
  GroupDivider,
  OptionListRow,
  SettingsGroup,
  ToggleRow,
  ValueRow,
} from "./phone-settings-sections";

// Profile management for the standalone phone shell. The shared library
// (lib/profiles) already supports create / edit / delete / PIN / kid
// profiles / primary / startup defaults — the desktop profile picker and
// Settings > Account are its only surfaces, and the phone previously had
// just the switcher. Everything here calls the same provider functions and
// settings keys those surfaces use; no parallel profile state.
//
// PIN operations (set / change / remove / delete-gate) apply immediately
// through verified PinSheet flows, mirroring the desktop editor's PIN
// sub-views; name / avatar / color / kid fields are draft state saved by
// the editor's Save button, like the desktop editor form.

type ManagerView = { kind: "list" } | { kind: "create" } | { kind: "edit"; id: string };

const PROMPT_INTERVALS = [
  { value: "launch", label: "Every launch" },
  { value: "15m", label: "Every 15 min" },
  { value: "30m", label: "Every 30 min" },
  { value: "never", label: "Never" },
] as const;

export function PhoneProfileManager({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { profiles } = useProfiles();
  const scrollRef = useTabBarScrollRef();
  const { settings, update } = useSettings();
  const [view, setView] = useState<ManagerView>({ kind: "list" });

  const viewRef = useRef(view);
  viewRef.current = view;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isPhoneBackActive()) return;
    return pushPhoneBack(() => {
      if (viewRef.current.kind !== "list") {
        setView({ kind: "list" });
        return true;
      }
      onCloseRef.current();
      return true;
    });
  }, []);

  const editing =
    view.kind === "edit" ? (profiles.find((p) => p.id === view.id) ?? null) : null;
  const title =
    view.kind === "list"
      ? t("Manage profiles")
      : view.kind === "create"
        ? t("New profile")
        : t("Edit profile");

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
          onClick={() => {
            if (view.kind !== "list") setView({ kind: "list" });
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
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4"
        style={{
          paddingBottom:
            "calc(var(--harbor-safe-bottom, env(safe-area-inset-bottom, 0px)) + 28px)",
        }}
      >
        <div className="flex flex-col gap-6">
          {view.kind === "list" && (
            <>
              <SettingsGroup title={t("Profiles")}>
                {profiles.map((p, i) => (
                  <div key={p.id}>
                    {i > 0 && <GroupDivider />}
                    <button
                      type="button"
                      onClick={() => setView({ kind: "edit", id: p.id })}
                      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-start transition-colors active:bg-raised/60"
                    >
                      <ProfileAvatar profile={p} size={42} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] font-medium text-ink">
                          {p.name}
                        </span>
                        <span className="flex items-center gap-2 text-[12.5px] text-ink-subtle">
                          {p.isPrimary && <span>{t("Primary")}</span>}
                          {p.kid && <span>{t("Kid")}</span>}
                          {p.passwordHash && (
                            <span className="flex items-center gap-1">
                              <Lock size={11} strokeWidth={2.4} />
                              {t("PIN")}
                            </span>
                          )}
                          {!p.isPrimary && !p.kid && !p.passwordHash && (
                            <span>{t("Profile")}</span>
                          )}
                        </span>
                      </span>
                      <ChevronRight
                        size={18}
                        strokeWidth={2.2}
                        className="shrink-0 text-ink-subtle"
                      />
                    </button>
                  </div>
                ))}
                <GroupDivider />
                <button
                  type="button"
                  onClick={() => setView({ kind: "create" })}
                  className="flex w-full items-center gap-3.5 px-4 py-3.5 text-start transition-colors active:bg-raised/60"
                >
                  <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full border border-dashed border-edge text-ink-muted">
                    <Plus size={19} strokeWidth={2.2} />
                  </span>
                  <span className="text-[15px] font-medium text-accent">
                    {t("Add profile")}
                  </span>
                </button>
              </SettingsGroup>

              {profiles.length > 1 && (
                <SettingsGroup
                  title={t("Startup & default")}
                  footer={t("Profiles with a PIN cannot be a default.")}
                >
                  <OptionListRow
                    label={t("Who's watching")}
                    value={settings.profilePromptInterval ?? "launch"}
                    options={PROMPT_INTERVALS.map((o) => ({
                      value: o.value,
                      label: t(o.label),
                    }))}
                    onSelect={(v) =>
                      update({
                        profilePromptInterval: v as typeof settings.profilePromptInterval,
                      })
                    }
                  />
                  <GroupDivider />
                  <OptionListRow
                    label={t("Start as")}
                    value={settings.defaultProfileId ?? ""}
                    options={[
                      { value: "", label: t("No default profile") },
                      ...profiles
                        .filter((p) => !p.passwordHash)
                        .map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onSelect={(v) => update({ defaultProfileId: v })}
                  />
                </SettingsGroup>
              )}
            </>
          )}

          {view.kind === "create" && (
            <ProfileEditor
              key="create"
              profile={null}
              onDone={() => setView({ kind: "list" })}
            />
          )}
          {view.kind === "edit" && editing && (
            <ProfileEditor
              key={editing.id}
              profile={editing}
              onDone={() => setView({ kind: "list" })}
            />
          )}
          {view.kind === "edit" && !editing && (
            <SettingsGroup>
              <ValueRow label={t("This profile no longer exists")} />
            </SettingsGroup>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProfileAvatar({
  profile,
  size,
}: {
  profile: Pick<Profile, "name" | "avatar" | "color">;
  size: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: profile.avatar ? undefined : profile.color,
      }}
    >
      {profile.avatar ? (
        <img src={profile.avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        profile.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Editor (create + edit)                                              */
/* ------------------------------------------------------------------ */

const KID_AGES = [3, 5, 7, 9, 12] as const;
const KID_CURFEWS: Array<{ label: string; v: number | null }> = [
  { label: "No limit", v: null },
  { label: "30 min", v: 30 },
  { label: "1 hour", v: 60 },
  { label: "1½ hr", v: 90 },
  { label: "2 hr", v: 120 },
  { label: "3 hr", v: 180 },
];

type EditorPin =
  | { kind: "set-profile" }
  | { kind: "change-verify" }
  | { kind: "change-set" }
  | { kind: "remove-profile" }
  | { kind: "delete" }
  | { kind: "parent-set" };

const NAME_INPUT_SKIN =
  "min-w-0 flex-1 rounded-xl border border-edge-soft bg-canvas/60 px-3.5 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-accent";

function ProfileEditor({
  profile,
  onDone,
}: {
  profile: Profile | null;
  onDone: () => void;
}) {
  const t = useT();
  const {
    profiles,
    activeId,
    createProfile,
    updateProfile,
    deleteProfile,
    setPrimary,
  } = useProfiles();
  const { setSettingsLinked } = useSettings();

  const [name, setName] = useState(profile?.name ?? "");
  const [avatar, setAvatar] = useState<string | null>(profile?.avatar ?? null);
  const [color, setColor] = useState<string>(
    profile?.color ?? nextProfileColor(profiles),
  );
  const [kidOn, setKidOn] = useState(!!profile?.kid);
  const [kidAge, setKidAge] = useState<number>(profile?.kid?.age ?? 7);
  const [kidCurfew, setKidCurfew] = useState<number | null>(
    profile?.kid?.curfewMinutes ?? null,
  );
  const [parentPinHash, setParentPinHash] = useState<string | null>(
    profile?.kid?.parentPinHash ?? null,
  );
  const [pinFlow, setPinFlow] = useState<EditorPin | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isPrimary = !!profile?.isPrimary;
  const kidConfig = (): KidConfig | null =>
    kidOn
      ? { age: kidAge, curfewMinutes: kidCurfew, parentPinHash }
      : null;

  const save = () => {
    if (!profile) {
      createProfile({
        name: name.trim() || t("Profile"),
        avatar,
        color,
        kid: kidConfig(),
      });
      onDone();
      return;
    }
    updateProfile(profile.id, {
      name,
      avatar,
      color,
      ...(profile.isPrimary ? {} : { kid: kidConfig() }),
    });
    onDone();
  };

  const deleteTargetHash =
    profile?.passwordHash || profile?.kid?.parentPinHash || null;

  const doDelete = () => {
    if (!profile) return;
    deleteProfile(profile.id);
    onDone();
  };

  return (
    <>
      <SettingsGroup title={t("Name")}>
        <div className="px-4 py-3.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Profile name")}
            maxLength={32}
            autoCapitalize="words"
            className={NAME_INPUT_SKIN}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("Avatar")}>
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAvatar(null)}
              className={`flex h-12 w-12 items-center justify-center rounded-full text-[17px] font-bold text-white ${
                avatar === null ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""
              }`}
              style={{ background: color }}
              aria-label={t("No picture")}
            >
              {(name.trim() || t("Profile")).slice(0, 1).toUpperCase()}
            </button>
            <span className="text-[13px] text-ink-subtle">{t("No picture — initial only")}</span>
          </div>
          {AVATAR_CATALOG.map((group) => (
            <div key={group.group} className="flex flex-col gap-2">
              <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                {group.group}
              </span>
              <div className="grid grid-cols-5 gap-2.5">
                {group.items.map((item) => {
                  const url = avatarUrl(item.id);
                  const selected = avatar === url;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAvatar(url)}
                      aria-label={item.name}
                      className={`aspect-square overflow-hidden rounded-full transition-transform active:scale-95 ${
                        selected ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""
                      }`}
                    >
                      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("Color")}>
        <div className="flex flex-wrap gap-2.5 px-4 py-4">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95 ${
                color === c ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""
              }`}
              style={{ background: c }}
            >
              {color === c && <Check size={16} strokeWidth={3} className="text-white" />}
            </button>
          ))}
        </div>
      </SettingsGroup>

      {!isPrimary && (
        <SettingsGroup
          title={t("Kid profile")}
          footer={t("Sets the age level for the kids space. A parent PIN lets you allow more time.")}
        >
          <ToggleRow
            label={t("Kid profile")}
            on={kidOn}
            onChange={setKidOn}
          />
          {kidOn && (
            <>
              <GroupDivider />
              <div className="flex flex-col gap-2 px-4 py-3.5">
                <span className="text-[15px] font-medium text-ink">{t("Age level")}</span>
                <div className="flex gap-2">
                  {KID_AGES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setKidAge(a)}
                      className={`flex h-10 min-w-11 items-center justify-center rounded-full px-3 text-[14.5px] font-semibold transition-colors ${
                        kidAge === a
                          ? "bg-accent text-canvas"
                          : "bg-raised text-ink-muted"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <GroupDivider />
              <OptionListRow
                label={t("Daily watch time")}
                value={kidCurfew === null ? "none" : String(kidCurfew)}
                options={KID_CURFEWS.map((c) => ({
                  value: c.v === null ? "none" : String(c.v),
                  label: t(c.label),
                }))}
                onSelect={(v) => setKidCurfew(v === "none" ? null : Number(v))}
              />
              <GroupDivider />
              <ValueRow
                label={t("Parent PIN")}
                value={parentPinHash ? t("PIN set") : t("Not set")}
                onClick={() => setPinFlow({ kind: "parent-set" })}
              />
              {parentPinHash && (
                <>
                  <GroupDivider />
                  <ValueRow
                    label={t("Remove parent PIN")}
                    danger
                    onClick={() => setParentPinHash(null)}
                  />
                </>
              )}
            </>
          )}
        </SettingsGroup>
      )}

      {profile && (
        <SettingsGroup title={t("Profile PIN")}>
          {profile.passwordHash ? (
            <>
              <ValueRow
                label={t("Change PIN")}
                onClick={() => setPinFlow({ kind: "change-verify" })}
              />
              <GroupDivider />
              <ValueRow
                label={t("Remove PIN")}
                danger
                onClick={() => setPinFlow({ kind: "remove-profile" })}
              />
            </>
          ) : (
            <ValueRow
              label={t("Set a PIN")}
              onClick={() => setPinFlow({ kind: "set-profile" })}
            />
          )}
        </SettingsGroup>
      )}

      {profile && profile.id === activeId && (
        <SettingsGroup title={t("Settings for this profile")}>
          <ToggleRow
            label={t("Share settings with other profiles")}
            on={profile.settingsLinked !== false}
            onChange={(next) => {
              setSettingsLinked(next);
              updateProfile(profile.id, { settingsLinked: next });
            }}
          />
        </SettingsGroup>
      )}

      <button
        type="button"
        onClick={save}
        className="flex h-12 items-center justify-center rounded-full bg-ink text-[15px] font-semibold text-canvas transition-transform active:scale-[0.98]"
      >
        {profile ? t("Save") : t("Create profile")}
      </button>

      {profile && !isPrimary && (
        <SettingsGroup>
          {!profile.kid && (
            <>
              <ValueRow
                label={t("Make primary")}
                onClick={() => setPrimary(profile.id)}
              />
              <GroupDivider />
            </>
          )}
          <ValueRow
            label={confirmDelete ? t("Tap again to delete this profile") : t("Delete profile")}
            danger
            onClick={() => {
              if (deleteTargetHash) setPinFlow({ kind: "delete" });
              else if (confirmDelete) doDelete();
              else setConfirmDelete(true);
            }}
          />
        </SettingsGroup>
      )}

      {pinFlow?.kind === "parent-set" && (
        <PinSheet
          title={t("Parent PIN")}
          subtitle={t("Set the 4-digit PIN a parent uses to allow more time.")}
          mode="set"
          onComplete={async (pin) => {
            setParentPinHash(await hashProfilePassword(pin));
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow?.kind === "set-profile" && profile && (
        <PinSheet
          title={t("Set a PIN")}
          subtitle={t("Profile is locked. Enter the 4-digit PIN to continue.")}
          mode="set"
          onComplete={async (pin) => {
            updateProfile(profile.id, {
              passwordHash: await hashProfilePassword(pin),
            });
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow?.kind === "change-verify" && profile?.passwordHash && (
        <PinSheet
          title={t("Current PIN")}
          subtitle={t("Enter the current PIN first.")}
          mode="verify"
          verify={(pin) => verifyProfilePassword(pin, profile.passwordHash!)}
          onComplete={() => setPinFlow({ kind: "change-set" })}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow?.kind === "change-set" && profile && (
        <PinSheet
          title={t("New PIN")}
          subtitle={t("Set the new 4-digit PIN.")}
          mode="set"
          onComplete={async (pin) => {
            updateProfile(profile.id, {
              passwordHash: await hashProfilePassword(pin),
            });
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow?.kind === "remove-profile" && profile?.passwordHash && (
        <PinSheet
          title={t("Remove PIN")}
          subtitle={t("Enter the PIN to remove it.")}
          mode="verify"
          verify={(pin) => verifyProfilePassword(pin, profile.passwordHash!)}
          onComplete={() => {
            updateProfile(profile.id, { passwordHash: null });
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow?.kind === "delete" && profile && deleteTargetHash && (
        <PinSheet
          title={t("Delete profile")}
          subtitle={t("Enter the PIN to delete this profile.")}
          mode="verify"
          verify={(pin) => verifyProfilePassword(pin, deleteTargetHash)}
          onComplete={() => {
            setPinFlow(null);
            doDelete();
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
    </>
  );
}
