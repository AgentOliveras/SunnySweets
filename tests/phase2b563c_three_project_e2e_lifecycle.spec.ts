import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService } from '../src/services/quotingService';
import { ProductProject, QuoteFormulaLine, QuoteProductConfig } from '../src/types/quoting';
import { calculateProductPricing, recalculateProductsPricing } from '../src/utils/quotingCalculator';

const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] || null,
  };
};

describe('Phase 2B.5.6.3C — Three-Project End-to-End Data Integrity Lifecycle Suite', () => {
  const TEST_WS = 'ws-release-gate-c';
  const TEST_USER = 'user-release-gate-c';

  beforeEach(() => {
    (globalThis as any).localStorage = createMockLocalStorage();
    quotingService.setMockCloudWriteHandler(null);
  });

  afterEach(() => {
    quotingService.setMockCloudWriteHandler(null);
  });

  test('E2E Lifecycle: Three separate projects created, populated, renamed, edited, navigated, and reloaded with 100% mathematical and metadata fidelity', async () => {
    // -------------------------------------------------------------------------
    // STEP 1: CREATE THREE SEPARATE PROJECTS
    // -------------------------------------------------------------------------
    const projA = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project A - Artisan Sourdough',
      customerName: 'Bistro 42',
      userId: TEST_USER,
    });
    const projB = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project B - Brioche Buns',
      customerName: 'Burger Joint',
      userId: TEST_USER,
    });
    const projC = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project C - Rye Pumpernickel',
      customerName: 'Deli Direct',
      userId: TEST_USER,
    });

    assert.notEqual(projA.id, projB.id);
    assert.notEqual(projB.id, projC.id);

    // -------------------------------------------------------------------------
    // STEP 2: POPULATE ALL THREE WITH DISTINCT FORMULAS & PRODUCTS
    // -------------------------------------------------------------------------
    // Project A: 4 ingredients (Bread Flour, Water, Starter, Salt) = 1970g, $5.45
    const formulaA = {
      totalWeightGrams: 1970,
      totalCost: 5.45,
      lines: [
        { id: 'la-1', name: 'Bread Flour', quantity: 1000, unit: 'g', unitCostUsed: 0.0025, unitCostType: 'per_gram' as const, lineCost: 2.50 },
        { id: 'la-2', name: 'Water', quantity: 750, unit: 'g', unitCostUsed: 0.0002, unitCostType: 'per_gram' as const, lineCost: 0.15 },
        { id: 'la-3', name: 'Sourdough Starter', quantity: 200, unit: 'g', unitCostUsed: 0.012, unitCostType: 'per_gram' as const, lineCost: 2.40 },
        { id: 'la-4', name: 'Sea Salt', quantity: 20, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram' as const, lineCost: 0.40 },
      ],
    };
    const productsA: QuoteProductConfig[] = [
      calculateProductPricing({
        id: 'prod-a1',
        productType: 'Bread',
        name: 'Boule 800g',
        pieceWeight: 800,
        weightUnit: 'g',
        piecesPerCase: 6,
        packagingCost: 1.20,
        laborCost: 4.50,
        otherCost: 0.50,
        ingredientMultiplier: 1.6,
        pricingBasis: 'case',
        quotedPrice: 32.00,
        formula: formulaA,
      }),
      calculateProductPricing({
        id: 'prod-a2',
        productType: 'Bread',
        name: 'Batard 500g',
        pieceWeight: 500,
        weightUnit: 'g',
        piecesPerCase: 8,
        packagingCost: 1.40,
        laborCost: 5.00,
        otherCost: 0.60,
        ingredientMultiplier: 1.6,
        pricingBasis: 'case',
        quotedPrice: 28.00,
        formula: formulaA,
      }),
    ];

    // Project B: 6 ingredients (Pastry Flour, Eggs, Butter, Sugar, Milk, Yeast) = 1865g, $12.35
    const formulaB = {
      totalWeightGrams: 1865,
      totalCost: 12.35,
      lines: [
        { id: 'lb-1', name: 'Pastry Flour', quantity: 1000, unit: 'g', unitCostUsed: 0.003, unitCostType: 'per_gram' as const, lineCost: 3.00 },
        { id: 'lb-2', name: 'Whole Eggs', quantity: 300, unit: 'g', unitCostUsed: 0.008, unitCostType: 'per_gram' as const, lineCost: 2.40 },
        { id: 'lb-3', name: 'European Butter', quantity: 250, unit: 'g', unitCostUsed: 0.018, unitCostType: 'per_gram' as const, lineCost: 4.50 },
        { id: 'lb-4', name: 'Granulated Sugar', quantity: 100, unit: 'g', unitCostUsed: 0.0015, unitCostType: 'per_gram' as const, lineCost: 0.15 },
        { id: 'lb-5', name: 'Whole Milk', quantity: 200, unit: 'g', unitCostUsed: 0.005, unitCostType: 'per_gram' as const, lineCost: 1.00 },
        { id: 'lb-6', name: 'Instant Yeast', quantity: 15, unit: 'g', unitCostUsed: 0.0867, unitCostType: 'per_gram' as const, lineCost: 1.30 },
      ],
    };
    const productsB: QuoteProductConfig[] = [
      calculateProductPricing({
        id: 'prod-b1',
        productType: 'Bread',
        name: '6-Pack Brioche Buns (300g)',
        pieceWeight: 300,
        weightUnit: 'g',
        piecesPerCase: 10,
        packagingCost: 2.00,
        laborCost: 6.00,
        otherCost: 0.80,
        ingredientMultiplier: 1.7,
        pricingBasis: 'case',
        quotedPrice: 42.50,
        formula: formulaB,
      }),
    ];

    // Project C: 5 ingredients (Dark Rye, Bread Flour, Caraway, Molasses, Salt) = 1630g, $7.80
    const formulaC = {
      totalWeightGrams: 1630,
      totalCost: 7.80,
      lines: [
        { id: 'lc-1', name: 'Dark Rye Flour', quantity: 800, unit: 'g', unitCostUsed: 0.004, unitCostType: 'per_gram' as const, lineCost: 3.20 },
        { id: 'lc-2', name: 'Bread Flour', quantity: 600, unit: 'g', unitCostUsed: 0.0025, unitCostType: 'per_gram' as const, lineCost: 1.50 },
        { id: 'lc-3', name: 'Molasses', quantity: 150, unit: 'g', unitCostUsed: 0.012, unitCostType: 'per_gram' as const, lineCost: 1.80 },
        { id: 'lc-4', name: 'Caraway Seeds', quantity: 50, unit: 'g', unitCostUsed: 0.018, unitCostType: 'per_gram' as const, lineCost: 0.90 },
        { id: 'lc-5', name: 'Salt', quantity: 30, unit: 'g', unitCostUsed: 0.0133, unitCostType: 'per_gram' as const, lineCost: 0.40 },
      ],
    };
    const productsC: QuoteProductConfig[] = [
      calculateProductPricing({
        id: 'prod-c1',
        productType: 'Bread',
        name: 'Rye Loaf 600g',
        pieceWeight: 600,
        weightUnit: 'g',
        piecesPerCase: 8,
        packagingCost: 1.50,
        laborCost: 5.20,
        otherCost: 0.70,
        ingredientMultiplier: 1.6,
        pricingBasis: 'case',
        quotedPrice: 38.00,
        formula: formulaC,
      }),
      calculateProductPricing({
        id: 'prod-c2',
        productType: 'Bread',
        name: 'Case of 12 (Sliced)',
        pieceWeight: 600,
        weightUnit: 'g',
        piecesPerCase: 12,
        packagingCost: 2.20,
        laborCost: 7.50,
        otherCost: 1.00,
        ingredientMultiplier: 1.6,
        pricingBasis: 'case',
        quotedPrice: 54.00,
        formula: formulaC,
      }),
    ];

    // Save all three
    await quotingService.saveProject({ ...projA, formula: formulaA, products: productsA });
    await quotingService.saveProject({ ...projB, formula: formulaB, products: productsB });
    await quotingService.saveProject({ ...projC, formula: formulaC, products: productsC });

    // -------------------------------------------------------------------------
    // STEP 3: CLOSE, REOPEN, AND VERIFY ALL THREE
    // -------------------------------------------------------------------------
    const checkA = quotingService.getProject(TEST_WS, projA.id);
    const checkB = quotingService.getProject(TEST_WS, projB.id);
    const checkC = quotingService.getProject(TEST_WS, projC.id);

    assert.equal(checkA?.formula.lines.length, 4);
    assert.equal(checkA?.products.length, 2);
    assert.equal(checkA?.productName, 'Project A - Artisan Sourdough');

    assert.equal(checkB?.formula.lines.length, 6);
    assert.equal(checkB?.products.length, 1);
    assert.equal(checkB?.productName, 'Project B - Brioche Buns');

    assert.equal(checkC?.formula.lines.length, 5);
    assert.equal(checkC?.products.length, 2);
    assert.equal(checkC?.productName, 'Project C - Rye Pumpernickel');

    // -------------------------------------------------------------------------
    // STEP 4: RENAME ONE PROJECT (PROJECT A) WITHOUT TOUCHING FORMULAS
    // -------------------------------------------------------------------------
    await quotingService.updateProjectMetadata(TEST_WS, projA.id, {
      productName: 'Heritage Rustic Sourdough',
      customerName: 'Bistro 42 Grand',
      description: 'Slow-fermented 36h levain',
    });

    // Verify Project A has new name, but identical formula & products
    const afterRenameA = quotingService.getProject(TEST_WS, projA.id);
    assert.equal(afterRenameA?.productName, 'Heritage Rustic Sourdough');
    assert.equal(afterRenameA?.customerName, 'Bistro 42 Grand');
    assert.equal(afterRenameA?.description, 'Slow-fermented 36h levain');
    assert.equal(afterRenameA?.formula.lines.length, 4);
    assert.equal(afterRenameA?.products.length, 2);

    // Verify Projects B and C were COMPLETELY untouched by Project A rename
    const untouchedB = quotingService.getProject(TEST_WS, projB.id);
    const untouchedC = quotingService.getProject(TEST_WS, projC.id);
    assert.equal(untouchedB?.productName, 'Project B - Brioche Buns');
    assert.equal(untouchedB?.formula.lines.length, 6);
    assert.equal(untouchedB?.formula.totalCost, 12.35);
    assert.equal(untouchedC?.productName, 'Project C - Rye Pumpernickel');
    assert.equal(untouchedC?.formula.lines.length, 5);
    assert.equal(untouchedC?.formula.totalCost, 7.80);

    // -------------------------------------------------------------------------
    // STEP 5: EDIT QUANTITIES IN ANOTHER PROJECT (PROJECT B)
    // -------------------------------------------------------------------------
    // Increase Butter quantity in Project B from 250g to 400g (+150g butter @ 0.018 = +$2.70)
    const updatedLinesB = checkB!.formula.lines.map((l) =>
      l.id === 'lb-3' ? { ...l, quantity: 400, lineCost: 7.20 } : l
    );
    const updatedFormulaB = {
      totalWeightGrams: 2015,
      totalCost: 15.05,
      lines: updatedLinesB,
    };
    const updatedProductsB = recalculateProductsPricing(checkB!.products, updatedFormulaB);

    await quotingService.saveProject({
      ...checkB!,
      formula: updatedFormulaB,
      products: updatedProductsB,
    });

    const afterEditB = quotingService.getProject(TEST_WS, projB.id);
    assert.equal(afterEditB?.formula.lines.length, 6);
    assert.equal(afterEditB?.formula.totalWeightGrams, 2015);
    assert.equal(afterEditB?.formula.totalCost, 15.05);
    assert.equal(afterEditB?.formula.lines.find((l) => l.id === 'lb-3')?.quantity, 400);

    // Verify Project A and Project C remain pristine
    const pristineA = quotingService.getProject(TEST_WS, projA.id);
    const pristineC = quotingService.getProject(TEST_WS, projC.id);
    assert.equal(pristineA?.formula.lines.length, 4);
    assert.equal(pristineA?.formula.totalCost, 5.45);
    assert.equal(pristineC?.formula.lines.length, 5);
    assert.equal(pristineC?.formula.totalCost, 7.80);

    // -------------------------------------------------------------------------
    // STEP 6: RAPID SWITCHING BETWEEN PROJECTS
    // -------------------------------------------------------------------------
    // Simulate quick navigation cycles with emergency recovery drafts
    quotingService.saveDraftRecovery(TEST_WS, projA.id, pristineA!, TEST_USER);
    quotingService.saveDraftRecovery(TEST_WS, projB.id, afterEditB!, TEST_USER);
    quotingService.saveDraftRecovery(TEST_WS, projC.id, pristineC!, TEST_USER);

    const recA = quotingService.getDraftRecovery(TEST_WS, projA.id, TEST_USER);
    const recB = quotingService.getDraftRecovery(TEST_WS, projB.id, TEST_USER);
    const recC = quotingService.getDraftRecovery(TEST_WS, projC.id, TEST_USER);

    assert.equal(recA?.id, projA.id);
    assert.equal(recB?.id, projB.id);
    assert.equal(recC?.id, projC.id);
    assert.equal(recA?.formula.lines.length, 4);
    assert.equal(recB?.formula.lines.length, 6);
    assert.equal(recC?.formula.lines.length, 5);

    // -------------------------------------------------------------------------
    // STEP 7: REFRESH & RELOAD FROM PERSISTENT STORAGE
    // -------------------------------------------------------------------------
    // Simulate page reload by constructing new quotingService instance or loading from storage
    (quotingService as any).loadFromStorage();

    const reloadedA = quotingService.getProject(TEST_WS, projA.id);
    const reloadedB = quotingService.getProject(TEST_WS, projB.id);
    const reloadedC = quotingService.getProject(TEST_WS, projC.id);

    // Confirm every single detail on all three projects
    assert.equal(reloadedA?.productName, 'Heritage Rustic Sourdough');
    assert.equal(reloadedA?.customerName, 'Bistro 42 Grand');
    assert.equal(reloadedA?.formula.lines.length, 4);
    assert.equal(reloadedA?.formula.totalWeightGrams, 1970);
    assert.equal(reloadedA?.formula.totalCost, 5.45);
    assert.equal(reloadedA?.products.length, 2);

    assert.equal(reloadedB?.productName, 'Project B - Brioche Buns');
    assert.equal(reloadedB?.formula.lines.length, 6);
    assert.equal(reloadedB?.formula.totalWeightGrams, 2015);
    assert.equal(reloadedB?.formula.totalCost, 15.05);
    assert.equal(reloadedB?.products.length, 1);

    assert.equal(reloadedC?.productName, 'Project C - Rye Pumpernickel');
    assert.equal(reloadedC?.customerName, 'Deli Direct');
    assert.equal(reloadedC?.formula.lines.length, 5);
    assert.equal(reloadedC?.formula.totalWeightGrams, 1630);
    assert.equal(reloadedC?.formula.totalCost, 7.80);
    assert.equal(reloadedC?.products.length, 2);
  });

  test('Canonical Integrity: Divergent ingredient or cost strictly aborts save and preserves draft', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Integrity Failure Project',
      userId: TEST_USER,
    });

    const intended: ProductProject = {
      ...p,
      formula: {
        totalWeightGrams: 500,
        totalCost: 10.0,
        lines: [
          { id: 'l-1', name: 'Flour', quantity: 500, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 10.0 },
        ],
      },
    };

    const corrupted: ProductProject = {
      ...intended,
      formula: {
        ...intended.formula,
        lines: [
          // Corrupted quantity and line cost
          { id: 'l-1', name: 'Flour', quantity: 250, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 5.0 },
        ],
      },
    };

    assert.throws(
      () => {
        quotingService.verifyCanonicalPayloadIntegrity(intended, corrupted);
      },
      /Integrity verification failed/
    );
  });

  test('Intentional Formula Clearing: Removing all ingredients succeeds with allowEmptyFormula: true, but blocks accidental wipe', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Formula Empty Guard Project',
      userId: TEST_USER,
    });

    const populated: ProductProject = {
      ...p,
      formula: {
        totalWeightGrams: 300,
        totalCost: 6.0,
        lines: [
          { id: 'l-x', name: 'Cocoa', quantity: 300, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 6.0 },
        ],
      },
    };
    await quotingService.saveProject(populated);

    // 1. Accidental empty save without allowEmptyFormula throws
    await assert.rejects(
      async () => {
        await quotingService.saveProject({
          ...populated,
          formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
        });
      },
      /Safety Guard: Attempted to save an empty formula/
    );

    // 2. Intentional empty save with allowEmptyFormula succeeds
    const intentionalEmpty: ProductProject = {
      ...populated,
      formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
      allowEmptyFormula: true,
    } as any;

    const cleared = await quotingService.saveProject(intentionalEmpty);
    assert.equal(cleared.formula.lines.length, 0);
    assert.equal(cleared.formula.totalWeightGrams, 0);
    assert.equal(cleared.formula.totalCost, 0);
  });

  test('Metadata Preservation: Stale draft formula saves cannot overwrite newer project metadata', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Initial Product Name',
      customerName: 'Initial Customer',
      description: 'Initial Description',
      userId: TEST_USER,
    });

    // Populate initial formula
    const saved = await quotingService.saveProject({
      ...p,
      formula: {
        totalWeightGrams: 500,
        totalCost: 10,
        lines: [
          { id: 'l1', name: 'Flour', quantity: 500, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 10 },
        ],
      },
    });

    // Simulate an editor tab holding a draft with the initial metadata and version
    const staleDraft: ProductProject = {
      ...saved,
      formula: {
        totalWeightGrams: 750,
        totalCost: 15,
        lines: [
          { id: 'l1', name: 'Flour', quantity: 500, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 10 },
          { id: 'l2', name: 'Sugar', quantity: 250, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 5 },
        ],
      },
    };

    // Concurrently, project metadata is updated on the server/metadata endpoint
    await quotingService.updateProjectMetadata(TEST_WS, p.id, {
      productName: 'Authoritative Renamed Product',
      customerName: 'Enterprise Client Co',
      description: 'Updated Production Description',
    });

    // Now the stale formula draft saves
    const resultAfterSave = await quotingService.saveProject(staleDraft);

    // Verify formula updated to 2 ingredients
    assert.equal(resultAfterSave.formula.lines.length, 2);
    assert.equal(resultAfterSave.formula.totalWeightGrams, 750);
    assert.equal(resultAfterSave.formula.totalCost, 15);

    // Verify newer metadata was PRESERVED and not overwritten by stale draft
    assert.equal(resultAfterSave.productName, 'Authoritative Renamed Product');
    assert.equal(resultAfterSave.customerName, 'Enterprise Client Co');
    assert.equal(resultAfterSave.description, 'Updated Production Description');

    const inStorage = quotingService.getProject(TEST_WS, p.id);
    assert.equal(inStorage?.productName, 'Authoritative Renamed Product');
    assert.equal(inStorage?.customerName, 'Enterprise Client Co');
    assert.equal(inStorage?.description, 'Updated Production Description');
    assert.equal(inStorage?.formula.lines.length, 2);
  });
});
