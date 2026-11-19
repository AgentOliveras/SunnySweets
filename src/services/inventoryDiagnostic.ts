import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { store } from './store';

export const HISTORICAL_OWNER_UID = '42JFWv9G4eb4AvUql3VrvufLeGd2';
export const TARGET_WORKSPACE_ID = 'ws-main';

export interface ReadOnlyDiagnosticReport {
  timestamp: string;
  phase1: {
    authUid: string | null;
    authEmail: string | null;
    workspace: {
      exists: boolean;
      ownerId: string | null;
      ownerEmail: string | null;
      name?: string | null;
    };
    currentMember: {
      exists: boolean;
      uid: string | null;
      email: string | null;
      role: string | null;
      active: boolean | null;
    };
    userProfile: {
      exists: boolean;
      ownedWorkspaceId: string | null;
      defaultWorkspaceId: string | null;
      onboardingStatus: string | null;
    };
    workspaceMemberships: Array<{
      id: string;
      workspaceId?: string;
      role?: string;
      active?: boolean;
    }>;
    historicalMember: {
      exists: boolean;
      uid: string | null;
      email: string | null;
      role: string | null;
      active: boolean | null;
    };
  };
  phase2: {
    recipes: {
      total: number;
      active: number;
      archived: number;
    };
    masterIngredients: {
      total: number;
    };
    presets: {
      total: number;
    };
    mixers: {
      total: number;
    };
    history: {
      total: number;
    };
    settings: {
      exists: boolean;
      data: any | null;
    };
  };
}

let diagnosticRunning = false;
let lastReport: ReadOnlyDiagnosticReport | null = null;

export async function executeReadOnlyInventoryDiagnostic(force = false): Promise<ReadOnlyDiagnosticReport | null> {
  const isDevMode = Boolean(
    typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV
  );
  if (!isDevMode) {
    return null;
  }
  if (store.getUserRole() !== 'owner') {
    return null;
  }
  if (diagnosticRunning || (!force && lastReport)) return lastReport;
  diagnosticRunning = true;

  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn('[InventoryDiagnostic] No authenticated user detected.');
      return null;
    }

    const idToken = await currentUser.getIdToken();
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };

    const currentUid = currentUser.uid;
    const currentEmail = currentUser.email || null;

    // Phase 1 Reads
    const wsRef = doc(db, 'workspaces', TARGET_WORKSPACE_ID);
    const memberRef = doc(db, 'workspaces', TARGET_WORKSPACE_ID, 'members', currentUid);
    const historicalMemberRef = doc(db, 'workspaces', TARGET_WORKSPACE_ID, 'members', HISTORICAL_OWNER_UID);
    const userRef = doc(db, 'users', currentUid);
    const membershipsColRef = collection(db, 'users', currentUid, 'workspaceMemberships');

    // Phase 2 Reads
    const recipesQuery = query(collection(db, 'recipes'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
    const masterIngsQuery = query(collection(db, 'master_ingredients'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
    const presetsQuery = query(collection(db, 'presets'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
    const mixersQuery = query(collection(db, 'mixers'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
    const historyQuery = query(collection(db, 'history'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
    const settingsRef = doc(db, 'settings', currentUid);

    const [
      wsSnap,
      memberSnap,
      historicalMemberSnap,
      userSnap,
      membershipsSnap,
      recipesSnap,
      masterIngsSnap,
      presetsSnap,
      mixersSnap,
      historySnap,
      settingsSnap,
    ] = await Promise.all([
      getDoc(wsRef),
      getDoc(memberRef),
      getDoc(historicalMemberRef),
      getDoc(userRef),
      getDocs(membershipsColRef),
      getDocs(recipesQuery),
      getDocs(masterIngsQuery),
      getDocs(presetsQuery),
      getDocs(mixersQuery),
      getDocs(historyQuery),
      getDoc(settingsRef),
    ]);

    // Analyze recipes
    let activeRecipes = 0;
    let archivedRecipes = 0;
    let totalTopLevelIngredientLines = 0;
    let activeIngredientLines = 0;
    let archivedIngredientLines = 0;
    let totalRecipeSubIngredients = 0;
    const recipeAudit: Array<{
      id: string;
      name: string;
      archived: boolean;
      ingredientsLength: number;
      subIngredientsCount: number;
      duplicateLineIds: string[];
      unusuallyLarge: boolean;
    }> = [];

    const recipeIdsSeen = new Set<string>();
    const duplicateRecipeIds: string[] = [];

    recipesSnap.forEach((d) => {
      const data = d.data();
      const isArchived = data.archived === true;
      if (isArchived) {
        archivedRecipes++;
      } else {
        activeRecipes++;
      }

      if (recipeIdsSeen.has(d.id)) {
        duplicateRecipeIds.push(d.id);
      }
      recipeIdsSeen.add(d.id);

      const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
      const ingLen = ingredients.length;
      totalTopLevelIngredientLines += ingLen;
      if (isArchived) {
        archivedIngredientLines += ingLen;
      } else {
        activeIngredientLines += ingLen;
      }

      let subCount = 0;
      const seenIngIds = new Set<string>();
      const dupIngIds: string[] = [];

      for (const ing of ingredients) {
        if (ing.id) {
          if (seenIngIds.has(ing.id)) {
            dupIngIds.push(ing.id);
          }
          seenIngIds.add(ing.id);
        }
        if (ing.subIngredients) {
          if (Array.isArray(ing.subIngredients)) {
            subCount += ing.subIngredients.length;
          } else if (typeof ing.subIngredients === 'string' && ing.subIngredients.trim().length > 0) {
            subCount += ing.subIngredients.split(',').length;
          }
        }
      }
      totalRecipeSubIngredients += subCount;

      recipeAudit.push({
        id: d.id,
        name: data.name || 'Unnamed Recipe',
        archived: isArchived,
        ingredientsLength: ingLen,
        subIngredientsCount: subCount,
        duplicateLineIds: dupIngIds,
        unusuallyLarge: ingLen > 25,
      });
    });

    // Detailed forensic collection for all collections
    let formulaLinesWithMasterId = 0;
    const detailedRecipes: any[] = [];
    recipesSnap.forEach((d) => {
      const data = d.data();
      const ings = Array.isArray(data.ingredients) ? data.ingredients : [];
      let masterIdCount = 0;
      for (const ing of ings) {
        if (ing.masterIngredientId) {
          masterIdCount++;
          formulaLinesWithMasterId++;
        }
      }
      detailedRecipes.push({
        ...data,
        id: d.id,
        name: data.name || 'Unnamed Recipe',
        category: data.category || '',
        archived: data.archived === true,
        userId: data.userId || null,
        workspaceId: data.workspaceId || null,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        ingredientsCount: ings.length,
        masterIngredientIdCount: masterIdCount,
        ingredients: ings,
      });
    });

    const detailedMasterIngs: any[] = [];
    let masterIngSubIngredientEntries = 0;
    masterIngsSnap.forEach((d) => {
      const data = d.data();
      if (data.subIngredients) {
        if (Array.isArray(data.subIngredients)) {
          masterIngSubIngredientEntries += data.subIngredients.length;
        } else if (typeof data.subIngredients === 'string' && data.subIngredients.trim().length > 0) {
          masterIngSubIngredientEntries += data.subIngredients.split(',').length;
        }
      }
      detailedMasterIngs.push({
        id: d.id,
        name: data.name || '',
        category: data.category || '',
        userId: data.userId || null,
        workspaceId: data.workspaceId || null,
        brand: data.brand || '',
        supplier: data.supplier || '',
        allergens: data.allergens || '',
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
      });
    });

    const detailedPresets: any[] = [];
    presetsSnap.forEach((d) => {
      const data = d.data();
      detailedPresets.push({
        id: d.id,
        name: data.name || '',
        category: data.category || '',
        finishedWeight: data.finishedWeight ?? null,
        weightUnit: data.weightUnit || '',
        quantityPerUnit: data.quantityPerUnit ?? null,
        unitName: data.unitName || '',
        userId: data.userId || null,
        workspaceId: data.workspaceId || null,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
      });
    });

    const detailedMixers: any[] = [];
    mixersSnap.forEach((d) => {
      const data = d.data();
      detailedMixers.push({
        id: d.id,
        name: data.name || '',
        maxCapacityGrams: data.maxCapacityGrams ?? null,
        minCapacityGrams: data.minCapacityGrams ?? null,
        userId: data.userId || null,
        workspaceId: data.workspaceId || null,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
      });
    });

    // Inspect localStorage
    const localInspection: any = {
      storedLastSync: null,
      localRecipesCount: 0,
      localMasterIngsCount: 0,
      localPresetsCount: 0,
      localMixersCount: 0,
      localHistoryCount: 0,
      localSettings: null,
    };
    if (typeof localStorage !== 'undefined') {
      try {
        localInspection.storedLastSync = localStorage.getItem('bakery_last_synced');
        const r = localStorage.getItem('bakery_recipes');
        if (r) localInspection.localRecipesCount = JSON.parse(r).length;
        const mi = localStorage.getItem('bakery_master_ingredients');
        if (mi) localInspection.localMasterIngsCount = JSON.parse(mi).length;
        const p = localStorage.getItem('bakery_presets');
        if (p) localInspection.localPresetsCount = JSON.parse(p).length;
        const m = localStorage.getItem('bakery_mixers');
        if (m) localInspection.localMixersCount = JSON.parse(m).length;
        const h = localStorage.getItem('bakery_history');
        if (h) localInspection.localHistoryCount = JSON.parse(h).length;
        const s = localStorage.getItem('bakery_settings');
        if (s) localInspection.localSettings = JSON.parse(s);
      } catch (e) {
        console.warn('[InventoryDiagnostic] LocalStorage parse warning:', e);
      }
    }

    const forensicAuditPayload = {
      timestamp: new Date().toISOString(),
      authUid: currentUid,
      authEmail: currentEmail,
      counts: {
        recipes: recipesSnap.size,
        activeRecipes,
        archivedRecipes,
        totalTopLevelIngredientLines,
        activeIngredientLines,
        archivedIngredientLines,
        formulaLinesWithMasterId,
        masterIngredients: masterIngsSnap.size,
        presets: presetsSnap.size,
        mixers: mixersSnap.size,
        history: historySnap.size,
      },
      recipes: detailedRecipes,
      masterIngredients: detailedMasterIngs,
      presets: detailedPresets,
      mixers: detailedMixers,
      settings: settingsSnap.exists() ? settingsSnap.data() : null,
      localInspection,
    };

    // Post to backend forensic-audit endpoint
    try {
      await fetch('/api/dev/forensic-audit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(forensicAuditPayload),
      });
      console.log('[InventoryDiagnostic] Comprehensive forensic audit posted to /api/dev/forensic-audit.');
    } catch (fErr) {
      console.warn('[InventoryDiagnostic] Failed to post forensic audit:', fErr);
    }

    const detailedAuditPayload = {
      timestamp: new Date().toISOString(),
      totalRecipes: recipesSnap.size,
      totalTopLevelIngredientLines,
      activeRecipes,
      activeIngredientLines,
      archivedRecipes,
      archivedIngredientLines,
      sumMatches: activeIngredientLines + archivedIngredientLines === totalTopLevelIngredientLines,
      totalRecipeSubIngredients,
      masterIngSubIngredientEntries,
      duplicateRecipeIds,
      recipes: recipeAudit,
    };

    // Post to backend recipe-audit endpoint
    try {
      await fetch('/api/dev/recipe-audit', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(detailedAuditPayload),
      });
      console.log('[InventoryDiagnostic] Detailed recipe audit posted to /api/dev/recipe-audit.');
    } catch (auditErr) {
      console.warn('[InventoryDiagnostic] Failed to post to /api/dev/recipe-audit:', auditErr);
    }

    const membershipsList: Array<{ id: string; workspaceId?: string; role?: string; active?: boolean }> = [];
    membershipsSnap.forEach((d) => {
      membershipsList.push({ id: d.id, ...d.data() });
    });

    const report: ReadOnlyDiagnosticReport = {
      timestamp: new Date().toISOString(),
      phase1: {
        authUid: currentUid,
        authEmail: currentEmail,
        workspace: {
          exists: wsSnap.exists(),
          ownerId: wsSnap.exists() ? wsSnap.data()?.ownerId || null : null,
          ownerEmail: wsSnap.exists() ? wsSnap.data()?.ownerEmail || null : null,
          name: wsSnap.exists() ? wsSnap.data()?.name || null : null,
        },
        currentMember: {
          exists: memberSnap.exists(),
          uid: memberSnap.exists() ? memberSnap.data()?.uid || memberSnap.id : null,
          email: memberSnap.exists() ? memberSnap.data()?.email || null : null,
          role: memberSnap.exists() ? memberSnap.data()?.role || null : null,
          active: memberSnap.exists() ? memberSnap.data()?.active ?? null : null,
        },
        userProfile: {
          exists: userSnap.exists(),
          ownedWorkspaceId: userSnap.exists() ? userSnap.data()?.ownedWorkspaceId || null : null,
          defaultWorkspaceId: userSnap.exists() ? userSnap.data()?.defaultWorkspaceId || null : null,
          onboardingStatus: userSnap.exists() ? userSnap.data()?.onboardingStatus || null : null,
        },
        workspaceMemberships: membershipsList,
        historicalMember: {
          exists: historicalMemberSnap.exists(),
          uid: historicalMemberSnap.exists() ? historicalMemberSnap.data()?.uid || historicalMemberSnap.id : null,
          email: historicalMemberSnap.exists() ? historicalMemberSnap.data()?.email || null : null,
          role: historicalMemberSnap.exists() ? historicalMemberSnap.data()?.role || null : null,
          active: historicalMemberSnap.exists() ? historicalMemberSnap.data()?.active ?? null : null,
        },
      },
      phase2: {
        recipes: {
          total: recipesSnap.size,
          active: activeRecipes,
          archived: archivedRecipes,
        },
        masterIngredients: {
          total: masterIngsSnap.size,
        },
        presets: {
          total: presetsSnap.size,
        },
        mixers: {
          total: mixersSnap.size,
        },
        history: {
          total: historySnap.size,
        },
        settings: {
          exists: settingsSnap.exists(),
          data: settingsSnap.exists() ? settingsSnap.data() : null,
        },
      },
    };

    lastReport = report;

    // Post to backend diagnostic store
    try {
      await fetch('/api/dev/inventory-report', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(report),
      });
      console.log('[InventoryDiagnostic] Inventory report successfully posted to server.');
    } catch (postErr) {
      console.warn('[InventoryDiagnostic] Failed to post to /api/dev/inventory-report:', postErr);
    }

    return report;
  } catch (err) {
    console.error('[InventoryDiagnostic] Diagnostic error:', err);
    return null;
  } finally {
    diagnosticRunning = false;
  }
}
