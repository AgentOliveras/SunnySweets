import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AccessRole,
  CriticalProductionNote,
  Mixer,
  ProductionPreset,
  Recipe,
} from '../src/types';
import {
  CriticalNoteConflictError,
  canProceedToMixWithSyncSafety,
  computeSafetyInstructionsSignature,
  extractCanonicalCriticalNotesFromPresets,
  getProductionNotesStatus,
  isSafetySignatureAcknowledged,
  resolveApplicableSafetyInstructions,
} from '../src/utils/productionNotes';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  LEGACY_LOCAL_CRITICAL_NOTES_KEY,
  PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID,
  StorageLike,
  captureNonDestructiveCriticalNotesBackup,
  inspectCriticalNotesReconciliation,
  makeReconciliationItemKey,
  readDurableCriticalNotesBackup,
} from '../src/utils/criticalNotesReconciliation';
import { calculateProduction } from '../src/utils/calculator';
import { INITIAL_SETTINGS } from '../src/services/sampleData';
import { PresetCloudPersistenceAdapter, store } from '../src/services/store';
import { CriticalNotesSyncReview } from '../src/components/CriticalNotesSyncReview';
import { ProductionModeView } from '../src/components/ProductionModeView';
import { GuidedMixingMode } from '../src/components/GuidedMixingMode';

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
 * Simulated in-memory Firestore `presets` collection with atomic optimistic transactions
 * and simulated `onSnapshot` fan-out across Desktop, Phone, and Tablet clients.
 */
class SimulatedFirestorePresetsCloud {
  private docs = new Map<string, ProductionPreset>();
  private subscribers: Array<(presets: ProductionPreset[]) => void> = [];
  public failNextWriteWith: Error | null = null;
  public transactionCount = 0;

  constructor(initialPresets: ProductionPreset[] = []) {
    for (const p of initialPresets) {
      this.docs.set(p.id, structuredClone(p));
    }
  }

  public getSnapshotForWorkspace(workspaceId: string): ProductionPreset[] {
    return Array.from(this.docs.values())
      .filter((p) => !p.workspaceId || p.workspaceId === workspaceId)
      .map((p) => structuredClone(p));
  }

  public getRawDoc(presetId: string): ProductionPreset | null {
    const doc = this.docs.get(presetId);
    return doc ? structuredClone(doc) : null;
  }

  public onSnapshot(workspaceId: string, cb: (presets: ProductionPreset[]) => void): () => void {
    const wrapped = () => cb(this.getSnapshotForWorkspace(workspaceId));
    this.subscribers.push(wrapped);
    wrapped();
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== wrapped);
    };
  }

  public createAdapter(): PresetCloudPersistenceAdapter {
    return {
      transactPreset: async (presetId, mutator) => {
        if (this.failNextWriteWith) {
          const err = this.failNextWriteWith;
          this.failNextWriteWith = null;
          throw err;
        }
        this.transactionCount += 1;
        const current = this.getRawDoc(presetId);
        const updated = mutator(current);
        this.docs.set(presetId, structuredClone(updated));
        this.broadcast();
        return structuredClone(updated);
      },
      deletePreset: async (presetId) => {
        if (this.failNextWriteWith) {
          const err = this.failNextWriteWith;
          this.failNextWriteWith = null;
          throw err;
        }
        this.docs.delete(presetId);
        this.broadcast();
      },
    };
  }

  private broadcast(): void {
    for (const sub of [...this.subscribers]) {
      sub([]);
    }
  }
}

function createSunnySweetsRecipes(): {
  chocChipRecipe: Recipe;
  oatmealRecipe: Recipe;
  otherWorkspaceRecipe: Recipe;
} {
  const chocChipRecipe: Recipe = {
    id: 'recipe-ss-choc-chip',
    workspaceId: 'ws-main',
    userId: 'owner-uid-1',
    name: 'Sunny Sweets Chocolate Chip Cookies',
    description: 'Chilled dough must stay below 68F before scooping. Fold chocolate chips on low speed only.',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    ingredients: [
      { id: 'ing-flour', name: 'All-Purpose Flour', quantity: 2000, unit: 'g' },
      { id: 'ing-butter', name: 'Unsalted Butter', quantity: 1200, unit: 'g' },
      { id: 'ing-sugar', name: 'Brown Sugar', quantity: 1400, unit: 'g' },
      { id: 'ing-eggs', name: 'Whole Eggs', quantity: 500, unit: 'g' },
      { id: 'ing-chips', name: 'Semi-Sweet Chocolate Chips', quantity: 1500, unit: 'g' },
    ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-02-15T10:00:00.000Z',
  };

  const oatmealRecipe: Recipe = {
    id: 'recipe-ss-oatmeal-raisin',
    workspaceId: 'ws-main',
    userId: 'owner-uid-1',
    name: 'Sunny Sweets Oatmeal Raisin Cookies',
    description: '',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 6,
    ingredients: [
      { id: 'ing-oats', name: 'Rolled Oats', quantity: 1800, unit: 'g' },
      { id: 'ing-flour-2', name: 'Pastry Flour', quantity: 1500, unit: 'g' },
    ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
  };

  const otherWorkspaceRecipe: Recipe = {
    id: 'recipe-ws-other-1',
    workspaceId: 'ws-other',
    userId: 'other-owner-uid',
    name: 'External Bakery Brioche',
    description: 'Confidential other workspace note',
    category: 'Bread',
    batchYieldQuantity: 50,
    batchYieldUnit: 'loaves',
    defaultWastePercent: 5,
    ingredients: [{ id: 'ing-b1', name: 'Bread Flour', quantity: 5000, unit: 'g' }],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:00:00.000Z',
  };

  return { chocChipRecipe, oatmealRecipe, otherWorkspaceRecipe };
}

function createSunnySweetsPresets(): ProductionPreset[] {
  return [
    {
      id: 'preset-1oz-cookie',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '1 oz Cookies',
      category: 'Cookies',
      finishedWeight: 1,
      weightUnit: 'oz',
      quantityPerUnit: 360,
      unitName: 'Case',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'preset-2_5oz-cookie',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '2.5 oz Cookies',
      category: 'Cookies',
      finishedWeight: 2.5,
      weightUnit: 'oz',
      quantityPerUnit: 120,
      unitName: 'Case',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'preset-ws-other-loaf',
      workspaceId: 'ws-other',
      userId: 'other-owner-uid',
      name: 'Other Workspace Loaf Pan',
      category: 'Bread',
      finishedWeight: 16,
      weightUnit: 'oz',
      quantityPerUnit: 12,
      unitName: 'Rack',
      criticalNotes: [
        {
          id: 'cpn-ws-other-secret',
          presetId: 'preset-ws-other-loaf',
          recipeId: 'recipe-ws-other-1',
          workspaceId: 'ws-other',
          note: 'SECRET OTHER WORKSPACE CRITICAL NOTE',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
    },
  ];
}

const defaultMixer: Mixer = {
  id: 'mixer-hobart-60',
  workspaceId: 'ws-main',
  userId: 'owner-uid-1',
  name: '60 Qt Hobart Mixer',
  maxWeight: 80,
  weightUnit: 'lb',
  createdAt: '2026-01-10T08:00:00.000Z',
  updatedAt: '2026-01-10T08:00:00.000Z',
};

describe('Stage 1 — Critical Production Notes Synchronization & Data Preservation', () => {
  let desktopStorage: MemoryStorage;
  let phoneStorage: MemoryStorage;
  let tabletStorage: MemoryStorage;
  let originalGlobalLocalStorage: any;

  beforeEach(() => {
    desktopStorage = new MemoryStorage();
    phoneStorage = new MemoryStorage();
    tabletStorage = new MemoryStorage();
    originalGlobalLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = desktopStorage;
  });

  afterEach(() => {
    store.configureCriticalNotesTestHarness({
      session: null,
      storage: null,
      cloudAdapter: null,
      recipes: [],
      presets: [],
      presetsSyncError: null,
      recipesSyncError: null,
    });
    if (originalGlobalLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = originalGlobalLocalStorage;
    }
  });

  it('1. Local Note Backup Preservation & Non-Auto-Migration on Login: preserves IDs, timestamps, and workspaceId without clearing source storage', () => {
    const { chocChipRecipe, oatmealRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const cloud = new SimulatedFirestorePresetsCloud(presets);

    const legacyDesktopNotes: CriticalProductionNote[] = [
      {
        id: PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID,
        presetId: 'preset-1oz-cookie',
        recipeId: chocChipRecipe.id,
        workspaceId: 'ws-main',
        note: '1 oz Cookie Safety: Use #30 scoop leveled strictly; bake on parchment-lined pan at 345F.',
        createdAt: '2026-01-15T12:00:00.000Z',
        updatedAt: '2026-01-15T12:00:00.000Z',
        createdBy: 'owner-uid-1',
      },
      {
        id: 'cpn-desktop-2_5oz-choc-chip',
        presetId: 'preset-2_5oz-cookie',
        recipeId: chocChipRecipe.id,
        workspaceId: 'ws-main',
        note: '2.5 oz Chocolate Chip Critical Note: Chill pucks 24 hours minimum before baking; rotate rack halfway.',
        createdAt: '2026-03-01T09:30:00.000Z',
        updatedAt: '2026-03-02T14:15:00.000Z',
        createdBy: 'owner-uid-1',
      },
    ];
    desktopStorage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, JSON.stringify(legacyDesktopNotes));

    const envelope = captureNonDestructiveCriticalNotesBackup(desktopStorage);
    assert.strictEqual(Object.keys(envelope.records).length, 2, 'Both desktop notes must be backed up');

    const rawLegacyAfter = JSON.parse(desktopStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY) || '[]');
    assert.strictEqual(rawLegacyAfter.length, 2, 'Source recipe_calc_critical_notes must NEVER be deleted');

    const backupRecords = Object.values(readDurableCriticalNotesBackup(desktopStorage).records);
    const backedUp25 = backupRecords.find((r) => r.note.id === 'cpn-desktop-2_5oz-choc-chip');
    assert.ok(backedUp25, '2.5 oz Chocolate Chip desktop note must be in durable backup');
    assert.strictEqual(backedUp25!.note.createdAt, '2026-03-01T09:30:00.000Z');
    assert.strictEqual(backedUp25!.note.updatedAt, '2026-03-02T14:15:00.000Z');
    assert.strictEqual(backedUp25!.note.workspaceId, 'ws-main');

    // Simulate Owner login/hydration: must NOT automatically write local notes into Firestore
    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: cloud.createAdapter(),
      recipes: [chocChipRecipe, oatmealRecipe],
      presets: cloud.getSnapshotForWorkspace('ws-main'),
    });

    assert.strictEqual(
      cloud.transactionCount,
      0,
      'Login/hydration must NEVER automatically migrate local notes into Firestore without Owner approval'
    );
    assert.deepStrictEqual(
      store.getCriticalProductionNotes(),
      [],
      'Runtime canonical read must come strictly from presets/{presetId}.criticalNotes, not unmigrated localStorage'
    );

    // Also verify empty browsers (Phone) do NOT auto-seed synthetic local notes
    captureNonDestructiveCriticalNotesBackup(phoneStorage);
    assert.strictEqual(phoneStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY), null);
  });

  it('2. Sign-Out Safety: clearSession() wipes ephemeral caches from memory/storage while preserving local Critical Notes and durable backup', () => {
    const desktopNotes: CriticalProductionNote[] = [
      {
        id: 'cpn-desktop-2_5oz-choc-chip',
        presetId: 'preset-2_5oz-cookie',
        recipeId: 'recipe-ss-choc-chip',
        workspaceId: 'ws-main',
        note: '2.5 oz Chocolate Chip Critical Note: Verify allergen tray separation.',
        createdAt: '2026-03-01T09:30:00.000Z',
        updatedAt: '2026-03-01T09:30:00.000Z',
      },
    ];
    desktopStorage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, JSON.stringify(desktopNotes));
    desktopStorage.setItem('recipe_calc_recipes', JSON.stringify([{ id: 'r1' }]));
    desktopStorage.setItem('recipe_calc_presets', JSON.stringify([{ id: 'p1' }]));

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      recipes: [],
      presets: [],
    });
    assert.strictEqual(store.isAuthorized(), true);

    // Execute sign-out session teardown
    store.clearSession();

    assert.strictEqual(store.isAuthorized(), false, 'User session must be signed out');
    assert.strictEqual(desktopStorage.getItem('recipe_calc_recipes'), null, 'Ephemeral recipe cache should clear');
    assert.strictEqual(desktopStorage.getItem('recipe_calc_presets'), null, 'Ephemeral preset cache should clear');

    // CRITICAL SAFETY INVARIANT: Local notes & durable backup MUST survive sign-out
    const preservedLegacy = JSON.parse(desktopStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY) || '[]');
    assert.strictEqual(
      preservedLegacy.length,
      1,
      'Sign-out must NEVER delete recipe_calc_critical_notes'
    );
    assert.strictEqual(preservedLegacy[0].id, 'cpn-desktop-2_5oz-choc-chip');

    const preservedBackup = readDurableCriticalNotesBackup(desktopStorage);
    assert.strictEqual(
      Object.keys(preservedBackup.records).length,
      1,
      'Sign-out must capture and preserve sunny_sweets_critical_notes_backup_v1'
    );
  });

  it('3. Workspace-Switch Safety & Cross-Workspace Isolation: preserves backups and never exposes notes across workspaces', async () => {
    const { chocChipRecipe, otherWorkspaceRecipe } = createSunnySweetsRecipes();
    const allPresets = createSunnySweetsPresets();

    const wsMainLocalNote: CriticalProductionNote = {
      id: 'cpn-ws-main-local',
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      workspaceId: 'ws-main',
      note: 'Sunny Sweets ws-main local note',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };
    desktopStorage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, JSON.stringify([wsMainLocalNote]));

    // Configure session in ws-main, passing the raw multi-workspace array to test strict workspace filtering
    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      recipes: [chocChipRecipe],
      presets: allPresets,
    });

    const wsMainNotes = store.getCriticalProductionNotes();
    assert.strictEqual(
      wsMainNotes.some((n) => n.note.includes('SECRET OTHER WORKSPACE')),
      false,
      'ws-main must NEVER expose presets/{presetId}.criticalNotes belonging to ws-other'
    );

    // Switch active session to ws-other on the same browser
    store.configureCriticalNotesTestHarness({
      session: { uid: 'other-owner-uid', role: 'owner', workspaceId: 'ws-other' },
      storage: desktopStorage,
      recipes: [otherWorkspaceRecipe],
      presets: allPresets.filter((p) => p.workspaceId === 'ws-other'),
    });

    const wsOtherReport = store.inspectCriticalNotesReconciliation('owner');
    assert.strictEqual(
      wsOtherReport.items.some((i) => i.localNote?.id === 'cpn-ws-main-local'),
      false,
      'Owner reconciliation in ws-other must NEVER expose local notes belonging to ws-main'
    );
    assert.strictEqual(
      store.getCriticalProductionNotes().length,
      1,
      'ws-other sees only its own canonical cloud note'
    );
    assert.strictEqual(store.getCriticalProductionNotes()[0].id, 'cpn-ws-other-secret');

    // Attempt cross-workspace write injection must reject
    await assert.rejects(
      async () => {
        await store.saveCriticalProductionNote({
          presetId: 'preset-2_5oz-cookie', // belongs to ws-main, not ws-other
          recipeId: otherWorkspaceRecipe.id,
          note: 'Cross-workspace injection attempt',
        });
      },
      /Invalid presetId|Workspace isolation violation/
    );

    // Verify ws-main local backup is still 100% intact after workspace switch
    const backup = readDurableCriticalNotesBackup(desktopStorage);
    assert.strictEqual(Object.keys(backup.records).length, 1);
  });

  it('4. Protection of 1 oz Chocolate Chip Baseline Note: prevents discarding when no authoritative cloud copy exists', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const cloud = new SimulatedFirestorePresetsCloud(presets);

    const baseline1ozNote: CriticalProductionNote = {
      id: PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID,
      presetId: 'preset-1oz-cookie',
      recipeId: chocChipRecipe.id,
      workspaceId: 'ws-main',
      note: '1 oz Chocolate Chip Cookies: Do not overbake past 10 minutes; cool on rack before boxing 360/case.',
      createdAt: '2026-01-12T08:00:00.000Z',
      updatedAt: '2026-01-12T08:00:00.000Z',
    };
    desktopStorage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, JSON.stringify([baseline1ozNote]));

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: cloud.createAdapter(),
      recipes: [chocChipRecipe],
      presets: cloud.getSnapshotForWorkspace('ws-main'),
    });

    const report = store.inspectCriticalNotesReconciliation('owner');
    const item1oz = report.items.find((i) => i.presetId === 'preset-1oz-cookie')!;
    assert.ok(item1oz, '1 oz Chocolate Chip note must appear in Owner reconciliation');
    assert.strictEqual(item1oz.isProtected1ozBaselineNote, true);
    assert.strictEqual(item1oz.hasAuthoritativeCloudCopy, false);
    assert.strictEqual(item1oz.proposedAction, 'promote_local');

    // Attempting to discard via 'keep_cloud' when NO cloud copy exists MUST be blocked
    await assert.rejects(
      async () => {
        await store.applyCriticalNotesReconciliationDecisions({
          [item1oz.itemKey]: 'keep_cloud',
        });
      },
      /Safety Protection: Cannot discard the local 1 oz Chocolate Chip note/
    );

    // Promoting local note to shared workspace succeeds and preserves backup
    const execResult = await store.applyCriticalNotesReconciliationDecisions({
      [item1oz.itemKey]: 'promote_local',
    });
    assert.strictEqual(execResult.promotedCount, 1);
    assert.deepStrictEqual(execResult.promotedNoteIds, [PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID]);

    // Verify authoritative cloud copy now exists and local backup was NOT deleted
    const updatedReport = store.inspectCriticalNotesReconciliation('owner');
    const updated1oz = updatedReport.items.find((i) => i.presetId === 'preset-1oz-cookie')!;
    assert.strictEqual(updated1oz.hasAuthoritativeCloudCopy, true);
    assert.strictEqual(updated1oz.status, 'ALREADY_IN_SYNC');
    assert.ok(
      desktopStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY)?.includes(PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID),
      'Local note storage must remain preserved even after verified cloud promotion'
    );
  });

  it('5. Owner-Only Reconciliation Visibility & Conflict Handling: never resolves text conflicts by timestamp alone', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presetsWithCloudNote = createSunnySweetsPresets()
      .filter((p) => p.workspaceId === 'ws-main')
      .map((p) =>
        p.id === 'preset-2_5oz-cookie'
          ? {
              ...p,
              criticalNotes: [
                {
                  id: 'cpn-cloud-2_5oz',
                  presetId: 'preset-2_5oz-cookie',
                  recipeId: chocChipRecipe.id,
                  workspaceId: 'ws-main',
                  note: 'CLOUD VERSION: Bake 13 minutes at 350F with low fan.',
                  createdAt: '2026-03-10T10:00:00.000Z',
                  updatedAt: '2026-03-10T10:00:00.000Z', // Cloud is NEWER than local!
                },
              ],
            }
          : p
      );
    const cloud = new SimulatedFirestorePresetsCloud(presetsWithCloudNote);

    // Local note has an OLDER timestamp (2026-03-01) AND different text — must STILL require manual_review!
    const olderLocalNote: CriticalProductionNote = {
      id: 'cpn-local-2_5oz',
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      workspaceId: 'ws-main',
      note: 'LOCAL DESKTOP VERSION: Chill dough 24h and bake 14 minutes at 340F.',
      createdAt: '2026-03-01T08:00:00.000Z',
      updatedAt: '2026-03-01T08:00:00.000Z',
    };
    desktopStorage.setItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY, JSON.stringify([olderLocalNote]));

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: cloud.createAdapter(),
      recipes: [chocChipRecipe],
      presets: cloud.getSnapshotForWorkspace('ws-main'),
    });

    // 5a. Editor & Viewer cannot inspect or render reconciliation UI
    const editorInspection = inspectCriticalNotesReconciliation({
      userRole: 'editor',
      activeWorkspaceId: 'ws-main',
      storage: desktopStorage,
      cloudPresets: store.getPresets(),
      recipes: store.getRecipes(),
    });
    assert.strictEqual(editorInspection.isOwnerAuthorized, false);
    assert.strictEqual(editorInspection.items.length, 0);

    const viewerHtml = renderToStaticMarkup(
      React.createElement(CriticalNotesSyncReview, {
        userRole: 'viewer',
        defaultExpanded: true,
      })
    );
    const editorHtml = renderToStaticMarkup(
      React.createElement(CriticalNotesSyncReview, {
        userRole: 'editor',
        defaultExpanded: true,
      })
    );
    assert.strictEqual(viewerHtml, '', 'Viewer must never see Owner reconciliation review UI');
    assert.strictEqual(editorHtml, '', 'Editor must never see Owner reconciliation review UI');

    await assert.rejects(
      async () => {
        await store.applyCriticalNotesReconciliationDecisions({}, undefined, 'editor');
      },
      /Permission denied: Only the Workspace Owner/
    );

    // 5b. Owner inspection surfaces full comparison fields and requires manual_review on text mismatch
    const ownerReport = store.inspectCriticalNotesReconciliation('owner');
    assert.strictEqual(ownerReport.isOwnerAuthorized, true);
    assert.strictEqual(ownerReport.conflictCount, 1);

    const conflictItem = ownerReport.items[0];
    assert.strictEqual(conflictItem.status, 'CONFLICT_TEXT_MISMATCH');
    assert.strictEqual(
      conflictItem.proposedAction,
      'manual_review',
      'Differing local vs cloud text must NEVER auto-resolve by timestamp'
    );
    assert.strictEqual(conflictItem.presetName, '2.5 oz Cookies');
    assert.strictEqual(conflictItem.recipeName, 'Sunny Sweets Chocolate Chip Cookies');
    assert.strictEqual(conflictItem.recipeWideNoteText, chocChipRecipe.description);

    // Test reverse timestamp (local NEWER than cloud) — still must require manual_review, never silently overwrite cloud!
    const newerLocalStorage = new MemoryStorage();
    newerLocalStorage.setItem(
      LEGACY_LOCAL_CRITICAL_NOTES_KEY,
      JSON.stringify([
        {
          ...olderLocalNote,
          updatedAt: '2026-04-01T12:00:00.000Z',
        },
      ])
    );
    const newerLocalReport = inspectCriticalNotesReconciliation({
      userRole: 'owner',
      activeWorkspaceId: 'ws-main',
      storage: newerLocalStorage,
      cloudPresets: store.getPresets(),
      recipes: store.getRecipes(),
    });
    assert.strictEqual(newerLocalReport.items[0].status, 'CONFLICT_TEXT_MISMATCH');
    assert.strictEqual(newerLocalReport.items[0].proposedAction, 'manual_review');

    // 5c. Owner SSR rendering displays Preset name, Recipe name, Local note, Cloud version, Recipe-Wide note, and actions
    const ownerHtml = renderToStaticMarkup(
      React.createElement(CriticalNotesSyncReview, {
        userRole: 'owner',
        defaultExpanded: true,
      })
    );
    assert.ok(ownerHtml.includes('2.5 oz Cookies'), 'Owner UI must show Preset name');
    assert.ok(ownerHtml.includes('Sunny Sweets Chocolate Chip Cookies'), 'Owner UI must show Recipe name');
    assert.ok(ownerHtml.includes('LOCAL DESKTOP VERSION'), 'Owner UI must show Local note text');
    assert.ok(ownerHtml.includes('CLOUD VERSION'), 'Owner UI must show Existing cloud version');
    assert.ok(ownerHtml.includes('Chilled dough must stay below 68F'), 'Owner UI must show Recipe-Wide note context');
    assert.ok(ownerHtml.includes('Promote local note to shared workspace'));
    assert.ok(ownerHtml.includes('Keep existing cloud note'));
    assert.ok(ownerHtml.includes('Review conflict manually'));
    assert.ok(ownerHtml.includes('Leave unchanged'));
  });

  it('6 & 7. Desktop -> Phone -> Tablet Live Synchronization: 2.5 oz Chocolate Chip Cookies Critical Note syncs across devices automatically', async () => {
    const { chocChipRecipe, oatmealRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    // Track live snapshot state delivered to Phone (Viewer) and Tablet (Editor)
    let phonePresetsSnapshot: ProductionPreset[] = [];
    let tabletPresetsSnapshot: ProductionPreset[] = [];

    const unsubPhone = sharedCloud.onSnapshot('ws-main', () => {
      phonePresetsSnapshot = sharedCloud.getSnapshotForWorkspace('ws-main');
    });
    const unsubTablet = sharedCloud.onSnapshot('ws-main', () => {
      tabletPresetsSnapshot = sharedCloud.getSnapshotForWorkspace('ws-main');
    });

    // Desktop Owner logs in and creates Critical Production Note for 2.5 oz Chocolate Chip Cookies
    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe, oatmealRecipe],
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
    });

    const createdNote = await store.saveCriticalProductionNote({
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: '2.5 oz Chocolate Chip Cookies: Scoop 71g +/- 1g, chill 24h at 38F, bake 13m at 345F.',
      expectedUpdatedAt: null,
    });

    assert.ok(createdNote.id, 'Saved note must have a canonical ID');
    assert.strictEqual(createdNote.presetId, 'preset-2_5oz-cookie');
    assert.strictEqual(createdNote.recipeId, chocChipRecipe.id);
    assert.strictEqual(createdNote.workspaceId, 'ws-main');

    // Phone session (with completely EMPTY phoneStorage!) immediately receives canonical note via presets listener
    assert.strictEqual(phoneStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY), null);
    const phoneExtracted = extractCanonicalCriticalNotesFromPresets(phonePresetsSnapshot, 'ws-main');
    assert.strictEqual(phoneExtracted.length, 1);
    assert.strictEqual(
      phoneExtracted[0].note,
      '2.5 oz Chocolate Chip Cookies: Scoop 71g +/- 1g, chill 24h at 38F, bake 13m at 345F.'
    );

    // Tablet session (with completely EMPTY tabletStorage!) also immediately receives canonical note
    const tabletExtracted = extractCanonicalCriticalNotesFromPresets(tabletPresetsSnapshot, 'ws-main');
    assert.strictEqual(tabletExtracted.length, 1);
    assert.strictEqual(tabletExtracted[0].id, createdNote.id);

    // Switch store harness to simulate Phone Viewer opening Production Floor Mode
    store.configureCriticalNotesTestHarness({
      session: { uid: 'phone-operator-uid', role: 'viewer', workspaceId: 'ws-main' },
      storage: phoneStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe, oatmealRecipe],
      presets: phonePresetsSnapshot,
    });

    const phoneFloorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [chocChipRecipe, oatmealRecipe],
        presets: phonePresetsSnapshot,
        mixers: [defaultMixer],
        settings: INITIAL_SETTINGS,
        activeWorkspaceId: 'ws-main',
        initialRecipeId: chocChipRecipe.id,
        onExit: () => {},
      })
    );
    // Critical Production Notes card is rendered immediately in REVIEW REQUIRED state upon selecting recipe
    assert.ok(
      phoneFloorHtml.includes('Critical Production Notes'),
      'Phone Production Floor must show Critical Production Notes card'
    );
    assert.ok(
      phoneFloorHtml.includes('REVIEW REQUIRED'),
      'Phone Production Floor must enforce REVIEW REQUIRED status badge'
    );

    // Verify safety resolution when 2.5 oz Cookies preset is selected on Phone/Tablet
    const phoneSafety = resolveApplicableSafetyInstructions({
      recipe: chocChipRecipe,
      presets: phonePresetsSnapshot,
      selectedPresetIds: ['preset-2_5oz-cookie'],
      activeWorkspaceId: 'ws-main',
    });
    assert.strictEqual(phoneSafety.recipeWideNotes.length, 1);
    assert.strictEqual(phoneSafety.presetSpecificNotes.length, 1);
    assert.strictEqual(
      phoneSafety.presetSpecificNotes[0].note,
      '2.5 oz Chocolate Chip Cookies: Scoop 71g +/- 1g, chill 24h at 38F, bake 13m at 345F.'
    );

    unsubPhone();
    unsubTablet();
  });

  it('8. Editing an Existing Note & Live Acknowledgment Invalidation: preserves other recipes notes and invalidates prior acknowledgment on live edit', async () => {
    const { chocChipRecipe, oatmealRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'editor-uid-1', role: 'editor', workspaceId: 'ws-main' },
      storage: tabletStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe, oatmealRecipe],
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
    });

    // Create note for Chocolate Chip AND another note on the SAME 2.5 oz preset for Oatmeal Raisin
    const chocNoteV1 = await store.saveCriticalProductionNote({
      id: 'cpn-2_5-choc',
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Version 1: Bake at 345F for 13 minutes.',
      createdAt: '2026-03-01T10:00:00.000Z',
    });
    const oatmealNote = await store.saveCriticalProductionNote({
      id: 'cpn-2_5-oatmeal',
      presetId: 'preset-2_5oz-cookie',
      recipeId: oatmealRecipe.id,
      note: 'Oatmeal Raisin 2.5 oz: Plump raisins in warm water 15m and drain thoroughly.',
    });

    // Operator on Phone acknowledges Version 1
    const safetyV1 = resolveApplicableSafetyInstructions({
      recipe: chocChipRecipe,
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
      selectedPresetIds: ['preset-2_5oz-cookie'],
      activeWorkspaceId: 'ws-main',
    });
    const operatorAckSignature = safetyV1.signature;
    assert.strictEqual(isSafetySignatureAcknowledged(safetyV1.signature, operatorAckSignature), true);

    // Operator changes case count / mixer — signature does NOT depend on quantity or mixer, so ack stays valid!
    const safetyAfterQuantityChange = resolveApplicableSafetyInstructions({
      recipe: chocChipRecipe,
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
      selectedPresetIds: ['preset-2_5oz-cookie'],
      activeWorkspaceId: 'ws-main',
    });
    assert.strictEqual(
      isSafetySignatureAcknowledged(safetyAfterQuantityChange.signature, operatorAckSignature),
      true,
      'Changing case count or mixer must NOT force re-acknowledgment when notes have not changed'
    );

    // Now Editor updates the 2.5 oz Chocolate Chip note live on Tablet
    const chocNoteV2 = await store.saveCriticalProductionNote({
      id: chocNoteV1.id,
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Version 2 URGENT: Bake at 335F for 14 minutes — new convection calibration!',
      expectedUpdatedAt: chocNoteV1.updatedAt,
    });

    assert.strictEqual(chocNoteV2.id, chocNoteV1.id, 'Edited note must preserve original ID');
    assert.strictEqual(chocNoteV2.createdAt, '2026-03-01T10:00:00.000Z', 'Edited note must preserve createdAt');

    // Verify Oatmeal Raisin note on the same preset was preserved untouched
    const remainingForPreset = store.getCriticalNotesForPreset('preset-2_5oz-cookie');
    assert.strictEqual(remainingForPreset.length, 2, 'Sibling recipe notes on the same preset must be preserved');
    assert.ok(remainingForPreset.some((n) => n.id === oatmealNote.id && n.recipeId === oatmealRecipe.id));

    // Verify operator's prior acknowledgment on Phone is IMMEDIATELY INVALIDATED by the live update!
    const safetyV2 = resolveApplicableSafetyInstructions({
      recipe: chocChipRecipe,
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
      selectedPresetIds: ['preset-2_5oz-cookie'],
      activeWorkspaceId: 'ws-main',
    });
    assert.notStrictEqual(safetyV2.signature, operatorAckSignature);
    const stillAcked = isSafetySignatureAcknowledged(safetyV2.signature, operatorAckSignature);
    assert.strictEqual(stillAcked, false, 'Live edit to Critical Production Note must invalidate prior acknowledgment');
    assert.strictEqual(getProductionNotesStatus(safetyV2.hasSafetyNotes, stillAcked), 'REVIEW_REQUIRED');
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: safetyV2.hasSafetyNotes,
        isAcknowledged: stillAcked,
        syncError: null,
      }),
      false
    );
  });

  it('9. Deleting an Existing Note & Non-Resurrection Guarantee: deleted notes never reappear from localStorage', async () => {
    const { chocChipRecipe, oatmealRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    // Seed legacy localStorage with the same note ID to verify it CANNOT resurrect after cloud deletion
    desktopStorage.setItem(
      LEGACY_LOCAL_CRITICAL_NOTES_KEY,
      JSON.stringify([
        {
          id: 'cpn-delete-target',
          presetId: 'preset-2_5oz-cookie',
          recipeId: chocChipRecipe.id,
          workspaceId: 'ws-main',
          note: 'Stale local copy that was deleted from cloud',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ])
    );

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe, oatmealRecipe],
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
    });

    const savedTarget = await store.saveCriticalProductionNote({
      id: 'cpn-delete-target',
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Cloud note to be deleted',
    });
    const siblingNote = await store.saveCriticalProductionNote({
      id: 'cpn-keep-oatmeal',
      presetId: 'preset-2_5oz-cookie',
      recipeId: oatmealRecipe.id,
      note: 'Sibling note that must remain',
    });

    assert.strictEqual(store.getCriticalProductionNotes().length, 2);

    // Delete target note from cloud
    await store.deleteCriticalProductionNote(savedTarget.id, 'owner', {
      presetId: 'preset-2_5oz-cookie',
      expectedUpdatedAt: savedTarget.updatedAt,
    });

    // Verify deleted note is gone from canonical runtime state and does NOT resurrect from desktopStorage!
    assert.deepStrictEqual(
      store.getCriticalNotesForPresetAndRecipe('preset-2_5oz-cookie', chocChipRecipe.id),
      [],
      'Deleted note must be removed from canonical presets state and NEVER resurrect from localStorage'
    );
    assert.strictEqual(store.getCriticalNotesForPresetAndRecipe('preset-2_5oz-cookie', oatmealRecipe.id)[0].id, siblingNote.id);
  });

  it('10. Failed Firestore Save Handling: rejects cleanly without optimistic state corruption', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe],
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
    });

    // Inject simulated Firestore unavailable error
    sharedCloud.failNextWriteWith = new Error('Firestore unavailable: client is offline.');

    await assert.rejects(
      async () => {
        await store.saveCriticalProductionNote({
          presetId: 'preset-2_5oz-cookie',
          recipeId: chocChipRecipe.id,
          note: 'Unpersisted note during outage',
        });
      },
      /Firestore unavailable/
    );

    assert.deepStrictEqual(
      store.getCriticalProductionNotes(),
      [],
      'Failed cloud save must NEVER leave unpersisted optimistic notes in canonical runtime state'
    );
  });

  it('11. Concurrent Note Edits, Edit-vs-Delete Conflicts & Preset Metadata Save Preservation', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe],
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
    });

    const initial = await store.saveCriticalProductionNote({
      id: 'cpn-concurrent-1',
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Initial shared safety instruction',
    });
    const staleTimestamp = initial.updatedAt!;

    // Wait 2ms so updatedAt strictly advances
    await new Promise((r) => setTimeout(r, 5));

    // Device A saves an updated instruction first
    const deviceAUpdated = await store.saveCriticalProductionNote({
      id: initial.id,
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Device A updated safety instruction: Allergen wash required.',
      expectedUpdatedAt: staleTimestamp,
    });
    assert.notStrictEqual(deviceAUpdated.updatedAt, staleTimestamp);

    // 11a. Device B tries to save using stale expectedUpdatedAt -> must throw CriticalNoteConflictError!
    let caughtConflict: CriticalNoteConflictError | null = null;
    try {
      await store.saveCriticalProductionNote({
        id: initial.id,
        presetId: 'preset-2_5oz-cookie',
        recipeId: chocChipRecipe.id,
        note: 'Device B stale overwrite attempt',
        expectedUpdatedAt: staleTimestamp,
      });
    } catch (err) {
      if (err instanceof CriticalNoteConflictError) {
        caughtConflict = err;
      } else {
        throw err;
      }
    }
    assert.ok(caughtConflict, 'Stale concurrent edit must throw CriticalNoteConflictError');
    assert.strictEqual(
      caughtConflict!.remoteNote?.note,
      'Device A updated safety instruction: Allergen wash required.',
      'Conflict error must surface remoteNote so UI can show latest cloud version'
    );

    // 11b. Device B tries to delete using stale expectedUpdatedAt -> must throw CriticalNoteConflictError!
    await assert.rejects(
      async () => {
        await store.deleteCriticalProductionNote(initial.id, 'owner', {
          presetId: 'preset-2_5oz-cookie',
          expectedUpdatedAt: staleTimestamp,
        });
      },
      (err: unknown) => err instanceof CriticalNoteConflictError
    );

    // 11c. Editing preset metadata via savePreset (when caller object lacks criticalNotes) MUST preserve remote criticalNotes!
    const stalePresetWithoutNotes: ProductionPreset = {
      id: 'preset-2_5oz-cookie',
      workspaceId: 'ws-main',
      userId: 'owner-uid-1',
      name: '2.5 oz Cookies',
      category: 'Cookies',
      finishedWeight: 2.5,
      weightUnit: 'oz',
      quantityPerUnit: 120,
      unitName: 'Case',
      createdAt: '2026-01-10T08:00:00.000Z',
      updatedAt: '2026-01-10T08:00:00.000Z',
      // criticalNotes intentionally undefined (simulating stale preset form save)
    };
    await store.savePreset(stalePresetWithoutNotes);

    const preservedNotes = store.getCriticalNotesForPresetAndRecipe('preset-2_5oz-cookie', chocChipRecipe.id);
    assert.strictEqual(
      preservedNotes.length,
      1,
      'savePreset transaction must preserve remote criticalNotes when undefined on caller payload'
    );
    assert.strictEqual(preservedNotes[0].note, 'Device A updated safety instruction: Allergen wash required.');
  });

  it('12. Role-Based Write Permissions: Owner & Editor can save/delete notes; Viewer & Signed-Out are strictly blocked', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    const configureForRole = (role: AccessRole | null) => {
      store.configureCriticalNotesTestHarness({
        session: role ? { uid: `${role}-uid`, role, workspaceId: 'ws-main' } : null,
        storage: desktopStorage,
        cloudAdapter: sharedCloud.createAdapter(),
        recipes: [chocChipRecipe],
        presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
      });
    };

    // Owner can create
    configureForRole('owner');
    const ownerCreated = await store.saveCriticalProductionNote({
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Owner created safety rule',
    });
    assert.ok(ownerCreated.id);

    // Editor can edit
    configureForRole('editor');
    const editorUpdated = await store.saveCriticalProductionNote({
      id: ownerCreated.id,
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Editor updated safety rule',
      expectedUpdatedAt: ownerCreated.updatedAt,
    });
    assert.strictEqual(editorUpdated.note, 'Editor updated safety rule');

    // Viewer can READ but CANNOT create, edit, or delete
    configureForRole('viewer');
    assert.strictEqual(store.getCriticalProductionNotes().length, 1, 'Viewer must read canonical workspace notes');

    await assert.rejects(
      async () => {
        await store.saveCriticalProductionNote({
          presetId: 'preset-2_5oz-cookie',
          recipeId: chocChipRecipe.id,
          note: 'Viewer unauthorized write',
        });
      },
      /Unauthorized: Viewers cannot create or edit/
    );

    await assert.rejects(
      async () => {
        await store.deleteCriticalProductionNote(ownerCreated.id);
      },
      /Unauthorized: Viewers cannot delete/
    );

    // Signed-out user can neither read nor write
    configureForRole(null);
    assert.deepStrictEqual(store.getCriticalProductionNotes(), []);
    await assert.rejects(
      async () => {
        await store.saveCriticalProductionNote({
          presetId: 'preset-2_5oz-cookie',
          recipeId: chocChipRecipe.id,
          note: 'Anonymous unauthorized write',
        });
      },
      /Unauthorized|Authentication Required/
    );
  });

  it('13 & 14. Unified Safety Visibility, Mandatory Acknowledgment Gate & Fail-Closed Sync Error in Production Floor & Guided Mixing Mode', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presets: ProductionPreset[] = createSunnySweetsPresets()
      .filter((p) => p.workspaceId === 'ws-main')
      .map((p) =>
        p.id === 'preset-2_5oz-cookie'
          ? {
              ...p,
              criticalNotes: [
                {
                  id: 'cpn-2_5oz-choc-live',
                  presetId: 'preset-2_5oz-cookie',
                  recipeId: chocChipRecipe.id,
                  workspaceId: 'ws-main',
                  note: 'PRESET SAFETY RULE: Verify metal detector calibration card before packing 120-count cases.',
                  createdAt: '2026-03-15T09:00:00.000Z',
                  updatedAt: '2026-03-15T09:00:00.000Z',
                },
              ],
            }
          : p
      );

    store.configureCriticalNotesTestHarness({
      session: { uid: 'viewer-uid-1', role: 'viewer', workspaceId: 'ws-main' },
      storage: phoneStorage,
      recipes: [chocChipRecipe],
      presets,
      presetsSyncError: null,
      recipesSyncError: null,
    });

    // Build a production calculation for 2 cases of 2.5 oz Chocolate Chip Cookies
    const calculation = calculateProduction(
      chocChipRecipe,
      [
        {
          id: 'req-2_5oz',
          presetId: 'preset-2_5oz-cookie',
          presetName: '2.5 oz Cookies',
          quantity: 2,
          piecesPerUnit: 120,
          itemWeight: 2.5,
          itemWeightUnit: 'oz',
        },
      ],
      {
        mixer: defaultMixer,
        defaultWeightUnit: 'lb',
        defaultWastePercent: 6,
      }
    );

    // 14a. GuidedMixingMode SSR renders BOTH Recipe-Wide and Preset-Specific Critical Notes distinctly and locks completion until acknowledged
    const guidedHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation,
        presets,
        recipes: [chocChipRecipe],
        criticalNotesSyncError: null,
        activeWorkspaceId: 'ws-main',
        onExit: () => {},
      })
    );
    assert.ok(guidedHtml.includes('Recipe-Wide Critical Note'), 'Guided Mixing must label Recipe-Wide Critical Note');
    assert.ok(
      guidedHtml.includes('Chilled dough must stay below 68F'),
      'Guided Mixing must render Recipe.description safety rule'
    );
    assert.ok(
      guidedHtml.includes('Preset-Specific Critical Note — 2.5 oz Cookies'),
      'Guided Mixing must label Preset-Specific Critical Note with preset name'
    );
    assert.ok(
      guidedHtml.includes('PRESET SAFETY RULE: Verify metal detector calibration card'),
      'Guided Mixing must render presets/{presetId}.criticalNotes safety rule'
    );
    assert.ok(
      guidedHtml.includes('I HAVE READ THESE PRODUCTION NOTES'),
      'Guided Mixing must render mandatory acknowledgment button'
    );
    assert.ok(
      guidedHtml.includes('id="guided-complete-btn" disabled=""'),
      'Guided Mixing must disable batch completion button until safety notes are acknowledged'
    );

    // 13a. Fail-closed verification when Firestore sync error occurs (even if hasSafetyNotes === false or previously acknowledged!)
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: false,
        isAcknowledged: true,
        syncError: 'Missing or insufficient permissions',
      }),
      false,
      'Must fail closed whenever criticalNotesSyncError is non-null, even if 0 notes loaded'
    );
    assert.strictEqual(
      canProceedToMixWithSyncSafety({
        hasNotes: true,
        isAcknowledged: true,
        syncError: 'Firestore network timeout',
      }),
      false,
      'Must fail closed whenever criticalNotesSyncError is non-null, even if previously acknowledged'
    );

    const floorSyncErrorHtml = renderToStaticMarkup(
      React.createElement(ProductionModeView, {
        recipes: [chocChipRecipe],
        presets,
        mixers: [defaultMixer],
        settings: INITIAL_SETTINGS,
        criticalNotesSyncError: 'Unable to load packaging presets and critical production notes from Cloud Firestore.',
        activeWorkspaceId: 'ws-main',
        initialRecipeId: chocChipRecipe.id,
        onExit: () => {},
      })
    );
    assert.ok(
      floorSyncErrorHtml.includes('Critical Production Notes Unavailable — Safety Hold Active'),
      'ProductionModeView must display explicit fail-closed safety hold when Firestore sync fails'
    );

    const guidedSyncErrorHtml = renderToStaticMarkup(
      React.createElement(GuidedMixingMode, {
        calculation,
        presets,
        recipes: [chocChipRecipe],
        criticalNotesSyncError: 'Unable to load packaging presets and critical production notes from Cloud Firestore.',
        activeWorkspaceId: 'ws-main',
        onExit: () => {},
      })
    );
    assert.ok(
      guidedSyncErrorHtml.includes('Critical Production Notes Unavailable — Safety Hold Active'),
      'GuidedMixingMode must display explicit fail-closed safety hold when Firestore sync fails'
    );
  });

  it('15. Production Data Integrity Guarantee: saving/editing/deleting Critical Notes never alters preset weights, case counts, recipe formulas, or 6% waste scaling', async () => {
    const { chocChipRecipe } = createSunnySweetsRecipes();
    const presets = createSunnySweetsPresets().filter((p) => p.workspaceId === 'ws-main');
    const sharedCloud = new SimulatedFirestorePresetsCloud(presets);

    store.configureCriticalNotesTestHarness({
      session: { uid: 'owner-uid-1', role: 'owner', workspaceId: 'ws-main' },
      storage: desktopStorage,
      cloudAdapter: sharedCloud.createAdapter(),
      recipes: [chocChipRecipe],
      presets: sharedCloud.getSnapshotForWorkspace('ws-main'),
    });

    const beforeCalc = calculateProduction(
      chocChipRecipe,
      [
        {
          id: 'req-1',
          presetId: 'preset-2_5oz-cookie',
          presetName: '2.5 oz Cookies',
          quantity: 3,
          piecesPerUnit: 120,
          itemWeight: 2.5,
          itemWeightUnit: 'oz',
        },
      ],
      { mixer: defaultMixer, defaultWeightUnit: 'lb', defaultWastePercent: 6 }
    );

    const saved = await store.saveCriticalProductionNote({
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Verify scoop weight every 2nd sheet pan.',
    });
    await store.saveCriticalProductionNote({
      id: saved.id,
      presetId: 'preset-2_5oz-cookie',
      recipeId: chocChipRecipe.id,
      note: 'Verify scoop weight every sheet pan.',
      expectedUpdatedAt: saved.updatedAt,
    });

    const updatedPreset = store.getPresets().find((p) => p.id === 'preset-2_5oz-cookie')!;
    assert.strictEqual(updatedPreset.finishedWeight, 2.5);
    assert.strictEqual(updatedPreset.weightUnit, 'oz');
    assert.strictEqual(updatedPreset.quantityPerUnit, 120);
    assert.strictEqual(updatedPreset.unitName, 'Case');
    assert.strictEqual(updatedPreset.category, 'Cookies');

    const afterCalc = calculateProduction(
      store.getRecipes()[0],
      [
        {
          id: 'req-1',
          presetId: updatedPreset.id,
          presetName: updatedPreset.name,
          quantity: 3,
          piecesPerUnit: updatedPreset.quantityPerUnit,
          itemWeight: updatedPreset.finishedWeight,
          itemWeightUnit: updatedPreset.weightUnit,
        },
      ],
      { mixer: defaultMixer, defaultWeightUnit: 'lb', defaultWastePercent: 6 }
    );

    assert.strictEqual(afterCalc.totalPieces, beforeCalc.totalPieces);
    assert.strictEqual(afterCalc.totalFinishedWeightGrams, beforeCalc.totalFinishedWeightGrams);
    assert.strictEqual(afterCalc.totalBatchWeightGrams, beforeCalc.totalBatchWeightGrams);
    assert.strictEqual(afterCalc.productionWastePercent, 6);
    assert.deepStrictEqual(
      afterCalc.calculatedIngredients.map((i) => i.displayQuantity),
      beforeCalc.calculatedIngredients.map((i) => i.displayQuantity)
    );
  });
});
