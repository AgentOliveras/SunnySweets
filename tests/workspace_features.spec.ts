import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  Workspace,
  UserSettings,
  Recipe,
  Mixer,
  ProductionPreset,
  AccessRole,
} from '../src/types';
import {
  DEFAULT_WORKSPACE_FEATURES,
  resolveWorkspaceFeatures,
  hasWorkspaceFeature,
  canUserAccessFeature,
} from '../src/services/workspaceFeatures';
import { calculateProduction } from '../src/utils/calculator';
import {
  generateSalt,
  hashPin,
  verifyManagementPin,
  saveManagementLockConfig,
  loadManagementLockConfig,
  ManagementLockConfig,
} from '../src/utils/managementLock';
import { evaluateEntitlement } from '../src/services/entitlement';

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

describe('Phase 2 — Workspace Feature Architecture Verification Suite', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  describe('1. Backward Compatibility & Authoritative Defaults', () => {
    it('WF1: Workspace without capability metadata resolves to authoritative defaults', () => {
      const legacyWs: Workspace = {
        id: 'ws-legacy-1',
        name: 'Historic Bakery',
        ownerId: 'owner-1',
        ownerEmail: 'owner@legacy.com',
        code: 'HISTORIC-1',
        members: [],
        groups: [],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      const resolved = resolveWorkspaceFeatures(legacyWs);
      assert.strictEqual(resolved.recipeManagement, true, 'recipeManagement must default to true');
      assert.strictEqual(resolved.productionFloor, true, 'productionFloor must default to true');
      assert.strictEqual(resolved.costing, true, 'costing must default to true');
      assert.strictEqual(resolved.inventoryManagement, false, 'inventoryManagement must default to false');
      assert.strictEqual(resolved.labelPrinting, false, 'labelPrinting must default to false');
    });

    it('WF2: Null or undefined workspace safely falls back to default feature matrix', () => {
      const fromNull = resolveWorkspaceFeatures(null);
      const fromUndefined = resolveWorkspaceFeatures(undefined);

      assert.deepStrictEqual(fromNull, DEFAULT_WORKSPACE_FEATURES);
      assert.deepStrictEqual(fromUndefined, DEFAULT_WORKSPACE_FEATURES);
    });

    it('WF3: hasWorkspaceFeature respects defaults when field is not defined', () => {
      const ws: Workspace = {
        id: 'ws-test',
        name: 'Test Bakery',
        ownerId: 'owner-1',
        ownerEmail: 'owner@test.com',
        code: 'TEST-1',
        members: [],
        groups: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      assert.strictEqual(hasWorkspaceFeature(ws, 'recipeManagement'), true);
      assert.strictEqual(hasWorkspaceFeature(ws, 'productionFloor'), true);
      assert.strictEqual(hasWorkspaceFeature(ws, 'costing'), true);
      assert.strictEqual(hasWorkspaceFeature(ws, 'inventoryManagement'), false);
      assert.strictEqual(hasWorkspaceFeature(ws, 'labelPrinting'), false);
    });
  });

  describe('2. Feature Activation & Custom Configuration', () => {
    it('WF4: Workspace can enable advanced operational module (e.g. inventoryManagement)', () => {
      const wsWithInventory: Workspace = {
        id: 'ws-sunny-advanced',
        name: 'Sunny Sweets Flagship Kitchen',
        ownerId: 'owner-sunny',
        ownerEmail: 'jaoliveras@gmail.com',
        code: 'SUNNY-FLAG',
        members: [],
        groups: [],
        features: {
          inventoryManagement: true,
          labelPrinting: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      assert.strictEqual(hasWorkspaceFeature(wsWithInventory, 'inventoryManagement'), true);
      assert.strictEqual(hasWorkspaceFeature(wsWithInventory, 'labelPrinting'), true);
      // Core features remain enabled
      assert.strictEqual(hasWorkspaceFeature(wsWithInventory, 'recipeManagement'), true);
      assert.strictEqual(hasWorkspaceFeature(wsWithInventory, 'costing'), true);
    });

    it('WF5: Disabled capability explicitly prevents feature access', () => {
      const wsWithoutCosting: Workspace = {
        id: 'ws-basic-subscriber',
        name: 'Artisan Kitchen Basic',
        ownerId: 'owner-artisan',
        ownerEmail: 'artisan@baker.com',
        code: 'ARTISAN-1',
        members: [],
        groups: [],
        features: {
          costing: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      assert.strictEqual(hasWorkspaceFeature(wsWithoutCosting, 'costing'), false);
      assert.strictEqual(hasWorkspaceFeature(wsWithoutCosting, 'recipeManagement'), true);
    });
  });

  describe('3. Multi-Tenant Capability Isolation', () => {
    it('WF6: Enabling a capability on one workspace does NOT leak to another workspace', () => {
      const wsMain: Workspace = {
        id: 'ws-main',
        name: 'Sunny Sweets Main',
        ownerId: 'owner-sunny',
        ownerEmail: 'jaoliveras@gmail.com',
        code: 'WS-MAIN',
        members: [],
        groups: [],
        features: {
          inventoryManagement: true,
          labelPrinting: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const subscriberWs: Workspace = {
        id: 'ws-other-client',
        name: 'External Bakery',
        ownerId: 'owner-ext',
        ownerEmail: 'ext@bakery.com',
        code: 'EXT-BAKE',
        members: [],
        groups: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      assert.strictEqual(hasWorkspaceFeature(wsMain, 'inventoryManagement'), true);
      assert.strictEqual(hasWorkspaceFeature(wsMain, 'labelPrinting'), true);

      // Other workspace must remain on defaults (inventory false, label false)
      assert.strictEqual(hasWorkspaceFeature(subscriberWs, 'inventoryManagement'), false);
      assert.strictEqual(hasWorkspaceFeature(subscriberWs, 'labelPrinting'), false);
    });
  });

  describe('4. Invariant: Feature Enablement NEVER Elevates Viewer Permissions', () => {
    const wsWithAllModules: Workspace = {
      id: 'ws-full',
      name: 'Full Suite Bakery',
      ownerId: 'owner-1',
      ownerEmail: 'owner@full.com',
      code: 'FULL-1',
      members: [],
      groups: [],
      features: {
        inventoryManagement: true,
        labelPrinting: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('WF7: Viewer can view enabled module, but CANNOT execute mutating actions or configure', () => {
      const viewDecision = canUserAccessFeature(wsWithAllModules, 'viewer', 'inventoryManagement', 'view');
      assert.strictEqual(viewDecision.allowed, true, 'Viewer should be allowed to view enabled module');

      const useDecision = canUserAccessFeature(wsWithAllModules, 'viewer', 'inventoryManagement', 'use');
      assert.strictEqual(useDecision.allowed, false, 'Viewer must NOT be allowed to execute mutating operations');
      assert.match(useDecision.reason || '', /viewers have read-only access/i);

      const configDecision = canUserAccessFeature(wsWithAllModules, 'viewer', 'inventoryManagement', 'configure');
      assert.strictEqual(configDecision.allowed, false, 'Viewer must NOT be allowed to configure workspace capabilities');
    });

    it('WF8: Editor can view and execute, but cannot configure workspace capabilities', () => {
      const viewDecision = canUserAccessFeature(wsWithAllModules, 'editor', 'inventoryManagement', 'view');
      assert.strictEqual(viewDecision.allowed, true);

      const useDecision = canUserAccessFeature(wsWithAllModules, 'editor', 'inventoryManagement', 'use');
      assert.strictEqual(useDecision.allowed, true, 'Editor is authorized to execute module operations');

      const configDecision = canUserAccessFeature(wsWithAllModules, 'editor', 'inventoryManagement', 'configure');
      assert.strictEqual(configDecision.allowed, false, 'Editor cannot reconfigure workspace capabilities');
      assert.match(configDecision.reason || '', /only workspace owners/i);
    });

    it('WF9: Owner has full permission to view, execute, and configure', () => {
      const viewDecision = canUserAccessFeature(wsWithAllModules, 'owner', 'inventoryManagement', 'view');
      const useDecision = canUserAccessFeature(wsWithAllModules, 'owner', 'inventoryManagement', 'use');
      const configDecision = canUserAccessFeature(wsWithAllModules, 'owner', 'inventoryManagement', 'configure');

      assert.strictEqual(viewDecision.allowed, true);
      assert.strictEqual(useDecision.allowed, true);
      assert.strictEqual(configDecision.allowed, true);
    });

    it('WF10: Denied feature cannot be viewed by anyone including owner', () => {
      const wsDisabledModule: Workspace = {
        id: 'ws-disabled',
        name: 'Limited Bakery',
        ownerId: 'owner-1',
        ownerEmail: 'owner@limit.com',
        code: 'LIMIT-1',
        members: [],
        groups: [],
        features: {
          inventoryManagement: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ownerView = canUserAccessFeature(wsDisabledModule, 'owner', 'inventoryManagement', 'view');
      assert.strictEqual(ownerView.allowed, false, 'Owner cannot access a disabled workspace module');
    });
  });

  describe('5. Production Floor Setting Layering on Capability', () => {
    it('WF11: If productionFloor capability is true, operational toggle controls active floor mode', () => {
      const wsEnabled: Workspace = {
        id: 'ws-floor-1',
        name: 'Floor Active',
        ownerId: 'owner-1',
        ownerEmail: 'owner@floor.com',
        code: 'FLR-1',
        members: [],
        groups: [],
        features: { productionFloor: true },
        productionFloorModeEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const wsToggledOff: Workspace = {
        id: 'ws-floor-2',
        name: 'Floor Toggled Off',
        ownerId: 'owner-1',
        ownerEmail: 'owner@floor.com',
        code: 'FLR-2',
        members: [],
        groups: [],
        features: { productionFloor: true },
        productionFloorModeEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Helper simulating store evaluation logic
      const isFloorActive = (ws: Workspace) => {
        if (!hasWorkspaceFeature(ws, 'productionFloor')) return false;
        return ws.productionFloorModeEnabled !== false;
      };

      assert.strictEqual(isFloorActive(wsEnabled), true);
      assert.strictEqual(isFloorActive(wsToggledOff), false);
    });

    it('WF12: If productionFloor capability is false, floor mode is disabled regardless of toggle', () => {
      const wsCapabilityDisabled: Workspace = {
        id: 'ws-office',
        name: 'Headquarters / No Floor',
        ownerId: 'owner-1',
        ownerEmail: 'owner@hq.com',
        code: 'HQ-1',
        members: [],
        groups: [],
        features: { productionFloor: false },
        productionFloorModeEnabled: true, // Even if toggle was true
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const isFloorActive = (ws: Workspace) => {
        if (!hasWorkspaceFeature(ws, 'productionFloor')) return false;
        return ws.productionFloorModeEnabled !== false;
      };

      assert.strictEqual(isFloorActive(wsCapabilityDisabled), false);
    });
  });

  describe('6. Management Lock Invariance', () => {
    it('WF13: Management PIN hashing, salt, and verification remain completely operational', async () => {
      const pin = '8822';
      const salt = generateSalt();
      const hash = await hashPin(pin, salt);

      const config: ManagementLockConfig = {
        enabled: true,
        hash,
        salt,
      };

      saveManagementLockConfig(config);
      const loaded = loadManagementLockConfig();

      assert.strictEqual(loaded.enabled, true);
      assert.strictEqual(await verifyManagementPin(pin, loaded), true);
      assert.strictEqual(await verifyManagementPin('0000', loaded), false);
    });
  });

  describe('7. Subscription Entitlement & Sunny Sweets Exemption Separation', () => {
    it('WF14: ws-main maintains temporary internal exemption regardless of capability state', () => {
      const evalResult = evaluateEntitlement({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        billingDoc: null,
        workspaceId: 'ws-main',
      });

      assert.strictEqual(evalResult.canAccessApp, true);
      assert.strictEqual(evalResult.accessState, 'AUTHORIZED_INTERNAL');
      assert.strictEqual(evalResult.planId, 'internal');
      assert.strictEqual(evalResult.isCompatibilityFallback, true);
    });

    it('WF15: Third-party workspace without billing remains strictly blocked regardless of capabilities', () => {
      const evalResult = evaluateEntitlement({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        billingDoc: null,
        workspaceId: 'ws-commercial-custom',
      });

      assert.strictEqual(evalResult.canAccessApp, false);
      assert.strictEqual(evalResult.accessState, 'NO_ENTITLEMENT');
    });
  });

  describe('8. Calculation Engine Invariance', () => {
    const sampleRecipe: Recipe = {
      id: 'rec-guaranteed-calc',
      workspaceId: 'ws-main',
      userId: 'u1',
      name: 'Sunny Butter Shortbread',
      description: 'Classic rich buttery shortbread',
      batchYieldQuantity: 50,
      batchYieldUnit: 'pieces',
      defaultWastePercent: 3,
      ingredients: [
        { id: 'ing-1', name: 'Pastry Flour', quantity: 1000, unit: 'g' },
        { id: 'ing-2', name: 'Butter', quantity: 600, unit: 'g' },
        { id: 'ing-3', name: 'Powdered Sugar', quantity: 300, unit: 'g' },
        { id: 'ing-4', name: 'Fine Salt', quantity: 10, unit: 'g' },
      ],
      archived: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    const sampleMixer: Mixer = {
      id: 'mix-1',
      userId: 'u1',
      name: 'Hobart 20-Qt Commercial',
      maxWeight: 20,
      weightUnit: 'lb',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    it('WF16: Standard recipe calculation produces identical mathematical outputs', () => {
      const calcResult = calculateProduction(sampleRecipe, [], {
        mixer: sampleMixer,
        mode: 'full_recipe',
        fullRecipeCount: 2,
      });

      assert.strictEqual(calcResult.calculatedIngredients.length, 4);
      // Scaled quantities must be exactly double base
      assert.strictEqual(calcResult.calculatedIngredients[0].scaledQuantity, 2000);
      assert.strictEqual(calcResult.calculatedIngredients[1].scaledQuantity, 1200);
      assert.strictEqual(calcResult.calculatedIngredients[2].scaledQuantity, 600);
      assert.strictEqual(calcResult.calculatedIngredients[3].scaledQuantity, 20);
      assert(calcResult.totalBatchWeightGrams > 3800, 'Total batch weight computed accurately');
    });

    it('WF17: Production batch allocation and splitting remain 100% authoritative', () => {
      const bigBatchResult = calculateProduction(sampleRecipe, [], {
        mixer: sampleMixer,
        mode: 'full_recipe',
        fullRecipeCount: 20, // Huge requirement exceeding 20lb bowl
      });

      assert(bigBatchResult.suggestedBatches > 1, 'Batch splitting accurately suggests multiple batches');
      assert.strictEqual(bigBatchResult.isCapacityExceeded, true, 'Mixer capacity check flags capacity exceeded');
    });
  });
});
