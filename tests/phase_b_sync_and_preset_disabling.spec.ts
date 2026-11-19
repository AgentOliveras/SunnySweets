import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';
import { store } from '../src/services/store';
import {
  getOrderedProductionOptionKeys,
  isPresetEnabledForProduction,
  matchesPresetKey,
  canonicalizeProductionOptionOrder,
  SYSTEM_OPTION_KEYS,
} from '../src/utils/productionOptionOrdering';
import {
  createNewPresetEditorState,
  createEditPresetEditorState,
  buildPresetSubmissionPayload,
} from '../src/utils/presetEditorState';
import {
  resolveApplicableSafetyInstructions,
  isSafetySignatureAcknowledged,
} from '../src/utils/productionNotes';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  StorageLike,
} from '../src/utils/criticalNotesReconciliation';
import { MGMT_LOCK_STORAGE_KEY } from '../src/utils/managementLock';
import { calculateProduction } from '../src/utils/calculator';
import { ProductionOptionOrderingSettings } from '../src/components/ProductionOptionOrderingSettings';
import { SettingsView } from '../src/components/SettingsView';
import { PresetManager } from '../src/components/PresetManager';
import { ProductionModeView } from '../src/components/ProductionModeView';
import { ProductionCalculator } from '../src/components/ProductionCalculator';
import { PackagingPresetSelectorModal } from '../src/components/quoting/PackagingPresetSelectorModal';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  Workspace,
  UserSettings,
} from '../src/types';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  public clearCalls = 0;

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.clearCalls += 1;
    this.map.clear();
  }
}

const BASE_SETTINGS: UserSettings = {
  userId: 'uid-owner',
  defaultWeightUnit: 'lb',
  defaultWastePercent: 6,
  decimalPlaces: 2,
  theme: 'light',
  businessName: 'Sunny Sweets',
  activeWorkspaceId: 'ws-main',
  workspaceName: 'Sunny Sweets Production',
  categoryPresetMap: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const FOUR_SEASONS_CHOC_CHIP_RECIPE: Recipe = {
  id: 'rec-choc-chip-fs',
  userId: 'uid-owner',
  workspaceId: 'ws-main',
  name: 'Four Seasons Chocolate Chip Cookie',
  description: 'Keep butter at 66F before creaming.',
  category: 'Cookies',
  batchYieldQuantity: 100,
  batchYieldUnit: 'cookies',
  defaultWastePercent: 6,
  archived: false,
  ingredients: [
    { id: 'ing-flour', name: 'Pastry Flour', quantity: 2000, unit: 'g' },
    { id: 'ing-butter', name: 'Unsalted Butter', quantity: 1200, unit: 'g' },
    { id: 'ing-sugar', name: 'Brown Sugar', quantity: 1000, unit: 'g' },
    { id: 'ing-chips', name: 'Semi-Sweet Chocolate Chips', quantity: 1500, unit: 'g' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const HOBART_MIXER: Mixer = {
  id: 'mixer-hobart-60',
  userId: 'uid-owner',
  workspaceId: 'ws-main',
  name: 'Hobart 60 Qt',
  maxWeight: 22679.6, // 50 lb in grams
  weightUnit: 'lb',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createSunnyCookiePresets(): ProductionPreset[] {
  return [
    {
      id: 'preset-1oz',
      userId: 'uid-owner',
      workspaceId: 'ws-main',
      name: '1 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 1,
      weightUnit: 'oz',
      quantityPerUnit: 240,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-2oz',
      userId: 'uid-owner',
      workspaceId: 'ws-main',
      name: '2 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 2,
      weightUnit: 'oz',
      quantityPerUnit: 180,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-2_5oz',
      userId: 'uid-owner',
      workspaceId: 'ws-main',
      name: '2.5 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 2.5,
      weightUnit: 'oz',
      quantityPerUnit: 144,
      unitName: 'Case',
      criticalNotes: [
        {
          id: 'note-2_5oz-4000ct',
          presetId: 'preset-2_5oz',
          recipeId: 'rec-choc-chip-fs',
          workspaceId: 'ws-main',
          note: 'CRITICAL: Use 4000-count mini chocolate chips for 2.5 oz Four Seasons portioning.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          createdBy: 'uid-owner',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'preset-3oz',
      userId: 'uid-owner',
      workspaceId: 'ws-main',
      name: '3 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 3,
      weightUnit: 'oz',
      quantityPerUnit: 120,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'preset-4oz',
      userId: 'uid-owner',
      workspaceId: 'ws-main',
      name: '4 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 96,
      unitName: 'Case',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function createWorkspaceDoc(order?: string[]): Workspace {
  return {
    id: 'ws-main',
    name: 'Sunny Sweets Production',
    ownerId: 'uid-owner',
    ownerEmail: 'jaoliveras@gmail.com',
    code: 'SUNNY-MAIN',
    members: [],
    groups: [],
    productionFloorModeEnabled: true,
    productionOptionOrder:
      order ?? [
        'preset-1oz',
        'preset-2oz',
        'preset-3oz',
        'preset-4oz',
        'preset-2_5oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Phase B — Cross-Device Production Option Synchronization & Preset Disabling', () => {
  let memoryStorage: MemoryStorage;
  let originalLocalStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    memoryStorage = new MemoryStorage();
    memoryStorage.setItem(
      'recipe_calc_critical_notes',
      JSON.stringify([
        {
          id: 'note-2_5oz-4000ct',
          presetId: 'preset-2_5oz',
          recipeId: 'rec-choc-chip-fs',
          workspaceId: 'ws-main',
          note: 'CRITICAL: Use 4000-count mini chocolate chips for 2.5 oz Four Seasons portioning.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          createdBy: 'uid-owner',
        },
      ])
    );
    memoryStorage.setItem(
      DURABLE_CRITICAL_NOTES_BACKUP_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-02T00:00:00.000Z',
        records: {
          'ws-main::preset-2_5oz::rec-choc-chip-fs': {
            key: 'ws-main::preset-2_5oz::rec-choc-chip-fs',
            firstCapturedAt: '2026-01-01T00:00:00.000Z',
            lastCapturedAt: '2026-01-02T00:00:00.000Z',
            note: {
              id: 'note-2_5oz-4000ct',
              presetId: 'preset-2_5oz',
              recipeId: 'rec-choc-chip-fs',
              workspaceId: 'ws-main',
              note: 'CRITICAL: Use 4000-count mini chocolate chips for 2.5 oz Four Seasons portioning.',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
              createdBy: 'uid-owner',
            },
          },
        },
        decisions: {},
      })
    );
    memoryStorage.setItem(
      MGMT_LOCK_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        salt: 'a'.repeat(32),
        hash: 'b'.repeat(64),
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: memoryStorage,
      configurable: true,
      writable: true,
    });

    store.clearSession();
  });

  afterEach(() => {
    store.clearSession();
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  // =========================================================================
  // SUITE A — Cross-Device Production Option Order
  // =========================================================================
  describe('Suite A — Cross-Device Production Option Display Order', () => {
    it('A1: Owner moves 2.5 oz between 2 oz and 3 oz -> persists narrow workspaces/ws-main payload -> Viewer tablet receives real-time & post-refresh order with zero settings/{uid} write', async () => {
      const presets = createSunnyCookiePresets();
      let cloudWorkspace = createWorkspaceDoc();
      const workspaceWrites: Array<{ workspaceId: string; updates: Record<string, unknown> }> = [];

      // 1. Configure Owner phone session (jaoliveras@gmail.com)
      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [cloudWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets,
        localSettings: {
          ...BASE_SETTINGS,
          // Stale legacy per-user order that MUST NOT be used or overwritten
          productionOptionOrder: ['preset-4oz', 'preset-3oz', 'preset-2oz', 'preset-1oz'],
        },
        workspaceSettingsSaveAdapter: async (workspaceId, updates) => {
          workspaceWrites.push({ workspaceId, updates });
          cloudWorkspace = {
            ...cloudWorkspace,
            ...(updates as Partial<Workspace>),
          };
        },
      });

      const desiredOrder = [
        'preset-1oz',
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        'preset-4oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ];

      await store.setProductionOptionOrder(desiredOrder);

      // Verify narrow authoritative Firestore write to workspaces/ws-main
      assert.equal(workspaceWrites.length, 1);
      assert.equal(workspaceWrites[0].workspaceId, 'ws-main');
      assert.deepEqual(
        Object.keys(workspaceWrites[0].updates).sort(),
        ['productionOptionOrder', 'updatedAt'],
        'Must send ONLY { productionOptionOrder, updatedAt } so rules allow both Owner and Editor'
      );
      assert.deepEqual(cloudWorkspace.productionOptionOrder, desiredOrder);

      // Verify per-user settings were NOT mutated to store desiredOrder
      assert.notDeepEqual(store.getSettings().productionOptionOrder, desiredOrder);

      // 2. Simulate Samsung Tablet Viewer session (sunnysweetsapopka@gmail.com) initially holding old order
      const tabletOldWorkspace = createWorkspaceDoc();
      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-samsung-tablet', role: 'viewer', workspaceId: 'ws-main' },
        workspaces: [tabletOldWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets,
        localSettings: {
          ...BASE_SETTINGS,
          userId: 'uid-samsung-tablet',
          // Even if tablet local settings had a stale order, getProductionOptionOrder MUST ignore it
          productionOptionOrder: ['preset-1oz', 'preset-2oz', 'preset-3oz', 'preset-4oz', 'preset-2_5oz'],
        },
      });

      // Deliver live onSnapshot from workspaces/ws-main to Samsung tablet
      store.simulateWorkspaceRealtimeSnapshotForTesting({
        workspaceId: 'ws-main',
        exists: true,
        data: cloudWorkspace,
        fromCache: false,
      });

      assert.deepEqual(store.getProductionOptionOrder('ws-main'), desiredOrder);

      // Render ProductionModeView on Samsung tablet (both real-time and simulated full refresh)
      const tabletHtml = renderToStaticMarkup(
        React.createElement(ProductionModeView, {
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          presets,
          mixers: [HOBART_MIXER],
          settings: store.getSettings(),
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          activeWorkspaceId: 'ws-main',
          initialRecipeId: 'rec-choc-chip-fs',
          onExit: () => {},
        })
      );

      const idx2oz = tabletHtml.indexOf('id="card-prod-option-preset-preset-2oz"');
      const idx25oz = tabletHtml.indexOf('id="card-prod-option-preset-preset-2_5oz"');
      const idx3oz = tabletHtml.indexOf('id="card-prod-option-preset-preset-3oz"');
      assert.ok(idx2oz > -1 && idx25oz > -1 && idx3oz > -1, 'All cookie preset cards must render');
      assert.ok(
        idx2oz < idx25oz && idx25oz < idx3oz,
        '2.5 oz Cookie Case must render strictly between 2 oz and 3 oz on Samsung tablet'
      );

      // 3. Simulate full page refresh on Samsung tablet: re-hydrating from cloudWorkspace
      store.clearSession();
      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-samsung-tablet', role: 'viewer', workspaceId: 'ws-main' },
        workspaces: [cloudWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets,
        localSettings: {
          ...BASE_SETTINGS,
          userId: 'uid-samsung-tablet',
          productionOptionOrder: ['preset-4oz', 'preset-1oz'],
        },
      });

      assert.deepEqual(store.getProductionOptionOrder(), desiredOrder);
      const orderedKeysAfterRefresh = getOrderedProductionOptionKeys(
        presets,
        store.getProductionOptionOrder()
      );
      assert.deepEqual(orderedKeysAfterRefresh.slice(0, 5), [
        'preset-1oz',
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        'preset-4oz',
      ]);
    });

    it('A2: Active Editor saves productionOptionOrder with narrow payload and syncs to Owner & Viewer', async () => {
      const presets = createSunnyCookiePresets();
      let cloudWorkspace = createWorkspaceDoc();
      const writes: Array<Record<string, unknown>> = [];

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        workspaces: [cloudWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets,
        workspaceSettingsSaveAdapter: async (_wsId, updates) => {
          writes.push(updates);
          cloudWorkspace = { ...cloudWorkspace, ...(updates as Partial<Workspace>) };
        },
      });

      const editorOrder = [
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        'preset-1oz',
        'preset-4oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ];

      await store.setProductionOptionOrder(editorOrder);
      assert.equal(writes.length, 1);
      assert.deepEqual(Object.keys(writes[0]).sort(), ['productionOptionOrder', 'updatedAt']);
      assert.deepEqual(store.getProductionOptionOrder(), editorOrder);

      const editorOrderingHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets,
          productionOptionOrder: store.getProductionOptionOrder(),
          userRole: 'editor',
        })
      );
      assert.doesNotMatch(editorOrderingHtml, /Read-Only/i);
      assert.doesNotMatch(editorOrderingHtml, /prod-option-order-viewer-readonly/);
    });

    it('A3: Viewer cannot edit or save productionOptionOrder in UI or Store', async () => {
      const presets = createSunnyCookiePresets();
      const cloudWorkspace = createWorkspaceDoc();
      let writeAttempted = false;

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-viewer', role: 'viewer', workspaceId: 'ws-main' },
        workspaces: [cloudWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets,
        workspaceSettingsSaveAdapter: async () => {
          writeAttempted = true;
        },
      });

      await assert.rejects(
        () => store.setProductionOptionOrder(['preset-2_5oz', 'preset-2oz']),
        /Permission denied/i
      );
      assert.equal(writeAttempted, false);

      const viewerHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets,
          productionOptionOrder: store.getProductionOptionOrder(),
          userRole: 'viewer',
        })
      );
      assert.match(viewerHtml, /id="prod-option-order-viewer-readonly"/);
      assert.doesNotMatch(viewerHtml, /id="btn-save-prod-option-order"/);
    });

    it('A4: Rejected Firestore write surfaces error and NEVER mutates local workspace order', async () => {
      const presets = createSunnyCookiePresets();
      const initialOrder = [
        'preset-1oz',
        'preset-2oz',
        'preset-3oz',
        'preset-4oz',
        'preset-2_5oz',
      ];
      const cloudWorkspace = createWorkspaceDoc(initialOrder);

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [cloudWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets,
        workspaceSettingsSaveAdapter: async () => {
          const err = new Error('Missing or insufficient permissions.');
          (err as Error & { code?: string }).code = 'permission-denied';
          throw err;
        },
      });

      await assert.rejects(
        () =>
          store.setProductionOptionOrder([
            'preset-1oz',
            'preset-2oz',
            'preset-2_5oz',
            'preset-3oz',
            'preset-4oz',
          ]),
        /Missing or insufficient permissions/i
      );

      assert.deepEqual(
        store.getProductionOptionOrder(),
        initialOrder,
        'Failed cloud write must NEVER optimistically mutate authoritative local workspace order'
      );
    });

    it('A5: Missing workspace root document fails closed without auto-bootstrapping workspaces/ws-main and blocks saving', async () => {
      const presets = createSunnyCookiePresets();
      let saveCalled = false;

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [createWorkspaceDoc()],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets,
        workspaceSettingsSaveAdapter: async () => {
          saveCalled = true;
        },
      });

      // Authoritative server snapshot reports workspaces/ws-main does NOT exist
      store.simulateWorkspaceRealtimeSnapshotForTesting({
        workspaceId: 'ws-main',
        exists: false,
        fromCache: false,
      });

      assert.equal(store.getWorkspaceDocHydrationState(), 'ERROR');
      assert.equal(store.getProductionOptionOrder(), null);
      assert.equal(
        store.getWorkspaces().some((w) => w.id === 'ws-main'),
        false,
        'Stale cached workspace root document must be evicted when server confirms missing doc'
      );

      await assert.rejects(
        () => store.setProductionOptionOrder(['preset-2oz', 'preset-2_5oz', 'preset-3oz']),
        /not found|has not finished syncing/i
      );
      assert.equal(saveCalled, false, 'Must NEVER auto-recreate or write to a missing workspace doc');

      const warningHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets,
          productionOptionOrder: store.getProductionOptionOrder(),
          userRole: 'owner',
        })
      );
      assert.match(warningHtml, /id="prod-option-order-hydration-warning"/);
    });

    it('A6: Non-destructive Owner legacy order reconciliation detects phone 2.5 oz order, hides from tablet, promotes on explicit Owner action, and does not re-prompt', async () => {
      const presets = createSunnyCookiePresets();
      let cloudWorkspace = createWorkspaceDoc([
        'preset-1oz',
        'preset-2oz',
        'preset-3oz',
        'preset-4oz',
        'preset-2_5oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ]);

      const ownerPhoneLegacyOrder = [
        'preset-1oz',
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        'preset-4oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ];

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [cloudWorkspace],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets,
        localSettings: {
          ...BASE_SETTINGS,
          productionOptionOrder: ownerPhoneLegacyOrder,
        },
        workspaceSettingsSaveAdapter: async (_wsId, updates) => {
          cloudWorkspace = { ...cloudWorkspace, ...(updates as Partial<Workspace>) };
        },
      });

      // 1. Must NOT automatically overwrite workspace order before Owner acts
      assert.deepEqual(
        store.getProductionOptionOrder()?.slice(0, 5),
        ['preset-1oz', 'preset-2oz', 'preset-3oz', 'preset-4oz', 'preset-2_5oz']
      );

      // 2. Owner sees pending reconciliation candidate with clear comparison
      const inspection = store.inspectPendingProductionOrderMigration('ws-main');
      assert.ok(inspection);
      assert.equal(inspection.hasLegacyCandidate, true);
      assert.equal(inspection.hasDifferences, true);
      assert.deepEqual(inspection.candidateOrder, ownerPhoneLegacyOrder);

      const ownerHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets,
          productionOptionOrder: store.getProductionOptionOrder(),
          userRole: 'owner',
        })
      );
      assert.match(ownerHtml, /id="legacy-prod-order-reconciliation-banner"/);
      assert.match(ownerHtml, /id="btn-promote-legacy-prod-order"/);
      assert.match(ownerHtml, /id="btn-dismiss-legacy-prod-order"/);

      const collapsedSettingsHtml = renderToStaticMarkup(
        React.createElement(SettingsView, {
          settings: store.getSettings(),
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          presets,
          productionOptionOrder: store.getProductionOptionOrder(),
          userRole: 'owner',
          onUpdateSettings: () => {},
          onOpenUnitTests: () => {},
        })
      );
      assert.match(collapsedSettingsHtml, /id="settings-legacy-prod-order-alert"/);

      // 3. Viewer & Editor NEVER see Owner's legacy candidate
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-samsung-tablet', role: 'viewer', workspaceId: 'ws-main' },
      });
      assert.equal(store.inspectPendingProductionOrderMigration('ws-main'), null);

      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
      });
      assert.equal(store.inspectPendingProductionOrderMigration('ws-main'), null);

      // 4. Switch back to Owner and explicitly promote the phone's order
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      });

      const promoted = await store.promoteLegacyProductionOptionOrder('owner');
      assert.deepEqual(promoted, ownerPhoneLegacyOrder);
      assert.deepEqual(cloudWorkspace.productionOptionOrder, ownerPhoneLegacyOrder);
      assert.deepEqual(store.getProductionOptionOrder(), ownerPhoneLegacyOrder);

      // Legacy per-user setting was NOT destructively wiped
      assert.deepEqual(store.getSettings().productionOptionOrder, ownerPhoneLegacyOrder);

      // Even if another Editor later moves 4 oz first, the already-promoted stale candidate does NOT re-prompt
      const subsequentEditorOrder = [
        'preset-4oz',
        'preset-1oz',
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ];
      store.simulateWorkspaceRealtimeSnapshotForTesting({
        workspaceId: 'ws-main',
        exists: true,
        data: { ...cloudWorkspace, productionOptionOrder: subsequentEditorOrder },
        fromCache: false,
      });

      const afterLaterChange = store.inspectPendingProductionOrderMigration('ws-main');
      assert.equal(
        afterLaterChange?.hasDifferences,
        false,
        'Previously reconciled legacy candidate signature must not repeatedly reappear'
      );
    });

    it('A7: Strict numeric ounce boundary matching prevents 2 oz / 2.5 oz / 12 oz / 21 oz collisions and normalizes blank categories', () => {
      const p2 = {
        id: 'preset-a',
        userId: 'u',
        name: '2 oz Cookie',
        category: '',
        finishedWeight: 2,
        weightUnit: 'oz' as const,
        quantityPerUnit: 180,
        unitName: 'Case',
        createdAt: '',
        updatedAt: '',
      };
      const p25 = { ...p2, id: 'preset-b', name: '2.5 oz Cookie', finishedWeight: 2.5 };
      const p12 = { ...p2, id: 'preset-c', name: '12 oz Cookie Tub', finishedWeight: 12 };
      const p21 = { ...p2, id: 'preset-d', name: '21 oz Dough Block', finishedWeight: 21 };

      assert.equal(matchesPresetKey(p2, '2 oz'), true);
      assert.equal(matchesPresetKey(p25, '2 oz'), false);
      assert.equal(matchesPresetKey(p12, '2 oz'), false);
      assert.equal(matchesPresetKey(p21, '2 oz'), false);

      assert.equal(matchesPresetKey(p25, '2.5 oz'), true);
      assert.equal(matchesPresetKey(p2, '2.5 oz'), false);
      assert.equal(matchesPresetKey(p12, '12 oz'), true);
      assert.equal(matchesPresetKey(p2, 'preset-b'), false);

      const canonical = canonicalizeProductionOptionOrder(
        ['12 oz', '2 oz', '2.5 oz', '21 oz'],
        [p2, p25, p12, p21]
      );
      assert.deepEqual(canonical.slice(0, 4), ['preset-c', 'preset-a', 'preset-b', 'preset-d']);

      // Verify ProductionOptionOrderingSettings groups blank-category presets under 'Cookies'
      const orderingHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets: [p2, p25],
          productionOptionOrder: ['preset-a', 'preset-b'],
          userRole: 'owner',
          initialOpenCategoriesForTest: { Cookies: true },
        })
      );
      assert.match(orderingHtml, /2 oz Cookie/);
      assert.match(orderingHtml, /2\.5 oz Cookie/);
    });

    it('A8: Sign-out / workspace switch clears cached workspace order while preserving critical notes backups and Management PIN', () => {
      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [createWorkspaceDoc()],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets: createSunnyCookiePresets(),
      });
      memoryStorage.setItem('recipe_calc_workspaces', JSON.stringify([createWorkspaceDoc()]));

      store.simulateFirestoreSnapshotForTesting({
        event: 'auth_change',
        nextUid: null,
      });

      assert.equal(store.getProductionOptionOrder(), null);
      assert.equal(store.getWorkspaces().length, 0);
      assert.deepEqual(JSON.parse(memoryStorage.getItem('recipe_calc_workspaces') || '[]'), []);

      // Safety-critical local artifacts MUST remain untouched
      assert.ok(memoryStorage.getItem('recipe_calc_critical_notes'));
      assert.ok(memoryStorage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY));
      assert.ok(memoryStorage.getItem(MGMT_LOCK_STORAGE_KEY));
      assert.equal(memoryStorage.clearCalls, 0);
    });
  });

  // =========================================================================
  // SUITE B — Preset Enabled/Disabled
  // =========================================================================
  describe('Suite B — Preset Enabled/Disabled & Backward Compatibility', () => {
    it('B1: Legacy presets without productionEnabled default to Enabled; newly created presets default to productionEnabled: true', async () => {
      const legacyPresets = createSunnyCookiePresets();
      assert.equal(legacyPresets[2].productionEnabled, undefined);
      assert.equal(isPresetEnabledForProduction(legacyPresets[2]), true);

      const newModalState = createNewPresetEditorState({
        selectedCategory: 'Cookies',
        allCategories: ['Cookies'],
        existingPresetIds: legacyPresets.map((p) => p.id),
      });
      assert.equal(newModalState.editingPreset?.productionEnabled, true);

      let createdInCloud: ProductionPreset | null = null;
      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        workspaces: [createWorkspaceDoc()],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        presets: legacyPresets,
      });
      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        presets: legacyPresets,
        presetsHydrationState: 'READY',
        cloudAdapter: {
          createPreset: async (p) => {
            createdInCloud = p;
            return p;
          },
          transactPreset: async (_id, mutator) => mutator(legacyPresets[0]),
        },
      });

      const created = await store.createPreset({
        id: 'preset-5oz-jumbo',
        userId: 'uid-editor',
        workspaceId: 'ws-main',
        name: '5 oz Jumbo Cookie Case',
        category: 'Cookies',
        finishedWeight: 5,
        weightUnit: 'oz',
        quantityPerUnit: 72,
        unitName: 'Case',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      });

      assert.equal(created.productionEnabled, true);
      assert.equal((createdInCloud as ProductionPreset | null)?.productionEnabled, true);
    });

    it('B2: Owner & Editor can toggle productionEnabled; Viewer sees read-only status without toggle and is rejected by store', async () => {
      const cloudPresets = new Map<string, ProductionPreset>(
        createSunnyCookiePresets().map((p) => [p.id, { ...p }])
      );

      const adapter = {
        transactPreset: async (
          presetId: string,
          mutator: (remote: ProductionPreset | null) => ProductionPreset
        ) => {
          const current = cloudPresets.get(presetId) || null;
          const next = mutator(current ? { ...current } : null);
          cloudPresets.set(presetId, next);
          return next;
        },
      };

      // Editor disables preset-2_5oz
      store.configureCriticalNotesTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        presets: Array.from(cloudPresets.values()),
        presetsHydrationState: 'READY',
        cloudAdapter: adapter,
      });

      const disabledPreset = await store.setPresetProductionEnabled('preset-2_5oz', false);
      assert.equal(disabledPreset.productionEnabled, false);
      assert.equal(cloudPresets.get('preset-2_5oz')?.productionEnabled, false);

      // Owner re-enables preset-2_5oz
      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      });
      const reEnabledPreset = await store.setPresetProductionEnabled('preset-2_5oz', true);
      assert.equal(reEnabledPreset.productionEnabled, true);
      assert.equal(cloudPresets.get('preset-2_5oz')?.productionEnabled, true);

      // Viewer cannot toggle in store or UI
      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-samsung-tablet', role: 'viewer', workspaceId: 'ws-main' },
      });
      await assert.rejects(
        () => store.setPresetProductionEnabled('preset-2_5oz', false),
        /Permission denied/i
      );

      const editorManagerHtml = renderToStaticMarkup(
        React.createElement(PresetManager, {
          presets: store.getPresets(),
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          userRole: 'editor',
          onSavePreset: () => {},
          onDeletePreset: () => {},
          onTogglePresetProductionEnabled: () => {},
        })
      );
      assert.match(editorManagerHtml, /id="preset-floor-toggle-preset-2_5oz"/);
      assert.match(editorManagerHtml, /id="preset-floor-status-preset-2_5oz"/);

      const viewerManagerHtml = renderToStaticMarkup(
        React.createElement(PresetManager, {
          presets: store.getPresets(),
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          userRole: 'viewer',
          onSavePreset: () => {},
          onDeletePreset: () => {},
          onTogglePresetProductionEnabled: () => {},
        })
      );
      assert.match(viewerManagerHtml, /id="preset-floor-status-preset-2_5oz"/);
      assert.doesNotMatch(
        viewerManagerHtml,
        /id="preset-floor-toggle-preset-2_5oz"/,
        'Viewer must see status text only and NEVER an interactive toggle'
      );
    });

    it('B3: Disabled preset is hidden from Production Floor ONLY while remaining visible & usable in PresetManager, Management Calculator, and Quoting Selector', () => {
      const presets = createSunnyCookiePresets().map((p) =>
        p.id === 'preset-2_5oz' ? { ...p, productionEnabled: false } : p
      );

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [
          createWorkspaceDoc([
            'preset-1oz',
            'preset-2oz',
            'preset-2_5oz',
            'preset-3oz',
            'preset-4oz',
          ]),
        ],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets,
      });

      // 1. Production Floor: hidden when qty === 0
      const floorHtml = renderToStaticMarkup(
        React.createElement(ProductionModeView, {
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          presets,
          mixers: [HOBART_MIXER],
          settings: BASE_SETTINGS,
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          activeWorkspaceId: 'ws-main',
          initialRecipeId: 'rec-choc-chip-fs',
          onExit: () => {},
        })
      );
      assert.doesNotMatch(floorHtml, /id="card-prod-option-preset-preset-2_5oz"/);
      assert.match(floorHtml, /id="card-prod-option-preset-preset-2oz"/);
      assert.match(floorHtml, /id="card-prod-option-preset-preset-3oz"/);

      // 2. Management PresetManager: visible with "Hidden on Floor" status
      const presetManagerHtml = renderToStaticMarkup(
        React.createElement(PresetManager, {
          presets,
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          userRole: 'owner',
          onSavePreset: () => {},
          onDeletePreset: () => {},
        })
      );
      assert.match(presetManagerHtml, /2\.5 oz Cookie Case/);
      assert.match(presetManagerHtml, /Hidden on Floor/);

      // 3. Management ProductionCalculator: remains selectable in dropdown with (Hidden on Floor)
      const mgmtCalcHtml = renderToStaticMarkup(
        React.createElement(ProductionCalculator, {
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          presets,
          mixers: [HOBART_MIXER],
          settings: BASE_SETTINGS,
          userRole: 'owner',
          initialRecipeId: 'rec-choc-chip-fs',
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          activeWorkspaceId: 'ws-main',
          onStartGuidedMixing: () => {},
          onSaveToHistory: () => {},
        })
      );
      assert.match(
        mgmtCalcHtml,
        /2\.5 oz Cookie Case — 2\.5 oz \(144 \/ Case\) \(Hidden on Floor\)/
      );

      // 4. Quoting / Product Development PackagingPresetSelectorModal: remains visible & selectable
      const quotingModalHtml = renderToStaticMarkup(
        React.createElement(PackagingPresetSelectorModal, {
          isOpen: true,
          onClose: () => {},
          presets,
          categoryHint: 'Cookies',
          workspaceId: 'ws-main',
          onSelectPreset: () => {},
          onSelectCustom: () => {},
        })
      );
      assert.match(quotingModalHtml, /2\.5 oz Cookie Case/);
      assert.match(quotingModalHtml, /Hidden on Floor/);
      assert.match(quotingModalHtml, /Usable in Management/);
    });

    it('B4 & B5: Disabling preserves Critical Production Notes (4000-count chip note), 6% waste math, and exact ordering slot upon re-enable', async () => {
      const initialPresets = createSunnyCookiePresets();
      const cloudPresets = new Map<string, ProductionPreset>(
        initialPresets.map((p) => [p.id, { ...p }])
      );

      const savedOrder = [
        'preset-1oz',
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        'preset-4oz',
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
      ];

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        workspaces: [createWorkspaceDoc(savedOrder)],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets: initialPresets,
      });
      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets: initialPresets,
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        cloudAdapter: {
          transactPreset: async (id, mutator) => {
            const next = mutator(cloudPresets.get(id) || null);
            cloudPresets.set(id, next);
            return next;
          },
        },
      });

      // Disable 2.5 oz preset
      const afterDisable = await store.setPresetProductionEnabled('preset-2_5oz', false);
      assert.equal(afterDisable.productionEnabled, false);
      assert.equal(afterDisable.criticalNotes?.length, 1);
      assert.match(afterDisable.criticalNotes![0].note, /4000-count mini chocolate chips/);

      // Management Ordering editor still keeps 2.5 oz in its slot between 2 oz and 3 oz while disabled
      const orderingWhileDisabledHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets: store.getPresets(),
          productionOptionOrder: store.getProductionOptionOrder(),
          userRole: 'owner',
          initialOpenCategoriesForTest: { Cookies: true },
        })
      );
      const pos2 = orderingWhileDisabledHtml.indexOf('2 oz Cookie Case');
      const pos25 = orderingWhileDisabledHtml.indexOf('2.5 oz Cookie Case');
      const pos3 = orderingWhileDisabledHtml.indexOf('3 oz Cookie Case');
      assert.ok(pos2 < pos25 && pos25 < pos3, 'Disabled preset keeps its slot in Management ordering');
      assert.match(orderingWhileDisabledHtml, /Hidden on Floor/);

      // Four Seasons 6% waste calculation in Management remains identical while disabled
      const calcWhileDisabled = calculateProduction(
        FOUR_SEASONS_CHOC_CHIP_RECIPE,
        [
          {
            id: 'req-1',
            presetId: afterDisable.id,
            presetName: afterDisable.name,
            quantity: 2,
            piecesPerUnit: afterDisable.quantityPerUnit,
            itemWeight: afterDisable.finishedWeight,
            itemWeightUnit: afterDisable.weightUnit,
          },
        ],
        {
          defaultWastePercent: 6,
          mixer: HOBART_MIXER,
          defaultWeightUnit: 'lb',
        }
      );
      assert.equal(calcWhileDisabled.productionWastePercent, 6);
      assert.equal(calcWhileDisabled.totalPieces, 288);

      // Re-enable 2.5 oz preset -> immediately returns to exact slot between 2 oz and 3 oz on Floor
      await store.setPresetProductionEnabled('preset-2_5oz', true);
      const enabledPresets = store.getPresets().filter((p) => isPresetEnabledForProduction(p));
      const restoredFloorOrder = getOrderedProductionOptionKeys(
        enabledPresets,
        store.getProductionOptionOrder()
      );
      assert.deepEqual(restoredFloorOrder.slice(0, 5), [
        'preset-1oz',
        'preset-2oz',
        'preset-2_5oz',
        'preset-3oz',
        'preset-4oz',
      ]);
    });

    it('B6: Editing preset packaging without touching floor toggle preserves concurrent remote productionEnabled change', async () => {
      const initialPresets = createSunnyCookiePresets();
      const cloudPresets = new Map<string, ProductionPreset>(
        initialPresets.map((p) => [p.id, { ...p, productionEnabled: true }])
      );

      store.configureCriticalNotesTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        presets: Array.from(cloudPresets.values()),
        presetsHydrationState: 'READY',
        cloudAdapter: {
          transactPreset: async (id, mutator) => {
            const next = mutator(cloudPresets.get(id) || null);
            cloudPresets.set(id, next);
            return next;
          },
        },
      });

      // Editor opens Edit modal while productionEnabled === true
      const editState = createEditPresetEditorState(cloudPresets.get('preset-2_5oz')!);
      assert.equal(editState.productionEnabledTouched, false);

      // Meanwhile Owner on another device disables preset-2_5oz in Cloud Firestore
      cloudPresets.set('preset-2_5oz', {
        ...cloudPresets.get('preset-2_5oz')!,
        productionEnabled: false,
      });

      // Editor changes quantityPerUnit from 144 -> 150 without touching the floor switch
      editState.editingPreset = {
        ...editState.editingPreset!,
        quantityPerUnit: 150,
      };
      const submission = buildPresetSubmissionPayload(editState);
      assert.equal(submission.preserveRemoteProductionEnabled, true);

      await store.savePreset(submission.preset, {
        mode: submission.mode,
        preserveRemoteProductionEnabled: submission.preserveRemoteProductionEnabled,
      });

      const finalCloud = cloudPresets.get('preset-2_5oz')!;
      assert.equal(finalCloud.quantityPerUnit, 150);
      assert.equal(
        finalCloud.productionEnabled,
        false,
        'Unrelated modal edit must NOT revert concurrent remote productionEnabled=false'
      );
      assert.equal(finalCloud.criticalNotes?.length, 1);
    });
  });

  // =========================================================================
  // SUITE C — Active Production Batch Safety
  // =========================================================================
  describe('Suite C — Active Production Floor Calculation Safety When Disabled Remotely', () => {
    it('C1: Remotely disabling an active preset preserves batch weights, 6% waste, safety acknowledgment, and locks "+" while allowing "-", Clear, and Reset', () => {
      const initialPresets = createSunnyCookiePresets();

      store.configureAuthAndLockTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-samsung-tablet', role: 'viewer', workspaceId: 'ws-main' },
        workspaces: [
          createWorkspaceDoc([
            'preset-1oz',
            'preset-2oz',
            'preset-2_5oz',
            'preset-3oz',
            'preset-4oz',
          ]),
        ],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
        presets: initialPresets,
      });

      // Compute acknowledged safety signature for active 2.5 oz selection before disable
      const initialSafety = resolveApplicableSafetyInstructions({
        recipe: FOUR_SEASONS_CHOC_CHIP_RECIPE,
        presets: initialPresets,
        selectedPresetIds: ['preset-2_5oz'],
        activeWorkspaceId: 'ws-main',
      });
      assert.equal(initialSafety.hasSafetyNotes, true);

      // Remote snapshot disables preset-2_5oz while tablet has 2 cases selected and ing-flour checked
      const remotelyDisabledPresets = initialPresets.map((p) =>
        p.id === 'preset-2_5oz' ? { ...p, productionEnabled: false } : p
      );

      // Safety signature remains acknowledged because the safety note text did NOT change
      const postDisableSafety = resolveApplicableSafetyInstructions({
        recipe: FOUR_SEASONS_CHOC_CHIP_RECIPE,
        presets: remotelyDisabledPresets,
        selectedPresetIds: ['preset-2_5oz'],
        activeWorkspaceId: 'ws-main',
      });
      assert.equal(
        isSafetySignatureAcknowledged(postDisableSafety.signature, initialSafety.signature),
        true,
        'Disabling a preset must NOT invalidate an already acknowledged safety signature'
      );

      // Render active Production Floor screen with 2 cases of preset-2_5oz selected
      const activeFloorHtml = renderToStaticMarkup(
        React.createElement(ProductionModeView, {
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          presets: remotelyDisabledPresets,
          mixers: [HOBART_MIXER],
          settings: BASE_SETTINGS,
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          activeWorkspaceId: 'ws-main',
          initialRecipeId: 'rec-choc-chip-fs',
          initialPresetQuantitiesForTest: { 'preset-2_5oz': 2 },
          initialAcknowledgedSignatureForTest: initialSafety.signature,
          initialCheckedIngredientsForTest: { 'ing-flour': true },
          onExit: () => {},
        })
      );

      // 1. Warning banner & locked badge visible
      assert.match(activeFloorHtml, /id="prod-disabled-active-preset-warning"/);
      assert.match(activeFloorHtml, /id="badge-prod-preset-disabled-locked-preset-2_5oz"/);

      // 2. Active batch math is NOT zeroed: 2 cases * 144 = 288 cookies, 720 OZ NET, 6% waste intact
      assert.match(activeFloorHtml, /2 CASES/);
      assert.match(activeFloorHtml, /288 COOKIES/);
      assert.match(activeFloorHtml, /720 OZ NET/);
      assert.match(activeFloorHtml, /6% waste calculation/);

      // 3. "+" button is disabled, while "-", Clear, and Reset Batch remain active
      assert.match(
        activeFloorHtml,
        /<button[^>]*id="btn-prod-inc-preset-2_5oz"[^>]*disabled=""/
      );
      assert.doesNotMatch(
        activeFloorHtml,
        /<button[^>]*id="btn-prod-dec-preset-2_5oz"[^>]*disabled=""/
      );
      assert.match(activeFloorHtml, /id="btn-prod-clear-preset-2_5oz"/);
      assert.match(activeFloorHtml, /id="btn-prod-reset"/);

      // 4. If a real safety note text ALSO changes remotely, acknowledgment IS re-required
      const noteChangedPresets = remotelyDisabledPresets.map((p) =>
        p.id === 'preset-2_5oz'
          ? {
              ...p,
              criticalNotes: [
                {
                  ...p.criticalNotes![0],
                  note: 'UPDATED CRITICAL: Use 4000-count chips AND chill 30 min.',
                  updatedAt: '2026-01-05T00:00:00.000Z',
                },
              ],
            }
          : p
      );
      const updatedNoteSafety = resolveApplicableSafetyInstructions({
        recipe: FOUR_SEASONS_CHOC_CHIP_RECIPE,
        presets: noteChangedPresets,
        selectedPresetIds: ['preset-2_5oz'],
        activeWorkspaceId: 'ws-main',
      });
      assert.equal(
        isSafetySignatureAcknowledged(updatedNoteSafety.signature, initialSafety.signature),
        false
      );

      // 5. Once cleared (qty = 0), the disabled preset is hidden from Production Floor
      const clearedFloorHtml = renderToStaticMarkup(
        React.createElement(ProductionModeView, {
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          presets: remotelyDisabledPresets,
          mixers: [HOBART_MIXER],
          settings: BASE_SETTINGS,
          recipesHydrationState: 'READY',
          presetsHydrationState: 'READY',
          connectionVerified: true,
          activeWorkspaceId: 'ws-main',
          initialRecipeId: 'rec-choc-chip-fs',
          initialPresetQuantitiesForTest: {},
          onExit: () => {},
        })
      );
      assert.doesNotMatch(clearedFloorHtml, /id="card-prod-option-preset-preset-2_5oz"/);
      assert.doesNotMatch(clearedFloorHtml, /id="prod-disabled-active-preset-warning"/);
    });
  });

  // =========================================================================
  // SUITE D — Preset Deletion Permissions
  // =========================================================================
  describe('Suite D — Owner-Only Permanent Preset Deletion', () => {
    it('D1 & D2: Only Owner sees permanent preset delete control and can call store.deletePreset; Editor & Viewer are blocked', async () => {
      const presets = createSunnyCookiePresets();
      const deletedPresetIds: string[] = [];

      store.configureCriticalNotesTestHarness({
        storage: memoryStorage,
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        presets,
        presetsHydrationState: 'READY',
        cloudAdapter: {
          transactPreset: async (_id, mutator) => mutator(presets[0]),
          deletePreset: async (id) => {
            deletedPresetIds.push(id);
          },
        },
      });

      // Editor UI: can add, edit, and toggle Floor status, but CANNOT see permanent delete button
      const editorHtml = renderToStaticMarkup(
        React.createElement(PresetManager, {
          presets,
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          userRole: 'editor',
          onSavePreset: () => {},
          onDeletePreset: () => {},
          onTogglePresetProductionEnabled: () => {},
        })
      );
      assert.match(editorHtml, /id="preset-add-btn"/);
      assert.match(editorHtml, /id="preset-edit-btn-preset-2_5oz"/);
      assert.match(editorHtml, /id="preset-floor-toggle-preset-2_5oz"/);
      assert.doesNotMatch(editorHtml, /id="preset-delete-btn-preset-2_5oz"/);

      // Editor store call rejected
      await assert.rejects(() => store.deletePreset('preset-2_5oz'), /Only workspace owners/i);
      assert.equal(deletedPresetIds.length, 0);

      // Viewer store call rejected
      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-samsung-tablet', role: 'viewer', workspaceId: 'ws-main' },
      });
      await assert.rejects(() => store.deletePreset('preset-2_5oz'), /Only workspace owners/i);
      assert.equal(deletedPresetIds.length, 0);

      // Owner UI & store call succeed
      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      });
      const ownerHtml = renderToStaticMarkup(
        React.createElement(PresetManager, {
          presets,
          recipes: [FOUR_SEASONS_CHOC_CHIP_RECIPE],
          userRole: 'owner',
          onSavePreset: () => {},
          onDeletePreset: () => {},
          onTogglePresetProductionEnabled: () => {},
        })
      );
      assert.match(ownerHtml, /id="preset-delete-btn-preset-2_5oz"/);

      await store.deletePreset('preset-4oz');
      assert.deepEqual(deletedPresetIds, ['preset-4oz']);
      assert.equal(
        store.getPresets().some((p) => p.id === 'preset-4oz'),
        false
      );
    });
  });

  // =========================================================================
  // SUITE E — Security Rules Verification (firestore.rules + PolicySimulationEngine)
  // =========================================================================
  describe('Suite E — Firestore Security Rules Verification (Local Source + Policy Simulation)', () => {
    it('E1: firestore.rules text enforces bool productionEnabled on presets create/update, Owner-only presets/recipes delete, and narrow Editor workspace ordering update', () => {
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      const rulesText = fs.readFileSync(rulesPath, 'utf8');

      // Presets create/update validate optional bool productionEnabled AND preserve Stage 1.1 substring
      assert.match(
        rulesText,
        /\(!\('productionEnabled' in request\.resource\.data\) \|\| request\.resource\.data\.productionEnabled is bool\)/
      );
      assert.ok(
        rulesText.includes('isWorkspaceEditor(request.resource.data.workspaceId);'),
        'Must preserve exact Stage 1.1 safety assertion substring'
      );

      // Presets delete & Recipes delete are Owner-only
      const presetsMatchBlock = rulesText.split('match /presets/{presetId}')[1]?.split('match /')[0] || '';
      assert.match(
        presetsMatchBlock,
        /allow delete:\s*if isSignedIn\(\)\s*&&\s*resource\.data\.workspaceId != null\s*&&\s*isWorkspaceOwner\(resource\.data\.workspaceId\);/
      );
      assert.doesNotMatch(presetsMatchBlock, /allow delete:[\s\S]*isWorkspaceEditor/);

      const recipesMatchBlock = rulesText.split('match /recipes/{recipeId}')[1]?.split('match /')[0] || '';
      assert.match(
        recipesMatchBlock,
        /allow delete:\s*if isSignedIn\(\)\s*&&\s*resource\.data\.workspaceId != null\s*&&\s*isWorkspaceOwner\(resource\.data\.workspaceId\);/
      );

      // Narrow Editor workspace ordering rule remains intact
      assert.match(
        rulesText,
        /affectedKeys\(\)\.hasOnly\(\['productionOptionOrder', 'updatedAt'\]\)/
      );
      assert.match(rulesText, /request\.resource\.data\.productionOptionOrder is list/);
      assert.match(rulesText, /request\.resource\.data\.productionOptionOrder\.size\(\) <= 500/);
    });

    it('E2: PolicySimulationEngine enforces active membership, narrow Editor ordering writes, bool productionEnabled validation, and Owner-only deletion', () => {
      const engine = new PolicySimulationEngine();
      engine.setWorkspace('ws-main', 'uid-owner', 'Sunny Sweets');
      engine.setMember('ws-main', 'uid-owner', 'owner', 'jaoliveras@gmail.com', true);
      engine.setMember('ws-main', 'uid-editor', 'editor', 'leadbaker@sunnysweets.com', true);
      engine.setMember('ws-main', 'uid-viewer', 'viewer', 'sunnysweetsapopka@gmail.com', true);
      engine.setMember('ws-main', 'uid-inactive-editor', 'editor', 'former@sunnysweets.com', false);

      const ownerCtx = { auth: { uid: 'uid-owner', email: 'jaoliveras@gmail.com' }, workspaceId: 'ws-main' };
      const editorCtx = { auth: { uid: 'uid-editor', email: 'leadbaker@sunnysweets.com' }, workspaceId: 'ws-main' };
      const viewerCtx = { auth: { uid: 'uid-viewer', email: 'sunnysweetsapopka@gmail.com' }, workspaceId: 'ws-main' };
      const inactiveCtx = { auth: { uid: 'uid-inactive-editor', email: 'former@sunnysweets.com' }, workspaceId: 'ws-main' };

      const existingWsDoc = {
        id: 'ws-main',
        name: 'Sunny Sweets',
        ownerId: 'uid-owner',
        productionOptionOrder: ['preset-1oz', 'preset-2oz'],
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      // 1. Active Owner, Editor, Viewer can read workspace; inactive member denied
      assert.equal(engine.evaluateRequest(ownerCtx, 'read', 'workspaces', undefined, existingWsDoc), 'ALLOW');
      assert.equal(engine.evaluateRequest(editorCtx, 'read', 'workspaces', undefined, existingWsDoc), 'ALLOW');
      assert.equal(engine.evaluateRequest(viewerCtx, 'read', 'workspaces', undefined, existingWsDoc), 'ALLOW');
      assert.equal(engine.evaluateRequest(inactiveCtx, 'read', 'workspaces', undefined, existingWsDoc), 'DENY');

      // 2. Narrow productionOptionOrder update: Owner & Editor ALLOW; Viewer & inactive Editor DENY; broader Editor update DENY
      const narrowOrderDoc = {
        ...existingWsDoc,
        productionOptionOrder: ['preset-1oz', 'preset-2oz', 'preset-2_5oz', 'preset-3oz'],
        updatedAt: '2026-01-02T00:00:00.000Z',
      };
      assert.equal(
        engine.evaluateRequest(editorCtx, 'update', 'workspaces', narrowOrderDoc, existingWsDoc),
        'ALLOW'
      );
      assert.equal(
        engine.evaluateRequest(viewerCtx, 'update', 'workspaces', narrowOrderDoc, existingWsDoc),
        'DENY'
      );
      assert.equal(
        engine.evaluateRequest(inactiveCtx, 'update', 'workspaces', narrowOrderDoc, existingWsDoc),
        'DENY'
      );
      assert.equal(
        engine.evaluateRequest(
          editorCtx,
          'update',
          'workspaces',
          { ...narrowOrderDoc, name: 'Tampered Name' },
          existingWsDoc
        ),
        'DENY'
      );

      // 3. Presets create/update: bool or omitted productionEnabled ALLOW for Owner/Editor, DENY for Viewer; non-bool DENY for all
      const basePresetDoc = {
        id: 'preset-2_5oz',
        workspaceId: 'ws-main',
        name: '2.5 oz Cookie Case',
        finishedWeight: 2.5,
      };
      assert.equal(
        engine.evaluateRequest(
          editorCtx,
          'create',
          'presets',
          { ...basePresetDoc, productionEnabled: true }
        ),
        'ALLOW'
      );
      assert.equal(
        engine.evaluateRequest(
          editorCtx,
          'create',
          'presets',
          basePresetDoc // omitted productionEnabled
        ),
        'ALLOW'
      );
      assert.equal(
        engine.evaluateRequest(
          ownerCtx,
          'create',
          'presets',
          { ...basePresetDoc, productionEnabled: 'yes' }
        ),
        'DENY'
      );
      assert.equal(
        engine.evaluateRequest(
          editorCtx,
          'create',
          'presets',
          { ...basePresetDoc, productionEnabled: 1 }
        ),
        'DENY'
      );

      const existingPresetDoc = { ...basePresetDoc, productionEnabled: true };
      assert.equal(
        engine.evaluateRequest(
          editorCtx,
          'update',
          'presets',
          { ...basePresetDoc, productionEnabled: false },
          existingPresetDoc
        ),
        'ALLOW'
      );
      assert.equal(
        engine.evaluateRequest(
          viewerCtx,
          'update',
          'presets',
          { ...basePresetDoc, productionEnabled: false },
          existingPresetDoc
        ),
        'DENY'
      );

      // 4. Permanent preset & recipe deletion: Owner ALLOW, Editor & Viewer DENY
      assert.equal(
        engine.evaluateRequest(editorCtx, 'delete', 'presets', undefined, existingPresetDoc),
        'DENY'
      );
      assert.equal(
        engine.evaluateRequest(viewerCtx, 'delete', 'presets', undefined, existingPresetDoc),
        'DENY'
      );
      assert.equal(
        engine.evaluateRequest(ownerCtx, 'delete', 'presets', undefined, existingPresetDoc),
        'ALLOW'
      );

      const existingRecipeDoc = { id: 'rec-choc-chip-fs', workspaceId: 'ws-main' };
      assert.equal(
        engine.evaluateRequest(editorCtx, 'delete', 'recipes', undefined, existingRecipeDoc),
        'DENY'
      );
      assert.equal(
        engine.evaluateRequest(ownerCtx, 'delete', 'recipes', undefined, existingRecipeDoc),
        'ALLOW'
      );
    });
  });
});
