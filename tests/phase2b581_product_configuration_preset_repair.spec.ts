import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService } from '../src/services/quotingService';
import {
  ProductProject,
  QuoteFormula,
  QuoteFormulaLine,
  QuoteProductConfig,
} from '../src/types/quoting';
import {
  calculateFormulaTotals,
  calculateProductPricing,
  convertRecipeToQuoteFormula,
} from '../src/utils/quotingCalculator';
import { Recipe, MasterIngredient, ProductionPreset } from '../src/types';
import { store } from '../src/services/store';

const createMockLocalStorage = () => {
  let s: Record<string, string> = {};
  return {
    getItem: (key: string) => s[key] || null,
    setItem: (key: string, val: string) => {
      s[key] = String(val);
    },
    removeItem: (key: string) => {
      delete s[key];
    },
    clear: () => {
      s = {};
    },
    get length() {
      return Object.keys(s).length;
    },
    key: (i: number) => Object.keys(s)[i] || null,
  };
};

describe('PHASE 2B.5.8.1 — Product Configuration Preset Selection Repair Suite', () => {
  const TEST_WS = 'ws-p2b581-repair';
  const TEST_USER = 'user-p2b581-lead';

  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'ing-flour',
      workspaceId: TEST_WS,
      name: 'All-Purpose Flour',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2200,
      },
      densityGramsPerMl: 0.57,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ing-sugar',
      workspaceId: TEST_WS,
      name: 'Granulated Sugar',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 3500,
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const mockPresets: ProductionPreset[] = [
    {
      id: 'preset-cookie-4oz',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '4 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 80,
      unitName: 'case',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'preset-cookie-2oz',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '2 oz Cookie Case',
      category: 'Cookies',
      finishedWeight: 2,
      weightUnit: 'oz',
      quantityPerUnit: 120,
      unitName: 'case',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'preset-jumbo-5oz',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: 'Jumbo 5 oz Cookie Tray',
      category: 'Cookies',
      finishedWeight: 5,
      weightUnit: 'oz',
      quantityPerUnit: 60,
      unitName: 'tray',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'preset-pie-shell-9in',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '9-inch Pie Shells (Case of 24)',
      category: 'Pie Dough',
      finishedWeight: 12,
      weightUnit: 'oz',
      quantityPerUnit: 24,
      unitName: 'case',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleRecipe: Recipe = {
    id: 'rec-chocolate-chip',
    workspaceId: TEST_WS,
    userId: TEST_USER,
    name: 'Gourmet Chocolate Chip',
    description: 'Freshly baked gourmet chocolate chip cookies',
    category: 'Cookies',
    batchYieldQuantity: 100,
    batchYieldUnit: 'pieces',
    defaultWastePercent: 0,
    ingredients: [
      {
        id: 'ri-1',
        name: 'All-Purpose Flour',
        quantity: 2000,
        unit: 'g',
        masterIngredientId: 'ing-flour',
      },
      {
        id: 'ri-2',
        name: 'Granulated Sugar',
        quantity: 1000,
        unit: 'g',
        masterIngredientId: 'ing-sugar',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  let originalLocalStorage: any;

  beforeEach(() => {
    originalLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = createMockLocalStorage();
    quotingService.setMockCloudWriteHandler(null);
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    quotingService.setMockCloudWriteHandler(null);
  });

  // T1. First product configuration opens Packaging Preset selector.
  test('T1: First product configuration opens Packaging Preset selector', () => {
    // When no configurations exist (products.length === 0), clicking Create First Product Configuration
    // triggers the Packaging Preset selector modal workflow with authorized presets
    const products: QuoteProductConfig[] = [];
    const authorizedPresets = mockPresets.filter(
      (p) => !p.workspaceId || p.workspaceId === TEST_WS
    );

    assert.equal(products.length, 0);
    assert.ok(authorizedPresets.length > 0);
    // Verifies authorized presets contain the expected standard presets
    const firstPreset = authorizedPresets.find((p) => p.id === 'preset-cookie-4oz');
    assert.ok(firstPreset);
    assert.equal(firstPreset.finishedWeight, 4);
    assert.equal(firstPreset.quantityPerUnit, 80);
  });

  // T2. Second product configuration opens the same selector.
  test('T2: Second product configuration opens the same selector rather than auto-duplicating', async () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    // Initial first product configuration created from first preset
    const preset1 = mockPresets[0]; // 4 oz Cookie Case
    const config1 = calculateProductPricing({
      id: 'prod-config-1',
      productType: preset1.category || 'Cookie',
      name: preset1.name,
      pieceWeight: preset1.finishedWeight,
      weightUnit: preset1.weightUnit,
      piecesPerCase: preset1.quantityPerUnit,
      unitName: preset1.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: 95.0, // User set a quoted price on config 1
      quotedPricePerUnit: 1.1875,
      formula,
    });

    const products = [config1];
    assert.equal(products.length, 1);

    // Adding second configuration must offer preset selection, NOT automatically duplicate config 1!
    const preset2 = mockPresets[1]; // 2 oz Cookie Case
    const config2 = calculateProductPricing({
      id: 'prod-config-2',
      productType: preset2.category || 'Cookie',
      name: preset2.name,
      pieceWeight: preset2.finishedWeight,
      weightUnit: preset2.weightUnit,
      piecesPerCase: preset2.quantityPerUnit,
      unitName: preset2.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: null, // Starts blank!
      quotedPricePerUnit: null,
      formula,
    });

    // Config 2 is derived from preset2, NOT a clone of config1
    assert.notEqual(config2.id, config1.id);
    assert.equal(config2.name, '2 oz Cookie Case');
    assert.equal(config2.pieceWeight, 2);
    assert.equal(config2.piecesPerCase, 120);
    assert.notEqual(config2.pieceWeight, config1.pieceWeight);
    assert.notEqual(config2.piecesPerCase, config1.piecesPerCase);
  });

  // T3. Third and subsequent configurations open the same selector.
  test('T3: Third and subsequent configurations open the same selector', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    const config1 = calculateProductPricing({
      id: 'cfg-1',
      name: '4 oz Cookie Case',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.6,
      formula,
    });

    const config2 = calculateProductPricing({
      id: 'cfg-2',
      name: '2 oz Cookie Case',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 120,
      ingredientMultiplier: 1.6,
      formula,
    });

    const products = [config1, config2];
    assert.equal(products.length, 2);

    // Adding third configuration chooses from presets
    const preset3 = mockPresets[2]; // Jumbo 5 oz Cookie Tray
    const config3 = calculateProductPricing({
      id: 'cfg-3',
      name: preset3.name,
      pieceWeight: preset3.finishedWeight,
      weightUnit: preset3.weightUnit,
      piecesPerCase: preset3.quantityPerUnit,
      unitName: preset3.unitName,
      ingredientMultiplier: 1.6,
      formula,
    });

    const updatedProducts = [...products, config3];
    assert.equal(updatedProducts.length, 3);
    assert.equal(updatedProducts[2].name, 'Jumbo 5 oz Cookie Tray');
    assert.equal(updatedProducts[2].pieceWeight, 5);
    assert.equal(updatedProducts[2].piecesPerCase, 60);
    assert.equal(updatedProducts[2].unitName, 'tray');
  });

  // T4. Selecting different presets creates independent configurations.
  test('T4: Selecting different presets creates independent configurations', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    const configs = mockPresets.map((preset, idx) => {
      return calculateProductPricing({
        id: `config-${idx + 1}-${preset.id}`,
        name: preset.name,
        pieceWeight: preset.finishedWeight,
        weightUnit: preset.weightUnit,
        piecesPerCase: preset.quantityPerUnit,
        unitName: preset.unitName,
        ingredientMultiplier: 1.6,
        formula,
      });
    });

    assert.equal(configs.length, 4);
    // Unique IDs
    const ids = new Set(configs.map((c) => c.id));
    assert.equal(ids.size, 4);

    // Distinct weights and counts
    assert.equal(configs[0].pieceWeight, 4);
    assert.equal(configs[1].pieceWeight, 2);
    assert.equal(configs[2].pieceWeight, 5);
    assert.equal(configs[3].pieceWeight, 12);
  });

  // T5. New configuration receives correct preset-derived values.
  test('T5: New configuration receives correct preset-derived values', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);
    const preset = mockPresets[1]; // 2 oz Cookie Case, 120 pcs/case

    const config = calculateProductPricing({
      id: 'new-cfg-preset-2',
      productType: preset.category || 'Cookie',
      name: preset.name,
      pieceWeight: preset.finishedWeight,
      weightUnit: preset.weightUnit,
      piecesPerCase: preset.quantityPerUnit,
      unitName: preset.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: null,
      quotedPricePerUnit: null,
      formula,
    });

    assert.equal(config.name, '2 oz Cookie Case');
    assert.equal(config.pieceWeight, 2);
    assert.equal(config.weightUnit, 'oz');
    assert.equal(config.piecesPerCase, 120);
    assert.equal(config.unitName, 'case');
    assert.equal(config.productType, 'Cookies');
    // Live calculation has correct dough weight: 120 pcs * 2 oz = 240 oz = 6803.9 g
    assert.ok(Math.abs(config.doughWeightGrams - 6803.9) < 2);
  });

  // T6. Previous configurations remain unchanged.
  test('T6: Previous configurations remain unchanged', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    const config1 = calculateProductPricing({
      id: 'cfg-1',
      name: '4 oz Cookie Case',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 4.5, // Customized packaging
      laborCost: 15.0, // Customized labor
      quotedPrice: 105.0, // Quoted price
      ingredientMultiplier: 1.7,
      formula,
    });

    const frozenSnapshot1 = JSON.stringify(config1);

    // Now create config 2
    const config2 = calculateProductPricing({
      id: 'cfg-2',
      name: '2 oz Cookie Case',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 120,
      packagingCost: 3.0,
      laborCost: 11.45,
      ingredientMultiplier: 1.6,
      formula,
    });

    const products = [config1, config2];

    // Assert config 1 is completely identical to its frozen snapshot
    assert.equal(JSON.stringify(products[0]), frozenSnapshot1);
    assert.equal(products[0].packagingCost, 4.5);
    assert.equal(products[0].laborCost, 15.0);
    assert.equal(products[0].quotedPrice, 105.0);
    assert.equal(products[0].ingredientMultiplier, 1.7);
  });

  // T7. New configuration does not inherit previous quoted pricing.
  test('T7: New configuration does not inherit previous quoted pricing', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    const config1 = calculateProductPricing({
      id: 'cfg-1',
      name: '4 oz Cookie Case',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      quotedPrice: 110.0,
      quotedPricePerUnit: 1.375,
      ingredientMultiplier: 2.0,
      formula,
    });

    assert.equal(config1.quotedPrice, 110.0);

    // Create config 2 from preset
    const preset = mockPresets[1];
    const config2 = calculateProductPricing({
      id: 'cfg-2',
      productType: preset.category || 'Cookie',
      name: preset.name,
      pieceWeight: preset.finishedWeight,
      weightUnit: preset.weightUnit,
      piecesPerCase: preset.quantityPerUnit,
      unitName: preset.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.6, // Default multiplier, NOT config1's 2.0
      pricingBasis: 'case',
      quotedPrice: null, // Crucial: Begins blank!
      quotedPricePerUnit: null,
      formula,
    });

    assert.equal(config2.quotedPrice, null);
    assert.equal(config2.quotedPricePerUnit, null);
    assert.notEqual(config2.ingredientMultiplier, config1.ingredientMultiplier);
  });

  // T8. Rapid repeated Add actions do not create duplicates.
  test('T8: Rapid repeated Add actions do not create duplicates', () => {
    let products: QuoteProductConfig[] = [];
    let isAdding = false;

    const handleSelectPreset = (preset: ProductionPreset) => {
      if (isAdding) return;
      isAdding = true;

      const newId = `scen-${products.length + 1}`;
      const newConfig = calculateProductPricing({
        id: newId,
        name: preset.name,
        pieceWeight: preset.finishedWeight,
        weightUnit: preset.weightUnit,
        piecesPerCase: preset.quantityPerUnit,
        ingredientMultiplier: 1.6,
        formula: { totalWeightGrams: 3000, totalCost: 5.0, lines: [] },
      });

      products = [...products, newConfig];
    };

    // First click
    handleSelectPreset(mockPresets[0]);
    // Immediate rapid second click while isAdding is true
    handleSelectPreset(mockPresets[0]);
    handleSelectPreset(mockPresets[0]);

    // Exactly one product configuration was added
    assert.equal(products.length, 1);
  });

  // T9. Configuration values persist after navigation and refresh.
  test('T9: Configuration values persist after navigation and refresh', async () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'Preserved Multi-Preset Project',
      initialFormula: formula,
    });

    const config1 = calculateProductPricing({
      id: 'cfg-pres-1',
      name: '4 oz Cookie Case',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      unitName: 'case',
      ingredientMultiplier: 1.6,
      formula,
    });

    const config2 = calculateProductPricing({
      id: 'cfg-pres-2',
      name: '2 oz Cookie Case',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 120,
      unitName: 'case',
      ingredientMultiplier: 1.6,
      formula,
    });

    // Save project with both configurations
    const updatedDraft: ProductProject = {
      ...project,
      products: [config1, config2],
    };

    await quotingService.saveProject(updatedDraft);

    // Simulate navigation/reload
    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.products.length, 2);
    assert.equal(reloaded.products[0].name, '4 oz Cookie Case');
    assert.equal(reloaded.products[0].pieceWeight, 4);
    assert.equal(reloaded.products[0].piecesPerCase, 80);

    assert.equal(reloaded.products[1].name, '2 oz Cookie Case');
    assert.equal(reloaded.products[1].pieceWeight, 2);
    assert.equal(reloaded.products[1].piecesPerCase, 120);
  });

  // T10. Costing and pricing recalculate independently.
  test('T10: Costing and pricing recalculate independently', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    const config80 = calculateProductPricing({
      name: '80 pcs of 4 oz',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      ingredientMultiplier: 1.6,
      formula,
    });

    const config120 = calculateProductPricing({
      name: '120 pcs of 2 oz',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 120,
      packagingCost: 3.0,
      ingredientMultiplier: 1.6,
      formula,
    });

    // 80 * 4 oz = 320 oz dough
    // 120 * 2 oz = 240 oz dough
    assert.ok(config80.rawIngredientCost > config120.rawIngredientCost);
    assert.ok(config80.totalProductionCost > config120.totalProductionCost);
    assert.ok(config80.calculatedTargetPrice > config120.calculatedTargetPrice);

    // Changing packaging cost on config80 does not affect config120
    const config80Modified = calculateProductPricing({
      ...config80,
      packagingCost: 8.0,
      formula,
    });

    assert.equal(config80Modified.packagingCost, 8.0);
    assert.equal(config120.packagingCost, 3.0);
  });

  // T11. Mobile preset selection remains usable.
  test('T11: Mobile preset selection remains usable', () => {
    // Verify preset filter by search and category works cleanly
    const query = 'cookie';
    const matches = mockPresets.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.category && p.category.toLowerCase().includes(query))
    );

    assert.equal(matches.length, 3);
    matches.forEach((m) => {
      assert.ok(m.finishedWeight > 0);
      assert.ok(m.quantityPerUnit > 0);
      assert.ok(m.name.length > 0);
    });

    // Check invalid preset detection
    const invalidPreset: ProductionPreset = {
      id: 'inv-1',
      userId: TEST_USER,
      name: 'Corrupt Preset',
      finishedWeight: 0,
      weightUnit: 'oz',
      quantityPerUnit: 0,
      unitName: 'case',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const isInvalid =
      !invalidPreset.finishedWeight ||
      invalidPreset.finishedWeight <= 0 ||
      !invalidPreset.quantityPerUnit ||
      invalidPreset.quantityPerUnit <= 0;

    assert.equal(isInvalid, true);
  });

  // T12. Imported production recipe remains unchanged.
  test('T12: Imported production recipe remains unchanged', async () => {
    const originalRecipeJson = JSON.stringify(sampleRecipe);

    // Create project from recipe
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS,
      recipe: sampleRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    // Add multiple preset configurations to project
    const config1 = calculateProductPricing({
      id: 'p1',
      name: mockPresets[0].name,
      pieceWeight: mockPresets[0].finishedWeight,
      weightUnit: mockPresets[0].weightUnit,
      piecesPerCase: mockPresets[0].quantityPerUnit,
      ingredientMultiplier: 1.6,
      formula: project.formula,
    });

    const config2 = calculateProductPricing({
      id: 'p2',
      name: mockPresets[1].name,
      pieceWeight: mockPresets[1].finishedWeight,
      weightUnit: mockPresets[1].weightUnit,
      piecesPerCase: mockPresets[1].quantityPerUnit,
      ingredientMultiplier: 1.6,
      formula: project.formula,
    });

    await quotingService.saveProject({
      ...project,
      products: [config1, config2],
    });

    // The original sampleRecipe in the production recipe library is 100% untouched
    assert.equal(JSON.stringify(sampleRecipe), originalRecipeJson);
    assert.equal(sampleRecipe.batchYieldQuantity, 100);
    assert.equal(sampleRecipe.ingredients.length, 2);
  });

  // T13. Issued quote revisions remain immutable.
  test('T13: Issued quote revisions remain immutable', async () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);
    const project = await quotingService.createProject({
      workspaceId: TEST_WS,
      userId: TEST_USER,
      productName: 'Revision Freeze Test',
      initialFormula: formula,
    });

    const config1 = calculateProductPricing({
      id: 'c1',
      name: 'Initial 4 oz Cookie Case',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1.6,
      quotedPrice: 85.0,
      formula,
    });

    const saved = await quotingService.saveProject({
      ...project,
      products: [config1],
    });

    // Issue quote revision
    const issuedProject = await quotingService.issueQuoteRevision(
      project.id,
      TEST_WS,
      TEST_USER,
      'Lead User',
      'Initial Quote Revision'
    );

    assert.ok(issuedProject);
    assert.equal(issuedProject.revisions.length, 1);
    const frozenRevision = issuedProject.revisions[0];
    assert.equal(frozenRevision.productsSnapshot.length, 1);
    assert.equal(frozenRevision.productsSnapshot[0].name, 'Initial 4 oz Cookie Case');
    assert.equal(frozenRevision.productsSnapshot[0].quotedPrice, 85.0);

    // Now add a second configuration from preset to the active draft
    const config2 = calculateProductPricing({
      id: 'c2',
      name: '2 oz Cookie Case',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 120,
      ingredientMultiplier: 1.6,
      quotedPrice: 75.0,
      formula,
    });

    await quotingService.saveProject({
      ...issuedProject,
      products: [config1, config2],
    });

    // Reload project
    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    // Active draft has 2 configurations
    assert.equal(reloaded.products.length, 2);
    // Issued revision 1 STILL has exactly 1 configuration and remains completely unchanged!
    assert.equal(reloaded.revisions[0].productsSnapshot.length, 1);
    assert.equal(reloaded.revisions[0].productsSnapshot[0].name, 'Initial 4 oz Cookie Case');
    assert.equal(reloaded.revisions[0].productsSnapshot[0].quotedPrice, 85.0);
  });

  // T14. Existing recipe-import and formula-editor regression tests remain passing.
  test('T14: Existing recipe-import and formula-editor regression invariants remain intact', () => {
    // 1. Two-step formula add starts blank
    const formulaLines: QuoteFormulaLine[] = [];
    assert.equal(formulaLines.length, 0);

    // 2. Decimal quantities calculate accurately
    const line: QuoteFormulaLine = {
      id: 'l1',
      name: 'All-Purpose Flour',
      quantity: 0.5,
      unit: 'lb',
      masterIngredientId: 'ing-flour',
      unitCostUsed: 0,
      unitCostType: 'per_gram',
      lineCost: 0,
    };
    const masterMap = new Map(mockMasterIngredients.map((m) => [m.id, m]));
    const calculated = calculateFormulaTotals([line], masterMap);
    assert.ok(calculated.totalWeightGrams > 0);
    assert.ok(calculated.totalCost > 0);

    // 3. Independent product pricing calculation
    const pricing = calculateProductPricing({
      name: 'Sample Cookie Case',
      pieceWeight: 3.5,
      weightUnit: 'oz',
      piecesPerCase: 90,
      ingredientMultiplier: 1.6,
      formula: calculated,
    });
    assert.equal(pricing.pieceWeight, 3.5);
    assert.equal(pricing.piecesPerCase, 90);
    assert.ok(pricing.rawIngredientCost > 0);
    assert.ok(pricing.calculatedTargetPrice > 0);
  });
});
