import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Copy,
  Archive,
  Trash2,
  MoveUp,
  MoveDown,
  ChefHat,
  X,
  Tag,
  ArrowUpDown,
  Flame,
  Clock,
  SortAsc,
  FolderTree,
  SlidersHorizontal,
  Scale,
  Eye,
} from 'lucide-react';
import { Recipe, Ingredient, ProductionHistoryEntry, MasterIngredient, UserSettings, AccessRole, WeightUnit } from '../types';
import { getUnitLabel, WEIGHT_UNITS, isWeightUnit, convertWeight, standardizeIngredientsToUnit, standardizeIngredientToUnit } from '../utils/units';
import { calculateRecipeTotal } from '../utils/calculator';

const DEFAULT_CATEGORIES = [
  'Cookies',
  'Biscuits',
  'Scones',
  'Bread',
  'Pastries',
  'Cakes',
  'Pies',
  'Muffins',
];

export type ArrangeOption = 'category' | 'alphabetical' | 'most_used' | 'most_recent' | 'manual';

interface RecipeManagerProps {
  userRole?: AccessRole;
  recipes: Recipe[];
  masterIngredients?: MasterIngredient[];
  history?: ProductionHistoryEntry[];
  settings?: UserSettings;
  onSaveRecipe: (recipe: Recipe) => void;
  onDuplicateRecipe: (id: string) => void;
  onArchiveRecipe: (id: string, archived?: boolean) => void;
  onDeleteRecipe: (id: string) => void;
  onReorderRecipes?: (orderedRecipes: Recipe[]) => void;
  onSelectRecipeForCalc: (recipeId: string) => void;
  onSaveMasterIngredient?: (ing: MasterIngredient) => void;
  openModalDirectly?: boolean;
}

export const RecipeManager: React.FC<RecipeManagerProps> = ({
  userRole = 'owner',
  recipes,
  masterIngredients = [],
  history = [],
  settings,
  onSaveRecipe,
  onDuplicateRecipe,
  onArchiveRecipe,
  onDeleteRecipe,
  onReorderRecipes,
  onSelectRecipeForCalc,
  onSaveMasterIngredient,
  openModalDirectly = false,
}) => {
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [arrangeBy, setArrangeBy] = useState<ArrangeOption>('category');
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState<number | null>(null);

  const defaultUnit = settings?.defaultWeightUnit || 'g';
  const [cardUnits, setCardUnits] = useState<Record<string, WeightUnit>>({});
  const [modalTotalUnit, setModalTotalUnit] = useState<WeightUnit>(settings?.defaultWeightUnit || 'g');

  // Modal State
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(
    openModalDirectly
      ? {
          id: `recipe-${Date.now()}`,
          userId: '',
          name: '',
          description: '',
          category: 'Cookies',
          batchYieldQuantity: 100,
          batchYieldUnit: 'cookies',
          defaultWastePercent: settings?.defaultWastePercent ?? 6,
          ingredients: [{ id: `ing-${Date.now()}-1`, name: '', quantity: '' as any, unit: defaultUnit }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : null
  );

  const [isCustomCategoryInput, setIsCustomCategoryInput] = useState(false);
  const [customCategoryText, setCustomCategoryText] = useState('');

  // Extract all existing unique categories
  const existingCategories = useMemo(() => {
    const set = new Set<string>([
      ...(settings?.recipeCategories || []),
      ...(recipes.map((r) => r.category?.trim()).filter(Boolean) as string[]),
    ]);
    const arr = Array.from(set).sort();
    return arr.length > 0 ? arr : ['Cookies'];
  }, [recipes, settings?.recipeCategories]);

  const handleCreateNew = () => {
    const sysUnit = settings?.defaultWeightUnit || 'g';

    setEditingRecipe({
      id: `recipe-${Date.now()}`,
      userId: '',
      name: '',
      description: '',
      category: 'Cookies',
      batchYieldQuantity: 100,
      batchYieldUnit: 'cookies',
      defaultWastePercent: settings?.defaultWastePercent ?? 6,
      ingredients: [
        { id: `ing-${Date.now()}-1`, name: '', quantity: '' as any, unit: sysUnit },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setIsCustomCategoryInput(false);
    setCustomCategoryText('');
  };

  const handleAddIngredient = () => {
    if (!editingRecipe) return;
    const sysUnit = settings?.defaultWeightUnit || 'g';
    const newIng: Ingredient = {
      id: `ing-${Date.now()}-${editingRecipe.ingredients.length + 1}`,
      name: '',
      quantity: '' as any,
      unit: sysUnit,
    };
    setEditingRecipe({
      ...editingRecipe,
      ingredients: [...editingRecipe.ingredients, newIng],
    });
  };

  const handleUpdateIngredient = (index: number, updates: Partial<Ingredient>) => {
    if (!editingRecipe) return;
    const updatedIngs = [...editingRecipe.ingredients];
    updatedIngs[index] = { ...updatedIngs[index], ...updates };
    setEditingRecipe({ ...editingRecipe, ingredients: updatedIngs });
  };

  const handleUnitChange = (index: number, newUnit: string) => {
    if (!editingRecipe) return;
    const ing = editingRecipe.ingredients[index];
    const oldUnit = ing.unit;
    const rawQty = typeof ing.quantity === 'number' ? ing.quantity : parseFloat(String(ing.quantity) || '0');

    if (!isNaN(rawQty) && rawQty > 0 && isWeightUnit(oldUnit) && isWeightUnit(newUnit)) {
      const converted = convertWeight(rawQty, oldUnit, newUnit as WeightUnit);
      const decimals = settings?.decimalPlaces !== undefined ? settings.decimalPlaces : 3;
      handleUpdateIngredient(index, { unit: newUnit, quantity: Number(converted.toFixed(decimals)) });
    } else {
      handleUpdateIngredient(index, { unit: newUnit });
    }
  };

  const handleStandardizeAllIngredients = (targetUnit?: WeightUnit) => {
    if (!editingRecipe) return;
    const unitToUse = targetUnit || defaultUnit;
    const standardized = standardizeIngredientsToUnit(
      editingRecipe.ingredients,
      unitToUse,
      settings?.decimalPlaces
    );
    setEditingRecipe({
      ...editingRecipe,
      ingredients: standardized,
    });
  };

  const handleRemoveIngredient = (index: number) => {
    if (!editingRecipe) return;
    const updatedIngs = editingRecipe.ingredients.filter((_, i) => i !== index);
    setEditingRecipe({ ...editingRecipe, ingredients: updatedIngs });
  };

  const handleMoveIngredient = (index: number, direction: 'up' | 'down') => {
    if (!editingRecipe) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= editingRecipe.ingredients.length) return;

    const copy = [...editingRecipe.ingredients];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;

    setEditingRecipe({ ...editingRecipe, ingredients: copy });
  };

  const handleSortRecipeIngredients = (sortType: string) => {
    if (!editingRecipe) return;
    const sorted = [...editingRecipe.ingredients].sort((a, b) => {
      if (sortType === 'alphabetical') {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortType === 'category') {
        const catA = masterIngredients.find((m) => m.name.toLowerCase() === a.name.toLowerCase())?.category || 'General';
        const catB = masterIngredients.find((m) => m.name.toLowerCase() === b.name.toLowerCase())?.category || 'General';
        const comp = catA.localeCompare(catB, undefined, { numeric: true, sensitivity: 'base' });
        if (comp !== 0) return comp;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortType === 'ascending') {
        const qA = Number(a.quantity) || 0;
        const qB = Number(b.quantity) || 0;
        if (qA !== qB) return qA - qB;
        return a.name.localeCompare(b.name);
      }
      if (sortType === 'descending') {
        const qA = Number(a.quantity) || 0;
        const qB = Number(b.quantity) || 0;
        if (qA !== qB) return qB - qA;
        return b.name.localeCompare(a.name);
      }
      return 0;
    });

    if (sortType === 'oldest_added') {
      sorted.reverse();
    }

    setEditingRecipe({
      ...editingRecipe,
      ingredients: sorted,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecipe) return;
    if (!isEditorOrOwner) {
      setEditingRecipe(null);
      return;
    }
    if (!editingRecipe.name.trim()) {
      alert('Please enter a recipe name.');
      return;
    }
    if (editingRecipe.ingredients.length === 0) {
      alert('Please add at least one ingredient.');
      return;
    }

    // Recipe should not save if there is an ingredient with blank amount
    const hasBlankIngredient = editingRecipe.ingredients.some(
      (ing) =>
        ing.quantity === '' ||
        ing.quantity === undefined ||
        ing.quantity === null ||
        isNaN(Number(ing.quantity))
    );

    if (hasBlankIngredient) {
      alert('Recipe cannot be saved because one or more ingredients have a blank amount.');
      return;
    }

    const cleanedIngredients = editingRecipe.ingredients.map((ing) => ({
      ...ing,
      quantity: Number(ing.quantity),
    }));

    const finalCategory = isCustomCategoryInput
      ? customCategoryText.trim() || 'Uncategorized'
      : editingRecipe.category || 'Uncategorized';

    // Auto-save new recipe ingredients to Master Ingredients pantry
    if (onSaveMasterIngredient) {
      cleanedIngredients.forEach((ing) => {
        if (!ing.name.trim()) return;
        const nameClean = ing.name.trim();
        const exists = masterIngredients.some(
          (m) => m.name.toLowerCase() === nameClean.toLowerCase()
        );
        if (!exists) {
          onSaveMasterIngredient({
            id: `mi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            name: nameClean,
            category: 'General',
            defaultUnit: ing.unit || defaultUnit,
            defaultWastePercent: ing.wastePercent ?? 0,
          });
        }
      });
    }

    onSaveRecipe({
      ...editingRecipe,
      ingredients: cleanedIngredients,
      category: finalCategory,
    });
    setEditingRecipe(null);
  };

  // Move Recipe position in Manual Order mode
  const handleMoveRecipeCard = (recipeId: string, direction: 'up' | 'down') => {
    if (!onReorderRecipes) return;
    const currentList = [...recipes];
    const idx = currentList.findIndex((r) => r.id === recipeId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentList.length) return;

    const temp = currentList[idx];
    currentList[idx] = currentList[targetIdx];
    currentList[targetIdx] = temp;

    const reordered = currentList.map((r, i) => ({ ...r, orderIndex: i }));
    onReorderRecipes(reordered);
  };

  // Base Filter
  const baseFiltered = recipes.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.category && r.category.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesArchived = showArchived ? true : !r.archived;
    const matchesCategory =
      selectedCategory === 'ALL' || (r.category || 'Uncategorized') === selectedCategory;
    return matchesSearch && matchesArchived && matchesCategory;
  });

  // Calculate usage map
  const usageCountMap = new Map<string, number>();
  history.forEach((h) => {
    if (h.recipeId) {
      usageCountMap.set(h.recipeId, (usageCountMap.get(h.recipeId) || 0) + 1);
    }
  });

  // Sorted Array
  const sortedRecipes = [...baseFiltered].sort((a, b) => {
    if (arrangeBy === 'alphabetical') {
      return a.name.localeCompare(b.name);
    }
    if (arrangeBy === 'most_used') {
      const usageA = usageCountMap.get(a.id) || 0;
      const usageB = usageCountMap.get(b.id) || 0;
      return usageB - usageA;
    }
    if (arrangeBy === 'most_recent') {
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    }
    if (arrangeBy === 'category') {
      const catA = a.category || 'Uncategorized';
      const catB = b.category || 'Uncategorized';
      if (catA !== catB) return catA.localeCompare(catB);
      return a.name.localeCompare(b.name);
    }
    // Manual
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  });

  // Unique categories in active recipes for chip filters
  const activeCategoryCounts = recipes.reduce((acc: Record<string, number>, r) => {
    if (!showArchived && r.archived) return acc;
    const cat = r.category || 'Uncategorized';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  // Grouped by Category map
  const groupedByCategory = sortedRecipes.reduce((acc: Record<string, Recipe[]>, r) => {
    const cat = r.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  // Render Recipe Card
  const renderRecipeCard = (recipe: Recipe, index: number) => {
    const usages = usageCountMap.get(recipe.id) || 0;
    const cardUnit = cardUnits[recipe.id] || settings?.defaultWeightUnit || 'g';
    const recipeTotal = calculateRecipeTotal(recipe, cardUnit, settings?.decimalPlaces);

    return (
      <div
        key={recipe.id}
        id={`recipe-card-${recipe.id}`}
        className={`bg-white dark:bg-[#1E1B18] border ${
          recipe.archived
            ? 'border-[#E5E1DA] dark:border-[#2D2925] opacity-60'
            : 'border-[#E5E1DA] dark:border-[#2D2925]'
        } rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between group relative`}
      >
        <div>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1] leading-tight">
                {recipe.name}
              </h3>
              {recipe.category && (
                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] rounded text-[10px] font-bold">
                  <Tag className="w-2.5 h-2.5 text-[#D4A373]" />
                  <span>{recipe.category}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {isEditorOrOwner && arrangeBy === 'manual' && onReorderRecipes && (
                <div className="flex items-center gap-0.5 bg-[#F5F2ED] dark:bg-[#25221F] p-1 rounded-lg border border-[#EEECE8] dark:border-[#332F2B]">
                  <button
                    onClick={() => handleMoveRecipeCard(recipe.id, 'up')}
                    disabled={index === 0}
                    title="Move Up"
                    className="p-1 text-[#8B7E74] hover:text-[#5A534B] disabled:opacity-20 cursor-pointer"
                  >
                    <MoveUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleMoveRecipeCard(recipe.id, 'down')}
                    disabled={index === sortedRecipes.length - 1}
                    title="Move Down"
                    className="p-1 text-[#8B7E74] hover:text-[#5A534B] disabled:opacity-20 cursor-pointer"
                  >
                    <MoveDown className="w-3 h-3" />
                  </button>
                </div>
              )}

              {recipe.archived && (
                <span className="px-2 py-0.5 bg-[#EEECE8] text-[#5A534B] dark:bg-[#25221F] dark:text-[#A39E93] rounded text-[10px] font-bold uppercase tracking-wider">
                  Archived
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] line-clamp-2 mb-4">
            {recipe.description || 'No description provided.'}
          </p>

          <div className="bg-[#F9F8F6] dark:bg-[#25221F] rounded-xl p-3 space-y-2 text-xs text-[#5A534B] dark:text-[#EAE6E1] border border-[#EEECE8] dark:border-[#332F2B] mb-4">
            <div className="flex justify-between">
              <span className="text-[#8B7E74]">Base Yield:</span>
              <span className="font-bold text-[#D4A373] font-mono">
                {recipe.batchYieldQuantity} {recipe.batchYieldUnit}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8B7E74]">Default Waste:</span>
              <span className="font-semibold font-mono">{recipe.defaultWastePercent ?? 0}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8B7E74]">Ingredients:</span>
              <span className="font-semibold">{recipe.ingredients.length} items</span>
            </div>
            {usages > 0 && (
              <div className="flex justify-between text-[11px] text-[#D4A373] font-semibold">
                <span>Calculated Runs:</span>
                <span>{usages} times</span>
              </div>
            )}

            {/* Total Recipe Weight Calculation at bottom of recipe */}
            <div className="pt-2 border-t border-[#EEECE8] dark:border-[#332F2B] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#8B7E74] font-medium flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5 text-[#D4A373]" />
                  <span>Recipe Total:</span>
                </span>
                <span className="font-bold font-mono text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                  {recipeTotal.formattedTargetUnit}{' '}
                  <span className="text-[#D4A373] font-semibold">{recipeTotal.targetUnit}</span>
                </span>
              </div>

              {/* Unit Toggle Buttons */}
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#A39E93]">Unit:</span>
                <div className="flex items-center bg-[#EEECE8] dark:bg-[#1E1B18] p-0.5 rounded-md">
                  {(['g', 'lb', 'oz', 'kg'] as WeightUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardUnits((prev) => ({ ...prev, [recipe.id]: u }));
                      }}
                      className={`px-1.5 py-0.5 rounded font-mono font-bold uppercase transition cursor-pointer ${
                        cardUnit === u
                          ? 'bg-[#D4A373] text-white shadow-xs'
                          : 'text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1]'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Per-piece average weight calculation if applicable */}
              {recipeTotal.perPieceWeight && (
                <div className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] flex justify-between font-mono">
                  <span>Per {recipe.batchYieldUnit || 'piece'}:</span>
                  <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">
                    ~{recipeTotal.perPieceWeight.formatted} {recipeTotal.perPieceWeight.unit}
                  </span>
                </div>
              )}

              {/* Non-weight discrete ingredients notice if present */}
              {recipeTotal.discreteCount > 0 && (
                <div className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] italic flex justify-between">
                  <span>Non-weight items:</span>
                  <span className="font-medium">
                    {recipeTotal.discreteItems.map((d) => `${d.quantity} ${d.unit}`).join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recipe Card Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-[#EEECE8] dark:border-[#332F2B] gap-1">
          <button
            id={`recipe-calculate-btn-${recipe.id}`}
            onClick={() => onSelectRecipeForCalc(recipe.id)}
            className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition cursor-pointer"
          >
            Calculate Batch
          </button>

          <div className="flex items-center gap-1">
            <button
              id={`recipe-edit-btn-${recipe.id}`}
              onClick={() => {
                setEditingRecipe(recipe);
                setIsCustomCategoryInput(
                  !!recipe.category && !DEFAULT_CATEGORIES.includes(recipe.category)
                );
                if (recipe.category && !DEFAULT_CATEGORIES.includes(recipe.category)) {
                  setCustomCategoryText(recipe.category);
                }
              }}
              title={isEditorOrOwner ? "Edit Recipe" : "View Recipe Details"}
              className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer flex items-center gap-1"
            >
              {isEditorOrOwner ? <Edit2 className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#D4A373]" />}
            </button>
            {isEditorOrOwner && (
              <>
                <button
                  id={`recipe-duplicate-btn-${recipe.id}`}
                  onClick={() => onDuplicateRecipe(recipe.id)}
                  title="Duplicate Recipe"
                  className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  id={`recipe-archive-btn-${recipe.id}`}
                  onClick={() => onArchiveRecipe(recipe.id, !recipe.archived)}
                  title={recipe.archived ? 'Unarchive' : 'Archive'}
                  className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer"
                >
                  <Archive className="w-4 h-4" />
                </button>
                <button
                  id={`recipe-delete-btn-${recipe.id}`}
                  onClick={() => {
                    if (confirm(`Delete "${recipe.name}" permanently?`)) {
                      onDeleteRecipe(recipe.id);
                    }
                  }}
                  title="Delete Recipe"
                  className="p-1.5 text-[#C97B63] hover:text-red-700 hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Viewer Notice Banner */}
      {!isEditorOrOwner && (
        <div className="bg-[#FAF3E0] dark:bg-[#2C2416] border border-[#E6C875] dark:border-[#8A6D24] text-[#7A5B10] dark:text-[#EED285] px-4 py-3 rounded-xl text-xs font-semibold flex items-center gap-2.5 shadow-xs">
          <Eye className="w-4 h-4 shrink-0 text-[#D4A373]" />
          <span>
            <strong>Viewer Mode:</strong> You have read-only access. Only workspace Owners and Editors can add, edit, or delete recipes.
          </span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-[#D4A373]" />
            <span>Recipe Formulas</span>
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Organize recipes by custom categories, arrange order, and manage batch yields.
          </p>
        </div>

        <button
          id="recipe-add-btn"
          disabled={!isEditorOrOwner}
          onClick={handleCreateNew}
          title={!isEditorOrOwner ? "Viewers cannot create recipes" : "New Recipe"}
          className={`inline-flex items-center justify-center gap-2 font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-xs ${
            isEditorOrOwner
              ? 'bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white cursor-pointer'
              : 'bg-gray-200 dark:bg-[#2A2725] text-gray-400 dark:text-gray-600 cursor-not-allowed border border-gray-300 dark:border-gray-800'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>New Recipe</span>
        </button>
      </div>

      {/* Category Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedCategory('ALL')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            selectedCategory === 'ALL'
              ? 'bg-[#5A534B] text-white shadow-sm dark:bg-[#3D3732]'
              : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] border border-[#E5E1DA] dark:border-[#2D2925] hover:text-[#5A534B]'
          }`}
        >
          All Recipes ({recipes.filter((r) => showArchived || !r.archived).length})
        </button>

        {Object.entries(activeCategoryCounts).map(([catName, count]) => (
          <button
            key={catName}
            onClick={() => setSelectedCategory(catName)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              selectedCategory === catName
                ? 'bg-[#D4A373] text-white shadow-sm'
                : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] border border-[#E5E1DA] dark:border-[#2D2925] hover:text-[#5A534B]'
            }`}
          >
            <Tag className="w-3 h-3" />
            <span>{catName}</span>
            <span className="opacity-75 font-mono text-[10px]">({count})</span>
          </button>
        ))}
      </div>

      {/* Controls Bar: Search, Arrange Selector & Filters */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-3 bg-white dark:bg-[#1E1B18] p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] shadow-sm">
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A39E93]" />
          <input
            type="text"
            placeholder="Search name, ingredients, category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:outline-none focus:border-[#D4A373] dark:text-[#EAE6E1]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
          {/* Arrange By Dropdown */}
          <div className="flex items-center gap-2 text-xs text-[#8B7E74] dark:text-[#A39E93]">
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#D4A373]" />
            <span className="font-semibold hidden sm:inline">Arrange By:</span>
            <select
              value={arrangeBy}
              onChange={(e) => setArrangeBy(e.target.value as ArrangeOption)}
              className="px-2.5 py-1.5 bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none focus:border-[#D4A373] cursor-pointer"
            >
              <option value="category">📂 Category Grouping</option>
              <option value="alphabetical">🔤 Alphabetical (A-Z)</option>
              <option value="most_used">🔥 Most Used</option>
              <option value="most_recent">🕒 Most Recent</option>
              <option value="manual">🖐️ Manual Order</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#8B7E74] dark:text-[#A39E93] cursor-pointer pl-2 border-l border-[#EEECE8] dark:border-[#332F2B]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded text-[#D4A373] focus:ring-[#D4A373]"
            />
            <span>Show Archived ({recipes.filter((r) => r.archived).length})</span>
          </label>
        </div>
      </div>

      {/* Main Recipe Display Area */}
      {arrangeBy === 'category' && selectedCategory === 'ALL' ? (
        /* Render Grouped Category Sections */
        <div className="space-y-8">
          {(Object.entries(groupedByCategory) as [string, Recipe[]][]).map(([categoryName, items]) => (
            <div key={categoryName} className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#E5E1DA] dark:border-[#2D2925] pb-2">
                <div className="flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-[#D4A373]" />
                  <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                    {categoryName}
                  </h3>
                  <span className="text-xs font-mono font-bold bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] px-2 py-0.5 rounded-full border border-[#EEECE8] dark:border-[#332F2B]">
                    {items.length} {items.length === 1 ? 'recipe' : 'recipes'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((recipe, idx) => renderRecipeCard(recipe, idx))}
              </div>
            </div>
          ))}

          {Object.keys(groupedByCategory).length === 0 && (
            <div className="py-12 text-center text-[#A39E93] text-sm bg-white dark:bg-[#1E1B18] rounded-xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] p-8">
              <p className="mb-2">No recipes found matching criteria.</p>
              <button
                onClick={handleCreateNew}
                className="text-[#D4A373] font-bold underline cursor-pointer"
              >
                Create a new recipe
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Render Standard Flat Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedRecipes.map((recipe, idx) => renderRecipeCard(recipe, idx))}

          {sortedRecipes.length === 0 && (
            <div className="col-span-full py-12 text-center text-[#A39E93] text-sm bg-white dark:bg-[#1E1B18] rounded-xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] p-8">
              <p className="mb-2">No recipes found matching criteria.</p>
              <button
                onClick={handleCreateNew}
                className="text-[#D4A373] font-bold underline cursor-pointer"
              >
                Create a new recipe
              </button>
            </div>
          )}
        </div>
      )}

      {/* Recipe Create / Edit Modal */}
      {editingRecipe && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl my-auto">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between">
              <div>
                <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                  {!isEditorOrOwner
                    ? 'View Recipe Formula (Read Only)'
                    : editingRecipe.id.includes('recipe-')
                    ? 'Create New Recipe'
                    : 'Edit Recipe Formula'}
                </h3>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  {!isEditorOrOwner
                    ? 'Viewing formula in read-only mode.'
                    : 'Specify base recipe yield, category, and ingredient formulas.'}
                </p>
              </div>
              <button
                onClick={() => setEditingRecipe(null)}
                className="p-1.5 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Recipe Name *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!isEditorOrOwner}
                    placeholder="e.g., Chocolate Chip Cookies 4oz"
                    value={editingRecipe.name}
                    onChange={(e) => setEditingRecipe({ ...editingRecipe, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>

                {/* Category Selection */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1 flex items-center justify-between">
                    <span>Category / Tag *</span>
                    {isEditorOrOwner && (
                      <button
                        type="button"
                        onClick={() => setIsCustomCategoryInput(!isCustomCategoryInput)}
                        className="text-[11px] text-[#D4A373] hover:underline cursor-pointer"
                      >
                        {isCustomCategoryInput ? 'Select from presets' : '+ Add custom category'}
                      </button>
                    )}
                  </label>

                  {isCustomCategoryInput ? (
                    <input
                      type="text"
                      disabled={!isEditorOrOwner}
                      placeholder="e.g., Biscuits, Scones, Macarons..."
                      value={customCategoryText}
                      onChange={(e) => {
                        setCustomCategoryText(e.target.value);
                        setEditingRecipe({ ...editingRecipe, category: e.target.value });
                      }}
                      className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                    />
                  ) : (
                    <select
                      value={editingRecipe.category || 'Cookies'}
                      disabled={!isEditorOrOwner}
                      onChange={(e) => {
                        if (e.target.value === '__CUSTOM__') {
                          setIsCustomCategoryInput(true);
                          setCustomCategoryText('');
                        } else {
                          setEditingRecipe({ ...editingRecipe, category: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer disabled:opacity-75"
                    >
                      {existingCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                      {isEditorOrOwner && <option value="__CUSTOM__">+ Add Custom Category...</option>}
                    </select>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Description / Notes
                  </label>
                  <input
                    type="text"
                    disabled={!isEditorOrOwner}
                    placeholder="e.g., Chewy brown sugar dough base"
                    value={editingRecipe.description}
                    onChange={(e) => setEditingRecipe({ ...editingRecipe, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Base Yield Quantity *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    disabled={!isEditorOrOwner}
                    value={editingRecipe.batchYieldQuantity}
                    onChange={(e) =>
                      setEditingRecipe({
                        ...editingRecipe,
                        batchYieldQuantity: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Yield Unit (e.g., cookies, biscuits, loaves, kg) *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!isEditorOrOwner}
                    placeholder="e.g., cookies"
                    value={editingRecipe.batchYieldUnit}
                    onChange={(e) => setEditingRecipe({ ...editingRecipe, batchYieldUnit: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Default Recipe Waste Percentage (%)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    disabled={!isEditorOrOwner}
                    value={editingRecipe.defaultWastePercent}
                    onChange={(e) =>
                      setEditingRecipe({
                        ...editingRecipe,
                        defaultWastePercent: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>
              </div>

              {/* Top Add Ingredient Button */}
              <div className="pt-4 border-t border-[#EEECE8] dark:border-[#332F2B]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                      Recipe Ingredients ({editingRecipe.ingredients.length})
                    </h4>
                    <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                      Specify exact ingredient amounts. All inputs can be standardized to your setup preference.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Sort Recipe Ingredients Dropdown */}
                    <div className="flex items-center gap-1 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] px-2.5 py-1 rounded-lg text-xs">
                      <ArrowUpDown className="w-3 h-3 text-[#D4A373] shrink-0" />
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            handleSortRecipeIngredients(e.target.value);
                            e.target.value = '';
                          }
                        }}
                        defaultValue=""
                        className="bg-transparent font-bold text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none cursor-pointer text-xs"
                      >
                        <option value="" disabled>Sort Ingredients...</option>
                        <option value="alphabetical">Alphabetical Order (A-Z)</option>
                        <option value="category">Category</option>
                        <option value="recently_added">Recently Added</option>
                        <option value="oldest_added">Oldest Added</option>
                        <option value="ascending">Ascending (Qty)</option>
                        <option value="descending">Descending (Qty)</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddIngredient}
                      className="inline-flex items-center gap-1 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-3 py-1.5 rounded-lg text-xs cursor-pointer shadow-sm transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Ingredient</span>
                    </button>
                  </div>
                </div>

                {/* Measuring Unit Setup Preference & Standardization Bar */}
                {(() => {
                  const differingUnits = editingRecipe.ingredients.filter(
                    (ing) => ing.unit && ing.unit.trim().toLowerCase() !== defaultUnit.toLowerCase()
                  );
                  const hasDiffering = differingUnits.length > 0;

                  return (
                    <div className="mb-3 space-y-2">
                      <div className="bg-[#FAF7F2] dark:bg-[#25221F] border border-[#D4A373]/30 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-[#F0EAE1] dark:bg-[#332F2B] flex items-center justify-center text-[#D4A373] shrink-0 font-mono font-bold text-xs">
                            {defaultUnit}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                                Measuring Unit Preference: {getUnitLabel(defaultUnit)}
                              </span>
                              {!hasDiffering && editingRecipe.ingredients.length > 0 && (
                                <span className="bg-[#E8F5E9] dark:bg-[#1B3520] text-[#2E7D32] dark:text-[#81C784] font-bold px-2 py-0.5 rounded text-[10px]">
                                  ✓ All Aligned ({defaultUnit})
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                              {hasDiffering
                                ? `${differingUnits.length} ingredient${differingUnits.length > 1 ? 's have' : ' has'} differing units. Standardize all to ${defaultUnit.toUpperCase()} below.`
                                : `All new ingredient inputs and calculations automatically use ${defaultUnit}.`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                          {isEditorOrOwner && (
                            <button
                              type="button"
                              onClick={() => handleStandardizeAllIngredients(defaultUnit)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer ${
                                hasDiffering
                                  ? 'bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#D4A373] dark:hover:bg-[#C49363] text-white'
                                  : 'bg-white dark:bg-[#1E1B18] text-[#5A534B] dark:text-[#EAE6E1] border border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
                              }`}
                              title={`Convert all ingredients to ${defaultUnit}`}
                            >
                              <Scale className="w-3.5 h-3.5 text-[#D4A373] dark:text-white" />
                              <span>Standardize All to {defaultUnit.toUpperCase()}</span>
                            </button>
                          )}

                          {/* Quick conversion pill selector */}
                          <div className="hidden sm:flex items-center gap-0.5 bg-white dark:bg-[#1E1B18] p-0.5 rounded-lg border border-[#EEECE8] dark:border-[#332F2B]">
                            {WEIGHT_UNITS.map((u) => (
                              <button
                                key={u.value}
                                type="button"
                                onClick={() => handleStandardizeAllIngredients(u.value)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                                  defaultUnit === u.value
                                    ? 'bg-[#D4A373] text-white'
                                    : 'text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1]'
                                }`}
                                title={`Convert all ingredients to ${u.label}`}
                              >
                                {u.value}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-3">
                  {editingRecipe.ingredients.map((ing, idx) => {
                    const currentQuery = ing.name.trim().toLowerCase();
                    const suggestions =
                      currentQuery.length > 0
                        ? masterIngredients
                            .filter((m) => m.name.toLowerCase().includes(currentQuery))
                            .slice(0, 8)
                        : [];

                    return (
                      <div
                        key={ing.id || idx}
                        className="p-3 bg-[#F9F8F6] dark:bg-[#25221F] rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            {/* Reorder Buttons */}
                            {isEditorOrOwner && (
                              <div className="flex flex-col gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveIngredient(idx, 'up')}
                                  className="p-0.5 text-[#A39E93] hover:text-[#5A534B] disabled:opacity-20 cursor-pointer"
                                >
                                  <MoveUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === editingRecipe.ingredients.length - 1}
                                  onClick={() => handleMoveIngredient(idx, 'down')}
                                  className="p-0.5 text-[#A39E93] hover:text-[#5A534B] disabled:opacity-20 cursor-pointer"
                                >
                                  <MoveDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            {/* Ingredient Name Input with Autocomplete Dropdown */}
                            <div className="flex-1 relative">
                              <input
                                type="text"
                                required
                                disabled={!isEditorOrOwner}
                                placeholder="Type ingredient name (e.g. Bread Flour)"
                                value={ing.name}
                                onFocus={() => isEditorOrOwner && setActiveSuggestionIdx(idx)}
                                onBlur={() => setTimeout(() => setActiveSuggestionIdx(null), 200)}
                                onChange={(e) => {
                                  setActiveSuggestionIdx(idx);
                                  handleUpdateIngredient(idx, { name: e.target.value });
                                }}
                                className="w-full px-3 py-1.5 text-sm bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                              />

                              {/* Autocomplete Dropdown */}
                              {isEditorOrOwner && activeSuggestionIdx === idx && suggestions.length > 0 && (
                                <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl shadow-xl max-h-52 overflow-y-auto divide-y divide-[#EEECE8] dark:divide-[#332F2B]">
                                  {suggestions.map((s) => (
                                    <button
                                      key={s.id}
                                      type="button"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleUpdateIngredient(idx, {
                                          name: s.name,
                                          unit: defaultUnit,
                                          wastePercent: s.defaultWastePercent ?? ing.wastePercent ?? 0,
                                        });
                                        setActiveSuggestionIdx(null);
                                      }}
                                      className="w-full px-3 py-2 text-left text-xs hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition flex items-center justify-between cursor-pointer group"
                                    >
                                      <div className="flex flex-col gap-0.5 max-w-[70%]">
                                        <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1] group-hover:text-[#D4A373]">
                                          {s.name}
                                          {s.brand ? ` (${s.brand})` : ''}
                                        </span>
                                        {s.subIngredients && (
                                          <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] truncate italic">
                                            Contains: {s.subIngredients}
                                          </span>
                                        )}
                                        {s.allergens && (
                                          <span className="text-[10px] text-[#C97B63] dark:text-[#EAA89A] font-semibold truncate">
                                            ⚠️ {s.allergens}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-[#A39E93] font-mono flex items-center gap-2">
                                        <span className="text-[#D4A373] font-bold">unit: {defaultUnit} (preferred)</span>
                                        <span>waste: {s.defaultWastePercent ?? 0}%</span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Quantity */}
                            <div className="w-24 sm:w-24 flex-1 sm:flex-none">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                disabled={!isEditorOrOwner}
                                placeholder="Qty"
                                value={
                                  ing.quantity === '' ||
                                  ing.quantity === undefined ||
                                  ing.quantity === null ||
                                  isNaN(Number(ing.quantity))
                                    ? ''
                                    : ing.quantity
                                }
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleUpdateIngredient(idx, {
                                    quantity: val === '' ? ('' as any) : parseFloat(val),
                                  });
                                }}
                                className="w-full px-2 py-1.5 text-sm font-mono bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                              />
                            </div>

                            {/* Unit Selector - Smart dropdown prioritizing user setup preference */}
                            <div className="w-28 sm:w-32 flex-1 sm:flex-none">
                              <select
                                disabled={!isEditorOrOwner}
                                value={ing.unit || defaultUnit}
                                onChange={(e) => handleUnitChange(idx, e.target.value)}
                                className="w-full px-2 py-1.5 text-xs font-mono font-bold bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75 cursor-pointer"
                              >
                                <optgroup label="⭐ Setup Preference">
                                  <option value={defaultUnit}>
                                    {defaultUnit} ({getUnitLabel(defaultUnit)})
                                  </option>
                                </optgroup>
                                <optgroup label="Weight Units">
                                  {WEIGHT_UNITS.filter((u) => u.value !== defaultUnit).map((u) => (
                                    <option key={u.value} value={u.value}>
                                      {u.value} ({u.label})
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Volume & Discrete">
                                  <option value="cup">cup (Cups)</option>
                                  <option value="tbsp">tbsp (Tablespoons)</option>
                                  <option value="tsp">tsp (Teaspoons)</option>
                                  <option value="ml">ml (Milliliters)</option>
                                  <option value="l">l (Liters)</option>
                                  <option value="fl_oz">fl oz (Fluid Ounces)</option>
                                  <option value="pcs">pcs (Pieces)</option>
                                  <option value="eggs">eggs (Eggs)</option>
                                  <option value="units">units (Units)</option>
                                  <option value="doz">doz (Dozens)</option>
                                </optgroup>
                                {ing.unit && !['g', 'kg', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'fl_oz', 'pcs', 'eggs', 'units', 'doz'].includes(ing.unit) && (
                                  <optgroup label="Custom Unit">
                                    <option value={ing.unit}>{ing.unit}</option>
                                  </optgroup>
                                )}
                              </select>
                            </div>

                            {/* Delete Ingredient Button */}
                            {isEditorOrOwner && (
                              <button
                                type="button"
                                onClick={() => handleRemoveIngredient(idx)}
                                className="p-1.5 text-[#A39E93] hover:text-[#C97B63] rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                      {/* Optional Ingredient Notes / Waste */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 pl-6">
                        <input
                          type="text"
                          disabled={!isEditorOrOwner}
                          placeholder="Ingredient note (e.g., softened, fold in last)"
                          value={ing.notes || ''}
                          onChange={(e) => handleUpdateIngredient(idx, { notes: e.target.value })}
                          className="px-2 py-1 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none text-[#8B7E74] dark:text-[#D4CEC7] disabled:opacity-75"
                        />
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#A39E93] shrink-0">Waste %:</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            max="100"
                            disabled={!isEditorOrOwner}
                            placeholder="0"
                            value={ing.wastePercent ?? ''}
                            onChange={(e) =>
                              handleUpdateIngredient(idx, {
                                wastePercent: e.target.value !== '' ? parseFloat(e.target.value) : undefined,
                              })
                            }
                            className="w-full px-2 py-1 text-xs font-mono bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none text-[#8B7E74] dark:text-[#D4CEC7] disabled:opacity-75"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                  {/* Add Ingredient Button at bottom of list */}
                  {isEditorOrOwner && (
                    <button
                      type="button"
                      onClick={handleAddIngredient}
                      className="w-full py-2.5 px-4 bg-[#F5F2ED] dark:bg-[#25221F] hover:bg-[#EEECE8] dark:hover:bg-[#2E2A26] border border-dashed border-[#D4A373]/60 dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer mt-2"
                    >
                      <Plus className="w-4 h-4 text-[#D4A373]" />
                      <span>Add Another Ingredient</span>
                    </button>
                  )}
                </div>

                {/* Formula Total Weight Live Calculation at bottom of recipe modal */}
                {editingRecipe && editingRecipe.ingredients.length > 0 && (() => {
                  const modalRecipeTotal = calculateRecipeTotal(
                    editingRecipe,
                    modalTotalUnit,
                    settings?.decimalPlaces
                  );
                  return (
                    <div className="mt-4 p-4 bg-[#F5F2ED] dark:bg-[#25221F] rounded-xl border border-[#D4A373]/50 dark:border-[#332F2B] space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-[#D4A373]/20 rounded-lg text-[#D4A373]">
                            <Scale className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1.5">
                              <span>Recipe Total Calculation</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#D4A373] text-white rounded font-bold">
                                {modalRecipeTotal.formattedTargetUnit} {modalRecipeTotal.targetUnit}
                              </span>
                            </h4>
                            <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                              Live sum of all ingredients converted to your selected measuring unit
                            </p>
                          </div>
                        </div>

                        {/* Unit Selector Toggle */}
                        <div className="flex items-center gap-1.5 self-start sm:self-auto">
                          <span className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] font-semibold">
                            Unit:
                          </span>
                          <div className="flex items-center bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] p-0.5 rounded-lg shadow-2xs">
                            {(['g', 'lb', 'oz', 'kg'] as WeightUnit[]).map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => setModalTotalUnit(u)}
                                className={`px-2 py-1 text-xs font-mono font-bold rounded-md transition cursor-pointer ${
                                  modalTotalUnit === u
                                    ? 'bg-[#D4A373] text-white shadow-xs'
                                    : 'text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1]'
                                }`}
                              >
                                {u.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* 4-Unit Equivalence Breakdown Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#EEECE8] dark:border-[#332F2B]">
                        <div
                          onClick={() => setModalTotalUnit('g')}
                          className={`p-2.5 rounded-xl border transition cursor-pointer ${
                            modalTotalUnit === 'g'
                              ? 'bg-white dark:bg-[#1E1B18] border-[#D4A373] shadow-xs'
                              : 'bg-[#FAF9F6] dark:bg-[#1E1B18]/40 border-transparent hover:border-[#EEECE8]'
                          }`}
                        >
                          <div className="text-[10px] uppercase font-bold text-[#8B7E74] dark:text-[#A39E93]">
                            Grams (g)
                          </div>
                          <div className="text-sm font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                            {modalRecipeTotal.equivalents.g.formatted} g
                          </div>
                        </div>

                        <div
                          onClick={() => setModalTotalUnit('lb')}
                          className={`p-2.5 rounded-xl border transition cursor-pointer ${
                            modalTotalUnit === 'lb'
                              ? 'bg-white dark:bg-[#1E1B18] border-[#D4A373] shadow-xs'
                              : 'bg-[#FAF9F6] dark:bg-[#1E1B18]/40 border-transparent hover:border-[#EEECE8]'
                          }`}
                        >
                          <div className="text-[10px] uppercase font-bold text-[#8B7E74] dark:text-[#A39E93]">
                            Pounds (lb)
                          </div>
                          <div className="text-sm font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                            {modalRecipeTotal.equivalents.lb.formatted} lb
                          </div>
                        </div>

                        <div
                          onClick={() => setModalTotalUnit('oz')}
                          className={`p-2.5 rounded-xl border transition cursor-pointer ${
                            modalTotalUnit === 'oz'
                              ? 'bg-white dark:bg-[#1E1B18] border-[#D4A373] shadow-xs'
                              : 'bg-[#FAF9F6] dark:bg-[#1E1B18]/40 border-transparent hover:border-[#EEECE8]'
                          }`}
                        >
                          <div className="text-[10px] uppercase font-bold text-[#8B7E74] dark:text-[#A39E93]">
                            Ounces (oz)
                          </div>
                          <div className="text-sm font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                            {modalRecipeTotal.equivalents.oz.formatted} oz
                          </div>
                        </div>

                        <div
                          onClick={() => setModalTotalUnit('kg')}
                          className={`p-2.5 rounded-xl border transition cursor-pointer ${
                            modalTotalUnit === 'kg'
                              ? 'bg-white dark:bg-[#1E1B18] border-[#D4A373] shadow-xs'
                              : 'bg-[#FAF9F6] dark:bg-[#1E1B18]/40 border-transparent hover:border-[#EEECE8]'
                          }`}
                        >
                          <div className="text-[10px] uppercase font-bold text-[#8B7E74] dark:text-[#A39E93]">
                            Kilograms (kg)
                          </div>
                          <div className="text-sm font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                            {modalRecipeTotal.equivalents.kg.formatted} kg
                          </div>
                        </div>
                      </div>

                      {/* Yield per piece weight and discrete item summary */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-[#8B7E74] dark:text-[#A39E93] pt-1">
                        {modalRecipeTotal.perPieceWeight && (
                          <div className="flex items-center gap-1">
                            <span>Per {editingRecipe.batchYieldUnit || 'piece'}:</span>
                            <span className="font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                              ~{modalRecipeTotal.perPieceWeight.formatted} {modalRecipeTotal.perPieceWeight.unit} / {editingRecipe.batchYieldUnit || 'piece'}
                            </span>
                          </div>
                        )}

                        {modalRecipeTotal.discreteCount > 0 && (
                          <div className="italic text-[11px]">
                            <span>Non-weight ingredients: </span>
                            <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">
                              {modalRecipeTotal.discreteItems.map((d) => `${d.quantity} ${d.unit} ${d.name}`).join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#EEECE8] dark:border-[#332F2B]">
                {isEditorOrOwner ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingRecipe(null)}
                      className="px-4 py-2 text-xs font-bold text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-5 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm"
                    >
                      Save Recipe Formula
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingRecipe(null)}
                    className="bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-5 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm"
                  >
                    Close
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
