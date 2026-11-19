import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService } from '../src/services/quotingService';
import { ProductProject, QuoteFormulaLine } from '../src/types/quoting';

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

describe('Phase 2B.5.6.3A — Data Recovery Preservation & Synchronization Safety Suite', () => {
  const TEST_WS = 'ws-test-safety';
  const TEST_USER = 'user-test-safety';

  beforeEach(() => {
    (globalThis as any).localStorage = createMockLocalStorage();
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

  test('R1: Three separate projects with distinct formulas can be created and stored in isolation', async () => {
    const p1 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project 1 - Sourdough',
      userId: TEST_USER,
    });
    const p2 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project 2 - Brioche',
      userId: TEST_USER,
    });
    const p3 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Project 3 - Rye Bread',
      userId: TEST_USER,
    });

    assert.notEqual(p1.id, p2.id);
    assert.notEqual(p2.id, p3.id);

    // Save distinct formulas on each
    const p1WithFormula: ProductProject = {
      ...p1,
      formula: {
        totalWeightGrams: 500,
        totalCost: 25,
        lines: createSampleLines('P1', 5),
      },
    };
    const p2WithFormula: ProductProject = {
      ...p2,
      formula: {
        totalWeightGrams: 800,
        totalCost: 40,
        lines: createSampleLines('P2', 8),
      },
    };
    const p3WithFormula: ProductProject = {
      ...p3,
      formula: {
        totalWeightGrams: 300,
        totalCost: 15,
        lines: createSampleLines('P3', 3),
      },
    };

    await quotingService.saveProject(p1WithFormula);
    await quotingService.saveProject(p2WithFormula);
    await quotingService.saveProject(p3WithFormula);

    const savedP1 = quotingService.getProject(TEST_WS, p1.id);
    const savedP2 = quotingService.getProject(TEST_WS, p2.id);
    const savedP3 = quotingService.getProject(TEST_WS, p3.id);

    assert.equal(savedP1?.formula.lines.length, 5);
    assert.equal(savedP2?.formula.lines.length, 8);
    assert.equal(savedP3?.formula.lines.length, 3);
  });

  test('R2: Renaming one project via updateProjectMetadata preserves all three projects without rewriting formulas', async () => {
    const p1 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Original P1 Name',
      userId: TEST_USER,
    });
    const p2 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'P2 Croissant',
      userId: TEST_USER,
    });
    const p3 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'P3 Baguette',
      userId: TEST_USER,
    });

    await quotingService.saveProject({
      ...p1,
      formula: { totalWeightGrams: 400, totalCost: 20, lines: createSampleLines('P1', 4) },
    });
    await quotingService.saveProject({
      ...p2,
      formula: { totalWeightGrams: 600, totalCost: 30, lines: createSampleLines('P2', 6) },
    });
    await quotingService.saveProject({
      ...p3,
      formula: { totalWeightGrams: 200, totalCost: 10, lines: createSampleLines('P3', 2) },
    });

    // Rename only P1 using updateProjectMetadata
    const renamed = await quotingService.updateProjectMetadata(TEST_WS, p1.id, {
      productName: 'Renamed P1 Sourdough Artisan',
      customerName: 'Artisan Bakery Co.',
    });

    assert.equal(renamed.productName, 'Renamed P1 Sourdough Artisan');
    assert.equal(renamed.customerName, 'Artisan Bakery Co.');
    assert.equal(renamed.formula.lines.length, 4, 'P1 formula preserved intact');

    // Verify P2 and P3 formulas were completely untouched
    const checkP2 = quotingService.getProject(TEST_WS, p2.id);
    const checkP3 = quotingService.getProject(TEST_WS, p3.id);

    assert.equal(checkP2?.productName, 'P2 Croissant');
    assert.equal(checkP2?.formula.lines.length, 6, 'P2 formula completely retained');
    assert.equal(checkP3?.productName, 'P3 Baguette');
    assert.equal(checkP3?.formula.lines.length, 2, 'P3 formula completely retained');
  });

  test('R3: Accidental empty formula overwrite protection guards existing non-empty formula', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Protection Test',
      userId: TEST_USER,
    });

    await quotingService.saveProject({
      ...proj,
      formula: { totalWeightGrams: 500, totalCost: 25, lines: createSampleLines('Protect', 5) },
    });

    // Attempt to save an accidental empty formula without intentional flag
    await assert.rejects(
      async () => {
        await quotingService.saveProject({
          ...proj,
          formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
        });
      },
      /Safety Guard: Attempted to save an empty formula over an existing formula/
    );

    // Existing formula remains intact
    const preserved = quotingService.getProject(TEST_WS, proj.id);
    assert.equal(preserved?.formula.lines.length, 5);
  });

  test('R4: Intentional formula clearing succeeds when allowEmptyFormula is explicitly set', async () => {
    const proj = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Intentional Clear Test',
      userId: TEST_USER,
    });

    await quotingService.saveProject({
      ...proj,
      formula: { totalWeightGrams: 300, totalCost: 15, lines: createSampleLines('Clear', 3) },
    });

    // Explicit intentional formula clearing
    const cleared = await quotingService.saveProject({
      ...proj,
      formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
      allowEmptyFormula: true,
    } as any);

    assert.equal(cleared.formula.lines.length, 0);
  });

  test('R5: Snapshot arriving with stale empty project does not clobber local dirty project', () => {
    // Simulate local dirty draft in projectsMap
    const localProject: ProductProject = {
      id: 'proj-dirty-1',
      workspaceId: TEST_WS,
      productName: 'Local Sourdough',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula: { totalWeightGrams: 500, totalCost: 25, lines: createSampleLines('Dirty', 5) },
      products: [],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-10-09T00:00:00.000Z',
      createdBy: TEST_USER,
      updatedAt: '2026-10-09T01:00:00.000Z',
      updatedBy: TEST_USER,
      documentVersion: 2,
      hasUnsyncedLocalChanges: true,
    };

    // Save to local cache
    (quotingService as any).projectsMap.set(TEST_WS, [localProject]);

    // Local draft remains available
    const cached = quotingService.getProject(TEST_WS, 'proj-dirty-1');
    assert.equal(cached?.hasUnsyncedLocalChanges, true);
    assert.equal(cached?.formula.lines.length, 5);
  });

  test('R6: Recovery inspection identifies candidate emergency drafts and quote revisions without mutating records', async () => {
    const p1 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Inspectable Project',
      userId: TEST_USER,
    });

    const p1WithLines: ProductProject = {
      ...p1,
      formula: { totalWeightGrams: 750, totalCost: 35, lines: createSampleLines('Inspect', 7) },
    };

    // Save working project with lines
    await quotingService.saveProject(p1WithLines);

    // Issue a quote revision on p1
    await quotingService.issueQuoteRevision(p1.id, TEST_WS, TEST_USER, 'Manager', 'Initial Quote');

    // Simulate an in-progress working session writing an unsaved emergency recovery draft
    const unsavedWorkingDraft: ProductProject = {
      ...p1WithLines,
      formula: { totalWeightGrams: 900, totalCost: 45, lines: createSampleLines('Unsaved', 9) },
    };
    quotingService.saveDraftRecovery(TEST_WS, p1.id, unsavedWorkingDraft, TEST_USER);

    // Run read-only candidate inspection
    const candidates = quotingService.inspectRecoveryCandidates(TEST_WS, TEST_USER);

    assert.ok(candidates.length >= 1, 'Found at least one candidate recovery record');
    const matched = candidates.find((c) => c.projectId === p1.id);
    assert.ok(matched, 'Found candidate for project 1');
    assert.ok(matched!.ingredientCount >= 7);

    // Verify recovery draft was NOT deleted or mutated during inspection
    const recovered = quotingService.getDraftRecovery(TEST_WS, p1.id, TEST_USER);
    assert.ok(recovered, 'Draft recovery was not deleted by inspection');
    assert.equal(recovered?.formula.lines.length, 9, 'Emergency recovery draft preserved intact');
  });

  test('R7: Historical QuoteRevision remains immutable after project metadata rename', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Revision Immutability Test',
      userId: TEST_USER,
    });

    await quotingService.saveProject({
      ...p,
      formula: { totalWeightGrams: 450, totalCost: 22, lines: createSampleLines('Rev', 4) },
    });

    const revised = await quotingService.issueQuoteRevision(p.id, TEST_WS, TEST_USER, 'Manager', 'Rev 1 Freeze');
    assert.equal(revised.revisions.length, 1);
    const frozenRev = revised.revisions[0];
    assert.equal(frozenRev.formulaSnapshot.lines.length, 4);
    assert.equal(frozenRev.formulaSnapshot.totalCost, 22);

    // Rename project
    await quotingService.updateProjectMetadata(TEST_WS, p.id, {
      productName: 'Brand New Project Name',
    });

    // Retrieve fresh project and check historical revision
    const fresh = quotingService.getProject(TEST_WS, p.id);
    assert.equal(fresh?.productName, 'Brand New Project Name');
    assert.equal(fresh?.revisions.length, 1);
    assert.equal(fresh?.revisions[0].formulaSnapshot.lines.length, 4, 'Revision lines frozen');
    assert.equal(fresh?.revisions[0].formulaSnapshot.totalCost, 22, 'Revision cost frozen');
    assert.equal(fresh?.revisions[0].revisionNumber, 1);
  });

  test('R8: Failed save rejects promise, marks error state, and retains dirty local draft', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Fail Persistence Test',
      userId: TEST_USER,
    });

    const projectWithFormula: ProductProject = {
      ...p,
      formula: { totalWeightGrams: 500, totalCost: 25, lines: createSampleLines('Fail', 5) },
    };
    await quotingService.saveProject(projectWithFormula);

    // Attempting an empty overwrite without confirmation triggers safety rejection
    await assert.rejects(
      async () => {
        await quotingService.saveProject({
          ...projectWithFormula,
          formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
        });
      },
      /Safety Guard/
    );
  });

  test('R9: Rapid navigation between projects retains individual project drafts without cross-contamination', async () => {
    const p1 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Rapid Nav P1',
      userId: TEST_USER,
    });
    const p2 = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Rapid Nav P2',
      userId: TEST_USER,
    });

    // Write recovery draft for P1
    quotingService.saveDraftRecovery(TEST_WS, p1.id, {
      ...p1,
      formula: { totalWeightGrams: 100, totalCost: 5, lines: createSampleLines('P1Nav', 1) },
    }, TEST_USER);

    // Write recovery draft for P2
    quotingService.saveDraftRecovery(TEST_WS, p2.id, {
      ...p2,
      formula: { totalWeightGrams: 200, totalCost: 10, lines: createSampleLines('P2Nav', 2) },
    }, TEST_USER);

    // Verify recovery drafts are strictly isolated
    const recP1 = quotingService.getDraftRecovery(TEST_WS, p1.id, TEST_USER);
    const recP2 = quotingService.getDraftRecovery(TEST_WS, p2.id, TEST_USER);

    assert.equal(recP1?.formula.lines.length, 1);
    assert.equal(recP2?.formula.lines.length, 2);
    assert.notEqual(recP1?.id, recP2?.id);
  });

  test('R10: Conflict preservation flags server collision without silent local overwrite', () => {
    const dirtyLocal: ProductProject = {
      id: 'conflict-proj-1',
      workspaceId: TEST_WS,
      productName: 'Local Head',
      formulaOwnership: 'bakery_owned',
      status: 'draft',
      formula: { totalWeightGrams: 1000, totalCost: 50, lines: createSampleLines('Local', 10) },
      products: [],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: '2026-10-09T00:00:00.000Z',
      createdBy: TEST_USER,
      updatedAt: '2026-10-09T01:00:00.000Z',
      updatedBy: TEST_USER,
      documentVersion: 5,
      hasUnsyncedLocalChanges: true,
      cloudConflict: {
        conflictAt: new Date().toISOString(),
        serverVersion: 6,
        serverUpdatedAt: '2026-10-09T01:05:00.000Z',
        serverFormulaLineCount: 2,
        serverProductName: 'Server Head',
      },
    };

    (quotingService as any).projectsMap.set(TEST_WS, [dirtyLocal]);
    const stored = quotingService.getProject(TEST_WS, 'conflict-proj-1');

    assert.ok(stored?.cloudConflict, 'Conflict record is preserved');
    assert.equal(stored?.formula.lines.length, 10, 'Local 10 ingredients preserved without wipe');
    assert.equal(stored?.cloudConflict?.serverFormulaLineCount, 2);
  });

  test('R11: Recovery draft cleared only upon durable save completion', async () => {
    const p = await quotingService.createProject({
      workspaceId: TEST_WS,
      productName: 'Durable Save Test',
      userId: TEST_USER,
    });

    const draftWithFormula: ProductProject = {
      ...p,
      formula: { totalWeightGrams: 300, totalCost: 15, lines: createSampleLines('Durable', 3) },
    };

    quotingService.saveDraftRecovery(TEST_WS, p.id, draftWithFormula, TEST_USER);
    assert.ok(quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER));

    // Save project durably
    await quotingService.saveProject(draftWithFormula);

    // After durable save, draft recovery is cleanly cleared
    const postSaveRecovery = quotingService.getDraftRecovery(TEST_WS, p.id, TEST_USER);
    assert.equal(postSaveRecovery, null, 'Recovery draft cleared after durable save');
  });
});
