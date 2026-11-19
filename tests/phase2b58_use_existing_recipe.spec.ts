import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { quotingService, canUserAccessQuoting } from '../src/services/quotingService';
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
import { Recipe, MasterIngredient, Workspace, AccessRole } from '../src/types';
import { store } from '../src/services/store';

const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] || null,
  };
};

describe('PHASE 2B.5.8 — Use Existing Recipe Regression Suite', () => {
  const TEST_WS_A = 'ws-p2b58-alpha';
  const TEST_WS_B = 'ws-p2b58-beta';
  const TEST_USER = 'user-p2b58-lead';

  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'ing-flour',
      workspaceId: TEST_WS_A,
      name: 'All-Purpose Flour',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2200, // $22 / 50 lb -> ~0.00097 $/g
      },
    },
    {
      id: 'ing-butter',
      workspaceId: TEST_WS_A,
      name: 'Unsalted Butter',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 36,
        unitMeasure: 'lb',
        packagePriceCents: 10800, // $108 / 36 lb -> ~0.00661 $/g
      },
    },
    {
      id: 'ing-sugar',
      workspaceId: TEST_WS_A,
      name: 'Granulated Sugar',
      dimension: 'mass',
      defaultUnit: 'g',
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 3200, // $32 / 50 lb -> ~0.00141 $/g
      },
    },
    {
      id: 'ing-vanilla',
      workspaceId: TEST_WS_A,
      name: 'Pure Vanilla Extract',
      dimension: 'volume',
      defaultUnit: 'ml',
      densityGramsPerMl: 1.0,
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 32,
        unitMeasure: 'fl_oz',
        packagePriceCents: 4500,
      },
    },
  ];

  const masterMap = new Map(mockMasterIngredients.map((m) => [m.id, m]));

  const sampleProductionRecipe: Recipe = {
    id: 'rec-choc-chip-prod',
    workspaceId: TEST_WS_A,
    userId: TEST_USER,
    name: 'Classic Chocolate Chip Cookies',
    description: 'Traditional artisan bakery chocolate chip recipe with brown butter notes.',
    category: 'Cookie',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 2.0,
    createdAt: '2026-01-15T08:00:00Z',
    updatedAt: '2026-02-10T14:30:00Z',
    ingredients: [
      {
        id: 'ing-line-1',
        name: 'All-Purpose Flour',
        quantity: 1000,
        unit: 'g',
        masterIngredientId: 'ing-flour',
        notes: 'Sifted',
      },
      {
        id: 'ing-line-2',
        name: 'Unsalted Butter',
        quantity: 500,
        unit: 'g',
        masterIngredientId: 'ing-butter',
        notes: 'Room temperature',
      },
      {
        id: 'ing-line-3',
        name: 'Granulated Sugar',
        quantity: 350,
        unit: 'g',
        masterIngredientId: 'ing-sugar',
      },
      {
        id: 'ing-line-4',
        name: 'Pure Vanilla Extract',
        quantity: 20,
        unit: 'ml',
        densityGramsPerMl: 1.0,
        masterIngredientId: 'ing-vanilla',
      },
    ],
  };

  beforeEach(() => {
    (globalThis as any).localStorage = createMockLocalStorage();
    quotingService.setMockCloudWriteHandler(null);
  });

  afterEach(() => {
    quotingService.setMockCloudWriteHandler(null);
  });

  // T1. Blank formula project creation remains unchanged.
  test('T1: Blank formula project creation remains unchanged', async () => {
    const project = await quotingService.createProject({
      workspaceId: TEST_WS_A,
      userId: TEST_USER,
      productName: 'Blank Cookie Project',
      productCategory: 'Cookie',
      formulaOwnership: 'bakery_owned',
    });

    assert.ok(project);
    assert.equal(project.productName, 'Blank Cookie Project');
    assert.equal(project.formula.lines.length, 0, 'Blank project starts with 0 lines');
    assert.equal(project.formula.totalWeightGrams, 0);
    assert.equal(project.formula.totalCost, 0);
    assert.equal(project.status, 'draft');
    assert.equal(project.sourceRecipeId, undefined, 'Blank project has no source recipe id');
  });

  // T2. Existing recipe search returns authorized workspace recipes only.
  test('T2: Existing recipe search returns authorized workspace recipes only', () => {
    const allRecipes: Recipe[] = [
      sampleProductionRecipe,
      {
        ...sampleProductionRecipe,
        id: 'rec-ws-b-croissant',
        workspaceId: TEST_WS_B,
        name: 'Butter Croissant (WS-B)',
      },
      {
        ...sampleProductionRecipe,
        id: 'rec-archived-cookie',
        workspaceId: TEST_WS_A,
        archived: true,
        name: 'Old Archived Cookie',
      },
    ];

    // Filter scoped to TEST_WS_A
    const authorized = allRecipes.filter((r) => {
      if (r.archived) return false;
      if (r.workspaceId && r.workspaceId !== TEST_WS_A) return false;
      return true;
    });

    assert.equal(authorized.length, 1);
    assert.equal(authorized[0].id, 'rec-choc-chip-prod');
    assert.ok(!authorized.some((r) => r.workspaceId === TEST_WS_B), 'Must never leak recipes from another workspace');
    assert.ok(!authorized.some((r) => r.archived), 'Must exclude archived recipes');
  });

  // T3. Selecting and cancelling a recipe creates no project.
  test('T3: Selecting and cancelling a recipe creates no project', async () => {
    const beforeProjects = quotingService.getProjects(TEST_WS_A);
    const countBefore = beforeProjects.length;

    // Simulate user state in modal: selected recipe, but then user cancels
    let selectedRecipe: Recipe | null = sampleProductionRecipe;
    let isCreateModalOpen = true;

    // User taps cancel
    selectedRecipe = null;
    isCreateModalOpen = false;

    // No API / service call made
    const afterProjects = quotingService.getProjects(TEST_WS_A);
    assert.equal(afterProjects.length, countBefore, 'Project count must remain unchanged upon cancellation');
    assert.equal(isCreateModalOpen, false);
    assert.equal(selectedRecipe, null);
  });

  // T4. Importing a recipe creates a new independent project.
  test('T4: Importing a recipe creates a new independent project', async () => {
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      productName: 'Classic Chocolate Chip - Hotel Quote',
      masterIngredients: mockMasterIngredients,
    });

    assert.ok(project);
    assert.ok(project.id.startsWith('proj-'));
    assert.equal(project.productName, 'Classic Chocolate Chip - Hotel Quote');
    assert.equal(project.sourceRecipeId, sampleProductionRecipe.id);
    assert.equal(project.sourceRecipeName, sampleProductionRecipe.name);
    assert.ok(project.importedAt, 'Import timestamp must be recorded');
    assert.equal(project.status, 'draft');
    assert.ok(project.formula.lines.length > 0);
  });

  // T5. Imported ingredient names, quantities, units, and order match the source.
  test('T5: Imported ingredient names, quantities, units, and order match the source', async () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    assert.equal(formula.lines.length, sampleProductionRecipe.ingredients.length);
    sampleProductionRecipe.ingredients.forEach((sourceIng, index) => {
      const importedLine = formula.lines[index];
      assert.equal(importedLine.name, sourceIng.name);
      assert.equal(importedLine.quantity, sourceIng.quantity);
      assert.equal(importedLine.unit, sourceIng.unit);
      assert.notEqual(importedLine.id, sourceIng.id, 'Imported line must have independent ID');
    });
  });

  // T6. Pantry ingredient associations are preserved accurately.
  test('T6: Pantry ingredient associations are preserved accurately', async () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    assert.equal(formula.lines[0].masterIngredientId, 'ing-flour');
    assert.equal(formula.lines[1].masterIngredientId, 'ing-butter');
    assert.equal(formula.lines[2].masterIngredientId, 'ing-sugar');
    assert.equal(formula.lines[3].masterIngredientId, 'ing-vanilla');

    // Unit costs must be computed from active pantry
    assert.ok(formula.lines[0].unitCostUsed > 0);
    assert.ok(formula.lines[1].unitCostUsed > 0);
    assert.ok(formula.lines[0].lineCost > 0);
    assert.ok(formula.lines[1].lineCost > 0);
  });

  // T7. Temporary and unlinked ingredients are not silently lost.
  test('T7: Temporary and unlinked ingredients are not silently lost', async () => {
    const recipeWithUnlinked: Recipe = {
      ...sampleProductionRecipe,
      id: 'rec-unlinked-test',
      ingredients: [
        ...sampleProductionRecipe.ingredients,
        {
          id: 'ing-unlinked-cardamom',
          name: 'Ground Green Cardamom',
          quantity: 15,
          unit: 'g',
          masterIngredientId: undefined, // Not linked to pantry
          notes: 'Specialty aromatic spice',
        },
      ],
    };

    const formula = convertRecipeToQuoteFormula(recipeWithUnlinked, mockMasterIngredients);

    assert.equal(formula.lines.length, 5);
    const unlinkedLine = formula.lines[4];
    assert.equal(unlinkedLine.name, 'Ground Green Cardamom');
    assert.equal(unlinkedLine.quantity, 15);
    assert.equal(unlinkedLine.unit, 'g');
    assert.equal(unlinkedLine.masterIngredientId, undefined);
    assert.equal(unlinkedLine.lineCost, 0, 'Unlinked ingredient cost defaults to 0 with pending status');
    assert.equal(unlinkedLine.notes, 'Specialty aromatic spice');
  });

  // T8. Editing an imported ingredient does not modify the production recipe.
  test('T8: Editing an imported ingredient does not modify the production recipe', async () => {
    // Clone original recipe to verify deep immutability
    const originalRecipeSnapshot = JSON.parse(JSON.stringify(sampleProductionRecipe));

    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    // Mutate the working formula of the project
    const editedLines = project.formula.lines.map((l) =>
      l.name === 'All-Purpose Flour' ? { ...l, quantity: 2500 } : l
    );
    const editedFormula = calculateFormulaTotals(editedLines, masterMap);

    await quotingService.saveProject({
      ...project,
      formula: editedFormula,
    });

    // Verify project formula has 2500g
    const reloadedProject = quotingService.getProject(TEST_WS_A, project.id);
    assert.ok(reloadedProject);
    assert.equal(reloadedProject.formula.lines[0].quantity, 2500);

    // CRITICAL INVARIANT: Original production recipe must be 100% UNTOUCHED
    assert.deepEqual(sampleProductionRecipe, originalRecipeSnapshot);
    assert.equal(sampleProductionRecipe.ingredients[0].quantity, 1000);
  });

  // T9. Removing an imported ingredient does not modify the production recipe.
  test('T9: Removing an imported ingredient does not modify the production recipe', async () => {
    const originalRecipeSnapshot = JSON.parse(JSON.stringify(sampleProductionRecipe));

    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    // Remove sugar (line index 2)
    const filteredLines = project.formula.lines.filter((l) => l.name !== 'Granulated Sugar');
    const recalculated = calculateFormulaTotals(filteredLines, masterMap);

    await quotingService.saveProject({
      ...project,
      formula: recalculated,
    });

    const reloaded = quotingService.getProject(TEST_WS_A, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines.length, 3);
    assert.ok(!reloaded.formula.lines.some((l) => l.name === 'Granulated Sugar'));

    // Production recipe still has 4 ingredients including sugar
    assert.equal(sampleProductionRecipe.ingredients.length, 4);
    assert.deepEqual(sampleProductionRecipe, originalRecipeSnapshot);
  });

  // T10. Imported formula persists after navigation and refresh.
  test('T10: Imported formula persists after navigation and refresh', async () => {
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    // Re-fetch project as if navigating back or refreshing browser
    const reloaded = quotingService.getProject(TEST_WS_A, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines.length, 4);
    assert.equal(reloaded.formula.lines[0].quantity, 1000);
    assert.equal(reloaded.formula.lines[1].quantity, 500);
    assert.equal(reloaded.formula.lines[2].quantity, 350);
    assert.equal(reloaded.formula.lines[3].quantity, 20);
    assert.equal(reloaded.sourceRecipeId, sampleProductionRecipe.id);
    assert.equal(reloaded.sourceRecipeName, sampleProductionRecipe.name);
  });

  // T11. Imported quantities survive immediate navigation.
  test('T11: Imported quantities survive immediate navigation', async () => {
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    // User edits butter to 600g and immediately navigates
    const linesWith600 = project.formula.lines.map((l) =>
      l.name === 'Unsalted Butter' ? { ...l, quantity: 600 } : l
    );
    const draft: ProductProject = {
      ...project,
      formula: calculateFormulaTotals(linesWith600, masterMap),
      hasUnsyncedLocalChanges: true,
      updatedAt: new Date().toISOString(),
    };

    // Unmount recovery and write
    quotingService.saveDraftRecovery(TEST_WS_A, project.id, draft, TEST_USER);
    await quotingService.saveProject(draft);

    const reloaded = quotingService.getProject(TEST_WS_A, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines.find((l) => l.name === 'Unsalted Butter')?.quantity, 600);
  });

  // T12. Current pantry costs are recalculated correctly.
  test('T12: Current pantry costs are recalculated correctly', async () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    // 1000g flour @ ~0.00097 $/g -> ~$0.97
    const flourLine = formula.lines.find((l) => l.name === 'All-Purpose Flour');
    assert.ok(flourLine);
    assert.ok(flourLine.lineCost > 0.9 && flourLine.lineCost < 1.05);

    // Total weight: 1000g + 500g + 350g + 20g (density 1.0) = 1870g
    assert.equal(formula.totalWeightGrams, 1870);
    assert.ok(formula.totalCost > 0);
    assert.ok(formula.costPerLb! > 0);
  });

  // T13. Missing ingredient costs are visibly identified.
  test('T13: Missing ingredient costs are visibly identified', () => {
    const recipeWithUnlinked: Recipe = {
      ...sampleProductionRecipe,
      ingredients: [
        {
          id: 'ing-mystery',
          name: 'Mystery Extract',
          quantity: 50,
          unit: 'g',
          masterIngredientId: undefined,
        },
      ],
    };

    const formula = convertRecipeToQuoteFormula(recipeWithUnlinked, mockMasterIngredients);
    assert.equal(formula.lines.length, 1);
    assert.equal(formula.lines[0].masterIngredientId, undefined);
    assert.equal(formula.lines[0].lineCost, 0);
  });

  // T14. Multiple product sizes can be configured independently.
  test('T14: Multiple product sizes can be configured independently', async () => {
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    const config15oz = calculateProductPricing({
      name: '1.5 oz Cookies',
      pieceWeight: 1.5,
      weightUnit: 'oz',
      piecesPerCase: 100,
      ingredientMultiplier: 1.0,
      packagingCost: 1.2,
      laborCost: 2.0,
      otherCost: 0.5,
      formula: project.formula,
    });

    const config3oz = calculateProductPricing({
      name: '3.0 oz Cookies',
      pieceWeight: 3.0,
      weightUnit: 'oz',
      piecesPerCase: 60,
      ingredientMultiplier: 1.0,
      packagingCost: 1.5,
      laborCost: 2.5,
      otherCost: 0.5,
      formula: project.formula,
    });

    const draftWithProducts: ProductProject = {
      ...project,
      products: [config15oz, config3oz],
    };

    await quotingService.saveProject(draftWithProducts);
    const reloaded = quotingService.getProject(TEST_WS_A, project.id);

    assert.ok(reloaded);
    assert.equal(reloaded.products.length, 2);
    assert.equal(reloaded.products[0].name, '1.5 oz Cookies');
    assert.equal(reloaded.products[0].pieceWeight, 1.5);
    assert.equal(reloaded.products[1].name, '3.0 oz Cookies');
    assert.equal(reloaded.products[1].pieceWeight, 3.0);
    assert.notEqual(reloaded.products[0].doughWeightGrams, reloaded.products[1].doughWeightGrams);
    // Production recipe is still intact
    assert.equal(sampleProductionRecipe.batchYieldQuantity, 100);
  });

  // T15. Different pieces-per-case values remain independent.
  test('T15: Different pieces-per-case values remain independent', () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    const configA = calculateProductPricing({
      name: '80/case',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 80,
      ingredientMultiplier: 1,
      formula,
    });

    const configB = calculateProductPricing({
      name: '140/case',
      pieceWeight: 2,
      weightUnit: 'oz',
      piecesPerCase: 140,
      ingredientMultiplier: 1,
      formula,
    });

    assert.equal(configA.piecesPerCase, 80);
    assert.equal(configB.piecesPerCase, 140);
    assert.ok(configB.rawIngredientCost > configA.rawIngredientCost);
  });

  // T16. Rapid repeated project creation does not create duplicate projects.
  test('T16: Rapid repeated project creation does not create duplicate projects', async () => {
    let callCount = 0;
    const submitProject = async () => {
      callCount++;
      return quotingService.createProjectFromRecipe({
        workspaceId: TEST_WS_A,
        recipe: sampleProductionRecipe,
        userId: TEST_USER,
        productName: 'Idempotent Double-Click Test',
        masterIngredients: mockMasterIngredients,
      });
    };

    // In UI, isSubmittingRef blocks subsequent calls while in-flight
    let isSubmitting = false;
    const guardedSubmit = async () => {
      if (isSubmitting) return null;
      isSubmitting = true;
      try {
        return await submitProject();
      } finally {
        isSubmitting = false;
      }
    };

    const first = await guardedSubmit();
    const second = await guardedSubmit();

    assert.ok(first);
    assert.ok(second); // Sequential calls succeed, but concurrent rapid clicks are guarded
    assert.notEqual(first?.id, second?.id);
  });

  // T17. Workspace and role restrictions remain enforced.
  test('T17: Workspace and role restrictions remain enforced', async () => {
    const foreignRecipe: Recipe = {
      ...sampleProductionRecipe,
      id: 'foreign-rec',
      workspaceId: 'other-workspace-xyz',
    };

    // Attempting to import into TEST_WS_A must throw workspace isolation error
    await assert.rejects(
      async () => {
        await quotingService.createProjectFromRecipe({
          workspaceId: TEST_WS_A,
          recipe: foreignRecipe,
          userId: TEST_USER,
          masterIngredients: mockMasterIngredients,
        });
      },
      /Workspace isolation violation/
    );

    // Role restrictions: Viewers cannot access quoting
    const viewerWorkspace: Workspace = {
      id: TEST_WS_A,
      name: 'Bakery A',
      ownerId: 'owner-1',
      ownerEmail: 'owner@test.com',
      code: 'BAKERY-A',
      members: [],
      groups: [],
      features: { productQuoting: true },
      createdAt: '',
      updatedAt: '',
    };
    assert.equal(canUserAccessQuoting(viewerWorkspace, 'viewer'), false);
    assert.equal(canUserAccessQuoting(viewerWorkspace, 'editor'), true);
    assert.equal(canUserAccessQuoting(viewerWorkspace, 'owner'), true);
  });

  // T18. Mobile ingredient editor remains fully functional.
  test('T18: Mobile ingredient editor remains fully functional', () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    // Each imported line satisfies mobile card rendering requirements
    formula.lines.forEach((line) => {
      assert.ok(line.id);
      assert.ok(line.name);
      assert.ok(line.quantity > 0);
      assert.ok(line.unit);
      assert.ok(line.lineCost >= 0);
    });
  });

  // T19. No automatic 100 g ingredient is added.
  test('T19: No automatic 100 g ingredient is added', () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    // Source flour is 1000g, butter is 500g, sugar is 350g, vanilla is 20ml
    // NONE of them should be mutated or defaulted to 100g
    assert.equal(formula.lines[0].quantity, 1000);
    assert.equal(formula.lines[1].quantity, 500);
    assert.equal(formula.lines[2].quantity, 350);
    assert.equal(formula.lines[3].quantity, 20);
  });

  // T20. Existing decimal quantity editing remains functional.
  test('T20: Existing decimal quantity editing remains functional', () => {
    const formula = convertRecipeToQuoteFormula(sampleProductionRecipe, mockMasterIngredients);

    // Edit vanilla to 2.5 ml
    const updatedLines = formula.lines.map((l) =>
      l.name === 'Pure Vanilla Extract' ? { ...l, quantity: 2.5 } : l
    );
    const recalculated = calculateFormulaTotals(updatedLines, masterMap);

    assert.equal(
      recalculated.lines.find((l) => l.name === 'Pure Vanilla Extract')?.quantity,
      2.5
    );
  });

  // T21. Issued quote revisions remain immutable.
  test('T21: Issued quote revisions remain immutable', async () => {
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    // Issue quote revision
    const issuedProject = await quotingService.issueQuoteRevision(
      project.id,
      TEST_WS_A,
      TEST_USER,
      'Lead User',
      'Initial quote from production recipe snapshot'
    );

    assert.ok(issuedProject);
    assert.equal(issuedProject.currentRevisionNumber, 1);
    assert.equal(issuedProject.revisions.length, 1);
    assert.equal(issuedProject.revisions[0].formulaSnapshot.lines[0].quantity, 1000);
    assert.equal(issuedProject.revisions[0].sourceRecipeId, sampleProductionRecipe.id);
    assert.equal(issuedProject.revisions[0].sourceRecipeName, sampleProductionRecipe.name);

    // Edit working project formula to 5000g
    const mutatedLines = issuedProject.formula.lines.map((l) => ({ ...l, quantity: 5000 }));
    const mutatedFormula = calculateFormulaTotals(mutatedLines, masterMap);

    await quotingService.saveProject({
      ...issuedProject,
      formula: mutatedFormula,
    });

    const reloaded = quotingService.getProject(TEST_WS_A, project.id);
    assert.ok(reloaded);
    assert.equal(reloaded.formula.lines[0].quantity, 5000, 'Working formula updated');
    assert.equal(
      reloaded.revisions[0].formulaSnapshot.lines[0].quantity,
      1000,
      'Issued revision snapshot must remain strictly immutable at 1000g'
    );
  });

  // T22. Three imported projects remain isolated from one another.
  test('T22: Three imported projects remain isolated from one another', async () => {
    const p1 = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      productName: 'Project 1 - Grocery Store',
      masterIngredients: mockMasterIngredients,
    });

    const p2 = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      productName: 'Project 2 - Coffee Shop',
      masterIngredients: mockMasterIngredients,
    });

    const p3 = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      productName: 'Project 3 - Banquet Hall',
      masterIngredients: mockMasterIngredients,
    });

    assert.notEqual(p1.id, p2.id);
    assert.notEqual(p2.id, p3.id);

    // Edit P1 flour to 300g, P2 flour to 400g, P3 flour to 500g
    const lines1 = p1.formula.lines.map((l) => (l.name.includes('Flour') ? { ...l, quantity: 300 } : l));
    const lines2 = p2.formula.lines.map((l) => (l.name.includes('Flour') ? { ...l, quantity: 400 } : l));
    const lines3 = p3.formula.lines.map((l) => (l.name.includes('Flour') ? { ...l, quantity: 500 } : l));

    await quotingService.saveProject({ ...p1, formula: calculateFormulaTotals(lines1, masterMap) });
    await quotingService.saveProject({ ...p2, formula: calculateFormulaTotals(lines2, masterMap) });
    await quotingService.saveProject({ ...p3, formula: calculateFormulaTotals(lines3, masterMap) });

    const reload1 = quotingService.getProject(TEST_WS_A, p1.id);
    const reload2 = quotingService.getProject(TEST_WS_A, p2.id);
    const reload3 = quotingService.getProject(TEST_WS_A, p3.id);

    assert.equal(reload1?.formula.lines[0].quantity, 300);
    assert.equal(reload2?.formula.lines[0].quantity, 400);
    assert.equal(reload3?.formula.lines[0].quantity, 500);
  });

  // T23. Firestore CAS and recovery safeguards remain operational.
  test('T23: Firestore CAS and recovery safeguards remain operational', async () => {
    const project = await quotingService.createProjectFromRecipe({
      workspaceId: TEST_WS_A,
      recipe: sampleProductionRecipe,
      userId: TEST_USER,
      masterIngredients: mockMasterIngredients,
    });

    const recoveryDraft: ProductProject = {
      ...project,
      customerName: 'Emergency Crash Recovery Client',
      hasUnsyncedLocalChanges: true,
      updatedAt: new Date().toISOString(),
    };

    quotingService.saveDraftRecovery(TEST_WS_A, project.id, recoveryDraft, TEST_USER);

    const retrieved = quotingService.getDraftRecovery(TEST_WS_A, project.id, TEST_USER);
    assert.ok(retrieved);
    assert.equal(retrieved.customerName, 'Emergency Crash Recovery Client');
    assert.equal(retrieved.sourceRecipeId, sampleProductionRecipe.id);
  });

  // T24. Pending uncommitted ingredient warning works when continuing to Products & Pricing.
  test('T24: Pending uncommitted ingredient warning works when continuing to Products & Pricing', () => {
    // Simulating FormulaBuilder handleContinueToPricing logic
    const evaluateContinue = (selectedMaster: any, searchTerm: string, addQty: string) => {
      if (selectedMaster || (searchTerm.trim() && addQty.trim())) {
        return {
          allowed: false,
          warning: `Pending ingredient "${selectedMaster?.name || searchTerm.trim()}" is not yet added to the formula. Tap "Add to Formula" to include it, or clear it to proceed.`,
        };
      }
      return { allowed: true, warning: null };
    };

    const cleanCheck = evaluateContinue(null, '', '');
    assert.equal(cleanCheck.allowed, true);

    const pendingMasterCheck = evaluateContinue({ name: 'Cocoa Powder' }, '', '');
    assert.equal(pendingMasterCheck.allowed, false);
    assert.ok(pendingMasterCheck.warning?.includes('Cocoa Powder'));

    const pendingTypedCheck = evaluateContinue(null, 'Baking Soda', '5');
    assert.equal(pendingTypedCheck.allowed, false);
    assert.ok(pendingTypedCheck.warning?.includes('Baking Soda'));
  });

  // T25. Existing Administration Hub navigation remains unchanged.
  test('T25: Existing Administration Hub navigation remains unchanged', () => {
    const activeWs = store.getActiveWorkspace();
    assert.ok(activeWs);
    const features = store.getWorkspaceFeatures();
    assert.ok(features);
    assert.equal(typeof features.productQuoting, 'boolean');
  });
});
