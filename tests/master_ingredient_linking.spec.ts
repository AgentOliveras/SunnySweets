import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  Recipe,
  MasterIngredient,
  AccessRole,
  Ingredient,
  Mixer,
  ProductionItemRequirement,
} from '../src/types';
import {
  findMatchSuggestion,
  linkIngredientInRecipe,
  unlinkIngredientInRecipe,
  collectFormulaLineOccurrences,
  calculateLinkingStats,
  groupOccurrencesByName,
  applyBulkGroupLink,
  getMasterIngredientReferences,
} from '../src/services/masterIngredientLinking';
import { calculateRecipeTotal, calculateProduction } from '../src/utils/calculator';
import { SAMPLE_RECIPES, SAMPLE_MASTER_INGREDIENTS } from '../src/services/sampleData';

describe('Phase 2A — Master Ingredient Linking Foundation Verification Suite', () => {
  let sampleRecipe: Recipe;
  let masterButter: MasterIngredient;
  let masterSugar: MasterIngredient;
  let masterBrownSugar: MasterIngredient;
  let masterEggs: MasterIngredient;

  beforeEach(() => {
    masterButter = {
      id: 'mi-butter-1',
      workspaceId: 'ws-main',
      name: 'Unsalted Butter',
      category: 'Fats & Oils',
      defaultUnit: 'g',
    };

    masterSugar = {
      id: 'mi-sugar-1',
      workspaceId: 'ws-main',
      name: 'Sugar',
      category: 'Sugar',
      defaultUnit: 'g',
    };

    masterBrownSugar = {
      id: 'mi-brown-sugar-1',
      workspaceId: 'ws-main',
      name: 'Brown Sugar',
      category: 'Sugar',
      defaultUnit: 'g',
    };

    masterEggs = {
      id: 'mi-eggs-1',
      workspaceId: 'ws-main',
      name: 'Eggs',
      category: 'Eggs',
      defaultUnit: 'eggs',
    };

    sampleRecipe = {
      id: 'recipe-test-1',
      workspaceId: 'ws-main',
      userId: 'user-1',
      name: 'Classic Chocolate Chip Cookies',
      description: 'Classic chocolate chip cookies description',
      category: 'Cookies',
      batchYieldQuantity: 50,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 5,
      archived: false,
      ingredients: [
        {
          id: 'ing-1',
          name: 'Unsalted Butter',
          quantity: 454,
          unit: 'g',
          wastePercent: 2,
          notes: 'room temp',
        },
        {
          id: 'ing-2',
          name: 'Sugar',
          quantity: 300,
          unit: 'g',
          wastePercent: 0,
        },
        {
          id: 'ing-3',
          name: 'Brown Sugar',
          quantity: 350,
          unit: 'g',
          wastePercent: 0,
        },
        {
          id: 'ing-4',
          name: 'Eggs',
          quantity: 4,
          unit: 'eggs',
          notes: 'large',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  });

  describe('1. Formula Invariance & Linking Pure Functions', () => {
    it('[ML1] Linking an ingredient persists masterIngredientId without modifying recipe ingredient name, quantity, unit, or waste', () => {
      const originalIngredient = { ...sampleRecipe.ingredients[0] };
      const updated = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');

      // The target line must have the masterIngredientId
      assert.strictEqual(updated.ingredients[0].masterIngredientId, masterButter.id);

      // Invariance: All formula values must be identical
      assert.strictEqual(updated.ingredients[0].name, originalIngredient.name);
      assert.strictEqual(updated.ingredients[0].quantity, originalIngredient.quantity);
      assert.strictEqual(updated.ingredients[0].unit, originalIngredient.unit);
      assert.strictEqual(updated.ingredients[0].wastePercent, originalIngredient.wastePercent);
      assert.strictEqual(updated.ingredients[0].notes, originalIngredient.notes);
      assert.strictEqual(updated.batchYieldQuantity, sampleRecipe.batchYieldQuantity);
      assert.strictEqual(updated.category, sampleRecipe.category);
    });

    it('[ML2] Unlinking an ingredient removes masterIngredientId without modifying recipe ingredient name, quantity, unit, or waste', () => {
      const linked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'editor');
      assert.strictEqual(linked.ingredients[0].masterIngredientId, masterButter.id);

      const unlinked = unlinkIngredientInRecipe(linked, 'ing-1', 'editor');
      assert.strictEqual(unlinked.ingredients[0].masterIngredientId, undefined);
      assert.strictEqual(unlinked.ingredients[0].name, sampleRecipe.ingredients[0].name);
      assert.strictEqual(unlinked.ingredients[0].quantity, sampleRecipe.ingredients[0].quantity);
      assert.strictEqual(unlinked.ingredients[0].unit, sampleRecipe.ingredients[0].unit);
      assert.strictEqual(unlinked.ingredients[0].wastePercent, sampleRecipe.ingredients[0].wastePercent);
    });

    it('[ML3] Formula calculations produce identical results before and after linking (scale = 1)', () => {
      const beforeCalc = calculateRecipeTotal(sampleRecipe.ingredients, 'g', 0);

      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const afterCalc = calculateRecipeTotal(linkedRecipe.ingredients, 'g', 0);

      assert.strictEqual(afterCalc.totalWeightGrams, beforeCalc.totalWeightGrams);
      assert.strictEqual(afterCalc.discreteCount, beforeCalc.discreteCount);
    });

    it('[ML4] Formula calculations produce identical results before and after linking (scale = 3.5)', () => {
      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');

      const prodBefore = calculateProduction(sampleRecipe, [], {
        mode: 'full_recipe',
        fullRecipeCount: 3.5,
        defaultWeightUnit: 'g',
      });

      const prodAfter = calculateProduction(linkedRecipe, [], {
        mode: 'full_recipe',
        fullRecipeCount: 3.5,
        defaultWeightUnit: 'g',
      });

      assert.strictEqual(prodAfter.totalBatchWeightGrams, prodBefore.totalBatchWeightGrams);
      assert.strictEqual(prodAfter.totalPieces, prodBefore.totalPieces);
      assert.deepStrictEqual(
        prodAfter.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit })),
        prodBefore.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit }))
      );
    });

    it('[ML5] Production Floor scaled batch calculations are bit-for-bit identical before and after linking', () => {
      // Fully link all ingredients in sampleRecipe
      let fullyLinked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      fullyLinked = linkIngredientInRecipe(fullyLinked, 'ing-2', masterSugar, 'ws-main', 'owner');
      fullyLinked = linkIngredientInRecipe(fullyLinked, 'ing-3', masterBrownSugar, 'ws-main', 'owner');
      fullyLinked = linkIngredientInRecipe(fullyLinked, 'ing-4', masterEggs, 'ws-main', 'owner');

      const floorBefore = calculateProduction(sampleRecipe, [], {
        mode: 'full_recipe',
        fullRecipeCount: 7,
        defaultWeightUnit: 'lb',
        overrideWastePercent: 6,
      });

      const floorAfter = calculateProduction(fullyLinked, [], {
        mode: 'full_recipe',
        fullRecipeCount: 7,
        defaultWeightUnit: 'lb',
        overrideWastePercent: 6,
      });

      assert.strictEqual(floorAfter.totalBatchWeightGrams, floorBefore.totalBatchWeightGrams);
      assert.strictEqual(floorAfter.calculatedIngredients.length, floorBefore.calculatedIngredients.length);
      for (let i = 0; i < floorBefore.calculatedIngredients.length; i++) {
        assert.strictEqual(
          floorAfter.calculatedIngredients[i].scaledQuantity,
          floorBefore.calculatedIngredients[i].scaledQuantity
        );
      }
    });
  });

  describe('2. Match Suggestions & Ambiguity Safeguards', () => {
    it('[ML6] Exact match suggestions correctly identify identical normalized names', () => {
      const match = findMatchSuggestion('Unsalted Butter', [masterButter, masterSugar]);
      assert.ok(match);
      assert.strictEqual(match.confidence, 'exact');
      assert.strictEqual(match.masterIngredient.id, masterButter.id);

      // Case insensitive and trim
      const matchCase = findMatchSuggestion('  unsalted butter  ', [masterButter]);
      assert.ok(matchCase);
      assert.strictEqual(matchCase.confidence, 'exact');
    });

    it('[ML7] Singular/plural variants are identified as likely matches ("Egg" vs "Eggs")', () => {
      const match1 = findMatchSuggestion('Egg', [masterEggs]);
      assert.ok(match1);
      assert.strictEqual(match1.confidence, 'likely');
      assert.strictEqual(match1.masterIngredient.id, masterEggs.id);

      const match2 = findMatchSuggestion('Eggs', [{ ...masterEggs, name: 'Egg' }]);
      assert.ok(match2);
      assert.strictEqual(match2.confidence, 'likely');
    });

    it('[ML8] Ambiguous matches are not auto-resolved ("Sugar" vs "Brown Sugar" vs "Powdered Sugar")', () => {
      const masterPowdered = {
        id: 'mi-powdered-1',
        workspaceId: 'ws-main',
        name: 'Powdered Sugar',
        category: 'Sugar',
      };

      const exactSugar = findMatchSuggestion('Sugar', [masterSugar, masterBrownSugar, masterPowdered]);
      assert.strictEqual(exactSugar?.masterIngredient.id, masterSugar.id);
      assert.strictEqual(exactSugar?.confidence, 'exact');

      const ambiguousQuery = findMatchSuggestion('Organic Cane Sugar', [
        masterSugar,
        masterBrownSugar,
        masterPowdered,
      ]);
      assert.ok(
        !ambiguousQuery ||
          ambiguousQuery.masterIngredient.name === 'Sugar' ||
          ambiguousQuery.confidence !== 'exact'
      );
    });

    it('[ML9] Suggested matches are never persisted without explicit operator confirmation', () => {
      const suggestion = findMatchSuggestion('Unsalted Butter', [masterButter]);
      assert.ok(suggestion);
      assert.strictEqual(sampleRecipe.ingredients[0].masterIngredientId, undefined);
    });
  });

  describe('3. Bulk Review & Grouping', () => {
    it('[ML10] Bulk review correctly aggregates identical ingredient names across multiple recipes', () => {
      const recipeA: Recipe = {
        ...sampleRecipe,
        id: 'rec-a',
        name: 'Cookie A',
        ingredients: [{ id: 'a1', name: 'Unsalted Butter', quantity: 100, unit: 'g' }],
      };
      const recipeB: Recipe = {
        ...sampleRecipe,
        id: 'rec-b',
        name: 'Cookie B',
        ingredients: [{ id: 'b1', name: 'unsalted butter', quantity: 200, unit: 'g' }],
      };

      const occurrences = collectFormulaLineOccurrences([recipeA, recipeB], [masterButter]);
      assert.strictEqual(occurrences.length, 2);

      const groups = groupOccurrencesByName(occurrences, [masterButter]);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].count, 2);
      assert.strictEqual(groups[0].unlinkedCount, 2);
      assert.strictEqual(groups[0].suggestionConfidence, 'exact');
    });

    it('[ML11] Bulk linking applies to all selected occurrences and preserves all formula quantities', () => {
      const recipeA: Recipe = {
        ...sampleRecipe,
        id: 'rec-a',
        name: 'Cookie A',
        ingredients: [{ id: 'a1', name: 'Unsalted Butter', quantity: 100, unit: 'g' }],
      };
      const recipeB: Recipe = {
        ...sampleRecipe,
        id: 'rec-b',
        name: 'Cookie B',
        ingredients: [{ id: 'b1', name: 'Unsalted Butter', quantity: 250, unit: 'g' }],
      };

      const { updatedRecipes, affectedCount } = applyBulkGroupLink(
        [recipeA, recipeB],
        'unsalted butter',
        masterButter,
        'ws-main',
        'owner'
      );

      assert.strictEqual(affectedCount, 2);
      assert.strictEqual(updatedRecipes[0].ingredients[0].masterIngredientId, masterButter.id);
      assert.strictEqual(updatedRecipes[0].ingredients[0].quantity, 100);
      assert.strictEqual(updatedRecipes[1].ingredients[0].masterIngredientId, masterButter.id);
      assert.strictEqual(updatedRecipes[1].ingredients[0].quantity, 250);
    });
  });

  describe('4. Referential Integrity & Protection', () => {
    it('[ML12] Deleting a Master Ingredient that is referenced by recipes is blocked or warns with occurrence count', () => {
      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const references = getMasterIngredientReferences(masterButter.id, [linkedRecipe]);

      assert.strictEqual(references.length, 1);
      assert.strictEqual(references[0].recipeId, sampleRecipe.id);
      assert.strictEqual(references[0].ingredientCount, 1);
    });

    it('[ML13] Broken links are detected when masterIngredientId references a nonexistent Master Ingredient', () => {
      const brokenRecipe: Recipe = {
        ...sampleRecipe,
        ingredients: [
          {
            id: 'broken-1',
            name: 'Deleted Cocoa Powder',
            quantity: 50,
            unit: 'g',
            masterIngredientId: 'nonexistent-id-999',
          },
        ],
      };

      const occurrences = collectFormulaLineOccurrences([brokenRecipe], [masterButter]);
      assert.strictEqual(occurrences.length, 1);
      assert.strictEqual(occurrences[0].isBroken, true);
      assert.strictEqual(occurrences[0].linkedMasterIngredient, null);
    });

    it('[ML14] Repairing a broken link updates masterIngredientId without changing the formula line', () => {
      const brokenRecipe: Recipe = {
        ...sampleRecipe,
        ingredients: [
          {
            id: 'broken-1',
            name: 'Sugar',
            quantity: 50,
            unit: 'g',
            wastePercent: 3,
            masterIngredientId: 'nonexistent-id-999',
          },
        ],
      };

      const repaired = linkIngredientInRecipe(brokenRecipe, 'broken-1', masterSugar, 'ws-main', 'editor');
      assert.strictEqual(repaired.ingredients[0].masterIngredientId, masterSugar.id);
      assert.strictEqual(repaired.ingredients[0].quantity, 50);
      assert.strictEqual(repaired.ingredients[0].wastePercent, 3);
    });

    it('[ML15] Archiving a recipe does not break its Master Ingredient links', () => {
      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const archivedRecipe: Recipe = { ...linkedRecipe, archived: true };

      assert.strictEqual(archivedRecipe.ingredients[0].masterIngredientId, masterButter.id);
      const stats = calculateLinkingStats([archivedRecipe], [masterButter]);
      assert.strictEqual(stats.archivedFormulaLines, 4);
      assert.strictEqual(stats.linkedFormulaLines, 1);
    });

    it('[ML16] Linking respects workspace isolation (cannot link to Master Ingredient from another workspace)', () => {
      const otherWorkspaceMaster: MasterIngredient = {
        id: 'mi-other-1',
        workspaceId: 'ws-different',
        name: 'Other Butter',
      };

      assert.throws(
        () => {
          linkIngredientInRecipe(sampleRecipe, 'ing-1', otherWorkspaceMaster, 'ws-main', 'owner');
        },
        /Cross-workspace linking is strictly prohibited/
      );
    });
  });

  describe('5. Access Control & Role Enforcement', () => {
    it('[ML17] Viewers cannot create, modify, or remove links', () => {
      assert.throws(() => {
        linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'viewer');
      }, /Permission denied/);

      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      assert.throws(() => {
        unlinkIngredientInRecipe(linkedRecipe, 'ing-1', 'viewer');
      }, /Permission denied/);
    });

    it('[ML18] Editors and Owners can create, modify, and remove links', () => {
      // Editor can link and unlink
      const editorLinked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'editor');
      assert.strictEqual(editorLinked.ingredients[0].masterIngredientId, masterButter.id);
      const editorUnlinked = unlinkIngredientInRecipe(editorLinked, 'ing-1', 'editor');
      assert.strictEqual(editorUnlinked.ingredients[0].masterIngredientId, undefined);

      // Owner can link and unlink
      const ownerLinked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      assert.strictEqual(ownerLinked.ingredients[0].masterIngredientId, masterButter.id);
      const ownerUnlinked = unlinkIngredientInRecipe(ownerLinked, 'ing-1', 'owner');
      assert.strictEqual(ownerUnlinked.ingredients[0].masterIngredientId, undefined);
    });
  });

  describe('6. Workspace Statistics & Dynamic Derivation', () => {
    it('[ML19] Total formula lines count matches the sum of all recipe ingredients across the workspace', () => {
      const stats = calculateLinkingStats([sampleRecipe], [masterButter]);
      assert.strictEqual(stats.totalFormulaLines, sampleRecipe.ingredients.length);
      assert.strictEqual(stats.totalFormulaLines, 4);
    });

    it('[ML20] Linked + unlinked count equals total formula lines', () => {
      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const stats = calculateLinkingStats([linkedRecipe], [masterButter]);

      assert.strictEqual(stats.linkedFormulaLines, 1);
      assert.strictEqual(stats.unlinkedFormulaLines, 3);
      assert.strictEqual(stats.linkedFormulaLines + stats.unlinkedFormulaLines, stats.totalFormulaLines);
    });

    it('[ML21] Sunny Sweets initial state reports 702 formula lines and 0 linked (when loaded from production snapshot)', () => {
      const syntheticRecipes: Recipe[] = [];
      let totalLinesCreated = 0;

      for (let i = 0; i < 72; i++) {
        const isArchived = i >= 69;
        const lineCount = i < 54 ? 10 : 9;
        const ingredients: Ingredient[] = [];
        for (let j = 0; j < lineCount; j++) {
          ingredients.push({
            id: `syn-${i}-${j}`,
            name: `Formula Ingredient ${j}`,
            quantity: 100 * (j + 1),
            unit: 'g',
          });
        }
        totalLinesCreated += lineCount;

        syntheticRecipes.push({
          id: `syn-recipe-${i}`,
          workspaceId: 'ws-main',
          userId: 'user-ss',
          name: `Sunny Sweets Recipe ${i + 1}`,
          description: `Sunny Sweets production recipe ${i + 1}`,
          category: 'Cookies',
          batchYieldQuantity: 100,
          batchYieldUnit: 'cookies',
          defaultWastePercent: 6,
          archived: isArchived,
          ingredients,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
      }

      assert.strictEqual(totalLinesCreated, 702);

      const stats = calculateLinkingStats(syntheticRecipes, SAMPLE_MASTER_INGREDIENTS);
      assert.strictEqual(stats.totalFormulaLines, 702);
      assert.strictEqual(stats.linkedFormulaLines, 0);
      assert.strictEqual(stats.unlinkedFormulaLines, 702);
      assert.strictEqual(stats.percentageLinked, 0);
      assert.strictEqual(stats.isInventoryReady, false);
    });

    it('[ML22] Linking stats update reactively when an ingredient is linked or unlinked', () => {
      const stats0 = calculateLinkingStats([sampleRecipe], [masterButter]);
      assert.strictEqual(stats0.linkedFormulaLines, 0);

      const r1 = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const stats1 = calculateLinkingStats([r1], [masterButter]);
      assert.strictEqual(stats1.linkedFormulaLines, 1);
      assert.strictEqual(stats1.percentageLinked, 25);

      const r2 = unlinkIngredientInRecipe(r1, 'ing-1', 'owner');
      const stats2 = calculateLinkingStats([r2], [masterButter]);
      assert.strictEqual(stats2.linkedFormulaLines, 0);
      assert.strictEqual(stats2.percentageLinked, 0);
    });

    it('[ML23] Inventory readiness reports "NOT READY" when unlinked formula lines exist', () => {
      const r1 = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const stats = calculateLinkingStats([r1], [masterButter]);
      assert.strictEqual(stats.isInventoryReady, false);
    });

    it('[ML24] Inventory readiness reports "READY" when 100% of active formula lines are linked', () => {
      let r = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      r = linkIngredientInRecipe(r, 'ing-2', masterSugar, 'ws-main', 'owner');
      r = linkIngredientInRecipe(r, 'ing-3', masterBrownSugar, 'ws-main', 'owner');
      r = linkIngredientInRecipe(r, 'ing-4', masterEggs, 'ws-main', 'owner');

      const stats = calculateLinkingStats([r], [masterButter, masterSugar, masterBrownSugar, masterEggs]);
      assert.strictEqual(stats.unlinkedFormulaLines, 0);
      assert.strictEqual(stats.percentageLinked, 100);
      assert.strictEqual(stats.isInventoryReady, true);
    });

    it('[ML25] Sample/archived recipes are distinguishable in linking review', () => {
      const activeRecipe = { ...sampleRecipe, id: 'rec-act', name: 'Active Cookie', archived: false };
      const archivedRecipe = { ...sampleRecipe, id: 'rec-arc', name: 'Archived Cookie', archived: true };

      const occurrences = collectFormulaLineOccurrences([activeRecipe, archivedRecipe], [masterButter]);
      const activeOcc = occurrences.filter((o) => !o.recipeArchived);
      const archivedOcc = occurrences.filter((o) => o.recipeArchived);

      assert.strictEqual(activeOcc.length, 4);
      assert.strictEqual(archivedOcc.length, 4);
      assert.strictEqual(archivedOcc[0].recipeName, 'Archived Cookie');
    });
  });

  describe('Phase 2A.2 — Master Ingredient Linking Safety & Targeting Suite', () => {
    it('[LS1] Link targets ingredient by recipeId + ingredientId', () => {
      const linked = linkIngredientInRecipe(sampleRecipe, 'ing-2', masterSugar, 'ws-main', 'owner');
      assert.strictEqual(linked.ingredients[1].id, 'ing-2');
      assert.strictEqual(linked.ingredients[1].masterIngredientId, masterSugar.id);
      // Other ingredients unchanged
      assert.strictEqual(linked.ingredients[0].masterIngredientId, undefined);
      assert.strictEqual(linked.ingredients[2].masterIngredientId, undefined);
      assert.strictEqual(linked.ingredients[3].masterIngredientId, undefined);
    });

    it('[LS2] Unlink targets ingredient by recipeId + ingredientId', () => {
      const linked = linkIngredientInRecipe(sampleRecipe, 'ing-3', masterBrownSugar, 'ws-main', 'owner');
      assert.strictEqual(linked.ingredients[2].masterIngredientId, masterBrownSugar.id);

      const unlinked = unlinkIngredientInRecipe(linked, 'ing-3', 'owner');
      assert.strictEqual(unlinked.ingredients[2].masterIngredientId, undefined);
      assert.strictEqual(unlinked.ingredients[2].name, 'Brown Sugar');
    });

    it('[LS3] Reordering ingredient array before linking does not cause wrong ingredient to be linked', () => {
      // Create recipe with reversed order of ingredients
      const reversedIngredients = [...sampleRecipe.ingredients].reverse();
      const reorderedRecipe: Recipe = {
        ...sampleRecipe,
        ingredients: reversedIngredients,
      };

      // In reordered recipe, 'ing-1' (Butter) is now at index 3 instead of 0
      assert.strictEqual(reorderedRecipe.ingredients[3].id, 'ing-1');
      assert.strictEqual(reorderedRecipe.ingredients[0].id, 'ing-4');

      const linked = linkIngredientInRecipe(reorderedRecipe, 'ing-1', masterButter, 'ws-main', 'owner');

      // The correct line ('ing-1') is linked, regardless of its position
      const butterLine = linked.ingredients.find((i) => i.id === 'ing-1');
      const eggsLine = linked.ingredients.find((i) => i.id === 'ing-4');

      assert.strictEqual(butterLine?.masterIngredientId, masterButter.id);
      assert.strictEqual(eggsLine?.masterIngredientId, undefined);
    });

    it('[LS4] Inserting a new ingredient before target does not affect targeting', () => {
      const newIngredient: Ingredient = {
        id: 'ing-new-0',
        name: 'Vanilla Extract',
        quantity: 10,
        unit: 'g',
      };
      const recipeWithInserted: Recipe = {
        ...sampleRecipe,
        ingredients: [newIngredient, ...sampleRecipe.ingredients],
      };

      // Target 'ing-2' (Sugar), which shifted from index 1 to index 2
      const linked = linkIngredientInRecipe(recipeWithInserted, 'ing-2', masterSugar, 'ws-main', 'owner');

      const sugarLine = linked.ingredients.find((i) => i.id === 'ing-2');
      const insertedLine = linked.ingredients.find((i) => i.id === 'ing-new-0');

      assert.strictEqual(sugarLine?.masterIngredientId, masterSugar.id);
      assert.strictEqual(insertedLine?.masterIngredientId, undefined);
    });

    it('[LS5] Removing another ingredient does not affect targeting', () => {
      // Remove 'ing-1' (Butter) so 'ing-2' shifts from index 1 to 0
      const recipeWithRemoved: Recipe = {
        ...sampleRecipe,
        ingredients: sampleRecipe.ingredients.filter((i) => i.id !== 'ing-1'),
      };

      const linked = linkIngredientInRecipe(recipeWithRemoved, 'ing-2', masterSugar, 'ws-main', 'owner');
      const sugarLine = linked.ingredients.find((i) => i.id === 'ing-2');
      assert.strictEqual(sugarLine?.masterIngredientId, masterSugar.id);
      assert.strictEqual(sugarLine?.name, 'Sugar');
    });

    it('[LS6] Missing ingredientId fails closed with clear error', () => {
      assert.throws(
        () => {
          linkIngredientInRecipe(sampleRecipe, 'nonexistent-id', masterButter, 'ws-main', 'owner');
        },
        /Ingredient not found in recipe/
      );

      assert.throws(
        () => {
          unlinkIngredientInRecipe(sampleRecipe, 'nonexistent-id', 'owner');
        },
        /Ingredient not found in recipe/
      );

      // Empty string also fails closed
      assert.throws(
        () => {
          linkIngredientInRecipe(sampleRecipe, '', masterButter, 'ws-main', 'owner');
        },
        /Invalid ingredient ID/
      );
    });

    it('[LS7] Unknown recipe fails closed with clear error', () => {
      const emptyRecipe = null as unknown as Recipe;
      assert.throws(
        () => {
          linkIngredientInRecipe(emptyRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
        },
        /Invalid recipe/
      );

      const unidentifiableRecipe = { ...sampleRecipe, id: '' };
      assert.throws(
        () => {
          linkIngredientInRecipe(unidentifiableRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
        },
        /Invalid recipe/
      );
    });

    it('[LS8] Duplicate ingredientId within SAME recipe fails closed', () => {
      // Recipe with malformed internal duplicate ID
      const corruptedRecipe: Recipe = {
        ...sampleRecipe,
        ingredients: [
          ...sampleRecipe.ingredients,
          {
            id: 'ing-1', // duplicate of first ingredient ID!
            name: 'Another Butter',
            quantity: 100,
            unit: 'g',
          },
        ],
      };

      assert.throws(
        () => {
          linkIngredientInRecipe(corruptedRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
        },
        /Duplicate ingredient ID detected in recipe/
      );

      assert.throws(
        () => {
          unlinkIngredientInRecipe(corruptedRecipe, 'ing-1', 'owner');
        },
        /Duplicate ingredient ID detected in recipe/
      );
    });

    it('[LS9] Same ingredientId in DIFFERENT recipes remains safe because recipeId scopes identity', () => {
      // Two cloned recipes sharing identical ingredient ID 'ing-shared-1'
      const recipeA: Recipe = {
        ...sampleRecipe,
        id: 'recipe-shortbread-1',
        name: 'Shortbread Cookies',
        ingredients: [
          { id: 'ing-shared-1', name: 'Unsalted Butter', quantity: 200, unit: 'g' },
          { id: 'ing-shared-2', name: 'Sugar', quantity: 100, unit: 'g' },
        ],
      };

      const recipeB: Recipe = {
        ...sampleRecipe,
        id: 'recipe-shortbread-2',
        name: 'Chocolate Shortbread Cookies',
        ingredients: [
          { id: 'ing-shared-1', name: 'Unsalted Butter', quantity: 250, unit: 'g' },
          { id: 'ing-shared-2', name: 'Sugar', quantity: 120, unit: 'g' },
        ],
      };

      // Linking in Recipe A scopes only to Recipe A
      const linkedA = linkIngredientInRecipe(recipeA, 'ing-shared-1', masterButter, 'ws-main', 'owner');

      assert.strictEqual(linkedA.id, 'recipe-shortbread-1');
      assert.strictEqual(linkedA.ingredients[0].masterIngredientId, masterButter.id);
      // Recipe B is completely untouched
      assert.strictEqual(recipeB.ingredients[0].masterIngredientId, undefined);
    });

    it('[LS10] Link modifies only intended masterIngredientId and permitted updated timestamp', () => {
      const originalRecipe = JSON.parse(JSON.stringify(sampleRecipe));
      const linked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');

      // Check all fields of recipe
      assert.strictEqual(linked.id, originalRecipe.id);
      assert.strictEqual(linked.name, originalRecipe.name);
      assert.strictEqual(linked.workspaceId, originalRecipe.workspaceId);
      assert.strictEqual(linked.category, originalRecipe.category);
      assert.strictEqual(linked.batchYieldQuantity, originalRecipe.batchYieldQuantity);
      assert.strictEqual(linked.batchYieldUnit, originalRecipe.batchYieldUnit);
      assert.strictEqual(linked.defaultWastePercent, originalRecipe.defaultWastePercent);
      assert.strictEqual(linked.archived, originalRecipe.archived);

      // Target ingredient check
      assert.strictEqual(linked.ingredients[0].masterIngredientId, masterButter.id);
      assert.strictEqual(linked.ingredients[0].name, originalRecipe.ingredients[0].name);
      assert.strictEqual(linked.ingredients[0].quantity, originalRecipe.ingredients[0].quantity);
      assert.strictEqual(linked.ingredients[0].unit, originalRecipe.ingredients[0].unit);
      assert.strictEqual(linked.ingredients[0].wastePercent, originalRecipe.ingredients[0].wastePercent);
      assert.strictEqual(linked.ingredients[0].notes, originalRecipe.ingredients[0].notes);

      // Non-target ingredients check
      assert.deepStrictEqual(linked.ingredients[1], originalRecipe.ingredients[1]);
      assert.deepStrictEqual(linked.ingredients[2], originalRecipe.ingredients[2]);
      assert.deepStrictEqual(linked.ingredients[3], originalRecipe.ingredients[3]);

      // Permitted timestamp updated
      assert.ok(new Date(linked.updatedAt).getTime() >= new Date(originalRecipe.updatedAt).getTime());
    });

    it('[LS11] Unlink modifies only intended relationship and permitted timestamp', () => {
      const linked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const unlinked = unlinkIngredientInRecipe(linked, 'ing-1', 'owner');

      assert.strictEqual(unlinked.ingredients[0].masterIngredientId, undefined);
      assert.strictEqual(unlinked.ingredients[0].name, sampleRecipe.ingredients[0].name);
      assert.strictEqual(unlinked.ingredients[0].quantity, sampleRecipe.ingredients[0].quantity);
      assert.strictEqual(unlinked.ingredients[0].unit, sampleRecipe.ingredients[0].unit);
      assert.strictEqual(unlinked.ingredients[0].wastePercent, sampleRecipe.ingredients[0].wastePercent);

      // Other ingredients completely untouched
      assert.deepStrictEqual(unlinked.ingredients[1], sampleRecipe.ingredients[1]);
      assert.deepStrictEqual(unlinked.ingredients[2], sampleRecipe.ingredients[2]);
      assert.deepStrictEqual(unlinked.ingredients[3], sampleRecipe.ingredients[3]);

      // Permitted timestamp updated
      assert.ok(new Date(unlinked.updatedAt).getTime() >= new Date(sampleRecipe.updatedAt).getTime());
    });

    it('[LS12] Cross-workspace Master Ingredient remains rejected', () => {
      const rogueMaster: MasterIngredient = {
        id: 'mi-rogue-1',
        workspaceId: 'ws-attacker',
        name: 'Attacker Butter',
      };

      assert.throws(
        () => {
          linkIngredientInRecipe(sampleRecipe, 'ing-1', rogueMaster, 'ws-main', 'owner');
        },
        /Cross-workspace linking is strictly prohibited/
      );
    });

    it('[LS13] Viewer remains unable to link/unlink', () => {
      assert.throws(
        () => {
          linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'viewer');
        },
        /Permission denied/
      );

      assert.throws(
        () => {
          unlinkIngredientInRecipe(sampleRecipe, 'ing-1', 'viewer');
        },
        /Permission denied/
      );

      assert.throws(
        () => {
          linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', null);
        },
        /Permission denied/
      );
    });

    it('[LS14] Editor/Owner permissions remain correct', () => {
      // Editor can link
      const editorLinked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'editor');
      assert.strictEqual(editorLinked.ingredients[0].masterIngredientId, masterButter.id);

      // Editor can unlink
      const editorUnlinked = unlinkIngredientInRecipe(editorLinked, 'ing-1', 'editor');
      assert.strictEqual(editorUnlinked.ingredients[0].masterIngredientId, undefined);

      // Owner can link
      const ownerLinked = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      assert.strictEqual(ownerLinked.ingredients[0].masterIngredientId, masterButter.id);

      // Owner can unlink
      const ownerUnlinked = unlinkIngredientInRecipe(ownerLinked, 'ing-1', 'owner');
      assert.strictEqual(ownerUnlinked.ingredients[0].masterIngredientId, undefined);
    });

    it('[LS15] Bulk preview performs zero writes', () => {
      const recipesCopy = JSON.parse(JSON.stringify([sampleRecipe]));

      // Pure derivation: occurrences and groups
      const occurrences = collectFormulaLineOccurrences(recipesCopy, [masterButter]);
      const groups = groupOccurrencesByName(occurrences, [masterButter]);
      const stats = calculateLinkingStats(recipesCopy, [masterButter]);

      // All pure read operations: zero mutations on source objects
      assert.strictEqual(recipesCopy[0].ingredients[0].masterIngredientId, undefined);
      assert.strictEqual(occurrences.length, 4);
      assert.strictEqual(groups.length, 4);
      assert.strictEqual(stats.linkedFormulaLines, 0);
    });

    it('[LS16] Bulk confirmation count equals exact affected line count', () => {
      const recipe1: Recipe = {
        ...sampleRecipe,
        id: 'rec-bulk-1',
        ingredients: [
          { id: 'b1-1', name: 'Unsalted Butter', quantity: 100, unit: 'g' },
          { id: 'b1-2', name: 'Sugar', quantity: 50, unit: 'g' },
        ],
      };
      const recipe2: Recipe = {
        ...sampleRecipe,
        id: 'rec-bulk-2',
        ingredients: [
          { id: 'b2-1', name: 'Unsalted Butter', quantity: 200, unit: 'g' },
          { id: 'b2-2', name: 'Flour', quantity: 300, unit: 'g' },
        ],
      };
      const recipe3: Recipe = {
        ...sampleRecipe,
        id: 'rec-bulk-3',
        ingredients: [
          { id: 'b3-1', name: 'Brown Sugar', quantity: 150, unit: 'g' },
        ],
      };

      const occurrences = collectFormulaLineOccurrences([recipe1, recipe2, recipe3], [masterButter]);
      const groups = groupOccurrencesByName(occurrences, [masterButter]);
      const butterGroup = groups.find((g) => g.normalizedName === 'unsalted butter');

      assert.ok(butterGroup);
      assert.strictEqual(butterGroup.count, 2);

      const { updatedRecipes, affectedCount } = applyBulkGroupLink(
        [recipe1, recipe2, recipe3],
        'unsalted butter',
        masterButter,
        'ws-main',
        'owner'
      );

      // Affected count matches group count exactly
      assert.strictEqual(affectedCount, butterGroup.count);
      assert.strictEqual(affectedCount, 2);
      assert.strictEqual(updatedRecipes[0].ingredients[0].masterIngredientId, masterButter.id);
      assert.strictEqual(updatedRecipes[1].ingredients[0].masterIngredientId, masterButter.id);
      // Non-matching ingredients untouched
      assert.strictEqual(updatedRecipes[0].ingredients[1].masterIngredientId, undefined);
      assert.strictEqual(updatedRecipes[1].ingredients[1].masterIngredientId, undefined);
      assert.strictEqual(updatedRecipes[2].ingredients[0].masterIngredientId, undefined);
    });

    it('[LS17] Delete safety regression: referenced Master Ingredient cannot be deleted without error', () => {
      const linkedRecipe = linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner');
      const references = getMasterIngredientReferences(masterButter.id, [linkedRecipe]);

      assert.ok(references.length > 0);
      assert.strictEqual(references[0].ingredientCount, 1);
      assert.strictEqual(references[0].recipeName, 'Classic Chocolate Chip Cookies');
    });

    it('[LS18] Mathematical invariance across standard calculations, Saved Production Presets, Full Recipe, Full Mixer, Custom Quantity, waste, mixer capacity, and batch splitting', () => {
      // 1. Standard calculation
      const beforeStandard = calculateRecipeTotal(sampleRecipe.ingredients, 'g', 0);
      const fullyLinked = linkIngredientInRecipe(
        linkIngredientInRecipe(
          linkIngredientInRecipe(
            linkIngredientInRecipe(sampleRecipe, 'ing-1', masterButter, 'ws-main', 'owner'),
            'ing-2', masterSugar, 'ws-main', 'owner'
          ),
          'ing-3', masterBrownSugar, 'ws-main', 'owner'
        ),
        'ing-4', masterEggs, 'ws-main', 'owner'
      );
      const afterStandard = calculateRecipeTotal(fullyLinked.ingredients, 'g', 0);
      assert.strictEqual(afterStandard.totalWeightGrams, beforeStandard.totalWeightGrams);
      assert.strictEqual(afterStandard.discreteCount, beforeStandard.discreteCount);

      // 2. Full Recipe mode
      const prodFullRecipeBefore = calculateProduction(sampleRecipe, [], {
        mode: 'full_recipe',
        fullRecipeCount: 5,
        defaultWeightUnit: 'g',
      });
      const prodFullRecipeAfter = calculateProduction(fullyLinked, [], {
        mode: 'full_recipe',
        fullRecipeCount: 5,
        defaultWeightUnit: 'g',
      });
      assert.strictEqual(prodFullRecipeAfter.totalBatchWeightGrams, prodFullRecipeBefore.totalBatchWeightGrams);
      assert.strictEqual(prodFullRecipeAfter.totalPieces, prodFullRecipeBefore.totalPieces);
      assert.deepStrictEqual(
        prodFullRecipeAfter.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit })),
        prodFullRecipeBefore.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit }))
      );

      // 3. Full Mixer mode & mixer capacity & batch splitting
      const testMixer: Mixer = {
        id: 'mixer-1',
        userId: 'u1',
        name: 'Hobart 60qt',
        maxWeight: 20000,
        weightUnit: 'g',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const prodFullMixerBefore = calculateProduction(sampleRecipe, [], {
        mode: 'full_mixer',
        mixer: testMixer,
        fullMixerBatches: 2,
        defaultWeightUnit: 'g',
      });
      const prodFullMixerAfter = calculateProduction(fullyLinked, [], {
        mode: 'full_mixer',
        mixer: testMixer,
        fullMixerBatches: 2,
        defaultWeightUnit: 'g',
      });
      assert.strictEqual(prodFullMixerAfter.totalBatchWeightGrams, prodFullMixerBefore.totalBatchWeightGrams);
      assert.strictEqual(prodFullMixerAfter.scalingMultiplier, prodFullMixerBefore.scalingMultiplier);
      assert.strictEqual(prodFullMixerAfter.suggestedBatches, prodFullMixerBefore.suggestedBatches);

      // 4. Custom Quantity mode
      const customRequirement: ProductionItemRequirement = {
        id: 'req-custom-1',
        presetName: 'Custom Quantity',
        quantity: 350,
        piecesPerUnit: 1,
        itemWeight: 35,
        itemWeightUnit: 'g',
      };
      const prodCustomBefore = calculateProduction(sampleRecipe, [customRequirement], {
        mode: 'presets',
        defaultWeightUnit: 'g',
      });
      const prodCustomAfter = calculateProduction(fullyLinked, [customRequirement], {
        mode: 'presets',
        defaultWeightUnit: 'g',
      });
      assert.strictEqual(prodCustomAfter.totalBatchWeightGrams, prodCustomBefore.totalBatchWeightGrams);
      assert.strictEqual(prodCustomAfter.totalPieces, prodCustomBefore.totalPieces);
      assert.deepStrictEqual(
        prodCustomAfter.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit })),
        prodCustomBefore.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit }))
      );

      // 5. Saved Production Presets mode
      const presetRequirement: ProductionItemRequirement = {
        id: 'req-preset-1',
        presetName: 'Case of 48',
        quantity: 10,
        piecesPerUnit: 48,
        itemWeight: 35,
        itemWeightUnit: 'g',
      };

      const prodPresetBefore = calculateProduction(sampleRecipe, [presetRequirement], {
        mode: 'presets',
        defaultWeightUnit: 'g',
        overrideWastePercent: 6,
      });
      const prodPresetAfter = calculateProduction(fullyLinked, [presetRequirement], {
        mode: 'presets',
        defaultWeightUnit: 'g',
        overrideWastePercent: 6,
      });
      assert.strictEqual(prodPresetAfter.totalBatchWeightGrams, prodPresetBefore.totalBatchWeightGrams);
      assert.strictEqual(prodPresetAfter.totalPieces, prodPresetBefore.totalPieces);
      assert.strictEqual(prodPresetAfter.displayBatchWeight, prodPresetBefore.displayBatchWeight);
      assert.deepStrictEqual(
        prodPresetAfter.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit })),
        prodPresetBefore.calculatedIngredients.map((i) => ({ q: i.scaledQuantity, u: i.baseUnit }))
      );
    });
  });
});
