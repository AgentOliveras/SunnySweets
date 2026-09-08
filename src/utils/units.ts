import { WeightUnit, VolumeUnit, MeasurementUnit, PeanutButterJarsDetail } from '../types';

export const WEIGHT_TO_GRAMS: Record<WeightUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

export const GRAMS_PER_PB_JAR = 1816; // 4 lbs commercial jar (4 * 454g = 1816 grams, yielding 1928g -> 1 jar + 112 grams)

export const VOLUME_TO_ML: Record<VolumeUnit, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  cup: 236.5882365,
  fl_oz: 29.5735295625,
};

export const WEIGHT_UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'g', label: 'Grams (g)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'oz', label: 'Ounces (oz)' },
  { value: 'lb', label: 'Pounds (lb)' },
];

export const ALL_UNITS: { value: string; label: string; category: 'weight' | 'volume' | 'discrete' }[] = [
  { value: 'g', label: 'Grams (g)', category: 'weight' },
  { value: 'kg', label: 'Kilograms (kg)', category: 'weight' },
  { value: 'oz', label: 'Ounces (oz)', category: 'weight' },
  { value: 'lb', label: 'Pounds (lb)', category: 'weight' },
  { value: 'ml', label: 'Milliliters (ml)', category: 'volume' },
  { value: 'l', label: 'Liters (l)', category: 'volume' },
  { value: 'tsp', label: 'Teaspoons (tsp)', category: 'volume' },
  { value: 'tbsp', label: 'Tablespoons (tbsp)', category: 'volume' },
  { value: 'cup', label: 'Cups', category: 'volume' },
  { value: 'fl_oz', label: 'Fluid Ounces (fl oz)', category: 'volume' },
  { value: 'pcs', label: 'Pieces (pcs)', category: 'discrete' },
  { value: 'units', label: 'Units', category: 'discrete' },
  { value: 'eggs', label: 'Eggs', category: 'discrete' },
  { value: 'cookies', label: 'Cookies', category: 'discrete' },
  { value: 'doz', label: 'Dozens', category: 'discrete' },
];

export function isWeightUnit(unit: string): unit is WeightUnit {
  return unit in WEIGHT_TO_GRAMS;
}

export function isVolumeUnit(unit: string): unit is VolumeUnit {
  return unit in VOLUME_TO_ML;
}

/**
 * Check if ingredient name represents dairy butter (e.g. Butter, Unsalted Butter, Salted Butter, Brown Butter, etc.)
 * Excludes nut, fruit, and plant butters like Peanut Butter, Almond Butter, Apple Butter, etc.
 */
export function isButterIngredient(name?: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (/(peanut|almond|apple|cookie|sunflower|cashew|cocoa|hazelnut|soy)\s*butter/i.test(trimmed)) {
    return false;
  }
  return /\bbutter\b/i.test(trimmed);
}

/**
 * Check if an ingredient represents Peanut Butter (or if making a Peanut Butter cookie recipe).
 */
export function isPeanutButterIngredient(ingredientName?: string, recipeName?: string): boolean {
  if (!ingredientName) return false;
  const ing = ingredientName.trim();
  // Direct peanut butter check
  if (/\bpeanut\s*butter\b|\bcreamy\s*pb\b|\bcrunchy\s*pb\b|\bpeanut\s*spread\b|\bcreamy\s*peanut\s*butter\b|\bcrunchy\s*peanut\s*butter\b/i.test(ing)) {
    return true;
  }
  // Check if recipe is a peanut butter cookie recipe AND the ingredient is peanut butter/peanut paste
  if (recipeName && /\bpeanut\s*butter\b/i.test(recipeName)) {
    if (/\bpeanut\s*butter\b|\bpb\b/i.test(ing)) {
      return true;
    }
    if (/\bpeanut\b/i.test(ing) && !/\bchips\b|\bpieces\b|\bbrittle\b|\bcrunch\b|\bhalves\b|\bchopped\b/i.test(ing)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert weight in canonical grams into 4-lb jars with breakdown text.
 * Each jar is 4 lbs = 1814.36948 grams.
 * For example: 1928 grams -> 1.06 jars (1 jar + 114 g).
 */
export function calculatePeanutButterJarsDetail(totalGrams: number): PeanutButterJarsDetail {
  if (totalGrams <= 0) {
    return {
      jars: 0,
      fullJars: 0,
      remainingGrams: 0,
      text: '0 jars',
    };
  }

  const rawJars = totalGrams / GRAMS_PER_PB_JAR;
  const jars = Number(rawJars.toFixed(2));
  const fullJars = Math.floor(rawJars);
  const remainingGrams = Math.max(0, Math.round(totalGrams - fullJars * GRAMS_PER_PB_JAR));

  let text = '';
  if (fullJars > 0 && remainingGrams > 0) {
    text = `${fullJars} ${fullJars === 1 ? 'jar' : 'jars'} + ${remainingGrams} grams`;
  } else if (fullJars > 0 && remainingGrams === 0) {
    text = `${fullJars} ${fullJars === 1 ? 'jar' : 'jars'}`;
  } else {
    text = `${remainingGrams} grams`;
  }

  return {
    jars,
    fullJars,
    remainingGrams,
    text,
  };
}

/**
 * Helper to determine decimal precision for displaying ingredient amounts and totals:
 * - Butter: always 2 decimal points (in lbs).
 * - Peanut Butter: always 2 decimal points (in jars).
 * - Grams ('g'): 0 decimal points (always rounded to whole integers, no decimals).
 * - Other units: uses user settings or fallback decimals.
 */
export function getDisplayDecimals(
  unit?: string,
  isButter = false,
  customDecimals?: number,
  isPeanutButter = false
): { maxDecimals: number; minDecimals: number } {
  if (isButter || isPeanutButter) {
    return { maxDecimals: 2, minDecimals: 2 };
  }
  const normalizedUnit = (unit || '').trim().toLowerCase();
  if (normalizedUnit === 'jars' || normalizedUnit === 'jar') {
    return { maxDecimals: 2, minDecimals: 2 };
  }
  if (normalizedUnit === 'g' || normalizedUnit === 'gram' || normalizedUnit === 'grams') {
    return { maxDecimals: 0, minDecimals: 0 };
  }
  const max = customDecimals !== undefined ? customDecimals : 2;
  return { maxDecimals: max, minDecimals: 0 };
}

/**
 * Convert any value in a weight unit to canonical grams.
 */
export function toGrams(value: number, unit: WeightUnit): number {
  if (!isWeightUnit(unit)) return value;
  return value * WEIGHT_TO_GRAMS[unit];
}

/**
 * Convert canonical grams to target weight unit.
 */
export function fromGrams(grams: number, targetUnit: WeightUnit): number {
  if (!isWeightUnit(targetUnit)) return grams;
  return grams / WEIGHT_TO_GRAMS[targetUnit];
}

/**
 * Convert value between weight units cleanly.
 */
export function convertWeight(value: number, fromUnit: WeightUnit, toUnit: WeightUnit): number {
  if (fromUnit === toUnit) return value;
  const grams = toGrams(value, fromUnit);
  return fromGrams(grams, toUnit);
}

/**
 * Convert value between volume units.
 */
export function convertVolume(value: number, fromUnit: VolumeUnit, toUnit: VolumeUnit): number {
  if (fromUnit === toUnit) return value;
  const ml = value * VOLUME_TO_ML[fromUnit];
  return ml / VOLUME_TO_ML[toUnit];
}

/**
 * Try to convert an ingredient quantity to target default weight unit.
 * If volume and density is present, converts volume -> ml -> grams -> target unit.
 * If weight, converts weight -> grams -> target unit.
 * Otherwise returns null (discrete units like pieces stay discrete).
 */
export function tryConvertToWeight(
  quantity: number,
  unit: string,
  targetUnit: WeightUnit,
  densityGramsPerMl?: number
): number | null {
  if (isWeightUnit(unit)) {
    return convertWeight(quantity, unit, targetUnit);
  }
  if (isVolumeUnit(unit) && densityGramsPerMl && densityGramsPerMl > 0) {
    const ml = quantity * VOLUME_TO_ML[unit];
    const grams = ml * densityGramsPerMl;
    return fromGrams(grams, targetUnit);
  }
  return null;
}

/**
 * High precision formatting function that avoids rounding errors and trailing zeros.
 * When maxDecimals is 0, it rounds the value to the nearest whole integer with no decimal places.
 */
export function formatNumber(value: number, maxDecimals = 2, minDecimals = 0): string {
  if (value === 0) return '0';
  if (isNaN(value) || !isFinite(value)) return '0';
  
  const effectiveMax = Math.max(0, maxDecimals);
  const effectiveMin = Math.min(minDecimals, effectiveMax);

  // Use Intl.NumberFormat for locale awareness and precision
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: effectiveMin,
    maximumFractionDigits: effectiveMax,
  });
  return formatter.format(value);
}

/**
 * Convenience helper to format quantities according to decimal precision settings (or fallback maxDecimals).
 */
export function formatQuantity(value: number, decimalPlaces?: number, fallbackMax = 2): string {
  const decimals = decimalPlaces !== undefined ? decimalPlaces : fallbackMax;
  return formatNumber(value, decimals);
}

/**
 * Friendly unit label getter
 */
export function getUnitLabel(unit: string): string {
  const found = ALL_UNITS.find((u) => u.value === unit);
  return found ? found.label : unit;
}

/**
 * Converts a single ingredient to the user's preferred measuring unit if possible.
 * If the ingredient is in a weight unit (or volume unit with density/assumed density 1.0 for liquids),
 * it converts its quantity and updates its unit to targetUnit.
 */
export function standardizeIngredientToUnit(
  ingredient: { id?: string; name: string; quantity: number | string; unit: string; notes?: string; wastePercent?: number; densityGramsPerMl?: number },
  targetUnit: WeightUnit,
  decimalPlaces?: number
): any {
  const rawQty = ingredient.quantity;
  const qty = typeof rawQty === 'number'
    ? rawQty
    : parseFloat(String(rawQty) || '0');
  
  if (isNaN(qty) || qty <= 0) {
    return {
      ...ingredient,
      unit: targetUnit,
    };
  }

  // If already target unit, return as is
  if (ingredient.unit === targetUnit) {
    return ingredient;
  }

  const density = ingredient.densityGramsPerMl || (isVolumeUnit(ingredient.unit) ? 1.0 : undefined);
  const convertedQty = tryConvertToWeight(qty, ingredient.unit, targetUnit, density);

  if (convertedQty !== null) {
    const decimals = decimalPlaces !== undefined ? decimalPlaces : 3;
    const rounded = Number(convertedQty.toFixed(decimals));
    return {
      ...ingredient,
      quantity: rounded,
      unit: targetUnit,
    };
  }

  // Discrete unit or unknown unit - keep quantity, keep unit unless empty
  return {
    ...ingredient,
    unit: ingredient.unit || targetUnit,
  };
}

/**
 * Standardize an entire list of ingredients to the user's preferred measuring unit.
 */
export function standardizeIngredientsToUnit<T extends { id?: string; name: string; quantity: number | string; unit: string; notes?: string; wastePercent?: number; densityGramsPerMl?: number }>(
  ingredients: T[],
  targetUnit: WeightUnit,
  decimalPlaces?: number
): T[] {
  return ingredients.map((ing) => standardizeIngredientToUnit(ing, targetUnit, decimalPlaces));
}
