/**
 * Phase 2A — Master Ingredient Linking Foundation Service
 *
 * Provides authoritative models, matching suggestions, dynamic workspace statistics,
 * grouped linking helpers, orphan/broken link detection, and workspace isolation guards.
 *
 * CORE INVARIANTS:
 * 1. Linking changes ONLY masterIngredientId metadata.
 * 2. Recipe formula quantities, units, waste, and calculations are strictly IMMUTABLE.
 * 3. Suggestions are never authority — zero writes without explicit user confirmation.
 * 4. Cross-workspace linking is strictly forbidden.
 * 5. Viewer role cannot create, modify, or remove links.
 */

import { Recipe, Ingredient, MasterIngredient, AccessRole } from '../types';

export type MatchConfidence = 'exact' | 'likely' | 'none';

export interface MatchSuggestion {
  masterIngredient: MasterIngredient;
  confidence: 'exact' | 'likely';
  reason: string;
}

export interface FormulaLineOccurrence {
  recipeId: string;
  recipeName: string;
  recipeArchived: boolean;
  ingredientIndex: number;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  masterIngredientId?: string;
  linkedMasterIngredient?: MasterIngredient | null;
  isBroken: boolean;
  suggestion?: MatchSuggestion | null;
}

export interface GroupedIngredientOccurrence {
  normalizedName: string;
  displayName: string;
  count: number;
  activeCount: number;
  archivedCount: number;
  occurrences: FormulaLineOccurrence[];
  allLinked: boolean;
  anyLinked: boolean;
  linkedCount: number;
  unlinkedCount: number;
  brokenCount: number;
  suggestedMasterIngredient?: MasterIngredient | null;
  suggestionConfidence: MatchConfidence;
  suggestionReason?: string;
}

export interface LinkingStats {
  totalFormulaLines: number;
  linkedFormulaLines: number;
  unlinkedFormulaLines: number;
  brokenLinks: number;
  exactMatchSuggestions: number;
  likelyMatchSuggestions: number;
  percentageLinked: number;
  isInventoryReady: boolean;
  activeFormulaLines: number;
  archivedFormulaLines: number;
}

/**
 * Normalizes a string for comparison by trimming, converting to lower case,
 * and normalizing whitespace and punctuation.
 */
export function normalizeIngredientName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Safe matching algorithm:
 * - EXACT MATCH: Case-insensitive trimmed name matches exactly.
 * - LIKELY MATCH: Normalized singular/plural or inverted formatting without ambiguity.
 * - NO MATCH: Multiple ambiguous candidates or no match.
 *
 * CRITICAL RULE: Ambiguous terms (e.g. "Sugar" vs "Brown Sugar", "Powdered Sugar", "Granulated Sugar")
 * must NEVER produce a likely match if there are multiple candidates.
 */
export function findMatchSuggestion(
  ingredientName: string,
  masterIngredients: MasterIngredient[]
): MatchSuggestion | null {
  const cleanName = ingredientName.trim();
  if (!cleanName || masterIngredients.length === 0) return null;

  const lowerName = cleanName.toLowerCase();
  const normalized = normalizeIngredientName(cleanName);

  // 1. Check for Exact Case-Insensitive Match
  const exactMatches = masterIngredients.filter(
    (m) => m.name.trim().toLowerCase() === lowerName
  );
  if (exactMatches.length === 1) {
    return {
      masterIngredient: exactMatches[0],
      confidence: 'exact',
      reason: 'Exact name match',
    };
  }

  // 2. Check for singular/plural or punctuation variations (e.g., "Egg" vs "Eggs")
  const directVariations = masterIngredients.filter((m) => {
    const mNorm = normalizeIngredientName(m.name);
    if (mNorm === normalized) return true;
    if (mNorm === `${normalized}s` || `${mNorm}s` === normalized) return true;
    if (mNorm === `${normalized}es` || `${mNorm}es` === normalized) return true;
    return false;
  });

  if (directVariations.length === 1) {
    return {
      masterIngredient: directVariations[0],
      confidence: 'likely',
      reason: 'Singular/plural variation',
    };
  }

  // 3. Check for specific common pantry qualifiers with strict ambiguity avoidance
  // E.g., "Butter, Unsalted" vs "Unsalted Butter"
  const invertedMatches = masterIngredients.filter((m) => {
    const mWords = normalizeIngredientName(m.name).split(' ').sort().join(' ');
    const nWords = normalized.split(' ').sort().join(' ');
    return mWords === nWords && mWords.length > 0;
  });

  if (invertedMatches.length === 1) {
    return {
      masterIngredient: invertedMatches[0],
      confidence: 'likely',
      reason: 'Word order variation',
    };
  }

  // 4. Safe containment ONLY IF there is a single unmistakable match
  // E.g. "Pure Vanilla Extract" vs "Vanilla Extract", but NOT "Sugar" if multiple sugars exist!
  const containsCandidates = masterIngredients.filter((m) => {
    const mNorm = normalizeIngredientName(m.name);
    return mNorm.includes(normalized) || normalized.includes(mNorm);
  });

  // If multiple candidates exist (e.g. Sugar -> Brown Sugar, White Sugar, Powdered Sugar),
  // this is ambiguous! Return null (Needs Review / No automatic suggestion).
  if (containsCandidates.length === 1) {
    return {
      masterIngredient: containsCandidates[0],
      confidence: 'likely',
      reason: 'Unique partial match',
    };
  }

  return null;
}

/**
 * Validates cross-workspace linking constraint.
 * A recipe ingredient may only link to a Master Ingredient belonging to the SAME workspace.
 */
export function assertSameWorkspace(
  recipe: Recipe,
  masterIngredient: MasterIngredient,
  activeWorkspaceId: string
): void {
  const recipeWs = recipe.workspaceId || activeWorkspaceId || 'ws-main';
  const masterWs = masterIngredient.workspaceId || activeWorkspaceId || 'ws-main';

  if (recipeWs !== masterWs) {
    throw new Error(
      `Cross-workspace linking is strictly prohibited. Recipe workspace (${recipeWs}) does not match Master Ingredient workspace (${masterWs}).`
    );
  }
}

/**
 * Validates that user role is permitted to modify ingredient links.
 */
export function assertCanModifyLinks(userRole?: AccessRole | null): void {
  if (userRole !== 'owner' && userRole !== 'editor') {
    throw new Error('Permission denied: Viewers cannot create, modify, or remove ingredient links.');
  }
}

/**
 * Pure function: links a specific recipe ingredient line to a Master Ingredient.
 * Invariant: Modifies ONLY masterIngredientId and updatedAt. Formula fields are untouched.
 * Targeting: Authoritative pair (recipeId, ingredientId) - fail-closed on invalid/missing/duplicate ID.
 */
export function linkIngredientInRecipe(
  recipe: Recipe,
  ingredientId: string,
  masterIngredient: MasterIngredient,
  activeWorkspaceId: string,
  userRole?: AccessRole | null
): Recipe {
  assertCanModifyLinks(userRole);

  if (!recipe || !recipe.id) {
    throw new Error('Invalid recipe: Recipe must exist and have an ID.');
  }

  assertSameWorkspace(recipe, masterIngredient, activeWorkspaceId);

  if (!ingredientId || typeof ingredientId !== 'string' || ingredientId.trim() === '') {
    throw new Error('Invalid ingredient ID: ingredientId must be a non-empty string.');
  }

  const matchingIngredients = recipe.ingredients.filter((ing) => ing.id === ingredientId);

  if (matchingIngredients.length === 0) {
    throw new Error(`Ingredient not found in recipe ${recipe.id}: ${ingredientId}`);
  }

  if (matchingIngredients.length > 1) {
    throw new Error(
      `Duplicate ingredient ID detected in recipe ${recipe.id}: ${ingredientId}. Operation aborted to prevent ambiguous mutation.`
    );
  }

  const updatedIngredients = recipe.ingredients.map((ing) => {
    if (ing.id !== ingredientId) return ing;
    return {
      ...ing,
      masterIngredientId: masterIngredient.id,
    };
  });

  return {
    ...recipe,
    ingredients: updatedIngredients,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Pure function: unlinks a specific recipe ingredient line from its Master Ingredient.
 * Invariant: Removes ONLY masterIngredientId. Formula fields are untouched.
 * Targeting: Authoritative pair (recipeId, ingredientId) - fail-closed on invalid/missing/duplicate ID.
 */
export function unlinkIngredientInRecipe(
  recipe: Recipe,
  ingredientId: string,
  userRole?: AccessRole | null
): Recipe {
  assertCanModifyLinks(userRole);

  if (!recipe || !recipe.id) {
    throw new Error('Invalid recipe: Recipe must exist and have an ID.');
  }

  if (!ingredientId || typeof ingredientId !== 'string' || ingredientId.trim() === '') {
    throw new Error('Invalid ingredient ID: ingredientId must be a non-empty string.');
  }

  const matchingIngredients = recipe.ingredients.filter((ing) => ing.id === ingredientId);

  if (matchingIngredients.length === 0) {
    throw new Error(`Ingredient not found in recipe ${recipe.id}: ${ingredientId}`);
  }

  if (matchingIngredients.length > 1) {
    throw new Error(
      `Duplicate ingredient ID detected in recipe ${recipe.id}: ${ingredientId}. Operation aborted to prevent ambiguous mutation.`
    );
  }

  const updatedIngredients = recipe.ingredients.map((ing) => {
    if (ing.id !== ingredientId) return ing;
    const { masterIngredientId, ...rest } = ing;
    return rest;
  });

  return {
    ...recipe,
    ingredients: updatedIngredients,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Collects all formula line occurrences across workspace recipes.
 */
export function collectFormulaLineOccurrences(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[]
): FormulaLineOccurrence[] {
  const masterMap = new Map<string, MasterIngredient>();
  masterIngredients.forEach((m) => masterMap.set(m.id, m));

  const occurrences: FormulaLineOccurrence[] = [];

  for (const recipe of recipes) {
    recipe.ingredients.forEach((ing, idx) => {
      const isLinked = Boolean(ing.masterIngredientId);
      const linkedMaster = ing.masterIngredientId ? masterMap.get(ing.masterIngredientId) || null : null;
      const isBroken = Boolean(ing.masterIngredientId && !linkedMaster);

      const suggestion = !isLinked ? findMatchSuggestion(ing.name, masterIngredients) : null;

      occurrences.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeArchived: Boolean(recipe.archived),
        ingredientIndex: idx,
        ingredientId: ing.id || `${recipe.id}-ing-${idx}`,
        ingredientName: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        masterIngredientId: ing.masterIngredientId,
        linkedMasterIngredient: linkedMaster,
        isBroken,
        suggestion,
      });
    });
  }

  return occurrences;
}

/**
 * Computes dynamic workspace linking statistics.
 * Never hardcoded — strictly derived from active workspace data.
 */
export function calculateLinkingStats(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[]
): LinkingStats {
  const occurrences = collectFormulaLineOccurrences(recipes, masterIngredients);

  const totalFormulaLines = occurrences.length;
  let linkedFormulaLines = 0;
  let unlinkedFormulaLines = 0;
  let brokenLinks = 0;
  let exactMatchSuggestions = 0;
  let likelyMatchSuggestions = 0;
  let activeFormulaLines = 0;
  let archivedFormulaLines = 0;

  for (const occ of occurrences) {
    if (occ.recipeArchived) {
      archivedFormulaLines++;
    } else {
      activeFormulaLines++;
    }

    if (occ.isBroken) {
      brokenLinks++;
    } else if (occ.masterIngredientId && occ.linkedMasterIngredient) {
      linkedFormulaLines++;
    } else {
      unlinkedFormulaLines++;
      if (occ.suggestion) {
        if (occ.suggestion.confidence === 'exact') {
          exactMatchSuggestions++;
        } else if (occ.suggestion.confidence === 'likely') {
          likelyMatchSuggestions++;
        }
      }
    }
  }

  const percentageLinked = totalFormulaLines > 0 ? (linkedFormulaLines / totalFormulaLines) * 100 : 0;
  // Inventory readiness requires 100% of active formula lines to be linked with 0 broken links
  const isInventoryReady = totalFormulaLines > 0 && unlinkedFormulaLines === 0 && brokenLinks === 0;

  return {
    totalFormulaLines,
    linkedFormulaLines,
    unlinkedFormulaLines,
    brokenLinks,
    exactMatchSuggestions,
    likelyMatchSuggestions,
    percentageLinked: Math.round(percentageLinked * 10) / 10,
    isInventoryReady,
    activeFormulaLines,
    archivedFormulaLines,
  };
}

/**
 * Groups formula line occurrences by normalized ingredient name for review & bulk linking.
 */
export function groupOccurrencesByName(
  occurrences: FormulaLineOccurrence[],
  masterIngredients: MasterIngredient[]
): GroupedIngredientOccurrence[] {
  const groupsMap = new Map<string, FormulaLineOccurrence[]>();

  for (const occ of occurrences) {
    const key = occ.ingredientName.trim().toLowerCase();
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
    }
    groupsMap.get(key)!.push(occ);
  }

  const result: GroupedIngredientOccurrence[] = [];

  for (const [key, items] of groupsMap.entries()) {
    const displayName = items[0]?.ingredientName || key;
    const count = items.length;
    const activeCount = items.filter((i) => !i.recipeArchived).length;
    const archivedCount = items.filter((i) => i.recipeArchived).length;
    const linkedCount = items.filter((i) => Boolean(i.masterIngredientId && !i.isBroken)).length;
    const brokenCount = items.filter((i) => i.isBroken).length;
    const unlinkedCount = items.filter((i) => !i.masterIngredientId).length;

    const allLinked = linkedCount === count;
    const anyLinked = linkedCount > 0;

    // Determine suggestion for this group
    const suggestion = findMatchSuggestion(displayName, masterIngredients);

    result.push({
      normalizedName: key,
      displayName,
      count,
      activeCount,
      archivedCount,
      occurrences: items,
      allLinked,
      anyLinked,
      linkedCount,
      unlinkedCount,
      brokenCount,
      suggestedMasterIngredient: suggestion?.masterIngredient || null,
      suggestionConfidence: suggestion?.confidence || 'none',
      suggestionReason: suggestion?.reason,
    });
  }

  // Sort by count descending (most common ingredients first)
  return result.sort((a, b) => b.count - a.count);
}

/**
 * Finds all recipes that reference a specific Master Ingredient by masterIngredientId.
 */
export function getMasterIngredientReferences(
  masterIngredientId: string,
  recipes: Recipe[]
): {
  recipeId: string;
  recipeName: string;
  recipeArchived: boolean;
  ingredientCount: number;
}[] {
  if (!masterIngredientId) return [];

  const references: {
    recipeId: string;
    recipeName: string;
    recipeArchived: boolean;
    ingredientCount: number;
  }[] = [];

  for (const recipe of recipes) {
    const matches = recipe.ingredients.filter(
      (ing) => ing.masterIngredientId === masterIngredientId
    );
    if (matches.length > 0) {
      references.push({
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeArchived: Boolean(recipe.archived),
        ingredientCount: matches.length,
      });
    }
  }

  return references;
}

/**
 * Bulk-links a group of occurrences to a chosen Master Ingredient across recipes.
 * Returns the modified recipes and the exact count of lines updated.
 */
export function applyBulkGroupLink(
  recipes: Recipe[],
  targetNormalizedName: string,
  masterIngredient: MasterIngredient,
  activeWorkspaceId: string,
  userRole?: AccessRole | null
): { updatedRecipes: Recipe[]; affectedCount: number } {
  assertCanModifyLinks(userRole);

  const targetKey = targetNormalizedName.trim().toLowerCase();
  let affectedCount = 0;

  const updatedRecipes = recipes.map((recipe) => {
    let recipeChanged = false;
    const updatedIngredients = recipe.ingredients.map((ing) => {
      if (ing.name.trim().toLowerCase() === targetKey && ing.masterIngredientId !== masterIngredient.id) {
        // Enforce workspace check
        assertSameWorkspace(recipe, masterIngredient, activeWorkspaceId);
        recipeChanged = true;
        affectedCount++;
        return {
          ...ing,
          masterIngredientId: masterIngredient.id,
        };
      }
      return ing;
    });

    if (recipeChanged) {
      return {
        ...recipe,
        ingredients: updatedIngredients,
        updatedAt: new Date().toISOString(),
      };
    }
    return recipe;
  });

  return { updatedRecipes, affectedCount };
}
