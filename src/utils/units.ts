import { WeightUnit, VolumeUnit, MeasurementUnit } from '../types';

export const WEIGHT_TO_GRAMS: Record<WeightUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

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
