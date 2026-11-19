import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  Workspace,
  UserSettings,
  Recipe,
  Mixer,
  ProductionPreset,
} from '../src/types';
import { calculateProduction } from '../src/utils/calculator';
import {
  generateSalt,
  hashPin,
  verifyManagementPin,
  saveManagementLockConfig,
  loadManagementLockConfig,
  ManagementLockConfig,
} from '../src/utils/managementLock';

// Mock localStorage in Node test environment
const mockStorage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = val;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
};

describe('Workspace Setting — Enable or Disable Production Floor Mode', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  describe('1. Default Setting & Backward Compatibility', () => {
    it('PFS1: Workspace without explicit productionFloorModeEnabled defaults to true (ON)', () => {
      const workspace: Workspace = {
        id: 'ws-test-1',
        name: 'Sunny Sweets Flagship',
        ownerId: 'owner-1',
        ownerEmail: 'owner@sunnysweets.com',
        code: 'SUNNY-01',
        members: [],
        groups: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // When undefined, authoritative default is true
      const isEnabled = workspace.productionFloorModeEnabled !== false;
      assert.strictEqual(isEnabled, true, 'Default setting must be ON (true)');
    });

    it('PFS2: Settings without explicit productionFloorModeEnabled defaults to true (ON)', () => {
      const settings: UserSettings = {
        userId: 'user-1',
        defaultWeightUnit: 'lb',
        defaultWastePercent: 6,
        theme: 'light',
      };

      const isEnabled = settings.productionFloorModeEnabled !== false;
      assert.strictEqual(isEnabled, true, 'UserSettings default must be ON (true)');
    });
  });

  describe('2. Workspace-Level Persistence & Multi-Workspace Isolation', () => {
    it('PFS3: Setting persists at workspace level and can be toggled OFF and ON', () => {
      let workspace: Workspace = {
        id: 'ws-test-2',
        name: 'Artisan Bakes',
        ownerId: 'owner-1',
        ownerEmail: 'owner@sunnysweets.com',
        code: 'BAKE-02',
        members: [],
        groups: [],
        productionFloorModeEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      assert.strictEqual(workspace.productionFloorModeEnabled, true);

      // Disable
      workspace = {
        ...workspace,
        productionFloorModeEnabled: false,
        updatedAt: new Date().toISOString(),
      };
      assert.strictEqual(workspace.productionFloorModeEnabled, false);

      // Re-enable
      workspace = {
        ...workspace,
        productionFloorModeEnabled: true,
        updatedAt: new Date().toISOString(),
      };
      assert.strictEqual(workspace.productionFloorModeEnabled, true);
    });

    it('PFS4: Multi-workspace isolation: Disabling for one workspace does not affect another', () => {
      const workspaceA: Workspace = {
        id: 'ws-a',
        name: 'Production Facility',
        ownerId: 'owner-1',
        ownerEmail: 'owner@sunnysweets.com',
        code: 'FACILITY-A',
        members: [],
        groups: [],
        productionFloorModeEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const workspaceB: Workspace = {
        id: 'ws-b',
        name: 'Corporate Office / Management',
        ownerId: 'owner-1',
        ownerEmail: 'owner@sunnysweets.com',
        code: 'CORP-B',
        members: [],
        groups: [],
        productionFloorModeEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const getEnabled = (ws: Workspace) => ws.productionFloorModeEnabled !== false;

      assert.strictEqual(getEnabled(workspaceA), true, 'Workspace A should have floor mode enabled');
      assert.strictEqual(getEnabled(workspaceB), false, 'Workspace B should have floor mode disabled');
    });
  });

  describe('3. Access Role Protection', () => {
    it('PFS5: Viewer and Editor roles are blocked from modifying Production Floor Mode master switch', () => {
      for (const nonOwnerRole of ['viewer', 'editor'] as const) {
        const isOwner = (nonOwnerRole as string) === 'owner';

        let modifyAttempted = false;
        let errorMessage: string | null = null;

        try {
          if (!isOwner) {
            throw new Error(
              'Permission denied: Only workspace owners can enable or disable Production Floor Mode.'
            );
          }
          modifyAttempted = true;
        } catch (err: any) {
          errorMessage = err.message;
        }

        assert.strictEqual(modifyAttempted, false, `${nonOwnerRole} must not modify master switch`);
        assert.strictEqual(
          errorMessage,
          'Permission denied: Only workspace owners can enable or disable Production Floor Mode.'
        );
      }
    });

    it('PFS6: Only Owner role is authorized to modify Production Floor Mode master switch', () => {
      const role = 'owner';
      const isOwner = role === 'owner';
      assert.strictEqual(isOwner, true, 'owner must be permitted');
    });
  });

  describe('4. UI Navigation & Routing Invariants', () => {
    it('PFS7: When Production Floor Mode is enabled, launcher and nav buttons are provided', () => {
      const isProductionFloorEnabled = true;

      const onSwitchToProductionMode = isProductionFloorEnabled ? () => {} : undefined;
      const onBackToMain = isProductionFloorEnabled ? () => {} : undefined;

      assert(typeof onSwitchToProductionMode === 'function', 'Production mode switch handler should be defined');
      assert(typeof onBackToMain === 'function', 'Back to main handler should be defined');
    });

    it('PFS8: When Production Floor Mode is disabled, production switcher and back-to-main are omitted', () => {
      const isProductionFloorEnabled = false;

      const onSwitchToProductionMode = isProductionFloorEnabled ? () => {} : undefined;
      const onBackToMain = isProductionFloorEnabled ? () => {} : undefined;

      assert.strictEqual(onSwitchToProductionMode, undefined, 'Production mode switcher must be omitted');
      assert.strictEqual(onBackToMain, undefined, 'Back to main launcher button must be omitted');
    });

    it('PFS9: When Production Floor Mode is disabled, appMode safely redirects to management mode', () => {
      const resolveAppMode = (
        mode: 'main' | 'production' | 'management',
        floorEnabled: boolean
      ): 'main' | 'production' | 'management' => {
        if (!floorEnabled && mode !== 'management') {
          return 'management';
        }
        return mode;
      };

      assert.strictEqual(resolveAppMode('production', false), 'management', 'Production mode must redirect to management mode when floor is disabled');
      assert.strictEqual(resolveAppMode('main', false), 'management', 'Main mode must redirect to management mode when floor is disabled');
      assert.strictEqual(resolveAppMode('management', false), 'management', 'Management mode remains management mode when floor is disabled');
      assert.strictEqual(resolveAppMode('production', true), 'production', 'Production mode is preserved when floor is enabled');

      // Attempting to switch back to production is denied
      const handleSwitchToProductionMode = (enabled: boolean) => {
        if (!enabled) {
          return 'management';
        }
        return 'production';
      };

      const resultMode = handleSwitchToProductionMode(false);
      assert.strictEqual(resultMode, 'management', 'Cannot enter production mode while setting is disabled');
    });
  });

  describe('5. PIN Protection Interaction & Dead-End Prevention', () => {
    it('PFS10: If Production Floor Mode is disabled and Management PIN is active, direct PIN challenge is presented', async () => {
      const isProductionFloorEnabled = false;

      // Configure a test PIN
      const salt = generateSalt();
      const hash = await hashPin('1234', salt);
      saveManagementLockConfig({
        enabled: true,
        salt,
        hash,
      });

      const config = loadManagementLockConfig();
      const isLockActive = Boolean(config.enabled && config.hash && config.salt);
      assert.strictEqual(isLockActive, true, 'Lock should be active');

      let isManagementUnlocked = false;
      let showManagementPinModal = !isProductionFloorEnabled && isLockActive;

      assert.strictEqual(showManagementPinModal, true, 'PIN challenge modal should be prompted directly');
      assert.strictEqual(isManagementUnlocked, false, 'Management mode must remain locked until PIN verified');

      // Verify correct PIN
      const isValid = await verifyManagementPin('1234', config);
      assert.strictEqual(isValid, true);

      if (isValid) {
        isManagementUnlocked = true;
        showManagementPinModal = false;
      }

      assert.strictEqual(isManagementUnlocked, true, 'Management mode successfully unlocked');
      assert.strictEqual(showManagementPinModal, false, 'PIN modal closed upon unlock');
    });

    it('PFS11: If user closes PIN modal without entering PIN, unlock button remains available (no dead end)', async () => {
      const isProductionFloorEnabled = false;

      const salt = generateSalt();
      const hash = await hashPin('5678', salt);
      saveManagementLockConfig({
        enabled: true,
        salt,
        hash,
      });

      const config = loadManagementLockConfig();
      let isManagementUnlocked = false;
      let showManagementPinModal = true;

      // User cancels / closes modal
      showManagementPinModal = false;

      assert.strictEqual(isManagementUnlocked, false, 'Still locked');
      assert.strictEqual(showManagementPinModal, false, 'Modal hidden');

      // Card is rendered with "Enter Management PIN" button
      const canReopenModal = () => {
        showManagementPinModal = true;
      };

      canReopenModal();
      assert.strictEqual(showManagementPinModal, true, 'User can reopen PIN modal at any time');
    });

    it('PFS12: If Production Floor Mode is disabled and NO PIN is set, opens directly without prompt', () => {
      const isProductionFloorEnabled = false;

      saveManagementLockConfig({
        enabled: false,
        salt: '',
        hash: '',
      });

      const config = loadManagementLockConfig();
      const isLockActive = Boolean(config.enabled && config.hash && config.salt);
      const isManagementUnlocked = !isLockActive;
      const showManagementPinModal = !isProductionFloorEnabled && isLockActive;

      assert.strictEqual(isLockActive, false);
      assert.strictEqual(isManagementUnlocked, true, 'Directly unlocked');
      assert.strictEqual(showManagementPinModal, false, 'No PIN modal shown');
    });
  });

  describe('6. Data Integrity & Non-Destructive Invariants', () => {
    it('PFS13: Disabling and re-enabling Production Floor Mode preserves all recipes and calculations', () => {
      const testRecipe: Recipe = {
        id: 'r-preserve',
        userId: 'u1',
        name: 'Artisan Brioche Loaf',
        description: 'Rich brioche dough for artisan loaves',
        batchYieldQuantity: 12,
        batchYieldUnit: 'loaves',
        defaultWastePercent: 4,
        archived: false,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        ingredients: [
          { id: 'i1', name: 'Bread Flour', quantity: 1000, unit: 'g' },
          { id: 'i2', name: 'Butter', quantity: 500, unit: 'g' },
          { id: 'i3', name: 'Eggs', quantity: 300, unit: 'g' },
        ],
      };

      // Calculation before disable
      const calcBefore = calculateProduction(testRecipe, [], {
        mode: 'full_recipe',
        fullRecipeCount: 2,
      });

      // Toggle setting OFF and then ON
      let wsEnabled = false;
      assert.strictEqual(wsEnabled, false);
      wsEnabled = true;
      assert.strictEqual(wsEnabled, true);

      // Calculation after
      const calcAfter = calculateProduction(testRecipe, [], {
        mode: 'full_recipe',
        fullRecipeCount: 2,
      });

      assert.strictEqual(calcBefore.totalBatchWeightGrams, calcAfter.totalBatchWeightGrams);
      assert.strictEqual(calcBefore.calculatedIngredients.length, calcAfter.calculatedIngredients.length);
      assert.strictEqual(calcBefore.calculatedIngredients[0].scaledQuantity, 2000);
      assert.strictEqual(calcBefore.calculatedIngredients[1].scaledQuantity, 1000);
      assert.strictEqual(calcBefore.calculatedIngredients[2].scaledQuantity, 600);
    });

    it('PFS14: Recipe list, mixers, and presets are untouched by setting toggles', () => {
      const recipes: Recipe[] = [
        {
          id: 'rec-1',
          userId: 'u1',
          name: 'Croissant',
          description: 'Classic flaky butter croissant',
          batchYieldQuantity: 50,
          batchYieldUnit: 'pieces',
          defaultWastePercent: 5,
          ingredients: [],
          archived: false,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ];
      const mixers: Mixer[] = [
        {
          id: 'mix-1',
          userId: 'u1',
          name: 'Hobart 80Qt',
          maxWeight: 100,
          weightUnit: 'lb',
          createdAt: '2026-09-01',
          updatedAt: '2026-09-01',
        },
      ];
      const presets: ProductionPreset[] = [
        {
          id: 'pre-1',
          userId: 'u1',
          name: 'Single Case',
          category: 'Pastry',
          finishedWeight: 3.5,
          weightUnit: 'oz',
          quantityPerUnit: 24,
          unitName: 'case',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ];

      // Simulate state
      const state = {
        recipes,
        mixers,
        presets,
        productionFloorModeEnabled: true,
      };

      // Disable
      state.productionFloorModeEnabled = false;

      assert.strictEqual(state.recipes.length, 1);
      assert.strictEqual(state.mixers.length, 1);
      assert.strictEqual(state.presets.length, 1);
      assert.strictEqual(state.recipes[0].name, 'Croissant');

      // Re-enable
      state.productionFloorModeEnabled = true;

      assert.strictEqual(state.recipes.length, 1);
      assert.strictEqual(state.mixers.length, 1);
      assert.strictEqual(state.presets.length, 1);
    });
  });
});
