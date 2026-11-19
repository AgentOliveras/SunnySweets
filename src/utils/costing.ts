import {
  Recipe,
  Ingredient,
  MasterIngredient,
  PurchasePackage,
  CostingDimension,
  WeightUnit,
  VolumeUnit,
} from '../types';
import { WEIGHT_TO_GRAMS, VOLUME_TO_ML, isWeightUnit, isVolumeUnit } from './units';

export type CostIncompleteReason =
  | 'UNLINKED'
  | 'NO_PURCHASE_PRICE'
  | 'NO_PACKAGE_SIZE'
  | 'MISSING_DENSITY'
  | 'MISSING_PIECE_WEIGHT'
  | 'UNSUPPORTED_UNIT'
  | 'MASTER_INGREDIENT_NOT_FOUND'
  | 'INVALID_PACKAGE_DATA';

// Additional volume units for commercial packaging (e.g. 1 gal jug)
const EXTENDED_VOLUME_TO_ML: Record<string, number> = {
  ...VOLUME_TO_ML,
  gal: 3785.411784,
  gallon: 3785.411784,
  gallons: 3785.411784,
};

// Recognized discrete units
const DISCRETE_UNITS = new Set([
  'each',
  'piece',
  'pieces',
  'pcs',
  'unit',
  'units',
  'egg',
  'eggs',
  'doz',
  'dozen',
  'dozens',
  'ct',
  'count',
]);

/**
 * Normalization result when processing a PurchasePackage.
 */
export interface NormalizedPackageResult {
  costPerGram?: number;
  costPerEach?: number;
  normalizedPackageGrams?: number;
  totalUnitsCount?: number;
  totalVolumeMl?: number;
  error?: string;
}

/**
 * Validate and normalize purchase package data into precise base unit costs.
 * Rule: packagePriceCents is integer cents ($24.50 = 2450).
 * Unit costs are floating dollar values preserving precision (at least 8 decimals).
 * $0.00 is valid (tap water, sourdough starter).
 */
export function normalizePurchasePackage(
  pkg: PurchasePackage,
  dimension?: CostingDimension,
  densityGramsPerMl?: number,
  pieceWeightGrams?: number
): NormalizedPackageResult {
  if (!pkg) {
    return { error: 'No purchase package provided' };
  }

  const { packQuantity, unitSize, unitMeasure, packagePriceCents } = pkg;

  // Validation
  if (packQuantity === undefined || packQuantity === null || isNaN(packQuantity) || packQuantity <= 0) {
    return { error: 'Pack quantity must be greater than 0' };
  }
  if (unitSize === undefined || unitSize === null || isNaN(unitSize) || unitSize <= 0) {
    return { error: 'Unit size must be greater than 0' };
  }
  if (packagePriceCents === undefined || packagePriceCents === null || isNaN(packagePriceCents) || packagePriceCents < 0) {
    return { error: 'Package price cannot be negative' };
  }
  const cleanMeasure = (unitMeasure || '').trim().toLowerCase();
  if (!cleanMeasure) {
    return { error: 'Unit measure is required' };
  }

  const packagePriceDollars = packagePriceCents / 100;

  // Infer dimension if not explicitly provided
  let effectiveDimension: CostingDimension = dimension || 'mass';
  if (!dimension) {
    if (isWeightUnit(cleanMeasure)) {
      effectiveDimension = 'mass';
    } else if (cleanMeasure in EXTENDED_VOLUME_TO_ML) {
      effectiveDimension = 'volume';
    } else if (DISCRETE_UNITS.has(cleanMeasure)) {
      effectiveDimension = 'discrete';
    }
  }

  // Dimension 1: MASS
  if (effectiveDimension === 'mass') {
    if (!isWeightUnit(cleanMeasure)) {
      return { error: `Unsupported mass unit "${unitMeasure}". Supported: g, kg, oz, lb` };
    }
    const gramsPerUnit = WEIGHT_TO_GRAMS[cleanMeasure as WeightUnit];
    const totalGrams = packQuantity * unitSize * gramsPerUnit;
    if (totalGrams <= 0) {
      return { error: 'Calculated package net weight must be greater than 0' };
    }
    const costPerGram = packagePriceDollars / totalGrams;
    const result: NormalizedPackageResult = {
      costPerGram,
      normalizedPackageGrams: totalGrams,
    };
    if (pieceWeightGrams && pieceWeightGrams > 0) {
      result.costPerEach = costPerGram * pieceWeightGrams;
    }
    return result;
  }

  // Dimension 2: VOLUME
  if (effectiveDimension === 'volume') {
    const mlPerUnit = EXTENDED_VOLUME_TO_ML[cleanMeasure];
    if (!mlPerUnit) {
      return { error: `Unsupported volume unit "${unitMeasure}". Supported: ml, l, tsp, tbsp, cup, fl_oz, gal` };
    }
    const totalMl = packQuantity * unitSize * mlPerUnit;
    if (totalMl <= 0) {
      return { error: 'Calculated package net volume must be greater than 0' };
    }

    const result: NormalizedPackageResult = {
      totalVolumeMl: totalMl,
    };

    if (densityGramsPerMl && densityGramsPerMl > 0) {
      const totalGrams = totalMl * densityGramsPerMl;
      result.normalizedPackageGrams = totalGrams;
      result.costPerGram = packagePriceDollars / totalGrams;
    }
    return result;
  }

  // Dimension 3: DISCRETE
  if (effectiveDimension === 'discrete') {
    let multiplier = 1;
    if (cleanMeasure === 'doz' || cleanMeasure === 'dozen' || cleanMeasure === 'dozens') {
      multiplier = 12;
    }
    const totalCount = packQuantity * unitSize * multiplier;
    if (totalCount <= 0) {
      return { error: 'Calculated package item count must be greater than 0' };
    }
    const costPerEach = packagePriceDollars / totalCount;
    const result: NormalizedPackageResult = {
      costPerEach,
      totalUnitsCount: totalCount,
    };
    if (pieceWeightGrams && pieceWeightGrams > 0) {
      const totalGrams = totalCount * pieceWeightGrams;
      result.normalizedPackageGrams = totalGrams;
      result.costPerGram = packagePriceDollars / totalGrams;
    }
    return result;
  }

  return { error: `Unknown dimension "${effectiveDimension}"` };
}

/**
 * Result of costing a single recipe ingredient line.
 */
export interface IngredientCostResult {
  cost: number; // Dollar amount (0 if zero-cost or incomplete)
  isComplete: boolean;
  reason?: CostIncompleteReason;
  message?: string;
  unitCostUsed?: number;
  unitCostType?: 'per_gram' | 'per_each';
}

/**
 * Calculate the cost of a single recipe ingredient line against its linked MasterIngredient.
 * Adheres to:
 * - NEVER default missing density to 1.0!
 * - Do NOT automatically assume large egg = 50g!
 * - $0.00 is valid.
 * - Missing links or data produce structured incomplete results.
 */
export function calculateIngredientCost(
  ingredient: Ingredient,
  masterIngredient?: MasterIngredient
): IngredientCostResult {
  // Check 1: Must have masterIngredientId
  if (!ingredient.masterIngredientId) {
    return {
      cost: 0,
      isComplete: false,
      reason: 'UNLINKED',
      message: 'Ingredient is not linked to a Master Ingredient in the pantry',
    };
  }

  // Check 2: MasterIngredient must exist
  if (!masterIngredient) {
    return {
      cost: 0,
      isComplete: false,
      reason: 'MASTER_INGREDIENT_NOT_FOUND',
      message: `Master Ingredient not found for ID "${ingredient.masterIngredientId}"`,
    };
  }

  // Check 3: Check unit costs or derive from preferredPurchasePackage
  let costPerGram = masterIngredient.costPerGram;
  let costPerEach = masterIngredient.costPerEach;

  if (costPerGram === undefined && costPerEach === undefined && masterIngredient.preferredPurchasePackage) {
    const norm = normalizePurchasePackage(
      masterIngredient.preferredPurchasePackage,
      masterIngredient.dimension,
      ingredient.densityGramsPerMl || masterIngredient.densityGramsPerMl,
      masterIngredient.pieceWeightGrams
    );
    costPerGram = norm.costPerGram;
    costPerEach = norm.costPerEach;
  }

  // Check 4: If still no cost defined
  if (costPerGram === undefined && costPerEach === undefined) {
    return {
      cost: 0,
      isComplete: false,
      reason: 'NO_PURCHASE_PRICE',
      message: `No purchase price or package configured for "${masterIngredient.name}"`,
    };
  }

  const ingQuantity = Number(ingredient.quantity) || 0;
  const cleanUnit = (ingredient.unit || '').trim().toLowerCase();

  // Route A: Mass Unit (g, kg, oz, lb)
  if (isWeightUnit(cleanUnit)) {
    const grams = ingQuantity * WEIGHT_TO_GRAMS[cleanUnit as WeightUnit];
    if (costPerGram !== undefined) {
      return {
        cost: grams * costPerGram,
        isComplete: true,
        unitCostUsed: costPerGram,
        unitCostType: 'per_gram',
      };
    }
    // If purchased discretely (costPerEach exists), we need pieceWeightGrams to convert weight to count
    if (costPerEach !== undefined) {
      const pieceWeight = masterIngredient.pieceWeightGrams;
      if (pieceWeight && pieceWeight > 0) {
        const derivedCostPerGram = costPerEach / pieceWeight;
        return {
          cost: grams * derivedCostPerGram,
          isComplete: true,
          unitCostUsed: derivedCostPerGram,
          unitCostType: 'per_gram',
        };
      }
      return {
        cost: 0,
        isComplete: false,
        reason: 'MISSING_PIECE_WEIGHT',
        message: `Piece weight (g) required to calculate weight cost for discrete item "${masterIngredient.name}"`,
      };
    }
  }

  // Route B: Volume Unit (ml, l, tsp, tbsp, cup, fl_oz, gal)
  if (cleanUnit in EXTENDED_VOLUME_TO_ML) {
    const mlPerUnit = EXTENDED_VOLUME_TO_ML[cleanUnit];
    const totalMl = ingQuantity * mlPerUnit;
    const density = ingredient.densityGramsPerMl || masterIngredient.densityGramsPerMl;

    // Density is strictly required for volume-to-mass costing
    if (!density || density <= 0) {
      return {
        cost: 0,
        isComplete: false,
        reason: 'MISSING_DENSITY',
        message: `Density (g/ml) required for costing volume ingredient "${ingredient.name}"`,
      };
    }

    const totalGrams = totalMl * density;
    if (costPerGram !== undefined) {
      return {
        cost: totalGrams * costPerGram,
        isComplete: true,
        unitCostUsed: costPerGram,
        unitCostType: 'per_gram',
      };
    }
  }

  // Route C: Discrete Unit (each, piece, egg, doz, etc.)
  if (DISCRETE_UNITS.has(cleanUnit)) {
    let multiplier = 1;
    if (cleanUnit === 'doz' || cleanUnit === 'dozen' || cleanUnit === 'dozens') {
      multiplier = 12;
    }
    const count = ingQuantity * multiplier;

    if (costPerEach !== undefined) {
      return {
        cost: count * costPerEach,
        isComplete: true,
        unitCostUsed: costPerEach,
        unitCostType: 'per_each',
      };
    }

    // If only costPerGram is known, we need pieceWeightGrams
    if (costPerGram !== undefined) {
      const pieceWeight = masterIngredient.pieceWeightGrams;
      if (pieceWeight && pieceWeight > 0) {
        const totalGrams = count * pieceWeight;
        return {
          cost: totalGrams * costPerGram,
          isComplete: true,
          unitCostUsed: costPerGram,
          unitCostType: 'per_gram',
        };
      }
      return {
        cost: 0,
        isComplete: false,
        reason: 'MISSING_PIECE_WEIGHT',
        message: `Piece weight (g) required to cost discrete quantity of "${masterIngredient.name}"`,
      };
    }
  }

  // Route D: Unsupported custom unit
  return {
    cost: 0,
    isComplete: false,
    reason: 'UNSUPPORTED_UNIT',
    message: `Unsupported measurement unit "${ingredient.unit}" for costing "${ingredient.name}"`,
  };
}

/**
 * Summary breakdown of a full recipe's ingredient costing.
 */
export interface RecipeCostSummary {
  totalIngredientCost: number; // Sum of all costed ingredients (in dollars)
  costComplete: boolean; // True only if every ingredient is fully costed
  costedIngredientCount: number;
  totalIngredientCount: number;
  costPerYieldUnit?: number; // Only if costComplete && batchYieldQuantity > 0
  yieldUnit?: string;
  missing: Array<{
    ingredientId: string;
    ingredientName: string;
    reason: CostIncompleteReason;
    message: string;
  }>;
  uncostedIngredients: Array<{
    ingredientId: string;
    ingredientName: string;
    reason: CostIncompleteReason;
    message: string;
  }>;
  ingredientCosts: Array<{
    ingredientId: string;
    ingredientName: string;
    cost: number;
    isComplete: boolean;
    reason?: CostIncompleteReason;
    message?: string;
    unitCostUsed?: number;
  }>;
}

/**
 * Calculate the comprehensive ingredient cost summary for a recipe or ingredient list.
 */
export function calculateRecipeCostSummary(
  target: Recipe | Ingredient[] = [],
  masterIngredients: MasterIngredient[] | Map<string, MasterIngredient>,
  batchYieldQuantity?: number,
  batchYieldUnit?: string
): RecipeCostSummary {
  let ingredients: Ingredient[];
  let yieldQty = Number(batchYieldQuantity) || 0;
  let unit = batchYieldUnit;

  if (Array.isArray(target)) {
    ingredients = target;
  } else if (target && typeof target === 'object' && 'ingredients' in target) {
    ingredients = target.ingredients || [];
    if (!yieldQty && target.batchYieldQuantity) {
      yieldQty = Number(target.batchYieldQuantity) || 0;
    }
    if (!unit && target.batchYieldUnit) {
      unit = target.batchYieldUnit;
    }
  } else {
    ingredients = [];
  }

  const masterList =
    masterIngredients instanceof Map
      ? Array.from(masterIngredients.values())
      : (masterIngredients || []);

  const masterMap =
    masterIngredients instanceof Map
      ? masterIngredients
      : new Map(masterList.map((m) => [m.id, m]));

  const nameMap = new Map(masterList.map((m) => [m.name.trim().toLowerCase(), m]));

  const missing: RecipeCostSummary['missing'] = [];
  const ingredientCosts: RecipeCostSummary['ingredientCosts'] = [];
  let totalCost = 0;
  let costedCount = 0;

  for (const ing of ingredients) {
    const master =
      (ing.masterIngredientId ? masterMap.get(ing.masterIngredientId) : undefined) ||
      nameMap.get((ing.name || '').trim().toLowerCase());

    const res = calculateIngredientCost(ing, master);

    ingredientCosts.push({
      ingredientId: ing.id,
      ingredientName: ing.name,
      cost: res.cost,
      isComplete: res.isComplete,
      reason: res.reason,
      message: res.message,
      unitCostUsed: res.unitCostUsed,
    });

    if (res.isComplete) {
      totalCost += res.cost;
      costedCount++;
    } else {
      missing.push({
        ingredientId: ing.id,
        ingredientName: ing.name,
        reason: res.reason || 'UNLINKED',
        message: res.message || 'Cost information incomplete',
      });
    }
  }

  const costComplete = ingredients.length > 0 && missing.length === 0;
  const costPerYieldUnit =
    costComplete && yieldQty > 0 ? totalCost / yieldQty : undefined;

  return {
    totalIngredientCost: totalCost,
    costComplete,
    costedIngredientCount: costedCount,
    totalIngredientCount: ingredients.length,
    costPerYieldUnit,
    yieldUnit: unit,
    missing,
    uncostedIngredients: missing,
    ingredientCosts,
  };
}

/**
 * Scaled production cost estimate based on recipe summary and multiplier.
 * Parallel to production scaling — does not alter or block scaling math.
 */
export function calculateScaledProductionCost(
  recipeSummary: RecipeCostSummary,
  scalingMultiplier: number
): {
  estimatedCost?: number;
  isComplete: boolean;
  missingCount: number;
} {
  if (!recipeSummary.costComplete || scalingMultiplier <= 0) {
    return {
      estimatedCost: undefined,
      isComplete: false,
      missingCount: recipeSummary.missing.length,
    };
  }
  return {
    estimatedCost: recipeSummary.totalIngredientCost * scalingMultiplier,
    isComplete: true,
    missingCount: 0,
  };
}
