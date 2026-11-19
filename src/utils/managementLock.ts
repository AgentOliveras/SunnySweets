/**
 * Management Mode Lock & Centralized Session Guard Utility
 *
 * Provides a shared workspace-level secondary UI guard (with safe legacy local
 * fallback prior to Owner promotion) to prevent unauthorized or accidental entry
 * into administrative views on shared production floor tablets.
 *
 * SECURITY INVARIANTS:
 * - Plaintext PIN is NEVER stored in localStorage.
 * - Plaintext PIN is NEVER stored in Firestore.
 * - Plaintext PIN is NEVER exposed in configuration or client source code.
 * - Uses Web Crypto SHA-256 with a unique random 128-bit cryptographic salt.
 * - Fails CLOSED whenever an enabled lock is malformed or when authoritative
 *   workspace lock hydration is still loading or failed.
 * - Ephemeral unlock state lives ONLY in memory for the active Management view
 *   and re-locks immediately on exit to Production Floor/Main, reload/reopen,
 *   workspace change, PIN rotation, or sign-out.
 * - Firebase Authentication and Firestore workspace security rules remain the
 *   authoritative backend security controls.
 */

import type { AccessRole, TabType, Workspace, WorkspaceManagementLockPolicy } from '../types';

export interface ManagementLockConfig extends WorkspaceManagementLockPolicy {
  enabled: boolean;
  salt: string; // Random hex string (>= 16 chars)
  hash: string; // SHA-256(salt + ':' + pin) (64 hex chars)
  updatedAt?: string;
  updatedByUid?: string;
}

export type WorkspaceLockHydrationState = 'LOADING' | 'READY' | 'ERROR';

export type EffectiveManagementLockStatus =
  | 'DISABLED'
  | 'DISABLED_WORKSPACE'
  | 'PROTECTED_WORKSPACE'
  | 'PROTECTED_LOCAL_LEGACY'
  | 'HYDRATION_LOADING'
  | 'FAIL_CLOSED_UNVERIFIED'
  | 'FAIL_CLOSED_CORRUPT';

export type EffectiveManagementLockSource =
  | 'workspace'
  | 'local_legacy'
  | 'workspace_loading'
  | 'workspace_unverified'
  | 'unconfigured';

export interface EffectiveManagementLockResolution {
  status: EffectiveManagementLockStatus;
  source: EffectiveManagementLockSource;
  isLockActive: boolean;
  isVerificationBlocked: boolean;
  blockReason: string | null;
  effectiveConfig: ManagementLockConfig;
  hasLocalLegacyPin: boolean;
}

export interface StorageReaderWriter {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export const MGMT_LOCK_STORAGE_KEY = 'SS_MGMT_LOCK_CONFIG';
export const APP_MODE_STORAGE_KEY = 'SS_APP_MODE';

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const FORBIDDEN_PLAINTEXT_KEYS = ['pin', 'rawPin', 'plaintextPin', 'passcode', 'password', 'secretPin'];

/**
 * Generate a cryptographically secure 128-bit random salt
 */
export function generateSalt(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback if window.crypto is unavailable (e.g. Node test environment)
  const partA = Math.random().toString(16).substring(2).padEnd(16, '0').slice(0, 16);
  const partB = Date.now().toString(16).padStart(16, '0').slice(0, 16);
  return `${partA}${partB}`;
}

/**
 * Hash a PIN using Web Crypto SHA-256 and the provided salt.
 * Node.js test environments will use standard crypto if Web Crypto is not present.
 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const normalizedPin = pin.trim();
  const input = `${salt}:${normalizedPin}`;

  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Node.js / Server environment fallback
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha256').update(input).digest('hex');
  } catch {
    throw new Error('Cryptographic hashing is not available in the current runtime environment.');
  }
}

function getStorage(override?: StorageReaderWriter | null): StorageReaderWriter | null {
  if (override) return override;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
  }
  return null;
}

/**
 * Validates that an enabled lock config contains a well-formed salt and 64-char SHA-256 hex digest,
 * and contains zero plaintext PIN fields.
 */
export function isValidEnabledLockConfig(config: Partial<ManagementLockConfig> | null | undefined): boolean {
  if (!config || config.enabled !== true) return false;
  for (const key of FORBIDDEN_PLAINTEXT_KEYS) {
    if (key in (config as Record<string, unknown>)) {
      return false;
    }
  }
  const salt = typeof config.salt === 'string' ? config.salt.trim() : '';
  const hash = typeof config.hash === 'string' ? config.hash.trim() : '';
  if (salt.length < 16) return false;
  if (!SHA256_HEX_REGEX.test(hash)) return false;
  return true;
}

/**
 * Enforces strict persistence invariants before writing a lock config to localStorage or Firestore.
 */
export function assertValidLockConfigForPersistence(
  rawConfig: ManagementLockConfig & Record<string, unknown>
): ManagementLockConfig {
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('Invalid Management Lock configuration payload.');
  }

  for (const forbidden of FORBIDDEN_PLAINTEXT_KEYS) {
    if (forbidden in rawConfig && rawConfig[forbidden] !== undefined) {
      throw new Error(`Security invariant violation: Plaintext field "${forbidden}" is strictly prohibited.`);
    }
  }

  if (!rawConfig.enabled) {
    return {
      enabled: false,
      salt: '',
      hash: '',
      updatedAt: rawConfig.updatedAt || new Date().toISOString(),
      ...(rawConfig.updatedByUid ? { updatedByUid: String(rawConfig.updatedByUid) } : {}),
    };
  }

  const cleanSalt = typeof rawConfig.salt === 'string' ? rawConfig.salt.trim() : '';
  const cleanHash = typeof rawConfig.hash === 'string' ? rawConfig.hash.trim().toLowerCase() : '';

  if (cleanSalt.length < 16) {
    throw new Error('Invalid Management Lock configuration: Cryptographic salt must be at least 16 characters.');
  }
  if (!SHA256_HEX_REGEX.test(cleanHash)) {
    throw new Error('Invalid Management Lock configuration: Hash must be a 64-character SHA-256 hex digest.');
  }

  return {
    enabled: true,
    salt: cleanSalt,
    hash: cleanHash,
    updatedAt: rawConfig.updatedAt || new Date().toISOString(),
    ...(rawConfig.updatedByUid ? { updatedByUid: String(rawConfig.updatedByUid) } : {}),
  };
}

/**
 * Enforces Owner-only role authorization for modifying Management Mode PIN settings.
 */
export function assertOwnerCanConfigureManagementLock(role: AccessRole | null | undefined): void {
  if (role !== 'owner') {
    throw new Error('Permission denied: Only the workspace owner can configure or modify the Management Mode PIN.');
  }
}

/**
 * Load the current device-local lock configuration from localStorage
 */
export function loadManagementLockConfig(storageOverride?: StorageReaderWriter | null): ManagementLockConfig {
  const storage = getStorage(storageOverride);
  if (!storage) {
    return { enabled: false, salt: '', hash: '' };
  }
  try {
    const raw = storage.getItem(MGMT_LOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: Boolean(parsed.enabled),
        salt: typeof parsed.salt === 'string' ? parsed.salt : '',
        hash: typeof parsed.hash === 'string' ? parsed.hash : '',
        updatedAt: parsed.updatedAt,
        updatedByUid: parsed.updatedByUid,
      };
    }
  } catch (e) {
    console.error('Failed to load management lock config', e);
  }
  return { enabled: false, salt: '', hash: '' };
}

/**
 * Save lock configuration to localStorage (validated against plaintext storage)
 */
export function saveManagementLockConfig(
  config: ManagementLockConfig,
  storageOverride?: StorageReaderWriter | null
): void {
  const sanitized = assertValidLockConfigForPersistence(
    config as ManagementLockConfig & Record<string, unknown>
  );
  const storage = getStorage(storageOverride);
  if (!storage || !storage.setItem) return;
  try {
    storage.setItem(MGMT_LOCK_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (e) {
    console.error('Failed to save management lock config', e);
  }
}

/**
 * Verify an entered PIN against the stored hash and salt.
 *
 * FAIL-CLOSED INVARIANT:
 * - Explicitly disabled lock (`enabled: false`) returns `true`.
 * - Enabled lock (`enabled: true`) with missing/corrupt `hash`, missing/short `salt`,
 *   or empty PIN input strictly returns `false` (never fails open).
 */
export async function verifyManagementPin(
  pin: string,
  config: ManagementLockConfig
): Promise<boolean> {
  if (!config || !config.enabled) return true;
  if (!pin || !pin.trim()) return false;
  if (!isValidEnabledLockConfig(config)) return false;

  const computedHash = await hashPin(pin, config.salt.trim());
  return computedHash.toLowerCase() === config.hash.trim().toLowerCase();
}

/**
 * Check if device-local management mode lock is currently active
 */
export function isManagementLockEnabled(storageOverride?: StorageReaderWriter | null): boolean {
  const config = loadManagementLockConfig(storageOverride);
  return isValidEnabledLockConfig(config);
}

/**
 * Resolves the authoritative Management Mode PIN policy for the active workspace.
 *
 * FAIL-CLOSED & MIGRATION SAFETY RULES:
 * 1. While `workspaceDocHydrationState === 'LOADING'`, Management Mode entry is held
 *    locked (`HYDRATION_LOADING`) so a fresh device cannot slip past a cloud workspace PIN
 *    before the workspace document arrives.
 * 2. When `workspaceDocHydrationState === 'ERROR'`, Management Mode FAILS CLOSED
 *    (`FAIL_CLOSED_UNVERIFIED`) and never downgrades to an unconfigured or stale local PIN.
 * 3. When `workspace.managementLock` is defined on a hydrated (`READY`) workspace, it is
 *    authoritative across all devices (desktop, tablet, phone). Corrupt `enabled: true`
 *    workspace configs FAIL CLOSED (`FAIL_CLOSED_CORRUPT`).
 * 4. When `workspace.managementLock` is `undefined` on a hydrated (`READY`) workspace
 *    (not yet promoted by the Owner), any existing device-local `SS_MGMT_LOCK_CONFIG` is
 *    preserved and enforced (`PROTECTED_LOCAL_LEGACY`), while devices without a local PIN
 *    remain unlocked (`DISABLED`) so no user in `ws-main` is locked out during an unapproved migration.
 */
export function resolveEffectiveManagementLock(params: {
  workspace: Workspace | null;
  workspaceDocHydrationState: WorkspaceLockHydrationState;
  localConfig?: ManagementLockConfig;
  storageOverride?: StorageReaderWriter | null;
}): EffectiveManagementLockResolution {
  const localCfg = params.localConfig ?? loadManagementLockConfig(params.storageOverride);
  const hasLocalLegacyPin = Boolean(localCfg.enabled && isValidEnabledLockConfig(localCfg));
  const wsLock = params.workspace?.managementLock;

  if (params.workspaceDocHydrationState === 'LOADING') {
    return {
      status: 'HYDRATION_LOADING',
      source: 'workspace_loading',
      isLockActive: true,
      isVerificationBlocked: true,
      blockReason: 'Verifying workspace Management Mode security policy from Cloud Firestore...',
      effectiveConfig: { enabled: true, salt: '', hash: '' },
      hasLocalLegacyPin,
    };
  }

  if (params.workspaceDocHydrationState === 'ERROR') {
    return {
      status: 'FAIL_CLOSED_UNVERIFIED',
      source: 'workspace_unverified',
      isLockActive: true,
      isVerificationBlocked: true,
      blockReason:
        'Unable to verify the shared workspace Management PIN policy from Cloud Firestore. Management Mode remains locked until connection is restored.',
      effectiveConfig: { enabled: true, salt: '', hash: '' },
      hasLocalLegacyPin,
    };
  }

  // Authoritative workspace policy exists on hydrated workspace document
  if (wsLock !== undefined && wsLock !== null) {
    if (wsLock.enabled) {
      if (!isValidEnabledLockConfig(wsLock)) {
        return {
          status: 'FAIL_CLOSED_CORRUPT',
          source: 'workspace_unverified',
          isLockActive: true,
          isVerificationBlocked: true,
          blockReason:
            'Workspace Management PIN configuration is incomplete or corrupted. Management Mode remains locked for safety.',
          effectiveConfig: { enabled: true, salt: '', hash: '' },
          hasLocalLegacyPin,
        };
      }
      return {
        status: 'PROTECTED_WORKSPACE',
        source: 'workspace',
        isLockActive: true,
        isVerificationBlocked: false,
        blockReason: null,
        effectiveConfig: {
          enabled: true,
          salt: wsLock.salt.trim(),
          hash: wsLock.hash.trim().toLowerCase(),
          updatedAt: wsLock.updatedAt,
          updatedByUid: wsLock.updatedByUid,
        },
        hasLocalLegacyPin,
      };
    }

    return {
      status: 'DISABLED_WORKSPACE',
      source: 'workspace',
      isLockActive: false,
      isVerificationBlocked: false,
      blockReason: null,
      effectiveConfig: {
        enabled: false,
        salt: '',
        hash: '',
        updatedAt: wsLock.updatedAt,
        updatedByUid: wsLock.updatedByUid,
      },
      hasLocalLegacyPin,
    };
  }

  // Hydrated workspace has no shared managementLock field yet -> preserve device-local PIN if present
  if (localCfg.enabled) {
    if (!isValidEnabledLockConfig(localCfg)) {
      return {
        status: 'FAIL_CLOSED_CORRUPT',
        source: 'local_legacy',
        isLockActive: true,
        isVerificationBlocked: true,
        blockReason:
          'Local Management PIN configuration on this device is incomplete or corrupted. Management Mode remains locked.',
        effectiveConfig: { enabled: true, salt: '', hash: '' },
        hasLocalLegacyPin: false,
      };
    }

    return {
      status: 'PROTECTED_LOCAL_LEGACY',
      source: 'local_legacy',
      isLockActive: true,
      isVerificationBlocked: false,
      blockReason: null,
      effectiveConfig: {
        enabled: true,
        salt: localCfg.salt.trim(),
        hash: localCfg.hash.trim().toLowerCase(),
        updatedAt: localCfg.updatedAt,
        updatedByUid: localCfg.updatedByUid,
      },
      hasLocalLegacyPin: true,
    };
  }

  return {
    status: 'DISABLED',
    source: 'unconfigured',
    isLockActive: false,
    isVerificationBlocked: false,
    blockReason: null,
    effectiveConfig: { enabled: false, salt: '', hash: '' },
    hasLocalLegacyPin: false,
  };
}

/**
 * Sanitizes restored `SS_APP_MODE` on startup/reload/reopen so a persisted
 * `'management'` or `'full'` value NEVER bypasses the PIN lock on a shared tablet.
 */
export function sanitizeRestoredAppMode(
  rawSavedMode: string | null | undefined,
  options: {
    isProductionFloorEnabled: boolean;
    isLockActive: boolean;
  }
): 'main' | 'production' | 'management' {
  if (!options.isProductionFloorEnabled) {
    return 'management';
  }

  if (rawSavedMode === 'production') {
    return 'production';
  }

  if (rawSavedMode === 'management' || rawSavedMode === 'full') {
    // Never restore directly into unlocked Management Mode when a PIN guard is active
    return options.isLockActive ? 'main' : 'management';
  }

  return 'main';
}

/**
 * Builds the ephemeral session unlock key bound to both workspace ID and active PIN hash.
 * Any workspace switch or remote PIN rotation automatically invalidates prior unlock state.
 */
export function buildManagementUnlockSessionKey(
  workspaceId: string,
  resolution: EffectiveManagementLockResolution
): string | null {
  const cleanWsId = (workspaceId || '').trim();
  if (!cleanWsId) return null;
  if (!resolution.isLockActive || resolution.isVerificationBlocked) return null;
  if (!isValidEnabledLockConfig(resolution.effectiveConfig)) return null;
  return `${cleanWsId}:${resolution.effectiveConfig.hash}`;
}

export interface PendingManagementNavigationTarget {
  tab?: TabType;
  recipeIdForCalc?: string;
  openNewRecipeModal?: boolean;
}

/**
 * Deterministic controller modeling the centralized Management Mode guard across
 * all entry points, exit transitions, reloads, workspace switches, and sign-outs.
 */
export class ManagementSessionGateController {
  private appMode: 'main' | 'production' | 'management';
  private activeTab: TabType;
  private unlockedSessionKey: string | null = null;
  private pinModalOpen = false;
  private pendingTarget: PendingManagementNavigationTarget | null = null;
  private selectedRecipeForCalcId: string | undefined = undefined;
  private openRecipeModalDirectly = false;

  public constructor(params: {
    workspaceId: string;
    isProductionFloorEnabled: boolean;
    resolution: EffectiveManagementLockResolution;
    storage?: StorageReaderWriter | null;
    initialTab?: TabType;
  }) {
    const rawSaved = params.storage?.getItem(APP_MODE_STORAGE_KEY) ?? null;
    this.appMode = sanitizeRestoredAppMode(rawSaved, {
      isProductionFloorEnabled: params.isProductionFloorEnabled,
      isLockActive: params.resolution.isLockActive,
    });
    this.activeTab = params.initialTab || 'dashboard';

    if (
      params.isProductionFloorEnabled &&
      params.resolution.isLockActive &&
      (rawSaved === 'management' || rawSaved === 'full')
    ) {
      params.storage?.setItem?.(APP_MODE_STORAGE_KEY, 'main');
    }

    if (!params.isProductionFloorEnabled && params.resolution.isLockActive) {
      this.pinModalOpen = true;
    }
  }

  public isManagementUnlocked(
    workspaceId: string,
    resolution: EffectiveManagementLockResolution
  ): boolean {
    if (!resolution.isLockActive) return true;
    if (resolution.isVerificationBlocked) return false;
    const expectedKey = buildManagementUnlockSessionKey(workspaceId, resolution);
    return Boolean(expectedKey && this.unlockedSessionKey === expectedKey);
  }

  public canRenderManagementWorkspace(
    workspaceId: string,
    isProductionFloorEnabled: boolean,
    resolution: EffectiveManagementLockResolution
  ): boolean {
    const wantsManagement = this.appMode === 'management' || !isProductionFloorEnabled;
    if (!wantsManagement) return false;
    return this.isManagementUnlocked(workspaceId, resolution);
  }

  public getState(
    workspaceId: string,
    isProductionFloorEnabled: boolean,
    resolution: EffectiveManagementLockResolution
  ) {
    const unlocked = this.isManagementUnlocked(workspaceId, resolution);
    const wantsManagement = this.appMode === 'management' || !isProductionFloorEnabled;
    return {
      appMode: this.appMode,
      activeTab: this.activeTab,
      isManagementUnlocked: unlocked,
      requiresPinChallengeScreen: wantsManagement && resolution.isLockActive && !unlocked,
      pinModalOpen: this.pinModalOpen,
      pendingTarget: this.pendingTarget,
      selectedRecipeForCalcId: this.selectedRecipeForCalcId,
      openRecipeModalDirectly: this.openRecipeModalDirectly,
      canRenderManagementWorkspace: this.canRenderManagementWorkspace(
        workspaceId,
        isProductionFloorEnabled,
        resolution
      ),
    };
  }

  public requestManagementAccess(
    workspaceId: string,
    resolution: EffectiveManagementLockResolution,
    target?: PendingManagementNavigationTarget,
    storage?: StorageReaderWriter | null
  ): { grantedImmediately: boolean; openedPinModal: boolean } {
    if (this.isManagementUnlocked(workspaceId, resolution)) {
      this.applyTarget(target);
      this.appMode = 'management';
      if (!resolution.isLockActive) {
        storage?.setItem?.(APP_MODE_STORAGE_KEY, 'management');
      }
      return { grantedImmediately: true, openedPinModal: false };
    }

    this.pendingTarget = target || {};
    this.pinModalOpen = true;
    return { grantedImmediately: false, openedPinModal: true };
  }

  public async submitPin(
    pin: string,
    workspaceId: string,
    resolution: EffectiveManagementLockResolution
  ): Promise<boolean> {
    if (resolution.isVerificationBlocked) {
      return false;
    }
    const ok = await verifyManagementPin(pin, resolution.effectiveConfig);
    if (!ok) {
      return false;
    }
    const sessionKey = buildManagementUnlockSessionKey(workspaceId, resolution);
    if (!sessionKey) {
      return false;
    }
    this.unlockedSessionKey = sessionKey;
    this.pinModalOpen = false;
    this.applyTarget(this.pendingTarget || undefined);
    this.pendingTarget = null;
    this.appMode = 'management';
    return true;
  }

  public exitToProductionFloor(
    isProductionFloorEnabled: boolean,
    workspaceId: string,
    resolution: EffectiveManagementLockResolution,
    storage?: StorageReaderWriter | null
  ): void {
    this.relock();
    if (!isProductionFloorEnabled) {
      this.appMode = 'management';
      if (resolution.isLockActive) {
        this.pinModalOpen = true;
      }
      return;
    }
    this.appMode = 'production';
    storage?.setItem?.(APP_MODE_STORAGE_KEY, 'production');
  }

  public exitToMainLauncher(
    isProductionFloorEnabled: boolean,
    workspaceId: string,
    resolution: EffectiveManagementLockResolution,
    storage?: StorageReaderWriter | null
  ): void {
    this.relock();
    if (!isProductionFloorEnabled) {
      this.appMode = 'management';
      if (resolution.isLockActive) {
        this.pinModalOpen = true;
      }
      return;
    }
    this.appMode = 'main';
    storage?.setItem?.(APP_MODE_STORAGE_KEY, 'main');
  }

  public handleWorkspaceSwitchOrSignOut(
    isProductionFloorEnabled: boolean,
    storage?: StorageReaderWriter | null
  ): void {
    this.relock();
    this.appMode = isProductionFloorEnabled ? 'main' : 'management';
    const saved = storage?.getItem(APP_MODE_STORAGE_KEY);
    if (saved === 'management' || saved === 'full') {
      storage?.removeItem?.(APP_MODE_STORAGE_KEY);
    }
  }

  public relock(): void {
    this.unlockedSessionKey = null;
    this.pinModalOpen = false;
    this.pendingTarget = null;
  }

  private applyTarget(target?: PendingManagementNavigationTarget): void {
    if (!target) return;
    if (target.recipeIdForCalc !== undefined) {
      this.selectedRecipeForCalcId = target.recipeIdForCalc;
    }
    if (target.openNewRecipeModal !== undefined) {
      this.openRecipeModalDirectly = target.openNewRecipeModal;
    }
    if (target.tab) {
      this.activeTab = target.tab;
    }
  }
}

// ============================================================================
// MANAGEMENT MODE AUTO-LOCK CONTROLLER (PHASE A TABLET SAFETY)
// ============================================================================

/** Re-lock Management Mode after 15 minutes of inactivity while unlocked. */
export const MANAGEMENT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

/** Re-lock Management Mode when browser/tab is hidden or screen is off for >60 seconds. */
export const MANAGEMENT_HIDDEN_TIMEOUT_MS = 60 * 1000;

export type ManagementAutoLockReason = 'inactivity_timeout' | 'hidden_timeout';

export interface ManagementAutoLockControllerOptions {
  inactivityTimeoutMs?: number;
  hiddenTimeoutMs?: number;
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  onAutoLock: (reason: ManagementAutoLockReason) => void;
}

/**
 * Deterministic controller managing Management Mode session auto-lock:
 * - Locks after 15 minutes of user inactivity while Management Mode is unlocked.
 * - Locks after the tab/app is hidden or tablet screen is off for strictly > 60 seconds,
 *   evaluating wall-clock elapsed time on visibility resume so Android Doze/suspended
 *   timers cannot bypass the lock.
 * - Never touches Firebase Auth session, localStorage backups, or mounted form DOM.
 */
export class ManagementAutoLockController {
  private readonly inactivityTimeoutMs: number;
  private readonly hiddenTimeoutMs: number;
  private readonly now: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void;
  private readonly onAutoLock: (reason: ManagementAutoLockReason) => void;

  private active = false;
  private isHidden = false;
  private lastActivityAtMs = 0;
  private hiddenSinceMs: number | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ManagementAutoLockControllerOptions) {
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? MANAGEMENT_INACTIVITY_TIMEOUT_MS;
    this.hiddenTimeoutMs = options.hiddenTimeoutMs ?? MANAGEMENT_HIDDEN_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));
    this.onAutoLock = options.onAutoLock;
  }

  public start(initialHidden: boolean = false): void {
    this.stop();
    this.active = true;
    const currentNow = this.now();
    this.lastActivityAtMs = currentNow;
    this.isHidden = initialHidden;
    this.hiddenSinceMs = initialHidden ? currentNow : null;

    this.scheduleInactivityTimer(this.inactivityTimeoutMs);
    if (initialHidden) {
      this.scheduleHiddenTimer(this.hiddenTimeoutMs + 1);
    }
  }

  public recordActivity(): void {
    if (!this.active || this.isHidden) return;
    this.lastActivityAtMs = this.now();
    this.scheduleInactivityTimer(this.inactivityTimeoutMs);
  }

  public handleVisibilityChange(hidden: boolean): void {
    if (!this.active) return;
    const currentNow = this.now();

    if (hidden) {
      if (!this.isHidden) {
        this.isHidden = true;
        this.hiddenSinceMs = currentNow;
        this.scheduleHiddenTimer(this.hiddenTimeoutMs + 1);
      }
      return;
    }

    // Returning to visible state (tab foregrounded / tablet screen woken)
    const wasHiddenSince = this.hiddenSinceMs;
    this.isHidden = false;
    this.hiddenSinceMs = null;
    this.clearHiddenTimer();

    if (wasHiddenSince !== null && currentNow - wasHiddenSince > this.hiddenTimeoutMs) {
      this.triggerLock('hidden_timeout');
      return;
    }

    const inactiveElapsed = currentNow - this.lastActivityAtMs;
    if (inactiveElapsed >= this.inactivityTimeoutMs) {
      this.triggerLock('inactivity_timeout');
      return;
    }

    this.scheduleInactivityTimer(this.inactivityTimeoutMs - inactiveElapsed);
  }

  public isRunning(): boolean {
    return this.active;
  }

  public stop(): void {
    this.active = false;
    this.isHidden = false;
    this.hiddenSinceMs = null;
    this.clearInactivityTimer();
    this.clearHiddenTimer();
  }

  private triggerLock(reason: ManagementAutoLockReason): void {
    if (!this.active) return;
    this.stop();
    this.onAutoLock(reason);
  }

  private scheduleInactivityTimer(delayMs: number): void {
    this.clearInactivityTimer();
    const safeDelay = Math.max(1, delayMs);
    this.inactivityTimer = this.setTimer(() => {
      if (!this.active) return;
      const elapsed = this.now() - this.lastActivityAtMs;
      if (elapsed >= this.inactivityTimeoutMs) {
        this.triggerLock('inactivity_timeout');
      } else {
        this.scheduleInactivityTimer(this.inactivityTimeoutMs - elapsed);
      }
    }, safeDelay);
  }

  private scheduleHiddenTimer(delayMs: number): void {
    this.clearHiddenTimer();
    const safeDelay = Math.max(1, delayMs);
    this.hiddenTimer = this.setTimer(() => {
      if (!this.active || !this.isHidden || this.hiddenSinceMs === null) return;
      const elapsed = this.now() - this.hiddenSinceMs;
      if (elapsed > this.hiddenTimeoutMs) {
        this.triggerLock('hidden_timeout');
      } else {
        this.scheduleHiddenTimer(this.hiddenTimeoutMs + 1 - elapsed);
      }
    }, safeDelay);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer !== null) {
      this.clearTimer(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private clearHiddenTimer(): void {
    if (this.hiddenTimer !== null) {
      this.clearTimer(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  }
}

