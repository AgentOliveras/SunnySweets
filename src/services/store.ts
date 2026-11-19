import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  getDoc,
  getDocFromServer,
  runTransaction,
  Unsubscribe,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionHistoryEntry,
  UserSettings,
  MasterIngredient,
  Workspace,
  AccessRole,
  AccessGroup,
  WeightUnit,
  WorkspaceBranding,
  PresetPaletteId,
  WorkspaceMemberDoc,
  WorkspaceFeatures,
  CriticalProductionNote,
} from '../types';
import {
  resolveWorkspaceFeatures,
  hasWorkspaceFeature,
} from './workspaceFeatures';
import {
  db,
  auth,
  handleFirestoreError,
  OperationType,
  sanitizeForFirestore,
  signInWithGoogle,
  deleteWorkspaceLogoFromStorage,
} from './firebase';
import { INITIAL_SETTINGS } from './sampleData';
import { normalizePresetCategory } from '../utils/calculator';
import {
  ProductionOptionOrderMigrationInspection,
  canonicalizeProductionOptionOrder,
  inspectProductionOptionOrderMigration,
} from '../utils/productionOptionOrdering';
import {
  resolveWorkspaceCategoryPresetMap,
  inspectCategoryMappingMigration,
  sanitizeCategoryPresetMap,
  assertCanModifyWorkspaceCategoryMap,
  CategoryMappingMigrationInspection,
} from '../utils/categoryPresetMapping';
import {
  extractCanonicalCriticalNotesFromPresets,
  getCanonicalNotesForPreset,
  getCanonicalNotesForPresetAndRecipe,
  getCanonicalNotesForRecipe,
  CriticalNoteConflictError,
  PresetCreationConflictError,
  CryptoProviderLike,
  generateCryptographicallySecureUuidV4,
  generateCollisionResistantPresetId,
  FirestoreHydrationState,
  SafetyConnectionStatus,
  SafetyOperationalGateState,
  SafetySyncStatusLabel,
  resolveSafetyHydrationGateState,
  resolveSafetyOperationalGateState,
  resolveSafetySyncStatusLabel,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
} from '../utils/productionNotes';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  StorageLike,
  OwnerReconciliationAction,
  CriticalNotesReconciliationReport,
  captureNonDestructiveCriticalNotesBackup,
  inspectCriticalNotesReconciliation,
  recordVerifiedReconciliationDecision,
  assertOwnerCanReconcileCriticalNotes,
} from '../utils/criticalNotesReconciliation';
import {
  getDefaultWorkspaceBranding,
  sanitizeDisplayName,
  getPaletteById,
  applyThemeTokensToDOM,
  resetThemeTokensOnDOM,
  DEFAULT_PALETTE_ID,
  DEFAULT_DISPLAY_NAME,
} from '../utils/branding';
import { formatWorkspaceBootstrapError } from '../utils/authDiagnostics';
import {
  APP_MODE_STORAGE_KEY,
  EffectiveManagementLockResolution,
  ManagementLockConfig,
  assertOwnerCanConfigureManagementLock,
  assertValidLockConfigForPersistence,
  isValidEnabledLockConfig,
  loadManagementLockConfig,
  resolveEffectiveManagementLock,
  saveManagementLockConfig,
  verifyManagementPin,
} from '../utils/managementLock';
import { EntitlementService } from './entitlement';
import { WorkspaceProvisioningService } from './workspaceProvisioning';
import {
  WorkspaceBilling,
  AppAccessState,
  EntitlementEvaluation,
  PlanId,
  SubscriptionStatus,
  EntitlementStatus as BillingEntitlementStatus,
  BillingSource,
  canManageTeam,
  supportsBranding,
  computeSeatUsage,
  countActiveSeats,
  checkOwnerMembershipIntegrity,
  OwnerIntegrityResult,
} from '../types/billing';

export interface EntitlementStatus {
  hasValidEntitlement: boolean;
  plan: 'internal_phase0' | 'trial' | 'active_subscription' | 'expired';
  expiresAt: string | null;
}
import { standardizeIngredientsToUnit } from '../utils/units';
import {
  linkIngredientInRecipe,
  unlinkIngredientInRecipe,
  applyBulkGroupLink,
  calculateLinkingStats,
  getMasterIngredientReferences,
  LinkingStats,
} from './masterIngredientLinking';

const STORAGE_KEYS = {
  RECIPES: 'recipe_calc_recipes',
  PRESETS: 'recipe_calc_presets',
  MIXERS: 'recipe_calc_mixers',
  HISTORY: 'recipe_calc_history',
  SETTINGS: 'recipe_calc_settings',
  MASTER_INGREDIENTS: 'recipe_calc_master_ingredients',
  ACTIVE_CHECKLIST: 'recipe_calc_active_checklist',
  WORKSPACES: 'recipe_calc_workspaces',
  LAST_SYNCED: 'recipe_calc_last_synced',
  CRITICAL_NOTES: 'recipe_calc_critical_notes',
  CRITICAL_NOTES_BACKUP: DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  DISMISSED_LEGACY_PROD_ORDER: 'recipe_calc_dismissed_legacy_prod_order',
};

export interface PresetCloudPersistenceAdapter {
  createPreset?: (preset: ProductionPreset) => Promise<ProductionPreset>;
  transactPreset: (
    presetId: string,
    mutator: (remotePreset: ProductionPreset | null) => ProductionPreset
  ) => Promise<ProductionPreset>;
  deletePreset?: (presetId: string) => Promise<void>;
}

export interface ReconciliationExecutionResult {
  promotedCount: number;
  keptCloudCount: number;
  leftUnchangedCount: number;
  manualReviewDeferredCount: number;
  promotedNoteIds: string[];
}

export interface SyncStatusInfo {
  status: 'synced' | 'syncing' | 'offline' | 'error';
  lastSynced: Date | null;
  message: string;
  itemCount: number;
}

// Safe localStorage wrapper for environments where window/localStorage is undefined (e.g., node test runners, SSR)
const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch (_) {}
    return null;
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch (_) {}
  },
  removeItem: (key: string): void => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch (_) {}
  },
};

// Helper for local storage read/write
function getLocal<T>(key: string, fallback: T): T {
  try {
    const raw = safeStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${key} from localStorage:`, err);
  }
  return fallback;
}

function setLocal<T>(key: string, data: T): void {
  try {
    safeStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Error saving ${key} to localStorage:`, err);
  }
}

export class StoreManager {
  private static instance: StoreManager;

  private recipes: Recipe[] = [];
  private presets: ProductionPreset[] = [];
  private mixers: Mixer[] = [];
  private history: ProductionHistoryEntry[] = [];
  private settings: UserSettings = INITIAL_SETTINGS;
  private masterIngredients: MasterIngredient[] = [];
  private criticalProductionNotes: CriticalProductionNote[] = [];
  private workspaces: Workspace[] = [];
  private workspaceMembers: WorkspaceMemberDoc[] = [];
  private activeWorkspaceId: string = 'ws-main';
  private billing: WorkspaceBilling | null = null;
  private currentUserId: string | null = null;
  private validatedUid: string | null = null;
  private validatedUserRole: AccessRole | null = null;
  private initialized = false;
  private authLoading = true;
  private initializationError: string | null = null;
  private workspaceLoading = false;
  private billingLoading = false;
  private presetsSyncError: string | null = null;
  private recipesSyncError: string | null = null;
  private recipesHydrationState: FirestoreHydrationState = 'LOADING';
  private presetsHydrationState: FirestoreHydrationState = 'LOADING';
  private workspaceDocHydrationState: FirestoreHydrationState = 'LOADING';
  private workspaceDocSyncError: string | null = null;
  private capturedLegacyWorkspaceOrderByWsId: Record<string, string[]> = {};
  private recipesServerConfirmedInWorkspace = false;
  private presetsServerConfirmedInWorkspace = false;
  private recipesConnectionVerified = false;
  private presetsConnectionVerified = false;
  private isSafetyReconnecting = false;
  private safetyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private safetyRetryAttempt = 0;
  private listenerGeneration = 0;
  private customPresetCloudAdapter: PresetCloudPersistenceAdapter | null = null;
  private customHistorySaveAdapter: ((entry: ProductionHistoryEntry) => Promise<void>) | null = null;
  private customStorageForTesting: StorageLike | null = null;
  private safetyRetryDelayOverrideMsForTesting: number[] | null = null;
  private customListenerRestartHookForTesting:
    | ((generation: number, workspaceId: string) => void)
    | null = null;
  private customAccessValidatorForTesting:
    | ((uid: string, workspaceId: string) => Promise<boolean> | boolean)
    | null = null;
  private customMembershipLookupForTesting:
    | ((uid: string, workspaceId: string) => Promise<{ exists: boolean; role?: AccessRole; active?: boolean }>)
    | null = null;
  private customWorkspaceDocLoaderForTesting:
    | ((workspaceId: string) => Promise<Workspace | null>)
    | null = null;
  private customWorkspaceLockSaveAdapterForTesting:
    | ((workspaceId: string, policy: ManagementLockConfig) => Promise<void>)
    | null = null;
  private customWorkspaceSettingsSaveAdapterForTesting:
    | ((workspaceId: string, updates: Record<string, unknown>) => Promise<void>)
    | null = null;
  private customRecipeDeleteAdapterForTesting:
    | ((recipeId: string) => Promise<void>)
    | null = null;
  private membershipSecurityEpoch = 0;
  private lastMembershipSecurityEvent: {
    epoch: number;
    reason: 'role_downgrade' | 'deactivated' | null;
    previousRole: AccessRole | null;
    nextRole: AccessRole | null;
  } = {
    epoch: 0,
    reason: null,
    previousRole: null,
    nextRole: null,
  };
  private presetCryptoOverrideForTesting: CryptoProviderLike | null | undefined = undefined;
  private testSessionOverride: {
    uid: string;
    role: AccessRole;
    workspaceId: string;
  } | null = null;
  private testAuthUidOnlyOverride: string | null = null;
  private authUnsubscribe: Unsubscribe | null = null;
  private authDiagnosticTimer: ReturnType<typeof setTimeout> | null = null;
  private activeAuthObserverCount = 0;
  private customAuthStateSubscriberForTesting:
    | ((
        onNext: (user: { uid: string; email?: string | null } | null) => void | Promise<void>,
        onError?: (error: unknown) => void
      ) => Unsubscribe)
    | null = null;
  private unsubs: Array<() => void> = [];
  private syncStatus: SyncStatusInfo = {
    status: 'offline',
    lastSynced: null,
    message: 'Local Mode',
    itemCount: 0,
  };

  private listeners: Set<() => void> = new Set();

  private constructor() {
    this.loadFromLocalStorage();
    const storedLastSync = safeStorage.getItem(STORAGE_KEYS.LAST_SYNCED);
    if (storedLastSync) {
      this.syncStatus.lastSynced = new Date(storedLastSync);
    }
  }

  public static getInstance(): StoreManager {
    if (!StoreManager.instance) {
      StoreManager.instance = new StoreManager();
    }
    return StoreManager.instance;
  }

  private getEffectiveStorage(): StorageLike {
    return this.customStorageForTesting || safeStorage;
  }

  private isDevOrTestEnvironment(): boolean {
    return Boolean(
      (typeof process !== 'undefined' &&
        (process.env?.NODE_ENV === 'test' || Boolean(process.env?.NODE_TEST_CONTEXT))) ||
        (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV)
    );
  }

  private static readonly SAFETY_RETRY_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000];

  private cancelSafetySyncRetry(resetAttempt = true): void {
    if (this.safetyRetryTimer !== null) {
      clearTimeout(this.safetyRetryTimer);
      this.safetyRetryTimer = null;
    }
    if (resetAttempt) {
      this.safetyRetryAttempt = 0;
      this.isSafetyReconnecting = false;
    }
  }

  private resetSafetyHydrationToLoading(options?: {
    reconnecting?: boolean;
    preserveServerConfirmedHistory?: boolean;
    preserveRetrySequence?: boolean;
  }): void {
    if (!options?.preserveRetrySequence) {
      this.cancelSafetySyncRetry(!options?.reconnecting);
    } else if (this.safetyRetryTimer !== null) {
      clearTimeout(this.safetyRetryTimer);
      this.safetyRetryTimer = null;
    }

    this.listenerGeneration += 1;
    this.recipesHydrationState = 'LOADING';
    this.presetsHydrationState = 'LOADING';
    this.workspaceDocHydrationState = 'LOADING';
    this.workspaceDocSyncError = null;
    this.recipesSyncError = null;
    this.presetsSyncError = null;
    this.recipesConnectionVerified = false;
    this.presetsConnectionVerified = false;
    if (!options?.preserveServerConfirmedHistory) {
      this.recipesServerConfirmedInWorkspace = false;
      this.presetsServerConfirmedInWorkspace = false;
    }
    this.isSafetyReconnecting = Boolean(options?.reconnecting);
  }

  private scheduleAutomaticSafetySyncRetry(): void {
    // Only one retry sequence may be active at any time
    if (this.safetyRetryTimer !== null) {
      return;
    }

    const uid = this.getEffectiveAuthenticatedUid();
    const wsId = (this.activeWorkspaceId || '').trim();
    if (!uid || !wsId || !this.isAuthorized()) {
      this.cancelSafetySyncRetry(true);
      return;
    }

    const delays =
      this.isDevOrTestEnvironment() && this.safetyRetryDelayOverrideMsForTesting !== null
        ? this.safetyRetryDelayOverrideMsForTesting
        : StoreManager.SAFETY_RETRY_BACKOFF_MS;

    if (this.safetyRetryAttempt >= delays.length) {
      this.isSafetyReconnecting = false;
      return;
    }

    const delayMs = Math.max(0, delays[this.safetyRetryAttempt]);
    this.safetyRetryAttempt += 1;

    this.safetyRetryTimer = setTimeout(() => {
      this.safetyRetryTimer = null;
      if (
        this.getEffectiveAuthenticatedUid() !== uid ||
        (this.activeWorkspaceId || '').trim() !== wsId ||
        !this.isAuthorized()
      ) {
        this.cancelSafetySyncRetry(true);
        this.notify();
        return;
      }
      void this.retrySafetySync({ fromAutoBackoff: true });
    }, delayMs);
  }

  private loadFromLocalStorage(): void {
    // Capture non-destructive backup of any local Critical Production Notes immediately on startup
    captureNonDestructiveCriticalNotesBackup(this.getEffectiveStorage());

    this.resetSafetyHydrationToLoading();

    // Production records remain uninitialized in memory until UID authorization resolves
    this.recipes = [];
    this.presets = [];
    this.mixers = [];
    this.history = [];
    this.masterIngredients = [];
    this.criticalProductionNotes = [];

    const storedSettings = getLocal<UserSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    this.settings = {
      ...INITIAL_SETTINGS,
      ...storedSettings,
      defaultWastePercent:
        storedSettings?.defaultWastePercent !== undefined && storedSettings?.defaultWastePercent !== 0
          ? storedSettings.defaultWastePercent
          : (storedSettings?.defaultWastePercent === 0 && safeStorage.getItem('bakery_settings_explicit_zero_waste') ? 0 : INITIAL_SETTINGS.defaultWastePercent),
    };

    const defaultWs: Workspace = {
      id: 'ws-main',
      name: 'Main Bakery Workspace',
      ownerId: '',
      ownerEmail: '',
      code: 'BAKERY-MAIN',
      members: [],
      groups: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const storedWorkspaces = getLocal<Workspace[]>(STORAGE_KEYS.WORKSPACES, [defaultWs]);
    for (const candidateWs of storedWorkspaces) {
      if (
        candidateWs &&
        candidateWs.id &&
        Array.isArray(candidateWs.productionOptionOrder) &&
        candidateWs.productionOptionOrder.length > 0
      ) {
        this.capturedLegacyWorkspaceOrderByWsId[candidateWs.id] = [
          ...candidateWs.productionOptionOrder,
        ];
      }
    }
    this.workspaces = storedWorkspaces;

    this.activeWorkspaceId = this.settings.activeWorkspaceId || this.workspaces[0]?.id || 'ws-main';
  }

  private loadProductionRecordsFromLocalStorage(): void {
    if (!this.isAuthorized()) return;

    // Ensure durable local backup is captured before hydrating local workspace cache.
    // Do NOT auto-migrate local notes to Firestore or auto-seed synthetic local notes.
    captureNonDestructiveCriticalNotesBackup(this.getEffectiveStorage());

    const activeWsId = this.activeWorkspaceId || 'ws-main';
    this.recipes = getLocal<Recipe[]>(STORAGE_KEYS.RECIPES, []).filter(
      (r) => !r.workspaceId || r.workspaceId === activeWsId
    );
    this.presets = getLocal<ProductionPreset[]>(STORAGE_KEYS.PRESETS, [])
      .filter((p) => !p.workspaceId || p.workspaceId === activeWsId)
      .map((p) => {
        const normCat = normalizePresetCategory(p);
        return p.category === normCat ? p : { ...p, category: normCat };
      });
    this.mixers = getLocal<Mixer[]>(STORAGE_KEYS.MIXERS, []).filter(
      (m) => !m.workspaceId || m.workspaceId === activeWsId
    );
    this.history = getLocal<ProductionHistoryEntry[]>(STORAGE_KEYS.HISTORY, []).filter(
      (h) => !h.workspaceId || h.workspaceId === activeWsId
    );
    this.masterIngredients = getLocal<MasterIngredient[]>(STORAGE_KEYS.MASTER_INGREDIENTS, []).filter(
      (i) => !i.workspaceId || i.workspaceId === activeWsId
    );
    this.criticalProductionNotes = [];
  }

  private clearProductionRecordsFromMemory(options?: {
    preserveWorkspacesList?: boolean;
  }): void {
    const activeStorage = this.getEffectiveStorage();
    // Capture a durable non-destructive backup of any local Critical Production Notes
    // BEFORE clearing in-memory session state. Never delete STORAGE_KEYS.CRITICAL_NOTES
    // or STORAGE_KEYS.CRITICAL_NOTES_BACKUP during sign-out or workspace switching.
    captureNonDestructiveCriticalNotesBackup(activeStorage);

    for (const candidateWs of this.workspaces) {
      if (
        candidateWs &&
        candidateWs.id &&
        Array.isArray(candidateWs.productionOptionOrder) &&
        candidateWs.productionOptionOrder.length > 0 &&
        !this.capturedLegacyWorkspaceOrderByWsId[candidateWs.id]
      ) {
        this.capturedLegacyWorkspaceOrderByWsId[candidateWs.id] = [
          ...candidateWs.productionOptionOrder,
        ];
      }
    }

    this.recipes = [];
    this.presets = [];
    this.mixers = [];
    this.history = [];
    this.masterIngredients = [];
    this.criticalProductionNotes = [];
    if (!options?.preserveWorkspacesList) {
      this.workspaces = [];
    }
    this.workspaceMembers = [];
    this.billing = null;
    this.workspaceDocHydrationState = 'LOADING';
    this.workspaceDocSyncError = null;
    this.resetSafetyHydrationToLoading();

    // Clear ephemeral production caches from storage on unauthorized, sign-out, or workspace switch.
    // CRITICAL SAFETY INVARIANT: Do NOT remove STORAGE_KEYS.CRITICAL_NOTES, STORAGE_KEYS.CRITICAL_NOTES_BACKUP,
    // Management PIN storage, or legacy per-user settings candidates.
    const removeKey = (key: string) => {
      if (activeStorage.removeItem) {
        activeStorage.removeItem(key);
      } else {
        safeStorage.removeItem(key);
      }
    };
    removeKey(STORAGE_KEYS.RECIPES);
    removeKey(STORAGE_KEYS.PRESETS);
    removeKey(STORAGE_KEYS.MIXERS);
    removeKey(STORAGE_KEYS.HISTORY);
    removeKey(STORAGE_KEYS.MASTER_INGREDIENTS);
    removeKey(STORAGE_KEYS.ACTIVE_CHECKLIST);
    if (!options?.preserveWorkspacesList) {
      removeKey(STORAGE_KEYS.WORKSPACES);
    }

    // Ensure persisted Management Mode flag never survives sign-out or workspace switch
    const savedAppMode = activeStorage.getItem(APP_MODE_STORAGE_KEY);
    if (savedAppMode === 'management' || savedAppMode === 'full') {
      removeKey(APP_MODE_STORAGE_KEY);
    }

    // Reset DOM theme tokens to generic clean fallback on logout / unauthorized
    resetThemeTokensOnDOM();
  }

  private async testFirestoreConnection(): Promise<void> {
    try {
      await getDocFromServer(doc(db, 'settings', 'test-connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.warn('Firestore is currently offline or unreachable.');
      }
    }
  }

  private detachAuthObserver(): void {
    if (this.authDiagnosticTimer !== null) {
      clearTimeout(this.authDiagnosticTimer);
      this.authDiagnosticTimer = null;
    }
    if (this.authUnsubscribe !== null) {
      const unsub = this.authUnsubscribe;
      this.authUnsubscribe = null;
      this.activeAuthObserverCount = Math.max(0, this.activeAuthObserverCount - 1);
      try {
        unsub();
      } catch (err) {
        console.warn('[Store] Error unsubscribing previous auth observer:', err);
      }
    }
    this.initialized = false;
  }

  public initFirebaseSync(): void {
    if (this.initialized && this.authUnsubscribe !== null) return;

    this.detachAuthObserver();
    this.initialized = true;

    this.syncStatus = {
      status: 'offline',
      lastSynced: this.syncStatus.lastSynced,
      message: 'Sign In with Google to enable cloud sync',
      itemCount: this.getTotalItemCount(),
    };
    this.notify();

    // Section 7: Bounded diagnostic observer warning instead of a fixed 1500ms force-signed-out timeout
    this.authDiagnosticTimer = setTimeout(() => {
      this.authDiagnosticTimer = null;
      if (this.authLoading && !this.getEffectiveAuthenticatedUid()) {
        console.warn('[Store] Auth determination pending from Firebase observer (>5s). Explicit loading screen active.');
      }
    }, 5000);

    const subscribeAuth =
      this.isDevOrTestEnvironment() && this.customAuthStateSubscriberForTesting
        ? this.customAuthStateSubscriberForTesting
        : (
            onNext: (user: { uid: string; email?: string | null } | null) => void | Promise<void>,
            onError?: (err: unknown) => void
          ) => onAuthStateChanged(auth, onNext, onError);

    let observerActive = true;
    this.activeAuthObserverCount += 1;

    // Listen to Auth state changes - Google Sign-In is the sole authentication method
    const rawUnsub = subscribeAuth(
      async (user) => {
        if (!observerActive) return;
        if (this.authDiagnosticTimer !== null) {
          clearTimeout(this.authDiagnosticTimer);
          this.authDiagnosticTimer = null;
        }
        this.initializationError = null;
        try {
          if (this.isDevOrTestEnvironment() && this.customAuthStateSubscriberForTesting) {
            this.testAuthUidOnlyOverride = user?.uid || null;
          }
          if ((user?.uid || null) !== this.currentUserId) {
            this.resetSafetyHydrationToLoading();
          }
          if (user && user.uid) {
            await this.resolveAuthenticatedSession(user.uid);
          } else {
            // Disconnected / logged out: tear down listeners cleanly & clear records from memory
            this.cancelSafetySyncRetry(true);
            this.unsubs.forEach((unsub) => unsub());
            this.unsubs = [];
            this.currentUserId = null;
            this.validatedUid = null;
            this.validatedUserRole = null;
            this.activeWorkspaceId = '';
            this.clearProductionRecordsFromMemory();
            const activeStorage = this.getEffectiveStorage();
            if (activeStorage.removeItem) {
              activeStorage.removeItem(APP_MODE_STORAGE_KEY);
            } else {
              safeStorage.removeItem(APP_MODE_STORAGE_KEY);
            }
            this.authLoading = false;
            this.workspaceLoading = false;
            this.billingLoading = false;
            this.syncStatus = {
              status: 'offline',
              lastSynced: this.syncStatus.lastSynced,
              message: 'Sign in with Google to enable Cloud Sync',
              itemCount: 0,
            };
            this.notify();
          }
        } catch (fatalErr: any) {
          console.error('[Store] Fatal error in onAuthStateChanged workflow:', fatalErr);
          this.initializationError = fatalErr?.message || 'Authentication lifecycle initialization failed.';
          this.recipesHydrationState = 'ERROR';
          this.presetsHydrationState = 'ERROR';
          this.authLoading = false;
          this.workspaceLoading = false;
          this.billingLoading = false;
          this.notify();
        }
      },
      (error: any) => {
        if (!observerActive) return;
        if (this.authDiagnosticTimer !== null) {
          clearTimeout(this.authDiagnosticTimer);
          this.authDiagnosticTimer = null;
        }
        console.warn('[Store] onAuthStateChanged observer error:', error);
        this.initializationError = error?.message || 'Firebase Auth observer reported an infrastructure error.';
        this.recipesHydrationState = 'ERROR';
        this.presetsHydrationState = 'ERROR';
        this.authLoading = false;
        this.workspaceLoading = false;
        this.billingLoading = false;
        this.notify();
      }
    );

    this.authUnsubscribe = () => {
      if (!observerActive) return;
      observerActive = false;
      rawUnsub();
    };
  }

  private handleRecipesSnapshot(
    rawDocs: Array<{ id: string; data: Recipe }>,
    metadata: { fromCache: boolean; hasPendingWrites?: boolean },
    hasDocChanges: boolean,
    generation: number,
    workspaceId: string
  ): void {
    const activeWs = this.activeWorkspaceId || 'ws-main';
    if (generation !== this.listenerGeneration || workspaceId !== activeWs) {
      return;
    }

    const remoteRecipes: Recipe[] = rawDocs
      .map((d) => ({ ...d.data, id: d.data.id || d.id }))
      .filter((r) => !r.workspaceId || r.workspaceId === workspaceId);

    if (metadata.fromCache) {
      // Before first server-confirmed snapshot in this workspace: cached data NEVER authorizes mixing
      if (!this.recipesServerConfirmedInWorkspace) {
        const prevState = this.recipesHydrationState;
        const prevVerified = this.recipesConnectionVerified;
        this.recipesHydrationState = 'LOADING';
        this.recipesConnectionVerified = false;
        if (hasDocChanges && remoteRecipes.length > 0) {
          this.recipes = remoteRecipes;
        }
        if (prevState !== 'LOADING' || prevVerified || (hasDocChanges && remoteRecipes.length > 0)) {
          this.notify();
        }
        return;
      }

      // After initial READY: Wi-Fi drop / cache-only event moves operational state to CONNECTION_UNVERIFIED
      // without discarding the already-loaded recipes or resetting hydration back to initial LOADING.
      const prevVerified = this.recipesConnectionVerified;
      this.recipesConnectionVerified = false;
      if (hasDocChanges && remoteRecipes.length > 0) {
        this.recipes = remoteRecipes;
      }
      this.syncStatus = {
        status: 'offline',
        lastSynced: this.syncStatus.lastSynced,
        message: SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
        itemCount: this.getTotalItemCount(),
      };
      if (prevVerified || (hasDocChanges && remoteRecipes.length > 0)) {
        this.notify();
      } else {
        this.notify();
      }
      return;
    }

    const prevState = this.recipesHydrationState;
    const prevErr = this.recipesSyncError;
    const prevVerified = this.recipesConnectionVerified;
    this.recipesSyncError = null;
    this.recipesHydrationState = 'READY';
    this.recipesServerConfirmedInWorkspace = true;
    this.recipesConnectionVerified = true;
    this.recipes = remoteRecipes;
    setLocal(STORAGE_KEYS.RECIPES, remoteRecipes);

    if (this.presetsHydrationState === 'READY' && this.presetsConnectionVerified) {
      this.cancelSafetySyncRetry(true);
    }

    if (hasDocChanges || prevState !== 'READY' || prevErr !== null || !prevVerified) {
      this.updateSyncSuccess();
    }
  }

  private handleRecipesListenerError(
    error: unknown,
    generation: number,
    workspaceId: string
  ): void {
    const activeWs = this.activeWorkspaceId || 'ws-main';
    if (generation !== this.listenerGeneration || workspaceId !== activeWs) {
      return;
    }
    this.recipesHydrationState = 'ERROR';
    this.recipesConnectionVerified = false;
    this.recipesSyncError =
      error instanceof Error
        ? error.message
        : 'Unable to load recipes and recipe-wide safety notes from Cloud Firestore.';
    this.scheduleAutomaticSafetySyncRetry();
    this.handleSyncError(error, 'recipes');
  }

  private handlePresetsSnapshot(
    rawDocs: Array<{ id: string; data: ProductionPreset }>,
    metadata: { fromCache: boolean; hasPendingWrites?: boolean },
    hasDocChanges: boolean,
    generation: number,
    workspaceId: string
  ): void {
    const activeWs = this.activeWorkspaceId || 'ws-main';
    if (generation !== this.listenerGeneration || workspaceId !== activeWs) {
      return;
    }

    const remotePresets: ProductionPreset[] = rawDocs
      .map((d) => {
        const normCat = normalizePresetCategory(d.data);
        return {
          ...d.data,
          id: d.data.id || d.id,
          category: normCat,
        };
      })
      .filter((p) => !p.workspaceId || p.workspaceId === workspaceId);

    if (metadata.fromCache) {
      // Before first server-confirmed snapshot in this workspace: cached data NEVER authorizes mixing
      if (!this.presetsServerConfirmedInWorkspace) {
        const prevState = this.presetsHydrationState;
        const prevVerified = this.presetsConnectionVerified;
        this.presetsHydrationState = 'LOADING';
        this.presetsConnectionVerified = false;
        if (hasDocChanges && remotePresets.length > 0) {
          this.presets = remotePresets;
        }
        if (prevState !== 'LOADING' || prevVerified || (hasDocChanges && remotePresets.length > 0)) {
          this.notify();
        }
        return;
      }

      // After initial READY: Wi-Fi drop / cache-only event moves operational state to CONNECTION_UNVERIFIED
      const prevVerified = this.presetsConnectionVerified;
      this.presetsConnectionVerified = false;
      if (hasDocChanges && remotePresets.length > 0) {
        this.presets = remotePresets;
      }
      this.syncStatus = {
        status: 'offline',
        lastSynced: this.syncStatus.lastSynced,
        message: SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
        itemCount: this.getTotalItemCount(),
      };
      if (prevVerified || (hasDocChanges && remotePresets.length > 0)) {
        this.notify();
      } else {
        this.notify();
      }
      return;
    }

    const prevState = this.presetsHydrationState;
    const prevErr = this.presetsSyncError;
    const prevVerified = this.presetsConnectionVerified;
    this.presetsSyncError = null;
    this.presetsHydrationState = 'READY';
    this.presetsServerConfirmedInWorkspace = true;
    this.presetsConnectionVerified = true;
    this.presets = remotePresets;
    setLocal(STORAGE_KEYS.PRESETS, remotePresets);

    if (this.recipesHydrationState === 'READY' && this.recipesConnectionVerified) {
      this.cancelSafetySyncRetry(true);
    }

    if (hasDocChanges || prevState !== 'READY' || prevErr !== null || !prevVerified) {
      this.updateSyncSuccess();
    }
  }

  private handlePresetsListenerError(
    error: unknown,
    generation: number,
    workspaceId: string
  ): void {
    const activeWs = this.activeWorkspaceId || 'ws-main';
    if (generation !== this.listenerGeneration || workspaceId !== activeWs) {
      return;
    }
    this.presetsHydrationState = 'ERROR';
    this.presetsConnectionVerified = false;
    this.presetsSyncError =
      error instanceof Error
        ? error.message
        : 'Unable to load packaging presets and critical production notes from Cloud Firestore.';
    this.scheduleAutomaticSafetySyncRetry();
    this.handleSyncError(error, 'presets');
  }

  private setupRealtimeListeners(options?: { preserveGenerationReset?: boolean }): void {
    // Zero-trust enforcement: do not attach listeners if unauthenticated
    if (!auth.currentUser) return;

    // Clear previous snapshot listeners cleanly to prevent duplicate subscriptions or leaks
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    if (!options?.preserveGenerationReset) {
      this.resetSafetyHydrationToLoading();
    }

    const wsId = this.activeWorkspaceId || 'ws-main';
    const generation = this.listenerGeneration;
    const currentAuthUid = auth.currentUser?.uid || null;
    this.notify();

    // 0a. Dedicated real-time self-membership listener for the signed-in user:
    // Guarantees immediate live role refresh, downgrade revocation, and deactivation lockout
    // even if collection-wide members query is delayed or restricted.
    if (currentAuthUid) {
      const selfMemberDocRef = doc(db, 'workspaces', wsId, 'members', currentAuthUid);
      const unsubSelfMember = onSnapshot(
        selfMemberDocRef,
        (docSnap) => {
          if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
            return;
          }
          if (!docSnap.exists()) {
            this.handleCurrentUserMembershipRealtimeUpdate({
              uid: currentAuthUid,
              workspaceId: wsId,
              generation,
              exists: false,
            });
            return;
          }
          const data = docSnap.data();
          this.handleCurrentUserMembershipRealtimeUpdate({
            uid: currentAuthUid,
            workspaceId: wsId,
            generation,
            exists: true,
            role: data?.role,
            active: data?.active,
          });
        },
        (error: any) => {
          if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
            return;
          }
          const code = String(error?.code || '').toLowerCase();
          if (code === 'permission-denied' || code.endsWith('/permission-denied')) {
            // Firestore rules deny read when active !== true or member document is removed
            this.handleCurrentUserMembershipRealtimeUpdate({
              uid: currentAuthUid,
              workspaceId: wsId,
              generation,
              exists: false,
              active: false,
            });
            return;
          }
          this.handleSyncError(error, `workspaces/${wsId}/members/${currentAuthUid}`);
        }
      );
      this.unsubs.push(unsubSelfMember);
    }

    // 0c. Subscribe to Members of active workspace
    const membersColRef = collection(db, 'workspaces', wsId, 'members');
    const unsubMembers = onSnapshot(
      membersColRef,
      (snapshot) => {
        if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
          return;
        }
        const memberList: WorkspaceMemberDoc[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          memberList.push({
            uid: data.uid || d.id,
            id: d.id,
            email: data.email || '',
            name: data.name || (data.email ? data.email.split('@')[0] : 'Member'),
            role: (data.role as AccessRole) || 'viewer',
            active: data.active === true,
            addedAt: data.addedAt || '',
            updatedAt: data.updatedAt || data.addedAt || '',
          });
        });
        this.workspaceMembers = memberList;

        // Reconcile current user's live membership state
        const currentUid = auth.currentUser?.uid;
        if (currentUid) {
          const myDoc = memberList.find((m) => m.uid === currentUid);
          if (!myDoc) {
            this.handleCurrentUserMembershipRealtimeUpdate({
              uid: currentUid,
              workspaceId: wsId,
              generation,
              exists: false,
            });
            return;
          }
          this.handleCurrentUserMembershipRealtimeUpdate({
            uid: currentUid,
            workspaceId: wsId,
            generation,
            exists: true,
            role: myDoc.role,
            active: myDoc.active,
          });
          return;
        }
        this.notify();
      },
      (error) => {
        if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
          return;
        }
        this.handleSyncError(error, `workspaces/${wsId}/members`);
      }
    );
    this.unsubs.push(unsubMembers);

    // 0d. Subscribe to Billing/Entitlement of active workspace
    const billingDocRef = doc(db, 'workspaces', wsId, 'billing', 'current');
    const unsubBilling = onSnapshot(
      billingDocRef,
      (snapshot) => {
        if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
          return;
        }
        if (snapshot.exists()) {
          const data = snapshot.data();
          this.billing = {
            planId: (data.planId as PlanId) || 'solo',
            subscriptionStatus: (data.subscriptionStatus as SubscriptionStatus) || 'incomplete',
            entitlementStatus: (data.entitlementStatus as BillingEntitlementStatus) || 'inactive',
            trialStartedAt: data.trialStartedAt || null,
            trialEndsAt: data.trialEndsAt || null,
            stripeCustomerId: data.stripeCustomerId || null,
            stripeSubscriptionId: data.stripeSubscriptionId || null,
            stripePriceId: data.stripePriceId || null,
            seatLimit: typeof data.seatLimit === 'number' ? data.seatLimit : 1,
            activeSeatCount: typeof data.activeSeatCount === 'number' ? data.activeSeatCount : 1,
            cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
            currentPeriodStart: data.currentPeriodStart || null,
            currentPeriodEnd: data.currentPeriodEnd || null,
            billingUpdatedAt: data.billingUpdatedAt || new Date().toISOString(),
            billingSource: (data.billingSource as BillingSource) || 'internal',
          };
        } else {
          this.billing = null;
        }
        this.notify();
      },
      () => {
        // Safe fallback if billing document does not exist or user lacks permission
        this.billing = null;
        this.notify();
      }
    );
    this.unsubs.push(unsubBilling);

    // 1. Subscribe to active Workspace (including shared managementLock policy)
    const wsDocRef = doc(db, 'workspaces', wsId);
    const unsubWorkspace = onSnapshot(
      wsDocRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
          return;
        }
        const isFromCache = snapshot.metadata.fromCache;
        if (snapshot.exists()) {
          const remoteWs = { ...(snapshot.data() as Workspace), id: snapshot.id };
          const idx = this.workspaces.findIndex((w) => w.id === remoteWs.id);
          if (idx >= 0) {
            const nextWorkspaces = [...this.workspaces];
            nextWorkspaces[idx] = remoteWs;
            this.workspaces = nextWorkspaces;
          } else {
            this.workspaces = [...this.workspaces, remoteWs];
          }
          setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
          if (!isFromCache) {
            this.workspaceDocHydrationState = 'READY';
            this.workspaceDocSyncError = null;
          }
          this.applyActiveWorkspaceTheme();
          this.updateSyncSuccess();
        } else if (!isFromCache) {
          // Do NOT auto-bootstrap or replace a missing workspace root document.
          // Remove stale cached workspace state and fail closed with a clear diagnostic error.
          this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
          setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
          this.workspaceDocHydrationState = 'ERROR';
          this.workspaceDocSyncError = `Workspace root document (workspaces/${wsId}) was not found in Cloud Firestore.`;
          this.notify();
        }
      },
      (error) => {
        if (generation !== this.listenerGeneration || (this.activeWorkspaceId || 'ws-main') !== wsId) {
          return;
        }
        this.workspaceDocHydrationState = 'ERROR';
        this.workspaceDocSyncError =
          error instanceof Error ? error.message : 'Unable to sync workspace security policy.';
        this.handleSyncError(error, `workspaces/${wsId}`);
      }
    );
    this.unsubs.push(unsubWorkspace);

    // 2. Subscribe to Recipes scoped to active workspace (with metadata changes so server confirmation is observed even when cache matches)
    const recipesQuery = query(collection(db, 'recipes'), where('workspaceId', '==', wsId));
    const unsubRecipes = onSnapshot(
      recipesQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({
          id: d.id,
          data: d.data() as Recipe,
        }));
        this.handleRecipesSnapshot(
          docs,
          {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          },
          snapshot.docChanges().length > 0,
          generation,
          wsId
        );
      },
      (error) => {
        this.handleRecipesListenerError(error, generation, wsId);
      }
    );
    this.unsubs.push(unsubRecipes);

    // 3. Subscribe to Presets scoped to active workspace (Authoritative source for preset.criticalNotes)
    const presetsQuery = query(collection(db, 'presets'), where('workspaceId', '==', wsId));
    const unsubPresets = onSnapshot(
      presetsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({
          id: d.id,
          data: d.data() as ProductionPreset,
        }));
        this.handlePresetsSnapshot(
          docs,
          {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          },
          snapshot.docChanges().length > 0,
          generation,
          wsId
        );
      },
      (error) => {
        this.handlePresetsListenerError(error, generation, wsId);
      }
    );
    this.unsubs.push(unsubPresets);

    // 4. Subscribe to Mixers scoped to active workspace
    const mixersQuery = query(collection(db, 'mixers'), where('workspaceId', '==', wsId));
    const unsubMixers = onSnapshot(
      mixersQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const remoteMixers: Mixer[] = snapshot.docs.map((d) => d.data() as Mixer);
          this.mixers = remoteMixers;
          setLocal(STORAGE_KEYS.MIXERS, remoteMixers);
          this.updateSyncSuccess();
        }
      },
      (error) => {
        this.handleSyncError(error, 'mixers');
      }
    );
    this.unsubs.push(unsubMixers);

    // 5. Subscribe to History scoped to active workspace
    const historyQuery = query(collection(db, 'history'), where('workspaceId', '==', wsId));
    const unsubHistory = onSnapshot(
      historyQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const remoteHistory: ProductionHistoryEntry[] = snapshot.docs.map((d) => d.data() as ProductionHistoryEntry);
          remoteHistory.sort((a, b) => new Date(b.calculatedAt).getTime() - new Date(a.calculatedAt).getTime());
          this.history = remoteHistory;
          setLocal(STORAGE_KEYS.HISTORY, remoteHistory);
          this.updateSyncSuccess();
        }
      },
      (error) => {
        this.handleSyncError(error, 'history');
      }
    );
    this.unsubs.push(unsubHistory);

    // 6. Subscribe to Master Ingredients scoped to active workspace
    const masterIngsQuery = query(collection(db, 'master_ingredients'), where('workspaceId', '==', wsId));
    const unsubMasterIngs = onSnapshot(
      masterIngsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const remoteIngs: MasterIngredient[] = snapshot.docs.map((d) => d.data() as MasterIngredient);
          this.masterIngredients = remoteIngs;
          setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, remoteIngs);
          this.updateSyncSuccess();
        }
      },
      (error) => {
        this.handleSyncError(error, 'master_ingredients');
      }
    );
    this.unsubs.push(unsubMasterIngs);
  }

  public async applyWorkspaceScopeToLocalData(workspaceId: string, ownerUid: string): Promise<void> {
    this.activeWorkspaceId = workspaceId;
    this.recipes = this.recipes.map((r) => ({ ...r, workspaceId: r.workspaceId || workspaceId }));
    this.presets = this.presets.map((p) => ({ ...p, workspaceId: p.workspaceId || workspaceId }));
    this.mixers = this.mixers.map((m) => ({ ...m, workspaceId: m.workspaceId || workspaceId }));
    this.history = this.history.map((h) => ({ ...h, workspaceId: h.workspaceId || workspaceId }));
    this.masterIngredients = this.masterIngredients.map((i) => ({ ...i, workspaceId: i.workspaceId || workspaceId }));

    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    setLocal(STORAGE_KEYS.PRESETS, this.presets);
    setLocal(STORAGE_KEYS.MIXERS, this.mixers);
    setLocal(STORAGE_KEYS.HISTORY, this.history);
    setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, this.masterIngredients);

    const ws = this.getActiveWorkspace();
    if (ws) {
      ws.ownerId = ownerUid;
      setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
    }
    this.notify();
  }

  private getTotalItemCount(): number {
    return (
      this.recipes.length +
      this.masterIngredients.length +
      this.presets.length +
      this.mixers.length +
      this.history.length +
      this.workspaces.length
    );
  }

  private updateSyncSuccess(): void {
    const now = new Date();
    const operationalState = this.getSafetyOperationalGateState();
    this.syncStatus = {
      status: operationalState === 'CONNECTION_UNVERIFIED' ? 'offline' : 'synced',
      lastSynced: now,
      message:
        operationalState === 'READY'
          ? 'Safety Sync Ready'
          : operationalState === 'CONNECTION_UNVERIFIED'
          ? SAFETY_CONNECTION_UNVERIFIED_MESSAGE
          : this.getSafetySyncStatusLabel(),
      itemCount: this.getTotalItemCount(),
    };
    safeStorage.setItem(STORAGE_KEYS.LAST_SYNCED, now.toISOString());
    this.notify();
  }

  private handleSyncError(error: unknown, path: string): void {
    handleFirestoreError(error, OperationType.GET, path);
    const hasScheduledRetry = this.safetyRetryTimer !== null || this.isSafetyReconnecting;
    this.syncStatus = {
      status: 'error',
      lastSynced: this.syncStatus.lastSynced,
      message: hasScheduledRetry ? 'Reconnecting' : 'Safety Sync Failed',
      itemCount: this.getTotalItemCount(),
    };
    this.notify();
  }

  /**
   * Restarts terminated Firestore safety listeners after validating current authentication
   * and workspace access.
   *
   * Safety guarantees:
   * - Never mutates Firestore documents (read-only membership check only when online).
   * - Preserves existing in-memory recipes, presets, and browser localStorage critical notes.
   * - Increments listenerGeneration so stale callbacks from prior subscriptions are ignored.
   * - Tears down prior listeners cleanly to prevent duplicate subscriptions or memory leaks.
   * - Keeps production blocked in LOADING until authoritative server-confirmed snapshots arrive.
   */
  public async retrySafetySync(options?: { fromAutoBackoff?: boolean }): Promise<boolean> {
    if (!options?.fromAutoBackoff) {
      this.cancelSafetySyncRetry(true);
    }

    // Preserve durable backup of any local Critical Production Notes non-destructively
    captureNonDestructiveCriticalNotesBackup(this.getEffectiveStorage());

    const uid = this.getEffectiveAuthenticatedUid();
    const wsId = (this.activeWorkspaceId || '').trim();
    if (!uid || !wsId) {
      this.cancelSafetySyncRetry(true);
      this.recipesHydrationState = 'ERROR';
      this.presetsHydrationState = 'ERROR';
      this.recipesConnectionVerified = false;
      this.presetsConnectionVerified = false;
      this.recipesSyncError =
        this.recipesSyncError || 'Authentication required to retry Cloud Firestore safety sync.';
      this.syncStatus = {
        status: 'error',
        lastSynced: this.syncStatus.lastSynced,
        message: 'Safety Sync Failed',
        itemCount: this.getTotalItemCount(),
      };
      this.notify();
      return false;
    }

    let accessValid = false;
    try {
      if (this.customAccessValidatorForTesting && this.isDevOrTestEnvironment()) {
        accessValid = await this.customAccessValidatorForTesting(uid, wsId);
      } else if (this.testSessionOverride && this.isDevOrTestEnvironment()) {
        accessValid = this.isAuthorized() && this.testSessionOverride.workspaceId === wsId;
      } else {
        const user = auth.currentUser;
        if (user && user.uid === uid) {
          const memberSnap = await getDoc(doc(db, 'workspaces', wsId, 'members', uid));
          if (memberSnap.exists()) {
            const data = memberSnap.data();
            if (
              data &&
              data.active === true &&
              (data.role === 'owner' || data.role === 'editor' || data.role === 'viewer')
            ) {
              this.validatedUid = uid;
              this.validatedUserRole = data.role as AccessRole;
              accessValid = true;
            }
          }
        }
      }
    } catch (err: unknown) {
      this.isSafetyReconnecting = false;
      this.recipesHydrationState = 'ERROR';
      this.presetsHydrationState = 'ERROR';
      this.recipesConnectionVerified = false;
      this.presetsConnectionVerified = false;
      this.recipesSyncError =
        err instanceof Error
          ? err.message
          : 'Unable to validate workspace membership during safety sync retry.';
      this.scheduleAutomaticSafetySyncRetry();
      this.syncStatus = {
        status: 'error',
        lastSynced: this.syncStatus.lastSynced,
        message: this.safetyRetryTimer !== null ? 'Reconnecting' : 'Safety Sync Failed',
        itemCount: this.getTotalItemCount(),
      };
      this.notify();
      return false;
    }

    // Abort if signed out or switched workspace while awaiting membership validation
    if (
      this.getEffectiveAuthenticatedUid() !== uid ||
      (this.activeWorkspaceId || '').trim() !== wsId
    ) {
      this.cancelSafetySyncRetry(true);
      this.notify();
      return false;
    }

    if (!accessValid) {
      this.cancelSafetySyncRetry(true);
      this.recipesHydrationState = 'ERROR';
      this.presetsHydrationState = 'ERROR';
      this.recipesConnectionVerified = false;
      this.presetsConnectionVerified = false;
      this.recipesSyncError = 'Account is not authorized for the active workspace.';
      this.syncStatus = {
        status: 'error',
        lastSynced: this.syncStatus.lastSynced,
        message: 'Safety Sync Failed',
        itemCount: this.getTotalItemCount(),
      };
      this.notify();
      return false;
    }

    // Tear down any terminated/existing listeners without clearing recipes, presets, or local notes
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];

    this.resetSafetyHydrationToLoading({
      reconnecting: true,
      preserveServerConfirmedHistory: true,
      preserveRetrySequence: Boolean(options?.fromAutoBackoff),
    });

    this.syncStatus = {
      status: 'syncing',
      lastSynced: this.syncStatus.lastSynced,
      message: 'Reconnecting',
      itemCount: this.getTotalItemCount(),
    };

    const currentGen = this.listenerGeneration;
    if (this.customListenerRestartHookForTesting && this.isDevOrTestEnvironment()) {
      this.notify();
      this.customListenerRestartHookForTesting(currentGen, wsId);
    } else if (auth.currentUser) {
      this.setupRealtimeListeners({ preserveGenerationReset: true });
    } else {
      this.notify();
    }

    return true;
  }

  public getSyncStatus(): SyncStatusInfo {
    return this.syncStatus;
  }

  public async syncAllWithCloud(triggerSignInIfOffline = false): Promise<{ success: boolean; message: string; count: number }> {
    let currentUser = auth.currentUser;
    if (!currentUser && triggerSignInIfOffline) {
      currentUser = await signInWithGoogle();
    }

    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to sync with Cloud Firestore.');
    }

    if (!this.isAuthorized()) {
      throw new Error('Permission denied: You must have an authorized role in this workspace to sync.');
    }
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot upload operational data to Cloud Firestore.');
    }

    const uid = currentUser.uid;
    const activeWs = this.getActiveWorkspace();
    if (!activeWs || !activeWs.id) {
      throw new Error('No active workspace selected.');
    }
    const wsId = activeWs.id;

    this.syncStatus = {
      status: 'syncing',
      lastSynced: this.syncStatus.lastSynced,
      message: 'Uploading and syncing data to Cloud Firestore...',
      itemCount: this.getTotalItemCount(),
    };
    this.notify();

    try {
      let syncedCount = 0;

      // Helper to identify local sample items that should not be uploaded
      const isSample = (item: { id?: string; userId?: string }): boolean => {
        if (!item) return true;
        if (item.userId === 'default' || item.userId === 'baker-user' || item.userId === 'default-user') return true;
        if (item.id && (item.id.startsWith('sample-') || item.id.startsWith('sample_'))) return true;
        return false;
      };

      // 1. Sync Recipes (strictly scoped to active workspace, skip sample data and other workspaces)
      for (const recipe of this.recipes) {
        if (isSample(recipe)) continue;
        if (recipe.workspaceId && recipe.workspaceId !== wsId) continue;
        const recipeToSync: Recipe = {
          ...recipe,
          workspaceId: wsId,
          userId: uid,
        };
        await setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipeToSync));
        syncedCount++;
      }

      // 2. Sync Master Ingredients (scoped to active workspace)
      for (const ing of this.masterIngredients) {
        if (isSample(ing)) continue;
        if (ing.workspaceId && ing.workspaceId !== wsId) continue;
        const ingToSync: MasterIngredient = {
          ...ing,
          workspaceId: wsId,
          userId: uid,
        };
        await setDoc(doc(db, 'master_ingredients', ing.id), sanitizeForFirestore(ingToSync));
        syncedCount++;
      }

      // 3. Sync Presets (scoped to active workspace — never clobber newer cloud criticalNotes)
      for (const preset of this.presets) {
        if (isSample(preset)) continue;
        if (preset.workspaceId && preset.workspaceId !== wsId) continue;
        await this.executePresetTransaction(preset.id, (remotePreset) => {
          const preservedNotes =
            remotePreset && Array.isArray(remotePreset.criticalNotes)
              ? remotePreset.criticalNotes
              : preset.criticalNotes;
          return {
            ...preset,
            ...(preservedNotes !== undefined ? { criticalNotes: preservedNotes } : {}),
            workspaceId: wsId,
            userId: uid,
          };
        });
        syncedCount++;
      }

      // 4. Sync Mixers (scoped to active workspace)
      for (const mixer of this.mixers) {
        if (isSample(mixer)) continue;
        if (mixer.workspaceId && mixer.workspaceId !== wsId) continue;
        const mixerToSync: Mixer = {
          ...mixer,
          workspaceId: wsId,
          userId: uid,
        };
        await setDoc(doc(db, 'mixers', mixer.id), sanitizeForFirestore(mixerToSync));
        syncedCount++;
      }

      // 5. Sync History (scoped to active workspace)
      for (const hist of this.history) {
        if (hist.workspaceId && hist.workspaceId !== wsId) continue;
        const histToSync: ProductionHistoryEntry = {
          ...hist,
          workspaceId: wsId,
          userId: uid,
        };
        await setDoc(doc(db, 'history', hist.id), sanitizeForFirestore(histToSync));
        syncedCount++;
      }

      // 6. Sync Workspace ONLY if current user is owner, preserving existing ownerId without overwrite
      if (this.getUserRole() === 'owner' && activeWs.ownerId === uid) {
        await setDoc(doc(db, 'workspaces', activeWs.id), sanitizeForFirestore(activeWs), { merge: true });
        syncedCount++;
      }

      // 7. Sync User Settings for this authenticated user only (excluding shared workspace keys)
      const {
        categoryPresetMap: _omitSyncMap,
        recipeCategories: _omitSyncCats,
        productionOptionOrder: _omitSyncOrder,
        ...userSyncSettings
      } = this.settings;
      await setDoc(
        doc(db, 'settings', uid),
        sanitizeForFirestore({ ...userSyncSettings, userId: uid }),
        { merge: true }
      );
      syncedCount++;

      this.updateSyncSuccess();
      return {
        success: true,
        message: `Successfully synchronized ${syncedCount} items with your Cloud Firestore database!`,
        count: syncedCount,
      };
    } catch (err) {
      this.handleSyncError(err, 'syncAllWithCloud');
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Sync encountered an issue.',
        count: 0,
      };
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  /**
   * Executes workspace discovery + membership validation for an authenticated UID.
   * Distinguishes Firestore/network failures (`INITIALIZATION_ERROR`) from genuine
   * empty workspace memberships (`NO_WORKSPACE`) so existing Owners/members are
   * never misrouted to `NewWorkspaceSetupScreen` during transient connectivity issues.
   */
  public async resolveAuthenticatedSession(uid: string): Promise<void> {
    if (!uid) return;

    this.initializationError = null;
    this.authLoading = false;
    this.workspaceLoading = true;
    this.currentUserId = uid;
    this.settings.userId = uid;
    this.notify();

    // 1. Discover workspace memberships for user UID
    let memberships: Array<{ workspaceId: string; role: AccessRole; active: boolean }> = [];
    try {
      memberships = await WorkspaceProvisioningService.detectUserWorkspaces(uid);
    } catch (wsErr) {
      console.error('[Store] Workspace discovery failed due to service/network error:', wsErr);
      this.validatedUid = null;
      this.validatedUserRole = null;
      this.initializationError = formatWorkspaceBootstrapError(wsErr, 'discovery');
      this.workspaceLoading = false;
      this.billingLoading = false;
      this.notify();
      return;
    }

    if (memberships.length === 0) {
      // Confirmed: authenticated user has zero active workspace memberships
      this.validatedUid = null;
      this.validatedUserRole = null;
      this.activeWorkspaceId = '';
      this.clearProductionRecordsFromMemory();
      this.workspaceLoading = false;
      this.billingLoading = false;
      this.notify();
      return;
    }

    // 2. Select active workspace (preserve current valid activeWorkspaceId, else profile default, else first membership)
    let targetWsId = memberships[0].workspaceId;
    if (this.activeWorkspaceId && memberships.some((m) => m.workspaceId === this.activeWorkspaceId)) {
      targetWsId = this.activeWorkspaceId;
    } else if (!this.customMembershipLookupForTesting) {
      try {
        const userProfile = await WorkspaceProvisioningService.getUserProfile(uid);
        const prefWsId = userProfile?.defaultWorkspaceId;
        if (prefWsId && memberships.some((m) => m.workspaceId === prefWsId)) {
          targetWsId = prefWsId;
        }
      } catch (profErr) {
        console.warn('[Store] Could not read user profile, using first membership:', profErr);
      }
    }

    this.activeWorkspaceId = targetWsId;
    this.settings.activeWorkspaceId = targetWsId;
    this.workspaceLoading = false;
    this.billingLoading = true;
    this.notify();

    // 3. Validate membership for user UID in target workspace
    let authorized = false;
    try {
      authorized = await this.validateMembershipForUser(uid, targetWsId);
    } catch (valErr) {
      console.error('[Store] Membership validation failed due to service/network error:', valErr);
      this.validatedUid = null;
      this.validatedUserRole = null;
      this.initializationError = formatWorkspaceBootstrapError(valErr, 'membership');
      this.billingLoading = false;
      this.notify();
      return;
    }

    this.billingLoading = false;

    if (authorized && this.isAuthorized()) {
      this.applyActiveWorkspaceTheme();

      this.syncStatus = {
        status: 'syncing',
        lastSynced: this.syncStatus.lastSynced,
        message: 'Connecting',
        itemCount: this.getTotalItemCount(),
      };
      this.notify();

      if (!this.customMembershipLookupForTesting && auth.currentUser?.uid === uid) {
        try {
          const userSettingsRef = doc(db, 'settings', uid);
          const existingSettingsSnap = await getDoc(userSettingsRef);
          if (existingSettingsSnap.exists()) {
            const remoteSettings = existingSettingsSnap.data() as Partial<UserSettings>;
            const localCandidateMap = this.settings.categoryPresetMap;
            const remoteCandidateMap = remoteSettings.categoryPresetMap;
            const localCandidateOrder =
              Array.isArray(this.settings.productionOptionOrder) &&
              this.settings.productionOptionOrder.length > 0
                ? this.settings.productionOptionOrder
                : undefined;
            const remoteCandidateOrder =
              Array.isArray(remoteSettings.productionOptionOrder) &&
              remoteSettings.productionOptionOrder.length > 0
                ? remoteSettings.productionOptionOrder
                : undefined;
            this.settings = {
              ...this.settings,
              ...remoteSettings,
              userId: uid,
              activeWorkspaceId: targetWsId,
              categoryPresetMap: localCandidateMap || remoteCandidateMap || this.settings.categoryPresetMap,
              // Preserved strictly as read-only Owner reconciliation candidate; never used by getProductionOptionOrder()
              productionOptionOrder: remoteCandidateOrder || localCandidateOrder,
            };
            setLocal(STORAGE_KEYS.SETTINGS, this.settings);
            this.applyActiveWorkspaceTheme();
            this.notify();
          } else {
            const {
              categoryPresetMap: _omitWorkspaceMap,
              recipeCategories: _omitWorkspaceCats,
              productionOptionOrder: _omitWorkspaceOrder,
              ...userOnlySettings
            } = this.settings;
            await setDoc(
              userSettingsRef,
              sanitizeForFirestore({ ...userOnlySettings, userId: uid, activeWorkspaceId: targetWsId }),
              { merge: true }
            );
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `settings/${uid}`);
        }
      }
      this.updateSyncSuccess();
    } else {
      // Confirmed non-member / inactive membership
      this.cancelSafetySyncRetry(true);
      this.unsubs.forEach((unsub) => unsub());
      this.unsubs = [];
      this.clearProductionRecordsFromMemory();
      this.syncStatus = {
        status: 'offline',
        lastSynced: this.syncStatus.lastSynced,
        message: 'Account not authorized by workspace owner.',
        itemCount: 0,
      };
      this.notify();
    }
  }

  // --- Session & Access Control API ---
  public async validateMembershipForUser(uid: string, targetWorkspaceId?: string): Promise<boolean> {
    const isTestHarnessUid =
      this.isDevOrTestEnvironment() &&
      (this.testAuthUidOnlyOverride === uid || this.testSessionOverride?.uid === uid);

    const user = auth.currentUser;
    if (!isTestHarnessUid && (!user || user.uid !== uid)) {
      this.validatedUid = null;
      this.validatedUserRole = null;
      return false;
    }

    const wsId = targetWorkspaceId || this.activeWorkspaceId;
    if (!wsId) {
      this.validatedUid = null;
      this.validatedUserRole = null;
      this.notify();
      return false;
    }

    // Query Firestore membership subcollection by UID (rethrows connectivity/service errors to caller)
    let memberExists = false;
    let memberRole: AccessRole | undefined;
    let memberActive = false;

    if (this.customMembershipLookupForTesting && this.isDevOrTestEnvironment()) {
      const lookup = await this.customMembershipLookupForTesting(uid, wsId);
      memberExists = lookup.exists;
      memberRole = lookup.role;
      memberActive = lookup.active === true;
    } else {
      const memberDoc = await getDoc(doc(db, 'workspaces', wsId, 'members', uid));
      if (memberDoc.exists()) {
        const data = memberDoc.data();
        memberExists = true;
        memberRole = data?.role as AccessRole | undefined;
        memberActive = data?.active === true;
      }
    }

    if (
      memberExists &&
      (memberRole === 'owner' || memberRole === 'editor' || memberRole === 'viewer') &&
      memberActive
    ) {
      this.validatedUid = uid;
      this.validatedUserRole = memberRole;
      this.activeWorkspaceId = wsId;
      this.settings.activeWorkspaceId = wsId;

      this.resetSafetyHydrationToLoading();
      if (wsId === 'ws-main') {
        this.loadProductionRecordsFromLocalStorage();
      } else {
        this.clearProductionRecordsFromMemory();
      }

      // Preserve any pre-hydration local workspace ordering candidate non-destructively before hydrating remote workspace doc
      const preHydrationWs = this.workspaces.find((w) => w.id === wsId);
      if (
        preHydrationWs &&
        Array.isArray(preHydrationWs.productionOptionOrder) &&
        preHydrationWs.productionOptionOrder.length > 0 &&
        !this.capturedLegacyWorkspaceOrderByWsId[wsId]
      ) {
        this.capturedLegacyWorkspaceOrderByWsId[wsId] = [
          ...preHydrationWs.productionOptionOrder,
        ];
      }

      // Hydrate workspace root doc (including shared managementLock & productionOptionOrder); fail closed on error or missing root doc
      try {
        if (this.customWorkspaceDocLoaderForTesting && this.isDevOrTestEnvironment()) {
          const loadedWs = await this.customWorkspaceDocLoaderForTesting(wsId);
          if (loadedWs) {
            const wsData = { ...loadedWs, id: loadedWs.id || wsId };
            const idx = this.workspaces.findIndex((w) => w.id === wsId);
            if (idx >= 0) {
              const nextWorkspaces = [...this.workspaces];
              nextWorkspaces[idx] = wsData;
              this.workspaces = nextWorkspaces;
            } else {
              this.workspaces = [...this.workspaces, wsData];
            }
            setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
            this.workspaceDocHydrationState = 'READY';
            this.workspaceDocSyncError = null;
          } else {
            // Missing workspace root document: fail closed without auto-bootstrapping or leaving stale cache
            this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
            setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
            this.workspaceDocHydrationState = 'ERROR';
            this.workspaceDocSyncError = `Workspace root document (workspaces/${wsId}) was not found in Cloud Firestore.`;
          }
        } else {
          const wsDocSnap = await getDoc(doc(db, 'workspaces', wsId));
          if (wsDocSnap.exists()) {
            const wsData = { ...(wsDocSnap.data() as Workspace), id: wsDocSnap.id };
            const idx = this.workspaces.findIndex((w) => w.id === wsId);
            if (idx >= 0) {
              const nextWorkspaces = [...this.workspaces];
              nextWorkspaces[idx] = wsData;
              this.workspaces = nextWorkspaces;
            } else {
              this.workspaces = [...this.workspaces, wsData];
            }
            setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
            this.workspaceDocHydrationState = 'READY';
            this.workspaceDocSyncError = null;
          } else {
            // Missing workspace root document: fail closed without auto-bootstrapping or leaving stale cache
            this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
            setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
            this.workspaceDocHydrationState = 'ERROR';
            this.workspaceDocSyncError = `Workspace root document (workspaces/${wsId}) was not found in Cloud Firestore.`;
          }
        }
      } catch (wsErr) {
        console.warn('Workspace doc fetch error (workspace hydration fails closed until synced):', wsErr);
        this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
        this.workspaceDocHydrationState = 'ERROR';
        this.workspaceDocSyncError =
          wsErr instanceof Error ? wsErr.message : 'Unable to load workspace security policy.';
      }

      if (!isTestHarnessUid) {
        this.setupRealtimeListeners({ preserveGenerationReset: true });
      }
      this.notify();
      return true;
    }

    this.validatedUid = null;
    this.validatedUserRole = null;
    this.notify();
    return false;
  }

  /**
   * Activates a newly created customer workspace.
   * Ensures production caches are completely clean (no sample data),
   * validates owner membership, and attaches realtime listeners.
   */
  public async setWorkspaceAfterCreation(workspaceId: string): Promise<void> {
    const user = auth.currentUser;
    if (!user || !user.uid) {
      throw new Error('User must be authenticated to activate workspace.');
    }

    this.activeWorkspaceId = workspaceId;
    this.settings.activeWorkspaceId = workspaceId;

    // Clear production records from memory so new workspace starts strictly empty
    this.clearProductionRecordsFromMemory();
    this.recipes = [];
    this.presets = [];
    this.mixers = [];
    this.history = [];
    this.masterIngredients = [];

    // Validate membership (which attaches workspace-scoped realtime listeners once)
    await this.validateMembershipForUser(user.uid, workspaceId);

    // Apply workspace branding theme
    this.applyActiveWorkspaceTheme();
    this.notify();
  }

  public getSessionUserEmail(): string | null {
    return auth.currentUser?.email || null;
  }

  private static getRoleRank(role: AccessRole | null | undefined): number {
    if (role === 'owner') return 3;
    if (role === 'editor') return 2;
    if (role === 'viewer') return 1;
    return 0;
  }

  public getMembershipSecurityEpoch(): number {
    return this.membershipSecurityEpoch;
  }

  public getLastMembershipSecurityEvent(): {
    epoch: number;
    reason: 'role_downgrade' | 'deactivated' | null;
    previousRole: AccessRole | null;
    nextRole: AccessRole | null;
  } {
    return { ...this.lastMembershipSecurityEvent };
  }

  /**
   * Authoritative live membership state handler.
   * Ignores stale listener generations or workspace mismatches.
   * Immediately revokes editing/session access and increments `membershipSecurityEpoch`
   * on role downgrade (e.g., owner->editor, editor->viewer) or member deactivation.
   * Never signs out Firebase Auth or clears Critical Notes / PIN localStorage backups.
   */
  private handleCurrentUserMembershipRealtimeUpdate(params: {
    uid: string;
    workspaceId: string;
    generation: number;
    exists: boolean;
    role?: unknown;
    active?: unknown;
  }): void {
    const activeWs = this.activeWorkspaceId || 'ws-main';
    if (params.generation !== this.listenerGeneration || params.workspaceId !== activeWs) {
      return;
    }

    const effectiveUid = this.getEffectiveAuthenticatedUid();
    if (!effectiveUid || effectiveUid !== params.uid) {
      return;
    }

    const previousRole = this.getUserRole();
    const previousRank = StoreManager.getRoleRank(previousRole);

    const isValidRole =
      params.role === 'owner' || params.role === 'editor' || params.role === 'viewer';
    const isActiveValid = params.exists === true && params.active === true && isValidRole;

    if (!isActiveValid) {
      this.validatedUid = null;
      this.validatedUserRole = null;
      if (this.testSessionOverride && this.testSessionOverride.uid === params.uid) {
        this.testSessionOverride = null;
        this.testAuthUidOnlyOverride = params.uid;
      }
      this.membershipSecurityEpoch += 1;
      this.lastMembershipSecurityEvent = {
        epoch: this.membershipSecurityEpoch,
        reason: 'deactivated',
        previousRole,
        nextRole: null,
      };
      this.cancelSafetySyncRetry(true);
      const subsToDetach = [...this.unsubs];
      this.unsubs = [];
      subsToDetach.forEach((unsub) => {
        try {
          unsub();
        } catch {
          // Ignore listener teardown errors
        }
      });
      this.clearProductionRecordsFromMemory();
      this.syncStatus = {
        status: 'offline',
        lastSynced: this.syncStatus.lastSynced,
        message: 'Workspace membership inactive or revoked.',
        itemCount: 0,
      };
      this.notify();
      return;
    }

    const nextRole = params.role as AccessRole;
    const nextRank = StoreManager.getRoleRank(nextRole);

    this.validatedUid = params.uid;
    this.validatedUserRole = nextRole;
    if (this.testSessionOverride && this.testSessionOverride.uid === params.uid) {
      this.testSessionOverride = {
        ...this.testSessionOverride,
        role: nextRole,
      };
    }

    if (previousRank > 0 && nextRank < previousRank) {
      this.membershipSecurityEpoch += 1;
      this.lastMembershipSecurityEvent = {
        epoch: this.membershipSecurityEpoch,
        reason: 'role_downgrade',
        previousRole,
        nextRole,
      };
    }

    this.notify();
  }

  public simulateCurrentUserMembershipRealtimeUpdateForTesting(params: {
    uid: string;
    workspaceId: string;
    generation?: number;
    exists: boolean;
    role?: unknown;
    active?: unknown;
  }): void {
    if (!this.isDevOrTestEnvironment()) return;
    this.handleCurrentUserMembershipRealtimeUpdate({
      uid: params.uid,
      workspaceId: params.workspaceId,
      generation: params.generation ?? this.listenerGeneration,
      exists: params.exists,
      role: params.role,
      active: params.active,
    });
  }

  public assertOwnerForBackupImport(): void {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can import full workspace backups.');
    }
  }

  public getUserRole(): AccessRole | null {
    if (this.testSessionOverride && this.isDevOrTestEnvironment()) {
      return this.testSessionOverride.role;
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) return null;
    if (uid !== this.validatedUid) return null;
    return this.validatedUserRole;
  }

  public isAuthorized(): boolean {
    if (this.testSessionOverride && this.isDevOrTestEnvironment()) {
      const r = this.testSessionOverride.role;
      return Boolean(this.testSessionOverride.uid) && (r === 'owner' || r === 'editor' || r === 'viewer');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) return false;
    if (uid !== this.validatedUid) return false;
    const role = this.validatedUserRole;
    return role === 'owner' || role === 'editor' || role === 'viewer';
  }

  private getEffectiveAuthenticatedUid(): string | null {
    if (this.isDevOrTestEnvironment()) {
      if (this.testSessionOverride) {
        return this.testSessionOverride.uid;
      }
      if (this.testAuthUidOnlyOverride) {
        return this.testAuthUidOnlyOverride;
      }
    }
    return auth.currentUser?.uid || null;
  }

  public isAuthLoading(): boolean {
    return this.authLoading;
  }

  public getBilling(): WorkspaceBilling | null {
    return this.billing;
  }

  /**
   * DEVELOPMENT & QA TESTING ONLY:
   * Simulates an in-memory billing state during development and automated tests.
   *
   * PRODUCTION SECURITY INVARIANTS:
   * 1. Strictly disabled in production builds (import.meta.env.DEV check).
   * 2. Cannot override Firestore billing/current on the server or database.
   * 3. Cannot override canAccessApp() in production.
   * 4. URL parameters, localStorage, and browser console manipulation cannot persist or activate simulated billing state.
   */
  public setMockBillingForTesting(mockBilling: WorkspaceBilling | null): void {
    const isDevelopment = Boolean(
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
      (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV)
    );

    if (!isDevelopment) {
      console.warn('[SECURITY] Simulated billing is strictly disabled in production builds.');
      return;
    }

    this.billing = mockBilling;
    this.notify();
  }

  /**
   * Authoritative Active Seat Count:
   * Derives exclusively from `workspaces/{workspaceId}/members` where `active === true`
   * and role is one of 'owner', 'editor', 'viewer'.
   *
   * FAIL-CLOSED ENFORCEMENT:
   * Missing, undefined, null, or malformed active flags are strictly non-active.
   * Does not silently mask malformed owner state with Math.max(1, ...).
   */
  public getComputedActiveSeatCount(): number {
    if (!this.workspaceMembers || this.workspaceMembers.length === 0) {
      return 0;
    }
    return countActiveSeats(this.workspaceMembers);
  }

  /**
   * Diagnostic check for workspace owner membership integrity.
   * Confirms authoritative owner membership exists with role === 'owner' and active === true.
   * Does not silently rewrite or force Math.max(1, count).
   */
  public getOwnerMembershipIntegrity(): OwnerIntegrityResult {
    const ws = this.getActiveWorkspace();
    return checkOwnerMembershipIntegrity(this.workspaceMembers, ws?.ownerId);
  }

  public getEntitlementEvaluation(): EntitlementEvaluation {
    const uid = this.getEffectiveAuthenticatedUid();
    const isAuthenticated = Boolean(uid);
    const hasWorkspaceMembership = this.isAuthorized();
    const wsId = this.activeWorkspaceId || 'ws-main';

    return EntitlementService.evaluate({
      isAuthenticated,
      hasWorkspaceMembership,
      billingDoc: this.billing,
      workspaceId: wsId,
    });
  }

  public getAppAccessState(): AppAccessState {
    if (this.initializationError) return 'INITIALIZATION_ERROR';
    if (this.authLoading) return 'AUTH_LOADING';
    if (!this.getEffectiveAuthenticatedUid()) return 'SIGNED_OUT';
    if (this.workspaceLoading) return 'WORKSPACE_LOADING';
    if (!this.isAuthorized()) return 'NO_WORKSPACE';
    if (this.billingLoading) return 'BILLING_LOADING';
    return this.getEntitlementEvaluation().accessState;
  }

  public getInitializationError(): string | null {
    return this.initializationError;
  }

  public isWorkspaceLoading(): boolean {
    return this.workspaceLoading;
  }

  public isBillingLoading(): boolean {
    return this.billingLoading;
  }

  /**
   * Safe retry / recheck trigger for UI components and ErrorBoundary.
   * Works even when `activeWorkspaceId` was cleared or never discovered due to a
   * prior connectivity error during post-login workspace lookup.
   */
  public async recheckAccess(): Promise<void> {
    try {
      this.initializationError = null;
      const uid = this.getEffectiveAuthenticatedUid();
      if (uid) {
        if (!this.activeWorkspaceId || !this.isAuthorized()) {
          await this.resolveAuthenticatedSession(uid);
        } else {
          try {
            await this.validateMembershipForUser(uid, this.activeWorkspaceId);
          } catch (valErr) {
            this.initializationError = formatWorkspaceBootstrapError(valErr, 'membership');
          }
        }
      } else {
        this.detachAuthObserver();
        this.authLoading = true;
        this.initFirebaseSync();
      }
    } catch (e: any) {
      console.warn('[Store] recheckAccess non-blocking catch:', e);
      this.initializationError = e?.message || 'Access recheck failed.';
    }
    this.notify();
  }

  public getEntitlementStatus(): EntitlementStatus {
    const evalResult = this.getEntitlementEvaluation();
    return {
      hasValidEntitlement: evalResult.canAccessApp,
      plan:
        evalResult.planId === 'internal'
          ? 'internal_phase0'
          : evalResult.accessState === 'TRIAL_ACTIVE'
          ? 'trial'
          : evalResult.canAccessApp
          ? 'active_subscription'
          : 'expired',
      expiresAt: evalResult.expiresAt,
    };
  }

  public canAccessApp(): boolean {
    return this.getEntitlementEvaluation().canAccessApp;
  }

  public isEditorOrOwner(): boolean {
    const role = this.getUserRole();
    return role === 'owner' || role === 'editor';
  }

  public getMasterIngredients(): MasterIngredient[] {
    if (!this.isAuthorized()) return [];
    return this.masterIngredients;
  }

  public async saveMasterIngredient(ingredient: MasterIngredient): Promise<MasterIngredient> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify ingredients.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save ingredients.');
    }
    const userId = currentUser.uid;
    const wsId = this.activeWorkspaceId || 'ws-main';
    const existingIndex = this.masterIngredients.findIndex(
      (m) => m.id === ingredient.id || m.name.toLowerCase() === ingredient.name.trim().toLowerCase()
    );

    let updatedItem: MasterIngredient;

    if (existingIndex >= 0) {
      updatedItem = {
        ...this.masterIngredients[existingIndex],
        ...ingredient,
        name: ingredient.name.trim(),
        userId,
        workspaceId: ingredient.workspaceId || this.masterIngredients[existingIndex]?.workspaceId || wsId,
        updatedAt: new Date().toISOString(),
      };
      this.masterIngredients[existingIndex] = updatedItem;
    } else {
      updatedItem = {
        ...ingredient,
        id: ingredient.id || `mi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: ingredient.name.trim(),
        userId,
        workspaceId: ingredient.workspaceId || wsId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.masterIngredients.unshift(updatedItem);
    }

    setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, this.masterIngredients);
    this.notify();

    try {
      await setDoc(doc(db, 'master_ingredients', updatedItem.id), sanitizeForFirestore(updatedItem));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `master_ingredients/${updatedItem.id}`);
    }

    return updatedItem;
  }

  public async deleteMasterIngredient(id: string, force = false): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete ingredients.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete ingredients.');
    }

    // Phase 2A Orphan / Invalid Link Protection:
    // Detect situations where recipe ingredients reference this Master Ingredient
    const references = getMasterIngredientReferences(id, this.recipes);
    const totalLines = references.reduce((acc, r) => acc + r.ingredientCount, 0);

    if (totalLines > 0 && !force) {
      const recipeNames = references.map((r) => r.recipeName).slice(0, 3).join(', ');
      const moreCount = references.length > 3 ? ` and ${references.length - 3} more` : '';
      throw new Error(
        `Cannot delete Master Ingredient: It is currently referenced by ${totalLines} formula line(s) across ${references.length} recipe(s) (${recipeNames}${moreCount}). Unlink or update the references first to prevent broken links.`
      );
    }

    this.masterIngredients = this.masterIngredients.filter((mi) => mi.id !== id);
    setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, this.masterIngredients);
    this.notify();

    try {
      await deleteDoc(doc(db, 'master_ingredients', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `master_ingredients/${id}`);
    }
  }

  // --- Phase 2A Master Ingredient Linking API ---
  public async linkRecipeIngredient(
    recipeId: string,
    ingredientId: string,
    masterIngredientId: string
  ): Promise<Recipe> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot create or modify ingredient links.');
    }
    if (!recipeId || typeof recipeId !== 'string' || recipeId.trim() === '') {
      throw new Error('Invalid recipe ID: recipeId must be a non-empty string.');
    }
    if (!ingredientId || typeof ingredientId !== 'string' || ingredientId.trim() === '') {
      throw new Error('Invalid ingredient ID: ingredientId must be a non-empty string.');
    }
    const recipe = this.getRecipe(recipeId);
    if (!recipe) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }
    const masterIngredient = this.masterIngredients.find((m) => m.id === masterIngredientId);
    if (!masterIngredient) {
      throw new Error(`Master Ingredient not found: ${masterIngredientId}`);
    }

    const updated = linkIngredientInRecipe(
      recipe,
      ingredientId,
      masterIngredient,
      this.activeWorkspaceId,
      this.getUserRole()
    );

    await this.saveRecipe(updated);
    return updated;
  }

  public async unlinkRecipeIngredient(
    recipeId: string,
    ingredientId: string
  ): Promise<Recipe> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot remove ingredient links.');
    }
    if (!recipeId || typeof recipeId !== 'string' || recipeId.trim() === '') {
      throw new Error('Invalid recipe ID: recipeId must be a non-empty string.');
    }
    if (!ingredientId || typeof ingredientId !== 'string' || ingredientId.trim() === '') {
      throw new Error('Invalid ingredient ID: ingredientId must be a non-empty string.');
    }
    const recipe = this.getRecipe(recipeId);
    if (!recipe) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }

    const updated = unlinkIngredientInRecipe(
      recipe,
      ingredientId,
      this.getUserRole()
    );

    await this.saveRecipe(updated);
    return updated;
  }

  public async bulkLinkIngredientGroup(
    targetNormalizedName: string,
    masterIngredientId: string
  ): Promise<{ affectedCount: number }> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot link ingredient groups.');
    }
    const masterIngredient = this.masterIngredients.find((m) => m.id === masterIngredientId);
    if (!masterIngredient) {
      throw new Error(`Master Ingredient not found: ${masterIngredientId}`);
    }

    const { updatedRecipes, affectedCount } = applyBulkGroupLink(
      this.recipes,
      targetNormalizedName,
      masterIngredient,
      this.activeWorkspaceId,
      this.getUserRole()
    );

    if (affectedCount > 0) {
      for (const recipe of updatedRecipes) {
        if (recipe.ingredients.some((ing) => ing.masterIngredientId === masterIngredientId)) {
          await this.saveRecipe(recipe);
        }
      }
    }

    return { affectedCount };
  }

  public getLinkingStats(): LinkingStats {
    return calculateLinkingStats(this.recipes, this.masterIngredients);
  }

  public getMasterIngredientReferences(masterIngredientId: string) {
    return getMasterIngredientReferences(masterIngredientId, this.recipes);
  }

  public async bulkImportMasterIngredients(items: Partial<MasterIngredient>[]): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot import ingredients.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to import ingredients.');
    }
    for (const item of items) {
      if (!item.name?.trim()) continue;
      const nameClean = item.name.trim();
      const existing = this.masterIngredients.find((m) => m.name.toLowerCase() === nameClean.toLowerCase());
      if (!existing) {
        await this.saveMasterIngredient({
          id: `mi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          userId: currentUser.uid,
          name: nameClean,
          category: item.category || 'General',
          defaultUnit: item.defaultUnit || 'kg',
          defaultWastePercent: item.defaultWastePercent ?? 0,
        });
      }
    }
  }

  // --- Recipes API ---
  public getRecipes(includeArchived = false): Recipe[] {
    if (!this.isAuthorized()) return [];
    if (includeArchived) return this.recipes;
    return this.recipes.filter((r) => !r.archived);
  }

  public getRecipe(id: string): Recipe | undefined {
    if (!this.isAuthorized()) return undefined;
    return this.recipes.find((r) => r.id === id);
  }

  public async saveRecipe(recipe: Recipe): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify recipes.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save recipes.');
    }
    const userId = currentUser.uid;
    const wsId = this.activeWorkspaceId || 'ws-main';
    const recipeToSave: Recipe = {
      ...recipe,
      userId,
      workspaceId: recipe.workspaceId || wsId,
      updatedAt: new Date().toISOString(),
    };

    const index = this.recipes.findIndex((r) => r.id === recipe.id);
    if (index >= 0) {
      this.recipes[index] = recipeToSave;
    } else {
      this.recipes.unshift(recipeToSave);
    }

    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();

    try {
      await setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipeToSave));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`);
    }
  }

  public async reorderRecipes(orderedRecipes: Recipe[]): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot reorder recipes.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to reorder recipes.');
    }
    const wsId = this.activeWorkspaceId || 'ws-main';
    this.recipes = orderedRecipes.map((r, idx) => ({
      ...r,
      orderIndex: idx,
      workspaceId: r.workspaceId || wsId,
    }));
    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();

    for (const recipe of this.recipes) {
      setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipe)).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`)
      );
    }
  }

  public async standardizeAllRecipeIngredients(targetUnit: WeightUnit, decimalPlaces?: number): Promise<number> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot modify recipes.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to modify recipes.');
    }
    let convertedCount = 0;
    this.recipes = this.recipes.map((recipe) => {
      const standardizedIngredients = standardizeIngredientsToUnit(
        recipe.ingredients,
        targetUnit,
        decimalPlaces !== undefined ? decimalPlaces : this.settings.decimalPlaces
      );
      convertedCount += recipe.ingredients.length;
      return {
        ...recipe,
        ingredients: standardizedIngredients,
        updatedAt: new Date().toISOString(),
      };
    });

    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();

    for (const recipe of this.recipes) {
      setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipe)).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`)
      );
    }

    return convertedCount;
  }

  public async duplicateRecipe(id: string): Promise<Recipe | undefined> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot duplicate recipes.');
    }
    const original = this.getRecipe(id);
    if (!original) return undefined;

    const duplicate: Recipe = {
      ...original,
      id: `recipe-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: `${original.name} (Copy)`,
      workspaceId: original.workspaceId || this.activeWorkspaceId || 'ws-main',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveRecipe(duplicate);
    return duplicate;
  }

  public async archiveRecipe(id: string, archived = true): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot archive recipes.');
    }
    const recipe = this.getRecipe(id);
    if (!recipe) return;
    recipe.archived = archived;
    await this.saveRecipe(recipe);
  }

  public async deleteRecipe(id: string): Promise<void> {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      throw new Error(
        'Permission denied: Only workspace owners can permanently delete recipes. Editors can archive recipes instead.'
      );
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete recipes.');
    }

    try {
      if (this.customRecipeDeleteAdapterForTesting && this.isDevOrTestEnvironment()) {
        await this.customRecipeDeleteAdapterForTesting(id);
      } else {
        await deleteDoc(doc(db, 'recipes', id));
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `recipes/${id}`);
      } catch {
        // Propagate clean error to caller without mutating local state
      }
      throw err;
    }

    this.recipes = this.recipes.filter((r) => r.id !== id);
    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();
  }

  // --- Recipe Categories & Authoritative Workspace Preset Routing API ---
  public getCategoryPresetMap(workspaceId?: string): Record<string, string | string[]> {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId) || null
      : this.getActiveWorkspace();
    return resolveWorkspaceCategoryPresetMap(ws);
  }

  public inspectPendingCategoryMappingMigration(
    workspaceId?: string
  ): CategoryMappingMigrationInspection {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId) || null
      : this.getActiveWorkspace();
    return inspectCategoryMappingMigration(ws, this.settings?.categoryPresetMap);
  }

  public async saveWorkspaceCategoryPresetMap(
    newMap: Record<string, string | string[]>,
    recipeCategories?: string[],
    userRoleOverride?: AccessRole
  ): Promise<void> {
    const role = userRoleOverride ?? this.getUserRole();
    assertCanModifyWorkspaceCategoryMap(role);

    const currentUser = auth.currentUser;
    if (currentUser && currentUser.uid) {
      if (!this.isAuthorized()) {
        throw new Error('Unauthorized: You do not have an active membership for this workspace.');
      }
    }

    const ws = this.getActiveWorkspace();
    if (!ws) {
      throw new Error('No active workspace found to save category preset mappings.');
    }

    const sanitizedMap = sanitizeCategoryPresetMap(newMap);
    const nowIso = new Date().toISOString();
    const cleanedCategories =
      recipeCategories !== undefined
        ? Array.from(new Set(recipeCategories.map((c) => c.trim()).filter(Boolean)))
        : ws.recipeCategories;

    const updatedWs: Workspace = {
      ...ws,
      categoryPresetMap: sanitizedMap,
      ...(cleanedCategories !== undefined ? { recipeCategories: cleanedCategories } : {}),
      updatedAt: nowIso,
    };

    const idx = this.workspaces.findIndex((w) => w.id === ws.id);
    if (idx >= 0) {
      const nextWorkspaces = [...this.workspaces];
      nextWorkspaces[idx] = updatedWs;
      this.workspaces = nextWorkspaces;
    } else {
      this.workspaces = [...this.workspaces, updatedWs];
    }
    setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);

    // Align local user settings copy for this active workspace so stale local differences do not resurface
    this.settings = {
      ...this.settings,
      categoryPresetMap: sanitizedMap,
      ...(cleanedCategories !== undefined ? { recipeCategories: cleanedCategories } : {}),
      updatedAt: nowIso,
    };
    setLocal(STORAGE_KEYS.SETTINGS, this.settings);

    if (currentUser?.uid) {
      const wsRef = doc(db, 'workspaces', updatedWs.id);
      const updatePayload: Record<string, any> = {
        categoryPresetMap: sanitizeForFirestore(sanitizedMap),
        updatedAt: nowIso,
      };
      if (cleanedCategories !== undefined) {
        updatePayload.recipeCategories = sanitizeForFirestore(cleanedCategories);
      }
      try {
        await updateDoc(wsRef, updatePayload);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `workspaces/${updatedWs.id}`);
        throw err;
      }
    }

    this.notify();
  }

  public async approveCategoryMappingMigration(
    selectedCategories?: string[],
    userRoleOverride?: AccessRole
  ): Promise<void> {
    const role = userRoleOverride ?? this.getUserRole();
    assertCanModifyWorkspaceCategoryMap(role);

    const inspection = this.inspectPendingCategoryMappingMigration();
    if (!inspection.hasDifferences) return;

    const nextMap: Record<string, string | string[]> = {
      ...sanitizeCategoryPresetMap(inspection.authoritativeWorkspaceMap),
    };

    const allowedSet = selectedCategories
      ? new Set(selectedCategories.map((c) => c.trim().toLowerCase()))
      : null;

    for (const diff of inspection.diffs) {
      if (allowedSet && !allowedSet.has(diff.category.toLowerCase())) {
        continue;
      }
      nextMap[diff.category] =
        diff.localProposedTargets.length === 1
          ? diff.localProposedTargets[0]
          : diff.localProposedTargets;
    }

    await this.saveWorkspaceCategoryPresetMap(nextMap, undefined, role);
  }

  public discardLocalCategoryMappingDifferences(): void {
    const authoritative = this.getCategoryPresetMap();
    this.settings = {
      ...this.settings,
      categoryPresetMap: sanitizeCategoryPresetMap(authoritative),
      updatedAt: new Date().toISOString(),
    };
    setLocal(STORAGE_KEYS.SETTINGS, this.settings);
    this.notify();
  }

  public getRecipeCategories(workspaceId?: string): string[] {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId) || null
      : this.getActiveWorkspace();

    const fromWorkspace = new Set<string>();
    const targetWsId = ws?.id || this.activeWorkspaceId;

    this.recipes.forEach((r) => {
      if (r.workspaceId && targetWsId && r.workspaceId !== targetWsId) return;
      if (r.category && r.category.trim()) {
        fromWorkspace.add(r.category.trim());
      }
    });

    if (ws?.recipeCategories && Array.isArray(ws.recipeCategories)) {
      ws.recipeCategories.forEach((c) => {
        if (c && c.trim()) fromWorkspace.add(c.trim());
      });
    }

    if (ws?.categoryPresetMap && typeof ws.categoryPresetMap === 'object') {
      Object.keys(ws.categoryPresetMap).forEach((k) => {
        if (k && k.trim()) fromWorkspace.add(k.trim());
      });
    }

    return Array.from(fromWorkspace);
  }

  public async addRecipeCategory(newCategory: string, defaultPresetCategories: string[] = ['All']): Promise<void> {
    assertCanModifyWorkspaceCategoryMap(this.getUserRole());
    const cleanName = newCategory.trim();
    if (!cleanName) return;

    const currentList = this.getRecipeCategories();
    const updatedList = Array.from(new Set([...currentList, cleanName]));

    const currentMap = { ...this.getCategoryPresetMap() };
    if (!currentMap[cleanName]) {
      currentMap[cleanName] = defaultPresetCategories;
    }

    await this.saveWorkspaceCategoryPresetMap(currentMap, updatedList);
  }

  public async renameRecipeCategory(oldCategory: string, newCategory: string): Promise<number> {
    assertCanModifyWorkspaceCategoryMap(this.getUserRole());
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to rename categories.');
    }
    const cleanOld = oldCategory.trim();
    const cleanNew = newCategory.trim();
    if (!cleanNew || cleanOld.toLowerCase() === cleanNew.toLowerCase()) return 0;

    // 1. Update all recipes that use this category
    let affectedCount = 0;
    this.recipes = this.recipes.map((recipe) => {
      if ((recipe.category || '').trim().toLowerCase() === cleanOld.toLowerCase()) {
        affectedCount++;
        const updated = { ...recipe, category: cleanNew, updatedAt: new Date().toISOString() };
        // Sync to cloud in background
        setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(updated)).catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`)
        );
        return updated;
      }
      return recipe;
    });

    setLocal(STORAGE_KEYS.RECIPES, this.recipes);

    // 2. Update workspace category list & categoryPresetMap
    const currentList = this.getRecipeCategories();
    const updatedList = currentList.map((c) => (c.toLowerCase() === cleanOld.toLowerCase() ? cleanNew : c));
    if (!updatedList.includes(cleanNew)) {
      updatedList.push(cleanNew);
    }

    const currentMap = { ...this.getCategoryPresetMap() };
    const existingMapping = currentMap[cleanOld] || currentMap[oldCategory];
    delete currentMap[cleanOld];
    delete currentMap[oldCategory];
    if (existingMapping) {
      currentMap[cleanNew] = existingMapping;
    }

    await this.saveWorkspaceCategoryPresetMap(currentMap, Array.from(new Set(updatedList)));

    this.notify();
    return affectedCount;
  }

  public async deleteRecipeCategory(categoryToDelete: string, reassignToCategory?: string): Promise<number> {
    assertCanModifyWorkspaceCategoryMap(this.getUserRole());
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete categories.');
    }
    const cleanCat = categoryToDelete.trim();
    const replacement = reassignToCategory ? reassignToCategory.trim() : 'Uncategorized';

    // 1. Update recipes
    let affectedCount = 0;
    this.recipes = this.recipes.map((recipe) => {
      if ((recipe.category || '').trim().toLowerCase() === cleanCat.toLowerCase()) {
        affectedCount++;
        const updated = { ...recipe, category: replacement, updatedAt: new Date().toISOString() };
        setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(updated)).catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`)
        );
        return updated;
      }
      return recipe;
    });

    setLocal(STORAGE_KEYS.RECIPES, this.recipes);

    // 2. Remove from workspace category list & categoryPresetMap
    const currentList = this.getRecipeCategories();
    const updatedList = currentList.filter((c) => c.toLowerCase() !== cleanCat.toLowerCase());

    const currentMap = { ...this.getCategoryPresetMap() };
    delete currentMap[cleanCat];
    delete currentMap[categoryToDelete];

    await this.saveWorkspaceCategoryPresetMap(currentMap, updatedList);

    this.notify();
    return affectedCount;
  }

  // --- Presets API ---
  public getPresets(): ProductionPreset[] {
    if (!this.isAuthorized()) return [];
    const wsId = this.getActiveWorkspaceId();
    return this.presets
      .filter((p) => !p.workspaceId || p.workspaceId === wsId)
      .map((p) => {
        const normCat = normalizePresetCategory(p);
        return p.category === normCat ? p : { ...p, category: normCat };
      });
  }

  public generatePresetId(): string {
    const cryptoOverride = this.isDevOrTestEnvironment()
      ? this.presetCryptoOverrideForTesting
      : undefined;
    return generateCollisionResistantPresetId(
      this.presets.map((p) => p.id),
      cryptoOverride
    );
  }

  private generateSecureCriticalNoteId(): string {
    const cryptoOverride = this.isDevOrTestEnvironment()
      ? this.presetCryptoOverrideForTesting
      : undefined;
    return `cpn-${generateCryptographicallySecureUuidV4(cryptoOverride)}`;
  }

  private async executePresetTransaction(
    presetId: string,
    mutator: (remotePreset: ProductionPreset | null) => ProductionPreset
  ): Promise<ProductionPreset> {
    if (this.customPresetCloudAdapter && this.isDevOrTestEnvironment()) {
      return this.customPresetCloudAdapter.transactPreset(presetId, mutator);
    }

    const presetRef = doc(db, 'presets', presetId);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(presetRef);
      const current = snap.exists()
        ? ({ ...(snap.data() as ProductionPreset), id: snap.id } as ProductionPreset)
        : null;
      const updated = mutator(current);
      tx.set(presetRef, sanitizeForFirestore(updated));
      return updated;
    });
  }

  /**
   * Creates a brand-new packaging preset WITHOUT calling `tx.get(presetRef)` on a nonexistent
   * document (which would fail `/firestore.rules` `allow read` when `resource == null`).
   *
   * IMPORTANT ARCHITECTURAL NOTE ON `setDoc()` SEMANTICS:
   * - The Firebase Web SDK `setDoc(doc(db, 'presets', cleanId), ...)` is NOT a server-enforced
   *   create-only operation (unlike Admin SDK `.create()`), and `/firestore.rules` currently
   *   evaluates `allow create` only when the document does not yet exist while permitting
   *   `allow update` for same-workspace Owners/Editors.
   * - True server-side create-only atomicity cannot be guaranteed purely from the Web SDK
   *   without modifying `firestore.rules` or routing through a trusted Admin SDK endpoint.
   * - Collision risk is mitigated client-side by requiring `presetsHydrationState === 'READY'`,
   *   checking all hydrated workspace preset IDs (`PresetCreationConflictError`), and generating
   *   IDs exclusively via 122-bit CSPRNG RFC 4122 v4 UUIDs (`generatePresetId()`), failing
   *   closed (`InsecureUuidUnavailableError`) if Web Crypto CSPRNG is unavailable.
   */
  public async createPreset(preset: ProductionPreset): Promise<ProductionPreset> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify presets.');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save presets.');
    }
    const wsId = (this.activeWorkspaceId || '').trim() || 'ws-main';
    if (preset.workspaceId && preset.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Cannot create a preset belonging to another workspace.');
    }
    if (this.presetsHydrationState !== 'READY') {
      throw new Error(
        this.presetsHydrationState === 'LOADING'
          ? 'Cannot create preset while workspace presets are still loading from Cloud Firestore.'
          : 'Cannot create preset while Cloud Firestore preset synchronization is unavailable.'
      );
    }

    const cleanId = (preset.id || '').trim() || this.generatePresetId();
    if (this.presets.some((existing) => existing.id === cleanId)) {
      throw new PresetCreationConflictError(
        `Conflict: A preset with ID "${cleanId}" already exists in this workspace. Creation will not overwrite an existing preset.`,
        cleanId
      );
    }

    const nowIso = new Date().toISOString();
    const validatedStagedNotes: CriticalProductionNote[] = [];

    if (Array.isArray(preset.criticalNotes)) {
      for (const rawNote of preset.criticalNotes) {
        if (!rawNote || typeof rawNote.note !== 'string') continue;
        const trimmedText = rawNote.note.trim();
        if (!trimmedText) continue;

        if (rawNote.presetId && rawNote.presetId !== cleanId) {
          throw new Error(
            `Stale Critical Production Note detected from preset "${rawNote.presetId}". Refusing to copy foreign notes onto new preset "${cleanId}".`
          );
        }
        if (rawNote.workspaceId && rawNote.workspaceId !== wsId) {
          throw new Error('Workspace isolation violation: Staged Critical Production Note belongs to another workspace.');
        }

        const cleanRecipeId = (rawNote.recipeId || '').trim();
        if (!cleanRecipeId) {
          throw new Error('Invalid Critical Production Note: recipeId is required.');
        }
        const targetRecipe = this.recipes.find((r) => r.id === cleanRecipeId);
        if (!targetRecipe || (targetRecipe.workspaceId && targetRecipe.workspaceId !== wsId)) {
          throw new Error(
            `Invalid recipeId: Recipe "${cleanRecipeId}" does not exist in the active workspace.`
          );
        }

        validatedStagedNotes.push({
          id:
            (rawNote.id && rawNote.id.trim()) ||
            this.generateSecureCriticalNoteId(),
          presetId: cleanId,
          recipeId: cleanRecipeId,
          workspaceId: wsId,
          note: trimmedText,
          createdAt: rawNote.createdAt || nowIso,
          updatedAt: nowIso,
          createdBy: rawNote.createdBy || uid,
        });
      }
    }

    const normCat = normalizePresetCategory(preset);
    const newPreset: ProductionPreset = {
      ...preset,
      id: cleanId,
      category: normCat,
      productionEnabled: preset.productionEnabled !== false,
      criticalNotes: validatedStagedNotes,
      userId: uid,
      workspaceId: wsId,
      createdAt: preset.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      let persistedPreset = newPreset;
      if (this.customPresetCloudAdapter && this.isDevOrTestEnvironment()) {
        if (!this.customPresetCloudAdapter.createPreset) {
          throw new Error(
            'Cloud persistence adapter must implement createPreset for new presets (transactional tx.get on nonexistent presets is prohibited by Firestore rules).'
          );
        }
        persistedPreset = await this.customPresetCloudAdapter.createPreset(newPreset);
      } else {
        await setDoc(doc(db, 'presets', cleanId), sanitizeForFirestore(newPreset));
      }

      const existingIdx = this.presets.findIndex((p) => p.id === persistedPreset.id);
      if (existingIdx >= 0) {
        const nextPresets = [...this.presets];
        nextPresets[existingIdx] = persistedPreset;
        this.presets = nextPresets;
      } else {
        this.presets = [persistedPreset, ...this.presets];
      }

      setLocal(STORAGE_KEYS.PRESETS, this.presets);
      this.notify();
      return persistedPreset;
    } catch (err) {
      if (!(err instanceof PresetCreationConflictError) && !(err instanceof CriticalNoteConflictError)) {
        try {
          handleFirestoreError(err, OperationType.CREATE, `presets/${cleanId}`);
        } catch {
          // Ensure original error propagates cleanly to caller
        }
      }
      throw err;
    }
  }

  /**
   * Updates an existing persisted packaging preset via Firestore transaction.
   * Always preserves authoritative `remotePreset.criticalNotes` so stale preset forms
   * can never overwrite newer Critical Production Notes saved concurrently.
   * Also preserves `remotePreset.productionEnabled` when `options.preserveRemoteProductionEnabled`
   * is true so unrelated modal edits do not revert concurrent Production Floor status toggles.
   */
  public async updatePreset(
    preset: ProductionPreset,
    options?: { preserveRemoteProductionEnabled?: boolean }
  ): Promise<ProductionPreset> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify presets.');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save presets.');
    }
    const wsId = (this.activeWorkspaceId || '').trim() || 'ws-main';
    if (preset.workspaceId && preset.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Cannot save a preset belonging to another workspace.');
    }

    const cleanId = (preset.id || '').trim();
    if (!cleanId) {
      throw new Error('Invalid preset ID: Cannot update a preset without an ID.');
    }

    const nowIso = new Date().toISOString();

    try {
      const savedPreset = await this.executePresetTransaction(cleanId, (remotePreset) => {
        if (!remotePreset) {
          throw new Error(
            `Cannot update preset "${cleanId}": preset no longer exists in Cloud Firestore.`
          );
        }
        if (remotePreset.workspaceId && remotePreset.workspaceId !== wsId) {
          throw new Error(
            'Workspace isolation violation: Remote preset belongs to a different workspace.'
          );
        }

        // Unconditionally preserve authoritative remote criticalNotes during packaging edits
        // so stale preset forms cannot clobber newer Critical Production Notes.
        const preservedCriticalNotes =
          remotePreset.criticalNotes !== undefined
            ? remotePreset.criticalNotes
            : preset.criticalNotes;

        const resolvedProductionEnabled = options?.preserveRemoteProductionEnabled
          ? remotePreset.productionEnabled
          : preset.productionEnabled !== undefined
          ? Boolean(preset.productionEnabled)
          : remotePreset.productionEnabled;

        const { productionEnabled: _omitFormEnabled, ...presetWithoutEnabled } = preset;

        const normCat = normalizePresetCategory(preset);
        return {
          ...remotePreset,
          ...presetWithoutEnabled,
          id: cleanId,
          category: normCat,
          ...(resolvedProductionEnabled !== undefined
            ? { productionEnabled: resolvedProductionEnabled }
            : {}),
          ...(preservedCriticalNotes !== undefined
            ? { criticalNotes: preservedCriticalNotes }
            : {}),
          userId: uid,
          workspaceId: remotePreset.workspaceId || preset.workspaceId || wsId,
          createdAt: remotePreset.createdAt || preset.createdAt || nowIso,
          updatedAt: nowIso,
        };
      });

      const index = this.presets.findIndex((p) => p.id === savedPreset.id);
      if (index >= 0) {
        const nextPresets = [...this.presets];
        nextPresets[index] = savedPreset;
        this.presets = nextPresets;
      } else {
        this.presets = [savedPreset, ...this.presets];
      }

      setLocal(STORAGE_KEYS.PRESETS, this.presets);
      this.notify();
      return savedPreset;
    } catch (err) {
      if (!(err instanceof CriticalNoteConflictError)) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `presets/${cleanId}`);
        } catch {
          // Ensure original error propagates cleanly to caller
        }
      }
      throw err;
    }
  }

  public async savePreset(
    preset: ProductionPreset,
    options?: { mode?: 'create' | 'edit'; preserveRemoteProductionEnabled?: boolean }
  ): Promise<void> {
    const resolvedMode =
      options?.mode ??
      (this.presets.some((existing) => existing.id === preset.id) ? 'edit' : 'create');

    if (resolvedMode === 'create') {
      await this.createPreset(preset);
      return;
    }

    await this.updatePreset(preset, {
      preserveRemoteProductionEnabled: options?.preserveRemoteProductionEnabled,
    });
  }

  /**
   * Shared workspace Production Floor availability toggle for a preset.
   * Allowed for active Workspace Owners and Editors; denied for Viewers.
   * Executes a Firestore transaction that updates ONLY `productionEnabled` and `updatedAt`,
   * preserving `criticalNotes`, packaging fields, recipe formulas, and production history.
   */
  public async setPresetProductionEnabled(
    presetId: string,
    enabled: boolean,
    userRoleOverride?: AccessRole | null
  ): Promise<ProductionPreset> {
    const role = userRoleOverride !== undefined ? userRoleOverride : this.getUserRole();
    if (role !== 'owner' && role !== 'editor') {
      throw new Error(
        'Permission denied: Only workspace owners and editors can enable or disable presets for Production Floor.'
      );
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid || !this.isAuthorized()) {
      throw new Error('Authentication Required: You must be signed in to update preset availability.');
    }

    const cleanId = (presetId || '').trim();
    if (!cleanId) {
      throw new Error('Invalid preset ID: A non-empty preset ID is required.');
    }

    const wsId = (this.activeWorkspaceId || '').trim() || 'ws-main';
    const localPreset = this.presets.find((p) => p.id === cleanId);
    if (localPreset && localPreset.workspaceId && localPreset.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Cannot modify a preset belonging to another workspace.');
    }

    const nowIso = new Date().toISOString();
    const targetEnabled = Boolean(enabled);

    try {
      const savedPreset = await this.executePresetTransaction(cleanId, (remotePreset) => {
        if (!remotePreset) {
          throw new Error(
            `Cannot update preset "${cleanId}": preset no longer exists in Cloud Firestore.`
          );
        }
        if (remotePreset.workspaceId && remotePreset.workspaceId !== wsId) {
          throw new Error(
            'Workspace isolation violation: Remote preset belongs to a different workspace.'
          );
        }

        const normCat = normalizePresetCategory(remotePreset);
        return {
          ...remotePreset,
          id: cleanId,
          category: normCat,
          productionEnabled: targetEnabled,
          workspaceId: remotePreset.workspaceId || wsId,
          updatedAt: nowIso,
        };
      });

      const index = this.presets.findIndex((p) => p.id === savedPreset.id);
      if (index >= 0) {
        const nextPresets = [...this.presets];
        nextPresets[index] = savedPreset;
        this.presets = nextPresets;
      } else {
        this.presets = [savedPreset, ...this.presets];
      }

      setLocal(STORAGE_KEYS.PRESETS, this.presets);
      this.notify();
      return savedPreset;
    } catch (err) {
      if (!(err instanceof CriticalNoteConflictError)) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `presets/${cleanId}`);
        } catch {
          // Ensure original error propagates cleanly to caller
        }
      }
      throw err;
    }
  }

  /**
   * Permanent preset deletion is strictly restricted to active Workspace Owners.
   * Editors should disable presets for Production Floor (`setPresetProductionEnabled(id, false)`)
   * so packaging specs, Critical Production Notes, and historical context are preserved.
   */
  public async deletePreset(id: string): Promise<void> {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      throw new Error(
        'Permission denied: Only workspace owners can permanently delete presets. Editors can disable presets on the Production Floor instead.'
      );
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete presets.');
    }
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new Error('Invalid preset ID: A non-empty preset ID is required to delete.');
    }

    const wsId = (this.activeWorkspaceId || '').trim() || 'ws-main';
    const localPreset = this.presets.find((p) => p.id === cleanId);
    if (localPreset && localPreset.workspaceId && localPreset.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Cannot delete a preset belonging to another workspace.');
    }

    try {
      if (this.customPresetCloudAdapter?.deletePreset && this.isDevOrTestEnvironment()) {
        await this.customPresetCloudAdapter.deletePreset(cleanId);
      } else {
        await deleteDoc(doc(db, 'presets', cleanId));
      }
      this.presets = this.presets.filter((p) => p.id !== cleanId);
      setLocal(STORAGE_KEYS.PRESETS, this.presets);
      this.notify();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `presets/${cleanId}`);
      } catch {
        // Propagate error
      }
      throw err;
    }
  }

  // --- Critical Production Notes & Safety Hydration API ---
  public getRecipesHydrationState(): FirestoreHydrationState {
    return this.recipesHydrationState;
  }

  public getPresetsHydrationState(): FirestoreHydrationState {
    return this.presetsHydrationState;
  }

  public getSafetyHydrationGateState(): FirestoreHydrationState {
    return resolveSafetyHydrationGateState({
      recipesHydrationState: this.recipesHydrationState,
      presetsHydrationState: this.presetsHydrationState,
      syncError: this.getCriticalNotesSyncError(),
    });
  }

  public isSafetyConnectionVerified(): boolean {
    return (
      this.recipesHydrationState === 'READY' &&
      this.presetsHydrationState === 'READY' &&
      this.recipesConnectionVerified &&
      this.presetsConnectionVerified &&
      !this.getCriticalNotesSyncError()
    );
  }

  public getSafetyConnectionStatus(): SafetyConnectionStatus {
    return this.isSafetyConnectionVerified() ? 'VERIFIED' : 'UNVERIFIED';
  }

  public getSafetyOperationalGateState(): SafetyOperationalGateState {
    return resolveSafetyOperationalGateState({
      recipesHydrationState: this.recipesHydrationState,
      presetsHydrationState: this.presetsHydrationState,
      syncError: this.getCriticalNotesSyncError(),
      connectionVerified: this.isSafetyConnectionVerified(),
    });
  }

  public isSafetyReconnectingState(): boolean {
    return this.isSafetyReconnecting || this.safetyRetryTimer !== null;
  }

  public isSafetyRetryScheduled(): boolean {
    return this.safetyRetryTimer !== null;
  }

  public getSafetyRetryAttemptCount(): number {
    return this.safetyRetryAttempt;
  }

  public getSafetySyncStatusLabel(): SafetySyncStatusLabel {
    return resolveSafetySyncStatusLabel({
      operationalState: this.getSafetyOperationalGateState(),
      isReconnecting: this.isSafetyReconnectingState(),
    });
  }

  public getCriticalNotesSyncError(): string | null {
    return this.presetsSyncError || this.recipesSyncError || null;
  }

  public getCriticalProductionNotes(): CriticalProductionNote[] {
    if (!this.isAuthorized()) return [];
    const wsId = this.getActiveWorkspaceId();
    if (!wsId) return [];
    return extractCanonicalCriticalNotesFromPresets(this.presets, wsId);
  }

  public getCriticalNotesForPresetAndRecipe(
    presetId: string | null | undefined,
    recipeId: string | null | undefined
  ): CriticalProductionNote[] {
    if (!this.isAuthorized() || !presetId || !recipeId) return [];
    const wsId = this.getActiveWorkspaceId();
    if (!wsId) return [];
    return getCanonicalNotesForPresetAndRecipe(this.presets, presetId, recipeId, wsId);
  }

  public getCriticalNotesForPreset(presetId: string | null | undefined): CriticalProductionNote[] {
    if (!this.isAuthorized() || !presetId) return [];
    const wsId = this.getActiveWorkspaceId();
    if (!wsId) return [];
    return getCanonicalNotesForPreset(this.presets, presetId, wsId);
  }

  public getCriticalNotesForRecipe(recipeId: string | null | undefined): CriticalProductionNote[] {
    if (!this.isAuthorized() || !recipeId) return [];
    const wsId = this.getActiveWorkspaceId();
    if (!wsId) return [];
    return getCanonicalNotesForRecipe(this.presets, recipeId, wsId);
  }

  public async saveCriticalProductionNote(
    noteData: {
      id?: string;
      presetId: string;
      recipeId: string;
      note: string;
      createdAt?: string;
      createdBy?: string;
      expectedUpdatedAt?: string | null;
    },
    userRole?: AccessRole
  ): Promise<CriticalProductionNote> {
    const effectiveRole = userRole ?? this.getUserRole();
    if (!effectiveRole || effectiveRole === 'viewer') {
      throw new Error('Unauthorized: Viewers cannot create or edit Critical Production Notes.');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid || !this.isAuthorized()) {
      throw new Error(
        'Authentication Required: You must be an authorized workspace Editor or Owner to save Critical Production Notes.'
      );
    }

    const wsId = (this.activeWorkspaceId || '').trim();
    if (!wsId) {
      throw new Error('No active workspace selected.');
    }

    const cleanPresetId = (noteData.presetId || '').trim();
    const cleanRecipeId = (noteData.recipeId || '').trim();
    const cleanNoteText = typeof noteData.note === 'string' ? noteData.note.trim() : '';

    if (!cleanPresetId || !cleanRecipeId || !cleanNoteText) {
      throw new Error('Invalid note data: presetId, recipeId, and non-empty note content are required.');
    }

    const localPreset = this.presets.find((p) => p.id === cleanPresetId);
    if (!localPreset) {
      throw new Error(`Invalid presetId: Preset "${cleanPresetId}" does not exist in the active workspace.`);
    }
    if (localPreset.workspaceId && localPreset.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Preset belongs to another workspace.');
    }

    const targetRecipe = this.recipes.find((r) => r.id === cleanRecipeId);
    if (!targetRecipe) {
      throw new Error(`Invalid recipeId: Recipe "${cleanRecipeId}" does not exist in the active workspace.`);
    }
    if (targetRecipe.workspaceId && targetRecipe.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Recipe belongs to another workspace.');
    }

    const nowIso = new Date().toISOString();
    let committedNote: CriticalProductionNote | null = null;

    try {
      const updatedPreset = await this.executePresetTransaction(cleanPresetId, (remotePreset) => {
        const basePreset = remotePreset || localPreset;
        if (basePreset.workspaceId && basePreset.workspaceId !== wsId) {
          throw new Error(
            'Workspace isolation violation: Remote preset belongs to a different workspace.'
          );
        }

        const existingNotes = Array.isArray(basePreset.criticalNotes)
          ? [...basePreset.criticalNotes]
          : [];

        // Match by explicit note ID first, otherwise by (presetId, recipeId) pair
        let matchIndex = noteData.id
          ? existingNotes.findIndex((n) => n && n.id === noteData.id)
          : -1;
        if (matchIndex < 0) {
          matchIndex = existingNotes.findIndex((n) => n && n.recipeId === cleanRecipeId);
        }

        const existingRemote = matchIndex >= 0 ? existingNotes[matchIndex] : null;

        // Optimistic concurrency protection when expectedUpdatedAt is supplied
        if (noteData.expectedUpdatedAt !== undefined) {
          if (noteData.expectedUpdatedAt === null && existingRemote) {
            throw new CriticalNoteConflictError(
              'Conflict detected: Another device already created a Critical Production Note for this preset and recipe. Please review the latest cloud note before saving.',
              {
                presetId: cleanPresetId,
                recipeId: cleanRecipeId,
                remoteNote: existingRemote,
              }
            );
          }
          if (typeof noteData.expectedUpdatedAt === 'string') {
            if (!existingRemote) {
              throw new CriticalNoteConflictError(
                'Conflict detected: This Critical Production Note was deleted on another device while you were editing it.',
                {
                  presetId: cleanPresetId,
                  recipeId: cleanRecipeId,
                  remoteNote: null,
                }
              );
            }
            const remoteTs = existingRemote.updatedAt || existingRemote.createdAt || '';
            if (remoteTs !== noteData.expectedUpdatedAt) {
              throw new CriticalNoteConflictError(
                'Conflict detected: This Critical Production Note was modified on another device. Refresh and review the latest version before overwriting.',
                {
                  presetId: cleanPresetId,
                  recipeId: cleanRecipeId,
                  remoteNote: existingRemote,
                }
              );
            }
          }
        }

        if (existingRemote && matchIndex >= 0) {
          committedNote = {
            ...existingRemote,
            id: existingRemote.id,
            presetId: cleanPresetId,
            recipeId: cleanRecipeId,
            workspaceId: wsId,
            note: cleanNoteText,
            createdAt: existingRemote.createdAt || noteData.createdAt || nowIso,
            updatedAt: nowIso,
            createdBy: existingRemote.createdBy || noteData.createdBy || uid,
          };
          existingNotes[matchIndex] = committedNote;
        } else {
          committedNote = {
            id:
              (noteData.id && noteData.id.trim()) ||
              this.generateSecureCriticalNoteId(),
            presetId: cleanPresetId,
            recipeId: cleanRecipeId,
            workspaceId: wsId,
            note: cleanNoteText,
            createdAt: noteData.createdAt || nowIso,
            updatedAt: nowIso,
            createdBy: noteData.createdBy || uid,
          };
          existingNotes.push(committedNote);
        }

        return {
          ...basePreset,
          workspaceId: basePreset.workspaceId || wsId,
          criticalNotes: existingNotes,
          updatedAt: nowIso,
        };
      });

      if (!committedNote) {
        throw new Error('Failed to commit Critical Production Note transaction.');
      }

      // Only update in-memory canonical state AFTER verified cloud persistence succeeds
      const presetIdx = this.presets.findIndex((p) => p.id === updatedPreset.id);
      if (presetIdx >= 0) {
        const nextPresets = [...this.presets];
        nextPresets[presetIdx] = updatedPreset;
        this.presets = nextPresets;
      } else {
        this.presets = [updatedPreset, ...this.presets];
      }
      setLocal(STORAGE_KEYS.PRESETS, this.presets);
      this.notify();
      return committedNote;
    } catch (err) {
      if (!(err instanceof CriticalNoteConflictError)) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `presets/${cleanPresetId}`);
        } catch {
          // Ensure error propagates cleanly to caller
        }
      }
      throw err;
    }
  }

  public async deleteCriticalProductionNote(
    noteId: string,
    userRole?: AccessRole,
    options?: {
      presetId?: string;
      expectedUpdatedAt?: string;
    }
  ): Promise<void> {
    const effectiveRole = userRole ?? this.getUserRole();
    if (!effectiveRole || effectiveRole === 'viewer') {
      throw new Error('Unauthorized: Viewers cannot delete Critical Production Notes.');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid || !this.isAuthorized()) {
      throw new Error(
        'Authentication Required: You must be an authorized workspace Editor or Owner to delete Critical Production Notes.'
      );
    }

    const wsId = (this.activeWorkspaceId || '').trim();
    if (!wsId) {
      throw new Error('No active workspace selected.');
    }

    const cleanNoteId = (noteId || '').trim();
    if (!cleanNoteId) {
      throw new Error('Invalid noteId: A non-empty note ID is required to delete.');
    }

    const targetPreset = options?.presetId
      ? this.presets.find((p) => p.id === options.presetId)
      : this.presets.find(
          (p) =>
            (!p.workspaceId || p.workspaceId === wsId) &&
            Array.isArray(p.criticalNotes) &&
            p.criticalNotes.some((n) => n && n.id === cleanNoteId)
        );

    if (!targetPreset) {
      return;
    }
    if (targetPreset.workspaceId && targetPreset.workspaceId !== wsId) {
      throw new Error('Workspace isolation violation: Preset belongs to another workspace.');
    }

    const nowIso = new Date().toISOString();

    try {
      const updatedPreset = await this.executePresetTransaction(targetPreset.id, (remotePreset) => {
        const basePreset = remotePreset || targetPreset;
        if (basePreset.workspaceId && basePreset.workspaceId !== wsId) {
          throw new Error(
            'Workspace isolation violation: Remote preset belongs to a different workspace.'
          );
        }

        const existingNotes = Array.isArray(basePreset.criticalNotes)
          ? [...basePreset.criticalNotes]
          : [];
        const existingRemote = existingNotes.find((n) => n && n.id === cleanNoteId) || null;

        if (existingRemote && options?.expectedUpdatedAt !== undefined) {
          const remoteTs = existingRemote.updatedAt || existingRemote.createdAt || '';
          if (remoteTs !== options.expectedUpdatedAt) {
            throw new CriticalNoteConflictError(
              'Conflict detected: This Critical Production Note was edited on another device before deletion. Please review the updated note first.',
              {
                presetId: targetPreset.id,
                recipeId: existingRemote.recipeId,
                remoteNote: existingRemote,
              }
            );
          }
        }

        const nextNotes = existingNotes.filter((n) => n && n.id !== cleanNoteId);
        return {
          ...basePreset,
          workspaceId: basePreset.workspaceId || wsId,
          criticalNotes: nextNotes,
          updatedAt: nowIso,
        };
      });

      const presetIdx = this.presets.findIndex((p) => p.id === updatedPreset.id);
      if (presetIdx >= 0) {
        const nextPresets = [...this.presets];
        nextPresets[presetIdx] = updatedPreset;
        this.presets = nextPresets;
        setLocal(STORAGE_KEYS.PRESETS, this.presets);
      }
      this.notify();
    } catch (err) {
      if (!(err instanceof CriticalNoteConflictError)) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `presets/${targetPreset.id}`);
        } catch {
          // Ensure error propagates cleanly to caller
        }
      }
      throw err;
    }
  }

  // --- Owner-Only Critical Production Notes Reconciliation API ---
  public inspectCriticalNotesReconciliation(
    userRoleOverride?: AccessRole
  ): CriticalNotesReconciliationReport {
    const role = userRoleOverride ?? this.getUserRole();
    const wsId = this.getActiveWorkspaceId();
    return inspectCriticalNotesReconciliation({
      userRole: role,
      activeWorkspaceId: wsId,
      storage: this.getEffectiveStorage(),
      cloudPresets: this.getPresets(),
      recipes: this.getRecipes(),
    });
  }

  public async applyCriticalNotesReconciliationDecisions(
    decisions: Record<string, OwnerReconciliationAction>,
    manualNoteOverrides?: Record<string, string>,
    userRoleOverride?: AccessRole
  ): Promise<ReconciliationExecutionResult> {
    const role = userRoleOverride ?? this.getUserRole();
    assertOwnerCanReconcileCriticalNotes(role);

    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid || !this.isAuthorized()) {
      throw new Error('Authentication Required: Owner must be signed in to reconcile Critical Production Notes.');
    }

    const report = this.inspectCriticalNotesReconciliation(role);
    const summary: ReconciliationExecutionResult = {
      promotedCount: 0,
      keptCloudCount: 0,
      leftUnchangedCount: 0,
      manualReviewDeferredCount: 0,
      promotedNoteIds: [],
    };

    for (const item of report.items) {
      const chosenAction = decisions[item.itemKey];
      if (!chosenAction) continue;

      if (chosenAction === 'leave_unchanged') {
        summary.leftUnchangedCount++;
        recordVerifiedReconciliationDecision(this.getEffectiveStorage(), {
          itemKey: item.itemKey,
          action: 'leave_unchanged',
          resolvedAt: new Date().toISOString(),
          resolvedByUid: uid,
          localNoteSnapshot: item.localNote?.note.trim(),
          cloudNoteSnapshot: item.cloudNote?.note.trim(),
          cloudUpdatedAt: item.cloudNote?.updatedAt,
        });
        continue;
      }

      if (chosenAction === 'keep_cloud') {
        if (!item.hasAuthoritativeCloudCopy && item.isProtected1ozBaselineNote) {
          throw new Error(
            'Safety Protection: Cannot discard the local 1 oz Chocolate Chip note via "Keep Cloud" because no authoritative cloud copy exists yet. Choose "Promote local note to shared workspace" or "Leave unchanged".'
          );
        }
        summary.keptCloudCount++;
        recordVerifiedReconciliationDecision(this.getEffectiveStorage(), {
          itemKey: item.itemKey,
          action: 'keep_cloud',
          resolvedAt: new Date().toISOString(),
          resolvedByUid: uid,
          localNoteSnapshot: item.localNote?.note.trim(),
          cloudNoteSnapshot: item.cloudNote?.note.trim(),
          cloudUpdatedAt: item.cloudNote?.updatedAt,
        });
        continue;
      }

      if (chosenAction === 'manual_review') {
        const manualText = manualNoteOverrides?.[item.itemKey]?.trim();
        if (!manualText) {
          summary.manualReviewDeferredCount++;
          continue;
        }
        if (!item.canPromoteToCloud) {
          throw new Error(
            item.cannotPromoteReason ||
              `Cannot promote manual resolution for "${item.presetName}" / "${item.recipeName}".`
          );
        }
        const expectedTs = item.cloudNote
          ? item.cloudNote.updatedAt || item.cloudNote.createdAt || ''
          : null;

        const saved = await this.saveCriticalProductionNote(
          {
            id: item.cloudNote?.id || item.localNote?.id,
            presetId: item.presetId,
            recipeId: item.recipeId,
            note: manualText,
            createdAt: item.cloudNote?.createdAt || item.localNote?.createdAt,
            createdBy: item.localNote?.createdBy || uid,
            expectedUpdatedAt: expectedTs,
          },
          role
        );
        summary.promotedCount++;
        summary.promotedNoteIds.push(saved.id);
        recordVerifiedReconciliationDecision(this.getEffectiveStorage(), {
          itemKey: item.itemKey,
          action: 'promote_local',
          resolvedAt: new Date().toISOString(),
          resolvedByUid: uid,
          localNoteSnapshot: item.localNote?.note.trim(),
          cloudNoteSnapshot: saved.note,
          cloudUpdatedAt: saved.updatedAt,
        });
        continue;
      }

      if (chosenAction === 'promote_local') {
        if (!item.localNote) {
          continue;
        }
        if (!item.canPromoteToCloud) {
          throw new Error(
            item.cannotPromoteReason ||
              `Cannot promote local note for "${item.presetName}" / "${item.recipeName}".`
          );
        }

        const expectedTs = item.cloudNote
          ? item.cloudNote.updatedAt || item.cloudNote.createdAt || ''
          : null;

        const saved = await this.saveCriticalProductionNote(
          {
            id: item.localNote.id,
            presetId: item.presetId,
            recipeId: item.recipeId,
            note: item.localNote.note,
            createdAt: item.localNote.createdAt,
            createdBy: item.localNote.createdBy || uid,
            expectedUpdatedAt: expectedTs,
          },
          role
        );
        summary.promotedCount++;
        summary.promotedNoteIds.push(saved.id);

        // Record verified cloud persistence in durable backup WITHOUT deleting local backup!
        recordVerifiedReconciliationDecision(this.getEffectiveStorage(), {
          itemKey: item.itemKey,
          action: 'promote_local',
          resolvedAt: new Date().toISOString(),
          resolvedByUid: uid,
          localNoteSnapshot: item.localNote.note.trim(),
          cloudNoteSnapshot: saved.note,
          cloudUpdatedAt: saved.updatedAt,
        });
      }
    }

    this.notify();
    return summary;
  }

  /**
   * DEVELOPMENT & AUTOMATED TEST HARNESS ONLY:
   * Configures in-memory session, simulated cloud transaction adapter, storage, and snapshot delivery
   * so unit tests can verify multi-device synchronization, concurrency conflicts, failed cloud saves,
   * role enforcement, sign-out preservation, and workspace isolation with ZERO live Firestore mutations.
   * Strictly disabled in production builds.
   */
  public configureCriticalNotesTestHarness(config: {
    session?: { uid: string; role: AccessRole; workspaceId: string } | null;
    storage?: StorageLike | null;
    cloudAdapter?: PresetCloudPersistenceAdapter | null;
    historySaveAdapter?: ((entry: ProductionHistoryEntry) => Promise<void>) | null;
    recipes?: Recipe[];
    presets?: ProductionPreset[];
    history?: ProductionHistoryEntry[];
    presetsSyncError?: string | null;
    recipesSyncError?: string | null;
    recipesHydrationState?: FirestoreHydrationState;
    presetsHydrationState?: FirestoreHydrationState;
    recipesConnectionVerified?: boolean;
    presetsConnectionVerified?: boolean;
    safetyRetryDelaysMs?: number[] | null;
    listenerRestartHook?: ((generation: number, workspaceId: string) => void) | null;
    accessValidator?: ((uid: string, workspaceId: string) => Promise<boolean> | boolean) | null;
    presetCryptoOverride?: CryptoProviderLike | null | undefined;
  }): void {
    if (!this.isDevOrTestEnvironment()) {
      console.warn('[SECURITY] Test harness configuration is strictly disabled in production builds.');
      return;
    }

    this.cancelSafetySyncRetry(true);

    if (config.storage !== undefined) {
      this.customStorageForTesting = config.storage;
    }
    if (config.cloudAdapter !== undefined) {
      this.customPresetCloudAdapter = config.cloudAdapter;
    }
    if (config.historySaveAdapter !== undefined) {
      this.customHistorySaveAdapter = config.historySaveAdapter;
    }
    if (config.safetyRetryDelaysMs !== undefined) {
      this.safetyRetryDelayOverrideMsForTesting = config.safetyRetryDelaysMs;
    }
    if (config.listenerRestartHook !== undefined) {
      this.customListenerRestartHookForTesting = config.listenerRestartHook;
    }
    if (config.accessValidator !== undefined) {
      this.customAccessValidatorForTesting = config.accessValidator;
    }
    if ('presetCryptoOverride' in config) {
      this.presetCryptoOverrideForTesting = config.presetCryptoOverride;
    }
    if (config.session !== undefined) {
      this.testSessionOverride = config.session;
      if (config.session) {
        this.activeWorkspaceId = config.session.workspaceId;
        this.settings.activeWorkspaceId = config.session.workspaceId;
      } else {
        this.resetSafetyHydrationToLoading();
      }
    }
    if (config.recipes !== undefined) {
      this.recipes = [...config.recipes];
    }
    if (config.presets !== undefined) {
      this.presets = config.presets.map((p) => {
        const normCat = normalizePresetCategory(p);
        return p.category === normCat ? { ...p } : { ...p, category: normCat };
      });
    }
    if (config.history !== undefined) {
      this.history = [...config.history];
    }
    if (config.presetsSyncError !== undefined) {
      this.presetsSyncError = config.presetsSyncError;
    }
    if (config.recipesSyncError !== undefined) {
      this.recipesSyncError = config.recipesSyncError;
    }

    if (config.recipesHydrationState !== undefined) {
      this.recipesHydrationState = config.recipesHydrationState;
    } else if (config.recipesSyncError) {
      this.recipesHydrationState = 'ERROR';
    } else if (config.recipes !== undefined && config.session !== null) {
      this.recipesHydrationState = 'READY';
    }

    if (config.presetsHydrationState !== undefined) {
      this.presetsHydrationState = config.presetsHydrationState;
    } else if (config.presetsSyncError) {
      this.presetsHydrationState = 'ERROR';
    } else if (config.presets !== undefined && config.session !== null) {
      this.presetsHydrationState = 'READY';
    }

    if (this.recipesHydrationState === 'READY') {
      this.recipesServerConfirmedInWorkspace = true;
      this.recipesConnectionVerified =
        config.recipesConnectionVerified !== undefined ? config.recipesConnectionVerified : true;
    } else {
      this.recipesServerConfirmedInWorkspace = false;
      this.recipesConnectionVerified = false;
    }

    if (this.presetsHydrationState === 'READY') {
      this.presetsServerConfirmedInWorkspace = true;
      this.presetsConnectionVerified =
        config.presetsConnectionVerified !== undefined ? config.presetsConnectionVerified : true;
    } else {
      this.presetsServerConfirmedInWorkspace = false;
      this.presetsConnectionVerified = false;
    }

    this.notify();
  }

  /**
   * DEVELOPMENT & AUTOMATED TEST HARNESS ONLY:
   * Drives the StoreManager's snapshot/error/lifecycle handlers directly using mocked
   * Firestore snapshot metadata (`fromCache`, `hasPendingWrites`, `generation`, `workspaceId`)
   * with ZERO live Firestore reads or writes.
   */
  public getListenerGenerationForTesting(): number {
    return this.isDevOrTestEnvironment() ? this.listenerGeneration : 0;
  }

  public simulateFirestoreSnapshotForTesting(params: {
    event:
      | 'recipes_snapshot'
      | 'presets_snapshot'
      | 'recipes_error'
      | 'presets_error'
      | 'listener_restart'
      | 'auth_change'
      | 'workspace_switch';
    recipes?: Recipe[];
    presets?: ProductionPreset[];
    fromCache?: boolean;
    hasPendingWrites?: boolean;
    hasDocChanges?: boolean;
    error?: Error | string;
    generation?: number;
    workspaceId?: string;
    nextUid?: string | null;
    nextRole?: AccessRole;
  }): void {
    if (!this.isDevOrTestEnvironment()) {
      return;
    }

    const gen = params.generation ?? this.listenerGeneration;
    const wsId = params.workspaceId ?? (this.activeWorkspaceId || 'ws-main');

    switch (params.event) {
      case 'listener_restart': {
        this.resetSafetyHydrationToLoading();
        this.notify();
        break;
      }
      case 'auth_change': {
        this.resetSafetyHydrationToLoading();
        if (params.nextUid) {
          this.testSessionOverride = {
            uid: params.nextUid,
            role: params.nextRole || this.testSessionOverride?.role || 'owner',
            workspaceId: wsId,
          };
          this.activeWorkspaceId = wsId;
          this.settings.activeWorkspaceId = wsId;
        } else {
          this.testSessionOverride = null;
          this.clearProductionRecordsFromMemory();
        }
        this.notify();
        break;
      }
      case 'workspace_switch': {
        const targetWs = params.workspaceId || 'ws-other';
        this.clearProductionRecordsFromMemory();
        this.activeWorkspaceId = targetWs;
        this.settings.activeWorkspaceId = targetWs;
        if (this.testSessionOverride) {
          this.testSessionOverride = {
            ...this.testSessionOverride,
            workspaceId: targetWs,
          };
        }
        this.resetSafetyHydrationToLoading();
        this.notify();
        break;
      }
      case 'recipes_snapshot': {
        const docs = (params.recipes || []).map((r) => ({ id: r.id, data: r }));
        this.handleRecipesSnapshot(
          docs,
          {
            fromCache: Boolean(params.fromCache),
            hasPendingWrites: Boolean(params.hasPendingWrites),
          },
          params.hasDocChanges ?? true,
          gen,
          wsId
        );
        break;
      }
      case 'presets_snapshot': {
        const docs = (params.presets || []).map((p) => ({ id: p.id, data: p }));
        this.handlePresetsSnapshot(
          docs,
          {
            fromCache: Boolean(params.fromCache),
            hasPendingWrites: Boolean(params.hasPendingWrites),
          },
          params.hasDocChanges ?? true,
          gen,
          wsId
        );
        break;
      }
      case 'recipes_error': {
        const err =
          params.error instanceof Error
            ? params.error
            : new Error(params.error || 'Simulated recipes listener error');
        this.handleRecipesListenerError(err, gen, wsId);
        break;
      }
      case 'presets_error': {
        const err =
          params.error instanceof Error
            ? params.error
            : new Error(params.error || 'Simulated presets listener error');
        this.handlePresetsListenerError(err, gen, wsId);
        break;
      }
    }
  }

  // --- Mixers API ---
  public getMixers(): Mixer[] {
    if (!this.isAuthorized()) return [];
    return this.mixers;
  }

  public async saveMixer(mixer: Mixer): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify mixers.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save mixers.');
    }
    const userId = currentUser.uid;
    const wsId = this.activeWorkspaceId || 'ws-main';
    const mixerToSave: Mixer = {
      ...mixer,
      userId,
      workspaceId: mixer.workspaceId || wsId,
      updatedAt: new Date().toISOString(),
    };

    const index = this.mixers.findIndex((m) => m.id === mixer.id);
    if (index >= 0) {
      this.mixers[index] = mixerToSave;
    } else {
      this.mixers.unshift(mixerToSave);
    }

    setLocal(STORAGE_KEYS.MIXERS, this.mixers);
    this.notify();

    try {
      await setDoc(doc(db, 'mixers', mixer.id), sanitizeForFirestore(mixerToSave));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `mixers/${mixer.id}`);
    }
  }

  public async deleteMixer(id: string): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete mixers.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete mixers.');
    }
    this.mixers = this.mixers.filter((m) => m.id !== id);
    setLocal(STORAGE_KEYS.MIXERS, this.mixers);
    this.notify();

    try {
      await deleteDoc(doc(db, 'mixers', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `mixers/${id}`);
    }
  }

  // --- History API ---
  public getHistory(): ProductionHistoryEntry[] {
    if (!this.isAuthorized()) return [];
    return this.history;
  }

  public getHistoryEntry(id: string): ProductionHistoryEntry | undefined {
    if (!this.isAuthorized()) return undefined;
    return this.history.find((h) => h.id === id);
  }

  public async saveHistoryEntry(entry: ProductionHistoryEntry): Promise<void> {
    const userId = this.getEffectiveAuthenticatedUid();
    if (!userId) {
      throw new Error('Authentication Required: You must be signed in with Google to save production history.');
    }
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot save production history.');
    }
    const operationalGate = this.getSafetyOperationalGateState();
    if (operationalGate !== 'READY') {
      throw new Error(
        operationalGate === 'INITIAL_LOADING'
          ? SAFETY_HYDRATION_LOADING_MESSAGE
          : operationalGate === 'CONNECTION_UNVERIFIED'
          ? SAFETY_CONNECTION_UNVERIFIED_MESSAGE
          : SAFETY_HYDRATION_ERROR_MESSAGE
      );
    }

    const wsId = this.activeWorkspaceId || 'ws-main';
    const entryToSave: ProductionHistoryEntry = {
      ...entry,
      userId,
      workspaceId: entry.workspaceId || wsId,
    };

    try {
      if (this.customHistorySaveAdapter && this.isDevOrTestEnvironment()) {
        await this.customHistorySaveAdapter(entryToSave);
      } else {
        await setDoc(doc(db, 'history', entry.id), sanitizeForFirestore(entryToSave));
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `history/${entry.id}`);
      } catch {
        // Propagate error cleanly
      }
      throw err;
    }

    const index = this.history.findIndex((h) => h.id === entry.id);
    if (index >= 0) {
      this.history[index] = entryToSave;
    } else {
      this.history.unshift(entryToSave);
    }

    setLocal(STORAGE_KEYS.HISTORY, this.history);
    this.notify();
  }

  public async deleteHistoryEntry(id: string): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete production history.');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete production history.');
    }

    if (auth.currentUser?.uid) {
      try {
        await deleteDoc(doc(db, 'history', id));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.DELETE, `history/${id}`);
        } catch {
          // Propagate error cleanly without mutating local history
        }
        throw err;
      }
    }

    this.history = this.history.filter((h) => h.id !== id);
    setLocal(STORAGE_KEYS.HISTORY, this.history);
    this.notify();
  }

  // --- Settings API ---
  public getSettings(): UserSettings {
    return this.settings;
  }

  // --- Workspace Capabilities & Features API (Phase 2 Foundation) ---
  public getWorkspaceFeatures(workspaceId?: string): WorkspaceFeatures {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId) || null
      : this.getActiveWorkspace();
    return resolveWorkspaceFeatures(ws);
  }

  public hasFeature(featureKey: keyof WorkspaceFeatures, workspaceId?: string): boolean {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId) || null
      : this.getActiveWorkspace();
    return hasWorkspaceFeature(ws, featureKey);
  }

  public async setWorkspaceFeatures(
    features: Partial<WorkspaceFeatures>,
    workspaceId?: string
  ): Promise<void> {
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: You do not have an active membership for this workspace.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can configure workspace capabilities.');
    }

    const targetId = workspaceId || this.activeWorkspaceId;
    const ws = this.workspaces.find((w) => w.id === targetId) || this.getActiveWorkspace();
    if (!ws) {
      throw new Error('No active workspace found to update capabilities.');
    }

    const nowIso = new Date().toISOString();
    const updatedFeatures: WorkspaceFeatures = {
      ...resolveWorkspaceFeatures(ws),
      ...features,
    };

    const currentUser = auth.currentUser;
    if (this.customWorkspaceSettingsSaveAdapterForTesting && this.isDevOrTestEnvironment()) {
      await this.customWorkspaceSettingsSaveAdapterForTesting(ws.id, {
        features: sanitizeForFirestore(updatedFeatures),
        updatedAt: nowIso,
      });
    } else if (currentUser?.uid) {
      await updateDoc(
        doc(db, 'workspaces', ws.id),
        sanitizeForFirestore({
          features: updatedFeatures,
          updatedAt: nowIso,
        })
      );
    }

    const updatedWs: Workspace = {
      ...ws,
      features: updatedFeatures,
      updatedAt: nowIso,
    };

    const idx = this.workspaces.findIndex((w) => w.id === ws.id);
    if (idx >= 0) {
      this.workspaces[idx] = updatedWs;
    }
    setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
    this.notify();
  }

  public isProductionFloorModeEnabled(): boolean {
    const ws = this.getActiveWorkspace();
    // 1. If workspace capability 'productionFloor' is disabled, floor mode is disabled
    if (!this.hasFeature('productionFloor')) {
      return false;
    }
    // 2. If capability is enabled, respect workspace/settings toggle
    if (ws && ws.productionFloorModeEnabled !== undefined) {
      return ws.productionFloorModeEnabled !== false;
    }
    if (this.settings && this.settings.productionFloorModeEnabled !== undefined) {
      return this.settings.productionFloorModeEnabled !== false;
    }
    return true; // Authoritative default: ON (true)
  }

  public async setProductionFloorModeEnabled(enabled: boolean): Promise<void> {
    const role = this.getUserRole();
    if (role !== 'owner') {
      throw new Error(
        'Permission denied: Only workspace owners can enable or disable Production Floor Mode.'
      );
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: You do not have an active membership for this workspace.');
    }

    const nowIso = new Date().toISOString();
    const ws = this.getActiveWorkspace();
    const currentUser = auth.currentUser;

    // Persist authoritative workspace setting to Cloud Firestore BEFORE mutating local shared state
    if (ws) {
      if (this.customWorkspaceSettingsSaveAdapterForTesting && this.isDevOrTestEnvironment()) {
        await this.customWorkspaceSettingsSaveAdapterForTesting(ws.id, {
          productionFloorModeEnabled: enabled,
          updatedAt: nowIso,
        });
      } else if (currentUser?.uid) {
        await updateDoc(doc(db, 'workspaces', ws.id), {
          productionFloorModeEnabled: enabled,
          updatedAt: nowIso,
        });
      }

      const updatedWs: Workspace = {
        ...ws,
        productionFloorModeEnabled: enabled,
        updatedAt: nowIso,
      };
      const idx = this.workspaces.findIndex((w) => w.id === ws.id);
      if (idx >= 0) {
        this.workspaces[idx] = updatedWs;
      }
      setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
    }

    this.settings = {
      ...this.settings,
      productionFloorModeEnabled: enabled,
      updatedAt: nowIso,
    };
    setLocal(STORAGE_KEYS.SETTINGS, this.settings);

    if (currentUser?.uid) {
      try {
        const {
          categoryPresetMap: _omitMap,
          recipeCategories: _omitCats,
          productionOptionOrder: _omitOrder,
          ...userDocPayload
        } = this.settings;
        await setDoc(doc(db, 'settings', currentUser.uid), sanitizeForFirestore(userDocPayload), { merge: true });
      } catch (err) {
        console.warn('Settings cloud sync note:', err);
      }
    }

    this.notify();
  }

  /**
   * Sole authoritative read path for authenticated workspace Production Floor ordering:
   * reads ONLY `workspaces/{workspaceId}.productionOptionOrder`.
   * Never falls back to per-user `settings/{uid}.productionOptionOrder` or device-local settings.
   */
  public getProductionOptionOrder(workspaceId?: string): string[] | null {
    if (!this.isAuthorized()) {
      return null;
    }
    if (this.workspaceDocHydrationState === 'ERROR') {
      return null;
    }
    const targetId = workspaceId || this.activeWorkspaceId;
    const ws = targetId
      ? this.workspaces.find((w) => w.id === targetId) || null
      : this.getActiveWorkspace();
    if (ws && Array.isArray(ws.productionOptionOrder) && ws.productionOptionOrder.length > 0) {
      return ws.productionOptionOrder;
    }
    return null;
  }

  private getDismissedLegacyOrderSignature(workspaceId: string): string | null {
    const activeStorage = this.getEffectiveStorage();
    try {
      const raw = activeStorage.getItem(STORAGE_KEYS.DISMISSED_LEGACY_PROD_ORDER);
      if (!raw) return null;
      const map = JSON.parse(raw) as Record<string, string>;
      return map && typeof map[workspaceId] === 'string' ? map[workspaceId] : null;
    } catch {
      return null;
    }
  }

  private setDismissedLegacyOrderSignature(workspaceId: string, signature: string): void {
    const activeStorage = this.getEffectiveStorage();
    try {
      const raw = activeStorage.getItem(STORAGE_KEYS.DISMISSED_LEGACY_PROD_ORDER);
      const map: Record<string, string> = raw ? JSON.parse(raw) : {};
      map[workspaceId] = signature;
      activeStorage.setItem(STORAGE_KEYS.DISMISSED_LEGACY_PROD_ORDER, JSON.stringify(map));
    } catch {
      // Ignore storage write error
    }
  }

  /**
   * Non-destructive Owner-only inspection of any saved per-user or device-local
   * production option ordering candidate that differs from `workspaces/{wsId}.productionOptionOrder`.
   * Never exposed to Editors, Viewers, or the shared production tablet.
   */
  public inspectPendingProductionOrderMigration(
    workspaceId?: string
  ): ProductionOptionOrderMigrationInspection | null {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      return null;
    }
    if (this.workspaceDocHydrationState !== 'READY') {
      return null;
    }
    const targetId = workspaceId || this.activeWorkspaceId || 'ws-main';
    const ws = this.workspaces.find((w) => w.id === targetId) || null;
    if (!ws) {
      return null;
    }

    const perUserCandidate =
      this.settings && Array.isArray(this.settings.productionOptionOrder)
        ? this.settings.productionOptionOrder
        : null;
    const localWsCandidate = this.capturedLegacyWorkspaceOrderByWsId[targetId] || null;
    const dismissedSignature = this.getDismissedLegacyOrderSignature(targetId);

    return inspectProductionOptionOrderMigration({
      workspace: ws,
      perUserCandidateOrder: perUserCandidate,
      localWorkspaceCandidateOrder: localWsCandidate,
      allPresets: this.presets,
      dismissedSignature,
    });
  }

  /**
   * Explicit Owner-controlled promotion of a saved legacy per-user/device ordering candidate
   * into the authoritative shared `workspaces/{wsId}.productionOptionOrder`.
   * Never deletes legacy per-user or local data, and prevents stale candidates from reappearing.
   */
  public async promoteLegacyProductionOptionOrder(
    userRoleOverride?: AccessRole | null
  ): Promise<string[]> {
    const role = userRoleOverride !== undefined ? userRoleOverride : this.getUserRole();
    if (!this.isAuthorized() || role !== 'owner') {
      throw new Error(
        'Permission denied: Only workspace owners can promote a saved device order to the shared workspace.'
      );
    }

    const wsId = (this.activeWorkspaceId || '').trim() || 'ws-main';
    const inspection = this.inspectPendingProductionOrderMigration(wsId);
    if (!inspection || !inspection.hasLegacyCandidate || inspection.candidateOrder.length === 0) {
      throw new Error('No differing saved device production order candidate was found to promote.');
    }

    await this.setProductionOptionOrder(inspection.candidateOrder, role);
    this.setDismissedLegacyOrderSignature(wsId, inspection.candidateSignature);
    this.notify();
    return inspection.candidateOrder;
  }

  /**
   * Explicit Owner-controlled action to keep the current shared workspace order without deleting
   * the legacy candidate, recording its signature so the banner does not repeatedly reappear.
   */
  public dismissLegacyProductionOrderCandidate(workspaceId?: string): void {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      return;
    }
    const wsId = workspaceId || this.activeWorkspaceId || 'ws-main';
    const inspection = this.inspectPendingProductionOrderMigration(wsId);
    if (!inspection || !inspection.candidateSignature) {
      return;
    }
    this.setDismissedLegacyOrderSignature(wsId, inspection.candidateSignature);
    this.notify();
  }

  public async setProductionOptionOrder(order: string[], userRole?: AccessRole | null): Promise<void> {
    const role = userRole !== undefined ? userRole : this.getUserRole();
    if (role !== 'owner' && role !== 'editor') {
      throw new Error(
        'Permission denied: Only workspace owners and editors can update production option display order.'
      );
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: You do not have an active membership for this workspace.');
    }
    if (!Array.isArray(order) || order.length > 500) {
      throw new Error('Invalid production option order: Expected an array of at most 500 option IDs.');
    }

    const wsId = (this.activeWorkspaceId || '').trim();
    if (this.workspaceDocHydrationState !== 'READY') {
      throw new Error(
        this.workspaceDocSyncError ||
          'Cannot save production option order: Workspace document has not finished syncing from Cloud Firestore.'
      );
    }

    const ws = this.getActiveWorkspace();
    if (!ws || !ws.id || (wsId && ws.id !== wsId)) {
      throw new Error(
        `Cannot save production option order: Authoritative workspace document (workspaces/${wsId || 'unknown'}) is missing.`
      );
    }

    const canonicalOrder =
      this.presets.length > 0 ? canonicalizeProductionOptionOrder(order, this.presets) : order;
    const sanitizedOrder = sanitizeForFirestore(canonicalOrder) as string[];
    const nowIso = new Date().toISOString();
    const currentUser = auth.currentUser;

    // Persist narrowly scoped payload ({ productionOptionOrder, updatedAt }) BEFORE mutating local shared state.
    // Never write productionOptionOrder to per-user settings/{uid}.
    if (this.customWorkspaceSettingsSaveAdapterForTesting && this.isDevOrTestEnvironment()) {
      await this.customWorkspaceSettingsSaveAdapterForTesting(ws.id, {
        productionOptionOrder: sanitizedOrder,
        updatedAt: nowIso,
      });
    } else if (currentUser?.uid) {
      await updateDoc(doc(db, 'workspaces', ws.id), {
        productionOptionOrder: sanitizedOrder,
        updatedAt: nowIso,
      });
    } else if (!this.testSessionOverride) {
      throw new Error('Authentication Required: You must be signed in to update workspace production order.');
    }

    const updatedWs: Workspace = {
      ...ws,
      productionOptionOrder: sanitizedOrder,
      updatedAt: nowIso,
    };
    const idx = this.workspaces.findIndex((w) => w.id === ws.id);
    if (idx >= 0) {
      const nextWorkspaces = [...this.workspaces];
      nextWorkspaces[idx] = updatedWs;
      this.workspaces = nextWorkspaces;
    } else {
      this.workspaces = [...this.workspaces, updatedWs];
    }
    setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);

    // If a local legacy candidate matched or was superseded on this Owner device, mark its signature
    // reconciled without deleting legacy per-user Firestore data or writing to settings/{uid}.
    if (role === 'owner') {
      const prevPerUser = this.settings?.productionOptionOrder;
      if (Array.isArray(prevPerUser) && prevPerUser.length > 0) {
        const prevSig = JSON.stringify(canonicalizeProductionOptionOrder(prevPerUser, this.presets));
        this.setDismissedLegacyOrderSignature(ws.id, prevSig);
      }
      const prevLocalWs = this.capturedLegacyWorkspaceOrderByWsId[ws.id];
      if (Array.isArray(prevLocalWs) && prevLocalWs.length > 0) {
        const prevWsSig = JSON.stringify(canonicalizeProductionOptionOrder(prevLocalWs, this.presets));
        this.setDismissedLegacyOrderSignature(ws.id, prevWsSig);
      }
    }

    this.notify();
  }

  public async updateSettings(updates: Partial<UserSettings>): Promise<void> {
    // Prevent workspace-scoped settings from being mutated or spoofed via personal user settings updates:
    // - categoryPresetMap -> saveWorkspaceCategoryPresetMap() (Owner-only)
    // - productionFloorModeEnabled -> setProductionFloorModeEnabled() (Owner-only)
    // - productionOptionOrder -> setProductionOptionOrder() (Owner/Editor)
    const {
      categoryPresetMap: _ignoredCategoryMap,
      recipeCategories: _ignoredCategories,
      productionFloorModeEnabled: _ignoredFloorMode,
      productionOptionOrder: _ignoredOptionOrder,
      ...safeUserUpdates
    } = updates;

    this.settings = { ...this.settings, ...safeUserUpdates, updatedAt: new Date().toISOString() };
    setLocal(STORAGE_KEYS.SETTINGS, this.settings);
    if (safeUserUpdates.theme !== undefined) {
      this.applyActiveWorkspaceTheme();
    }
    this.notify();

    const currentUser = auth.currentUser;
    if (currentUser?.uid) {
      const targetUid = currentUser.uid;
      const {
        categoryPresetMap: _omitMap,
        recipeCategories: _omitCats,
        productionOptionOrder: _omitOrder,
        ...userDocPayload
      } = this.settings;
      try {
        await setDoc(doc(db, 'settings', targetUid), sanitizeForFirestore(userDocPayload), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `settings/${targetUid}`);
      }
    }
  }

  // --- Active Guided Mixing Checklist State ---
  public getActiveChecklist(): any {
    if (!this.isAuthorized()) return null;
    return getLocal(STORAGE_KEYS.ACTIVE_CHECKLIST, null);
  }

  public setActiveChecklist(checklistData: any): void {
    setLocal(STORAGE_KEYS.ACTIVE_CHECKLIST, checklistData);
    this.notify();
  }

  public clearActiveChecklist(): void {
    safeStorage.removeItem(STORAGE_KEYS.ACTIVE_CHECKLIST);
    this.notify();
  }

  // --- Workspaces & Access Groups API ---
  public getWorkspaces(): Workspace[] {
    return this.workspaces;
  }

  public getActiveWorkspace(): Workspace | null {
    if (!this.activeWorkspaceId) return null;
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId) || null;
  }

  public getActiveWorkspaceId(): string {
    return this.activeWorkspaceId || this.getActiveWorkspace()?.id || 'ws-main';
  }

  public getWorkspaceDocHydrationState(): FirestoreHydrationState {
    return this.workspaceDocHydrationState;
  }

  public getWorkspaceDocSyncError(): string | null {
    return this.workspaceDocSyncError;
  }

  /**
   * Resolves the authoritative Management Mode PIN policy for the active workspace,
   * failing closed whenever workspace hydration is LOADING/ERROR or a workspace lock is malformed,
   * and preserving any existing device-local PIN prior to Owner promotion.
   */
  public getEffectiveManagementLockResolution(): EffectiveManagementLockResolution {
    return resolveEffectiveManagementLock({
      workspace: this.getActiveWorkspace(),
      workspaceDocHydrationState: this.workspaceDocHydrationState,
      storageOverride: this.getEffectiveStorage(),
    });
  }

  /**
   * Retries hydrating `workspaces/{wsId}` when workspace policy verification failed closed.
   * Performs zero Firestore writes.
   */
  public async retryWorkspaceLockHydration(): Promise<boolean> {
    const uid = this.getEffectiveAuthenticatedUid();
    const wsId = (this.activeWorkspaceId || '').trim();
    if (!uid || !wsId || !this.isAuthorized()) {
      return false;
    }

    try {
      if (this.customWorkspaceDocLoaderForTesting && this.isDevOrTestEnvironment()) {
        const loaded = await this.customWorkspaceDocLoaderForTesting(wsId);
        if (loaded) {
          const wsData = { ...loaded, id: loaded.id || wsId };
          const idx = this.workspaces.findIndex((w) => w.id === wsId);
          if (idx >= 0) {
            const next = [...this.workspaces];
            next[idx] = wsData;
            this.workspaces = next;
          } else {
            this.workspaces = [...this.workspaces, wsData];
          }
          setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
          this.workspaceDocHydrationState = 'READY';
          this.workspaceDocSyncError = null;
          this.notify();
          return true;
        }
        this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
        setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
        this.workspaceDocHydrationState = 'ERROR';
        this.workspaceDocSyncError = `Workspace root document (workspaces/${wsId}) was not found in Cloud Firestore.`;
        this.notify();
        return false;
      } else {
        const snap = await getDoc(doc(db, 'workspaces', wsId));
        if (snap.exists()) {
          const wsData = { ...(snap.data() as Workspace), id: snap.id };
          const idx = this.workspaces.findIndex((w) => w.id === wsId);
          if (idx >= 0) {
            const next = [...this.workspaces];
            next[idx] = wsData;
            this.workspaces = next;
          } else {
            this.workspaces = [...this.workspaces, wsData];
          }
          setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
          this.workspaceDocHydrationState = 'READY';
          this.workspaceDocSyncError = null;
          this.notify();
          return true;
        }
        this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
        setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
        this.workspaceDocHydrationState = 'ERROR';
        this.workspaceDocSyncError = `Workspace root document (workspaces/${wsId}) was not found in Cloud Firestore.`;
        this.notify();
        return false;
      }
    } catch (err) {
      this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
      this.workspaceDocHydrationState = 'ERROR';
      this.workspaceDocSyncError =
        err instanceof Error ? err.message : 'Unable to verify workspace Management PIN policy.';
      this.notify();
      return false;
    }
  }

  /**
   * Owner-only authoritative save of the shared workspace Management Mode PIN policy.
   *
   * SAFETY & SECURITY INVARIANTS:
   * - Strictly restricted to `owner` role (rejects `editor`, `viewer`, and unauthenticated callers).
   * - Requires `workspaceDocHydrationState === 'READY'` so an offline client cannot overwrite a cloud PIN.
   * - Validates salted SHA-256 format and rejects any plaintext PIN fields.
   * - Awaits server confirmation BEFORE updating in-memory workspace state or device storage.
   * - Never runs automatically on startup or login.
   */
  public async saveWorkspaceManagementLock(
    config: ManagementLockConfig,
    userRoleOverride?: AccessRole | null
  ): Promise<ManagementLockConfig> {
    const role = userRoleOverride !== undefined ? userRoleOverride : this.getUserRole();
    assertOwnerCanConfigureManagementLock(role);

    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid || !this.isAuthorized()) {
      throw new Error('Authentication Required: Owner must be signed in to configure the Management Mode PIN.');
    }

    const wsId = (this.activeWorkspaceId || '').trim();
    if (!wsId) {
      throw new Error('No active workspace selected.');
    }

    if (this.workspaceDocHydrationState !== 'READY') {
      throw new Error(
        'Cannot modify the Management Mode PIN until the current workspace policy finishes syncing from Cloud Firestore.'
      );
    }

    const nowIso = new Date().toISOString();
    const validatedPolicy = assertValidLockConfigForPersistence({
      ...(config as ManagementLockConfig & Record<string, unknown>),
      updatedAt: nowIso,
      updatedByUid: uid,
    });

    if (this.customWorkspaceLockSaveAdapterForTesting && this.isDevOrTestEnvironment()) {
      await this.customWorkspaceLockSaveAdapterForTesting(wsId, validatedPolicy);
    } else {
      await setDoc(
        doc(db, 'workspaces', wsId),
        sanitizeForFirestore({
          managementLock: validatedPolicy,
          updatedAt: nowIso,
        }),
        { merge: true }
      );
    }

    const idx = this.workspaces.findIndex((w) => w.id === wsId);
    if (idx >= 0) {
      const nextWorkspaces = [...this.workspaces];
      nextWorkspaces[idx] = {
        ...nextWorkspaces[idx],
        managementLock: validatedPolicy,
        updatedAt: nowIso,
      };
      this.workspaces = nextWorkspaces;
    } else {
      this.workspaces = [
        ...this.workspaces,
        {
          id: wsId,
          name: 'Workspace',
          ownerId: uid,
          ownerEmail: auth.currentUser?.email || '',
          code: wsId.toUpperCase(),
          members: [],
          groups: [],
          managementLock: validatedPolicy,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ];
    }

    setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
    saveManagementLockConfig(validatedPolicy, this.getEffectiveStorage());
    this.notify();
    return validatedPolicy;
  }

  /**
   * Owner-only controlled promotion of an existing device-local PIN (`SS_MGMT_LOCK_CONFIG`)
   * into the shared `workspaces/{wsId}.managementLock` policy after verifying the current PIN.
   * Never discards or overwrites the local backup destructively.
   */
  public async promoteLocalManagementLockToWorkspace(
    currentPin: string,
    userRoleOverride?: AccessRole | null
  ): Promise<ManagementLockConfig> {
    const role = userRoleOverride !== undefined ? userRoleOverride : this.getUserRole();
    assertOwnerCanConfigureManagementLock(role);

    const localConfig = loadManagementLockConfig(this.getEffectiveStorage());
    if (!localConfig.enabled || !isValidEnabledLockConfig(localConfig)) {
      throw new Error('No valid device-local Management PIN is configured on this browser to promote.');
    }

    const isValid = await verifyManagementPin(currentPin, localConfig);
    if (!isValid) {
      throw new Error('Current PIN is incorrect. Enter the existing device PIN to promote it to the workspace.');
    }

    return this.saveWorkspaceManagementLock(
      {
        enabled: true,
        salt: localConfig.salt,
        hash: localConfig.hash,
      },
      role
    );
  }

  /**
   * DEVELOPMENT & AUTOMATED TEST HARNESS ONLY:
   * Configures isolated authentication bootstrap, membership lookup, and workspace lock
   * persistence adapters with zero live Firestore reads/writes.
   */
  public configureAuthAndLockTestHarness(config: {
    authUidOnly?: string | null;
    session?: { uid: string; role: AccessRole; workspaceId: string } | null;
    storage?: StorageLike | null;
    workspaces?: Workspace[];
    activeWorkspaceId?: string;
    workspaceDocHydrationState?: FirestoreHydrationState;
    workspaceDocSyncError?: string | null;
    membershipLookup?:
      | ((uid: string, workspaceId: string) => Promise<{ exists: boolean; role?: AccessRole; active?: boolean }>)
      | null;
    workspaceDocLoader?: ((workspaceId: string) => Promise<Workspace | null>) | null;
    workspaceLockSaveAdapter?: ((workspaceId: string, policy: ManagementLockConfig) => Promise<void>) | null;
    workspaceSettingsSaveAdapter?: ((workspaceId: string, updates: Record<string, unknown>) => Promise<void>) | null;
    recipeDeleteAdapter?: ((recipeId: string) => Promise<void>) | null;
    presetCloudAdapter?: PresetCloudPersistenceAdapter | null;
    recipes?: Recipe[];
    presets?: ProductionPreset[];
    localSettings?: Partial<UserSettings>;
    legacyWorkspaceCandidateOrder?: { workspaceId: string; order: string[] } | null;
    authStateSubscriber?:
      | ((
          onNext: (user: { uid: string; email?: string | null } | null) => void | Promise<void>,
          onError?: (error: unknown) => void
        ) => Unsubscribe)
      | null;
  }): void {
    if (!this.isDevOrTestEnvironment()) {
      return;
    }

    if (config.storage !== undefined) {
      this.customStorageForTesting = config.storage;
    }
    if (config.authUidOnly !== undefined) {
      this.testAuthUidOnlyOverride = config.authUidOnly;
      this.authLoading = false;
    }
    if (config.session !== undefined) {
      this.testSessionOverride = config.session;
      this.authLoading = false;
      if (config.session) {
        this.validatedUid = config.session.uid;
        this.validatedUserRole = config.session.role;
        this.activeWorkspaceId = config.session.workspaceId;
        this.settings.activeWorkspaceId = config.session.workspaceId;
      } else {
        this.validatedUid = null;
        this.validatedUserRole = null;
      }
    }
    if (config.workspaces !== undefined) {
      this.workspaces = config.workspaces.map((w) => ({ ...w }));
      if (config.workspaceDocHydrationState === undefined) {
        this.workspaceDocHydrationState = config.workspaces.length > 0 ? 'READY' : 'LOADING';
      }
    }
    if (config.recipes !== undefined) {
      this.recipes = config.recipes.map((r) => ({ ...r }));
    }
    if (config.presets !== undefined) {
      this.presets = config.presets.map((p) => ({
        ...p,
        category: normalizePresetCategory(p),
      }));
    }
    if (config.localSettings !== undefined) {
      this.settings = {
        ...INITIAL_SETTINGS,
        ...config.localSettings,
        activeWorkspaceId:
          config.localSettings.activeWorkspaceId ||
          config.activeWorkspaceId ||
          this.activeWorkspaceId,
      };
    }
    if (config.legacyWorkspaceCandidateOrder !== undefined) {
      if (config.legacyWorkspaceCandidateOrder === null) {
        this.capturedLegacyWorkspaceOrderByWsId = {};
      } else {
        this.capturedLegacyWorkspaceOrderByWsId[config.legacyWorkspaceCandidateOrder.workspaceId] = [
          ...config.legacyWorkspaceCandidateOrder.order,
        ];
      }
    }
    if (config.activeWorkspaceId !== undefined) {
      this.activeWorkspaceId = config.activeWorkspaceId;
      this.settings.activeWorkspaceId = config.activeWorkspaceId;
    }
    if (config.workspaceDocHydrationState !== undefined) {
      this.workspaceDocHydrationState = config.workspaceDocHydrationState;
    }
    if (config.workspaceDocSyncError !== undefined) {
      this.workspaceDocSyncError = config.workspaceDocSyncError;
    }
    if (config.membershipLookup !== undefined) {
      this.customMembershipLookupForTesting = config.membershipLookup;
    }
    if (config.workspaceDocLoader !== undefined) {
      this.customWorkspaceDocLoaderForTesting = config.workspaceDocLoader;
    }
    if (config.workspaceLockSaveAdapter !== undefined) {
      this.customWorkspaceLockSaveAdapterForTesting = config.workspaceLockSaveAdapter;
    }
    if (config.workspaceSettingsSaveAdapter !== undefined) {
      this.customWorkspaceSettingsSaveAdapterForTesting = config.workspaceSettingsSaveAdapter;
    }
    if (config.recipeDeleteAdapter !== undefined) {
      this.customRecipeDeleteAdapterForTesting = config.recipeDeleteAdapter;
    }
    if (config.presetCloudAdapter !== undefined) {
      this.customPresetCloudAdapter = config.presetCloudAdapter;
    }
    if (config.authStateSubscriber !== undefined) {
      this.detachAuthObserver();
      this.customAuthStateSubscriberForTesting = config.authStateSubscriber;
    }
    this.notify();
  }

  /**
   * DEVELOPMENT & TEST HARNESS ONLY:
   * Simulates an authoritative real-time `onSnapshot` update for `workspaces/{workspaceId}`.
   */
  public simulateWorkspaceRealtimeSnapshotForTesting(params: {
    workspaceId: string;
    exists: boolean;
    data?: Workspace | null;
    fromCache?: boolean;
  }): void {
    if (!this.isDevOrTestEnvironment()) return;
    const wsId = params.workspaceId;
    if ((this.activeWorkspaceId || 'ws-main') !== wsId) return;

    if (params.exists && params.data) {
      const remoteWs = { ...params.data, id: params.data.id || wsId };
      const idx = this.workspaces.findIndex((w) => w.id === remoteWs.id);
      if (idx >= 0) {
        const nextWorkspaces = [...this.workspaces];
        nextWorkspaces[idx] = remoteWs;
        this.workspaces = nextWorkspaces;
      } else {
        this.workspaces = [...this.workspaces, remoteWs];
      }
      setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
      if (!params.fromCache) {
        this.workspaceDocHydrationState = 'READY';
        this.workspaceDocSyncError = null;
      }
      this.notify();
      return;
    }

    if (!params.fromCache) {
      this.workspaces = this.workspaces.filter((w) => w.id !== wsId);
      setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
      this.workspaceDocHydrationState = 'ERROR';
      this.workspaceDocSyncError = `Workspace root document (workspaces/${wsId}) was not found in Cloud Firestore.`;
      this.notify();
    }
  }

  public getActiveAuthObserverCountForTesting(): number {
    if (!this.isDevOrTestEnvironment()) return 0;
    return this.activeAuthObserverCount;
  }

  public detachAuthObserverForTesting(): void {
    if (!this.isDevOrTestEnvironment()) return;
    this.detachAuthObserver();
  }

  public async setActiveWorkspace(id: string): Promise<void> {
    if (this.activeWorkspaceId && this.activeWorkspaceId !== id) {
      this.clearProductionRecordsFromMemory({ preserveWorkspacesList: true });
    } else {
      this.resetSafetyHydrationToLoading();
    }
    const activeStorage = this.getEffectiveStorage();
    const savedAppMode = activeStorage.getItem(APP_MODE_STORAGE_KEY);
    if (savedAppMode === 'management' || savedAppMode === 'full') {
      if (activeStorage.removeItem) {
        activeStorage.removeItem(APP_MODE_STORAGE_KEY);
      } else {
        safeStorage.removeItem(APP_MODE_STORAGE_KEY);
      }
    }
    this.activeWorkspaceId = id;
    if (this.testSessionOverride && this.isDevOrTestEnvironment()) {
      this.testSessionOverride = {
        ...this.testSessionOverride,
        workspaceId: id,
      };
    }
    const ws = this.getActiveWorkspace();
    if (ws && !auth.currentUser) {
      this.workspaceDocHydrationState = 'READY';
    }
    const wsEnabled = ws && ws.productionFloorModeEnabled !== undefined
      ? ws.productionFloorModeEnabled !== false
      : true;
    this.settings = {
      ...this.settings,
      productionFloorModeEnabled: wsEnabled,
    };
    await this.updateSettings({
      activeWorkspaceId: id,
      workspaceName: ws?.name || 'Main Bakery Workspace',
    });
    this.applyActiveWorkspaceTheme();
    this.setupRealtimeListeners();
    this.notify();
  }

  public async saveWorkspace(workspace: Workspace): Promise<void> {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can modify workspace settings.');
    }
    const uid = this.getEffectiveAuthenticatedUid();
    if (!uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save a workspace.');
    }
    const updated = {
      ...workspace,
      updatedAt: new Date().toISOString(),
    };

    if (auth.currentUser?.uid) {
      try {
        await setDoc(doc(db, 'workspaces', updated.id), sanitizeForFirestore(updated));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `workspaces/${updated.id}`);
        } catch {
          // Propagate error cleanly without mutating local shared state
        }
        throw err;
      }
    }

    const idx = this.workspaces.findIndex((w) => w.id === workspace.id);
    if (idx >= 0) {
      this.workspaces[idx] = updated;
    } else {
      this.workspaces.push(updated);
    }
    setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
    this.notify();
  }

  public async createWorkspace(name: string): Promise<Workspace> {
    if (!this.isAuthorized() || this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can create workspaces.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to create a workspace.');
    }
    const userEmail = currentUser.email || '';
    const userId = currentUser.uid;
    const newWs: Workspace = {
      id: `ws-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      ownerId: userId,
      ownerEmail: userEmail,
      code: `BAKERY-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      members: [
        {
          email: userEmail,
          name: currentUser.displayName || 'Workspace Owner',
          role: 'owner',
          addedAt: new Date().toISOString(),
        },
      ],
      groups: [],
      branding: {
        displayName: name,
        paletteId: DEFAULT_PALETTE_ID,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.saveWorkspace(newWs);
    await this.setActiveWorkspace(newWs.id);
    return newWs;
  }

  public async addMemberToWorkspace(email: string, role: AccessRole, name?: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can manage members.');
    }
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const cleanEmail = email.toLowerCase().trim();
    const existingIdx = ws.members.findIndex((m) => m.email.toLowerCase() === cleanEmail);
    const updatedMembers = [...ws.members];
    if (existingIdx >= 0) {
      updatedMembers[existingIdx] = {
        ...updatedMembers[existingIdx],
        role,
        name: name || updatedMembers[existingIdx].name,
      };
    } else {
      updatedMembers.push({
        email: cleanEmail,
        name: name || cleanEmail.split('@')[0],
        role,
        addedAt: new Date().toISOString(),
      });
    }
    await this.saveWorkspace({ ...ws, members: updatedMembers });

    // Also sync membership to subcollection if currentUser matches
    if (auth.currentUser && auth.currentUser.email?.toLowerCase() === cleanEmail) {
      const memberDocRef = doc(db, 'workspaces', ws.id, 'members', auth.currentUser.uid);
      setDoc(
        memberDocRef,
        sanitizeForFirestore({
          id: auth.currentUser.uid,
          role,
          email: cleanEmail,
          name: name || auth.currentUser.displayName || cleanEmail.split('@')[0],
          addedAt: new Date().toISOString(),
        }),
        { merge: true }
      ).catch((err) => console.warn('Member subcollection sync note:', err));
    }
  }

  public async removeMemberFromWorkspace(email: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can remove members.');
    }
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const cleanEmail = email.toLowerCase().trim();
    const updatedMembers = ws.members.filter((m) => m.email.toLowerCase() !== cleanEmail);
    await this.saveWorkspace({ ...ws, members: updatedMembers });
  }

  public async updateMemberRole(email: string, role: AccessRole): Promise<void> {
    await this.addMemberToWorkspace(email, role);
  }

  // =========================================================================
  // Phase 0.6: Authoritative UID-Based Workspace Members Management
  // =========================================================================

  public getWorkspaceMembers(): WorkspaceMemberDoc[] {
    if (!this.isAuthorized()) return [];
    return [...this.workspaceMembers];
  }

  public async fetchWorkspaceMembersDirect(workspaceId?: string): Promise<WorkspaceMemberDoc[]> {
    if (!this.isAuthorized()) return [];
    const ws = this.getActiveWorkspace();
    const wsId = workspaceId || ws?.id || 'ws-main';
    try {
      const snap = await getDocs(collection(db, 'workspaces', wsId, 'members'));
      const members: WorkspaceMemberDoc[] = [];
      snap.forEach((d) => {
        const data = d.data();
        members.push({
          uid: data.uid || d.id,
          id: d.id,
          email: data.email || '',
          name: data.name || (data.email ? data.email.split('@')[0] : 'Member'),
          role: (data.role as AccessRole) || 'viewer',
          active: data.active === true,
          addedAt: data.addedAt || '',
          updatedAt: data.updatedAt || data.addedAt || '',
        });
      });
      this.workspaceMembers = members;
      this.notify();
      return members;
    } catch (err) {
      console.warn('Error fetching workspace members:', err);
      return this.workspaceMembers;
    }
  }

  public async addWorkspaceMember(params: {
    uid: string;
    email: string;
    name?: string;
    role: 'editor' | 'viewer';
    active?: boolean;
  }): Promise<WorkspaceMemberDoc> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: No active authorized session.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can manage members.');
    }

    // Phase 1.3: Plan Capability & Seat Enforcement
    const evaluation = this.getEntitlementEvaluation();
    if (!canManageTeam(evaluation.planId)) {
      throw new Error(
        `Team member management is not included in the Solo plan. Upgrade to the Team plan to invite editors and viewers.`
      );
    }

    const currentActiveSeats = this.getComputedActiveSeatCount();
    const seatUsage = computeSeatUsage(evaluation.planId, currentActiveSeats);
    const willBeActive = params.active !== false;
    if (willBeActive && !seatUsage.canAddMember) {
      throw new Error(
        `Workspace seat limit reached (${seatUsage.activeSeats}/${seatUsage.seatLimit} seats occupied on ${seatUsage.planDisplayName} plan). Deactivate an existing member or upgrade your plan to add more members.`
      );
    }

    const ws = this.getActiveWorkspace();
    const wsId = ws?.id || 'ws-main';

    const cleanUid = (params.uid || '').trim();
    if (!cleanUid) {
      throw new Error('Firebase UID is required.');
    }
    if (cleanUid.length < 5 || cleanUid.includes(' ') || cleanUid.includes('/')) {
      throw new Error('Invalid Firebase UID format: Must be at least 5 characters with no spaces or slashes.');
    }

    const cleanEmail = (params.email || '').toLowerCase().trim();
    if (!cleanEmail) {
      throw new Error('Email address is required.');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      throw new Error('Invalid email address format.');
    }

    if (params.role !== 'editor' && params.role !== 'viewer') {
      throw new Error('Invalid role: Must be either editor or viewer.');
    }

    // Protect current owner from being added as editor or viewer
    if (cleanUid === currentUser.uid) {
      throw new Error('Cannot add yourself as an editor or viewer. You are the workspace owner.');
    }

    // Prevent duplicate addition
    const memberDocRef = doc(db, 'workspaces', wsId, 'members', cleanUid);
    const existingSnap = await getDoc(memberDocRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData?.role === 'owner') {
        throw new Error('This UID is already assigned as the workspace owner.');
      }
      throw new Error(`A member with UID "${cleanUid}" already exists in this workspace.`);
    }

    const nowIso = new Date().toISOString();
    const newMember: WorkspaceMemberDoc = {
      uid: cleanUid,
      id: cleanUid,
      email: cleanEmail,
      name: (params.name || '').trim() || cleanEmail.split('@')[0],
      role: params.role,
      active: params.active === false ? false : true,
      addedAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      await setDoc(memberDocRef, sanitizeForFirestore(newMember));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `workspaces/${wsId}/members/${cleanUid}`);
      throw err;
    }

    const existingIdx = this.workspaceMembers.findIndex((m) => m.uid === cleanUid);
    if (existingIdx >= 0) {
      this.workspaceMembers[existingIdx] = newMember;
    } else {
      this.workspaceMembers.push(newMember);
    }
    this.notify();
    return newMember;
  }

  public async updateWorkspaceMember(
    memberUid: string,
    updates: {
      role?: 'editor' | 'viewer';
      name?: string;
      active?: boolean;
    }
  ): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: No active authorized session.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can update members.');
    }

    const ws = this.getActiveWorkspace();
    const wsId = ws?.id || 'ws-main';

    const cleanUid = (memberUid || '').trim();
    if (!cleanUid) {
      throw new Error('Member UID is required.');
    }

    // Owner protection: cannot demote or deactivate self
    if (cleanUid === currentUser.uid) {
      throw new Error('Workspace Owner account role or status cannot be modified through this screen.');
    }

    if (updates.role && updates.role !== 'editor' && updates.role !== 'viewer') {
      throw new Error('Invalid role: Must be either editor or viewer.');
    }

    const memberDocRef = doc(db, 'workspaces', wsId, 'members', cleanUid);
    const existingSnap = await getDoc(memberDocRef);
    if (!existingSnap.exists()) {
      throw new Error('Member document not found in workspace.');
    }
    const existingData = existingSnap.data();
    if (existingData?.role === 'owner') {
      throw new Error('Cannot modify workspace owner role or status.');
    }

    // Phase 1.3: If reactivating an inactive member, check seat limit
    if (updates.active === true && existingData?.active !== true) {
      const evaluation = this.getEntitlementEvaluation();
      const currentActiveSeats = this.getComputedActiveSeatCount();
      const seatUsage = computeSeatUsage(evaluation.planId, currentActiveSeats);
      if (!seatUsage.canAddMember) {
        throw new Error(
          `Cannot reactivate member: Workspace seat limit reached (${seatUsage.activeSeats}/${seatUsage.seatLimit} seats occupied on ${seatUsage.planDisplayName} plan). Upgrade plan or deactivate another member first.`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const docUpdates: Partial<WorkspaceMemberDoc> = {
      updatedAt: nowIso,
    };
    if (updates.role !== undefined) docUpdates.role = updates.role;
    if (updates.name !== undefined) docUpdates.name = updates.name.trim();
    if (updates.active !== undefined) docUpdates.active = updates.active;

    try {
      await setDoc(memberDocRef, sanitizeForFirestore(docUpdates), { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaces/${wsId}/members/${cleanUid}`);
      throw err;
    }

    const idx = this.workspaceMembers.findIndex((m) => m.uid === cleanUid);
    if (idx >= 0) {
      this.workspaceMembers[idx] = {
        ...this.workspaceMembers[idx],
        ...docUpdates,
      };
      this.notify();
    }
  }

  public async removeWorkspaceMember(memberUid: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: No active authorized session.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can remove members.');
    }

    const ws = this.getActiveWorkspace();
    const wsId = ws?.id || 'ws-main';

    const cleanUid = (memberUid || '').trim();
    if (!cleanUid) {
      throw new Error('Member UID is required.');
    }

    // Owner protection
    if (cleanUid === currentUser.uid) {
      throw new Error('Cannot remove yourself as workspace owner.');
    }

    const memberDocRef = doc(db, 'workspaces', wsId, 'members', cleanUid);
    const existingSnap = await getDoc(memberDocRef);
    if (!existingSnap.exists()) {
      return;
    }
    const existingData = existingSnap.data();
    if (existingData?.role === 'owner') {
      throw new Error('Cannot remove workspace owner membership.');
    }

    try {
      await deleteDoc(memberDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `workspaces/${wsId}/members/${cleanUid}`);
      throw err;
    }

    this.workspaceMembers = this.workspaceMembers.filter((m) => m.uid !== cleanUid);
    this.notify();
  }

  public async addGroupToWorkspace(name: string, memberEmails: string[], role: AccessRole): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can manage access groups.');
    }
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const newGrp: AccessGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      memberEmails,
      role,
    };
    const updatedGroups = [...ws.groups, newGrp];
    await this.saveWorkspace({ ...ws, groups: updatedGroups });
  }

  public async removeGroupFromWorkspace(groupId: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can remove access groups.');
    }
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const updatedGroups = ws.groups.filter((g) => g.id !== groupId);
    await this.saveWorkspace({ ...ws, groups: updatedGroups });
  }

  // --- Workspace Branding & Appearance (Phase 0.5) ---

  public getWorkspaceBranding(workspaceId?: string): WorkspaceBranding {
    if (!this.isAuthorized()) {
      // Unauthorized visitors must NOT receive private workspace branding data
      return getDefaultWorkspaceBranding();
    }
    const targetId = workspaceId || this.activeWorkspaceId;
    const ws = this.workspaces.find((w) => w.id === targetId) || this.getActiveWorkspace();
    if (ws && ws.branding) {
      return {
        displayName: ws.branding.displayName || ws.name || DEFAULT_DISPLAY_NAME,
        logoUrl: ws.branding.logoUrl,
        logoStoragePath: ws.branding.logoStoragePath,
        paletteId: ws.branding.paletteId || DEFAULT_PALETTE_ID,
      };
    }
    return getDefaultWorkspaceBranding(ws?.name);
  }

  public applyActiveWorkspaceTheme(previewBranding?: WorkspaceBranding): void {
    const isDark = this.settings.theme === 'dark';
    if (previewBranding) {
      applyThemeTokensToDOM(previewBranding.paletteId, isDark);
      return;
    }
    if (this.isAuthorized()) {
      const branding = this.getWorkspaceBranding();
      applyThemeTokensToDOM(branding.paletteId, isDark);
    } else {
      resetThemeTokensOnDOM();
    }
  }

  public async saveWorkspaceBranding(branding: WorkspaceBranding): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: Sign in with Google to customize branding.');
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized: You do not have an active membership for this workspace.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can modify workspace branding.');
    }

    // Phase 1.3: Plan Branding Capability Check (Team and Internal only)
    const evaluation = this.getEntitlementEvaluation();
    if (!supportsBranding(evaluation.planId)) {
      throw new Error(
        'Workspace branding and appearance customization is a Team plan feature. Upgrade to the Team plan to set custom logos and color palettes.'
      );
    }

    const ws = this.getActiveWorkspace();
    if (!ws) {
      throw new Error('No active workspace found.');
    }

    // Validate display name (2-60 chars, trimmed, plain-text sanitized)
    const nameValidation = sanitizeDisplayName(branding.displayName);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error || 'Invalid display name.');
    }

    // Validate palette against known presets
    const validPalette = getPaletteById(branding.paletteId);

    const updatedBranding: WorkspaceBranding = {
      displayName: nameValidation.value,
      logoUrl: branding.logoUrl || undefined,
      logoStoragePath: branding.logoStoragePath || undefined,
      paletteId: validPalette.id,
    };

    // If an old logo was replaced and had a different storage path, cleanup old path
    if (
      ws.branding?.logoStoragePath &&
      updatedBranding.logoStoragePath &&
      ws.branding.logoStoragePath !== updatedBranding.logoStoragePath
    ) {
      await deleteWorkspaceLogoFromStorage(ws.branding.logoStoragePath);
    }

    const updatedWs: Workspace = {
      ...ws,
      branding: updatedBranding,
      updatedAt: new Date().toISOString(),
    };

    await this.saveWorkspace(updatedWs);
    this.applyActiveWorkspaceTheme();
    this.notify();
  }

  public async restoreWorkspaceDefaultBranding(): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: Sign in with Google.');
    }
    if (!this.isAuthorized()) {
      throw new Error('Unauthorized.');
    }
    if (this.getUserRole() !== 'owner') {
      throw new Error('Permission denied: Only workspace owners can restore workspace default branding.');
    }
    const ws = this.getActiveWorkspace();
    if (!ws) return;

    if (ws.branding?.logoStoragePath) {
      await deleteWorkspaceLogoFromStorage(ws.branding.logoStoragePath);
    }

    const updatedWs: Workspace = {
      ...ws,
      branding: getDefaultWorkspaceBranding(ws.name),
      updatedAt: new Date().toISOString(),
    };

    await this.saveWorkspace(updatedWs);
    this.applyActiveWorkspaceTheme();
    this.notify();
  }

  /**
   * Request trusted server-side 14-day free trial activation
   * Strictly enforces owner authorization and updates authoritative billing state.
   */
  public async startFreeTrial(workspaceId?: string): Promise<WorkspaceBilling> {
    const user = auth.currentUser;
    if (!user || !user.uid) {
      throw new Error('Please sign in again.');
    }

    const wsId = workspaceId || this.activeWorkspaceId;
    if (!wsId) {
      throw new Error('No target workspace available.');
    }

    if (wsId === 'ws-main') {
      throw new Error('Sunny Sweets internal workspace operates under internal authorization.');
    }

    const currentRole = this.getUserRole();
    if (currentRole !== 'owner') {
      throw new Error('Only the workspace owner can start the free trial.');
    }

    const idToken = await user.getIdToken();
    const response = await fetch('/api/billing/start-trial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ workspaceId: wsId }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const message = errData.error || "We couldn't start your trial. Please try again.";
      throw new Error(message);
    }

    const data = await response.json();
    if (data.billing) {
      this.billing = data.billing;
      this.notify();
      return data.billing;
    }

    throw new Error("We couldn't start your trial. Please try again.");
  }

  public clearSession(): void {
    this.cancelSafetySyncRetry(true);
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    this.currentUserId = null;
    this.validatedUid = null;
    this.validatedUserRole = null;
    this.initializationError = null;
    this.workspaceLoading = false;
    this.billingLoading = false;
    this.testSessionOverride = null;
    this.testAuthUidOnlyOverride = null;
    this.customHistorySaveAdapter = null;
    this.safetyRetryDelayOverrideMsForTesting = null;
    this.customListenerRestartHookForTesting = null;
    this.customAccessValidatorForTesting = null;
    this.customMembershipLookupForTesting = null;
    this.customWorkspaceDocLoaderForTesting = null;
    this.customWorkspaceLockSaveAdapterForTesting = null;
    this.customWorkspaceSettingsSaveAdapterForTesting = null;
    this.customRecipeDeleteAdapterForTesting = null;
    this.customPresetCloudAdapter = null;
    this.capturedLegacyWorkspaceOrderByWsId = {};
    this.settings = { ...INITIAL_SETTINGS };
    if (this.customAuthStateSubscriberForTesting !== null) {
      this.detachAuthObserver();
      this.customAuthStateSubscriberForTesting = null;
    }
    this.presetCryptoOverrideForTesting = undefined;
    const activeStorage = this.getEffectiveStorage();
    if (activeStorage.removeItem) {
      activeStorage.removeItem(APP_MODE_STORAGE_KEY);
    } else {
      safeStorage.removeItem(APP_MODE_STORAGE_KEY);
    }
    this.clearProductionRecordsFromMemory();
    this.customStorageForTesting = null;
    this.authLoading = false;
    resetThemeTokensOnDOM();
    this.notify();
  }
}

export const store = StoreManager.getInstance();

