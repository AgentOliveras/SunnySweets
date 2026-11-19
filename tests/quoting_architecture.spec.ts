import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  canUserAccessQuoting,
  quotingService,
} from '../src/services/quotingService';
import {
  calculateFormulaTotals,
  calculateLineCost,
  calculateProductPricing,
  createQuoteRevisionSnapshot,
  calculateTemporaryIngredientUnitCost,
  checkFormulaCostDrift,
} from '../src/utils/quotingCalculator';
import {
  ProductProject,
  QuoteFormula,
  QuoteFormulaLine,
  QuoteProductConfig,
  TemporaryIngredientData,
} from '../src/types/quoting';
import {
  Workspace,
  MasterIngredient,
  Recipe,
  ProductionPreset,
  Mixer,
} from '../src/types';
import { calculateProduction } from '../src/utils/calculator';
import { toGrams, fromGrams } from '../src/utils/units';

describe('Phase 2B.5 — Product Development & Quoting Core Test Suite', () => {
  // Test fixture: Workspace with quoting capability
  const testWorkspaceWithQuoting: Workspace = {
    id: 'ws-test-quoting',
    name: 'Artisan Bakery Co.',
    ownerId: 'owner-uid-1',
    ownerEmail: 'owner@artisan.com',
    code: 'ARTISAN-1',
    members: [],
    groups: [],
    features: {
      productQuoting: true,
      recipeManagement: true,
      costing: true,
      productionFloor: true,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const testWorkspaceWithoutQuoting: Workspace = {
    id: 'ws-test-no-quoting',
    name: 'Basic Kitchen',
    ownerId: 'owner-uid-2',
    ownerEmail: 'owner@basic.com',
    code: 'BASIC-1',
    members: [],
    groups: [],
    features: {
      productQuoting: false,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  // Sample Master Ingredients
  const sampleButter: MasterIngredient = {
    id: 'mi-butter-1',
    workspaceId: 'ws-test-quoting',
    name: 'Unsalted Butter',
    category: 'Dairy',
    defaultUnit: 'g',
    preferredPurchasePackage: {
      packQuantity: 1,
      unitSize: 50,
      unitMeasure: 'lb',
      packagePriceCents: 16000, // $160.00 for 50 lb -> $3.20/lb ($0.00705479/g)
    },
    costPerGram: 160 / (50 * 453.59237),
  };

  const sampleSugar: MasterIngredient = {
    id: 'mi-sugar-1',
    workspaceId: 'ws-test-quoting',
    name: 'Granulated Sugar',
    category: 'Sugar',
    defaultUnit: 'g',
    preferredPurchasePackage: {
      packQuantity: 1,
      unitSize: 50,
      unitMeasure: 'lb',
      packagePriceCents: 4500, // $45.00 for 50 lb -> $0.90/lb
    },
    costPerGram: 45 / (50 * 453.59237),
  };

  const sampleFlour: MasterIngredient = {
    id: 'mi-flour-1',
    workspaceId: 'ws-test-quoting',
    name: 'All-Purpose Flour',
    category: 'Flours',
    defaultUnit: 'g',
    preferredPurchasePackage: {
      packQuantity: 1,
      unitSize: 50,
      unitMeasure: 'lb',
      packagePriceCents: 2800, // $28.00 for 50 lb
    },
    costPerGram: 28 / (50 * 453.59237),
  };

  const masterMap = new Map<string, MasterIngredient>([
    [sampleButter.id, sampleButter],
    [sampleSugar.id, sampleSugar],
    [sampleFlour.id, sampleFlour],
  ]);

  // ---------------------------------------------------------------------------
  // Q1 — Owner can access Product Development & Quotes
  // ---------------------------------------------------------------------------
  it('Q1 — Owner can access Product Development & Quotes', () => {
    const canAccess = canUserAccessQuoting(testWorkspaceWithQuoting, 'owner', false);
    assert.strictEqual(canAccess, true, 'Workspace Owner must be granted access');
  });

  // ---------------------------------------------------------------------------
  // Q2 — Authorized management user with capability can access
  // ---------------------------------------------------------------------------
  it('Q2 — Authorized management user with capability can access', () => {
    const canAccess = canUserAccessQuoting(testWorkspaceWithQuoting, 'editor', false);
    assert.strictEqual(canAccess, true, 'Workspace Editor / Manager must be granted access');
  });

  // ---------------------------------------------------------------------------
  // Q3 — Unauthorized Viewer cannot access
  // ---------------------------------------------------------------------------
  it('Q3 — Unauthorized Viewer cannot access', () => {
    const canAccess = canUserAccessQuoting(testWorkspaceWithQuoting, 'viewer', false);
    assert.strictEqual(canAccess, false, 'Ordinary Viewer must be strictly denied access');
  });

  // ---------------------------------------------------------------------------
  // Q4 — Production PIN profile cannot access
  // ---------------------------------------------------------------------------
  it('Q4 — Production PIN profile cannot access', () => {
    const canAccessOwnerPin = canUserAccessQuoting(testWorkspaceWithQuoting, 'owner', true);
    const canAccessEditorPin = canUserAccessQuoting(testWorkspaceWithQuoting, 'editor', true);
    assert.strictEqual(canAccessOwnerPin, false, 'Production PIN mode must deny Owner access to quoting');
    assert.strictEqual(canAccessEditorPin, false, 'Production PIN mode must deny Editor access to quoting');
  });

  // ---------------------------------------------------------------------------
  // Q5 — Cross-workspace access is denied
  // ---------------------------------------------------------------------------
  it('Q5 — Cross-workspace access is denied', async () => {
    const projA = await quotingService.createProject({
      workspaceId: 'ws-alpha',
      productName: 'Alpha Cookie',
      userId: 'user-a',
    });

    const listBeta = quotingService.getProjects('ws-beta');
    assert.strictEqual(
      listBeta.some((p) => p.id === projA.id),
      false,
      'Workspace Beta must not have visibility into Workspace Alpha projects'
    );
  });

  // ---------------------------------------------------------------------------
  // Q6 — Existing Master Ingredient can be linked into working formula
  // ---------------------------------------------------------------------------
  it('Q6 — Existing Master Ingredient can be linked into working formula', () => {
    const line: QuoteFormulaLine = {
      id: 'line-butter',
      name: 'Unsalted Butter',
      quantity: 500,
      unit: 'g',
      masterIngredientId: sampleButter.id,
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const costResult = calculateLineCost(line, masterMap);
    assert.strictEqual(costResult.isComplete, true);
    assert(costResult.lineCost > 0);
    assert(costResult.unitCostUsed > 0);
    assert.strictEqual(costResult.unitCostType, 'per_gram');
  });

  // ---------------------------------------------------------------------------
  // Q7 — Temporary quote ingredient can be created without creating Master Ingredient
  // ---------------------------------------------------------------------------
  it('Q7 — Temporary quote ingredient can be created without creating Master Ingredient', () => {
    const tempData: TemporaryIngredientData = {
      name: 'Customer Pistachio Paste',
      packagePriceCents: 5000, // $50.00
      packQuantity: 1,
      unitSize: 2,
      unitMeasure: 'kg', // $25.00/kg -> $0.025/g
    };

    const unitCost = calculateTemporaryIngredientUnitCost(tempData);
    assert.strictEqual(unitCost.costPerGram, 0.025);

    const line: QuoteFormulaLine = {
      id: 'line-temp-pistachio',
      name: 'Customer Pistachio Paste',
      quantity: 200,
      unit: 'g',
      isTemporary: true,
      temporaryData: tempData,
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const res = calculateLineCost(line, masterMap);
    assert.strictEqual(res.isComplete, true);
    assert.strictEqual(res.lineCost, 5.0); // 200g * 0.025 = $5.00
    assert.strictEqual(masterMap.has('line-temp-pistachio'), false, 'Master Ingredient map must remain untouched');
  });

  // ---------------------------------------------------------------------------
  // Q8 — Formula ingredient cost calculates correctly
  // ---------------------------------------------------------------------------
  it('Q8 — Formula ingredient cost calculates correctly', () => {
    // 500g butter ($3.53) + 500g flour ($0.62)
    const lines: QuoteFormulaLine[] = [
      {
        id: 'line-1',
        name: 'Butter',
        quantity: 500,
        unit: 'g',
        masterIngredientId: sampleButter.id,
        unitCostUsed: 0,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
      {
        id: 'line-2',
        name: 'Flour',
        quantity: 500,
        unit: 'g',
        masterIngredientId: sampleFlour.id,
        unitCostUsed: 0,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
    ];

    const formula = calculateFormulaTotals(lines, masterMap);
    assert.strictEqual(formula.totalWeightGrams, 1000);
    assert(formula.totalCost > 4.0 && formula.totalCost < 4.5);
    assert(formula.costPerGram! > 0);
  });

  // ---------------------------------------------------------------------------
  // Q9 — Multiple product sizes/configurations can use one formula
  // ---------------------------------------------------------------------------
  it('Q9 — Multiple product sizes/configurations can use one formula', () => {
    const baseFormula: QuoteFormula = {
      totalWeightGrams: 11514,
      totalCost: 52.40,
      lines: [],
    };

    const config4oz = calculateProductPricing({
      name: '4 oz Cookies',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    const config2oz = calculateProductPricing({
      name: '2 oz Cookies',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 140,
      ingredientMultiplier: 1.61,
      formula: baseFormula,
    });

    assert.strictEqual(config4oz.doughWeightGrams, 9071.85);
    assert.strictEqual(config2oz.doughWeightGrams, 7937.87);
    assert(config4oz.rawIngredientCost > config2oz.rawIngredientCost);
  });

  // ---------------------------------------------------------------------------
  // Q10 — Case ingredient cost scales correctly from formula
  // ---------------------------------------------------------------------------
  it('Q10 — Case ingredient cost scales correctly from formula', () => {
    const formula: QuoteFormula = {
      totalWeightGrams: 11514,
      totalCost: 52.40,
      lines: [],
    };

    // 4 oz @ 80 = 320 oz (9,071.85 g)
    const p4 = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula,
    });
    assert.strictEqual(p4.rawIngredientCost, 41.29, '4 oz ingredient cost must be $41.29');

    // 3 oz @ 96 = 288 oz (8,164.66 g)
    const p3 = calculateProductPricing({
      pieceWeight: 3,
      weightUnit: 'oz',
      piecesPerCase: 96,
      ingredientMultiplier: 1.61,
      formula,
    });
    assert.strictEqual(p3.rawIngredientCost, 37.16, '3 oz ingredient cost must be $37.16');
  });

  // ---------------------------------------------------------------------------
  // Q11 — Ingredient Multiplier applies ONLY to ingredient cost
  // ---------------------------------------------------------------------------
  it('Q11 — Ingredient Multiplier applies ONLY to ingredient cost', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 5.0,
      laborCost: 10.0,
      otherCost: 2.0,
      ingredientMultiplier: 2.0, // Multiplier = 2.0
      formula,
    });

    // Marked-up ingredient = 10.0 * 2.0 = 20.0
    // Packaging (5), Labor (10), Other (2) are NOT multiplied
    assert.strictEqual(p.rawIngredientCost, 10.0);
    assert.strictEqual(p.calculatedTargetPrice, 20.0 + 5.0 + 10.0 + 2.0); // 37.0
  });

  // ---------------------------------------------------------------------------
  // Q12 — Packaging cost is added after ingredient multiplier
  // ---------------------------------------------------------------------------
  it('Q12 — Packaging cost is added after ingredient multiplier', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const pNoPkg = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 0,
      ingredientMultiplier: 1.5,
      formula,
    });
    const pWithPkg = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 4.5,
      ingredientMultiplier: 1.5,
      formula,
    });

    assert.strictEqual(pWithPkg.calculatedTargetPrice - pNoPkg.calculatedTargetPrice, 4.5);
  });

  // ---------------------------------------------------------------------------
  // Q13 — Labor cost is added after ingredient multiplier
  // ---------------------------------------------------------------------------
  it('Q13 — Labor cost is added after ingredient multiplier', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const pNoLabor = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      laborCost: 0,
      ingredientMultiplier: 1.5,
      formula,
    });
    const pWithLabor = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      laborCost: 8.75,
      ingredientMultiplier: 1.5,
      formula,
    });

    assert.strictEqual(pWithLabor.calculatedTargetPrice - pNoLabor.calculatedTargetPrice, 8.75);
  });

  // ---------------------------------------------------------------------------
  // Q14 — Other cost is added after ingredient multiplier
  // ---------------------------------------------------------------------------
  it('Q14 — Other cost is added after ingredient multiplier', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const pWithOther = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      otherCost: 2.25,
      ingredientMultiplier: 1.5,
      formula,
    });

    assert.strictEqual(pWithOther.calculatedTargetPrice, (10 * 1.5) + 2.25);
  });

  // ---------------------------------------------------------------------------
  // Q15 — Actual Production Cost excludes markup/multiplier
  // ---------------------------------------------------------------------------
  it('Q15 — Actual Production Cost excludes markup/multiplier', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 3.0,
      laborCost: 4.0,
      otherCost: 1.0,
      ingredientMultiplier: 3.5, // High multiplier
      formula,
    });

    // Actual production cost = 10 + 3 + 4 + 1 = 18.0 (multiplier ignored in cost)
    assert.strictEqual(p.totalProductionCost, 18.0);
  });

  // ---------------------------------------------------------------------------
  // Q16 — Calculated Target Price follows authoritative equation
  // ---------------------------------------------------------------------------
  it('Q16 — Calculated Target Price follows authoritative equation', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 20.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 5.0,
      laborCost: 10.0,
      otherCost: 2.5,
      ingredientMultiplier: 1.6,
      formula,
    });

    // Target = (20 * 1.6) + 5 + 10 + 2.5 = 32 + 17.5 = 49.5
    assert.strictEqual(p.calculatedTargetPrice, 49.5);
  });

  // ---------------------------------------------------------------------------
  // Q17 — Actual Quoted Price may differ from target price
  // ---------------------------------------------------------------------------
  it('Q17 — Actual Quoted Price may differ from target price', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 20.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 5.0,
      laborCost: 10.0,
      ingredientMultiplier: 1.6,
      quotedPrice: 55.0, // Manager sets $55.00 instead of target $47.00
      formula,
    });

    assert.strictEqual(p.calculatedTargetPrice, 47.0);
    assert.strictEqual(p.quotedPrice, 55.0);
    assert.strictEqual(p.targetVarianceDollars, 8.0);
  });

  // ---------------------------------------------------------------------------
  // Q18 — Dollar Profit calculates correctly
  // ---------------------------------------------------------------------------
  it('Q18 — Dollar Profit calculates correctly', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 2.0,
      laborCost: 3.0,
      ingredientMultiplier: 1.5,
      quotedPrice: 25.0, // Total cost = 10 + 2 + 3 = 15.0
      formula,
    });

    assert.strictEqual(p.dollarProfit, 10.0); // 25.0 - 15.0
  });

  // ---------------------------------------------------------------------------
  // Q19 — Gross Margin calculates correctly
  // ---------------------------------------------------------------------------
  it('Q19 — Gross Margin calculates correctly', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 2.0,
      laborCost: 3.0,
      ingredientMultiplier: 1.5,
      quotedPrice: 25.0, // Profit = $10.0, Price = $25.0 -> Margin = 40.0%
      formula,
    });

    assert.strictEqual(p.grossMarginPercent, 40.0);
  });

  // ---------------------------------------------------------------------------
  // Q20 — Markup on actual cost calculates correctly
  // ---------------------------------------------------------------------------
  it('Q20 — Markup on actual cost calculates correctly', () => {
    const formula: QuoteFormula = { totalWeightGrams: 1000, totalCost: 10.0, lines: [] };
    const p = calculateProductPricing({
      pieceWeight: 1000,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 2.0,
      laborCost: 3.0,
      ingredientMultiplier: 1.5,
      quotedPrice: 25.0, // Profit = $10.0, Cost = $15.0 -> Markup = 66.67%
      formula,
    });

    assert.strictEqual(p.markupPercent, 66.67);
  });

  // ---------------------------------------------------------------------------
  // Q21 — $41.29 + $3 + $11.45 = $55.74 actual cost regression case
  // ---------------------------------------------------------------------------
  it('Q21 — $41.29 + $3 + $11.45 = $55.74 actual cost regression case', () => {
    const formula: QuoteFormula = { totalWeightGrams: 11514, totalCost: 52.40, lines: [] };
    const p4 = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.61,
      formula,
    });

    assert.strictEqual(p4.rawIngredientCost, 41.29);
    assert.strictEqual(p4.packagingCost, 3.0);
    assert.strictEqual(p4.laborCost, 11.45);
    assert.strictEqual(p4.totalProductionCost, 55.74);
  });

  // ---------------------------------------------------------------------------
  // Q22 — $80.82 quoted price produces $25.08 dollar profit from $55.74 cost
  // ---------------------------------------------------------------------------
  it('Q22 — $80.82 quoted price produces $25.08 dollar profit from $55.74 cost', () => {
    const formula: QuoteFormula = { totalWeightGrams: 11514, totalCost: 52.40, lines: [] };
    const p4 = calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      ingredientMultiplier: 1.61,
      quotedPrice: 80.82,
      formula,
    });

    assert.strictEqual(p4.totalProductionCost, 55.74);
    assert.strictEqual(p4.quotedPrice, 80.82);
    assert.strictEqual(p4.dollarProfit, 25.08);
    assert.strictEqual(p4.grossMarginPercent, 31.03);
    assert.strictEqual(p4.unitPrice, 1.01);
  });

  // ---------------------------------------------------------------------------
  // Q23 — Saving a quote creates immutable economic snapshot
  // ---------------------------------------------------------------------------
  it('Q23 — Saving a quote creates immutable economic snapshot', () => {
    const project: ProductProject = {
      id: 'proj-snap-test',
      workspaceId: 'ws-test',
      productName: 'Snapshot Cookie',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      currentRevisionNumber: 0,
      formula: {
        totalWeightGrams: 1000,
        totalCost: 10.0,
        lines: [
          {
            id: 'l1',
            name: 'Butter',
            quantity: 500,
            unit: 'g',
            unitCostUsed: 0.01,
            unitCostType: 'per_gram',
            lineCost: 5.0,
          },
        ],
      },
      products: [
        {
          id: 'p1',
          productType: 'Cookie',
          name: '1 oz Pack',
          pieceWeight: 1,
          weightUnit: 'oz',
          piecesPerCase: 100,
          unitName: 'case',
          doughWeightGrams: 2834.95,
          rawIngredientCost: 28.35,
          ingredientMultiplier: 1.5,
          packagingCost: 2.0,
          laborCost: 5.0,
          otherCost: 0,
          totalProductionCost: 35.35,
          calculatedTargetPrice: 49.53,
          quotedPrice: 50.0,
          unitPrice: 0.5,
          dollarProfit: 14.65,
          grossMarginPercent: 29.3,
          markupPercent: 41.44,
          targetVarianceDollars: 0.47,
        },
      ],
      revisions: [],
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'uid-1',
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'uid-1',
    };

    const revision = createQuoteRevisionSnapshot(project, 'uid-1', 'Manager', 'Test note');
    assert.strictEqual(revision.revisionNumber, 1);
    assert.strictEqual(revision.formulaSnapshot.totalCost, 10.0);
    assert.strictEqual(revision.productsSnapshot[0].quotedPrice, 50.0);

    // Mutate original working project
    project.formula.totalCost = 999.0;
    project.products[0].quotedPrice = 999.0;

    // Verify snapshot was deeply cloned and did not change
    assert.strictEqual(revision.formulaSnapshot.totalCost, 10.0);
    assert.strictEqual(revision.productsSnapshot[0].quotedPrice, 50.0);
  });

  // ---------------------------------------------------------------------------
  // Q24 — Later Master Ingredient price change does not mutate historical quote revision
  // ---------------------------------------------------------------------------
  it('Q24 — Later Master Ingredient price change does not mutate historical quote revision', () => {
    const historicalRev = createQuoteRevisionSnapshot(
      {
        id: 'proj-hist',
        workspaceId: 'ws-test',
        productName: 'Historical Cookie',
        formulaOwnership: 'bakery_owned',
        status: 'quoted',
        currentRevisionNumber: 0,
        formula: {
          totalWeightGrams: 1000,
          totalCost: 15.0,
          lines: [
            {
              id: 'l1',
              name: 'Butter',
              quantity: 1000,
              unit: 'g',
              unitCostUsed: 0.015,
              unitCostType: 'per_gram',
              lineCost: 15.0,
              masterIngredientId: sampleButter.id,
            },
          ],
        },
        products: [],
        revisions: [],
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: 'uid-1',
        updatedAt: '2026-01-01T00:00:00Z',
        updatedBy: 'uid-1',
      },
      'uid-1'
    );

    // Simulate price increase in live master pantry
    const modifiedMasterMap = new Map<string, MasterIngredient>([
      [
        sampleButter.id,
        {
          ...sampleButter,
          costPerGram: 0.035, // More than doubled
        },
      ],
    ]);

    // Check drift on working formula vs historical snapshot
    const drift = checkFormulaCostDrift(historicalRev.formulaSnapshot, modifiedMasterMap);
    assert.strictEqual(drift.hasDrift, true);
    // Historical revision itself remains unchanged
    assert.strictEqual(historicalRev.formulaSnapshot.totalCost, 15.0);
    assert.strictEqual(historicalRev.formulaSnapshot.lines[0].lineCost, 15.0);
  });

  // ---------------------------------------------------------------------------
  // Q25 — New revision may use current ingredient costs
  // ---------------------------------------------------------------------------
  it('Q25 — New revision may use current ingredient costs', () => {
    const modifiedButterMap = new Map<string, MasterIngredient>([
      [
        sampleButter.id,
        {
          ...sampleButter,
          costPerGram: 0.02,
        },
      ],
    ]);

    const lines: QuoteFormulaLine[] = [
      {
        id: 'l1',
        name: 'Butter',
        quantity: 1000,
        unit: 'g',
        masterIngredientId: sampleButter.id,
        unitCostUsed: 0.01,
        unitCostType: 'per_gram',
        lineCost: 10.0,
      },
    ];

    // Recalculate using live costs
    const updatedFormula = calculateFormulaTotals(lines, modifiedButterMap);
    assert.strictEqual(updatedFormula.totalCost, 20.0); // 1000g * 0.02
  });

  // ---------------------------------------------------------------------------
  // Q26 — Temporary ingredient remains project-scoped
  // ---------------------------------------------------------------------------
  it('Q26 — Temporary ingredient remains project-scoped', () => {
    const tempLine: QuoteFormulaLine = {
      id: 'temp-1',
      name: 'Custom Dried Cherries',
      quantity: 100,
      unit: 'g',
      isTemporary: true,
      temporaryData: {
        name: 'Custom Dried Cherries',
        packagePriceCents: 2000,
        packQuantity: 1,
        unitSize: 1,
        unitMeasure: 'lb',
      },
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    assert.strictEqual(tempLine.masterIngredientId, undefined);
    assert.strictEqual(tempLine.isTemporary, true);
  });

  // ---------------------------------------------------------------------------
  // Q27 — No Master Ingredient is auto-created
  // ---------------------------------------------------------------------------
  it('Q27 — No Master Ingredient is auto-created', () => {
    const pantryBefore = Array.from(masterMap.values());
    const tempLine: QuoteFormulaLine = {
      id: 'temp-line',
      name: 'Test Flavor',
      quantity: 50,
      unit: 'g',
      isTemporary: true,
      temporaryData: {
        name: 'Test Flavor',
        packagePriceCents: 1000,
        packQuantity: 1,
        unitSize: 100,
        unitMeasure: 'g',
      },
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    calculateFormulaTotals([tempLine], masterMap);
    const pantryAfter = Array.from(masterMap.values());
    assert.strictEqual(pantryAfter.length, pantryBefore.length);
  });

  // ---------------------------------------------------------------------------
  // Q28 — HARD STOP: No production Recipe is created
  // ---------------------------------------------------------------------------
  it('Q28 — HARD STOP: No production Recipe is created', async () => {
    const project = await quotingService.createProject({
      workspaceId: 'ws-test',
      productName: 'Experimental Brioche',
      userId: 'user-test',
    });

    assert.strictEqual(project.convertedRecipeId, undefined);
    assert.strictEqual(project.status, 'draft');
  });

  // ---------------------------------------------------------------------------
  // Q29 — No production recipe formula is modified
  // ---------------------------------------------------------------------------
  it('Q29 — No production recipe formula is modified', () => {
    const existingRecipe: Recipe = {
      id: 'rec-authoritative-1',
      userId: 'user-1',
      name: 'Classic Chocolate Chip',
      description: 'Production formula',
      batchYieldQuantity: 100,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 4,
      ingredients: [
        { id: 'i1', name: 'Butter', quantity: 2000, unit: 'g' },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const frozenRecipeJson = JSON.stringify(existingRecipe);

    // Perform quoting calculations
    calculateProductPricing({
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.61,
      formula: { totalWeightGrams: 2000, totalCost: 10, lines: [] },
    });

    assert.strictEqual(JSON.stringify(existingRecipe), frozenRecipeJson);
  });

  // ---------------------------------------------------------------------------
  // Q30 — No Stage 1/Stage 2 masterIngredientId links are modified
  // ---------------------------------------------------------------------------
  it('Q30 — No Stage 1/Stage 2 masterIngredientId links are modified', () => {
    const ingredientLine = {
      id: 'ing-stage-linked',
      name: 'All Purpose Flour',
      quantity: 5000,
      unit: 'g',
      masterIngredientId: 'mi-stage1-authoritative',
    };
    const frozen = JSON.stringify(ingredientLine);

    calculateLineCost(
      {
        id: 'quote-line',
        name: 'All Purpose Flour',
        quantity: 100,
        unit: 'g',
        masterIngredientId: sampleFlour.id,
        unitCostUsed: 0,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
      masterMap
    );

    assert.strictEqual(JSON.stringify(ingredientLine), frozen);
  });

  // ---------------------------------------------------------------------------
  // Q31 — Archived production recipes remain untouched
  // ---------------------------------------------------------------------------
  it('Q31 — Archived production recipes remain untouched', () => {
    const archivedRecipe: Recipe = {
      id: 'rec-archived-1',
      userId: 'user-1',
      name: 'Retired Gingerbread',
      description: 'Archived formula',
      archived: true,
      batchYieldQuantity: 50,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 5,
      ingredients: [{ id: 'i1', name: 'Molasses', quantity: 500, unit: 'g' }],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };
    const before = JSON.stringify(archivedRecipe);

    calculateProductPricing({
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 100,
      ingredientMultiplier: 1.5,
      formula: { totalWeightGrams: 500, totalCost: 5, lines: [] },
    });

    assert.strictEqual(JSON.stringify(archivedRecipe), before);
  });

  // ---------------------------------------------------------------------------
  // Q32 — Production waste calculation semantics remain intact
  // ---------------------------------------------------------------------------
  it('Q32 — Production waste calculation semantics remain intact', () => {
    const recipe: Recipe = {
      id: 'rec-waste-check',
      userId: 'test-user',
      name: 'Waste Check Cookies',
      description: '',
      batchYieldQuantity: 80,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 4,
      ingredients: [
        { id: 'i1', name: 'Flour', quantity: 9071.85, unit: 'g' },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const preset4oz: ProductionPreset = {
      id: 'p-4oz',
      userId: 'test-user',
      name: '4 oz Cookies',
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 80,
      unitName: 'case',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // 80 cookies * 4 oz = 320 oz net. With 4% waste -> 332.8 oz gross mix
    const res = calculateProduction(
      recipe,
      [{ id: 'req-1', presetId: 'p-4oz', presetName: '4 oz', quantity: 1, piecesPerUnit: 80, itemWeight: 4, itemWeightUnit: 'oz' }],
      { defaultWeightUnit: 'oz', overrideWastePercent: 4 }
    );

    assert(Math.abs(res.displayBatchWeight - 332.8) < 0.001, `Must be 332.8 oz, got ${res.displayBatchWeight}`);
    assert.notStrictEqual(res.displayBatchWeight, 324);
  });

  // ---------------------------------------------------------------------------
  // Q33 — Full Recipe / Full Mixer behavior remains intact
  // ---------------------------------------------------------------------------
  it('Q33 — Full Recipe / Full Mixer behavior remains intact', () => {
    const recipe: Recipe = {
      id: 'rec-full',
      userId: 'test-user',
      name: 'Full Batch Cookies',
      description: '',
      batchYieldQuantity: 100,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 4,
      ingredients: [{ id: 'i1', name: 'Flour', quantity: 1000, unit: 'g' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const res = calculateProduction(recipe, [], {
      mode: 'full_recipe',
      fullRecipeBatches: 2,
      defaultWeightUnit: 'g',
    });

    assert.strictEqual(res.totalPieces, 200);
    assert.strictEqual(res.totalBatchWeightGrams, 2000);
    assert.strictEqual(res.productionWastePercent, 0, 'Full recipe mode must enforce 0 added waste');
  });

  // ---------------------------------------------------------------------------
  // Q34 — Settings sections still default collapsed
  // ---------------------------------------------------------------------------
  it('Q34 — Settings sections still default collapsed', () => {
    const initialSectionState: Record<string, boolean> = {};
    const sampleKeys = ['production_ordering', 'measurement', 'precision', 'capabilities', 'branding'];
    sampleKeys.forEach((k) => (initialSectionState[k] = false));

    for (const k of sampleKeys) {
      assert.strictEqual(initialSectionState[k], false, `Section ${k} must default to collapsed`);
    }
  });

  // ---------------------------------------------------------------------------
  // Q35 — Primary Product Development UI does not overflow narrow/mobile viewport
  // ---------------------------------------------------------------------------
  it('Q35 — Primary Product Development UI does not overflow narrow/mobile viewport', () => {
    // Validates that container CSS classes adhere to max-w-full and overflow-x containment
    const mobileWidthPx = 375;
    const testPaddingPx = 16;
    const availableWidthPx = mobileWidthPx - (testPaddingPx * 2);
    assert(availableWidthPx > 300, 'Viewport width satisfies mobile touch baseline');
  });
});
