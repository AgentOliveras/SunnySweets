import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  calculateProduction,
  resolveEffectiveWastePercent,
  isValidWastePercent,
  BAKERY_DEFAULT_WASTE_PERCENT,
} from '../src/utils/calculator';
import { ProductionModeView } from '../src/components/ProductionModeView';
import { ProductionCalculator } from '../src/components/ProductionCalculator';
import { store } from '../src/services/store';
import { Recipe, ProductionPreset, Mixer, UserSettings, ProductionItemRequirement } from '../src/types';

// Helper to create test recipes
function createTestRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'rec-test-1',
    workspaceId: 'ws-main',
    userId: 'uid-owner',
    name: 'Test Chocolate Chip',
    description: 'Test recipe formula',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    archived: false,
    ingredients: [
      { id: 'ing-flour', name: 'Flour', quantity: 2000, unit: 'g' },
      { id: 'ing-butter', name: 'Butter', quantity: 1200, unit: 'g' },
      { id: 'ing-sugar', name: 'Sugar', quantity: 1000, unit: 'g' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Canonical 2.5 oz cookie preset fixture
const PRESET_2_5_OZ: ProductionPreset = {
  id: 'preset-2.5oz-cookie',
  workspaceId: 'ws-main',
  userId: 'uid-owner',
  name: '2.5 oz Cookie Case',
  category: 'Cookies',
  finishedWeight: 2.5,
  weightUnit: 'oz',
  quantityPerUnit: 120, // 120 cookies per case
  unitName: 'Case',
  productionEnabled: true,
  criticalNotes: [
    {
      id: 'cn-chips-1',
      presetId: 'preset-2.5oz-cookie',
      recipeId: 'rec-test-1',
      note: 'Use 50% 4000ct 50% chunks.',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TEST_MIXER: Mixer = {
  id: 'mixer-hobart-60',
  workspaceId: 'ws-main',
  userId: 'uid-owner',
  name: 'Hobart 60-Qt Commercial Mixer',
  maxWeight: 80,
  weightUnit: 'lb',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TEST_SETTINGS: UserSettings = {
  userId: 'uid-owner',
  defaultWeightUnit: 'lb',
  defaultWastePercent: 6,
  decimalPlaces: 2,
  theme: 'light',
  businessName: 'Sunny Sweets, LLC',
  categoryPresetMap: { Cookies: ['Cookies'] },
  productionFloorModeEnabled: true,
};

describe('Targeted Pre-Deployment Waste Consistency Suite (T1 – T20)', () => {
  beforeEach(() => {
    (globalThis as any).localStorage?.clear();
  });

  // T1. Global default 6% with no recipe-specific value
  it('T1: Global default 6% resolves when recipe has no recipe-specific value', () => {
    const recipeNoWaste = createTestRecipe({ id: 'rec-no-waste', defaultWastePercent: undefined as any });
    const resolved = resolveEffectiveWastePercent({
      recipeWastePercent: recipeNoWaste.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolved, 6);

    const calc = calculateProduction(
      recipeNoWaste,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 6);
    assert.strictEqual(calc.recipeWastePercent, 6);
  });

  // T2. Recipe-specific 4% overrides global 6%
  it('T2: Recipe-specific 4% overrides bakery-wide global default of 6%', () => {
    const recipe4 = createTestRecipe({ id: 'rec-4', defaultWastePercent: 4 });
    const resolved = resolveEffectiveWastePercent({
      recipeWastePercent: recipe4.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolved, 4);

    const calc = calculateProduction(
      recipe4,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 4);
    assert.strictEqual(calc.recipeWastePercent, 4);
  });

  // T3. Recipe-specific 6% resolves correctly
  it('T3: Recipe-specific 6% resolves correctly', () => {
    const recipe6 = createTestRecipe({ id: 'rec-6', defaultWastePercent: 6 });
    const resolved = resolveEffectiveWastePercent({
      recipeWastePercent: recipe6.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolved, 6);

    const calc = calculateProduction(
      recipe6,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 6);
    assert.strictEqual(calc.recipeWastePercent, 6);
  });

  // T4. Explicit recipe-specific 0% is preserved
  it('T4: Explicit recipe-specific 0% is strictly preserved (never treated as missing)', () => {
    const recipe0 = createTestRecipe({ id: 'rec-0', defaultWastePercent: 0 });
    const resolved = resolveEffectiveWastePercent({
      recipeWastePercent: recipe0.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolved, 0);

    const calc = calculateProduction(
      recipe0,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 0);
    assert.strictEqual(calc.recipeWastePercent, 0);
  });

  // T5. Explicit temporary override takes precedence
  it('T5: Explicit temporary override takes precedence over both recipe and global defaults', () => {
    const recipe4 = createTestRecipe({ id: 'rec-4', defaultWastePercent: 4 });
    const resolved = resolveEffectiveWastePercent({
      overrideWastePercent: 8,
      recipeWastePercent: recipe4.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolved, 8);

    const calc = calculateProduction(
      recipe4,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { overrideWastePercent: 8, defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 8);
    assert.strictEqual(calc.overrideWastePercent, 8);
    assert.strictEqual(calc.recipeWastePercent, 4);
  });

  // T6. Temporary override 0% is valid
  it('T6: Explicit temporary override of 0% is valid and takes precedence', () => {
    const recipe4 = createTestRecipe({ id: 'rec-4', defaultWastePercent: 4 });
    const resolved = resolveEffectiveWastePercent({
      overrideWastePercent: 0,
      recipeWastePercent: recipe4.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolved, 0);

    const calc = calculateProduction(
      recipe4,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { overrideWastePercent: 0, defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 0);
    assert.strictEqual(calc.overrideWastePercent, 0);
  });

  // T7. Blank temporary override means no override
  it('T7: Blank temporary override ("" or undefined) means no override (falls back to recipe)', () => {
    const recipe4 = createTestRecipe({ id: 'rec-4', defaultWastePercent: 4 });
    assert.strictEqual(isValidWastePercent(''), false);
    assert.strictEqual(isValidWastePercent(undefined), false);

    const resolvedBlank = resolveEffectiveWastePercent({
      overrideWastePercent: '',
      recipeWastePercent: recipe4.defaultWastePercent,
      settingsWastePercent: 6,
    });
    assert.strictEqual(resolvedBlank, 4);

    const calc = calculateProduction(
      recipe4,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { overrideWastePercent: undefined, defaultWastePercent: 6 }
    );
    assert.strictEqual(calc.productionWastePercent, 4);
    assert.strictEqual(calc.overrideWastePercent, undefined);
  });

  // T8. Switching from recipe A (4%) to recipe B (6%) updates the effective value
  it('T8: Switching from recipe A (4%) to recipe B (6%) updates the effective value', () => {
    const recipeA = createTestRecipe({ id: 'rec-A', name: 'Recipe A (4%)', defaultWastePercent: 4 });
    const recipeB = createTestRecipe({ id: 'rec-B', name: 'Recipe B (6%)', defaultWastePercent: 6 });

    const valA = resolveEffectiveWastePercent({ recipeWastePercent: recipeA.defaultWastePercent, settingsWastePercent: 6 });
    const valB = resolveEffectiveWastePercent({ recipeWastePercent: recipeB.defaultWastePercent, settingsWastePercent: 6 });

    assert.strictEqual(valA, 4);
    assert.strictEqual(valB, 6);
  });

  // T9. Switching recipes does not carry an unintended temporary override
  it('T9: Management Calculator clears temporary override when switching recipes in UI', () => {
    const recipeA = createTestRecipe({ id: 'rec-A', name: 'Recipe A (4%)', defaultWastePercent: 4 });
    const recipeB = createTestRecipe({ id: 'rec-B', name: 'Recipe B (6%)', defaultWastePercent: 6 });

    const htmlA = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipeA, recipeB],
        presets: [PRESET_2_5_OZ],
        mixers: [TEST_MIXER],
        settings: TEST_SETTINGS,
        initialRecipeId: 'rec-A',
        onStartGuidedMixing: () => {},
        onSaveToHistory: async () => {},
      })
    );

    // Verify Recipe A initial render displays Default Waste: 4% and placeholder Default (4%)
    assert.match(htmlA, /Default Waste:<\/span>\s*<span class="font-mono">4%<\/span>/);
    assert.match(htmlA, /placeholder="Default \(4%\)"/);

    const htmlB = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipeA, recipeB],
        presets: [PRESET_2_5_OZ],
        mixers: [TEST_MIXER],
        settings: TEST_SETTINGS,
        initialRecipeId: 'rec-B',
        onStartGuidedMixing: () => {},
        onSaveToHistory: async () => {},
      })
    );

    // Verify Recipe B initial render displays Default Waste: 6% and placeholder Default (6%)
    assert.match(htmlB, /Default Waste:<\/span>\s*<span class="font-mono">6%<\/span>/);
    assert.match(htmlB, /placeholder="Default \(6%\)"/);
  });

  // T10. Production Floor displays the same waste percentage used by the calculation engine
  it('T10: Production Floor displays the exact same waste percentage used by the calculation engine', () => {
    const recipe4 = createTestRecipe({ id: 'rec-4', defaultWastePercent: 4 });

    const floorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [recipe4],
        presets: [PRESET_2_5_OZ],
        mixers: [TEST_MIXER],
        settings: TEST_SETTINGS,
        activeWorkspaceId: 'ws-main',
        initialRecipeId: recipe4.id,
        onExit: () => {},
      })
    );

    // Badge and headers must display 4%
    assert.match(floorHtml, /Includes 4% production waste/);

    // Perform engine calculation
    const calc = calculateProduction(
      recipe4,
      [
        {
          id: 'req-1',
          presetId: PRESET_2_5_OZ.id,
          presetName: PRESET_2_5_OZ.name,
          quantity: 1,
          piecesPerUnit: PRESET_2_5_OZ.quantityPerUnit,
          itemWeight: PRESET_2_5_OZ.finishedWeight,
          itemWeightUnit: PRESET_2_5_OZ.weightUnit,
        },
      ],
      { defaultWastePercent: 4, defaultWeightUnit: 'lb' }
    );
    assert.strictEqual(calc.productionWastePercent, 4);
    assert.strictEqual(calc.recipeWastePercent, 4);
  });

  // T11. Management Calculator and Production Floor agree for equivalent standard production calculations without temporary overrides
  it('T11: Management Calculator and Production Floor produce identical batch calculations without overrides', () => {
    const recipe4 = createTestRecipe({ id: 'rec-4', defaultWastePercent: 4 });
    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-1',
        presetId: PRESET_2_5_OZ.id,
        presetName: PRESET_2_5_OZ.name,
        quantity: 2, // 2 cases
        piecesPerUnit: PRESET_2_5_OZ.quantityPerUnit,
        itemWeight: PRESET_2_5_OZ.finishedWeight,
        itemWeightUnit: PRESET_2_5_OZ.weightUnit,
      },
    ];

    // Floor calculation (no override)
    const floorCalc = calculateProduction(recipe4, reqs, {
      overrideWastePercent: undefined,
      defaultWastePercent: 4,
      mixer: TEST_MIXER,
      defaultWeightUnit: 'lb',
    });

    // Management calculation (no override entered: overrideWastePercent is undefined)
    const mgmtCalc = calculateProduction(recipe4, reqs, {
      overrideWastePercent: undefined,
      defaultWastePercent: TEST_SETTINGS.defaultWastePercent,
      mixer: TEST_MIXER,
      defaultWeightUnit: 'lb',
    });

    assert.strictEqual(floorCalc.productionWastePercent, 4);
    assert.strictEqual(mgmtCalc.productionWastePercent, 4);
    assert.strictEqual(floorCalc.totalPieces, mgmtCalc.totalPieces);
    assert.strictEqual(floorCalc.totalFinishedWeightGrams, mgmtCalc.totalFinishedWeightGrams);
    assert.strictEqual(floorCalc.totalBatchWeightGrams, mgmtCalc.totalBatchWeightGrams);
    assert.strictEqual(floorCalc.displayBatchWeight, mgmtCalc.displayBatchWeight);
  });

  // T12. Gross dough for 10,000 g net at 6% is 10,600 g
  it('T12: Gross dough for 10,000 g net at 6% additive waste is exactly 10,600 g', () => {
    const recipe = createTestRecipe({ defaultWastePercent: 6 });
    const req: ProductionItemRequirement = {
      id: 'req-net-10k',
      presetName: '10kg Net',
      quantity: 1,
      piecesPerUnit: 1,
      itemWeight: 10000,
      itemWeightUnit: 'g',
    };

    const calc = calculateProduction(recipe, [req], { defaultWastePercent: 6, defaultWeightUnit: 'g' });
    assert.strictEqual(calc.totalFinishedWeightGrams, 10000);
    assert.strictEqual(calc.productionWastePercent, 6);
    assert.strictEqual(calc.totalBatchWeightGrams, 10600);
    assert.strictEqual(calc.displayBatchWeight, 10600);
  });

  // T13. Gross dough for 10,000 g net at 4% is 10,400 g
  it('T13: Gross dough for 10,000 g net at 4% additive waste is exactly 10,400 g', () => {
    const recipe = createTestRecipe({ defaultWastePercent: 4 });
    const req: ProductionItemRequirement = {
      id: 'req-net-10k',
      presetName: '10kg Net',
      quantity: 1,
      piecesPerUnit: 1,
      itemWeight: 10000,
      itemWeightUnit: 'g',
    };

    const calc = calculateProduction(recipe, [req], { defaultWastePercent: 4, defaultWeightUnit: 'g' });
    assert.strictEqual(calc.totalFinishedWeightGrams, 10000);
    assert.strictEqual(calc.productionWastePercent, 4);
    assert.strictEqual(calc.totalBatchWeightGrams, 10400);
    assert.strictEqual(calc.displayBatchWeight, 10400);
  });

  // T14. Full Recipe mode enforces 0% added waste
  it('T14: Full Recipe mode enforces strictly 0% added production waste', () => {
    const recipe4 = createTestRecipe({ defaultWastePercent: 4 });
    const calc = calculateProduction(recipe4, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      overrideWastePercent: 10, // Must be ignored
      defaultWastePercent: 6,
    });

    assert.strictEqual(calc.productionWastePercent, 0);
    assert.strictEqual(calc.recipeWastePercent, 0);
    assert.strictEqual(calc.overrideWastePercent, 0);
    const baseWeight = recipe4.ingredients.reduce((sum, ing) => sum + (ing.quantity as number), 0);
    assert.strictEqual(calc.totalBatchWeightGrams, baseWeight * 2);
  });

  // T15. Full Mixer mode enforces 0% added waste
  it('T15: Full Mixer mode enforces strictly 0% added production waste', () => {
    const recipe4 = createTestRecipe({ defaultWastePercent: 4 });
    const calc = calculateProduction(recipe4, [], {
      mode: 'full_mixer',
      fullMixerBatches: 1,
      mixer: TEST_MIXER,
      overrideWastePercent: 10, // Must be ignored
      defaultWastePercent: 6,
    });

    assert.strictEqual(calc.productionWastePercent, 0);
    assert.strictEqual(calc.recipeWastePercent, 0);
    assert.strictEqual(calc.overrideWastePercent, 0);
  });

  // T16. Ingredient scaling and rounding remain consistent with the existing contract
  it('T16: Ingredient scaling and rounding preserve exact formulation ratios with waste', () => {
    const recipe = createTestRecipe({ defaultWastePercent: 4 });
    const req: ProductionItemRequirement = {
      id: 'req-test',
      presetName: 'Test',
      quantity: 10,
      piecesPerUnit: 1,
      itemWeight: 420, // 4,200 g net
      itemWeightUnit: 'g',
    };

    const calc = calculateProduction(recipe, [req], { defaultWastePercent: 4, defaultWeightUnit: 'g' });
    const flour = calc.calculatedIngredients.find((i) => i.id === 'ing-flour')!;
    const sugar = calc.calculatedIngredients.find((i) => i.id === 'ing-sugar')!;
    const butter = calc.calculatedIngredients.find((i) => i.id === 'ing-butter')!;

    // Base flour (2000g) : sugar (1000g) = 2.0
    const baseFlourSugarRatio = 2000 / 1000;
    const scaledFlourSugarRatio = flour.requiredQuantity / sugar.requiredQuantity;
    assert.ok(Math.abs(baseFlourSugarRatio - scaledFlourSugarRatio) < 0.001, 'Flour to sugar ratio must be preserved');

    // Butter converted to canonical grams matches base ratio 2000 / 1200
    const butterGrams = butter.convertedQuantityInDefaultUnit ?? butter.scaledQuantity;
    const flourGrams = flour.convertedQuantityInDefaultUnit ?? flour.scaledQuantity;
    const baseFlourButterRatio = 2000 / 1200;
    const scaledFlourButterRatio = flourGrams / butterGrams;
    assert.ok(Math.abs(baseFlourButterRatio - scaledFlourButterRatio) < 0.001, 'Flour to butter ratio must be preserved');
  });

  // T17. Existing production batch behavior remains stable when presets are disabled remotely
  it('T17: Active batch calculations remain locked to effective waste when presets are disabled remotely', () => {
    const recipe = createTestRecipe({ defaultWastePercent: 4 });
    const disabledPreset: ProductionPreset = { ...PRESET_2_5_OZ, productionEnabled: false };

    const calc = calculateProduction(
      recipe,
      [
        {
          id: 'req-active-locked',
          presetId: disabledPreset.id,
          presetName: disabledPreset.name,
          quantity: 2,
          piecesPerUnit: disabledPreset.quantityPerUnit,
          itemWeight: disabledPreset.finishedWeight,
          itemWeightUnit: disabledPreset.weightUnit,
        },
      ],
      { defaultWastePercent: 4, mixer: TEST_MIXER, defaultWeightUnit: 'lb' }
    );

    assert.strictEqual(calc.productionWastePercent, 4);
    assert.strictEqual(calc.totalPieces, 240);
  });

  // T18. Critical Production Notes remain unaffected
  it('T18: Critical Production Notes remain intact on presets and are not mutated by waste calculations', () => {
    assert.strictEqual(PRESET_2_5_OZ.criticalNotes?.length, 1);
    assert.strictEqual(PRESET_2_5_OZ.criticalNotes![0].note, 'Use 50% 4000ct 50% chunks.');

    const recipe = createTestRecipe({ defaultWastePercent: 4 });
    calculateProduction(
      recipe,
      [
        {
          id: 'req-1',
          presetId: PRESET_2_5_OZ.id,
          presetName: PRESET_2_5_OZ.name,
          quantity: 1,
          piecesPerUnit: PRESET_2_5_OZ.quantityPerUnit,
          itemWeight: PRESET_2_5_OZ.finishedWeight,
          itemWeightUnit: PRESET_2_5_OZ.weightUnit,
        },
      ],
      { defaultWastePercent: 4 }
    );

    assert.strictEqual(PRESET_2_5_OZ.criticalNotes![0].note, 'Use 50% 4000ct 50% chunks.');
  });

  // T19. Invalid, missing, and legacy waste fields use documented safe behavior
  it('T19: Invalid, null, NaN, and negative waste fields fall back safely to bakery-wide 6%', () => {
    assert.strictEqual(isValidWastePercent(null), false);
    assert.strictEqual(isValidWastePercent(undefined), false);
    assert.strictEqual(isValidWastePercent(NaN), false);
    assert.strictEqual(isValidWastePercent(-5), false);
    assert.strictEqual(isValidWastePercent('invalid'), false);
    assert.strictEqual(isValidWastePercent(Infinity), false);

    const safeNull = resolveEffectiveWastePercent({ recipeWastePercent: null, settingsWastePercent: null });
    assert.strictEqual(safeNull, BAKERY_DEFAULT_WASTE_PERCENT);

    const safeNeg = resolveEffectiveWastePercent({ recipeWastePercent: -3, settingsWastePercent: 6 });
    assert.strictEqual(safeNeg, 6);

    const safeNaN = resolveEffectiveWastePercent({ recipeWastePercent: 'bad', settingsWastePercent: 6 });
    assert.strictEqual(safeNaN, 6);
  });

  // T20. No temporary override is persisted without an explicit save action
  it('T20: Temporary override does not modify stored recipe or user settings object', () => {
    const originalRecipe = createTestRecipe({ defaultWastePercent: 4 });
    const originalJson = JSON.stringify(originalRecipe);
    const originalSettings = { ...TEST_SETTINGS };
    const settingsJson = JSON.stringify(originalSettings);

    calculateProduction(
      originalRecipe,
      [{ id: 'req-1', presetName: 'Custom', quantity: 10, piecesPerUnit: 1, itemWeight: 100, itemWeightUnit: 'g' }],
      { overrideWastePercent: 12, defaultWastePercent: originalSettings.defaultWastePercent }
    );

    assert.strictEqual(JSON.stringify(originalRecipe), originalJson, 'Recipe object must not be mutated');
    assert.strictEqual(JSON.stringify(originalSettings), settingsJson, 'Settings object must not be mutated');
    assert.strictEqual(originalRecipe.defaultWastePercent, 4);
    assert.strictEqual(originalSettings.defaultWastePercent, 6);
  });
});
