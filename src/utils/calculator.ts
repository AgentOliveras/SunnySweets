import {
  Recipe,
  Ingredient,
  ProductionItemRequirement,
  ProductionPreset,
  Mixer,
  CalculationResult,
  CalculatedIngredient,
  WeightUnit,
  MasterIngredient,
  ProductionMeasurementDisplayMode,
} from '../types';
import { getTargetPresetCategoriesForRecipeCategory } from './categoryPresetMapping';
import {
  toGrams,
  fromGrams,
  tryConvertToWeight,
  convertWeight,
  isWeightUnit,
  isVolumeUnit,
  isButterIngredient,
  isPeanutButterIngredient,
  calculatePeanutButterJarsDetail,
  formatQuantity,
  GRAMS_PER_PB_JAR,
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

    const density = ing.densityGramsPerMl;
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
 * and volume ingredients with explicit density, plus discrete ingredients with pieceWeightGrams.
 * Never silently assumes water density (1.0) when density is missing!
 */
export function calculateRecipeBaseWeightGrams(
  recipe: Recipe,
  masterIngredients?: MasterIngredient[]
): number {
  const masterMap = masterIngredients ? new Map(masterIngredients.map((m) => [m.id, m])) : null;
  let totalGrams = 0;
  for (const ing of recipe.ingredients) {
    const master = masterMap && ing.masterIngredientId ? masterMap.get(ing.masterIngredientId) : undefined;
    const density = ing.densityGramsPerMl ?? master?.densityGramsPerMl;
    const weightInGrams = tryConvertToWeight(ing.quantity, ing.unit, 'g', density);
    if (weightInGrams !== null) {
      totalGrams += weightInGrams;
    } else {
      const pieceWeight = ing.pieceWeightGrams ?? master?.pieceWeightGrams;
      if (pieceWeight && pieceWeight > 0) {
        const count = typeof ing.quantity === 'number' ? ing.quantity : parseFloat(String(ing.quantity) || '0');
        if (!isNaN(count) && count > 0) {
          totalGrams += count * pieceWeight;
        }
      }
    }
  }
  return totalGrams;
}

/**
 * Perform production calculation for a recipe with multiple requirement items,
 * optional mixer, waste overrides, and business default display unit.
 */
export interface ProductionCalculationOptions {
  overrideWastePercent?: number; // Temporary waste percentage for single calculation
  defaultWastePercent?: number;
  mixer?: Mixer;
  defaultWeightUnit?: WeightUnit;
  displayMode?: ProductionMeasurementDisplayMode;
  capacityOverridden?: boolean;
  productionMode?: 'presets' | 'full_recipe' | 'full_mixer';
  mode?: 'presets' | 'full_recipe' | 'full_mixer';
  fullRecipeBatches?: number;
  fullRecipeCount?: number;
  fullMixerBatches?: number;
  useIngredientSpecificWaste?: boolean; // When true, uses isolated ingredient-level waste (decoupled from production floor)
  masterIngredients?: MasterIngredient[];
}

/**
 * Authoritative Sunny Sweets bakery-wide default production waste percentage.
 */
export const BAKERY_DEFAULT_WASTE_PERCENT = 6;

/**
 * Validates whether a value is a finite, non-negative numeric waste percentage.
 * Numbers and numeric strings >= 0 are valid (explicit 0% is strictly preserved).
 * Returns false for null, undefined, '', NaN, Infinity, negative numbers, or non-numeric types.
 */
export function isValidWastePercent(value: unknown): value is number {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return typeof num === 'number' && Number.isFinite(num) && !Number.isNaN(num) && num >= 0;
}

/**
 * Resolves effective production waste percentage according to Sunny Sweets business rules:
 * 1. Direct formulation modes ('full_recipe', 'full_mixer') => strictly 0% added waste.
 * 2. Explicit temporary calculation override, if valid (including explicit 0%).
 * 3. Explicit recipe-specific defaultWastePercent, if valid (including explicit 0%).
 * 4. Bakery-wide settings.defaultWastePercent, if valid (normally 6%).
 * 5. Documented safe application fallback (BAKERY_DEFAULT_WASTE_PERCENT = 6%).
 */
export function resolveEffectiveWastePercent(params: {
  mode?: string;
  overrideWastePercent?: unknown;
  recipeWastePercent?: unknown;
  settingsWastePercent?: unknown;
}): number {
  if (params.mode === 'full_recipe' || params.mode === 'full_mixer') {
    return 0;
  }
  if (isValidWastePercent(params.overrideWastePercent)) {
    return Number(params.overrideWastePercent);
  }
  if (isValidWastePercent(params.recipeWastePercent)) {
    return Number(params.recipeWastePercent);
  }
  if (isValidWastePercent(params.settingsWastePercent)) {
    return Number(params.settingsWastePercent);
  }
  return BAKERY_DEFAULT_WASTE_PERCENT;
}

/**
 * Authoritatively calculates production requirements for a recipe based on
 * finished-item presets, custom pieces, full recipe, or full mixer capacity with
 * optional mixer, waste overrides, and business default display unit.
 */
export function calculateProduction(
  recipe: Recipe,
  requirements: ProductionItemRequirement[],
  options: ProductionCalculationOptions = {}
): CalculationResult {
  const defaultWeightUnit = options.defaultWeightUnit || 'lb';
  const displayMode: ProductionMeasurementDisplayMode = options.displayMode || 'as_entered';
  const effectiveMode =
    options.mode ??
    options.productionMode ??
    (options.fullRecipeCount && options.fullRecipeCount > 0
      ? 'full_recipe'
      : options.fullRecipeBatches && options.fullRecipeBatches > 0
      ? 'full_recipe'
      : options.fullMixerBatches && options.fullMixerBatches > 0
      ? 'full_mixer'
      : 'presets');

  // Base recipe total weight in grams (including discrete items with configured pieceWeightGrams)
  const baseRecipeTotalWeightGrams = calculateRecipeBaseWeightGrams(recipe, options.masterIngredients);

  // Volume density warnings
  const densityWarnings: string[] = [];
  recipe.ingredients.forEach((ing) => {
    if (isVolumeUnit(ing.unit)) {
      const master = options.masterIngredients?.find((m) => m.id === ing.masterIngredientId);
      const density = ing.densityGramsPerMl ?? master?.densityGramsPerMl;
      if (!density || density <= 0) {
        densityWarnings.push(`Density required to convert ${ing.name} between volume and weight.`);
      }
    }
  });

  // 1. Calculate total target pieces and total finished weight in grams based on mode
  let totalPieces = 0;
  let totalFinishedWeightGrams = 0;
  let scalingMultiplier = 1;
  let isFullMixerMode = false;
  let fullMixerBatchesCount = 1;
  let singleMixerBatchWeightGrams = 0;
  let singleMixerBatchMultiplier = 1;

  if (effectiveMode === 'full_recipe') {
    const batches =
      options.fullRecipeCount && options.fullRecipeCount > 0
        ? options.fullRecipeCount
        : options.fullRecipeBatches && options.fullRecipeBatches > 0
        ? options.fullRecipeBatches
        : 1;
    scalingMultiplier = batches;
    totalPieces = (recipe.batchYieldQuantity || 0) * batches;
    totalFinishedWeightGrams = baseRecipeTotalWeightGrams * batches;
  } else if (effectiveMode === 'full_mixer') {
    isFullMixerMode = true;
    fullMixerBatchesCount = options.fullMixerBatches && options.fullMixerBatches > 0 ? options.fullMixerBatches : 1;
    const mixerMaxGrams = options.mixer ? toGrams(options.mixer.maxWeight, options.mixer.weightUnit) : 0;
    singleMixerBatchWeightGrams = mixerMaxGrams;
    singleMixerBatchMultiplier =
      baseRecipeTotalWeightGrams > 0 && mixerMaxGrams > 0
        ? mixerMaxGrams / baseRecipeTotalWeightGrams
        : 1;
    scalingMultiplier = singleMixerBatchMultiplier * fullMixerBatchesCount;
    totalFinishedWeightGrams = mixerMaxGrams * fullMixerBatchesCount;
    totalPieces =
      recipe.batchYieldQuantity > 0 ? Math.round(recipe.batchYieldQuantity * scalingMultiplier) : 0;
  } else {
    // Standard presets & custom requirements
    for (const req of requirements) {
      const itemPieces = req.quantity * req.piecesPerUnit;
      totalPieces += itemPieces;
      const itemWeightGrams = toGrams(req.itemWeight, req.itemWeightUnit);
      totalFinishedWeightGrams += itemPieces * itemWeightGrams;
    }

    if (baseRecipeTotalWeightGrams > 0 && totalFinishedWeightGrams > 0) {
      scalingMultiplier = totalFinishedWeightGrams / baseRecipeTotalWeightGrams;
    } else if (recipe.batchYieldQuantity > 0 && totalPieces > 0) {
      scalingMultiplier = totalPieces / recipe.batchYieldQuantity;
    } else if (requirements.length > 0 && requirements[0].quantity > 0) {
      scalingMultiplier = requirements[0].quantity;
    }
  }

  // 4. Authoritative Production Waste
  // Full Recipe and Full Mixer Capacity represent direct formulation / equipment target weight (0% added waste)
  const isDirectFormulationMode = effectiveMode === 'full_recipe' || effectiveMode === 'full_mixer';
  const productionWastePercent = resolveEffectiveWastePercent({
    mode: effectiveMode,
    overrideWastePercent: options.overrideWastePercent,
    recipeWastePercent: recipe.defaultWastePercent,
    settingsWastePercent: options.defaultWastePercent,
  });

  const wasteMultiplier = 1 + productionWastePercent / 100;

  // Authoritative gross required mix weight:
  // requiredMixWeight = finishedProductionWeight * (1 + productionWastePercent / 100)
  const authoritativeGrossMixWeightGrams = isDirectFormulationMode
    ? totalFinishedWeightGrams
    : totalFinishedWeightGrams * wasteMultiplier;

  // Proportional whole-batch scaling multiplier for required gross mix quantities
  const grossScalingMultiplier = isDirectFormulationMode
    ? scalingMultiplier
    : scalingMultiplier * wasteMultiplier;

  // 5. Calculate per-ingredient quantities
  let totalBatchWeightGrams = 0;
  let hasNonWeightIngredients = false;

  const calculatedIngredients: CalculatedIngredient[] = recipe.ingredients.map((ing) => {
    const isWeight = isWeightUnit(ing.unit);
    const isVol = isVolumeUnit(ing.unit);
    const isDiscrete = !isWeight && !isVol;

    const master = options.masterIngredients?.find((m) => m.id === ing.masterIngredientId);
    const density = ing.densityGramsPerMl ?? master?.densityGramsPerMl;
    const pieceWeight = ing.pieceWeightGrams ?? master?.pieceWeightGrams;

    // Net scaled quantity before waste (net requirement)
    const scaledQuantity = ing.quantity * scalingMultiplier;

    // Waste factor for this ingredient:
    // When options.useIngredientSpecificWaste is explicitly requested, preserve isolated ingredient waste.
    // Otherwise, whole-batch production waste is applied uniformly across all ingredients
    // to strictly preserve formulation proportions and reconcile to authoritative gross mix weight.
    const isIsolatedWaste = !!options.useIngredientSpecificWaste && ing.wastePercent !== undefined && ing.wastePercent !== null;
    const ingredientEffectiveWaste = isDirectFormulationMode
      ? 0
      : isIsolatedWaste
      ? ing.wastePercent!
      : productionWastePercent;

    // Gross required mixing quantity: Base * Multiplier * (1 + Waste / 100)
    // For uniform production waste, this strictly equals Base * grossScalingMultiplier
    const rawRequiredQuantity = isDirectFormulationMode
      ? scaledQuantity
      : isIsolatedWaste
      ? scaledQuantity * (1 + ing.wastePercent! / 100)
      : ing.quantity * grossScalingMultiplier;

    // Convert to default summary unit if compatible
    const convertedInDefault = tryConvertToWeight(
      rawRequiredQuantity,
      ing.unit,
      defaultWeightUnit,
      density
    );

    // Add to total batch weight in canonical grams
    let ingGrams = tryConvertToWeight(rawRequiredQuantity, ing.unit, 'g', density);
    if (ingGrams === null && isDiscrete && pieceWeight && pieceWeight > 0) {
      ingGrams = rawRequiredQuantity * pieceWeight;
    }

    if (ingGrams !== null) {
      totalBatchWeightGrams += ingGrams;
    } else {
      hasNonWeightIngredients = true;
    }

    // Check if ingredient represents Peanut Butter or Butter
    const isPB = isPeanutButterIngredient(ing.name, recipe.name);
    const isButter = !isPB && isButterIngredient(ing.name);
    let jarsDetail = undefined;

    if (isPB) {
      // Auto-convert peanut butter to 4-lb jars with 2 decimal points & breakdown note
      const pbGrams = ingGrams ?? toGrams(rawRequiredQuantity, isWeight ? (ing.unit as WeightUnit) : 'g');
      jarsDetail = calculatePeanutButterJarsDetail(pbGrams);
    }

    // Determine display quantity and unit based on displayMode
    let displayQuantity = rawRequiredQuantity;
    let displayUnit = ing.unit;

    if (displayMode === 'as_entered') {
      displayQuantity = rawRequiredQuantity;
      displayUnit = ing.unit;
    } else if (isWeight && isWeightUnit(displayMode)) {
      displayQuantity = convertWeight(rawRequiredQuantity, ing.unit as WeightUnit, displayMode as WeightUnit);
      displayUnit = displayMode;
    } else if (isVol && isWeightUnit(displayMode) && density && density > 0) {
      const convertedVol = tryConvertToWeight(rawRequiredQuantity, ing.unit, displayMode as WeightUnit, density);
      if (convertedVol !== null) {
        displayQuantity = convertedVol;
        displayUnit = displayMode;
      }
    }

    // Required quantity and unit (backward compatible and mode-aware)
    let finalRequiredQuantity = displayQuantity;
    let finalRequiredUnit = displayUnit;

    if (!options.displayMode) {
      // Legacy behavior when options.displayMode was not explicitly passed
      if (isPB) {
        finalRequiredQuantity = jarsDetail ? jarsDetail.jars : rawRequiredQuantity;
        finalRequiredUnit = 'jars';
      } else if (isButter) {
        const butterInLbs = tryConvertToWeight(
          rawRequiredQuantity,
          ing.unit,
          'lb',
          density ?? 0.911
        );
        if (butterInLbs !== null) {
          finalRequiredQuantity = Number(butterInLbs.toFixed(2));
          finalRequiredUnit = 'lb';
        }
      } else if (finalRequiredUnit.toLowerCase() === 'g') {
        finalRequiredQuantity = Math.round(finalRequiredQuantity);
      }
    } else {
      // Explicit displayMode is provided
      if (displayUnit.toLowerCase() === 'g') {
        finalRequiredQuantity = Math.round(finalRequiredQuantity);
      } else if (displayUnit.toLowerCase() === 'lb' || displayUnit.toLowerCase() === 'oz') {
        finalRequiredQuantity = Number(finalRequiredQuantity.toFixed(2));
      } else if (displayUnit.toLowerCase() === 'kg') {
        finalRequiredQuantity = Number(finalRequiredQuantity.toFixed(3));
      }
    }

    const densityWarning = isVol && (!density || density <= 0)
      ? `Density required to convert ${ing.name} between volume and weight.`
      : undefined;

    return {
      id: ing.id,
      name: ing.name,
      baseQuantity: ing.quantity,
      baseUnit: ing.unit,
      scaledQuantity,
      scaledUnit: ing.unit,
      wastePercent: ingredientEffectiveWaste,
      ingredientWastePercent: ing.wastePercent,
      requiredQuantity: finalRequiredQuantity,
      requiredUnit: finalRequiredUnit,
      displayQuantity,
      displayUnit,
      convertedQuantityInDefaultUnit: convertedInDefault ?? undefined,
      defaultUnit: defaultWeightUnit,
      notes: ing.notes,
      isPeanutButter: isPB,
      jarsDetail,
      pieceWeightGrams: pieceWeight,
      densityGramsPerMl: density,
      isDiscrete,
      isVolume: isVol,
      isWeight,
      densityWarning,
    };
  });

  // Reconcile totalBatchWeightGrams:
  // If no weight ingredients were found in calculated ingredients, fallback totalBatchWeightGrams to authoritative gross mix
  if (totalBatchWeightGrams === 0 && authoritativeGrossMixWeightGrams > 0) {
    totalBatchWeightGrams = authoritativeGrossMixWeightGrams;
  } else if (!hasNonWeightIngredients && !options.useIngredientSpecificWaste && authoritativeGrossMixWeightGrams > 0) {
    // When all ingredients are weight-based and waste is uniform, total batch weight reconciles
    // exactly to authoritativeGrossMixWeightGrams, eliminating any floating-point summation drift
    totalBatchWeightGrams = authoritativeGrossMixWeightGrams;
  }

  // 6. Mixer capacity check
  let mixerMaxWeightGrams = 0;
  let isCapacityExceeded = false;
  let suggestedBatches = 1;
  let discreteMixerWarning: string | undefined = undefined;

  // Check if recipe has discrete ingredients without pieceWeightGrams
  const hasDiscreteWithoutWeight = recipe.ingredients.some((ing) => {
    const isWeight = isWeightUnit(ing.unit);
    const isVol = isVolumeUnit(ing.unit);
    if (!isWeight && !isVol) {
      const master = options.masterIngredients?.find((m) => m.id === ing.masterIngredientId);
      const pieceWeight = ing.pieceWeightGrams ?? master?.pieceWeightGrams;
      return !pieceWeight || pieceWeight <= 0;
    }
    return false;
  });

  if (options.mixer) {
    mixerMaxWeightGrams = toGrams(options.mixer.maxWeight, options.mixer.weightUnit);

    if (hasDiscreteWithoutWeight && (effectiveMode === 'full_mixer' || totalBatchWeightGrams > 0)) {
      const unweightedDiscrete = recipe.ingredients.find((ing) => {
        const isWeight = isWeightUnit(ing.unit);
        const isVol = isVolumeUnit(ing.unit);
        if (!isWeight && !isVol) {
          const master = options.masterIngredients?.find((m) => m.id === ing.masterIngredientId);
          const pieceWeight = ing.pieceWeightGrams ?? master?.pieceWeightGrams;
          return !pieceWeight || pieceWeight <= 0;
        }
        return false;
      });
      discreteMixerWarning = `Full Mixer Capacity cannot be calculated reliably because ${unweightedDiscrete?.name || 'discrete ingredients'} do not have a weight equivalent configured.`;
    }

    if (isFullMixerMode) {
      suggestedBatches = fullMixerBatchesCount;
      isCapacityExceeded = false;
    } else if (totalBatchWeightGrams > mixerMaxWeightGrams && mixerMaxWeightGrams > 0) {
      isCapacityExceeded = true;
      suggestedBatches = Math.ceil(totalBatchWeightGrams / mixerMaxWeightGrams);
    }
  }

  // Calculate per batch amounts if split
  if (isFullMixerMode) {
    calculatedIngredients.forEach((ci) => {
      const isPB = !!ci.isPeanutButter;
      const isButter = !isPB && isButterIngredient(ci.name);
      const rawBatch = ci.requiredQuantity / fullMixerBatchesCount;
      ci.perBatchDisplayQuantity = ci.displayQuantity !== undefined ? ci.displayQuantity / fullMixerBatchesCount : undefined;

      if (isPB) {
        ci.perBatchQuantity = Number(rawBatch.toFixed(2));
        if (ci.jarsDetail) {
          const totalPBGrams = (ci.jarsDetail.fullJars * GRAMS_PER_PB_JAR) + ci.jarsDetail.remainingGrams;
          const perBatchGrams = totalPBGrams / fullMixerBatchesCount;
          ci.perBatchJarsDetail = calculatePeanutButterJarsDetail(perBatchGrams);
        }
      } else if (isButter && !options.displayMode) {
        ci.perBatchQuantity = Number(rawBatch.toFixed(2));
      } else if (ci.requiredUnit.toLowerCase() === 'g') {
        ci.perBatchQuantity = Math.round(rawBatch);
      } else if (ci.requiredUnit.toLowerCase() === 'lb' || ci.requiredUnit.toLowerCase() === 'oz') {
        ci.perBatchQuantity = Number(rawBatch.toFixed(2));
      } else if (ci.requiredUnit.toLowerCase() === 'kg') {
        ci.perBatchQuantity = Number(rawBatch.toFixed(3));
      } else {
        ci.perBatchQuantity = rawBatch;
      }
    });
  } else if (suggestedBatches > 1) {
    calculatedIngredients.forEach((ci) => {
      const isPB = !!ci.isPeanutButter;
      const isButter = !isPB && isButterIngredient(ci.name);
      const rawBatch = ci.requiredQuantity / suggestedBatches;
      ci.perBatchDisplayQuantity = ci.displayQuantity !== undefined ? ci.displayQuantity / suggestedBatches : undefined;

      if (isPB) {
        // Calculate per batch peanut butter in jars
        ci.perBatchQuantity = Number(rawBatch.toFixed(2));
        if (ci.jarsDetail) {
          const totalPBGrams = (ci.jarsDetail.fullJars * GRAMS_PER_PB_JAR) + ci.jarsDetail.remainingGrams;
          const perBatchGrams = totalPBGrams / suggestedBatches;
          ci.perBatchJarsDetail = calculatePeanutButterJarsDetail(perBatchGrams);
        }
      } else if (isButter && !options.displayMode) {
        ci.perBatchQuantity = Number(rawBatch.toFixed(2));
      } else if (ci.requiredUnit.toLowerCase() === 'g') {
        ci.perBatchQuantity = Math.round(rawBatch);
      } else if (ci.requiredUnit.toLowerCase() === 'lb' || ci.requiredUnit.toLowerCase() === 'oz') {
        ci.perBatchQuantity = Number(rawBatch.toFixed(2));
      } else if (ci.requiredUnit.toLowerCase() === 'kg') {
        ci.perBatchQuantity = Number(rawBatch.toFixed(3));
      } else {
        ci.perBatchQuantity = rawBatch;
      }
    });
  } else {
    calculatedIngredients.forEach((ci) => {
      ci.perBatchQuantity = ci.requiredQuantity;
      ci.perBatchDisplayQuantity = ci.displayQuantity;
      if (ci.isPeanutButter) {
        ci.perBatchJarsDetail = ci.jarsDetail;
      }
    });
  }

  // Display batch weight in requested summary unit (rounded if in grams)
  const summaryUnit =
    displayMode && isWeightUnit(displayMode) ? (displayMode as WeightUnit) : defaultWeightUnit;
  let displayBatchWeight = fromGrams(totalBatchWeightGrams, summaryUnit);
  if (summaryUnit === 'g') {
    displayBatchWeight = Math.round(displayBatchWeight);
  }

  return {
    recipe,
    requirements,
    totalPieces,
    totalFinishedWeightGrams,
    baseRecipeTotalWeightGrams,
    scalingMultiplier,
    multiplier: scalingMultiplier,
    recipeWastePercent: isDirectFormulationMode
      ? 0
      : resolveEffectiveWastePercent({
          recipeWastePercent: recipe.defaultWastePercent,
          settingsWastePercent: options.defaultWastePercent,
        }),
    overrideWastePercent: isDirectFormulationMode
      ? 0
      : isValidWastePercent(options.overrideWastePercent)
      ? Number(options.overrideWastePercent)
      : undefined,
    productionWastePercent,
    mixer: options.mixer,
    totalBatchWeightGrams,
    displayBatchWeight,
    displayWeightUnit: summaryUnit,
    displayMode,
    densityWarnings: densityWarnings.length > 0 ? densityWarnings : undefined,
    discreteMixerWarning,
    mixerMaxWeightGrams,
    isCapacityExceeded,
    capacityOverridden: !!options.capacityOverridden,
    suggestedBatches,
    calculatedIngredients,
  };
}

/**
 * Normalizes a preset's category to match bakery business domain conventions.
 * If category or recipeCategory is present and non-empty, it is trimmed and returned.
 * If empty/missing, the category is deterministically inferred from the preset name:
 * - Cookie presets ("2 oz Cookies", "3 oz Cookies", etc.) -> 'Cookies'
 * - Pie presets -> 'Pie Dough'
 * - Shortbread presets -> 'Shortbread'
 * - Bread / loaf / batard / boule / focaccia / dough / round presets -> 'Base Dough'
 * Default fallback when unspecified -> 'Cookies' (matching system standard)
 */
export function normalizePresetCategory(preset: {
  name?: string;
  category?: string;
  recipeCategory?: string;
}): string {
  if (preset.category && preset.category.trim()) {
    return preset.category.trim();
  }
  if (preset.recipeCategory && preset.recipeCategory.trim()) {
    return preset.recipeCategory.trim();
  }
  const nameLower = (preset.name || '').toLowerCase();
  if (nameLower.includes('cookie')) return 'Cookies';
  if (nameLower.includes('pie')) return 'Pie Dough';
  if (nameLower.includes('shortbread')) return 'Shortbread';
  if (
    nameLower.includes('loaf') ||
    nameLower.includes('dough') ||
    nameLower.includes('batard') ||
    nameLower.includes('boule') ||
    nameLower.includes('focaccia') ||
    nameLower.includes('round')
  ) {
    return 'Base Dough';
  }
  return 'Cookies';
}

/**
 * Authoritatively filters production presets applicable to a given recipe
 * using existing category metadata on Recipe & ProductionPreset, with support
 * for workspace categoryPresetMap mappings.
 *
 * Generic routing behavior:
 * - Cookie recipe -> Cookie presets only
 * - Shortbread recipe -> Shortbread presets only
 * - Base Dough recipe -> Base Dough presets only
 * - Biscuit / Scones recipe -> Cookie presets (via categoryPresetMap)
 * - Pie / Pastry recipe -> Pie Dough presets (via categoryPresetMap)
 * - Does NOT perform heuristic string matching on preset names.
 * - Does NOT append unrelated presets.
 */
export function getApplicablePresetsForRecipe(
  recipe: Recipe | null | undefined,
  presets: ProductionPreset[],
  categoryPresetMap?: Record<string, string | string[]> | null
): ProductionPreset[] {
  if (!recipe) return presets;

  const recipeCategory = (recipe.category || '').trim();
  if (!recipeCategory) return presets;

  // 1. Resolve target preset categories from authoritative workspace mapping or direct category match (never auto-'All')
  const targetCategories = getTargetPresetCategoriesForRecipeCategory(
    recipeCategory,
    categoryPresetMap
  );

  if (targetCategories.includes('All')) {
    return presets;
  }

  // 2. Filter presets matching target categories
  // In the application data model, presets normalize via normalizePresetCategory(p).
  const matched = presets.filter((p) => {
    const presetCat = normalizePresetCategory(p);
    return targetCategories.some(
      (tc) => tc.toLowerCase() === presetCat.toLowerCase()
    );
  });

  return matched;
}

