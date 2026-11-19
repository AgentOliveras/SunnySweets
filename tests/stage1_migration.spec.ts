import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STAGE1_APPROVED_MANIFEST_FINGERPRINT,
  STAGE2_HUMAN_REVIEW_NAMES,
  TARGET_WORKSPACE_ID,
  computeFormulaSnapshotHash,
  buildStage1LinkingPlan,
  applyStage1Mutations,
  executeAuthenticatedStage1Migration,
  buildComplete681Manifest,
} from '../src/services/stage1MigrationService';
import { Recipe, MasterIngredient } from '../src/types';
import { calculateRecipeTotal, calculateProduction } from '../src/utils/calculator';
import fs from 'node:fs';

describe('Phase 2A.6B — Authenticated Stage 1 Migration Utility Verification Suite', () => {
  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'mi-butter-1',
      workspaceId: 'ws-main',
      name: 'Unsalted Butter',
      category: 'Fats',
      defaultUnit: 'g',
    },
    {
      id: 'mi-sugar-1',
      workspaceId: 'ws-main',
      name: 'Sugar',
      category: 'Sugars',
      defaultUnit: 'g',
    },
    {
      id: 'mi-vanilla-1',
      workspaceId: 'ws-main',
      name: 'Vanilla Extract',
      category: 'Flavorings',
      defaultUnit: 'ml',
    },
    {
      id: 'mi-flour-1',
      workspaceId: 'ws-main',
      name: 'All-Purpose Flour',
      category: 'Flour',
      defaultUnit: 'g',
    },
    {
      id: 'mi-salt-1',
      workspaceId: 'ws-main',
      name: 'Salt',
      category: 'Spices',
      defaultUnit: 'g',
    },
  ];

  const mockRecipes: Recipe[] = [
    {
      id: 'rec-1',
      workspaceId: 'ws-main',
      userId: 'test-user',
      description: 'Vanilla Shortbread description',
      name: 'Vanilla Shortbread',
      category: 'Cookies',
      batchYieldQuantity: 24,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 4,
      archived: false,
      ingredients: [
        {
          id: 'ing-1',
          name: 'Vanilla Extract',
          quantity: 10,
          unit: 'ml',
          wastePercent: 0,
        },
        {
          id: 'ing-2',
          name: 'All-Purpose Flour',
          quantity: 300,
          unit: 'g',
          wastePercent: 2,
        },
        {
          id: 'ing-3',
          name: 'Unsalted Butter', // In Stage 2 exclusion set!
          quantity: 200,
          unit: 'g',
          wastePercent: 1,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'rec-2',
      workspaceId: 'ws-main',
      userId: 'test-user',
      description: 'Sugar Sparkles description',
      name: 'Sugar Sparkles',
      category: 'Cookies',
      batchYieldQuantity: 12,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 2,
      archived: false,
      ingredients: [
        {
          id: 'ing-4',
          name: 'Salt',
          quantity: 5,
          unit: 'g',
          wastePercent: 0,
        },
        {
          id: 'ing-5',
          name: 'Sugar', // In Stage 2 exclusion set!
          quantity: 150,
          unit: 'g',
          wastePercent: 0,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'rec-3-archived',
      workspaceId: 'ws-main',
      userId: 'test-user',
      description: 'Old Discontinued Cookie description',
      name: 'Old Discontinued Cookie',
      category: 'Cookies',
      batchYieldQuantity: 10,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 0,
      archived: true,
      ingredients: [
        {
          id: 'ing-6',
          name: 'Vanilla Extract',
          quantity: 5,
          unit: 'ml',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  describe('1. Access Role & Workspace Invariant Enforcement', () => {
    it('[S1-01] Viewers are strictly denied execution', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage1Migration({
            db: {} as any,
            user: { uid: 'user-viewer', email: 'viewer@example.com' } as any,
            workspaceId: 'ws-main',
            role: 'viewer',
          });
        },
        /Permission denied: Only workspace Owners can execute Stage 1 migration/
      );
    });

    it('[S1-02] Editors are strictly denied execution', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage1Migration({
            db: {} as any,
            user: { uid: 'user-editor', email: 'editor@example.com' } as any,
            workspaceId: 'ws-main',
            role: 'editor',
          });
        },
        /Permission denied: Only workspace Owners can execute Stage 1 migration/
      );
    });

    it('[S1-03] Unauthenticated calls are strictly denied', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage1Migration({
            db: {} as any,
            user: null,
            workspaceId: 'ws-main',
            role: 'owner',
          });
        },
        /Authentication required: No active Firebase user detected/
      );
    });

    it('[S1-04] Cross-workspace execution target is rejected', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage1Migration({
            db: {} as any,
            user: { uid: 'owner-1', email: 'owner@example.com' } as any,
            workspaceId: 'ws-rogue',
            role: 'owner',
          });
        },
        /Workspace isolation error: Target workspace must be 'ws-main'/
      );
    });
  });

  describe('2. Stage 1 vs Stage 2 Separation & Invariant Checks', () => {
    it('[S1-05] Approved Stage 2 human-review names are completely excluded from Stage 1', async () => {
      const plan = await buildStage1LinkingPlan(mockRecipes, mockMasterIngredients, 'ws-main');

      // Vanilla Extract (rec-1), All-Purpose Flour (rec-1), and Salt (rec-2) should be in Stage 1
      assert.strictEqual(plan.stage1LinesToLink, 3);
      // Unsalted Butter and Sugar are Stage 2 excluded
      assert.strictEqual(plan.stage2ExcludedLines, 2);
      assert.strictEqual(plan.stage2Breakdown['unsalted butter'], 1);
      assert.strictEqual(plan.stage2Breakdown['sugar'], 1);

      // Verify that no Stage 2 ingredient appears in Stage 1 planned links
      for (const link of plan.stage1PlannedLinks) {
        assert.ok(!STAGE2_HUMAN_REVIEW_NAMES.has(link.ingredientName.trim().toLowerCase()));
      }
    });

    it('[S1-06] Archived recipes and archived lines are excluded from Stage 1 linking', async () => {
      const plan = await buildStage1LinkingPlan(mockRecipes, mockMasterIngredients, 'ws-main');

      assert.strictEqual(plan.archivedRecipes, 1);
      assert.strictEqual(plan.archivedFormulaLines, 1);

      // rec-3-archived must NOT be in stage 1 planned links
      const hasArchived = plan.stage1PlannedLinks.some((l) => l.recipeId === 'rec-3-archived');
      assert.strictEqual(hasArchived, false);
    });

    it('[S1-07] Cross-workspace recipe or master ingredient is flagged as invariant violation', async () => {
      const rogueMaster: MasterIngredient = {
        id: 'mi-rogue',
        workspaceId: 'ws-attacker',
        name: 'Rogue Salt',
      };
      const plan = await buildStage1LinkingPlan(mockRecipes, [rogueMaster], 'ws-main');
      assert.ok(plan.invariantViolations.some((v) => v.includes('Cross-workspace master ingredient')));
      assert.strictEqual(plan.isValid, false);
    });
  });

  describe('3. Mathematical Formula Invariance & Hash Verification', () => {
    it('[S1-08] computeFormulaSnapshotHash is deterministic and identical before/after linking', async () => {
      const hashBefore = await computeFormulaSnapshotHash(mockRecipes);

      const plan = await buildStage1LinkingPlan(mockRecipes, mockMasterIngredients, 'ws-main');
      const { updatedRecipes, affectedCount } = applyStage1Mutations(mockRecipes, plan);

      assert.strictEqual(affectedCount, plan.stage1LinesToLink);

      const hashAfter = await computeFormulaSnapshotHash(updatedRecipes);
      assert.strictEqual(hashAfter, hashBefore);
    });

    it('[S1-09] computeFormulaSnapshotHash detects formula tampering', async () => {
      const originalHash = await computeFormulaSnapshotHash(mockRecipes);

      // Tamper with 1 quantity
      const tampered = JSON.parse(JSON.stringify(mockRecipes));
      tampered[0].ingredients[0].quantity = 999;

      const tamperedHash = await computeFormulaSnapshotHash(tampered);
      assert.notStrictEqual(tamperedHash, originalHash);
    });

    it('[S1-10] Formula scaling and production calculations remain 100% identical after linking', () => {
      const beforeCalc = calculateRecipeTotal(mockRecipes[0].ingredients, 'g', 0);

      const plan: any = {
        stage1PlannedLinks: [
          {
            recipeId: 'rec-1',
            ingredientId: 'ing-1',
            masterIngredientId: 'mi-vanilla-1',
          },
          {
            recipeId: 'rec-1',
            ingredientId: 'ing-2',
            masterIngredientId: 'mi-flour-1',
          },
        ],
      };

      const { updatedRecipes } = applyStage1Mutations(mockRecipes, plan);
      const afterCalc = calculateRecipeTotal(updatedRecipes[0].ingredients, 'g', 0);

      assert.strictEqual(afterCalc.totalWeightGrams, beforeCalc.totalWeightGrams);
      assert.strictEqual(afterCalc.discreteCount, beforeCalc.discreteCount);

      // Test production batch calculation
      const beforeProd = calculateProduction(mockRecipes[0], [], {
        mode: 'full_recipe',
        fullRecipeCount: 3,
        defaultWeightUnit: 'g',
      });
      const afterProd = calculateProduction(updatedRecipes[0], [], {
        mode: 'full_recipe',
        fullRecipeCount: 3,
        defaultWeightUnit: 'g',
      });

      assert.strictEqual(afterProd.totalBatchWeightGrams, beforeProd.totalBatchWeightGrams);
      assert.strictEqual(afterProd.totalPieces, beforeProd.totalPieces);
      assert.deepStrictEqual(
        afterProd.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit })),
        beforeProd.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit }))
      );
    });
  });

  describe('4. Full Audit Snapshot Verification (ws-main Baseline)', () => {
    it('[S1-11] Live ws-main audit snapshot yields exactly 512 Stage 1 lines and 169 Stage 2 lines', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) {
        return; // Skip if snapshot not in environment
      }

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      // If the snapshot reflects post-Stage-1 execution (516 linked), reconstruct the pre-Stage-1 baseline
      // where only the 4 original pre-existing lines in 'Shingle Creek Pie Dough' were linked
      const recipes = (audit.recipes as Recipe[]).map((r) => {
        if (r.name === 'Shingle Creek Pie Dough' || r.archived) {
          return r;
        }
        return {
          ...r,
          ingredients: (r.ingredients || []).map((ing) => ({
            ...ing,
            masterIngredientId: undefined,
          })),
        };
      });
      const masterIngredients = audit.masterIngredients as MasterIngredient[];

      const plan = await buildStage1LinkingPlan(recipes, masterIngredients, 'ws-main');

      // Assert exact authoritative counts
      assert.strictEqual(plan.totalRecipes, 73);
      assert.strictEqual(plan.activeRecipes, 70);
      assert.strictEqual(plan.archivedRecipes, 3);
      assert.strictEqual(plan.activeFormulaLines, 685);
      assert.strictEqual(plan.preExistingLinkedActiveLines, 4);
      assert.strictEqual(plan.unlinkedActiveLines, 681);
      assert.strictEqual(plan.brokenLinks, 0);
      assert.strictEqual(plan.archivedFormulaLines, 21);

      // Stage 1 exact metrics
      assert.strictEqual(plan.stage1LinesToLink, 512);
      assert.strictEqual(plan.stage1GroupsCount, 90);
      assert.strictEqual(plan.stage1AffectedRecipesCount, 69);

      // Stage 2 exact metrics
      assert.strictEqual(plan.stage2ExcludedLines, 169);
      assert.strictEqual(plan.stage2ExcludedGroupsCount, 10);

      // Breakdown of the 10 human review groups
      assert.strictEqual(plan.stage2Breakdown['unsalted butter'], 58);
      assert.strictEqual(plan.stage2Breakdown['sugar'], 56);
      assert.strictEqual(plan.stage2Breakdown['dark brown sugar'], 34);
      assert.strictEqual(plan.stage2Breakdown['oatmeal'], 8);
      assert.strictEqual(plan.stage2Breakdown['light brown sugar'], 7);
      assert.strictEqual(plan.stage2Breakdown['flax seeds (ground)'], 2);
      assert.strictEqual(plan.stage2Breakdown['butter'], 1);
      assert.strictEqual(plan.stage2Breakdown['flax seed meal'], 1);
      assert.strictEqual(plan.stage2Breakdown['marhsmallow'], 1);
      assert.strictEqual(plan.stage2Breakdown['steel cut'], 1);

      // Verify approved fingerprint matches and all pre-write invariants are satisfied
      assert.strictEqual(plan.isFingerprintApproved, true);
      assert.strictEqual(plan.currentManifestFingerprint, '3c2b327885d07c3a0975fee1f7de873318854f37e61ae043e4ad8df15979e5ca');
      assert.strictEqual(plan.invariantViolations.length, 0);
      assert.strictEqual(plan.isValid, true);

      // Test mutation on audit recipes
      const { updatedRecipes, affectedCount } = applyStage1Mutations(recipes, plan);
      assert.strictEqual(affectedCount, 512);

      // Formula hash must match exactly before and after linking
      const postHash = await computeFormulaSnapshotHash(updatedRecipes);
      assert.strictEqual(postHash, plan.preWriteFormulaHash);
    });

    it('[S1-12] Authoritative Stage 2 mappings and Marshmallow target correction are strictly verified', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) {
        return;
      }

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const recipes = (audit.recipes as Recipe[]).map((r) => {
        if (r.name === 'Shingle Creek Pie Dough' || r.archived) {
          return r;
        }
        return {
          ...r,
          ingredients: (r.ingredients || []).map((ing) => ({
            ...ing,
            masterIngredientId: undefined,
          })),
        };
      });
      const masterIngredients = audit.masterIngredients as MasterIngredient[];

      const manifest = buildComplete681Manifest(recipes, masterIngredients);
      assert.strictEqual(manifest.length, 681);

      const stage1Records = manifest.filter((m) => m.stage === 'STAGE_1');
      const stage2Records = manifest.filter((m) => m.stage === 'STAGE_2');

      assert.strictEqual(stage1Records.length, 512);
      assert.strictEqual(stage2Records.length, 169);

      // Verify Marshmallow target is authoritative mi-1785876432641 and NOT corrupted mi-1787072264396-0v58
      const marshmallowRecord = manifest.find((m) => m.ingredientDisplayName === 'Marhsmallow');
      assert.ok(marshmallowRecord, 'Marhsmallow record must exist in manifest');
      assert.strictEqual(marshmallowRecord.recipeName, 'Orange Marshmallow Cookies');
      assert.strictEqual(marshmallowRecord.proposedMasterIngredientId, 'mi-1785876432641');
      assert.strictEqual(marshmallowRecord.proposedMasterIngredientName, 'Marshmallows');
      assert.strictEqual(marshmallowRecord.stage, 'STAGE_2');

      // Verify Butter -> mi-9
      const butterRecord = manifest.find((m) => m.ingredientDisplayName === 'Butter');
      assert.ok(butterRecord);
      assert.strictEqual(butterRecord.proposedMasterIngredientId, 'mi-9');
      assert.strictEqual(butterRecord.proposedMasterIngredientName, 'Unsalted Butter');

      // Verify Flax Seed Meal and Flax Seeds (Ground) remain distinct
      const flaxMeal = manifest.find((m) => m.ingredientDisplayName === 'Flax Seed Meal');
      assert.ok(flaxMeal);
      assert.strictEqual(flaxMeal.proposedMasterIngredientId, 'mi-1785876070988');

      const flaxGround = manifest.find((m) => m.ingredientDisplayName === 'Flax Seeds (Ground)');
      assert.ok(flaxGround);
      assert.strictEqual(flaxGround.proposedMasterIngredientId, 'mi-1785876091244');
      assert.notStrictEqual(flaxMeal.proposedMasterIngredientId, flaxGround.proposedMasterIngredientId);

      // Verify Steel Cut -> mi-1787074632520-5frd
      const steelCut = manifest.find((m) => m.ingredientDisplayName === 'Steel Cut');
      assert.ok(steelCut);
      assert.strictEqual(steelCut.proposedMasterIngredientId, 'mi-1787074632520-5frd');

      // Verify Dark Brown Sugar and Light Brown Sugar remain distinct
      const darkBrown = manifest.find((m) => m.ingredientDisplayName === 'Dark Brown Sugar');
      const lightBrown = manifest.find((m) => m.ingredientDisplayName === 'Light Brown Sugar');
      assert.ok(darkBrown && lightBrown);
      assert.strictEqual(darkBrown.proposedMasterIngredientId, 'mi-6');
      assert.strictEqual(lightBrown.proposedMasterIngredientId, 'mi-1785876302990');
      assert.notStrictEqual(darkBrown.proposedMasterIngredientId, lightBrown.proposedMasterIngredientId);
    });

    it('[S1-13] Hardened formula snapshot hash detects metadata alterations', async () => {
      const sampleRecipeCopy = JSON.parse(JSON.stringify(mockRecipes[0]));
      const originalHash = await computeFormulaSnapshotHash([sampleRecipeCopy]);

      // Category change
      const modifiedCategory = JSON.parse(JSON.stringify(sampleRecipeCopy));
      modifiedCategory.category = 'Modified Category';
      assert.notStrictEqual(await computeFormulaSnapshotHash([modifiedCategory]), originalHash);

      // Description change
      const modifiedDesc = JSON.parse(JSON.stringify(sampleRecipeCopy));
      modifiedDesc.description = 'Modified Description';
      assert.notStrictEqual(await computeFormulaSnapshotHash([modifiedDesc]), originalHash);

      // Batch yield change
      const modifiedYield = JSON.parse(JSON.stringify(sampleRecipeCopy));
      modifiedYield.batchYieldQuantity = 999;
      assert.notStrictEqual(await computeFormulaSnapshotHash([modifiedYield]), originalHash);

      // Default waste percent change
      const modifiedWaste = JSON.parse(JSON.stringify(sampleRecipeCopy));
      modifiedWaste.defaultWastePercent = 99;
      assert.notStrictEqual(await computeFormulaSnapshotHash([modifiedWaste]), originalHash);
    });
  });
});
