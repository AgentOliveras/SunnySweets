import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  analyzeWorkspaceCosting,
  findExactMatchSuggestions,
  linkExactMatchesForRecipe,
  linkSpecificIngredient,
  unlinkSpecificIngredient,
} from '../src/utils/costingCompletion';
import {
  Recipe,
  MasterIngredient,
  Ingredient,
} from '../src/types';

describe('Phase 2.0C — Ingredient Linking & Cost Completion Center Suite', () => {
  const mockMasterIngredients: MasterIngredient[] = [
    {
      id: 'mi-flour',
      name: 'All-Purpose Flour',
      category: 'Flour',
      defaultUnit: 'lb',
      defaultWastePercent: 1,
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 50,
        unitMeasure: 'lb',
        packagePriceCents: 2450, // $24.50
      },
    },
    {
      id: 'mi-sugar',
      name: 'Granulated White Sugar',
      category: 'Sugar',
      defaultUnit: 'lb',
      defaultWastePercent: 0,
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 25,
        unitMeasure: 'lb',
        packagePriceCents: 1800, // $18.00
      },
    },
    {
      id: 'mi-butter',
      name: 'Unsalted Butter',
      category: 'Dairy',
      defaultUnit: 'lb',
      defaultWastePercent: 2,
      // No purchase package configured yet! Missing price
    },
    {
      id: 'mi-vanilla',
      name: 'Pure Vanilla Extract',
      category: 'Flavoring',
      defaultUnit: 'oz',
      defaultWastePercent: 0,
      preferredPurchasePackage: {
        packQuantity: 1,
        unitSize: 16,
        unitMeasure: 'oz',
        packagePriceCents: 3200,
      },
      densityGramsPerMl: 0.95,
    },
  ];

  const recipe1FullyCosted: Recipe = {
    id: 'rec-1',
    userId: 'user-1',
    name: 'Simple Sugar Shortbread',
    description: 'Crisp buttery cookies',
    defaultWastePercent: 0,
    batchYieldQuantity: 50,
    batchYieldUnit: 'cookies',
    ingredients: [
      {
        id: 'ing-1-1',
        name: 'All-Purpose Flour',
        quantity: 500,
        unit: 'g',
        masterIngredientId: 'mi-flour',
      },
      {
        id: 'ing-1-2',
        name: 'Granulated White Sugar',
        quantity: 250,
        unit: 'g',
        masterIngredientId: 'mi-sugar',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const recipe2Unlinked: Recipe = {
    id: 'rec-2',
    userId: 'user-1',
    name: 'Classic Chocolate Chip',
    description: 'Chewy chocolate chip cookies',
    defaultWastePercent: 0,
    batchYieldQuantity: 36,
    batchYieldUnit: 'cookies',
    ingredients: [
      {
        id: 'ing-2-1',
        name: 'All-Purpose Flour', // Matches mi-flour exact case-insensitive!
        quantity: 350,
        unit: 'g',
        notes: 'Sifted',
        wastePercent: 3,
        // No masterIngredientId
      },
      {
        id: 'ing-2-2',
        name: 'Granulated White Sugar', // Matches mi-sugar exact
        quantity: 150,
        unit: 'g',
        // No masterIngredientId
      },
      {
        id: 'ing-2-3',
        name: 'Dark Chocolate Callets', // No master match in pantry
        quantity: 200,
        unit: 'g',
        // No masterIngredientId
      },
    ],
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  };

  const recipe3MissingCost: Recipe = {
    id: 'rec-3',
    userId: 'user-1',
    name: 'Butter Croissants',
    description: 'Laminated pastry dough',
    defaultWastePercent: 0,
    batchYieldQuantity: 24,
    batchYieldUnit: 'croissants',
    ingredients: [
      {
        id: 'ing-3-1',
        name: 'All-Purpose Flour',
        quantity: 1000,
        unit: 'g',
        masterIngredientId: 'mi-flour',
      },
      {
        id: 'ing-3-2',
        name: 'Unsalted Butter',
        quantity: 500,
        unit: 'g',
        masterIngredientId: 'mi-butter', // Linked, but mi-butter has no purchase package!
      },
    ],
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  };

  // 1. Workspace Analysis & High-Level Metrics
  it('1. Computes workspace costing stats and flags fully costed vs attention needed', () => {
    const analysis = analyzeWorkspaceCosting(
      [recipe1FullyCosted, recipe2Unlinked, recipe3MissingCost],
      mockMasterIngredients
    );

    assert.strictEqual(analysis.stats.totalRecipes, 3);
    assert.strictEqual(analysis.stats.fullyCostedCount, 1);
    assert.strictEqual(analysis.stats.incompleteCount, 2);
    // Coverage = 1/3 = 33%
    assert.strictEqual(analysis.stats.coveragePercent, 33);
    assert.strictEqual(analysis.stats.unlinkedLinesCount, 3);

    // Check recipe 1
    const r1 = analysis.recipeDetails.find((r) => r.recipe.id === 'rec-1');
    assert(r1);
    assert.strictEqual(r1.status, 'FULLY_COSTED');
    assert.strictEqual(r1.unlinkedCount, 0);
    assert.strictEqual(r1.missingPriceCount, 0);

    // Check recipe 2
    const r2 = analysis.recipeDetails.find((r) => r.recipe.id === 'rec-2');
    assert(r2);
    assert.strictEqual(r2.status, 'NEEDS_ATTENTION');
    assert.strictEqual(r2.unlinkedCount, 3);
    assert.strictEqual(r2.missingPriceCount, 0);

    // Check recipe 3
    const r3 = analysis.recipeDetails.find((r) => r.recipe.id === 'rec-3');
    assert(r3);
    assert.strictEqual(r3.status, 'NEEDS_ATTENTION');
    assert.strictEqual(r3.unlinkedCount, 0);
    assert.strictEqual(r3.missingPriceCount, 1);
  });

  // 2. Exact Match Suggestions (Scope: Active Workspace Master Ingredients Only)
  it('2. Suggests exact case-insensitive matches from active workspace master ingredients only', () => {
    const suggestions = findExactMatchSuggestions(recipe2Unlinked, mockMasterIngredients);

    assert.strictEqual(suggestions.length, 2);
    // Flour
    const flourMatch = suggestions.find((s) => s.ingredientId === 'ing-2-1');
    assert(flourMatch);
    assert.strictEqual(flourMatch.matchedMasterId, 'mi-flour');
    assert.strictEqual(flourMatch.matchedMasterName, 'All-Purpose Flour');
    assert.strictEqual(flourMatch.matchedMasterHasPricing, true);

    // Sugar
    const sugarMatch = suggestions.find((s) => s.ingredientId === 'ing-2-2');
    assert(sugarMatch);
    assert.strictEqual(sugarMatch.matchedMasterId, 'mi-sugar');

    // Chocolate has no match in pantry
    const chocMatch = suggestions.find((s) => s.ingredientId === 'ing-2-3');
    assert.strictEqual(chocMatch, undefined);
  });

  // 3. Case-Insensitive Matching
  it('3. Matches exact pantry items regardless of case differences', () => {
    const recipeWithCaseDiff: Recipe = {
      ...recipe2Unlinked,
      ingredients: [
        {
          id: 'ing-case-1',
          name: 'all-purpose flour', // lower-case
          quantity: 200,
          unit: 'g',
        },
        {
          id: 'ing-case-2',
          name: 'GRANULATED WHITE SUGAR  ', // upper-case with whitespace
          quantity: 100,
          unit: 'g',
        },
      ],
    };

    const suggestions = findExactMatchSuggestions(recipeWithCaseDiff, mockMasterIngredients);
    assert.strictEqual(suggestions.length, 2);
    assert.strictEqual(suggestions[0].matchedMasterId, 'mi-flour');
    assert.strictEqual(suggestions[1].matchedMasterId, 'mi-sugar');
  });

  // 4. Invariant Preservation on Exact Match Linking
  it('4. linkExactMatchesForRecipe preserves all ingredient snapshot fields, IDs, ordering, and quantities', () => {
    const originalIng1 = { ...recipe2Unlinked.ingredients[0] };
    const originalIng2 = { ...recipe2Unlinked.ingredients[1] };
    const originalIng3 = { ...recipe2Unlinked.ingredients[2] };

    const { updatedRecipe, linkedCount } = linkExactMatchesForRecipe(recipe2Unlinked, mockMasterIngredients);

    assert.strictEqual(linkedCount, 2);
    // Verification of non-destruction
    assert.strictEqual(updatedRecipe.id, recipe2Unlinked.id);
    assert.strictEqual(updatedRecipe.name, recipe2Unlinked.name);
    assert.strictEqual(updatedRecipe.batchYieldQuantity, recipe2Unlinked.batchYieldQuantity);
    assert.strictEqual(updatedRecipe.batchYieldUnit, recipe2Unlinked.batchYieldUnit);
    assert.strictEqual(updatedRecipe.ingredients.length, 3);

    // Line 1: linked to mi-flour, but keeps all other properties
    const ing1 = updatedRecipe.ingredients[0];
    assert.strictEqual(ing1.id, originalIng1.id);
    assert.strictEqual(ing1.name, originalIng1.name);
    assert.strictEqual(ing1.quantity, originalIng1.quantity);
    assert.strictEqual(ing1.unit, originalIng1.unit);
    assert.strictEqual(ing1.notes, 'Sifted');
    assert.strictEqual(ing1.wastePercent, 3);
    assert.strictEqual(ing1.masterIngredientId, 'mi-flour'); // Updated!

    // Line 2: linked to mi-sugar
    const ing2 = updatedRecipe.ingredients[1];
    assert.strictEqual(ing2.id, originalIng2.id);
    assert.strictEqual(ing2.name, originalIng2.name);
    assert.strictEqual(ing2.quantity, originalIng2.quantity);
    assert.strictEqual(ing2.unit, originalIng2.unit);
    assert.strictEqual(ing2.masterIngredientId, 'mi-sugar'); // Updated!

    // Line 3: untouched because no exact match existed
    const ing3 = updatedRecipe.ingredients[2];
    assert.strictEqual(ing3.id, originalIng3.id);
    assert.strictEqual(ing3.name, originalIng3.name);
    assert.strictEqual(ing3.quantity, originalIng3.quantity);
    assert.strictEqual(ing3.unit, originalIng3.unit);
    assert.strictEqual(ing3.masterIngredientId, undefined); // Untouched!

    // Original recipe was not mutated
    assert.strictEqual(recipe2Unlinked.ingredients[0].masterIngredientId, undefined);
  });

  // 5. Specific Ingredient Linking & Unlinking
  it('5. linkSpecificIngredient updates only the target ingredient line and preserves all others', () => {
    const updated = linkSpecificIngredient(recipe2Unlinked, 'ing-2-3', 'mi-flour');
    assert.strictEqual(updated.ingredients[2].masterIngredientId, 'mi-flour');
    assert.strictEqual(updated.ingredients[0].masterIngredientId, undefined);
    assert.strictEqual(updated.ingredients[1].masterIngredientId, undefined);

    // Now unlink it
    const unlinked = unlinkSpecificIngredient(updated, 'ing-2-3');
    assert.strictEqual(unlinked.ingredients[2].masterIngredientId, undefined);
    assert.strictEqual(unlinked.ingredients[2].name, 'Dark Chocolate Callets');
    assert.strictEqual(unlinked.ingredients[2].quantity, 200);
  });

  // 6. Zero-recipe workspace safety
  it('6. Safely handles empty recipe or empty pantry workspace', () => {
    const emptyAnalysis = analyzeWorkspaceCosting([], []);
    assert.strictEqual(emptyAnalysis.stats.totalRecipes, 0);
    assert.strictEqual(emptyAnalysis.stats.fullyCostedCount, 0);
    assert.strictEqual(emptyAnalysis.stats.coveragePercent, 0);
    assert.strictEqual(emptyAnalysis.stats.unlinkedLinesCount, 0);
    assert.strictEqual(emptyAnalysis.recipeDetails.length, 0);
  });

  // 7. No accidental destructive auto-migration
  it('7. Analysis never modifies the input recipes or master ingredients', () => {
    const recipeClone = JSON.parse(JSON.stringify(recipe2Unlinked));
    const pantryClone = JSON.parse(JSON.stringify(mockMasterIngredients));

    analyzeWorkspaceCosting([recipeClone], pantryClone);
    findExactMatchSuggestions(recipeClone, pantryClone);

    assert.deepStrictEqual(recipeClone, recipe2Unlinked);
    assert.deepStrictEqual(pantryClone, mockMasterIngredients);
  });
});
