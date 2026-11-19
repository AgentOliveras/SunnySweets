/**
 * Phase 2A.9 — Authenticated Stage 2 Owner-Authorized Migration Utility Service
 *
 * Provides safe, owner-only, browser-authenticated execution logic for Phase 2A Stage 2
 * Master Ingredient ambiguity linking (169 active formula lines across 68 recipes).
 *
 * STRICT SAFETY INVARIANTS:
 * 1. OWNER-ONLY: Viewers and Editors are strictly rejected with an error.
 * 2. EXACT AUTHORIZATION PHRASE: Requires case-sensitive input "EXECUTE STAGE 2 LINKING".
 * 3. WEB SDK AUTHENTICATION: Writes execute through authenticated Firebase Web SDK (db, auth.currentUser).
 * 4. WORKSPACE ISOLATION: Scoped exclusively to active workspace 'ws-main'. Cross-workspace targets are rejected.
 * 5. FORMULA IMMUTABILITY: Modifies ONLY masterIngredientId and updatedAt.
 *    Recipe quantities, units, waste, names, notes, and calculations are strictly untouched.
 * 6. NO PANTRY CLEANUP: Does NOT delete, rename, or merge any Master Ingredients.
 *    Pantry cleanup candidates (mi-5, mi-1786997941446-ajz7, mi-1787072264396-0v58,
 *    mi-1786734885980-3pc2, mi-1786118169508-yvy2, and Steel Cut) remain strictly untouched.
 * 7. PRE-WRITE & POST-WRITE CRYPTOGRAPHIC VERIFICATION:
 *    - Formula content snapshot SHA-256 (32a7cf48c5a8fb42e10ac62199900d22782afcc56c99aba6a7da3abc74ae74fd)
 *      must match before and after execution.
 *    - Minimal canonical manifest SHA-256 must match the approved hash
 *      (9b87dac651d262f2842f952fec7a4de42d561443b1f508008b10194d2ed47027).
 *    - Expected post-write active lines: exactly 685 linked (100%), 0 unlinked.
 *    - Zero broken links, zero changes to archived recipes (21 unlinked formula lines preserved).
 */

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  writeBatch,
  Firestore,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { Recipe, MasterIngredient, AccessRole } from '../types';

export const TARGET_WORKSPACE_ID = 'ws-main';

export const STAGE2_AUTHORIZATION_PHRASE = 'EXECUTE STAGE 2 LINKING';

/**
 * Authoritative approved minimal canonical manifest SHA-256 fingerprint.
 * Represents deterministic records of { recipeId, ingredientId, proposedMasterIngredientId }
 * sorted by recipeId ASC, ingredientId ASC.
 */
export const STAGE2_APPROVED_MINIMAL_FINGERPRINT =
  '9b87dac651d262f2842f952fec7a4de42d561443b1f508008b10194d2ed47027';

/**
 * Secondary full manifest record SHA-256 fingerprint.
 */
export const STAGE2_APPROVED_FULL_FINGERPRINT =
  '18b9b811e6305fd82d2856f27327b412f5815ab9321a5c52baf0a707abd163cb';

/**
 * Approved formula content snapshot SHA-256 hash covering all 73 recipes in ws-main
 * (excluding only masterIngredientId and updatedAt).
 */
export const STAGE2_EXPECTED_FORMULA_HASH =
  '32a7cf48c5a8fb42e10ac62199900d22782afcc56c99aba6a7da3abc74ae74fd';

/**
 * Master Ingredient IDs that must NEVER appear as execution targets in Stage 2.
 */
export const STAGE2_PROHIBITED_MASTER_IDS: ReadonlySet<string> = new Set([
  'mi-5',                  // Granulated Sugar (Pantry duplicate; Sugar targets mi-1785877164225-axt7)
  'mi-1786997941446-ajz7', // Butter (Pantry duplicate; Butter targets mi-9)
  'mi-1787072264396-0v58', // Marhsmallow (Corrupted duplicate; Marhsmallow targets mi-1785876432641)
  'mi-1786734885980-3pc2', // Brown Sugar (Ambiguous pantry entry; dark/light sugars remain separated)
  'mi-1786118169508-yvy2', // Unsalted (Pantry duplicate; Unsalted Butter targets mi-9)
]);

/**
 * Future pantry cleanup candidates that MUST remain completely untouched during Stage 2.
 */
export interface ProtectedCleanupCandidate {
  id: string;
  expectedName: string;
  role: string;
  protectionRule: string;
}

export const STAGE2_PROTECTED_CLEANUP_CANDIDATES: ProtectedCleanupCandidate[] = [
  {
    id: 'mi-1786997941446-ajz7',
    expectedName: 'Butter',
    role: 'Pantry Duplicate Candidate',
    protectionRule: 'Must NOT be targeted, renamed, merged, or deleted during Stage 2.',
  },
  {
    id: 'mi-1787072264396-0v58',
    expectedName: 'Marhsmallow',
    role: 'Corrupted Typo Duplicate Candidate',
    protectionRule: 'Must NOT be targeted, renamed, merged, or deleted during Stage 2.',
  },
  {
    id: 'mi-1786734885980-3pc2',
    expectedName: 'Brown Sugar',
    role: 'Generic Sugar Duplicate Candidate',
    protectionRule: 'Must NOT be targeted, renamed, merged, or deleted during Stage 2.',
  },
  {
    id: 'mi-1786118169508-yvy2',
    expectedName: 'Unsalted',
    role: 'Incomplete Name Duplicate Candidate',
    protectionRule: 'Must NOT be targeted, renamed, merged, or deleted during Stage 2.',
  },
  {
    id: 'mi-5',
    expectedName: 'Granulated Sugar',
    role: 'Sugar Duplicate Candidate',
    protectionRule: 'Must NOT be targeted, renamed, merged, or deleted during Stage 2.',
  },
  {
    id: 'mi-1787074632520-5frd',
    expectedName: 'Steel Cut',
    role: 'Authoritative Target (Future Rename: Steel Cut Oats)',
    protectionRule: 'Must NOT be renamed during Stage 2. Rename will occur only in separate cleanup phase.',
  },
];

/**
 * Stage 2 Authoritative Mapping Definition for the 10 Human-Approved Groups.
 */
export interface Stage2TargetDefinition {
  formulaDisplayName: string;
  proposedMasterIngredientId: string;
  proposedMasterIngredientName: string;
  targetCategory: string;
  mappingDecisionType: string;
  expectedLines: number;
}

export const STAGE2_MAPPING_DEFINITIONS: Record<string, Stage2TargetDefinition> = {
  'Unsalted Butter': {
    formulaDisplayName: 'Unsalted Butter',
    proposedMasterIngredientId: 'mi-9',
    proposedMasterIngredientName: 'Unsalted Butter',
    targetCategory: 'Dairy & Fats',
    mappingDecisionType: 'Owner Ambiguity Resolution (Canonical Butter Entry)',
    expectedLines: 58,
  },
  'Butter': {
    formulaDisplayName: 'Butter',
    proposedMasterIngredientId: 'mi-9',
    proposedMasterIngredientName: 'Unsalted Butter',
    targetCategory: 'Dairy & Fats',
    mappingDecisionType: 'Owner Alias Mapping (Production Unsalted Butter)',
    expectedLines: 1,
  },
  'Sugar': {
    formulaDisplayName: 'Sugar',
    proposedMasterIngredientId: 'mi-1785877164225-axt7',
    proposedMasterIngredientName: 'Sugar',
    targetCategory: 'General',
    mappingDecisionType: 'Owner Ambiguity Resolution (Common Pantry Sugar)',
    expectedLines: 56,
  },
  'Dark Brown Sugar': {
    formulaDisplayName: 'Dark Brown Sugar',
    proposedMasterIngredientId: 'mi-6',
    proposedMasterIngredientName: 'Dark Brown Sugar',
    targetCategory: 'Sugar & Sweeteners',
    mappingDecisionType: 'Owner Specification Separation (Distinct from Light Brown)',
    expectedLines: 34,
  },
  'Light Brown Sugar': {
    formulaDisplayName: 'Light Brown Sugar',
    proposedMasterIngredientId: 'mi-1785876302990',
    proposedMasterIngredientName: 'Light Brown Sugar',
    targetCategory: 'Sugar',
    mappingDecisionType: 'Owner Specification Separation (Distinct from Dark Brown)',
    expectedLines: 7,
  },
  'Oatmeal': {
    formulaDisplayName: 'Oatmeal',
    proposedMasterIngredientId: 'mi-1785876569598',
    proposedMasterIngredientName: 'Oatmeal',
    targetCategory: 'Oatmeal',
    mappingDecisionType: 'Owner Variety Selection (Standard Rolled Oats)',
    expectedLines: 8,
  },
  'Flax Seeds (Ground)': {
    formulaDisplayName: 'Flax Seeds (Ground)',
    proposedMasterIngredientId: 'mi-1785876091244',
    proposedMasterIngredientName: 'Flax Seeds (Ground)',
    targetCategory: 'Seeds',
    mappingDecisionType: 'Owner Form Differentiation (Distinct from Seed Meal)',
    expectedLines: 2,
  },
  'Flax Seed Meal': {
    formulaDisplayName: 'Flax Seed Meal',
    proposedMasterIngredientId: 'mi-1785876070988',
    proposedMasterIngredientName: 'Flax Seed Meal',
    targetCategory: 'Seeds',
    mappingDecisionType: 'Owner Form Differentiation (Distinct from Ground Seeds)',
    expectedLines: 1,
  },
  'Marhsmallow': {
    formulaDisplayName: 'Marhsmallow',
    proposedMasterIngredientId: 'mi-1785876432641',
    proposedMasterIngredientName: 'Marshmallows',
    targetCategory: 'Add-ins',
    mappingDecisionType: 'Owner Typo Correction / Authoritative Target',
    expectedLines: 1,
  },
  'Steel Cut': {
    formulaDisplayName: 'Steel Cut',
    proposedMasterIngredientId: 'mi-1787074632520-5frd',
    proposedMasterIngredientName: 'Steel Cut',
    targetCategory: 'General',
    mappingDecisionType: 'Owner Form Differentiation (Distinct from Oatmeal)',
    expectedLines: 1,
  },
};

export interface Stage2ManifestRecord {
  recipeId: string;
  recipeName: string;
  ingredientId: string;
  ingredientDisplayName: string;
  currentMasterIngredientId: string | null;
  proposedMasterIngredientId: string;
  proposedMasterIngredientName: string;
  mappingDecisionType: string;
}

export interface Stage2MinimalTuple {
  recipeId: string;
  ingredientId: string;
  proposedMasterIngredientId: string;
}

export interface Stage2GroupSummary {
  formulaDisplayName: string;
  activeCount: number;
  recipesAffectedCount: number;
  proposedMasterIngredientId: string;
  proposedMasterIngredientName: string;
  targetCategory: string;
  mappingDecisionType: string;
  recipeNames: string[];
}

export interface Stage2RecipeImpact {
  recipeId: string;
  recipeName: string;
  stage2LinesCount: number;
  ingredients: string[];
  isMultiLink: boolean;
}

export interface Stage2MasterIngredientImpact {
  masterIngredientId: string;
  masterIngredientName: string;
  currentAuthoritativeLinks: number;
  proposedStage2Links: number;
  projectedTotalLinks: number;
}

export type Stage2LifecycleState =
  | 'PRE_EXECUTION_READY'
  | 'POST_EXECUTION_COMPLETE'
  | 'INVALID_OR_PARTIAL_STATE';

export const STAGE2_EXECUTION_TIMESTAMP = '2026-09-28T09:14:40.963Z';

export interface Stage2LinkingPlan {
  lifecycleState: Stage2LifecycleState;

  totalRecipes: number;
  activeRecipes: number;
  archivedRecipes: number;

  totalFormulaLines: number;
  activeFormulaLines: number;
  archivedFormulaLines: number;

  currentActiveLinkedLines: number;
  currentActiveUnlinkedLines: number;
  currentArchivedLinkedLines: number;
  currentArchivedUnlinkedLines: number;
  brokenLinks: number;

  stage2LinesToLink: number;
  stage2CompletedLinks: number;
  stage2GroupsCount: number;
  affectedRecipesCount: number;
  stage2Groups: Stage2GroupSummary[];
  stage2Manifest: Stage2ManifestRecord[];
  recipeImpactList: Stage2RecipeImpact[];
  masterIngredientImpactList: Stage2MasterIngredientImpact[];

  preWriteFormulaHash: string;
  expectedFormulaHash: string;
  isFormulaHashApproved: boolean;

  approvedMinimalFingerprint: string;
  currentMinimalFingerprint: string;
  isFingerprintApproved: boolean;

  approvedFullFingerprint: string;
  currentFullFingerprint: string;

  executionTimestamp?: string;
  invariantViolations: string[];
  isValid: boolean;
}

export interface Stage2ExecutionResult {
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
 * Reconstructs the canonical 169-record Stage 2 manifest dynamically from
 * active recipes. Deterministically sorted by recipeId ASC, then ingredientId ASC.
 * If includeAlreadyLinked is false (default), only lines currently missing masterIngredientId are returned.
 * If includeAlreadyLinked is true, all 169 Stage 2 mapping formula lines are returned.
 */
export function buildStage2Manifest(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[],
  includeAlreadyLinked = false
): Stage2ManifestRecord[] {
  const masterById = new Map<string, MasterIngredient>();
  masterIngredients.forEach((m) => masterById.set(m.id, m));

  const activeRecipes = recipes.filter((r) => !r.archived);
  const records: Stage2ManifestRecord[] = [];

  for (const recipe of activeRecipes) {
    for (const ing of recipe.ingredients || []) {
      // If includeAlreadyLinked is false, include only active formula lines where masterIngredientId is absent
      if (!includeAlreadyLinked && ing.masterIngredientId) continue;

      const mapping = STAGE2_MAPPING_DEFINITIONS[ing.name.trim()];
      if (mapping) {
        records.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingredientId: ing.id,
          ingredientDisplayName: ing.name.trim(),
          currentMasterIngredientId: ing.masterIngredientId || null,
          proposedMasterIngredientId: mapping.proposedMasterIngredientId,
          proposedMasterIngredientName: mapping.proposedMasterIngredientName,
          mappingDecisionType: mapping.mappingDecisionType,
        });
      }
    }
  }

  // Deterministic canonical sort: recipeId ASC, ingredientId ASC
  records.sort(
    (a, b) => a.recipeId.localeCompare(b.recipeId) || a.ingredientId.localeCompare(b.ingredientId)
  );

  return records;
}

/**
 * Computes the authoritative minimal canonical manifest SHA-256 fingerprint.
 * Canonical records contain { recipeId, ingredientId, proposedMasterIngredientId }
 * sorted by recipeId ASC, then ingredientId ASC.
 */
export async function computeStage2MinimalFingerprint(
  manifest: Stage2ManifestRecord[]
): Promise<string> {
  const canonicalPayload: Stage2MinimalTuple[] = manifest.map((m) => ({
    recipeId: m.recipeId,
    ingredientId: m.ingredientId,
    proposedMasterIngredientId: m.proposedMasterIngredientId,
  }));

  const jsonStr = JSON.stringify(canonicalPayload);
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
 * Computes the secondary full record canonical manifest SHA-256 fingerprint.
 */
export async function computeStage2FullFingerprint(
  manifest: Stage2ManifestRecord[]
): Promise<string> {
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
 * Computes the hardened deterministic SHA-256 formula content snapshot hash
 * across all recipe definitions.
 * STRICTLY INCLUDES:
 * - Recipe level: id, name, description, category, workspaceId, userId, archived, orderIndex,
 *   batchYieldQuantity, batchYieldUnit, defaultWastePercent, createdAt.
 * - Ingredient level: id, name, quantity, unit, wastePercent, notes, densityGramsPerMl, subIngredients.
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

  let hash = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `hash-${Math.abs(hash).toString(16)}`;
}

/**
 * Builds the comprehensive Stage 2 linking plan, auditing all live database
 * invariants, reconstructing the manifest, computing fingerprints, and assessing
 * recipe-level and master-ingredient-level impact.
 */
export async function buildStage2LinkingPlan(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[],
  activeWorkspaceId: string = TARGET_WORKSPACE_ID
): Promise<Stage2LinkingPlan> {
  const invariantViolations: string[] = [];

  // Master Ingredient index maps
  const masterById = new Map<string, MasterIngredient>();
  const masterByName = new Map<string, MasterIngredient>();
  for (const m of masterIngredients) {
    masterById.set(m.id, m);
    masterByName.set(m.name.trim().toLowerCase(), m);
    if (m.workspaceId && m.workspaceId !== activeWorkspaceId) {
      invariantViolations.push(
        `Cross-workspace master ingredient detected: ${m.name} (${m.id}) in workspace ${m.workspaceId}`
      );
    }
  }

  let activeRecipes = 0;
  let archivedRecipes = 0;
  let totalFormulaLines = 0;
  let activeFormulaLines = 0;
  let archivedFormulaLines = 0;

  let currentActiveLinkedLines = 0;
  let currentActiveUnlinkedLines = 0;
  let currentArchivedLinkedLines = 0;
  let currentArchivedUnlinkedLines = 0;
  let brokenLinks = 0;

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

    for (const ing of recipe.ingredients || []) {
      totalFormulaLines++;

      if (isArchived) {
        archivedFormulaLines++;
        if (ing.masterIngredientId) {
          currentArchivedLinkedLines++;
          invariantViolations.push(
            `Archived recipe '${recipe.name}' contains linked ingredient '${ing.name}' (${ing.masterIngredientId})`
          );
        } else {
          currentArchivedUnlinkedLines++;
        }
        continue;
      }

      activeFormulaLines++;
      if (ing.masterIngredientId) {
        currentActiveLinkedLines++;
        if (!masterById.has(ing.masterIngredientId)) {
          brokenLinks++;
          invariantViolations.push(
            `Broken link in active recipe '${recipe.name}': ingredient '${ing.name}' references non-existent masterIngredientId '${ing.masterIngredientId}'`
          );
        }
      } else {
        currentActiveUnlinkedLines++;
      }
    }
  }

  // Reconstruct Stage 2 all candidate tuples from active recipes
  const stage2AllCandidateTuples: Stage2ManifestRecord[] = [];
  const crossWorkspaceViolations: string[] = [];
  let exactApprovedLinks = 0;
  let unlinkedCandidateLines = 0;
  let wrongTargetLines = 0;

  for (const recipe of recipes) {
    if (recipe.archived) continue;
    for (const ing of recipe.ingredients || []) {
      const mapping = STAGE2_MAPPING_DEFINITIONS[ing.name.trim()];
      if (mapping) {
        const curMasterId = ing.masterIngredientId || null;
        if (!curMasterId) {
          unlinkedCandidateLines++;
        } else if (curMasterId === mapping.proposedMasterIngredientId) {
          exactApprovedLinks++;
        } else {
          wrongTargetLines++;
        }

        stage2AllCandidateTuples.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingredientId: ing.id,
          ingredientDisplayName: ing.name.trim(),
          currentMasterIngredientId: curMasterId,
          proposedMasterIngredientId: mapping.proposedMasterIngredientId,
          proposedMasterIngredientName: mapping.proposedMasterIngredientName,
          mappingDecisionType: mapping.mappingDecisionType,
        });
      }
    }
  }

  // Deterministic canonical sort: recipeId ASC, ingredientId ASC
  stage2AllCandidateTuples.sort(
    (a, b) => a.recipeId.localeCompare(b.recipeId) || a.ingredientId.localeCompare(b.ingredientId)
  );

  // Group breakdown aggregation
  const groupsMap = new Map<string, Stage2GroupSummary>();
  const recipeImpactMap = new Map<string, Stage2RecipeImpact>();
  const seenTuples = new Set<string>();

  for (const record of stage2AllCandidateTuples) {
    const tupleKey = `${record.recipeId}::${record.ingredientId}`;
    if (seenTuples.has(tupleKey)) {
      crossWorkspaceViolations.push(
        `Duplicate tuple detected in Stage 2 manifest: ${record.recipeName} -> ${record.ingredientDisplayName} (${tupleKey})`
      );
    }
    seenTuples.add(tupleKey);

    // Verify target Master Ingredient exists and belongs to workspace
    const target = masterById.get(record.proposedMasterIngredientId);
    if (!target) {
      crossWorkspaceViolations.push(
        `Missing target Master Ingredient: '${record.proposedMasterIngredientName}' (${record.proposedMasterIngredientId}) does not exist in pantry.`
      );
    } else if (target.workspaceId !== activeWorkspaceId) {
      crossWorkspaceViolations.push(
        `Target Master Ingredient '${target.name}' (${target.id}) belongs to cross-workspace ${target.workspaceId}.`
      );
    }

    // Verify target is NOT a prohibited ID
    if (STAGE2_PROHIBITED_MASTER_IDS.has(record.proposedMasterIngredientId)) {
      crossWorkspaceViolations.push(
        `PROHIBITED TARGET DETECTED: Stage 2 manifest targets prohibited Master Ingredient ${record.proposedMasterIngredientId} (${record.proposedMasterIngredientName}).`
      );
    }

    // Group summary tracking
    if (!groupsMap.has(record.ingredientDisplayName)) {
      const def = STAGE2_MAPPING_DEFINITIONS[record.ingredientDisplayName];
      groupsMap.set(record.ingredientDisplayName, {
        formulaDisplayName: record.ingredientDisplayName,
        activeCount: 0,
        recipesAffectedCount: 0,
        proposedMasterIngredientId: record.proposedMasterIngredientId,
        proposedMasterIngredientName: record.proposedMasterIngredientName,
        targetCategory: def ? def.targetCategory : '',
        mappingDecisionType: record.mappingDecisionType,
        recipeNames: [],
      });
    }
    const group = groupsMap.get(record.ingredientDisplayName)!;
    group.activeCount++;
    if (!group.recipeNames.includes(record.recipeName)) {
      group.recipeNames.push(record.recipeName);
      group.recipesAffectedCount++;
    }

    // Recipe impact tracking
    if (!recipeImpactMap.has(record.recipeId)) {
      recipeImpactMap.set(record.recipeId, {
        recipeId: record.recipeId,
        recipeName: record.recipeName,
        stage2LinesCount: 0,
        ingredients: [],
        isMultiLink: false,
      });
    }
    const rImpact = recipeImpactMap.get(record.recipeId)!;
    rImpact.stage2LinesCount++;
    rImpact.ingredients.push(record.ingredientDisplayName);
    rImpact.isMultiLink = rImpact.stage2LinesCount > 1;
  }

  const stage2Groups = Array.from(groupsMap.values()).sort(
    (a, b) => b.activeCount - a.activeCount || a.formulaDisplayName.localeCompare(b.formulaDisplayName)
  );

  const recipeImpactList = Array.from(recipeImpactMap.values()).sort(
    (a, b) => b.stage2LinesCount - a.stage2LinesCount || a.recipeName.localeCompare(b.recipeName)
  );

  // Master Ingredient impact projections
  const targetIds = [
    'mi-9',
    'mi-1785877164225-axt7',
    'mi-6',
    'mi-1785876569598',
    'mi-1785876302990',
    'mi-1785876091244',
    'mi-1785876070988',
    'mi-1785876432641',
    'mi-1787074632520-5frd',
  ];

  const currentLinksByMasterId: Record<string, number> = {};
  targetIds.forEach((id) => (currentLinksByMasterId[id] = 0));

  for (const r of recipes) {
    if (r.archived) continue;
    for (const ing of r.ingredients || []) {
      if (ing.masterIngredientId && currentLinksByMasterId[ing.masterIngredientId] !== undefined) {
        currentLinksByMasterId[ing.masterIngredientId]++;
      }
    }
  }

  const proposedLinksByMasterId: Record<string, number> = {};
  targetIds.forEach((id) => (proposedLinksByMasterId[id] = 0));
  for (const m of stage2AllCandidateTuples) {
    if (proposedLinksByMasterId[m.proposedMasterIngredientId] !== undefined) {
      proposedLinksByMasterId[m.proposedMasterIngredientId]++;
    }
  }

  const masterIngredientImpactList: Stage2MasterIngredientImpact[] = targetIds.map((id) => {
    const mi = masterById.get(id);
    const curr = currentLinksByMasterId[id] || 0;
    const prop = proposedLinksByMasterId[id] || 0;
    return {
      masterIngredientId: id,
      masterIngredientName: mi ? mi.name : id,
      currentAuthoritativeLinks: curr,
      proposedStage2Links: prop,
      projectedTotalLinks: curr + (unlinkedCandidateLines > 0 ? prop : 0),
    };
  });

  // Fingerprint calculations on canonical tuples
  const currentMinimalFingerprint = await computeStage2MinimalFingerprint(stage2AllCandidateTuples);
  const currentFullFingerprint = await computeStage2FullFingerprint(stage2AllCandidateTuples);
  const isFingerprintApproved = currentMinimalFingerprint === STAGE2_APPROVED_MINIMAL_FINGERPRINT;

  // Formula snapshot hash
  const preWriteFormulaHash = await computeFormulaSnapshotHash(recipes);
  const isFormulaHashApproved = preWriteFormulaHash === STAGE2_EXPECTED_FORMULA_HASH;

  // 1. Strict POST_EXECUTION_COMPLETE Verification
  const isPostExecutionCensusMatch =
    recipes.length === 73 &&
    activeRecipes === 70 &&
    archivedRecipes === 3 &&
    totalFormulaLines === 706 &&
    activeFormulaLines === 685 &&
    archivedFormulaLines === 21 &&
    currentActiveLinkedLines === 685 &&
    currentActiveUnlinkedLines === 0 &&
    currentArchivedLinkedLines === 0 &&
    brokenLinks === 0;

  const isPostExecutionLinksMatch =
    stage2AllCandidateTuples.length === 169 &&
    exactApprovedLinks === 169 &&
    unlinkedCandidateLines === 0 &&
    wrongTargetLines === 0;

  const isPostExecutionComplete =
    isPostExecutionCensusMatch &&
    isPostExecutionLinksMatch &&
    isFormulaHashApproved &&
    isFingerprintApproved &&
    crossWorkspaceViolations.length === 0;

  // 2. Strict PRE_EXECUTION_READY Verification
  const isPreExecutionCensusMatch =
    recipes.length === 73 &&
    activeRecipes === 70 &&
    archivedRecipes === 3 &&
    totalFormulaLines === 706 &&
    activeFormulaLines === 685 &&
    archivedFormulaLines === 21 &&
    currentActiveLinkedLines === 516 &&
    currentActiveUnlinkedLines === 169 &&
    currentArchivedLinkedLines === 0 &&
    brokenLinks === 0;

  const isPreExecutionLinksMatch =
    stage2AllCandidateTuples.length === 169 &&
    unlinkedCandidateLines === 169 &&
    exactApprovedLinks === 0 &&
    wrongTargetLines === 0;

  const isPreExecutionReady =
    isPreExecutionCensusMatch &&
    isPreExecutionLinksMatch &&
    isFormulaHashApproved &&
    isFingerprintApproved &&
    crossWorkspaceViolations.length === 0;

  let lifecycleState: Stage2LifecycleState;

  if (isPostExecutionComplete) {
    lifecycleState = 'POST_EXECUTION_COMPLETE';
  } else if (isPreExecutionReady) {
    lifecycleState = 'PRE_EXECUTION_READY';
  } else {
    lifecycleState = 'INVALID_OR_PARTIAL_STATE';

    // Accumulate precise forensic invariant violations for invalid/partial state
    if (recipes.length !== 73) {
      invariantViolations.push(`Recipe census mismatch: Expected 73 total recipes, found ${recipes.length}.`);
    }
    if (activeRecipes !== 70) {
      invariantViolations.push(`Active recipe count mismatch: Expected 70 active recipes, found ${activeRecipes}.`);
    }
    if (archivedRecipes !== 3) {
      invariantViolations.push(`Archived recipe count mismatch: Expected 3 archived recipes, found ${archivedRecipes}.`);
    }
    if (activeFormulaLines !== 685) {
      invariantViolations.push(`Active formula line count mismatch: Expected 685, found ${activeFormulaLines}.`);
    }
    if (archivedFormulaLines !== 21) {
      invariantViolations.push(`Archived formula line count mismatch: Expected 21, found ${archivedFormulaLines}.`);
    }
    if (currentActiveLinkedLines !== 516 && currentActiveLinkedLines !== 685) {
      invariantViolations.push(
        `Partial active linked line count: Expected 516 (pre-execution) or 685 (post-execution), found ${currentActiveLinkedLines}.`
      );
    }
    if (currentActiveUnlinkedLines !== 169 && currentActiveUnlinkedLines !== 0) {
      invariantViolations.push(
        `Partial active unlinked line count: Expected 169 (pre-execution) or 0 (post-execution), found ${currentActiveUnlinkedLines}.`
      );
    }
    if (currentArchivedLinkedLines > 0) {
      invariantViolations.push(
        `Archived recipe protection violation: ${currentArchivedLinkedLines} archived formula lines contain unauthorized links.`
      );
    }
    if (brokenLinks > 0) {
      invariantViolations.push(
        `Dangling link violation: ${brokenLinks} formula lines reference non-existent Master Ingredient IDs.`
      );
    }
    if (!isFormulaHashApproved) {
      invariantViolations.push(
        `Formula content hash mismatch: Calculated ${preWriteFormulaHash} does not match expected ${STAGE2_EXPECTED_FORMULA_HASH}.`
      );
    }
    if (stage2AllCandidateTuples.length !== 169) {
      invariantViolations.push(
        `Stage 2 tuple count mismatch: Expected 169 candidate tuples, found ${stage2AllCandidateTuples.length}.`
      );
    }
    if (wrongTargetLines > 0) {
      invariantViolations.push(
        `Incorrect target link violation: ${wrongTargetLines} of 169 Stage 2 tuples linked to unauthorized Master Ingredient.`
      );
    }
    if (!isFingerprintApproved) {
      invariantViolations.push(
        `Stage 2 manifest fingerprint mismatch: Calculated ${currentMinimalFingerprint} does not match approved ${STAGE2_APPROVED_MINIMAL_FINGERPRINT}.`
      );
    }
    crossWorkspaceViolations.forEach((v) => invariantViolations.push(v));
  }

  const isValid = lifecycleState !== 'INVALID_OR_PARTIAL_STATE';

  return {
    lifecycleState,
    totalRecipes: recipes.length,
    activeRecipes,
    archivedRecipes,

    totalFormulaLines,
    activeFormulaLines,
    archivedFormulaLines,

    currentActiveLinkedLines,
    currentActiveUnlinkedLines,
    currentArchivedLinkedLines,
    currentArchivedUnlinkedLines,
    brokenLinks,

    stage2LinesToLink: lifecycleState === 'POST_EXECUTION_COMPLETE' ? 0 : unlinkedCandidateLines,
    stage2CompletedLinks: exactApprovedLinks,
    stage2GroupsCount: stage2Groups.length,
    affectedRecipesCount: recipeImpactList.length,
    stage2Groups,
    stage2Manifest: stage2AllCandidateTuples,
    recipeImpactList,
    masterIngredientImpactList,

    preWriteFormulaHash,
    expectedFormulaHash: STAGE2_EXPECTED_FORMULA_HASH,
    isFormulaHashApproved,

    approvedMinimalFingerprint: STAGE2_APPROVED_MINIMAL_FINGERPRINT,
    currentMinimalFingerprint,
    isFingerprintApproved,

    approvedFullFingerprint: STAGE2_APPROVED_FULL_FINGERPRINT,
    currentFullFingerprint,

    executionTimestamp: lifecycleState === 'POST_EXECUTION_COMPLETE' ? STAGE2_EXECUTION_TIMESTAMP : undefined,
    invariantViolations,
    isValid,
  };
}

/**
 * Pure function: applies Stage 2 link mutations to affected recipes in memory.
 * Strictly modifies ONLY masterIngredientId and updatedAt.
 * Preserves all formula quantities, units, waste, names, and notes strictly immutable.
 */
export function applyStage2Mutations(
  recipes: Recipe[],
  plan: Stage2LinkingPlan
): { updatedRecipes: Recipe[]; affectedCount: number } {
  // Fast lookup map for planned links: recipeId + ingredientId -> masterIngredientId
  const linkMap = new Map<string, string>();
  for (const record of plan.stage2Manifest) {
    linkMap.set(`${record.recipeId}::${record.ingredientId}`, record.proposedMasterIngredientId);
  }

  let affectedCount = 0;
  const nowIso = new Date().toISOString();

  const updatedRecipes = recipes.map((recipe) => {
    // Archived recipes must NEVER be mutated
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
 * Authenticated Stage 2 Migration Execution Routine.
 *
 * CRITICAL EXECUTION REQUIREMENTS:
 * - Must be called with authenticated Owner role only.
 * - Must verify the exact case-sensitive authorization phrase "EXECUTE STAGE 2 LINKING".
 * - Must execute using the Firebase Web SDK `writeBatch`.
 * - Performs immediate post-write read-back verification from remote Firestore.
 * - Confirms mathematical formula invariance before and after write.
 * - Verifies 685 active linked lines (100%), 0 unlinked, 0 broken, 21 archived preserved.
 */
export async function executeAuthenticatedStage2Migration(params: {
  db: Firestore;
  user: User | null;
  workspaceId: string;
  role: AccessRole | null;
  confirmationPhrase: string;
  _mockData?: {
    recipes: Recipe[];
    masterIngredients: MasterIngredient[];
  };
}): Promise<Stage2ExecutionResult> {
  const { db, user, workspaceId, role, confirmationPhrase, _mockData } = params;

  // 1. Strict Owner Authorization Guard
  if (!user) {
    throw new Error('Authentication required: No active Firebase user detected.');
  }
  if (role !== 'owner') {
    throw new Error(
      `Permission denied: Only workspace Owners can execute Stage 2 migration. Current role is '${role || 'none'}'.`
    );
  }
  if (workspaceId !== TARGET_WORKSPACE_ID) {
    throw new Error(
      `Workspace isolation error: Target workspace must be '${TARGET_WORKSPACE_ID}', got '${workspaceId}'.`
    );
  }
  if (confirmationPhrase !== STAGE2_AUTHORIZATION_PHRASE) {
    throw new Error(
      `Invalid authorization phrase: Expected '${STAGE2_AUTHORIZATION_PHRASE}', got '${confirmationPhrase}'. Execution blocked.`
    );
  }

  // 2. Fetch fresh live state directly from Firestore (authoritative read) or injected mockData for testing
  let liveRecipes: Recipe[] = [];
  let liveMasterIngs: MasterIngredient[] = [];

  if (_mockData) {
    liveRecipes = _mockData.recipes;
    liveMasterIngs = _mockData.masterIngredients;
  } else {
    // Authoritative server/Firestore membership verification: do not trust client role parameter alone
    const callerMemberSnap = await getDoc(
      doc(db, 'workspaces', TARGET_WORKSPACE_ID, 'members', user.uid)
    );
    const callerMemberData = callerMemberSnap.exists() ? callerMemberSnap.data() : null;
    if (
      !callerMemberData ||
      callerMemberData.active !== true ||
      callerMemberData.role !== 'owner'
    ) {
      throw new Error(
        'Permission denied: Verified active workspace Owner membership in Cloud Firestore is required to execute Stage 2 migration.'
      );
    }

    const recipesQuery = query(collection(db, 'recipes'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
    const masterIngsQuery = query(collection(db, 'master_ingredients'), where('workspaceId', '==', TARGET_WORKSPACE_ID));

    const [recipesSnap, masterIngsSnap] = await Promise.all([
      getDocs(recipesQuery),
      getDocs(masterIngsQuery),
    ]);

    recipesSnap.forEach((docSnap) => {
      liveRecipes.push({ id: docSnap.id, ...docSnap.data() } as Recipe);
    });

    masterIngsSnap.forEach((docSnap) => {
      liveMasterIngs.push({ id: docSnap.id, ...docSnap.data() } as MasterIngredient);
    });
  }

  // 3. Build & Validate Linking Plan
  const plan = await buildStage2LinkingPlan(liveRecipes, liveMasterIngs, TARGET_WORKSPACE_ID);

  // Execution Idempotency & Permanent Guard:
  // If Stage 2 has already been executed and verified, strictly refuse execution and perform zero writes.
  if (plan.lifecycleState === 'POST_EXECUTION_COMPLETE') {
    throw new Error(
      'STAGE_2_ALREADY_COMPLETE: Stage 2 Master Ingredient linking has already executed and is 100% complete and verified. Zero writes performed.'
    );
  }

  // Refuse execution for INVALID_OR_PARTIAL_STATE or any state other than PRE_EXECUTION_READY
  if (plan.lifecycleState === 'INVALID_OR_PARTIAL_STATE' || plan.lifecycleState !== 'PRE_EXECUTION_READY') {
    throw new Error(
      `STAGE_2_INVALID_STATE: Stage 2 execution refused because database is in ${plan.lifecycleState}. Zero writes performed. Invariants:\n` +
      plan.invariantViolations.join('\n')
    );
  }

  if (!plan.isValid || plan.invariantViolations.length > 0) {
    throw new Error(
      `Pre-write invariant validation failed:\n${plan.invariantViolations.join('\n')}`
    );
  }

  if (plan.stage2LinesToLink !== 169) {
    throw new Error(
      `Stage 2 count mismatch: Expected exactly 169 lines to link, found ${plan.stage2LinesToLink}. Aborting.`
    );
  }

  // 4. Formula content pre-write hash
  const preWriteHash = plan.preWriteFormulaHash;

  // 5. Concurrency / Stale-data protection check immediately before mutating
  const manifestMap = new Map<string, Stage2ManifestRecord>();
  plan.stage2Manifest.forEach((m) => manifestMap.set(`${m.recipeId}::${m.ingredientId}`, m));

  for (const record of plan.stage2Manifest) {
    const liveRecipe = liveRecipes.find((r) => r.id === record.recipeId);
    if (!liveRecipe) {
      throw new Error(`Concurrency check failed: Recipe '${record.recipeName}' (${record.recipeId}) no longer exists.`);
    }
    if (liveRecipe.archived) {
      throw new Error(`Concurrency check failed: Recipe '${record.recipeName}' is archived.`);
    }
    const liveIng = (liveRecipe.ingredients || []).find((i) => i.id === record.ingredientId);
    if (!liveIng) {
      throw new Error(`Concurrency check failed: Ingredient '${record.ingredientDisplayName}' (${record.ingredientId}) not found in recipe '${liveRecipe.name}'.`);
    }
    if (liveIng.masterIngredientId) {
      throw new Error(`Concurrency check failed: Ingredient '${liveIng.name}' in '${liveRecipe.name}' is already linked to '${liveIng.masterIngredientId}'.`);
    }
  }

  // 6. Apply Mutations to in-memory recipe representations
  const { updatedRecipes, affectedCount } = applyStage2Mutations(liveRecipes, plan);

  if (affectedCount !== 169) {
    throw new Error(
      `Mutation count mismatch: In-memory mutation produced ${affectedCount} links instead of 169. Aborting.`
    );
  }

  const modifiedRecipeDocs = updatedRecipes.filter((r) => {
    const original = liveRecipes.find((orig) => orig.id === r.id);
    return original && original.updatedAt !== r.updatedAt;
  });

  if (modifiedRecipeDocs.length !== 68) {
    throw new Error(
      `Affected recipe document count mismatch: Expected 68 modified recipe documents, found ${modifiedRecipeDocs.length}. Aborting.`
    );
  }

  // 7. Execute Remote Writes via Web SDK writeBatch in safe chunks
  const BATCH_SIZE = 400;
  for (let i = 0; i < modifiedRecipeDocs.length; i += BATCH_SIZE) {
    const chunk = modifiedRecipeDocs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const recipe of chunk) {
      const docRef = doc(db, 'recipes', recipe.id);
      batch.update(docRef, {
        ingredients: recipe.ingredients,
        updatedAt: recipe.updatedAt,
      });
    }

    await batch.commit();
  }

  console.log(`[Stage2Migration] Successfully committed ${modifiedRecipeDocs.length} recipe documents to Firestore.`);

  // 8. Authoritative Post-Write Remote Read-Back Verification
  const verifyRecipesQuery = query(collection(db, 'recipes'), where('workspaceId', '==', TARGET_WORKSPACE_ID));
  const verifySnap = await getDocs(verifyRecipesQuery);
  const verifyRecipes: Recipe[] = [];
  verifySnap.forEach((d) => {
    verifyRecipes.push({ id: d.id, ...(d.data() as object) } as Recipe);
  });

  // Verify formula content immutability post-write
  const postWriteFormulaHash = await computeFormulaSnapshotHash(verifyRecipes);
  if (postWriteFormulaHash !== preWriteHash) {
    throw new Error(
      `CRITICAL INVARIANT VIOLATION: Formula content altered during Stage 2 write! Pre-write: ${preWriteHash}, Post-write: ${postWriteFormulaHash}`
    );
  }

  // Count post-write lines
  let postWriteActiveLinked = 0;
  let postWriteActiveUnlinked = 0;
  let postWriteBrokenLinks = 0;
  let postWriteArchivedUntouched = 0;

  const masterById = new Map<string, MasterIngredient>();
  liveMasterIngs.forEach((m) => masterById.set(m.id, m));

  for (const r of verifyRecipes) {
    if (r.archived) {
      postWriteArchivedUntouched += (r.ingredients || []).length;
      continue;
    }
    for (const ing of r.ingredients || []) {
      if (ing.masterIngredientId) {
        postWriteActiveLinked++;
        if (!masterById.has(ing.masterIngredientId)) {
          postWriteBrokenLinks++;
        }
      } else {
        postWriteActiveUnlinked++;
      }
    }
  }

  // Assert expected 685 active linked lines (100%), 0 unlinked, 0 broken, 21 archived
  if (postWriteActiveLinked !== 685) {
    throw new Error(
      `Post-write verification failed: Expected 685 active linked lines, found ${postWriteActiveLinked}.`
    );
  }
  if (postWriteActiveUnlinked !== 0) {
    throw new Error(
      `Post-write verification failed: Expected 0 active unlinked lines, found ${postWriteActiveUnlinked}.`
    );
  }
  if (postWriteBrokenLinks !== 0) {
    throw new Error(
      `Post-write verification failed: Detected ${postWriteBrokenLinks} broken links.`
    );
  }
  if (postWriteArchivedUntouched !== 21) {
    throw new Error(
      `Post-write verification failed: Expected 21 untouched archived lines, found ${postWriteArchivedUntouched}.`
    );
  }

  return {
    success: true,
    message: `Stage 2 Master Ingredient linking successfully executed and remotely verified. 169 formula lines linked across 68 recipes.`,
    affectedRecipesCount: modifiedRecipeDocs.length,
    linkedLinesCount: affectedCount,
    preWriteFormulaHash: preWriteHash,
    postWriteFormulaHash,
    postWriteActiveLinked,
    postWriteActiveUnlinked,
    postWriteBrokenLinks,
    postWriteArchivedUntouched,
    timestamp: new Date().toISOString(),
    operatorEmail: user.email,
    operatorUid: user.uid,
  };
}
