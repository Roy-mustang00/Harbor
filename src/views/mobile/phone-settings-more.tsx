import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Minus, Plus } from "lucide-react";
import {
  getCustomThemes,
  subscribeCustomThemes,
  type CustomTheme,
} from "@/lib/custom-themes";
import {
  applyBackup,
  BACKUP_SECTIONS,
  backupKeyCount,
  backupSectionDescription,
  backupSectionLabel,
  backupSections,
  downloadBackup,
  parseBackup,
  pickBackupFile,
  type Backup,
  type BackupSectionKey,
} from "@/lib/backup";
import {
  HARBOR_PUBLIC_RELAY,
} from "@/lib/together/relay-version";
import {
  mediaServerConnections,
  removeMediaServerConnection,
  subscribeMediaServerConnections,
  updateMediaServerConnection,
} from "@/lib/media-server/connections";
import type { MediaServerConnection } from "@/lib/media-server/types";
import { useT } from "@/lib/i18n";
import { LOCKABLE_TABS, useParental } from "@/lib/parental";
import { verifyProfilePassword } from "@/lib/profile-password";
import { useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { ALL_LANGUAGE_NAMES } from "@/lib/subtitles/language";
import {
  BETA_THEMES,
  DEFAULT_CUSTOM_COLORS,
  FEATURED_CUSTOM_THEMES,
  FONT_PAIRS,
  getThemeById,
  THEME_PRESETS,
  type ActiveThemeId,
  type CustomColors,
  type FontPairId,
  type ThemePreset,
} from "@/lib/theme";
import { nextBackgroundImage } from "@/lib/theme-background";
import { PinSheet } from "./phone-pin";
import {
  GroupDivider,
  KeyField,
  OptionListRow,
  SettingsGroup,
  ToggleRow,
  ValueRow,
} from "./phone-settings-sections";

// Stage 2 slice 2 (phone): the settings surfaces the gap inventory found
// missing from the phone shell — Appearance, parental controls, subtitle /
// playback depth, backup & restore, relay, home servers. Every control
// writes through the same stores, providers and commit paths the desktop
// and Big Picture surfaces use (lib/settings, lib/theme, lib/parental,
// lib/backup, lib/media-server); nothing here keeps parallel state.
// Imported only by phone-settings.tsx, which only the standalone shell
// mounts.

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export function StepperRow({
  label,
  detail,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  detail?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const btn =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-ink transition-transform active:scale-95 disabled:opacity-35";
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium text-ink">{label}</span>
        {detail && <span className="text-[12.5px] text-ink-subtle">{detail}</span>}
      </span>
      <button
        type="button"
        aria-label={`${label} −`}
        disabled={value <= min}
        onClick={() => onChange(clamp(Math.round((value - step) * 100) / 100))}
        className={btn}
      >
        <Minus size={16} strokeWidth={2.4} />
      </button>
      <span className="w-14 shrink-0 text-center text-[14.5px] font-semibold tabular-nums text-ink">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        disabled={value >= max}
        onClick={() => onChange(clamp(Math.round((value + step) * 100) / 100))}
        className={btn}
      >
        <Plus size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}

const COLOR_PRESETS = [
  "#ffffff",
  "#ffd94d",
  "#ffb020",
  "#7dd3fc",
  "#a3e635",
  "#f472b6",
  "#ef5a5a",
  "#111214",
] as const;

export function ColorSwatchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <span className="flex items-center justify-between">
        <span className="text-[15px] font-medium text-ink">{label}</span>
        <span
          className="h-6 w-10 rounded-md ring-1 ring-edge-soft"
          style={{ background: value }}
        />
      </span>
      <span className="flex flex-wrap gap-2">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={c}
            className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-edge-soft transition-transform active:scale-95 ${
              value.toLowerCase() === c ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""
            }`}
            style={{ background: c }}
          >
            {value.toLowerCase() === c && (
              <Check size={14} strokeWidth={3} className="text-black/60" />
            )}
          </button>
        ))}
      </span>
      <KeyField label="Hex" value={value} onSave={onChange} placeholder="#ffffff" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

const BUILTIN_THEMES: ThemePreset[] = (() => {
  const seen = new Set<string>();
  const out: ThemePreset[] = [];
  for (const p of [
    ...Object.values(THEME_PRESETS),
    ...FEATURED_CUSTOM_THEMES,
    ...BETA_THEMES,
  ]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
})();

const CUSTOM_COLOR_FIELDS: Array<{ key: keyof CustomColors; label: string }> = [
  { key: "canvas", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "elevated", label: "Elevated" },
  { key: "raised", label: "Raised" },
  { key: "ink", label: "Text" },
  { key: "inkMuted", label: "Muted text" },
  { key: "inkSubtle", label: "Subtle text" },
  { key: "edge", label: "Borders" },
  { key: "accent", label: "Accent" },
  { key: "danger", label: "Danger" },
];

function ThemeSwatches({ swatch }: { swatch: readonly string[] }) {
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {swatch.slice(0, 3).map((c, i) => (
        <span
          key={i}
          className="h-6 w-6 rounded-full ring-2 ring-canvas"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

export function AppearanceSection() {
  const t = useT();
  const { settings, update } = useSettings();
  const theme = settings.theme;
  const customThemes = useSyncExternalStore(
    subscribeCustomThemes,
    getCustomThemes,
    getCustomThemes,
  );
  const [colorsOpen, setColorsOpen] = useState(false);
  const [draftColors, setDraftColors] = useState<CustomColors>(
    () => theme.customColors ?? DEFAULT_CUSTOM_COLORS,
  );
  useEffect(() => {
    if (theme.customColors) setDraftColors(theme.customColors);
  }, [theme.customColors]);

  const selectTheme = (id: string) => {
    update({
      theme: {
        ...theme,
        preset: id as ActiveThemeId,
        backgroundImage: nextBackgroundImage(
          theme.backgroundImage,
          getThemeById(theme.preset),
          getThemeById(id),
        ),
      },
    });
  };

  const themeRow = (p: ThemePreset | CustomTheme) => {
    const active = theme.preset === p.id;
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => selectTheme(p.id)}
        className="flex w-full items-center gap-3.5 px-4 py-3 text-start transition-colors active:bg-raised/60"
      >
        <ThemeSwatches swatch={p.swatch} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={`truncate text-[15px] ${active ? "font-semibold text-ink" : "font-medium text-ink"}`}
          >
            {p.name}
          </span>
          {p.blurb && (
            <span className="truncate text-[12.5px] text-ink-subtle">{p.blurb}</span>
          )}
        </span>
        {active && <Check size={17} strokeWidth={2.6} className="shrink-0 text-accent" />}
      </button>
    );
  };

  return (
    <>
      <SettingsGroup
        title={t("Theme")}
        footer={t("Pick a look. Every color and surface updates instantly.")}
      >
        {BUILTIN_THEMES.map((p, i) => (
          <div key={p.id}>
            {i > 0 && <GroupDivider />}
            {themeRow(p)}
          </div>
        ))}
        {customThemes.length > 0 && (
          <>
            <GroupDivider />
            <div className="px-4 pb-1 pt-3.5 text-[12px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
              {t("Your themes")}
            </div>
            {customThemes.map((p) => (
              <div key={p.id}>
                <GroupDivider />
                {themeRow(p)}
              </div>
            ))}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Custom colors")}>
        <ValueRow
          label={theme.preset === "custom" ? t("Custom colors active") : t("Use custom colors")}
          value={colorsOpen ? t("Hide") : t("Edit")}
          onClick={() => setColorsOpen((v) => !v)}
        />
        {colorsOpen && (
          <>
            <GroupDivider />
            {CUSTOM_COLOR_FIELDS.map((f, i) => (
              <div key={f.key}>
                {i > 0 && <GroupDivider />}
                <KeyField
                  label={t(f.label)}
                  value={draftColors[f.key]}
                  onSave={(v) =>
                    setDraftColors((d) => ({ ...d, [f.key]: v || d[f.key] }))
                  }
                  placeholder="#000000"
                />
              </div>
            ))}
            <GroupDivider />
            <div className="px-4 py-3.5">
              <button
                type="button"
                onClick={() =>
                  update({
                    theme: { ...theme, preset: "custom", customColors: draftColors },
                  })
                }
                className="flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98]"
              >
                {t("Apply custom colors")}
              </button>
            </div>
            {theme.customColors && (
              <>
                <GroupDivider />
                <ValueRow
                  label={t("Clear custom colors")}
                  danger
                  onClick={() =>
                    update({
                      theme: {
                        ...theme,
                        customColors: null,
                        preset: theme.preset === "custom" ? "cool-grey" : theme.preset,
                      },
                    })
                  }
                />
              </>
            )}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Typography")}>
        <OptionListRow
          label={t("Font pairing")}
          value={theme.fontPair}
          options={Object.values(FONT_PAIRS).map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          onSelect={(v) =>
            update({
              theme: { ...theme, fontPair: v as FontPairId, customFontId: null },
            })
          }
        />
      </SettingsGroup>

      {theme.backgroundImage && (
        <SettingsGroup title={t("Background image")}>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <span className="flex items-center justify-between">
              <span className="text-[15px] font-medium text-ink">{t("Dim")}</span>
              <span className="text-[13.5px] tabular-nums text-ink-subtle">
                {Math.round(theme.backgroundDim * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={theme.backgroundDim}
              onChange={(e) =>
                update({
                  theme: { ...theme, backgroundDim: Number(e.target.value) },
                })
              }
              className="w-full accent-[var(--color-accent)]"
              aria-label={t("Dim")}
            />
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup title={t("Card badges")}>
        <ToggleRow
          label={t("Card badges")}
          on={settings.showCardBadges}
          onChange={(v) => update({ showCardBadges: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("IMDb badge")}
          on={settings.showImdbBadge}
          onChange={(v) => update({ showImdbBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("TMDB badge")}
          on={settings.showTmdbBadge}
          onChange={(v) => update({ showTmdbBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Rotten Tomatoes badge")}
          on={settings.showRtBadge}
          onChange={(v) => update({ showRtBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("MAL badge")}
          on={settings.showMalBadge}
          onChange={(v) => update({ showMalBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Letterboxd badge")}
          on={settings.showLetterboxdBadge}
          onChange={(v) => update({ showLetterboxdBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Trakt badge")}
          on={settings.showTraktBadge}
          onChange={(v) => update({ showTraktBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Quality badge")}
          on={settings.showQualityBadge}
          onChange={(v) => update({ showQualityBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Watched badge")}
          on={settings.showWatchedBadge}
          onChange={(v) => update({ showWatchedBadge: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Subtitle indicator")}
          on={settings.showSubtitleIndicator}
          onChange={(v) => update({ showSubtitleIndicator: v })}
        />
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Parental controls                                                   */
/* ------------------------------------------------------------------ */

// ParentalProvider was mounted in the phone entry from the start but had
// no UI. Its model (lib/parental) is per active profile: the profile PIN
// (passwordHash) plus lockedTabs — the tabs hidden for that profile. The
// provider's own setPin / clearPin / setTabHidden are the write paths.
export function ParentalSection() {
  const t = useT();
  const { activeProfile } = useProfiles();
  const { hasPin, hiddenTabs, setTabHidden, setPin, clearPin } = useParental();
  const [pinFlow, setPinFlow] = useState<
    null | "set" | "change-verify" | "change-set" | "remove"
  >(null);

  const currentHash = activeProfile?.passwordHash ?? null;

  return (
    <>
      <SettingsGroup
        title={t("Profile PIN")}
        footer={t(
          "The PIN locks this profile. With tabs hidden below, the profile asks for the PIN before they can be opened.",
        )}
      >
        {hasPin ? (
          <>
            <ValueRow
              label={t("Change PIN")}
              onClick={() => setPinFlow("change-verify")}
            />
            <GroupDivider />
            <ValueRow
              label={t("Remove PIN")}
              danger
              onClick={() => setPinFlow("remove")}
            />
          </>
        ) : (
          <ValueRow label={t("Set a PIN")} onClick={() => setPinFlow("set")} />
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Hidden tabs")}>
        {LOCKABLE_TABS.map((tab, i) => (
          <div key={tab.key}>
            {i > 0 && <GroupDivider />}
            <ToggleRow
              label={t(tab.label)}
              on={!!hiddenTabs[tab.key]}
              onChange={(on) => setTabHidden(tab.key, on)}
            />
          </div>
        ))}
      </SettingsGroup>

      {activeProfile?.kid && (
        <SettingsGroup>
          <ValueRow label={t("This is a kid profile")} />
          <GroupDivider />
          <ValueRow label={t("Age level and parent PIN live in Manage profiles")} />
        </SettingsGroup>
      )}

      {pinFlow === "set" && (
        <PinSheet
          title={t("Set a PIN")}
          subtitle={t("Set the 4-digit PIN for this profile.")}
          mode="set"
          onComplete={async (pin) => {
            await setPin(pin);
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow === "change-verify" && currentHash && (
        <PinSheet
          title={t("Current PIN")}
          subtitle={t("Enter the current PIN first.")}
          mode="verify"
          verify={(pin) => verifyProfilePassword(pin, currentHash)}
          onComplete={() => setPinFlow("change-set")}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow === "change-set" && (
        <PinSheet
          title={t("New PIN")}
          subtitle={t("Set the new 4-digit PIN.")}
          mode="set"
          onComplete={async (pin) => {
            await setPin(pin);
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
      {pinFlow === "remove" && currentHash && (
        <PinSheet
          title={t("Remove PIN")}
          subtitle={t("Enter the PIN to remove it.")}
          mode="verify"
          verify={(pin) => verifyProfilePassword(pin, currentHash)}
          onComplete={() => {
            clearPin();
            setPinFlow(null);
          }}
          onCancel={() => setPinFlow(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Subtitle depth (appended under the BP Subtitles catalog view)       */
/* ------------------------------------------------------------------ */

// The BP catalog carries subtitle languages + size; the desktop Subtitles
// panel's other tabs (Look / Sources / Sync / language behaviour) write
// these same settings keys. All controls below write lib/settings
// directly, exactly like the desktop panels.
const SUB_LANG_COMMON = 24;

function langOptions(current: string[]) {
  const common = ALL_LANGUAGE_NAMES.slice(0, SUB_LANG_COMMON);
  return [...common, ...current.filter((l) => !common.includes(l))];
}

export function SubtitleDepthSections() {
  const t = useT();
  const { settings, update } = useSettings();
  const providers = settings.subProvidersEnabled;
  const setProvider = (key: keyof typeof providers, v: boolean) =>
    update({ subProvidersEnabled: { ...providers, [key]: v } });

  return (
    <>
      <SettingsGroup title={t("Subtitle look")}>
        <OptionListRow
          label={t("Style")}
          value={settings.subStyle}
          options={[
            { value: "shadow", label: t("Shadow") },
            { value: "outline", label: t("Outline") },
            { value: "box", label: t("Box") },
          ]}
          onSelect={(v) => update({ subStyle: v as typeof settings.subStyle })}
        />
        <GroupDivider />
        <ColorSwatchRow
          label={t("Text color")}
          value={settings.subFontColor}
          onChange={(v) => update({ subFontColor: v })}
        />
        <GroupDivider />
        <ColorSwatchRow
          label={t("Border color")}
          value={settings.subBorderColor}
          onChange={(v) => update({ subBorderColor: v })}
        />
        <GroupDivider />
        <StepperRow
          label={t("Border size")}
          value={settings.subBorderSize}
          min={0}
          max={4}
          step={1}
          onChange={(v) => update({ subBorderSize: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Bold")}
          on={settings.subBold}
          onChange={(v) => update({ subBold: v })}
        />
        <GroupDivider />
        <StepperRow
          label={t("Opacity")}
          value={settings.subOpacity}
          min={0.2}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update({ subOpacity: v })}
        />
        <GroupDivider />
        <StepperRow
          label={t("Bottom margin")}
          value={settings.subMarginY}
          min={0}
          max={40}
          step={2}
          format={(v) => `${v}px`}
          onChange={(v) => update({ subMarginY: v })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Alignment")}
          value={settings.subAlignX}
          options={[
            { value: "left", label: t("Left") },
            { value: "center", label: t("Center") },
            { value: "right", label: t("Right") },
          ]}
          onSelect={(v) => update({ subAlignX: v as typeof settings.subAlignX })}
        />
        {settings.subStyle === "box" && (
          <>
            <GroupDivider />
            <ColorSwatchRow
              label={t("Box color")}
              value={settings.subBoxColor}
              onChange={(v) => update({ subBoxColor: v })}
            />
            <GroupDivider />
            <StepperRow
              label={t("Box opacity")}
              value={settings.subBoxOpacity}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => update({ subBoxOpacity: v })}
            />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Subtitle sources")}>
        <ToggleRow
          label="Wyzie"
          on={providers.wyzie}
          onChange={(v) => setProvider("wyzie", v)}
        />
        <GroupDivider />
        <ToggleRow
          label="OpenSubtitles"
          on={providers.opensubtitles}
          onChange={(v) => setProvider("opensubtitles", v)}
        />
        <GroupDivider />
        <ToggleRow
          label="Jimaku"
          on={providers.jimaku}
          onChange={(v) => setProvider("jimaku", v)}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Addon subtitles")}
          on={providers.addons}
          onChange={(v) => setProvider("addons", v)}
        />
        <GroupDivider />
        <ToggleRow
          label="SubDL"
          on={!!providers.subdl}
          onChange={(v) => setProvider("subdl", v)}
        />
        <GroupDivider />
        <ToggleRow
          label="Subsource"
          on={!!providers.subsource}
          onChange={(v) => setProvider("subsource", v)}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Subtitle provider keys")}>
        <KeyField
          label={t("OpenSubtitles API key")}
          value={settings.opensubtitlesApiKey}
          onSave={(v) => update({ opensubtitlesApiKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label={t("Jimaku token")}
          value={settings.jimakuToken}
          onSave={(v) => update({ jimakuToken: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label={t("SubDL API key")}
          value={settings.subdlApiKey}
          onSave={(v) => update({ subdlApiKey: v })}
          placeholder={t("API key")}
        />
        <GroupDivider />
        <KeyField
          label={t("Subsource API key")}
          value={settings.subsourceApiKey}
          onSave={(v) => update({ subsourceApiKey: v })}
          placeholder={t("API key")}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Subtitle sync")}>
        <ToggleRow
          label={t("Automatic sync")}
          on={settings.subtitleAutoSync}
          onChange={(v) => update({ subtitleAutoSync: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Apply structural fixes")}
          on={settings.autoSyncApplyStructural}
          onChange={(v) => update({ autoSyncApplyStructural: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Correct drift")}
          on={settings.autoSyncDrift}
          onChange={(v) => update({ autoSyncDrift: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Speech-recognition sync")}
          on={settings.subtitleAutoSyncAsr}
          onChange={(v) => update({ subtitleAutoSyncAsr: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Pivot-language sync")}
          on={settings.subtitleAutoSyncPivot}
          onChange={(v) => update({ subtitleAutoSyncPivot: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Community sync")}
          on={settings.subtitleAutoSyncCrowd}
          onChange={(v) => update({ subtitleAutoSyncCrowd: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Sync indicator")}
          detail={t("The on-screen readout shown while nudging subtitle timing.")}
          on={settings.subOffsetIndicatorEnabled}
          onChange={(v) => update({ subOffsetIndicatorEnabled: v })}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Subtitle behaviour")}>
        <ToggleRow
          label={t("Subtitles off by default")}
          on={settings.subtitlesOffByDefault}
          onChange={(v) => update({ subtitlesOffByDefault: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Prefer embedded subtitles")}
          on={settings.preferEmbeddedSubs}
          onChange={(v) => update({ preferEmbeddedSubs: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Forced subtitles with native audio")}
          on={settings.forcedSubsWhenNativeAudio}
          onChange={(v) => update({ forcedSubsWhenNativeAudio: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Hide SDH subtitles")}
          on={settings.subHideSdh}
          onChange={(v) => update({ subHideSdh: v })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Second subtitle language")}
          value={settings.secondarySubLang}
          options={[
            { value: "", label: t("Off") },
            ...langOptions(
              settings.secondarySubLang ? [settings.secondarySubLang] : [],
            ).map((l) => ({ value: l, label: l })),
          ]}
          onSelect={(v) => update({ secondarySubLang: v })}
        />
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playback depth (appended under the BP Playback catalog view)        */
/* ------------------------------------------------------------------ */

export function PlaybackDepthSections() {
  const t = useT();
  const { settings, update } = useSettings();
  const audioLangs = langOptions(settings.preferredAudioLangs);

  const toggleAudioLang = (lang: string) => {
    const has = settings.preferredAudioLangs.includes(lang);
    update({
      preferredAudioLangs: has
        ? settings.preferredAudioLangs.filter((l) => l !== lang)
        : [...settings.preferredAudioLangs, lang],
    });
  };

  return (
    <>
      <SettingsGroup title={t("Skipping")}>
        <ToggleRow
          label={t("Skip recaps")}
          on={settings.autoSkipRecap}
          onChange={(v) => update({ autoSkipRecap: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Skip credits")}
          on={settings.autoSkipOutro}
          onChange={(v) => update({ autoSkipOutro: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Skip ads")}
          on={settings.adSkipEnabled}
          onChange={(v) => update({ adSkipEnabled: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Show skip button")}
          on={settings.showSkipButton}
          onChange={(v) => update({ showSkipButton: v })}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Resume & speed")}>
        <ToggleRow
          label={t("Resume playback")}
          on={settings.resumePlayback}
          onChange={(v) => update({ resumePlayback: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Ask before resuming")}
          on={settings.resumePrompt}
          onChange={(v) => update({ resumePrompt: v })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Default speed")}
          value={String(settings.defaultPlaybackSpeed)}
          options={["0.5", "0.75", "1", "1.25", "1.5", "1.75", "2"].map((v) => ({
            value: v,
            label: `${v}×`,
          }))}
          onSelect={(v) => update({ defaultPlaybackSpeed: Number(v) })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Seek forward")}
          value={String(settings.seekForwardStepSec)}
          options={["5", "10", "15", "30", "60"].map((v) => ({
            value: v,
            label: `${v} sec`,
          }))}
          onSelect={(v) => update({ seekForwardStepSec: Number(v) })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Seek back")}
          value={String(settings.seekBackStepSec)}
          options={["5", "10", "15", "30", "60"].map((v) => ({
            value: v,
            label: `${v} sec`,
          }))}
          onSelect={(v) => update({ seekBackStepSec: Number(v) })}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Audio")}>
        <div className="flex flex-col">
          <span className="px-4 pb-1 pt-3.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {t("Preferred audio languages")}
          </span>
          {audioLangs.map((lang) => {
            const at = settings.preferredAudioLangs.indexOf(lang);
            return (
              <ToggleRow
                key={lang}
                label={lang}
                detail={at >= 0 ? `#${at + 1}` : undefined}
                on={at >= 0}
                onChange={() => toggleAudioLang(lang)}
              />
            );
          })}
        </div>
        <GroupDivider />
        <ToggleRow
          label={t("Normalize volume")}
          on={settings.audioNormalize}
          onChange={(v) => update({ audioNormalize: v })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Audio profile")}
          value={settings.audioProfile}
          options={[
            { value: "off", label: t("Off") },
            { value: "bass", label: t("Bass") },
            { value: "voice", label: t("Voice") },
            { value: "bass-reduce", label: t("Bass reduce") },
            { value: "night", label: t("Night") },
          ]}
          onSelect={(v) =>
            update({ audioProfile: v as typeof settings.audioProfile })
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("Streams")}>
        <OptionListRow
          label={t("Stream order")}
          value={settings.streamSort}
          options={[
            { value: "harbor", label: t("Harbor order") },
            { value: "addon", label: t("Addon order") },
          ]}
          onSelect={(v) => update({ streamSort: v as typeof settings.streamSort })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Stream filtering")}
          value={settings.streamFilterLevel}
          options={[
            { value: "strict", label: t("Strict") },
            { value: "balanced", label: t("Balanced") },
            { value: "off", label: t("Off") },
          ]}
          onSelect={(v) =>
            update({ streamFilterLevel: v as typeof settings.streamFilterLevel })
          }
        />
        <GroupDivider />
        <ToggleRow
          label={t("Full stream descriptions")}
          on={settings.fullStreamDescription}
          onChange={(v) => update({ fullStreamDescription: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Remember last stream")}
          on={settings.rememberLastStream}
          onChange={(v) => update({ rememberLastStream: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Keep source for next episode")}
          on={settings.keepSourceNextEpisode}
          onChange={(v) => update({ keepSourceNextEpisode: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Lock source per season")}
          on={settings.seasonSourceLock}
          onChange={(v) => update({ seasonSourceLock: v })}
        />
        <GroupDivider />
        <OptionListRow
          label={t("Player controls style")}
          value={settings.playerChromeTheme}
          options={[
            { value: "auto", label: t("Auto") },
            { value: "default", label: t("Harbor") },
            { value: "stremio", label: t("Stremio") },
          ]}
          onSelect={(v) =>
            update({ playerChromeTheme: v as typeof settings.playerChromeTheme })
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("Trailers")}>
        <OptionListRow
          label={t("Trailer quality")}
          value={settings.trailerQuality}
          options={[
            { value: "auto", label: t("Auto") },
            { value: "360p", label: "360p" },
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" },
            { value: "best", label: t("Best") },
          ]}
          onSelect={(v) =>
            update({ trailerQuality: v as typeof settings.trailerQuality })
          }
        />
        <GroupDivider />
        <ToggleRow
          label={t("Autoplay trailers on detail pages")}
          on={settings.detailTrailerAutoplay}
          onChange={(v) => update({ detailTrailerAutoplay: v })}
        />
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Home depth (appended under the BP Home catalog view)                */
/* ------------------------------------------------------------------ */

export function HomeDepthSection() {
  const t = useT();
  const { settings, update } = useSettings();
  return (
    <SettingsGroup title={t("Library")}>
      <OptionListRow
        label={t("Library sort")}
        value={settings.librarySort}
        options={[
          { value: "recent", label: t("Recently added") },
          { value: "title", label: t("Title") },
          { value: "year", label: t("Year") },
        ]}
        onSelect={(v) => update({ librarySort: v as typeof settings.librarySort })}
      />
      <GroupDivider />
      <ToggleRow
        label={t("Library shows bookmarks only")}
        on={settings.libraryBookmarkedOnly}
        onChange={(v) => update({ libraryBookmarkedOnly: v })}
      />
      <GroupDivider />
      <ToggleRow
        label={t("Hide watched in the hero")}
        on={settings.hideWatchedInHero}
        onChange={(v) => update({ hideWatchedInHero: v })}
      />
    </SettingsGroup>
  );
}

/* ------------------------------------------------------------------ */
/* Backup & restore                                                    */
/* ------------------------------------------------------------------ */

// Mirrors the desktop Settings backup row (views/settings/backup-row.tsx)
// on lib/backup: export builds a .harbx through downloadBackup (native
// save dialog — the dialog plugin and save_text_file are registered in
// mobile.rs), restore picks a file with pickBackupFile, parses it, shows
// what it contains, and only then applies it and reloads, exactly like
// the desktop flow. The Stremio sign-in is excluded by lib/backup itself.
export function BackupSection() {
  const t = useT();
  const [selected, setSelected] = useState<Set<BackupSectionKey>>(
    () => new Set(BACKUP_SECTIONS.map((s) => s.key)),
  );
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [applying, setApplying] = useState(false);
  const [restoreError, setRestoreError] = useState(false);

  useEffect(() => {
    if (!exported) return;
    const timer = window.setTimeout(() => setExported(false), 1600);
    return () => window.clearTimeout(timer);
  }, [exported]);

  const toggle = (key: BackupSectionKey) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const doExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const saved = await downloadBackup([...selected]);
      if (saved) setExported(true);
    } catch {
      setError(t("Could not build the backup file."));
    } finally {
      setExporting(false);
    }
  };

  const startRestore = () => {
    setError(null);
    void pickBackupFile()
      .then((text) => {
        if (text === null) return;
        const res = parseBackup(text);
        if (!res.ok) {
          setError(t(res.error));
          return;
        }
        setPending(res.backup);
        setRestoreError(false);
      })
      .catch(() => setError(t("Could not read that file.")));
  };

  const confirmRestore = () => {
    if (!pending) return;
    setApplying(true);
    setRestoreError(false);
    void applyBackup(pending)
      .then(() => {
        window.setTimeout(() => window.location.reload(), 280);
      })
      .catch(() => {
        setApplying(false);
        setRestoreError(true);
      });
  };

  return (
    <>
      <SettingsGroup
        title={t("Export your setup")}
        footer={t(
          "Choose which parts of your setup to save in one backup file. Your Stremio sign-in is excluded.",
        )}
      >
        {BACKUP_SECTIONS.map((section, i) => (
          <div key={section.key}>
            {i > 0 && <GroupDivider />}
            <ToggleRow
              label={t(backupSectionLabel(section.key))}
              detail={
                t(backupSectionDescription(section.key)) +
                (section.warning ? ` ${t("Contains login credentials.")}` : "")
              }
              on={selected.has(section.key)}
              onChange={() => toggle(section.key)}
            />
          </div>
        ))}
        <GroupDivider />
        <div className="px-4 py-3.5">
          <button
            type="button"
            disabled={exporting || selected.size === 0}
            onClick={() => void doExport()}
            className="flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {exported
              ? t("Saved")
              : exporting
                ? t("Working…")
                : t("Export {n} sections", { n: selected.size })}
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("Restore from a backup")}
        footer={t(
          "Choose a Harbor backup and review what it contains before restoring. Your Stremio sign-in stays on this device.",
        )}
      >
        {pending ? (
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <span className="text-[15px] font-medium text-ink">
              {t("Restore this backup?")}
            </span>
            <span className="text-[13px] leading-relaxed text-ink-subtle">
              {t(
                "This file restores its {n} saved entries and replaces only those parts of your setup. Anything it does not contain stays exactly as it is.",
                { n: backupKeyCount(pending) },
              )}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {backupSections(pending).map((key) => (
                <span
                  key={key}
                  className="rounded-full bg-raised px-2.5 py-1 text-[12px] font-medium text-ink-muted"
                >
                  {t(backupSectionLabel(key))}
                </span>
              ))}
            </span>
            <span className="text-[12.5px] text-ink-subtle">
              {t("Saved {when} from Harbor {app}. Your Stremio sign-in stays as is.", {
                when: pending.exportedAt
                  ? new Date(pending.exportedAt).toLocaleString()
                  : t("an unknown date"),
                app: pending.app,
              })}
            </span>
            {restoreError && (
              <p role="alert" className="text-[13px] text-danger">
                {t(
                  "Restore did not finish. Some settings may already have changed. Free some storage, then try again.",
                )}
              </p>
            )}
            <span className="flex gap-2.5">
              <button
                type="button"
                disabled={applying}
                onClick={() => setPending(null)}
                className="flex h-11 flex-1 items-center justify-center rounded-full border border-edge-soft bg-surface text-[14.5px] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={confirmRestore}
                className="flex h-11 flex-1 items-center justify-center rounded-full bg-ink text-[14.5px] font-semibold text-canvas transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                {applying ? t("Restoring...") : t("Restore and reload")}
              </button>
            </span>
          </div>
        ) : (
          <ValueRow label={t("Restore")} onClick={startRestore} />
        )}
      </SettingsGroup>

      {error && (
        <p role="alert" className="px-1 text-[13px] text-danger">
          {error}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Relay (Watch Together)                                              */
/* ------------------------------------------------------------------ */

// The Together / Listen Together providers are mounted in the phone
// entry; the relay they connect through is a plain settings key
// (togetherRelayUrl) the desktop Relay panel writes. This section
// mirrors that panel's URL handling (custom URL / public relay /
// clear) plus the two session toggles. The Cloudflare self-deploy flow
// stays desktop-only — it provisions a worker with account tokens from
// the desktop panel.
export function RelaySection() {
  const t = useT();
  const { settings, update } = useSettings();
  const url = settings.togetherRelayUrl;
  return (
    <>
      <SettingsGroup
        title={t("Relay")}
        footer={t(
          "Watch Together connects through a relay. Leave this empty to stay offline, or use the public relay. Deploying your own relay is done from the desktop app.",
        )}
      >
        <KeyField
          label={t("Relay URL")}
          value={url}
          onSave={(v) => update({ togetherRelayUrl: v })}
          placeholder="wss://…"
        />
        <GroupDivider />
        <ValueRow
          label={t("Use the public relay")}
          value={url === HARBOR_PUBLIC_RELAY ? t("On") : undefined}
          onClick={() => update({ togetherRelayUrl: HARBOR_PUBLIC_RELAY })}
        />
        {url && (
          <>
            <GroupDivider />
            <ValueRow
              label={t("Clear relay")}
              danger
              onClick={() => update({ togetherRelayUrl: "" })}
            />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("Session")}>
        <ToggleRow
          label={t("Share cursors")}
          on={settings.togetherShareCursors}
          onChange={(v) => update({ togetherShareCursors: v })}
        />
        <GroupDivider />
        <ToggleRow
          label={t("Guests can pick what to watch")}
          on={settings.togetherGuestsPick}
          onChange={(v) => update({ togetherGuestsPick: v })}
        />
      </SettingsGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Home servers (Plex / Jellyfin / Emby)                               */
/* ------------------------------------------------------------------ */

// Connections live in lib/media-server/connections (per profile, tokens
// in the secret store). Managing existing connections — enable, include
// in Continue Watching, remove — is plain store writes. Adding one
// needs the provider sign-in flows (Plex PIN, Jellyfin / Emby login and
// library pickers) that only the desktop streaming-sources panel
// implements, so the phone manages what is already connected.
let msCache: MediaServerConnection[] | null = null;
function msSnapshot(): MediaServerConnection[] {
  if (!msCache) msCache = mediaServerConnections();
  return msCache;
}
function msSubscribe(fn: () => void): () => void {
  return subscribeMediaServerConnections(() => {
    msCache = null;
    fn();
  });
}

export function MediaServersSection() {
  const t = useT();
  const connections = useSyncExternalStore(msSubscribe, msSnapshot, msSnapshot);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (connections.length === 0) {
    return (
      <SettingsGroup
        footer={t(
          "Adding a server needs its sign-in flow (Plex, Jellyfin or Emby), which lives in the desktop app for now.",
        )}
      >
        <ValueRow label={t("No home servers connected")} />
      </SettingsGroup>
    );
  }

  return (
    <>
      {connections.map((c) => (
        <SettingsGroup
          key={c.id}
          title={c.name}
          footer={`${c.provider} · ${c.origin}`}
        >
          <ToggleRow
            label={t("Enabled")}
            on={c.enabled}
            onChange={(v) => updateMediaServerConnection(c.id, { enabled: v })}
          />
          <GroupDivider />
          <ToggleRow
            label={t("Include in Continue Watching")}
            on={c.includeContinueWatching}
            onChange={(v) =>
              updateMediaServerConnection(c.id, { includeContinueWatching: v })
            }
          />
          <GroupDivider />
          <ToggleRow
            label={t("Direct play")}
            on={c.directPlay}
            onChange={(v) => updateMediaServerConnection(c.id, { directPlay: v })}
          />
          <GroupDivider />
          <ValueRow
            label={
              confirmRemove === c.id ? t("Tap again to remove") : t("Remove server")
            }
            danger
            onClick={() => {
              if (confirmRemove === c.id) {
                removeMediaServerConnection(c.id);
                setConfirmRemove(null);
              } else {
                setConfirmRemove(c.id);
              }
            }}
          />
        </SettingsGroup>
      ))}
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-subtle">
        {t(
          "Adding a server needs its sign-in flow (Plex, Jellyfin or Emby), which lives in the desktop app for now.",
        )}
      </p>
    </>
  );
}
