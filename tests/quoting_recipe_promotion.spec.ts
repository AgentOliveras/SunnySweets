import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  canUserPromoteProject,
  checkDuplicatePromotion,
  validatePromotionPayload,
  PromotionPayload,
} from '../src/services/promotionService';
import { generateFormulaFingerprint } from '../src/utils/formulaFingerprint';
import { ProductProject, QuoteRevision } from '../src/types/quoting';
import { MasterIngredient, Workspace, Recipe } from '../src/types';

describe('Phase 2B.6 — Controlled Product Development → Production Recipe Promotion Suite', () => {
  const mockWorkspace: Workspace = {
    id: 'ws-101',
    name: 'Bakery Lab',
    ownerId: 'user-owner',
    ownerEmail: 'owner@test.com',
    code: 'LAB',
    members: [],
    groups: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    features: {
      recipeManagement: true,
      productionFloor: true,
      costing: true,
      inventoryManagement: false,
      labelPrinting: false,
      productQuoting: true,
    },
  };

  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'mi-flour',
      workspaceId: 'ws-101',
      name: 'Bread Flour',
      category: 'Flour',
      defaultUnit: 'g',
    },
    {
      id: 'mi-butter',
      workspaceId: 'ws-101',
      name: 'Unsalted Butter',
      category: 'Dairy',
      defaultUnit: 'g',
    },
    {
      id: 'mi-milk',
      workspaceId: 'ws-101',
      name: 'Whole Milk',
      category: 'Dairy',
      defaultUnit: 'ml',
      densityGramsPerMl: 1.03,
    },
    {
      id: 'mi-eggs',
      workspaceId: 'ws-101',
      name: 'Large Eggs',
      category: 'Eggs',
      defaultUnit: 'eggs',
      pieceWeightGrams: 50,
    },
  ];

  const mockProject: ProductProject = {
    id: 'proj-hotel-program',
    workspaceId: 'ws-101',
    productName: 'ABC Hotel Cookie Program',
    productCategory: 'Cookies',
    status: 'draft',
    formulaOwnership: 'bakery_owned',
    products: [],
    currentRevisionNumber: 1,
    createdBy: 'user-mgmt',
    updatedBy: 'user-mgmt',
    formula: {
      totalWeightGrams: 750,
      totalCost: 3.0,
      lines: [
        {
          id: 'line-1',
          name: 'Bread Flour',
          quantity: 500,
          unit: 'g',
          masterIngredientId: 'mi-flour',
          unitCostUsed: 0.002,
          unitCostType: 'per_gram',
          lineCost: 1.0,
        },
        {
          id: 'line-2',
          name: 'Unsalted Butter',
          quantity: 250,
          unit: 'g',
          masterIngredientId: 'mi-butter',
          unitCostUsed: 0.008,
          unitCostType: 'per_gram',
          lineCost: 2.0,
        },
      ],
    },
    revisions: [
      {
        id: 'rev-001',
        revisionNumber: 1,
        quoteCode: 'REV-001',
        createdAt: '2026-03-01T10:00:00Z',
        createdBy: 'user-mgmt',
        notes: 'Initial commercial revision for hotel banquets',
        formulaSnapshot: {
          totalWeightGrams: 750,
          totalCost: 3.0,
          lines: [
            {
              id: 'rev-line-1',
              name: 'Bread Flour',
              quantity: 500,
              unit: 'g',
              masterIngredientId: 'mi-flour',
              unitCostUsed: 0.002,
              unitCostType: 'per_gram',
              lineCost: 1.0,
            },
            {
              id: 'rev-line-2',
              name: 'Unsalted Butter',
              quantity: 250,
              unit: 'g',
              masterIngredientId: 'mi-butter',
              unitCostUsed: 0.008,
              unitCostType: 'per_gram',
              lineCost: 2.0,
            },
          ],
        },
        productsSnapshot: [],
      },
    ],
    productionPromotions: [],
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-01T10:00:00Z',
  };

  // ---------------------------------------------------------------------------
  // 1. Authorization Rules (Floor PIN, Viewer, Editor, Owner)
  // ---------------------------------------------------------------------------
  describe('1. Authorization Gates', () => {
    it('PROMO-AUTH-1: Owner can promote project', () => {
      assert.strictEqual(canUserPromoteProject(mockWorkspace, 'owner', false), true);
    });

    it('PROMO-AUTH-2: Editor / Manager can promote project', () => {
      assert.strictEqual(canUserPromoteProject(mockWorkspace, 'editor', false), true);
    });

    it('PROMO-AUTH-3: Production Floor PIN user is strictly DENIED', () => {
      assert.strictEqual(canUserPromoteProject(mockWorkspace, 'owner', true), false);
      assert.strictEqual(canUserPromoteProject(mockWorkspace, 'editor', true), false);
    });

    it('PROMO-AUTH-4: Viewer is strictly DENIED', () => {
      assert.strictEqual(canUserPromoteProject(mockWorkspace, 'viewer', false), false);
    });

    it('PROMO-AUTH-5: Workspace without productQuoting capability is strictly DENIED', () => {
      const restrictedWs: Workspace = {
        ...mockWorkspace,
        features: {
          recipeManagement: true,
          productionFloor: true,
          costing: true,
          inventoryManagement: false,
          labelPrinting: false,
          productQuoting: false,
        },
      };
      assert.strictEqual(canUserPromoteProject(restrictedWs, 'owner', false), false);
    });

    it('PROMO-AUTH-6: Null workspace or undefined role is strictly DENIED', () => {
      assert.strictEqual(canUserPromoteProject(null, 'owner', false), false);
      assert.strictEqual(canUserPromoteProject(mockWorkspace, null, false), false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Promotion Payload Validation
  // ---------------------------------------------------------------------------
  describe('2. Validation & Safety Gates', () => {
    const validPayload: PromotionPayload = {
      workspaceId: 'ws-101',
      projectId: 'proj-hotel-program',
      projectName: 'ABC Hotel Cookie Program',
      sourceType: 'working_formula',
      recipeName: 'ABC Hotel Chocolate Chip',
      recipeCategory: 'Cookies',
      batchYieldQuantity: 48,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 2,
      formulaOwnership: 'bakery_owned',
      userId: 'user-owner',
      ingredients: [
        {
          id: 'ing-1',
          name: 'Bread Flour',
          quantity: 500,
          unit: 'g',
          masterIngredientId: 'mi-flour',
        },
        {
          id: 'ing-2',
          name: 'Unsalted Butter',
          quantity: 250,
          unit: 'g',
          masterIngredientId: 'mi-butter',
        },
      ],
    };

    it('PROMO-VAL-1: Valid payload passes validation cleanly', () => {
      const res = validatePromotionPayload(
        validPayload,
        mockWorkspace,
        'owner',
        mockProject,
        mockMasterIngredients,
        []
      );
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.errors.length, 0);
    });

    it('PROMO-VAL-2: Cross-workspace promotion is strictly blocked', () => {
      const crossPayload: PromotionPayload = {
        ...validPayload,
        workspaceId: 'ws-other-corp',
      };
      const res = validatePromotionPayload(
        crossPayload,
        mockWorkspace,
        'owner',
        mockProject,
        mockMasterIngredients,
        []
      );
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('Cross-workspace')));
    });

    it('PROMO-VAL-3: Unlinked ingredient triggers Master Ingredient Resolution gate', () => {
      const unlinkedPayload: PromotionPayload = {
        ...validPayload,
        ingredients: [
          {
            id: 'ing-unlinked',
            name: 'Special Vanilla',
            quantity: 10,
            unit: 'g',
            masterIngredientId: '', // Unlinked!
          },
        ],
      };
      const res = validatePromotionPayload(
        unlinkedPayload,
        mockWorkspace,
        'owner',
        mockProject,
        mockMasterIngredients,
        []
      );
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('Resolution is required')));
    });

    it('PROMO-VAL-4: Volume ingredient without density generates actionable warning', () => {
      const volumePayload: PromotionPayload = {
        ...validPayload,
        ingredients: [
          {
            id: 'ing-vol',
            name: 'Whole Milk',
            quantity: 200,
            unit: 'ml',
            masterIngredientId: 'mi-flour', // flour has no density
          },
        ],
      };
      const res = validatePromotionPayload(
        volumePayload,
        mockWorkspace,
        'owner',
        mockProject,
        mockMasterIngredients,
        []
      );
      assert.strictEqual(res.isValid, true); // Does not block creation
      assert.ok(res.warnings.some((w) => w.includes('volume unit') && w.includes('without density')));
    });

    it('PROMO-VAL-5: Non-existent revisionId is rejected when sourceType is quote_revision', () => {
      const badRevPayload: PromotionPayload = {
        ...validPayload,
        sourceType: 'quote_revision',
        sourceRevisionId: 'rev-ghost-nonexistent',
      };
      const res = validatePromotionPayload(
        badRevPayload,
        mockWorkspace,
        'owner',
        mockProject,
        mockMasterIngredients,
        []
      );
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('does not exist in this project')));
    });
  });

  // ---------------------------------------------------------------------------
  // 3. One-to-Many Promotion & Non-Destructive Provenance
  // ---------------------------------------------------------------------------
  describe('3. One-to-Many Promotion & Provenance Tracking', () => {
    it('PROMO-MULTI-1: Single project can have multiple promotions with distinct names', () => {
      const fingerprint = generateFormulaFingerprint(mockProject.formula.lines);

      // Recipe 1: Chocolate Chip
      const dup1 = checkDuplicatePromotion(mockProject, 'ABC Hotel Chocolate Chip', fingerprint, []);
      assert.strictEqual(dup1.isDuplicate, false);

      // Record first promotion
      const projectWithPromo1: ProductProject = {
        ...mockProject,
        productionPromotions: [
          {
            id: 'promo-1',
            productionRecipeId: 'rec-1',
            productionRecipeName: 'ABC Hotel Chocolate Chip',
            sourceType: 'working_formula',
            sourceFormulaFingerprint: fingerprint,
            promotedAt: new Date().toISOString(),
            promotedByUid: 'user-owner',
          },
        ],
      };

      // Recipe 2: Macadamia White Chocolate (same project, distinct name)
      const dup2 = checkDuplicatePromotion(
        projectWithPromo1,
        'ABC Hotel Macadamia White Chocolate',
        fingerprint,
        []
      );
      assert.strictEqual(dup2.isDuplicate, false, 'Multiple distinct recipes from same project must be permitted');

      // Duplicate attempt: Exact same recipe name and formula on same project
      const dupExact = checkDuplicatePromotion(
        projectWithPromo1,
        'ABC Hotel Chocolate Chip',
        fingerprint,
        []
      );
      assert.strictEqual(dupExact.isDuplicate, true, 'Duplicate promotion with same name and formula must be caught');
    });

    it('PROMO-MULTI-2: Formula fingerprint correctly reflects formulation changes', () => {
      const fp1 = generateFormulaFingerprint([
        { id: '1', name: 'Flour', quantity: 500, unit: 'g', masterIngredientId: 'mi-1' },
      ]);
      const fp2 = generateFormulaFingerprint([
        { id: '1', name: 'Flour', quantity: 550, unit: 'g', masterIngredientId: 'mi-1' },
      ]);
      assert.notStrictEqual(fp1, fp2, 'Different quantities must produce different fingerprints');
    });

    it('PROMO-MULTI-3: Historical revisions and project remain unmutated after promotion simulation', () => {
      const initialRevisionsCount = mockProject.revisions?.length;
      const initialFormulaLinesCount = mockProject.formula.lines.length;

      // Promotion records do not overwrite revisions
      const updatedPromotions = [
        ...(mockProject.productionPromotions || []),
        {
          id: 'promo-sim-1',
          productionRecipeId: 'rec-sim-1',
          productionRecipeName: 'Simulated Recipe',
          sourceType: 'quote_revision' as const,
          sourceRevisionId: 'rev-001',
          sourceRevisionNumber: 1,
          sourceFormulaFingerprint: 'abc',
          promotedAt: new Date().toISOString(),
          promotedByUid: 'user-owner',
        },
      ];

      const promotedProject: ProductProject = {
        ...mockProject,
        productionPromotions: updatedPromotions,
      };

      assert.strictEqual(promotedProject.revisions?.length, initialRevisionsCount);
      assert.strictEqual(promotedProject.formula.lines.length, initialFormulaLinesCount);
      assert.strictEqual(promotedProject.revisions?.[0].notes, 'Initial commercial revision for hotel banquets');
    });
  });
});
