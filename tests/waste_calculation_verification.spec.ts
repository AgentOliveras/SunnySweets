import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateProduction,
  calculateRecipeBaseWeightGrams,
} from '../src/utils/calculator';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionItemRequirement,
  MasterIngredient,
  ProductionHistoryEntry,
} from '../src/types';
import { toGrams, fromGrams } from '../src/utils/units';

// Standard 4 oz cookie preset (80 pcs/case @ 4 oz = 320 oz)
const samplePreset4oz: ProductionPreset = {
  id: 'preset-4oz-cookie',
  userId: 'test-user',
  name: '4 oz Cookies',
  category: 'Cookies',
  finishedWeight: 4,
  weightUnit: 'oz',
  quantityPerUnit: 80,
  unitName: 'case',
  expectedYield: '80 cookies @ 4 oz each',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// 2 oz cookie preset (140 pcs/case @ 2 oz = 280 oz)
const samplePreset2oz: ProductionPreset = {
  id: 'preset-2oz-cookie',
  userId: 'test-user',
  name: '2 oz Cookies',
  category: 'Cookies',
  finishedWeight: 2,
  weightUnit: 'oz',
  quantityPerUnit: 140,
  unitName: 'case',
  expectedYield: '140 cookies @ 2 oz each',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Pure weight-based recipe: 80 pieces @ 1 oz = 80 oz base dough (2268g)
function createWeightOnlyRecipe(): Recipe {
  return {
    id: 'rec-weight-only',
    userId: 'test-user',
    name: 'Classic Chocolate Chip Cookies (Weight Only)',
    description: '',
    category: 'Cookies',
    batchYieldQuantity: 80,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 4,
    ingredients: [
      { id: 'ing-flour', name: 'All-Purpose Flour', quantity: 1000, unit: 'g' },
      { id: 'ing-butter', name: 'Butter', quantity: 500, unit: 'g' },
      { id: 'ing-sugar', name: 'Granulated Sugar', quantity: 400, unit: 'g' },
      { id: 'ing-chips', name: 'Semisweet Chocolate Chips', quantity: 368, unit: 'g' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// Mixed recipe with weight ingredients and discrete Large Eggs
function createMixedRecipeWithEggs(): Recipe {
  return {
    id: 'rec-mixed-eggs',
    userId: 'test-user',
    name: 'Classic Chocolate Chip Cookies (with Eggs)',
    description: '',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 4,
    ingredients: [
      { id: 'ing-flour', name: 'Bread Flour', quantity: 5, unit: 'kg' },
      { id: 'ing-sugar', name: 'Granulated Sugar', quantity: 2.5, unit: 'kg' },
      { id: 'ing-brown-sugar', name: 'Dark Brown Sugar', quantity: 2.5, unit: 'kg' },
      { id: 'ing-butter', name: 'Unsalted Butter', quantity: 3, unit: 'kg' },
      { id: 'ing-eggs', name: 'Large Eggs', quantity: 24, unit: 'eggs' },
      { id: 'ing-chips', name: 'Semisweet Chocolate Chips', quantity: 4, unit: 'kg' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const sampleMixer: Mixer = {
  id: 'mixer-hobart-80',
  name: 'Hobart 80-Qt Commercial Mixer',
  maxWeight: 100,
  weightUnit: 'lb',
  userId: 'test-user',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('Phase 2B.3 — Production Waste Semantics & Mathematical Integrity Suite', () => {

  // ---------------------------------------------------------------------------
  // W1: 80 × 4 oz = 320 oz + 4% production waste = exactly 332.8 oz required mix
  // ---------------------------------------------------------------------------
  it('W1: 80 cookies × 4 oz = 320 oz net with 4% production waste produces exactly 332.8 oz mix', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetId: samplePreset4oz.id,
      presetName: samplePreset4oz.name,
      quantity: 1, // 1 case
      piecesPerUnit: samplePreset4oz.quantityPerUnit, // 80 pcs
      itemWeight: samplePreset4oz.finishedWeight, // 4 oz
      itemWeightUnit: samplePreset4oz.weightUnit, // oz
    };

    const result = calculateProduction(recipe, [req], {
      defaultWastePercent: 4,
      defaultWeightUnit: 'oz',
    });

    // 1. Net pieces = 80
    assert.strictEqual(result.totalPieces, 80);

    // 2. Net finished weight = 320 oz
    const finishedOz = fromGrams(result.totalFinishedWeightGrams, 'oz');
    assert(Math.abs(finishedOz - 320) < 0.0001, `Finished weight must be 320 oz, got ${finishedOz}`);

    // 3. Gross required mix = 320 * 1.04 = 332.80 oz
    assert(
      Math.abs(result.displayBatchWeight - 332.8) < 0.0001,
      `displayBatchWeight must be exactly 332.8 oz, got ${result.displayBatchWeight}`
    );
  });

  // ---------------------------------------------------------------------------
  // W2: Explicitly prove result != 324 oz (Rejection of additive scalar)
  // ---------------------------------------------------------------------------
  it('W2: Explicitly proves result != 324 oz (Rejection of additive scalar)', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetName: samplePreset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [req], {
      defaultWastePercent: 4,
      defaultWeightUnit: 'oz',
    });

    // Proves result is not 320 + 4 = 324
    assert.notStrictEqual(result.displayBatchWeight, 324);
    assert(Math.abs(result.displayBatchWeight - 324) > 5.0, 'Result must not be near additive 324 oz');
  });

  // ---------------------------------------------------------------------------
  // W3: Explicitly prove result != 333.333... oz (Rejection of shrink-yield division)
  // ---------------------------------------------------------------------------
  it('W3: Explicitly proves result != 333.333... oz (Rejection of shrink division)', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetName: samplePreset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [req], {
      defaultWastePercent: 4,
      defaultWeightUnit: 'oz',
    });

    const shrinkYieldResult = 320 / (1 - 0.04); // 333.3333...
    assert.notStrictEqual(result.displayBatchWeight, shrinkYieldResult);
    assert(
      Math.abs(result.displayBatchWeight - shrinkYieldResult) > 0.4,
      'Result must not use shrink division 333.333 oz'
    );
  });

  // ---------------------------------------------------------------------------
  // W4: Verify ingredient quantities preserve recipe proportions after waste
  // ---------------------------------------------------------------------------
  it('W4: Scaled ingredient quantities preserve recipe proportions after waste', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetName: samplePreset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    // Calculate with 0% waste and with 4% waste
    const resNoWaste = calculateProduction(recipe, [req], { overrideWastePercent: 0 });
    const res4Waste = calculateProduction(recipe, [req], { overrideWastePercent: 4 });

    // Base flour to butter ratio: 1000 / 500 = 2.0
    // Base flour to sugar ratio: 1000 / 400 = 2.5
    // Base flour to chips ratio: 1000 / 368 = 2.71739...
    const flour0 = resNoWaste.calculatedIngredients.find((i) => i.id === 'ing-flour')!;
    const butter0 = resNoWaste.calculatedIngredients.find((i) => i.id === 'ing-butter')!;
    const sugar0 = resNoWaste.calculatedIngredients.find((i) => i.id === 'ing-sugar')!;
    const chips0 = resNoWaste.calculatedIngredients.find((i) => i.id === 'ing-chips')!;

    const flour4 = res4Waste.calculatedIngredients.find((i) => i.id === 'ing-flour')!;
    const butter4 = res4Waste.calculatedIngredients.find((i) => i.id === 'ing-butter')!;
    const sugar4 = res4Waste.calculatedIngredients.find((i) => i.id === 'ing-sugar')!;
    const chips4 = res4Waste.calculatedIngredients.find((i) => i.id === 'ing-chips')!;

    // Proportions before waste vs after waste must be identical:
    // Check using canonical converted quantities in default unit (grams):
    const ratioFlourButterBefore = (flour0.convertedQuantityInDefaultUnit ?? flour0.scaledQuantity) / (butter0.convertedQuantityInDefaultUnit ?? butter0.scaledQuantity);
    const ratioFlourButterAfter = (flour4.convertedQuantityInDefaultUnit ?? flour4.requiredQuantity) / (butter4.convertedQuantityInDefaultUnit ?? butter4.requiredQuantity);
    assert(Math.abs(ratioFlourButterBefore - ratioFlourButterAfter) < 0.0001, 'Flour to butter ratio must be preserved');

    const ratioFlourSugarBefore = flour0.scaledQuantity / sugar0.scaledQuantity;
    const ratioFlourSugarAfter = flour4.requiredQuantity / sugar4.requiredQuantity;
    assert(Math.abs(ratioFlourSugarBefore - ratioFlourSugarAfter) < 0.0001, 'Flour to sugar ratio must be preserved');

    const ratioFlourChipsBefore = flour0.scaledQuantity / chips0.scaledQuantity;
    const ratioFlourChipsAfter = flour4.scaledQuantity / chips4.scaledQuantity;
    assert(Math.abs(ratioFlourChipsBefore - ratioFlourChipsAfter) < 0.0001, 'Flour to chips unrounded ratio must be strictly identical');

    // And after integer gram rounding, ratio is preserved within 0.001:
    const ratioRoundedBefore = flour0.requiredQuantity / chips0.requiredQuantity;
    const ratioRoundedAfter = flour4.requiredQuantity / chips4.requiredQuantity;
    assert(Math.abs(ratioRoundedBefore - ratioRoundedAfter) < 0.001, 'Flour to chips rounded ratio must be preserved within integer tolerance');
  });

  // ---------------------------------------------------------------------------
  // W5: Verify sum of weight-equivalent scaled ingredients reconciles to gross mix
  // ---------------------------------------------------------------------------
  it('W5: Sum of weight-equivalent scaled ingredients reconciles to required gross mix within rounding tolerance', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetName: samplePreset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [req], {
      defaultWastePercent: 4,
      defaultWeightUnit: 'oz',
    });

    // Sum all ingredient required quantities converted to canonical default units (oz)
    const sumIngredientOz = result.calculatedIngredients.reduce(
      (sum, ing) => sum + (ing.convertedQuantityInDefaultUnit ?? 0),
      0
    );
    const expectedMixOz = 332.8;

    // Tolerance is within 0.01 oz (less than 0.3 grams out of 9.4 kg batch)
    assert(
      Math.abs(sumIngredientOz - expectedMixOz) < 0.01,
      `Sum of ingredient weights (${sumIngredientOz} oz) must reconcile to gross mix (${expectedMixOz} oz)`
    );
  });

  // ---------------------------------------------------------------------------
  // W6: Custom Quantity follows the same rule
  // ---------------------------------------------------------------------------
  it('W6: Custom Quantity follows the exact same production waste rule', () => {
    const recipe = createWeightOnlyRecipe();
    // Custom requirement: 100 cookies @ 3.2 oz = 320 oz net
    const customReq: ProductionItemRequirement = {
      id: 'req-custom',
      presetName: 'Custom Quantity',
      quantity: 100,
      piecesPerUnit: 1,
      itemWeight: 3.2,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [customReq], {
      defaultWastePercent: 4,
      defaultWeightUnit: 'oz',
    });

    assert.strictEqual(result.totalPieces, 100);
    const finishedOz = fromGrams(result.totalFinishedWeightGrams, 'oz');
    assert(Math.abs(finishedOz - 320) < 0.0001);

    // With 4% waste: 320 * 1.04 = 332.80 oz
    assert(Math.abs(result.displayBatchWeight - 332.8) < 0.0001);
  });

  // ---------------------------------------------------------------------------
  // W7: Mixed production requirements follow the same rule
  // ---------------------------------------------------------------------------
  it('W7: Mixed production requirements (multiple presets) follow the same rule', () => {
    const recipe = createWeightOnlyRecipe();
    // 1 case of 4 oz (80 @ 4 oz = 320 oz) + 1 case of 2 oz (140 @ 2 oz = 280 oz)
    // Total net finished = 320 + 280 = 600 oz
    const mixedReqs: ProductionItemRequirement[] = [
      {
        id: 'req-4oz',
        presetName: samplePreset4oz.name,
        quantity: 1,
        piecesPerUnit: 80,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      },
      {
        id: 'req-2oz',
        presetName: samplePreset2oz.name,
        quantity: 1,
        piecesPerUnit: 140,
        itemWeight: 2,
        itemWeightUnit: 'oz',
      },
    ];

    const result = calculateProduction(recipe, [mixedReqs[0], mixedReqs[1]], {
      overrideWastePercent: 5,
      defaultWeightUnit: 'oz',
    });

    assert.strictEqual(result.totalPieces, 220); // 80 + 140
    const finishedOz = fromGrams(result.totalFinishedWeightGrams, 'oz');
    assert(Math.abs(finishedOz - 600) < 0.0001);

    // 600 oz net + 5% waste = 600 * 1.05 = 630.00 oz mix
    assert(Math.abs(result.displayBatchWeight - 630) < 0.0001);
  });

  // ---------------------------------------------------------------------------
  // W8: 0% production waste produces net requirement exactly
  // ---------------------------------------------------------------------------
  it('W8: 0% production waste produces net requirement exactly', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetName: samplePreset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [req], {
      overrideWastePercent: 0,
      defaultWeightUnit: 'oz',
    });

    // 320 oz net finished = 320 oz mix required (0% added waste)
    assert(Math.abs(result.displayBatchWeight - 320) < 0.0001);
    assert.strictEqual(result.displayBatchWeight, fromGrams(result.totalFinishedWeightGrams, 'oz'));
  });

  // ---------------------------------------------------------------------------
  // W9: Decimal waste percentage (example 0.5%) calculates correctly
  // ---------------------------------------------------------------------------
  it('W9: Decimal waste percentage (example 0.5%) calculates correctly', () => {
    const recipe = createWeightOnlyRecipe();
    const req: ProductionItemRequirement = {
      id: 'req-1case-4oz',
      presetName: samplePreset4oz.name,
      quantity: 1,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    // 320 oz * (1 + 0.5 / 100) = 320 * 1.005 = 321.60 oz
    const result = calculateProduction(recipe, [req], {
      overrideWastePercent: 0.5,
      defaultWeightUnit: 'oz',
    });

    assert(Math.abs(result.displayBatchWeight - 321.6) < 0.0001);
  });

  // ---------------------------------------------------------------------------
  // W10: Non-weight/discrete ingredient recipe scales correctly without dropping
  // ---------------------------------------------------------------------------
  it('W10: Non-weight/discrete ingredient (Large Eggs) scales proportionally without silent drop', () => {
    const recipe = createMixedRecipeWithEggs();
    // Base recipe produces 100 cookies with 24 eggs.
    // Target: 2 cases of 4 oz cookies = 160 cookies @ 4 oz.
    const req: ProductionItemRequirement = {
      id: 'req-2cases-4oz',
      presetName: samplePreset4oz.name,
      quantity: 2,
      piecesPerUnit: 80,
      itemWeight: 4,
      itemWeightUnit: 'oz',
    };

    const result = calculateProduction(recipe, [req], {
      defaultWastePercent: 4,
    });

    const eggsIng = result.calculatedIngredients.find((i) => i.id === 'ing-eggs')!;
    assert(eggsIng, 'Eggs ingredient must exist in calculated result');
    assert.strictEqual(eggsIng.requiredUnit, 'eggs');

    // Eggs must scale by gross multiplier (including the 4% waste allowance):
    // Flour is 5 kg base -> scaled to net 5 * (totalFinished / baseWeight), then * 1.04.
    // Eggs must scale by the exact same ratio as Flour:
    const flourIng = result.calculatedIngredients.find((i) => i.id === 'ing-flour')!;
    const eggRatio = eggsIng.requiredQuantity / recipe.ingredients.find((i) => i.id === 'ing-eggs')!.quantity;
    const flourRatio = flourIng.requiredQuantity / recipe.ingredients.find((i) => i.id === 'ing-flour')!.quantity;

    assert(
      Math.abs(eggRatio - flourRatio) < 0.001,
      `Egg scaling ratio (${eggRatio}) must match flour scaling ratio (${flourRatio})`
    );
  });

  // ---------------------------------------------------------------------------
  // W11: Full Recipe behavior remains correct (0% waste, direct formulation)
  // ---------------------------------------------------------------------------
  it('W11: Full Recipe mode enforces 0% added waste and direct formulation scaling', () => {
    const recipe = createWeightOnlyRecipe();
    // 2 full recipe batches
    const result = calculateProduction(recipe, [], {
      mode: 'full_recipe',
      fullRecipeCount: 2,
      defaultWeightUnit: 'g',
    });

    const baseWeight = calculateRecipeBaseWeightGrams(recipe);
    assert.strictEqual(result.scalingMultiplier, 2);
    assert.strictEqual(result.recipeWastePercent, 0);
    assert.strictEqual(result.overrideWastePercent, 0);
    assert.strictEqual(result.totalBatchWeightGrams, baseWeight * 2);

    // Each ingredient is scaled by exactly 2x with 0% added waste
    result.calculatedIngredients.forEach((ing) => {
      const orig = recipe.ingredients.find((i) => i.id === ing.id)!;
      if (ing.id === 'ing-butter') {
        // Butter is automatically converted to lb (500g * 2 = 1000g = 2.2 lb)
        assert.strictEqual(ing.convertedQuantityInDefaultUnit, 1000);
      } else {
        assert.strictEqual(ing.requiredQuantity, orig.quantity * 2);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // W12: Full Mixer Capacity behavior remains correct (0% waste, scales to limit)
  // ---------------------------------------------------------------------------
  it('W12: Full Mixer Capacity mode enforces 0% added waste and scales to mixer limit', () => {
    const recipe = createWeightOnlyRecipe();
    // 1 mixer batch on Hobart 80 (100 lb capacity)
    const result = calculateProduction(recipe, [], {
      mode: 'full_mixer',
      fullMixerBatches: 1,
      mixer: sampleMixer,
      defaultWeightUnit: 'lb',
    });

    assert.strictEqual(result.recipeWastePercent, 0);
    assert.strictEqual(result.overrideWastePercent, 0);
    assert.strictEqual(result.isCapacityExceeded, false);

    // Mix weight equals mixer capacity: 100 lb
    assert(Math.abs(result.displayBatchWeight - 100) < 0.01);
  });

  // ---------------------------------------------------------------------------
  // W13: Original Recipe object remains deeply unchanged after calculation
  // ---------------------------------------------------------------------------
  it('W13: Original Recipe object remains deeply unchanged after calculation', () => {
    const recipe = createWeightOnlyRecipe();
    const originalJson = JSON.stringify(recipe);

    // Run multiple calculations with various options
    calculateProduction(recipe, [
      {
        id: 'req-1',
        presetName: '4 oz Case',
        quantity: 5,
        piecesPerUnit: 80,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      },
    ], { overrideWastePercent: 12 });

    calculateProduction(recipe, [], { mode: 'full_recipe', fullRecipeCount: 3 });
    calculateProduction(recipe, [], { mode: 'full_mixer', fullMixerBatches: 2, mixer: sampleMixer });

    // Verify deep immutability
    assert.strictEqual(JSON.stringify(recipe), originalJson, 'Recipe object must not be mutated by calculations');
  });

  // ---------------------------------------------------------------------------
  // W14: No Master Ingredient or pantry data is mutated
  // ---------------------------------------------------------------------------
  it('W14: Master Ingredient records remain completely unmutated by calculations', () => {
    const masterIngredient: MasterIngredient = {
      id: 'mi-test-flour',
      userId: 'test-user',
      name: 'All-Purpose Flour',
      category: 'Flour',
      netWeight: 50,
      netWeightUnit: 'lb',
      packageType: 'Bag',
      pieceWeightGrams: undefined,
    };
    const masterJson = JSON.stringify(masterIngredient);

    const recipe = createWeightOnlyRecipe();
    calculateProduction(recipe, [
      {
        id: 'req-1',
        presetName: 'Test',
        quantity: 1,
        piecesPerUnit: 80,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      },
    ], { defaultWastePercent: 4 });

    assert.strictEqual(JSON.stringify(masterIngredient), masterJson, 'MasterIngredient must remain immutable');
  });

  // ---------------------------------------------------------------------------
  // W15: Existing production history records remain unchanged
  // ---------------------------------------------------------------------------
  it('W15: Existing production history records remain completely unchanged', () => {
    const historicalEntry: ProductionHistoryEntry = {
      id: 'hist-sample-1',
      userId: 'test-user',
      recipeId: 'rec-1',
      recipeName: 'Historical Cookies',
      calculatedAt: '2026-01-01T12:00:00Z',
      requirements: [],
      totalPieces: 100,
      totalFinishedWeightGrams: 2834.95,
      displayBatchWeight: 100,
      displayWeightUnit: 'oz',
      scalingMultiplier: 1.0,
      wastePercent: 4,
      suggestedBatches: 1,
      capacityExceeded: false,
      capacityOverridden: false,
      calculatedIngredients: [],
      status: 'completed',
    };
    const historyJson = JSON.stringify(historicalEntry);

    const recipe = createWeightOnlyRecipe();
    calculateProduction(recipe, [
      {
        id: 'req-1',
        presetName: 'Test',
        quantity: 2,
        piecesPerUnit: 80,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      },
    ], { defaultWastePercent: 4 });

    assert.strictEqual(JSON.stringify(historicalEntry), historyJson, 'Historical entries must remain immutable');
  });
});
