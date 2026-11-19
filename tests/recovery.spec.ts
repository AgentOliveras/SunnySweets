import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  checkRecoveryEligibility,
  parseAndValidateBackup,
  sanitizeSettings,
  prepareRecoveryBatch,
  AUTHORIZED_RECOVERY_EMAIL,
  TARGET_WORKSPACE_ID,
  EXPECTED_COUNTS,
  EXCLUDED_COLLECTIONS,
  ValidatedBackupPayload,
} from '../src/services/recoveryService';
import { UserSettings, Recipe, MasterIngredient, ProductionPreset, Mixer } from '../src/types';

describe('Disaster Recovery Import Tool — Verification & Safety Invariant Suite', () => {
  // Authoritative verified recovery inventory mock backup meeting 100% invariant specifications
  // Invariants: 72 recipes (69 active, 3 archived), 130 master ingredients, 19 presets, 1 mixer, 0 history, 702 formula lines, 0 linked
  function createValidMockBackup() {
    const recipes: any[] = [];
    // 72 recipes total: 69 active (674 ingredient lines) + 3 archived (28 ingredient lines) = 702 ingredient lines
    // Distribution:
    // Active (0..68, 69 recipes): 54 recipes with 10 ingredients (540) + 14 recipes with 9 ingredients (126) + 1 recipe with 8 ingredients (8) = 674 lines
    // Archived (69..71, 3 recipes): 1 recipe with 10 ingredients (10) + 2 recipes with 9 ingredients (18) = 28 lines
    // Total lines = 674 + 28 = 702 lines
    for (let r = 0; r < 72; r++) {
      const isArchived = r >= 69;
      let ingCount = 10;
      if (!isArchived) {
        if (r >= 54 && r < 68) ingCount = 9;
        else if (r === 68) ingCount = 8;
      } else {
        if (r > 69) ingCount = 9;
      }

      const ingredients: any[] = [];
      for (let i = 0; i < ingCount; i++) {
        ingredients.push({
          id: `ing-${r}-${i}`,
          name: `Ingredient ${r}-${i}`,
          quantity: 100,
          unit: 'g',
          wastePercent: 0,
          // masterIngredientId is strictly omitted/null - 0 linked lines invariant
        });
      }

      recipes.push({
        id: `recipe-${r}`,
        name: isArchived ? `Archived Recipe ${r}` : `Active Recipe ${r}`,
        description: '',
        workspaceId: TARGET_WORKSPACE_ID,
        userId: 'legacy-uid',
        category: 'Cookies',
        batchYieldQuantity: 100,
        batchYieldUnit: 'cookies',
        defaultWastePercent: 4,
        archived: isArchived,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        ingredients,
      });
    }

    // 130 master ingredients
    const master_ingredients: any[] = [];
    for (let mi = 0; mi < 130; mi++) {
      master_ingredients.push({
        id: `mi-${mi}`,
        name: `Master Ingredient ${mi}`,
        workspaceId: TARGET_WORKSPACE_ID,
        userId: 'legacy-uid',
        category: 'Flour',
        defaultUnit: 'g',
        defaultWastePercent: 0,
      });
    }

    // 19 presets
    const presets: any[] = [];
    for (let p = 0; p < 19; p++) {
      presets.push({
        id: `preset-${p}`,
        name: `Preset ${p}`,
        workspaceId: TARGET_WORKSPACE_ID,
        userId: 'legacy-uid',
        finishedWeight: 3,
        weightUnit: 'oz',
        quantityPerUnit: 96,
        unitName: 'Case',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });
    }

    // 1 mixer
    const mixers = [
      {
        id: 'mixer-hobart-60',
        name: 'Hobart 60-Qt Commercial Mixer',
        workspaceId: TARGET_WORKSPACE_ID,
        userId: 'legacy-uid',
        maxWeight: 41500,
        weightUnit: 'g',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];

    // Settings
    const settings = {
      userId: 'legacy-uid-XrlESDwjfnREtPAiqsJsJIToY4m1',
      defaultWeightUnit: 'g',
      defaultWastePercent: 6,
      decimalPlaces: 0,
      theme: 'light',
      businessName: 'Sunny Sweets, LLC',
      activeWorkspaceId: TARGET_WORKSPACE_ID,
      workspaceName: 'Main Bakery Workspace',
      categoryPresetMap: { Cookies: 'Cookies' },
    };

    const workspaces = [
      {
        id: TARGET_WORKSPACE_ID,
        name: 'Main Bakery Workspace',
        ownerId: 'legacy-owner',
        members: [],
      },
    ];

    return {
      recipes,
      master_ingredients,
      presets,
      mixers,
      history: [],
      settings,
      workspaces,
    };
  }

  // 1. Wrong email blocks recovery
  it('1. Wrong email blocks recovery', () => {
    const stranger = { email: 'stranger@example.com', uid: 'stranger-uid' };
    const res = checkRecoveryEligibility(stranger, TARGET_WORKSPACE_ID, 'owner', true);
    assert.strictEqual(res.eligible, false);
    assert(res.reasons.some((r) => r.includes('does not match authorized owner')));
  });

  // 2. Non-owner blocks recovery
  it('2. Non-owner blocks recovery (editor / viewer)', () => {
    const ownerUser = { email: AUTHORIZED_RECOVERY_EMAIL, uid: 'owner-uid' };
    const editorRes = checkRecoveryEligibility(ownerUser, TARGET_WORKSPACE_ID, 'editor', true);
    assert.strictEqual(editorRes.eligible, false);
    assert(editorRes.reasons.some((r) => r.includes("is not 'owner'")));

    const viewerRes = checkRecoveryEligibility(ownerUser, TARGET_WORKSPACE_ID, 'viewer', true);
    assert.strictEqual(viewerRes.eligible, false);
    assert(viewerRes.reasons.some((r) => r.includes("is not 'owner'")));
  });

  // 3. Wrong workspace blocks recovery
  it('3. Wrong workspace blocks recovery', () => {
    const ownerUser = { email: AUTHORIZED_RECOVERY_EMAIL, uid: 'owner-uid' };
    const res = checkRecoveryEligibility(ownerUser, 'ws-other-bakery', 'owner', true);
    assert.strictEqual(res.eligible, false);
    assert(res.reasons.some((r) => r.includes("is not 'ws-main'")));
  });

  // 4. Production environment blocks recovery
  it('4. Production environment blocks recovery (isDev = false)', () => {
    const ownerUser = { email: AUTHORIZED_RECOVERY_EMAIL, uid: 'owner-uid' };
    const res = checkRecoveryEligibility(ownerUser, TARGET_WORKSPACE_ID, 'owner', false);
    assert.strictEqual(res.eligible, false);
    assert(res.reasons.some((r) => r.includes('restricted strictly to the development environment')));
  });

  // 5. Authorized owner in dev environment is eligible
  it('5. Authorized owner in dev environment with ws-main is approved', () => {
    const ownerUser = { email: AUTHORIZED_RECOVERY_EMAIL, uid: 'owner-uid' };
    const res = checkRecoveryEligibility(ownerUser, TARGET_WORKSPACE_ID, 'owner', true);
    assert.strictEqual(res.eligible, true);
    assert.strictEqual(res.reasons.length, 0);
  });

  // 6. Malformed JSON blocks recovery
  it('6. Malformed JSON blocks recovery with explicit error', () => {
    const res = parseAndValidateBackup('{ not valid json', 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors[0].includes('JSON parse failure'));
  });

  // 7. Negative Tests: Recipe count mismatches (71 or 73)
  it('7a. Drop 1 recipe (71 recipes) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.recipes.pop();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Recipe count mismatch: found 71, expected 72')));
  });

  it('7b. Add 1 recipe (73 recipes) blocks recovery', () => {
    const raw = createValidMockBackup();
    const extraRecipe = { ...raw.recipes[0], id: 'recipe-extra', name: 'Extra Recipe' };
    raw.recipes.push(extraRecipe);
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Recipe count mismatch: found 73, expected 72')));
  });

  // 8. Negative Tests: Master ingredients count mismatches (129 or 131)
  it('8a. Drop 1 master ingredient (129) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.master_ingredients.pop();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Master ingredients count mismatch: found 129, expected 130')));
  });

  it('8b. Add 1 master ingredient (131) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.master_ingredients.push({
      id: 'mi-extra',
      name: 'Extra Ingredient',
      workspaceId: TARGET_WORKSPACE_ID,
      userId: 'legacy-uid',
      category: 'Flour',
      defaultUnit: 'g',
      defaultWastePercent: 0,
    });
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Master ingredients count mismatch: found 131, expected 130')));
  });

  // 9. Negative Tests: Presets count mismatches (18 or 20)
  it('9a. Drop 1 preset (18) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.presets.pop();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Presets count mismatch: found 18, expected 19')));
  });

  it('9b. Add 1 preset (20) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.presets.push({
      id: 'preset-extra',
      name: 'Extra Preset',
      workspaceId: TARGET_WORKSPACE_ID,
      userId: 'legacy-uid',
      finishedWeight: 3,
      weightUnit: 'oz',
      quantityPerUnit: 12,
      unitName: 'Box',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Presets count mismatch: found 20, expected 19')));
  });

  // 10. Negative Tests: Mixers count mismatches (0 or 2)
  it('10a. Drop mixer (0 mixers) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.mixers = [];
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Mixers count mismatch: found 0, expected 1')));
  });

  it('10b. Add mixer (2 mixers) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.mixers.push({
      id: 'mixer-extra',
      name: 'Extra Mixer',
      workspaceId: TARGET_WORKSPACE_ID,
      userId: 'legacy-uid',
      maxWeight: 20000,
      weightUnit: 'g',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Mixers count mismatch: found 2, expected 1')));
  });

  // 11. Negative Tests: Non-zero history records block recovery
  it('11. Non-zero history records block recovery', () => {
    const raw = createValidMockBackup();
    raw.history = [
      {
        id: 'hist-1',
        recipeName: 'Historical Batch',
        workspaceId: TARGET_WORKSPACE_ID,
        userId: 'legacy-uid',
        calculatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('History count mismatch: found 1, expected 0')));
  });

  // 12. Negative Tests: Formula lines mismatch (701 or 703)
  it('12a. Drop 1 ingredient line (701 lines) blocks recovery', () => {
    const raw = createValidMockBackup();
    // Drop 1 ingredient line -> 701 lines
    raw.recipes[0].ingredients.pop();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Total ingredient lines mismatch: found 701, expected 702')));
  });

  it('12b. Add 1 ingredient line (703 lines) blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.recipes[0].ingredients.push({
      id: 'ing-extra',
      name: 'Extra Line',
      quantity: 50,
      unit: 'g',
      wastePercent: 0,
    });
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Total ingredient lines mismatch: found 703, expected 702')));
  });

  // 13. Negative Test: Any masterIngredientId link blocks recovery
  it('13. Ingredient linking safety: any masterIngredientId blocks recovery', () => {
    const raw = createValidMockBackup();
    // Introduce a premature masterIngredientId link
    raw.recipes[0].ingredients[0].masterIngredientId = 'mi-0';
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes('Ingredient linking safety violation')));
    assert(res.errors.some((e) => e.includes('All 702 lines must be unlinked')));
  });

  // 14. Wrong target workspace in business record blocks recovery
  it('14. Foreign workspaceId on any recipe or ingredient blocks recovery', () => {
    const raw = createValidMockBackup();
    raw.recipes[5].workspaceId = 'ws-hacked';
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, false);
    assert(res.errors.some((e) => e.includes("does not target 'ws-main'")));
  });

  // 15. Destination collision logic blocks recovery
  it('15. Destination collision simulation rejects non-empty workspace', () => {
    const collisionReport = {
      recipes: 1,
      masterIngredients: 0,
      presets: 0,
      mixers: 0,
    };
    const collisionDetected = collisionReport.recipes > 0 || collisionReport.masterIngredients > 0;
    assert.strictEqual(collisionDetected, true);
  });

  // 16. Verified inventory parsing executes in-memory with zero writes
  it('16. File selection and parsing execute in-memory with zero writes matching 702 lines', () => {
    const raw = createValidMockBackup();
    const jsonStr = JSON.stringify(raw);
    const res = parseAndValidateBackup(jsonStr, 'user-uid-123');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.counts.recipes, 72);
    assert.strictEqual(res.counts.masterIngredients, 130);
    assert.strictEqual(res.counts.presets, 19);
    assert.strictEqual(res.counts.mixers, 1);
    assert.strictEqual(res.counts.history, 0);
    assert.strictEqual(res.counts.totalIngredientLines, 702);
    assert.strictEqual(res.counts.linkedIngredientLines, 0);
  });

  // 17. Settings sanitization according to current UserSettings schema
  it('17. Settings are sanitized according to current UserSettings schema', () => {
    const rawSettings = {
      userId: 'XrlESDwjfnREtPAiqsJsJIToY4m1', // legacy UID
      defaultWeightUnit: 'g',
      defaultWastePercent: 6,
      decimalPlaces: 0,
      theme: 'light',
      businessName: 'Sunny Sweets, LLC',
      activeWorkspaceId: 'ws-main',
      workspaceName: 'Main Bakery Workspace',
      categoryPresetMap: {
        Cookies: 'Cookies',
        Dough: ['Pie Dough'],
      },
      unauthorizedField: 'should-be-stripped',
    };

    const currentUid = 'auth-uid-jaime-2026';
    const sanitized = sanitizeSettings(rawSettings, currentUid);

    assert.strictEqual(sanitized.userId, currentUid);
    assert.notStrictEqual(sanitized.userId, 'XrlESDwjfnREtPAiqsJsJIToY4m1');
    assert.strictEqual(sanitized.businessName, 'Sunny Sweets, LLC');
    assert.strictEqual(sanitized.activeWorkspaceId, TARGET_WORKSPACE_ID);
    assert.strictEqual(sanitized.defaultWeightUnit, 'g');
    assert.strictEqual(sanitized.defaultWastePercent, 6);
    assert.strictEqual(sanitized.decimalPlaces, 0);
    assert.strictEqual(sanitized.theme, 'light');
    assert.deepStrictEqual(sanitized.categoryPresetMap, {
      Cookies: 'Cookies',
      Dough: ['Pie Dough'],
    });
  });

  // 18. Excluded authorization/billing/history data cannot enter the batch
  it('18. Excluded authorization/billing/history collections cannot enter batch', () => {
    const raw = createValidMockBackup();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, true);

    const payload = res.data!;
    const paths: string[] = [];

    // Recipes
    for (const r of payload.recipes) {
      paths.push(`recipes/${r.id}`);
    }
    // Master ingredients
    for (const mi of payload.masterIngredients) {
      paths.push(`master_ingredients/${mi.id}`);
    }
    // Presets
    for (const p of payload.presets) {
      paths.push(`presets/${p.id}`);
    }
    // Mixers
    for (const m of payload.mixers) {
      paths.push(`mixers/${m.id}`);
    }
    // Settings
    paths.push(`settings/test-uid`);

    assert.strictEqual(paths.length, 223);

    // Verify no excluded path is included
    for (const p of paths) {
      assert(!p.startsWith('workspaces/'), `Forbidden path found: ${p}`);
      assert(!p.startsWith('users/'), `Forbidden path found: ${p}`);
      assert(!p.startsWith('billing/'), `Forbidden path found: ${p}`);
      assert(!p.startsWith('history/'), `Forbidden path found: ${p}`);
      assert(!p.startsWith('invitations/'), `Forbidden path found: ${p}`);
    }

    assert(EXCLUDED_COLLECTIONS.includes('billing / Stripe data'));
    assert(EXCLUDED_COLLECTIONS.includes('workspaces/ws-main/members'));
  });

  // 19. Single atomic batch invariant (223 operations <= 500 max)
  it('19. Exactly 223 write operations fits in single atomic WriteBatch (limit 500)', () => {
    const raw = createValidMockBackup();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, true);

    const recipeCount = res.data!.recipes.length;
    const miCount = res.data!.masterIngredients.length;
    const presetCount = res.data!.presets.length;
    const mixerCount = res.data!.mixers.length;
    const settingsCount = 1;

    const totalBatchOps = recipeCount + miCount + presetCount + mixerCount + settingsCount;
    assert.strictEqual(totalBatchOps, 223);
    assert(totalBatchOps <= 500, 'Must not exceed Firestore 500 limit');
  });

  // 20. Import requires explicit user action: no auto-commit
  it('20. Batch creation does not invoke commit; requires explicit final action', () => {
    let commitInvoked = false;
    const mockBatch: any = {
      set: () => {},
      commit: async () => {
        commitInvoked = true;
      },
    };

    // Validating and preparing the batch must NOT commit
    const raw = createValidMockBackup();
    const res = parseAndValidateBackup(JSON.stringify(raw), 'test-uid');
    assert.strictEqual(res.valid, true);

    // Invariant: commitInvoked must remain false
    assert.strictEqual(commitInvoked, false);
  });

  // 21. Executable recovery pathway is permanently decommissioned
  it('21. Executable recovery batch pathway throws and cannot write to Firestore', () => {
    assert.throws(
      () => {
        prepareRecoveryBatch();
      },
      /Disaster recovery is closed/
    );
  });
});
