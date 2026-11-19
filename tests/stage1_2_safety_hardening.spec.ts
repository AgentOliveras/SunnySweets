import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CalculationResult,
  CriticalProductionNote,
  Mixer,
  ProductionHistoryEntry,
  ProductionItemRequirement,
  ProductionPreset,
  Recipe,
} from '../src/types';
import {
  CryptoProviderLike,
  InsecureUuidUnavailableError,
  PresetCreationConflictError,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_NOTES_UNACKNOWLEDGED_EXPORT_MESSAGE,
  canProceedToMixWithSyncSafety,
  generateCollisionResistantPresetId,
  generateCryptographicallySecureUuidV4,
  isSafetySignatureAcknowledged,
  resolveApplicableSafetyInstructions,
} from '../src/utils/productionNotes';
import { createNewPresetEditorState } from '../src/utils/presetEditorState';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  LEGACY_LOCAL_CRITICAL_NOTES_KEY,
  StorageLike,
} from '../src/utils/criticalNotesReconciliation';
import { calculateProduction } from '../src/utils/calculator';
import { exportProductionSheetPDF } from '../src/utils/pdfExport';
import { INITIAL_SETTINGS } from '../src/services/sampleData';
import { PresetCloudPersistenceAdapter, store } from '../src/services/store';
import { ProductionModeView } from '../src/components/ProductionModeView';
import { GuidedMixingMode } from '../src/components/GuidedMixingMode';
import { ProductionCalculator } from '../src/components/ProductionCalculator';
import { PresetManager } from '../src/components/PresetManager';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class IsolatedPresetsCloud {
  private docs = new Map<string, ProductionPreset>();
  public createCalls = 0;
  public transactCalls = 0;
  public deleteCalls = 0;

  constructor(initialDocs: ProductionPreset[] = []) {
    for (const d of initialDocs) {
      this.docs.set(d.id, structuredClone(d));
    }
  }

  public getTotalMutations(): number {
    return this.createCalls + this.transactCalls + this.deleteCalls;
  }

  public getDoc(id: string): ProductionPreset | null {
    const found = this.docs.get(id);
    return found ? structuredClone(found) : null;
  }

  public createAdapter(activeWorkspaceResolver: () => string): PresetCloudPersistenceAdapter {
    return {
      createPreset: async (preset: ProductionPreset) => {
        this.createCalls += 1;
        const activeWs = activeWorkspaceResolver();
        if (!preset.workspaceId || preset.workspaceId !== activeWs) {
          throw new Error('Workspace mismatch in createPreset');
        }
        if (this.docs.has(preset.id)) {
          throw new PresetCreationConflictError(
            `Document presets/${preset.id} already exists.`,
            preset.id
          );
        }
        const stored = structuredClone(preset);
        this.docs.set(stored.id, stored);
        return structuredClone(stored);
      },
      transactPreset: async (presetId, mutator) => {
        this.transactCalls += 1;
        const existing = this.docs.get(presetId);
        if (!existing) {
          throw new Error(`Missing document presets/${presetId}`);
        }
        const next = mutator(structuredClone(existing));
        this.docs.set(presetId, structuredClone(next));
        return structuredClone(next);
      },
      deletePreset: async (presetId: string) => {
        this.deleteCalls += 1;
        if (!this.docs.has(presetId)) {
          throw new Error(`Missing document presets/${presetId}`);
        }
        this.docs.delete(presetId);
      },
    };
  }
}

const WS_MAIN = 'ws-main';

const SAMPLE_MIXERS: Mixer[] = [
  {
    id: 'mixer-hobart-60',
    workspaceId: WS_MAIN,
    userId: 'uid-owner',
    name: 'Hobart 60 Qt',
    maxWeight: 80,
    weightUnit: 'lb',
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
  },
];

function makeBaseRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'rec-choc-chip',
    workspaceId: WS_MAIN,
    userId: 'uid-owner',
    name: 'Chocolate Chip Cookie',
    description:
      'RECIPE-WIDE ALLERGEN RULE: Fold semi-sweet chips on Speed 1 for 25 seconds max.',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    ingredients: [
      { id: 'ing-flour', name: 'Pastry Flour', quantity: 10, unit: 'lb' },
      { id: 'ing-butter', name: 'Unsalted Butter', quantity: 6, unit: 'lb' },
      { id: 'ing-sugar', name: 'Granulated Sugar', quantity: 5, unit: 'lb' },
      { id: 'ing-chips', name: 'Chocolate Chips', quantity: 4, unit: 'lb' },
    ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
    ...overrides,
  };
}

function makePreset1oz(criticalNotes?: CriticalProductionNote[]): ProductionPreset {
  return {
    id: 'preset-cookie-1oz',
    workspaceId: WS_MAIN,
    userId: 'uid-owner',
    name: '1 oz Cookie Case',
    category: 'Cookies',
    finishedWeight: 1,
    weightUnit: 'oz',
    quantityPerUnit: 120,
    unitName: 'Case',
    criticalNotes:
      criticalNotes ?? [
        {
          id: 'note-1oz-choc',
          presetId: 'preset-cookie-1oz',
          recipeId: 'rec-choc-chip',
          workspaceId: WS_MAIN,
          note: 'PRESET RULE (1 OZ): Use mini chocolate chips ONLY; chill dough to 38°F before scooping.',
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
          createdBy: 'uid-owner',
        },
      ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
  };
}

function makePreset3oz(criticalNotes: CriticalProductionNote[] = []): ProductionPreset {
  return {
    id: 'preset-cookie-3oz',
    workspaceId: WS_MAIN,
    userId: 'uid-owner',
    name: '3 oz Jumbo Cookie Case',
    category: 'Cookies',
    finishedWeight: 3,
    weightUnit: 'oz',
    quantityPerUnit: 48,
    unitName: 'Case',
    criticalNotes,
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
  };
}

function buildRequirement(preset: ProductionPreset, cases = 1): ProductionItemRequirement {
  return {
    id: `req-${preset.id}`,
    presetId: preset.id,
    presetName: preset.name,
    quantity: cases,
    piecesPerUnit: preset.quantityPerUnit,
    itemWeight: preset.finishedWeight,
    itemWeightUnit: preset.weightUnit,
  };
}

function calcBatch(recipe: Recipe, presetsWithCounts: Array<{ preset: ProductionPreset; count: number }>): CalculationResult {
  const reqs = presetsWithCounts.map((item) => buildRequirement(item.preset, item.count));
  return calculateProduction(recipe, reqs, {
    mixer: SAMPLE_MIXERS[0],
    overrideWastePercent: 6,
    defaultWeightUnit: 'lb',
  });
}

function makeHistoryEntry(id: string, calc: CalculationResult): ProductionHistoryEntry {
  return {
    id,
    workspaceId: WS_MAIN,
    userId: 'uid-owner',
    recipeId: calc.recipe.id,
    recipeName: calc.recipe.name,
    calculatedAt: '2026-03-01T10:00:00.000Z',
    requirements: calc.requirements,
    totalPieces: calc.totalPieces,
    totalFinishedWeightGrams: calc.totalFinishedWeightGrams,
    displayBatchWeight: calc.displayBatchWeight,
    displayWeightUnit: calc.displayWeightUnit,
    scalingMultiplier: calc.scalingMultiplier,
    wastePercent: 6,
    mixerName: SAMPLE_MIXERS[0].name,
    mixerMaxWeight: SAMPLE_MIXERS[0].maxWeight,
    mixerWeightUnit: SAMPLE_MIXERS[0].weightUnit,
    capacityExceeded: calc.isCapacityExceeded,
    capacityOverridden: calc.capacityOverridden,
    suggestedBatches: calc.suggestedBatches,
    calculatedIngredients: calc.calculatedIngredients,
    status: 'completed',
    completedAt: '2026-03-01T10:05:00.000Z',
  };
}

function seedProtectedDesktopLocalNote(storage: MemoryStorage): string {
  const payload = JSON.stringify([
    {
      id: 'local-original-1oz-note',
      presetId: 'preset-cookie-1oz',
      recipeId: 'rec-choc-chip',
      workspaceId: WS_MAIN,
      note: 'ORIGINAL DESKTOP NOTE: Do not lose 1 oz mini chip requirement.',
      createdAt: '2026-01-15T09:30:00.000Z',
      updatedAt: '2026-01-15T09:30:00.000Z',
    },
  ]);
  storage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, payload);
  return payload;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Stage 1.2 — Final Production Safety Hardening (Isolated Mocks & Fixtures)', () => {
  let memoryStorage: MemoryStorage;
  let cloud: IsolatedPresetsCloud;

  beforeEach(() => {
    memoryStorage = new MemoryStorage();
    cloud = new IsolatedPresetsCloud([makePreset1oz(), makePreset3oz()]);
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => store.getActiveWorkspaceId() || WS_MAIN),
      historySaveAdapter: null,
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz(), makePreset3oz()],
      history: [],
      recipesSyncError: null,
      presetsSyncError: null,
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      recipesConnectionVerified: true,
      presetsConnectionVerified: true,
      safetyRetryDelaysMs: null,
      listenerRestartHook: null,
      accessValidator: null,
      presetCryptoOverride: undefined,
    });
  });

  afterEach(() => {
    store.configureCriticalNotesTestHarness({
      session: null,
      storage: null,
      cloudAdapter: null,
      historySaveAdapter: null,
      recipes: [],
      presets: [],
      history: [],
      recipesSyncError: null,
      presetsSyncError: null,
      safetyRetryDelaysMs: null,
      listenerRestartHook: null,
      accessValidator: null,
      presetCryptoOverride: undefined,
    });
  });

  // ===========================================================================
  // SCENARIO 1: recipes listener error -> manual retry -> server-confirmed recovery
  // ===========================================================================
  it('1. recovers from recipes listener error via manual store.retrySafetySync() only after server-confirmed snapshots', async () => {
    const restartedGenerations: Array<{ generation: number; workspaceId: string }> = [];
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => store.getActiveWorkspaceId() || WS_MAIN),
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [60_000],
      listenerRestartHook: (generation, workspaceId) => {
        restartedGenerations.push({ generation, workspaceId });
      },
    });

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_error',
      error: new Error('Firestore internal stream closed (recipes)'),
    });

    assert.strictEqual(store.getRecipesHydrationState(), 'ERROR');
    assert.strictEqual(store.getSafetyOperationalGateState(), 'ERROR');
    assert.strictEqual(store.isSafetyRetryScheduled(), true);
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Reconnecting');

    // Existing recipes & presets preserved in memory; zero Firestore writes
    assert.strictEqual(store.getRecipes().length, 1);
    assert.strictEqual(store.getPresets().length, 1);
    assert.strictEqual(cloud.getTotalMutations(), 0);

    // Operator clicks "Retry Safety Sync"
    const restarted = await store.retrySafetySync();
    assert.strictEqual(restarted, true);
    assert.strictEqual(restartedGenerations.length, 1);
    assert.strictEqual(restartedGenerations[0].workspaceId, WS_MAIN);
    assert.strictEqual(store.isSafetyRetryScheduled(), false);
    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
    assert.strictEqual(store.getSafetyOperationalGateState(), 'INITIAL_LOADING');
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Reconnecting');

    // Cache-only snapshot during retry MUST NOT unlock production
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [makeBaseRecipe()],
      fromCache: true,
      hasDocChanges: true,
    });
    assert.notStrictEqual(store.getSafetyOperationalGateState(), 'READY');

    // Authoritative server-confirmed snapshots arrive for both collections
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [makeBaseRecipe()],
      fromCache: false,
      hasDocChanges: true,
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'INITIAL_LOADING');

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: [makePreset1oz()],
      fromCache: false,
      hasDocChanges: true,
    });

    assert.strictEqual(store.getRecipesHydrationState(), 'READY');
    assert.strictEqual(store.getPresetsHydrationState(), 'READY');
    assert.strictEqual(store.isSafetyConnectionVerified(), true);
    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Safety Sync Ready');
    assert.strictEqual(cloud.getTotalMutations(), 0);
  });

  // ===========================================================================
  // SCENARIO 2: presets listener error -> manual retry -> server-confirmed recovery
  // ===========================================================================
  it('2. recovers from presets listener error via manual store.retrySafetySync() and renders Retry Safety Sync buttons in all 3 views', async () => {
    let restartCount = 0;
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [], // no auto-retries so status immediately reflects Safety Sync Failed
      listenerRestartHook: () => {
        restartCount += 1;
      },
    });

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      error: new Error('Firestore permission or transport failure (presets)'),
    });

    assert.strictEqual(store.getPresetsHydrationState(), 'ERROR');
    assert.strictEqual(store.getSafetyOperationalGateState(), 'ERROR');
    assert.strictEqual(store.isSafetyRetryScheduled(), false);
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Safety Sync Failed');

    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const calc = calcBatch(recipe, [{ preset: presets[0], count: 1 }]);

    const prodHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        criticalNotesSyncError: store.getCriticalNotesSyncError(),
        connectionVerified: store.isSafetyConnectionVerified(),
        isReconnecting: store.isSafetyReconnectingState(),
        activeWorkspaceId: WS_MAIN,
        initialRecipeId: recipe.id,
        initialPresetQuantitiesForTest: { 'preset-cookie-1oz': 1 },
        onExit: () => {},
      })
    );
    assert.ok(prodHtml.includes('id="btn-prod-retry-safety-sync"'));
    assert.ok(prodHtml.includes('Retry Safety Sync'));
    assert.ok(prodHtml.includes('Safety Sync Failed'));
    assert.ok(!prodHtml.includes('Retrying'));

    const guidedHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation: calc,
        recipes: [recipe],
        presets,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        criticalNotesSyncError: store.getCriticalNotesSyncError(),
        connectionVerified: store.isSafetyConnectionVerified(),
        isReconnecting: store.isSafetyReconnectingState(),
        activeWorkspaceId: WS_MAIN,
        onExit: () => {},
      })
    );
    assert.ok(guidedHtml.includes('id="btn-guided-retry-safety-sync"'));
    assert.ok(guidedHtml.includes('Retry Safety Sync'));
    assert.ok(guidedHtml.includes('Safety Sync Failed'));
    assert.ok(!guidedHtml.includes('Retrying'));

    const calcHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        criticalNotesSyncError: store.getCriticalNotesSyncError(),
        connectionVerified: store.isSafetyConnectionVerified(),
        isReconnecting: store.isSafetyReconnectingState(),
        activeWorkspaceId: WS_MAIN,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(calcHtml.includes('id="btn-calc-retry-safety-sync"'));
    assert.ok(calcHtml.includes('Retry Safety Sync'));
    assert.ok(calcHtml.includes('Safety Sync Failed'));
    assert.ok(!calcHtml.includes('Retrying'));

    const ok = await store.retrySafetySync();
    assert.strictEqual(ok, true);
    assert.strictEqual(restartCount, 1);

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [recipe],
      fromCache: false,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets,
      fromCache: false,
    });

    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Safety Sync Ready');
  });

  // ===========================================================================
  // SCENARIO 3: Automatic bounded backoff retry and exhaustion
  // ===========================================================================
  it('3. executes bounded exponential-backoff retries with at most one active sequence and stops cleanly on exhaustion', async () => {
    const attempts: number[] = [];

    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [15, 25], // 2 bounded attempts max
      listenerRestartHook: (generation) => {
        attempts.push(generation);
        store.simulateFirestoreSnapshotForTesting({
          event: 'presets_error',
          generation,
          error: new Error(`Persistent network error on gen ${generation}`),
        });
      },
    });

    // Fire BOTH recipes and presets errors simultaneously to prove only ONE retry timer is scheduled
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_error',
      error: new Error('Simultaneous recipes failure'),
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      error: new Error('Simultaneous presets failure'),
    });

    assert.strictEqual(store.isSafetyRetryScheduled(), true);
    assert.strictEqual(store.getSafetyRetryAttemptCount(), 1);
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Reconnecting');

    const deadline = Date.now() + 2500;
    while (
      (attempts.length < 2 || store.isSafetyRetryScheduled()) &&
      Date.now() < deadline
    ) {
      await waitMs(20);
    }
    // Wait an additional settle window to prove no extra retry fires after exhaustion
    await waitMs(60);

    assert.strictEqual(attempts.length, 2, 'Exactly 2 bounded auto-retry attempts must run');
    assert.strictEqual(store.isSafetyRetryScheduled(), false, 'No further retry timer after exhaustion');
    assert.strictEqual(store.isSafetyReconnectingState(), false);
    assert.strictEqual(store.getSafetyOperationalGateState(), 'ERROR');
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Safety Sync Failed');
    assert.strictEqual(store.getSyncStatus().message, 'Safety Sync Failed');
  });

  // ===========================================================================
  // SCENARIO 4: Retry cancellation on sign-out and workspace switch
  // ===========================================================================
  it('4. cancels scheduled safety retries immediately on sign-out and on workspace switch', async () => {
    let restartInvocations = 0;
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [30],
      listenerRestartHook: () => {
        restartInvocations += 1;
      },
    });

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      error: new Error('Transient error before sign-out'),
    });
    assert.strictEqual(store.isSafetyRetryScheduled(), true);

    store.simulateFirestoreSnapshotForTesting({
      event: 'auth_change',
      nextUid: null,
    });
    assert.strictEqual(store.isSafetyRetryScheduled(), false);

    await waitMs(55);
    assert.strictEqual(restartInvocations, 0, 'Retry must not fire after sign-out');

    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [30],
      listenerRestartHook: () => {
        restartInvocations += 1;
      },
    });

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_error',
      error: new Error('Transient error before workspace switch'),
    });
    assert.strictEqual(store.isSafetyRetryScheduled(), true);

    store.simulateFirestoreSnapshotForTesting({
      event: 'workspace_switch',
      workspaceId: 'ws-secondary',
    });
    assert.strictEqual(store.isSafetyRetryScheduled(), false);

    await waitMs(55);
    assert.strictEqual(restartInvocations, 0, 'Retry must not fire after workspace switch');
  });

  // ===========================================================================
  // SCENARIO 5: Stale listener generation callback rejection
  // ===========================================================================
  it('5. rejects stale snapshot and error callbacks from previous listener generations after retrySafetySync()', async () => {
    let latestGen = 0;
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [],
      listenerRestartHook: (gen) => {
        latestGen = gen;
      },
    });

    const staleGeneration = store.getListenerGenerationForTesting();

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      generation: staleGeneration,
      error: new Error('Initial listener terminated'),
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'ERROR');

    await store.retrySafetySync();
    assert.ok(latestGen > staleGeneration);

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      generation: staleGeneration,
      recipes: [makeBaseRecipe()],
      fromCache: false,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      generation: staleGeneration,
      presets: [makePreset1oz()],
      fromCache: false,
    });
    assert.strictEqual(
      store.getSafetyOperationalGateState(),
      'INITIAL_LOADING',
      'Stale generation snapshots must never mark new generation READY'
    );

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      generation: latestGen,
      recipes: [makeBaseRecipe()],
      fromCache: false,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      generation: latestGen,
      presets: [makePreset1oz()],
      fromCache: false,
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      generation: staleGeneration,
      error: new Error('Delayed stale error callback'),
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');
  });

  // ===========================================================================
  // SCENARIO 6: Cache-only startup remains blocked (INITIAL_LOADING)
  // ===========================================================================
  it('6. keeps startup in INITIAL_LOADING when only cached snapshots (fromCache: true) have arrived', () => {
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      recipes: [],
      presets: [],
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'LOADING',
    });

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [makeBaseRecipe()],
      fromCache: true,
      hasDocChanges: true,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: [makePreset1oz()],
      fromCache: true,
      hasDocChanges: true,
    });

    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
    assert.strictEqual(store.isSafetyConnectionVerified(), false);
    assert.strictEqual(store.getSafetyOperationalGateState(), 'INITIAL_LOADING');
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Connecting');
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: true,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        connectionVerified: store.isSafetyConnectionVerified(),
        syncError: store.getCriticalNotesSyncError(),
      }),
      false
    );
  });

  // ===========================================================================
  // SCENARIO 7: Cache-only metadata event after READY enters CONNECTION_UNVERIFIED
  //             without wiping progress or acknowledged signature
  // ===========================================================================
  it('7. transitions from READY to CONNECTION_UNVERIFIED on mid-batch Wi-Fi drop without wiping operator progress or acknowledgedSafetySignature, while blocking new actions', async () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const calc = calcBatch(recipe, [{ preset: presets[0], count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets,
      fromCache: true,
      hasDocChanges: false,
    });

    assert.strictEqual(store.getRecipesHydrationState(), 'READY');
    assert.strictEqual(store.getPresetsHydrationState(), 'READY');
    assert.strictEqual(store.isSafetyConnectionVerified(), false);
    assert.strictEqual(store.getSafetyOperationalGateState(), 'CONNECTION_UNVERIFIED');
    assert.strictEqual(store.getSafetySyncStatusLabel(), 'Reconnecting');

    // Verify batch history logging is blocked during CONNECTION_UNVERIFIED
    const blockedEntry = makeHistoryEntry('hist-wifi-drop', calc);
    await assert.rejects(
      () => store.saveHistoryEntry(blockedEntry),
      (err: Error) => err.message === SAFETY_CONNECTION_UNVERIFIED_MESSAGE
    );

    // ProductionModeView: preserves acknowledged signature & visible checked ingredient rows in read-only hold
    const prodHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        criticalNotesSyncError: store.getCriticalNotesSyncError(),
        connectionVerified: store.isSafetyConnectionVerified(),
        isReconnecting: store.isSafetyReconnectingState(),
        activeWorkspaceId: WS_MAIN,
        initialRecipeId: recipe.id,
        initialPresetQuantitiesForTest: { 'preset-cookie-1oz': 1 },
        initialAcknowledgedSignatureForTest: safety.signature,
        initialCheckedIngredientsForTest: { 'ing-flour': true },
        onExit: () => {},
      })
    );
    assert.ok(prodHtml.includes('id="prod-connection-unverified-banner"'));
    assert.ok(prodHtml.includes(SAFETY_CONNECTION_UNVERIFIED_MESSAGE));
    assert.ok(prodHtml.includes('Pastry Flour'), 'Visible ingredient checklist preserved');
    assert.ok(prodHtml.includes('(1 / 4 scaled)'), 'Checked progress preserved');
    assert.ok(prodHtml.includes('REVIEWED'), 'Acknowledged safety signature preserved');

    // GuidedMixingMode: preserves completed ingredient progress & acknowledged signature while blocking check-offs/completion
    const guidedHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation: calc,
        recipes: [recipe],
        presets,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        criticalNotesSyncError: store.getCriticalNotesSyncError(),
        connectionVerified: store.isSafetyConnectionVerified(),
        isReconnecting: store.isSafetyReconnectingState(),
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        initialCompletedIdsForTest: ['ing-flour', 'ing-butter'],
        onExit: () => {},
      })
    );
    assert.ok(guidedHtml.includes('id="guided-connection-unverified-banner"'));
    assert.ok(guidedHtml.includes('50%'), 'Completed ingredient progress (2 of 4 = 50%) preserved');
    assert.ok(guidedHtml.includes('REVIEWED'), 'Acknowledged safety signature preserved');

    // ProductionCalculator: preserves visible checklist progress & acknowledged signature while disabling Export PDF & Save History
    const calcHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        criticalNotesSyncError: store.getCriticalNotesSyncError(),
        connectionVerified: store.isSafetyConnectionVerified(),
        isReconnecting: store.isSafetyReconnectingState(),
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        initialCheckedIngredientsForTest: { 'ing-flour': true },
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(calcHtml.includes('id="calc-connection-unverified-banner"'));
    assert.ok(calcHtml.includes('id="calc-ing-row-ing-flour"'), 'Visible checklist table preserved');
    assert.ok(calcHtml.includes('REVIEWED'), 'Acknowledged safety signature preserved');
    assert.match(calcHtml, /id="calc-export-pdf-btn"[^>]*disabled=""/);
    assert.match(calcHtml, /id="calc-save-history-btn"[^>]*disabled=""/);
  });

  // ===========================================================================
  // SCENARIO 8: Unchanged safety signature resumes automatically after reconnection
  // ===========================================================================
  it('8. resumes mixing automatically when BOTH recipes and presets reconnect with unchanged Critical Production Notes signature', () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const initialSafety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });
    const operatorAckSignature = initialSafety.signature;

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [recipe],
      fromCache: true,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets,
      fromCache: true,
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'CONNECTION_UNVERIFIED');

    // Reconnect ONLY recipes first -> must remain CONNECTION_UNVERIFIED until presets is also server-confirmed
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [recipe],
      fromCache: false,
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'CONNECTION_UNVERIFIED');

    // Reconnect presets with unchanged notes -> operational state returns to READY and prior signature remains valid
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets,
      fromCache: false,
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');
    assert.strictEqual(store.isSafetyConnectionVerified(), true);

    const reconnectedSafety = resolveApplicableSafetyInstructions({
      recipe: store.getRecipes()[0],
      presets: store.getPresets(),
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });
    assert.strictEqual(
      isSafetySignatureAcknowledged(reconnectedSafety.signature, operatorAckSignature),
      true,
      'Unchanged signature remains acknowledged automatically'
    );
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: reconnectedSafety.hasSafetyNotes,
        isAcknowledged: isSafetySignatureAcknowledged(
          reconnectedSafety.signature,
          operatorAckSignature
        ),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        connectionVerified: store.isSafetyConnectionVerified(),
        syncError: store.getCriticalNotesSyncError(),
      }),
      true
    );
  });

  // ===========================================================================
  // SCENARIO 9: Changed safety signature requires re-acknowledgment after reconnection
  // ===========================================================================
  it('9. invalidates prior acknowledgment and requires re-review when Critical Production Notes changed during Wi-Fi interruption', () => {
    const recipe = makeBaseRecipe();
    const initialPresets = [makePreset1oz()];
    const initialSafety = resolveApplicableSafetyInstructions({
      recipe,
      presets: initialPresets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });
    const operatorAckSignature = initialSafety.signature;

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: initialPresets,
      fromCache: true,
    });
    assert.strictEqual(store.getSafetyOperationalGateState(), 'CONNECTION_UNVERIFIED');

    const updatedPresets = [
      makePreset1oz([
        {
          id: 'note-1oz-choc',
          presetId: 'preset-cookie-1oz',
          recipeId: 'rec-choc-chip',
          workspaceId: WS_MAIN,
          note: 'UPDATED PRESET RULE (1 OZ): Chill dough to 35°F and use allergen-free scoop #40.',
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-03-15T14:22:00.000Z',
        },
      ]),
    ];

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: updatedPresets,
      fromCache: false,
      hasDocChanges: true,
    });

    assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');
    const reconnectedSafety = resolveApplicableSafetyInstructions({
      recipe: store.getRecipes()[0],
      presets: store.getPresets(),
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    assert.notStrictEqual(reconnectedSafety.signature, operatorAckSignature);
    assert.strictEqual(
      isSafetySignatureAcknowledged(reconnectedSafety.signature, operatorAckSignature),
      false,
      'Modified note signature must invalidate prior acknowledgment'
    );
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: reconnectedSafety.hasSafetyNotes,
        isAcknowledged: isSafetySignatureAcknowledged(
          reconnectedSafety.signature,
          operatorAckSignature
        ),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        connectionVerified: store.isSafetyConnectionVerified(),
        syncError: store.getCriticalNotesSyncError(),
      }),
      false,
      'Mixing must remain blocked until updated note is re-acknowledged'
    );
  });

  // ===========================================================================
  // SCENARIO 10: ProductionCalculator blocks ingredient check-off before note approval
  // ===========================================================================
  it('10. gates the operational scaled ingredient checklist in ProductionCalculator behind Critical Production Note acknowledgment', () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const calc = calcBatch(recipe, [{ preset: presets[0], count: 2 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const unackHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        connectionVerified: true,
        criticalNotesSyncError: null,
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: null,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(unackHtml.includes('id="calc-checklist-safety-gate"'));
    assert.ok(!unackHtml.includes('id="calc-ing-row-ing-flour"'));
    assert.ok(!unackHtml.includes('<table'));

    const ackHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        connectionVerified: true,
        criticalNotesSyncError: null,
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(!ackHtml.includes('id="calc-checklist-safety-gate"'));
    assert.ok(ackHtml.includes('id="calc-ing-row-ing-flour"'));
    assert.ok(ackHtml.includes('<table'));
  });

  // ===========================================================================
  // SCENARIO 11: ProductionCalculator disables Export PDF before note approval
  // ===========================================================================
  it('11. disables Export PDF in ProductionCalculator until all applicable Critical Production Notes are acknowledged', () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const calc = calcBatch(recipe, [{ preset: presets[0], count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const unackHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        connectionVerified: true,
        criticalNotesSyncError: null,
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: null,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.match(unackHtml, /id="calc-export-pdf-btn"[^>]*disabled=""/);

    const ackHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        connectionVerified: true,
        criticalNotesSyncError: null,
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.doesNotMatch(ackHtml, /id="calc-export-pdf-btn"[^>]*disabled=""/);
  });

  // ===========================================================================
  // SCENARIO 12: ProductionCalculator disables Export PDF during LOADING, CONNECTION_UNVERIFIED, and ERROR
  // ===========================================================================
  it('12. disables Export PDF in ProductionCalculator during INITIAL_LOADING, CONNECTION_UNVERIFIED, and ERROR even if previously acknowledged', () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const calc = calcBatch(recipe, [{ preset: presets[0], count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const loadingHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'LOADING',
        presetsHydrationState: 'READY',
        connectionVerified: false,
        criticalNotesSyncError: null,
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.match(loadingHtml, /id="calc-export-pdf-btn"[^>]*disabled=""/);

    const unverifiedHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        connectionVerified: false,
        criticalNotesSyncError: null,
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.match(unverifiedHtml, /id="calc-export-pdf-btn"[^>]*disabled=""/);

    const errorHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [recipe],
        presets,
        mixers: SAMPLE_MIXERS,
        settings: INITIAL_SETTINGS,
        initialRecipeId: recipe.id,
        initialCalculation: calc,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'ERROR',
        connectionVerified: false,
        criticalNotesSyncError: 'Firestore listener terminated',
        activeWorkspaceId: WS_MAIN,
        initialAcknowledgedSignatureForTest: safety.signature,
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.match(errorHtml, /id="calc-export-pdf-btn"[^>]*disabled=""/);
  });

  // ===========================================================================
  // SCENARIO 13: Direct exportProductionSheetPDF() call fails when safety requirements are not met
  // ===========================================================================
  it('13. throws inside exportProductionSheetPDF() itself when called during INITIAL_LOADING, CONNECTION_UNVERIFIED, ERROR, or without note acknowledgment', () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz()];
    const calc = calcBatch(recipe, [{ preset: presets[0], count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    assert.throws(
      () =>
        exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
          recipesHydrationState: 'LOADING',
          presetsHydrationState: 'READY',
          connectionVerified: false,
          syncError: null,
          recipes: [recipe],
          presets,
          activeWorkspaceId: WS_MAIN,
          acknowledgedSafetySignature: safety.signature,
          skipDownload: true,
        }),
      (err: Error) => err.message === SAFETY_HYDRATION_LOADING_MESSAGE
    );

    assert.throws(
      () =>
        exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: false,
          syncError: null,
          recipes: [recipe],
          presets,
          activeWorkspaceId: WS_MAIN,
          acknowledgedSafetySignature: safety.signature,
          skipDownload: true,
        }),
      (err: Error) => err.message === SAFETY_CONNECTION_UNVERIFIED_MESSAGE
    );

    assert.throws(
      () =>
        exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
          recipesHydrationState: 'READY',
          presetsHydrationState: 'ERROR',
          connectionVerified: false,
          syncError: 'Listener disconnected',
          recipes: [recipe],
          presets,
          activeWorkspaceId: WS_MAIN,
          acknowledgedSafetySignature: safety.signature,
          skipDownload: true,
        }),
      (err: Error) => err.message === SAFETY_HYDRATION_ERROR_MESSAGE
    );

    assert.throws(
      () =>
        exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          syncError: null,
          recipes: [recipe],
          presets,
          activeWorkspaceId: WS_MAIN,
          acknowledgedSafetySignature: null,
          skipDownload: true,
        }),
      (err: Error) => err.message === SAFETY_NOTES_UNACKNOWLEDGED_EXPORT_MESSAGE
    );

    const historyEntry = makeHistoryEntry('hist-1', calc);
    assert.throws(
      () =>
        exportProductionSheetPDF(historyEntry, 'Sunny Sweets', 2, {
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          syncError: null,
          recipes: [recipe],
          presets,
          activeWorkspaceId: WS_MAIN,
          acknowledgedSafetySignature: 'stale-signature',
          skipDownload: true,
        }),
      (err: Error) => err.message === SAFETY_NOTES_UNACKNOWLEDGED_EXPORT_MESSAGE
    );
  });

  // ===========================================================================
  // SCENARIO 14: PDF includes Recipe-Wide Critical Production Notes
  // ===========================================================================
  it('14. renders Recipe-Wide Critical Production Notes with explicit scope label in the exported PDF', () => {
    const recipe = makeBaseRecipe({
      description: 'RECIPE-WIDE ONLY: Sift cocoa and flour twice; scrape bowl thoroughly.',
    });
    const presetWithoutNote = makePreset1oz([]);
    const calc = calcBatch(recipe, [{ preset: presetWithoutNote, count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets: [presetWithoutNote],
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const pdf = exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      connectionVerified: true,
      syncError: null,
      recipes: [recipe],
      presets: [presetWithoutNote],
      activeWorkspaceId: WS_MAIN,
      acknowledgedSafetySignature: safety.signature,
      skipDownload: true,
    });

    assert.strictEqual(pdf.hasCriticalNotes, true);
    assert.strictEqual(pdf.renderedSafetyInstructions.length, 1);
    assert.strictEqual(pdf.renderedSafetyInstructions[0].scope, 'recipe_wide');

    const noteTexts = pdf.blocks
      .filter((b) => b.section === 'critical_notes')
      .map((b) => b.text)
      .join('\n');
    assert.ok(
      noteTexts.includes('[Recipe-Wide Critical Production Note — Chocolate Chip Cookie]')
    );
    assert.ok(noteTexts.includes('RECIPE-WIDE ONLY: Sift cocoa and flour twice; scrape bowl thoroughly.'));
  });

  // ===========================================================================
  // SCENARIO 15: PDF includes Preset-Specific Critical Production Notes
  // ===========================================================================
  it('15. renders Preset-Specific Critical Production Notes with explicit preset scope label in the exported PDF', () => {
    const recipe = makeBaseRecipe({ description: '' });
    const presetWithNote = makePreset1oz();
    const calc = calcBatch(recipe, [{ preset: presetWithNote, count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets: [presetWithNote],
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const pdf = exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      connectionVerified: true,
      syncError: null,
      recipes: [recipe],
      presets: [presetWithNote],
      activeWorkspaceId: WS_MAIN,
      acknowledgedSafetySignature: safety.signature,
      skipDownload: true,
    });

    assert.strictEqual(pdf.hasCriticalNotes, true);
    assert.strictEqual(pdf.renderedSafetyInstructions.length, 1);
    assert.strictEqual(pdf.renderedSafetyInstructions[0].scope, 'preset_specific');

    const noteTexts = pdf.blocks
      .filter((b) => b.section === 'critical_notes')
      .map((b) => b.text)
      .join('\n');
    assert.ok(noteTexts.includes('[Preset-Specific Critical Production Note — 1 oz Cookie Case]'));
    assert.ok(
      noteTexts.includes(
        'PRESET RULE (1 OZ): Use mini chocolate chips ONLY; chill dough to 38°F before scooping.'
      )
    );
  });

  // ===========================================================================
  // SCENARIO 16: PDF includes both note types together with clear scope labels BEFORE checklist
  // ===========================================================================
  it('16. renders Recipe name, Selected Packaging Presets, and BOTH Recipe-Wide + Preset-Specific notes prominently BEFORE the ingredient checklist', () => {
    const recipe = makeBaseRecipe();
    const presets = [makePreset1oz(), makePreset3oz()];
    const calc = calcBatch(recipe, [
      { preset: presets[0], count: 2 },
      { preset: presets[1], count: 1 },
    ]);
    const safety = resolveApplicableSafetyInstructions({
      recipe,
      presets,
      selectedPresetIds: ['preset-cookie-1oz', 'preset-cookie-3oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const pdf = exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      connectionVerified: true,
      syncError: null,
      recipes: [recipe],
      presets,
      activeWorkspaceId: WS_MAIN,
      acknowledgedSafetySignature: safety.signature,
      skipDownload: true,
    });

    assert.strictEqual(pdf.recipeName, 'Chocolate Chip Cookie');
    assert.deepStrictEqual(pdf.selectedPresetLabels, [
      '1 oz Cookie Case',
      '3 oz Jumbo Cookie Case',
    ]);

    const summaryText = pdf.blocks
      .filter((b) => b.section === 'summary' || b.section === 'header')
      .map((b) => b.text)
      .join('\n');
    assert.ok(summaryText.includes('Chocolate Chip Cookie'));
    assert.ok(
      summaryText.includes(
        'Selected Packaging Preset(s): 1 oz Cookie Case, 3 oz Jumbo Cookie Case'
      )
    );

    const firstCriticalIdx = pdf.blocks.findIndex((b) => b.section === 'critical_notes');
    const lastCriticalIdx = pdf.blocks.reduce(
      (acc, b, idx) => (b.section === 'critical_notes' ? idx : acc),
      -1
    );
    const firstReqIdx = pdf.blocks.findIndex((b) => b.section === 'requirements');
    const firstChecklistIdx = pdf.blocks.findIndex((b) => b.section === 'ingredient_checklist');

    assert.ok(firstCriticalIdx >= 0, 'Critical notes blocks must exist');
    assert.ok(firstChecklistIdx > lastCriticalIdx, 'Critical notes must appear BEFORE ingredient checklist');
    assert.ok(firstReqIdx > lastCriticalIdx, 'Critical notes must appear BEFORE requirements/checklist');

    const criticalSectionText = pdf.blocks
      .filter((b) => b.section === 'critical_notes')
      .map((b) => b.text)
      .join('\n');
    assert.ok(
      criticalSectionText.includes(
        '[Recipe-Wide Critical Production Note — Chocolate Chip Cookie]'
      )
    );
    assert.ok(criticalSectionText.includes('[Preset-Specific Critical Production Note — 1 oz Cookie Case]'));
  });

  // ===========================================================================
  // SCENARIO 17: PDF wraps and paginates long multi-line notes without truncation
  // ===========================================================================
  it('17. wraps and paginates long multi-line Critical Production Notes across multiple PDF pages without truncating any line', () => {
    const numberedParagraphs = Array.from(
      { length: 48 },
      (_, idx) =>
        `CRITICAL STEP ${idx + 1}: Verify planetary mixer bowl lock pin engagement, confirm butter temperature between 62°F and 65°F, and inspect allergen lot tag #LOT-2026-${1000 + idx} prior to charging flour.`
    ).join('\n');

    const longRecipe = makeBaseRecipe({
      description: numberedParagraphs,
    });
    const longPreset = makePreset1oz([
      {
        id: 'note-long-1oz',
        presetId: 'preset-cookie-1oz',
        recipeId: longRecipe.id,
        workspaceId: WS_MAIN,
        note:
          'FINAL_PRESET_MARKER_START — Portion strictly with #40 disher onto parchment-lined half-sheets; never substitute dark chocolate chunks for mini semi-sweet chips — FINAL_PRESET_MARKER_END',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
    ]);

    const calc = calcBatch(longRecipe, [{ preset: longPreset, count: 1 }]);
    const safety = resolveApplicableSafetyInstructions({
      recipe: longRecipe,
      presets: [longPreset],
      selectedPresetIds: ['preset-cookie-1oz'],
      activeWorkspaceId: WS_MAIN,
    });

    const pdf = exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      connectionVerified: true,
      syncError: null,
      recipes: [longRecipe],
      presets: [longPreset],
      activeWorkspaceId: WS_MAIN,
      acknowledgedSafetySignature: safety.signature,
      skipDownload: true,
    });

    assert.ok(pdf.pageCount >= 2, `Expected multi-page PDF pagination, got pageCount=${pdf.pageCount}`);

    const joinedCriticalText = pdf.blocks
      .filter((b) => b.section === 'critical_notes')
      .map((b) => b.text)
      .join(' ');

    assert.ok(joinedCriticalText.includes('CRITICAL STEP 1:'));
    assert.ok(joinedCriticalText.includes('CRITICAL STEP 24:'));
    assert.ok(joinedCriticalText.includes('CRITICAL STEP 48:'));
    assert.ok(joinedCriticalText.includes('#LOT-2026-1047'));
    assert.ok(joinedCriticalText.includes('FINAL_PRESET_MARKER_START'));
    assert.ok(joinedCriticalText.includes('FINAL_PRESET_MARKER_END'));

    const checklistText = pdf.blocks
      .filter((b) => b.section === 'ingredient_checklist')
      .map((b) => b.text)
      .join(' ');
    assert.ok(checklistText.includes('Pastry Flour'));
    assert.ok(checklistText.includes('Chocolate Chips'));
  });

  // ===========================================================================
  // SCENARIO 18: PDF shows "No Critical Production Notes" when zero notes apply after READY
  // ===========================================================================
  it('18. renders "No Critical Production Notes" in the PDF when authoritative READY snapshots confirm zero notes apply', () => {
    const cleanRecipe = makeBaseRecipe({ description: '' });
    const cleanPreset = makePreset1oz([]);
    const calc = calcBatch(cleanRecipe, [{ preset: cleanPreset, count: 1 }]);

    const pdf = exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      connectionVerified: true,
      syncError: null,
      recipes: [cleanRecipe],
      presets: [cleanPreset],
      activeWorkspaceId: WS_MAIN,
      acknowledgedSafetySignature: null,
      skipDownload: true,
    });

    assert.strictEqual(pdf.hasCriticalNotes, false);
    const criticalText = pdf.blocks
      .filter((b) => b.section === 'critical_notes')
      .map((b) => b.text)
      .join('\n');
    assert.ok(criticalText.includes('No Critical Production Notes'));
  });

  // ===========================================================================
  // SCENARIO 19: Preset ID generation uses secure crypto.randomUUID() when available
  // ===========================================================================
  it('19. generates preset IDs using crypto.randomUUID() when available and avoids local ID collisions', () => {
    // Note: both UUIDs are strict RFC 4122 v4 (version digit '4', variant digit '8'|'9'|'a'|'b')
    const uuids = [
      '550e8400-e29b-41d4-a716-446655440000', // collides with existing local preset below
      '6ba7b810-9dad-41d1-80b4-00c04fd430c8', // unique RFC 4122 v4 UUID
    ];
    let callIdx = 0;
    const mockCrypto: CryptoProviderLike = {
      randomUUID: () => uuids[callIdx++] || 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    };

    const generated = generateCollisionResistantPresetId(
      ['preset-550e8400-e29b-41d4-a716-446655440000'],
      mockCrypto
    );
    assert.strictEqual(generated, 'preset-6ba7b810-9dad-41d1-80b4-00c04fd430c8');
    assert.strictEqual(callIdx, 2);
  });

  // ===========================================================================
  // SCENARIO 20: Preset ID generation falls back to crypto.getRandomValues() RFC 4122 v4
  // ===========================================================================
  it('20. falls back to crypto.getRandomValues() RFC 4122 v4 UUID when crypto.randomUUID is unavailable', () => {
    let getRandomValuesCalls = 0;
    const mockCryptoGetRandomOnly: CryptoProviderLike = {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        getRandomValuesCalls += 1;
        const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < view.length; i++) {
          view[i] = (i * 17 + 43 + getRandomValuesCalls) & 0xff;
        }
        return array;
      },
    };

    const rawUuid = generateCryptographicallySecureUuidV4(mockCryptoGetRandomOnly);
    assert.match(
      rawUuid,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      `Expected strict RFC 4122 v4 UUID, got ${rawUuid}`
    );

    const presetId = generateCollisionResistantPresetId([], mockCryptoGetRandomOnly);
    assert.match(
      presetId,
      /^preset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    assert.strictEqual(getRandomValuesCalls, 2);
  });

  // ===========================================================================
  // SCENARIO 21: Preset ID generation fails safely when CSPRNG is unavailable
  // ===========================================================================
  it('21. fails closed with InsecureUuidUnavailableError and visible UI error without creating a preset or falling back to Math.random()/timestamps when CSPRNG is unavailable', async () => {
    // 1. Direct utility check
    assert.throws(
      () => generateCollisionResistantPresetId([], null),
      (err: unknown) => err instanceof InsecureUuidUnavailableError
    );
    assert.throws(
      () =>
        createNewPresetEditorState({
          selectedCategory: 'Cookies',
          allCategories: ['Cookies', 'Pie Dough'],
          existingPresetIds: ['preset-cookie-1oz'],
          cryptoOverride: null,
        }),
      (err: unknown) => err instanceof InsecureUuidUnavailableError
    );

    // 2. Store createPreset check when preset ID is empty and CSPRNG is unavailable
    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => WS_MAIN),
      presets: [makePreset1oz()],
      presetCryptoOverride: null,
    });

    await assert.rejects(
      () =>
        store.createPreset({
          id: '',
          userId: 'uid-owner',
          name: 'Unsafe Preset Attempt',
          category: 'Cookies',
          finishedWeight: 2,
          weightUnit: 'oz',
          quantityPerUnit: 60,
          unitName: 'Case',
          workspaceId: WS_MAIN,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        }),
      (err: unknown) => err instanceof InsecureUuidUnavailableError
    );
    assert.strictEqual(cloud.createCalls, 0, 'No cloud createPreset call may execute when CSPRNG fails');
    assert.strictEqual(store.getPresets().length, 1, 'Existing presets remain unchanged');

    // 3. PresetManager UI renders visible security error banner and keeps editor closed
    const pmHtml = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets: [makePreset1oz()],
        recipes: [makeBaseRecipe()],
        userRole: 'owner',
        onSavePreset: () => {},
        onDeletePreset: () => {},
        cryptoOverrideForTest: null,
      })
    );
    assert.ok(pmHtml.includes('id="preset-creation-security-error-banner"'));
    assert.ok(
      pmHtml.includes('Cryptographically secure UUID generation is unavailable')
    );
    assert.ok(pmHtml.includes('Refusing to create a packaging preset with a predictable ID'));

    // 4. Static source verification: zero executable Math.random() in productionNotes.ts, presetEditorState.ts, PresetManager.tsx
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const prodNotesSrc = stripComments(
      fs.readFileSync(path.resolve(process.cwd(), 'src/utils/productionNotes.ts'), 'utf8')
    );
    const presetEditorSrc = stripComments(
      fs.readFileSync(path.resolve(process.cwd(), 'src/utils/presetEditorState.ts'), 'utf8')
    );
    const presetManagerSrc = stripComments(
      fs.readFileSync(path.resolve(process.cwd(), 'src/components/PresetManager.tsx'), 'utf8')
    );
    assert.ok(!prodNotesSrc.includes('Math.random'), 'productionNotes.ts must not invoke Math.random');
    assert.ok(!presetEditorSrc.includes('Math.random'), 'presetEditorState.ts must not invoke Math.random');
    assert.ok(!presetManagerSrc.includes('Math.random'), 'PresetManager.tsx must not invoke Math.random');
  });

  // ===========================================================================
  // SCENARIO 22: Local recipe_calc_critical_notes & durable backup untouched across all paths
  //              + duplicate setupRealtimeListeners() calls removed in store.ts
  // ===========================================================================
  it('22. preserves recipe_calc_critical_notes and durable backup untouched across errors, retries, Wi-Fi drops, sign-out, workspace switch, and PDF rejections, and confirms duplicate setupRealtimeListeners calls were removed', async () => {
    const originalRaw = seedProtectedDesktopLocalNote(memoryStorage);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'uid-owner', role: 'owner', workspaceId: WS_MAIN },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => store.getActiveWorkspaceId() || WS_MAIN),
      recipes: [makeBaseRecipe()],
      presets: [makePreset1oz()],
      safetyRetryDelaysMs: [],
      listenerRestartHook: () => {},
    });

    // 1. Listener error + manual retry
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      error: new Error('Listener failure'),
    });
    await store.retrySafetySync();
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [makeBaseRecipe()],
      fromCache: false,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: [makePreset1oz()],
      fromCache: false,
    });

    // 2. Wi-Fi drop (CONNECTION_UNVERIFIED) + blocked PDF export
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: [makePreset1oz()],
      fromCache: true,
    });
    const calc = calcBatch(makeBaseRecipe(), [{ preset: makePreset1oz(), count: 1 }]);
    assert.throws(() =>
      exportProductionSheetPDF(calc, 'Sunny Sweets', 2, {
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
        connectionVerified: store.isSafetyConnectionVerified(),
        syncError: store.getCriticalNotesSyncError(),
        skipDownload: true,
      })
    );

    // 3. Workspace switch + sign-out
    store.simulateFirestoreSnapshotForTesting({
      event: 'workspace_switch',
      workspaceId: 'ws-other',
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'auth_change',
      nextUid: null,
    });

    // Original localStorage key is byte-for-byte identical and durable backup is populated & intact
    assert.strictEqual(memoryStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY), originalRaw);
    const durableRaw = memoryStorage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY);
    assert.ok(durableRaw && durableRaw.includes('local-original-1oz-note'));
    assert.strictEqual(cloud.getTotalMutations(), 0);

    // Verify duplicate setupRealtimeListeners() calls were removed from onAuthStateChanged & setWorkspaceAfterCreation
    // Remaining single-responsibility call sites: validateMembershipForUser, retrySafetySync, and setActiveWorkspace
    const storeSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/store.ts'),
      'utf8'
    );
    const directCalls = storeSrc.match(/this\.setupRealtimeListeners\(/g) || [];
    assert.strictEqual(
      directCalls.length,
      3,
      'setupRealtimeListeners must only be invoked once per lifecycle transition (validateMembershipForUser, retrySafetySync, setActiveWorkspace)'
    );
  });
});
