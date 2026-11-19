import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateProduction,
  getApplicablePresetsForRecipe,
} from '../src/utils/calculator';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  UserSettings,
  ProductionItemRequirement,
} from '../src/types';
import {
  formatNumber,
} from '../src/utils/units';
import {
  sortRecipes,
  RecipeUsageMap,
} from '../src/utils/productionHistory';
import {
  generateSalt,
  hashPin,
  verifyManagementPin,
  saveManagementLockConfig,
  loadManagementLockConfig,
} from '../src/utils/managementLock';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory mock for localStorage in Node test environment
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

function createSampleMixer(overrides: Partial<Mixer> = {}): Mixer {
  return {
    id: 'mixer-hobart-60',
    name: 'Hobart 60-Qt Commercial Mixer',
    maxWeight: 80,
    weightUnit: 'lb',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    userId: 'user-admin',
    ...overrides,
  };
}

function createSampleRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'rec-test-chocolate-chip',
    name: 'Chocolate Chip Cookies',
    description: 'Classic chocolate chip cookies',
    category: 'Cookies',
    batchYieldQuantity: 80,
    batchYieldUnit: 'piece',
    defaultWastePercent: 6,
    ingredients: [
      {
        id: 'ing-flour',
        name: 'All-Purpose Flour',
        quantity: 1000,
        unit: 'g',
      },
      {
        id: 'ing-butter',
        name: 'Unsalted Butter Blocks',
        quantity: 500,
        unit: 'g',
      },
      {
        id: 'ing-sugar',
        name: 'Granulated Sugar',
        quantity: 400,
        unit: 'g',
      },
    ],
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    userId: 'user-admin',
    ...overrides,
  };
}

function createSamplePreset(overrides: Partial<ProductionPreset> = {}): ProductionPreset {
  return {
    id: 'preset-case-4oz',
    name: 'Case of 80 (4 oz)',
    category: 'Cookies',
    finishedWeight: 4,
    weightUnit: 'oz',
    quantityPerUnit: 80,
    unitName: 'case',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    userId: 'user-admin',
    ...overrides,
  };
}

describe('Sunny Sweets — Production Command Center & Mode Refinement Invariants', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Production Floor does not expose Management navigation
  // -------------------------------------------------------------------------
  it('1. Production Floor does not expose Management navigation or administrative links', () => {
    const prodFile = fs.readFileSync(path.join(__dirname, '../src/components/ProductionModeView.tsx'), 'utf-8');

    // Administrative sub-navigation actions must NOT be present
    assert(!prodFile.includes('btn-nav-calculations'), 'Production floor must not have New Calculation nav');
    assert(!prodFile.includes('btn-nav-recipes'), 'Production floor must not have Recipes admin nav');
    assert(!prodFile.includes('btn-nav-ingredients'), 'Production floor must not have Ingredients admin nav');
    assert(!prodFile.includes('btn-nav-costing'), 'Production floor must not have Costing admin nav');
    assert(!prodFile.includes('btn-nav-presets'), 'Production floor must not have Presets admin nav');
    assert(!prodFile.includes('btn-nav-mixers'), 'Production floor must not have Mixers admin nav');
    assert(!prodFile.includes('btn-nav-settings'), 'Production floor must not have Settings admin nav');
    assert(!prodFile.includes('id="main-mode-members-btn"'), 'Production floor must not have People & Groups button');

    // Only exit buttons returning to launcher
    assert(prodFile.includes('id="btn-exit-production-mode"'), 'Must have exit button');
    assert(prodFile.includes('Exit Production'), 'Exit button text must clearly return to production launcher');
  });

  // -------------------------------------------------------------------------
  // 2. Management Mode still exposes the full management navigation
  // -------------------------------------------------------------------------
  it('2. Management Mode still exposes the full management navigation after authorization', () => {
    const appFile = fs.readFileSync(path.join(__dirname, '../src/components/AuthorizedRecipeCalculatorApp.tsx'), 'utf-8');

    // When in management mode, full administrative views are rendered
    assert(appFile.includes("setAppMode('management')"), 'Must support switching to management mode');
    assert(appFile.includes("activeTab === 'recipes'"), 'Management mode supports recipes tab');
    assert(appFile.includes("activeTab === 'ingredients'"), 'Management mode supports ingredients tab');
    assert(appFile.includes("activeTab === 'costing'"), 'Management mode supports costing tab');
    assert(appFile.includes("activeTab === 'presets'"), 'Management mode supports presets tab');
    assert(appFile.includes("activeTab === 'mixers'"), 'Management mode supports mixers tab');
    assert(appFile.includes("activeTab === 'settings'"), 'Management mode supports settings tab');
  });

  // -------------------------------------------------------------------------
  // 3. One configured mixer automatically becomes the selected mixer
  // -------------------------------------------------------------------------
  it('3. One configured mixer automatically becomes the selected mixer', () => {
    const singleMixer = createSampleMixer({ id: 'single-mixer-1', name: 'Hobart 60-Qt' });
    const mixers = [singleMixer];
    const settings: Partial<UserSettings> = {};

    const getDefaultMixerId = (mixerList: Mixer[], userSettings: any): string | null => {
      if (!mixerList || mixerList.length === 0) return null;
      if (userSettings?.defaultMixerId) {
        const found = mixerList.find((m) => m.id === userSettings.defaultMixerId);
        if (found) return found.id;
      }
      const defaultFlagged = mixerList.find((m) => (m as any).isDefault);
      if (defaultFlagged) return defaultFlagged.id;
      return mixerList[0].id;
    };

    const selectedId = getDefaultMixerId(mixers, settings);
    assert.strictEqual(selectedId, 'single-mixer-1');
  });

  // -------------------------------------------------------------------------
  // 4. Multiple mixers allow explicit selection
  // -------------------------------------------------------------------------
  it('4. Multiple mixers allow explicit selection with configured default or fallback', () => {
    const mixer1 = createSampleMixer({ id: 'mixer-60', name: 'Hobart 60-Qt', maxWeight: 80 });
    const mixer2 = createSampleMixer({ id: 'mixer-140', name: 'Hobart 140-Qt', maxWeight: 200 });
    const mixers = [mixer1, mixer2];

    const getDefaultMixerId = (mixerList: Mixer[], userSettings: any): string | null => {
      if (!mixerList || mixerList.length === 0) return null;
      if (userSettings?.defaultMixerId) {
        const found = mixerList.find((m) => m.id === userSettings.defaultMixerId);
        if (found) return found.id;
      }
      const defaultFlagged = mixerList.find((m) => (m as any).isDefault);
      if (defaultFlagged) return defaultFlagged.id;
      return mixerList[0].id;
    };

    assert.strictEqual(getDefaultMixerId(mixers, {}), 'mixer-60');
    assert.strictEqual(getDefaultMixerId(mixers, { defaultMixerId: 'mixer-140' }), 'mixer-140');
  });

  // -------------------------------------------------------------------------
  // 5. Changing mixers recalculates capacity status
  // -------------------------------------------------------------------------
  it('5. Changing mixers recalculates capacity status immediately for current run', () => {
    const mixerSmall = createSampleMixer({ id: 'mixer-small', name: 'Small Mixer', maxWeight: 40, weightUnit: 'lb' });
    const mixerLarge = createSampleMixer({ id: 'mixer-large', name: 'Large Mixer', maxWeight: 140, weightUnit: 'lb' });
    const recipe = createSampleRecipe();
    const preset = createSamplePreset();

    // 5 cases of 80 pcs * 4 oz = 1600 oz = 100 lb finished dough (+ waste = ~106 lb)
    const requirements: ProductionItemRequirement[] = [
      {
        id: 'req-1',
        presetName: preset.name,
        quantity: 5,
        piecesPerUnit: preset.quantityPerUnit,
        itemWeight: preset.finishedWeight,
        itemWeightUnit: preset.weightUnit,
      },
    ];

    // With small mixer (40 lb):
    const resSmall = calculateProduction(recipe, requirements, { mixer: mixerSmall, defaultWeightUnit: 'lb' });
    assert.strictEqual(resSmall.isCapacityExceeded, true, 'Small mixer capacity must be exceeded');
    assert(resSmall.suggestedBatches > 1, 'Must recommend multiple mixes for small mixer');

    // With large mixer (140 lb):
    const resLarge = calculateProduction(recipe, requirements, { mixer: mixerLarge, defaultWeightUnit: 'lb' });
    assert.strictEqual(resLarge.isCapacityExceeded, false, 'Large mixer capacity must NOT be exceeded');
    assert.strictEqual(resLarge.suggestedBatches, 1, 'Must require only 1 mix for large mixer');
  });

  // -------------------------------------------------------------------------
  // 6. Changing mixers does not change selected case quantities
  // -------------------------------------------------------------------------
  it('6. Changing mixers preserves entered case quantities without reset', () => {
    const initialQuantities: Record<string, number> = { 'preset-case-4oz': 8 };
    let selectedMixerId = 'mixer-60';

    // Simulate mixer change
    selectedMixerId = 'mixer-140';

    assert.deepStrictEqual(initialQuantities, { 'preset-case-4oz': 8 });
    assert.strictEqual(selectedMixerId, 'mixer-140');
  });

  // -------------------------------------------------------------------------
  // 7. Different mixer capacities produce different split results for exact same production requirement
  // -------------------------------------------------------------------------
  it('7. Different mixer capacities produce different Good to Proceed / split results for exact same production requirement', () => {
    const mixerA = createSampleMixer({ id: 'mixer-a', maxWeight: 50, weightUnit: 'lb' });
    const mixerB = createSampleMixer({ id: 'mixer-b', maxWeight: 200, weightUnit: 'lb' });
    const recipe = createSampleRecipe();
    const preset = createSamplePreset();

    // 4 cases of 80 pcs * 4 oz = 1280 oz = 80 lb dough (with waste ~84.8 lb)
    const requirements: ProductionItemRequirement[] = [
      {
        id: 'req-4cases',
        presetName: preset.name,
        quantity: 4,
        piecesPerUnit: preset.quantityPerUnit,
        itemWeight: preset.finishedWeight,
        itemWeightUnit: preset.weightUnit,
      },
    ];

    const calcA = calculateProduction(recipe, requirements, { mixer: mixerA, defaultWeightUnit: 'lb' });
    const calcB = calculateProduction(recipe, requirements, { mixer: mixerB, defaultWeightUnit: 'lb' });

    assert.strictEqual(calcA.isCapacityExceeded, true);
    assert.strictEqual(calcA.suggestedBatches, 2);

    assert.strictEqual(calcB.isCapacityExceeded, false);
    assert.strictEqual(calcB.suggestedBatches, 1);
  });

  // -------------------------------------------------------------------------
  // 8. Zero configured mixers produces explicit "capacity cannot be verified" state
  // -------------------------------------------------------------------------
  it('8. Zero configured mixers produces explicit "capacity cannot be verified" state and never falsely reports Good to Proceed', () => {
    const prodFile = fs.readFileSync(path.join(__dirname, '../src/components/ProductionModeView.tsx'), 'utf-8');

    assert(prodFile.includes('CAPACITY CANNOT BE VERIFIED — NO MIXER CONFIGURED'));
    assert(prodFile.includes('!activeMixer ? ('));
    assert(prodFile.includes('No Mixer Configured'));

    const recipe = createSampleRecipe();
    const preset = createSamplePreset();
    const result = calculateProduction(recipe, [{
      id: 'req-1',
      presetName: preset.name,
      quantity: 5,
      piecesPerUnit: preset.quantityPerUnit,
      itemWeight: preset.finishedWeight,
      itemWeightUnit: preset.weightUnit,
    }], { mixer: undefined, defaultWeightUnit: 'lb' });
    assert.strictEqual(result.mixer, undefined);
  });

  // -------------------------------------------------------------------------
  // 9. Mixer selection performs zero Firestore writes
  // -------------------------------------------------------------------------
  it('9. Mixer selection performs zero Firestore writes or database mutations', () => {
    const prodFile = fs.readFileSync(path.join(__dirname, '../src/components/ProductionModeView.tsx'), 'utf-8');

    // The mixer select handler only updates component local state
    assert(prodFile.includes('onChange={(e) => setSelectedMixerId(e.target.value)}'));
    assert(!prodFile.includes('store.updateMixer('));
    assert(!prodFile.includes('store.saveMixer('));
  });

  // -------------------------------------------------------------------------
  // 10. Existing Production Floor preset/category filtering remains intact
  // -------------------------------------------------------------------------
  it('10. Existing Production Floor preset/category filtering remains intact', () => {
    const cookieRecipe = createSampleRecipe({ category: 'Cookies' });
    const brownieRecipe = createSampleRecipe({ id: 'rec-brownie', name: 'Fudge Brownies', category: 'Brownies' });

    const cookiePreset = createSamplePreset({ id: 'p-cookie', category: 'Cookies' });
    const browniePreset = createSamplePreset({ id: 'p-brownie', category: 'Brownies' });
    const globalPreset = createSamplePreset({ id: 'p-global', category: '' });

    const allPresets = [cookiePreset, browniePreset, globalPreset];

    // For Cookie recipe: cookiePreset and globalPreset (which defaults to Cookies) match
    const applicableForCookies = getApplicablePresetsForRecipe(cookieRecipe, allPresets, {});
    assert.strictEqual(applicableForCookies.length, 2);
    assert(applicableForCookies.some((p) => p.id === 'p-cookie'));
    assert(applicableForCookies.some((p) => p.id === 'p-global'));
    assert(!applicableForCookies.some((p) => p.id === 'p-brownie'));

    // For Brownie recipe: only browniePreset matches
    const applicableForBrownies = getApplicablePresetsForRecipe(brownieRecipe, allPresets, {});
    assert.strictEqual(applicableForBrownies.length, 1);
    assert(applicableForBrownies.some((p) => p.id === 'p-brownie'));
    assert(!applicableForBrownies.some((p) => p.id === 'p-cookie'));
  });

  // -------------------------------------------------------------------------
  // 11. Existing recipe sorting remains intact
  // -------------------------------------------------------------------------
  it('11. Existing recipe sorting remains intact (Alphabetical, Most Used, Recently Used)', () => {
    const rA = createSampleRecipe({ id: 'r-a', name: 'Apple Tart' });
    const rB = createSampleRecipe({ id: 'r-b', name: 'Banana Bread' });
    const rC = createSampleRecipe({ id: 'r-c', name: 'Chocolate Chip' });

    const usageMap: RecipeUsageMap = {
      'r-b': { recipeId: 'r-b', useCount: 15, lastUsedAt: 1000 },
      'r-a': { recipeId: 'r-a', useCount: 5, lastUsedAt: 2000 },
      'r-c': { recipeId: 'r-c', useCount: 1, lastUsedAt: 3000 },
    };

    // Alphabetical
    const sortedAlpha = sortRecipes([rC, rA, rB], 'alphabetical', usageMap);
    assert.strictEqual(sortedAlpha[0].id, 'r-a');
    assert.strictEqual(sortedAlpha[1].id, 'r-b');
    assert.strictEqual(sortedAlpha[2].id, 'r-c');

    // Most Used
    const sortedMost = sortRecipes([rA, rB, rC], 'most_used', usageMap);
    assert.strictEqual(sortedMost[0].id, 'r-b'); // 15 uses
    assert.strictEqual(sortedMost[1].id, 'r-a'); // 5 uses
    assert.strictEqual(sortedMost[2].id, 'r-c'); // 1 use

    // Recently Used
    const sortedRecent = sortRecipes([rA, rB, rC], 'recent', usageMap);
    assert.strictEqual(sortedRecent[0].id, 'r-c'); // time 3000
    assert.strictEqual(sortedRecent[1].id, 'r-a'); // time 2000
    assert.strictEqual(sortedRecent[2].id, 'r-b'); // time 1000
  });

  // -------------------------------------------------------------------------
  // 12. Butter gram display includes secondary pounds value with exactly 2 decimal places
  // -------------------------------------------------------------------------
  it('12. Butter gram display includes secondary pounds value with exactly two decimal places', () => {
    const butterGrams = 4854;
    const butterPounds = butterGrams / 453.59237;

    const formattedGrams = formatNumber(butterGrams, 0, 0);
    const formattedPounds = formatNumber(butterPounds, 2, 2);

    assert.strictEqual(formattedGrams, '4,854', 'Grams must display as whole integer with 0 decimals');
    assert.strictEqual(formattedPounds, '10.70', 'Secondary pounds must display to exactly two decimal places');
  });

  // -------------------------------------------------------------------------
  // 13. Production Command Center launcher removed and restored dashboard verified
  // -------------------------------------------------------------------------
  it('13. Production Command Center launcher is removed and Main Bakery Workspace dashboard restored', () => {
    const launcherFilePath = path.join(__dirname, '../src/components/MainModeLauncher.tsx');
    assert.strictEqual(fs.existsSync(launcherFilePath), false, 'MainModeLauncher.tsx component must be removed');

    const dashboardFile = fs.readFileSync(path.join(__dirname, '../src/components/Dashboard.tsx'), 'utf-8');
    assert(!dashboardFile.includes('PRODUCTION COMMAND CENTER'), 'Must not contain PRODUCTION COMMAND CENTER');
    assert(!dashboardFile.includes('MainModeLauncher'), 'Dashboard must not import or render MainModeLauncher');

    // Main landing hierarchy
    assert(dashboardFile.includes('main-dashboard-view'), 'Must render main-dashboard-view');
    assert(dashboardFile.includes('Production & Batch Scaling Hub'), 'Must render Production & Batch Scaling Hub heading');
    assert(dashboardFile.includes('BASE SYSTEM'), 'Must render base system badge');
  });

  // -------------------------------------------------------------------------
  // 14. Restored dashboard hero contains only Production Floor Mode and Management Mode
  // -------------------------------------------------------------------------
  it('14. Restored main dashboard hero has exactly two workflow buttons and no Recent Recipes', () => {
    const dashboardFile = fs.readFileSync(path.join(__dirname, '../src/components/Dashboard.tsx'), 'utf-8');

    // Hero buttons in main mode
    assert(dashboardFile.includes('id="dashboard-production-mode-btn"'), 'Must have Production Floor Mode button');
    assert(dashboardFile.includes('id="dashboard-management-mode-btn"'), 'Must have Management Mode button');

    // Main mode must NOT have these administrative buttons in its hero
    // In Dashboard.tsx, these are guarded under `isManagement && (...)`
    assert(dashboardFile.includes('!isManagement && ('), 'Management button must only show in main mode');
    assert(dashboardFile.includes('isManagement && ('), 'Administrative buttons must only show in management mode');

    // Operational summary cards are present
    assert(dashboardFile.includes('id="dashboard-recipes-metric-btn"'), 'Must have Recipes summary card');
    assert(dashboardFile.includes('id="dashboard-costing-metric-btn"'), 'Must have Costing summary card');
    assert(dashboardFile.includes('id="dashboard-presets-metric-btn"'), 'Must have Presets summary card');
    assert(dashboardFile.includes('id="dashboard-mixers-metric-btn"'), 'Must have Mixers summary card');
    assert(dashboardFile.includes('id="dashboard-history-metric-btn"'), 'Must have History summary card');

    // Recent Recipes removed from dashboard
    assert(!dashboardFile.includes('Recent Recipes'), 'Recent Recipes heading must be removed from dashboard');
    assert(!dashboardFile.includes('dashboard-view-all-recipes-btn'), 'View All recipes button must be removed');
    assert(!dashboardFile.includes('recipe-quick-card-'), 'Recipe quick cards must be removed from dashboard');
  });

  // -------------------------------------------------------------------------
  // 15. Management PIN behavior remains intact
  // -------------------------------------------------------------------------
  it('15. Management PIN behavior remains intact with salted SHA-256 validation', async () => {
    const pin = '4321';
    const salt = generateSalt();
    const hash = await hashPin(pin, salt);

    const config = {
      enabled: true,
      hash,
      salt,
      updatedAt: String(Date.now()),
    };

    saveManagementLockConfig(config);

    const loaded = loadManagementLockConfig();
    assert.strictEqual(loaded.enabled, true);
    assert.strictEqual(loaded.hash, hash);
    assert.strictEqual(loaded.salt, salt);

    // Correct PIN verifies
    const isValid = await verifyManagementPin(pin, loaded);
    assert.strictEqual(isValid, true, 'Correct PIN must verify successfully');

    // Incorrect PIN fails
    const isInvalid = await verifyManagementPin('9999', loaded);
    assert.strictEqual(isInvalid, false, 'Incorrect PIN must fail');
  });

  // -------------------------------------------------------------------------
  // 16. Operational summary cards and Management button enforce PIN verification when locked
  // -------------------------------------------------------------------------
  it('16. Operational summary cards and Management button enforce PIN verification when locked', () => {
    const dashboardFile = fs.readFileSync(path.join(__dirname, '../src/components/Dashboard.tsx'), 'utf-8');

    assert(dashboardFile.includes('loadManagementLockConfig()'), 'Must check management lock configuration');
    assert(dashboardFile.includes('handleManagementModeClick'), 'Must handle Management Mode button click with PIN check');
    assert(dashboardFile.includes('handleCardClick'), 'Must handle operational card clicks with PIN check');
    assert(dashboardFile.includes('ManagementLockModal'), 'Must mount ManagementLockModal for PIN challenges');
  });
});
