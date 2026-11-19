import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  Recipe,
  ProductionItemRequirement,
  MasterIngredient,
  UserSettings,
} from '../src/types';
import {
  calculateProduction,
  calculateRecipeBaseWeightGrams,
} from '../src/utils/calculator';
import {
  toGrams,
  fromGrams,
  convertWeight,
  convertIngredientForDisplay,
  PRODUCTION_DISPLAY_MODES,
  formatNumber,
} from '../src/utils/units';

describe('Phase 2B.5.5 — Measurement Architecture Hardening & Production Display Modes', () => {
  // Test Recipe with mixed measurement units as specified in forensic audit & Phase 2B.5.5 brief:
  // Butter ................. 4 lb
  // Sugar .................. 1,360 g
  // Dark Brown Sugar ....... 1.5 kg
  // Vanilla Extract ........ 2 oz
  // Flour .................. 5 lb
  // Chocolate Chips ........ 2,400 g
  // Large Eggs ............. 24 eggs
  const mixedUnitsRecipe: Recipe = {
    id: 'rec-mixed-audit',
    name: 'Artisan Mixed-Unit Chocolate Chip Cookies',
    description: 'Controlled mixed-measurement test recipe for forensic architecture trace.',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'Cookies',
    defaultWastePercent: 0,
    ingredients: [
      { id: 'i-butter', name: 'Butter', quantity: 4, unit: 'lb' },
      { id: 'i-sugar', name: 'Sugar', quantity: 1360, unit: 'g' },
      { id: 'i-brown-sugar', name: 'Dark Brown Sugar', quantity: 1.5, unit: 'kg' },
      { id: 'i-vanilla', name: 'Vanilla Extract', quantity: 2, unit: 'oz' },
      { id: 'i-flour', name: 'All-Purpose Flour', quantity: 5, unit: 'lb' },
      { id: 'i-chips', name: 'Chocolate Chips', quantity: 2400, unit: 'g' },
      { id: 'i-eggs', name: 'Large Eggs', quantity: 24, unit: 'eggs' },
    ],
    userId: 'user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  // 2.5x scaling via Full Recipe mode (2.5 batches)
  const scaling2_5x = (displayMode: any, extra = {}) => ({
    mode: 'full_recipe' as const,
    fullRecipeBatches: 2.5,
    displayMode,
    ...extra,
  });

  describe('1. Authoritative Three-Layer Measurement Architecture', () => {
    it('MD1: Layer 1 — Stored recipe formulation preserves exact entered units and quantities', () => {
      const copy = JSON.parse(JSON.stringify(mixedUnitsRecipe));

      // Calculate production at 2.5x with various display modes
      calculateProduction(copy, [], scaling2_5x('as_entered'));
      calculateProduction(copy, [], scaling2_5x('g'));
      calculateProduction(copy, [], scaling2_5x('kg'));
      calculateProduction(copy, [], scaling2_5x('oz'));
      calculateProduction(copy, [], scaling2_5x('lb'));

      // Invariant: original recipe formulation lines are 100% immutable
      assert.strictEqual(copy.ingredients[0].quantity, 4);
      assert.strictEqual(copy.ingredients[0].unit, 'lb');
      assert.strictEqual(copy.ingredients[1].quantity, 1360);
      assert.strictEqual(copy.ingredients[1].unit, 'g');
      assert.strictEqual(copy.ingredients[2].quantity, 1.5);
      assert.strictEqual(copy.ingredients[2].unit, 'kg');
      assert.strictEqual(copy.ingredients[3].quantity, 2);
      assert.strictEqual(copy.ingredients[3].unit, 'oz');
      assert.strictEqual(copy.ingredients[4].quantity, 5);
      assert.strictEqual(copy.ingredients[4].unit, 'lb');
      assert.strictEqual(copy.ingredients[5].quantity, 2400);
      assert.strictEqual(copy.ingredients[5].unit, 'g');
      assert.strictEqual(copy.ingredients[6].quantity, 24);
      assert.strictEqual(copy.ingredients[6].unit, 'eggs');
    });

    it('MD2: Layer 2 — Canonical internal calculation unit is Grams (g) for mass', () => {
      // 4 lb butter = 1814.36948 g
      // 1360 g sugar = 1360 g
      // 1.5 kg brown sugar = 1500 g
      // 2 oz vanilla = 56.69904625 g
      // 5 lb flour = 2267.96185 g
      // 2400 g chips = 2400 g
      // Expected total base weight in grams:
      const expectedTotalGrams =
        4 * 453.59237 +
        1360 +
        1.5 * 1000 +
        2 * 28.349523125 +
        5 * 453.59237 +
        2400;

      const baseWeight = calculateRecipeBaseWeightGrams(mixedUnitsRecipe);
      assert(
        Math.abs(baseWeight - expectedTotalGrams) < 0.01,
        `Expected base weight ~${expectedTotalGrams}, got ${baseWeight}`
      );
    });

    it('MD3: Layer 3 — Production display mode is presentation only and does not alter underlying quantities', () => {
      const calcEntered = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('as_entered'));
      const calcG = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('g'));

      // Both must calculate identical total pieces and underlying scaled finished weight
      assert.strictEqual(calcEntered.totalPieces, 250);
      assert.strictEqual(calcG.totalPieces, 250);
      assert.strictEqual(calcEntered.scalingMultiplier, 2.5);
      assert.strictEqual(calcG.scalingMultiplier, 2.5);
    });
  });

  describe('2. Production Measurement Display Selector & Options', () => {
    it('MD4: PRODUCTION_DISPLAY_MODES lists all 5 authoritative options with As Entered as first option', () => {
      assert.strictEqual(PRODUCTION_DISPLAY_MODES.length, 5);
      assert.strictEqual(PRODUCTION_DISPLAY_MODES[0].value, 'as_entered');
      assert.strictEqual(PRODUCTION_DISPLAY_MODES[0].label, 'As Entered');
      assert.strictEqual(PRODUCTION_DISPLAY_MODES[1].value, 'g');
      assert.strictEqual(PRODUCTION_DISPLAY_MODES[2].value, 'kg');
      assert.strictEqual(PRODUCTION_DISPLAY_MODES[3].value, 'oz');
      assert.strictEqual(PRODUCTION_DISPLAY_MODES[4].value, 'lb');
    });

    it('MD5: calculateProduction defaults to as_entered when displayMode option is omitted or undefined', () => {
      const res = calculateProduction(mixedUnitsRecipe, [], { mode: 'full_recipe', fullRecipeBatches: 2.5 });
      assert.strictEqual(res.displayMode, 'as_entered');
    });
  });

  describe('3. Mode Behavior: As Entered (Authoritative Default)', () => {
    it('MD6: At 2.5× scaling, As Entered displays each ingredient in its original entry unit', () => {
      const res = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('as_entered'));

      const butter = res.calculatedIngredients.find((i) => i.name === 'Butter')!;
      const sugar = res.calculatedIngredients.find((i) => i.name === 'Sugar')!;
      const brownSugar = res.calculatedIngredients.find((i) => i.name === 'Dark Brown Sugar')!;
      const vanilla = res.calculatedIngredients.find((i) => i.name === 'Vanilla Extract')!;
      const flour = res.calculatedIngredients.find((i) => i.name === 'All-Purpose Flour')!;
      const chips = res.calculatedIngredients.find((i) => i.name === 'Chocolate Chips')!;
      const eggs = res.calculatedIngredients.find((i) => i.name === 'Large Eggs')!;

      // Butter: 4 lb * 2.5 = 10 lb
      assert.strictEqual(butter.requiredUnit, 'lb');
      assert.strictEqual(butter.requiredQuantity, 10);

      // Sugar: 1360 g * 2.5 = 3,400 g
      assert.strictEqual(sugar.requiredUnit, 'g');
      assert.strictEqual(sugar.requiredQuantity, 3400);

      // Dark Brown Sugar: 1.5 kg * 2.5 = 3.75 kg
      assert.strictEqual(brownSugar.requiredUnit, 'kg');
      assert.strictEqual(brownSugar.requiredQuantity, 3.75);

      // Vanilla Extract: 2 oz * 2.5 = 5 oz
      assert.strictEqual(vanilla.requiredUnit, 'oz');
      assert.strictEqual(vanilla.requiredQuantity, 5);

      // Flour: 5 lb * 2.5 = 12.5 lb
      assert.strictEqual(flour.requiredUnit, 'lb');
      assert.strictEqual(flour.requiredQuantity, 12.5);

      // Chocolate Chips: 2400 g * 2.5 = 6,000 g
      assert.strictEqual(chips.requiredUnit, 'g');
      assert.strictEqual(chips.requiredQuantity, 6000);

      // Large Eggs: 24 eggs * 2.5 = 60 eggs
      assert.strictEqual(eggs.requiredUnit, 'eggs');
      assert.strictEqual(eggs.requiredQuantity, 60);
    });
  });

  describe('4. Mode Behavior: Grams (g)', () => {
    it('MD7: All mass ingredients convert and display in grams (g)', () => {
      const res = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('g'));

      const butter = res.calculatedIngredients.find((i) => i.name === 'Butter')!;
      const sugar = res.calculatedIngredients.find((i) => i.name === 'Sugar')!;
      const brownSugar = res.calculatedIngredients.find((i) => i.name === 'Dark Brown Sugar')!;
      const vanilla = res.calculatedIngredients.find((i) => i.name === 'Vanilla Extract')!;
      const flour = res.calculatedIngredients.find((i) => i.name === 'All-Purpose Flour')!;
      const chips = res.calculatedIngredients.find((i) => i.name === 'Chocolate Chips')!;
      const eggs = res.calculatedIngredients.find((i) => i.name === 'Large Eggs')!;

      // Butter: 10 lb in g = 4,536 g (4535.92 g rounded)
      assert.strictEqual(butter.requiredUnit, 'g');
      assert.strictEqual(butter.requiredQuantity, 4536);

      // Sugar: 3,400 g
      assert.strictEqual(sugar.requiredUnit, 'g');
      assert.strictEqual(sugar.requiredQuantity, 3400);

      // Brown sugar: 3.75 kg in g = 3,750 g
      assert.strictEqual(brownSugar.requiredUnit, 'g');
      assert.strictEqual(brownSugar.requiredQuantity, 3750);

      // Vanilla extract: 5 oz in g = 142 g (141.75 g rounded)
      assert.strictEqual(vanilla.requiredUnit, 'g');
      assert.strictEqual(vanilla.requiredQuantity, 142);

      // Flour: 12.5 lb in g = 5,670 g (5669.9 g rounded)
      assert.strictEqual(flour.requiredUnit, 'g');
      assert.strictEqual(flour.requiredQuantity, 5670);

      // Chocolate chips: 6,000 g
      assert.strictEqual(chips.requiredUnit, 'g');
      assert.strictEqual(chips.requiredQuantity, 6000);

      // Large Eggs: Discrete item remains in eggs!
      assert.strictEqual(eggs.requiredUnit, 'eggs');
      assert.strictEqual(eggs.requiredQuantity, 60);
    });
  });

  describe('5. Mode Behavior: Kilograms (kg)', () => {
    it('MD8: All mass ingredients convert and display in kilograms (kg) with 3 decimals', () => {
      const res = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('kg'));

      const sugar = res.calculatedIngredients.find((i) => i.name === 'Sugar')!;
      const brownSugar = res.calculatedIngredients.find((i) => i.name === 'Dark Brown Sugar')!;
      const chips = res.calculatedIngredients.find((i) => i.name === 'Chocolate Chips')!;
      const eggs = res.calculatedIngredients.find((i) => i.name === 'Large Eggs')!;

      // Sugar: 3400 g = 3.4 kg
      assert.strictEqual(sugar.requiredUnit, 'kg');
      assert.strictEqual(sugar.requiredQuantity, 3.4);

      // Brown sugar: 3.75 kg
      assert.strictEqual(brownSugar.requiredUnit, 'kg');
      assert.strictEqual(brownSugar.requiredQuantity, 3.75);

      // Chocolate chips: 6000 g = 6 kg
      assert.strictEqual(chips.requiredUnit, 'kg');
      assert.strictEqual(chips.requiredQuantity, 6);

      // Large Eggs: Remains 60 eggs
      assert.strictEqual(eggs.requiredUnit, 'eggs');
      assert.strictEqual(eggs.requiredQuantity, 60);
    });
  });

  describe('6. Mode Behavior: Ounces (oz)', () => {
    it('MD9: All mass ingredients convert and display in ounces (oz) with 2 decimals', () => {
      const res = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('oz'));

      const butter = res.calculatedIngredients.find((i) => i.name === 'Butter')!;
      const vanilla = res.calculatedIngredients.find((i) => i.name === 'Vanilla Extract')!;
      const eggs = res.calculatedIngredients.find((i) => i.name === 'Large Eggs')!;

      // Butter: 10 lb = 160 oz
      assert.strictEqual(butter.requiredUnit, 'oz');
      assert.strictEqual(butter.requiredQuantity, 160);

      // Vanilla extract: 5 oz
      assert.strictEqual(vanilla.requiredUnit, 'oz');
      assert.strictEqual(vanilla.requiredQuantity, 5);

      // Large eggs: Remains 60 eggs
      assert.strictEqual(eggs.requiredUnit, 'eggs');
      assert.strictEqual(eggs.requiredQuantity, 60);
    });
  });

  describe('7. Mode Behavior: Pounds (lb)', () => {
    it('MD10: All mass ingredients convert and display in pounds (lb) with 2 decimals', () => {
      const res = calculateProduction(mixedUnitsRecipe, [], scaling2_5x('lb'));

      const butter = res.calculatedIngredients.find((i) => i.name === 'Butter')!;
      const flour = res.calculatedIngredients.find((i) => i.name === 'All-Purpose Flour')!;
      const sugar = res.calculatedIngredients.find((i) => i.name === 'Sugar')!;
      const eggs = res.calculatedIngredients.find((i) => i.name === 'Large Eggs')!;

      // Butter: 10 lb
      assert.strictEqual(butter.requiredUnit, 'lb');
      assert.strictEqual(butter.requiredQuantity, 10);

      // Flour: 12.5 lb
      assert.strictEqual(flour.requiredUnit, 'lb');
      assert.strictEqual(flour.requiredQuantity, 12.5);

      // Sugar: 3400 g = 3400 / 453.59237 = 7.50 lb
      assert.strictEqual(sugar.requiredUnit, 'lb');
      assert.strictEqual(sugar.requiredQuantity, 7.5);

      // Large eggs: Remains 60 eggs
      assert.strictEqual(eggs.requiredUnit, 'eggs');
      assert.strictEqual(eggs.requiredQuantity, 60);
    });
  });

  describe('8. Production Waste & Scaling Invariance', () => {
    it('MD11: Production waste factor applies uniformly across all measurement display modes', () => {
      // 5% whole-batch production waste: multiplier = 2.5 * 1.05 = 2.625
      const reqs: ProductionItemRequirement[] = [{
        id: 'req-1',
        presetName: 'Box',
        quantity: 250,
        piecesPerUnit: 1,
        itemWeight: 93.9903037625,
        itemWeightUnit: 'g',
      }];
      const resEntered = calculateProduction(mixedUnitsRecipe, reqs, {
        overrideWastePercent: 5,
        displayMode: 'as_entered',
      });
      const resG = calculateProduction(mixedUnitsRecipe, reqs, {
        overrideWastePercent: 5,
        displayMode: 'g',
      });

      const butterEntered = resEntered.calculatedIngredients.find((i) => i.name === 'Butter')!;
      const butterG = resG.calculatedIngredients.find((i) => i.name === 'Butter')!;

      // In entered mode: 4 lb * 2.625 = 10.5 lb
      assert.strictEqual(butterEntered.requiredUnit, 'lb');
      assert.strictEqual(butterEntered.requiredQuantity, 10.5);

      // In g mode: 10.5 lb = 4,763 g (4762.72 g rounded)
      assert.strictEqual(butterG.requiredUnit, 'g');
      assert.strictEqual(butterG.requiredQuantity, 4763);
    });
  });

  describe('9. UI Components & Selectors Verification', () => {
    it('MD12: ProductionModeView renders production-display-mode-selector with all 5 buttons', () => {
      const modeViewContent = fs.readFileSync(
        path.join(process.cwd(), 'src/components/ProductionModeView.tsx'),
        'utf-8'
      );
      assert(
        modeViewContent.includes('id="production-display-mode-selector"'),
        'Must contain production-display-mode-selector'
      );
      assert(
        modeViewContent.includes('display-mode-btn-'),
        'Must contain individual display-mode buttons'
      );
      assert(
        modeViewContent.includes('PRODUCTION_DISPLAY_MODES'),
        'Must import and map over PRODUCTION_DISPLAY_MODES'
      );
    });

    it('MD13: ProductionCalculator renders calc-display-mode-selector and table-display-mode-selector', () => {
      const calcContent = fs.readFileSync(
        path.join(process.cwd(), 'src/components/ProductionCalculator.tsx'),
        'utf-8'
      );
      assert(
        calcContent.includes('id="calc-display-mode-selector"'),
        'Must contain calc-display-mode-selector'
      );
      assert(
        calcContent.includes('id="table-display-mode-selector"'),
        'Must contain table-display-mode-selector'
      );
    });

    it('MD14: SettingsView renders Default Production Display Mode setting', () => {
      const settingsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/components/SettingsView.tsx'),
        'utf-8'
      );
      assert(
        settingsContent.includes('Default Production Display Mode'),
        'Must contain Default Production Display Mode label'
      );
      assert(
        settingsContent.includes('settings-display-mode-'),
        'Must contain display mode setting buttons'
      );
    });
  });

  describe('10. Scope Boundaries & Protection Invariants', () => {
    it('MD15: Convert to Production Recipe remains disabled with Phase 2B.6 lock', () => {
      const projectEditorContent = fs.readFileSync(
        path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx'),
        'utf-8'
      );
      assert(
        projectEditorContent.includes('Phase 2B.6'),
        'Convert to Production Recipe must remain locked until Phase 2B.6'
      );
    });

    it('MD16: convertIngredientForDisplay helper preserves discrete and converts weight correctly', () => {
      // Discrete count remains untouched
      const discreteRes = convertIngredientForDisplay(24, 'eggs', 'lb');
      assert.strictEqual(discreteRes.quantity, 24);
      assert.strictEqual(discreteRes.unit, 'eggs');
      assert.strictEqual(discreteRes.wasConverted, false);

      // As entered returns as entered
      const asEnteredRes = convertIngredientForDisplay(4, 'lb', 'as_entered');
      assert.strictEqual(asEnteredRes.quantity, 4);
      assert.strictEqual(asEnteredRes.unit, 'lb');
      assert.strictEqual(asEnteredRes.wasConverted, false);

      // Weight conversion
      const wtRes = convertIngredientForDisplay(4, 'lb', 'g');
      assert(Math.abs(wtRes.quantity - 1814.369) < 0.1);
      assert.strictEqual(wtRes.unit, 'g');
      assert.strictEqual(wtRes.wasConverted, true);
    });
  });
});
