import { AccessRole, Workspace } from '../types';

/**
 * Baseline system category-to-preset routing map.
 * Used ONLY when a workspace has not explicitly configured an override for one of these
 * standard bakery categories. Never overrides explicit workspace mappings, and never
 * applies an automatic 'All' fallback to unmapped custom categories (such as 'Four Seasons').
 */
export const DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP: Readonly<Record<string, string>> = Object.freeze({
  Cookies: 'Cookies',
  Bread: 'Base Dough',
  Pies: 'Pie Dough',
  'Pie Dough': 'Pie Dough',
  Shortbread: 'Shortbread',
  Pastries: 'Pie Dough',
  Biscuits: 'Cookies',
  Scones: 'Cookies',
  Cakes: 'All',
  Muffins: 'All',
});

export interface CategoryMappingDiff {
  category: string;
  workspaceExplicitValue: string | string[] | undefined;
  workspaceEffectiveTargets: string[];
  localProposedTargets: string[];
  changeType: 'added' | 'modified';
}

export interface CategoryMappingMigrationInspection {
  hasDifferences: boolean;
  diffs: CategoryMappingDiff[];
  authoritativeWorkspaceMap: Record<string, string | string[]>;
  proposedMergedWorkspaceMap: Record<string, string | string[]>;
}

/**
 * Normalizes a string or string[] preset routing value into a clean, deduplicated array.
 */
export function normalizeCategoryTargets(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  const rawList = Array.isArray(val) ? val : [val];
  const cleaned: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed === 'All') {
      return ['All'];
    }
    if (!cleaned.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

/**
 * Looks up a category key in a categoryPresetMap with exact match first,
 * followed by trimmed case-insensitive key lookup.
 */
export function lookupCategoryMappingValue(
  category: string | undefined | null,
  categoryPresetMap?: Record<string, string | string[]> | null
): { found: boolean; matchedKey?: string; value?: string | string[] } {
  if (!category || !categoryPresetMap) return { found: false };
  const cleanCat = category.trim();
  if (!cleanCat) return { found: false };

  if (Object.prototype.hasOwnProperty.call(categoryPresetMap, cleanCat)) {
    return { found: true, matchedKey: cleanCat, value: categoryPresetMap[cleanCat] };
  }

  const lower = cleanCat.toLowerCase();
  for (const key of Object.keys(categoryPresetMap)) {
    if (key.trim().toLowerCase() === lower) {
      return { found: true, matchedKey: key, value: categoryPresetMap[key] };
    }
  }

  return { found: false };
}

/**
 * Resolves the authoritative categoryPresetMap for a given workspace.
 *
 * CRITICAL INVARIANTS:
 * 1. Reads ONLY from `workspaces/{workspaceId}.categoryPresetMap` layered over
 *    `DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP`.
 * 2. NEVER reads from device-local `localStorage` or per-user `settings/{uid}`.
 * 3. Guarantees identical routing across laptop, tablet, and phone for all
 *    authorized workspace members (Owner, Editor, Viewer).
 * 4. Guarantees zero cross-workspace leakage when switching workspaces.
 */
export function resolveWorkspaceCategoryPresetMap(
  workspace: Pick<Workspace, 'categoryPresetMap'> | null | undefined
): Record<string, string | string[]> {
  const resolved: Record<string, string | string[]> = {
    ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
  };

  const wsMap = workspace?.categoryPresetMap;
  if (wsMap && typeof wsMap === 'object') {
    for (const [rawKey, rawVal] of Object.entries(wsMap)) {
      const cleanKey = rawKey.trim();
      if (!cleanKey) continue;
      // Remove any differing-case duplicate key from defaults before applying workspace override
      for (const existingKey of Object.keys(resolved)) {
        if (existingKey !== cleanKey && existingKey.toLowerCase() === cleanKey.toLowerCase()) {
          delete resolved[existingKey];
        }
      }
      const normalized = normalizeCategoryTargets(rawVal);
      if (normalized.length > 0) {
        resolved[cleanKey] = normalized.length === 1 ? normalized[0] : normalized;
      }
    }
  }

  return resolved;
}

/**
 * Resolves the target packaging preset categories for a given recipe category
 * using the unified category mapping logic shared by BOTH Production Floor Mode
 * and Management Mode.
 *
 * - If the recipe category has an explicit mapping in `categoryPresetMap`, returns
 *   its normalized target categories (`['All']` ONLY when `'All'` was explicitly mapped).
 * - If unmapped, returns `[recipeCategory.trim()]` — NEVER an automatic `'All'` fallback
 *   that would expose unrelated presets to unmapped recipe categories.
 */
export function getTargetPresetCategoriesForRecipeCategory(
  recipeCategory: string | undefined | null,
  categoryPresetMap?: Record<string, string | string[]> | null
): string[] {
  const cleanCat = (recipeCategory || '').trim();
  if (!cleanCat) return ['All'];

  const lookup = lookupCategoryMappingValue(cleanCat, categoryPresetMap);
  if (lookup.found) {
    const normalized = normalizeCategoryTargets(lookup.value);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [cleanCat];
}

/**
 * Compares two normalized target category arrays for semantic equivalence
 * (case-insensitive, order-independent).
 */
export function areCategoryTargetsEquivalent(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].map((s) => s.trim().toLowerCase()).sort();
  const sortedB = [...b].map((s) => s.trim().toLowerCase()).sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 *Sanitizes a categoryPresetMap prior to persisting to `workspaces/{workspaceId}`.
 */
export function sanitizeCategoryPresetMap(
  inputMap: Record<string, string | string[]> | null | undefined
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};
  if (!inputMap || typeof inputMap !== 'object') return sanitized;

  for (const [rawKey, rawVal] of Object.entries(inputMap)) {
    const cleanKey = rawKey.trim();
    if (!cleanKey) continue;
    const normalized = normalizeCategoryTargets(rawVal);
    if (normalized.length === 0) continue;
    sanitized[cleanKey] = normalized.length === 1 ? normalized[0] : normalized;
  }

  return sanitized;
}

/**
 * Enforces Owner-only authorization before saving workspace-wide category mappings.
 * Mirrors `firestore.rules` (`allow update: if isWorkspaceOwner(workspaceId)`).
 */
export function assertCanModifyWorkspaceCategoryMap(role: AccessRole | null | undefined): void {
  if (role !== 'owner') {
    throw new Error(
      'Permission denied: Only workspace owners can modify shared workspace category preset mappings.'
    );
  }
}

/**
 * Read-only migration inspector: compares the authoritative `workspaces/{workspaceId}.categoryPresetMap`
 * against a device-local or per-UID saved `categoryPresetMap` without mutating any state.
 *
 * Rules:
 * - Never auto-applies local mappings.
 * - Ignores local entries that already match the workspace's effective routing.
 * - Never deletes existing explicit workspace mappings simply because a stale local device lacks them.
 * - Produces an exact per-category diff list requiring explicit Owner review and approval.
 */
export function inspectCategoryMappingMigration(
  workspace: Pick<Workspace, 'categoryPresetMap'> | null | undefined,
  localSavedMap?: Record<string, string | string[]> | null
): CategoryMappingMigrationInspection {
  const authoritativeWorkspaceMap = resolveWorkspaceCategoryPresetMap(workspace);
  const explicitWsMap = workspace?.categoryPresetMap || {};
  const proposedMergedWorkspaceMap: Record<string, string | string[]> = {
    ...sanitizeCategoryPresetMap(authoritativeWorkspaceMap),
  };

  if (!localSavedMap || typeof localSavedMap !== 'object') {
    return {
      hasDifferences: false,
      diffs: [],
      authoritativeWorkspaceMap,
      proposedMergedWorkspaceMap,
    };
  }

  const diffs: CategoryMappingDiff[] = [];

  for (const [rawCat, rawLocalVal] of Object.entries(localSavedMap)) {
    const cleanCat = rawCat.trim();
    if (!cleanCat) continue;

    const localProposedTargets = normalizeCategoryTargets(rawLocalVal);
    if (localProposedTargets.length === 0) continue;

    const workspaceEffectiveTargets = getTargetPresetCategoriesForRecipeCategory(
      cleanCat,
      authoritativeWorkspaceMap
    );

    if (areCategoryTargetsEquivalent(workspaceEffectiveTargets, localProposedTargets)) {
      continue;
    }

    const explicitLookup = lookupCategoryMappingValue(cleanCat, explicitWsMap);
    diffs.push({
      category: cleanCat,
      workspaceExplicitValue: explicitLookup.value,
      workspaceEffectiveTargets,
      localProposedTargets,
      changeType: explicitLookup.found ? 'modified' : 'added',
    });

    const targetKey = explicitLookup.matchedKey || cleanCat;
    proposedMergedWorkspaceMap[targetKey] =
      localProposedTargets.length === 1 ? localProposedTargets[0] : localProposedTargets;
  }

  diffs.sort((a, b) => a.category.localeCompare(b.category));

  return {
    hasDifferences: diffs.length > 0,
    diffs,
    authoritativeWorkspaceMap,
    proposedMergedWorkspaceMap,
  };
}
