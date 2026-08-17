import {
  Recipe,
  Ingredient,
  ProductionItemRequirement,
  Mixer,
  CalculationResult,
  CalculatedIngredient,
  WeightUnit,
} from '../types';
import {
  toGrams,
  fromGrams,
  tryConvertToWeight,
  isWeightUnit,
  isVolumeUnit,
  formatQuantity,
} from './units';

export interface RecipeTotalSummary {
  totalWeightGrams: number;
  totalWeightTargetUnit: number;
  targetUnit: WeightUnit;
  formattedTargetUnit: string;
  equivalents: {
    g: { value: number; formatted: string; label: string };
    kg: { value: number; formatted: string; label: string };
    oz: { value: number; formatted: string; label: string };
    lb: { value: number; formatted: string; label: string };
  };
  discreteItems: { name: string; quantity: number; unit: string }[];
  discreteCount: number;
  totalItemsCount: number;
  perPieceWeight?: {
    value: number;
    formatted: string;
    unit: WeightUnit;
    yieldUnit: string;
  };
}

/**
 * Calculates full recipe total details, converting to user's selected measuring unit
 * (grams, lbs, ounces, kg), along with multi-unit equivalents and discrete items count.
 */
export function calculateRecipeTotal(
  recipeOrIngredients:
    | { ingredients: Ingredient[]; batchYieldQuantity?: number; batchYieldUnit?: string }
    | Ingredient[],
  targetUnit: WeightUnit = 'g',
  decimalPlaces?: number
): RecipeTotalSummary {
  const ingredients = Array.isArray(recipeOrIngredients)
    ? recipeOrIngredients
    : recipeOrIngredients.ingredients || [];

  const batchYieldQuantity = !Array.isArray(recipeOrIngredients)
    ? recipeOrIngredients.batchYieldQuantity
    : undefined;
  const batchYieldUnit = !Array.isArray(recipeOrIngredients)
    ? recipeOrIngredients.batchYieldUnit
    : undefined;

  let totalWeightGrams = 0;
  const discreteItems: { name: string; quantity: number; unit: string }[] = [];

  for (const ing of ingredients) {
    const qty =
      typeof ing.quantity === 'number'
        ? ing.quantity
        : parseFloat(String(ing.quantity) || '0');
    if (!qty || isNaN(qty) || qty <= 0) continue;

    const density = ing.densityGramsPerMl || (isVolumeUnit(ing.unit) ? 1.0 : undefined);
    const weightGrams = tryConvertToWeight(qty, ing.unit, 'g', density);

    if (weightGrams !== null) {
      totalWeightGrams += weightGrams;
    } else {
      discreteItems.push({
        name: ing.name || 'Item',
        quantity: qty,
        unit: ing.unit || 'units',
      });
    }
  }

  const totalWeightTargetUnit = fromGrams(totalWeightGrams, targetUnit);
  const formattedTargetUnit = formatQuantity(totalWeightTargetUnit, decimalPlaces);

  const equivalents = {
    g: {
      value: totalWeightGrams,
      formatted: formatQuantity(totalWeightGrams, decimalPlaces ?? 0),
      label: 'g',
    },
    kg: {
      value: fromGrams(totalWeightGrams, 'kg'),
      formatted: formatQuantity(fromGrams(totalWeightGrams, 'kg'), decimalPlaces ?? 2),
      label: 'kg',
    },
    oz: {
      value: fromGrams(totalWeightGrams, 'oz'),
      formatted: formatQuantity(fromGrams(totalWeightGrams, 'oz'), decimalPlaces ?? 1),
      label: 'oz',
    },
    lb: {
      value: fromGrams(totalWeightGrams, 'lb'),
      formatted: formatQuantity(fromGrams(totalWeightGrams, 'lb'), decimalPlaces ?? 2),
      label: 'lb',
    },
  };

  let perPieceWeight: RecipeTotalSummary['perPieceWeight'] | undefined = undefined;
  if (batchYieldQuantity && batchYieldQuantity > 0 && totalWeightGrams > 0) {
    const pieceGrams = totalWeightGrams / batchYieldQuantity;
    const pieceInTarget = fromGrams(pieceGrams, targetUnit);
    perPieceWeight = {
      value: pieceInTarget,
      formatted: formatQuantity(pieceInTarget, decimalPlaces),
      unit: targetUnit,
      yieldUnit: batchYieldUnit || 'piece',
    };
  }

  return {
    totalWeightGrams,
    totalWeightTargetUnit,
    targetUnit,
    formattedTargetUnit,
    equivalents,
    discreteItems,
    discreteCount: discreteItems.length,
    totalItemsCount: ingredients.length,
    perPieceWeight,
  };
}

/**
 * Calculates base total weight of a recipe in grams by summing all weight ingredients
 * and volume ingredients with density.
 */
export function calculateRecipeBaseWeightGrams(recipe: Recipe): number {
  let totalGrams = 0;
  for (const ing of recipe.ingredients) {
    const density = ing.densityGramsPerMl || (isVolumeUnit(ing.unit) ? 1.0 : undefined);
    const weightInGrams = tryConvertToWeight(ing.quantity, ing.unit, 'g', density);
    if (weightInGrams !== null) {
      totalGrams += weightInGrams;
    }
  }
  return totalGrams;
}

/**
 * Perform production calculation for a recipe with multiple requirement items,
 * optional mixer, waste overrides, and business default display unit.
 */
export function calculateProduction(
  recipe: Recipe,
  requirements: ProductionItemRequirement[],
  options: {
    overrideWastePercent?: number; // Temporary waste percentage for single calculation
    defaultWastePercent?: number;
    mixer?: Mixer;
    defaultWeightUnit?: WeightUnit;
    capacityOverridden?: boolean;
  } = {}
): CalculationResult {
  const defaultWeightUnit = options.defaultWeightUnit || 'lb';

  // 1. Calculate total target pieces and total finished weight in grams
  let totalPieces = 0;
  let totalFinishedWeightGrams = 0;

  for (const req of requirements) {
    const itemPieces = req.quantity * req.piecesPerUnit;
    totalPieces += itemPieces;
    const itemWeightGrams = toGrams(req.itemWeight, req.itemWeightUnit);
    totalFinishedWeightGrams += itemPieces * itemWeightGrams;
  }

  // 2. Base recipe total weight in grams
  const baseRecipeTotalWeightGrams = calculateRecipeBaseWeightGrams(recipe);

  // 3. Determine Scaling Multiplier
  let scalingMultiplier = 1;
  if (baseRecipeTotalWeightGrams > 0 && totalFinishedWeightGrams > 0) {
    scalingMultiplier = totalFinishedWeightGrams / baseRecipeTotalWeightGrams;
  } else if (recipe.batchYieldQuantity > 0 && totalPieces > 0) {
    scalingMultiplier = totalPieces / recipe.batchYieldQuantity;
  } else if (requirements.length > 0 && requirements[0].quantity > 0) {
    scalingMultiplier = requirements[0].quantity;
  }

  // 4. Waste Percent to use
  const effectiveRecipeWaste = options.overrideWastePercent ?? recipe.defaultWastePercent ?? options.defaultWastePercent ?? 6;

  // 5. Calculate per-ingredient quantities
  let totalBatchWeightGrams = 0;

  const calculatedIngredients: CalculatedIngredient[] = recipe.ingredients.map((ing) => {
    // Scaled quantity before waste
    const scaledQuantity = ing.quantity * scalingMultiplier;

    // Waste percentage for this ingredient:
    // If a temporary waste override was provided in calculation options, it overrides recipe and ingredient default waste.
    // Otherwise, use ingredient-specific waste if defined, or fallback to recipe default waste.
    const ingredientWastePercent =
      options.overrideWastePercent !== undefined && options.overrideWastePercent !== null
        ? options.overrideWastePercent
        : (ing.wastePercent !== undefined && ing.wastePercent !== null
            ? ing.wastePercent
            : effectiveRecipeWaste);

    // Formula: Required = Base * Multiplier * (1 + Waste / 100)
    const requiredQuantity = scaledQuantity * (1 + ingredientWastePercent / 100);

    // Convert to default unit if compatible
    const convertedInDefault = tryConvertToWeight(
      requiredQuantity,
      ing.unit,
      defaultWeightUnit,
      ing.densityGramsPerMl
    );

    // Add to total batch weight if weight compatible
    const ingGrams = tryConvertToWeight(requiredQuantity, ing.unit, 'g', ing.densityGramsPerMl);
    if (ingGrams !== null) {
      totalBatchWeightGrams += ingGrams;
    }

    return {
      id: ing.id,
      name: ing.name,
      baseQuantity: ing.quantity,
      baseUnit: ing.unit,
      scaledQuantity,
      wastePercent: ingredientWastePercent,
      requiredQuantity,
      requiredUnit: ing.unit,
      convertedQuantityInDefaultUnit: convertedInDefault ?? undefined,
      defaultUnit: defaultWeightUnit,
      notes: ing.notes,
    };
  });

  // If no weight ingredients were found in calculated ingredients, fallback totalBatchWeightGrams to totalFinishedWeightGrams
  if (totalBatchWeightGrams === 0) {
    totalBatchWeightGrams = totalFinishedWeightGrams * (1 + effectiveRecipeWaste / 100);
  }

  // 6. Mixer capacity check
  let mixerMaxWeightGrams = 0;
  let isCapacityExceeded = false;
  let suggestedBatches = 1;

  if (options.mixer) {
    mixerMaxWeightGrams = toGrams(options.mixer.maxWeight, options.mixer.weightUnit);
    if (totalBatchWeightGrams > mixerMaxWeightGrams && mixerMaxWeightGrams > 0) {
      isCapacityExceeded = true;
      suggestedBatches = Math.ceil(totalBatchWeightGrams / mixerMaxWeightGrams);
    }
  }

  // Calculate per batch amounts if split
  if (suggestedBatches > 1) {
    calculatedIngredients.forEach((ci) => {
      ci.perBatchQuantity = ci.requiredQuantity / suggestedBatches;
    });
  } else {
    calculatedIngredients.forEach((ci) => {
      ci.perBatchQuantity = ci.requiredQuantity;
    });
  }

  // Display batch weight in requested default unit
  const displayBatchWeight = fromGrams(totalBatchWeightGrams, defaultWeightUnit);

  return {
    recipe,
    requirements,
    totalPieces,
    totalFinishedWeightGrams,
    baseRecipeTotalWeightGrams,
    scalingMultiplier,
    recipeWastePercent: recipe.defaultWastePercent ?? 0,
    overrideWastePercent: options.overrideWastePercent,
    mixer: options.mixer,
    totalBatchWeightGrams,
    displayBatchWeight,
    displayWeightUnit: defaultWeightUnit,
    mixerMaxWeightGrams,
    isCapacityExceeded,
    capacityOverridden: !!options.capacityOverridden,
    suggestedBatches,
    calculatedIngredients,
  };
}
