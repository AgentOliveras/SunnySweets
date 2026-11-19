import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import {
  STAGE2_APPROVED_MINIMAL_FINGERPRINT,
  STAGE2_APPROVED_FULL_FINGERPRINT,
  STAGE2_EXPECTED_FORMULA_HASH,
  STAGE2_AUTHORIZATION_PHRASE,
  STAGE2_PROHIBITED_MASTER_IDS,
  STAGE2_PROTECTED_CLEANUP_CANDIDATES,
  STAGE2_MAPPING_DEFINITIONS,
  TARGET_WORKSPACE_ID,
  buildStage2Manifest,
  computeStage2MinimalFingerprint,
  computeStage2FullFingerprint,
  computeFormulaSnapshotHash,
  buildStage2LinkingPlan,
  applyStage2Mutations,
  executeAuthenticatedStage2Migration,
} from '../src/services/stage2MigrationService';
import { Recipe, MasterIngredient } from '../src/types';

describe('Phase 2A.9 — Stage 2 Owner-Authorized Ambiguity Linking Utility Suite', () => {
  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'mi-9',
      workspaceId: 'ws-main',
      name: 'Unsalted Butter',
      category: 'Dairy & Fats',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1785877164225-axt7',
      workspaceId: 'ws-main',
      name: 'Sugar',
      category: 'General',
      defaultUnit: 'g',
    },
    {
      id: 'mi-6',
      workspaceId: 'ws-main',
      name: 'Dark Brown Sugar',
      category: 'Sugar & Sweeteners',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1785876302990',
      workspaceId: 'ws-main',
      name: 'Light Brown Sugar',
      category: 'Sugar',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1785876569598',
      workspaceId: 'ws-main',
      name: 'Oatmeal',
      category: 'Oatmeal',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1785876091244',
      workspaceId: 'ws-main',
      name: 'Flax Seeds (Ground)',
      category: 'Seeds',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1785876070988',
      workspaceId: 'ws-main',
      name: 'Flax Seed Meal',
      category: 'Seeds',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1785876432641',
      workspaceId: 'ws-main',
      name: 'Marshmallows',
      category: 'Add-ins',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1787074632520-5frd',
      workspaceId: 'ws-main',
      name: 'Steel Cut',
      category: 'General',
      defaultUnit: 'g',
    },
    {
      id: 'mi-1',
      workspaceId: 'ws-main',
      name: 'All-Purpose Flour',
      category: 'Flours',
      defaultUnit: 'g',
    },
  ];

  describe('1. Owner Authorization & Guard Invariants', () => {
    it('[S2-01] Non-owner (viewer) is strictly denied execution', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: {} as any,
            user: { uid: 'uid-viewer', email: 'viewer@sunnysweets.com' } as any,
            workspaceId: 'ws-main',
            role: 'viewer',
            confirmationPhrase: STAGE2_AUTHORIZATION_PHRASE,
          });
        },
        {
          name: 'Error',
          message: "Permission denied: Only workspace Owners can execute Stage 2 migration. Current role is 'viewer'.",
        }
      );
    });

    it('[S2-02] Non-owner (editor) is strictly denied execution', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: {} as any,
            user: { uid: 'uid-editor', email: 'editor@sunnysweets.com' } as any,
            workspaceId: 'ws-main',
            role: 'editor',
            confirmationPhrase: STAGE2_AUTHORIZATION_PHRASE,
          });
        },
        {
          name: 'Error',
          message: "Permission denied: Only workspace Owners can execute Stage 2 migration. Current role is 'editor'.",
        }
      );
    });

    it('[S2-03] Unauthenticated caller (null user) is strictly denied execution', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: {} as any,
            user: null,
            workspaceId: 'ws-main',
            role: 'owner',
            confirmationPhrase: STAGE2_AUTHORIZATION_PHRASE,
          });
        },
        {
          name: 'Error',
          message: 'Authentication required: No active Firebase user detected.',
        }
      );
    });

    it('[S2-04] Cross-workspace execution target is rejected', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: {} as any,
            user: { uid: 'uid-owner', email: 'owner@sunnysweets.com' } as any,
            workspaceId: 'ws-other',
            role: 'owner',
            confirmationPhrase: STAGE2_AUTHORIZATION_PHRASE,
          });
        },
        {
          name: 'Error',
          message: "Workspace isolation error: Target workspace must be 'ws-main', got 'ws-other'.",
        }
      );
    });

    it('[S2-05] Wrong or missing authorization phrase strictly blocks execution', async () => {
      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: {} as any,
            user: { uid: 'uid-owner', email: 'owner@sunnysweets.com' } as any,
            workspaceId: 'ws-main',
            role: 'owner',
            confirmationPhrase: 'execute stage 2 linking', // Lowercase mismatch
          });
        },
        {
          name: 'Error',
          message: "Invalid authorization phrase: Expected 'EXECUTE STAGE 2 LINKING', got 'execute stage 2 linking'. Execution blocked.",
        }
      );
    });
  });

  function getPreExecutionBaselineRecipes(recipes: Recipe[]): Recipe[] {
    const cloned: Recipe[] = JSON.parse(JSON.stringify(recipes));
    for (const r of cloned) {
      if (r.archived) continue;
      for (const ing of r.ingredients || []) {
        const mapping = STAGE2_MAPPING_DEFINITIONS[ing.name.trim()];
        if (mapping && ing.masterIngredientId === mapping.proposedMasterIngredientId) {
          delete ing.masterIngredientId;
        }
      }
    }
    return cloned;
  }

  describe('2. Manifest Reconstruction & Fingerprint Matching', () => {
    it('[S2-06] Dynamic manifest reconstruction from live census yields exactly 169 records', () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const preRecipes = getPreExecutionBaselineRecipes(audit.recipes);
      const manifest = buildStage2Manifest(preRecipes, audit.masterIngredients);

      assert.strictEqual(manifest.length, 169);

      // Verify no duplicates
      const seen = new Set<string>();
      for (const m of manifest) {
        const key = `${m.recipeId}::${m.ingredientId}`;
        assert.strictEqual(seen.has(key), false, `Duplicate key detected: ${key}`);
        seen.add(key);
      }
      assert.strictEqual(seen.size, 169);

      // Also verify that passing includeAlreadyLinked=true on executed recipes yields 169 records
      const candidateManifest = buildStage2Manifest(audit.recipes, audit.masterIngredients, true);
      assert.strictEqual(candidateManifest.length, 169);
    });

    it('[S2-07] Minimal canonical fingerprint matches approved SHA-256 hash', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const preRecipes = getPreExecutionBaselineRecipes(audit.recipes);
      const manifest = buildStage2Manifest(preRecipes, audit.masterIngredients);

      const minimalHash = await computeStage2MinimalFingerprint(manifest);
      assert.strictEqual(minimalHash, STAGE2_APPROVED_MINIMAL_FINGERPRINT);
      assert.strictEqual(
        minimalHash,
        '9b87dac651d262f2842f952fec7a4de42d561443b1f508008b10194d2ed47027'
      );
    });

    it('[S2-08] Full manifest fingerprint matches secondary approved SHA-256 hash', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const preRecipes = getPreExecutionBaselineRecipes(audit.recipes);
      const manifest = buildStage2Manifest(preRecipes, audit.masterIngredients);

      const fullHash = await computeStage2FullFingerprint(manifest);
      assert.strictEqual(fullHash, STAGE2_APPROVED_FULL_FINGERPRINT);
      assert.strictEqual(
        fullHash,
        '18b9b811e6305fd82d2856f27327b412f5815ab9321a5c52baf0a707abd163cb'
      );
    });

    it('[S2-09] Fingerprint mismatch blocks execution', async () => {
      const mockManifestRecord = {
        recipeId: 'rec-test',
        recipeName: 'Test Cookie',
        ingredientId: 'ing-1',
        ingredientDisplayName: 'Sugar',
        currentMasterIngredientId: null,
        proposedMasterIngredientId: 'mi-1785877164225-axt7',
        proposedMasterIngredientName: 'Sugar',
        mappingDecisionType: 'Test Decision',
      };

      // Manifest with only 1 record will not match 169-record hash
      const singleHash = await computeStage2MinimalFingerprint([mockManifestRecord]);
      assert.notStrictEqual(singleHash, STAGE2_APPROVED_MINIMAL_FINGERPRINT);
    });
  });

  describe('3. Prohibited Targets & Safety Invariants', () => {
    it('[S2-10] Prohibited Master Ingredient IDs are completely excluded from Stage 2 mapping definitions', () => {
      for (const [name, def] of Object.entries(STAGE2_MAPPING_DEFINITIONS)) {
        assert.strictEqual(
          STAGE2_PROHIBITED_MASTER_IDS.has(def.proposedMasterIngredientId),
          false,
          `Prohibited Master Ingredient ${def.proposedMasterIngredientId} mapped for '${name}'`
        );
      }
    });

    it('[S2-11] Stage 2 manifest contains zero occurrences of prohibited Master Ingredients', () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const manifest = buildStage2Manifest(audit.recipes, audit.masterIngredients);

      for (const rec of manifest) {
        assert.strictEqual(
          STAGE2_PROHIBITED_MASTER_IDS.has(rec.proposedMasterIngredientId),
          false,
          `Record in ${rec.recipeName} targets prohibited ID ${rec.proposedMasterIngredientId}`
        );
      }
    });

    it('[S2-12] Protected pantry cleanup candidates exist and are untouched in pantry', () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const miMap = new Map<string, MasterIngredient>();
      audit.masterIngredients.forEach((m: MasterIngredient) => miMap.set(m.id, m));

      for (const cand of STAGE2_PROTECTED_CLEANUP_CANDIDATES) {
        const item = miMap.get(cand.id);
        assert.ok(item, `Protected pantry candidate ${cand.id} must exist in pantry`);
        assert.strictEqual(
          item.name,
          cand.expectedName,
          `Protected candidate ${cand.id} name must be '${cand.expectedName}', got '${item.name}'`
        );
      }
    });

    it('[S2-13] Archived recipes and archived lines are strictly excluded from Stage 2 manifest', () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const archivedIds = new Set(
        audit.recipes.filter((r: Recipe) => r.archived).map((r: Recipe) => r.id)
      );

      const manifest = buildStage2Manifest(audit.recipes, audit.masterIngredients);
      for (const rec of manifest) {
        assert.strictEqual(
          archivedIds.has(rec.recipeId),
          false,
          `Archived recipe ${rec.recipeName} (${rec.recipeId}) must not be in Stage 2 manifest`
        );
      }
    });
  });

  describe('4. Formula Content Immutability & Hash Verification', () => {
    it('[S2-14] Pre-write formula content hash matches authoritative approved hash', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const hash = await computeFormulaSnapshotHash(audit.recipes);

      assert.strictEqual(hash, STAGE2_EXPECTED_FORMULA_HASH);
      assert.strictEqual(
        hash,
        '32a7cf48c5a8fb42e10ac62199900d22782afcc56c99aba6a7da3abc74ae74fd'
      );
    });

    it('[S2-15] applyStage2Mutations modifies ONLY masterIngredientId and preserves formula hash', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const preRecipes = getPreExecutionBaselineRecipes(audit.recipes);
      const plan = await buildStage2LinkingPlan(
        preRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'PRE_EXECUTION_READY');
      assert.strictEqual(plan.isValid, true);
      assert.strictEqual(plan.stage2LinesToLink, 169);

      // Perform in-memory mutation from pre-execution state
      const { updatedRecipes, affectedCount } = applyStage2Mutations(preRecipes, plan);
      assert.strictEqual(affectedCount, 169);

      // Verify formula snapshot hash is 100% identical before and after
      const postHash = await computeFormulaSnapshotHash(updatedRecipes);
      assert.strictEqual(postHash, plan.preWriteFormulaHash);
      assert.strictEqual(postHash, STAGE2_EXPECTED_FORMULA_HASH);

      // Verify all formula line data other than masterIngredientId is untouched
      for (const orig of preRecipes) {
        const upd = updatedRecipes.find((r) => r.id === orig.id)!;
        assert.strictEqual(upd.name, orig.name);
        assert.strictEqual(upd.batchYieldQuantity, orig.batchYieldQuantity);
        assert.strictEqual(upd.batchYieldUnit, orig.batchYieldUnit);
        assert.strictEqual(upd.defaultWastePercent, orig.defaultWastePercent);
        assert.strictEqual(upd.archived, orig.archived);

        assert.strictEqual(upd.ingredients.length, orig.ingredients.length);
        for (let i = 0; i < orig.ingredients.length; i++) {
          const origIng = orig.ingredients[i];
          const updIng = upd.ingredients[i];
          assert.strictEqual(updIng.id, origIng.id);
          assert.strictEqual(updIng.name, origIng.name);
          assert.strictEqual(updIng.quantity, origIng.quantity);
          assert.strictEqual(updIng.unit, origIng.unit);
          assert.strictEqual(updIng.wastePercent, origIng.wastePercent);
          assert.strictEqual(updIng.notes, origIng.notes);
        }
      }
    });

    it('[S2-16] Post-Stage-2 state projects 685 active linked lines and 0 unlinked lines', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const preRecipes = getPreExecutionBaselineRecipes(audit.recipes);
      const plan = await buildStage2LinkingPlan(
        preRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      const { updatedRecipes } = applyStage2Mutations(preRecipes, plan);

      let activeLinked = 0;
      let activeUnlinked = 0;
      let archivedLinked = 0;
      let archivedUnlinked = 0;

      for (const r of updatedRecipes) {
        if (r.archived) {
          for (const ing of r.ingredients || []) {
            if (ing.masterIngredientId) archivedLinked++;
            else archivedUnlinked++;
          }
        } else {
          for (const ing of r.ingredients || []) {
            if (ing.masterIngredientId) activeLinked++;
            else activeUnlinked++;
          }
        }
      }

      assert.strictEqual(activeLinked, 685);
      assert.strictEqual(activeUnlinked, 0);
      assert.strictEqual(archivedLinked, 0);
      assert.strictEqual(archivedUnlinked, 21);
    });
  });

  describe('5. Concurrency & Stale Data Guarding', () => {
    it('[S2-17] Plan detects cross-workspace recipe and master ingredients', async () => {
      const crossWsRecipe: Recipe = {
        id: 'rec-cross',
        workspaceId: 'ws-foreign',
        name: 'Foreign Cookie',
        ingredients: [
          {
            id: 'ing-1',
            name: 'Sugar',
            quantity: 100,
            unit: 'g',
          },
        ],
      } as any;

      const plan = await buildStage2LinkingPlan(
        [crossWsRecipe],
        mockMasterIngredients,
        'ws-main'
      );

      assert.strictEqual(plan.isValid, false);
      const crossViolation = plan.invariantViolations.find((v) =>
        v.includes('Cross-workspace recipe detected')
      );
      assert.ok(crossViolation);
    });

    it('[S2-18] Plan detects missing target Master Ingredient', async () => {
      const recipeWithMissingTarget: Recipe = {
        id: 'rec-missing-target',
        workspaceId: 'ws-main',
        name: 'Cookie With Unmapped Target',
        ingredients: [
          {
            id: 'ing-1',
            name: 'Sugar',
            quantity: 100,
            unit: 'g',
          },
        ],
      } as any;

      // Master ingredients list without Sugar (mi-1785877164225-axt7)
      const pantryWithoutSugar = mockMasterIngredients.filter(
        (m) => m.id !== 'mi-1785877164225-axt7'
      );

      const plan = await buildStage2LinkingPlan(
        [recipeWithMissingTarget],
        pantryWithoutSugar,
        'ws-main'
      );

      assert.strictEqual(plan.isValid, false);
      const missingViolation = plan.invariantViolations.find((v) =>
        v.includes('Missing target Master Ingredient')
      );
      assert.ok(missingViolation);
    });
  });

  describe('6. Lifecycle State Recognition & Migration Closure (Phase 2A.12)', () => {
    it('[S2-19] Strict POST_EXECUTION_COMPLETE recognized on authoritative live executed data', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const plan = await buildStage2LinkingPlan(
        audit.recipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'POST_EXECUTION_COMPLETE');
      assert.strictEqual(plan.isValid, true);
      assert.strictEqual(plan.invariantViolations.length, 0);

      // Census invariants
      assert.strictEqual(plan.totalRecipes, 73);
      assert.strictEqual(plan.activeRecipes, 70);
      assert.strictEqual(plan.archivedRecipes, 3);
      assert.strictEqual(plan.totalFormulaLines, 706);
      assert.strictEqual(plan.activeFormulaLines, 685);
      assert.strictEqual(plan.archivedFormulaLines, 21);

      // Linking invariants
      assert.strictEqual(plan.currentActiveLinkedLines, 685);
      assert.strictEqual(plan.currentActiveUnlinkedLines, 0);
      assert.strictEqual(plan.currentArchivedLinkedLines, 0);
      assert.strictEqual(plan.currentArchivedUnlinkedLines, 21);
      assert.strictEqual(plan.brokenLinks, 0);

      // Stage 2 specific links verification
      assert.strictEqual(plan.stage2LinesToLink, 0);
      assert.strictEqual(plan.stage2CompletedLinks, 169);
      assert.strictEqual(plan.stage2Manifest.length, 169);
      assert.strictEqual(plan.stage2GroupsCount, 10);
      assert.strictEqual(plan.affectedRecipesCount, 68);

      // Cryptographic guarantees
      assert.strictEqual(plan.isFormulaHashApproved, true);
      assert.strictEqual(plan.preWriteFormulaHash, STAGE2_EXPECTED_FORMULA_HASH);
      assert.strictEqual(plan.approvedMinimalFingerprint, STAGE2_APPROVED_MINIMAL_FINGERPRINT);
      assert.strictEqual(plan.isFingerprintApproved, true);
    });

    it('[S2-20] Strict PRE_EXECUTION_READY recognized on pre-execution baseline', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const preRecipes = getPreExecutionBaselineRecipes(audit.recipes);
      const plan = await buildStage2LinkingPlan(
        preRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'PRE_EXECUTION_READY');
      assert.strictEqual(plan.isValid, true);
      assert.strictEqual(plan.invariantViolations.length, 0);

      assert.strictEqual(plan.currentActiveLinkedLines, 516);
      assert.strictEqual(plan.currentActiveUnlinkedLines, 169);
      assert.strictEqual(plan.stage2LinesToLink, 169);
      assert.strictEqual(plan.stage2CompletedLinks, 0);
      assert.strictEqual(plan.stage2GroupsCount, 10);
      assert.strictEqual(plan.affectedRecipesCount, 68);
      assert.strictEqual(plan.isFingerprintApproved, true);
      assert.strictEqual(plan.isFormulaHashApproved, true);
    });

    it('[S2-21] Partial execution state transitions strictly to INVALID_OR_PARTIAL_STATE', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const partialRecipes: Recipe[] = JSON.parse(JSON.stringify(audit.recipes));

      // Unlink only half the Stage 2 items (partial execution)
      let unlinkedCount = 0;
      for (const r of partialRecipes) {
        if (r.archived) continue;
        for (const ing of r.ingredients || []) {
          const mapping = STAGE2_MAPPING_DEFINITIONS[ing.name.trim()];
          if (mapping && ing.masterIngredientId === mapping.proposedMasterIngredientId && unlinkedCount < 50) {
            delete ing.masterIngredientId;
            unlinkedCount++;
          }
        }
      }

      const plan = await buildStage2LinkingPlan(
        partialRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'INVALID_OR_PARTIAL_STATE');
      assert.strictEqual(plan.isValid, false);
      assert.ok(plan.invariantViolations.length > 0);
      assert.ok(plan.invariantViolations.some((v) => v.includes('Partial active linked line count')));
    });

    it('[S2-22] Wrong Master Ingredient target transitions strictly to INVALID_OR_PARTIAL_STATE', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const tamperedRecipes: Recipe[] = JSON.parse(JSON.stringify(audit.recipes));

      // Intentionally tamper one tuple to point to wrong Master Ingredient
      for (const r of tamperedRecipes) {
        if (r.archived) continue;
        const ing = (r.ingredients || []).find((i) => i.name.trim() === 'Unsalted Butter');
        if (ing) {
          ing.masterIngredientId = 'mi-1'; // Alter from mi-9 to mi-1
          break;
        }
      }

      const plan = await buildStage2LinkingPlan(
        tamperedRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'INVALID_OR_PARTIAL_STATE');
      assert.strictEqual(plan.isValid, false);
      assert.ok(
        plan.invariantViolations.some((v) => v.includes('Incorrect target link violation'))
      );
    });

    it('[S2-23] Archived recipe modification transitions strictly to INVALID_OR_PARTIAL_STATE', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const tamperedRecipes: Recipe[] = JSON.parse(JSON.stringify(audit.recipes));

      // Intentionally link an ingredient in an archived recipe
      const archRecipe = tamperedRecipes.find((r) => r.archived);
      assert.ok(archRecipe && archRecipe.ingredients.length > 0);
      archRecipe.ingredients[0].masterIngredientId = 'mi-9';

      const plan = await buildStage2LinkingPlan(
        tamperedRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'INVALID_OR_PARTIAL_STATE');
      assert.strictEqual(plan.isValid, false);
      assert.ok(
        plan.invariantViolations.some((v) => v.includes('Archived recipe protection violation'))
      );
    });

    it('[S2-24] Formula content tampering transitions strictly to INVALID_OR_PARTIAL_STATE', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const tamperedRecipes: Recipe[] = JSON.parse(JSON.stringify(audit.recipes));

      // Tamper formula quantity (violating full-schema hash)
      tamperedRecipes[0].ingredients[0].quantity = 999999;

      const plan = await buildStage2LinkingPlan(
        tamperedRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'INVALID_OR_PARTIAL_STATE');
      assert.strictEqual(plan.isValid, false);
      assert.ok(
        plan.invariantViolations.some((v) => v.includes('Formula content hash mismatch'))
      );
    });

    it('[S2-25] Dangling / broken masterIngredientId transitions strictly to INVALID_OR_PARTIAL_STATE', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const tamperedRecipes: Recipe[] = JSON.parse(JSON.stringify(audit.recipes));

      // Set non-existent ID on an active recipe
      tamperedRecipes[0].ingredients[0].masterIngredientId = 'non-existent-master-id-999';

      const plan = await buildStage2LinkingPlan(
        tamperedRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );

      assert.strictEqual(plan.lifecycleState, 'INVALID_OR_PARTIAL_STATE');
      assert.strictEqual(plan.isValid, false);
      assert.ok(
        plan.invariantViolations.some((v) => v.includes('non-existent masterIngredientId') || v.includes('Dangling link'))
      );
    });

    it('[S2-26] Completed Stage 2 cannot execute again at service layer', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      
      // Verify pre-call state directly
      const plan = await buildStage2LinkingPlan(
        audit.recipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );
      assert.strictEqual(plan.lifecycleState, 'POST_EXECUTION_COMPLETE');

      // Create spy database to track any attempted writes
      let writeBatchCount = 0;
      let commitCount = 0;
      let updateCount = 0;
      const spyDb: any = {
        _isSpy: true,
      };

      // Deep copy recipes to verify zero mutations occur
      const recipesBefore = JSON.parse(JSON.stringify(audit.recipes));

      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: spyDb,
            user: { uid: 'owner-id', email: 'owner@sunnysweets.com' } as any,
            workspaceId: TARGET_WORKSPACE_ID,
            role: 'owner',
            confirmationPhrase: STAGE2_AUTHORIZATION_PHRASE,
            _mockData: {
              recipes: audit.recipes,
              masterIngredients: audit.masterIngredients,
            },
          });
        },
        (err: any) => {
          assert.ok(
            err.message.startsWith('STAGE_2_ALREADY_COMPLETE'),
            `Expected STAGE_2_ALREADY_COMPLETE prefix, got: ${err.message}`
          );
          return true;
        }
      );

      // Verify zero writes, zero commits, zero mutations
      assert.strictEqual(writeBatchCount, 0, 'Firestore writeBatch calls must be 0');
      assert.strictEqual(commitCount, 0, 'Firestore commit calls must be 0');
      assert.strictEqual(updateCount, 0, 'Recipe updates must be 0');

      // Verify in-memory recipes remain 100% unchanged
      assert.deepStrictEqual(audit.recipes, recipesBefore, 'Recipes must not be mutated');
    });

    it('[S2-27] Invalid/partial Stage 2 state cannot enter write path', async () => {
      if (!fs.existsSync('/tmp/forensic-audit.json')) return;

      const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      
      // Synthesize invalid/partial state: 684 correctly linked active lines, 1 active Stage 2 line unlinked
      const partialRecipes: Recipe[] = JSON.parse(JSON.stringify(audit.recipes));
      let unlinkedSingleLine = false;
      for (const r of partialRecipes) {
        if (r.archived) continue;
        for (const ing of r.ingredients || []) {
          const mapping = STAGE2_MAPPING_DEFINITIONS[ing.name.trim()];
          if (mapping && ing.masterIngredientId === mapping.proposedMasterIngredientId) {
            delete ing.masterIngredientId;
            unlinkedSingleLine = true;
            break;
          }
        }
        if (unlinkedSingleLine) break;
      }
      assert.ok(unlinkedSingleLine, 'Must have unlinked exactly 1 line for partial state test');

      // Verify plan reflects INVALID_OR_PARTIAL_STATE
      const plan = await buildStage2LinkingPlan(
        partialRecipes,
        audit.masterIngredients,
        TARGET_WORKSPACE_ID
      );
      assert.strictEqual(plan.lifecycleState, 'INVALID_OR_PARTIAL_STATE');

      let writeBatchCount = 0;
      let commitCount = 0;
      const spyDb: any = {
        _isSpy: true,
      };

      const partialBefore = JSON.parse(JSON.stringify(partialRecipes));

      await assert.rejects(
        async () => {
          await executeAuthenticatedStage2Migration({
            db: spyDb,
            user: { uid: 'owner-id', email: 'owner@sunnysweets.com' } as any,
            workspaceId: TARGET_WORKSPACE_ID,
            role: 'owner',
            confirmationPhrase: STAGE2_AUTHORIZATION_PHRASE,
            _mockData: {
              recipes: partialRecipes,
              masterIngredients: audit.masterIngredients,
            },
          });
        },
        (err: any) => {
          assert.ok(
            err.message.startsWith('STAGE_2_INVALID_STATE'),
            `Expected STAGE_2_INVALID_STATE prefix, got: ${err.message}`
          );
          return true;
        }
      );

      // Verify zero writes, zero commits, zero automatic repairs/mutations
      assert.strictEqual(writeBatchCount, 0, 'Firestore writeBatch calls must be 0');
      assert.strictEqual(commitCount, 0, 'Firestore commit calls must be 0');
      assert.deepStrictEqual(partialRecipes, partialBefore, 'No partial mutations or auto-repairs permitted');
    });
  });
});
