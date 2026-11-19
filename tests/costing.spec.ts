import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizePurchasePackage,
  calculateIngredientCost,
  calculateRecipeCostSummary,
  calculateScaledProductionCost,
} from '../src/utils/costing';
import {
  Ingredient,
  MasterIngredient,
  PurchasePackage,
  Recipe,
  ProductionItemRequirement,
  Mixer,
} from '../src/types';
import { calculateProduction } from '../src/utils/calculator';
import {
  calculatePeanutButterJarsDetail,
  getDisplayDecimals,
  isButterIngredient,
  isPeanutButterIngredient,
} from '../src/utils/units';

describe('Phase 2.0B — Master Ingredient Foundation & Basic Recipe Costing Suite', () => {
  // 1. 50 lb flour package normalization
  it('1. Normalizes 50 lb flour package with precise costPerGram', () => {
    const pkg: PurchasePackage = {
      packQuantity: 1,
      unitSize: 50,
      unitMeasure: 'lb',
      packagePriceCents: 2450, // $24.50
    };
    const norm = normalizePurchasePackage(pkg, 'mass');
    assert.strictEqual(norm.error, undefined);
    assert(norm.normalizedPackageGrams !== undefined);
    // 50 * 453.59237 = 22679.6185 g
    assert.strictEqual(norm.normalizedPackageGrams, 22679.6185);
    assert(norm.costPerGram !== undefined);
    // 24.50 / 22679.6185 = ~0.00108026499...
    const expected = 24.5 / 22679.6185;
    assert.strictEqual(Math.abs(norm.costPerGram - expected) < 1e-10, true);
    // Precision test: should preserve at least 8 decimal places
    const strVal = norm.costPerGram.toFixed(7);
    assert.strictEqual(strVal, '0.0010803');
    assert.strictEqual(norm.costPerGram > 0.0010802 && norm.costPerGram < 0.0010803, true);
  });

  // 2. 6 × 5 lb multi-pack
  it('2. Normalizes 6 × 5 lb multi-pack correctly', () => {
    const pkg: PurchasePackage = {
      packQuantity: 6,
      unitSize: 5,
      unitMeasure: 'lb',
      packagePriceCents: 6000, // $60.00
    };
    const norm = normalizePurchasePackage(pkg, 'mass');
    assert.strictEqual(norm.error, undefined);
    // 30 lb = 13607.7711 g
    assert.strictEqual(norm.normalizedPackageGrams, 30 * 453.59237);
    const expected = 60.0 / (30 * 453.59237);
    assert(norm.costPerGram !== undefined);
    assert.strictEqual(Math.abs(norm.costPerGram - expected) < 1e-10, true);
  });

  // 3. kg → grams
  it('3. Converts kg to grams accurately', () => {
    const pkg: PurchasePackage = {
      packQuantity: 1,
      unitSize: 25,
      unitMeasure: 'kg',
      packagePriceCents: 5000, // $50.00
    };
    const norm = normalizePurchasePackage(pkg, 'mass');
    assert.strictEqual(norm.error, undefined);
    assert.strictEqual(norm.normalizedPackageGrams, 25000);
    assert.strictEqual(norm.costPerGram, 0.002);
  });

  // 4. oz → grams
  it('4. Converts oz to grams accurately', () => {
    const pkg: PurchasePackage = {
      packQuantity: 1,
      unitSize: 16,
      unitMeasure: 'oz',
      packagePriceCents: 800, // $8.00
    };
    const norm = normalizePurchasePackage(pkg, 'mass');
    assert.strictEqual(norm.error, undefined);
    assert.strictEqual(norm.normalizedPackageGrams, 16 * 28.349523125);
    const expected = 8.0 / (16 * 28.349523125);
    assert(norm.costPerGram !== undefined);
    assert.strictEqual(Math.abs(norm.costPerGram - expected) < 1e-10, true);
  });

  // 5. lb → grams
  it('5. Converts lb to grams accurately', () => {
    const pkg: PurchasePackage = {
      packQuantity: 2,
      unitSize: 10,
      unitMeasure: 'lb',
      packagePriceCents: 3000, // $30.00
    };
    const norm = normalizePurchasePackage(pkg, 'mass');
    assert.strictEqual(norm.error, undefined);
    assert.strictEqual(norm.normalizedPackageGrams, 20 * 453.59237);
    const expected = 30.0 / (20 * 453.59237);
    assert(norm.costPerGram !== undefined);
    assert.strictEqual(Math.abs(norm.costPerGram - expected) < 1e-10, true);
  });

  // 6. volume + valid density
  it('6. Costs volume ingredient when density is explicitly provided', () => {
    const master: MasterIngredient = {
      id: 'mi-vanilla',
      name: 'Pure Vanilla Extract',
      costPerGram: 0.04, // $0.04/g
      densityGramsPerMl: 0.95, // 0.95 g/ml
    };
    // Recipe uses 20 ml
    const ing: Ingredient = {
      id: 'ing-1',
      name: 'Vanilla Extract',
      quantity: 20,
      unit: 'ml',
      masterIngredientId: 'mi-vanilla',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, true);
    // 20 ml * 0.95 g/ml = 19 g. 19 g * $0.04 = $0.76
    assert.strictEqual(Math.abs(res.cost - 0.76) < 1e-6, true);
    assert.strictEqual(res.unitCostType, 'per_gram');
  });

  // 7. volume + missing density
  it('7. Rejects volume costing with MISSING_DENSITY when density is absent and NEVER defaults to 1.0', () => {
    const master: MasterIngredient = {
      id: 'mi-molasses',
      name: 'Blackstrap Molasses',
      costPerGram: 0.008,
      // density omitted!
    };
    const ing: Ingredient = {
      id: 'ing-2',
      name: 'Blackstrap Molasses',
      quantity: 100,
      unit: 'ml',
      masterIngredientId: 'mi-molasses',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, false);
    assert.strictEqual(res.reason, 'MISSING_DENSITY');
    assert.strictEqual(res.cost, 0);
    assert(res.message?.includes('Density'));
  });

  // 8. discrete purchase costing
  it('8. Costs discrete count ingredients from package purchase accurately', () => {
    const pkg: PurchasePackage = {
      packQuantity: 15,
      unitSize: 1,
      unitMeasure: 'doz',
      packagePriceCents: 4500, // $45.00 for 15 dozen = 180 eggs
    };
    const norm = normalizePurchasePackage(pkg, 'discrete');
    assert.strictEqual(norm.error, undefined);
    assert.strictEqual(norm.totalUnitsCount, 180);
    assert.strictEqual(norm.costPerEach, 0.25);

    const master: MasterIngredient = {
      id: 'mi-eggs',
      name: 'Large Shell Eggs',
      costPerEach: norm.costPerEach,
    };
    const ing: Ingredient = {
      id: 'ing-3',
      name: 'Eggs',
      quantity: 16,
      unit: 'eggs',
      masterIngredientId: 'mi-eggs',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, true);
    assert.strictEqual(res.cost, 4.0); // 16 * 0.25 = $4.00
    assert.strictEqual(res.unitCostType, 'per_each');
  });

  // 9. discrete mass conversion with explicit piece weight
  it('9. Converts discrete purchase to mass cost when pieceWeightGrams is explicitly provided', () => {
    const master: MasterIngredient = {
      id: 'mi-eggs-mass',
      name: 'Large Shell Eggs',
      costPerEach: 0.25,
      pieceWeightGrams: 50, // Explicitly user-confirmed 50g per egg
    };
    // Recipe asks for 500g eggs
    const ing: Ingredient = {
      id: 'ing-4',
      name: 'Eggs (liquid)',
      quantity: 500,
      unit: 'g',
      masterIngredientId: 'mi-eggs-mass',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, true);
    // 0.25 / 50 = $0.005 / g. 500g * $0.005 = $2.50
    assert.strictEqual(Math.abs(res.cost - 2.5) < 1e-6, true);
  });

  // 10. missing piece weight
  it('10. Fails safely with MISSING_PIECE_WEIGHT and never assumes 50g default', () => {
    const master: MasterIngredient = {
      id: 'mi-eggs-nopiece',
      name: 'Large Shell Eggs',
      costPerEach: 0.25,
      // pieceWeightGrams missing!
    };
    const ing: Ingredient = {
      id: 'ing-5',
      name: 'Eggs (weight)',
      quantity: 500,
      unit: 'g',
      masterIngredientId: 'mi-eggs-nopiece',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, false);
    assert.strictEqual(res.reason, 'MISSING_PIECE_WEIGHT');
    assert.strictEqual(res.cost, 0);
  });

  // 11. zero-cost ingredient
  it('11. Allows $0.00 zero-cost ingredients without treating 0 as missing data', () => {
    const master: MasterIngredient = {
      id: 'mi-water',
      name: 'Filtered Water',
      costPerGram: 0,
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 1,
        unitMeasure: 'g',
        packagePriceCents: 0,
      },
    };
    const ing: Ingredient = {
      id: 'ing-6',
      name: 'Water',
      quantity: 250,
      unit: 'g',
      masterIngredientId: 'mi-water',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, true);
    assert.strictEqual(res.cost, 0);
  });

  // 12. unlinked recipe ingredient
  it('12. Marks unlinked ingredient with UNLINKED reason without throwing', () => {
    const ing: Ingredient = {
      id: 'ing-7',
      name: 'Secret Spice Blend',
      quantity: 15,
      unit: 'g',
      // No masterIngredientId
    };
    const res = calculateIngredientCost(ing);
    assert.strictEqual(res.isComplete, false);
    assert.strictEqual(res.reason, 'UNLINKED');
    assert.strictEqual(res.cost, 0);
  });

  // 13. missing master ingredient
  it('13. Handles non-existent master ingredient reference gracefully', () => {
    const ing: Ingredient = {
      id: 'ing-8',
      name: 'Discontinued Cocoa',
      quantity: 100,
      unit: 'g',
      masterIngredientId: 'mi-ghost-id',
    };
    const res = calculateIngredientCost(ing, undefined);
    assert.strictEqual(res.isComplete, false);
    assert.strictEqual(res.reason, 'MASTER_INGREDIENT_NOT_FOUND');
  });

  // 14. unsupported custom unit
  it('14. Flags unsupported custom unit with UNSUPPORTED_UNIT', () => {
    const master: MasterIngredient = {
      id: 'mi-cinnamon',
      name: 'Ground Cinnamon',
      costPerGram: 0.03,
    };
    const ing: Ingredient = {
      id: 'ing-9',
      name: 'Ground Cinnamon',
      quantity: 2,
      unit: 'pinch', // Custom unmapped unit
      masterIngredientId: 'mi-cinnamon',
    };
    const res = calculateIngredientCost(ing, master);
    assert.strictEqual(res.isComplete, false);
    assert.strictEqual(res.reason, 'UNSUPPORTED_UNIT');
  });

  // 15. partial recipe costing
  it('15. Identifies partial recipe costing with explicit missing items breakdown', () => {
    const masters: MasterIngredient[] = [
      { id: 'mi-flour', name: 'Flour', costPerGram: 0.001 },
      { id: 'mi-sugar', name: 'Sugar', costPerGram: 0.002 },
    ];
    const ingredients: Ingredient[] = [
      { id: 'ing-a', name: 'Flour', quantity: 500, unit: 'g', masterIngredientId: 'mi-flour' },
      { id: 'ing-b', name: 'Sugar', quantity: 200, unit: 'g', masterIngredientId: 'mi-sugar' },
      { id: 'ing-c', name: 'Vanilla', quantity: 10, unit: 'ml' }, // Unlinked!
    ];

    const summary = calculateRecipeCostSummary(ingredients, masters);
    assert.strictEqual(summary.costComplete, false);
    assert.strictEqual(summary.costedIngredientCount, 2);
    assert.strictEqual(summary.totalIngredientCount, 3);
    assert.strictEqual(summary.missing.length, 1);
    assert.strictEqual(summary.missing[0].reason, 'UNLINKED');
    // Sum of costed: 500 * 0.001 (0.50) + 200 * 0.002 (0.40) = 0.90
    assert.strictEqual(Math.abs(summary.totalIngredientCost - 0.9) < 1e-6, true);
    assert.strictEqual(summary.costPerYieldUnit, undefined);
  });

  // 16. fully costed recipe
  it('16. Successfully completes fully costed recipe summary', () => {
    const masters: MasterIngredient[] = [
      { id: 'mi-flour', name: 'Flour', costPerGram: 0.001 },
      { id: 'mi-butter', name: 'Butter', costPerGram: 0.008 },
    ];
    const ingredients: Ingredient[] = [
      { id: 'ing-1', name: 'Flour', quantity: 1000, unit: 'g', masterIngredientId: 'mi-flour' }, // $1.00
      { id: 'ing-2', name: 'Butter', quantity: 500, unit: 'g', masterIngredientId: 'mi-butter' }, // $4.00
    ];

    const summary = calculateRecipeCostSummary(ingredients, masters, 50, 'cookies');
    assert.strictEqual(summary.costComplete, true);
    assert.strictEqual(summary.costedIngredientCount, 2);
    assert.strictEqual(summary.totalIngredientCount, 2);
    assert.strictEqual(summary.missing.length, 0);
    assert.strictEqual(Math.abs(summary.totalIngredientCost - 5.0) < 1e-6, true);
  });

  // 17. cost per yield unit
  it('17. Calculates accurate cost per yield unit only when reliable positive yield exists', () => {
    const masters: MasterIngredient[] = [
      { id: 'mi-f', name: 'Flour', costPerGram: 0.002 },
    ];
    const ingredients: Ingredient[] = [
      { id: 'ing-1', name: 'Flour', quantity: 1000, unit: 'g', masterIngredientId: 'mi-f' }, // $2.00
    ];
    // Yield 8 cookies
    const summary = calculateRecipeCostSummary(ingredients, masters, 8, 'cookies');
    assert.strictEqual(summary.costComplete, true);
    assert.strictEqual(summary.totalIngredientCost, 2.0);
    assert.strictEqual(summary.costPerYieldUnit, 0.25); // $2.00 / 8 = $0.25 / cookie
  });

  // 18. existing recipe without masterIngredientId still scales
  it('18. Existing recipe without masterIngredientId continues production scaling with 0 regression', () => {
    const legacyRecipe: Recipe = {
      id: 'rec-legacy',
      userId: 'test-user',
      name: 'Legacy Chocolate Chip',
      description: 'Pre-existing recipe without masterIngredientId',
      batchYieldQuantity: 80,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 5,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ingredients: [
        { id: 'l-1', name: 'Bread Flour', quantity: 500, unit: 'g' },
        { id: 'l-2', name: 'Butter', quantity: 250, unit: 'g' },
        { id: 'l-3', name: 'Chocolate Chips', quantity: 300, unit: 'g' },
      ],
    };

    const requirements: ProductionItemRequirement[] = [
      {
        id: 'req-1',
        presetName: 'Cases',
        quantity: 2,
        piecesPerUnit: 80,
        itemWeight: 2,
        itemWeightUnit: 'oz',
      },
    ];

    const result = calculateProduction(legacyRecipe, requirements, {
      defaultWeightUnit: 'lb',
    });

    assert(result !== null);
    assert.strictEqual(result.totalPieces, 160);
    assert.strictEqual(result.calculatedIngredients.length, 3);
    assert(result.totalBatchWeightGrams > 0);
    assert(result.displayBatchWeight > 0);
    assert.strictEqual(result.recipe.name, 'Legacy Chocolate Chip');
  });

  // 19. existing calculator regression suite
  it('19. Verifies full production calculator invariants and waste override logic', () => {
    const recipe: Recipe = {
      id: 'rec-calc',
      userId: 'test-user',
      name: 'Sugar Cookie',
      description: 'Test',
      batchYieldQuantity: 50,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 6,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ingredients: [
        { id: 'i-1', name: 'Flour', quantity: 1000, unit: 'g' },
      ],
    };

    const reqs: ProductionItemRequirement[] = [
      {
        id: 'r-1',
        presetName: 'Standard',
        quantity: 2,
        piecesPerUnit: 50,
        itemWeight: 1,
        itemWeightUnit: 'oz',
      },
    ];

    // Default waste 6%
    const resDef = calculateProduction(recipe, reqs);
    assert.strictEqual(resDef.recipeWastePercent, 6);

    // Override waste 10%
    const resOver = calculateProduction(recipe, reqs, { overrideWastePercent: 10 });
    assert.strictEqual(resOver.overrideWastePercent, 10);
    assert(resOver.totalBatchWeightGrams > resDef.totalBatchWeightGrams);
  });

  // 20. mixer capacity regression suite
  it('20. Accurately detects mixer capacity overload and suggests correct batches', () => {
    const recipe: Recipe = {
      id: 'rec-mix',
      userId: 'test-user',
      name: 'Big Batch',
      description: 'Heavy',
      batchYieldQuantity: 100,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 5,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ingredients: [
        { id: 'i-1', name: 'Flour', quantity: 20000, unit: 'g' }, // 20 kg
      ],
    };
    const reqs: ProductionItemRequirement[] = [
      { id: 'r-1', presetName: 'Run', quantity: 1, piecesPerUnit: 100, itemWeight: 7, itemWeightUnit: 'oz' },
    ];
    const smallMixer: Mixer = {
      id: 'mix-1',
      userId: 'test-user',
      name: 'Small 20-Qt',
      maxWeight: 10,
      weightUnit: 'kg',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const result = calculateProduction(recipe, reqs, { mixer: smallMixer });
    assert.strictEqual(result.isCapacityExceeded, true);
    assert(result.suggestedBatches >= 2);
  });

  // 21. peanut butter conversion regression
  it('21. Preserves commercial peanut butter jar calculation rules', () => {
    // 1928 grams -> 1 jar (1816g) + 112 grams
    const detail = calculatePeanutButterJarsDetail(1928);
    assert.strictEqual(detail.fullJars, 1);
    assert.strictEqual(detail.remainingGrams, 112);
    assert.strictEqual(detail.text, '1 jar + 112 grams');

    // 0 grams
    const empty = calculatePeanutButterJarsDetail(0);
    assert.strictEqual(empty.fullJars, 0);
    assert.strictEqual(empty.remainingGrams, 0);
    assert.strictEqual(empty.text, '0 jars');

    // Helper checks
    assert.strictEqual(isPeanutButterIngredient('Creamy Peanut Butter'), true);
    assert.strictEqual(isPeanutButterIngredient('Almond Butter'), false);
  });

  // 22. butter formatting regression
  it('22. Preserves butter display precision rules (2 decimal places)', () => {
    assert.strictEqual(isButterIngredient('Unsalted Butter'), true);
    assert.strictEqual(isButterIngredient('Brown Butter'), true);
    assert.strictEqual(isButterIngredient('Peanut Butter'), false);
    assert.strictEqual(isButterIngredient('Apple Butter'), false);

    const butterDec = getDisplayDecimals('lb', true);
    assert.strictEqual(butterDec.maxDecimals, 2);
    assert.strictEqual(butterDec.minDecimals, 2);

    const gramsDec = getDisplayDecimals('g', false);
    assert.strictEqual(gramsDec.maxDecimals, 0);
  });

  // 23. workspace isolation regression
  it('23. Scaled production cost calculation functions safely in parallel with production calculator', () => {
    const masters: MasterIngredient[] = [
      { id: 'mi-flour', name: 'Flour', costPerGram: 0.001 },
      { id: 'mi-sugar', name: 'Sugar', costPerGram: 0.002 },
    ];
    const ingredients: Ingredient[] = [
      { id: 'ing-1', name: 'Flour', quantity: 1000, unit: 'g', masterIngredientId: 'mi-flour' },
      { id: 'ing-2', name: 'Sugar', quantity: 500, unit: 'g', masterIngredientId: 'mi-sugar' },
    ];
    const recipeSummary = calculateRecipeCostSummary(ingredients, masters);
    assert.strictEqual(recipeSummary.costComplete, true);
    assert.strictEqual(recipeSummary.totalIngredientCost, 2.0); // 1.00 + 1.00 = 2.00

    // Scaling multiplier 5x
    const scaled = calculateScaledProductionCost(recipeSummary, 5);
    assert.strictEqual(scaled.isComplete, true);
    assert.strictEqual(scaled.estimatedCost, 10.0);

    // Scaling with incomplete recipe summary
    const incompleteSummary = calculateRecipeCostSummary(
      [{ id: 'ing-x', name: 'Flour', quantity: 100, unit: 'g' }], // unlinked
      masters
    );
    const incompleteScaled = calculateScaledProductionCost(incompleteSummary, 5);
    assert.strictEqual(incompleteScaled.isComplete, false);
    assert.strictEqual(incompleteScaled.estimatedCost, undefined);
    assert.strictEqual(incompleteScaled.missingCount, 1);
  });

  // Phase 2.0B.1 — Closure Patch Tests
  it('24. Production Calculator: scaled costing displays complete cost and piece unit cost when pieces > 0', () => {
    const masters: MasterIngredient[] = [
      { id: 'mi-1', name: 'Flour', costPerGram: 0.002 },
      { id: 'mi-2', name: 'Butter', costPerGram: 0.01 },
    ];
    const recipe: Recipe = {
      id: 'rec-1',
      userId: 'test-user',
      name: 'Butter Biscuit',
      description: 'Test recipe',
      batchYieldQuantity: 20,
      batchYieldUnit: 'pcs',
      defaultWastePercent: 0,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ingredients: [
        { id: 'ing-1', name: 'Flour', quantity: 500, unit: 'g', masterIngredientId: 'mi-1' },
        { id: 'ing-2', name: 'Butter', quantity: 200, unit: 'g', masterIngredientId: 'mi-2' },
      ],
    };

    const summary = calculateRecipeCostSummary(recipe.ingredients, masters);
    assert.strictEqual(summary.costComplete, true);
    // 500 * 0.002 = 1.00; 200 * 0.01 = 2.00; total = 3.00
    assert.strictEqual(summary.totalIngredientCost, 3.0);

    const scalingMultiplier = 4;
    const totalPieces = 80;
    const scaled = calculateScaledProductionCost(summary, scalingMultiplier);
    assert.strictEqual(scaled.isComplete, true);
    assert.strictEqual(scaled.estimatedCost, 12.0);

    // Derived cost per piece
    const costPerPiece = scaled.estimatedCost! / totalPieces;
    assert.strictEqual(costPerPiece, 0.15);
  });

  it('25. Production Calculator: incomplete costing lists missing count and structured reasons', () => {
    const masters: MasterIngredient[] = [
      { id: 'mi-flour', name: 'Flour', costPerGram: 0.002 },
      { id: 'mi-milk', name: 'Milk', costPerGram: 0.005 }, // volume ingredient with no density
      { id: 'mi-salt', name: 'Salt' }, // no purchase price
    ];

    const recipe: Recipe = {
      id: 'rec-incomplete',
      userId: 'test-user',
      name: 'Pancake Mix',
      description: 'Test recipe',
      batchYieldQuantity: 10,
      batchYieldUnit: 'pcs',
      defaultWastePercent: 0,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      ingredients: [
        { id: 'ing-1', name: 'Flour', quantity: 500, unit: 'g', masterIngredientId: 'mi-flour' },
        { id: 'ing-2', name: 'Milk', quantity: 2, unit: 'cup', masterIngredientId: 'mi-milk' }, // missing density
        { id: 'ing-3', name: 'Salt', quantity: 10, unit: 'g', masterIngredientId: 'mi-salt' }, // no purchase price
        { id: 'ing-4', name: 'Vanilla Extract', quantity: 1, unit: 'tsp' }, // unlinked
      ],
    };

    const summary = calculateRecipeCostSummary(recipe.ingredients, masters);
    assert.strictEqual(summary.costComplete, false);
    assert.strictEqual(summary.costedIngredientCount, 1);
    assert.strictEqual(summary.totalIngredientCount, 4);
    assert.strictEqual(summary.missing.length, 3);

    const reasons = summary.missing.map((m) => ({ name: m.ingredientName, reason: m.reason }));
    assert.deepStrictEqual(reasons, [
      { name: 'Milk', reason: 'MISSING_DENSITY' },
      { name: 'Salt', reason: 'NO_PURCHASE_PRICE' },
      { name: 'Vanilla Extract', reason: 'UNLINKED' },
    ]);

    const scaled = calculateScaledProductionCost(summary, 2.5);
    assert.strictEqual(scaled.isComplete, false);
    assert.strictEqual(scaled.estimatedCost, undefined);
    assert.strictEqual(scaled.missingCount, 3);
  });

  it('26. Recipe Save: auto-created MasterIngredient assigns ID to recipe ingredient', () => {
    const existingPantry: MasterIngredient[] = [
      { id: 'mi-sugar', name: 'White Sugar', category: 'General', defaultUnit: 'g' },
    ];

    const newIngredients: Ingredient[] = [
      { id: 'line-1', name: 'Raw Honey', quantity: 150, unit: 'g' },
    ];

    // Simulate save logic from RecipeManager.handleSubmit
    const savedPantry: MasterIngredient[] = [];
    const onSaveMasterIngredient = (m: MasterIngredient) => savedPantry.push(m);

    const newlyCreatedMasters = new Map<string, string>();
    const linked = newIngredients.map((ing) => {
      const nameClean = ing.name.trim();
      if (!nameClean) return ing;
      const lowerName = nameClean.toLowerCase();

      if (ing.masterIngredientId) return ing;

      const existingMatch = existingPantry.find(
        (m) => m.name.trim().toLowerCase() === lowerName
      );
      if (existingMatch) {
        return { ...ing, masterIngredientId: existingMatch.id };
      }

      if (newlyCreatedMasters.has(lowerName)) {
        return { ...ing, masterIngredientId: newlyCreatedMasters.get(lowerName)! };
      }

      const newMasterId = `mi-${Date.now()}-mock`;
      newlyCreatedMasters.set(lowerName, newMasterId);
      onSaveMasterIngredient({
        id: newMasterId,
        name: nameClean,
        category: 'General',
        defaultUnit: ing.unit || 'g',
        defaultWastePercent: ing.wastePercent ?? 0,
      });
      return { ...ing, masterIngredientId: newMasterId };
    });

    assert.strictEqual(savedPantry.length, 1);
    assert.strictEqual(savedPantry[0].name, 'Raw Honey');
    assert.strictEqual(linked[0].masterIngredientId, savedPantry[0].id);
    assert.strictEqual(linked[0].name, 'Raw Honey');
    assert.strictEqual(linked[0].quantity, 150);
  });

  it('27. Recipe Save: exact case-insensitive match links to existing Pantry ID without creating duplicate', () => {
    const existingPantry: MasterIngredient[] = [
      { id: 'mi-sugar-123', name: 'Granulated Sugar', category: 'General', defaultUnit: 'g' },
    ];

    const newIngredients: Ingredient[] = [
      { id: 'line-1', name: 'granulated sugar', quantity: 200, unit: 'g' },
    ];

    const savedPantry: MasterIngredient[] = [];
    const onSaveMasterIngredient = (m: MasterIngredient) => savedPantry.push(m);

    const newlyCreatedMasters = new Map<string, string>();
    const linked = newIngredients.map((ing) => {
      const nameClean = ing.name.trim();
      if (!nameClean) return ing;
      const lowerName = nameClean.toLowerCase();

      if (ing.masterIngredientId) return ing;

      const existingMatch = existingPantry.find(
        (m) => m.name.trim().toLowerCase() === lowerName
      );
      if (existingMatch) {
        return { ...ing, masterIngredientId: existingMatch.id };
      }

      if (newlyCreatedMasters.has(lowerName)) {
        return { ...ing, masterIngredientId: newlyCreatedMasters.get(lowerName)! };
      }

      const newMasterId = `mi-${Date.now()}-mock`;
      newlyCreatedMasters.set(lowerName, newMasterId);
      onSaveMasterIngredient({
        id: newMasterId,
        name: nameClean,
        category: 'General',
        defaultUnit: ing.unit || 'g',
        defaultWastePercent: ing.wastePercent ?? 0,
      });
      return { ...ing, masterIngredientId: newMasterId };
    });

    // Zero new pantry items created
    assert.strictEqual(savedPantry.length, 0);
    // Linked to existing pantry ID
    assert.strictEqual(linked[0].masterIngredientId, 'mi-sugar-123');
    // Snapshot fields intact
    assert.strictEqual(linked[0].name, 'granulated sugar');
    assert.strictEqual(linked[0].quantity, 200);
  });

  it('28. Recipe Save: preserves existing masterIngredientId and all snapshot fields', () => {
    const existingPantry: MasterIngredient[] = [
      { id: 'mi-butter', name: 'Unsalted Butter', category: 'Dairy', defaultUnit: 'lb' },
    ];

    const ingredients: Ingredient[] = [
      {
        id: 'line-butter',
        masterIngredientId: 'mi-butter',
        name: 'Unsalted Butter',
        quantity: 454,
        unit: 'g',
        notes: 'Cold cubed',
        wastePercent: 2,
        densityGramsPerMl: 0.911,
      },
    ];

    const savedPantry: MasterIngredient[] = [];
    const onSaveMasterIngredient = (m: MasterIngredient) => savedPantry.push(m);

    const newlyCreatedMasters = new Map<string, string>();
    const linked = ingredients.map((ing) => {
      const nameClean = ing.name.trim();
      if (!nameClean) return ing;
      const lowerName = nameClean.toLowerCase();

      if (ing.masterIngredientId) return ing;

      const existingMatch = existingPantry.find(
        (m) => m.name.trim().toLowerCase() === lowerName
      );
      if (existingMatch) {
        return { ...ing, masterIngredientId: existingMatch.id };
      }

      const newMasterId = `mi-${Date.now()}-mock`;
      newlyCreatedMasters.set(lowerName, newMasterId);
      onSaveMasterIngredient({
        id: newMasterId,
        name: nameClean,
        category: 'General',
        defaultUnit: ing.unit || 'g',
        defaultWastePercent: ing.wastePercent ?? 0,
      });
      return { ...ing, masterIngredientId: newMasterId };
    });

    assert.strictEqual(savedPantry.length, 0);
    assert.strictEqual(linked[0].masterIngredientId, 'mi-butter');
    assert.strictEqual(linked[0].name, 'Unsalted Butter');
    assert.strictEqual(linked[0].quantity, 454);
    assert.strictEqual(linked[0].unit, 'g');
    assert.strictEqual(linked[0].notes, 'Cold cubed');
    assert.strictEqual(linked[0].wastePercent, 2);
    assert.strictEqual(linked[0].densityGramsPerMl, 0.911);
  });
});
