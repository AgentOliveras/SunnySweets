import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProductPricing,
  recalculateProductsPricing,
} from '../src/utils/quotingCalculator';
import {
  QuoteFormula,
  QuoteProductConfig,
  QuotedPricingMethod,
} from '../src/types/quoting';
import { quotingService } from '../src/services/quotingService';
import { store } from '../src/services/store';

describe('PHASE 2B.5.9 — Interactive Quoted Pricing Suite', () => {
  const TEST_WS = 'ws-main';
  const TEST_USER = 'user-owner';

  // Base formula: 10,000g total weight, $50.00 total cost
  // Cost per gram = $0.0050/g
  const baseFormula: QuoteFormula = {
    totalWeightGrams: 10000,
    totalCost: 50.0,
    costPerGram: 0.005,
    costPerLb: 2.27,
    costPerKg: 5.0,
    lines: [
      {
        id: 'flour-1',
        name: 'Bread Flour',
        quantity: 6000,
        unit: 'g',
        unitCostUsed: 0.003,
        unitCostType: 'per_gram',
        lineCost: 18.0,
      },
      {
        id: 'butter-1',
        name: 'Butter',
        quantity: 4000,
        unit: 'g',
        unitCostUsed: 0.008,
        unitCostType: 'per_gram',
        lineCost: 32.0,
      },
    ],
  };

  // Mock localStorage for lifecycle and persistence tests
  const createMockLocalStorage = () => {
    let s: Record<string, string> = {};
    return {
      getItem: (key: string) => s[key] || null,
      setItem: (key: string, val: string) => {
        s[key] = String(val);
      },
      removeItem: (key: string) => {
        delete s[key];
      },
      clear: () => {
        s = {};
      },
      get length() {
        return Object.keys(s).length;
      },
      key: (i: number) => Object.keys(s)[i] || null,
    };
  };

  // ---------------------------------------------------------------------------
  // 1. SECTION A — TARGET PRICING MODEL VERIFICATION
  // ---------------------------------------------------------------------------
  describe('1. Section A — Target Pricing Model', () => {
    it('T1: Target pricing calculates accurately with strict raw-ingredient multiplier', () => {
      // Configuration: 4 oz cookies (113.40g), 80/case
      // Case dough weight = 80 * 113.398 = 9,071.85g
      // Raw ingredient ratio = 9071.85 / 10000 = 0.907185
      // Raw ingredient cost = $50 * 0.907185 = $45.36
      // Packaging = $3.00, Labor = $11.45, Other = $1.00
      // Total COGS = $45.36 + $3.00 + $11.45 + $1.00 = $60.81
      // Target Multiplier = 2.0 (applies strictly to raw ingredients)
      // Marked-up ingredients = $45.36 * 2.0 = $90.72
      // Calculated Target Price / Case = $90.72 + $3.00 + $11.45 + $1.00 = $106.17
      // Target Price / Unit = $106.17 / 80 = $1.33
      // Expected Gross Profit / Case = $106.17 - $60.81 = $45.36
      // Target Gross Margin % = ($45.36 / $106.17) * 100 = 42.72%

      const config = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        otherCost: 1.0,
        ingredientMultiplier: 2.0,
        formula: baseFormula,
      });

      assert.strictEqual(config.totalProductionCost, 60.81, 'COGS per case');
      assert.strictEqual(config.costPerUnit, 0.76, 'COGS per unit (60.81 / 80)');
      assert.strictEqual(config.calculatedTargetPrice, 106.17, 'Target price per case');
      assert.strictEqual(config.targetPricePerUnit, 1.33, 'Target price per unit');
      assert.strictEqual(config.targetDollarProfit, 45.36, 'Expected gross profit per case');
      assert.strictEqual(config.targetGrossMarginPercent, 42.72, 'Gross margin percentage');
      assert.strictEqual(config.isTargetPriceComplete, true);
    });

    it('T2: Prompt specification example calculates identical values', () => {
      // Prompt example:
      // Raw ingredients per case: $20.00
      // Packaging per case: $5.00
      // Labor per case: $4.00
      // Other costs per case: $1.00
      // Ingredients multiplier: 3
      // Suggested price per case: ($20 × 3) + $5 + $4 + $1 = $70.00
      // Total cost per case: $20 + $5 + $4 + $1 = $30.00
      // Expected gross profit per case: $70 - $30 = $40.00
      // Gross margin: ($40 / $70) × 100 = 57.14%

      // Create a formula with $20 cost per case
      const customFormula: QuoteFormula = {
        totalWeightGrams: 1000,
        totalCost: 20.0,
        lines: [
          {
            id: 'l1',
            name: 'Mix',
            quantity: 1000,
            unit: 'g',
            unitCostUsed: 0.02,
            unitCostType: 'per_gram',
            lineCost: 20.0,
          },
        ],
      };

      const config = calculateProductPricing({
        pieceWeight: 10,
        weightUnit: 'g',
        piecesPerCase: 100, // 100 * 10g = 1000g = 100% of formula batch ($20.00 raw)
        packagingCost: 5.0,
        laborCost: 4.0,
        otherCost: 1.0,
        ingredientMultiplier: 3.0,
        formula: customFormula,
      });

      assert.strictEqual(config.rawIngredientCost, 20.0);
      assert.strictEqual(config.totalProductionCost, 30.0, 'Total cost per case');
      assert.strictEqual(config.calculatedTargetPrice, 70.0, 'Suggested price per case');
      assert.strictEqual(config.targetDollarProfit, 40.0, 'Expected gross profit per case');
      assert.strictEqual(config.targetGrossMarginPercent, 57.14, 'Gross margin');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. SECTION B — INTERACTIVE QUOTED PRICING: 4 MUTUALLY EXCLUSIVE METHODS
  // ---------------------------------------------------------------------------
  describe('2. Section B — Interactive Quoted Pricing Methods', () => {
    const setupConfig = (overrides?: any) => {
      return calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        otherCost: 0.0,
        ingredientMultiplier: 1.6,
        formula: baseFormula,
        ...overrides,
      });
    };

    // Total COGS = $45.36 (raw) + $3.00 (pack) + $11.45 (labor) + $0.00 (other) = $59.81
    it('T3: Initial state is blank without default or suggested pricing', () => {
      const config = setupConfig({
        quotedPrice: null,
        quotedPricePerUnit: null,
        quotedMethod: 'price_per_case',
        quotedMethodValue: null,
      });

      assert.strictEqual(config.quotedPrice, null, 'Quoted price must be null');
      assert.strictEqual(config.quotedPricePerUnit, null, 'Quoted price per unit must be null');
      assert.strictEqual(config.quotedMethodValue, null, 'Method input value must be null');
      assert.strictEqual(config.isQuotedPriceSet, false, 'Quote must not be marked set');
      assert.strictEqual(config.dollarProfit, 0, 'No profit calculated yet');
      assert.strictEqual(config.grossMarginPercent, 0, 'No margin calculated yet');

      // Section A must remain complete and independent
      assert.strictEqual(config.calculatedTargetPrice > 0, true, 'Section A remains valid');
      assert.strictEqual(config.isTargetPriceComplete, true);
    });

    it('T4: Mode A — Price Per Case calculates unit price, profit, and margin', () => {
      // User quotes $80.00 / case
      // Quoted price per unit = $80.00 / 80 = $1.00
      // Total COGS = $59.81
      // Gross profit = $80.00 - $59.81 = $20.19
      // Gross margin = ($20.19 / $80.00) * 100 = 25.24%

      const config = setupConfig({
        quotedMethod: 'price_per_case',
        quotedMethodValue: 80.0,
      });

      assert.strictEqual(config.quotedPrice, 80.0);
      assert.strictEqual(config.quotedPricePerUnit, 1.0);
      assert.strictEqual(config.dollarProfit, 20.19);
      assert.strictEqual(config.grossMarginPercent, 25.24);
      assert.strictEqual(config.isQuotedPriceSet, true);

      // Section A remains untouched
      assert.strictEqual(config.ingredientMultiplier, 1.6);
      assert.strictEqual(config.calculatedTargetPrice, 87.03); // (45.36 * 1.6) + 3 + 11.45 = 72.58 + 14.45 = 87.03
    });

    it('T5: Mode B — Price Per Unit calculates case price, profit, and margin', () => {
      // User quotes $1.20 / unit
      // Quoted price per case = $1.20 * 80 = $96.00
      // Total COGS = $59.81
      // Gross profit = $96.00 - $59.81 = $36.19
      // Gross margin = ($36.19 / $96.00) * 100 = 37.70%

      const config = setupConfig({
        quotedMethod: 'price_per_unit',
        quotedMethodValue: 1.2,
      });

      assert.strictEqual(config.quotedPricePerUnit, 1.2);
      assert.strictEqual(config.quotedPrice, 96.0);
      assert.strictEqual(config.dollarProfit, 36.19);
      assert.strictEqual(config.grossMarginPercent, 37.7);
      assert.strictEqual(config.isQuotedPriceSet, true);
    });

    it('T6: Mode C — Desired Gross Profit Per Case derives selling price accurately', () => {
      // User specifies $25.00 desired gross profit per case
      // Total COGS = $59.81
      // Quoted price per case = $59.81 + $25.00 = $84.81
      // Quoted price per unit = $84.81 / 80 = $1.06
      // Gross profit = $25.00
      // Gross margin = ($25.00 / $84.81) * 100 = 29.48%

      const config = setupConfig({
        quotedMethod: 'desired_profit',
        quotedMethodValue: 25.0,
      });

      assert.strictEqual(config.quotedPrice, 84.81);
      assert.strictEqual(config.quotedPricePerUnit, 1.06);
      assert.strictEqual(config.dollarProfit, 25.0);
      assert.strictEqual(config.grossMarginPercent, 29.48);
      assert.strictEqual(config.desiredProfitPerCase, 25.0);
      assert.strictEqual(config.isQuotedPriceSet, true);
    });

    it('T7: Mode D — Ingredients Multiplier applies strictly to raw ingredients', () => {
      // Raw ingredients = $45.36
      // Packaging = $3.00, Labor = $11.45, Other = $0.00 (Additive non-ingredient = $14.45)
      // Total COGS = $59.81
      // User enters multiplier = 2.50
      // Multiplier applies ONLY to raw ingredients: $45.36 * 2.50 = $113.40
      // Quoted price per case = $113.40 + $3.00 + $11.45 = $127.85
      // Quoted price per unit = $127.85 / 80 = $1.60
      // Gross profit per case = $127.85 - $59.81 = $68.04
      // Gross margin = ($68.04 / $127.85) * 100 = 53.22%

      const config = setupConfig({
        quotedMethod: 'ingredients_multiplier',
        quotedMethodValue: 2.5,
      });

      assert.strictEqual(config.quotedPrice, 127.85);
      assert.strictEqual(config.quotedPricePerUnit, 1.6);
      assert.strictEqual(config.dollarProfit, 68.04);
      assert.strictEqual(config.grossMarginPercent, 53.22);
      assert.strictEqual(config.quotedMultiplier, 2.5);
      assert.strictEqual(config.isQuotedPriceSet, true);

      // Verify that non-ingredient costs were NOT multiplied
      // If non-ingredients were mistakenly multiplied: ($59.81 * 2.5) = $149.53, which is WRONG!
      assert.notStrictEqual(config.quotedPrice, 149.53);
    });

    it('T8: Section A and Section B remain strictly independent', () => {
      // Target multiplier = 1.60 -> Target price = $87.03
      // Quoted method = Mode D with multiplier 3.00
      const config = setupConfig({
        ingredientMultiplier: 1.6,
        quotedMethod: 'ingredients_multiplier',
        quotedMethodValue: 3.0,
      });

      // Target pricing (Section A) maintains target multiplier 1.60
      assert.strictEqual(config.ingredientMultiplier, 1.6);
      assert.strictEqual(config.calculatedTargetPrice, 87.03);
      assert.strictEqual(config.targetDollarProfit, 27.22);
      assert.strictEqual(config.targetGrossMarginPercent, 31.28);

      // Interactive quote (Section B) uses quoted multiplier 3.00
      // ($45.36 * 3.0) + $14.45 = $136.08 + $14.45 = $150.53
      assert.strictEqual(config.quotedPrice, 150.53);
      assert.strictEqual(config.quotedMultiplier, 3.0);
      assert.strictEqual(config.dollarProfit, 90.72);
      assert.strictEqual(config.grossMarginPercent, 60.27);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. MULTIPLE CONFIGURATIONS & ISOLATION
  // ---------------------------------------------------------------------------
  describe('3. Multiple Configurations Independence', () => {
    it('T9: Each product configuration maintains its own independent pricing method and inputs', () => {
      const c1 = calculateProductPricing({
        id: 'cfg-1',
        name: '4 oz Cookie (80/cs)',
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        ingredientMultiplier: 1.6,
        quotedMethod: 'price_per_case',
        quotedMethodValue: 85.0,
        formula: baseFormula,
      });

      const c2 = calculateProductPricing({
        id: 'cfg-2',
        name: '2 oz Cookie (140/cs)',
        pieceWeight: 2,
        weightUnit: 'oz',
        piecesPerCase: 140,
        packagingCost: 2.5,
        laborCost: 10.0,
        ingredientMultiplier: 1.6,
        quotedMethod: 'desired_profit',
        quotedMethodValue: 30.0,
        formula: baseFormula,
      });

      const c3 = calculateProductPricing({
        id: 'cfg-3',
        name: '1 oz Cookie (360/cs)',
        pieceWeight: 1,
        weightUnit: 'oz',
        piecesPerCase: 360,
        packagingCost: 4.0,
        laborCost: 15.0,
        ingredientMultiplier: 1.6,
        quotedMethod: 'price_per_case',
        quotedMethodValue: null, // Unquoted
        formula: baseFormula,
      });

      assert.strictEqual(c1.quotedMethod, 'price_per_case');
      assert.strictEqual(c1.quotedPrice, 85.0);
      assert.strictEqual(c1.isQuotedPriceSet, true);

      assert.strictEqual(c2.quotedMethod, 'desired_profit');
      assert.strictEqual(c2.dollarProfit, 30.0);
      assert.strictEqual(c2.isQuotedPriceSet, true);

      assert.strictEqual(c3.quotedPrice, null);
      assert.strictEqual(c3.isQuotedPriceSet, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. FORMULA RECALCULATION BEHAVIOR
  // ---------------------------------------------------------------------------
  describe('4. Formula Recalculation Rules', () => {
    it('T10: Formula change preserves fixed quoted prices for Modes A/B and updates profit/margin', () => {
      const initialProducts: QuoteProductConfig[] = [
        calculateProductPricing({
          id: 'p1',
          pieceWeight: 4,
          weightUnit: 'oz',
          piecesPerCase: 80,
          packagingCost: 3.0,
          laborCost: 11.45,
          ingredientMultiplier: 1.6,
          quotedMethod: 'price_per_case',
          quotedMethodValue: 80.0,
          formula: baseFormula,
        }),
      ];

      assert.strictEqual(initialProducts[0].quotedPrice, 80.0);
      assert.strictEqual(initialProducts[0].totalProductionCost, 59.81);
      assert.strictEqual(initialProducts[0].dollarProfit, 20.19);

      // Formula ingredients increase in cost: $50 -> $60 total cost
      const updatedFormula: QuoteFormula = {
        ...baseFormula,
        totalCost: 60.0,
        costPerGram: 0.006,
      };

      const recalculated = recalculateProductsPricing(initialProducts, updatedFormula);

      // Raw cost increased to: 60 * 0.907185 = $54.43
      // New COGS = $54.43 + $14.45 = $68.88
      assert.strictEqual(recalculated[0].totalProductionCost, 68.88);
      // Quoted customer selling price stays fixed at $80.00
      assert.strictEqual(recalculated[0].quotedPrice, 80.0);
      // Profit decreases to $80.00 - $68.88 = $11.12
      assert.strictEqual(recalculated[0].dollarProfit, 11.12);
      // Margin decreases to ($11.12 / $80.00) * 100 = 13.90%
      assert.strictEqual(recalculated[0].grossMarginPercent, 13.9);
    });

    it('T11: Formula change updates selling price for Mode D (Multiplier) and Mode C (Desired Profit)', () => {
      const products: QuoteProductConfig[] = [
        // Mode D: Multiplier 2.0x
        calculateProductPricing({
          id: 'p-mult',
          pieceWeight: 4,
          weightUnit: 'oz',
          piecesPerCase: 80,
          packagingCost: 3.0,
          laborCost: 11.45,
          ingredientMultiplier: 1.6,
          quotedMethod: 'ingredients_multiplier',
          quotedMethodValue: 2.0,
          formula: baseFormula,
        }),
        // Mode C: Desired profit $20.00
        calculateProductPricing({
          id: 'p-profit',
          pieceWeight: 4,
          weightUnit: 'oz',
          piecesPerCase: 80,
          packagingCost: 3.0,
          laborCost: 11.45,
          ingredientMultiplier: 1.6,
          quotedMethod: 'desired_profit',
          quotedMethodValue: 20.0,
          formula: baseFormula,
        }),
      ];

      // Initial raw ingredients = $45.36
      // Mode D initial quoted price = ($45.36 * 2.0) + $14.45 = $105.17
      assert.strictEqual(products[0].quotedPrice, 105.17);
      // Mode C initial quoted price = $59.81 + $20.00 = $79.81
      assert.strictEqual(products[1].quotedPrice, 79.81);

      // Formula ingredients increase in cost ($50 -> $60)
      // New raw ingredients = 60 * 0.907185 = $54.43
      const updatedFormula: QuoteFormula = {
        ...baseFormula,
        totalCost: 60.0,
      };

      const recalculated = recalculateProductsPricing(products, updatedFormula);

      // Mode D recalculated: ($54.43 * 2.0) + $14.45 = $108.86 + $14.45 = $123.31
      assert.strictEqual(recalculated[0].quotedPrice, 123.31);
      // Mode C recalculated: New COGS ($68.88) + $20.00 = $88.88
      assert.strictEqual(recalculated[1].quotedPrice, 88.88);
      assert.strictEqual(recalculated[1].dollarProfit, 20.0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. IMMUTABILITY & PERSISTENCE
  // ---------------------------------------------------------------------------
  describe('5. Immutability & Project Persistence', () => {
    it('T12: Saved project persists interactive quoted pricing methods and reloads accurately', async () => {
      const mockStorage = createMockLocalStorage();
      (global as any).localStorage = mockStorage;

      const project = await quotingService.createProject({
        workspaceId: TEST_WS,
        userId: TEST_USER,
        productName: 'Lemon Shortbread Cookie',
        formulaOwnership: 'bakery_owned',
        customerName: 'Customer A',
        initialFormula: baseFormula,
      });

      // Add a configured product with Mode C (Desired profit)
      const config = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        ingredientMultiplier: 1.6,
        quotedMethod: 'desired_profit',
        quotedMethodValue: 22.5,
        formula: baseFormula,
      });

      await quotingService.saveProject({
        ...project,
        products: [config],
      });

      // Reload project
      const reloaded = quotingService.getProject(TEST_WS, project.id);
      assert.ok(reloaded);
      assert.strictEqual(reloaded.products.length, 1);
      assert.strictEqual(reloaded.products[0].quotedMethod, 'desired_profit');
      assert.strictEqual(reloaded.products[0].quotedMethodValue, 22.5);
      assert.strictEqual(reloaded.products[0].dollarProfit, 22.5);
      assert.strictEqual(reloaded.products[0].quotedPrice, 82.31); // 59.81 + 22.50 = 82.31
      assert.strictEqual(reloaded.products[0].isQuotedPriceSet, true);
    });

    it('T13: Source production recipe remains completely unmutated by quoting calculations', () => {
      const originalRecipe = store.getRecipe('recipe-chocolate-chip');
      if (originalRecipe) {
        const recipeCloneBefore = JSON.parse(JSON.stringify(originalRecipe));

        // Perform multiple product quoting calculations
        calculateProductPricing({
          pieceWeight: 4,
          weightUnit: 'oz',
          piecesPerCase: 80,
          packagingCost: 3.0,
          laborCost: 11.45,
          ingredientMultiplier: 1.6,
          quotedMethod: 'ingredients_multiplier',
          quotedMethodValue: 2.75,
          formula: baseFormula,
        });

        const recipeAfter = store.getRecipe('recipe-chocolate-chip');
        assert.deepStrictEqual(recipeAfter, recipeCloneBefore, 'Production recipe is strictly unchanged');
      }
    });
  });
});
