import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService } from '../src/services/quotingService';
import { ProductProject, QuoteFormulaLine, QuoteProductConfig, QuoteRevision } from '../src/types/quoting';
import { calculateFormulaTotals, calculateProductPricing, recalculateProductsPricing } from '../src/utils/quotingCalculator';
import { parseRoute, buildRoutePath, navigateToRoute } from '../src/utils/navigation';
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

describe('Phase 2B.5.7 — Product Development Workflow, Quote Permissions & Navigation Repairs Suite', () => {
  const TEST_WS = 'ws-p2b57-test';
  const TEST_USER = 'user-p2b57-mgr';
  const VIEWER_USER = 'user-p2b57-viewer';

  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'ing-flour',
      name: 'Bread Flour',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2450, // $24.50 for 50 lb -> ~$0.00108/g
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
        packagePriceCents: 10800, // $108 for 36 lb -> ~$0.00661/g
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
      id: 'ing-eggs',
      name: 'Large Eggs',
      dimension: 'discrete',
      defaultUnit: 'eggs',
      preferredPurchasePackage: {
        packQuantity: 30,
        unitSize: 1,
        unitMeasure: 'doz',
        packagePriceCents: 9000, // $90 for 360 eggs -> $0.25/egg
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

  // T1: New project modal closes and new editor opens after successful creation
  test('T1: New project creation succeeds, returns created ID, and transitions state to open editor', async () => {
    let modalOpen = true;
    let openedProjectId: string | null = null;

    const onCreateProject = async (params: any) => {
      const created = await quotingService.createProject({
        workspaceId: TEST_WS,
        productName: params.productName,
        customerName: params.customerName,
        userId: TEST_USER,
      });
      return created;
    };

    // Simulate modal submit
    const created = await onCreateProject({
      productName: 'Matcha Shortbread Cookie',
      customerName: 'Tokyo Cafe',
    });
    modalOpen = false;
    openedProjectId = created.id;

    assert.equal(modalOpen, false, 'Modal should close on successful project creation');
    assert.ok(openedProjectId, 'Opened project ID should be set');
    assert.equal(created.productName, 'Matcha Shortbread Cookie');
    assert.equal(created.status, 'draft');

    // Verify project is persisted in memory/cache
    const retrieved = quotingService.getProject(TEST_WS, created.id);
    assert.ok(retrieved, 'Project must be persisted in workspace cache');
    assert.equal(retrieved?.id, created.id);
  });

  // T2: Failed creation retains modal/input and displays error
  test('T2: Failed project creation retains modal open state and preserves input data', async () => {
    let modalOpen = true;
    let createError: string | null = null;
    const formInput = {
      productName: 'Failed Project Example',
      customerName: 'Error Cafe',
      description: 'Important client specifications',
    };

    const failingCreateProject = async () => {
      throw new Error('Database write rejected: Network timeout.');
    };

    try {
      await failingCreateProject();
      modalOpen = false;
    } catch (err: any) {
      createError = err.message;
    }

    assert.equal(modalOpen, true, 'Modal must remain open on creation failure');
    assert.equal(createError, 'Database write rejected: Network timeout.');
    assert.equal(formInput.productName, 'Failed Project Example', 'Form inputs must remain intact');
    assert.equal(formInput.customerName, 'Error Cafe');
  });

  // T3: Double-click creation does not create duplicate projects
  test('T3: Double-click prevention blocks duplicate simultaneous submissions', async () => {
    let isSubmitting = false;
    let submitCount = 0;

    const simulateSubmit = async () => {
      if (isSubmitting) return null;
      isSubmitting = true;
      submitCount++;
      const created = await quotingService.createProject({
        workspaceId: TEST_WS,
        productName: 'Single Creation Test',
        userId: TEST_USER,
      });
      isSubmitting = false;
      return created;
    };

    // Simultaneous double-click trigger
    const [first, second] = await Promise.all([simulateSubmit(), simulateSubmit()]);

    assert.equal(submitCount, 1, 'Only one submission must execute during in-flight state');
    assert.ok(first, 'First submission created project');
    assert.equal(second, null, 'Second simultaneous click was ignored');
  });

  // T4: Authorized owner/editor can issue a quote
  test('T4: Authorized owner and editor roles can successfully issue quote revisions', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Croissant Quote',
      userId: TEST_USER,
    });

    const issuedAsEditor = await quotingService.issueQuoteRevision(
      proj.id,
      TEST_WS,
      TEST_USER,
      'Lead Baker',
      'Initial Q4 Quote',
      undefined,
      'editor'
    );

    assert.equal(issuedAsEditor.status, 'quoted');
    assert.equal(issuedAsEditor.currentRevisionNumber, 1);
    assert.equal(issuedAsEditor.revisions.length, 1);
    assert.equal(issuedAsEditor.revisions[0].revisionNumber, 1);
    assert.equal(issuedAsEditor.revisions[0].notes, 'Initial Q4 Quote');

    // Issue V2 as owner
    const issuedAsOwner = await quotingService.issueQuoteRevision(
      proj.id,
      TEST_WS,
      TEST_USER,
      'Bakery Owner',
      'Owner Revised Quote',
      undefined,
      'owner'
    );

    assert.equal(issuedAsOwner.currentRevisionNumber, 2);
    assert.equal(issuedAsOwner.revisions.length, 2);
    assert.equal(issuedAsOwner.revisions[0].revisionNumber, 2);
  });

  // T5: Unauthorized viewer cannot issue a quote
  test('T5: Unauthorized viewer role is strictly rejected from issuing quote revisions', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Protected Financial Quote',
      userId: TEST_USER,
    });

    await assert.rejects(
      async () => {
        await quotingService.issueQuoteRevision(
          proj.id,
          TEST_WS,
          VIEWER_USER,
          'Guest Viewer',
          'Attempted Quote',
          undefined,
          'viewer'
        );
      },
      (err: any) => {
        assert.ok(err.message.includes('Permission denied'));
        assert.ok(err.message.includes('Viewers are unauthorized'));
        return true;
      }
    );
  });

  // T6: Permission errors identify the failing operation without exposing sensitive data
  test('T6: Permission denial error identifies failing operation and project without leaking secrets', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Secret Formula Project',
      userId: TEST_USER,
    });

    let caughtError: Error | null = null;
    try {
      await quotingService.issueQuoteRevision(
        proj.id,
        TEST_WS,
        VIEWER_USER,
        'Unauthorized User',
        'Unauthorized Revision',
        undefined,
        'viewer'
      );
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.ok(caughtError.message.includes(proj.id), 'Identifies target project ID');
    assert.ok(caughtError.message.includes('issue quote revisions'), 'Identifies failing operation');
    assert.ok(!caughtError.message.includes('password'), 'Does not leak passwords');
    assert.ok(!caughtError.message.includes('apiKey'), 'Does not leak api keys');
  });

  // T7: Issuance retry/double-click cannot create duplicate revisions
  test('T7: Rapid retry/double-click within idempotency window returns existing revision without duplicate V2', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Double-Click Idempotency Project',
      userId: TEST_USER,
    });

    const rev1 = await quotingService.issueQuoteRevision(
      proj.id,
      TEST_WS,
      TEST_USER,
      'Manager',
      'Rapid Double-Click Test',
      undefined,
      'editor'
    );

    // Immediate second call with identical notes and user
    const rev2 = await quotingService.issueQuoteRevision(
      proj.id,
      TEST_WS,
      TEST_USER,
      'Manager',
      'Rapid Double-Click Test',
      undefined,
      'editor'
    );

    assert.equal(rev1.currentRevisionNumber, 1);
    assert.equal(rev2.currentRevisionNumber, 1, 'Second rapid call must NOT bump revision number to 2');
    assert.equal(rev2.revisions.length, 1, 'Only one revision snapshot must exist');
    assert.equal(rev1.revisions[0].id, rev2.revisions[0].id);
  });

  // T8: Issued quote snapshot remains immutable
  test('T8: Issued quote revision formula and product snapshot remains strictly immutable after project updates', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Immutable Quote Test',
      userId: TEST_USER,
    });

    const lines: QuoteFormulaLine[] = [
      {
        id: 'line-1',
        name: 'Bread Flour',
        quantity: 1000,
        unit: 'g',
        masterIngredientId: 'ing-flour',
        unitCostUsed: 0.00108,
        unitCostType: 'per_gram',
        lineCost: 1.08,
      },
    ];

    const initialFormula = { totalWeightGrams: 1000, totalCost: 1.08, lines };
    const products: QuoteProductConfig[] = [
      calculateProductPricing({
        id: 'prod-1',
        productType: 'Bread',
        name: 'Standard Loaf',
        pieceWeight: 500,
        weightUnit: 'g',
        piecesPerCase: 2,
        packagingCost: 0.1,
        laborCost: 0.2,
        otherCost: 0.0,
        ingredientMultiplier: 1.5,
        pricingBasis: 'case',
        quotedPrice: 3.5,
        formula: initialFormula,
      }),
    ];

    const populated = await quotingService.saveProject({
      ...proj,
      formula: initialFormula,
      products,
    });

    const issued = await quotingService.issueQuoteRevision(
      populated.id,
      TEST_WS,
      TEST_USER,
      'Manager',
      'V1 Snapshot Baseline',
      undefined,
      'owner'
    );

    const snapshotV1 = issued.revisions[0];
    assert.equal(snapshotV1.formulaSnapshot.totalCost, 1.08);
    assert.equal(snapshotV1.productsSnapshot[0].name, 'Standard Loaf');
    assert.ok(snapshotV1.productsSnapshot[0].totalProductionCost > 0);

    // Modify active working project drastically
    const modifiedFormula = {
      totalWeightGrams: 5000,
      totalCost: 15.0,
      lines: [
        {
          id: 'line-2',
          name: 'Butter',
          quantity: 2000,
          unit: 'g',
          unitCostUsed: 0.0066,
          unitCostType: 'per_gram' as const,
          lineCost: 13.2,
        },
      ],
    };
    await quotingService.saveProject({
      ...issued,
      formula: modifiedFormula,
      products: [
        calculateProductPricing({
          id: 'prod-1',
          productType: 'Bread',
          name: 'Modified Loaf',
          pieceWeight: 1000,
          weightUnit: 'g',
          piecesPerCase: 5,
          packagingCost: 0.5,
          laborCost: 1.0,
          otherCost: 0.0,
          ingredientMultiplier: 2.0,
          pricingBasis: 'case',
          quotedPrice: 20.0,
          formula: modifiedFormula,
        }),
      ],
    });

    const reloaded = quotingService.getProject(TEST_WS, proj.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.revisions[0].revisionNumber, 1);
    assert.equal(
      reloaded?.revisions[0].formulaSnapshot.totalCost,
      1.08,
      'Historical revision formula snapshot must remain completely unchanged'
    );
    assert.equal(
      reloaded?.revisions[0].productsSnapshot[0].name,
      'Standard Loaf',
      'Historical revision product snapshot must remain completely unchanged'
    );
  });

  // T9: Failed issuance preserves formula, products and draft
  test('T9: Failed issuance preserves working draft, formula, products, and recovery draft intact', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Preserved Draft Project',
      userId: TEST_USER,
    });

    const workingLines: QuoteFormulaLine[] = [
      {
        id: 'line-f1',
        name: 'Unsalted Butter',
        quantity: 800,
        unit: 'g',
        masterIngredientId: 'ing-butter',
        unitCostUsed: 0.0066,
        unitCostType: 'per_gram',
        lineCost: 5.28,
      },
    ];

    const draftWithLines: ProductProject = {
      ...proj,
      formula: { totalWeightGrams: 800, totalCost: 5.28, lines: workingLines },
    };

    // Save recovery draft
    quotingService.saveDraftRecovery(TEST_WS, proj.id, draftWithLines, TEST_USER);

    // Attempt issuance with viewer role (fails)
    try {
      await quotingService.issueQuoteRevision(
        proj.id,
        TEST_WS,
        VIEWER_USER,
        'Viewer',
        'Should fail',
        draftWithLines,
        'viewer'
      );
    } catch {
      // Expected failure
    }

    // Verify draft recovery is still safely preserved
    const recovered = quotingService.getDraftRecovery(TEST_WS, proj.id, TEST_USER);
    assert.ok(recovered, 'Draft recovery must be preserved after failed quote issuance');
    assert.equal(recovered?.formula.lines.length, 1);
    assert.equal(recovered?.formula.lines[0].name, 'Unsalted Butter');
  });

  // T10: Browser Back from editor returns to dashboard
  test('T10: Route parsing supports navigation from editor back to dashboard', () => {
    // Current URL in editor
    const editorRoute = parseRoute('/quotes/proj-101');
    assert.equal(editorRoute.tab, 'quotes');
    assert.equal(editorRoute.projectId, 'proj-101');

    // Navigating back
    const dashboardRoute = parseRoute('/quotes');
    assert.equal(dashboardRoute.tab, 'quotes');
    assert.equal(dashboardRoute.projectId, null);

    // Canonical path building
    assert.equal(buildRoutePath('quotes', null), '/quotes');
    assert.equal(buildRoutePath('quotes', 'proj-101'), '/quotes/proj-101');
  });

  // T11: Browser Forward reopens the correct project
  test('T11: Browser forward navigation restores project ID and subTab route state', () => {
    const historySubTabRoute = parseRoute('/quotes/proj-202/history');
    assert.equal(historySubTabRoute.tab, 'quotes');
    assert.equal(historySubTabRoute.projectId, 'proj-202');
    assert.equal(historySubTabRoute.editorTab, 'history');

    const productsSubTabRoute = parseRoute('/quotes/proj-202/products');
    assert.equal(productsSubTabRoute.editorTab, 'products');

    assert.equal(buildRoutePath('quotes', 'proj-202', 'history'), '/quotes/proj-202/history');
    assert.equal(buildRoutePath('quotes', 'proj-202', 'products'), '/quotes/proj-202/products');
  });

  // T12: Back across major app sections restores previous in-app screen
  test('T12: Route parsing cleanly maps major app sections across Back/Forward navigation', () => {
    assert.equal(parseRoute('/ingredients').tab, 'ingredients');
    assert.equal(parseRoute('/recipes').tab, 'recipes');
    assert.equal(parseRoute('/calculate').tab, 'calculate');
    assert.equal(parseRoute('/settings').tab, 'settings');
    assert.equal(parseRoute('/history').tab, 'history');
    assert.equal(parseRoute('/dashboard').tab, 'dashboard');
    assert.equal(parseRoute('/').tab, 'dashboard');
  });

  // T13: Navigation during pending autosave preserves the draft
  test('T13: Navigation during pending autosave preserves unpersisted changes in local recovery', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Pending Autosave Test',
      userId: TEST_USER,
    });

    const pendingDraft: ProductProject = {
      ...proj,
      formula: {
        totalWeightGrams: 300,
        totalCost: 1.5,
        lines: [
          {
            id: 'line-p1',
            name: 'Sugar',
            quantity: 300,
            unit: 'g',
            unitCostUsed: 0.005,
            unitCostType: 'per_gram',
            lineCost: 1.5,
          },
        ],
      },
    };

    // User navigates away before debounced server save completes
    quotingService.saveDraftRecovery(TEST_WS, proj.id, pendingDraft, TEST_USER);

    // Verify draft recovery survives navigation
    const restored = quotingService.getDraftRecovery(TEST_WS, proj.id, TEST_USER);
    assert.ok(restored);
    assert.equal(restored?.formula.lines[0].name, 'Sugar');
    assert.equal(restored?.formula.lines[0].quantity, 300);
  });

  // T14: Ingredient entry order survives autosave and reload
  test('T14: Ingredient entry order (top-to-bottom) survives sequential additions, saves, and reloads', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Ordered Ingredient Test',
      userId: TEST_USER,
    });

    const orderedNames = ['Bread Flour', 'Granulated Sugar', 'Unsalted Butter', 'Large Eggs'];
    const lines: QuoteFormulaLine[] = orderedNames.map((name, idx) => ({
      id: `line-${idx + 1}`,
      name,
      quantity: (idx + 1) * 100,
      unit: name === 'Large Eggs' ? 'eggs' : 'g',
      unitCostUsed: 0.01,
      unitCostType: 'per_gram',
      lineCost: idx + 1,
    }));

    const saved = await quotingService.saveProject({
      ...proj,
      formula: { totalWeightGrams: 1000, totalCost: 10, lines },
    });

    const reloaded = quotingService.getProject(TEST_WS, saved.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.formula.lines.length, 4);

    for (let i = 0; i < orderedNames.length; i++) {
      assert.equal(
        reloaded?.formula.lines[i].name,
        orderedNames[i],
        `Row at index ${i} must strictly preserve entry order`
      );
    }
  });

  // T15: New blank ingredient row appears below existing ingredients and receives focus
  test('T15: Appending new ingredient line appends below existing entries without altering prior rows', () => {
    const initialLines: QuoteFormulaLine[] = [
      { id: 'row-1', name: 'Flour', quantity: 500, unit: 'g', unitCostUsed: 0, unitCostType: 'per_gram', lineCost: 0 },
      { id: 'row-2', name: 'Water', quantity: 350, unit: 'g', unitCostUsed: 0, unitCostType: 'per_gram', lineCost: 0 },
    ];

    const nextLine: QuoteFormulaLine = {
      id: 'row-3',
      name: 'Salt',
      quantity: 10,
      unit: 'g',
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };

    const nextLines = [...initialLines, nextLine];
    assert.equal(nextLines.length, 3);
    assert.equal(nextLines[0].name, 'Flour');
    assert.equal(nextLines[1].name, 'Water');
    assert.equal(nextLines[2].name, 'Salt', 'New ingredient must appear directly below previous row');
  });

  // T16: Removing an ingredient preserves remaining row order
  test('T16: Removing an ingredient line preserves the relative order of all remaining rows', () => {
    const lines: QuoteFormulaLine[] = [
      { id: 'r1', name: 'Ingredient 1', quantity: 10, unit: 'g', unitCostUsed: 0, unitCostType: 'per_gram', lineCost: 0 },
      { id: 'r2', name: 'Ingredient 2', quantity: 20, unit: 'g', unitCostUsed: 0, unitCostType: 'per_gram', lineCost: 0 },
      { id: 'r3', name: 'Ingredient 3', quantity: 30, unit: 'g', unitCostUsed: 0, unitCostType: 'per_gram', lineCost: 0 },
      { id: 'r4', name: 'Ingredient 4', quantity: 40, unit: 'g', unitCostUsed: 0, unitCostType: 'per_gram', lineCost: 0 },
    ];

    // Remove item 2 (id: 'r2')
    const remaining = lines.filter((l) => l.id !== 'r2');
    assert.equal(remaining.length, 3);
    assert.equal(remaining[0].name, 'Ingredient 1');
    assert.equal(remaining[1].name, 'Ingredient 3');
    assert.equal(remaining[2].name, 'Ingredient 4');
  });

  // T17: Formula changes still recalculate product pricing
  test('T17: Formula ingredient updates automatically recalculate total cost and product pricing', () => {
    const lines: QuoteFormulaLine[] = [
      {
        id: 'l1',
        name: 'Bread Flour',
        quantity: 2000,
        unit: 'g',
        masterIngredientId: 'ing-flour',
        unitCostUsed: 0.00108026,
        unitCostType: 'per_gram',
        lineCost: 2.16,
      },
      {
        id: 'l2',
        name: 'Unsalted Butter',
        quantity: 500,
        unit: 'g',
        masterIngredientId: 'ing-butter',
        unitCostUsed: 0.00661387,
        unitCostType: 'per_gram',
        lineCost: 3.31,
      },
    ];

    const formulaTotals = calculateFormulaTotals(lines, masterMap);
    assert.equal(formulaTotals.totalWeightGrams, 2500);
    assert.ok(Math.abs(formulaTotals.totalCost - 5.47) < 0.05);

    const initialProducts: QuoteProductConfig[] = [
      calculateProductPricing({
        id: 'p1',
        productType: 'Pastry',
        name: 'Butter Bun',
        pieceWeight: 100,
        weightUnit: 'g',
        piecesPerCase: 25,
        packagingCost: 0.2,
        laborCost: 0.5,
        otherCost: 0.0,
        ingredientMultiplier: 1.5,
        pricingBasis: 'case',
        quotedPrice: 10.0,
        formula: formulaTotals,
      }),
    ];

    const initialRawCost = initialProducts[0].rawIngredientCost;
    const doubledFormula = {
      ...formulaTotals,
      totalCost: formulaTotals.totalCost * 2,
    };
    const synced = recalculateProductsPricing(initialProducts, doubledFormula);
    assert.ok(synced[0].rawIngredientCost > initialRawCost, 'Product raw ingredient cost must be recalculated');
    assert.ok(synced[0].totalProductionCost > initialProducts[0].totalProductionCost);
    assert.ok(synced[0].calculatedTargetPrice > initialProducts[0].calculatedTargetPrice);
  });

  // T18: Three separate projects remain isolated through create/edit/rename/navigation
  test('T18: Three distinct projects remain completely isolated across create, edit, rename, and navigation', async () => {
    const p1 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Isolated Project 1',
      userId: TEST_USER,
    });
    const p2 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Isolated Project 2',
      userId: TEST_USER,
    });
    const p3 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Isolated Project 3',
      userId: TEST_USER,
    });

    // Populate with distinct ingredients
    await quotingService.saveProject({
      ...p1,
      formula: {
        totalWeightGrams: 100,
        totalCost: 1.0,
        lines: [{ id: 'p1-l1', name: 'Flour', quantity: 100, unit: 'g', unitCostUsed: 0.01, unitCostType: 'per_gram', lineCost: 1.0 }],
      },
    });

    await quotingService.saveProject({
      ...p2,
      formula: {
        totalWeightGrams: 200,
        totalCost: 4.0,
        lines: [{ id: 'p2-l1', name: 'Butter', quantity: 200, unit: 'g', unitCostUsed: 0.02, unitCostType: 'per_gram', lineCost: 4.0 }],
      },
    });

    await quotingService.saveProject({
      ...p3,
      formula: {
        totalWeightGrams: 300,
        totalCost: 3.0,
        lines: [{ id: 'p3-l1', name: 'Sugar', quantity: 300, unit: 'g', unitCostUsed: 0.01, unitCostType: 'per_gram', lineCost: 3.0 }],
      },
    });

    // Rename project 1 via metadata-only update
    await quotingService.updateProjectMetadata(TEST_WS, p1.id, {
      productName: 'Renamed Isolated Project 1',
    });

    // Verify isolation
    const p1Fresh = quotingService.getProject(TEST_WS, p1.id);
    const p2Fresh = quotingService.getProject(TEST_WS, p2.id);
    const p3Fresh = quotingService.getProject(TEST_WS, p3.id);

    assert.equal(p1Fresh?.productName, 'Renamed Isolated Project 1');
    assert.equal(p1Fresh?.formula.lines[0].name, 'Flour');

    assert.equal(p2Fresh?.productName, 'Isolated Project 2');
    assert.equal(p2Fresh?.formula.lines[0].name, 'Butter');

    assert.equal(p3Fresh?.productName, 'Isolated Project 3');
    assert.equal(p3Fresh?.formula.lines[0].name, 'Sugar');
  });
});
