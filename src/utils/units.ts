import { WeightUnit, VolumeUnit, MeasurementUnit, PeanutButterJarsDetail, ProductionMeasurementDisplayMode } from '../types';

export const WEIGHT_TO_GRAMS: Record<WeightUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/**
 * BUSINESS-SPECIFIC PACKAGE CONVERSION:
 * Operational Peanut Butter "4 lb Jar" is fixed at 1816 g (commercial bakery packaging
 * convention based on 4 x 454g).
 *
 * NOTE: This is NOT a generic 4-lb mass conversion!
 * Generic scientific weight conversion must strictly use WEIGHT_TO_GRAMS.lb (453.59237 g/lb),
 * which yields: 4 lb = 1814.36948 g.
 *
 * Operational Peanut Butter "4 lb Jar" = 1816 g and Generic 4 lb weight = 1814.36948 g
 * are intentionally separate concepts and must NEVER substitute for one another.
 */
export const GRAMS_PER_PB_JAR = 1816;

export const VOLUME_TO_ML: Record<VolumeUnit, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  cup: 236.5882365,
  fl_oz: 29.5735295625,
  pt: 473.176473,
  qt: 946.352946,
  gal: 3785.411784,
};

export const VOLUME_UNIT_ALIASES: Record<string, VolumeUnit> = {
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  fl_oz: 'fl_oz',
  'fl oz': 'fl_oz',
  floz: 'fl_oz',
  'fluid ounce': 'fl_oz',
  'fluid ounces': 'fl_oz',
  pt: 'pt',
  pint: 'pt',
  pints: 'pt',
  qt: 'qt',
  quart: 'qt',
  quarts: 'qt',
  gal: 'gal',
  gallon: 'gal',
  gallons: 'gal',
};

export function normalizeVolumeUnit(unit: string): VolumeUnit | null {
  if (!unit) return null;
  const clean = unit.trim().toLowerCase();
  if (clean in VOLUME_UNIT_ALIASES) return VOLUME_UNIT_ALIASES[clean];
  if (clean in VOLUME_TO_ML) return clean as VolumeUnit;
  return null;
}

export const WEIGHT_UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'g', label: 'Grams (g)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'oz', label: 'Ounces (oz)' },
  { value: 'lb', label: 'Pounds (lb)' },
];

export const PRODUCTION_DISPLAY_MODES: { value: ProductionMeasurementDisplayMode; label: string; shortLabel: string }[] = [
  { value: 'as_entered', label: 'As Entered', shortLabel: 'As Entered' },
  { value: 'g', label: 'Grams (g)', shortLabel: 'g' },
  { value: 'kg', label: 'Kilograms (kg)', shortLabel: 'kg' },
  { value: 'oz', label: 'Ounces (oz)', shortLabel: 'oz' },
  { value: 'lb', label: 'Pounds (lb)', shortLabel: 'lb' },
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
  { value: 'pt', label: 'Pints (pt)', category: 'volume' },
  { value: 'qt', label: 'Quarts (qt)', category: 'volume' },
  { value: 'gal', label: 'Gallons (gal)', category: 'volume' },
  { value: 'pcs', label: 'Pieces (pcs)', category: 'discrete' },
  { value: 'units', label: 'Units', category: 'discrete' },
  { value: 'eggs', label: 'Eggs', category: 'discrete' },
  { value: 'cookies', label: 'Cookies', category: 'discrete' },
  { value: 'doz', label: 'Dozens', category: 'discrete' },
];

export function isWeightUnit(unit: string): unit is WeightUnit {
  if (!unit) return false;
  return (unit.trim().toLowerCase()) in WEIGHT_TO_GRAMS;
}

export function isVolumeUnit(unit: string): unit is VolumeUnit {
  return normalizeVolumeUnit(unit) !== null;
}

/**
 * Formats a numeric value for clean human-readable input display without IEEE-754 floating-point artifacts.
 * Strips unnecessary trailing zeros and eliminates noise like 49.9999999997 or 50.0000000003.
 * Examples:
 *   50 -> "50"
 *   49.9999999997 -> "50"
 *   2.50000000001 -> "2.5"
 *   12.7500000003 -> "12.75"
 */
export function formatCleanNumeric(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '';
  const rounded = parseFloat(Number(val).toPrecision(10));
  return String(rounded);
}

/**
 * Check if ingredient name represents dairy butter (e.g. Butter, Unsalted Butter, Salted Butter, Brown Butter, etc.)
 * Excludes nut, fruit, and plant butters like Peanut Butter, Almond Butter, Apple Butter, etc.
 * Checks both authoritative ingredient name and category metadata if available.
 */
export function isButterIngredient(name?: string, category?: string): boolean {
  // If category indicates nut or seed or plant butters, it's not dairy butter
  if (category && /(nut\s*butter|seed\s*butter|fruit\s*butter)/i.test(category)) {
    return false;
  }
  if (!name) return false;
  const trimmed = name.trim();
  // Exclude nut, fruit, and plant butters
  if (/(peanut|almond|apple|cookie|sunflower|cashew|cocoa|hazelnut|soy|seed|shea)\s*butter/i.test(trimmed)) {
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
 * - Grams ('g'): ALWAYS 0 decimal points (rounded to whole integers, no decimals), even when switching butter to grams.
 * - Butter & ingredients in 'lb': always exactly 2 decimal points (minDecimals: 2, maxDecimals: 2, e.g. 11.00 lb, 7.00 lb, 3.50 lb).
 * - Peanut Butter in 'jars': always 2 decimal points.
 * - Other units: uses user settings or fallback decimals with minDecimals 0.
 */
export function getDisplayDecimals(
  unit?: string,
  isButter = false,
  customDecimals?: number,
  isPeanutButter = false
): { maxDecimals: number; minDecimals: number } {
  const normalizedUnit = (unit || '').trim().toLowerCase();

  // Grams are ALWAYS formatted as whole integers (0 decimals), even for butter when switched to grams
  if (normalizedUnit === 'g' || normalizedUnit === 'gram' || normalizedUnit === 'grams') {
    return { maxDecimals: 0, minDecimals: 0 };
  }

  // Peanut butter in jars: always 2 decimals
  if (isPeanutButter || normalizedUnit === 'jars' || normalizedUnit === 'jar') {
    return { maxDecimals: 2, minDecimals: 2 };
  }

  // Butter or any ingredient displayed in pounds (lb): always exactly 2 decimals (e.g. 11.00 lb, 7.00 lb, 3.50 lb)
  if (normalizedUnit === 'lb' || normalizedUnit === 'lbs') {
    return { maxDecimals: 2, minDecimals: 2 };
  }

  // Butter in general: 2 decimals
  if (isButter) {
    return { maxDecimals: 2, minDecimals: 2 };
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
export function convertVolume(value: number, fromUnit: string, toUnit: string): number {
  const normFrom = normalizeVolumeUnit(fromUnit);
  const normTo = normalizeVolumeUnit(toUnit);
  if (!normFrom || !normTo) return value;
  if (normFrom === normTo) return value;
  const ml = value * VOLUME_TO_ML[normFrom];
  return ml / VOLUME_TO_ML[normTo];
}

/**
 * Try to convert an ingredient quantity to target default weight unit.
 * If volume and explicit density is present (> 0), converts volume -> ml -> grams -> target unit.
 * If weight, converts weight -> grams -> target unit.
 * NEVER defaults density to 1.0! Returns null if density is missing.
 * Discrete units like pieces stay discrete (returns null).
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
  const normVol = normalizeVolumeUnit(unit);
  if (normVol && densityGramsPerMl && densityGramsPerMl > 0) {
    const ml = quantity * VOLUME_TO_ML[normVol];
    const grams = ml * densityGramsPerMl;
    return fromGrams(grams, targetUnit);
  }
  return null;
}

/**
 * Transforms an ingredient's quantity and unit according to the selected ProductionMeasurementDisplayMode.
 * - 'as_entered': preserves original unit and quantity.
 * - 'g' | 'kg' | 'oz' | 'lb': converts compatible weight units to the requested unit.
 *   Non-weight units (discrete count or volume without density) remain in their original units.
 */
export function convertIngredientForDisplay(
  quantity: number,
  unit: string,
  displayMode: ProductionMeasurementDisplayMode = 'as_entered',
  densityGramsPerMl?: number
): { quantity: number; unit: string; wasConverted: boolean } {
  if (displayMode === 'as_entered' || !displayMode) {
    return { quantity, unit, wasConverted: false };
  }

  // Weight unit conversion
  if (isWeightUnit(unit) && isWeightUnit(displayMode)) {
    const converted = convertWeight(quantity, unit as WeightUnit, displayMode as WeightUnit);
    return { quantity: converted, unit: displayMode, wasConverted: true };
  }

  // Volume unit conversion only if explicit density is provided
  if (isVolumeUnit(unit) && isWeightUnit(displayMode) && densityGramsPerMl && densityGramsPerMl > 0) {
    const converted = tryConvertToWeight(quantity, unit, displayMode as WeightUnit, densityGramsPerMl);
    if (converted !== null) {
      return { quantity: converted, unit: displayMode, wasConverted: true };
    }
  }

  // Discrete items or volume without density remain in original unit
  return { quantity, unit, wasConverted: false };
}

/**
 * High precision formatting function that avoids rounding errors and trailing zeros.
 * When maxDecimals is 0, it rounds the value to the nearest whole integer with no decimal places.
 */
export function formatNumber(value: number, maxDecimals = 2, minDecimals = 0): string {
  if (isNaN(value) || !isFinite(value)) return '0';
  
  const effectiveMax = Math.max(0, maxDecimals);
  const effectiveMin = Math.min(minDecimals, effectiveMax);

  if (value === 0 && effectiveMin === 0) return '0';

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
 * If the ingredient is in a weight unit (or volume unit with explicit density),
 * it converts its quantity and updates its unit to targetUnit.
 * Never guesses density for volume units!
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

  const density = ingredient.densityGramsPerMl;
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
