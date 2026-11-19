/**
 * Phase 2A.6B — Authenticated Stage 1 Execution Utility Service
 *
 * Provides safe, owner-only, browser-authenticated execution logic for Phase 2A Stage 1
 * Master Ingredient linking.
 *
 * STRICT SAFETY INVARIANTS:
 * 1. OWNER-ONLY: Viewers and Editors are strictly rejected with an error.
 * 2. WEB SDK AUTHENTICATION: Writes execute through authenticated Firebase Web SDK (db, auth.currentUser).
 * 3. NO SERVER BYPASS: Does not rely on Node backend credentials, server service accounts, or mocked Firestore.
 * 4. WORKSPACE ISOLATION: Scoped exclusively to active workspace 'ws-main'. Cross-workspace targets are rejected.
 * 5. FORMULA IMMUTABILITY: Modifies ONLY masterIngredientId and updatedAt.
 *    Recipe quantities, units, waste, names, notes, and calculations are strictly untouched.
 * 6. PRE-WRITE & POST-WRITE VERIFICATION:
 *    - Pre-write formula hash must match post-write formula hash.
 *    - Expected post-write active lines: exactly 516 linked (4 pre-existing + 512 Stage 1), 169 unlinked (Stage 2).
 *    - Zero broken links, zero changes to archived recipes (21 unlinked formula lines preserved).
 */

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch,
  Firestore,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { Recipe, MasterIngredient, AccessRole } from '../types';

export const STAGE1_APPROVED_MANIFEST_FINGERPRINT =
  '3c2b327885d07c3a0975fee1f7de873318854f37e61ae043e4ad8df15979e5ca';

export const TARGET_WORKSPACE_ID = 'ws-main';

/**
 * Authoritative mapping for the 10 human-review groups approved for Stage 2 (169 active formula lines).
 * NOTE: 'marhsmallow' strictly maps to mi-1785876432641 ('Marshmallows').
 * The corrupted Master Ingredient mi-1787072264396-0v58 MUST NOT be used.
 */
export interface Stage2AuthoritativeMapping {
  id: string;
  name: string;
  decisionType: string;
}

export const STAGE2_AUTHORITATIVE_MAPPINGS: Record<string, Stage2AuthoritativeMapping> = {
  'unsalted butter': {
    id: 'mi-9',
    name: 'Unsalted Butter',
    decisionType: 'Ambiguity Resolution / Canonical Butter Entry',
  },
  'sugar': {
    id: 'mi-1785877164225-axt7',
    name: 'Sugar',
    decisionType: 'Ambiguity Resolution / Common Pantry Sugar',
  },
  'dark brown sugar': {
    id: 'mi-6',
    name: 'Dark Brown Sugar',
    decisionType: 'Specification Separation',
  },
  'oatmeal': {
    id: 'mi-1785876569598',
    name: 'Oatmeal',
    decisionType: 'Variety Selection',
  },
  'light brown sugar': {
    id: 'mi-1785876302990',
    name: 'Light Brown Sugar',
    decisionType: 'Specification Separation',
  },
  'flax seeds (ground)': {
    id: 'mi-1785876091244',
    name: 'Flax Seeds (Ground)',
    decisionType: 'Form Differentiation',
  },
  'butter': {
    id: 'mi-9',
    name: 'Unsalted Butter',
    decisionType: 'Synonym / Alias Mapping (Dark Orange Cookies)',
  },
  'flax seed meal': {
    id: 'mi-1785876070988',
    name: 'Flax Seed Meal',
    decisionType: 'Form Differentiation',
  },
  'marhsmallow': {
    id: 'mi-1785876432641',
    name: 'Marshmallows',
    decisionType: 'Typo Correction / Authoritative Target (Orange Marshmallow Cookies)',
  },
  'steel cut': {
    id: 'mi-1787074632520-5frd',
    name: 'Steel Cut',
    decisionType: 'Form Differentiation (Breakfast Oatmeal Bar)',
  },
};

/**
 * The 10 human-review groups explicitly approved for Stage 2 (169 active formula lines).
 * These MUST be excluded from Stage 1 linking.
 */
export const STAGE2_HUMAN_REVIEW_NAMES: ReadonlySet<string> = new Set(
  Object.keys(STAGE2_AUTHORITATIVE_MAPPINGS)
);

export interface ManifestRecord {
  recipeId: string;
  recipeName: string;
  ingredientId: string;
  ingredientDisplayName: string;
  proposedMasterIngredientId: string;
  proposedMasterIngredientName: string;
  stage: 'STAGE_1' | 'STAGE_2';
}

export interface Stage1PlannedLink {
  recipeId: string;
  recipeName: string;
  ingredientId: string;
  ingredientName: string;
  masterIngredientId: string;
  masterIngredientName: string;
}

export interface Stage1GroupSummary {
  normalizedName: string;
  displayName: string;
  activeCount: number;
  masterIngredientId: string;
  masterIngredientName: string;
}

export interface Stage1LinkingPlan {
  totalRecipes: number;
  activeRecipes: number;
  archivedRecipes: number;
  totalFormulaLines: number;
  activeFormulaLines: number;
  archivedFormulaLines: number;
  preExistingLinkedActiveLines: number;
  unlinkedActiveLines: number;
  brokenLinks: number;

  stage1LinesToLink: number;
  stage1GroupsCount: number;
  stage1AffectedRecipesCount: number;
  stage1Groups: Stage1GroupSummary[];
  stage1PlannedLinks: Stage1PlannedLink[];

  stage2ExcludedLines: number;
  stage2ExcludedGroupsCount: number;
  stage2Breakdown: Record<string, number>;

  preWriteFormulaHash: string;
  approvedManifestFingerprint: string;
  currentManifestFingerprint: string;
  isFingerprintApproved: boolean;
  invariantViolations: string[];
  isValid: boolean;
}

export interface Stage1ExecutionResult {
  success: boolean;
  message: string;
  affectedRecipesCount: number;
  linkedLinesCount: number;
  preWriteFormulaHash: string;
  postWriteFormulaHash: string;
  postWriteActiveLinked: number;
  postWriteActiveUnlinked: number;
  postWriteBrokenLinks: number;
  postWriteArchivedUntouched: number;
  timestamp: string;
  operatorEmail: string | null;
  operatorUid: string;
}

/**
 * Reconstructs all 681 active unlinked records across the active recipe census
 * into a canonical manifest. Deterministically sorted by recipeId, then ingredientId.
 */
export function buildComplete681Manifest(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[]
): ManifestRecord[] {
  const masterByName = new Map<string, MasterIngredient>();
  masterIngredients.forEach((m) => {
    const k = m.name.trim().toLowerCase();
    if (!masterByName.has(k)) masterByName.set(k, m);
  });

  const activeRecipes = recipes.filter((r) => !r.archived);
  const records: ManifestRecord[] = [];

  for (const recipe of activeRecipes) {
    for (const ing of recipe.ingredients || []) {
      if (ing.masterIngredientId) continue; // Skip 4 pre-linked active lines

      const norm = ing.name.trim().toLowerCase();
      if (STAGE2_HUMAN_REVIEW_NAMES.has(norm)) {
        const mapping = STAGE2_AUTHORITATIVE_MAPPINGS[norm];
        records.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingredientId: ing.id,
          ingredientDisplayName: ing.name.trim(),
          proposedMasterIngredientId: mapping ? mapping.id : '',
          proposedMasterIngredientName: mapping ? mapping.name : '',
          stage: 'STAGE_2',
        });
      } else {
        const match = masterByName.get(norm);
        records.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingredientId: ing.id,
          ingredientDisplayName: ing.name.trim(),
          proposedMasterIngredientId: match ? match.id : '',
          proposedMasterIngredientName: match ? match.name : '',
          stage: 'STAGE_1',
        });
      }
    }
  }

  // Deterministic canonical sorting by recipeId, then ingredientId
  records.sort(
    (a, b) => a.recipeId.localeCompare(b.recipeId) || a.ingredientId.localeCompare(b.ingredientId)
  );

  return records;
}

/**
 * Computes a deterministic SHA-256 hash for the complete 681-record manifest.
 */
export async function computeManifestFingerprint(manifest: ManifestRecord[]): Promise<string> {
  const jsonStr = JSON.stringify(manifest);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);

  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const nodeCrypto = await import('crypto').catch(() => null);
  if (nodeCrypto && (nodeCrypto as any).createHash) {
    return (nodeCrypto as any).createHash('sha256').update(jsonStr).digest('hex');
  }

  let hash = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `hash-${Math.abs(hash).toString(16)}`;
}

/**
 * Computes a hardened, deterministic SHA-256 hash of all recipe formula lines across recipes.
 * Strictly verifies all mathematical formula and recipe definition fields:
 * - Recipe level: id, name, description, category, workspaceId, userId, archived, orderIndex,
 *   batchYieldQuantity, batchYieldUnit, defaultWastePercent, createdAt.
 * - Ingredient level: id, name, quantity, unit, wastePercent, notes, densityGramsPerMl, subIngredients.
 * Preserves ingredient ordering.
 * EXCLUDES ONLY fields modified by linking: masterIngredientId and updatedAt.
 */
export async function computeFormulaSnapshotHash(recipes: Recipe[]): Promise<string> {
  const sorted = [...recipes].sort((a, b) => a.id.localeCompare(b.id));

  const canonicalFormula = sorted.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    category: r.category || '',
    workspaceId: r.workspaceId || '',
    userId: r.userId || '',
    archived: Boolean(r.archived),
    orderIndex: r.orderIndex !== undefined ? r.orderIndex : null,
    batchYieldQuantity: Number(r.batchYieldQuantity) || 0,
    batchYieldUnit: r.batchYieldUnit || '',
    defaultWastePercent: Number(r.defaultWastePercent) || 0,
    createdAt: r.createdAt || '',
    ingredients: (r.ingredients || []).map((ing) => ({
      id: ing.id,
      name: ing.name.trim(),
      quantity: Number(ing.quantity) || 0,
      unit: ing.unit || '',
      wastePercent: Number(ing.wastePercent) || 0,
      notes: ing.notes || '',
      densityGramsPerMl: ing.densityGramsPerMl !== undefined ? Number(ing.densityGramsPerMl) : null,
      subIngredients: (ing as any).subIngredients || '',
    })),
  }));

  const jsonStr = JSON.stringify(canonicalFormula);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);

  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const nodeCrypto = await import('crypto').catch(() => null);
  if (nodeCrypto && (nodeCrypto as any).createHash) {
    return (nodeCrypto as any).createHash('sha256').update(jsonStr).digest('hex');
  }

  // Fallback simple checksum if crypto.subtle is unavailable
  let hash = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `hash-${Math.abs(hash).toString(16)}`;
}

/**
 * Builds the deterministic Stage 1 Linking Plan by analyzing live recipes and master ingredients.
 * Checks all baseline assertions and security invariants.
 */
export async function buildStage1LinkingPlan(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[],
  activeWorkspaceId: string = TARGET_WORKSPACE_ID
): Promise<Stage1LinkingPlan> {
  const invariantViolations: string[] = [];

  // Build master ingredient map by exact lowercase name
  const masterByName = new Map<string, MasterIngredient>();
  const masterById = new Map<string, MasterIngredient>();

  for (const m of masterIngredients) {
    masterById.set(m.id, m);
    const nameKey = m.name.trim().toLowerCase();
    const mWs = m.workspaceId || activeWorkspaceId;
    if (mWs !== activeWorkspaceId) {
      invariantViolations.push(
        `Cross-workspace master ingredient detected: ${m.name} (${m.id}) in workspace ${mWs}`
      );
    }
    // Record exact match
    if (!masterByName.has(nameKey)) {
      masterByName.set(nameKey, m);
    }
  }

  let totalFormulaLines = 0;
  let activeFormulaLines = 0;
  let archivedFormulaLines = 0;
  let preExistingLinkedActiveLines = 0;
  let unlinkedActiveLines = 0;
  let brokenLinks = 0;

  let activeRecipes = 0;
  let archivedRecipes = 0;

  const stage1PlannedLinks: Stage1PlannedLink[] = [];
  const stage1GroupsMap = new Map<string, Stage1GroupSummary>();
  const affectedRecipeIds = new Set<string>();

  const stage2Breakdown: Record<string, number> = {};
  let stage2ExcludedLines = 0;

  for (const recipe of recipes) {
    const isArchived = Boolean(recipe.archived);
    if (isArchived) {
      archivedRecipes++;
    } else {
      activeRecipes++;
    }

    const recipeWs = recipe.workspaceId || activeWorkspaceId;
    if (recipeWs !== activeWorkspaceId) {
      invariantViolations.push(
        `Cross-workspace recipe detected: ${recipe.name} (${recipe.id}) in workspace ${recipeWs}`
      );
    }

    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    for (const ing of ingredients) {
      totalFormulaLines++;

      if (isArchived) {
        archivedFormulaLines++;
        if (ing.masterIngredientId) {
          invariantViolations.push(
            `Archived recipe ${recipe.name} contains linked ingredient ${ing.name}`
          );
        }
        continue;
      }

      activeFormulaLines++;

      if (ing.masterIngredientId) {
        const targetMaster = masterById.get(ing.masterIngredientId);
        if (!targetMaster) {
          brokenLinks++;
          invariantViolations.push(
            `Broken link in ${recipe.name}: ingredient ${ing.name} references non-existent masterIngredientId ${ing.masterIngredientId}`
          );
        } else {
          preExistingLinkedActiveLines++;
        }
        continue;
      }

      unlinkedActiveLines++;

      const normalized = ing.name.trim().toLowerCase();

      // Check if this ingredient belongs to one of the 10 human-review Stage 2 groups
      if (STAGE2_HUMAN_REVIEW_NAMES.has(normalized)) {
        stage2ExcludedLines++;
        stage2Breakdown[normalized] = (stage2Breakdown[normalized] || 0) + 1;
        continue;
      }

      // Stage 1 Candidate: Must have an exact match in masterIngredients
      const targetMaster = masterByName.get(normalized);
      if (!targetMaster) {
        invariantViolations.push(
          `Unlinked ingredient '${ing.name}' in recipe '${recipe.name}' has no exact master ingredient match and is not in Stage 2 review list.`
        );
        continue;
      }

      stage1PlannedLinks.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        ingredientId: ing.id,
        ingredientName: ing.name,
        masterIngredientId: targetMaster.id,
        masterIngredientName: targetMaster.name,
      });

      affectedRecipeIds.add(recipe.id);

      if (!stage1GroupsMap.has(normalized)) {
        stage1GroupsMap.set(normalized, {
          normalizedName: normalized,
          displayName: ing.name.trim(),
          activeCount: 0,
          masterIngredientId: targetMaster.id,
          masterIngredientName: targetMaster.name,
        });
      }
      stage1GroupsMap.get(normalized)!.activeCount++;
    }
  }

  // Pre-write formula hash
  const preWriteFormulaHash = await computeFormulaSnapshotHash(recipes);

  const stage1Groups = Array.from(stage1GroupsMap.values()).sort((a, b) =>
    b.activeCount - a.activeCount || a.displayName.localeCompare(b.displayName)
  );

  const stage1LinesToLink = stage1PlannedLinks.length;
  const stage1GroupsCount = stage1Groups.length;
  const stage1AffectedRecipesCount = affectedRecipeIds.size;
  const stage2ExcludedGroupsCount = Object.keys(stage2Breakdown).length;

  // Invariant verification checks:
  if (recipes.length !== 73 && recipes.length > 0) {
    invariantViolations.push(`Expected 73 total recipes, found ${recipes.length}`);
  }
  if (activeRecipes !== 70 && activeRecipes > 0) {
    invariantViolations.push(`Expected 70 active recipes, found ${activeRecipes}`);
  }
  if (archivedRecipes !== 3 && recipes.length > 0) {
    invariantViolations.push(`Expected 3 archived recipes, found ${archivedRecipes}`);
  }
  if (activeFormulaLines !== 685 && activeFormulaLines > 0) {
    invariantViolations.push(`Expected 685 active formula lines, found ${activeFormulaLines}`);
  }
  if (preExistingLinkedActiveLines !== 4 && activeFormulaLines > 0) {
    invariantViolations.push(
      `Expected exactly 4 pre-existing linked active lines, found ${preExistingLinkedActiveLines}`
    );
  }
  if (unlinkedActiveLines !== 681 && unlinkedActiveLines > 0) {
    invariantViolations.push(`Expected 681 unlinked active lines, found ${unlinkedActiveLines}`);
  }
  if (stage1LinesToLink !== 512 && stage1LinesToLink > 0) {
    invariantViolations.push(`Expected 512 Stage 1 lines, found ${stage1LinesToLink}`);
  }
  if (stage1GroupsCount !== 90 && stage1GroupsCount > 0) {
    invariantViolations.push(`Expected 90 Stage 1 groups, found ${stage1GroupsCount}`);
  }
  if (stage1AffectedRecipesCount !== 69 && stage1AffectedRecipesCount > 0) {
    invariantViolations.push(
      `Expected 69 Stage 1 affected recipes, found ${stage1AffectedRecipesCount}`
    );
  }
  if (stage2ExcludedLines !== 169 && stage2ExcludedLines > 0) {
    invariantViolations.push(`Expected 169 Stage 2 excluded lines, found ${stage2ExcludedLines}`);
  }
  if (stage2ExcludedGroupsCount !== 10 && stage2ExcludedGroupsCount > 0) {
    invariantViolations.push(
      `Expected 10 Stage 2 excluded groups, found ${stage2ExcludedGroupsCount}`
    );
  }

  // Manifest Fingerprint Verification across 681 active unlinked records
  let currentManifestFingerprint = '';
  let isFingerprintApproved = false;

  if (activeRecipes > 0) {
    const manifest = buildComplete681Manifest(recipes, masterIngredients);
    currentManifestFingerprint = await computeManifestFingerprint(manifest);
    isFingerprintApproved = currentManifestFingerprint === STAGE1_APPROVED_MANIFEST_FINGERPRINT;

    if (!isFingerprintApproved && recipes.length === 73) {
      invariantViolations.push(
        `Manifest fingerprint mismatch: calculated ${currentManifestFingerprint} does not match approved Phase 2A.5 fingerprint ${STAGE1_APPROVED_MANIFEST_FINGERPRINT} (Stage 2 Marshmallow target corrected to mi-1785876432641). Owner approval required before execution.`
      );
    }
  }

  const isValid =
    invariantViolations.length === 0 &&
    stage1LinesToLink === 512 &&
    stage2ExcludedLines === 169 &&
    isFingerprintApproved;

  return {
    totalRecipes: recipes.length,
    activeRecipes,
    archivedRecipes,
    totalFormulaLines,
    activeFormulaLines,
    archivedFormulaLines,
    preExistingLinkedActiveLines,
    unlinkedActiveLines,
    brokenLinks,

    stage1LinesToLink,
    stage1GroupsCount,
    stage1AffectedRecipesCount,
    stage1Groups,
    stage1PlannedLinks,

    stage2ExcludedLines,
    stage2ExcludedGroupsCount,
    stage2Breakdown,

    preWriteFormulaHash,
    approvedManifestFingerprint: STAGE1_APPROVED_MANIFEST_FINGERPRINT,
    currentManifestFingerprint,
    isFingerprintApproved,
    invariantViolations,
    isValid,
  };
}

/**
 * Pure function: applies Stage 1 link mutations to affected recipes in memory.
 * Preserves all formula quantities, units, waste, names, and notes strictly immutable.
 */
export function applyStage1Mutations(
  recipes: Recipe[],
  plan: Stage1LinkingPlan
): { updatedRecipes: Recipe[]; affectedCount: number } {
  // Create a fast lookup map for planned links: recipeId + ingredientId -> masterIngredientId
  const linkMap = new Map<string, string>();
  for (const link of plan.stage1PlannedLinks) {
    linkMap.set(`${link.recipeId}::${link.ingredientId}`, link.masterIngredientId);
  }

  let affectedCount = 0;
  const nowIso = new Date().toISOString();

  const updatedRecipes = recipes.map((recipe) => {
    if (recipe.archived) {
      return recipe;
    }

    let recipeModified = false;
    const updatedIngredients = (recipe.ingredients || []).map((ing) => {
      const key = `${recipe.id}::${ing.id}`;
      const targetMasterId = linkMap.get(key);
      if (targetMasterId && ing.masterIngredientId !== targetMasterId) {
        recipeModified = true;
        affectedCount++;
        return {
          ...ing,
          masterIngredientId: targetMasterId,
        };
      }
      return ing;
    });

    if (recipeModified) {
      return {
        ...recipe,
        ingredients: updatedIngredients,
        updatedAt: nowIso,
      };
    }
    return recipe;
  });

  return { updatedRecipes, affectedCount };
}

/**
 * Authenticated Stage 1 Migration Execution Routine.
 *
 * CRITICAL REQUIREMENTS:
 * - Must be called with authenticated Owner role only.
 * - Must execute using the Firebase Web SDK `writeBatch`.
 * - Performs immediate post-write read-back verification from remote Firestore.
 * - Confirms mathematical formula invariance before and after write.
 */
export async function executeAuthenticatedStage1Migration(params: {
  db: Firestore;
  user: User | null;
  workspaceId: string;
  role: AccessRole | null;
}): Promise<Stage1ExecutionResult> {
  const { db, user, workspaceId, role } = params;

  // 1. Strict Owner Authorization Guard
  if (!user) {
    throw new Error('Authentication required: No active Firebase user detected.');
  }
  if (role !== 'owner') {
    throw new Error(
      `Permission denied: Only workspace Owners can execute Stage 1 migration. Current role is '${role || 'none'}'.`
    );
  }
  if (workspaceId !== TARGET_WORKSPACE_ID) {
    throw new Error(
      `Workspace isolation error: Target workspace must be '${TARGET_WORKSPACE_ID}', got '${workspaceId}'.`
    );
  }

  // 2. Fetch fresh live state directly from Firestore (authoritative read)
  const recipesQuery = query(collection(db, 'recipes'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
  const masterIngsQuery = query(collection(db, 'master_ingredients'), where('workspaceId', '==', TARGET_WORKSPACE_ID));

  const [recipesSnap, masterIngsSnap] = await Promise.all([
    getDocs(recipesQuery),
    getDocs(masterIngsQuery),
  ]);

  const liveRecipes: Recipe[] = [];
  recipesSnap.forEach((docSnap) => {
    liveRecipes.push({ id: docSnap.id, ...docSnap.data() } as Recipe);
  });

  const liveMasterIngs: MasterIngredient[] = [];
  masterIngsSnap.forEach((docSnap) => {
    liveMasterIngs.push({ id: docSnap.id, ...docSnap.data() } as MasterIngredient);
  });

  // 3. Build & Validate Linking Plan
  const plan = await buildStage1LinkingPlan(liveRecipes, liveMasterIngs, TARGET_WORKSPACE_ID);

  if (!plan.isValid || plan.invariantViolations.length > 0) {
    throw new Error(
      `Pre-write invariant validation failed:\n${plan.invariantViolations.join('\n')}`
    );
  }

  if (plan.stage1LinesToLink !== 512) {
    throw new Error(
      `Stage 1 count mismatch: Expected exactly 512 lines to link, found ${plan.stage1LinesToLink}. Aborting.`
    );
  }

  // 4. Compute Pre-Write Formula Snapshot Hash
  const preWriteHash = plan.preWriteFormulaHash;

  // 5. Apply Mutations to in-memory recipe representations
  const { updatedRecipes, affectedCount } = applyStage1Mutations(liveRecipes, plan);

  if (affectedCount !== 512) {
    throw new Error(
      `Mutation count mismatch: In-memory mutation produced ${affectedCount} links instead of 512. Aborting.`
    );
  }

  const modifiedRecipeDocs = updatedRecipes.filter((r) => {
    const original = liveRecipes.find((orig) => orig.id === r.id);
    return original && original.updatedAt !== r.updatedAt;
  });

  if (modifiedRecipeDocs.length !== 69) {
    throw new Error(
      `Affected recipe document count mismatch: Expected 69 modified recipe documents, found ${modifiedRecipeDocs.length}. Aborting.`
    );
  }

  // 6. Execute Remote Writes via Web SDK writeBatch in safe chunks
  // Firestore writeBatch allows up to 500 operations. 69 docs easily fits in 1 batch.
  const BATCH_SIZE = 400;
  for (let i = 0; i < modifiedRecipeDocs.length; i += BATCH_SIZE) {
    const chunk = modifiedRecipeDocs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const recipe of chunk) {
      const docRef = doc(db, 'recipes', recipe.id);
      // Update ingredients array and updatedAt timestamp
      batch.update(docRef, {
        ingredients: recipe.ingredients,
        updatedAt: recipe.updatedAt,
      });
    }

    await batch.commit();
  }

  console.log(`[Stage1Migration] Successfully committed ${modifiedRecipeDocs.length} recipe documents to Firestore.`);

  // 7. Authoritative Post-Write Remote Read-Back Verification
  const verifySnap = await getDocs(recipesQuery);
  const verifyRecipes: Recipe[] = [];
  verifySnap.forEach((d) => {
    verifyRecipes.push({ id: d.id, ...d.data() } as Recipe);
  });

  // Calculate post-write metrics
  let postWriteActiveLinked = 0;
  let postWriteActiveUnlinked = 0;
  let postWriteBroken = 0;
  let postWriteArchivedUntouched = 0;

  const masterIdSet = new Set(liveMasterIngs.map((m) => m.id));

  for (const r of verifyRecipes) {
    if (r.archived) {
      for (const ing of r.ingredients || []) {
        if (!ing.masterIngredientId) {
          postWriteArchivedUntouched++;
        }
      }
      continue;
    }

    for (const ing of r.ingredients || []) {
      if (ing.masterIngredientId) {
        if (!masterIdSet.has(ing.masterIngredientId)) {
          postWriteBroken++;
        } else {
          postWriteActiveLinked++;
        }
      } else {
        postWriteActiveUnlinked++;
      }
    }
  }

  // Post-write formula snapshot hash verification
  const postWriteHash = await computeFormulaSnapshotHash(verifyRecipes);

  if (postWriteHash !== preWriteHash) {
    throw new Error(
      `FATAL: Formula snapshot hash mismatch after write!\nPre-write: ${preWriteHash}\nPost-write: ${postWriteHash}\nRecipe formulas may have been altered!`
    );
  }

  if (postWriteActiveLinked !== 516) {
    throw new Error(
      `Post-write verification failed: Expected 516 active linked lines (4 pre-existing + 512 Stage 1), found ${postWriteActiveLinked}.`
    );
  }

  if (postWriteActiveUnlinked !== 169) {
    throw new Error(
      `Post-write verification failed: Expected 169 active unlinked lines (Stage 2), found ${postWriteActiveUnlinked}.`
    );
  }

  if (postWriteBroken !== 0) {
    throw new Error(
      `Post-write verification failed: Detected ${postWriteBroken} broken links.`
    );
  }

  if (postWriteArchivedUntouched !== 21) {
    throw new Error(
      `Post-write verification failed: Expected 21 archived unlinked formula lines, found ${postWriteArchivedUntouched}.`
    );
  }

  const result: Stage1ExecutionResult = {
    success: true,
    message: `Stage 1 Master Ingredient linking successfully executed and remotely verified. 512 formula lines linked across 69 recipes.`,
    affectedRecipesCount: modifiedRecipeDocs.length,
    linkedLinesCount: 512,
    preWriteFormulaHash: preWriteHash,
    postWriteFormulaHash: postWriteHash,
    postWriteActiveLinked,
    postWriteActiveUnlinked,
    postWriteBrokenLinks: postWriteBroken,
    postWriteArchivedUntouched,
    timestamp: new Date().toISOString(),
    operatorEmail: user.email,
    operatorUid: user.uid,
  };

  // 8. Publish audit payload to /api/dev/forensic-audit for permanent record
  try {
    await fetch('/api/dev/forensic-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase: 'PHASE_2A_6B_STAGE1_EXECUTION',
        result,
        counts: {
          recipes: verifyRecipes.length,
          activeRecipes: verifyRecipes.filter((r) => !r.archived).length,
          archivedRecipes: verifyRecipes.filter((r) => r.archived).length,
          linkedActiveLines: postWriteActiveLinked,
          unlinkedActiveLines: postWriteActiveUnlinked,
          brokenLinks: postWriteBroken,
          archivedFormulaLines: postWriteArchivedUntouched,
        },
      }),
    });
  } catch (err) {
    console.warn('[Stage1Migration] Failed to post audit payload:', err);
  }

  return result;
}
