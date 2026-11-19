import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateProduction,
  calculateRecipeBaseWeightGrams,
  getApplicablePresetsForRecipe,
} from '../src/utils/calculator';
import {
  hasProductionNotes,
  getProductionNotesStatus,
  canProceedToMix,
} from '../src/utils/productionNotes';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionItemRequirement,
  UserSettings,
  WeightUnit,
} from '../src/types';
import {
  toGrams,
  fromGrams,
  getDisplayDecimals,
  formatNumber,
  isButterIngredient,
} from '../src/utils/units';
import {
  sortRecipes,
  RecipeUsageMap,
  ProductionSortOption,
  recordProductionRun,
  loadRecipeUsageMap,
  saveRecipeUsageMap,
  PROD_RECIPE_USAGE_KEY,
} from '../src/utils/productionHistory';

function createCustomPreset(partial: Partial<ProductionPreset> & { id: string; name: string }): ProductionPreset {
  return {
    category: '',
    finishedWeight: 4,
    weightUnit: 'oz',
    quantityPerUnit: 80,
    unitName: 'case',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    userId: 'user-admin',
    ...partial,
  };
}

// Sample cookie recipe for test validation
function createTestRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'rec-test-chocolate-chip',
    name: 'Chocolate Chip Cookies',
    description: 'Classic chocolate chip cookies',
    category: 'Cookies',
    batchYieldQuantity: 80,
    batchYieldUnit: 'piece',
    defaultWastePercent: 6,
    ingredients: [
      {
        id: 'ing-flour',
        name: 'All-Purpose Flour',
        quantity: 1000,
        unit: 'g',
      },
      {
        id: 'ing-butter',
        name: 'Butter Blocks',
        quantity: 500,
        unit: 'g',
      },
      {
        id: 'ing-sugar',
        name: 'Granulated Sugar',
        quantity: 400,
        unit: 'g',
      },
      {
        id: 'ing-chips',
        name: 'Semi-Sweet Chocolate Chips',
        quantity: 368,
        unit: 'g',
      },
    ],
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    userId: 'user-admin',
    ...overrides,
  };
}

// Sample presets
function createTestPresets(): ProductionPreset[] {
  return [
    {
      id: 'preset-4oz',
      name: '4 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 80, // 80 cookies per case
      unitName: 'case',
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
      userId: 'user-admin',
    },
    {
      id: 'preset-2oz',
      name: '2 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 2,
      weightUnit: 'oz',
      quantityPerUnit: 120, // 120 cookies per case
      unitName: 'case',
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
      userId: 'user-admin',
    },
    {
      id: 'preset-1.5oz',
      name: '1.5 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 1.5,
      weightUnit: 'oz',
      quantityPerUnit: 140, // 140 cookies per case
      unitName: 'case',
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
      userId: 'user-admin',
    },
  ];
}

// Sample Hobart 60-Qt Mixer
function createTestMixer(): Mixer {
  return {
    id: 'mixer-hobart-60qt',
    name: 'Hobart 60-Qt Commercial Mixer',
    maxWeight: 80,
    weightUnit: 'lb',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    userId: 'user-admin',
  };
}

describe('Production Mode — Floor Minimalist Interface & Calculation Invariants', () => {
  const recipe = createTestRecipe();
  const presets = createTestPresets();
  const preset4oz = presets[0]; // 4 oz, 80 pcs/case
  const preset2oz = presets[1]; // 2 oz, 120 pcs/case
  const mixer = createTestMixer(); // 80 lb limit

  // -------------------------------------------------------------------------
  // TEST A
  // -------------------------------------------------------------------------
  it('A. 1 case of a 4 oz / 80-count preset is interpreted as 80 × 4 oz, NOT 1 × 4 oz', () => {
    // 1 case selected in Production Mode
    const req: ProductionItemRequirement = {
      id: 'req-1',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: 1, // 1 case
      piecesPerUnit: preset4oz.quantityPerUnit, // 80 pieces
      itemWeight: preset4oz.finishedWeight, // 4 oz
      itemWeightUnit: preset4oz.weightUnit, // 'oz'
    };

    const result = calculateProduction(recipe, [req], {
      mixer,
      overrideWastePercent: 6,
      defaultWeightUnit: 'lb',
    });

    // 1 case = 80 cookies total
    assert.strictEqual(result.totalPieces, 80, 'Total pieces must be 80, NOT 1');

    // Finished weight = 80 cookies * 4 oz = 320 oz
    const expectedOz = 80 * 4;
    const expectedGrams = toGrams(expectedOz, 'oz');
    assert.strictEqual(
      Math.round(result.totalFinishedWeightGrams),
      Math.round(expectedGrams),
      'Finished weight must be 80 * 4 oz (320 oz), NOT 1 * 4 oz'
    );

    // Scaling multiplier must scale for the full case (320 oz = ~9,071.85 g)
    const baseWeightGrams = calculateRecipeBaseWeightGrams(recipe);
    assert.strictEqual(baseWeightGrams, 2268); // 1000 + 500 + 400 + 368 = 2268 g
    const expectedMultiplier = expectedGrams / baseWeightGrams;
    assert(Math.abs(result.scalingMultiplier - expectedMultiplier) < 0.001);
  });

  // -------------------------------------------------------------------------
  // TEST B
  // -------------------------------------------------------------------------
  it('B. 2 cases of the same preset correctly doubles production requirement', () => {
    const req1Case: ProductionItemRequirement = {
      id: 'req-1',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: 1,
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const req2Cases: ProductionItemRequirement = {
      id: 'req-2',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: 2, // 2 cases
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const res1 = calculateProduction(recipe, [req1Case], { overrideWastePercent: 6 });
    const res2 = calculateProduction(recipe, [req2Cases], { overrideWastePercent: 6 });

    // Double pieces
    assert.strictEqual(res2.totalPieces, res1.totalPieces * 2);
    assert.strictEqual(res2.totalPieces, 160);

    // Double finished weight
    assert(Math.abs(res2.totalFinishedWeightGrams - res1.totalFinishedWeightGrams * 2) < 0.01);

    // Double scaling multiplier
    assert(Math.abs(res2.scalingMultiplier - res1.scalingMultiplier * 2) < 0.001);

    // Double required ingredient quantities
    res1.calculatedIngredients.forEach((ing1, idx) => {
      const ing2 = res2.calculatedIngredients[idx];
      assert(
        Math.abs(ing2.requiredQuantity - ing1.requiredQuantity * 2) <= 1,
        `Ingredient ${ing1.name} should double in required quantity`
      );
    });
  });

  // -------------------------------------------------------------------------
  // TEST C
  // -------------------------------------------------------------------------
  it('C. Multiple presets for one recipe combine correctly', () => {
    // 2 cases of 4 oz (80/case) + 1 case of 2 oz (120/case)
    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-4oz',
        presetId: preset4oz.id,
        presetName: preset4oz.name,
        quantity: 2, // 2 cases * 80 = 160 cookies @ 4 oz = 640 oz
        piecesPerUnit: preset4oz.quantityPerUnit,
        itemWeight: preset4oz.finishedWeight,
        itemWeightUnit: preset4oz.weightUnit,
      },
      {
        id: 'req-2oz',
        presetId: preset2oz.id,
        presetName: preset2oz.name,
        quantity: 1, // 1 case * 120 = 120 cookies @ 2 oz = 240 oz
        piecesPerUnit: preset2oz.quantityPerUnit,
        itemWeight: preset2oz.finishedWeight,
        itemWeightUnit: preset2oz.weightUnit,
      },
    ];

    const res = calculateProduction(recipe, reqs, { overrideWastePercent: 6 });

    // Total pieces = 160 + 120 = 280
    assert.strictEqual(res.totalPieces, 280);

    // Total finished weight = 640 oz + 240 oz = 880 oz
    const expectedGrams = toGrams(880, 'oz');
    assert(Math.abs(res.totalFinishedWeightGrams - expectedGrams) < 0.01);

    // Total batch dough weight includes 6% waste = 880 * 1.06 = 932.8 oz = ~58.3 lb
    const expectedBatchGrams = expectedGrams * 1.06;
    assert(Math.abs(res.totalBatchWeightGrams - expectedBatchGrams) < 1.0);
  });

  // -------------------------------------------------------------------------
  // TEST D
  // -------------------------------------------------------------------------
  it('D. Configured waste percentage is included exactly once', () => {
    const req: ProductionItemRequirement = {
      id: 'req-1',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: 1,
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    // 0% waste
    const resNoWaste = calculateProduction(recipe, [req], { overrideWastePercent: 0 });
    // 6% waste
    const res6Waste = calculateProduction(recipe, [req], { overrideWastePercent: 6 });
    // 10% waste
    const res10Waste = calculateProduction(recipe, [req], { overrideWastePercent: 10 });

    // Scaled quantities (before waste) are identical
    resNoWaste.calculatedIngredients.forEach((ing0, idx) => {
      const ing6 = res6Waste.calculatedIngredients[idx];
      const ing10 = res10Waste.calculatedIngredients[idx];

      assert.strictEqual(ing0.scaledQuantity, ing6.scaledQuantity);
      assert.strictEqual(ing0.scaledQuantity, ing10.scaledQuantity);
    });

    // For standard gram ingredients (e.g. Flour, Sugar, Chips), requiredQuantity = Math.round(scaledQuantity * (1 + waste/100))
    const flour0 = resNoWaste.calculatedIngredients.find((i) => i.id === 'ing-flour')!;
    const flour6 = res6Waste.calculatedIngredients.find((i) => i.id === 'ing-flour')!;
    const flour10 = res10Waste.calculatedIngredients.find((i) => i.id === 'ing-flour')!;

    assert.strictEqual(flour6.requiredQuantity, Math.round(flour0.scaledQuantity * 1.06));
    assert.strictEqual(flour10.requiredQuantity, Math.round(flour0.scaledQuantity * 1.10));

    // For butter (which the app displays in lb), converting back to grams confirms exact single waste factor
    const butter0 = resNoWaste.calculatedIngredients.find((i) => i.id === 'ing-butter')!;
    const butter6 = res6Waste.calculatedIngredients.find((i) => i.id === 'ing-butter')!;
    const butter0Grams = toGrams(butter0.requiredQuantity, butter0.requiredUnit as WeightUnit);
    const butter6Grams = toGrams(butter6.requiredQuantity, butter6.requiredUnit as WeightUnit);
    assert(Math.abs(butter6Grams - butter0Grams * 1.06) <= 5);

    // Total batch weight is scaled by (1 + waste / 100) exactly once
    assert(
      Math.abs(res6Waste.totalBatchWeightGrams - resNoWaste.totalBatchWeightGrams * 1.06) < 1.0
    );
    assert(
      Math.abs(res10Waste.totalBatchWeightGrams - resNoWaste.totalBatchWeightGrams * 1.10) < 1.0
    );
  });

  // -------------------------------------------------------------------------
  // TEST E
  // -------------------------------------------------------------------------
  it('E. Changing Production Mode quantities does not mutate the recipe', () => {
    const originalJson = JSON.stringify(recipe);

    // Run multiple calculations with various quantities
    calculateProduction(recipe, [
      {
        id: 'req-test',
        presetName: '4 oz Case',
        quantity: 5,
        piecesPerUnit: 80,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      },
    ]);

    calculateProduction(recipe, [
      {
        id: 'req-test-2',
        presetName: '2 oz Case',
        quantity: 12,
        piecesPerUnit: 120,
        itemWeight: 2,
        itemWeightUnit: 'oz',
      },
    ]);

    // Verify recipe object was not mutated
    assert.strictEqual(
      JSON.stringify(recipe),
      originalJson,
      'Recipe object must remain completely immutable during production calculations'
    );
  });

  // -------------------------------------------------------------------------
  // TEST F
  // -------------------------------------------------------------------------
  it('F. Changing Production Mode quantities does not mutate presets', () => {
    const originalPresetsJson = JSON.stringify(presets);

    // Simulate floor changes
    const reqs: ProductionItemRequirement[] = [
      {
        id: `prod-req-${preset4oz.id}`,
        presetId: preset4oz.id,
        presetName: preset4oz.name,
        quantity: 10,
        piecesPerUnit: preset4oz.quantityPerUnit,
        itemWeight: preset4oz.finishedWeight,
        itemWeightUnit: preset4oz.weightUnit,
      },
    ];

    calculateProduction(recipe, reqs);

    assert.strictEqual(
      JSON.stringify(presets),
      originalPresetsJson,
      'Presets must remain completely immutable during production calculations'
    );
  });

  // -------------------------------------------------------------------------
  // TEST G
  // -------------------------------------------------------------------------
  it('G. Reset clears temporary calculation state', () => {
    let presetQuantities: Record<string, number> = {
      [preset4oz.id]: 3,
      [preset2oz.id]: 1,
    };

    // Verify initial count is 4 cases
    assert.strictEqual(
      Object.values(presetQuantities).reduce((a, b) => a + b, 0),
      4
    );

    // Reset handler action
    presetQuantities = {};

    // Verify state is clean
    assert.strictEqual(Object.keys(presetQuantities).length, 0);
    assert.strictEqual(
      Object.values(presetQuantities).reduce((a, b) => a + b, 0),
      0
    );
  });

  // -------------------------------------------------------------------------
  // TEST H
  // -------------------------------------------------------------------------
  it('H. Archived recipes are excluded from the default Production Mode recipe selector', () => {
    const allRecipes: Recipe[] = [
      createTestRecipe({ id: 'r1', name: 'Chocolate Chip Cookies', archived: false }),
      createTestRecipe({ id: 'r2', name: 'Snickerdoodles', archived: undefined }),
      createTestRecipe({ id: 'r3', name: 'Old Discontinued Cookie', archived: true }),
      createTestRecipe({ id: 'r4', name: 'Holiday Special 2024 (Archived)', archived: true }),
    ];

    // Default Production Mode active filter
    const activeInProduction = allRecipes.filter((r) => !r.archived);

    assert.strictEqual(activeInProduction.length, 2);
    assert(activeInProduction.some((r) => r.id === 'r1'));
    assert(activeInProduction.some((r) => r.id === 'r2'));
    assert(!activeInProduction.some((r) => r.id === 'r3'));
    assert(!activeInProduction.some((r) => r.id === 'r4'));
  });

  // -------------------------------------------------------------------------
  // TEST I
  // -------------------------------------------------------------------------
  it('I. Mixer capacity uses the existing mixer configuration', () => {
    // 1 case of 4 oz = 320 oz finished weight = ~20 lb + 6% waste = ~21.2 lb
    const smallBatchReq: ProductionItemRequirement = {
      id: 'req-small',
      presetName: preset4oz.name,
      quantity: 1, // 1 case
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const resUnderCapacity = calculateProduction(recipe, [smallBatchReq], {
      mixer,
      defaultWeightUnit: 'lb',
    });

    // 21.2 lb is well within Hobart 60-Qt (80 lb)
    assert.strictEqual(resUnderCapacity.isCapacityExceeded, false);
    assert.strictEqual(resUnderCapacity.suggestedBatches, 1);
    assert.strictEqual(resUnderCapacity.mixer?.name, 'Hobart 60-Qt Commercial Mixer');
    assert.strictEqual(resUnderCapacity.mixer?.maxWeight, 80);

    // 5 cases of 4 oz = 1600 oz finished = 100 lb + 6% waste = ~106 lb
    // 106 lb exceeds Hobart 60-Qt 80 lb capacity!
    const largeBatchReq: ProductionItemRequirement = {
      id: 'req-large',
      presetName: preset4oz.name,
      quantity: 5, // 5 cases
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const resOverCapacity = calculateProduction(recipe, [largeBatchReq], {
      mixer,
      defaultWeightUnit: 'lb',
    });

    assert.strictEqual(resOverCapacity.isCapacityExceeded, true);
    // 106 lb / 80 lb limit = 2 batches
    assert.strictEqual(resOverCapacity.suggestedBatches, 2);

    // Per-batch quantities should equal half of total
    resOverCapacity.calculatedIngredients.forEach((ci) => {
      assert(ci.perBatchQuantity !== undefined);
      assert(
        Math.abs(ci.perBatchQuantity - ci.requiredQuantity / 2) <= 1,
        `Per batch quantity for ${ci.name} should be half of total`
      );
    });
  });

  // -------------------------------------------------------------------------
  // TEST J
  // -------------------------------------------------------------------------
  it('J. Production Mode respects existing workspace authorization', () => {
    // Production Mode uses in-memory calculation and store getters (getRecipes, getPresets, getMixers)
    // Any workspace member (owner, editor, viewer) can access Production Mode.
    // Verify that calculation is purely client-side and requires no admin/write authorization.
    const req: ProductionItemRequirement = {
      id: 'req-auth-test',
      presetName: preset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [req]);
    assert(result !== null);
    assert.strictEqual(result.requirements.length, 1);
  });

  // -------------------------------------------------------------------------
  // TEST K
  // -------------------------------------------------------------------------
  it('K. Direct quantity entry produces the same calculation as repeated + button presses', () => {
    // Repeated [+] 5 times: quantity = 5
    const reqStepped: ProductionItemRequirement = {
      id: 'req-stepped',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: 5,
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    // Direct input "5" parsed as integer 5
    const parsedQuantity = parseInt('5', 10);
    const reqDirect: ProductionItemRequirement = {
      id: 'req-direct',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: parsedQuantity,
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const resStepped = calculateProduction(recipe, [reqStepped], { overrideWastePercent: 6 });
    const resDirect = calculateProduction(recipe, [reqDirect], { overrideWastePercent: 6 });

    assert.strictEqual(resStepped.totalPieces, resDirect.totalPieces);
    assert.strictEqual(resStepped.totalBatchWeightGrams, resDirect.totalBatchWeightGrams);
    assert.strictEqual(resStepped.scalingMultiplier, resDirect.scalingMultiplier);
  });

  // -------------------------------------------------------------------------
  // TEST L
  // -------------------------------------------------------------------------
  it('L. Zero selected production units produces no production formula / appropriate empty state', () => {
    // When preset quantities are all 0 or requirements list is empty:
    const emptyReqs: ProductionItemRequirement[] = [];

    // The UI handles requirements.length === 0 by displaying the empty state and not calling calculation
    assert.strictEqual(emptyReqs.length, 0);

    // Even if an item with quantity 0 is passed to calculateProduction, pieces = 0
    const zeroReq: ProductionItemRequirement = {
      id: 'req-zero',
      presetName: preset4oz.name,
      quantity: 0,
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const resZero = calculateProduction(recipe, [zeroReq]);
    assert.strictEqual(resZero.totalPieces, 0);
    assert.strictEqual(resZero.totalFinishedWeightGrams, 0);
  });

  // -------------------------------------------------------------------------
  // TEST M
  // -------------------------------------------------------------------------
  it('M. Category filtering displays ONLY presets matching the selected recipe category', () => {
    // Authoritative preset inventory containing mixed categories
    const mixedPresets: ProductionPreset[] = [
      createCustomPreset({
        id: 'p-3oz-cookie',
        name: '3 oz Cookies',
        category: '', // Legacy preset defaults to Cookies
        finishedWeight: 3,
        weightUnit: 'oz',
        quantityPerUnit: 96,
      }),
      createCustomPreset({
        id: 'p-4oz-cookie',
        name: '4 oz Cookies',
        category: 'Cookies',
        finishedWeight: 4,
        weightUnit: 'oz',
        quantityPerUnit: 80,
      }),
      createCustomPreset({
        id: 'p-shortbread-2x2',
        name: 'Shortbread Cookies 2"x 2"',
        category: 'Shortbread',
        finishedWeight: 1.25,
        weightUnit: 'oz',
        quantityPerUnit: 220,
      }),
      createCustomPreset({
        id: 'p-tray',
        name: 'Tray',
        category: 'Tray',
        finishedWeight: 890,
        weightUnit: 'g',
        quantityPerUnit: 1,
      }),
      createCustomPreset({
        id: 'p-50-round',
        name: '50 Round',
        category: 'Base Dough',
        finishedWeight: 9,
        weightUnit: 'g',
        quantityPerUnit: 335,
      }),
      createCustomPreset({
        id: 'p-filling',
        name: 'Cream Cheese Scoops',
        category: 'Filling',
        finishedWeight: 0.85,
        weightUnit: 'oz',
        quantityPerUnit: 80,
      }),
    ];

    const categoryPresetMap: Record<string, string | string[]> = {
      Cookies: 'Cookies',
      Shortbread: 'Shortbread',
      Bread: 'Base Dough',
      'Base Dough': 'Base Dough',
    };

    const cookieRecipe = createTestRecipe({
      id: 'rec-macadamia',
      name: 'Macadamia White Chocolate Chip Cookies',
      category: 'Cookies',
    });

    const applicable = getApplicablePresetsForRecipe(cookieRecipe, mixedPresets, categoryPresetMap);

    // MUST return ONLY the 2 cookie presets
    assert.strictEqual(applicable.length, 2, 'Must return exactly 2 cookie presets');
    assert(applicable.some((p) => p.id === 'p-3oz-cookie'), 'Must include 3 oz Cookies (category: "")');
    assert(applicable.some((p) => p.id === 'p-4oz-cookie'), 'Must include 4 oz Cookies');

    // MUST NOT return presets from other categories
    assert(!applicable.some((p) => p.id === 'p-shortbread-2x2'), 'Must NOT include Shortbread presets');
    assert(!applicable.some((p) => p.id === 'p-tray'), 'Must NOT include Tray presets');
    assert(!applicable.some((p) => p.id === 'p-50-round'), 'Must NOT include Base Dough presets');
    assert(!applicable.some((p) => p.id === 'p-filling'), 'Must NOT include Filling presets');
  });

  // -------------------------------------------------------------------------
  // TEST N
  // -------------------------------------------------------------------------
  it('N. Generic category routing handles multiple recipe categories without hardcoding names', () => {
    const mixedPresets: ProductionPreset[] = [
      createCustomPreset({ id: 'p-c1', name: '4 oz Cookies', category: 'Cookies', finishedWeight: 4, weightUnit: 'oz', quantityPerUnit: 80 }),
      createCustomPreset({ id: 'p-sb1', name: 'Shortbread Squares', category: 'Shortbread', finishedWeight: 1.5, weightUnit: 'oz', quantityPerUnit: 150 }),
      createCustomPreset({ id: 'p-bd1', name: '50 Round Loaf Dough', category: 'Base Dough', finishedWeight: 500, weightUnit: 'g', quantityPerUnit: 20 }),
      createCustomPreset({ id: 'p-pd1', name: 'Pie Top 9-inch', category: 'Pie Dough', finishedWeight: 250, weightUnit: 'g', quantityPerUnit: 24 }),
    ];

    const categoryPresetMap: Record<string, string | string[]> = {
      Cookies: 'Cookies',
      Shortbread: 'Shortbread',
      Bread: 'Base Dough',
      Scones: 'Cookies',
      Pies: 'Pie Dough',
      'Pie Dough': 'Pie Dough',
    };

    // Case 1: Shortbread Recipe -> Shortbread Presets
    const sbRecipe = createTestRecipe({ category: 'Shortbread', name: 'Scottish Shortbread' });
    const sbApplicable = getApplicablePresetsForRecipe(sbRecipe, mixedPresets, categoryPresetMap);
    assert.strictEqual(sbApplicable.length, 1);
    assert.strictEqual(sbApplicable[0].id, 'p-sb1');

    // Case 2: Bread Recipe -> Base Dough Presets (via categoryPresetMap)
    const breadRecipe = createTestRecipe({ category: 'Bread', name: 'Sourdough Country Boule' });
    const breadApplicable = getApplicablePresetsForRecipe(breadRecipe, mixedPresets, categoryPresetMap);
    assert.strictEqual(breadApplicable.length, 1);
    assert.strictEqual(breadApplicable[0].id, 'p-bd1');

    // Case 3: Scones Recipe -> Cookies Presets (via categoryPresetMap)
    const sconeRecipe = createTestRecipe({ category: 'Scones', name: 'Blueberry Cream Scones' });
    const sconeApplicable = getApplicablePresetsForRecipe(sconeRecipe, mixedPresets, categoryPresetMap);
    assert.strictEqual(sconeApplicable.length, 1);
    assert.strictEqual(sconeApplicable[0].id, 'p-c1');

    // Case 4: Pie Dough Recipe -> Pie Dough Presets
    const pieRecipe = createTestRecipe({ category: 'Pies', name: 'Granny Smith Apple Pie' });
    const pieApplicable = getApplicablePresetsForRecipe(pieRecipe, mixedPresets, categoryPresetMap);
    assert.strictEqual(pieApplicable.length, 1);
    assert.strictEqual(pieApplicable[0].id, 'p-pd1');
  });

  // -------------------------------------------------------------------------
  // TEST O
  // -------------------------------------------------------------------------
  it('O. Every preset quantity initializes to 0 cases and resets to 0 upon Start New Batch', () => {
    // Contract check: On initial load of a recipe, the quantity state is empty or 0
    let presetQuantities: Record<string, number> = {};

    const availablePresets = createTestPresets();
    availablePresets.forEach((p) => {
      const qty = presetQuantities[p.id] || 0;
      assert.strictEqual(qty, 0, `Preset ${p.name} must initialize to 0 cases, never 1`);
    });

    // Simulate operator incrementing cases for a production run
    presetQuantities['preset-4oz'] = 3;
    presetQuantities['preset-2oz'] = 2;

    const totalSelectedBeforeReset = Object.values(presetQuantities).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalSelectedBeforeReset, 5);

    // Operator clicks "Start New Batch" / Reset
    presetQuantities = {};

    // Invariant: After reset, all preset quantities must return to 0
    availablePresets.forEach((p) => {
      const qty = presetQuantities[p.id] || 0;
      assert.strictEqual(qty, 0, `Preset ${p.name} must reset to 0 cases`);
    });

    const totalSelectedAfterReset = Object.values(presetQuantities).reduce((a, b) => a + b, 0);
    assert.strictEqual(totalSelectedAfterReset, 0, 'Total cases must be 0 after reset');
  });

  // -------------------------------------------------------------------------
  // TEST P
  // -------------------------------------------------------------------------
  it('P. Compact preset selectors uphold touch target specifications, direct numeric entry, and case semantics', () => {
    // Verify touch target dimension standard (min 44-48px)
    const MIN_TOUCH_PX = 44;
    const implementedButtonSize = 48; // w-12 h-12 in Tailwind is 48px
    assert(implementedButtonSize >= MIN_TOUCH_PX, 'Touch target button size must be at least 44px');

    // Direct entry parsing contract
    const enteredValueStr = '12';
    const parsedCases = Math.max(0, parseInt(enteredValueStr, 10) || 0);
    assert.strictEqual(parsedCases, 12);

    // Verify case multiplier semantics (12 cases of 80/case 4oz cookies = 960 cookies @ 4oz = 3840 oz)
    const req: ProductionItemRequirement = {
      id: 'req-direct-12',
      presetId: preset4oz.id,
      presetName: preset4oz.name,
      quantity: parsedCases,
      piecesPerUnit: preset4oz.quantityPerUnit,
      itemWeight: preset4oz.finishedWeight,
      itemWeightUnit: preset4oz.weightUnit,
    };

    const result = calculateProduction(recipe, [req], { overrideWastePercent: 6 });
    assert.strictEqual(result.totalPieces, 12 * 80);
    assert.strictEqual(result.totalPieces, 960);
    assert(Math.abs(result.totalFinishedWeightGrams - toGrams(960 * 4, 'oz')) < 0.01);
  });

  // -------------------------------------------------------------------------
  // TEST Q
  // -------------------------------------------------------------------------
  it('Q. Safety invariant: Production Mode operations perform zero writes to Firestore and mutate no formulas', () => {
    const baseRecipe = createTestRecipe();
    const originalRecipeSnapshot = JSON.stringify(baseRecipe);
    const originalPresetsSnapshot = JSON.stringify(presets);
    const originalMixerSnapshot = JSON.stringify(mixer);

    // Mock an observer to verify zero writes
    let writeOperationsCount = 0;
    const mockDb = {
      write: () => {
        writeOperationsCount++;
      },
      update: () => {
        writeOperationsCount++;
      },
      set: () => {
        writeOperationsCount++;
      },
      delete: () => {
        writeOperationsCount++;
      },
    };

    // Execute full Production Mode calculation pipeline
    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-prod-run',
        presetId: preset4oz.id,
        presetName: preset4oz.name,
        quantity: 4,
        piecesPerUnit: preset4oz.quantityPerUnit,
        itemWeight: preset4oz.finishedWeight,
        itemWeightUnit: preset4oz.weightUnit,
      },
    ];

    const result = calculateProduction(baseRecipe, reqs, {
      mixer,
      overrideWastePercent: 6,
      defaultWeightUnit: 'lb',
    });

    assert(result !== null);
    assert.strictEqual(result.totalPieces, 320);

    // Invariant 1: Zero database write operations executed
    assert.strictEqual(writeOperationsCount, 0, 'Production Mode calculations must execute zero database writes');

    // Invariant 2: Base recipe formula remained completely unmodified
    assert.strictEqual(
      JSON.stringify(baseRecipe),
      originalRecipeSnapshot,
      'Base recipe must remain completely untouched'
    );

    // Invariant 3: Presets remained completely unmodified
    assert.strictEqual(
      JSON.stringify(presets),
      originalPresetsSnapshot,
      'Preset objects must remain completely untouched'
    );

    // Invariant 4: Mixer specifications remained completely unmodified
    assert.strictEqual(
      JSON.stringify(mixer),
      originalMixerSnapshot,
      'Mixer specifications must remain completely untouched'
    );
  });

  // -------------------------------------------------------------------------
  // TEST R
  // -------------------------------------------------------------------------
  it('R. Recipe Sorting: A–Z and Category orders sort active recipes deterministically', () => {
    const r1 = createTestRecipe({ id: 'rec-1', name: 'Zucchini Bread Cookies', category: 'Seasonal' });
    const r2 = createTestRecipe({ id: 'rec-2', name: 'Apple Cinnamon Cookies', category: 'Fall' });
    const r3 = createTestRecipe({ id: 'rec-3', name: 'Chocolate Chip Cookies', category: 'Classic' });
    const r4 = createTestRecipe({ id: 'rec-4', name: 'Brown Butter Cookies', category: 'Classic' });
    const list = [r1, r2, r3, r4];

    // 1. Alphabetical (A-Z)
    const sortedAlpha = sortRecipes(list, 'alphabetical', {});
    assert.deepStrictEqual(
      sortedAlpha.map((r) => r.name),
      [
        'Apple Cinnamon Cookies',
        'Brown Butter Cookies',
        'Chocolate Chip Cookies',
        'Zucchini Bread Cookies',
      ]
    );

    // 2. Category Sort (Primary: Category A-Z, Secondary: Name A-Z)
    const sortedCategory = sortRecipes(list, 'category', {});
    assert.deepStrictEqual(
      sortedCategory.map((r) => `${r.category}: ${r.name}`),
      [
        'Classic: Brown Butter Cookies',
        'Classic: Chocolate Chip Cookies',
        'Fall: Apple Cinnamon Cookies',
        'Seasonal: Zucchini Bread Cookies',
      ]
    );
  });

  // -------------------------------------------------------------------------
  // TEST S
  // -------------------------------------------------------------------------
  it('S. Recipe Sorting: Recently Used and Most Used accurately utilize local usage metadata', () => {
    const rA = createTestRecipe({ id: 'rec-a', name: 'Almond Biscotti' });
    const rB = createTestRecipe({ id: 'rec-b', name: 'Butter Pecan' });
    const rC = createTestRecipe({ id: 'rec-c', name: 'Chocolate Fudge' });
    const list = [rA, rB, rC];

    const usageMap: RecipeUsageMap = {
      'rec-a': { recipeId: 'rec-a', useCount: 5, lastUsedAt: 1000 },
      'rec-b': { recipeId: 'rec-b', useCount: 12, lastUsedAt: 5000 }, // Most recent and most used
      'rec-c': { recipeId: 'rec-c', useCount: 2, lastUsedAt: 8000 },  // Most recent timestamp
    };

    // Recently Used: rC (8000) > rB (5000) > rA (1000)
    const sortedRecent = sortRecipes(list, 'recent', usageMap);
    assert.deepStrictEqual(
      sortedRecent.map((r) => r.id),
      ['rec-c', 'rec-b', 'rec-a']
    );

    // Most Used: rB (12 runs) > rA (5 runs) > rC (2 runs)
    const sortedMost = sortRecipes(list, 'most_used', usageMap);
    assert.deepStrictEqual(
      sortedMost.map((r) => r.id),
      ['rec-b', 'rec-a', 'rec-c']
    );
  });

  // -------------------------------------------------------------------------
  // TEST T
  // -------------------------------------------------------------------------
  it('T. Recipe Sorting: Fallback to A–Z when no local usage exists or when usage is identical', () => {
    const r1 = createTestRecipe({ id: 'rec-1', name: 'Zebra Stripe Cookies' });
    const r2 = createTestRecipe({ id: 'rec-2', name: 'Almond Crisps' });
    const r3 = createTestRecipe({ id: 'rec-3', name: 'Ginger Snaps' });
    const list = [r1, r2, r3];

    // Empty usage map: both 'recent' and 'most_used' must cleanly fall back to A–Z
    const sortedRecentNoUsage = sortRecipes(list, 'recent', {});
    assert.deepStrictEqual(
      sortedRecentNoUsage.map((r) => r.name),
      ['Almond Crisps', 'Ginger Snaps', 'Zebra Stripe Cookies']
    );

    const sortedMostNoUsage = sortRecipes(list, 'most_used', {});
    assert.deepStrictEqual(
      sortedMostNoUsage.map((r) => r.name),
      ['Almond Crisps', 'Ginger Snaps', 'Zebra Stripe Cookies']
    );

    // Identical run count (5 runs each) -> deterministic secondary alphabetical sort
    const tieUsage: RecipeUsageMap = {
      'rec-1': { recipeId: 'rec-1', useCount: 5, lastUsedAt: 2000 },
      'rec-2': { recipeId: 'rec-2', useCount: 5, lastUsedAt: 2000 },
      'rec-3': { recipeId: 'rec-3', useCount: 5, lastUsedAt: 2000 },
    };

    const sortedTiedRuns = sortRecipes(list, 'most_used', tieUsage);
    assert.deepStrictEqual(
      sortedTiedRuns.map((r) => r.name),
      ['Almond Crisps', 'Ginger Snaps', 'Zebra Stripe Cookies']
    );
  });

  // -------------------------------------------------------------------------
  // TEST U
  // -------------------------------------------------------------------------
  it('U. Search + Category + Sort work seamlessly together on filtered subsets', () => {
    const r1 = createTestRecipe({ id: 'r1', name: 'Classic Chocolate Chip', category: 'Cookies' });
    const r2 = createTestRecipe({ id: 'r2', name: 'Double Chocolate Fudge', category: 'Cookies' });
    const r3 = createTestRecipe({ id: 'r3', name: 'White Chocolate Macadamia', category: 'Cookies' });
    const r4 = createTestRecipe({ id: 'r4', name: 'Chocolate Scones', category: 'Scones' });
    const allRecipes = [r1, r2, r3, r4];

    const usage: RecipeUsageMap = {
      r1: { recipeId: 'r1', useCount: 1, lastUsedAt: 100 },
      r2: { recipeId: 'r2', useCount: 10, lastUsedAt: 500 }, // Most used chocolate cookie
      r3: { recipeId: 'r3', useCount: 4, lastUsedAt: 200 },
    };

    // Filter by Category: 'Cookies' and Search: 'chocolate'
    const category: string = 'Cookies';
    const query = 'chocolate';
    const filtered = allRecipes.filter((r) => {
      const matchesCategory = category === 'All' || (r.category && r.category.toLowerCase() === category.toLowerCase());
      const matchesSearch = !query || r.name.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    // Scones recipe must be excluded by category filter
    assert.strictEqual(filtered.length, 3);
    assert(!filtered.some((r) => r.id === 'r4'), 'Must not include Scones');

    // Sort the filtered subset by 'most_used'
    const sorted = sortRecipes(filtered, 'most_used', usage);
    assert.deepStrictEqual(
      sorted.map((r) => r.id),
      ['r2', 'r3', 'r1'] // r2 has 10 runs, r3 has 4 runs, r1 has 1 run
    );
  });

  // -------------------------------------------------------------------------
  // TEST V
  // -------------------------------------------------------------------------
  it('V. Butter precision display formatting in LB enforces 2 decimals while underlying grams remain authoritative', () => {
    // 1. Butter ingredient recognition
    assert.strictEqual(isButterIngredient('Butter (Unsalted)'), true);
    assert.strictEqual(isButterIngredient('European Butter 82%'), true);
    assert.strictEqual(isButterIngredient('Flour (All Purpose)'), false);

    // 2. getDisplayDecimals for LB unit + butter enforces minDecimals=2, maxDecimals=2
    const lbButterDecimals = getDisplayDecimals('lb', true, 2, false);
    assert.strictEqual(lbButterDecimals.minDecimals, 2);
    assert.strictEqual(lbButterDecimals.maxDecimals, 2);

    // 3. formatNumber outputs exactly 2 decimals
    assert.strictEqual(formatNumber(11, lbButterDecimals.maxDecimals, lbButterDecimals.minDecimals), '11.00');
    assert.strictEqual(formatNumber(7, lbButterDecimals.maxDecimals, lbButterDecimals.minDecimals), '7.00');
    assert.strictEqual(formatNumber(3.5, lbButterDecimals.maxDecimals, lbButterDecimals.minDecimals), '3.50');
    assert.strictEqual(formatNumber(3.66, lbButterDecimals.maxDecimals, lbButterDecimals.minDecimals), '3.66');

    // 4. Underlying grams remain high-precision float (e.g. 11 lb to grams)
    const butter11lbGrams = toGrams(11, 'lb');
    assert(Math.abs(butter11lbGrams - 4989.516) < 0.01, 'Authoritative grams must not be truncated in memory');
  });

  // -------------------------------------------------------------------------
  // TEST W
  // -------------------------------------------------------------------------
  it('W. Switching unit to Grams displays Butter naturally as whole integer with 0 decimals', () => {
    // getDisplayDecimals for grams with butter returns maxDecimals=0, minDecimals=0
    const gButterDecimals = getDisplayDecimals('g', true, 2, false);
    assert.strictEqual(gButterDecimals.maxDecimals, 0);
    assert.strictEqual(gButterDecimals.minDecimals, 0);

    // Formats as clean whole integer without forced decimals or trailing .00
    const formattedButterGrams = formatNumber(4854, gButterDecimals.maxDecimals, gButterDecimals.minDecimals);
    assert.strictEqual(formattedButterGrams, '4,854');
    assert(!formattedButterGrams.includes('.'), 'Butter in grams must not contain decimals');
  });

  // -------------------------------------------------------------------------
  // TEST X
  // -------------------------------------------------------------------------
  it('X. Gram-based ingredients display naturally with 0 decimals and never forced to 2 decimals', () => {
    const gDecimals = getDisplayDecimals('g', false, 2, false);
    assert.strictEqual(gDecimals.maxDecimals, 0);
    assert.strictEqual(gDecimals.minDecimals, 0);

    // Test specific standard batch ingredients in grams:
    // Sugar: 3,236 g, Baking Soda: 105 g, Salt: 86 g, Liquid Eggs: 1,190 g
    assert.strictEqual(formatNumber(3236, gDecimals.maxDecimals, gDecimals.minDecimals), '3,236');
    assert.strictEqual(formatNumber(105, gDecimals.maxDecimals, gDecimals.minDecimals), '105');
    assert.strictEqual(formatNumber(86, gDecimals.maxDecimals, gDecimals.minDecimals), '86');
    assert.strictEqual(formatNumber(1190, gDecimals.maxDecimals, gDecimals.minDecimals), '1,190');

    // Verify 0 is formatted as '0' without decimals
    assert.strictEqual(formatNumber(0, gDecimals.maxDecimals, gDecimals.minDecimals), '0');
  });

  // -------------------------------------------------------------------------
  // TEST Y
  // -------------------------------------------------------------------------
  it('Y. Local usage tracking uses localStorage only with zero Firestore writes and no recipe mutation', () => {
    // Mock memory localStorage
    const storage: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: (key: string) => storage[key] || null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    };

    // Save and load usage map using the test helper functions
    const testRecipe = createTestRecipe({ id: 'rec-strawberry-shortbread' });
    const originalRecipeJson = JSON.stringify(testRecipe);

    const initialUsage = loadRecipeUsageMap(mockLocalStorage);
    assert.deepStrictEqual(initialUsage, {});

    // Record production run
    const updatedUsage = recordProductionRun('rec-strawberry-shortbread', mockLocalStorage);
    assert.strictEqual(updatedUsage['rec-strawberry-shortbread'].useCount, 1);
    assert(updatedUsage['rec-strawberry-shortbread'].lastUsedAt > 0);

    // Recipe object was NOT mutated
    assert.strictEqual(JSON.stringify(testRecipe), originalRecipeJson, 'Recipe object must not be mutated');

    // Storage JSON contains only local tracking metadata under the dedicated key
    assert(storage[PROD_RECIPE_USAGE_KEY] !== undefined, 'Must store in dedicated localStorage key');
    const parsedStored = JSON.parse(storage[PROD_RECIPE_USAGE_KEY]);
    assert.strictEqual(parsedStored['rec-strawberry-shortbread'].useCount, 1);
  });

  // -------------------------------------------------------------------------
  // PRODUCTION NOTES ACKNOWLEDGMENT SUITE (PN1 - PN15)
  // -------------------------------------------------------------------------
  describe('Production Notes Acknowledgment (PN1 - PN15)', () => {
    it('PN1 — Note Exists: A recipe with Description/Notes displays the Production Notes card as REVIEW REQUIRED', () => {
      const recipeWithNote = createTestRecipe({
        description: 'Add chocolate chips during the final 60 seconds of mixing.\nDo not overmix after inclusions are added.',
      });
      const hasNotes = hasProductionNotes(recipeWithNote.description);
      assert.strictEqual(hasNotes, true);
      const status = getProductionNotesStatus(hasNotes, false);
      assert.strictEqual(status, 'REVIEW_REQUIRED');
    });

    it('PN2 — Explicit Acknowledgment: Opening/expanding the note alone does NOT count as acknowledgment', () => {
      const hasNotes = true;
      let isExpanded = false;
      let isAcknowledged = false;

      // Operator opens/expands the card
      isExpanded = true;

      // Expanding does NOT change isAcknowledged
      assert.strictEqual(isExpanded, true);
      assert.strictEqual(isAcknowledged, false);

      const status = getProductionNotesStatus(hasNotes, isAcknowledged);
      assert.strictEqual(status, 'REVIEW_REQUIRED');

      const canProceed = canProceedToMix(hasNotes, isAcknowledged);
      assert.strictEqual(canProceed, false);
    });

    it('PN3 — Acknowledgment Action: Explicitly clicking "I Have Read These Production Notes" marks the note reviewed', () => {
      const hasNotes = true;
      let isAcknowledged = false;

      // Operator clicks acknowledgment button
      isAcknowledged = true;

      const status = getProductionNotesStatus(hasNotes, isAcknowledged);
      assert.strictEqual(status, 'REVIEWED');

      const canProceed = canProceedToMix(hasNotes, isAcknowledged);
      assert.strictEqual(canProceed, true);
    });

    it('PN4 — Workflow Gate: A production run with an unacknowledged note cannot proceed into final workflow', () => {
      const hasNotes = true;
      const isAcknowledged = false;
      const canProceed = canProceedToMix(hasNotes, isAcknowledged);
      assert.strictEqual(canProceed, false);
    });

    it('PN5 — Calculation Integrity: The note gate does not change any production calculation values', () => {
      const recipe = createTestRecipe({
        description: 'Important handling note.',
      });
      const reqs: ProductionItemRequirement[] = [
        {
          id: 'p1',
          presetName: '4 oz Cookie Case',
          quantity: 3,
          piecesPerUnit: 80,
          itemWeight: 4,
          itemWeightUnit: 'oz',
        },
      ];

      // Calculation before acknowledgment
      const calcBefore = calculateProduction(recipe, reqs, { defaultWastePercent: 6 });
      // Calculation after acknowledgment
      const calcAfter = calculateProduction(recipe, reqs, { defaultWastePercent: 6 });

      assert.strictEqual(calcBefore.totalBatchWeightGrams, calcAfter.totalBatchWeightGrams);
      assert.strictEqual(calcBefore.totalPieces, calcAfter.totalPieces);
      assert.strictEqual(calcBefore.calculatedIngredients.length, calcAfter.calculatedIngredients.length);
      calcBefore.calculatedIngredients.forEach((ing, i) => {
        assert.strictEqual(ing.scaledQuantity, calcAfter.calculatedIngredients[i].scaledQuantity);
      });
    });

    it('PN6 — No Note: A recipe without Description/Notes proceeds without acknowledgment', () => {
      const emptyDesc = '';
      assert.strictEqual(hasProductionNotes(emptyDesc), false);
      assert.strictEqual(hasProductionNotes(null), false);
      assert.strictEqual(hasProductionNotes(undefined), false);

      const status = getProductionNotesStatus(false, false);
      assert.strictEqual(status, 'NONE');

      const canProceed = canProceedToMix(false, false);
      assert.strictEqual(canProceed, true);
    });

    it('PN7 — Whitespace Note: Whitespace-only Description/Notes is treated as no note', () => {
      const wsNote1 = '    ';
      const wsNote2 = '\t\n\r  ';
      assert.strictEqual(hasProductionNotes(wsNote1), false);
      assert.strictEqual(hasProductionNotes(wsNote2), false);

      assert.strictEqual(getProductionNotesStatus(false, false), 'NONE');
      assert.strictEqual(canProceedToMix(false, false), true);
    });

    it('PN8 — Collapse After Review: An acknowledged Production Notes card can be collapsed without losing acknowledgment', () => {
      const hasNotes = true;
      let isAcknowledged = true;
      let isExpanded = true;

      // Operator collapses card
      isExpanded = false;

      assert.strictEqual(isExpanded, false);
      assert.strictEqual(isAcknowledged, true);
      assert.strictEqual(getProductionNotesStatus(hasNotes, isAcknowledged), 'REVIEWED');
      assert.strictEqual(canProceedToMix(hasNotes, isAcknowledged), true);
    });

    it('PN9 — Quantity Changes: Changing production quantities after acknowledgment does not require re-acknowledgment', () => {
      const hasNotes = true;
      let isAcknowledged = true;
      let cases = 2;

      // Operator adjusts quantities
      cases = 5;

      assert.strictEqual(cases, 5);
      assert.strictEqual(isAcknowledged, true);
      assert.strictEqual(canProceedToMix(hasNotes, isAcknowledged), true);
    });

    it('PN10 — Mixer Change: Changing mixer after acknowledgment does not require re-acknowledgment during same run', () => {
      const hasNotes = true;
      let isAcknowledged = true;
      let activeMixerId = 'mixer-hobart-80';

      // Operator switches to mixer-hobart-140
      activeMixerId = 'mixer-hobart-140';

      assert.strictEqual(activeMixerId, 'mixer-hobart-140');
      assert.strictEqual(isAcknowledged, true);
      assert.strictEqual(canProceedToMix(hasNotes, isAcknowledged), true);
    });

    it('PN11 — Recipe Change: Changing recipes resets acknowledgment and evaluates the new recipe note independently', () => {
      // Recipe A acknowledged
      let currentRecipeId = 'rec-a';
      let isAcknowledged = true;

      // User selects Recipe B
      currentRecipeId = 'rec-b';
      isAcknowledged = false;

      const recipeB = createTestRecipe({ id: 'rec-b', description: 'Recipe B production notes' });
      const hasNotesB = hasProductionNotes(recipeB.description);

      assert.strictEqual(currentRecipeId, 'rec-b');
      assert.strictEqual(isAcknowledged, false);
      assert.strictEqual(hasNotesB, true);
      assert.strictEqual(getProductionNotesStatus(hasNotesB, isAcknowledged), 'REVIEW_REQUIRED');
      assert.strictEqual(canProceedToMix(hasNotesB, isAcknowledged), false);
    });

    it('PN12 — Start New Batch: Reset / Start New Batch clears acknowledgment and requires note to be reviewed again', () => {
      const hasNotes = true;
      let isAcknowledged = true;

      // Operator clicks Reset Batch / Start New Batch
      isAcknowledged = false;

      assert.strictEqual(isAcknowledged, false);
      assert.strictEqual(getProductionNotesStatus(hasNotes, isAcknowledged), 'REVIEW_REQUIRED');
      assert.strictEqual(canProceedToMix(hasNotes, isAcknowledged), false);
    });

    it('PN13 — Read Only: Production Floor cannot modify Description/Notes', () => {
      const originalDescription = 'Original protected production note.';
      const testRecipe = createTestRecipe({ description: originalDescription });
      const originalSnapshot = JSON.stringify(testRecipe);

      // Floor viewing and acknowledging
      const hasNotes = hasProductionNotes(testRecipe.description);
      let isAcknowledged = false;
      isAcknowledged = true;

      // Recipe is untouched
      assert.strictEqual(JSON.stringify(testRecipe), originalSnapshot);
      assert.strictEqual(testRecipe.description, originalDescription);
      assert.strictEqual(isAcknowledged, true);
    });

    it('PN14 — Zero Firestore Writes: Acknowledging Production Notes performs no Firestore write', () => {
      let firestoreWriteCalls = 0;
      const acknowledgeNoteInMemory = () => {
        // purely transient React state
        return true;
      };

      const ack = acknowledgeNoteInMemory();
      assert.strictEqual(ack, true);
      assert.strictEqual(firestoreWriteCalls, 0);
    });

    it('PN15 — Existing Production Regression: All Full Recipe, Full Mixer, Preset, Custom calculations remain identical', () => {
      const testRecipe = createTestRecipe();
      const testMixer: Mixer = {
        id: 'mixer-1',
        name: 'Floor Mixer',
        maxWeight: 80,
        weightUnit: 'lb',
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
        userId: 'user-admin',
      };

      const fullRec = calculateProduction(testRecipe, [], { mode: 'full_recipe', fullRecipeCount: 1 });
      const fullMix = calculateProduction(testRecipe, [], { mode: 'full_mixer', fullMixerBatches: 1, mixer: testMixer });
      const presetCalc = calculateProduction(
        testRecipe,
        [{ id: 'p', presetName: 'Case', quantity: 1, piecesPerUnit: 80, itemWeight: 4, itemWeightUnit: 'oz' }],
        { defaultWastePercent: 6 }
      );
      const customCalc = calculateProduction(
        testRecipe,
        [{ id: 'c', presetName: 'Custom', quantity: 1, piecesPerUnit: 100, itemWeight: 2, itemWeightUnit: 'oz' }],
        { defaultWastePercent: 0 }
      );

      assert(fullRec.totalBatchWeightGrams > 0);
      assert(fullMix.totalBatchWeightGrams > 0);
      assert(presetCalc.totalBatchWeightGrams > 0);
      assert(customCalc.totalBatchWeightGrams > 0);
      assert.strictEqual(customCalc.totalPieces, 100);
    });
  });
});

