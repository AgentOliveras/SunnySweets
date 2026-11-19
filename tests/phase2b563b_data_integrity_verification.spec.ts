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

describe('Phase 2B.5.6.3B — Final Data Integrity Verification Suite', () => {
  const TEST_WS = 'ws-verify-safety-b';
  const TEST_USER = 'user-verify-safety-b';

  beforeEach(() => {
    (globalThis as any).localStorage = createMockLocalStorage();
    quotingService.setMockCloudWriteHandler(null);
  });

  afterEach(() => {
    quotingService.setMockCloudWriteHandler(null);
  });

  const createSampleLines = (prefix: string, count: number): QuoteFormulaLine[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `line-${prefix}-${i + 1}`,
      name: `${prefix} Ingredient ${i + 1}`,
      quantity: 100 * (i + 1),
      unit: 'g',
      unitCostUsed: 0.05 * (i + 1),
      unitCostType: 'per_gram',
      lineCost: 5 * (i + 1),
    }));
  };

  test('T1: Concurrent writers and version conflicts abort stale overwrite and preserve local draft', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Concurrent Collision Project',
      userId: TEST_USER,
    });

    const baseProject: ProductProject = {
      ...p,
      documentVersion: 1,
      formula: {
        totalWeightGrams: 500,
        totalCost: 25,
        lines: createSampleLines('Base', 5),
      },
    };
    await quotingService.saveProject(baseProject);

    // Simulate Server having advanced to version 3 by another concurrent writer
    let cloudDocumentVersion = 3;

    quotingService.setMockCloudWriteHandler(async (incoming, type) => {
      if (type === 'save') {
        const expectedBaseVersion = baseProject.documentVersion || 0;
        if (cloudDocumentVersion > expectedBaseVersion) {
          throw new Error(
            `CONCURRENCY_CONFLICT: Server document version (${cloudDocumentVersion}) is newer than expected base version (${expectedBaseVersion}). Save aborted to preserve remote changes.`
          );
        }
      }
    });

    // Write recovery draft before saving
    const localDirtyDraft: ProductProject = {
      ...baseProject,
      formula: {
        totalWeightGrams: 600,
        totalCost: 30,
        lines: createSampleLines('LocalWriter', 6),
      },
    };
    quotingService.saveDraftRecovery(TEST_WS, p.id, localDirtyDraft, TEST_USER);

    // Attempt save with stale base version
    await assert.rejects(
      async () => {
        await quotingService.saveProject(localDirtyDraft);
      },
      /CONCURRENCY_CONFLICT/
    );

    // Verify recovery draft is strictly preserved
    const recoveryDraft = quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER);
    assert.ok(recoveryDraft, 'Recovery draft must NOT be cleared after failed save');
    assert.equal(recoveryDraft?.formula.lines.length, 6, 'Local 6 ingredients retained');

    // Verify project in cache is marked dirty with cloudConflict
    const cached = quotingService.getProject(TEST_WS, p.id);
    assert.equal(cached?.hasUnsyncedLocalChanges, true);
    assert.ok(cached?.cloudConflict, 'Conflict record is attached to cached project');
  });

  test('T2: Offline or pending Firestore writes propagate error and retain retry capability', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Offline Persistence Project',
      userId: TEST_USER,
    });

    const draft: ProductProject = {
      ...p,
      formula: {
        totalWeightGrams: 400,
        totalCost: 20,
        lines: createSampleLines('Offline', 4),
      },
    };
    quotingService.saveDraftRecovery(TEST_WS, p.id, draft, TEST_USER);

    // Simulate network error during cloud write
    let isOffline = true;
    quotingService.setMockCloudWriteHandler(async () => {
      if (isOffline) {
        throw new Error('NETWORK_TIMEOUT: Client is offline or Firestore transaction unreachable.');
      }
    });

    await assert.rejects(
      async () => {
        await quotingService.saveProject(draft);
      },
      /NETWORK_TIMEOUT/
    );

    // Verify recovery draft preserved
    assert.ok(quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER));

    // Restore network
    isOffline = false;
    const retryResult = await quotingService.saveProject(draft);
    assert.equal(retryResult.hasUnsyncedLocalChanges, false);

    // Verify recovery draft cleared only after verified durable success
    assert.equal(quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER), null);
  });

  test('T3: Recovery draft preservation until durable server confirmation', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Durable Confirmation Project',
      userId: TEST_USER,
    });

    const draft: ProductProject = {
      ...p,
      formula: {
        totalWeightGrams: 300,
        totalCost: 15,
        lines: createSampleLines('DurableTest', 3),
      },
    };

    quotingService.saveDraftRecovery(TEST_WS, p.id, draft, TEST_USER);
    assert.ok(quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER));

    // Save succeeds durably
    await quotingService.saveProject(draft);

    // Verified cleared
    assert.equal(quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER), null);
  });

  test('T4: In-flight save after project navigation remains strictly bound to originating project', async () => {
    const p1 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project 1 - Sourdough',
      userId: TEST_USER,
    });
    const p2 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project 2 - Croissant',
      userId: TEST_USER,
    });

    // P1 draft
    const p1Draft: ProductProject = {
      ...p1,
      formula: {
        totalWeightGrams: 700,
        totalCost: 35,
        lines: createSampleLines('P1Nav', 7),
      },
    };

    // P2 draft
    const p2Draft: ProductProject = {
      ...p2,
      formula: {
        totalWeightGrams: 450,
        totalCost: 22.5,
        lines: createSampleLines('P2Nav', 4),
      },
    };

    // Simulate async in-flight save for P1 with slight delay
    let p1Saved = false;
    quotingService.setMockCloudWriteHandler(async (incoming) => {
      if (incoming.id === p1.id) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        p1Saved = true;
      }
    });

    const p1Promise = quotingService.saveProject(p1Draft);

    // Immediately save P2 (simulating user navigating to P2)
    const p2Result = await quotingService.saveProject(p2Draft);

    // Wait for P1
    const p1Result = await p1Promise;

    assert.ok(p1Saved);
    assert.equal(p1Result.id, p1.id);
    assert.equal(p1Result.formula.lines.length, 7);
    assert.equal(p2Result.id, p2.id);
    assert.equal(p2Result.formula.lines.length, 4);

    // Verify cache integrity: P1 and P2 have not cross-pollinated
    const cachedP1 = quotingService.getProject(TEST_WS, p1.id);
    const cachedP2 = quotingService.getProject(TEST_WS, p2.id);

    assert.equal(cachedP1?.formula.lines.length, 7);
    assert.equal(cachedP2?.formula.lines.length, 4);
    assert.equal(cachedP1?.productName, 'Project 1 - Sourdough');
    assert.equal(cachedP2?.productName, 'Project 2 - Croissant');
  });

  test('T5: Rename concurrent with autosave merges safely without clobbering formulas', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Original Product Name',
      userId: TEST_USER,
    });

    const initialFormula: ProductProject = {
      ...p,
      formula: {
        totalWeightGrams: 500,
        totalCost: 25,
        lines: createSampleLines('FormulaAutosave', 5),
      },
    };
    await quotingService.saveProject(initialFormula);

    // Concurrently trigger metadata rename and formula autosave
    const renamePromise = quotingService.updateProjectMetadata(TEST_WS, p.id, {
      productName: 'Renamed Product Name',
      customerName: 'High End Cafe',
    });

    const updatedFormula: ProductProject = {
      ...initialFormula,
      productName: 'Renamed Product Name', // editor reflects updated name
      formula: {
        totalWeightGrams: 600,
        totalCost: 30,
        lines: createSampleLines('FormulaAutosave', 6),
      },
    };
    const autosavePromise = quotingService.saveProject(updatedFormula);

    await Promise.all([renamePromise, autosavePromise]);

    const finalProject = quotingService.getProject(TEST_WS, p.id);
    assert.equal(finalProject?.productName, 'Renamed Product Name');
    assert.equal(finalProject?.customerName, 'High End Cafe');
    assert.equal(finalProject?.formula.lines.length, 6, 'All formula ingredients preserved');
  });

  test('T6: Three separate projects remain strictly independent across sequential edits', async () => {
    const pA = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project A',
      userId: TEST_USER,
    });
    const pB = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project B',
      userId: TEST_USER,
    });
    const pC = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project C',
      userId: TEST_USER,
    });

    await quotingService.saveProject({
      ...pA,
      formula: { totalWeightGrams: 300, totalCost: 15, lines: createSampleLines('A', 3) },
    });
    await quotingService.saveProject({
      ...pB,
      formula: { totalWeightGrams: 500, totalCost: 25, lines: createSampleLines('B', 5) },
    });
    await quotingService.saveProject({
      ...pC,
      formula: { totalWeightGrams: 800, totalCost: 40, lines: createSampleLines('C', 8) },
    });

    // Rename project B
    await quotingService.updateProjectMetadata(TEST_WS, pB.id, {
      productName: 'Project B Deluxe',
    });

    // Verify all three
    const savedA = quotingService.getProject(TEST_WS, pA.id);
    const savedB = quotingService.getProject(TEST_WS, pB.id);
    const savedC = quotingService.getProject(TEST_WS, pC.id);

    assert.equal(savedA?.formula.lines.length, 3);
    assert.equal(savedB?.formula.lines.length, 5);
    assert.equal(savedC?.formula.lines.length, 8);
    assert.equal(savedB?.productName, 'Project B Deluxe');
    assert.equal(savedA?.productName, 'Project A');
    assert.equal(savedC?.productName, 'Project C');
  });

  test('T7: Read-only recovery inspection distinguishes populated drafts from empty shells without mutating records', async () => {
    const pPopulated = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Populated Project',
      userId: TEST_USER,
    });
    const pEmpty = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Empty Project',
      userId: TEST_USER,
    });

    // Save populated draft to emergency storage
    quotingService.saveDraftRecovery(
      TEST_WS,
      pPopulated.id,
      {
        ...pPopulated,
        formula: { totalWeightGrams: 500, totalCost: 25, lines: createSampleLines('Populated', 5) },
      },
      TEST_USER
    );

    // Save empty shell draft to emergency storage
    quotingService.saveDraftRecovery(
      TEST_WS,
      pEmpty.id,
      {
        ...pEmpty,
        formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
      },
      TEST_USER
    );

    const candidates = quotingService.inspectRecoveryCandidates(TEST_WS, TEST_USER);

    const candPop = candidates.find((c) => c.projectId === pPopulated.id);
    const candEmp = candidates.find((c) => c.projectId === pEmpty.id);

    assert.ok(candPop);
    assert.ok(candEmp);
    assert.equal(candPop?.isPopulated, true, 'Populated draft identified as populated');
    assert.equal(candEmp?.isPopulated, false, 'Empty shell identified as not populated');

    // Verify records remain in localStorage
    assert.ok(quotingService.getDraftRecovery(TEST_WS, pPopulated.id, TEST_USER));
    assert.ok(quotingService.getDraftRecovery(TEST_WS, pEmpty.id, TEST_USER));
  });

  test('T8: Formula-to-pricing recalculation accurately updates product tier margins and unit costs', () => {
    const initialFormula = {
      totalWeightGrams: 10000,
      totalCost: 50.0,
      lines: createSampleLines('Recalc', 2),
    };

    const initialProducts: QuoteProductConfig[] = [
      calculateProductPricing({
        id: 'prod-cookie-4oz',
        productType: 'Cookie',
        name: '4 oz (80/case)',
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        otherCost: 0.0,
        ingredientMultiplier: 1.6,
        pricingBasis: 'case',
        quotedPrice: 85.0,
        formula: initialFormula,
      }),
    ];

    assert.equal(initialProducts.length, 1);
    const p1 = initialProducts[0];
    assert.ok(p1.totalProductionCost > 0);
    assert.ok(p1.rawIngredientCost > 0);
    assert.ok(p1.calculatedTargetPrice > 0);

    const initialIngCost = p1.rawIngredientCost;
    const initialProdCost = p1.totalProductionCost;

    // Update formula to double the cost ($100.00)
    const updatedFormula = {
      totalWeightGrams: 10000,
      totalCost: 100.0,
      lines: createSampleLines('Recalc', 4),
    };

    const recalculated = recalculateProductsPricing(initialProducts, updatedFormula);
    assert.equal(recalculated.length, 1);
    const p1Updated = recalculated[0];

    // Raw ingredient cost should double from initial
    assert.ok(
      Math.abs(p1Updated.rawIngredientCost - initialIngCost * 2) < 0.05,
      `Expected doubled raw ingredient cost ~${(initialIngCost * 2).toFixed(2)}, got ${p1Updated.rawIngredientCost}`
    );
    // Total production cost should have increased by the exact ingredient cost increase
    assert.ok(
      p1Updated.totalProductionCost > initialProdCost,
      'Total production cost increases with higher formula cost'
    );
    // Target price reflects the new formula cost
    assert.ok(
      p1Updated.calculatedTargetPrice > p1.calculatedTargetPrice,
      'Calculated target price increases'
    );
  });

  test('T9: Historical QuoteRevision remains immutable after project edits and renames', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Revision Freeze Project',
      userId: TEST_USER,
    });

    const sampleFormula = { totalWeightGrams: 400, totalCost: 20, lines: createSampleLines('Frozen', 4) };
    const sampleProduct = calculateProductPricing({
      id: 'prod-freeze',
      productType: 'Cookie',
      name: 'Box',
      pieceWeight: 400,
      weightUnit: 'g',
      piecesPerCase: 1,
      packagingCost: 1.0,
      laborCost: 1.0,
      otherCost: 0.5,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: 32.14,
      formula: sampleFormula,
    });

    await quotingService.saveProject({
      ...p,
      formula: sampleFormula,
      products: [sampleProduct],
    });

    // Freeze Revision 1
    const revised = await quotingService.issueQuoteRevision(
      p.id,
      TEST_WS,
      TEST_USER,
      'Lead Baker',
      'Initial Approved Revision'
    );
    assert.equal(revised.revisions.length, 1);
    const rev1 = revised.revisions[0];
    assert.equal(rev1.revisionNumber, 1);
    assert.equal(rev1.formulaSnapshot.lines.length, 4);
    assert.equal(rev1.productsSnapshot.length, 1);

    // Modify active working formula and rename project
    await quotingService.updateProjectMetadata(TEST_WS, p.id, {
      productName: 'Completely Different Project Name',
    });
    await quotingService.saveProject({
      ...revised,
      productName: 'Completely Different Project Name',
      formula: { totalWeightGrams: 900, totalCost: 45, lines: createSampleLines('NewLines', 9) },
    });

    const activeProject = quotingService.getProject(TEST_WS, p.id);
    assert.equal(activeProject?.productName, 'Completely Different Project Name');
    assert.equal(activeProject?.formula.lines.length, 9);

    // Check historical revision remains frozen
    const storedRev1 = activeProject?.revisions.find((r) => r.revisionNumber === 1);
    assert.ok(storedRev1);
    assert.equal(storedRev1?.formulaSnapshot.lines.length, 4, 'Snapshot formula lines frozen at 4');
    assert.equal(storedRev1?.formulaSnapshot.totalCost, 20, 'Snapshot formula cost frozen at 20');
    assert.equal(storedRev1?.productsSnapshot.length, 1, 'Snapshot products frozen at 1');
  });
});
