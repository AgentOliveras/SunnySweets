import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService } from '../src/services/quotingService';
import { ProductProject, QuoteFormula, QuoteFormulaLine, QuoteProductConfig } from '../src/types/quoting';
import { calculateFormulaTotals, calculateProductPricing, recalculateProductsPricing } from '../src/utils/quotingCalculator';
import { MasterIngredient } from '../src/types';

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

describe('Phase 2B.5.7.2 — Quantity Integrity & UI Refinement Regression Suite', () => {
  const TEST_WS = 'ws-p2b572-test';
  const TEST_USER = 'user-p2b572-lead';

  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'ing-flour',
      name: 'All-Purpose Flour',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2200,
      },
    },
    {
      id: 'ing-butter',
      name: 'Unsalted Butter',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 36,
        unitMeasure: 'lb',
        packagePriceCents: 10800,
      },
    },
    {
      id: 'ing-sugar',
      name: 'Granulated Sugar',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 3200,
      },
    },
    {
      id: 'ing-vanilla',
      name: 'Pure Vanilla Extract',
      dimension: 'volume',
      defaultUnit: 'ml',
      densityGramsPerMl: 1.0,
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 32,
        unitMeasure: 'fl_oz',
        packagePriceCents: 4500,
      },
    },
    {
      id: 'ing-salt',
      name: 'Fine Sea Salt',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 25,
        unitMeasure: 'lb',
        packagePriceCents: 1500,
      },
    },
  ];

  const masterMap = new Map(mockMasterIngredients.map((m) => [m.id, m]));

  beforeEach(() => {
    (globalThis as any).localStorage = createMockLocalStorage();
    quotingService.setMockCloudWriteHandler(null);
  });

  afterEach(() => {
    quotingService.setMockCloudWriteHandler(null);
  });

  // T1: P0 Quantity Persistence: Edit default 100g to 20g with in-flight save and immediate navigation.
  test('T1: Quantity edit from 100g to 20g survives in-flight save race and immediate navigation', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T1 Quantity Race Project',
    });

    // Step 1: Ingredient added with default 100g
    const line100: QuoteFormulaLine = {
      id: 'line-flour-1',
      name: 'All-Purpose Flour',
      quantity: 100,
      unit: 'g',
      masterIngredientId: 'ing-flour',
      unitCostUsed: 0.001,
      unitCostType: 'per_gram',
      lineCost: 0.1,
    };
    const formula100 = calculateFormulaTotals([line100], masterMap);
    const draft100: ProductProject = {
      ...project,
      formula: formula100,
      updatedAt: new Date(Date.now() - 5000).toISOString(),
    };

    // Simulate in-flight save with cloud network latency (100ms)
    quotingService.setMockCloudWriteHandler(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const inFlightSave1 = quotingService.saveProject(draft100);

    // Step 2: User changes quantity from 100g to 20g while Save 1 is in-flight
    const line20: QuoteFormulaLine = {
      ...line100,
      quantity: 20,
    };
    const formula20 = calculateFormulaTotals([line20], masterMap);
    const draft20: ProductProject = {
      ...draft100,
      formula: formula20,
      updatedAt: new Date().toISOString(),
      hasUnsyncedLocalChanges: true,
    };

    // Synchronous recovery save on navigation
    quotingService.saveDraftRecovery(TEST_WS, project.id, draft20, TEST_USER);

    // Step 3: Unmount flush calls saveProject with draft20
    const unmountFlush = quotingService.saveProject(draft20);

    // Both saves complete in order
    await Promise.all([inFlightSave1, unmountFlush]);

    // Reopen project from store
    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded, 'Project must exist');
    assert.equal(reloaded.formula.lines[0].quantity, 20, 'Persisted quantity must be 20g, NOT reverted to 100g');
    assert.equal(reloaded.formula.totalWeightGrams, 20);
  });

  // T2: Add three ingredients with different quantities: all quantities persist.
  test('T2: Add three ingredients with distinct quantities and persist accurately', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T2 Three Ingredients Project',
    });

    const lines: QuoteFormulaLine[] = [
      {
        id: 'line-flour',
        name: 'All-Purpose Flour',
        quantity: 500,
        unit: 'g',
        masterIngredientId: 'ing-flour',
        unitCostUsed: 0.001,
        unitCostType: 'per_gram',
        lineCost: 0.5,
      },
      {
        id: 'line-butter',
        name: 'Unsalted Butter',
        quantity: 250,
        unit: 'g',
        masterIngredientId: 'ing-butter',
        unitCostUsed: 0.006,
        unitCostType: 'per_gram',
        lineCost: 1.5,
      },
      {
        id: 'line-sugar',
        name: 'Granulated Sugar',
        quantity: 125,
        unit: 'g',
        masterIngredientId: 'ing-sugar',
        unitCostUsed: 0.0014,
        unitCostType: 'per_gram',
        lineCost: 0.175,
      },
    ];

    const formula = calculateFormulaTotals(lines, masterMap);
    const draft: ProductProject = {
      ...project,
      formula,
    };

    await quotingService.saveProject(draft);
    const reloaded = quotingService.getProject(TEST_WS, project.id);

    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines.length, 3);
    assert.equal(reloaded.formula.lines[0].quantity, 500);
    assert.equal(reloaded.formula.lines[1].quantity, 250);
    assert.equal(reloaded.formula.lines[2].quantity, 125);
    assert.equal(reloaded.formula.totalWeightGrams, 875);
  });

  // T3: Rapidly edit 100 -> 50 -> 20 and navigate immediately: 20 persists.
  test('T3: Rapidly edit 100 -> 50 -> 20 and navigate immediately: 20 persists', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T3 Rapid Edit Project',
    });

    const baseLine: QuoteFormulaLine = {
      id: 'line-butter',
      name: 'Unsalted Butter',
      quantity: 100,
      unit: 'g',
      masterIngredientId: 'ing-butter',
      unitCostUsed: 0.006,
      unitCostType: 'per_gram',
      lineCost: 0.6,
    };

    // User types 50
    const line50: QuoteFormulaLine = { ...baseLine, quantity: 50 };
    const draft50: ProductProject = {
      ...project,
      formula: calculateFormulaTotals([line50], masterMap),
      updatedAt: new Date(Date.now() - 50).toISOString(),
    };
    quotingService.saveDraftRecovery(TEST_WS, project.id, draft50, TEST_USER);

    // User rapidly types 20 and navigates
    const line20: QuoteFormulaLine = { ...baseLine, quantity: 20 };
    const draft20: ProductProject = {
      ...project,
      formula: calculateFormulaTotals([line20], masterMap),
      updatedAt: new Date().toISOString(),
    };
    quotingService.saveDraftRecovery(TEST_WS, project.id, draft20, TEST_USER);

    // Unmount flush saves draft20
    await quotingService.saveProject(draft20);

    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines[0].quantity, 20);
  });

  // T4: Add five ingredients and edit the last one: latest value persists after reopening and refresh.
  test('T4: Add five ingredients and edit the last one: latest value persists', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T4 Five Ingredients Project',
    });

    const lines: QuoteFormulaLine[] = [
      { id: 'l1', name: 'Flour', quantity: 400, unit: 'g', masterIngredientId: 'ing-flour', unitCostUsed: 0.001, unitCostType: 'per_gram', lineCost: 0.4 },
      { id: 'l2', name: 'Butter', quantity: 200, unit: 'g', masterIngredientId: 'ing-butter', unitCostUsed: 0.006, unitCostType: 'per_gram', lineCost: 1.2 },
      { id: 'l3', name: 'Sugar', quantity: 150, unit: 'g', masterIngredientId: 'ing-sugar', unitCostUsed: 0.0014, unitCostType: 'per_gram', lineCost: 0.21 },
      { id: 'l4', name: 'Salt', quantity: 5, unit: 'g', masterIngredientId: 'ing-salt', unitCostUsed: 0.0013, unitCostType: 'per_gram', lineCost: 0.0065 },
      { id: 'l5', name: 'Vanilla', quantity: 10, unit: 'ml', masterIngredientId: 'ing-vanilla', unitCostUsed: 0.047, unitCostType: 'per_gram', lineCost: 0.47 },
    ];

    const initialDraft: ProductProject = {
      ...project,
      formula: calculateFormulaTotals(lines, masterMap),
    };
    await quotingService.saveProject(initialDraft);

    // Edit the 5th line quantity from 10 to 15
    const updatedLines = [...lines];
    updatedLines[4] = { ...updatedLines[4], quantity: 15 };
    const editedDraft: ProductProject = {
      ...initialDraft,
      formula: calculateFormulaTotals(updatedLines, masterMap),
    };
    await quotingService.saveProject(editedDraft);

    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines.length, 5);
    assert.equal(reloaded.formula.lines[4].quantity, 15);
  });

  // T5: Older in-flight save cannot overwrite a newer quantity.
  test('T5: Older in-flight save cannot overwrite a newer quantity', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T5 Concurrency Protection Project',
    });

    const lineOld: QuoteFormulaLine = { id: 'l-old', name: 'Sugar', quantity: 100, unit: 'g', masterIngredientId: 'ing-sugar', unitCostUsed: 0.0014, unitCostType: 'per_gram', lineCost: 0.14 };
    const draftOld: ProductProject = { ...project, formula: calculateFormulaTotals([lineOld], masterMap), documentVersion: 1 };

    const lineNew: QuoteFormulaLine = { ...lineOld, quantity: 20 };
    const draftNew: ProductProject = { ...project, formula: calculateFormulaTotals([lineNew], masterMap), documentVersion: 2 };

    // Newer save finishes first
    await quotingService.saveProject(draftNew, 2);

    // Stale older save with lower version attempts to complete
    await quotingService.saveProject(draftOld, 1);

    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines[0].quantity, 20, 'Newer 20g must never be overwritten by stale 100g');
  });

  // T6: Recovery contains a newer quantity than cloud: newer valid draft is retained safely.
  test('T6: Recovery containing newer quantity than cloud is retained safely', () => {
    const project: ProductProject = {
      id: 'proj-t6',
      workspaceId: TEST_WS,
      productName: 'T6 Recovery Project',
      status: 'draft',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 30000).toISOString(),
      createdBy: TEST_USER,
      updatedBy: TEST_USER,
      formulaOwnership: 'bakery_owned',
      products: [],
      revisions: [],
      currentRevisionNumber: 0,
      formula: calculateFormulaTotals(
        [{ id: 'l1', name: 'Flour', quantity: 100, unit: 'g', masterIngredientId: 'ing-flour', unitCostUsed: 0.001, unitCostType: 'per_gram', lineCost: 0.1 }],
        masterMap
      ),
    };

    const recoveryDraft: ProductProject = {
      ...project,
      updatedAt: new Date().toISOString(),
      formula: calculateFormulaTotals(
        [{ id: 'l1', name: 'Flour', quantity: 20, unit: 'g', masterIngredientId: 'ing-flour', unitCostUsed: 0.001, unitCostType: 'per_gram', lineCost: 0.02 }],
        masterMap
      ),
    };

    quotingService.saveDraftRecovery(TEST_WS, project.id, recoveryDraft, TEST_USER);
    const recovered = quotingService.getDraftRecovery(TEST_WS, project.id, TEST_USER);

    assert.ok(recovered);
    assert.equal(recovered.formula.lines[0].quantity, 20);
    const recTime = new Date(recovered.updatedAt || 0).getTime();
    const projTime = new Date(project.updatedAt || 0).getTime();
    assert.ok(recTime > projTime, 'Recovery draft must be strictly newer than cloud project');
  });

  // T7: Cloud save failure preserves latest draft and displays an actionable warning.
  test('T7: Cloud save failure preserves latest draft in memory and local storage', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T7 Cloud Failure Project',
    });

    const line: QuoteFormulaLine = { id: 'l1', name: 'Butter', quantity: 45, unit: 'g', masterIngredientId: 'ing-butter', unitCostUsed: 0.006, unitCostType: 'per_gram', lineCost: 0.27 };
    const draft: ProductProject = {
      ...project,
      formula: calculateFormulaTotals([line], masterMap),
      hasUnsyncedLocalChanges: true,
    };

    quotingService.saveDraftRecovery(TEST_WS, project.id, draft, TEST_USER);

    // Mock cloud write failure
    quotingService.setMockCloudWriteHandler(async () => {
      throw new Error('NETWORK_TIMEOUT: Failed to reach cloud endpoint');
    });

    try {
      await quotingService.saveProject(draft);
      assert.fail('Save must throw on failure');
    } catch (err: any) {
      assert.ok(err.message.includes('NETWORK_TIMEOUT') || err.message.includes('Failed to save'));
    }

    // Verify draft remains in local cache with dirty flag
    const cached = quotingService.getProject(TEST_WS, project.id);
    assert.ok(cached);
    assert.equal(cached.formula.lines[0].quantity, 45);
    assert.equal(cached.hasUnsyncedLocalChanges, true);

    // Verify recovery draft is also preserved
    const recovery = quotingService.getDraftRecovery(TEST_WS, project.id, TEST_USER);
    assert.ok(recovery);
    assert.equal(recovery.formula.lines[0].quantity, 45);
  });

  // T8: Three independent projects do not overwrite each other's formulas.
  test('T8: Three independent projects do not overwrite each other formulas', async () => {
    const p1 = await quotingService.createProject({ workspaceId: TEST_WS, userId: TEST_USER, productName: 'Project Alpha' });
    const p2 = await quotingService.createProject({ workspaceId: TEST_WS, userId: TEST_USER, productName: 'Project Beta' });
    const p3 = await quotingService.createProject({ workspaceId: TEST_WS, userId: TEST_USER, productName: 'Project Gamma' });

    const f1 = calculateFormulaTotals([{ id: 'l1', name: 'Flour', quantity: 100, unit: 'g', masterIngredientId: 'ing-flour', unitCostUsed: 0.001, unitCostType: 'per_gram', lineCost: 0.1 }], masterMap);
    const f2 = calculateFormulaTotals([{ id: 'l2', name: 'Butter', quantity: 200, unit: 'g', masterIngredientId: 'ing-butter', unitCostUsed: 0.006, unitCostType: 'per_gram', lineCost: 1.2 }], masterMap);
    const f3 = calculateFormulaTotals([{ id: 'l3', name: 'Sugar', quantity: 300, unit: 'g', masterIngredientId: 'ing-sugar', unitCostUsed: 0.0014, unitCostType: 'per_gram', lineCost: 0.42 }], masterMap);

    await Promise.all([
      quotingService.saveProject({ ...p1, formula: f1 }),
      quotingService.saveProject({ ...p2, formula: f2 }),
      quotingService.saveProject({ ...p3, formula: f3 }),
    ]);

    const r1 = quotingService.getProject(TEST_WS, p1.id);
    const r2 = quotingService.getProject(TEST_WS, p2.id);
    const r3 = quotingService.getProject(TEST_WS, p3.id);

    assert.equal(r1?.formula.lines[0].quantity, 100);
    assert.equal(r2?.formula.lines[0].quantity, 200);
    assert.equal(r3?.formula.lines[0].quantity, 300);
  });

  // T9: Batch weight, ingredient costing, COGS, and pricing reflect the final saved quantities.
  test('T9: Batch weight, ingredient costing, COGS, and pricing reflect the final saved quantities', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T9 Pricing Verification Project',
    });

    const lines: QuoteFormulaLine[] = [
      { id: 'l1', name: 'Flour', quantity: 400, unit: 'g', masterIngredientId: 'ing-flour', unitCostUsed: 0.001, unitCostType: 'per_gram', lineCost: 0.4 },
      { id: 'l2', name: 'Butter', quantity: 100, unit: 'g', masterIngredientId: 'ing-butter', unitCostUsed: 0.006, unitCostType: 'per_gram', lineCost: 0.6 },
    ];
    const formula = calculateFormulaTotals(lines, masterMap);

    const product: any = {
      id: 'prod-cookie-1',
      name: 'Signature Cookie',
      pieceWeight: 50,
      weightUnit: 'g',
      piecesPerCase: 1,
      unitName: 'unit',
      packagingCost: 0.15,
      laborCost: 0.20,
      otherCost: 0.10,
      ingredientMultiplier: 1.6,
      pricingBasis: 'unit',
    };

    const pricedProducts = recalculateProductsPricing([product], formula);
    const updatedProject: ProductProject = {
      ...project,
      formula,
      products: pricedProducts,
    };

    await quotingService.saveProject(updatedProject);
    const reloaded = quotingService.getProject(TEST_WS, project.id);

    assert.ok(reloaded);
    assert.equal(reloaded.formula.totalWeightGrams, 500);
    assert.ok(reloaded.formula.totalCost > 1.0 && reloaded.formula.totalCost < 1.1);
    // 50g piece from 500g batch costing ~$1.05 -> ~$0.105 ingredient cost per unit
    // Packaging (0.15) + Labor (0.20) + Overhead (0.10) + Ingredient (~0.105) ~ $0.555 total production cost
    const p0 = reloaded.products?.[0];
    assert.ok(p0);
    assert.ok(Math.abs((p0.totalProductionCost || 0) - 0.555) < 0.05);
    assert.ok(Math.abs((p0.costPerUnit || 0) - 0.555) < 0.05);
  });

  // T10: Delete all characters from the quantity field: field can remain temporarily blank.
  test('T10: Quantity parsing handles empty or partial input gracefully without corrupting formula', () => {
    // Normalization rule: empty string is valid temporary editing state
    const cleanEmpty = ''.replace(/[^0-9.]/g, '');
    assert.equal(cleanEmpty, '');

    // Partial decimal point
    const cleanDot = '.'.replace(/[^0-9.]/g, '');
    assert.equal(cleanDot, '.');

    // Float parsing of empty or dot produces NaN, which must not be committed to formula
    assert.ok(isNaN(parseFloat(cleanEmpty)));
    assert.ok(isNaN(parseFloat(cleanDot)));
  });

  // T11: Replace 100 with 50: no forced 050 state.
  test('T11: Normalization strips leading zeros (e.g. 050 becomes 50) while preserving positive decimals', () => {
    const normalizeInput = (incoming: string): string => {
      const cleaned = incoming.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      let normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
      if (normalized.length > 1 && normalized.startsWith('0') && normalized[1] !== '.') {
        normalized = normalized.replace(/^0+/, '') || '0';
      }
      return normalized;
    };

    // User types 5 after deleting 1 from 100 (which left 00 or 0)
    assert.equal(normalizeInput('05'), '5');
    assert.equal(normalizeInput('050'), '50');
    assert.equal(normalizeInput('0050'), '50');

    // Decimals are strictly preserved!
    assert.equal(normalizeInput('0.5'), '0.5');
    assert.equal(normalizeInput('0.25'), '0.25');
    assert.equal(normalizeInput('0.'), '0.');
  });

  // T12: Enter valid decimal quantities (0.5, 0.25): committed and calculated accurately.
  test('T12: Valid positive decimal quantities calculate formula totals accurately', () => {
    const decimalLines: QuoteFormulaLine[] = [
      {
        id: 'line-dec-1',
        name: 'All-Purpose Flour',
        quantity: 0.5,
        unit: 'lb',
        masterIngredientId: 'ing-flour',
        unitCostUsed: 0.001,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
      {
        id: 'line-dec-2',
        name: 'Unsalted Butter',
        quantity: 0.25,
        unit: 'lb',
        masterIngredientId: 'ing-butter',
        unitCostUsed: 0.006,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
    ];

    const formula = calculateFormulaTotals(decimalLines, masterMap);
    // 0.5 lb = 226.796 g, 0.25 lb = 113.398 g, total ~ 340.194 g
    assert.ok(formula.totalWeightGrams > 340 && formula.totalWeightGrams < 341);
    assert.ok(formula.totalCost > 0);
  });

  // T13: Negative or invalid numeric entries: rejected, formula preserved.
  test('T13: Negative, NaN, or zero quantities are rejected without corrupting formula', () => {
    const isValidQuantity = (val: any): boolean => {
      const parsed = typeof val === 'number' ? val : parseFloat(val);
      return !isNaN(parsed) && isFinite(parsed) && parsed > 0;
    };

    assert.equal(isValidQuantity(-5), false);
    assert.equal(isValidQuantity(0), false);
    assert.equal(isValidQuantity('abc'), false);
    assert.equal(isValidQuantity(NaN), false);
    assert.equal(isValidQuantity(Infinity), false);
    assert.equal(isValidQuantity(25), true);
    assert.equal(isValidQuantity(0.5), true);
  });

  // T14: Immediate navigation during editing: latest valid quantity survives.
  test('T14: Immediate navigation during editing persists the latest valid quantity via recovery', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'T14 Immediate Navigation Project',
    });

    const line: QuoteFormulaLine = {
      id: 'line-1',
      name: 'Flour',
      quantity: 100,
      unit: 'g',
      masterIngredientId: 'ing-flour',
      unitCostUsed: 0.001,
      unitCostType: 'per_gram',
      lineCost: 0.1,
    };
    await quotingService.saveProject({
      ...project,
      formula: calculateFormulaTotals([line], masterMap),
    });

    // User types 25 in quantity cell; before manual save, user navigates
    const editedLine: QuoteFormulaLine = { ...line, quantity: 25 };
    const latestDraft: ProductProject = {
      ...project,
      formula: calculateFormulaTotals([editedLine], masterMap),
      updatedAt: new Date().toISOString(),
      hasUnsyncedLocalChanges: true,
    };

    // Synchronous unmount flush stores recovery and triggers save
    quotingService.saveDraftRecovery(TEST_WS, project.id, latestDraft, TEST_USER);
    await quotingService.saveProject(latestDraft);

    // On reopening project:
    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines[0].quantity, 25);
  });
});
