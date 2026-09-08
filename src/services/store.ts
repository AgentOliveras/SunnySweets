import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  getDoc,
  getDocFromServer,
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
} from '../types';
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
import {
  getDefaultWorkspaceBranding,
  sanitizeDisplayName,
  getPaletteById,
  applyThemeTokensToDOM,
  resetThemeTokensOnDOM,
  DEFAULT_PALETTE_ID,
  DEFAULT_DISPLAY_NAME,
} from '../utils/branding';

export interface EntitlementStatus {
  hasValidEntitlement: boolean;
  plan: 'internal_phase0' | 'trial' | 'active_subscription' | 'expired';
  expiresAt: string | null;
}
import { standardizeIngredientsToUnit } from '../utils/units';

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
};

export interface SyncStatusInfo {
  status: 'synced' | 'syncing' | 'offline' | 'error';
  lastSynced: Date | null;
  message: string;
  itemCount: number;
}

// Helper for local storage read/write
function getLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${key} from localStorage:`, err);
  }
  return fallback;
}

function setLocal<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
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
  private workspaces: Workspace[] = [];
  private workspaceMembers: WorkspaceMemberDoc[] = [];
  private activeWorkspaceId: string = 'ws-main';
  private currentUserId: string | null = null;
  private validatedUid: string | null = null;
  private validatedUserRole: AccessRole | null = null;
  private initialized = false;
  private authLoading = true;
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
    const storedLastSync = localStorage.getItem(STORAGE_KEYS.LAST_SYNCED);
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

  private loadFromLocalStorage(): void {
    // Production records remain uninitialized in memory until UID authorization resolves
    this.recipes = [];
    this.presets = [];
    this.mixers = [];
    this.history = [];
    this.masterIngredients = [];

    const storedSettings = getLocal<UserSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    this.settings = {
      ...INITIAL_SETTINGS,
      ...storedSettings,
      defaultWastePercent:
        storedSettings?.defaultWastePercent !== undefined && storedSettings?.defaultWastePercent !== 0
          ? storedSettings.defaultWastePercent
          : (storedSettings?.defaultWastePercent === 0 && localStorage.getItem('bakery_settings_explicit_zero_waste') ? 0 : INITIAL_SETTINGS.defaultWastePercent),
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

    this.workspaces = getLocal<Workspace[]>(STORAGE_KEYS.WORKSPACES, [defaultWs]);

    this.activeWorkspaceId = this.settings.activeWorkspaceId || this.workspaces[0]?.id || 'ws-main';
  }

  private loadProductionRecordsFromLocalStorage(): void {
    if (!this.isAuthorized()) return;

    this.recipes = getLocal<Recipe[]>(STORAGE_KEYS.RECIPES, []);
    this.presets = getLocal<ProductionPreset[]>(STORAGE_KEYS.PRESETS, []).map((p) => {
      if (!p.category) {
        const nameLower = p.name.toLowerCase();
        if (nameLower.includes('cookie')) return { ...p, category: 'Cookies' };
        if (nameLower.includes('pie')) return { ...p, category: 'Pie Dough' };
        if (nameLower.includes('shortbread')) return { ...p, category: 'Shortbread' };
        if (nameLower.includes('loaf') || nameLower.includes('dough') || nameLower.includes('batard') || nameLower.includes('boule') || nameLower.includes('focaccia')) {
          return { ...p, category: 'Base Dough' };
        }
        return { ...p, category: 'Cookies' };
      }
      return p;
    });
    this.mixers = getLocal<Mixer[]>(STORAGE_KEYS.MIXERS, []);
    this.history = getLocal<ProductionHistoryEntry[]>(STORAGE_KEYS.HISTORY, []);
    this.masterIngredients = getLocal<MasterIngredient[]>(STORAGE_KEYS.MASTER_INGREDIENTS, []);
  }

  private clearProductionRecordsFromMemory(): void {
    this.recipes = [];
    this.presets = [];
    this.mixers = [];
    this.history = [];
    this.masterIngredients = [];
    this.workspaceMembers = [];

    // Clear production caches from localStorage on unauthorized or sign-out state
    localStorage.removeItem(STORAGE_KEYS.RECIPES);
    localStorage.removeItem(STORAGE_KEYS.PRESETS);
    localStorage.removeItem(STORAGE_KEYS.MIXERS);
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
    localStorage.removeItem(STORAGE_KEYS.MASTER_INGREDIENTS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_CHECKLIST);

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

  public initFirebaseSync(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.syncStatus = {
      status: 'offline',
      lastSynced: this.syncStatus.lastSynced,
      message: 'Sign In with Google to enable cloud sync',
      itemCount: this.getTotalItemCount(),
    };
    this.notify();

    // Listen to Auth state changes - Google Sign-In is the sole authentication method
    onAuthStateChanged(auth, async (user) => {
      if (user && user.uid) {
        const uid = user.uid;
        this.currentUserId = uid;
        this.settings.userId = uid;

        // Startup sequence:
        // 1. Authenticated Google user exists
        // 2. Validate membership for user UID
        const authorized = await this.validateMembershipForUser(uid);

        if (authorized && this.isAuthorized()) {
          // 3. Active workspace established
          // 4. Safely load cached records into memory
          this.loadProductionRecordsFromLocalStorage();
          this.applyActiveWorkspaceTheme();

          this.syncStatus = {
            status: 'syncing',
            lastSynced: this.syncStatus.lastSynced,
            message: 'Connecting to Cloud Firestore...',
            itemCount: this.getTotalItemCount(),
          };
          this.authLoading = false;
          this.notify();

          // 5. Establish live workspace-scoped Firestore listeners
          this.setupRealtimeListeners();

          // Save current user settings to cloud under this user's UID
          try {
            await setDoc(doc(db, 'settings', uid), sanitizeForFirestore({ ...this.settings, userId: uid }), { merge: true });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `settings/${uid}`);
          }
          this.updateSyncSuccess();
        } else {
          // Authenticated but unauthorized
          this.unsubs.forEach((unsub) => unsub());
          this.unsubs = [];
          this.clearProductionRecordsFromMemory();
          this.syncStatus = {
            status: 'offline',
            lastSynced: this.syncStatus.lastSynced,
            message: 'Account not authorized by workspace owner.',
            itemCount: 0,
          };
          this.authLoading = false;
          this.notify();
        }
      } else {
        // Disconnected / logged out: tear down listeners cleanly & clear records from memory
        this.unsubs.forEach((unsub) => unsub());
        this.unsubs = [];
        this.currentUserId = null;
        this.validatedUid = null;
        this.validatedUserRole = null;
        this.clearProductionRecordsFromMemory();
        this.authLoading = false;
        this.syncStatus = {
          status: 'offline',
          lastSynced: this.syncStatus.lastSynced,
          message: 'Sign in with Google to enable Cloud Sync',
          itemCount: 0,
        };
        this.notify();
      }
    });
  }

  private setupRealtimeListeners(): void {
    // Zero-trust enforcement: do not attach listeners if unauthenticated
    if (!auth.currentUser) return;

    // Clear previous snapshot listeners
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];

    const wsId = this.activeWorkspaceId || 'ws-main';

    // 0. Subscribe to Members of active workspace
    const membersColRef = collection(db, 'workspaces', wsId, 'members');
    const unsubMembers = onSnapshot(
      membersColRef,
      (snapshot) => {
        const memberList: WorkspaceMemberDoc[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          memberList.push({
            uid: data.uid || d.id,
            id: d.id,
            email: data.email || '',
            name: data.name || (data.email ? data.email.split('@')[0] : 'Member'),
            role: (data.role as AccessRole) || 'viewer',
            active: data.active !== false,
            addedAt: data.addedAt || '',
            updatedAt: data.updatedAt || data.addedAt || '',
          });
        });
        this.workspaceMembers = memberList;

        // Check if current user is still an active member
        const currentUid = auth.currentUser?.uid;
        if (currentUid) {
          const myDoc = memberList.find((m) => m.uid === currentUid);
          if (!myDoc || myDoc.active === false) {
            this.validatedUid = null;
            this.validatedUserRole = null;
            this.clearProductionRecordsFromMemory();
          } else if (myDoc.role !== this.validatedUserRole) {
            this.validatedUserRole = myDoc.role;
          }
        }
        this.notify();
      },
      (error) => {
        this.handleSyncError(error, `workspaces/${wsId}/members`);
      }
    );
    this.unsubs.push(unsubMembers);

    // 1. Subscribe to active Workspace
    const wsDocRef = doc(db, 'workspaces', wsId);
    const unsubWorkspace = onSnapshot(
      wsDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const remoteWs = snapshot.data() as Workspace;
          const idx = this.workspaces.findIndex((w) => w.id === remoteWs.id);
          if (idx >= 0) {
            this.workspaces[idx] = remoteWs;
          } else {
            this.workspaces.push(remoteWs);
          }
          setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
          this.applyActiveWorkspaceTheme();
          this.updateSyncSuccess();
        }
      },
      (error) => {
        this.handleSyncError(error, `workspaces/${wsId}`);
      }
    );
    this.unsubs.push(unsubWorkspace);

    // 2. Subscribe to Recipes scoped to active workspace
    const recipesQuery = query(collection(db, 'recipes'), where('workspaceId', '==', wsId));
    const unsubRecipes = onSnapshot(
      recipesQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const remoteRecipes: Recipe[] = snapshot.docs.map((d) => d.data() as Recipe);
          this.recipes = remoteRecipes;
          setLocal(STORAGE_KEYS.RECIPES, remoteRecipes);
          this.updateSyncSuccess();
        }
      },
      (error) => {
        this.handleSyncError(error, 'recipes');
      }
    );
    this.unsubs.push(unsubRecipes);

    // 3. Subscribe to Presets scoped to active workspace
    const presetsQuery = query(collection(db, 'presets'), where('workspaceId', '==', wsId));
    const unsubPresets = onSnapshot(
      presetsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const remotePresets: ProductionPreset[] = snapshot.docs.map((d) => d.data() as ProductionPreset);
          this.presets = remotePresets;
          setLocal(STORAGE_KEYS.PRESETS, remotePresets);
          this.updateSyncSuccess();
        }
      },
      (error) => {
        this.handleSyncError(error, 'presets');
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
    this.syncStatus = {
      status: 'synced',
      lastSynced: now,
      message: 'Cloud Synced & Up to Date',
      itemCount: this.getTotalItemCount(),
    };
    localStorage.setItem(STORAGE_KEYS.LAST_SYNCED, now.toISOString());
    this.notify();
  }

  private handleSyncError(error: unknown, path: string): void {
    handleFirestoreError(error, OperationType.GET, path);
    this.syncStatus = {
      status: 'error',
      lastSynced: this.syncStatus.lastSynced,
      message: 'Cloud Sync Notice: Retrying...',
      itemCount: this.getTotalItemCount(),
    };
    this.notify();
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

      // 3. Sync Presets (scoped to active workspace)
      for (const preset of this.presets) {
        if (isSample(preset)) continue;
        if (preset.workspaceId && preset.workspaceId !== wsId) continue;
        const presetToSync: ProductionPreset = {
          ...preset,
          workspaceId: wsId,
          userId: uid,
        };
        await setDoc(doc(db, 'presets', preset.id), sanitizeForFirestore(presetToSync));
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

      // 7. Sync User Settings for this authenticated user only
      await setDoc(doc(db, 'settings', uid), sanitizeForFirestore({ ...this.settings, userId: uid }), { merge: true });
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

  // --- Session & Access Control API ---
  public async validateMembershipForUser(uid: string): Promise<boolean> {
    const user = auth.currentUser;
    if (!user || user.uid !== uid) {
      this.validatedUid = null;
      this.validatedUserRole = null;
      return false;
    }

    const ws = this.getActiveWorkspace();
    const wsId = ws?.id || 'ws-main';

    // Query Firestore membership subcollection by UID
    try {
      const memberDoc = await getDoc(doc(db, 'workspaces', wsId, 'members', uid));
      if (memberDoc.exists()) {
        const data = memberDoc.data();
        if (
          data &&
          (data.role === 'owner' || data.role === 'editor' || data.role === 'viewer') &&
          data.active !== false
        ) {
          this.validatedUid = uid;
          this.validatedUserRole = data.role as AccessRole;
          this.loadProductionRecordsFromLocalStorage();
          this.setupRealtimeListeners();
          this.notify();
          return true;
        }
      }
    } catch (err) {
      console.warn('Membership subcollection lookup note:', err);
    }

    this.validatedUid = null;
    this.validatedUserRole = null;
    this.notify();
    return false;
  }

  public getSessionUserEmail(): string | null {
    return auth.currentUser?.email || null;
  }

  public getUserRole(): AccessRole | null {
    const user = auth.currentUser;
    if (!user || !user.uid) return null;
    if (user.uid !== this.validatedUid) return null;
    return this.validatedUserRole;
  }

  public isAuthorized(): boolean {
    const user = auth.currentUser;
    if (!user || !user.uid) return false;
    if (user.uid !== this.validatedUid) return false;
    const role = this.validatedUserRole;
    return role === 'owner' || role === 'editor' || role === 'viewer';
  }

  public isAuthLoading(): boolean {
    return this.authLoading;
  }

  public getEntitlementStatus(): EntitlementStatus {
    // Phase 0: All validated workspace members have internal access entitlement
    const isMember = this.isAuthorized();
    return {
      hasValidEntitlement: isMember,
      plan: 'internal_phase0',
      expiresAt: null,
    };
  }

  public canAccessApp(): boolean {
    const user = auth.currentUser;
    const isAuthenticated = Boolean(user && user.uid);
    const hasWorkspaceMembership = this.isAuthorized();
    const entitlement = this.getEntitlementStatus();
    const hasValidEntitlement = entitlement.hasValidEntitlement;

    return isAuthenticated && hasWorkspaceMembership && hasValidEntitlement;
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

  public async deleteMasterIngredient(id: string): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete ingredients.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete ingredients.');
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
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete recipes.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete recipes.');
    }
    this.recipes = this.recipes.filter((r) => r.id !== id);
    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();

    try {
      await deleteDoc(doc(db, 'recipes', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `recipes/${id}`);
    }
  }

  // --- Recipe Categories API ---
  public getRecipeCategories(): string[] {
    const fromRecipes = new Set<string>();
    this.recipes.forEach((r) => {
      if (r.category && r.category.trim()) {
        fromRecipes.add(r.category.trim());
      }
    });

    if (this.settings.recipeCategories && this.settings.recipeCategories.length > 0) {
      this.settings.recipeCategories.forEach((c) => {
        if (c && c.trim()) fromRecipes.add(c.trim());
      });
    }

    // If completely empty, default to at least one sample category or empty list
    return Array.from(fromRecipes);
  }

  public async addRecipeCategory(newCategory: string, defaultPresetCategories: string[] = ['All']): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add categories.');
    }
    const cleanName = newCategory.trim();
    if (!cleanName) return;

    const currentList = this.getRecipeCategories();
    const updatedList = Array.from(new Set([...currentList, cleanName]));

    const currentMap = { ...(this.settings.categoryPresetMap || {}) };
    if (!currentMap[cleanName]) {
      currentMap[cleanName] = defaultPresetCategories;
    }

    await this.updateSettings({
      recipeCategories: updatedList,
      categoryPresetMap: currentMap,
    });
  }

  public async renameRecipeCategory(oldCategory: string, newCategory: string): Promise<number> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot rename categories.');
    }
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

    // 2. Update category list & categoryPresetMap
    const currentList = this.getRecipeCategories();
    const updatedList = currentList.map((c) => (c.toLowerCase() === cleanOld.toLowerCase() ? cleanNew : c));
    if (!updatedList.includes(cleanNew)) {
      updatedList.push(cleanNew);
    }

    const currentMap = { ...(this.settings.categoryPresetMap || {}) };
    const existingMapping = currentMap[cleanOld] || currentMap[oldCategory];
    delete currentMap[cleanOld];
    delete currentMap[oldCategory];
    if (existingMapping) {
      currentMap[cleanNew] = existingMapping;
    }

    await this.updateSettings({
      recipeCategories: Array.from(new Set(updatedList)),
      categoryPresetMap: currentMap,
    });

    this.notify();
    return affectedCount;
  }

  public async deleteRecipeCategory(categoryToDelete: string, reassignToCategory?: string): Promise<number> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete categories.');
    }
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

    // 2. Remove from category list & categoryPresetMap
    const currentList = this.getRecipeCategories();
    const updatedList = currentList.filter((c) => c.toLowerCase() !== cleanCat.toLowerCase());

    const currentMap = { ...(this.settings.categoryPresetMap || {}) };
    delete currentMap[cleanCat];
    delete currentMap[categoryToDelete];

    await this.updateSettings({
      recipeCategories: updatedList,
      categoryPresetMap: currentMap,
    });

    this.notify();
    return affectedCount;
  }

  // --- Presets API ---
  public getPresets(): ProductionPreset[] {
    if (!this.isAuthorized()) return [];
    return this.presets;
  }

  public async savePreset(preset: ProductionPreset): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify presets.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save presets.');
    }
    const userId = currentUser.uid;
    const wsId = this.activeWorkspaceId || 'ws-main';
    const presetToSave: ProductionPreset = {
      ...preset,
      userId,
      workspaceId: preset.workspaceId || wsId,
      updatedAt: new Date().toISOString(),
    };

    const index = this.presets.findIndex((p) => p.id === preset.id);
    if (index >= 0) {
      this.presets[index] = presetToSave;
    } else {
      this.presets.unshift(presetToSave);
    }

    setLocal(STORAGE_KEYS.PRESETS, this.presets);
    this.notify();

    try {
      await setDoc(doc(db, 'presets', preset.id), sanitizeForFirestore(presetToSave));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `presets/${preset.id}`);
    }
  }

  public async deletePreset(id: string): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete presets.');
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete presets.');
    }
    this.presets = this.presets.filter((p) => p.id !== id);
    setLocal(STORAGE_KEYS.PRESETS, this.presets);
    this.notify();

    try {
      await deleteDoc(doc(db, 'presets', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `presets/${id}`);
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
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save production history.');
    }
    const userId = currentUser.uid;
    const wsId = this.activeWorkspaceId || 'ws-main';
    const entryToSave: ProductionHistoryEntry = {
      ...entry,
      userId,
      workspaceId: entry.workspaceId || wsId,
    };

    const index = this.history.findIndex((h) => h.id === entry.id);
    if (index >= 0) {
      this.history[index] = entryToSave;
    } else {
      this.history.unshift(entryToSave);
    }

    setLocal(STORAGE_KEYS.HISTORY, this.history);
    this.notify();

    try {
      await setDoc(doc(db, 'history', entry.id), sanitizeForFirestore(entryToSave));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `history/${entry.id}`);
    }
  }

  public async deleteHistoryEntry(id: string): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to delete production history.');
    }
    this.history = this.history.filter((h) => h.id !== id);
    setLocal(STORAGE_KEYS.HISTORY, this.history);
    this.notify();

    try {
      await deleteDoc(doc(db, 'history', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `history/${id}`);
    }
  }

  // --- Settings API ---
  public getSettings(): UserSettings {
    return this.settings;
  }

  public async updateSettings(updates: Partial<UserSettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates, updatedAt: new Date().toISOString() };
    setLocal(STORAGE_KEYS.SETTINGS, this.settings);
    if (updates.theme !== undefined) {
      this.applyActiveWorkspaceTheme();
    }
    this.notify();

    const currentUser = auth.currentUser;
    if (currentUser?.uid) {
      const targetUid = currentUser.uid;
      try {
        await setDoc(doc(db, 'settings', targetUid), sanitizeForFirestore(this.settings), { merge: true });
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
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_CHECKLIST);
    this.notify();
  }

  // --- Workspaces & Access Groups API ---
  public getWorkspaces(): Workspace[] {
    return this.workspaces;
  }

  public getActiveWorkspace(): Workspace | null {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId) || this.workspaces[0] || null;
  }

  public async setActiveWorkspace(id: string): Promise<void> {
    this.activeWorkspaceId = id;
    const ws = this.getActiveWorkspace();
    await this.updateSettings({
      activeWorkspaceId: id,
      workspaceName: ws?.name || 'Main Bakery Workspace',
    });
    this.applyActiveWorkspaceTheme();
    this.setupRealtimeListeners();
    this.notify();
  }

  public async saveWorkspace(workspace: Workspace): Promise<void> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication Required: You must be signed in with Google to save a workspace.');
    }
    const idx = this.workspaces.findIndex((w) => w.id === workspace.id);
    const updated = {
      ...workspace,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) {
      this.workspaces[idx] = updated;
    } else {
      this.workspaces.push(updated);
    }
    setLocal(STORAGE_KEYS.WORKSPACES, this.workspaces);
    this.notify();

    try {
      await setDoc(doc(db, 'workspaces', updated.id), sanitizeForFirestore(updated));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `workspaces/${updated.id}`);
    }
  }

  public async createWorkspace(name: string): Promise<Workspace> {
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
          active: data.active !== false,
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
      active: params.active !== false,
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

  public clearSession(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    this.currentUserId = null;
    this.validatedUid = null;
    this.validatedUserRole = null;
    this.clearProductionRecordsFromMemory();
    this.authLoading = false;
    resetThemeTokensOnDOM();
    this.notify();
  }
}

export const store = StoreManager.getInstance();

