import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { FocusPrefs } from './types';
import {
  applyLiquidNeonTokens,
  resetLiquidNeonTokens,
  applyPageBackgroundTokens,
  PAGE_BACKGROUND_DEFAULTS,
} from './theme';
import { resolveAxisTokens } from './themeAxis';
import { detectCloudProvider } from './lib/cloudSync';
import MoveVaultWizard from './MoveVaultWizard';
import SecurityWarningDialog from './components/SettingsPanel/SecurityWarningDialog';
import AdvancedAppearancePopover from './components/SettingsPanel/AdvancedAppearancePopover';
import ProviderSection from './components/SettingsPanel/sections/ProviderSection';
import ApiKeySection from './components/SettingsPanel/sections/ApiKeySection';
import AccountSection from './components/SettingsPanel/sections/AccountSection';
import VaultPathsSection from './components/SettingsPanel/sections/VaultPathsSection';
import VaultHealthSection from './components/SettingsPanel/sections/VaultHealthSection';
import AgentsSection from './components/SettingsPanel/sections/AgentsSection';
import AutoLinkerSection from './components/SettingsPanel/sections/AutoLinkerSection';
import JournalSection from './components/SettingsPanel/sections/JournalSection';
import SceneFieldsSection from './components/SettingsPanel/sections/SceneFieldsSection';
import SnapshotsSection from './components/SettingsPanel/sections/SnapshotsSection';
import VersionHistorySection from './components/SettingsPanel/sections/VersionHistorySection';
import BackupSection from './components/SettingsPanel/sections/BackupSection';
import ArchiveAgentSection from './components/SettingsPanel/sections/ArchiveAgentSection';
import UpdatesSection from './components/SettingsPanel/sections/UpdatesSection';
import AppearanceSection from './components/SettingsPanel/sections/AppearanceSection';
import LiquidNeonAppearanceSection from './components/SettingsPanel/sections/LiquidNeonAppearanceSection';
import PageAppearanceSection from './components/SettingsPanel/sections/PageAppearanceSection';
import NavConfigSection from './components/SettingsPanel/sections/NavConfigSection';
import FocusModeSection from './components/SettingsPanel/sections/FocusModeSection';
import VoiceSection from './components/SettingsPanel/sections/VoiceSection';
import TelemetrySection from './components/SettingsPanel/sections/TelemetrySection';
// Beta 3 M24: settings remainder pages (prototype §10) + vault/story import
import AccountProfileSection from './components/SettingsPanel/sections/AccountProfileSection';
import EditorSettingsSection from './components/SettingsPanel/sections/EditorSettingsSection';
import ImportVaultSection from './components/SettingsPanel/sections/ImportVaultSection';
import ImportStorySection from './components/SettingsPanel/sections/ImportStorySection';
import SyncBackupSection from './components/SettingsPanel/sections/SyncBackupSection';
import ShortcutsSection from './components/SettingsPanel/sections/ShortcutsSection';
import AboutSection from './components/SettingsPanel/sections/AboutSection';
import { SETTINGS_CATEGORIES, type SettingsCategoryId } from './settingsCategories';
import {
  DEFAULTS,
  DEFAULT_AGENT_OVERRIDE,
  PROVIDER_OPTIONS,
  LISTABLE_PROVIDERS,
  modelListErrorCopy,
  validateApiKey,
  providerSupportsVoice,
  LG_DEFAULTS,
  NAV_RAIL_DEFAULTS,
  type ProviderKind,
  type AgentName,
  type AgentOverrideState,
  type TestConnectionStatus,
  type ModelListStatus,
  type MicDevice,
} from './components/SettingsPanel/settingsPanelTypes';
import './SettingsPanel.css';

interface Props {
  onClose: () => void;
  onSaved?: (settings: AppSettings) => void;
  focusPrefs?: FocusPrefs;
  onFocusPrefsChange?: (prefs: FocusPrefs) => void;
}

const SETTINGS_CATS: readonly SettingsCategoryId[] = SETTINGS_CATEGORIES.map((c) => c.id);
type SettingsCat = SettingsCategoryId;

export default function SettingsPanel({ onClose, onSaved, focusPrefs, onFocusPrefsChange }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);

  // SKY-9: Vault paths state. `vaults` mirrors the persisted Story Vault +
  // Notes Vault roots; `vaultsDirty` flags an unsaved local edit so the Save
  // Vault Paths button only fires when there's something to persist.
  const [vaults, setVaults] = useState<{ storyVaultPath: string; notesVaultPath: string }>({
    storyVaultPath: '',
    notesVaultPath: '',
  });
  const [vaultsDirty, setVaultsDirty] = useState(false);
  const [vaultsSavedOk, setVaultsSavedOk] = useState(false);
  const [vaultsError, setVaultsError] = useState<string | null>(null);

  // SKY-861/SKY-1112: Cloud-sync vault placement entry point.
  const [showMoveWizard, setShowMoveWizard] = useState(false);
  const vaultProvider = useMemo(() => detectCloudProvider(vaults.storyVaultPath), [vaults.storyVaultPath]);

  // Provider state (MYT-779)
  const [providerKind, setProviderKind] = useState<ProviderKind>('anthropic');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerApiKeyDirty, setProviderApiKeyDirty] = useState(false);
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [testConnectionStatus, setTestConnectionStatus] = useState<TestConnectionStatus>('idle');
  const [testConnectionMsg, setTestConnectionMsg] = useState('');

  // Per-agent provider overrides (SKY-686)
  const [agentOverrides, setAgentOverrides] = useState<Record<AgentName, AgentOverrideState>>({
    writingAssistant: { ...DEFAULT_AGENT_OVERRIDE },
    brainstorm: { ...DEFAULT_AGENT_OVERRIDE },
    archive: { ...DEFAULT_AGENT_OVERRIDE },
  });
  const [agentTestStatus, setAgentTestStatus] = useState<Record<AgentName, TestConnectionStatus>>({
    writingAssistant: 'idle', brainstorm: 'idle', archive: 'idle',
  });
  const [agentTestMsg, setAgentTestMsg] = useState<Record<AgentName, string>>({
    writingAssistant: '', brainstorm: '', archive: '',
  });
  // Security warning: non-localhost endpoint confirmation. Not currently wired
  // to a producer (kept for parity with the pre-SKY-5694 monolith — no
  // behavior change intended by this refactor).
  const [remoteWarning, setRemoteWarning] = useState<{ agent: AgentName | 'global' | null; url: string; onConfirm: () => void } | null>(null);
  // Model listing state (SKY-1501)
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListStatus, setModelListStatus] = useState<ModelListStatus>('idle');
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [useCustomInput, setUseCustomInput] = useState(false);

  // SKY-1501: fetch available models from the selected provider endpoint.
  // Defined before the settings useEffect that calls it to avoid TDZ errors.
  const fetchModels = useCallback(async (kind: ProviderKind, baseUrl: string) => {
    if (!LISTABLE_PROVIDERS.has(kind)) {
      setModelList([]);
      setModelListStatus('idle');
      setModelListError(null);
      return;
    }
    setModelListStatus('loading');
    setModelListError(null);
    try {
      const result = await window.api.providerListModels({ kind, baseUrl: baseUrl || undefined });
      if (result.ok) {
        setModelList(result.models);
        // Empty list is not an error — fall back to free-text silently (spec §5)
        setModelListStatus(result.models.length > 0 ? 'ok' : 'idle');
        setUseCustomInput(false);
      } else {
        setModelList([]);
        setModelListStatus('error');
        setModelListError(modelListErrorCopy(kind, result.error));
      }
    } catch {
      setModelList([]);
      setModelListStatus('error');
      setModelListError(modelListErrorCopy(kind));
    }
  }, []);

  // Telemetry state (MYT-344 / MYT-779)
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  // Liquid Neon customization state (MYT-613 / MYT-716)
  const [lg, setLg] = useState<LiquidNeonPrefs>({ ...LG_DEFAULTS });
  const [lgAdvancedOpen, setLgAdvancedOpen] = useState(false);

  // SKY-2973: Settings category navigation
  const [settingsCategory, setSettingsCategory] = useState<SettingsCat>('agents');
  const settingsCatNavRef = useRef<HTMLElement>(null);

  // SKY-3218: Nav-bar configuration
  const [navConfig, setNavConfig] = useState<NavRailConfig>(NAV_RAIL_DEFAULTS);

  // Page background state (SKY-2097)
  const [pageBg, setPageBg] = useState<PageBackgroundSettings>({ ...PAGE_BACKGROUND_DEFAULTS });
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      if (s.liquidNeon) {
        const raw = s.liquidNeon;
        // SKY-3219 / GH#612: infer bgMode:'image' for legacy settings with a
        // stored file path but no explicit bgMode field.
        const bgModeOverride: Partial<LiquidNeonPrefs> =
          (raw.background && raw.background !== 'default' && !raw.bgMode)
            ? { bgMode: 'image' }
            : {};
        setLg({ ...LG_DEFAULTS, ...raw, ...bgModeOverride });
        const bg = raw.background;
        if (bg && bg !== 'default') {
          window.api.loadBgImage?.(bg)
            .then((res: { dataUrl: string | null }) => { if (res?.dataUrl) setBgPreviewUrl(res.dataUrl); })
            .catch(() => {});
        }
      }
      if (s.provider) {
        setProviderKind(s.provider.kind as ProviderKind);
        setProviderBaseUrl(s.provider.baseUrl ?? '');
        setProviderModel(s.provider.model ?? '');
        // SKY-1501: auto-fetch models on settings open
        fetchModels(s.provider.kind as ProviderKind, s.provider.baseUrl ?? '');
      }
      // Load per-agent provider overrides
      const loadAgentOverride = (agentCfg: { provider?: ProviderConfig }): AgentOverrideState => {
        const p = agentCfg.provider;
        if (!p) return { ...DEFAULT_AGENT_OVERRIDE };
        return {
          enabled: true,
          kind: p.kind as ProviderKind,
          apiKey: '',
          apiKeyDirty: false,
          baseUrl: p.baseUrl ?? '',
          model: p.model,
        };
      };
      setAgentOverrides({
        writingAssistant: loadAgentOverride(s.agents.writingAssistant),
        brainstorm: loadAgentOverride(s.agents.brainstorm),
        archive: loadAgentOverride(s.agents.archive),
      });
      setTelemetryEnabled(s.telemetry?.enabled ?? false);
      if (s.pageBackground) setPageBg({ ...PAGE_BACKGROUND_DEFAULTS, ...s.pageBackground });
      setNavConfig(s.navConfig ?? NAV_RAIL_DEFAULTS);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [fetchModels]);

  // SKY-1902: Move focus into the dialog once content has loaded. The mount-time
  // effect above runs while `loading` is still true and the dialog body hasn't
  // mounted, so `dialogRef.current` is null and no element gets focused. Without
  // this follow-up effect, keyboard focus stays on the trigger button outside
  // the dialog, breaking the focus trap and TC-SKY-814-06 (Tab navigation never
  // reaches the AI provider select).
  useEffect(() => {
    if (loading) return;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
  }, [loading]);

  // Close popover on Escape
  useEffect(() => {
    if (!lgAdvancedOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLgAdvancedOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lgAdvancedOpen]);

  // Keep --lg-neon in sync with the softness slider (SKY-261)
  useEffect(() => {
    const s = lg.softnessContrast;
    if (s != null && !isNaN(s)) {
      document.documentElement.style.setProperty('--lg-neon', resolveAxisTokens(s * 100).neon.toFixed(2));
    }
  }, [lg.softnessContrast]);

  // Close main dialog on Escape when the inner popover is not open (ARIA APG dialog pattern)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lgAdvancedOpen) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, lgAdvancedOpen]);

  // Focus trap in popover
  useEffect(() => {
    if (!lgAdvancedOpen) return;
    const first = popoverRef.current?.querySelector<HTMLElement>(
      'button, input, select, [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
  }, [lgAdvancedOpen]);

  // SKY-9: load currently-persisted vault paths once on mount. The IPC
  // resolves any unset path to its computed default (Option A) so the input
  // always shows the value that's actually in effect.
  useEffect(() => {
    window.api.vaultGetPaths().then((paths) => {
      setVaults(paths);
    }).catch(() => {
      // non-fatal — leave inputs blank; user can still pick folders
    });
  }, []);

  const handleMoveVault = useCallback(() => {
    setShowMoveWizard(true);
  }, []);

  const refreshMicDevices = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
      setMicDevices(mics);
    }).catch(() => {});
  }, []);

  useEffect(() => { refreshMicDevices(); }, [refreshMicDevices]);

  const keyIsConfigured = Boolean(settings.apiKey);
  const apiKeyError = apiKeyDirty ? validateApiKey(apiKeyInput) : null;

  const setAgentField = useCallback(<A extends keyof AppSettings['agents'], K extends keyof AppSettings['agents'][A]>(
    agent: A,
    field: K,
    value: AppSettings['agents'][A][K],
  ) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...prev.agents[agent], [field]: value },
      },
    }));
    setSavedOk(false);
  }, []);

  // SKY-908 — single source of truth for per-category auto-apply edits.
  // On first edit, materialises a full map seeded with the current enabled
  // state so the persisted JSON is unambiguous (no implicit "all enabled"
  // shorthand once the user has expressed an opinion).
  const setCategoryAutoApply = useCallback((
    agent: keyof AppSettings['agents'],
    category: SuggestionCategory,
    enabled: boolean,
  ) => {
    setSettings((prev) => {
      const current = prev.agents[agent];
      const existing = current.autoApplyCategories ?? {};
      const seeded: Record<SuggestionCategory, boolean> = {
        'punctuation': existing.punctuation ?? true,
        'spelling': existing.spelling ?? true,
        'grammar': existing.grammar ?? true,
        'sentence-structure': existing['sentence-structure'] ?? true,
        'style-tone': existing['style-tone'] ?? true,
        'other': existing.other ?? true,
      };
      seeded[category] = enabled;
      return {
        ...prev,
        agents: {
          ...prev.agents,
          [agent]: { ...current, autoApplyCategories: seeded },
        },
      };
    });
    setSavedOk(false);
  }, []);

  const buildAgentProviderConfig = useCallback((agentName: AgentName): ProviderConfig | undefined => {
    const ov = agentOverrides[agentName];
    if (!ov.enabled) return undefined;
    const def = PROVIDER_OPTIONS.find((p) => p.value === ov.kind)!;
    return {
      kind: ov.kind,
      model: ov.model,
      ...(def.needsKey ? { apiKey: ov.apiKeyDirty ? ov.apiKey : (settings.agents[agentName].provider?.apiKey ?? '') } : {}),
      ...(def.needsUrl && ov.baseUrl ? { baseUrl: ov.baseUrl } : {}),
    };
  }, [agentOverrides, settings.agents]);


  const handleSave = useCallback(async () => {
    if (apiKeyError) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const providerDef = PROVIDER_OPTIONS.find((p) => p.value === providerKind)!;
      const provider: AppSettings['provider'] = {
        kind: providerKind,
        model: providerModel,
        ...(providerDef.needsKey ? { apiKey: providerApiKeyDirty ? providerApiKey : (settings.provider?.apiKey ?? '') } : {}),
        ...(providerDef.needsUrl && providerBaseUrl ? { baseUrl: providerBaseUrl } : {}),
        ...(settings.provider?.kind === providerKind && settings.provider.capabilities ? { capabilities: settings.provider.capabilities } : {}),
      };
      const payload: AppSettings = {
        ...settings,
        apiKey: apiKeyDirty ? apiKeyInput : settings.apiKey,
        provider,
        liquidNeon: lg,
        pageBackground: pageBg,
        navConfig,
        telemetry: { enabled: telemetryEnabled, sessionId: settings.telemetry?.sessionId ?? '' },
        agents: {
          ...settings.agents,
          writingAssistant: { ...settings.agents.writingAssistant, provider: buildAgentProviderConfig('writingAssistant') },
          brainstorm: { ...settings.agents.brainstorm, provider: buildAgentProviderConfig('brainstorm') },
          archive: { ...settings.agents.archive, provider: buildAgentProviderConfig('archive') },
        },
      };
      await window.api.settingsSet(payload);
      setSavedOk(true);
      applyLiquidNeonTokens(lg, bgPreviewUrl);
      applyPageBackgroundTokens(pageBg);
      onSaved?.(payload);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }, [settings, apiKeyInput, apiKeyDirty, apiKeyError, providerKind, providerModel, providerApiKey, providerApiKeyDirty, providerBaseUrl, telemetryEnabled, lg, bgPreviewUrl, pageBg, navConfig, onSaved, buildAgentProviderConfig]);

  // SKY-9: persist vault paths in a separate round-trip from settingsSet so
  // a misconfigured path can't block API-key edits, and so the main side can
  // re-seed both vault dirs in the same call (vault:setPaths handler does
  // ensureVaultDir + ensureNotesVaultDir before returning).
  const handleSaveVaults = useCallback(async () => {
    setVaultsError(null);
    setVaultsSavedOk(false);
    try {
      const result = await window.api.vaultSetPaths(
        vaults.storyVaultPath.trim(),
        vaults.notesVaultPath.trim(),
      );
      if (result.saved) {
        setVaults({
          storyVaultPath: result.storyVaultPath,
          notesVaultPath: result.notesVaultPath,
        });
        setVaultsDirty(false);
        setVaultsSavedOk(true);
      }
    } catch (e) {
      setVaultsError(e instanceof Error ? e.message : 'Failed to save vault paths.');
    }
  }, [vaults.storyVaultPath, vaults.notesVaultPath]);

  const handlePickVaultFolder = useCallback(
    async (which: 'storyVaultPath' | 'notesVaultPath') => {
      const title = which === 'storyVaultPath' ? 'Choose Story Vault folder' : 'Choose Notes Vault folder';
      const res = await window.api.chooseVaultFolder(title, vaults[which] || undefined);
      if (res.cancelled || !res.path) return;
      setVaults((prev) => ({ ...prev, [which]: res.path as string }));
      setVaultsDirty(true);
      setVaultsSavedOk(false);
    },
    [vaults],
  );

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((el) => !(el as HTMLInputElement).disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const handleSettingsCategoryKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const idx = SETTINGS_CATS.indexOf(settingsCategory);
    if (idx < 0) return;
    let next = settingsCategory;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = SETTINGS_CATS[(idx + 1) % SETTINGS_CATS.length];
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = SETTINGS_CATS[(idx + SETTINGS_CATS.length - 1) % SETTINGS_CATS.length];
    } else if (e.key === 'Home') {
      next = SETTINGS_CATS[0];
    } else if (e.key === 'End') {
      next = SETTINGS_CATS[SETTINGS_CATS.length - 1];
    } else {
      return;
    }
    e.preventDefault();
    setSettingsCategory(next);
    const btn = settingsCatNavRef.current?.querySelector<HTMLElement>(`[data-tabkey="${next}"]`);
    btn?.focus();
  }, [settingsCategory]);

  const handleTestConnection = useCallback(async () => {
    setTestConnectionStatus('testing');
    setTestConnectionMsg('');
    try {
      const result = await window.api.settingsTestConnection({
        kind: providerKind,
        apiKey: providerApiKeyDirty ? providerApiKey : (settings.provider?.apiKey ?? ''),
        baseUrl: providerBaseUrl || undefined,
        model: providerModel,
      });
      if (result?.ok) {
        setTestConnectionStatus('ok');
        setTestConnectionMsg('Connection successful');
      } else {
        setTestConnectionStatus('error');
        setTestConnectionMsg(result?.error ?? 'Connection failed');
      }
    } catch (e) {
      setTestConnectionStatus('error');
      setTestConnectionMsg(e instanceof Error ? e.message : 'Connection failed');
    }
  }, [providerKind, providerApiKey, providerApiKeyDirty, providerBaseUrl, providerModel, settings.provider?.apiKey]);

  const handleAgentTestConnection = useCallback(async (agentName: AgentName) => {
    setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'testing' }));
    setAgentTestMsg((prev) => ({ ...prev, [agentName]: '' }));
    const ov = agentOverrides[agentName];
    try {
      const result = await window.api.settingsTestConnection({
        kind: ov.kind,
        apiKey: ov.apiKeyDirty ? ov.apiKey : (settings.agents[agentName].provider?.apiKey ?? ''),
        baseUrl: ov.baseUrl || undefined,
        model: ov.model,
      });
      if (result?.ok) {
        setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'ok' }));
        setAgentTestMsg((prev) => ({ ...prev, [agentName]: 'Connection successful' }));
      } else {
        setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'error' }));
        setAgentTestMsg((prev) => ({ ...prev, [agentName]: result?.error ?? 'Connection failed' }));
      }
    } catch (e) {
      setAgentTestStatus((prev) => ({ ...prev, [agentName]: 'error' }));
      setAgentTestMsg((prev) => ({ ...prev, [agentName]: e instanceof Error ? e.message : 'Connection failed' }));
    }
  }, [agentOverrides, settings.agents]);

  const setAgentOverride = useCallback(<K extends keyof AgentOverrideState>(
    agentName: AgentName,
    field: K,
    value: AgentOverrideState[K],
  ) => {
    setAgentOverrides((prev) => ({
      ...prev,
      [agentName]: { ...prev[agentName], [field]: value },
    }));
    setSavedOk(false);
  }, []);

  // ── Liquid Neon helpers ──────────────────────────────────────────────────

  const setLgField = useCallback(<K extends keyof LiquidNeonPrefs>(key: K, value: LiquidNeonPrefs[K]) => {
    setLg((prev) => {
      const next = { ...prev, [key]: value };
      applyLiquidNeonTokens(next, bgPreviewUrl);
      return next;
    });
    setSavedOk(false);
  }, [bgPreviewUrl]);

  const handleSoftnessChange = useCallback((s: number) => {
    document.documentElement.style.setProperty('--lg-neon', resolveAxisTokens(s * 100).neon.toFixed(2));
    setLg((prev) => {
      if (prev.advancedDecoupled) {
        // When decoupled only update the master; individual sliders stay
        const next: LiquidNeonPrefs = { ...prev, softnessContrast: s };
        applyLiquidNeonTokens(next, bgPreviewUrl);
        return next;
      }
      const next: LiquidNeonPrefs = { ...prev, softnessContrast: s, glass: s, blur: s, neonIntensity: s };
      applyLiquidNeonTokens(next, bgPreviewUrl);
      return next;
    });
    setSavedOk(false);
  }, [bgPreviewUrl]);

  const handleRelinkToSlider = useCallback(() => {
    setLg((prev) => {
      const s = prev.softnessContrast;
      const next: LiquidNeonPrefs = { ...prev, advancedDecoupled: false, glass: s ?? LG_DEFAULTS.glass, blur: s ?? LG_DEFAULTS.blur, neonIntensity: s ?? LG_DEFAULTS.neonIntensity };
      applyLiquidNeonTokens(next, bgPreviewUrl);
      return next;
    });
    setSavedOk(false);
  }, [bgPreviewUrl]);

  const handleResetAll = useCallback(() => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    const defaults = { ...LG_DEFAULTS };
    setLg(defaults);
    setBgPreviewUrl(null);
    setResetConfirm(false);
    resetLiquidNeonTokens();
    applyLiquidNeonTokens(defaults);
    setSavedOk(false);
  }, [resetConfirm]);

  if (loading) {
    return (
      <div className="settings-overlay" onClick={handleBackdropClick} aria-modal="true" role="dialog" aria-label="Settings">
        <div className="settings-panel">
          <div className="settings-loading">Loading settings…</div>
        </div>
      </div>
    );
  }

  const activeProvider = settings.provider?.kind === providerKind ? settings.provider : undefined;
  const activeProviderSupportsVoice = providerSupportsVoice(activeProvider);

  return (
    <>
    <div className="settings-overlay" onClick={handleBackdropClick} aria-modal="true" role="dialog" aria-label="Settings" aria-labelledby="settings-dialog-title">
      <div className="settings-panel" ref={dialogRef} onKeyDown={handleDialogKeyDown}>
        <div className="settings-header">
          <h2 id="settings-dialog-title" className="settings-title">Settings</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <nav
          className="settings-cat-nav"
          role="tablist"
          aria-label="Settings categories"
          ref={settingsCatNavRef}
          onKeyDown={handleSettingsCategoryKeyDown}
        >
          {SETTINGS_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              role="tab"
              id={`settings-category-tab-${cat.id}`}
              data-tabkey={cat.id}
              className={`settings-cat-nav__tab${settingsCategory === cat.id ? ' settings-cat-nav__tab--active' : ''}`}
              aria-selected={settingsCategory === cat.id}
              aria-controls="settings-category-panel"
              tabIndex={settingsCategory === cat.id ? 0 : -1}
              onClick={() => setSettingsCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        <div className="settings-body" role="tabpanel" id="settings-category-panel" aria-labelledby={`settings-category-tab-${settingsCategory}`}>

          {settingsCategory === 'agents' && (
            <>
              <ProviderSection
                providerKind={providerKind}
                setProviderKind={setProviderKind}
                providerApiKey={providerApiKey}
                setProviderApiKey={setProviderApiKey}
                providerApiKeyDirty={providerApiKeyDirty}
                setProviderApiKeyDirty={setProviderApiKeyDirty}
                providerBaseUrl={providerBaseUrl}
                setProviderBaseUrl={setProviderBaseUrl}
                providerModel={providerModel}
                setProviderModel={setProviderModel}
                savedProviderApiKey={settings.provider?.apiKey ?? ''}
                testStatus={testConnectionStatus}
                testMsg={testConnectionMsg}
                onTest={handleTestConnection}
                modelList={modelList}
                modelListStatus={modelListStatus}
                modelListError={modelListError}
                useCustomInput={useCustomInput}
                setUseCustomInput={setUseCustomInput}
                onFetchModels={fetchModels}
                setSavedOk={setSavedOk}
                activeProviderSupportsVoice={activeProviderSupportsVoice}
                setTestConnectionStatus={setTestConnectionStatus}
                setModelList={setModelList}
                setModelListStatus={setModelListStatus}
                setModelListError={setModelListError}
              />

              <ApiKeySection
                apiKeyInput={apiKeyInput}
                setApiKeyInput={setApiKeyInput}
                apiKeyDirty={apiKeyDirty}
                setApiKeyDirty={setApiKeyDirty}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
                keyIsConfigured={keyIsConfigured}
                apiKeyError={apiKeyError}
                setSavedOk={setSavedOk}
              />

              <AgentsSection
                settings={settings}
                providerKind={providerKind}
                agentOverrides={agentOverrides}
                agentTestStatus={agentTestStatus}
                agentTestMsg={agentTestMsg}
                setAgentField={setAgentField}
                setCategoryAutoApply={setCategoryAutoApply}
                setAgentOverride={setAgentOverride}
                onAgentTest={handleAgentTestConnection}
                micDevices={micDevices}
                refreshMicDevices={refreshMicDevices}
              />

              <AutoLinkerSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />

              <JournalSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />

              <ArchiveAgentSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />

              <VoiceSection settings={settings} setSettings={setSettings} providerKind={providerKind} setSavedOk={setSavedOk} />
            </>
          )}

          {settingsCategory === 'vaults' && (
            <>
              <AccountSection vaults={vaults} vaultProvider={vaultProvider} onMoveVault={handleMoveVault} />

              <VaultPathsSection
                vaults={vaults}
                setVaults={setVaults}
                vaultsDirty={vaultsDirty}
                setVaultsDirty={setVaultsDirty}
                vaultsSavedOk={vaultsSavedOk}
                setVaultsSavedOk={setVaultsSavedOk}
                vaultsError={vaultsError}
                onPickVaultFolder={handlePickVaultFolder}
                onSaveVaults={handleSaveVaults}
              />

              {/* Beta 3 M24: vault + story import (prototype Vault & Files page) */}
              <ImportVaultSection notesVaultPath={vaults.notesVaultPath} />

              <ImportStorySection />

              <VaultHealthSection />

              <SceneFieldsSection />

              <SnapshotsSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />

              <VersionHistorySection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />
              <BackupSection />
            </>
          )}

          {/* ── Beta 3 M24: settings remainder pages (prototype §10) ── */}
          {settingsCategory === 'account' && (
            <AccountProfileSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />
          )}

          {settingsCategory === 'editor' && (
            <EditorSettingsSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />
          )}

          {settingsCategory === 'sync' && (
            <SyncBackupSection vaults={vaults} vaultProvider={vaultProvider} onMoveVault={handleMoveVault} />
          )}

          {settingsCategory === 'shortcuts' && <ShortcutsSection />}

          {settingsCategory === 'about' && <AboutSection />}

          {settingsCategory === 'appearance' && (
            <>
              <UpdatesSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />

              {/* Beta 3 M4: Liquid Neon v2 appearance — the prototype's Appearance page. */}
              <LiquidNeonAppearanceSection
                liquidNeonV2={settings.liquidNeonV2}
                onChange={(next) => setSettings((p) => ({ ...p, liquidNeonV2: next }))}
                setSavedOk={setSavedOk}
              />

              <AppearanceSection
                settings={settings}
                setSettings={setSettings}
                lg={lg}
                onSoftnessChange={handleSoftnessChange}
                onOpenAdvanced={() => setLgAdvancedOpen(true)}
                onRelinkToSlider={handleRelinkToSlider}
                onResetAll={handleResetAll}
                resetConfirm={resetConfirm}
                setResetConfirm={setResetConfirm}
                setSavedOk={setSavedOk}
              />

              <PageAppearanceSection pageBg={pageBg} setPageBg={setPageBg} setSavedOk={setSavedOk} />

              <NavConfigSection navConfig={navConfig} setNavConfig={setNavConfig} setSavedOk={setSavedOk} />
            </>
          )}

          {/* ── Focus Mode (SKY-325) ── */}
          {settingsCategory === 'appearance' && (
            <FocusModeSection focusPrefs={focusPrefs} onFocusPrefsChange={onFocusPrefsChange} />
          )}

          {settingsCategory === 'appearance' && (
            <TelemetrySection telemetryEnabled={telemetryEnabled} setTelemetryEnabled={setTelemetryEnabled} setSavedOk={setSavedOk} />
          )}

        </div>

        <div className="settings-footer">
          {saveError && <p className="settings-error-msg" role="alert">{saveError}</p>}
          {savedOk && <p className="settings-saved-msg" aria-live="polite">Settings saved.</p>}
          {/* SKY-12.4: debug reset — only rendered when MYTHOS_DEV=1 is set in the dev environment */}
          {import.meta.env.VITE_MYTHOS_DEV === '1' && (
            <div className="settings-debug-section">
              <h3 className="settings-section-title">Developer</h3>
              <button
                className="settings-btn settings-btn-cancel"
                data-testid="reset-onboarding"
                onClick={() => {
                  if (window.confirm('Reset onboarding? The wizard will re-appear on next boot.')) {
                    window.api.onboardingReset().then(() => {
                      window.location.reload();
                    }).catch(() => {});
                  }
                }}
              >
                Reset onboarding
              </button>
            </div>
          )}
          <div className="settings-footer-actions">
            <button type="button" className="settings-btn settings-btn-cancel" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="settings-btn settings-btn-save"
              onClick={handleSave}
              disabled={saving || !!apiKeyError}
              aria-label="Save settings"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Advanced UI settings popover (MYT-716) ── */}
      {lgAdvancedOpen && (
        <AdvancedAppearancePopover
          lg={lg}
          setLg={setLg}
          setLgField={setLgField}
          bgPreviewUrl={bgPreviewUrl}
          setBgPreviewUrl={setBgPreviewUrl}
          setSavedOk={setSavedOk}
          onClose={() => setLgAdvancedOpen(false)}
          onRelinkToSlider={handleRelinkToSlider}
          onResetAll={handleResetAll}
          resetConfirm={resetConfirm}
          setResetConfirm={setResetConfirm}
          popoverRef={popoverRef}
        />
      )}
    </div>
    {remoteWarning && (
      <SecurityWarningDialog
        url={remoteWarning.url}
        onConfirm={() => { remoteWarning.onConfirm(); setRemoteWarning(null); }}
        onCancel={() => setRemoteWarning(null)}
      />
    )}
    {showMoveWizard && (
      <MoveVaultWizard
        onClose={() => setShowMoveWizard(false)}
        onSuccess={(newPath) => {
          setShowMoveWizard(false);
          setVaults((prev) => ({ ...prev, storyVaultPath: newPath }));
        }}
      />
    )}
    </>
  );
}
