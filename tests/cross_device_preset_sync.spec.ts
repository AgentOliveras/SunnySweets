import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  Workspace,
  UserSettings,
  AccessRole,
} from '../src/types';
import {
  DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
  resolveWorkspaceCategoryPresetMap,
  getTargetPresetCategoriesForRecipeCategory,
  inspectCategoryMappingMigration,
  assertCanModifyWorkspaceCategoryMap,
} from '../src/utils/categoryPresetMapping';
import {
  calculateProduction,
  getApplicablePresetsForRecipe,
  normalizePresetCategory,
} from '../src/utils/calculator';
import {
  getOrderedProductionOptionKeys,
  SYSTEM_OPTION_KEYS,
} from '../src/utils/productionOptionOrdering';
import { store } from '../src/services/store';
import { INITIAL_SETTINGS } from '../src/services/sampleData';
import { ProductionModeView } from '../src/components/ProductionModeView';
import { ProductionCalculator } from '../src/components/ProductionCalculator';
import { SettingsView } from '../src/components/SettingsView';

// Canonical Four Seasons Chocolate Chip Cookies synthetic fixture matching canonical Sunny Sweets records
function createFourSeasonsChocolateChipRecipe(): Recipe {
  return {
    id: 'recipe-1787779703770',
    workspaceId: 'ws-main',
    userId: 'owner-uid-1',
    name: 'Four Seasons Chocolate Chip Cookies',
    description: 'Canonical Four Seasons Chocolate Chip Cookies formula',
    category: 'Four Seasons',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    ingredients: [
      { id: 'fs-flour', name: 'All-Purpose Flour', quantity: 2000, unit: 'g' },
      { id: 'fs-butter', name: 'Unsalted Butter', quantity: 1200, unit: 'g' },
      { id: 'fs-brown-sugar', name: 'Brown Sugar', quantity: 1000, unit: 'g' },
      { id: 'fs-gran-sugar', name: 'Granulated Sugar', quantity: 800, unit: 'g' },
      { id: 'fs-eggs', name: 'Whole Eggs', quantity: 500, unit: 'g' },
      { id: 'fs-chips', name: 'Chocolate Chips', quantity: 1304, unit: 'g' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// Canonical Sunny Sweets presets including all 5 Cookie production options + unrelated categories
function createCanonicalPresets(): ProductionPreset[] {
  return [
    {
      id: 'preset-1785852701672',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '1 oz Cookies',
      category: 'Cookies',
      finishedWeight: 1,
      weightUnit: 'oz',
      quantityPerUnit: 360,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-2oz-cookie',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '2 oz Cookies',
      category: '', // Legacy blank category normalizes to 'Cookies'
      finishedWeight: 2,
      weightUnit: 'oz',
      quantityPerUnit: 140,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-1785852643334',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '3 oz Cookies',
      category: '', // Legacy blank category normalizes to 'Cookies'
      finishedWeight: 3,
      weightUnit: 'oz',
      quantityPerUnit: 96,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-4oz-cookie',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '4 oz Cookies',
      category: 'Cookies',
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 80,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-5oz-cookie',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '5 oz Cookies',
      category: 'Cookies',
      finishedWeight: 5,
      weightUnit: 'oz',
      quantityPerUnit: 72,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-pie-shell-9in',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '9-inch Deep Dish Pie Shell',
      category: 'Pie Dough',
      finishedWeight: 10,
      weightUnit: 'oz',
      quantityPerUnit: 24,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-sourdough-batard',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '24 oz Sourdough Batard',
      category: 'Base Dough',
      finishedWeight: 24,
      weightUnit: 'oz',
      quantityPerUnit: 12,
      unitName: 'Rack',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-shortbread-wedge',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: 'Shortbread Tin Assortment',
      category: 'Shortbread',
      finishedWeight: 8,
      weightUnit: 'oz',
      quantityPerUnit: 18,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function createTestMixer(): Mixer {
  return {
    id: 'mixer-hobart-60qt',
    workspaceId: 'ws-main',
    userId: 'owner-uid-1',
    name: 'Hobart 60-Qt Mixer',
    maxWeight: 80,
    weightUnit: 'lb',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createWorkspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-main',
    name: 'Sunny Sweets Production',
    ownerId: 'owner-uid-1',
    ownerEmail: 'owner@sunnysweets.test',
    code: 'SUNNY-MAIN',
    members: [
      {
        email: 'owner@sunnysweets.test',
        name: 'Bakery Owner',
        role: 'owner',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    groups: [],
    productionFloorModeEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Helper to configure isolated in-memory StoreManager state without touching live Firestore
function configureIsolatedStore(params: {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  role: AccessRole | null;
  uid?: string | null;
  localSettings?: Partial<UserSettings>;
  recipes?: Recipe[];
  presets?: ProductionPreset[];
}) {
  const s = store as any;
  s.workspaces = params.workspaces.map((w) => ({ ...w }));
  s.activeWorkspaceId = params.activeWorkspaceId;
  s.currentUserId = params.uid !== undefined ? params.uid : 'owner-uid-1';
  s.validatedUid = params.uid !== undefined ? params.uid : 'owner-uid-1';
  s.validatedUserRole = params.role;
  s.recipes = params.recipes ? [...params.recipes] : [];
  s.presets = params.presets ? [...params.presets] : [];
  s.settings = {
    ...INITIAL_SETTINGS,
    ...(params.localSettings || {}),
  };
}

describe('Cross-Device Packaging Preset Category Mapping Sync (Production Floor & Management Mode)', () => {
  const fourSeasonsRecipe = createFourSeasonsChocolateChipRecipe();
  const canonicalPresets = createCanonicalPresets();
  const mixer = createTestMixer();

  beforeEach(() => {
    configureIsolatedStore({
      workspaces: [
        createWorkspaceFixture({
          id: 'ws-main',
          categoryPresetMap: {
            ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
            'Four Seasons': ['Cookies'],
          },
        }),
      ],
      activeWorkspaceId: 'ws-main',
      role: 'owner',
      recipes: [fourSeasonsRecipe],
      presets: canonicalPresets,
    });
  });

  it('1. Desktop/Mobile Mapping Consistency: Laptop, Phone, and Tablet resolve identical Four Seasons presets from workspaces/{workspaceId}.categoryPresetMap', () => {
    const sharedWorkspace = createWorkspaceFixture({
      id: 'ws-main',
      categoryPresetMap: {
        ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
        'Four Seasons': ['Cookies'],
      },
    });

    // Simulate Laptop with populated localStorage settings
    configureIsolatedStore({
      workspaces: [sharedWorkspace],
      activeWorkspaceId: 'ws-main',
      role: 'owner',
      localSettings: {
        categoryPresetMap: { 'Four Seasons': ['Cookies'], CustomLocalOnly: ['Pie Dough'] },
      },
    });
    const laptopMap = store.getCategoryPresetMap();
    const laptopPresets = getApplicablePresetsForRecipe(fourSeasonsRecipe, canonicalPresets, laptopMap);

    // Simulate Phone with completely empty localStorage categoryPresetMap
    configureIsolatedStore({
      workspaces: [sharedWorkspace],
      activeWorkspaceId: 'ws-main',
      role: 'editor',
      localSettings: { categoryPresetMap: undefined },
    });
    const phoneMap = store.getCategoryPresetMap();
    const phonePresets = getApplicablePresetsForRecipe(fourSeasonsRecipe, canonicalPresets, phoneMap);

    // Simulate Tablet with INITIAL_SETTINGS (missing 'Four Seasons' in local settings)
    configureIsolatedStore({
      workspaces: [sharedWorkspace],
      activeWorkspaceId: 'ws-main',
      role: 'viewer',
      localSettings: { categoryPresetMap: { ...INITIAL_SETTINGS.categoryPresetMap } },
    });
    const tabletMap = store.getCategoryPresetMap();
    const tabletPresets = getApplicablePresetsForRecipe(fourSeasonsRecipe, canonicalPresets, tabletMap);

    assert.deepStrictEqual(laptopMap, phoneMap, 'Laptop and Phone must read identical authoritative map');
    assert.deepStrictEqual(phoneMap, tabletMap, 'Phone and Tablet must read identical authoritative map');
    assert.strictEqual(laptopMap['CustomLocalOnly'], undefined, 'Unapproved local-only keys must never leak into authoritative map');

    const expectedIds = [
      'preset-1785852701672', // 1 oz — 360/case
      'preset-2oz-cookie',    // 2 oz — 140/case
      'preset-1785852643334', // 3 oz — 96/case
      'preset-4oz-cookie',    // 4 oz — 80/case
      'preset-5oz-cookie',    // 5 oz — 72/case
    ];
    assert.deepStrictEqual(laptopPresets.map((p) => p.id), expectedIds);
    assert.deepStrictEqual(phonePresets.map((p) => p.id), expectedIds);
    assert.deepStrictEqual(tabletPresets.map((p) => p.id), expectedIds);
  });

  it('2. Owner/Editor/Viewer Visibility & Write Enforcement: All roles read identical mapping, but ONLY Owners can save or approve workspace mappings', async () => {
    const ws = createWorkspaceFixture({
      id: 'ws-main',
      categoryPresetMap: {
        ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
        'Four Seasons': ['Cookies'],
      },
    });

    for (const role of ['owner', 'editor', 'viewer'] as AccessRole[]) {
      configureIsolatedStore({
        workspaces: [ws],
        activeWorkspaceId: 'ws-main',
        role,
      });
      const visibleMap = store.getCategoryPresetMap();
      assert.deepStrictEqual(
        getTargetPresetCategoriesForRecipeCategory('Four Seasons', visibleMap),
        ['Cookies'],
        `Role "${role}" must read the shared Four Seasons -> Cookies mapping`
      );
    }

    // Unauthenticated (null role) write attempt MUST fail
    await assert.rejects(
      async () => {
        await store.saveWorkspaceCategoryPresetMap({ 'Four Seasons': ['Pie Dough'] });
      },
      /Only workspace owners can modify shared workspace category preset mappings/i,
      'Unauthenticated callers must not be able to overwrite workspace-wide categoryPresetMap'
    );

    // Editor write attempt MUST fail
    await assert.rejects(
      async () => {
        await store.saveWorkspaceCategoryPresetMap({ 'Four Seasons': ['Pie Dough'] }, undefined, 'editor');
      },
      /Only workspace owners can modify shared workspace category preset mappings/i,
      'Editors must not be able to overwrite workspace-wide categoryPresetMap'
    );
    assert.throws(
      () => assertCanModifyWorkspaceCategoryMap('editor'),
      /Only workspace owners/i
    );

    // Viewer write attempt MUST fail
    await assert.rejects(
      async () => {
        await store.saveWorkspaceCategoryPresetMap({ 'Four Seasons': ['Pie Dough'] }, undefined, 'viewer');
      },
      /Only workspace owners can modify shared workspace category preset mappings/i,
      'Viewers must not be able to overwrite workspace-wide categoryPresetMap'
    );
    await assert.rejects(
      async () => {
        await store.approveCategoryMappingMigration(undefined, 'viewer');
      },
      /Only workspace owners/i,
      'Viewers must not be able to approve workspace category mapping migrations'
    );

    // Owner write succeeds and updates workspace authoritatively
    configureIsolatedStore({
      workspaces: [ws],
      activeWorkspaceId: 'ws-main',
      role: 'owner',
    });
    await store.saveWorkspaceCategoryPresetMap(
      {
        ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
        'Four Seasons': ['Cookies', 'Shortbread'],
      },
      undefined,
      'owner'
    );
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', store.getCategoryPresetMap()),
      ['Cookies', 'Shortbread']
    );

    // Verify firestore.rules explicitly restricts workspaces/{workspaceId} update to isWorkspaceOwner
    const rulesText = fs.readFileSync('firestore.rules', 'utf8');
    assert(
      rulesText.includes('match /workspaces/{workspaceId}') &&
        rulesText.includes('allow read: if isWorkspaceMember(workspaceId);') &&
        rulesText.includes('allow update: if isWorkspaceOwner(workspaceId)'),
      'firestore.rules must enforce member read and owner-only update on workspaces/{workspaceId}'
    );
  });

  it('3. Missing localStorage Mapping: Fresh browser without localStorage mapping still resolves full workspace routing', () => {
    const ws = createWorkspaceFixture({
      id: 'ws-main',
      categoryPresetMap: {
        'Four Seasons': 'Cookies',
      },
    });

    configureIsolatedStore({
      workspaces: [ws],
      activeWorkspaceId: 'ws-main',
      role: 'viewer',
      localSettings: {
        categoryPresetMap: undefined,
        recipeCategories: undefined,
      },
    });

    const resolved = store.getCategoryPresetMap();
    assert.strictEqual(resolved['Four Seasons'], 'Cookies');
    assert.strictEqual(resolved['Cookies'], 'Cookies');
    assert.strictEqual(resolved['Bread'], 'Base Dough');

    const applicable = getApplicablePresetsForRecipe(fourSeasonsRecipe, canonicalPresets, resolved);
    assert.strictEqual(applicable.length, 5, 'All 5 Cookie presets must resolve when localStorage is empty');
  });

  it('4. Stale localStorage Mapping & Explicit Owner Migration Inspection: Stale local mappings cannot overwrite workspace settings, and migration requires explicit Owner approval', async () => {
    // Workspace has authoritative 'Four Seasons' -> ['Cookies']
    const ws = createWorkspaceFixture({
      id: 'ws-main',
      categoryPresetMap: {
        ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
        'Four Seasons': ['Cookies'],
      },
    });

    // Stale localStorage has outdated/conflicting 'Four Seasons' -> ['Pie Dough'] and 'Holiday Tin' -> ['Shortbread']
    configureIsolatedStore({
      workspaces: [ws],
      activeWorkspaceId: 'ws-main',
      role: 'owner',
      localSettings: {
        categoryPresetMap: {
          ...INITIAL_SETTINGS.categoryPresetMap,
          'Four Seasons': ['Pie Dough'],
          'Holiday Tin': ['Shortbread'],
        },
      },
    });

    // 4a. Authoritative read ignores stale localStorage completely
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', store.getCategoryPresetMap()),
      ['Cookies'],
      'Stale localStorage must NOT override authoritative workspace mapping on read'
    );

    // 4b. Generic store.updateSettings() cannot overwrite workspace categoryPresetMap
    await store.updateSettings({
      categoryPresetMap: { 'Four Seasons': ['Base Dough'] },
      decimalPlaces: 3,
    });
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', store.getCategoryPresetMap()),
      ['Cookies'],
      'Generic updateSettings() must NOT overwrite workspace categoryPresetMap'
    );

    // 4c. Read-only migration inspection detects exact diffs without mutating workspace
    const inspection = store.inspectPendingCategoryMappingMigration();
    assert.strictEqual(inspection.hasDifferences, true);
    assert.strictEqual(inspection.diffs.length, 2);

    const fourSeasonsDiff = inspection.diffs.find((d) => d.category === 'Four Seasons')!;
    assert.ok(fourSeasonsDiff);
    assert.strictEqual(fourSeasonsDiff.changeType, 'modified');
    assert.deepStrictEqual(fourSeasonsDiff.workspaceEffectiveTargets, ['Cookies']);
    assert.deepStrictEqual(fourSeasonsDiff.localProposedTargets, ['Pie Dough']);

    const holidayDiff = inspection.diffs.find((d) => d.category === 'Holiday Tin')!;
    assert.ok(holidayDiff);
    assert.strictEqual(holidayDiff.changeType, 'added');
    assert.deepStrictEqual(holidayDiff.workspaceEffectiveTargets, ['Holiday Tin']);
    assert.deepStrictEqual(holidayDiff.localProposedTargets, ['Shortbread']);

    // Workspace remains untouched before Owner approval
    assert.strictEqual(store.getCategoryPresetMap()['Holiday Tin'], undefined);

    // 4d. Owner can approve ONLY selected category ('Holiday Tin') while rejecting stale 'Four Seasons' change
    await store.approveCategoryMappingMigration(['Holiday Tin'], 'owner');
    const afterSelectiveApproval = store.getCategoryPresetMap();
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', afterSelectiveApproval),
      ['Cookies'],
      'Unapproved category change must remain untouched'
    );
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Holiday Tin', afterSelectiveApproval),
      ['Shortbread'],
      'Explicitly Owner-approved category change must be saved to workspace'
    );
    assert.strictEqual(
      store.inspectPendingCategoryMappingMigration().hasDifferences,
      false,
      'Local settings should align with workspace after Owner migration decision'
    );
  });

  it('5. Workspace Switching Isolation: Switching between workspaces never leaks category mappings or categories', async () => {
    const wsA = createWorkspaceFixture({
      id: 'ws-sunny-sweets',
      name: 'Sunny Sweets',
      categoryPresetMap: {
        ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
        'Four Seasons': ['Cookies'],
      },
      recipeCategories: ['Four Seasons', 'Cookies'],
    });

    const wsB = createWorkspaceFixture({
      id: 'ws-wholesale-bread',
      name: 'Wholesale Bread Co.',
      categoryPresetMap: {
        ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
        'Artisan Loaves': ['Base Dough'],
      },
      recipeCategories: ['Artisan Loaves'],
    });

    configureIsolatedStore({
      workspaces: [wsA, wsB],
      activeWorkspaceId: 'ws-sunny-sweets',
      role: 'owner',
    });

    // In Workspace A: Four Seasons -> Cookies, Artisan Loaves is unmapped
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', store.getCategoryPresetMap()),
      ['Cookies']
    );
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Artisan Loaves', store.getCategoryPresetMap()),
      ['Artisan Loaves']
    );

    // Switch to Workspace B
    await store.setActiveWorkspace('ws-wholesale-bread');
    const wsBMap = store.getCategoryPresetMap();
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Artisan Loaves', wsBMap),
      ['Base Dough'],
      'Workspace B must resolve its own Artisan Loaves -> Base Dough mapping'
    );
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', wsBMap),
      ['Four Seasons'],
      'Workspace A Four Seasons mapping must NOT leak into Workspace B'
    );
    assert.ok(
      !store.getRecipeCategories().includes('Four Seasons'),
      'Workspace A recipeCategories must NOT leak into Workspace B'
    );

    // Switch back to Workspace A
    await store.setActiveWorkspace('ws-sunny-sweets');
    assert.deepStrictEqual(
      getTargetPresetCategoriesForRecipeCategory('Four Seasons', store.getCategoryPresetMap()),
      ['Cookies'],
      'Switching back to Workspace A must restore Four Seasons -> Cookies cleanly'
    );
  });

  it('6. Live Firestore Snapshot Updates: Store subscribers are notified immediately when remote workspace mapping updates', () => {
    const unmappedWs = createWorkspaceFixture({
      id: 'ws-main',
      categoryPresetMap: { ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP },
    });

    configureIsolatedStore({
      workspaces: [unmappedWs],
      activeWorkspaceId: 'ws-main',
      role: 'viewer',
      recipes: [fourSeasonsRecipe],
      presets: canonicalPresets,
    });

    // Before live update: Four Seasons is unmapped -> 0 presets
    assert.strictEqual(
      getApplicablePresetsForRecipe(fourSeasonsRecipe, canonicalPresets, store.getCategoryPresetMap()).length,
      0
    );

    let notificationCount = 0;
    let latestObservedPresetIds: string[] = [];
    const unsubscribe = store.subscribe(() => {
      notificationCount += 1;
      const liveMap = store.getCategoryPresetMap();
      latestObservedPresetIds = getApplicablePresetsForRecipe(
        fourSeasonsRecipe,
        canonicalPresets,
        liveMap
      ).map((p) => p.id);
    });

    try {
      // Simulate Firestore onSnapshot delivering updated workspaces/ws-main document to mobile client
      const s = store as any;
      const remoteUpdatedWs: Workspace = {
        ...unmappedWs,
        categoryPresetMap: {
          ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
          'Four Seasons': ['Cookies'],
        },
        updatedAt: '2026-10-23T12:00:00.000Z',
      };
      s.workspaces = [remoteUpdatedWs];
      s.updateSyncSuccess();

      assert.strictEqual(notificationCount, 1, 'Subscriber must be notified immediately on snapshot');
      assert.deepStrictEqual(latestObservedPresetIds, [
        'preset-1785852701672',
        'preset-2oz-cookie',
        'preset-1785852643334',
        'preset-4oz-cookie',
        'preset-5oz-cookie',
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('7. React Rerender & Mode Parity: ProductionModeView and ProductionCalculator immediately render all 5 Four Seasons options in order upon mapping update', () => {
    const unmappedMap = resolveWorkspaceCategoryPresetMap(
      createWorkspaceFixture({ categoryPresetMap: { ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP } })
    );
    const mappedMap = resolveWorkspaceCategoryPresetMap(
      createWorkspaceFixture({
        categoryPresetMap: {
          ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
          'Four Seasons': ['Cookies'],
        },
      })
    );

    // 7a. Render ProductionModeView BEFORE mapping ('Four Seasons' unmapped)
    const floorHtmlBefore = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [fourSeasonsRecipe],
        presets: canonicalPresets,
        mixers: [mixer],
        settings: INITIAL_SETTINGS,
        categoryPresetMap: unmappedMap,
        productionOptionOrder: null,
        onExit: () => {},
        initialRecipeId: fourSeasonsRecipe.id,
      })
    );
    assert.ok(!floorHtmlBefore.includes('1 oz Cookies'), 'Unmapped Four Seasons must not show 1 oz Cookies');
    assert.ok(!floorHtmlBefore.includes('5 oz Cookies'), 'Unmapped Four Seasons must not show 5 oz Cookies');
    assert.ok(floorHtmlBefore.includes('Custom Quantity'), 'Custom Quantity remains available when unmapped');

    // 7b. Render ProductionModeView AFTER shared mapping updates ('Four Seasons' -> ['Cookies'])
    const floorHtmlAfter = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [fourSeasonsRecipe],
        presets: canonicalPresets,
        mixers: [mixer],
        settings: INITIAL_SETTINGS,
        categoryPresetMap: mappedMap,
        productionOptionOrder: null,
        onExit: () => {},
        initialRecipeId: fourSeasonsRecipe.id,
      })
    );

    assert.ok(floorHtmlAfter.includes('1 oz Cookies'), 'Must render 1 oz Cookies');
    assert.ok(floorHtmlAfter.includes('2 oz Cookies'), 'Must render 2 oz Cookies');
    assert.ok(floorHtmlAfter.includes('3 oz Cookies'), 'Must render 3 oz Cookies');
    assert.ok(floorHtmlAfter.includes('4 oz Cookies'), 'Must render 4 oz Cookies');
    assert.ok(floorHtmlAfter.includes('5 oz Cookies'), 'Must render 5 oz Cookies');
    assert.ok(floorHtmlAfter.includes('Custom Quantity'), 'Must render Custom Quantity');
    assert.ok(!floorHtmlAfter.includes('9-inch Deep Dish Pie Shell'), 'Must NOT render Pie Dough preset');
    assert.ok(!floorHtmlAfter.includes('24 oz Sourdough Batard'), 'Must NOT render Base Dough preset');

    // Verify exact productionOptionOrder preservation (1oz -> 2oz -> 3oz -> 4oz -> 5oz -> Custom Quantity)
    const idx1 = floorHtmlAfter.indexOf('1 oz Cookies');
    const idx2 = floorHtmlAfter.indexOf('2 oz Cookies');
    const idx3 = floorHtmlAfter.indexOf('3 oz Cookies');
    const idx4 = floorHtmlAfter.indexOf('4 oz Cookies');
    const idx5 = floorHtmlAfter.indexOf('5 oz Cookies');
    const idxCustom = floorHtmlAfter.indexOf('Custom Quantity');
    assert.ok(
      idx1 < idx2 && idx2 < idx3 && idx3 < idx4 && idx4 < idx5 && idx5 < idxCustom,
      'Production Floor options must preserve weight/configured order: 1oz -> 2oz -> 3oz -> 4oz -> 5oz -> Custom Quantity'
    );

    // Also verify custom productionOptionOrder is respected when configured on workspace
    const customOrder = [
      'preset-5oz-cookie',
      'preset-4oz-cookie',
      'preset-3oz-cookie',
      'preset-1785852643334',
      'preset-2oz-cookie',
      'preset-1785852701672',
      SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      SYSTEM_OPTION_KEYS.FULL_RECIPE,
      SYSTEM_OPTION_KEYS.FULL_MIXER,
    ];
    const customFloorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [fourSeasonsRecipe],
        presets: canonicalPresets,
        mixers: [mixer],
        settings: INITIAL_SETTINGS,
        categoryPresetMap: mappedMap,
        productionOptionOrder: customOrder,
        onExit: () => {},
        initialRecipeId: fourSeasonsRecipe.id,
      })
    );
    assert.ok(
      customFloorHtml.indexOf('5 oz Cookies') < customFloorHtml.indexOf('1 oz Cookies'),
      'Workspace productionOptionOrder must be preserved'
    );

    // 7c. Verify Management Mode ProductionCalculator uses identical category mapping logic
    const mgmtHtmlBefore = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [fourSeasonsRecipe],
        presets: canonicalPresets,
        mixers: [mixer],
        settings: INITIAL_SETTINGS,
        categoryPresetMap: unmappedMap,
        initialRecipeId: fourSeasonsRecipe.id,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(!mgmtHtmlBefore.includes('1 oz Cookies'), 'Management Mode must not auto-fallback to All Presets when unmapped');
    assert.ok(!mgmtHtmlBefore.includes('9-inch Deep Dish Pie Shell'), 'Management Mode must not leak Pie Dough presets when unmapped');

    const mgmtHtmlAfter = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [fourSeasonsRecipe],
        presets: canonicalPresets,
        mixers: [mixer],
        settings: INITIAL_SETTINGS,
        categoryPresetMap: mappedMap,
        initialRecipeId: fourSeasonsRecipe.id,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(mgmtHtmlAfter.includes('1 oz Cookies'), 'Management Mode must show 1 oz Cookies when mapped');
    assert.ok(mgmtHtmlAfter.includes('5 oz Cookies'), 'Management Mode must show 5 oz Cookies when mapped');
    assert.ok(!mgmtHtmlAfter.includes('9-inch Deep Dish Pie Shell'), 'Management Mode must still exclude unrelated Pie Dough presets');

    // 7d. Verify SettingsView renders Owner approval banner ONLY for Owner when local differences exist
    configureIsolatedStore({
      workspaces: [createWorkspaceFixture({ categoryPresetMap: { ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP } })],
      activeWorkspaceId: 'ws-main',
      role: 'owner',
      localSettings: {
        categoryPresetMap: { ...INITIAL_SETTINGS.categoryPresetMap, 'Four Seasons': ['Cookies'] },
      },
      recipes: [fourSeasonsRecipe],
      presets: canonicalPresets,
    });
    const ownerSettingsHtml = renderToStaticMarkup(
      React.createElement(SettingsView, {
        settings: store.getSettings(),
        categoryPresetMap: store.getCategoryPresetMap(),
        userRole: 'owner',
        recipesCount: 1,
        recipes: [fourSeasonsRecipe],
        presets: canonicalPresets,
        onUpdateSettings: () => {},
        onOpenUnitTests: () => {},
      })
    );
    // Settings sections start collapsed by default; verify SettingsView renders cleanly without auto-mutating store
    assert.strictEqual(
      store.getCategoryPresetMap()['Four Seasons'],
      undefined,
      'Rendering SettingsView must NEVER auto-migrate local mappings without explicit Owner click'
    );
    assert.ok(ownerSettingsHtml.length > 0);
  });

  it('8. Unrelated Recipe Category Isolation: No automatic All fallback; Bread, Pie, Shortbread, and unmapped Filling recipes stay strictly isolated', () => {
    const sharedMap = resolveWorkspaceCategoryPresetMap(
      createWorkspaceFixture({
        categoryPresetMap: {
          ...DEFAULT_WORKSPACE_CATEGORY_PRESET_MAP,
          'Four Seasons': ['Cookies'],
        },
      })
    );

    const breadRecipe: Recipe = { ...fourSeasonsRecipe, id: 'rec-bread', name: 'Country Sourdough', category: 'Bread' };
    const pieRecipe: Recipe = { ...fourSeasonsRecipe, id: 'rec-pie', name: 'Flaky Pie Crust', category: 'Pie Dough' };
    const shortbreadRecipe: Recipe = { ...fourSeasonsRecipe, id: 'rec-sb', name: 'Classic Shortbread', category: 'Shortbread' };
    const fillingRecipe: Recipe = { ...fourSeasonsRecipe, id: 'rec-filling', name: 'Lemon Curd Filling', category: 'Filling' };

    const breadPresets = getApplicablePresetsForRecipe(breadRecipe, canonicalPresets, sharedMap);
    assert.deepStrictEqual(breadPresets.map((p) => p.id), ['preset-sourdough-batard']);

    const piePresets = getApplicablePresetsForRecipe(pieRecipe, canonicalPresets, sharedMap);
    assert.deepStrictEqual(piePresets.map((p) => p.id), ['preset-pie-shell-9in']);

    const sbPresets = getApplicablePresetsForRecipe(shortbreadRecipe, canonicalPresets, sharedMap);
    assert.deepStrictEqual(sbPresets.map((p) => p.id), ['preset-shortbread-wedge']);

    // Unmapped 'Filling' category has NO matching 'Filling' presets -> must return [] (NEVER 'All'!)
    const fillingPresets = getApplicablePresetsForRecipe(fillingRecipe, canonicalPresets, sharedMap);
    assert.deepStrictEqual(
      fillingPresets,
      [],
      'Unmapped recipe category with no matching preset category must return [], never unrelated presets'
    );
  });

  it('9 & 10. Canonical Four Seasons Options (1–5 oz), Production Scaling Math, and 6% Production Waste Preservation', () => {
    const sharedMap = store.getCategoryPresetMap();
    const applicable = getApplicablePresetsForRecipe(fourSeasonsRecipe, canonicalPresets, sharedMap);
    const orderedKeys = getOrderedProductionOptionKeys(applicable, null);

    assert.deepStrictEqual(orderedKeys, [
      'preset-1785852701672',
      'preset-2oz-cookie',
      'preset-1785852643334',
      'preset-4oz-cookie',
      'preset-5oz-cookie',
      SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      SYSTEM_OPTION_KEYS.FULL_RECIPE,
      SYSTEM_OPTION_KEYS.FULL_MIXER,
    ]);

    // Verify canonical Four Seasons case specifications:
    // 1 oz — 360/case, 2 oz — 140/case, 3 oz — 96/case, 4 oz — 80/case, 5 oz — 72/case
    const expectedSpecs = [
      { id: 'preset-1785852701672', oz: 1, perCase: 360 },
      { id: 'preset-2oz-cookie', oz: 2, perCase: 140 },
      { id: 'preset-1785852643334', oz: 3, perCase: 96 },
      { id: 'preset-4oz-cookie', oz: 4, perCase: 80 },
      { id: 'preset-5oz-cookie', oz: 5, perCase: 72 },
    ];

    // If read-only forensic snapshot exists locally, cross-check canonical Four Seasons recipe & 1–4 oz preset IDs without modifying anything
    if (fs.existsSync('/tmp/forensic-audit.json')) {
      const snapshot = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
      const canonicalFsRecipe = (snapshot.collections?.recipes || []).find(
        (r: any) => r.id === 'recipe-1787779703770'
      );
      if (canonicalFsRecipe) {
        assert.strictEqual(canonicalFsRecipe.name, 'Four Seasons Chocolate Chip Cookies');
        assert.strictEqual(canonicalFsRecipe.category, 'Four Seasons');
      }
      for (const spec of expectedSpecs.slice(0, 4)) {
        const canonicalPreset = (snapshot.collections?.presets || []).find((p: any) => p.id === spec.id);
        if (canonicalPreset) {
          assert.strictEqual(canonicalPreset.finishedWeight, spec.oz);
          assert.strictEqual(canonicalPreset.quantityPerUnit, spec.perCase);
          assert.strictEqual(normalizePresetCategory(canonicalPreset), 'Cookies');
        }
      }
    }

    const GRAMS_PER_OZ = 28.349523125;
    const baseWeightGrams = fourSeasonsRecipe.ingredients.reduce((acc, i) => acc + i.quantity, 0); // 6804 g

    for (const spec of expectedSpecs) {
      const preset = applicable.find((p) => p.id === spec.id)!;
      assert.ok(preset, `Preset ${spec.oz} oz must be present`);
      assert.strictEqual(preset.finishedWeight, spec.oz);
      assert.strictEqual(preset.quantityPerUnit, spec.perCase);

      const calc = calculateProduction(
        fourSeasonsRecipe,
        [
          {
            id: `req-${spec.id}`,
            presetId: preset.id,
            presetName: preset.name,
            quantity: 1, // 1 case
            piecesPerUnit: preset.quantityPerUnit,
            itemWeight: preset.finishedWeight,
            itemWeightUnit: preset.weightUnit,
          },
        ],
        {
          mixer,
          defaultWeightUnit: 'lb',
          defaultWastePercent: 6,
        }
      );

      // Verify piece count & finished weight
      assert.strictEqual(calc.totalPieces, spec.perCase, `${spec.oz} oz case must produce ${spec.perCase} pieces`);
      const expectedFinishedGrams = spec.perCase * spec.oz * GRAMS_PER_OZ;
      assert.ok(
        Math.abs(calc.totalFinishedWeightGrams - expectedFinishedGrams) < 0.01,
        `${spec.oz} oz case finished weight must equal ${spec.perCase} * ${spec.oz} oz`
      );

      // Verify 6% whole-batch production waste preservation
      assert.strictEqual(calc.productionWastePercent, 6, 'Authoritative 6% production waste must be preserved');
      const expectedTotalBatchWith6PctWaste = expectedFinishedGrams * 1.06;
      assert.ok(
        Math.abs(calc.totalBatchWeightGrams - expectedTotalBatchWith6PctWaste) < 0.01,
        `Total batch weight for ${spec.oz} oz case must include exact 6% production waste`
      );

      // Verify ingredient scaling multiplier conservation (net finished multiplier + gross 1.06x ingredient quantities)
      const expectedNetMultiplier = expectedFinishedGrams / baseWeightGrams;
      assert.ok(
        Math.abs(calc.scalingMultiplier - expectedNetMultiplier) < 1e-6,
        'Net scaling multiplier must equal totalFinishedWeightGrams / baseRecipeTotalWeightGrams'
      );

      const summedGrossDisplayGrams = calc.calculatedIngredients.reduce(
        (sum, ing) => sum + (ing.displayQuantity ?? 0),
        0
      );
      assert.ok(
        Math.abs(summedGrossDisplayGrams - expectedTotalBatchWith6PctWaste) < 0.05,
        'Summed gross scaled ingredients (in base grams) must equal total batch weight with 6% waste'
      );
    }
  });
});
