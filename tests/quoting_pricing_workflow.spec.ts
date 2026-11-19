import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  calculateProductPricing,
  createQuoteRevisionSnapshot,
  calculateFormulaTotals,
} from '../src/utils/quotingCalculator';
import {
  QuoteFormula,
  ProductProject,
  QuoteProductConfig,
  QuoteFormulaLine,
} from '../src/types/quoting';
import { MasterIngredient, Workspace, Recipe } from '../src/types';
import { canUserAccessQuoting, quotingService } from '../src/services/quotingService';
import { calculateProduction } from '../src/utils/calculator';

describe('Phase 2B.5.1 — Product Development & Quoting UX + Pricing Workflow Refinement Suite', () => {
  // Test baseline formula: 11,514g total weight, $52.40 total raw ingredient cost
  const baseFormula: QuoteFormula = {
    totalWeightGrams: 11514,
    totalCost: 52.40,
    costPerGram: 52.40 / 11514,
    lines: [
      {
        id: 'line-butter',
        name: 'Butter',
        quantity: 2040,
        unit: 'g',
        unitCostUsed: 0.008,
        unitCostType: 'per_gram',
        lineCost: 16.32,
      },
      {
        id: 'line-sugar',
        name: 'Sugar',
        quantity: 1360,
        unit: 'g',
        unitCostUsed: 0.002,
        unitCostType: 'per_gram',
        lineCost: 2.72,
      },
    ],
  };

  const sampleMaster: MasterIngredient = {
    id: 'master-flour-1',
    workspaceId: 'ws-refinement',
    name: 'Bread Flour',
    category: 'Flours',
    defaultUnit: 'g',
    preferredPurchasePackage: {
      packQuantity: 1,
      unitSize: 50,
      unitMeasure: 'lb',
      packagePriceCents: 3000,
    },
    costPerGram: 30 / (50 * 453.59237),
  };

  const testWorkspace: Workspace = {
    id: 'ws-refinement',
    name: 'Commercial Bakery',
    ownerEmail: 'manager@bakery.com',
    ownerId: 'uid-mgr',
    code: 'BAKERY',
    members: [],
    groups: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    features: {
      recipeManagement: true,
      productionFloor: true,
      costing: true,
      productQuoting: true,
    },
  };

  // ---------------------------------------------------------------------------
  // P1 — Formula step contains Continue to Products & Pricing action
  // ---------------------------------------------------------------------------
  it('P1 — Formula step contains Continue to Products & Pricing action', () => {
    const builderContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/quoting/FormulaBuilder.tsx'),
      'utf8'
    );
    assert(
      builderContent.includes('Continue to Products & Pricing'),
      'FormulaBuilder must include Continue to Products & Pricing button'
    );
    assert(
      builderContent.includes('onContinueToPricing'),
      'FormulaBuilder must expose onContinueToPricing callback'
    );
  });

  // ---------------------------------------------------------------------------
  // P2 — Continue action navigates to Step 2 without issuing a quote or creating a production recipe
  // ---------------------------------------------------------------------------
  it('P2 — Continue action navigates to Step 2 without issuing a quote or creating a production recipe', () => {
    const editorContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/quoting/ProjectEditor.tsx'),
      'utf8'
    );
    assert(
      editorContent.includes("onContinueToPricing={() => setActiveTab('products')}"),
      'Continue button in ProjectEditor must only switch activeTab to products'
    );
    // Ensure no side effects are invoked by continue
    assert(
      !editorContent.includes('onContinueToPricing={() => onIssueRevision'),
      'Continue action must NOT issue a quote'
    );
  });

  // ---------------------------------------------------------------------------
  // P3 — Step 2 exposes product configuration/pricing editing without requiring the pencil-edit workflow
  // ---------------------------------------------------------------------------
  it('P3 — Step 2 exposes product configuration/pricing editing without requiring the pencil-edit workflow', () => {
    const matrixContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/quoting/ProductsPricingMatrix.tsx'),
      'utf8'
    );
    assert(
      matrixContent.includes('selectedConfigId'),
      'ProductsPricingMatrix must manage selectedConfigId for immediate active editing'
    );
    assert(
      matrixContent.includes('applyFormChanges'),
      'ProductsPricingMatrix must expose inline form update handlers directly in Step 2'
    );
    assert(
      !matrixContent.includes('isModalOpen') && !matrixContent.includes('ProductConfigurationModal'),
      'Step 2 must NOT require opening a modal to edit product pricing'
    );
  });

  // ---------------------------------------------------------------------------
  // P4 — Multiple product configurations remain supported
  // ---------------------------------------------------------------------------
  it('P4 — Multiple product configurations remain supported', () => {
    const p1 = calculateProductPricing({
      name: '4 oz Cookie (80/cs)',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    const p2 = calculateProductPricing({
      name: '3 oz Cookie (96/cs)',
      pieceWeight: 3,
      weightUnit: 'oz',
      piecesPerCase: 96,
      packagingCost: 3.0,
      laborCost: 15.0,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    const p3 = calculateProductPricing({
      name: '1 oz Cookie (360/cs)',
      pieceWeight: 1,
      weightUnit: 'oz',
      piecesPerCase: 360,
      packagingCost: 4.5,
      laborCost: 20.0,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    assert.strictEqual(p1.piecesPerCase, 80);
    assert.strictEqual(p2.piecesPerCase, 96);
    assert.strictEqual(p3.piecesPerCase, 360);
    assert.strictEqual(p1.doughWeightGrams, 9071.85); // 80 * 4 oz in grams
    assert.strictEqual(p2.doughWeightGrams, 8164.66); // 96 * 3 oz in grams
    assert.strictEqual(p3.doughWeightGrams, 10205.83); // 360 * 1 oz in grams
  });

  // ---------------------------------------------------------------------------
  // P5 — Raw Ingredient Cost calculates correctly
  // ---------------------------------------------------------------------------
  it('P5 — Raw Ingredient Cost calculates correctly', () => {
    // 80 * 4 oz = 320 oz (9,071.85g) -> ratio = 9071.85 / 11514 = 0.787897
    // Raw ingredients = 52.40 * 0.787897 = $41.29
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert.strictEqual(p.rawIngredientCost, 41.29);
  });

  // ---------------------------------------------------------------------------
  // P6 — COGS = Raw Ingredients + Packaging + Labor + Other
  // ---------------------------------------------------------------------------
  it('P6 — COGS = Raw Ingredients + Packaging + Labor + Other', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 1.25,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    // $41.29 + $3.00 + $11.45 + $1.25 = $56.99
    assert.strictEqual(p.totalProductionCost, 56.99);
  });

  // ---------------------------------------------------------------------------
  // P7 — Ingredient Multiplier applies ONLY to Raw Ingredients when calculating Target Price
  // ---------------------------------------------------------------------------
  it('P7 — Ingredient Multiplier applies ONLY to Raw Ingredients when calculating Target Price', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 5.0,
      laborCost: 10.0,
      otherCost: 2.0,
      ingredientMultiplier: 2.0, // 2x multiplier
      formula,
    });

    // Marked-up ingredients = 10.0 * 2.0 = 20.0
    // Target price = 20.0 + 5.0 + 10.0 + 2.0 = 37.0
    assert.strictEqual(p.rawIngredientCost, 10.0);
    assert.strictEqual(p.calculatedTargetPrice, 37.0);
  });

  // ---------------------------------------------------------------------------
  // P8 — Packaging is NOT multiplied
  // ---------------------------------------------------------------------------
  it('P8 — Packaging is NOT multiplied', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p1 = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 0,
      ingredientMultiplier: 3.0,
      formula,
    });
    const p2 = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 5.0,
      ingredientMultiplier: 3.0,
      formula,
    });
    // Target price increases exactly by 5.0, not 5.0 * 3.0
    assert.strictEqual(p2.calculatedTargetPrice - p1.calculatedTargetPrice, 5.0);
  });

  // ---------------------------------------------------------------------------
  // P9 — Labor is NOT multiplied
  // ---------------------------------------------------------------------------
  it('P9 — Labor is NOT multiplied', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p1 = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      laborCost: 0,
      ingredientMultiplier: 2.5,
      formula,
    });
    const p2 = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      laborCost: 12.0,
      ingredientMultiplier: 2.5,
      formula,
    });
    // Target price increases exactly by 12.0, not 12.0 * 2.5
    assert.strictEqual(p2.calculatedTargetPrice - p1.calculatedTargetPrice, 12.0);
  });

  // ---------------------------------------------------------------------------
  // P10 — Other Direct Cost is NOT multiplied
  // ---------------------------------------------------------------------------
  it('P10 — Other Direct Cost is NOT multiplied', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p1 = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      otherCost: 0,
      ingredientMultiplier: 2.0,
      formula,
    });
    const p2 = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      otherCost: 4.5,
      ingredientMultiplier: 2.0,
      formula,
    });
    assert.strictEqual(p2.calculatedTargetPrice - p1.calculatedTargetPrice, 4.5);
  });

  // ---------------------------------------------------------------------------
  // P11 — New product configuration Actual Quoted Price begins blank
  // ---------------------------------------------------------------------------
  it('P11 — New product configuration Actual Quoted Price begins blank', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      // quotedPrice omitted / undefined
      formula: baseFormula,
    });
    assert.strictEqual(p.quotedPrice, null, 'quotedPrice must be null for new configuration');
    assert.strictEqual(p.quotedPricePerUnit, null, 'quotedPricePerUnit must be null for new configuration');
    assert.strictEqual(p.isQuotedPriceSet, false, 'isQuotedPriceSet must be false');
  });

  // ---------------------------------------------------------------------------
  // P12 — Target Price does not automatically populate Actual Quoted Price
  // ---------------------------------------------------------------------------
  it('P12 — Target Price does not automatically populate Actual Quoted Price', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert(p.calculatedTargetPrice > 0, 'Target price must calculate');
    assert.strictEqual(p.quotedPrice, null, 'Actual quoted price must NOT inherit target price');
  });

  // ---------------------------------------------------------------------------
  // P13 — Blank cost input remains distinguishable from intentional $0.00
  // ---------------------------------------------------------------------------
  it('P13 — Blank cost input remains distinguishable from intentional $0.00', () => {
    const pBlank = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: null, // Blank
      laborCost: 10.0,
      otherCost: null,    // Blank
      ingredientMultiplier: 1.5,
      formula: baseFormula,
    });

    const pZero = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 0.0, // Intentional $0.00
      laborCost: 10.0,
      otherCost: 0.0,    // Intentional $0.00
      ingredientMultiplier: 1.5,
      formula: baseFormula,
    });

    assert.strictEqual(pZero.packagingCost, 0.0);
    assert.strictEqual(pZero.otherCost, 0.0);
    assert.strictEqual(pBlank.packagingCost, 0.0); // Resolved to 0 for sum
  });

  // ---------------------------------------------------------------------------
  // P14 — Ingredient Multiplier must be valid and > 0
  // ---------------------------------------------------------------------------
  it('P14 — Ingredient Multiplier must be valid and > 0', () => {
    const pZeroMult = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 0,
      formula: baseFormula,
    });
    assert.strictEqual(pZeroMult.isTargetPriceComplete, false);
    assert.strictEqual(pZeroMult.calculatedTargetPrice, 0);

    const pNegMult = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: -1.5,
      formula: baseFormula,
    });
    assert.strictEqual(pNegMult.isTargetPriceComplete, false);
    assert.strictEqual(pNegMult.calculatedTargetPrice, 0);

    const pValidMult = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert.strictEqual(pValidMult.isTargetPriceComplete, true);
    assert(pValidMult.calculatedTargetPrice > 0);
  });

  // ---------------------------------------------------------------------------
  // P15 — Target Price / Case calculates correctly
  // ---------------------------------------------------------------------------
  it('P15 — Target Price / Case calculates correctly', () => {
    // ($41.29 * 1.61) + $3.00 + $11.45 + $0.00 = $66.4769 + $14.45 = $80.93
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert.strictEqual(p.calculatedTargetPrice, 80.93);
  });

  // ---------------------------------------------------------------------------
  // P16 — Target Price / Unit = Target Price / Case ÷ Units per Case
  // ---------------------------------------------------------------------------
  it('P16 — Target Price / Unit = Target Price / Case ÷ Units per Case', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    // 80.93 / 80 = 1.011625 -> $1.01
    assert.strictEqual(p.targetPricePerUnit, Number((p.calculatedTargetPrice / 80).toFixed(2)));
    assert.strictEqual(p.targetPricePerUnit, 1.01);
  });

  // ---------------------------------------------------------------------------
  // P17 — Cost / Unit = COGS ÷ Units per Case
  // ---------------------------------------------------------------------------
  it('P17 — Cost / Unit = COGS ÷ Units per Case', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    // COGS = 55.74, 55.74 / 80 = 0.69675 -> $0.70
    assert.strictEqual(p.totalProductionCost, 55.74);
    assert.strictEqual(p.costPerUnit, Number((55.74 / 80).toFixed(2)));
    assert.strictEqual(p.costPerUnit, 0.70);
  });

  // ---------------------------------------------------------------------------
  // P18 — Cost / Unit is represented as a first-class financial metric in the UI
  // ---------------------------------------------------------------------------
  it('P18 — Cost / Unit is represented as a first-class financial metric in the UI', () => {
    const matrixContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/quoting/ProductsPricingMatrix.tsx'),
      'utf8'
    );
    assert(
      matrixContent.includes('Cost / Unit'),
      'ProductsPricingMatrix must have dedicated Cost / Unit label'
    );
    assert(
      matrixContent.includes('activeConfig.costPerUnit'),
      'ProductsPricingMatrix must render activeConfig.costPerUnit prominently'
    );
  });

  // ---------------------------------------------------------------------------
  // P19 — Case-based Actual Quote derives Unit Price correctly
  // ---------------------------------------------------------------------------
  it('P19 — Case-based Actual Quote derives Unit Price correctly', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      pricingBasis: 'case',
      quotedPrice: 85.60,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert.strictEqual(p.quotedPrice, 85.60);
    assert.strictEqual(p.quotedPricePerUnit, 1.07); // 85.60 / 80 = 1.07
  });

  // ---------------------------------------------------------------------------
  // P20 — Unit-based Actual Quote derives Case Price correctly
  // ---------------------------------------------------------------------------
  it('P20 — Unit-based Actual Quote derives Case Price correctly', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      pricingBasis: 'unit',
      quotedPricePerUnit: 1.07,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert.strictEqual(p.quotedPricePerUnit, 1.07);
    assert.strictEqual(p.quotedPrice, 85.60); // 1.07 * 80 = 85.60
  });

  // ---------------------------------------------------------------------------
  // P21 — Example: 80 units × $1.07/unit = $85.60/case
  // ---------------------------------------------------------------------------
  it('P21 — Example: 80 units × $1.07/unit = $85.60/case', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      pricingBasis: 'unit',
      quotedPricePerUnit: 1.07,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });
    assert.strictEqual(p.quotedPrice, 85.60);
    assert.strictEqual(Number((p.piecesPerCase * p.quotedPricePerUnit!).toFixed(2)), 85.60);
  });

  // ---------------------------------------------------------------------------
  // P22 — Actual Dollar Profit = Actual Quote / Case - COGS
  // ---------------------------------------------------------------------------
  it('P22 — Actual Dollar Profit = Actual Quote / Case - COGS', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      quotedPrice: 85.60, // COGS = 55.74
      formula: baseFormula,
    });
    // 85.60 - 55.74 = $29.86
    assert.strictEqual(p.dollarProfit, 29.86);
  });

  // ---------------------------------------------------------------------------
  // P23 — Actual Gross Margin uses Actual Quote, not Target Price
  // ---------------------------------------------------------------------------
  it('P23 — Actual Gross Margin uses Actual Quote, not Target Price', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61, // Target price = 80.93
      quotedPrice: 85.60,         // Actual quoted price = 85.60
      formula: baseFormula,
    });
    // Profit = 29.86, Margin = (29.86 / 85.60) * 100 = 34.88%
    assert.strictEqual(p.grossMarginPercent, 34.88);
  });

  // ---------------------------------------------------------------------------
  // P24 — Actual Markup uses Actual Quote and COGS
  // ---------------------------------------------------------------------------
  it('P24 — Actual Markup uses Actual Quote and COGS', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      quotedPrice: 85.60,
      formula: baseFormula,
    });
    // Profit = 29.86, COGS = 55.74 -> Markup = (29.86 / 55.74) * 100 = 53.57%
    assert.strictEqual(p.markupPercent, 53.57);
  });

  // ---------------------------------------------------------------------------
  // P25 — Target profitability uses Target Price
  // ---------------------------------------------------------------------------
  it('P25 — Target profitability uses Target Price', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61, // Target = 80.93, COGS = 55.74
      quotedPrice: 85.60,         // Quoted = 85.60
      formula: baseFormula,
    });
    // Target Profit = 80.93 - 55.74 = $25.19
    assert.strictEqual(p.targetDollarProfit, 25.19);
    // Target Margin = (25.19 / 80.93) * 100 = 31.13%
    assert.strictEqual(p.targetGrossMarginPercent, 31.13);
    // Target Markup = (25.19 / 55.74) * 100 = 45.19%
    assert.strictEqual(p.targetMarkupPercent, 45.19);
  });

  // ---------------------------------------------------------------------------
  // P26 — Target-vs-Actual case variance calculates correctly
  // ---------------------------------------------------------------------------
  it('P26 — Target-vs-Actual case variance calculates correctly', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61, // Target = 80.93
      quotedPrice: 85.60,         // Quoted = 85.60
      formula: baseFormula,
    });
    // 85.60 - 80.93 = +$4.67
    assert.strictEqual(p.targetVarianceDollars, 4.67);
  });

  // ---------------------------------------------------------------------------
  // P27 — Target-vs-Actual unit variance calculates correctly
  // ---------------------------------------------------------------------------
  it('P27 — Target-vs-Actual unit variance calculates correctly', () => {
    const p = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61, // Target/unit = 1.01
      quotedPrice: 85.60,         // Quoted/unit = 1.07
      formula: baseFormula,
    });
    // 1.07 - 1.01 = +$0.06
    assert.strictEqual(p.targetVarianceUnitDollars, 0.06);
  });

  // ---------------------------------------------------------------------------
  // P28 — Pricing one product configuration does not mutate another configuration
  // ---------------------------------------------------------------------------
  it('P28 — Pricing one product configuration does not mutate another configuration', () => {
    const configA = calculateProductPricing({
      id: 'cfg-a',
      name: '4 oz Cookie',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      quotedPrice: 85.60,
      formula: baseFormula,
    });

    const configB = calculateProductPricing({
      id: 'cfg-b',
      name: '2 oz Cookie',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 140,
      packagingCost: 3.5,
      laborCost: 14.0,
      otherCost: 0.0,
      ingredientMultiplier: 1.8,
      quotedPrice: 90.0,
      formula: baseFormula,
    });

    // Mutating A via recalculation with different price
    const configAUpdated = calculateProductPricing({
      ...configA,
      quotedPrice: 99.0,
      formula: baseFormula,
    });

    assert.strictEqual(configAUpdated.quotedPrice, 99.0);
    assert.strictEqual(configB.quotedPrice, 90.0, 'Config B quotedPrice must remain unchanged');
    assert.strictEqual(configB.pieceWeight, 2, 'Config B pieceWeight must remain unchanged');
    assert.strictEqual(configB.piecesPerCase, 140, 'Config B piecesPerCase must remain unchanged');
  });

  // ---------------------------------------------------------------------------
  // P29 — Existing saved Actual Quoted Prices remain preserved
  // ---------------------------------------------------------------------------
  it('P29 — Existing saved Actual Quoted Prices remain preserved', () => {
    // Existing saved Phase 2B.5 project configuration with quotedPrice = 80.82
    const savedConfig: QuoteProductConfig = {
      id: 'cfg-existing',
      productType: 'Cookie',
      name: '4 oz Cookie (80/cs)',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      unitName: 'case',
      doughWeightGrams: 9071.85,
      rawIngredientCost: 41.29,
      ingredientMultiplier: 1.61,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      totalProductionCost: 55.74,
      calculatedTargetPrice: 80.93,
      quotedPrice: 80.82, // Legitimate saved price
      unitPrice: 1.01,
      dollarProfit: 25.08,
      grossMarginPercent: 31.03,
      markupPercent: 44.99,
      targetVarianceDollars: -0.11,
    };

    const reloaded = calculateProductPricing({
      ...savedConfig,
      formula: baseFormula,
    });

    assert.strictEqual(reloaded.quotedPrice, 80.82, 'Saved quoted price 80.82 must be preserved');
    assert.strictEqual(reloaded.dollarProfit, 25.08);
  });

  // ---------------------------------------------------------------------------
  // P30 — Quote revision freezes Cost Per Unit
  // ---------------------------------------------------------------------------
  it('P30 — Quote revision freezes Cost Per Unit', () => {
    const config = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    const project: ProductProject = {
      id: 'proj-freeze-test',
      workspaceId: 'ws-refinement',
      productName: 'Freeze Test',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula: baseFormula,
      products: [config],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    };

    const revision = createQuoteRevisionSnapshot(project, 'uid-1', 'Manager', 'Revision test');
    assert.strictEqual(revision.productsSnapshot[0].costPerUnit, 0.70);

    // Later project alteration
    project.products[0].costPerUnit = 9.99;
    assert.strictEqual(revision.productsSnapshot[0].costPerUnit, 0.70, 'Snapshot costPerUnit must remain frozen');
  });

  // ---------------------------------------------------------------------------
  // P31 — Quote revision freezes Target Price / Case and Unit
  // ---------------------------------------------------------------------------
  it('P31 — Quote revision freezes Target Price / Case and Unit', () => {
    const config = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    const project: ProductProject = {
      id: 'proj-target-freeze',
      workspaceId: 'ws-refinement',
      productName: 'Target Freeze',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula: baseFormula,
      products: [config],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    };

    const revision = createQuoteRevisionSnapshot(project, 'uid-1', 'Manager');
    assert.strictEqual(revision.productsSnapshot[0].calculatedTargetPrice, 80.93);
    assert.strictEqual(revision.productsSnapshot[0].targetPricePerUnit, 1.01);
  });

  // ---------------------------------------------------------------------------
  // P32 — Quote revision freezes Actual Quote / Case and Unit
  // ---------------------------------------------------------------------------
  it('P32 — Quote revision freezes Actual Quote / Case and Unit', () => {
    const config = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      quotedPrice: 85.60,
      formula: baseFormula,
    });

    const project: ProductProject = {
      id: 'proj-quote-freeze',
      workspaceId: 'ws-refinement',
      productName: 'Quote Freeze',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula: baseFormula,
      products: [config],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    };

    const revision = createQuoteRevisionSnapshot(project, 'uid-1', 'Manager');
    assert.strictEqual(revision.productsSnapshot[0].quotedPrice, 85.60);
    assert.strictEqual(revision.productsSnapshot[0].quotedPricePerUnit, 1.07);
  });

  // ---------------------------------------------------------------------------
  // P33 — Quote revision freezes profitability metrics
  // ---------------------------------------------------------------------------
  it('P33 — Quote revision freezes profitability metrics', () => {
    const config = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      quotedPrice: 85.60,
      formula: baseFormula,
    });

    const project: ProductProject = {
      id: 'proj-profit-freeze',
      workspaceId: 'ws-refinement',
      productName: 'Profit Freeze',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula: baseFormula,
      products: [config],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    };

    const revision = createQuoteRevisionSnapshot(project, 'uid-1', 'Manager');
    assert.strictEqual(revision.productsSnapshot[0].dollarProfit, 29.86);
    assert.strictEqual(revision.productsSnapshot[0].grossMarginPercent, 34.88);
    assert.strictEqual(revision.productsSnapshot[0].markupPercent, 53.57);
  });

  // ---------------------------------------------------------------------------
  // P34 — Later Master Ingredient price changes do not mutate historical quote revisions
  // ---------------------------------------------------------------------------
  it('P34 — Later Master Ingredient price changes do not mutate historical quote revisions', () => {
    const flourMaster: MasterIngredient = {
      id: 'ing-flour-freeze',
      workspaceId: 'ws-refinement',
      name: 'Flour',
      category: 'Dry',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2000, // $20.00
      },
      costPerGram: 20 / (50 * 453.59237),
    };

    const lines: QuoteFormulaLine[] = [
      {
        id: 'l1',
        name: 'Flour',
        quantity: 1000,
        unit: 'g',
        masterIngredientId: flourMaster.id,
        unitCostUsed: flourMaster.costPerGram!,
        unitCostType: 'per_gram',
        lineCost: 1000 * flourMaster.costPerGram!,
      },
    ];

    const formula = calculateFormulaTotals(lines, new Map([[flourMaster.id, flourMaster]]));
    const config = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      ingredientMultiplier: 2.0,
      formula,
    });

    const project: ProductProject = {
      id: 'proj-pantry-drift',
      workspaceId: 'ws-refinement',
      productName: 'Drift Test',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula,
      products: [config],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    };

    const revision = createQuoteRevisionSnapshot(project, 'uid-1', 'Manager');
    const frozenCost = revision.formulaSnapshot.totalCost;

    // Mutate Master Ingredient cost in pantry
    flourMaster.costPerGram = 999.0;
    flourMaster.preferredPurchasePackage!.packagePriceCents = 999900;

    assert.strictEqual(revision.formulaSnapshot.totalCost, frozenCost, 'Historical revision cost must remain unchanged');
  });

  // ---------------------------------------------------------------------------
  // P35 — Temporary R&D ingredients do not create Master Ingredients
  // ---------------------------------------------------------------------------
  it('P35 — Temporary R&D ingredients do not create Master Ingredients', async () => {
    const project = await quotingService.createProject({
      workspaceId: 'ws-refinement',
      productName: 'Temp R&D Project',
      userId: 'uid-mgr',
    });

    const tempLine: QuoteFormulaLine = {
      id: 'line-temp',
      name: 'Experimental Cocoa Nibs',
      quantity: 500,
      unit: 'g',
      isTemporary: true,
      temporaryData: {
        name: 'Experimental Cocoa Nibs',
        packagePriceCents: 4500,
        packQuantity: 1,
        unitSize: 5,
        unitMeasure: 'lb',
      },
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const calculatedFormula = calculateFormulaTotals([tempLine], new Map());
    assert(calculatedFormula.totalCost > 0, 'Temporary ingredient calculates cost correctly');
    assert.strictEqual(tempLine.masterIngredientId, undefined, 'No masterIngredientId must be assigned');
  });

  // ---------------------------------------------------------------------------
  // P36 — Production recipes remain unchanged
  // ---------------------------------------------------------------------------
  it('P36 — Production recipes remain unchanged', () => {
    const sampleRecipe: Recipe = {
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

    const recipeCopy = JSON.stringify(sampleRecipe);

    // Calculate product pricing from formula
    calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    assert.strictEqual(JSON.stringify(sampleRecipe), recipeCopy, 'Recipe record must not be mutated');
  });

  // ---------------------------------------------------------------------------
  // P37 — Master Ingredient records remain unchanged
  // ---------------------------------------------------------------------------
  it('P37 — Master Ingredient records remain unchanged', () => {
    const masterCopy = JSON.stringify(sampleMaster);

    calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    assert.strictEqual(JSON.stringify(sampleMaster), masterCopy, 'Master ingredient must not be mutated');
  });

  // ---------------------------------------------------------------------------
  // P38 — Production waste behavior remains unchanged
  // ---------------------------------------------------------------------------
  it('P38 — Production waste behavior remains unchanged', () => {
    const testRecipe: Recipe = {
      id: 'rec-waste-integrity',
      userId: 'test-user',
      name: 'Waste Integrity Recipe',
      description: 'Test recipe',
      category: 'Cookies',
      batchYieldQuantity: 80,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 4,
      ingredients: [
        { id: 'i1', name: 'Flour', quantity: 9071.85, unit: 'g' },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // 80 pieces @ 4 oz = 320 oz net. Waste 4% -> Gross required = 332.8 oz
    const samplePreset4oz = {
      id: 'pre-4oz',
      name: '4 oz Case',
      finishedWeight: 4,
      weightUnit: 'oz' as const,
      quantityPerUnit: 80,
    };
    const req = {
      id: 'req-1case-4oz',
      presetId: samplePreset4oz.id,
      presetName: samplePreset4oz.name,
      quantity: 1, // 1 case
      piecesPerUnit: samplePreset4oz.quantityPerUnit, // 80 pcs
      itemWeight: samplePreset4oz.finishedWeight, // 4 oz
      itemWeightUnit: samplePreset4oz.weightUnit, // oz
    };

    const result = calculateProduction(testRecipe, [req], {
      defaultWastePercent: 4,
      defaultWeightUnit: 'oz',
    });

    assert.strictEqual(result.recipeWastePercent, 4);
    assert(Math.abs(result.displayBatchWeight - 332.8) < 0.001, 'Authoritative required mix weight must be 332.8 oz');
  });

  // ---------------------------------------------------------------------------
  // P39 — Full Recipe behavior remains unchanged
  // ---------------------------------------------------------------------------
  it('P39 — Full Recipe behavior remains unchanged', () => {
    const testRecipe: Recipe = {
      id: 'rec-full-integrity',
      userId: 'test-user',
      name: 'Full Recipe Integrity',
      description: 'Test recipe',
      category: 'Cookies',
      batchYieldQuantity: 50,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 4,
      ingredients: [
        { id: 'i1', name: 'Flour', quantity: 5000, unit: 'g' },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const result = calculateProduction(testRecipe, [], {
      mode: 'full_recipe',
      fullRecipeCount: 2,
      defaultWeightUnit: 'g',
    });
    assert.strictEqual(result.scalingMultiplier, 2);
    assert.strictEqual(result.recipeWastePercent, 0);
    assert.strictEqual(result.overrideWastePercent, 0);
    assert.strictEqual(result.totalBatchWeightGrams, 10000);
  });

  // ---------------------------------------------------------------------------
  // P40 — Full Mixer Capacity behavior remains unchanged
  // ---------------------------------------------------------------------------
  it('P40 — Full Mixer Capacity behavior remains unchanged', () => {
    const testRecipe: Recipe = {
      id: 'rec-mixer-integrity',
      userId: 'test-user',
      name: 'Mixer Integrity Recipe',
      description: 'Test recipe',
      category: 'Cookies',
      batchYieldQuantity: 50,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 0,
      ingredients: [
        { id: 'i1', name: 'Flour', quantity: 5000, unit: 'g' },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const mixer = {
      id: 'mixer-hobart-80',
      name: 'Hobart 80-Qt Commercial Mixer',
      maxWeight: 100,
      weightUnit: 'lb' as const,
      userId: 'test-user',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const result = calculateProduction(testRecipe, [], {
      mode: 'full_mixer',
      fullMixerBatches: 1,
      mixer,
      defaultWeightUnit: 'lb',
    });
    assert.strictEqual(result.recipeWastePercent, 0);
    assert.strictEqual(result.overrideWastePercent, 0);
    assert(Math.abs(result.displayBatchWeight - 100) < 0.01);
  });

  // ---------------------------------------------------------------------------
  // P41 — Floor PIN users cannot access quoting
  // ---------------------------------------------------------------------------
  it('P41 — Floor PIN users cannot access quoting', () => {
    const canAccessPin = canUserAccessQuoting(testWorkspace, 'owner', true);
    assert.strictEqual(canAccessPin, false, 'Floor PIN profile must be denied quoting access');
  });

  // ---------------------------------------------------------------------------
  // P42 — Cross-workspace project access remains denied
  // ---------------------------------------------------------------------------
  it('P42 — Cross-workspace project access remains denied', async () => {
    const projAlpha = await quotingService.createProject({
      workspaceId: 'ws-alpha-tenant',
      productName: 'Alpha Tenant Project',
      userId: 'user-1',
    });

    const betaProjects = quotingService.getProjects('ws-beta-tenant');
    assert(
      !betaProjects.some((p) => p.id === projAlpha.id),
      'Workspace Beta must not see Workspace Alpha projects'
    );
  });

  // ---------------------------------------------------------------------------
  // P43 — New Step 2 UI does not overflow mobile/narrow viewports
  // ---------------------------------------------------------------------------
  it('P43 — New Step 2 UI does not overflow mobile/narrow viewports', () => {
    const matrixContent = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/quoting/ProductsPricingMatrix.tsx'),
      'utf8'
    );
    // Responsive grid classes and touch-friendly controls
    assert(
      matrixContent.includes('grid-cols-1 sm:grid-cols-2') ||
      matrixContent.includes('grid-cols-1 sm:grid-cols-3') ||
      matrixContent.includes('grid-cols-2 sm:grid-cols-4'),
      'Step 2 must use responsive grid breakdowns'
    );
    assert(
      !matrixContent.includes('min-w-[1200px]') && !matrixContent.includes('min-w-[1000px]'),
      'Step 2 must not force rigid wide horizontal viewports'
    );
  });

  // ---------------------------------------------------------------------------
  // P44 — Existing Product Development projects remain readable after schema extension
  // ---------------------------------------------------------------------------
  it('P44 — Existing Product Development projects remain readable after schema extension', () => {
    // Legacy Phase 2B.5 project JSON without new optional fields
    const legacyProjectJson = JSON.stringify({
      id: 'legacy-proj-1',
      workspaceId: 'ws-refinement',
      productName: 'Legacy Phase 2B.5 Cookie',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      currentRevisionNumber: 0,
      formula: baseFormula,
      products: [
        {
          id: 'p-legacy-1',
          productType: 'Cookie',
          name: '4 oz Pack',
          pieceWeight: 4,
          weightUnit: 'oz',
          piecesPerCase: 80,
          unitName: 'case',
          doughWeightGrams: 9071.85,
          rawIngredientCost: 41.29,
          ingredientMultiplier: 1.61,
          packagingCost: 3.0,
          laborCost: 11.45,
          otherCost: 0.0,
          totalProductionCost: 55.74,
          calculatedTargetPrice: 80.93,
          quotedPrice: 80.82,
          unitPrice: 1.01,
          dollarProfit: 25.08,
          grossMarginPercent: 31.03,
          markupPercent: 44.99,
          targetVarianceDollars: -0.11,
        },
      ],
      revisions: [],
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    });

    const parsedProject: ProductProject = JSON.parse(legacyProjectJson);
    assert.strictEqual(parsedProject.id, 'legacy-proj-1');
    assert.strictEqual(parsedProject.products[0].quotedPrice, 80.82);
    assert.strictEqual(parsedProject.products[0].costPerUnit, undefined); // Backward-compatible optional field
  });
});
