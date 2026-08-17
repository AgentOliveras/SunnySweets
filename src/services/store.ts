import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  getDocFromServer,
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
} from '../types';
import { db, auth, handleFirestoreError, OperationType, sanitizeForFirestore, signInWithGoogle } from './firebase';
import { SAMPLE_RECIPES, SAMPLE_PRESETS, SAMPLE_MIXERS, INITIAL_SETTINGS, SAMPLE_MASTER_INGREDIENTS } from './sampleData';
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
  private activeWorkspaceId: string = 'ws-main';
  private currentUserId: string = 'offline-user';
  private sessionUserEmail: string | null = getLocal<string | null>('recipe_calc_user_email', 'jaoliveras@gmail.com');
  private initialized = false;
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
    this.recipes = getLocal<Recipe[]>(STORAGE_KEYS.RECIPES, SAMPLE_RECIPES);
    this.presets = getLocal<ProductionPreset[]>(STORAGE_KEYS.PRESETS, SAMPLE_PRESETS).map((p) => {
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
    this.mixers = getLocal<Mixer[]>(STORAGE_KEYS.MIXERS, SAMPLE_MIXERS);
    this.history = getLocal<ProductionHistoryEntry[]>(STORAGE_KEYS.HISTORY, []);
    const storedSettings = getLocal<UserSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    this.settings = {
      ...INITIAL_SETTINGS,
      ...storedSettings,
      defaultWastePercent:
        storedSettings?.defaultWastePercent !== undefined && storedSettings?.defaultWastePercent !== 0
          ? storedSettings.defaultWastePercent
          : (storedSettings?.defaultWastePercent === 0 && localStorage.getItem('bakery_settings_explicit_zero_waste') ? 0 : INITIAL_SETTINGS.defaultWastePercent),
    };
    this.masterIngredients = getLocal<MasterIngredient[]>(STORAGE_KEYS.MASTER_INGREDIENTS, SAMPLE_MASTER_INGREDIENTS);

    const defaultWs: Workspace = {
      id: 'ws-main',
      name: 'Main Bakery Workspace',
      ownerId: 'offline-user',
      ownerEmail: 'jaoliveras@gmail.com',
      code: 'BAKERY-MAIN',
      members: [
        {
          email: 'jaoliveras@gmail.com',
          name: 'Jaime Oliveras (Owner)',
          role: 'owner',
          addedAt: new Date().toISOString(),
        },
        {
          email: 'owner@bakery.com',
          name: 'Primary Owner',
          role: 'owner',
          addedAt: new Date().toISOString(),
        },
        {
          email: 'editor@bakery.com',
          name: 'Head Baker (Editor)',
          role: 'editor',
          addedAt: new Date().toISOString(),
        },
        {
          email: 'viewer@bakery.com',
          name: 'Kitchen Staff (Viewer)',
          role: 'viewer',
          addedAt: new Date().toISOString(),
        },
      ],
      groups: [
        {
          id: 'grp-kitchen',
          name: 'Kitchen Staff',
          memberEmails: ['baker@bakery.com'],
          role: 'editor',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadedWorkspaces = getLocal<Workspace[]>(STORAGE_KEYS.WORKSPACES, [defaultWs]);
    // Ensure default workspace has jaoliveras@gmail.com in members if it exists
    this.workspaces = loadedWorkspaces.map((ws) => {
      if (ws.id === 'ws-main') {
        const hasJaime = ws.members?.some((m) => m.email.toLowerCase() === 'jaoliveras@gmail.com');
        if (!hasJaime) {
          return {
            ...ws,
            members: [
              {
                email: 'jaoliveras@gmail.com',
                name: 'Jaime Oliveras',
                role: 'owner' as AccessRole,
                addedAt: new Date().toISOString(),
              },
              ...(ws.members || []),
            ],
          };
        }
      }
      return ws;
    });

    this.activeWorkspaceId = this.settings.activeWorkspaceId || this.workspaces[0]?.id || 'ws-main';
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

    this.testFirestoreConnection().catch((err) => console.warn('Connection test notice:', err));

    onAuthStateChanged(auth, async (user) => {
      // Clear previous snapshot listeners
      this.unsubs.forEach((unsub) => unsub());
      this.unsubs = [];

      if (user) {
        const uid = user.uid;
        this.currentUserId = uid;
        this.settings.userId = uid;
        this.syncStatus = {
          status: 'syncing',
          lastSynced: this.syncStatus.lastSynced,
          message: 'Connecting to Cloud Database...',
          itemCount: this.getTotalItemCount(),
        };
        this.notify();

        // 1. Subscribe to Workspaces for user
        const wsQuery = query(collection(db, 'workspaces'));
        const unsubWorkspaces = onSnapshot(
          wsQuery,
          (snapshot) => {
            if (!snapshot.empty) {
              const remoteWs: Workspace[] = snapshot.docs.map((d) => d.data() as Workspace);
              if (remoteWs.length > 0) {
                // Merge local workspaces not in remote
                const remoteIds = new Set(remoteWs.map((w) => w.id));
                const localOnly = this.workspaces.filter((w) => !remoteIds.has(w.id));
                if (localOnly.length > 0) {
                  localOnly.forEach((w) => {
                    setDoc(doc(db, 'workspaces', w.id), sanitizeForFirestore({ ...w, ownerId: uid })).catch((err) =>
                      handleFirestoreError(err, OperationType.WRITE, `workspaces/${w.id}`)
                    );
                  });
                }
                this.workspaces = remoteWs;
                setLocal(STORAGE_KEYS.WORKSPACES, remoteWs);
                this.updateSyncSuccess();
              }
            } else if (this.workspaces.length > 0) {
              this.workspaces.forEach((ws) => {
                setDoc(doc(db, 'workspaces', ws.id), sanitizeForFirestore({ ...ws, ownerId: uid })).catch((err) =>
                  handleFirestoreError(err, OperationType.WRITE, `workspaces/${ws.id}`)
                );
              });
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, 'workspaces');
          }
        );
        this.unsubs.push(unsubWorkspaces);

        // 2. Subscribe to Recipes (Realtime auto sync)
        const recipesQuery = query(collection(db, 'recipes'));
        const unsubRecipes = onSnapshot(
          recipesQuery,
          (snapshot) => {
            if (!snapshot.empty) {
              const remoteRecipes: Recipe[] = snapshot.docs.map((d) => d.data() as Recipe);
              const remoteIds = new Set(remoteRecipes.map((r) => r.id));
              const localOnly = this.recipes.filter((r) => !remoteIds.has(r.id));
              if (localOnly.length > 0) {
                localOnly.forEach((r) => {
                  setDoc(doc(db, 'recipes', r.id), sanitizeForFirestore({ ...r, userId: uid })).catch((err) =>
                    handleFirestoreError(err, OperationType.WRITE, `recipes/${r.id}`)
                  );
                });
              }
              this.recipes = remoteRecipes;
              setLocal(STORAGE_KEYS.RECIPES, remoteRecipes);
              this.updateSyncSuccess();
            } else if (this.recipes.length > 0) {
              this.recipes.forEach((r) => {
                setDoc(doc(db, 'recipes', r.id), sanitizeForFirestore({ ...r, userId: uid })).catch((err) =>
                  handleFirestoreError(err, OperationType.WRITE, `recipes/${r.id}`)
                );
              });
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, 'recipes');
          }
        );
        this.unsubs.push(unsubRecipes);

        // 3. Subscribe to Presets
        const presetsQuery = query(collection(db, 'presets'));
        const unsubPresets = onSnapshot(
          presetsQuery,
          (snapshot) => {
            if (!snapshot.empty) {
              const remotePresets: ProductionPreset[] = snapshot.docs.map((d) => d.data() as ProductionPreset);
              const remoteIds = new Set(remotePresets.map((p) => p.id));
              const localOnly = this.presets.filter((p) => !remoteIds.has(p.id));
              if (localOnly.length > 0) {
                localOnly.forEach((p) => {
                  setDoc(doc(db, 'presets', p.id), sanitizeForFirestore({ ...p, userId: uid })).catch((err) =>
                    handleFirestoreError(err, OperationType.WRITE, `presets/${p.id}`)
                  );
                });
              }
              this.presets = remotePresets;
              setLocal(STORAGE_KEYS.PRESETS, remotePresets);
              this.updateSyncSuccess();
            } else if (this.presets.length > 0) {
              this.presets.forEach((p) => {
                setDoc(doc(db, 'presets', p.id), sanitizeForFirestore({ ...p, userId: uid })).catch((err) =>
                  handleFirestoreError(err, OperationType.WRITE, `presets/${p.id}`)
                );
              });
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, 'presets');
          }
        );
        this.unsubs.push(unsubPresets);

        // 4. Subscribe to Mixers
        const mixersQuery = query(collection(db, 'mixers'));
        const unsubMixers = onSnapshot(
          mixersQuery,
          (snapshot) => {
            if (!snapshot.empty) {
              const remoteMixers: Mixer[] = snapshot.docs.map((d) => d.data() as Mixer);
              const remoteIds = new Set(remoteMixers.map((m) => m.id));
              const localOnly = this.mixers.filter((m) => !remoteIds.has(m.id));
              if (localOnly.length > 0) {
                localOnly.forEach((m) => {
                  setDoc(doc(db, 'mixers', m.id), sanitizeForFirestore({ ...m, userId: uid })).catch((err) =>
                    handleFirestoreError(err, OperationType.WRITE, `mixers/${m.id}`)
                  );
                });
              }
              this.mixers = remoteMixers;
              setLocal(STORAGE_KEYS.MIXERS, remoteMixers);
              this.updateSyncSuccess();
            } else if (this.mixers.length > 0) {
              this.mixers.forEach((m) => {
                setDoc(doc(db, 'mixers', m.id), sanitizeForFirestore({ ...m, userId: uid })).catch((err) =>
                  handleFirestoreError(err, OperationType.WRITE, `mixers/${m.id}`)
                );
              });
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, 'mixers');
          }
        );
        this.unsubs.push(unsubMixers);

        // 5. Subscribe to History
        const historyQuery = query(collection(db, 'history'));
        const unsubHistory = onSnapshot(
          historyQuery,
          (snapshot) => {
            if (!snapshot.empty) {
              const remoteHistory: ProductionHistoryEntry[] = snapshot.docs.map((d) => d.data() as ProductionHistoryEntry);
              remoteHistory.sort((a, b) => new Date(b.calculatedAt).getTime() - new Date(a.calculatedAt).getTime());
              const remoteIds = new Set(remoteHistory.map((h) => h.id));
              const localOnly = this.history.filter((h) => !remoteIds.has(h.id));
              if (localOnly.length > 0) {
                localOnly.forEach((h) => {
                  setDoc(doc(db, 'history', h.id), sanitizeForFirestore({ ...h, userId: uid })).catch((err) =>
                    handleFirestoreError(err, OperationType.WRITE, `history/${h.id}`)
                  );
                });
              }
              this.history = remoteHistory;
              setLocal(STORAGE_KEYS.HISTORY, remoteHistory);
              this.updateSyncSuccess();
            } else if (this.history.length > 0) {
              this.history.forEach((h) => {
                setDoc(doc(db, 'history', h.id), sanitizeForFirestore({ ...h, userId: uid })).catch((err) =>
                  handleFirestoreError(err, OperationType.WRITE, `history/${h.id}`)
                );
              });
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, 'history');
          }
        );
        this.unsubs.push(unsubHistory);

        // 6. Subscribe to Settings
        const settingsDocRef = doc(db, 'settings', uid);
        const unsubSettings = onSnapshot(
          settingsDocRef,
          (snapshot) => {
            if (snapshot.exists()) {
              const remote = snapshot.data() as Partial<UserSettings>;
              this.settings = {
                ...INITIAL_SETTINGS,
                ...this.settings,
                ...remote,
                userId: uid,
              };
              setLocal(STORAGE_KEYS.SETTINGS, this.settings);
              this.updateSyncSuccess();
            } else {
              setDoc(settingsDocRef, sanitizeForFirestore({ ...this.settings, userId: uid }), { merge: true }).catch((err) =>
                handleFirestoreError(err, OperationType.WRITE, `settings/${uid}`)
              );
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, `settings/${uid}`);
          }
        );
        this.unsubs.push(unsubSettings);

        // 7. Subscribe to Master Ingredients
        const masterIngsQuery = query(collection(db, 'master_ingredients'));
        const unsubMasterIngs = onSnapshot(
          masterIngsQuery,
          (snapshot) => {
            if (!snapshot.empty) {
              const remoteIngs: MasterIngredient[] = snapshot.docs.map((d) => d.data() as MasterIngredient);
              const remoteIds = new Set(remoteIngs.map((i) => i.id));
              const localOnly = this.masterIngredients.filter((i) => !remoteIds.has(i.id));
              if (localOnly.length > 0) {
                localOnly.forEach((mi) => {
                  setDoc(doc(db, 'master_ingredients', mi.id), sanitizeForFirestore({ ...mi, userId: uid })).catch((err) =>
                    handleFirestoreError(err, OperationType.WRITE, `master_ingredients/${mi.id}`)
                  );
                });
              }
              this.masterIngredients = remoteIngs;
              setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, remoteIngs);
              this.updateSyncSuccess();
            } else if (this.masterIngredients.length > 0) {
              this.masterIngredients.forEach((mi) => {
                setDoc(doc(db, 'master_ingredients', mi.id), sanitizeForFirestore({ ...mi, userId: uid })).catch((err) =>
                  handleFirestoreError(err, OperationType.WRITE, `master_ingredients/${mi.id}`)
                );
              });
              this.updateSyncSuccess();
            }
          },
          (error) => {
            this.handleSyncError(error, 'master_ingredients');
          }
        );
        this.unsubs.push(unsubMasterIngs);
      } else {
        this.currentUserId = 'offline-user';
        this.syncStatus = {
          status: 'offline',
          lastSynced: this.syncStatus.lastSynced,
          message: 'Local Offline Mode (Sign in to sync)',
          itemCount: this.getTotalItemCount(),
        };
        this.notify();
      }
    });
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

    if (!currentUser) {
      return {
        success: false,
        message: 'Please sign in with Google to enable cloud database synchronization.',
        count: 0,
      };
    }

    const uid = currentUser.uid;
    this.syncStatus = {
      status: 'syncing',
      lastSynced: this.syncStatus.lastSynced,
      message: 'Uploading and syncing all data to Firestore...',
      itemCount: this.getTotalItemCount(),
    };
    this.notify();

    try {
      let syncedCount = 0;

      // 1. Sync Recipes
      for (const recipe of this.recipes) {
        await setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore({ ...recipe, userId: uid }));
        syncedCount++;
      }

      // 2. Sync Master Ingredients
      for (const ing of this.masterIngredients) {
        await setDoc(doc(db, 'master_ingredients', ing.id), sanitizeForFirestore({ ...ing, userId: uid }));
        syncedCount++;
      }

      // 3. Sync Presets
      for (const preset of this.presets) {
        await setDoc(doc(db, 'presets', preset.id), sanitizeForFirestore({ ...preset, userId: uid }));
        syncedCount++;
      }

      // 4. Sync Mixers
      for (const mixer of this.mixers) {
        await setDoc(doc(db, 'mixers', mixer.id), sanitizeForFirestore({ ...mixer, userId: uid }));
        syncedCount++;
      }

      // 5. Sync History
      for (const hist of this.history) {
        await setDoc(doc(db, 'history', hist.id), sanitizeForFirestore({ ...hist, userId: uid }));
        syncedCount++;
      }

      // 6. Sync Workspaces
      for (const ws of this.workspaces) {
        await setDoc(doc(db, 'workspaces', ws.id), sanitizeForFirestore({ ...ws, ownerId: uid }));
        syncedCount++;
      }

      // 7. Sync Settings
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
  public setSessionUserEmail(email: string | null): void {
    this.sessionUserEmail = email ? email.trim().toLowerCase() : null;
    setLocal('recipe_calc_user_email', this.sessionUserEmail);
    this.notify();
  }

  public getSessionUserEmail(): string | null {
    if (auth.currentUser?.email) {
      return auth.currentUser.email;
    }
    return this.sessionUserEmail;
  }

  public getUserRole(): AccessRole | null {
    const ws = this.getActiveWorkspace();
    const currentUser = auth.currentUser;
    const userEmail = (currentUser?.email || this.sessionUserEmail)?.toLowerCase().trim();
    const userId = currentUser?.uid;

    if (!ws) return null;

    if (
      (userId && ws.ownerId === userId) ||
      (userEmail && ws.ownerEmail && ws.ownerEmail.toLowerCase().trim() === userEmail)
    ) {
      return 'owner';
    }

    if (userEmail) {
      const member = ws.members?.find((m) => m.email.toLowerCase().trim() === userEmail);
      if (member) {
        return member.role;
      }

      const group = ws.groups?.find((g) =>
        g.memberEmails?.some((e) => e.toLowerCase().trim() === userEmail)
      );
      if (group) {
        return group.role;
      }
    }

    return null;
  }

  public isAuthorized(): boolean {
    const role = this.getUserRole();
    return role === 'owner' || role === 'editor' || role === 'viewer';
  }

  public isEditorOrOwner(): boolean {
    const role = this.getUserRole();
    return role === 'owner' || role === 'editor';
  }

  public getMasterIngredients(): MasterIngredient[] {
    return this.masterIngredients;
  }

  public async saveMasterIngredient(ingredient: MasterIngredient): Promise<MasterIngredient> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify ingredients.');
    }
    const userId = auth.currentUser ? auth.currentUser.uid : this.currentUserId;
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
        updatedAt: new Date().toISOString(),
      };
      this.masterIngredients[existingIndex] = updatedItem;
    } else {
      updatedItem = {
        ...ingredient,
        id: ingredient.id || `mi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: ingredient.name.trim(),
        userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.masterIngredients.unshift(updatedItem);
    }

    setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, this.masterIngredients);
    this.notify();

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'master_ingredients', updatedItem.id), sanitizeForFirestore(updatedItem));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `master_ingredients/${updatedItem.id}`);
      }
    }

    return updatedItem;
  }

  public async deleteMasterIngredient(id: string): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot delete ingredients.');
    }
    this.masterIngredients = this.masterIngredients.filter((mi) => mi.id !== id);
    setLocal(STORAGE_KEYS.MASTER_INGREDIENTS, this.masterIngredients);
    this.notify();

    if (auth.currentUser) {
      try {
        await deleteDoc(doc(db, 'master_ingredients', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `master_ingredients/${id}`);
      }
    }
  }

  public async bulkImportMasterIngredients(items: Partial<MasterIngredient>[]): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot import ingredients.');
    }
    for (const item of items) {
      if (!item.name?.trim()) continue;
      const nameClean = item.name.trim();
      const existing = this.masterIngredients.find((m) => m.name.toLowerCase() === nameClean.toLowerCase());
      if (!existing) {
        await this.saveMasterIngredient({
          id: `mi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          userId: this.currentUserId,
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
    if (includeArchived) return this.recipes;
    return this.recipes.filter((r) => !r.archived);
  }

  public getRecipe(id: string): Recipe | undefined {
    return this.recipes.find((r) => r.id === id);
  }

  public async saveRecipe(recipe: Recipe): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot add or modify recipes.');
    }
    const userId = auth.currentUser ? auth.currentUser.uid : this.currentUserId;
    const recipeToSave = {
      ...recipe,
      userId,
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

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipeToSave));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`);
      }
    }
  }

  public async reorderRecipes(orderedRecipes: Recipe[]): Promise<void> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot reorder recipes.');
    }
    this.recipes = orderedRecipes.map((r, idx) => ({ ...r, orderIndex: idx }));
    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();

    if (auth.currentUser) {
      for (const recipe of this.recipes) {
        setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipe)).catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`)
        );
      }
    }
  }

  public async standardizeAllRecipeIngredients(targetUnit: WeightUnit, decimalPlaces?: number): Promise<number> {
    if (!this.isEditorOrOwner()) {
      throw new Error('Permission denied: Viewers cannot modify recipes.');
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

    if (auth.currentUser) {
      for (const recipe of this.recipes) {
        setDoc(doc(db, 'recipes', recipe.id), sanitizeForFirestore(recipe)).catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `recipes/${recipe.id}`)
        );
      }
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
    this.recipes = this.recipes.filter((r) => r.id !== id);
    setLocal(STORAGE_KEYS.RECIPES, this.recipes);
    this.notify();

    if (auth.currentUser) {
      try {
        await deleteDoc(doc(db, 'recipes', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `recipes/${id}`);
      }
    }
  }

  // --- Presets API ---
  public getPresets(): ProductionPreset[] {
    return this.presets;
  }

  public async savePreset(preset: ProductionPreset): Promise<void> {
    const userId = auth.currentUser ? auth.currentUser.uid : this.currentUserId;
    const presetToSave = {
      ...preset,
      userId,
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

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'presets', preset.id), sanitizeForFirestore(presetToSave));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `presets/${preset.id}`);
      }
    }
  }

  public async deletePreset(id: string): Promise<void> {
    this.presets = this.presets.filter((p) => p.id !== id);
    setLocal(STORAGE_KEYS.PRESETS, this.presets);
    this.notify();

    if (auth.currentUser) {
      try {
        await deleteDoc(doc(db, 'presets', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `presets/${id}`);
      }
    }
  }

  // --- Mixers API ---
  public getMixers(): Mixer[] {
    return this.mixers;
  }

  public async saveMixer(mixer: Mixer): Promise<void> {
    const userId = auth.currentUser ? auth.currentUser.uid : this.currentUserId;
    const mixerToSave = {
      ...mixer,
      userId,
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

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'mixers', mixer.id), sanitizeForFirestore(mixerToSave));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `mixers/${mixer.id}`);
      }
    }
  }

  public async deleteMixer(id: string): Promise<void> {
    this.mixers = this.mixers.filter((m) => m.id !== id);
    setLocal(STORAGE_KEYS.MIXERS, this.mixers);
    this.notify();

    if (auth.currentUser) {
      try {
        await deleteDoc(doc(db, 'mixers', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `mixers/${id}`);
      }
    }
  }

  // --- History API ---
  public getHistory(): ProductionHistoryEntry[] {
    return this.history;
  }

  public getHistoryEntry(id: string): ProductionHistoryEntry | undefined {
    return this.history.find((h) => h.id === id);
  }

  public async saveHistoryEntry(entry: ProductionHistoryEntry): Promise<void> {
    const userId = auth.currentUser ? auth.currentUser.uid : this.currentUserId;
    const entryToSave = {
      ...entry,
      userId,
    };

    const index = this.history.findIndex((h) => h.id === entry.id);
    if (index >= 0) {
      this.history[index] = entryToSave;
    } else {
      this.history.unshift(entryToSave);
    }

    setLocal(STORAGE_KEYS.HISTORY, this.history);
    this.notify();

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'history', entry.id), sanitizeForFirestore(entryToSave));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `history/${entry.id}`);
      }
    }
  }

  public async deleteHistoryEntry(id: string): Promise<void> {
    this.history = this.history.filter((h) => h.id !== id);
    setLocal(STORAGE_KEYS.HISTORY, this.history);
    this.notify();

    if (auth.currentUser) {
      try {
        await deleteDoc(doc(db, 'history', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `history/${id}`);
      }
    }
  }

  // --- Settings API ---
  public getSettings(): UserSettings {
    return this.settings;
  }

  public async updateSettings(updates: Partial<UserSettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates, updatedAt: new Date().toISOString() };
    setLocal(STORAGE_KEYS.SETTINGS, this.settings);
    this.notify();

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'settings', auth.currentUser.uid), sanitizeForFirestore(this.settings), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `settings/${auth.currentUser.uid}`);
      }
    }
  }

  // --- Active Guided Mixing Checklist State ---
  public getActiveChecklist(): any {
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
  }

  public async saveWorkspace(workspace: Workspace): Promise<void> {
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

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'workspaces', updated.id), sanitizeForFirestore(updated));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `workspaces/${updated.id}`);
      }
    }
  }

  public async createWorkspace(name: string): Promise<Workspace> {
    const userEmail = auth.currentUser?.email || 'owner@bakery.com';
    const userId = auth.currentUser ? auth.currentUser.uid : this.currentUserId;
    const newWs: Workspace = {
      id: `ws-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      ownerId: userId,
      ownerEmail: userEmail,
      code: `BAKERY-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      members: [
        {
          email: userEmail,
          name: auth.currentUser?.displayName || 'Workspace Owner',
          role: 'owner',
          addedAt: new Date().toISOString(),
        },
      ],
      groups: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.saveWorkspace(newWs);
    await this.setActiveWorkspace(newWs.id);
    return newWs;
  }

  public async addMemberToWorkspace(email: string, role: AccessRole, name?: string): Promise<void> {
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
  }

  public async removeMemberFromWorkspace(email: string): Promise<void> {
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const cleanEmail = email.toLowerCase().trim();
    const updatedMembers = ws.members.filter((m) => m.email.toLowerCase() !== cleanEmail);
    await this.saveWorkspace({ ...ws, members: updatedMembers });
  }

  public async updateMemberRole(email: string, role: AccessRole): Promise<void> {
    await this.addMemberToWorkspace(email, role);
  }

  public async addGroupToWorkspace(name: string, memberEmails: string[], role: AccessRole): Promise<void> {
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
    const ws = this.getActiveWorkspace();
    if (!ws) return;
    const updatedGroups = ws.groups.filter((g) => g.id !== groupId);
    await this.saveWorkspace({ ...ws, groups: updatedGroups });
  }

  public async joinWorkspaceByCode(code: string, userEmailInput?: string): Promise<boolean> {
    const cleanCode = code.trim().toUpperCase();
    let matched = this.workspaces.find((w) => w.code.toUpperCase() === cleanCode);
    const emailToUse = (userEmailInput || auth.currentUser?.email || this.sessionUserEmail || 'authorized-guest@bakery.com').toLowerCase().trim();

    if (matched) {
      await this.addMemberToWorkspace(emailToUse, 'editor');
      this.setSessionUserEmail(emailToUse);
      await this.setActiveWorkspace(matched.id);
      return true;
    }

    if (auth.currentUser) {
      try {
        const q = query(collection(db, 'workspaces'), where('code', '==', cleanCode));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const wsData = snap.docs[0].data() as Workspace;
          const updatedMembers = [
            ...(wsData.members || []),
            {
              email: emailToUse,
              name: auth.currentUser.displayName || emailToUse.split('@')[0],
              role: 'editor' as AccessRole,
              addedAt: new Date().toISOString(),
            },
          ];
          const updatedWs = { ...wsData, members: updatedMembers };
          await setDoc(doc(db, 'workspaces', updatedWs.id), sanitizeForFirestore(updatedWs));
          this.setSessionUserEmail(emailToUse);
          await this.saveWorkspace(updatedWs);
          await this.setActiveWorkspace(updatedWs.id);
          return true;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'workspaces');
      }
    }
    return false;
  }
}

export const store = StoreManager.getInstance();

