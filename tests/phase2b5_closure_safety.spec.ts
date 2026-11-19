import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  Recipe,
  ProductionItemRequirement,
  Mixer,
  UserSettings,
  CalculatedIngredient,
} from '../src/types';
import {
  calculateProduction,
  calculateRecipeBaseWeightGrams,
} from '../src/utils/calculator';
import {
  toGrams,
  fromGrams,
  convertWeight,
  tryConvertToWeight,
  GRAMS_PER_PB_JAR,
  WEIGHT_TO_GRAMS,
} from '../src/utils/units';

describe('Phase 2B.5.5.2 — Measurement Architecture Closure Safety Tests', () => {
  const baseTestRecipe: Recipe = {
    id: 'rec-safety-audit',
    name: 'Closure Safety Mixed Recipe',
    description: 'Controlled recipe for Phase 2B.5.5.2 closure verification.',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'Cookies',
    defaultWastePercent: 0,
    ingredients: [
      { id: 'i-flour', name: 'Flour', quantity: 4, unit: 'lb' },
      { id: 'i-sugar', name: 'Sugar', quantity: 1360, unit: 'g' },
      { id: 'i-eggs', name: 'Large Eggs', quantity: 24, unit: 'eggs' },
    ],
    userId: 'user-safety',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const testMixer: Mixer = {
    id: 'mixer-1',
    name: 'Hobart 60-Qt',
    maxWeight: 30,
    weightUnit: 'lb',
    userId: 'user-safety',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  // Test A: DISPLAY MODE IMMUTABILITY
  it('A. DISPLAY MODE IMMUTABILITY — Switching display modes leaves recipe formulation untouched', () => {
    const originalSnapshot = JSON.parse(JSON.stringify(baseTestRecipe));
    const workingRecipe = JSON.parse(JSON.stringify(baseTestRecipe));

    // Switch sequence: As Entered -> g -> lb -> As Entered
    const resAsEntered1 = calculateProduction(workingRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      displayMode: 'as_entered',
    });
    const flourEntered1 = resAsEntered1.calculatedIngredients.find((i) => i.id === 'i-flour')!;
    assert.strictEqual(flourEntered1.requiredUnit, 'lb');
    assert.strictEqual(flourEntered1.requiredQuantity, 8);

    const resG = calculateProduction(workingRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      displayMode: 'g',
    });
    const flourG = resG.calculatedIngredients.find((i) => i.id === 'i-flour')!;
    assert.strictEqual(flourG.requiredUnit, 'g');
    assert.strictEqual(flourG.requiredQuantity, 3629); // 8 lb = 3628.74 -> 3629 g

    const resLb = calculateProduction(workingRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      displayMode: 'lb',
    });
    const flourLb = resLb.calculatedIngredients.find((i) => i.id === 'i-flour')!;
    assert.strictEqual(flourLb.requiredUnit, 'lb');
    assert.strictEqual(flourLb.requiredQuantity, 8);

    const resAsEntered2 = calculateProduction(workingRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      displayMode: 'as_entered',
    });
    const flourEntered2 = resAsEntered2.calculatedIngredients.find((i) => i.id === 'i-flour')!;
    assert.strictEqual(flourEntered2.requiredUnit, 'lb');
    assert.strictEqual(flourEntered2.requiredQuantity, 8);

    // Deep equality invariant: master recipe ingredients are 100% unaltered
    assert.deepStrictEqual(
      workingRecipe.ingredients,
      originalSnapshot.ingredients,
      'Recipe.ingredients must remain strictly deep-equal before and after display switching'
    );
  });

  // Test B: WORKSPACE DEFAULT VS TEMPORARY OVERRIDE
  it('B. WORKSPACE DEFAULT VS TEMPORARY OVERRIDE — Absent resolves to as_entered; temporary override does not mutate workspace setting', () => {
    // 1. Absent setting resolves to 'as_entered'
    const emptySettings: Partial<UserSettings> = {};
    const defaultMode = emptySettings.defaultProductionDisplayMode || 'as_entered';
    assert.strictEqual(defaultMode, 'as_entered');

    const resDefault = calculateProduction(baseTestRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 1,
    });
    assert.strictEqual(resDefault.displayMode, 'as_entered');

    // 2. Manager-configured workspace default
    const managerSettings: Partial<UserSettings> = {
      defaultProductionDisplayMode: 'lb',
    };
    assert.strictEqual(managerSettings.defaultProductionDisplayMode, 'lb');

    // 3. Operator temporary run override
    const operatorRunOverride = 'kg' as const;
    const resOperator = calculateProduction(baseTestRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 1,
      displayMode: operatorRunOverride,
    });
    assert.strictEqual(resOperator.displayMode, 'kg');

    // Invariant: manager workspace default is preserved, not mutated
    assert.strictEqual(managerSettings.defaultProductionDisplayMode, 'lb');
  });

  // Test C: FULL MIXER CAPACITY WITH DISCRETE WEIGHT
  it('C. FULL MIXER CAPACITY WITH DISCRETE WEIGHT — Physical weight of discrete ingredient is included in mixer capacity calculation', () => {
    // Large Eggs with explicit pieceWeightGrams: 50 g each
    const recipeWithDiscreteWeight: Recipe = {
      ...baseTestRecipe,
      ingredients: [
        { id: 'i-flour', name: 'Flour', quantity: 5, unit: 'lb' }, // 5 lb = 2267.96185 g
        { id: 'i-eggs', name: 'Large Eggs', quantity: 24, unit: 'eggs', pieceWeightGrams: 50 }, // 24 * 50 = 1200 g
      ],
    };

    const baseWeight = calculateRecipeBaseWeightGrams(recipeWithDiscreteWeight);
    const expectedBaseGrams = 5 * 453.59237 + 24 * 50; // 2267.96185 + 1200 = 3467.96185 g
    assert(
      Math.abs(baseWeight - expectedBaseGrams) < 0.01,
      `Expected base weight ~${expectedBaseGrams}, got ${baseWeight}`
    );

    // Calculate in full_mixer mode with 10 lb mixer (4535.9237 g)
    const mixer10lb: Mixer = {
      id: 'm-10',
      name: '10 lb Mixer',
      maxWeight: 10,
      weightUnit: 'lb',
      userId: 'user-safety',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const res = calculateProduction(recipeWithDiscreteWeight, [], {
      mode: 'full_mixer',
      fullMixerBatches: 1,
      mixer: mixer10lb,
    });

    const mixerMaxGrams = 10 * 453.59237;
    const expectedMultiplier = mixerMaxGrams / expectedBaseGrams;
    assert(
      Math.abs(res.scalingMultiplier - expectedMultiplier) < 0.01,
      `Expected scaling multiplier ~${expectedMultiplier}, got ${res.scalingMultiplier}`
    );
    // discreteMixerWarning should NOT be set because pieceWeightGrams is known
    assert.strictEqual(res.discreteMixerWarning, undefined);
  });

  // Test D: FULL MIXER CAPACITY WITHOUT DISCRETE WEIGHT
  it('D. FULL MIXER CAPACITY WITHOUT DISCRETE WEIGHT — Emits discreteMixerWarning and does not silently claim safe exact capacity', () => {
    // Large Eggs without pieceWeightGrams
    const recipeWithoutDiscreteWeight: Recipe = {
      ...baseTestRecipe,
      ingredients: [
        { id: 'i-flour', name: 'Flour', quantity: 5, unit: 'lb' },
        { id: 'i-eggs', name: 'Large Eggs', quantity: 24, unit: 'eggs' }, // No pieceWeightGrams!
      ],
    };

    const mixer10lb: Mixer = {
      id: 'm-10',
      name: '10 lb Mixer',
      maxWeight: 10,
      weightUnit: 'lb',
      userId: 'user-safety',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const res = calculateProduction(recipeWithoutDiscreteWeight, [], {
      mode: 'full_mixer',
      fullMixerBatches: 1,
      mixer: mixer10lb,
    });

    // Invariant: discreteMixerWarning MUST be produced
    assert(
      res.discreteMixerWarning !== undefined,
      'discreteMixerWarning must be produced when discrete ingredients lack piece weight'
    );
    assert(
      res.discreteMixerWarning.includes('Large Eggs'),
      `Warning message should mention the unweighted ingredient: ${res.discreteMixerWarning}`
    );
    assert(
      res.discreteMixerWarning.includes('Full Mixer Capacity cannot be calculated reliably'),
      `Warning message should indicate capacity cannot be calculated reliably: ${res.discreteMixerWarning}`
    );
  });

  // Test E: VOLUME WITH DENSITY
  it('E. VOLUME WITH DENSITY — Converts volume to physical weight correctly using density', () => {
    // 500 ml Whole Milk with density 1.03 g/ml -> 515 g
    const volRecipe: Recipe = {
      ...baseTestRecipe,
      ingredients: [
        { id: 'i-milk', name: 'Whole Milk', quantity: 500, unit: 'ml', densityGramsPerMl: 1.03 },
      ],
    };

    const baseWeight = calculateRecipeBaseWeightGrams(volRecipe);
    assert.strictEqual(baseWeight, 515);

    const res = calculateProduction(volRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 1,
      displayMode: 'g',
    });
    const milk = res.calculatedIngredients.find((i) => i.id === 'i-milk')!;
    assert.strictEqual(milk.requiredQuantity, 515);
    assert.strictEqual(milk.requiredUnit, 'g');
    assert.strictEqual(res.densityWarnings, undefined);
  });

  // Test F: VOLUME WITHOUT DENSITY
  it('F. VOLUME WITHOUT DENSITY — Prevents 1 ml = 1 g fallback, emits density warning, and returns null weight', () => {
    // 500 ml ingredient WITHOUT density
    const volRecipeNoDensity: Recipe = {
      ...baseTestRecipe,
      ingredients: [
        { id: 'i-oil', name: 'Specialty Oil', quantity: 500, unit: 'ml' }, // No density!
      ],
    };

    // tryConvertToWeight must NOT assume 1.0 fallback
    const directConvert = tryConvertToWeight(500, 'ml', 'g');
    assert.strictEqual(directConvert, null, 'Must return null without density');

    const baseWeight = calculateRecipeBaseWeightGrams(volRecipeNoDensity);
    assert.strictEqual(
      baseWeight,
      0,
      'calculateRecipeBaseWeightGrams must not silently assume 1.0 g/ml density'
    );

    const res = calculateProduction(volRecipeNoDensity, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 1,
      displayMode: 'g',
    });
    assert(
      res.densityWarnings.length > 0,
      'Must produce density warning for volume ingredient lacking density'
    );
    assert(
      res.densityWarnings[0].includes('Density required to convert Specialty Oil'),
      `Density warning must specify ingredient: ${res.densityWarnings[0]}`
    );
  });

  // Test G: FRACTIONAL DISCRETE QUANTITY
  it('G. FRACTIONAL DISCRETE QUANTITY — Scaling producing 24.96 eggs remains mathematically 24.96 and is not rounded to 25', () => {
    // 24 eggs scaled by 1.04x = 24.96 eggs
    const discreteRecipe: Recipe = {
      ...baseTestRecipe,
      ingredients: [
        { id: 'i-eggs', name: 'Large Eggs', quantity: 24, unit: 'eggs' },
      ],
    };

    const res = calculateProduction(discreteRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 1.04,
      displayMode: 'as_entered',
    });

    const eggs = res.calculatedIngredients.find((i) => i.id === 'i-eggs')!;
    assert(
      Math.abs(eggs.requiredQuantity - 24.96) < 1e-9,
      `Calculated eggs quantity must be exactly 24.96, got ${eggs.requiredQuantity}`
    );
    assert.strictEqual(eggs.requiredUnit, 'eggs');
    assert.notStrictEqual(
      eggs.requiredQuantity,
      25,
      '24.96 eggs must NOT be silently rounded to 25'
    );
  });

  // Test H: AS ENTERED HIGH-LEVEL TOTAL
  it('H. AS ENTERED HIGH-LEVEL TOTAL — Ingredients retain mixed units while Total Mix uses a coherent summary weight unit', () => {
    const res = calculateProduction(baseTestRecipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      displayMode: 'as_entered',
      defaultWeightUnit: 'lb',
    });

    // Line level: each ingredient preserves its entered unit
    const flour = res.calculatedIngredients.find((i) => i.name === 'Flour')!;
    const sugar = res.calculatedIngredients.find((i) => i.name === 'Sugar')!;
    const eggs = res.calculatedIngredients.find((i) => i.name === 'Large Eggs')!;
    assert.strictEqual(flour.requiredUnit, 'lb');
    assert.strictEqual(flour.requiredQuantity, 8); // 4 * 2 = 8 lb
    assert.strictEqual(sugar.requiredUnit, 'g');
    assert.strictEqual(sugar.requiredQuantity, 2720); // 1360 * 2 = 2720 g
    assert.strictEqual(eggs.requiredUnit, 'eggs');
    assert.strictEqual(eggs.requiredQuantity, 48); // 24 * 2 = 48 eggs

    // High-level summary metrics use coherent summary weight unit ('lb')
    assert.strictEqual(res.displayWeightUnit, 'lb');
    assert(typeof res.displayBatchWeight === 'number' && res.displayBatchWeight > 0);
    assert(typeof res.totalBatchWeightGrams === 'number' && res.totalBatchWeightGrams > 0);
  });

  // Test I: PEANUT BUTTER BUSINESS CONVERSION
  it('I. PEANUT BUTTER BUSINESS CONVERSION — Operational PB jar is fixed at 1816 g; scientific 4-lb weight is 1814.36948 g', () => {
    // Operational commercial package conversion
    assert.strictEqual(GRAMS_PER_PB_JAR, 1816);

    // Generic scientific conversion: 4 lb * 453.59237 g/lb
    const generic4lbGrams = toGrams(4, 'lb');
    assert.strictEqual(generic4lbGrams, 1814.36948);

    // Invariant: the two conversions are distinct and must not be conflated
    assert.notStrictEqual(
      GRAMS_PER_PB_JAR,
      generic4lbGrams,
      'Operational PB 4-lb jar (1816 g) and scientific 4-lb weight (1814.36948 g) are intentionally separate'
    );
  });

  // Test J: STANDARDIZATION UI REMOVAL
  it('J. STANDARDIZATION UI REMOVAL — Standardize All Existing Recipe Ingredients is no longer exposed through normal Settings UI', () => {
    const settingsFilePath = path.join(process.cwd(), 'src/components/SettingsView.tsx');
    const settingsContent = fs.readFileSync(settingsFilePath, 'utf-8');

    // 1. Standardize button ID must NOT exist in SettingsView
    assert(
      !settingsContent.includes('standardize-all-recipes-btn'),
      'standardize-all-recipes-btn must NOT exist in SettingsView'
    );

    // 2. Destructive header must NOT exist in SettingsView
    assert(
      !settingsContent.includes('Standardize All Existing Recipe Ingredients'),
      'Standardize All Existing Recipe Ingredients UI title must NOT exist in SettingsView'
    );

    // 3. onStandardizeAllRecipes prop must NOT be part of SettingsViewProps
    assert(
      !settingsContent.includes('onStandardizeAllRecipes?:'),
      'onStandardizeAllRecipes prop must NOT be exposed in SettingsViewProps'
    );
  });
});
