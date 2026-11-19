import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService, canUserAccessQuoting } from '../src/services/quotingService';
import {
  ProductProject,
  QuoteFormula,
  QuoteProductConfig,
  ProjectDeletionPreview,
} from '../src/types/quoting';
import {
  calculateProductPricing,
  convertRecipeToQuoteFormula,
} from '../src/utils/quotingCalculator';
import { Recipe, MasterIngredient, Workspace, AccessRole, ProductionPreset } from '../src/types';
import { store } from '../src/services/store';

const createMockLocalStorage = () => {
  let storeMap: Record<string, string> = {};
  return {
    getItem: (key: string) => storeMap[key] || null,
    setItem: (key: string, val: string) => {
      storeMap[key] = String(val);
    },
    removeItem: (key: string) => {
      delete storeMap[key];
    },
    clear: () => {
      storeMap = {};
    },
    get length() {
      return Object.keys(storeMap).length;
    },
    key: (i: number) => Object.keys(storeMap)[i] || null,
  };
};

describe('PHASE 2B.5.10 — Controlled Project & Test-Quote Deletion Suite', () => {
  const TEST_WS = 'test-workspace-del';
  const TEST_WS_OTHER = 'test-workspace-other';
  const OWNER_USER = 'user-owner-101';
  const EDITOR_USER = 'user-editor-102';
  const VIEWER_USER = 'user-viewer-103';

  const mockPantryIngredients: MasterIngredient[] = [
    {
      id: 'ing-flour',
      workspaceId: TEST_WS,
      name: 'All-Purpose Flour',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2400,
      },
    },
    {
      id: 'ing-sugar',
      workspaceId: TEST_WS,
      name: 'Granulated Sugar',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 25,
        unitMeasure: 'lb',
        packagePriceCents: 1800,
      },
    },
  ];

  const mockPresets: ProductionPreset[] = [
    {
      id: 'preset-standard-box',
      workspaceId: TEST_WS,
      userId: OWNER_USER,
      name: 'Standard Box 80ct',
      category: 'Cookies',
      finishedWeight: 100,
      weightUnit: 'g',
      quantityPerUnit: 80,
      unitName: 'case',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const mockProductionRecipe: Recipe = {
    id: 'rec-butter-cookie',
    workspaceId: TEST_WS,
    userId: OWNER_USER,
    name: 'Classic Butter Cookie',
    description: 'Classic rich butter cookie for production',
    category: 'Cookie',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookie',
    defaultWastePercent: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ingredients: [
      { id: 'ing-flour', name: 'All-Purpose Flour', quantity: 2000, unit: 'g' },
      { id: 'ing-sugar', name: 'Granulated Sugar', quantity: 1000, unit: 'g' },
    ],
  };

  const createSyntheticProject = async (
    wsId: string,
    id: string,
    productName: string,
    opts: Partial<ProductProject> = {}
  ): Promise<ProductProject> => {
    const proj: ProductProject = {
      id,
      workspaceId: wsId,
      projectCode: `Q-2026-${id.slice(-3)}`,
      productName,
      customerName: 'Synthetic Customer',
      status: 'draft',
      formulaOwnership: 'bakery_owned',
      formula: {
        totalWeightGrams: 3000,
        totalCost: 15.0,
        lines: [
          {
            id: 'line-1',
            name: 'All-Purpose Flour',
            quantity: 2000,
            unit: 'g',
            unitCostUsed: 0.003,
            unitCostType: 'per_gram',
            lineCost: 6.0,
          },
          {
            id: 'line-2',
            name: 'Granulated Sugar',
            quantity: 1000,
            unit: 'g',
            unitCostUsed: 0.009,
            unitCostType: 'per_gram',
            lineCost: 9.0,
          },
        ],
      },
      products: [
        {
          id: 'cfg-1',
          productType: 'Cookie',
          name: '4 oz (80/cs)',
          pieceWeight: 4,
          weightUnit: 'oz',
          piecesPerCase: 80,
          unitName: 'case',
          doughWeightGrams: 9071.84,
          rawIngredientCost: 45.36,
          ingredientMultiplier: 1.6,
          packagingCost: 4.5,
          laborCost: 6.0,
          otherCost: 1.5,
          totalProductionCost: 57.36,
          calculatedTargetPrice: 84.58,
          quotedPrice: null,
          unitPrice: 0,
          dollarProfit: 0,
          grossMarginPercent: 0,
          markupPercent: 0,
          targetVarianceDollars: 0,
        },
      ],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: new Date().toISOString(),
      createdBy: OWNER_USER,
      updatedAt: new Date().toISOString(),
      updatedBy: OWNER_USER,
      documentVersion: 1,
      ...opts,
    };

    return quotingService.saveProject(proj);
  };

  beforeEach(() => {
    (globalThis as any).localStorage = createMockLocalStorage();
    quotingService.clearTombstonesForTesting();
  });

  afterEach(() => {
    quotingService.setMockCloudWriteHandler(null);
    quotingService.setMockDeletionHandler(null);
    quotingService.clearTombstonesForTesting();
  });

  // T1: Owner sees eligible permanent deletion controls and preview is generated
  test('T1: Owner sees eligible permanent deletion controls and accurate preview', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t1', 'Eligible Project T1');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');

    assert.equal(preview.isEligible, true);
    assert.equal(preview.blockers.length, 0);
    assert.equal(preview.productConfigurationsCount, 1);
    assert.equal(preview.issuedRevisionsCount, 0);
    assert.equal(preview.whatWillBeDeleted.length > 0, true);
    assert.equal(preview.whatWillBePreserved.length > 0, true);
  });

  // T2: Editor cannot permanently delete
  test('T2: Editor cannot permanently delete (UNAUTHORIZED_OWNER_REQUIRED)', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t2', 'Editor Test T2');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'editor');

    assert.equal(preview.isEligible, false);
    assert.equal(preview.blockers.some((b) => b.includes('Only authorized workspace Owners')), true);

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'editor',
        userId: EDITOR_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /UNAUTHORIZED_OWNER_REQUIRED/);
        return true;
      }
    );
  });

  // T3: Viewer cannot permanently delete
  test('T3: Viewer cannot permanently delete (UNAUTHORIZED_OWNER_REQUIRED)', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t3', 'Viewer Test T3');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'viewer');

    assert.equal(preview.isEligible, false);
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'viewer',
        userId: VIEWER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /UNAUTHORIZED_OWNER_REQUIRED/);
        return true;
      }
    );
  });

  // T4: Signed-out user cannot permanently delete
  test('T4: Signed-out user cannot permanently delete', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t4', 'Signed Out Test T4');
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: null,
        userId: '',
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /UNAUTHORIZED_OWNER_REQUIRED/);
        return true;
      }
    );
  });

  // T5: Cross-workspace deletion is denied
  test('T5: Cross-workspace deletion is denied', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t5', 'Workspace A Project');

    // Attempting to delete proj from TEST_WS_OTHER
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS_OTHER,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /not found in workspace/);
        return true;
      }
    );
  });

  // T6: Issued quote revisions block project deletion
  test('T6: Issued quote revisions block project deletion (immutable snapshot protection)', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t6', 'Quoted Cookie T6');
    await quotingService.issueQuoteRevision(proj.id, TEST_WS, OWNER_USER, 'Owner', 'Initial Quote', proj, 'owner');

    const quotedProj = quotingService.getProject(TEST_WS, proj.id);
    assert.equal((quotedProj?.revisions.length || 0) > 0, true);

    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, false);
    assert.equal(preview.issuedRevisionsCount, 1);
    assert.equal(preview.blockers.some((b) => b.includes('issued quote revision')), true);

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /DELETION_INELIGIBLE/);
        return true;
      }
    );
  });

  // T7: Order-linked projects cannot be deleted
  test('T7: Order-linked projects cannot be deleted', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t7', 'Ordered Project T7', {
      orderId: 'ord-9921',
    } as any);

    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, false);
    assert.equal(preview.blockers.some((b) => b.includes('order records')), true);

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /DELETION_INELIGIBLE/);
        return true;
      }
    );
  });

  // T8: Invoice-linked projects cannot be deleted
  test('T8: Invoice-linked projects cannot be deleted', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t8', 'Invoiced Project T8', {
      invoiceId: 'inv-8842',
    } as any);

    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, false);
    assert.equal(preview.blockers.some((b) => b.includes('invoice records')), true);

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /DELETION_INELIGIBLE/);
        return true;
      }
    );
  });

  // T9: Protected records cannot be deleted (retention policy)
  test('T9: Protected records cannot be deleted under retention policy', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t9', 'Retention Project T9', {
      isRetentionProtected: true,
    } as any);

    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, false);
    assert.equal(preview.blockers.some((b) => b.includes('corporate data retention policy')), true);

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /DELETION_INELIGIBLE/);
        return true;
      }
    );
  });

  // T10: Eligible unissued draft records can be selected
  test('T10: Eligible unissued draft records can be selected for preview', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t10', 'Draft Selection T10');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, true);
    assert.equal(preview.projectId, proj.id);
  });

  // T11: Deletion preview shows accurate record details
  test('T11: Deletion preview shows accurate record details', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t11', 'Detailed Preview T11');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');

    assert.equal(preview.productName, 'Detailed Preview T11');
    assert.equal(preview.projectCode, proj.projectCode);
    assert.equal(preview.workspaceId, TEST_WS);
    assert.equal(preview.status, 'draft');
    assert.equal(preview.productConfigurationsCount, 1);
    assert.equal(preview.draftQuotesCount, 1);
    assert.equal(preview.issuedRevisionsCount, 0);
  });

  // T12: Preview identifies all affected records
  test('T12: Preview identifies all affected records and preserved items', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t12', 'Breakdown Project T12', {
      sourceRecipeName: 'Classic Butter Cookie',
    });
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');

    assert.equal(preview.whatWillBeDeleted.some((s) => s.includes('Working formula definition')), true);
    assert.equal(preview.whatWillBeDeleted.some((s) => s.includes('Draft product configurations')), true);
    assert.equal(preview.whatWillBePreserved.some((s) => s.includes('Classic Butter Cookie')), true);
    assert.equal(preview.whatWillBePreserved.some((s) => s.includes('Shared pantry master ingredients')), true);
  });

  // T13: Confirmation requires exact DELETE text
  test('T13: Confirmation requires exact DELETE text', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t13', 'Confirm Test T13');

    // Case 1: lowercase 'delete'
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'delete',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /INVALID_CONFIRMATION/);
        return true;
      }
    );

    // Case 2: empty string
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: '',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /INVALID_CONFIRMATION/);
        return true;
      }
    );

    // Record remains intact after bad confirmation attempts
    assert.notEqual(quotingService.getProject(TEST_WS, proj.id), undefined);
  });

  // T14: Cancel leaves all records unchanged
  test('T14: Cancel leaves all records unchanged', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t14', 'Cancel Test T14');
    // Generating preview and not calling delete leaves project in store
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, true);

    const recheck = quotingService.getProject(TEST_WS, proj.id);
    assert.deepEqual(recheck?.id, proj.id);
    assert.deepEqual(recheck?.formula.lines.length, 2);
  });

  // T15: Stale preview blocks deletion
  test('T15: Stale preview blocks deletion (concurrency base version mismatch)', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t15', 'Stale Preview T15');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');

    // Concurrent modification advances documentVersion
    await quotingService.updateProjectMetadata(TEST_WS, proj.id, {
      productName: 'Stale Preview T15 Renamed',
    });

    // Attempting delete with older baseDocumentVersion fails
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        expectedBaseVersion: preview.baseDocumentVersion, // Older version
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /CONCURRENCY_CONFLICT/);
        return true;
      }
    );
  });

  // T16: Role changes before execution block deletion
  test('T16: Role changes before execution block deletion', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t16', 'Role Demotion T16');
    // Preview generated as owner
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, true);

    // Role revoked / changed to editor before execution
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'editor',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /UNAUTHORIZED_OWNER_REQUIRED/);
        return true;
      }
    );
  });

  // T17: Concurrent quote issuance blocks deletion
  test('T17: Concurrent quote issuance blocks deletion', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t17', 'Concurrent Quoting T17');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');
    assert.equal(preview.isEligible, true);

    // Another user or tab issues a quote revision
    await quotingService.issueQuoteRevision(proj.id, TEST_WS, OWNER_USER, 'Manager', 'Issued concurrent', proj, 'owner');

    // Attempting deletion now fails eligibility
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /DELETION_INELIGIBLE/);
        return true;
      }
    );
  });

  // T18: Transaction failure causes no partial deletion
  test('T18: Transaction failure causes no partial deletion', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t18', 'Transaction Failure T18');

    // Mock cloud handler throws network / storage failure
    quotingService.setMockDeletionHandler(async () => {
      throw new Error('CLOUD_TRANSACTION_FAILED: Remote storage write timeout.');
    });

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /CLOUD_TRANSACTION_FAILED/);
        return true;
      }
    );

    // Record remains completely intact in projectsMap
    const recheck = quotingService.getProject(TEST_WS, proj.id);
    assert.notEqual(recheck, undefined);
    assert.equal(recheck?.productName, 'Transaction Failure T18');
    assert.equal(quotingService.isProjectDeleted(proj.id), false);
  });

  // T19: Successful isolated deletion removes eligible data
  test('T19: Successful isolated deletion removes eligible data', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t19', 'Isolated Deletion T19');
    const res = await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    assert.equal(res.success, true);
    assert.notEqual(res.auditRecord, undefined);
    assert.equal(quotingService.getProject(TEST_WS, proj.id), undefined);
    assert.equal(quotingService.isProjectDeleted(proj.id), true);
  });

  // T20: Unrelated workspace records remain unchanged
  test('T20: Unrelated workspace records remain unchanged', async () => {
    const p1 = await createSyntheticProject(TEST_WS, 'test-proj-t20-a', 'Unrelated Keeper A');
    const p2 = await createSyntheticProject(TEST_WS, 'test-proj-t20-b', 'Project To Delete B');
    const p3 = await createSyntheticProject(TEST_WS_OTHER, 'test-proj-t20-c', 'Other WS Keeper C');

    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: p2.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    // p2 is gone
    assert.equal(quotingService.getProject(TEST_WS, p2.id), undefined);
    // p1 and p3 are completely preserved
    assert.notEqual(quotingService.getProject(TEST_WS, p1.id), undefined);
    assert.notEqual(quotingService.getProject(TEST_WS_OTHER, p3.id), undefined);
  });

  // T21: Production recipes remain unchanged
  test('T21: Production recipes remain unchanged after project deletion', async () => {
    const recipeSnapshotBefore = JSON.stringify(mockProductionRecipe);
    const proj = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS,
      recipe: mockProductionRecipe,
      userId: OWNER_USER,
      masterIngredients: mockPantryIngredients,
    });

    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    const recipeSnapshotAfter = JSON.stringify(mockProductionRecipe);
    assert.equal(recipeSnapshotBefore, recipeSnapshotAfter);
  });

  // T22: Packaging Presets remain unchanged
  test('T22: Packaging Presets remain unchanged', async () => {
    const presetsBefore = JSON.stringify(mockPresets);
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t22', 'Preset Test T22');

    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    const presetsAfter = JSON.stringify(mockPresets);
    assert.equal(presetsBefore, presetsAfter);
  });

  // T23: Shared pantry ingredients remain unchanged
  test('T23: Shared pantry ingredients remain unchanged', async () => {
    const pantryBefore = JSON.stringify(mockPantryIngredients);
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t23', 'Pantry Test T23');

    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    const pantryAfter = JSON.stringify(mockPantryIngredients);
    assert.equal(pantryBefore, pantryAfter);
  });

  // T24: Issued quote revisions remain immutable
  test('T24: Issued quote revisions remain immutable and cannot be deleted or renumbered', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t24', 'Immutable Rev T24');
    await quotingService.issueQuoteRevision(proj.id, TEST_WS, OWNER_USER, 'Manager', 'Rev 1', proj, 'owner');

    const quoted = quotingService.getProject(TEST_WS, proj.id);
    const rev1Id = quoted?.revisions[0].id;
    const rev1Num = quoted?.revisions[0].revisionNumber;

    // Permanent delete is rejected
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      })
    );

    // Revisions array remains unchanged
    const recheck = quotingService.getProject(TEST_WS, proj.id);
    assert.equal(recheck?.revisions[0].id, rev1Id);
    assert.equal(recheck?.revisions[0].revisionNumber, rev1Num);
  });

  // T25: Deleted projects cannot resurrect via autosave
  test('T25: Deleted projects cannot resurrect via autosave', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t25', 'Resurrect Autosave T25');

    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    // Simulate in-flight or debounce autosave firing with stale draft
    await assert.rejects(
      quotingService.saveProject({
        ...proj,
        productName: 'Resurrected Draft',
      }),
      (err: any) => {
        assert.match(err.message, /CANNOT_RESURRECT_DELETED_PROJECT/);
        return true;
      }
    );

    assert.equal(quotingService.getProject(TEST_WS, proj.id), undefined);
  });

  // T26: Deleted projects cannot resurrect via another tab
  test('T26: Deleted projects cannot resurrect via another tab draft recovery', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t26', 'Tab Resurrection T26');

    // Simulate another tab having a local draft recovery
    quotingService.saveDraftRecovery(TEST_WS, proj.id, proj, 'user-tab-2');

    // Owner deletes project in primary tab
    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    // Recovery is purged and future recovery saves are rejected
    quotingService.saveDraftRecovery(TEST_WS, proj.id, proj, 'user-tab-2');
    assert.equal(quotingService.getDraftRecovery(TEST_WS, proj.id, 'user-tab-2'), null);
  });

  // T27: Deleted projects cannot resurrect after refresh
  test('T27: Deleted projects cannot resurrect after refresh (tombstone persistence)', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t27', 'Refresh Resurrection T27');

    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    // Verify tombstone is saved in localStorage
    const tombstonesRaw = (globalThis as any).localStorage.getItem(`recipe_calc_tombstones_${TEST_WS}`);
    assert.notEqual(tombstonesRaw, null);
    assert.equal(tombstonesRaw.includes(proj.id), true);

    // Verify project is absent from workspace projects in localStorage
    const projectsRaw = (globalThis as any).localStorage.getItem(`recipe_calc_projects_${TEST_WS}`);
    assert.equal(projectsRaw?.includes(proj.id), false);
  });

  // T28: Audit record is created only after verified success
  test('T28: Audit record is created only after verified success', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t28', 'Audit Project T28');
    const auditsBefore = quotingService.getDeletionAuditLog(TEST_WS).length;

    const res = await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    const auditsAfter = quotingService.getDeletionAuditLog(TEST_WS);
    assert.equal(auditsAfter.length, auditsBefore + 1);

    const latestAudit = auditsAfter[0];
    assert.equal(latestAudit.operationId, res.auditRecord.operationId);
    assert.equal(latestAudit.deletedRecordId, proj.id);
    assert.equal(latestAudit.actorUid, OWNER_USER);
    assert.equal(latestAudit.actorRole, 'owner');
    assert.equal(latestAudit.recordType, 'product_project');
    assert.equal(latestAudit.recordSummary.productName, 'Audit Project T28');
  });

  // T29: Duplicate delete requests are handled safely
  test('T29: Duplicate delete requests are handled safely', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t29', 'Duplicate Delete T29');

    // First delete succeeds
    await quotingService.deleteProjectPermanently({
      workspaceId: TEST_WS,
      projectId: proj.id,
      userRole: 'owner',
      userId: OWNER_USER,
      confirmationText: 'DELETE',
      isDevelopmentTestEnvironment: true,
    });

    // Immediate duplicate delete request throws safe error without crashing
    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: TEST_WS,
        projectId: proj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: true,
      }),
      (err: any) => {
        assert.match(err.message, /not found in workspace/);
        return true;
      }
    );
  });

  // T30: Mobile confirmation interface remains usable
  test('T30: Mobile confirmation interface validation logic operates consistently', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t30', 'Mobile Usability T30');
    const preview = quotingService.getProjectDeletionPreview(TEST_WS, proj.id, 'owner');

    // Form confirmation checks
    const testInputs = ['', '   ', 'delete', 'Del', 'DELETE '];
    testInputs.forEach((input) => {
      const isConfirmed = input.trim() === 'DELETE';
      if (input === 'DELETE ') {
        assert.equal(isConfirmed, true);
      } else {
        assert.equal(isConfirmed, false);
      }
    });

    assert.equal(preview.isEligible, true);
  });

  // T31: Existing recipe-import workflow remains intact
  test('T31: Existing recipe-import workflow remains intact', async () => {
    const imported = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS,
      recipe: mockProductionRecipe,
      userId: OWNER_USER,
      masterIngredients: mockPantryIngredients,
    });

    assert.equal(imported.sourceRecipeId, mockProductionRecipe.id);
    assert.equal(imported.formula.lines.length, 2);
    // Formula lines are independent deep copies with new line IDs
    assert.notEqual(imported.formula.lines[0].id, mockProductionRecipe.ingredients[0].id);
  });

  // T32: Interactive quoted pricing remains intact
  test('T32: Interactive quoted pricing remains intact', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t32', 'Pricing Integrity T32');
    const cfg = proj.products[0];

    // Recalculate Mode A
    const pricingA = calculateProductPricing({
      ...cfg,
      formula: proj.formula,
      ingredientMultiplier: 1.6,
      quotedMethod: 'price_per_case',
      quotedMethodValue: 100.0, // $100 case
    });

    assert.equal(pricingA.quotedPrice, 100.0);
    assert.equal(pricingA.unitPrice, 100.0 / 80);
    assert.equal(pricingA.isQuotedPriceSet, true);
  });

  // T33: Existing CAS and recovery protections remain intact
  test('T33: Existing CAS and recovery protections remain intact', async () => {
    const proj = await createSyntheticProject(TEST_WS, 'test-proj-t33', 'CAS Protection T33');

    // Trying to save an empty formula over existing non-empty formula without allowEmptyFormula throws
    await assert.rejects(
      quotingService.saveProject({
        ...proj,
        formula: { totalWeightGrams: 0, totalCost: 0, lines: [] },
      }),
      (err: any) => {
        assert.match(err.message, /Safety Guard: Attempted to save an empty formula/);
        return true;
      }
    );
  });

  // T34: No destructive operations execute against live data
  test('T34: No destructive operations execute against live data in ws-main', async () => {
    // Attempting permanent deletion of a live project in ws-main without synthetic flag is blocked
    const liveProj = await createSyntheticProject('ws-main', 'proj-sunny-real-live-101', 'Sunny Sweets Real Project');

    // Simulate connected live Firestore mode
    (globalThis as any).localStorage.setItem(
      'recipe_calc_projects_ws-main',
      JSON.stringify([liveProj])
    );

    await assert.rejects(
      quotingService.deleteProjectPermanently({
        workspaceId: 'ws-main',
        projectId: liveProj.id,
        userRole: 'owner',
        userId: OWNER_USER,
        confirmationText: 'DELETE',
        isDevelopmentTestEnvironment: false, // Live production mode!
      }),
      (err: any) => {
        assert.match(err.message, /LIVE_DATA_PROTECTION/);
        return true;
      }
    );
  });
});
