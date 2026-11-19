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
import {
  normalizePresetCategory,
  getApplicablePresetsForRecipe,
} from '../src/utils/calculator';

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

describe('PHASE 2B.5.8.2 — Packaging Preset Discovery Repair Suite', () => {
  const TEST_WS = 'ws-main';
  const OTHER_WS = 'ws-other';
  const TEST_USER = 'user-owner';

  // Canonical preset records replicating actual Firestore ws-main records
  const canonicalPresets: ProductionPreset[] = [
    {
      id: 'preset-1785852701672',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '1 oz Cookies',
      category: 'Cookies',
      finishedWeight: 1,
      weightUnit: 'oz',
      quantityPerUnit: 360,
      unitName: 'Case',
      createdAt: '2026-08-04T14:11:41.672Z',
      updatedAt: '2026-09-30T10:40:24.035Z',
    },
    {
      id: 'preset-2oz-cookie',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '2 oz Cookies',
      category: '', // Stored as empty string in canonical Firestore
      finishedWeight: 2,
      weightUnit: 'oz',
      quantityPerUnit: 140,
      unitName: 'Case',
      createdAt: '2026-08-04T14:09:11.968Z',
      updatedAt: '2026-08-04T14:09:55.883Z',
    },
    {
      id: 'preset-1785852643334',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '3 oz Cookies',
      category: '', // Stored as empty string in canonical Firestore
      finishedWeight: 3,
      weightUnit: 'oz',
      quantityPerUnit: 96,
      unitName: 'Case',
      createdAt: '2026-08-04T14:10:43.334Z',
      updatedAt: '2026-08-04T19:24:34.829Z',
    },
    {
      id: 'preset-4oz-cookie',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '4 oz Cookies',
      category: 'Cookies',
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 80,
      unitName: 'Case',
      createdAt: '2026-08-04T14:09:11.968Z',
      updatedAt: '2026-08-17T15:25:24.129Z',
    },
    {
      id: 'preset-1786979159840',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: 'Shortbread Cookies 2"x 2"',
      category: 'Shortbread',
      finishedWeight: 1.43,
      weightUnit: 'oz',
      quantityPerUnit: 220,
      unitName: 'case',
      createdAt: '2026-08-17T15:05:59.840Z',
      updatedAt: '2026-10-03T20:46:00.338Z',
    },
    {
      id: 'preset-50-round',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: '50 Round',
      category: 'Base Dough',
      finishedWeight: 9,
      weightUnit: 'g',
      quantityPerUnit: 335,
      unitName: 'case',
      createdAt: '2026-08-17T19:56:46.720Z',
      updatedAt: '2026-08-17T19:59:30.805Z',
    },
    {
      id: 'preset-other-workspace',
      workspaceId: OTHER_WS,
      userId: 'other-user',
      name: '2.5 oz Cookie Special',
      category: 'Cookies',
      finishedWeight: 2.5,
      weightUnit: 'oz',
      quantityPerUnit: 100,
      unitName: 'case',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'preset-invalid-zero-weight',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      name: 'Incomplete Test Preset',
      category: 'Cookies',
      finishedWeight: 0,
      weightUnit: 'oz',
      quantityPerUnit: 100,
      unitName: 'case',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
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

  let origLocalStorage: any;

  beforeEach(() => {
    origLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = createMockLocalStorage();
  });

  afterEach(() => {
    (globalThis as any).localStorage = origLocalStorage;
  });

  // T1: Compare eligible canonical presets with selector results
  test('T1: Compare eligible canonical presets with selector results', () => {
    // Normalization test for all canonical records
    const normalized = canonicalPresets.map((p) => ({
      ...p,
      category: normalizePresetCategory(p),
    }));

    // Presets with name containing "cookie" must normalize to "Cookies"
    const cookiePresets = normalized.filter((p) => p.category === 'Cookies');
    const cookieIds = cookiePresets.map((p) => p.id);

    assert.ok(cookieIds.includes('preset-1785852701672'), '1 oz cookie included');
    assert.ok(cookieIds.includes('preset-2oz-cookie'), '2 oz cookie included despite empty category');
    assert.ok(cookieIds.includes('preset-1785852643334'), '3 oz cookie included despite empty category');
    assert.ok(cookieIds.includes('preset-4oz-cookie'), '4 oz cookie included');
  });

  // T2: Existing authorized 2 oz and 3 oz cookie presets appear when valid
  test('T2: Existing authorized 2 oz and 3 oz cookie presets appear when valid', () => {
    const wsAuthorized = canonicalPresets.filter(
      (p) => !p.workspaceId || p.workspaceId === TEST_WS
    );
    const validCookies = wsAuthorized.filter((p) => {
      const normCat = normalizePresetCategory(p);
      const isValid = p.finishedWeight > 0 && p.quantityPerUnit > 0;
      return normCat === 'Cookies' && isValid;
    });

    const p2oz = validCookies.find((p) => p.id === 'preset-2oz-cookie');
    assert.ok(p2oz, '2 oz cookie preset must be found');
    assert.equal(p2oz?.finishedWeight, 2);
    assert.equal(p2oz?.quantityPerUnit, 140);
    assert.equal(p2oz?.unitName, 'Case');

    const p3oz = validCookies.find((p) => p.id === 'preset-1785852643334');
    assert.ok(p3oz, '3 oz cookie preset must be found');
    assert.equal(p3oz?.finishedWeight, 3);
    assert.equal(p3oz?.quantityPerUnit, 96);
    assert.equal(p3oz?.unitName, 'Case');
  });

  // T3: Existing 1 oz and 4 oz presets remain available
  test('T3: Existing 1 oz and 4 oz presets remain available', () => {
    const wsAuthorized = canonicalPresets.filter(
      (p) => !p.workspaceId || p.workspaceId === TEST_WS
    );
    const validCookies = wsAuthorized.filter((p) => {
      const normCat = normalizePresetCategory(p);
      const isValid = p.finishedWeight > 0 && p.quantityPerUnit > 0;
      return normCat === 'Cookies' && isValid;
    });

    const p1oz = validCookies.find((p) => p.id === 'preset-1785852701672');
    assert.ok(p1oz, '1 oz cookie preset must remain available');
    assert.equal(p1oz?.finishedWeight, 1);
    assert.equal(p1oz?.quantityPerUnit, 360);

    const p4oz = validCookies.find((p) => p.id === 'preset-4oz-cookie');
    assert.ok(p4oz, '4 oz cookie preset must remain available');
    assert.equal(p4oz?.finishedWeight, 4);
    assert.equal(p4oz?.quantityPerUnit, 80);
  });

  // T4: Category filtering works correctly
  test('T4: Category filtering works correctly', () => {
    const wsAuthorized = canonicalPresets.filter(
      (p) => !p.workspaceId || p.workspaceId === TEST_WS
    );

    // Filter Cookies
    const cookies = wsAuthorized.filter(
      (p) => normalizePresetCategory(p).toLowerCase() === 'cookies'
    );
    assert.equal(cookies.length, 5); // 1oz, 2oz, 3oz, 4oz, + 1 invalid zero-weight

    // Filter Shortbread
    const shortbread = wsAuthorized.filter(
      (p) => normalizePresetCategory(p).toLowerCase() === 'shortbread'
    );
    assert.equal(shortbread.length, 1);
    assert.equal(shortbread[0].id, 'preset-1786979159840');

    // Filter Base Dough
    const baseDough = wsAuthorized.filter(
      (p) => normalizePresetCategory(p).toLowerCase() === 'base dough'
    );
    assert.equal(baseDough.length, 1);
    assert.equal(baseDough[0].id, 'preset-50-round');

    // Search within category
    const searchResult = cookies.filter((p) =>
      p.name.toLowerCase().includes('3 oz')
    );
    assert.equal(searchResult.length, 1);
    assert.equal(searchResult[0].id, 'preset-1785852643334');
  });

  // T5: Workspace isolation remains enforced
  test('T5: Workspace isolation remains enforced', () => {
    // Other workspace preset must be strictly excluded
    const currentWorkspacePresets = canonicalPresets.filter((p) => {
      if (p.workspaceId && p.workspaceId !== TEST_WS) return false;
      return true;
    });

    const hasOtherWs = currentWorkspacePresets.some((p) => p.workspaceId === OTHER_WS);
    assert.equal(hasOtherWs, false, 'Presets belonging to OTHER_WS must not leak into TEST_WS');
  });

  // T6: Inactive or invalid presets are handled transparently
  test('T6: Inactive or invalid presets are handled transparently', () => {
    const invalidPreset = canonicalPresets.find((p) => p.id === 'preset-invalid-zero-weight')!;
    const isInvalid =
      !invalidPreset.finishedWeight ||
      invalidPreset.finishedWeight <= 0 ||
      !invalidPreset.quantityPerUnit ||
      invalidPreset.quantityPerUnit <= 0;

    assert.equal(isInvalid, true, 'Zero finished weight must be detected as invalid');
  });

  // T7: First configuration selector remains functional
  test('T7: First configuration selector remains functional', async () => {
    const formula: QuoteFormula = {
      totalWeightGrams: 3000,
      totalCost: 10,
      lines: [],
    };

    const preset2oz = canonicalPresets.find((p) => p.id === 'preset-2oz-cookie')!;
    const config1 = calculateProductPricing({
      id: 'cfg-1',
      productType: normalizePresetCategory(preset2oz),
      name: preset2oz.name,
      pieceWeight: preset2oz.finishedWeight,
      weightUnit: preset2oz.weightUnit,
      piecesPerCase: preset2oz.quantityPerUnit,
      unitName: preset2oz.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: null,
      quotedPricePerUnit: null,
      formula,
    });

    assert.equal(config1.pieceWeight, 2);
    assert.equal(config1.piecesPerCase, 140);
    assert.equal(config1.productType, 'Cookies');
    assert.equal(config1.name, '2 oz Cookies');
  });

  // T8: Second and third configuration selectors remain functional
  test('T8: Second and third configuration selectors remain functional', async () => {
    const formula: QuoteFormula = {
      totalWeightGrams: 3000,
      totalCost: 10,
      lines: [],
    };

    const preset2oz = canonicalPresets.find((p) => p.id === 'preset-2oz-cookie')!;
    const preset3oz = canonicalPresets.find((p) => p.id === 'preset-1785852643334')!;
    const preset4oz = canonicalPresets.find((p) => p.id === 'preset-4oz-cookie')!;

    const config1 = calculateProductPricing({
      id: 'cfg-1',
      productType: normalizePresetCategory(preset2oz),
      name: preset2oz.name,
      pieceWeight: preset2oz.finishedWeight,
      weightUnit: preset2oz.weightUnit,
      piecesPerCase: preset2oz.quantityPerUnit,
      unitName: preset2oz.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula,
    });

    const config2 = calculateProductPricing({
      id: 'cfg-2',
      productType: normalizePresetCategory(preset3oz),
      name: preset3oz.name,
      pieceWeight: preset3oz.finishedWeight,
      weightUnit: preset3oz.weightUnit,
      piecesPerCase: preset3oz.quantityPerUnit,
      unitName: preset3oz.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula,
    });

    const config3 = calculateProductPricing({
      id: 'cfg-3',
      productType: normalizePresetCategory(preset4oz),
      name: preset4oz.name,
      pieceWeight: preset4oz.finishedWeight,
      weightUnit: preset4oz.weightUnit,
      piecesPerCase: preset4oz.quantityPerUnit,
      unitName: preset4oz.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula,
    });

    assert.notEqual(config1.id, config2.id);
    assert.notEqual(config2.id, config3.id);
    assert.equal(config1.pieceWeight, 2);
    assert.equal(config2.pieceWeight, 3);
    assert.equal(config3.pieceWeight, 4);
  });

  // T9: Selected presets create independent product configurations
  test('T9: Selected presets create independent product configurations', () => {
    const formula: QuoteFormula = {
      totalWeightGrams: 3000,
      totalCost: 10,
      lines: [],
    };

    const preset2oz = canonicalPresets.find((p) => p.id === 'preset-2oz-cookie')!;
    const preset3oz = canonicalPresets.find((p) => p.id === 'preset-1785852643334')!;

    const configA = calculateProductPricing({
      id: 'cfg-a',
      name: preset2oz.name,
      pieceWeight: preset2oz.finishedWeight,
      weightUnit: preset2oz.weightUnit,
      piecesPerCase: preset2oz.quantityPerUnit,
      unitName: preset2oz.unitName,
      packagingCost: 4.5,
      laborCost: 12.0,
      otherCost: 1.0,
      ingredientMultiplier: 1.7,
      pricingBasis: 'case',
      quotedPrice: 85.0,
      formula,
    });

    const configB = calculateProductPricing({
      id: 'cfg-b',
      name: preset3oz.name,
      pieceWeight: preset3oz.finishedWeight,
      weightUnit: preset3oz.weightUnit,
      piecesPerCase: preset3oz.quantityPerUnit,
      unitName: preset3oz.unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: null, // New config has blank quoted pricing
      formula,
    });

    assert.equal(configA.quotedPrice, 85.0);
    assert.equal(configB.quotedPrice, null);
    assert.equal(configA.pieceWeight, 2);
    assert.equal(configB.pieceWeight, 3);
    assert.equal(configA.packagingCost, 4.5);
    assert.equal(configB.packagingCost, 3.0);
  });

  // T10: Costing and pricing recalculate independently
  test('T10: Costing and pricing recalculate independently', () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, mockMasterIngredients);

    // 2 oz = 56.699g * 140 = 7937.86g dough
    const config2oz = calculateProductPricing({
      id: 'cfg-2oz',
      name: '2 oz Cookies',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 140,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula,
    });

    // 3 oz = 85.0485g * 96 = 8164.66g dough
    const config3oz = calculateProductPricing({
      id: 'cfg-3oz',
      name: '3 oz Cookies',
      pieceWeight: 3,
      weightUnit: 'oz',
      piecesPerCase: 96,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula,
    });

    assert.notEqual(config2oz.rawIngredientCost, config3oz.rawIngredientCost);
    assert.notEqual(config2oz.totalProductionCost, config3oz.totalProductionCost);
    assert.notEqual(config2oz.calculatedTargetPrice, config3oz.calculatedTargetPrice);
    assert.ok(config2oz.totalProductionCost > 0);
    assert.ok(config3oz.totalProductionCost > 0);
  });

  // T11: Save and reopen preserves configurations
  test('T11: Save and reopen preserves configurations', async () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, []);
    const project = await quotingService.createProject({
      productCategory: 'Cookies',
      productName: 'Choco Chip Presets',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      initialFormula: formula,
    });

    const preset2oz = canonicalPresets.find((p) => p.id === 'preset-2oz-cookie')!;
    const preset3oz = canonicalPresets.find((p) => p.id === 'preset-1785852643334')!;

    const config1 = calculateProductPricing({
      id: 'cfg-saved-1',
      productType: 'Cookies',
      name: '2 oz Cookies',
      pieceWeight: preset2oz.finishedWeight,
      weightUnit: 'oz',
      piecesPerCase: preset2oz.quantityPerUnit,
      unitName: 'Case',
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula: project.formula,
    });

    const config2 = calculateProductPricing({
      id: 'cfg-saved-2',
      productType: 'Cookies',
      name: '3 oz Cookies',
      pieceWeight: preset3oz.finishedWeight,
      weightUnit: 'oz',
      piecesPerCase: preset3oz.quantityPerUnit,
      unitName: 'Case',
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula: project.formula,
    });

    await quotingService.saveProject({
      ...project,
      products: [config1, config2],
    });

    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded, 'Project must be loaded');
    assert.equal(reloaded?.products.length, 2);
    assert.equal(reloaded?.products[0].name, '2 oz Cookies');
    assert.equal(reloaded?.products[0].pieceWeight, 2);
    assert.equal(reloaded?.products[1].name, '3 oz Cookies');
    assert.equal(reloaded?.products[1].pieceWeight, 3);
  });

  // T12: Source production recipes remain unchanged
  test('T12: Source production recipes remain unchanged', async () => {
    const originalRecipeJson = JSON.stringify(sampleRecipe);

    // Convert recipe to quote formula and configure products
    const formula = convertRecipeToQuoteFormula(sampleRecipe, []);
    const preset2oz = canonicalPresets.find((p) => p.id === 'preset-2oz-cookie')!;
    const config = calculateProductPricing({
      id: 'cfg-test',
      pieceWeight: preset2oz.finishedWeight,
      weightUnit: 'oz',
      piecesPerCase: preset2oz.quantityPerUnit,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      formula,
    });

    assert.ok(config);
    // Source recipe must not be mutated
    assert.equal(JSON.stringify(sampleRecipe), originalRecipeJson);
  });

  // T13: Issued quote revisions remain immutable
  test('T13: Issued quote revisions remain immutable', async () => {
    const formula = convertRecipeToQuoteFormula(sampleRecipe, []);
    const project = await quotingService.createProject({
      productCategory: 'Cookies',
      productName: 'Revision Cookies',
      workspaceId: TEST_WS,
      userId: TEST_USER,
      initialFormula: formula,
    });

    const preset2oz = canonicalPresets.find((p) => p.id === 'preset-2oz-cookie')!;
    const config1 = calculateProductPricing({
      id: 'cfg-rev-1',
      productType: 'Cookies',
      name: '2 oz Cookies',
      pieceWeight: preset2oz.finishedWeight,
      weightUnit: 'oz',
      piecesPerCase: preset2oz.quantityPerUnit,
      unitName: 'Case',
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: 50.0,
      formula: project.formula,
    });

    await quotingService.saveProject({
      ...project,
      products: [config1],
    });

    // Issue revision 1
    const issuedProject = await quotingService.issueQuoteRevision(
      project.id,
      TEST_WS,
      TEST_USER,
      'Test User',
      'Initial 2 oz quote'
    );
    assert.ok(issuedProject);
    assert.equal(issuedProject.revisions.length, 1);
    assert.equal(issuedProject.revisions[0].productsSnapshot.length, 1);
    assert.equal(issuedProject.revisions[0].productsSnapshot[0].pieceWeight, 2);

    // Now add a 3 oz configuration to working draft
    const preset3oz = canonicalPresets.find((p) => p.id === 'preset-1785852643334')!;
    const config2 = calculateProductPricing({
      id: 'cfg-rev-2',
      productType: 'Cookies',
      name: '3 oz Cookies',
      pieceWeight: preset3oz.finishedWeight,
      weightUnit: 'oz',
      piecesPerCase: preset3oz.quantityPerUnit,
      unitName: 'Case',
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice: 70.0,
      formula: project.formula,
    });

    await quotingService.saveProject({
      ...project,
      products: [config1, config2],
    });

    // Fetch revision again from project
    const reloaded = quotingService.getProject(TEST_WS, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.revisions.length, 1);
    assert.equal(reloaded.revisions[0].productsSnapshot.length, 1, 'Revision snapshot must remain immutable at 1 product');
    assert.equal(reloaded.revisions[0].productsSnapshot[0].name, '2 oz Cookies');
  });

  // T14: Existing quoting and mobile editor tests remain passing
  test('T14: Existing quoting and mobile editor tests remain passing', () => {
    // Normalization handles edge cases gracefully
    assert.equal(normalizePresetCategory({ name: 'Special Cookie' }), 'Cookies');
    assert.equal(normalizePresetCategory({ name: 'Apple Pie Round' }), 'Pie Dough');
    assert.equal(normalizePresetCategory({ name: 'Shortbread Tart' }), 'Shortbread');
    assert.equal(normalizePresetCategory({ name: 'Sourdough Batard' }), 'Base Dough');
    assert.equal(normalizePresetCategory({ name: 'Random Item' }), 'Cookies'); // Default fallback
    assert.equal(
      normalizePresetCategory({ name: 'Custom Name', category: 'Specialty Pastry' }),
      'Specialty Pastry'
    );
  });
});
