import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';
import { store } from '../src/services/store';
import {
  MANAGEMENT_HIDDEN_TIMEOUT_MS,
  MANAGEMENT_INACTIVITY_TIMEOUT_MS,
  ManagementAutoLockController,
  ManagementAutoLockReason,
  MGMT_LOCK_STORAGE_KEY,
} from '../src/utils/managementLock';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  StorageLike,
} from '../src/utils/criticalNotesReconciliation';
import { assertOwnerForPhase0Migration } from '../src/services/migration';
import { assertOwnerForRecovery, checkRecoveryEligibility } from '../src/services/recoveryService';
import { authorizeDevEndpointRequest } from '../server';
import { RecipeManager } from '../src/components/RecipeManager';
import { MixerManager } from '../src/components/MixerManager';
import { HistoryView } from '../src/components/HistoryView';
import { Dashboard } from '../src/components/Dashboard';
import { PresetManager } from '../src/components/PresetManager';
import { ProductionOptionOrderingSettings } from '../src/components/ProductionOptionOrderingSettings';
import { Recipe, Workspace, UserSettings, Mixer, ProductionHistoryEntry, ProductionPreset } from '../src/types';

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

class FakeTimerScheduler {
  public nowMs = 1_700_000_000_000;
  private nextId = 1;
  private tasks = new Map<number, { runAt: number; cb: () => void }>();

  public setTimeoutFn = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.tasks.set(id, { runAt: this.nowMs + Math.max(0, ms), cb });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  public clearTimeoutFn = (handle: ReturnType<typeof setTimeout>): void => {
    this.tasks.delete(handle as unknown as number);
  };

  public advanceBy(ms: number): void {
    const target = this.nowMs + ms;
    while (true) {
      let earliestId: number | null = null;
      let earliestTime = Infinity;
      for (const [id, task] of this.tasks.entries()) {
        if (task.runAt <= target && task.runAt < earliestTime) {
          earliestTime = task.runAt;
          earliestId = id;
        }
      }
      if (earliestId === null) break;
      const task = this.tasks.get(earliestId)!;
      this.tasks.delete(earliestId);
      this.nowMs = task.runAt;
      task.cb();
    }
    this.nowMs = target;
  }

  public jumpWallClockWithoutFiringTimers(ms: number): void {
    this.nowMs += ms;
  }
}

const BASE_SETTINGS: UserSettings = {
  userId: 'uid-test',
  defaultWeightUnit: 'g',
  defaultWastePercent: 5,
  decimalPlaces: 2,
  theme: 'light',
  businessName: 'Sunny Sweets',
  activeWorkspaceId: 'ws-main',
  workspaceName: 'Sunny Sweets Production',
  categoryPresetMap: {},
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SAMPLE_WORKSPACE: Workspace = {
  id: 'ws-main',
  name: 'Sunny Sweets Production',
  ownerId: 'uid-owner',
  ownerEmail: 'jaoliveras@gmail.com',
  code: 'SUNNY-MAIN',
  members: [],
  groups: [],
  productionFloorModeEnabled: true,
  productionOptionOrder: ['preset-1', 'preset-2'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SAMPLE_RECIPE: Recipe = {
  id: 'rec-test-1',
  userId: 'uid-owner',
  workspaceId: 'ws-main',
  name: 'Classic Sugar Cookie',
  description: '',
  category: 'Cookies',
  batchYieldQuantity: 24,
  batchYieldUnit: 'cookies',
  defaultWastePercent: 5,
  archived: false,
  ingredients: [
    { id: 'ing-1', name: 'Pastry Flour', quantity: 1000, unit: 'g' },
    { id: 'ing-2', name: 'Unsalted Butter', quantity: 500, unit: 'g' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Phase A — Management Editor Access & Security Hardening', () => {
  let memoryStorage: MemoryStorage;

  beforeEach(() => {
    memoryStorage = new MemoryStorage();
    memoryStorage.setItem(
      'recipe_calc_critical_notes',
      JSON.stringify([{ id: 'note-1', text: 'Chill dough 24h before sheeting' }])
    );
    memoryStorage.setItem(
      DURABLE_CRITICAL_NOTES_BACKUP_KEY,
      JSON.stringify({ preservedAt: '2026-01-01T00:00:00.000Z', records: [{ id: 'note-1' }] })
    );
    memoryStorage.setItem(
      MGMT_LOCK_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        salt: '0123456789abcdef0123456789abcdef',
        hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    );

    store.configureAuthAndLockTestHarness({
      storage: memoryStorage,
      session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      workspaces: [{ ...SAMPLE_WORKSPACE }],
      recipes: [{ ...SAMPLE_RECIPE }],
      activeWorkspaceId: 'ws-main',
      workspaceDocHydrationState: 'READY',
      workspaceDocSyncError: null,
      workspaceSettingsSaveAdapter: null,
      recipeDeleteAdapter: null,
    });
  });

  // =========================================================================
  // ITEM 1: FIRESTORE MEMBERSHIP SECURITY (active === true + role boundaries)
  // =========================================================================
  describe('1. Firestore Membership Security (active === true & role boundaries)', () => {
    it('firestore.rules enforces active == true in hasActiveMemberDoc and Owner-only recipe delete locally without deploying', () => {
      const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
      assert.match(rulesSource, /function\s+hasActiveMemberDoc\s*\(workspaceId\)/);
      assert.match(rulesSource, /\.data\.active\s*==\s*true/);
      assert.match(
        rulesSource,
        /affectedKeys\(\)\.hasOnly\(\['productionOptionOrder',\s*'updatedAt'\]\)/
      );
      assert.match(
        rulesSource,
        /match\s+\/recipes\/\{recipeId\}[\s\S]*?allow\s+delete:\s*if\s+isSignedIn\(\)\s*&&\s*resource\.data\.workspaceId\s*!=\s*null\s*&&\s*isWorkspaceOwner\(resource\.data\.workspaceId\);/
      );
    });

    it('denies inactive Owner, inactive Editor, and inactive Viewer across all operational collections', () => {
      const engine = new PolicySimulationEngine();
      engine.setMember('ws-main', 'uid-inactive-owner', 'owner', 'inactive-owner@test.com', false);
      engine.setMember('ws-main', 'uid-inactive-editor', 'editor', 'inactive-editor@test.com', false);
      engine.setMember('ws-main', 'uid-inactive-viewer', 'viewer', 'inactive-viewer@test.com', false);
      engine.setRawMemberForTesting('ws-main', 'uid-string-active', {
        role: 'editor',
        email: 'string-active@test.com',
        active: 'true',
      });

      const collections = [
        'recipes',
        'master_ingredients',
        'presets',
        'mixers',
        'history',
        'product_projects',
      ] as const;

      for (const uid of [
        'uid-inactive-owner',
        'uid-inactive-editor',
        'uid-inactive-viewer',
        'uid-string-active',
      ]) {
        for (const col of collections) {
          assert.strictEqual(
            engine.evaluateRequest(
              { auth: { uid, email: `${uid}@test.com` } },
              'read',
              col,
              { workspaceId: 'ws-main' }
            ),
            'DENY',
            `Expected ${uid} read on ${col} to be DENY`
          );
          assert.strictEqual(
            engine.evaluateRequest(
              { auth: { uid, email: `${uid}@test.com` } },
              'create',
              col,
              { workspaceId: 'ws-main' }
            ),
            'DENY',
            `Expected ${uid} create on ${col} to be DENY`
          );
        }
      }
    });

    it('preserves active Owner, active Editor operational writes, and active Viewer write denial', () => {
      const engine = new PolicySimulationEngine();
      engine.setMember('ws-main', 'uid-owner', 'owner', 'jaoliveras@gmail.com', true);
      engine.setMember('ws-main', 'uid-editor', 'editor', 'sunnysweetsapopka@gmail.com', true);
      engine.setMember('ws-main', 'uid-viewer', 'viewer', 'viewer@sunnysweets.test', true);

      const operationalCollections = [
        'recipes',
        'master_ingredients',
        'presets',
        'mixers',
        'history',
        'product_projects',
      ] as const;

      for (const col of operationalCollections) {
        const docPayload = { workspaceId: 'ws-main', name: 'Test Item' };
        // Viewer: read ALLOW, create/update/delete DENY
        assert.strictEqual(
          engine.evaluateRequest(
            { auth: { uid: 'uid-viewer', email: 'viewer@sunnysweets.test' } },
            'read',
            col,
            docPayload
          ),
          'ALLOW'
        );
        assert.strictEqual(
          engine.evaluateRequest(
            { auth: { uid: 'uid-viewer', email: 'viewer@sunnysweets.test' } },
            'create',
            col,
            docPayload
          ),
          'DENY'
        );
        assert.strictEqual(
          engine.evaluateRequest(
            { auth: { uid: 'uid-viewer', email: 'viewer@sunnysweets.test' } },
            'update',
            col,
            docPayload,
            docPayload
          ),
          'DENY'
        );

        // Editor: read/create/update ALLOW
        assert.strictEqual(
          engine.evaluateRequest(
            { auth: { uid: 'uid-editor', email: 'sunnysweetsapopka@gmail.com' } },
            'read',
            col,
            docPayload
          ),
          'ALLOW'
        );
        assert.strictEqual(
          engine.evaluateRequest(
            { auth: { uid: 'uid-editor', email: 'sunnysweetsapopka@gmail.com' } },
            'create',
            col,
            docPayload
          ),
          'ALLOW'
        );
        assert.strictEqual(
          engine.evaluateRequest(
            { auth: { uid: 'uid-editor', email: 'sunnysweetsapopka@gmail.com' } },
            'update',
            col,
            docPayload,
            docPayload
          ),
          'ALLOW'
        );
      }

      // Owner-only membership management: Editor denied on members create/update/delete
      assert.strictEqual(
        engine.evaluateRequest(
          { auth: { uid: 'uid-editor', email: 'sunnysweetsapopka@gmail.com' } },
          'create',
          'members',
          {
            workspaceId: 'ws-main',
            memberId: 'uid-new',
            uid: 'uid-new',
            role: 'viewer',
            active: true,
          }
        ),
        'DENY'
      );
      assert.strictEqual(
        engine.evaluateRequest(
          { auth: { uid: 'uid-owner', email: 'jaoliveras@gmail.com' } },
          'create',
          'members',
          {
            workspaceId: 'ws-main',
            memberId: 'uid-new',
            uid: 'uid-new',
            role: 'editor',
            active: true,
          }
        ),
        'ALLOW'
      );
    });
  });

  // =========================================================================
  // ITEM 2: EDITOR OPERATIONAL ACCESS & NO FALSE SUCCESS ON REJECTED WRITES
  // =========================================================================
  describe('2. Editor Operational Access & Remote-First Shared Settings Persistence', () => {
    it('allows Editor to save productionOptionOrder via narrow payload and rejects Viewer', async () => {
      const capturedUpdates: Array<{ wsId: string; updates: Record<string, unknown> }> = [];

      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        workspaces: [{ ...SAMPLE_WORKSPACE }],
        workspaceSettingsSaveAdapter: async (wsId, updates) => {
          capturedUpdates.push({ wsId, updates });
        },
      });

      await store.setProductionOptionOrder(['preset-2', 'preset-1', 'SYS:FULL_RECIPE']);

      assert.strictEqual(capturedUpdates.length, 1);
      assert.strictEqual(capturedUpdates[0].wsId, 'ws-main');
      assert.deepStrictEqual(
        Object.keys(capturedUpdates[0].updates).sort(),
        ['productionOptionOrder', 'updatedAt'],
        'Editor update payload must ONLY include productionOptionOrder and updatedAt'
      );
      assert.deepStrictEqual(store.getProductionOptionOrder(), [
        'preset-2',
        'preset-1',
        'SYS:FULL_RECIPE',
      ]);

      // Viewer must be rejected before calling remote adapter
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-viewer', role: 'viewer', workspaceId: 'ws-main' },
      });
      await assert.rejects(
        () => store.setProductionOptionOrder(['preset-1']),
        /Permission denied/i
      );
      assert.strictEqual(capturedUpdates.length, 1, 'Viewer must not trigger remote adapter');
    });

    it('keeps Production Floor Mode master switch strictly Owner-only (denies Editor and Viewer)', async () => {
      let adapterCalls = 0;
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        workspaces: [{ ...SAMPLE_WORKSPACE, productionFloorModeEnabled: true }],
        workspaceSettingsSaveAdapter: async () => {
          adapterCalls += 1;
        },
      });

      await assert.rejects(
        () => store.setProductionFloorModeEnabled(false),
        /Only workspace owners can enable or disable Production Floor Mode/i
      );
      assert.strictEqual(adapterCalls, 0);
      assert.strictEqual(store.isProductionFloorModeEnabled(), true);

      // Owner succeeds
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      });
      await store.setProductionFloorModeEnabled(false);
      assert.strictEqual(adapterCalls, 1);
      assert.strictEqual(store.isProductionFloorModeEnabled(), false);
    });

    it('prevents false success and misleading local persistence when Firestore rejects a shared workspace save', async () => {
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        workspaces: [{ ...SAMPLE_WORKSPACE, productionOptionOrder: ['preset-original'] }],
        workspaceSettingsSaveAdapter: async () => {
          const err: any = new Error('Missing or insufficient permissions.');
          err.code = 'permission-denied';
          throw err;
        },
      });

      await assert.rejects(
        () => store.setProductionOptionOrder(['preset-mutated']),
        /Missing or insufficient permissions/i
      );

      // Local workspace state MUST remain untouched!
      assert.deepStrictEqual(store.getProductionOptionOrder(), ['preset-original']);

      // And updateSettings() must strip shared workspace keys so failed remote saves never leak into per-user settings
      store.updateSettings({
        theme: 'dark',
        productionFloorModeEnabled: false,
        productionOptionOrder: ['leaked-order'],
        categoryPresetMap: { Cookies: ['All'] },
      } as any);
      assert.strictEqual(store.isProductionFloorModeEnabled(), true);
      assert.deepStrictEqual(store.getProductionOptionOrder(), ['preset-original']);
    });
  });

  // =========================================================================
  // ITEM 3: DANGEROUS ADMINISTRATIVE TOOLS & /api/dev/* HARDENING
  // =========================================================================
  describe('3. Dangerous Administrative Tools & /api/dev/* Endpoint Hardening', () => {
    it('restricts Backup Import, Legacy Data Recovery, and Phase 0 Migration helpers to Owners', () => {
      // Phase 0 Migration
      assert.throws(() => assertOwnerForPhase0Migration('editor'), /restricted to workspace Owners/i);
      assert.throws(() => assertOwnerForPhase0Migration('viewer'), /restricted to workspace Owners/i);
      assert.throws(() => assertOwnerForPhase0Migration(null), /restricted to workspace Owners/i);
      assert.doesNotThrow(() => assertOwnerForPhase0Migration('owner'));

      // Legacy Data Recovery
      assert.throws(() => assertOwnerForRecovery('editor'), /restricted to workspace Owners/i);
      assert.throws(() => assertOwnerForRecovery('viewer'), /restricted to workspace Owners/i);
      assert.doesNotThrow(() => assertOwnerForRecovery('owner'));

      const editorRecovery = checkRecoveryEligibility(
        { email: 'jaoliveras@gmail.com', uid: 'uid-editor' },
        'ws-main',
        'editor',
        true
      );
      assert.strictEqual(editorRecovery.eligible, false);

      // Backup Import in Store
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
      });
      assert.throws(() => store.assertOwnerForBackupImport(), /Only workspace owners/i);

      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      });
      assert.doesNotThrow(() => store.assertOwnerForBackupImport());
    });

    it('hardens /api/dev/* endpoints: disabled in production, 401 without valid token, 403 for non-Owners, 200 for active Owner', async () => {
      // 1. Disabled in production even with valid Owner token
      const prodDecision = await authorizeDevEndpointRequest({
        nodeEnv: 'production',
        authorizationHeader: 'Bearer valid-owner-token',
        verifyToken: async () => ({ uid: 'uid-owner', email: 'jaoliveras@gmail.com' }),
        verifyOwner: async () => true,
      });
      assert.strictEqual(prodDecision.allowed, false);
      assert.strictEqual(prodDecision.status, 403);

      // 2. Missing / invalid Bearer token -> 401
      const unauthDecision = await authorizeDevEndpointRequest({
        nodeEnv: 'development',
        authorizationHeader: undefined,
        verifyToken: async () => null,
        verifyOwner: async () => true,
      });
      assert.strictEqual(unauthDecision.allowed, false);
      assert.strictEqual(unauthDecision.status, 401);

      // 3. Authenticated Editor / Viewer -> 403
      const editorDecision = await authorizeDevEndpointRequest({
        nodeEnv: 'development',
        authorizationHeader: 'Bearer editor-token',
        verifyToken: async () => ({ uid: 'uid-editor', email: 'sunnysweetsapopka@gmail.com' }),
        verifyOwner: async () => false,
      });
      assert.strictEqual(editorDecision.allowed, false);
      assert.strictEqual(editorDecision.status, 403);

      // 4. Active Workspace Owner in development -> 200
      const ownerDecision = await authorizeDevEndpointRequest({
        nodeEnv: 'development',
        authorizationHeader: 'Bearer owner-token',
        verifyToken: async () => ({ uid: 'uid-owner', email: 'jaoliveras@gmail.com' }),
        verifyOwner: async (uid, wsId) => uid === 'uid-owner' && wsId === 'ws-main',
      });
      assert.strictEqual(ownerDecision.allowed, true);
      assert.strictEqual(ownerDecision.status, 200);
      assert.strictEqual(ownerDecision.uid, 'uid-owner');
    });

    it('removes legacy Navbar People & Groups buttons and AccessManagementModal wiring', () => {
      const navbarSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/Navbar.tsx'),
        'utf8'
      );
      const appSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/AuthorizedRecipeCalculatorApp.tsx'),
        'utf8'
      );

      assert.strictEqual(navbarSource.includes('People & Groups'), false);
      assert.strictEqual(navbarSource.includes('onOpenAccessModal'), false);
      assert.strictEqual(appSource.includes('AccessManagementModal'), false);
      assert.strictEqual(appSource.includes('executeReadOnlyInventoryDiagnostic'), false);
    });
  });

  // =========================================================================
  // ITEM 4: PERMANENT RECIPE DELETE (Owner-Only; Archive Preserved for Editor)
  // =========================================================================
  describe('4. Permanent Recipe Delete Restricted to Owner (Archive Preserved for Editor)', () => {
    it('blocks Editor and Viewer from permanently deleting recipes in store, while allowing Owner', async () => {
      let deletedId: string | null = null;

      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor', role: 'editor', workspaceId: 'ws-main' },
        recipes: [{ ...SAMPLE_RECIPE }],
        recipeDeleteAdapter: async (id) => {
          deletedId = id;
        },
      });

      await assert.rejects(
        () => store.deleteRecipe(SAMPLE_RECIPE.id),
        /Only workspace owners can permanently delete recipes/i
      );
      assert.strictEqual(deletedId, null);
      assert.strictEqual(store.getRecipes(true).length, 1, 'Recipe must remain intact when Editor is denied');

      // Viewer also denied
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-viewer', role: 'viewer', workspaceId: 'ws-main' },
      });
      await assert.rejects(
        () => store.deleteRecipe(SAMPLE_RECIPE.id),
        /Only workspace owners can permanently delete recipes/i
      );
      assert.strictEqual(deletedId, null);

      // Owner succeeds
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-owner', role: 'owner', workspaceId: 'ws-main' },
      });
      await store.deleteRecipe(SAMPLE_RECIPE.id);
      assert.strictEqual(deletedId, SAMPLE_RECIPE.id);
      assert.strictEqual(store.getRecipes(true).length, 0);
    });

    it('renders Archive button for Editors and permanent Delete button ONLY for Owners in RecipeManager', () => {
      const editorHtml = renderToStaticMarkup(
        React.createElement(RecipeManager, {
          userRole: 'editor',
          recipes: [SAMPLE_RECIPE],
          masterIngredients: [],
          history: [],
          settings: BASE_SETTINGS,
          onSaveRecipe: () => {},
          onDuplicateRecipe: () => {},
          onArchiveRecipe: () => {},
          onDeleteRecipe: () => {},
          onSelectRecipeForCalc: () => {},
        })
      );
      assert.match(editorHtml, /id="recipe-archive-btn-rec-test-1"/);
      assert.doesNotMatch(editorHtml, /id="recipe-delete-btn-rec-test-1"/);

      const ownerHtml = renderToStaticMarkup(
        React.createElement(RecipeManager, {
          userRole: 'owner',
          recipes: [SAMPLE_RECIPE],
          masterIngredients: [],
          history: [],
          settings: BASE_SETTINGS,
          onSaveRecipe: () => {},
          onDuplicateRecipe: () => {},
          onArchiveRecipe: () => {},
          onDeleteRecipe: () => {},
          onSelectRecipeForCalc: () => {},
        })
      );
      assert.match(ownerHtml, /id="recipe-archive-btn-rec-test-1"/);
      assert.match(ownerHtml, /id="recipe-delete-btn-rec-test-1"/);
    });
  });

  // =========================================================================
  // ITEM 5: VIEWER UI CONSISTENCY
  // =========================================================================
  describe('5. Viewer Read-Only UI Consistency Across Management Views', () => {
    it('hides edit/create/delete controls for Viewers in MixerManager, HistoryView, Dashboard, PresetManager, and ProductionOptionOrderingSettings', () => {
      const sampleMixer: Mixer = {
        id: 'mix-1',
        userId: 'uid-owner',
        workspaceId: 'ws-main',
        name: 'Hobart 60Qt',
        maxWeight: 80,
        weightUnit: 'lb',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const mixerViewerHtml = renderToStaticMarkup(
        React.createElement(MixerManager, {
          mixers: [sampleMixer],
          userRole: 'viewer',
          onSaveMixer: () => {},
          onDeleteMixer: () => {},
        })
      );
      assert.match(mixerViewerHtml, /id="mixer-viewer-readonly-banner"/);
      assert.doesNotMatch(mixerViewerHtml, /id="mixer-add-btn"/);
      assert.doesNotMatch(mixerViewerHtml, /id="mixer-edit-btn-mix-1"/);
      assert.doesNotMatch(mixerViewerHtml, /id="mixer-delete-btn-mix-1"/);

      const sampleHistory: ProductionHistoryEntry = {
        id: 'hist-1',
        userId: 'uid-owner',
        workspaceId: 'ws-main',
        recipeId: SAMPLE_RECIPE.id,
        recipeName: SAMPLE_RECIPE.name,
        calculatedAt: '2026-01-01T00:00:00.000Z',
        requirements: [],
        totalPieces: 24,
        totalFinishedWeightGrams: 1500,
        displayBatchWeight: 1500,
        displayWeightUnit: 'g',
        scalingMultiplier: 1,
        wastePercent: 5,
        capacityExceeded: false,
        capacityOverridden: false,
        suggestedBatches: 1,
        calculatedIngredients: [],
        status: 'completed',
      };
      const historyViewerHtml = renderToStaticMarkup(
        React.createElement(HistoryView, {
          history: [sampleHistory],
          userRole: 'viewer',
          onDeleteHistoryEntry: () => {},
          onReopenInCalculator: () => {},
        })
      );
      assert.doesNotMatch(historyViewerHtml, /id="history-delete-btn-hist-1"/);

      const dashboardViewerHtml = renderToStaticMarkup(
        React.createElement(Dashboard, {
          mode: 'management',
          userRole: 'viewer',
          recipes: [SAMPLE_RECIPE],
          presets: [],
          mixers: [],
          history: [],
          settings: BASE_SETTINGS,
          activeChecklist: null,
          setActiveTab: () => {},
          onOpenRecipeModal: () => {},
          onResumeChecklist: () => {},
          onResetChecklist: () => {},
          onDeleteChecklist: () => {},
          onRunUnitTests: () => {},
        })
      );
      assert.doesNotMatch(dashboardViewerHtml, /id="dashboard-new-recipe-btn"/);

      const samplePreset: ProductionPreset = {
        id: 'preset-1',
        userId: 'uid-owner',
        workspaceId: 'ws-main',
        name: '12-Pack Tray',
        category: 'Cookies',
        finishedWeight: 50,
        weightUnit: 'g',
        quantityPerUnit: 12,
        unitName: 'tray',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const presetViewerHtml = renderToStaticMarkup(
        React.createElement(PresetManager, {
          presets: [samplePreset],
          recipes: [SAMPLE_RECIPE],
          userRole: 'viewer',
          onSavePreset: () => {},
          onDeletePreset: () => {},
        })
      );
      assert.match(presetViewerHtml, /id="preset-viewer-readonly-banner"/);

      const orderingEditorHtml = renderToStaticMarkup(
        React.createElement(ProductionOptionOrderingSettings, {
          presets: [samplePreset],
          userRole: 'editor',
        })
      );
      assert.doesNotMatch(orderingEditorHtml, /Read-Only/i);
    });
  });

  // =========================================================================
  // ITEM 6: SHARED-TABLET MANAGEMENT PIN AUTO-LOCK (15m idle / >60s hidden)
  // =========================================================================
  describe('6. Shared-Tablet Management PIN Auto-Lock (15m Inactivity & >60s Hidden)', () => {
    it('auto-locks after 15 minutes of inactivity and resets timer when user interacts', () => {
      const scheduler = new FakeTimerScheduler();
      const reasons: ManagementAutoLockReason[] = [];

      const controller = new ManagementAutoLockController({
        now: () => scheduler.nowMs,
        setTimer: scheduler.setTimeoutFn,
        clearTimer: scheduler.clearTimeoutFn,
        onAutoLock: (r) => reasons.push(r),
      });

      controller.start(false);

      // Advance 10 minutes -> user taps screen -> advance another 10 minutes (total 20m, only 10m idle)
      scheduler.advanceBy(10 * 60 * 1000);
      assert.strictEqual(reasons.length, 0);
      controller.recordActivity();

      scheduler.advanceBy(10 * 60 * 1000);
      assert.strictEqual(reasons.length, 0, 'Activity must reset the 15-minute idle countdown');

      // Advance remaining 5 minutes -> reaches 15 minutes idle -> auto-locks!
      scheduler.advanceBy(5 * 60 * 1000);
      assert.deepStrictEqual(reasons, ['inactivity_timeout']);
      controller.stop();
    });

    it('auto-locks when tab/screen is hidden for >60 seconds (both timer and Android Doze wall-clock resume), but NOT for brief <60s switches', () => {
      const scheduler = new FakeTimerScheduler();
      const reasons: ManagementAutoLockReason[] = [];

      const controller = new ManagementAutoLockController({
        now: () => scheduler.nowMs,
        setTimer: scheduler.setTimeoutFn,
        clearTimer: scheduler.clearTimeoutFn,
        onAutoLock: (r) => reasons.push(r),
      });

      controller.start(false);

      // Brief 30s tab switch does NOT auto-lock
      controller.handleVisibilityChange(true);
      scheduler.advanceBy(30 * 1000);
      controller.handleVisibilityChange(false);
      assert.strictEqual(reasons.length, 0);

      // Simulate Android tablet screen-off where JS timers pause during Doze, then wake up 65s later
      controller.handleVisibilityChange(true);
      scheduler.jumpWallClockWithoutFiringTimers(MANAGEMENT_HIDDEN_TIMEOUT_MS + 5_000);
      controller.handleVisibilityChange(false);
      assert.deepStrictEqual(reasons, ['hidden_timeout']);
      controller.stop();
    });

    it('keeps Management Mode subtree hidden (not unmounted) across auto-lock so unsaved edits survive PIN re-entry', () => {
      const appSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/AuthorizedRecipeCalculatorApp.tsx'),
        'utf8'
      );
      assert.strictEqual(MANAGEMENT_INACTIVITY_TIMEOUT_MS, 15 * 60 * 1000);
      assert.strictEqual(MANAGEMENT_HIDDEN_TIMEOUT_MS, 60 * 1000);
      assert.match(appSource, /hasMountedManagementSession/);
      assert.match(
        appSource,
        /requiresManagementPinChallenge\s*\?\s*'hidden'/
      );
    });
  });

  // =========================================================================
  // ITEM 7: REAL-TIME MEMBERSHIP REVOCATION / ROLE-CHANGE HANDLING & BACKUPS
  // =========================================================================
  describe('7. Real-Time Membership Revocation / Role-Change Handling & Backup Preservation', () => {
    it('immediately updates role and increments securityEpoch on live Editor -> Viewer downgrade', () => {
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-tablet', role: 'editor', workspaceId: 'ws-main' },
      });

      const initialEpoch = store.getMembershipSecurityEpoch();
      assert.strictEqual(store.getUserRole(), 'editor');

      store.simulateCurrentUserMembershipRealtimeUpdateForTesting({
        uid: 'uid-tablet',
        workspaceId: 'ws-main',
        exists: true,
        role: 'viewer',
        active: true,
      });

      assert.strictEqual(store.getUserRole(), 'viewer');
      assert.strictEqual(store.isAuthorized(), true);
      assert.strictEqual(store.getMembershipSecurityEpoch(), initialEpoch + 1);
      assert.strictEqual(store.getLastMembershipSecurityEvent()?.reason, 'role_downgrade');
    });

    it('immediately revokes session on live deactivation (active: false) or member deletion while preserving local Critical Notes & PIN backups', () => {
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-tablet', role: 'editor', workspaceId: 'ws-main' },
      });
      const initialEpoch = store.getMembershipSecurityEpoch();

      // Stale generation event must be ignored
      store.simulateCurrentUserMembershipRealtimeUpdateForTesting({
        uid: 'uid-tablet',
        workspaceId: 'ws-main',
        generation: store.getListenerGenerationForTesting() - 1,
        exists: false,
      });
      assert.strictEqual(store.isAuthorized(), true);

      // Live deactivation (active: false) immediately revokes authorization
      store.simulateCurrentUserMembershipRealtimeUpdateForTesting({
        uid: 'uid-tablet',
        workspaceId: 'ws-main',
        exists: true,
        role: 'editor',
        active: false,
      });

      assert.strictEqual(store.isAuthorized(), false);
      assert.strictEqual(store.getUserRole(), null);
      assert.strictEqual(store.getAppAccessState(), 'NO_WORKSPACE');
      assert.strictEqual(store.getMembershipSecurityEpoch(), initialEpoch + 1);
      assert.strictEqual(store.getLastMembershipSecurityEvent()?.reason, 'deactivated');

      // Local storage & durable backups MUST remain 100% intact
      assert.strictEqual(memoryStorage.clearCalls, 0);
      assert.ok(memoryStorage.getItem('recipe_calc_critical_notes'));
      assert.ok(memoryStorage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY));
      assert.ok(memoryStorage.getItem(MGMT_LOCK_STORAGE_KEY));
    });

    it('preserves Samsung tablet Firebase Auth persistence hierarchy in src/services/firebase.ts', () => {
      const firebaseSource = fs.readFileSync(
        path.resolve(process.cwd(), 'src/services/firebase.ts'),
        'utf8'
      );
      assert.match(
        firebaseSource,
        /persistence:\s*\[\s*browserLocalPersistence,\s*indexedDBLocalPersistence,\s*browserSessionPersistence,?\s*\]/
      );
    });
  });
});
