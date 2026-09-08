import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { db, auth, sanitizeForFirestore } from './firebase';
import { store } from './store';
import { Workspace, WorkspaceMemberDoc } from '../types';

export interface MigrationScanReport {
  workspaceId: string;
  isOwnerAuthenticated: boolean;
  currentUserUid: string | null;
  currentUserEmail: string | null;
  currentUserEmailVerified: boolean;
  workspaceDocExists: boolean;
  ownerMemberDocExists: boolean;
  unscopedRecipesCount: number;
  unscopedPresetsCount: number;
  unscopedMixersCount: number;
  unscopedHistoryCount: number;
  unscopedIngredientsCount: number;
  totalUnscopedCount: number;
  alreadyMigratedCount: number;
  isFullyMigrated: boolean;
}

export interface MigrationExecutionResult {
  success: boolean;
  status: 'MIGRATION VERIFIED' | 'MIGRATION INCOMPLETE — DO NOT DEPLOY FINAL RULES';
  message: string;
  migratedCounts: {
    recipes: number;
    presets: number;
    mixers: number;
    history: number;
    ingredients: number;
    workspaceMembers: number;
  };
  failures: {
    recipes: number;
    presets: number;
    mixers: number;
    history: number;
    ingredients: number;
    workspaceMembership: number;
  };
  verificationScan?: {
    unscopedRecipes: number;
    unscopedPresets: number;
    unscopedMixers: number;
    unscopedHistory: number;
    unscopedIngredients: number;
    ownerUidMembershipExists: boolean;
  };
  errors: string[];
}

/**
 * Scans the database and local storage to determine migration readiness
 * without modifying any documents.
 */
export async function scanForLegacyData(): Promise<MigrationScanReport> {
  const currentUser = auth.currentUser;
  const targetWorkspaceId = 'ws-main';

  const report: MigrationScanReport = {
    workspaceId: targetWorkspaceId,
    isOwnerAuthenticated: !!currentUser,
    currentUserUid: currentUser?.uid || null,
    currentUserEmail: currentUser?.email || null,
    currentUserEmailVerified: currentUser?.emailVerified === true,
    workspaceDocExists: false,
    ownerMemberDocExists: false,
    unscopedRecipesCount: 0,
    unscopedPresetsCount: 0,
    unscopedMixersCount: 0,
    unscopedHistoryCount: 0,
    unscopedIngredientsCount: 0,
    totalUnscopedCount: 0,
    alreadyMigratedCount: 0,
    isFullyMigrated: false,
  };

  if (!currentUser) {
    const localRecipes = store.getRecipes(true);
    const localPresets = store.getPresets();
    const localMixers = store.getMixers();
    const localHistory = store.getHistory();
    const localIngs = store.getMasterIngredients();

    report.unscopedRecipesCount = localRecipes.filter((r) => !r.workspaceId).length;
    report.unscopedPresetsCount = localPresets.filter((p) => !p.workspaceId).length;
    report.unscopedMixersCount = localMixers.filter((m) => !m.workspaceId).length;
    report.unscopedHistoryCount = localHistory.filter((h) => !h.workspaceId).length;
    report.unscopedIngredientsCount = localIngs.filter((i) => !i.workspaceId).length;
    report.totalUnscopedCount =
      report.unscopedRecipesCount +
      report.unscopedPresetsCount +
      report.unscopedMixersCount +
      report.unscopedHistoryCount +
      report.unscopedIngredientsCount;

    return report;
  }

  try {
    // Check workspace doc
    const wsSnap = await getDoc(doc(db, 'workspaces', targetWorkspaceId));
    report.workspaceDocExists = wsSnap.exists();

    // Check membership subcollection doc
    const memberSnap = await getDoc(
      doc(db, 'workspaces', targetWorkspaceId, 'members', currentUser.uid)
    );
    report.ownerMemberDocExists = memberSnap.exists();

    // Check recipes
    try {
      const recipesSnap = await getDocs(collection(db, 'recipes'));
      recipesSnap.forEach((d) => {
        const data = d.data();
        if (!data.workspaceId) {
          report.unscopedRecipesCount++;
        } else {
          report.alreadyMigratedCount++;
        }
      });
    } catch {
      report.unscopedRecipesCount = store.getRecipes(true).filter((r) => !r.workspaceId).length;
    }

    // Check presets
    try {
      const presetsSnap = await getDocs(collection(db, 'presets'));
      presetsSnap.forEach((d) => {
        const data = d.data();
        if (!data.workspaceId) {
          report.unscopedPresetsCount++;
        } else {
          report.alreadyMigratedCount++;
        }
      });
    } catch {
      report.unscopedPresetsCount = store.getPresets().filter((p) => !p.workspaceId).length;
    }

    // Check mixers
    try {
      const mixersSnap = await getDocs(collection(db, 'mixers'));
      mixersSnap.forEach((d) => {
        const data = d.data();
        if (!data.workspaceId) {
          report.unscopedMixersCount++;
        } else {
          report.alreadyMigratedCount++;
        }
      });
    } catch {
      report.unscopedMixersCount = store.getMixers().filter((m) => !m.workspaceId).length;
    }

    // Check history
    try {
      const historySnap = await getDocs(collection(db, 'history'));
      historySnap.forEach((d) => {
        const data = d.data();
        if (!data.workspaceId) {
          report.unscopedHistoryCount++;
        } else {
          report.alreadyMigratedCount++;
        }
      });
    } catch {
      report.unscopedHistoryCount = store.getHistory().filter((h) => !h.workspaceId).length;
    }

    // Check master_ingredients
    try {
      const ingSnap = await getDocs(collection(db, 'master_ingredients'));
      ingSnap.forEach((d) => {
        const data = d.data();
        if (!data.workspaceId) {
          report.unscopedIngredientsCount++;
        } else {
          report.alreadyMigratedCount++;
        }
      });
    } catch {
      report.unscopedIngredientsCount = store.getMasterIngredients().filter((i) => !i.workspaceId).length;
    }

    report.totalUnscopedCount =
      report.unscopedRecipesCount +
      report.unscopedPresetsCount +
      report.unscopedMixersCount +
      report.unscopedHistoryCount +
      report.unscopedIngredientsCount;

    report.isFullyMigrated =
      report.workspaceDocExists &&
      report.ownerMemberDocExists &&
      report.totalUnscopedCount === 0;
  } catch (err) {
    console.warn('Scan for legacy data encountered notice:', err);
  }

  return report;
}

/**
 * Executes a strictly non-destructive, idempotent migration to partition
 * all legacy production data under `ws-main` and create owner membership.
 *
 * Strict Security Rules:
 * - Requires authentic currentUser != null
 * - Requires currentUser.uid != null
 * - Requires currentUser.email != null
 * - Requires currentUser.emailVerified == true
 * - If any condition fails: STOP MIGRATION
 * - No identity substitution
 * - Must NOT silently succeed after partial failure
 * - Performs post-migration verification scan
 * - Only reports MIGRATION VERIFIED when all unscoped counts are 0 and owner membership exists
 */
export async function executePhase0Migration(): Promise<MigrationExecutionResult> {
  const currentUser = auth.currentUser;

  // Strict identity validation (Requirement 5 & 9)
  if (!currentUser || !currentUser.uid || !currentUser.email || currentUser.emailVerified !== true) {
    const reason = !currentUser
      ? 'No authenticated user found. Google Sign-In is required.'
      : !currentUser.uid
      ? 'Authenticated user has no valid UID.'
      : !currentUser.email
      ? 'Authenticated user has no email address.'
      : !currentUser.emailVerified
      ? `Authenticated Google email (${currentUser.email}) is not verified. Email verification is strictly required.`
      : 'Invalid user credentials.';

    return {
      success: false,
      status: 'MIGRATION INCOMPLETE — DO NOT DEPLOY FINAL RULES',
      message: `STOP MIGRATION: ${reason}`,
      migratedCounts: { recipes: 0, presets: 0, mixers: 0, history: 0, ingredients: 0, workspaceMembers: 0 },
      failures: { recipes: 0, presets: 0, mixers: 0, history: 0, ingredients: 0, workspaceMembership: 1 },
      errors: [reason],
    };
  }

  const ownerUid = currentUser.uid;
  const ownerEmail = currentUser.email.toLowerCase().trim();
  const ownerName = currentUser.displayName || ownerEmail.split('@')[0];
  const targetWorkspaceId = 'ws-main';

  const failures = {
    recipes: 0,
    presets: 0,
    mixers: 0,
    history: 0,
    ingredients: 0,
    workspaceMembership: 0,
  };

  const migratedCounts = {
    recipes: 0,
    presets: 0,
    mixers: 0,
    history: 0,
    ingredients: 0,
    workspaceMembers: 0,
  };

  const errors: string[] = [];

  // 1. Ensure Workspace Document exists and has ownerId
  try {
    const wsRef = doc(db, 'workspaces', targetWorkspaceId);
    const existingWs = store.getActiveWorkspace();
    const wsData: Partial<Workspace> = {
      id: targetWorkspaceId,
      name: existingWs?.name || 'Main Bakery Workspace',
      ownerId: ownerUid,
      ownerEmail: ownerEmail,
      code: existingWs?.code || 'BAKERY-MAIN',
      updatedAt: new Date().toISOString(),
    };

    await setDoc(wsRef, sanitizeForFirestore(wsData), { merge: true });

    // 2. Create / Update Owner Membership Subcollection: workspaces/ws-main/members/{ownerUid}
    const memberDocRef = doc(db, 'workspaces', targetWorkspaceId, 'members', ownerUid);
    const nowIso = new Date().toISOString();
    const memberData: WorkspaceMemberDoc = {
      id: ownerUid,
      uid: ownerUid,
      role: 'owner',
      email: ownerEmail,
      name: ownerName,
      active: true,
      addedAt: nowIso,
      updatedAt: nowIso,
    };
    await setDoc(memberDocRef, sanitizeForFirestore(memberData), { merge: true });
    migratedCounts.workspaceMembers++;
  } catch (err: any) {
    failures.workspaceMembership++;
    errors.push(`Workspace membership establishment failed: ${err.message || String(err)}`);
  }

  // 3. Migrate Recipes (non-destructive merge of workspaceId only)
  try {
    const recipesSnap = await getDocs(collection(db, 'recipes'));
    for (const d of recipesSnap.docs) {
      const data = d.data();
      if (!data.workspaceId) {
        try {
          await setDoc(
            doc(db, 'recipes', d.id),
            { workspaceId: targetWorkspaceId, updatedAt: data.updatedAt || new Date().toISOString() },
            { merge: true }
          );
          migratedCounts.recipes++;
        } catch (docErr: any) {
          failures.recipes++;
          errors.push(`Recipe document "${d.id}" failed to scope: ${docErr.message || String(docErr)}`);
        }
      }
    }
  } catch (err: any) {
    failures.recipes++;
    errors.push(`Recipes collection query failed: ${err.message || String(err)}`);
  }

  // 4. Migrate Presets
  try {
    const presetsSnap = await getDocs(collection(db, 'presets'));
    for (const d of presetsSnap.docs) {
      const data = d.data();
      if (!data.workspaceId) {
        try {
          await setDoc(
            doc(db, 'presets', d.id),
            { workspaceId: targetWorkspaceId, updatedAt: data.updatedAt || new Date().toISOString() },
            { merge: true }
          );
          migratedCounts.presets++;
        } catch (docErr: any) {
          failures.presets++;
          errors.push(`Preset document "${d.id}" failed to scope: ${docErr.message || String(docErr)}`);
        }
      }
    }
  } catch (err: any) {
    failures.presets++;
    errors.push(`Presets collection query failed: ${err.message || String(err)}`);
  }

  // 5. Migrate Mixers
  try {
    const mixersSnap = await getDocs(collection(db, 'mixers'));
    for (const d of mixersSnap.docs) {
      const data = d.data();
      if (!data.workspaceId) {
        try {
          await setDoc(
            doc(db, 'mixers', d.id),
            { workspaceId: targetWorkspaceId, updatedAt: data.updatedAt || new Date().toISOString() },
            { merge: true }
          );
          migratedCounts.mixers++;
        } catch (docErr: any) {
          failures.mixers++;
          errors.push(`Mixer document "${d.id}" failed to scope: ${docErr.message || String(docErr)}`);
        }
      }
    }
  } catch (err: any) {
    failures.mixers++;
    errors.push(`Mixers collection query failed: ${err.message || String(err)}`);
  }

  // 6. Migrate History
  try {
    const historySnap = await getDocs(collection(db, 'history'));
    for (const d of historySnap.docs) {
      const data = d.data();
      if (!data.workspaceId) {
        try {
          await setDoc(
            doc(db, 'history', d.id),
            { workspaceId: targetWorkspaceId },
            { merge: true }
          );
          migratedCounts.history++;
        } catch (docErr: any) {
          failures.history++;
          errors.push(`History document "${d.id}" failed to scope: ${docErr.message || String(docErr)}`);
        }
      }
    }
  } catch (err: any) {
    failures.history++;
    errors.push(`History collection query failed: ${err.message || String(err)}`);
  }

  // 7. Migrate Master Ingredients
  try {
    const ingSnap = await getDocs(collection(db, 'master_ingredients'));
    for (const d of ingSnap.docs) {
      const data = d.data();
      if (!data.workspaceId) {
        try {
          await setDoc(
            doc(db, 'master_ingredients', d.id),
            { workspaceId: targetWorkspaceId },
            { merge: true }
          );
          migratedCounts.ingredients++;
        } catch (docErr: any) {
          failures.ingredients++;
          errors.push(`Master ingredient document "${d.id}" failed to scope: ${docErr.message || String(docErr)}`);
        }
      }
    }
  } catch (err: any) {
    failures.ingredients++;
    errors.push(`Master ingredients collection query failed: ${err.message || String(err)}`);
  }

  // 8. Update Local State & localStorage to maintain synchronous integrity
  await store.applyWorkspaceScopeToLocalData(targetWorkspaceId, ownerUid);

  // 9. Mandatory Post-Migration Verification Scan (Requirement 10)
  const verificationScan = {
    unscopedRecipes: 0,
    unscopedPresets: 0,
    unscopedMixers: 0,
    unscopedHistory: 0,
    unscopedIngredients: 0,
    ownerUidMembershipExists: false,
  };

  try {
    const memCheck = await getDoc(doc(db, 'workspaces', targetWorkspaceId, 'members', ownerUid));
    verificationScan.ownerUidMembershipExists = memCheck.exists();

    const rSnap = await getDocs(collection(db, 'recipes'));
    verificationScan.unscopedRecipes = rSnap.docs.filter((d) => !d.data().workspaceId).length;

    const pSnap = await getDocs(collection(db, 'presets'));
    verificationScan.unscopedPresets = pSnap.docs.filter((d) => !d.data().workspaceId).length;

    const mSnap = await getDocs(collection(db, 'mixers'));
    verificationScan.unscopedMixers = mSnap.docs.filter((d) => !d.data().workspaceId).length;

    const hSnap = await getDocs(collection(db, 'history'));
    verificationScan.unscopedHistory = hSnap.docs.filter((d) => !d.data().workspaceId).length;

    const iSnap = await getDocs(collection(db, 'master_ingredients'));
    verificationScan.unscopedIngredients = iSnap.docs.filter((d) => !d.data().workspaceId).length;
  } catch (vErr: any) {
    errors.push(`Post-migration verification scan error: ${vErr.message || String(vErr)}`);
  }

  const totalFailures =
    failures.recipes +
    failures.presets +
    failures.mixers +
    failures.history +
    failures.ingredients +
    failures.workspaceMembership;

  const totalUnscopedRemaining =
    verificationScan.unscopedRecipes +
    verificationScan.unscopedPresets +
    verificationScan.unscopedMixers +
    verificationScan.unscopedHistory +
    verificationScan.unscopedIngredients;

  const allChecksPassed =
    totalFailures === 0 &&
    totalUnscopedRemaining === 0 &&
    verificationScan.ownerUidMembershipExists;

  if (allChecksPassed) {
    const totalMigrated =
      migratedCounts.recipes +
      migratedCounts.presets +
      migratedCounts.mixers +
      migratedCounts.history +
      migratedCounts.ingredients;

    return {
      success: true,
      status: 'MIGRATION VERIFIED',
      message: `MIGRATION VERIFIED: Successfully bound ${totalMigrated} legacy records to workspace "${targetWorkspaceId}". Owner UID membership created for ${ownerEmail} (${ownerUid}). Post-migration scan confirmed 0 unscoped documents remaining.`,
      migratedCounts,
      failures,
      verificationScan,
      errors: [],
    };
  }

  return {
    success: false,
    status: 'MIGRATION INCOMPLETE — DO NOT DEPLOY FINAL RULES',
    message: `MIGRATION INCOMPLETE — DO NOT DEPLOY FINAL RULES. ${totalFailures} failures encountered. ${totalUnscopedRemaining} unscoped documents remain. Owner membership exists: ${verificationScan.ownerUidMembershipExists}. Errors: ${errors.join('; ')}`,
    migratedCounts,
    failures,
    verificationScan,
    errors,
  };
}
