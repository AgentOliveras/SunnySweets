import {
  ProductProject,
  QuoteFormula,
  QuoteFormulaLine,
  QuoteProductConfig,
  QuoteRevision,
  TemporaryIngredientData,
  QuotePricingBasis,
} from '../types/quoting';
import { MasterIngredient, WeightUnit, Recipe } from '../types';
import { toGrams, fromGrams, isWeightUnit, tryConvertToWeight } from './units';
import { calculateIngredientCost } from './costing';

/**
 * Calculates base unit cost for a temporary R&D ingredient from packaging inputs.
 */
export function calculateTemporaryIngredientUnitCost(
  data: TemporaryIngredientData
): {
  costPerGram?: number;
  costPerEach?: number;
  unitCostType: 'per_gram' | 'per_each';
  error?: string;
} {
  const { packQuantity, unitSize, unitMeasure, packagePriceCents } = data;
  if (!packQuantity || packQuantity <= 0 || !unitSize || unitSize <= 0) {
    return { unitCostType: 'per_gram', error: 'Pack quantity and unit size must be greater than 0' };
  }
  const cleanMeasure = (unitMeasure || '').trim().toLowerCase();
  const packagePriceDollars = (packagePriceCents || 0) / 100;

  if (isWeightUnit(cleanMeasure)) {
    const gramsPerUnit = toGrams(1, cleanMeasure as WeightUnit);
    const totalGrams = packQuantity * unitSize * gramsPerUnit;
    if (totalGrams <= 0) return { unitCostType: 'per_gram', error: 'Invalid weight measure' };
    const costPerGram = packagePriceDollars / totalGrams;
    return { costPerGram, unitCostType: 'per_gram' };
  }

  // Discrete unit
  const discreteUnits = ['each', 'piece', 'pcs', 'unit', 'egg', 'eggs', 'doz', 'dozen'];
  if (discreteUnits.includes(cleanMeasure)) {
    const multiplier = cleanMeasure.startsWith('doz') ? 12 : 1;
    const totalCount = packQuantity * unitSize * multiplier;
    if (totalCount <= 0) return { unitCostType: 'per_each', error: 'Invalid item count' };
    const costPerEach = packagePriceDollars / totalCount;
    let costPerGram: number | undefined = undefined;
    if (data.pieceWeightGrams && data.pieceWeightGrams > 0) {
      costPerGram = costPerEach / data.pieceWeightGrams;
    }
    return {
      costPerEach,
      costPerGram,
      unitCostType: costPerGram !== undefined ? 'per_gram' : 'per_each',
    };
  }

  // Fallback assuming unit is grams
  const totalGrams = packQuantity * unitSize;
  const costPerGram = totalGrams > 0 ? packagePriceDollars / totalGrams : 0;
  return { costPerGram, unitCostType: 'per_gram' };
}

/**
 * Calculates the cost of a single working formula line.
 */
export function calculateLineCost(
  line: QuoteFormulaLine,
  masterIngredientMap: Map<string, MasterIngredient>
): {
  lineCost: number;
  unitCostUsed: number;
  unitCostType: 'per_gram' | 'per_each';
  isComplete: boolean;
  message?: string;
} {
  const quantity = Number(line.quantity) || 0;
  if (quantity <= 0) {
    return { lineCost: 0, unitCostUsed: 0, unitCostType: 'per_gram', isComplete: true };
  }

  // Route 1: Temporary R&D Ingredient
  if (line.isTemporary && line.temporaryData) {
    const tempCost = calculateTemporaryIngredientUnitCost(line.temporaryData);
    if (tempCost.costPerGram !== undefined) {
      const grams = tryConvertToWeight(quantity, line.unit, 'g', line.densityGramsPerMl ?? line.temporaryData.densityGramsPerMl);
      if (grams !== null) {
        const lineCost = Number((grams * tempCost.costPerGram).toFixed(4));
        return {
          lineCost,
          unitCostUsed: tempCost.costPerGram,
          unitCostType: 'per_gram',
          isComplete: true,
        };
      }
    }
    if (tempCost.costPerEach !== undefined) {
      const lineCost = Number((quantity * tempCost.costPerEach).toFixed(4));
      return {
        lineCost,
        unitCostUsed: tempCost.costPerEach,
        unitCostType: 'per_each',
        isComplete: true,
      };
    }
    return {
      lineCost: 0,
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      isComplete: false,
      message: tempCost.error || 'Temporary ingredient cost could not be determined',
    };
  }

  // Route 2: Master Ingredient Link
  if (line.masterIngredientId) {
    const master = masterIngredientMap.get(line.masterIngredientId);
    if (!master) {
      return {
        lineCost: 0,
        unitCostUsed: 0,
        unitCostType: 'per_gram',
        isComplete: false,
        message: 'Master Ingredient not found in active pantry',
      };
    }

    const costRes = calculateIngredientCost(
      {
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        densityGramsPerMl: line.densityGramsPerMl,
        masterIngredientId: line.masterIngredientId,
      },
      master
    );

    return {
      lineCost: Number(costRes.cost.toFixed(4)),
      unitCostUsed: costRes.unitCostUsed ?? 0,
      unitCostType: costRes.unitCostType ?? 'per_gram',
      isComplete: costRes.isComplete,
      message: costRes.message,
    };
  }

  // Route 3: Unlinked / Unresolved
  return {
    lineCost: 0,
    unitCostUsed: 0,
    unitCostType: 'per_gram',
    isComplete: false,
    message: 'Ingredient is unlinked with no cost data',
  };
}

/**
 * Calculates total mass, total cost, and unit costs for a working formula.
 */
export function calculateFormulaTotals(
  lines: QuoteFormulaLine[],
  masterIngredientMap: Map<string, MasterIngredient>
): QuoteFormula {
  let totalWeightGrams = 0;
  let totalCost = 0;

  const evaluatedLines: QuoteFormulaLine[] = lines.map((line) => {
    const costData = calculateLineCost(line, masterIngredientMap);
    const weightGrams = tryConvertToWeight(
      line.quantity,
      line.unit,
      'g',
      line.densityGramsPerMl ?? line.temporaryData?.densityGramsPerMl
    );

    if (weightGrams !== null) {
      totalWeightGrams += weightGrams;
    }

    totalCost += costData.lineCost;

    return {
      ...line,
      lineCost: Number(costData.lineCost.toFixed(2)),
      unitCostUsed: costData.unitCostUsed,
      unitCostType: costData.unitCostType,
    };
  });

  const totalCostRounded = Number(totalCost.toFixed(2));
  const totalWeightRounded = Number(totalWeightGrams.toFixed(2));
  const costPerGram = totalWeightRounded > 0 ? totalCostRounded / totalWeightRounded : 0;
  const weightLbs = fromGrams(totalWeightRounded, 'lb');
  const weightKg = fromGrams(totalWeightRounded, 'kg');
  const costPerLb = weightLbs > 0 ? Number((totalCostRounded / weightLbs).toFixed(2)) : 0;
  const costPerKg = weightKg > 0 ? Number((totalCostRounded / weightKg).toFixed(2)) : 0;

  return {
    totalWeightGrams: totalWeightRounded,
    totalCost: totalCostRounded,
    costPerGram: Number(costPerGram.toFixed(6)),
    costPerLb,
    costPerKg,
    lines: evaluatedLines,
  };
}

export interface ProductPricingParams {
  id?: string;
  productType?: string;
  name?: string;
  pieceWeight: number;
  weightUnit: WeightUnit;
  piecesPerCase: number;
  unitName?: string;
  packagingCost?: number | null;
  packagingLines?: { id: string; name: string; cost: number }[];
  laborCost?: number | null;
  otherCost?: number | null;
  otherLines?: { id: string; name: string; cost: number }[];
  ingredientMultiplier: number | null | undefined;
  pricingBasis?: QuotePricingBasis;
  quotedMethod?: QuotePricingBasis;
  quotedMethodValue?: number | null;
  desiredProfitPerCase?: number | null;
  quotedMultiplier?: number | null;
  quotedPrice?: number | null;
  quotedPricePerUnit?: number | null;
  formula: QuoteFormula;
}

/**
 * Authoritative Commercial Pricing Engine for Sellable Product Configurations.
 *
 * SECTION A — TARGET PRICING MODEL:
 * - Dough Weight Per Case = Pieces Per Case * Piece Weight In Grams
 * - Raw Ingredient Cost = Formula Total Cost * (Dough Weight Per Case / Formula Total Weight)
 * - Marked-Up Ingredient Component = Raw Ingredient Cost * Ingredient Multiplier (strict: raw ingredients only)
 * - Actual Production Cost (COGS) = Raw Ingredient Cost + Packaging + Labor + Other
 * - Cost Per Unit = COGS / Pieces Per Case (first-class financial metric)
 * - Calculated Target Price / Case = Marked-Up Ingredient Component + Packaging + Labor + Other
 * - Target Price / Unit = Target Price / Case / Pieces Per Case
 * - Expected Gross Profit / Case = Calculated Target Price - COGS
 * - Target Gross Margin % = (Expected Gross Profit / Calculated Target Price) * 100
 *
 * SECTION B — INTERACTIVE QUOTED PRICING (4 Mutually Exclusive Methods):
 * - Mode A: Price Per Case -> Quoted Price / Case entered directly
 * - Mode B: Price Per Unit -> Quoted Price / Case = Quoted Price / Unit * Pieces Per Case
 * - Mode C: Desired Gross Profit / Case -> Quoted Price / Case = COGS + Desired Gross Profit
 * - Mode D: Ingredients Multiplier -> Quoted Price / Case = (Raw Ingredients * Multiplier) + Packaging + Labor + Other
 *
 * Calculations from Quoted Price / Case:
 * - Quoted Price / Unit = Quoted Price / Case / Pieces Per Case
 * - Gross Profit / Case = Quoted Price / Case - COGS
 * - Gross Margin % = (Gross Profit / Quoted Price / Case) * 100
 */
export function calculateProductPricing(params: ProductPricingParams): QuoteProductConfig {
  const {
    id = `scen-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    productType = 'Cookie',
    name = '',
    pieceWeight = 0,
    weightUnit = 'oz',
    piecesPerCase = 0,
    unitName = 'case',
    formula,
    ingredientMultiplier,
    pricingBasis = 'case',
  } = params;

  // Resolve packaging cost from direct input or line items sum
  const packagingCost =
    params.packagingLines && params.packagingLines.length > 0
      ? Number(params.packagingLines.reduce((sum, item) => sum + (Number(item.cost) || 0), 0).toFixed(2))
      : params.packagingCost !== undefined && params.packagingCost !== null
        ? Number(Number(params.packagingCost).toFixed(2))
        : 0;

  // Resolve labor cost
  const laborCost =
    params.laborCost !== undefined && params.laborCost !== null
      ? Number(Number(params.laborCost).toFixed(2))
      : 0;

  // Resolve other cost from direct input or line items sum
  const otherCost =
    params.otherLines && params.otherLines.length > 0
      ? Number(params.otherLines.reduce((sum, item) => sum + (Number(item.cost) || 0), 0).toFixed(2))
      : params.otherCost !== undefined && params.otherCost !== null
        ? Number(Number(params.otherCost).toFixed(2))
        : 0;

  // Calculate dough weight per case in grams
  const pieceGrams = pieceWeight > 0 ? toGrams(pieceWeight, weightUnit) : 0;
  const doughWeightGrams = piecesPerCase > 0 && pieceGrams > 0 ? Number((piecesPerCase * pieceGrams).toFixed(2)) : 0;

  // Scale ingredient cost proportionally to formula batch size
  let rawIngredientCost = 0;
  if (formula.totalWeightGrams > 0 && formula.totalCost > 0 && doughWeightGrams > 0) {
    const caseRatio = doughWeightGrams / formula.totalWeightGrams;
    rawIngredientCost = Number((formula.totalCost * caseRatio).toFixed(2));
  }

  // Actual production cost (COGS)
  const totalProductionCost = Number(
    (rawIngredientCost + packagingCost + laborCost + otherCost).toFixed(2)
  );

  // Cost Per Unit (first-class prominent metric)
  const costPerUnit = piecesPerCase > 0 ? Number((totalProductionCost / piecesPerCase).toFixed(2)) : 0;

  // Section A — Target Pricing Model:
  // Ingredient Multiplier must be a valid positive number > 0
  const mult = Number(ingredientMultiplier);
  const isMultiplierValid = !isNaN(mult) && mult > 0;
  const isTargetPriceComplete = isMultiplierValid && piecesPerCase > 0 && pieceWeight > 0;

  // Multiplier applies strictly to ingredient cost (raw ingredients only)
  const markedUpIngredient = isMultiplierValid ? Number((rawIngredientCost * mult).toFixed(2)) : 0;

  // Target Price / Case
  const calculatedTargetPrice = isTargetPriceComplete
    ? Number((markedUpIngredient + packagingCost + laborCost + otherCost).toFixed(2))
    : 0;

  // Target Price / Unit
  const targetPricePerUnit =
    isTargetPriceComplete && piecesPerCase > 0
      ? Number((calculatedTargetPrice / piecesPerCase).toFixed(2))
      : 0;

  // Target Profitability:
  const targetDollarProfit = isTargetPriceComplete
    ? Number((calculatedTargetPrice - totalProductionCost).toFixed(2))
    : 0;
  const targetGrossMarginPercent =
    isTargetPriceComplete && calculatedTargetPrice > 0
      ? Number((((calculatedTargetPrice - totalProductionCost) / calculatedTargetPrice) * 100).toFixed(2))
      : 0;
  const targetMarkupPercent =
    isTargetPriceComplete && totalProductionCost > 0
      ? Number((((calculatedTargetPrice - totalProductionCost) / totalProductionCost) * 100).toFixed(2))
      : 0;

  // Section B — Interactive Quoted Price Model Resolution (4 Mutually Exclusive Methods)
  // Determine normalized active method
  let effectiveMethod: 'price_per_case' | 'price_per_unit' | 'desired_profit' | 'ingredients_multiplier' = 'price_per_case';
  const methodCandidate = (params.quotedMethod || params.pricingBasis || 'case').toLowerCase();
  if (methodCandidate === 'unit' || methodCandidate === 'price_per_unit') {
    effectiveMethod = 'price_per_unit';
  } else if (methodCandidate === 'profit_case' || methodCandidate === 'desired_profit') {
    effectiveMethod = 'desired_profit';
  } else if (methodCandidate === 'multiplier' || methodCandidate === 'ingredients_multiplier') {
    effectiveMethod = 'ingredients_multiplier';
  } else {
    effectiveMethod = 'price_per_case';
  }

  let finalQuotedPrice: number | null = null;
  let finalQuotedPricePerUnit: number | null = null;
  let isQuotedPriceSet = false;
  let finalQuotedMethodValue: number | null = null;
  let finalDesiredProfit: number | null = null;
  let finalQuotedMultiplier: number | null = null;

  if (effectiveMethod === 'price_per_unit') {
    const rawVal = params.quotedPricePerUnit !== undefined && params.quotedPricePerUnit !== null
      ? Number(params.quotedPricePerUnit)
      : params.quotedMethodValue !== undefined && params.quotedMethodValue !== null
        ? Number(params.quotedMethodValue)
        : null;

    if (rawVal !== null && !isNaN(rawVal) && rawVal > 0) {
      finalQuotedMethodValue = rawVal;
      finalQuotedPricePerUnit = Number(rawVal.toFixed(2));
      finalQuotedPrice = piecesPerCase > 0 ? Number((finalQuotedPricePerUnit * piecesPerCase).toFixed(2)) : 0;
      isQuotedPriceSet = true;
    }
  } else if (effectiveMethod === 'desired_profit') {
    const rawVal = params.desiredProfitPerCase !== undefined && params.desiredProfitPerCase !== null
      ? Number(params.desiredProfitPerCase)
      : params.quotedMethodValue !== undefined && params.quotedMethodValue !== null
        ? Number(params.quotedMethodValue)
        : null;

    if (rawVal !== null && !isNaN(rawVal) && rawVal >= 0) {
      finalQuotedMethodValue = rawVal;
      finalDesiredProfit = Number(rawVal.toFixed(2));
      finalQuotedPrice = Number((totalProductionCost + finalDesiredProfit).toFixed(2));
      finalQuotedPricePerUnit = piecesPerCase > 0 ? Number((finalQuotedPrice / piecesPerCase).toFixed(2)) : 0;
      isQuotedPriceSet = true;
    }
  } else if (effectiveMethod === 'ingredients_multiplier') {
    const rawVal = params.quotedMultiplier !== undefined && params.quotedMultiplier !== null
      ? Number(params.quotedMultiplier)
      : params.quotedMethodValue !== undefined && params.quotedMethodValue !== null
        ? Number(params.quotedMethodValue)
        : null;

    if (rawVal !== null && !isNaN(rawVal) && rawVal > 0) {
      finalQuotedMethodValue = rawVal;
      finalQuotedMultiplier = rawVal;
      // Multiplier applies STRICTLY to raw ingredient cost
      const markedUpRaw = Number((rawIngredientCost * rawVal).toFixed(2));
      finalQuotedPrice = Number((markedUpRaw + packagingCost + laborCost + otherCost).toFixed(2));
      finalQuotedPricePerUnit = piecesPerCase > 0 ? Number((finalQuotedPrice / piecesPerCase).toFixed(2)) : 0;
      isQuotedPriceSet = true;
    }
  } else {
    // Mode A: price_per_case (default)
    const rawVal = params.quotedPrice !== undefined && params.quotedPrice !== null
      ? Number(params.quotedPrice)
      : params.quotedMethodValue !== undefined && params.quotedMethodValue !== null
        ? Number(params.quotedMethodValue)
        : null;

    if (rawVal !== null && !isNaN(rawVal) && rawVal > 0) {
      finalQuotedMethodValue = rawVal;
      finalQuotedPrice = Number(rawVal.toFixed(2));
      finalQuotedPricePerUnit = piecesPerCase > 0 ? Number((finalQuotedPrice / piecesPerCase).toFixed(2)) : 0;
      isQuotedPriceSet = true;
    } else if (params.quotedPricePerUnit !== undefined && params.quotedPricePerUnit !== null && !isNaN(Number(params.quotedPricePerUnit)) && Number(params.quotedPricePerUnit) > 0) {
      // Compatibility fallback if unit was provided
      finalQuotedPricePerUnit = Number(Number(params.quotedPricePerUnit).toFixed(2));
      finalQuotedPrice = piecesPerCase > 0 ? Number((finalQuotedPricePerUnit * piecesPerCase).toFixed(2)) : 0;
      finalQuotedMethodValue = finalQuotedPrice;
      isQuotedPriceSet = true;
    }
  }

  // Actual Quote Profitability:
  let dollarProfit = 0;
  let grossMarginPercent = 0;
  let markupPercent = 0;
  let targetVarianceDollars = 0;
  let targetVarianceUnitDollars = 0;
  let targetVariancePercent = 0;

  if (isQuotedPriceSet && finalQuotedPrice !== null) {
    dollarProfit = Number((finalQuotedPrice - totalProductionCost).toFixed(2));
    grossMarginPercent =
      finalQuotedPrice > 0
        ? Number(((dollarProfit / finalQuotedPrice) * 100).toFixed(2))
        : 0;
    markupPercent =
      totalProductionCost > 0
        ? Number(((dollarProfit / totalProductionCost) * 100).toFixed(2))
        : 0;

    if (isTargetPriceComplete && calculatedTargetPrice > 0) {
      targetVarianceDollars = Number((finalQuotedPrice - calculatedTargetPrice).toFixed(2));
      if (finalQuotedPricePerUnit !== null) {
        targetVarianceUnitDollars = Number((finalQuotedPricePerUnit - targetPricePerUnit).toFixed(2));
      }
      targetVariancePercent = Number(
        (((finalQuotedPrice - calculatedTargetPrice) / calculatedTargetPrice) * 100).toFixed(2)
      );
    }
  }

  const unitPrice = finalQuotedPricePerUnit ?? targetPricePerUnit;

  return {
    id,
    productType,
    name: name || `${pieceWeight} ${weightUnit.toUpperCase()} (${piecesPerCase}/${unitName})`,
    pieceWeight,
    weightUnit,
    piecesPerCase,
    unitName,
    doughWeightGrams,
    rawIngredientCost,
    ingredientMultiplier: isMultiplierValid ? mult : 0,
    packagingCost,
    packagingLines: params.packagingLines,
    laborCost,
    otherCost,
    otherLines: params.otherLines,
    totalProductionCost,
    costPerUnit,
    calculatedTargetPrice,
    targetPricePerUnit,
    targetDollarProfit,
    targetGrossMarginPercent,
    targetMarkupPercent,
    isTargetPriceComplete,
    pricingBasis: effectiveMethod === 'price_per_unit' ? 'unit' : 'case',
    quotedMethod: effectiveMethod,
    quotedMethodValue: finalQuotedMethodValue,
    desiredProfitPerCase: finalDesiredProfit,
    quotedMultiplier: finalQuotedMultiplier,
    quotedPrice: finalQuotedPrice,
    quotedPricePerUnit: finalQuotedPricePerUnit,
    unitPrice,
    dollarProfit,
    grossMarginPercent,
    markupPercent,
    targetVarianceDollars,
    targetVarianceUnitDollars,
    targetVariancePercent,
    isQuotedPriceSet,
  };
}

/**
 * Recalculates all working product configurations against the latest working formula.
 *
 * Rules:
 * - Authoritative working formula drives Raw Ingredients / Case and COGS.
 * - Target selling prices, margins, profits, and cost/unit recalculate automatically.
 * - Management decisions (actual quoted prices, basis, piece weights, case counts, direct costs)
 *   are preserved.
 * - If Mode D (Ingredients Multiplier) was used, quoted price updates with new raw ingredient cost.
 * - If Mode C (Desired Gross Profit) was used, quoted price updates with new COGS + desired profit.
 * - If Mode A or B (Selling Price per Case/Unit) was used, selling price stays fixed, and profit/margin recalculate.
 * - Blank actual quoted prices remain blank (null).
 * - Historical QuoteRevision snapshots are never modified.
 */
export function recalculateProductsPricing(
  products: QuoteProductConfig[] | undefined | null,
  formula: QuoteFormula
): QuoteProductConfig[] {
  if (!products || products.length === 0) return [];

  return products.map((p) => {
    let effectiveQuotedMethodValue = p.quotedMethodValue;
    if (p.quotedMethod === 'desired_profit' && p.desiredProfitPerCase != null) {
      effectiveQuotedMethodValue = p.desiredProfitPerCase;
    } else if (p.quotedMethod === 'ingredients_multiplier' && p.quotedMultiplier != null) {
      effectiveQuotedMethodValue = p.quotedMultiplier;
    } else if (p.quotedMethod === 'price_per_unit' && p.quotedPricePerUnit != null) {
      effectiveQuotedMethodValue = p.quotedPricePerUnit;
    } else if (p.quotedPrice != null) {
      effectiveQuotedMethodValue = p.quotedPrice;
    }

    return calculateProductPricing({
      id: p.id,
      productType: p.productType,
      name: p.name,
      pieceWeight: p.pieceWeight,
      weightUnit: p.weightUnit,
      piecesPerCase: p.piecesPerCase,
      unitName: p.unitName,
      packagingCost: p.packagingCost,
      packagingLines: p.packagingLines,
      laborCost: p.laborCost,
      otherCost: p.otherCost,
      otherLines: p.otherLines,
      ingredientMultiplier: p.ingredientMultiplier,
      pricingBasis: p.pricingBasis,
      quotedMethod: p.quotedMethod,
      quotedMethodValue: effectiveQuotedMethodValue,
      desiredProfitPerCase: p.desiredProfitPerCase,
      quotedMultiplier: p.quotedMultiplier,
      quotedPrice: p.quotedPrice,
      quotedPricePerUnit: p.quotedPricePerUnit,
      formula,
    });
  });
}

/**
 * Creates an immutable QuoteRevision snapshot from the current working project state.
 */
export function createQuoteRevisionSnapshot(
  project: ProductProject,
  userUid: string,
  createdByName?: string,
  notes?: string
): QuoteRevision {
  const revisionNumber = (project.currentRevisionNumber || 0) + 1;
  const projectCode = project.projectCode || `Q-${new Date().getFullYear()}`;
  const quoteCode = `${projectCode}.V${revisionNumber}`;

  // Deep clone formula and products to ensure snapshot immutability
  const formulaSnapshot: QuoteFormula = JSON.parse(JSON.stringify(project.formula));
  const productsSnapshot: QuoteProductConfig[] = JSON.parse(JSON.stringify(project.products));

  return {
    id: `rev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    revisionNumber,
    quoteCode,
    createdAt: new Date().toISOString(),
    createdBy: userUid,
    createdByName,
    formulaSnapshot,
    productsSnapshot,
    notes,
    sourceRecipeId: project.sourceRecipeId,
    sourceRecipeName: project.sourceRecipeName,
    importedAt: project.importedAt,
    sourceVersion: project.sourceVersion,
  };
}

/**
 * Safely converts an existing production Recipe into an independent working QuoteFormula snapshot.
 *
 * Requirements:
 * - Production recipe and imported formula must NOT share mutable objects or arrays.
 * - Independent formula line IDs are generated.
 * - Ingredient names, quantities, units, and order are preserved.
 * - Pantry ingredient links (masterIngredientId) are preserved.
 * - Unlinked ingredients remain visibly unlinked.
 * - Recalculates formula using current pantry purchase package costs.
 * - Blocks with a clear descriptive error if quantities/units are invalid or cannot be represented.
 */
export function convertRecipeToQuoteFormula(
  recipe: Recipe,
  masterIngredients: MasterIngredient[]
): QuoteFormula {
  if (!recipe) {
    throw new Error('Cannot import: source recipe is undefined or null.');
  }

  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    throw new Error(`Cannot import recipe "${recipe.name || 'Untitled'}": the recipe contains no ingredients.`);
  }

  const masterMap = new Map(masterIngredients.map((m) => [m.id, m]));

  const lines: QuoteFormulaLine[] = recipe.ingredients.map((ing, index) => {
    const rawQty = ing.quantity;
    const qty = Number(rawQty);
    if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
      throw new Error(
        `Cannot import recipe "${recipe.name}": ingredient "${ing.name || `at position ${index + 1}`}" has an invalid quantity (${rawQty}). A positive numeric quantity is required.`
      );
    }

    const cleanName = (ing.name || '').trim();
    if (!cleanName) {
      throw new Error(
        `Cannot import recipe "${recipe.name}": ingredient at position ${index + 1} has no name.`
      );
    }

    const cleanUnit = (ing.unit || '').trim();
    if (!cleanUnit) {
      throw new Error(
        `Cannot import recipe "${recipe.name}": ingredient "${cleanName}" has no unit of measure.`
      );
    }

    // Determine unit cost type
    const isDiscrete = ['eggs', 'each', 'pcs', 'doz', 'units', 'piece', 'unit', 'egg'].includes(
      cleanUnit.toLowerCase()
    );

    // Deep copy and generate completely independent line ID
    const lineId = `line-imp-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`;

    // Verify if master ingredient exists in active pantry
    const linkedMaster = ing.masterIngredientId ? masterMap.get(ing.masterIngredientId) : undefined;

    const formulaLine: QuoteFormulaLine = {
      id: lineId,
      name: cleanName,
      quantity: qty,
      unit: cleanUnit,
      masterIngredientId: linkedMaster ? linkedMaster.id : ing.masterIngredientId,
      unitCostUsed: 0,
      unitCostType: isDiscrete ? 'per_each' : 'per_gram',
      lineCost: 0,
      densityGramsPerMl: ing.densityGramsPerMl ?? linkedMaster?.densityGramsPerMl,
      notes: ing.notes ? String(ing.notes) : undefined,
    };

    return formulaLine;
  });

  // Calculate totals and live costs based on pantry
  return calculateFormulaTotals(lines, masterMap);
}

/**
 * Detects whether live pantry prices have changed relative to the working project's formula lines.
 */
export function checkFormulaCostDrift(
  formula: QuoteFormula,
  masterIngredientMap: Map<string, MasterIngredient>
): {
  hasDrift: boolean;
  driftCount: number;
  currentEstimatedCost: number;
  costDifference: number;
} {
  const recalculated = calculateFormulaTotals(formula.lines, masterIngredientMap);
  const diff = Number((recalculated.totalCost - formula.totalCost).toFixed(2));
  const hasDrift = Math.abs(diff) >= 0.01;

  let driftCount = 0;
  for (let i = 0; i < formula.lines.length; i++) {
    const orig = formula.lines[i];
    const updated = recalculated.lines[i];
    if (Math.abs((orig.lineCost || 0) - (updated.lineCost || 0)) >= 0.01) {
      driftCount++;
    }
  }

  return {
    hasDrift,
    driftCount,
    currentEstimatedCost: recalculated.totalCost,
    costDifference: diff,
  };
}
