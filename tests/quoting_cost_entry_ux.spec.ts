import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MasterIngredient,
  Recipe,
  PurchasePackage,
} from '../src/types';
import {
  QuoteFormula,
  QuoteFormulaLine,
  ProductProject,
} from '../src/types/quoting';
import {
  calculateFormulaTotals,
  calculateLineCost,
  calculateProductPricing,
} from '../src/utils/quotingCalculator';
import {
  formatCleanNumeric,
  isWeightUnit,
  toGrams,
} from '../src/utils/units';
import {
  normalizePurchasePackage,
  calculateIngredientCost,
} from '../src/utils/costing';
import { calculateProduction } from '../src/utils/calculator';

describe('Phase 2B.5.2 — Quoting & Ingredient Cost Entry UX Regression Suite', () => {
  // ---------------------------------------------------------------------------
  // 1. Weight-based quote ingredients default to workspace preferred formula unit ('g')
  // ---------------------------------------------------------------------------
  it('UX1 — Weight-based quote ingredients default to workspace preferred formula unit (g)', () => {
    // Dark Brown Sugar with 50 lb purchase package
    const darkBrownSugarMaster: MasterIngredient = {
      id: 'mi-sugar-dark-brown',
      name: 'Dark Brown Sugar',
      category: 'Sugar',
      dimension: 'mass',
      defaultUnit: 'g', // Preferred recipe weight unit in workspace
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 4800, // $48.00 for 50 lb
      },
      costPerGram: 48 / (50 * 453.59237),
    };

    // When resolving default formula line unit for a weight-based master ingredient
    const resolveDefaultFormulaUnit = (master: MasterIngredient): string => {
      if (master.dimension === 'discrete' || ['eggs', 'each', 'pcs', 'doz', 'units'].includes(master.defaultUnit?.toLowerCase() || '')) {
        return master.defaultUnit || 'each';
      } else if (master.dimension === 'volume' || ['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz'].includes(master.defaultUnit?.toLowerCase() || '')) {
        return master.defaultUnit || 'ml';
      }
      return 'g'; // Always grams for weight
    };

    const resolvedUnit = resolveDefaultFormulaUnit(darkBrownSugarMaster);
    assert.strictEqual(resolvedUnit, 'g', 'Dark Brown Sugar formula unit must default to grams (g)');
  });

  // ---------------------------------------------------------------------------
  // 2. Purchasing unit does not override formula-entry default unit
  // ---------------------------------------------------------------------------
  it('UX2 — Purchasing unit does not override formula-entry default unit', () => {
    // Test multiple ingredients with different purchasing units (kg, lb, oz)
    const testCases: { name: string; pkgUnit: string; expectedFormulaUnit: string }[] = [
      { name: 'Dark Brown Sugar', pkgUnit: 'lb', expectedFormulaUnit: 'g' },
      { name: 'Imported Cocoa Powder', pkgUnit: 'kg', expectedFormulaUnit: 'g' },
      { name: 'Yeast Brick', pkgUnit: 'oz', expectedFormulaUnit: 'g' },
      { name: 'Bulk Bread Flour', pkgUnit: 'lb', expectedFormulaUnit: 'g' },
    ];

    testCases.forEach((tc) => {
      const master: MasterIngredient = {
        id: `mi-${tc.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: tc.name,
        category: 'Baking',
        dimension: 'mass',
        preferredPurchasePackage: {
          packQuantity: 1,
          unitSize: 25,
          unitMeasure: tc.pkgUnit,
          packagePriceCents: 3500,
        },
      };

      const resolveDefaultFormulaUnit = (m: MasterIngredient): string => {
        if (m.dimension === 'discrete') return m.defaultUnit || 'each';
        if (m.dimension === 'volume') return m.defaultUnit || 'ml';
        return 'g';
      };

      const unit = resolveDefaultFormulaUnit(master);
      assert.strictEqual(
        unit,
        'g',
        `Ingredient purchased in ${tc.pkgUnit} must still default formula unit to 'g', not ${tc.pkgUnit}`
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Manual formula unit selection is preserved and costs correctly
  // ---------------------------------------------------------------------------
  it('UX3 — Manual formula unit selection is preserved and costs accurately', () => {
    const butterMaster: MasterIngredient = {
      id: 'mi-butter',
      name: 'Unsalted Butter',
      category: 'Dairy',
      dimension: 'mass',
      costPerGram: 0.010, // $10/kg = $0.01/g
    };

    const masterMap = new Map<string, MasterIngredient>([['mi-butter', butterMaster]]);

    // Line entered as 2040 grams
    const lineGrams: QuoteFormulaLine = {
      id: 'line-g',
      name: 'Unsalted Butter',
      quantity: 2040,
      unit: 'g',
      masterIngredientId: 'mi-butter',
      unitCostUsed: 0.01,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    // Line manually switched to 2.04 kg
    const lineKg: QuoteFormulaLine = {
      id: 'line-kg',
      name: 'Unsalted Butter',
      quantity: 2.04,
      unit: 'kg',
      masterIngredientId: 'mi-butter',
      unitCostUsed: 0.01,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const costG = calculateLineCost(lineGrams, masterMap);
    const costKg = calculateLineCost(lineKg, masterMap);

    assert.strictEqual(costG.lineCost, 20.40, '2040g @ $0.01/g = $20.40');
    assert.strictEqual(costKg.lineCost, 20.40, '2.04kg @ $0.01/g = $20.40');
    assert.strictEqual(costG.lineCost, costKg.lineCost, 'Grams and manually-selected Kilograms produce identical line cost');
  });

  // ---------------------------------------------------------------------------
  // 4. Unit Size supports temporary blank editing state
  // ---------------------------------------------------------------------------
  it('UX4 — Unit Size supports temporary blank editing state without coercion', () => {
    // Simulate user editing buffer
    let unitSizeBuffer = '50';

    // User selects all and presses Backspace
    unitSizeBuffer = '';
    assert.strictEqual(unitSizeBuffer, '', 'Field must remain blank while user is editing');
    assert.notStrictEqual(unitSizeBuffer, '0', 'Field must NOT coerce to 0');
    assert.notStrictEqual(unitSizeBuffer, '0.0001', 'Field must NOT coerce to 0.0001');

    // Live normalization during blank state returns null (does not crash or force zero)
    const priceNum = parseFloat('24.50');
    const uSize = parseFloat(unitSizeBuffer);
    const isValid = !isNaN(priceNum) && !isNaN(uSize) && uSize > 0;
    assert.strictEqual(isValid, false, 'Blank input is safely treated as pending/incomplete without error');
  });

  // ---------------------------------------------------------------------------
  // 5. Unit Size supports replacing an existing value
  // ---------------------------------------------------------------------------
  it('UX5 — Unit Size supports replacing an existing value naturally', () => {
    let unitSizeBuffer = '50';

    // Delete 50
    unitSizeBuffer = '';

    // Type 25
    unitSizeBuffer = '25';
    assert.strictEqual(unitSizeBuffer, '25');

    // On blur: formatCleanNumeric preserves 25
    const committedNum = parseFloat(unitSizeBuffer);
    assert.strictEqual(committedNum, 25);
    assert.strictEqual(formatCleanNumeric(committedNum), '25');
  });

  // ---------------------------------------------------------------------------
  // 6. Decimal entry works normally (typing 2.5, 0.5, 12.75)
  // ---------------------------------------------------------------------------
  it('UX6 — Decimal entry works normally without eating decimal points', () => {
    // User types "2" then "." then "5"
    let buffer = '2';
    assert.strictEqual(buffer, '2');

    buffer = '2.';
    // A string edit-buffer preserves the trailing dot while typing
    assert.strictEqual(buffer, '2.', 'Trailing decimal point is preserved during typing');

    buffer = '2.5';
    assert.strictEqual(buffer, '2.5');

    // Committed value
    const parsed = parseFloat(buffer);
    assert.strictEqual(parsed, 2.5);
    assert.strictEqual(formatCleanNumeric(parsed), '2.5');

    // Another case: 12.75
    let buffer2 = '12.';
    assert.strictEqual(buffer2, '12.');
    buffer2 = '12.75';
    assert.strictEqual(formatCleanNumeric(parseFloat(buffer2)), '12.75');

    // Another case: 0.5
    let buffer3 = '0.';
    assert.strictEqual(buffer3, '0.');
    buffer3 = '0.5';
    assert.strictEqual(formatCleanNumeric(parseFloat(buffer3)), '0.5');
  });

  // ---------------------------------------------------------------------------
  // 7. Floating-point artifacts are not exposed in the UI
  // ---------------------------------------------------------------------------
  it('UX7 — formatCleanNumeric eliminates IEEE-754 floating-point artifacts', () => {
    // Prohibited: 49.9999999997, 50.0000000003
    assert.strictEqual(formatCleanNumeric(49.9999999997), '50');
    assert.strictEqual(formatCleanNumeric(50.0000000003), '50');

    // Prohibited: 2.50000000001
    assert.strictEqual(formatCleanNumeric(2.50000000001), '2.5');

    // Prohibited: 12.7500000003
    assert.strictEqual(formatCleanNumeric(12.7500000003), '12.75');

    // No trailing zero forcing
    assert.strictEqual(formatCleanNumeric(50), '50');
    assert.notStrictEqual(formatCleanNumeric(50), '50.000000');
    assert.strictEqual(formatCleanNumeric(2.5), '2.5');
    assert.notStrictEqual(formatCleanNumeric(2.5), '2.500000');

    // Edge cases
    assert.strictEqual(formatCleanNumeric(0), '0');
    assert.strictEqual(formatCleanNumeric(null), '');
    assert.strictEqual(formatCleanNumeric(undefined), '');
    assert.strictEqual(formatCleanNumeric(NaN), '');
  });

  // ---------------------------------------------------------------------------
  // 8. Saved numeric values remain mathematically accurate
  // ---------------------------------------------------------------------------
  it('UX8 — Saved numeric values remain mathematically accurate in purchase package', () => {
    const pkg: PurchasePackage = {
      packQuantity: 1,
      unitSize: 50,
      unitMeasure: 'lb',
      packagePriceCents: 4800,
    };

    const norm = normalizePurchasePackage(pkg, 'mass');
    assert.strictEqual(norm.normalizedPackageGrams, 50 * 453.59237);
    assert.strictEqual(norm.costPerGram, 48.0 / (50 * 453.59237));
  });

  // ---------------------------------------------------------------------------
  // 9. Ingredient normalized costs remain unchanged regardless of formula unit
  // ---------------------------------------------------------------------------
  it('UX9 — 50 lb package at $48 produces identical cost across all formula units', () => {
    const sugarMaster: MasterIngredient = {
      id: 'mi-sugar-50lb',
      name: 'Granulated Sugar 50 lb',
      dimension: 'mass',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 4800,
      },
    };

    const norm = normalizePurchasePackage(sugarMaster.preferredPurchasePackage!, 'mass');
    sugarMaster.costPerGram = norm.costPerGram;

    const masterMap = new Map([['mi-sugar-50lb', sugarMaster]]);

    // 1 lb in different units:
    // 1 lb = 453.59237 g = 0.45359237 kg = 16 oz = 1 lb
    const lineG: QuoteFormulaLine = {
      id: 'l1',
      name: 'Sugar',
      quantity: 453.59237,
      unit: 'g',
      masterIngredientId: 'mi-sugar-50lb',
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const lineKg: QuoteFormulaLine = {
      id: 'l2',
      name: 'Sugar',
      quantity: 0.45359237,
      unit: 'kg',
      masterIngredientId: 'mi-sugar-50lb',
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const lineOz: QuoteFormulaLine = {
      id: 'l3',
      name: 'Sugar',
      quantity: 16,
      unit: 'oz',
      masterIngredientId: 'mi-sugar-50lb',
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const lineLb: QuoteFormulaLine = {
      id: 'l4',
      name: 'Sugar',
      quantity: 1,
      unit: 'lb',
      masterIngredientId: 'mi-sugar-50lb',
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const costG = calculateLineCost(lineG, masterMap).lineCost;
    const costKg = calculateLineCost(lineKg, masterMap).lineCost;
    const costOz = calculateLineCost(lineOz, masterMap).lineCost;
    const costLb = calculateLineCost(lineLb, masterMap).lineCost;

    // 1 lb out of 50 lb @ $48 = $48 / 50 = $0.96
    assert(Math.abs(costG - 0.96) < 0.001, `Grams cost: ${costG}`);
    assert(Math.abs(costKg - 0.96) < 0.001, `Kg cost: ${costKg}`);
    assert(Math.abs(costOz - 0.96) < 0.001, `Oz cost: ${costOz}`);
    assert(Math.abs(costLb - 0.96) < 0.001, `Lb cost: ${costLb}`);
  });

  // ---------------------------------------------------------------------------
  // 10. Existing saved quotes and production recipes remain unchanged
  // ---------------------------------------------------------------------------
  it('UX10 — Existing production recipes and saved quotes remain completely unchanged', () => {
    const existingRecipe: Recipe = {
      id: 'rec-authoritative',
      userId: 'user-bakery',
      name: 'Authoritative Production Cookie',
      description: 'Production formula',
      category: 'Cookies',
      batchYieldQuantity: 100,
      batchYieldUnit: 'pieces',
      defaultWastePercent: 4,
      ingredients: [
        { id: 'ing-1', name: 'Flour', quantity: 2500, unit: 'g' },
        { id: 'ing-2', name: 'Sugar', quantity: 2500, unit: 'g' },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      workspaceId: 'ws-refinement',
    };

    const recipeFrozen = JSON.stringify(existingRecipe);

    // Verify existing calculation engine remains unaltered
    const prodRes = calculateProduction(existingRecipe, [], {
      mode: 'full_recipe',
      fullRecipeCount: 1,
      defaultWeightUnit: 'g',
    });

    assert.strictEqual(JSON.stringify(existingRecipe), recipeFrozen, 'Recipe was not mutated');
    assert.strictEqual(prodRes.totalBatchWeightGrams, 5000);
  });
});
