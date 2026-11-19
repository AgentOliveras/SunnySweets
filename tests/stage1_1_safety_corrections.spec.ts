import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CriticalProductionNote,
  Mixer,
  ProductionHistoryEntry,
  ProductionPreset,
  Recipe,
} from '../src/types';
import {
  PresetCreationConflictError,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  canProceedToMixWithSyncSafety,
  computeSafetyInstructionsSignature,
  generateCollisionResistantPresetId,
  isSafetySignatureAcknowledged,
  resolveApplicableSafetyInstructions,
  resolveSafetyHydrationGateState,
} from '../src/utils/productionNotes';
import {
  buildPresetSubmissionPayload,
  createClosedPresetEditorState,
  createEditPresetEditorState,
  createInitialPresetDeleteState,
  createNewPresetEditorState,
  openPresetDeleteConfirmationState,
} from '../src/utils/presetEditorState';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  LEGACY_LOCAL_CRITICAL_NOTES_KEY,
  StorageLike,
} from '../src/utils/criticalNotesReconciliation';
import { calculateProduction } from '../src/utils/calculator';
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

  keys(): string[] {
    return Array.from(this.map.keys());
  }
}

/**
 * Simulated Firestore `presets` collection enforcing exact `/firestore.rules` semantics:
 * - `allow read`: fails with permission-denied if `tx.get(presetRef)` is called when `resource == null`
 *   (mirrors `isActiveWorkspaceMember(resource.data.workspaceId)` on nonexistent documents).
 * - `allow create`: succeeds via `createPreset` (`setDoc`) when `workspaceId` matches active workspace
 *   and caller is Owner or Editor.
 * - `allow update`: succeeds via `transactPreset` ONLY on existing documents in active workspace.
 * - `allow delete`: succeeds via `deletePreset` ONLY on existing documents in active workspace.
 */
class RulesAccurateSimulatedPresetsCloud {
  private docs = new Map<string, ProductionPreset>();
  public createCalls = 0;
  public transactReadCalls = 0;
  public deleteCalls = 0;
  public failNextCreateWith: Error | null = null;
  public failNextTransactWith: Error | null = null;
  public failNextDeleteWith: Error | null = null;
  public deleteGatePromise: Promise<void> | null = null;

  constructor(initialDocs: ProductionPreset[] = []) {
    for (const d of initialDocs) {
      this.docs.set(d.id, structuredClone(d));
    }
  }

  public getDoc(id: string): ProductionPreset | null {
    const found = this.docs.get(id);
    return found ? structuredClone(found) : null;
  }

  public getAllForWorkspace(wsId: string): ProductionPreset[] {
    return Array.from(this.docs.values())
      .filter((d) => !d.workspaceId || d.workspaceId === wsId)
      .map((d) => structuredClone(d));
  }

  public createAdapter(activeWorkspaceResolver: () => string): PresetCloudPersistenceAdapter {
    return {
      createPreset: async (preset: ProductionPreset) => {
        this.createCalls += 1;
        if (this.failNextCreateWith) {
          const err = this.failNextCreateWith;
          this.failNextCreateWith = null;
          throw err;
        }
        const activeWs = activeWorkspaceResolver();
        if (!preset.workspaceId || preset.workspaceId !== activeWs) {
          throw new Error('FirebaseError: Missing or insufficient permissions (create workspace mismatch).');
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
        this.transactReadCalls += 1;
        if (this.failNextTransactWith) {
          const err = this.failNextTransactWith;
          this.failNextTransactWith = null;
          throw err;
        }
        const existing = this.docs.get(presetId);
        // Exact reproduction of `/firestore.rules` line 136:
        // `allow read: if isAuthenticated() && isActiveWorkspaceMember(resource.data.workspaceId);`
        // Calling `tx.get` on a nonexistent preset document throws Missing or insufficient permissions!
        if (!existing) {
          throw new Error(
            `FirebaseError: Missing or insufficient permissions (tx.get on nonexistent presets/${presetId} where resource == null).`
          );
        }
        const activeWs = activeWorkspaceResolver();
        if (existing.workspaceId && existing.workspaceId !== activeWs) {
          throw new Error('FirebaseError: Missing or insufficient permissions (read workspace mismatch).');
        }
        const updated = mutator(structuredClone(existing));
        this.docs.set(presetId, structuredClone(updated));
        return structuredClone(updated);
      },

      deletePreset: async (presetId: string) => {
        this.deleteCalls += 1;
        if (this.deleteGatePromise) {
          await this.deleteGatePromise;
        }
        if (this.failNextDeleteWith) {
          const err = this.failNextDeleteWith;
          this.failNextDeleteWith = null;
          throw err;
        }
        const existing = this.docs.get(presetId);
        if (!existing) {
          throw new Error(`FirebaseError: Document presets/${presetId} not found.`);
        }
        const activeWs = activeWorkspaceResolver();
        if (existing.workspaceId && existing.workspaceId !== activeWs) {
          throw new Error('FirebaseError: Missing or insufficient permissions (delete workspace mismatch).');
        }
        this.docs.delete(presetId);
      },
    };
  }
}

const sampleMixer: Mixer = {
  id: 'mixer-hobart-60',
  workspaceId: 'ws-main',
  userId: 'owner-uid-1',
  name: '60 Qt Hobart Mixer',
  maxWeight: 80,
  weightUnit: 'lb',
  createdAt: '2026-01-10T08:00:00.000Z',
  updatedAt: '2026-01-10T08:00:00.000Z',
};

function createSampleRecipes(): {
  chocChip: Recipe;
  plainSugarCookie: Recipe;
} {
  const chocChip: Recipe = {
    id: 'recipe-choc-chip',
    workspaceId: 'ws-main',
    userId: 'owner-uid-1',
    name: 'Chocolate Chip Cookies',
    description: '',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    ingredients: [
      { id: 'ing-1', name: 'All-Purpose Flour', quantity: 2000, unit: 'g' },
      { id: 'ing-2', name: 'Butter', quantity: 1200, unit: 'g' },
      { id: 'ing-3', name: 'Chocolate Chips', quantity: 1500, unit: 'g' },
    ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-02-15T10:00:00.000Z',
  };

  const plainSugarCookie: Recipe = {
    id: 'recipe-sugar-cookie',
    workspaceId: 'ws-main',
    userId: 'owner-uid-1',
    name: 'Classic Sugar Cookies',
    description: '',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    ingredients: [
      { id: 'ing-s1', name: 'Pastry Flour', quantity: 1800, unit: 'g' },
      { id: 'ing-s2', name: 'Granulated Sugar', quantity: 1000, unit: 'g' },
    ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
  };

  return { chocChip, plainSugarCookie };
}

function createSamplePresets(with25OzCriticalNote: boolean): ProductionPreset[] {
  const note25Oz: CriticalProductionNote[] = with25OzCriticalNote
    ? [
        {
          id: 'cpn-2_5oz-4000ct',
          presetId: 'preset-2_5oz-cookies',
          recipeId: 'recipe-choc-chip',
          workspaceId: 'ws-main',
          note: 'CRITICAL: Use 4000-count chocolate chips for 2.5 oz Chocolate Chip Cookies.',
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-10T10:00:00.000Z',
          createdBy: 'owner-uid-1',
        },
      ]
    : [];

  return [
    {
      id: 'preset-1oz-cookies',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '1 oz Cookies',
      category: 'Cookies',
      finishedWeight: 1,
      weightUnit: 'oz',
      quantityPerUnit: 360,
      unitName: 'Case',
      criticalNotes: [],
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'preset-2_5oz-cookies',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '2.5 oz Cookies',
      category: 'Cookies',
      finishedWeight: 2.5,
      weightUnit: 'oz',
      quantityPerUnit: 120,
      unitName: 'Case',
      criticalNotes: note25Oz,
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
    },
  ];
}

describe('Stage 1.1 — Pre-Publication Safety Corrections (Isolated Source & Mock Verification)', () => {
  let memoryStorage: MemoryStorage;
  let originalGlobalLocalStorage: unknown;

  beforeEach(() => {
    memoryStorage = new MemoryStorage();
    originalGlobalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: memoryStorage,
      configurable: true,
      writable: true,
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
      presetsSyncError: null,
      recipesSyncError: null,
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'LOADING',
    });

    if (originalGlobalLocalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalGlobalLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  // =========================================================================
  // BLOCKER 1 — INITIAL FIRESTORE HYDRATION SAFETY GATE (Tests 1 - 9)
  // =========================================================================

  it('1. Fresh phone/tablet session is blocked across ProductionModeView, GuidedMixingMode, ProductionCalculator, and saveHistoryEntry while recipes is LOADING', async () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(false);
    let historySaves = 0;

    store.configureCriticalNotesTestHarness({
      session: { uid: 'tablet-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [chocChip],
      presets,
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'READY',
      presetsSyncError: null,
      recipesSyncError: null,
      historySaveAdapter: async () => {
        historySaves += 1;
      },
    });

    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'READY');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: true,
        syncError: null,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      false,
      'Must block mixing when recipesHydrationState is LOADING even if 0 notes exist in local cache'
    );

    const calc = calculateProduction(
      chocChip,
      [
        {
          id: 'req-1',
          presetId: 'preset-2_5oz-cookies',
          presetName: '2.5 oz Cookies',
          quantity: 1,
          piecesPerUnit: 120,
          itemWeight: 2.5,
          itemWeightUnit: 'oz',
        },
      ],
      { mixer: sampleMixer, defaultWeightUnit: 'lb', defaultWastePercent: 6 }
    );

    const floorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [chocChip],
        presets,
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        activeWorkspaceId: 'ws-main',
        initialRecipeId: chocChip.id,
        onExit: () => {},
      })
    );
    assert.ok(
      floorHtml.includes(SAFETY_HYDRATION_LOADING_MESSAGE),
      'ProductionModeView must display exact LOADING safety message while recipes is LOADING'
    );

    const guidedHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation: calc,
        presets,
        recipes: [chocChip],
        activeWorkspaceId: 'ws-main',
        onExit: () => {},
      })
    );
    assert.ok(
      guidedHtml.includes(SAFETY_HYDRATION_LOADING_MESSAGE),
      'GuidedMixingMode must display exact LOADING safety message while recipes is LOADING'
    );
    assert.ok(
      guidedHtml.includes('id="guided-complete-btn" disabled=""'),
      'GuidedMixingMode must disable Complete Batch while recipes is LOADING'
    );

    const calcHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [chocChip],
        presets,
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        initialRecipeId: chocChip.id,
        initialCalculation: calc,
        activeWorkspaceId: 'ws-main',
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(
      calcHtml.includes(SAFETY_HYDRATION_LOADING_MESSAGE),
      'ProductionCalculator must display exact LOADING safety message while recipes is LOADING'
    );
    assert.ok(
      calcHtml.includes('id="calc-guided-mixing-btn" disabled=""'),
      'ProductionCalculator must disable Guided Mixing button while recipes is LOADING'
    );
    assert.ok(
      calcHtml.includes('id="calc-save-history-btn" disabled=""'),
      'ProductionCalculator must disable Save History button while recipes is LOADING'
    );

    // Unsafe direct history log call must also reject while LOADING
    const sampleHistoryEntry: ProductionHistoryEntry = {
      id: 'hist-blocked-1',
      userId: 'owner-uid-1',
      workspaceId: 'ws-main',
      recipeId: chocChip.id,
      recipeName: chocChip.name,
      calculatedAt: new Date().toISOString(),
      requirements: calc.requirements,
      totalPieces: calc.totalPieces,
      totalFinishedWeightGrams: calc.totalFinishedWeightGrams,
      displayBatchWeight: calc.displayBatchWeight,
      displayWeightUnit: calc.displayWeightUnit,
      scalingMultiplier: calc.scalingMultiplier,
      wastePercent: 6,
      mixerName: sampleMixer.name,
      capacityExceeded: false,
      capacityOverridden: false,
      suggestedBatches: 1,
      calculatedIngredients: calc.calculatedIngredients,
      status: 'completed',
    };

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'READY',
    });

    await assert.rejects(
      async () => {
        await store.saveHistoryEntry(sampleHistoryEntry);
      },
      new RegExp(SAFETY_HYDRATION_LOADING_MESSAGE)
    );
    assert.strictEqual(historySaves, 0, 'Must never persist batch history while recipes is LOADING');
  });

  it('2. Fresh phone/tablet session is blocked while presets is LOADING (even after recipes reaches READY)', () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(false);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'phone-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [chocChip],
      presets: [], // Empty local presets cache on fresh phone
      recipesHydrationState: 'READY',
      presetsHydrationState: 'LOADING',
      presetsSyncError: null,
      recipesSyncError: null,
    });

    assert.strictEqual(store.getRecipesHydrationState(), 'READY');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');

    // Empty local cache must NEVER imply "no Critical Production Notes exist" while presets is LOADING
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: false,
        syncError: null,
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      false
    );

    const calc = calculateProduction(
      chocChip,
      [
        {
          id: 'req-1',
          presetId: 'preset-2_5oz-cookies',
          presetName: '2.5 oz Cookies',
          quantity: 1,
          piecesPerUnit: 120,
          itemWeight: 2.5,
          itemWeightUnit: 'oz',
        },
      ],
      { mixer: sampleMixer, defaultWeightUnit: 'lb', defaultWastePercent: 6 }
    );

    const floorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [chocChip],
        presets,
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        activeWorkspaceId: 'ws-main',
        initialRecipeId: chocChip.id,
        onExit: () => {},
      })
    );
    assert.ok(floorHtml.includes(SAFETY_HYDRATION_LOADING_MESSAGE));

    const guidedHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation: calc,
        presets,
        recipes: [chocChip],
        activeWorkspaceId: 'ws-main',
        onExit: () => {},
      })
    );
    assert.ok(guidedHtml.includes(SAFETY_HYDRATION_LOADING_MESSAGE));
    assert.ok(guidedHtml.includes('id="guided-complete-btn" disabled=""'));

    const calcHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [chocChip],
        presets,
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        initialRecipeId: chocChip.id,
        initialCalculation: calc,
        activeWorkspaceId: 'ws-main',
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(calcHtml.includes(SAFETY_HYDRATION_LOADING_MESSAGE));
    assert.ok(calcHtml.includes('id="calc-guided-mixing-btn" disabled=""'));
  });

  it('3. Cache-only Firestore snapshots (metadata.fromCache === true) do NOT count as server-confirmed READY and do NOT unlock mixing', () => {
    const { chocChip } = createSampleRecipes();
    const cachedPresetsWithoutNote = createSamplePresets(false);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'phone-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [],
      presets: [],
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'LOADING',
    });

    // Deliver offline/cache-only snapshots for BOTH collections
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [chocChip],
      fromCache: true,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: cachedPresetsWithoutNote,
      fromCache: true,
    });

    assert.strictEqual(
      store.getRecipesHydrationState(),
      'LOADING',
      'Cache-only recipes snapshot must remain LOADING'
    );
    assert.strictEqual(
      store.getPresetsHydrationState(),
      'LOADING',
      'Cache-only presets snapshot must remain LOADING'
    );
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: true,
        syncError: store.getCriticalNotesSyncError(),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      false,
      'Offline cached data without server confirmation must NOT unlock mixing'
    );
  });

  it('4. Legitimately empty server-confirmed snapshots (metadata.fromCache === false) reach READY and allow mixing when no notes exist', () => {
    store.configureCriticalNotesTestHarness({
      session: { uid: 'phone-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [],
      presets: [],
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'LOADING',
    });

    // Authoritative empty snapshots from server (fromCache: false)
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [],
      fromCache: false,
    });
    assert.strictEqual(store.getRecipesHydrationState(), 'READY');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: [],
      fromCache: false,
    });
    assert.strictEqual(store.getPresetsHydrationState(), 'READY');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'READY');

    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: false,
        syncError: store.getCriticalNotesSyncError(),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      true,
      'Legitimately empty server-confirmed snapshots with 0 notes must reach READY and allow mixing'
    );
  });

  it('5. Server-confirmed snapshot WITH a Critical Production Note reaches READY and still requires acknowledgment across all mixing views', () => {
    const { chocChip } = createSampleRecipes();
    const presetsWithNote = createSamplePresets(true);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'phone-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [],
      presets: [],
      recipesHydrationState: 'LOADING',
      presetsHydrationState: 'LOADING',
    });

    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [chocChip],
      fromCache: false,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: presetsWithNote,
      fromCache: false,
    });

    assert.strictEqual(store.getSafetyHydrationGateState(), 'READY');

    const resolution = resolveApplicableSafetyInstructions({
      recipe: store.getRecipes()[0],
      selectedPresetIds: ['preset-2_5oz-cookies'],
      presets: store.getPresets(),
      activeWorkspaceId: 'ws-main',
    });
    assert.strictEqual(resolution.allInstructions.length, 1);
    assert.ok(resolution.allInstructions[0].note.includes('4000-count chocolate chips'));

    // Unacknowledged -> blocked even though hydration is READY
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: resolution.hasSafetyNotes,
        isAcknowledged: false,
        syncError: store.getCriticalNotesSyncError(),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      false
    );

    const calc = calculateProduction(
      chocChip,
      [
        {
          id: 'req-1',
          presetId: 'preset-2_5oz-cookies',
          presetName: '2.5 oz Cookies',
          quantity: 1,
          piecesPerUnit: 120,
          itemWeight: 2.5,
          itemWeightUnit: 'oz',
        },
      ],
      { mixer: sampleMixer, defaultWeightUnit: 'lb', defaultWastePercent: 6 }
    );

    const calcHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: store.getRecipes(),
        presets: store.getPresets(),
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        initialRecipeId: chocChip.id,
        initialCalculation: calc,
        activeWorkspaceId: 'ws-main',
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(calcHtml.includes('4000-count chocolate chips'));
    assert.ok(
      calcHtml.includes('id="btn-calc-acknowledge-notes"'),
      'ProductionCalculator must render mandatory acknowledgment button when note exists'
    );
    assert.ok(
      calcHtml.includes('id="calc-guided-mixing-btn" disabled=""'),
      'ProductionCalculator must block starting Guided Mixing until Critical Note is acknowledged'
    );
    assert.ok(
      calcHtml.includes('id="calc-save-history-btn" disabled=""'),
      'ProductionCalculator must block Save History until Critical Note is acknowledged'
    );

    // Once acknowledged -> allowed
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: resolution.hasSafetyNotes,
        isAcknowledged: true,
        syncError: store.getCriticalNotesSyncError(),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      true
    );
  });

  it('6. Listener error transitions to ERROR (during initial load OR after prior READY) and blocks mixing with exact safety message', async () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(false);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [chocChip],
      presets,
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
      historySaveAdapter: async () => {},
    });

    assert.strictEqual(store.getSafetyHydrationGateState(), 'READY');

    // Simulate post-hydration presets listener failure
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_error',
      error: new Error('Firestore permission-denied or network stream closed'),
    });

    assert.strictEqual(store.getPresetsHydrationState(), 'ERROR');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'ERROR');
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: true,
        syncError: store.getCriticalNotesSyncError(),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      false
    );

    const calc = calculateProduction(
      chocChip,
      [
        {
          id: 'req-1',
          presetId: 'preset-2_5oz-cookies',
          presetName: '2.5 oz Cookies',
          quantity: 1,
          piecesPerUnit: 120,
          itemWeight: 2.5,
          itemWeightUnit: 'oz',
        },
      ],
      { mixer: sampleMixer, defaultWeightUnit: 'lb', defaultWastePercent: 6 }
    );

    const floorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [chocChip],
        presets,
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        activeWorkspaceId: 'ws-main',
        initialRecipeId: chocChip.id,
        onExit: () => {},
      })
    );
    assert.ok(floorHtml.includes(SAFETY_HYDRATION_ERROR_MESSAGE));

    const guidedHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation: calc,
        presets,
        recipes: [chocChip],
        activeWorkspaceId: 'ws-main',
        onExit: () => {},
      })
    );
    assert.ok(guidedHtml.includes(SAFETY_HYDRATION_ERROR_MESSAGE));
    assert.ok(guidedHtml.includes('id="guided-complete-btn" disabled=""'));

    const calcHtml = renderToStaticMarkup(
      React.createElement(ProductionCalculator, {
        recipes: [chocChip],
        presets,
        mixers: [sampleMixer],
        settings: INITIAL_SETTINGS,
        initialRecipeId: chocChip.id,
        initialCalculation: calc,
        activeWorkspaceId: 'ws-main',
        onStartGuidedMixing: () => {},
        onSaveToHistory: () => {},
      })
    );
    assert.ok(calcHtml.includes(SAFETY_HYDRATION_ERROR_MESSAGE));
    assert.ok(calcHtml.includes('id="calc-guided-mixing-btn" disabled=""'));
    assert.ok(calcHtml.includes('id="calc-save-history-btn" disabled=""'));

    await assert.rejects(
      async () => {
        await store.saveHistoryEntry({
          id: 'hist-err-1',
          userId: 'owner-uid-1',
          workspaceId: 'ws-main',
          recipeId: chocChip.id,
          recipeName: chocChip.name,
          calculatedAt: new Date().toISOString(),
          requirements: calc.requirements,
          totalPieces: calc.totalPieces,
          totalFinishedWeightGrams: calc.totalFinishedWeightGrams,
          displayBatchWeight: calc.displayBatchWeight,
          displayWeightUnit: calc.displayWeightUnit,
          scalingMultiplier: calc.scalingMultiplier,
          wastePercent: 6,
          mixerName: sampleMixer.name,
          capacityExceeded: false,
          capacityOverridden: false,
          suggestedBatches: 1,
          calculatedIngredients: calc.calculatedIngredients,
          status: 'completed',
        });
      },
      new RegExp('Production safety instructions unavailable')
    );
  });

  it('7. Workspace switch resets BOTH recipes and presets hydration to LOADING and ignores stale listener generations', () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(true);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [chocChip],
      presets,
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    const staleGen = store.getListenerGenerationForTesting();
    assert.strictEqual(store.getSafetyHydrationGateState(), 'READY');

    // Switch workspace -> must immediately reset to LOADING and increment generation
    store.simulateFirestoreSnapshotForTesting({
      event: 'workspace_switch',
      workspaceId: 'ws-secondary',
    });

    assert.strictEqual(store.getActiveWorkspaceId(), 'ws-secondary');
    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');

    // Late snapshot from previous generation / previous workspace MUST be ignored
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [chocChip],
      fromCache: false,
      generation: staleGen,
      workspaceId: 'ws-main',
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets,
      fromCache: false,
      generation: staleGen,
      workspaceId: 'ws-main',
    });

    assert.strictEqual(
      store.getSafetyHydrationGateState(),
      'LOADING',
      'Stale listener snapshots from prior workspace/generation must never mark new workspace READY'
    );
  });

  it('8. Authentication changes and listener restarts reset hydration to LOADING', () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(false);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [chocChip],
      presets,
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });
    assert.strictEqual(store.getSafetyHydrationGateState(), 'READY');

    // Auth user switch
    store.simulateFirestoreSnapshotForTesting({
      event: 'auth_change',
      nextUid: 'operator-uid-2',
      nextRole: 'viewer',
    });
    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');

    // Hydrate operator session to READY
    store.simulateFirestoreSnapshotForTesting({
      event: 'recipes_snapshot',
      recipes: [chocChip],
      fromCache: false,
    });
    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets,
      fromCache: false,
    });
    assert.strictEqual(store.getSafetyHydrationGateState(), 'READY');

    // Listener restart resets to LOADING
    store.simulateFirestoreSnapshotForTesting({
      event: 'listener_restart',
    });
    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
    assert.strictEqual(store.getSafetyHydrationGateState(), 'LOADING');

    // Sign-out (clearSession) also resets hydration to LOADING
    store.clearSession();
    assert.strictEqual(store.getRecipesHydrationState(), 'LOADING');
    assert.strictEqual(store.getPresetsHydrationState(), 'LOADING');
  });

  it('9. Live Critical Production Note addition or modification immediately invalidates prior acknowledgment', () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'phone-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      recipes: [chocChip],
      presets: initialPresets,
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    const initialResolution = resolveApplicableSafetyInstructions({
      recipe: store.getRecipes()[0],
      selectedPresetIds: ['preset-2_5oz-cookies'],
      presets: store.getPresets(),
      activeWorkspaceId: 'ws-main',
    });
    const acknowledgedSignature = computeSafetyInstructionsSignature(
      chocChip.id,
      initialResolution.allInstructions
    );
    assert.strictEqual(
      isSafetySignatureAcknowledged(initialResolution.signature, acknowledgedSignature),
      true
    );

    // Owner updates the note live on desktop -> phone receives updated server-confirmed snapshot
    const updatedPresets = initialPresets.map((p) =>
      p.id === 'preset-2_5oz-cookies'
        ? {
            ...p,
            criticalNotes: [
              {
                ...p.criticalNotes![0],
                note: 'UPDATED SAFETY RULE: Use 4000-count chocolate chips AND chill 45 minutes.',
                updatedAt: '2026-03-20T14:00:00.000Z',
              },
            ],
          }
        : p
    );

    store.simulateFirestoreSnapshotForTesting({
      event: 'presets_snapshot',
      presets: updatedPresets,
      fromCache: false,
    });

    const liveResolution = resolveApplicableSafetyInstructions({
      recipe: store.getRecipes()[0],
      selectedPresetIds: ['preset-2_5oz-cookies'],
      presets: store.getPresets(),
      activeWorkspaceId: 'ws-main',
    });

    assert.strictEqual(
      isSafetySignatureAcknowledged(liveResolution.signature, acknowledgedSignature),
      false,
      'Prior acknowledgment signature must immediately become invalid when note text changes live'
    );
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: liveResolution.hasSafetyNotes,
        isAcknowledged: isSafetySignatureAcknowledged(
          liveResolution.signature,
          acknowledgedSignature
        ),
        syncError: store.getCriticalNotesSyncError(),
        recipesHydrationState: store.getRecipesHydrationState(),
        presetsHydrationState: store.getPresetsHydrationState(),
      }),
      false,
      'Mixing must immediately lock until updated Critical Production Note is re-acknowledged'
    );
  });

  // =========================================================================
  // BLOCKER 2 — SAFE NEW PRESET CREATION (Tests 10 - 14)
  // =========================================================================

  it('10. Creating a brand-new preset succeeds via createPreset (setDoc path) without calling tx.get on a nonexistent document, compatible with unmodified firestore.rules', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => store.getActiveWorkspaceId() || 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    const newId = generateCollisionResistantPresetId(store.getPresets().map((p) => p.id));
    const newPreset: ProductionPreset = {
      id: newId,
      userId: '',
      name: '3.5 oz Bakery Cafe Cookie Case',
      category: 'Cookies',
      finishedWeight: 3.5,
      weightUnit: 'oz',
      quantityPerUnit: 96,
      unitName: 'Case',
      expectedYield: '96 cookies @ 3.5 oz each',
      criticalNotes: [],
      createdAt: '2026-03-21T09:00:00.000Z',
      updatedAt: '2026-03-21T09:00:00.000Z',
    };

    await store.savePreset(newPreset, { mode: 'create' });

    assert.strictEqual(cloud.createCalls, 1, 'Brand-new preset must use createPreset (setDoc) path');
    assert.strictEqual(
      cloud.transactReadCalls,
      0,
      'Brand-new preset MUST NOT call transactional tx.get on nonexistent presets/{id}'
    );

    const savedInCloud = cloud.getDoc(newId);
    assert.ok(savedInCloud, 'New preset must be persisted in simulated cloud');
    assert.strictEqual(savedInCloud!.workspaceId, 'ws-main');
    assert.strictEqual(savedInCloud!.userId, 'owner-uid-1');
    assert.deepStrictEqual(savedInCloud!.criticalNotes, []);

    // Verify `/firestore.rules` still contains unmodified `/presets/{presetId}` rules
    const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    assert.ok(
      rulesText.includes('match /presets/{presetId}'),
      'firestore.rules must define /presets/{presetId}'
    );
    assert.ok(
      rulesText.includes('allow create: if isSignedIn() &&') &&
        rulesText.includes('isWorkspaceEditor(request.resource.data.workspaceId);'),
      'firestore.rules allow create rule must match workspace-scoped setDoc payload'
    );
  });

  it('11. New preset creation fails cleanly with Save Failed when persistence fails and never optimistically mutates store.getPresets()', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);
    cloud.failNextCreateWith = new Error('Firestore network write rejected');

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => store.getActiveWorkspaceId() || 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    const beforeIds = store.getPresets().map((p) => p.id);
    const failedDraftState = createNewPresetEditorState({
      selectedCategory: 'Cookies',
      allCategories: ['Cookies', 'Pie Dough'],
      existingPresetIds: beforeIds,
    });
    failedDraftState.editingPreset!.name = '5 oz Festival Cookie';
    const submission = buildPresetSubmissionPayload(failedDraftState);

    await assert.rejects(
      async () => {
        await store.savePreset(submission.preset, { mode: submission.mode });
      },
      /Firestore network write rejected/
    );

    assert.deepStrictEqual(
      store.getPresets().map((p) => p.id),
      beforeIds,
      'Failed preset creation must NEVER leave an optimistic phantom preset in memory'
    );

    // Verify PresetManager SSR displays Save Failed banner when presetSaveStatus === 'error'
    const errorModalState = {
      ...failedDraftState,
      presetSaveStatus: 'error' as const,
      presetSaveError: 'Save Failed: Firestore network write rejected',
    };
    const html = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets: store.getPresets(),
        recipes: [chocChip],
        userRole: 'owner',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
        initialEditorStateForTest: errorModalState,
      })
    );
    assert.ok(
      html.includes('Save Failed: Firestore network write rejected'),
      'PresetManager modal must render Save Failed error banner when creation fails'
    );
  });

  it('12. Editing an existing preset runs transactionally and preserves unrelated or concurrently added criticalNotes', async () => {
    const { chocChip, plainSugarCookie } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'editor-uid-1', role: 'editor', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => store.getActiveWorkspaceId() || 'ws-main'),
      recipes: [chocChip, plainSugarCookie],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    // Simulate Editor opening "2.5 oz Cookies" edit form
    const staleOpenFormPreset: ProductionPreset = {
      ...store.getPresets().find((p) => p.id === 'preset-2_5oz-cookies')!,
      quantityPerUnit: 144, // Updating case count from 120 -> 144
      criticalNotes: [], // Even if a stale form had outdated/empty criticalNotes!
    };

    // Meanwhile, Owner adds a second Critical Production Note on another device directly in cloud
    const concurrentOwnerNote: CriticalProductionNote = {
      id: 'cpn-sugar-chill',
      presetId: 'preset-2_5oz-cookies',
      recipeId: plainSugarCookie.id,
      workspaceId: 'ws-main',
      note: 'Do not overbake 2.5 oz Sugar Cookies — pull at 11 minutes.',
      createdAt: '2026-03-21T10:00:00.000Z',
      updatedAt: '2026-03-21T10:00:00.000Z',
      createdBy: 'owner-uid-1',
    };
    const remoteCurrent = cloud.getDoc('preset-2_5oz-cookies')!;
    await cloud.createAdapter(() => 'ws-main').transactPreset('preset-2_5oz-cookies', () => ({
      ...remoteCurrent,
      criticalNotes: [...(remoteCurrent.criticalNotes || []), concurrentOwnerNote],
    }));

    // Reset counter before Editor submits packaging edit
    cloud.createCalls = 0;
    cloud.transactReadCalls = 0;

    await store.savePreset(staleOpenFormPreset, { mode: 'edit' });

    assert.strictEqual(cloud.createCalls, 0, 'Editing existing preset must NOT use createPreset');
    assert.strictEqual(cloud.transactReadCalls, 1, 'Editing existing preset MUST use transactional update');

    const updatedInCloud = cloud.getDoc('preset-2_5oz-cookies')!;
    assert.strictEqual(updatedInCloud.quantityPerUnit, 144);
    assert.strictEqual(
      updatedInCloud.criticalNotes?.length,
      2,
      'Both original 2.5 oz Chocolate Chip note AND concurrent Sugar Cookie note must be preserved'
    );
    assert.ok(updatedInCloud.criticalNotes!.some((n) => n.id === 'cpn-2_5oz-4000ct'));
    assert.ok(updatedInCloud.criticalNotes!.some((n) => n.id === 'cpn-sugar-chill'));
  });

  it('13. New preset IDs are collision-resistant and duplicate IDs cannot silently overwrite an existing preset', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    // Generate 200 IDs in a tight same-millisecond loop -> zero collisions
    const seen = new Set<string>(initialPresets.map((p) => p.id));
    for (let i = 0; i < 200; i++) {
      const id = generateCollisionResistantPresetId(seen);
      assert.strictEqual(seen.has(id), false, `Generated duplicate preset ID: ${id}`);
      seen.add(id);
    }

    // Attempting to create a preset with an existing preset's ID ('preset-2_5oz-cookies') MUST reject
    const collidingPreset: ProductionPreset = {
      id: 'preset-2_5oz-cookies',
      userId: 'owner-uid-1',
      workspaceId: 'ws-main',
      name: 'Accidental Overwrite Attempt',
      category: 'Cookies',
      finishedWeight: 9,
      weightUnit: 'oz',
      quantityPerUnit: 10,
      unitName: 'Box',
      criticalNotes: [],
      createdAt: '2026-03-21T10:00:00.000Z',
      updatedAt: '2026-03-21T10:00:00.000Z',
    };

    await assert.rejects(
      async () => {
        await store.createPreset(collidingPreset);
      },
      (err: unknown) => err instanceof PresetCreationConflictError
    );

    // Verify original 2.5 oz Cookies preset and its Critical Note were NOT overwritten
    const preserved = store.getPresets().find((p) => p.id === 'preset-2_5oz-cookies')!;
    assert.strictEqual(preserved.name, '2.5 oz Cookies');
    assert.strictEqual(preserved.finishedWeight, 2.5);
    assert.strictEqual(preserved.criticalNotes?.length, 1);
  });

  it('14. Viewer cannot create presets and PresetManager hides creation/edit/delete controls for Viewers', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'viewer-uid-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    await assert.rejects(
      async () => {
        await store.savePreset(
          {
            id: 'preset-viewer-illegal',
            userId: 'viewer-uid-1',
            name: 'Unauthorized Preset',
            category: 'Cookies',
            finishedWeight: 2,
            weightUnit: 'oz',
            quantityPerUnit: 60,
            unitName: 'Case',
            createdAt: '2026-03-21T10:00:00.000Z',
            updatedAt: '2026-03-21T10:00:00.000Z',
          },
          { mode: 'create' }
        );
      },
      /Permission denied: Viewers cannot add or modify presets/
    );
    assert.strictEqual(cloud.createCalls, 0);

    const viewerHtml = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets: store.getPresets(),
        recipes: [chocChip],
        userRole: 'viewer',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
      })
    );
    assert.ok(!viewerHtml.includes('id="preset-add-btn"'));
    assert.ok(!viewerHtml.includes('Add to Cookies'));
    assert.ok(!viewerHtml.includes('id="preset-delete-btn-preset-2_5oz-cookies"'));
  });

  // =========================================================================
  // BLOCKER 3 — PREVENT STALE CRITICAL NOTES ON NEW PRESETS (Tests 15 - 17)
  // =========================================================================

  it('15. Opening an existing preset with Critical Production Notes and then clicking "Add to Cookies" (or any New Preset button) resets presetNotes and draft fields to empty', () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(true);
    const presetWithNote = presets.find((p) => p.id === 'preset-2_5oz-cookies')!;

    // Step 1: Open existing 2.5 oz Cookies preset that has a Critical Production Note,
    // and simulate partial inline note editing state
    const openedEditState = {
      ...createEditPresetEditorState(presetWithNote, presetWithNote.criticalNotes || []),
      isAddingNote: true,
      editingNoteId: 'cpn-2_5oz-4000ct',
      editingNoteExpectedUpdatedAt: '2026-03-10T10:00:00.000Z',
      selectedRecipeForNote: chocChip.id,
      newNoteText: 'Half-typed draft edit...',
      noteSaveStatus: 'saved' as const,
      noteSaveMessage: 'Saved to shared workspace.',
    };
    assert.strictEqual(openedEditState.presetNotes.length, 1);

    // Step 2: Click category header "Add to Cookies" -> createNewPresetEditorState(categoryOverride: 'Cookies')
    const addToCookiesState = createNewPresetEditorState({
      selectedCategory: 'All',
      allCategories: ['Cookies', 'Pie Dough', 'Base Dough', 'Shortbread'],
      existingPresetIds: presets.map((p) => p.id),
      categoryOverride: 'Cookies',
    });

    assert.strictEqual(addToCookiesState.editorMode, 'create');
    assert.strictEqual(addToCookiesState.editingPreset?.category, 'Cookies');
    assert.deepStrictEqual(addToCookiesState.presetNotes, []);
    assert.deepStrictEqual(addToCookiesState.editingPreset?.criticalNotes, []);
    assert.strictEqual(addToCookiesState.isAddingNote, false);
    assert.strictEqual(addToCookiesState.editingNoteId, null);
    assert.strictEqual(addToCookiesState.editingNoteExpectedUpdatedAt, null);
    assert.strictEqual(addToCookiesState.selectedRecipeForNote, '');
    assert.strictEqual(addToCookiesState.newNoteText, '');
    assert.strictEqual(addToCookiesState.noteSaveStatus, 'idle');
    assert.strictEqual(addToCookiesState.noteSaveMessage, '');
    assert.strictEqual(addToCookiesState.presetSaveStatus, 'idle');
    assert.strictEqual(addToCookiesState.presetSaveError, '');

    // Verify rendered modal markup shows 0 critical notes and does NOT leak 4000-count chocolate chips
    const modalHtml = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets,
        recipes: [chocChip],
        userRole: 'owner',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
        initialEditorStateForTest: addToCookiesState,
      })
    );
    assert.ok(modalHtml.includes('Create Production Preset'));
    assert.ok(
      modalHtml.includes('No preset-specific critical production notes assigned to this preset yet.')
    );
    assert.ok(
      !modalHtml.includes('4000-count chocolate chips'),
      'New Preset modal opened via Add to Cookies MUST NOT display stale Critical Production Notes'
    );
  });

  it('16. Cancelling and reopening New Preset modal (including after staging a note or a failed save) leaves notes and errors completely empty', () => {
    const presets = createSamplePresets(true);

    // Open New Preset, stage a draft note and simulate a failed save error
    const firstNewState = createNewPresetEditorState({
      selectedCategory: 'Cookies',
      allCategories: ['Cookies'],
      existingPresetIds: presets.map((p) => p.id),
    });
    firstNewState.presetNotes = [
      {
        id: 'cpn-staged-temp',
        presetId: firstNewState.editingPreset!.id,
        recipeId: 'recipe-choc-chip',
        workspaceId: 'ws-main',
        note: 'Temporary staged note before cancel',
        createdAt: '2026-03-21T10:00:00.000Z',
        updatedAt: '2026-03-21T10:00:00.000Z',
      },
    ];
    firstNewState.presetSaveStatus = 'error';
    firstNewState.presetSaveError = 'Save Failed: Temporary network error';

    // Cancel modal
    const closedState = createClosedPresetEditorState();
    assert.strictEqual(closedState.editingPreset, null);
    assert.deepStrictEqual(closedState.presetNotes, []);
    assert.strictEqual(closedState.presetSaveError, '');

    // Reopen New Preset modal
    const reopenedState = createNewPresetEditorState({
      selectedCategory: 'Cookies',
      allCategories: ['Cookies'],
      existingPresetIds: presets.map((p) => p.id),
    });
    assert.deepStrictEqual(reopenedState.presetNotes, []);
    assert.strictEqual(reopenedState.presetSaveStatus, 'idle');
    assert.strictEqual(reopenedState.presetSaveError, '');
    assert.notStrictEqual(reopenedState.editingPreset!.id, firstNewState.editingPreset!.id);
  });

  it('17. Creating a new preset after viewing another preset does NOT copy notes, and both payload builder + store.createPreset block foreign presetId notes', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    // 1. View 2.5 oz Cookies (which has cpn-2_5oz-4000ct)
    const preset25 = store.getPresets().find((p) => p.id === 'preset-2_5oz-cookies')!;
    const viewedEditState = createEditPresetEditorState(
      preset25,
      store.getCriticalNotesForPreset(preset25.id)
    );
    assert.strictEqual(viewedEditState.presetNotes.length, 1);

    // 2. Switch to "Add to Cookies" to create "4 oz Bakery Cookie"
    const newPresetState = createNewPresetEditorState({
      selectedCategory: 'All',
      allCategories: ['Cookies'],
      existingPresetIds: store.getPresets().map((p) => p.id),
      categoryOverride: 'Cookies',
    });
    newPresetState.editingPreset!.name = '4 oz Bakery Cookie';

    const { preset: payloadToSave, mode } = buildPresetSubmissionPayload(newPresetState);
    assert.strictEqual(mode, 'create');
    assert.deepStrictEqual(payloadToSave.criticalNotes, []);

    await store.savePreset(payloadToSave, { mode });

    const created = cloud.getDoc(payloadToSave.id)!;
    assert.strictEqual(created.name, '4 oz Bakery Cookie');
    assert.deepStrictEqual(
      created.criticalNotes,
      [],
      'Newly created preset must have 0 inherited Critical Production Notes'
    );

    // 3. Defense-in-depth: even if a malformed caller passes a foreign note directly to store.createPreset, it MUST throw!
    await assert.rejects(
      async () => {
        await store.createPreset({
          id: generateCollisionResistantPresetId(store.getPresets().map((p) => p.id)),
          userId: 'owner-uid-1',
          workspaceId: 'ws-main',
          name: 'Malformed Foreign Note Preset',
          category: 'Cookies',
          finishedWeight: 3,
          weightUnit: 'oz',
          quantityPerUnit: 80,
          unitName: 'Case',
          criticalNotes: preset25.criticalNotes, // Foreign presetId = 'preset-2_5oz-cookies'
          createdAt: '2026-03-21T10:00:00.000Z',
          updatedAt: '2026-03-21T10:00:00.000Z',
        });
      },
      /Stale Critical Production Note detected from preset/
    );
  });

  // =========================================================================
  // BLOCKER 4 — PRESET DELETE CONFIRMATION & ERROR HANDLING (Tests 18 - 20)
  // =========================================================================

  it('18. Preset delete opens accessible in-app confirmation modal displaying preset name and uses zero window.confirm calls', () => {
    const { chocChip } = createSampleRecipes();
    const presets = createSamplePresets(true);
    const target = presets.find((p) => p.id === 'preset-1oz-cookies')!;

    // Verify source file contains zero browser `confirm(` or `window.confirm(` calls
    const presetManagerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/PresetManager.tsx'),
      'utf8'
    );
    assert.strictEqual(
      /\bwindow\.confirm\s*\(|\bconfirm\s*\(/.test(presetManagerSource),
      false,
      'PresetManager.tsx must NOT use browser confirm() / window.confirm()'
    );

    const confirmDeleteState = openPresetDeleteConfirmationState(
      createInitialPresetDeleteState(),
      target
    );
    const html = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets,
        recipes: [chocChip],
        userRole: 'owner',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
        initialDeleteStateForTest: confirmDeleteState,
      })
    );

    assert.ok(html.includes('id="preset-delete-confirm-modal"'));
    assert.ok(html.includes('role="alertdialog"'));
    assert.ok(html.includes('Delete Packaging Preset'));
    assert.ok(html.includes('1 oz Cookies'), 'Delete confirmation modal must display preset name');
    assert.ok(html.includes('id="preset-delete-cancel-btn"'));
    assert.ok(html.includes('id="preset-delete-confirm-btn"'));
  });

  it('19. Failed preset deletion retains the preset, blocks duplicate clicks while Deleting..., and shows Delete Failed error message', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);
    cloud.failNextDeleteWith = new Error('Missing or insufficient permissions');

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    await assert.rejects(
      async () => {
        await store.deletePreset('preset-1oz-cookies');
      },
      /Missing or insufficient permissions/
    );

    // Preset MUST still exist in both memory and simulated cloud
    assert.ok(
      store.getPresets().some((p) => p.id === 'preset-1oz-cookies'),
      'Preset must remain in store.getPresets() when deletion fails'
    );
    assert.ok(cloud.getDoc('preset-1oz-cookies'), 'Preset must remain in cloud when deletion fails');

    // Verify Deleting... disables duplicate delete clicks & openPresetDeleteConfirmationState ignores clicks while deleting
    const target = store.getPresets().find((p) => p.id === 'preset-1oz-cookies')!;
    const deletingState = {
      presetPendingDelete: target,
      deletingPresetId: target.id,
      deleteStatus: 'deleting' as const,
      deleteFeedbackMessage: `Deleting "${target.name}"...`,
    };
    const duplicateAttempt = openPresetDeleteConfirmationState(
      deletingState,
      store.getPresets()[1]
    );
    assert.strictEqual(
      duplicateAttempt.presetPendingDelete?.id,
      target.id,
      'Must ignore duplicate delete requests while a preset deletion is in flight'
    );

    const deletingHtml = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets: store.getPresets(),
        recipes: [chocChip],
        userRole: 'owner',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
        initialDeleteStateForTest: deletingState,
      })
    );
    assert.ok(deletingHtml.includes('Deleting...'));
    assert.ok(deletingHtml.includes('id="preset-delete-confirm-btn" disabled=""'));

    // Verify Delete Failed error state renders clear error banner in modal
    const failedDeleteUiState = {
      presetPendingDelete: target,
      deletingPresetId: null,
      deleteStatus: 'error' as const,
      deleteFeedbackMessage: 'Delete Failed: Missing or insufficient permissions',
    };
    const errorHtml = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets: store.getPresets(),
        recipes: [chocChip],
        userRole: 'owner',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
        initialDeleteStateForTest: failedDeleteUiState,
      })
    );
    assert.ok(errorHtml.includes('id="preset-delete-error-banner"'));
    assert.ok(errorHtml.includes('Delete Failed: Missing or insufficient permissions'));
  });

  it('20. Successful preset deletion removes the preset ONLY after cloud persistence resolves, displays Deleted feedback, and preserves unrelated presets, notes, recipes, and local backups', async () => {
    const { chocChip } = createSampleRecipes();
    const initialPresets = createSamplePresets(true);
    const cloud = new RulesAccurateSimulatedPresetsCloud(initialPresets);

    // Seed legacy local note + durable backup to verify preset deletion never touches local safety backups
    const rawLegacyJson = JSON.stringify([
      {
        id: 'cpn-desktop-local',
        presetId: 'preset-2_5oz-cookies',
        recipeId: chocChip.id,
        workspaceId: 'ws-main',
        note: 'Original desktop local note',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:00:00.000Z',
      },
    ]);
    memoryStorage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, rawLegacyJson);
    memoryStorage.setItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY, '{"version":1}');

    let releaseCloudDelete!: () => void;
    cloud.deleteGatePromise = new Promise<void>((resolve) => {
      releaseCloudDelete = resolve;
    });

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: memoryStorage,
      cloudAdapter: cloud.createAdapter(() => 'ws-main'),
      recipes: [chocChip],
      presets: cloud.getAllForWorkspace('ws-main'),
      recipesHydrationState: 'READY',
      presetsHydrationState: 'READY',
    });

    // Start async deletion of 'preset-1oz-cookies' — MUST remain in store while cloud promise is pending!
    const pendingDelete = store.deletePreset('preset-1oz-cookies');
    assert.strictEqual(
      store.getPresets().some((p) => p.id === 'preset-1oz-cookies'),
      true,
      'Preset MUST NOT be optimistically removed before cloud delete resolves'
    );

    releaseCloudDelete();
    await pendingDelete;

    assert.strictEqual(
      store.getPresets().some((p) => p.id === 'preset-1oz-cookies'),
      false,
      'Preset must be removed after cloud delete resolves'
    );
    assert.strictEqual(cloud.getDoc('preset-1oz-cookies'), null);

    // Unrelated preset (2.5 oz Cookies + its Critical Note), recipe, and local backups remain intact
    const remaining25Oz = store.getPresets().find((p) => p.id === 'preset-2_5oz-cookies')!;
    assert.ok(remaining25Oz);
    assert.strictEqual(remaining25Oz.criticalNotes?.length, 1);
    assert.strictEqual(store.getRecipes().length, 1);
    assert.strictEqual(memoryStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY), rawLegacyJson);
    assert.strictEqual(memoryStorage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY), '{"version":1}');

    // Verify Deleted status banner renders in PresetManager
    const deletedHtml = renderToStaticMarkup(
      React.createElement(PresetManager, {
        presets: store.getPresets(),
        recipes: [chocChip],
        userRole: 'owner',
        onSavePreset: async () => {},
        onDeletePreset: async () => {},
        initialDeleteStateForTest: {
          presetPendingDelete: null,
          deletingPresetId: null,
          deleteStatus: 'deleted',
          deleteFeedbackMessage: 'Deleted preset "1 oz Cookies".',
        },
      })
    );
    assert.ok(deletedHtml.includes('id="preset-delete-status-banner"'));
    assert.ok(deletedHtml.includes('Deleted preset &quot;1 oz Cookies&quot;.'));
  });
});
