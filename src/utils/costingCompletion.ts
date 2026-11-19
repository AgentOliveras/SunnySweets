import {
  Recipe,
  Ingredient,
  MasterIngredient,
  PurchasePackage,
} from '../types';
import {
  calculateRecipeCostSummary,
  calculateIngredientCost,
  RecipeCostSummary,
  CostIncompleteReason,
} from './costing';

export type RecipeCostStatus = 'FULLY_COSTED' | 'NEEDS_ATTENTION';

export interface RecipeCompletionDetail {
  recipe: Recipe;
  summary: RecipeCostSummary;
  status: RecipeCostStatus;
  totalIngredients: number;
  costedIngredients: number;
  unlinkedCount: number;
  missingPriceCount: number;
  missingDensityCount: number;
  missingPieceWeightCount: number;
  missingMasterCount: number;
  exactMatchCount: number;
}

export interface WorkspaceCostingStats {
  totalRecipes: number;
  fullyCostedCount: number;
  incompleteCount: number;
  coveragePercent: number; // 0 to 100
  totalIngredientLines: number;
  costedLinesCount: number;
  unlinkedLinesCount: number;
  totalMasterIngredients: number;
  masterIngredientsWithPricing: number;
  masterIngredientsMissingPricing: number;
  exactMatchesAvailable: number;
}

export interface ExactMatchSuggestion {
  recipeId: string;
  recipeName: string;
  ingredientId: string;
  ingredientName: string;
  matchedMasterId: string;
  matchedMasterName: string;
  matchedMasterCategory?: string;
  matchedMasterHasPricing: boolean;
}

/**
 * Scan recipes for unlinked ingredient lines that have an exact case-insensitive match
 * to an existing Master Ingredient in the active workspace.
 */
export function findExactMatchSuggestions(
  recipes: Recipe | Recipe[],
  masterIngredients: MasterIngredient[]
): ExactMatchSuggestion[] {
  const recipeList = Array.isArray(recipes) ? recipes : [recipes];
  const suggestions: ExactMatchSuggestion[] = [];
  const masterMap = new Map<string, MasterIngredient>();
  const nameToMaster = new Map<string, MasterIngredient>();

  for (const m of masterIngredients || []) {
    masterMap.set(m.id, m);
    const key = (m.name || '').trim().toLowerCase();
    if (key && !nameToMaster.has(key)) {
      nameToMaster.set(key, m);
    }
  }

  for (const recipe of recipeList) {
    if (recipe.archived) continue;
    for (const ing of recipe.ingredients || []) {
      const cleanName = (ing.name || '').trim().toLowerCase();
      if (!cleanName) continue;

      // If already linked to a valid master, skip
      if (ing.masterIngredientId && masterMap.has(ing.masterIngredientId)) {
        continue;
      }

      // Check for exact case-insensitive match in pantry
      const matched = nameToMaster.get(cleanName);
      if (matched) {
        const hasPricing =
          matched.costPerGram !== undefined ||
          matched.costPerEach !== undefined ||
          !!matched.preferredPurchasePackage;

        suggestions.push({
          recipeId: recipe.id,
          recipeName: recipe.name,
          ingredientId: ing.id,
          ingredientName: ing.name,
          matchedMasterId: matched.id,
          matchedMasterName: matched.name,
          matchedMasterCategory: matched.category,
          matchedMasterHasPricing: hasPricing,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Analyze all recipes and master ingredients in the active workspace to produce
 * high-level statistics and detailed breakdown per recipe.
 */
export function analyzeWorkspaceCosting(
  recipes: Recipe[],
  masterIngredients: MasterIngredient[]
): {
  stats: WorkspaceCostingStats;
  recipeDetails: RecipeCompletionDetail[];
} {
  const activeRecipes = (recipes || []).filter((r) => !r.archived);
  const masterMap = new Map(masterIngredients.map((m) => [m.id, m]));
  const nameMap = new Map(
    masterIngredients.map((m) => [(m.name || '').trim().toLowerCase(), m])
  );

  let fullyCostedCount = 0;
  let totalIngredientLines = 0;
  let costedLinesCount = 0;
  let unlinkedLinesCount = 0;

  const recipeDetails: RecipeCompletionDetail[] = [];

  for (const recipe of activeRecipes) {
    const summary = calculateRecipeCostSummary(recipe, masterIngredients);
    const totalLines = recipe.ingredients?.length || 0;
    totalIngredientLines += totalLines;

    let unlinkedCount = 0;
    let missingPriceCount = 0;
    let missingDensityCount = 0;
    let missingPieceWeightCount = 0;
    let missingMasterCount = 0;
    let exactMatchCount = 0;

    for (const ing of recipe.ingredients || []) {
      const cleanName = (ing.name || '').trim().toLowerCase();
      const hasValidLink = !!ing.masterIngredientId && masterMap.has(ing.masterIngredientId);

      if (!ing.masterIngredientId) {
        unlinkedCount++;
        unlinkedLinesCount++;
        if (cleanName && nameMap.has(cleanName)) {
          exactMatchCount++;
        }
      } else if (!hasValidLink) {
        missingMasterCount++;
        if (cleanName && nameMap.has(cleanName)) {
          exactMatchCount++;
        }
      } else {
        const master = masterMap.get(ing.masterIngredientId)!;
        const lineCost = calculateIngredientCost(ing, master);
        if (!lineCost.isComplete) {
          if (lineCost.reason === 'NO_PURCHASE_PRICE') missingPriceCount++;
          else if (lineCost.reason === 'MISSING_DENSITY') missingDensityCount++;
          else if (lineCost.reason === 'MISSING_PIECE_WEIGHT') missingPieceWeightCount++;
        }
      }
    }

    costedLinesCount += summary.costedIngredientCount;

    const isFullyCosted = summary.costComplete;
    if (isFullyCosted) {
      fullyCostedCount++;
    }

    recipeDetails.push({
      recipe,
      summary,
      status: isFullyCosted ? 'FULLY_COSTED' : 'NEEDS_ATTENTION',
      totalIngredients: totalLines,
      costedIngredients: summary.costedIngredientCount,
      unlinkedCount,
      missingPriceCount,
      missingDensityCount,
      missingPieceWeightCount,
      missingMasterCount,
      exactMatchCount,
    });
  }

  const totalRecipes = activeRecipes.length;
  const incompleteCount = totalRecipes - fullyCostedCount;
  const coveragePercent =
    totalRecipes > 0 ? Math.round((fullyCostedCount / totalRecipes) * 100) : 0;

  let masterIngredientsWithPricing = 0;
  for (const m of masterIngredients) {
    if (
      m.costPerGram !== undefined ||
      m.costPerEach !== undefined ||
      m.preferredPurchasePackage
    ) {
      masterIngredientsWithPricing++;
    }
  }
  const masterIngredientsMissingPricing =
    masterIngredients.length - masterIngredientsWithPricing;

  const suggestions = findExactMatchSuggestions(activeRecipes, masterIngredients);

  return {
    stats: {
      totalRecipes,
      fullyCostedCount,
      incompleteCount,
      coveragePercent,
      totalIngredientLines,
      costedLinesCount,
      unlinkedLinesCount,
      totalMasterIngredients: masterIngredients.length,
      masterIngredientsWithPricing,
      masterIngredientsMissingPricing,
      exactMatchesAvailable: suggestions.length,
    },
    recipeDetails,
  };
}

/**
 * Apply exact match links to a single recipe.
 * STRICT WRITE SAFETY INVARIANT:
 * - Preserves all snapshot fields: id, name, quantity, unit, notes, wastePercent, densityGramsPerMl.
 * - Only sets masterIngredientId for matched lines.
 * - Does not alter recipe ordering.
 */
export function linkExactMatchesForRecipe(
  recipe: Recipe,
  masterIngredients: MasterIngredient[]
): {
  updatedRecipe: Recipe;
  linkedCount: number;
  matchedLines: Array<{ lineId: string; masterId: string }>;
} {
  const masterMap = new Map(masterIngredients.map((m) => [m.id, m]));
  const nameMap = new Map<string, MasterIngredient>();
  for (const m of masterIngredients) {
    const key = (m.name || '').trim().toLowerCase();
    if (key && !nameMap.has(key)) {
      nameMap.set(key, m);
    }
  }

  let linkedCount = 0;
  const matchedLines: Array<{ lineId: string; masterId: string }> = [];

  const updatedIngredients = (recipe.ingredients || []).map((ing) => {
    // If already validly linked, preserve exactly
    if (ing.masterIngredientId && masterMap.has(ing.masterIngredientId)) {
      return ing;
    }

    const cleanName = (ing.name || '').trim().toLowerCase();
    if (!cleanName) return ing;

    const matchedMaster = nameMap.get(cleanName);
    if (matchedMaster) {
      linkedCount++;
      matchedLines.push({ lineId: ing.id, masterId: matchedMaster.id });
      return {
        ...ing,
        masterIngredientId: matchedMaster.id,
      };
    }

    return ing;
  });

  if (linkedCount === 0) {
    return { updatedRecipe: recipe, linkedCount: 0, matchedLines: [] };
  }

  return {
    updatedRecipe: {
      ...recipe,
      ingredients: updatedIngredients,
      updatedAt: new Date().toISOString(),
    },
    linkedCount,
    matchedLines,
  };
}

/**
 * Link a specific ingredient line to a specific Master Ingredient.
 * STRICT WRITE SAFETY INVARIANT:
 * Preserves all ingredient fields, only setting masterIngredientId.
 */
export function linkSpecificIngredient(
  recipe: Recipe,
  ingredientId: string,
  masterIngredientId: string
): Recipe {
  const updatedIngredients = (recipe.ingredients || []).map((ing) => {
    if (ing.id === ingredientId) {
      return {
        ...ing,
        masterIngredientId,
      };
    }
    return ing;
  });

  return {
    ...recipe,
    ingredients: updatedIngredients,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Unlink a specific ingredient line (removes masterIngredientId).
 */
export function unlinkSpecificIngredient(
  recipe: Recipe,
  ingredientId: string
): Recipe {
  const updatedIngredients = (recipe.ingredients || []).map((ing) => {
    if (ing.id === ingredientId) {
      const { masterIngredientId, ...rest } = ing;
      return {
        ...rest,
      };
    }
    return ing;
  });

  return {
    ...recipe,
    ingredients: updatedIngredients,
    updatedAt: new Date().toISOString(),
  };
}
