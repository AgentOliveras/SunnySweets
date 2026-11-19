import React, { useState, useMemo } from 'react';
import {
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
  Unlink,
  Plus,
  Search,
  Filter,
  Package,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Calculator,
  Eye,
  Check,
  X,
  Scale,
  Building2,
  Tag,
  ShieldCheck,
  AlertCircle,
  Clock,
  HelpCircle,
} from 'lucide-react';
import {
  Recipe,
  Ingredient,
  MasterIngredient,
  AccessRole,
  UserSettings,
  PurchasePackage,
  CostingDimension,
  WeightUnit,
} from '../types';
import { formatCleanNumeric } from '../utils/units';
import {
  analyzeWorkspaceCosting,
  findExactMatchSuggestions,
  linkExactMatchesForRecipe,
  linkSpecificIngredient,
  unlinkSpecificIngredient,
  RecipeCompletionDetail,
  ExactMatchSuggestion,
} from '../utils/costingCompletion';
import { normalizePurchasePackage } from '../utils/costing';
import { formatNumber } from '../utils/units';

interface CostingCompletionViewProps {
  recipes: Recipe[];
  masterIngredients: MasterIngredient[];
  settings?: UserSettings;
  userRole?: AccessRole;
  onSaveRecipe: (recipe: Recipe) => Promise<void> | void;
  onSaveMasterIngredient: (ingredient: MasterIngredient) => Promise<MasterIngredient | void> | void;
  onNavigateToPantry?: () => void;
  onNavigateToCalculator?: (recipeId: string) => void;
}

type FilterStatus = 'ALL' | 'NEEDS_ATTENTION' | 'FULLY_COSTED';

export const CostingCompletionView: React.FC<CostingCompletionViewProps> = ({
  recipes,
  masterIngredients,
  settings,
  userRole = 'owner',
  onSaveRecipe,
  onSaveMasterIngredient,
  onNavigateToPantry,
  onNavigateToCalculator,
}) => {
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';

  // Filters & State
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [expandedRecipeIds, setExpandedRecipeIds] = useState<Set<string>>(new Set());

  // Bulk Review Modal State
  const [showBulkReviewModal, setShowBulkReviewModal] = useState(false);
  const [selectedBulkMatchKeys, setSelectedBulkMatchKeys] = useState<Set<string>>(new Set());
  const [bulkActionFeedback, setBulkActionFeedback] = useState<string | null>(null);

  // Manual Link Picker Modal State
  const [linkingTarget, setLinkingTarget] = useState<{
    recipe: Recipe;
    ingredient: Ingredient;
  } | null>(null);
  const [pantrySearchQuery, setPantrySearchQuery] = useState('');

  // Quick Create Master Ingredient Modal State
  const [createMasterTarget, setCreateMasterTarget] = useState<{
    recipe: Recipe;
    ingredient: Ingredient;
  } | null>(null);
  const [newMasterName, setNewMasterName] = useState('');
  const [newMasterCategory, setNewMasterCategory] = useState('General');
  const [newMasterDimension, setNewMasterDimension] = useState<CostingDimension>('mass');
  const [newMasterPrice, setNewMasterPrice] = useState('');
  const [newMasterPackQtyStr, setNewMasterPackQtyStr] = useState('1');
  const [newMasterUnitSizeStr, setNewMasterUnitSizeStr] = useState('50');
  const [newMasterUnitMeasure, setNewMasterUnitMeasure] = useState('lb');
  const [newMasterDensity, setNewMasterDensity] = useState('');
  const [newMasterPieceWeight, setNewMasterPieceWeight] = useState('');

  // Quick Edit Package Cost Modal State (Edit Buffer Pattern)
  const [editingMasterCost, setEditingMasterCost] = useState<MasterIngredient | null>(null);
  const [pkgPriceInput, setPkgPriceInput] = useState('');
  const [packQtyInputStr, setPackQtyInputStr] = useState('1');
  const [unitSizeInputStr, setUnitSizeInputStr] = useState('50');
  const [unitMeasureInput, setUnitMeasureInput] = useState('lb');
  const [dimensionInput, setDimensionInput] = useState<CostingDimension>('mass');
  const [densityInput, setDensityInput] = useState('');
  const [pieceWeightInput, setPieceWeightInput] = useState('');
  const [pkgSaveFeedback, setPkgSaveFeedback] = useState<string | null>(null);

  // Derived Analytics
  const { stats, recipeDetails } = useMemo(
    () => analyzeWorkspaceCosting(recipes, masterIngredients),
    [recipes, masterIngredients]
  );

  const exactMatches = useMemo(
    () => findExactMatchSuggestions(recipes, masterIngredients),
    [recipes, masterIngredients]
  );

  // Categories present in recipes
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    recipes.forEach((r) => {
      if (r.category && r.category.trim()) cats.add(r.category.trim());
    });
    return Array.from(cats);
  }, [recipes]);

  // Filtered recipes
  const filteredRecipeDetails = useMemo(() => {
    return recipeDetails.filter((item) => {
      // Status filter
      if (filterStatus === 'FULLY_COSTED' && item.status !== 'FULLY_COSTED') return false;
      if (filterStatus === 'NEEDS_ATTENTION' && item.status !== 'NEEDS_ATTENTION') return false;

      // Category filter
      if (selectedCategory !== 'ALL' && (item.recipe.category || 'Uncategorized') !== selectedCategory) {
        return false;
      }

      // Search filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesName = item.recipe.name.toLowerCase().includes(q);
        const matchesCategory = (item.recipe.category || '').toLowerCase().includes(q);
        const matchesIngredient = item.recipe.ingredients.some((ing) =>
          ing.name.toLowerCase().includes(q)
        );
        if (!matchesName && !matchesCategory && !matchesIngredient) return false;
      }

      return true;
    });
  }, [recipeDetails, filterStatus, selectedCategory, searchTerm]);

  // Master Ingredient Map for fast lookup
  const masterMap = useMemo(() => {
    return new Map(masterIngredients.map((m) => [m.id, m]));
  }, [masterIngredients]);

  // Toggle Recipe Expansion
  const toggleRecipeExpansion = (id: string) => {
    setExpandedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedRecipeIds(new Set(filteredRecipeDetails.map((r) => r.recipe.id)));
  };

  const collapseAll = () => {
    setExpandedRecipeIds(new Set());
  };

  // --- Manual Linking Handler ---
  const handleSelectMasterForLinking = async (selectedMasterId: string) => {
    if (!linkingTarget || !isEditorOrOwner) return;
    const { recipe, ingredient } = linkingTarget;

    const updated = linkSpecificIngredient(recipe, ingredient.id, selectedMasterId);
    await onSaveRecipe(updated);
    setLinkingTarget(null);
    setPantrySearchQuery('');
  };

  // --- Unlink Handler ---
  const handleUnlink = async (recipe: Recipe, ingredientId: string) => {
    if (!isEditorOrOwner) return;
    const updated = unlinkSpecificIngredient(recipe, ingredientId);
    await onSaveRecipe(updated);
  };

  // --- Quick One-Click Exact Match Link for a Single Line ---
  const handleQuickLinkExactMatch = async (
    recipe: Recipe,
    ingredientId: string,
    matchedMasterId: string
  ) => {
    if (!isEditorOrOwner) return;
    const updated = linkSpecificIngredient(recipe, ingredientId, matchedMasterId);
    await onSaveRecipe(updated);
  };

  // --- Open Quick Create Master Ingredient Modal ---
  const handleOpenCreateMaster = (recipe: Recipe, ingredient: Ingredient) => {
    setCreateMasterTarget({ recipe, ingredient });
    setNewMasterName(ingredient.name.trim());
    setNewMasterCategory(recipe.category?.trim() || 'General');

    const cleanUnit = (ingredient.unit || '').toLowerCase();
    if (['gal', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'fl_oz'].includes(cleanUnit)) {
      setNewMasterDimension('volume');
      setNewMasterUnitMeasure(cleanUnit === 'gal' ? 'gal' : 'l');
    } else if (['each', 'pcs', 'egg', 'doz'].includes(cleanUnit)) {
      setNewMasterDimension('discrete');
      setNewMasterUnitMeasure(cleanUnit);
    } else {
      setNewMasterDimension('mass');
      setNewMasterUnitMeasure(cleanUnit === 'kg' ? 'kg' : cleanUnit === 'oz' ? 'oz' : 'lb');
    }

    setNewMasterPrice('');
    setNewMasterPackQtyStr('1');
    setNewMasterUnitSizeStr('50');
    setNewMasterDensity(ingredient.densityGramsPerMl ? formatCleanNumeric(ingredient.densityGramsPerMl) : '');
    setNewMasterPieceWeight('');
  };

  // --- Submit Quick Create Master Ingredient ---
  const handleCreateAndLinkMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createMasterTarget || !isEditorOrOwner) return;
    const { recipe, ingredient } = createMasterTarget;

    if (!newMasterName.trim()) {
      alert('Ingredient name is required.');
      return;
    }

    const newMasterId = `mi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const densityVal = newMasterDensity !== '' && !isNaN(parseFloat(newMasterDensity))
      ? parseFloat(newMasterDensity)
      : undefined;
    const pieceWeightVal = newMasterPieceWeight !== '' && !isNaN(parseFloat(newMasterPieceWeight))
      ? parseFloat(newMasterPieceWeight)
      : undefined;

    let prefPkg: PurchasePackage | undefined = undefined;
    let costPerGram: number | undefined = undefined;
    let costPerEach: number | undefined = undefined;

    if (newMasterPrice.trim() !== '') {
      const priceNum = parseFloat(newMasterPrice);
      if (!isNaN(priceNum) && priceNum >= 0) {
        const pQty = parseInt(newMasterPackQtyStr, 10);
        const uSize = parseFloat(newMasterUnitSizeStr);
        prefPkg = {
          packQuantity: !isNaN(pQty) && pQty >= 1 ? pQty : 1,
          unitSize: !isNaN(uSize) && uSize > 0 ? uSize : 50,
          unitMeasure: newMasterUnitMeasure,
          packagePriceCents: Math.round(priceNum * 100),
          effectiveDate: new Date().toISOString().split('T')[0],
        };

        const norm = normalizePurchasePackage(
          prefPkg,
          newMasterDimension,
          densityVal,
          pieceWeightVal
        );
        costPerGram = norm.costPerGram;
        costPerEach = norm.costPerEach;
      }
    }

    const newMaster: MasterIngredient = {
      id: newMasterId,
      workspaceId: recipe.workspaceId,
      name: newMasterName.trim(),
      category: newMasterCategory.trim() || 'General',
      defaultUnit: ingredient.unit || 'g',
      defaultWastePercent: ingredient.wastePercent ?? 0,
      dimension: newMasterDimension,
      preferredPurchasePackage: prefPkg,
      costPerGram,
      costPerEach,
      densityGramsPerMl: densityVal,
      pieceWeightGrams: pieceWeightVal,
      costUpdatedAt: prefPkg ? new Date().toISOString() : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 2,
    };

    await onSaveMasterIngredient(newMaster);

    // Link into recipe while preserving all snapshot values
    const updatedRecipe = linkSpecificIngredient(recipe, ingredient.id, newMasterId);
    await onSaveRecipe(updatedRecipe);

    setCreateMasterTarget(null);
  };

  // --- Open Quick Edit Package Cost Modal ---
  const handleOpenEditPackageCost = (master: MasterIngredient) => {
    setEditingMasterCost(master);
    setPkgSaveFeedback(null);
    setDimensionInput(master.dimension || 'mass');
    if (master.preferredPurchasePackage) {
      const pkg = master.preferredPurchasePackage;
      setPkgPriceInput(
        pkg.packagePriceCents !== undefined ? (pkg.packagePriceCents / 100).toFixed(2) : ''
      );
      setPackQtyInputStr(
        pkg.packQuantity !== undefined ? formatCleanNumeric(pkg.packQuantity) : '1'
      );
      setUnitSizeInputStr(
        pkg.unitSize !== undefined ? formatCleanNumeric(pkg.unitSize) : '1'
      );
      setUnitMeasureInput(pkg.unitMeasure || master.netWeightUnit || 'lb');
    } else {
      setPkgPriceInput('');
      setPackQtyInputStr('1');
      setUnitSizeInputStr(master.netWeight ? formatCleanNumeric(Number(master.netWeight)) : '50');
      setUnitMeasureInput(master.netWeightUnit || 'lb');
    }
    setDensityInput(master.densityGramsPerMl !== undefined ? formatCleanNumeric(master.densityGramsPerMl) : '');
    setPieceWeightInput(master.pieceWeightGrams !== undefined ? formatCleanNumeric(master.pieceWeightGrams) : '');
  };

  // --- Save Quick Package Cost ---
  const handleSavePackageCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMasterCost || !isEditorOrOwner) return;

    if (pkgPriceInput.trim() === '') {
      alert('Please enter a package price ($0.00 is permitted for water or free items).');
      return;
    }

    const priceNum = parseFloat(pkgPriceInput);
    if (isNaN(priceNum) || priceNum < 0) {
      alert('Package price must be a valid non-negative number.');
      return;
    }

    const pQty = parseInt(packQtyInputStr, 10);
    if (isNaN(pQty) || pQty <= 0) {
      alert('Pack quantity must be at least 1.');
      return;
    }

    const uSize = parseFloat(unitSizeInputStr);
    if (isNaN(uSize) || uSize <= 0) {
      alert('Unit size must be a valid number greater than 0.');
      return;
    }

    const densityVal = densityInput !== '' && !isNaN(parseFloat(densityInput))
      ? parseFloat(densityInput)
      : undefined;
    const pieceWeightVal = pieceWeightInput !== '' && !isNaN(parseFloat(pieceWeightInput))
      ? parseFloat(pieceWeightInput)
      : undefined;

    const prefPkg: PurchasePackage = {
      packQuantity: pQty,
      unitSize: uSize,
      unitMeasure: unitMeasureInput,
      packagePriceCents: Math.round(priceNum * 100),
      supplierName: editingMasterCost.supplier?.trim() || undefined,
      supplierItemCode: editingMasterCost.preferredPurchasePackage?.supplierItemCode || undefined,
      effectiveDate: new Date().toISOString().split('T')[0],
    };

    const norm = normalizePurchasePackage(
      prefPkg,
      dimensionInput,
      densityVal,
      pieceWeightVal
    );

    if (norm.error) {
      setPkgSaveFeedback(`Error: ${norm.error}`);
      return;
    }

    const updatedMaster: MasterIngredient = {
      ...editingMasterCost,
      preferredPurchasePackage: prefPkg,
      dimension: dimensionInput,
      densityGramsPerMl: densityVal,
      pieceWeightGrams: pieceWeightVal,
      costPerGram: norm.costPerGram,
      costPerEach: norm.costPerEach,
      costUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 2,
    };

    await onSaveMasterIngredient(updatedMaster);
    setEditingMasterCost(null);
  };

  // --- Bulk Match Review & Link All Handler ---
  const handleOpenBulkReview = () => {
    // Select all available exact matches by default
    const allKeys = new Set(exactMatches.map((m) => `${m.recipeId}::${m.ingredientId}`));
    setSelectedBulkMatchKeys(allKeys);
    setBulkActionFeedback(null);
    setShowBulkReviewModal(true);
  };

  const handleApplyBulkLinks = async () => {
    if (!isEditorOrOwner) return;
    const selectedMatches = exactMatches.filter((m) =>
      selectedBulkMatchKeys.has(`${m.recipeId}::${m.ingredientId}`)
    );

    if (selectedMatches.length === 0) {
      alert('Please select at least one exact match to link.');
      return;
    }

    // Group selected matches by recipeId
    const matchesByRecipe = new Map<string, ExactMatchSuggestion[]>();
    for (const match of selectedMatches) {
      const list = matchesByRecipe.get(match.recipeId) || [];
      list.push(match);
      matchesByRecipe.set(match.recipeId, list);
    }

    let totalLinked = 0;
    let recipesUpdated = 0;

    for (const [recipeId, matches] of matchesByRecipe.entries()) {
      const recipe = recipes.find((r) => r.id === recipeId);
      if (!recipe) continue;

      let currentRecipe = recipe;
      for (const m of matches) {
        currentRecipe = linkSpecificIngredient(currentRecipe, m.ingredientId, m.matchedMasterId);
        totalLinked++;
      }

      await onSaveRecipe(currentRecipe);
      recipesUpdated++;
    }

    setBulkActionFeedback(
      `Linked ${totalLinked} ${totalLinked === 1 ? 'ingredient' : 'ingredients'} across ${recipesUpdated} ${recipesUpdated === 1 ? 'recipe' : 'recipes'}.`
    );
    setShowBulkReviewModal(false);
  };

  return (
    <div className="space-y-6 pb-24 md:pb-12" id="costing-completion-center">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl p-6 md:p-8 shadow-xs relative overflow-hidden">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] px-3 py-1 rounded-full text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-3">
            <DollarSign className="w-3.5 h-3.5 text-[#D4A373]" />
            <span>Recipe Cost Completion Center</span>
            <span>•</span>
            <span className="text-[#5A534B] dark:text-[#EAE6E1] font-bold">Phase 2.0C</span>
          </div>

          <h2 className="text-2xl md:text-3xl font-serif text-[#5A534B] dark:text-[#EAE6E1] mb-2 leading-tight">
            Ingredient Linking & Cost Setup
          </h2>
          <p className="text-[#8B7E74] dark:text-[#A39E93] text-sm md:text-base leading-relaxed mb-4">
            Review your recipe library to resolve unlinked ingredients and missing package costs.
            Linking ingredients enables automatic batch cost estimates across the Recipe Manager and Production Calculator.
          </p>

          {!isEditorOrOwner && (
            <div className="inline-flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 px-3 py-1.5 rounded-xl font-medium">
              <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>You have View-Only access to this workspace. Ingredient links and costs can be modified by editors and owners.</span>
            </div>
          )}

          {bulkActionFeedback && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 px-3.5 py-2 rounded-xl">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{bulkActionFeedback}</span>
              </div>
              <button
                onClick={() => setBulkActionFeedback(null)}
                className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Top-Level Metrics Dashboard */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        {/* Total Recipes */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A39E93]">Total Recipes</span>
            <Layers className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
            {stats.totalRecipes}
          </div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">Active formulas</p>
        </div>

        {/* Fully Costed */}
        <div
          onClick={() => setFilterStatus('FULLY_COSTED')}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-xs cursor-pointer hover:border-emerald-500/50 transition"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A39E93]">Fully Costed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
            {stats.fullyCostedCount}
          </div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">100% complete costs</p>
        </div>

        {/* Need Attention */}
        <div
          onClick={() => setFilterStatus('NEEDS_ATTENTION')}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-xs cursor-pointer hover:border-amber-500/50 transition"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A39E93]">Need Attention</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-400">
            {stats.incompleteCount}
          </div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">Unlinked or missing data</p>
        </div>

        {/* Coverage % */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A39E93]">Cost Coverage</span>
            <Calculator className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
            {stats.coveragePercent}%
          </div>
          <div className="w-full bg-[#EEECE8] dark:bg-[#2D2925] h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                stats.coveragePercent === 100
                  ? 'bg-emerald-600'
                  : stats.coveragePercent > 50
                  ? 'bg-[#D4A373]'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${stats.coveragePercent}%` }}
            />
          </div>
        </div>

        {/* Master Pantry Stats */}
        <div className="col-span-2 lg:col-span-1 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A39E93]">Pantry Items</span>
            <Package className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
            {stats.totalMasterIngredients}
          </div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
            {stats.masterIngredientsWithPricing} with pricing • {stats.masterIngredientsMissingPricing} missing
          </p>
        </div>
      </div>

      {/* Bulk Review Callout Banner (if exact matches exist) */}
      {stats.exactMatchesAvailable > 0 && (
        <div
          id="exact-match-banner"
          className="bg-gradient-to-r from-[#F5F2ED] to-[#EAE6E1] dark:from-[#25221F] dark:to-[#1E1B18] border border-[#D4A373]/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs"
        >
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#D4A373] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#5A534B] dark:text-[#EAE6E1] text-sm sm:text-base">
                {stats.exactMatchesAvailable} {stats.exactMatchesAvailable === 1 ? 'Exact Pantry Match Found' : 'Exact Pantry Matches Found'}
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                Unlinked recipe ingredient lines match pantry items by name. Review and link them in one safe step.
              </p>
            </div>
          </div>

          {isEditorOrOwner && (
            <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto justify-end">
              <button
                id="bulk-review-matches-btn"
                onClick={handleOpenBulkReview}
                className="bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Review & Link Exact Matches</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filter and Control Bar */}
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Status Pills */}
          <div className="flex items-center gap-1 bg-[#F5F2ED] dark:bg-[#25221F] p-1 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] overflow-x-auto">
            <button
              onClick={() => setFilterStatus('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                filterStatus === 'ALL'
                  ? 'bg-[#5A534B] text-white dark:bg-[#3D3732] shadow-xs'
                  : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
              }`}
            >
              All Recipes ({recipeDetails.length})
            </button>
            <button
              onClick={() => setFilterStatus('NEEDS_ATTENTION')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterStatus === 'NEEDS_ATTENTION'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Needs Attention ({stats.incompleteCount})</span>
            </button>
            <button
              onClick={() => setFilterStatus('FULLY_COSTED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterStatus === 'FULLY_COSTED'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Fully Costed ({stats.fullyCostedCount})</span>
            </button>
          </div>

          {/* Quick Expand / Collapse */}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={expandAll}
              className="text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] px-2 py-1 rounded-lg hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
            >
              Expand All
            </button>
            <span className="text-[#E5E1DA] dark:text-[#332F2B]">•</span>
            <button
              onClick={collapseAll}
              className="text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] px-2 py-1 rounded-lg hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Search & Category Row */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1 border-t border-[#EEECE8] dark:border-[#2D2925]">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-[#A39E93] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filter by recipe or ingredient name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Recipe List */}
      <div className="space-y-4">
        {filteredRecipeDetails.map((detail) => {
          const { recipe, summary, status } = detail;
          const isExpanded = expandedRecipeIds.has(recipe.id);
          const isFullyCosted = status === 'FULLY_COSTED';

          return (
            <div
              key={recipe.id}
              id={`costing-recipe-card-${recipe.id}`}
              className={`bg-white dark:bg-[#1E1B18] border rounded-2xl transition-all shadow-xs overflow-hidden ${
                isFullyCosted
                  ? 'border-[#E5E1DA] dark:border-[#2D2925]'
                  : 'border-amber-200 dark:border-amber-900/40 bg-amber-500/[0.01]'
              }`}
            >
              {/* Card Header Row */}
              <div
                onClick={() => toggleRecipeExpansion(recipe.id)}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none hover:bg-[#FAF9F7] dark:hover:bg-[#221F1C] transition"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold shrink-0 mt-0.5 ${
                      isFullyCosted
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                    }`}
                  >
                    {isFullyCosted ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5" />
                    )}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                        {recipe.name}
                      </h3>
                      {recipe.category && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#D4CEC7] border border-[#EEECE8] dark:border-[#332F2B]">
                          {recipe.category}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
                      <span>
                        Yield: {recipe.batchYieldQuantity} {recipe.batchYieldUnit}
                      </span>
                      <span>•</span>
                      <span>
                        {detail.costedIngredients} of {detail.totalIngredients} ingredients costed
                      </span>
                      {detail.unlinkedCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">
                            {detail.unlinkedCount} unlinked
                          </span>
                        </>
                      )}
                      {detail.exactMatchCount > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-[#D4A373] font-bold flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            {detail.exactMatchCount} exact {detail.exactMatchCount === 1 ? 'match' : 'matches'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Summary & Toggle */}
                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#EEECE8] dark:border-[#2D2925]">
                  <div className="text-right">
                    <div className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                      {isFullyCosted ? 'Formula Cost' : 'Partial Cost'}
                    </div>
                    <div className="font-mono font-bold text-sm sm:text-base text-[#5A534B] dark:text-[#EAE6E1]">
                      ${summary.totalIngredientCost.toFixed(2)}
                      {isFullyCosted && summary.costPerYieldUnit !== undefined && (
                        <span className="text-[11px] font-normal text-[#8B7E74] dark:text-[#A39E93] ml-1">
                          (${summary.costPerYieldUnit.toFixed(2)} / {summary.yieldUnit || 'unit'})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-1.5 rounded-lg bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74]">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </div>

              {/* Expanded Ingredient Breakdown Table */}
              {isExpanded && (
                <div className="border-t border-[#EEECE8] dark:border-[#2D2925] bg-[#FDFCFB] dark:bg-[#1A1715] p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#8B7E74] dark:text-[#A39E93]">
                      Formula Ingredients Breakdown
                    </h4>
                    {onNavigateToCalculator && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToCalculator(recipe.id);
                        }}
                        className="text-xs text-[#D4A373] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Calculator className="w-3.5 h-3.5" />
                        <span>Open in Calculator</span>
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-[#EEECE8] dark:border-[#2D2925] bg-white dark:bg-[#1E1B18]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] border-b border-[#EEECE8] dark:border-[#332F2B]">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">Ingredient Line</th>
                          <th className="py-2.5 px-3 font-semibold">Formula Qty</th>
                          <th className="py-2.5 px-3 font-semibold">Linked Pantry Item</th>
                          <th className="py-2.5 px-3 font-semibold">Status / Unit Cost</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Line Cost</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEECE8] dark:divide-[#2D2925]">
                        {recipe.ingredients.map((ing) => {
                          const linkedMaster = ing.masterIngredientId
                            ? masterMap.get(ing.masterIngredientId)
                            : undefined;
                          const lineCost = summary.ingredientCosts.find(
                            (c) => c.ingredientId === ing.id
                          );

                          // Check if an exact match exists in pantry
                          const cleanName = (ing.name || '').trim().toLowerCase();
                          const exactPantryMatch = masterIngredients.find(
                            (m) => m.name.trim().toLowerCase() === cleanName
                          );

                          return (
                            <tr
                              key={ing.id}
                              className="hover:bg-[#F9F8F6] dark:hover:bg-[#25221F]/50 transition"
                            >
                              {/* Line Name */}
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                                  {ing.name}
                                </div>
                                {ing.notes && (
                                  <div className="text-[10px] text-[#A39E93] italic">
                                    {ing.notes}
                                  </div>
                                )}
                              </td>

                              {/* Formula Qty */}
                              <td className="py-2.5 px-3 font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                                {ing.quantity} {ing.unit}
                                {ing.wastePercent ? (
                                  <span className="text-[10px] text-[#A39E93] block">
                                    +{ing.wastePercent}% waste
                                  </span>
                                ) : null}
                              </td>

                              {/* Linked Pantry Item */}
                              <td className="py-2.5 px-3">
                                {linkedMaster ? (
                                  <div className="flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5 text-[#D4A373] shrink-0" />
                                    <div>
                                      <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1] block leading-tight">
                                        {linkedMaster.name}
                                      </span>
                                      {linkedMaster.category && (
                                        <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                                          {linkedMaster.category}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ) : ing.masterIngredientId ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded">
                                    <AlertCircle className="w-3 h-3" />
                                    Missing Master ({ing.masterIngredientId})
                                  </span>
                                ) : (
                                  <span className="text-[#A39E93] italic text-xs">
                                    Not linked
                                  </span>
                                )}
                              </td>

                              {/* Status / Unit Cost */}
                              <td className="py-2.5 px-3">
                                {lineCost?.isComplete ? (
                                  <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>
                                      {lineCost.unitCostUsed !== undefined
                                        ? lineCost.unitCostUsed < 0.01
                                          ? `$${lineCost.unitCostUsed.toFixed(6)} / g`
                                          : `$${lineCost.unitCostUsed.toFixed(4)} / g`
                                        : 'Cost complete'}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-800/60">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {!ing.masterIngredientId
                                        ? 'Unlinked line'
                                        : lineCost?.reason === 'NO_PURCHASE_PRICE'
                                        ? 'Missing purchase price'
                                        : lineCost?.reason === 'MISSING_DENSITY'
                                        ? 'Missing density (g/ml)'
                                        : lineCost?.reason === 'MISSING_PIECE_WEIGHT'
                                        ? 'Missing piece weight (g)'
                                        : lineCost?.reason === 'MASTER_INGREDIENT_NOT_FOUND'
                                        ? 'Pantry record missing'
                                        : 'Incomplete cost'}
                                    </span>
                                  </div>
                                )}
                              </td>

                              {/* Calculated Line Cost */}
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                                {lineCost?.isComplete ? (
                                  `$${lineCost.cost.toFixed(2)}`
                                ) : (
                                  <span className="text-[#A39E93] font-normal">—</span>
                                )}
                              </td>

                              {/* Action Buttons */}
                              <td className="py-2.5 px-3 text-right">
                                {isEditorOrOwner ? (
                                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                    {/* If unlinked and exact match exists: One-Click Quick Link */}
                                    {!ing.masterIngredientId && exactPantryMatch && (
                                      <button
                                        onClick={() =>
                                          handleQuickLinkExactMatch(recipe, ing.id, exactPantryMatch.id)
                                        }
                                        className="inline-flex items-center gap-1 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-2 py-1 rounded text-[11px] transition cursor-pointer shadow-2xs"
                                        title={`Link to existing pantry item: ${exactPantryMatch.name}`}
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        <span>Link to "{exactPantryMatch.name}"</span>
                                      </button>
                                    )}

                                    {/* Manual Link button */}
                                    {!ing.masterIngredientId ? (
                                      <>
                                        <button
                                          onClick={() => setLinkingTarget({ recipe, ingredient: ing })}
                                          className="inline-flex items-center gap-1 bg-[#F5F2ED] dark:bg-[#25221F] hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] font-semibold px-2 py-1 rounded text-[11px] border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer"
                                        >
                                          <LinkIcon className="w-3 h-3 text-[#D4A373]" />
                                          <span>Choose Pantry Item</span>
                                        </button>

                                        <button
                                          onClick={() => handleOpenCreateMaster(recipe, ing)}
                                          className="inline-flex items-center gap-1 bg-white dark:bg-[#1E1B18] hover:bg-[#F5F2ED] text-[#5A534B] dark:text-[#EAE6E1] font-semibold px-2 py-1 rounded text-[11px] border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer"
                                        >
                                          <Plus className="w-3 h-3 text-emerald-600" />
                                          <span>New Pantry Item</span>
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        {/* If linked: Edit Package Cost */}
                                        {linkedMaster && (
                                          <button
                                            onClick={() => handleOpenEditPackageCost(linkedMaster)}
                                            className="inline-flex items-center gap-1 bg-[#F5F2ED] dark:bg-[#25221F] hover:bg-[#EEECE8] text-[#5A534B] dark:text-[#EAE6E1] font-medium px-2 py-1 rounded text-[11px] border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer"
                                            title="Edit package price and sizing"
                                          >
                                            <DollarSign className="w-3 h-3 text-[#D4A373]" />
                                            <span>
                                              {linkedMaster.preferredPurchasePackage
                                                ? 'Edit Package'
                                                : 'Add Package Price'}
                                            </span>
                                          </button>
                                        )}

                                        {/* Unlink */}
                                        <button
                                          onClick={() => handleUnlink(recipe, ing.id)}
                                          className="p-1 text-[#8B7E74] hover:text-red-600 rounded transition cursor-pointer"
                                          title="Unlink from pantry"
                                        >
                                          <Unlink className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-[#A39E93] italic">
                                    View only
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredRecipeDetails.length === 0 && (
          <div className="py-12 text-center text-[#A39E93] bg-white dark:bg-[#1E1B18] rounded-2xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] p-8">
            <Package className="w-8 h-8 text-[#A39E93] mx-auto mb-2 opacity-50" />
            <p className="font-semibold text-sm">No recipes match the selected filters.</p>
            <button
              onClick={() => {
                setFilterStatus('ALL');
                setSearchTerm('');
                setSelectedCategory('ALL');
              }}
              className="text-[#D4A373] text-xs font-bold underline mt-2 cursor-pointer"
            >
              Reset filters
            </button>
          </div>
        )}
      </div>

      {/* MODAL 1: Bulk Exact Match Review Modal */}
      {showBulkReviewModal && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#D4A373]" />
                <h3 className="font-serif font-bold text-base sm:text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                  Review & Link Exact Pantry Matches
                </h3>
              </div>
              <button
                onClick={() => setShowBulkReviewModal(false)}
                className="p-1 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                The following unlinked recipe ingredients have an exact (case-insensitive) name match
                to an existing item in your Master Pantry.
                All recipe line IDs, quantities, units, and notes will be preserved.
              </p>

              <div className="flex items-center justify-between text-xs font-semibold px-1">
                <span>{selectedBulkMatchKeys.size} of {exactMatches.length} matches selected</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setSelectedBulkMatchKeys(
                        new Set(exactMatches.map((m) => `${m.recipeId}::${m.ingredientId}`))
                      )
                    }
                    className="text-[#D4A373] hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span>•</span>
                  <button
                    onClick={() => setSelectedBulkMatchKeys(new Set())}
                    className="text-[#8B7E74] hover:underline cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="divide-y divide-[#EEECE8] dark:divide-[#2D2925] border border-[#EEECE8] dark:border-[#2D2925] rounded-xl overflow-hidden bg-[#F9F8F6] dark:bg-[#25221F]">
                {exactMatches.map((match) => {
                  const key = `${match.recipeId}::${match.ingredientId}`;
                  const isChecked = selectedBulkMatchKeys.has(key);

                  return (
                    <label
                      key={key}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-white dark:hover:bg-[#1E1B18] transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            setSelectedBulkMatchKeys((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                          className="rounded text-[#D4A373] focus:ring-[#D4A373] cursor-pointer"
                        />
                        <div>
                          <div className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                            {match.ingredientName}
                          </div>
                          <div className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                            Recipe: {match.recipeName}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="flex items-center gap-1 justify-end font-semibold text-xs text-[#D4A373]">
                          <Package className="w-3 h-3" />
                          <span>{match.matchedMasterName}</span>
                        </div>
                        <div className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                          {match.matchedMasterHasPricing ? '✓ Has package pricing' : '⚠ Missing pricing'}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-[#EEECE8] dark:border-[#332F2B] bg-[#FAF9F7] dark:bg-[#221F1C] flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowBulkReviewModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#8B7E74] hover:text-[#5A534B] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyBulkLinks}
                disabled={!isEditorOrOwner || selectedBulkMatchKeys.size === 0}
                className="bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Link Selected ({selectedBulkMatchKeys.size})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Manual Link Picker Modal */}
      {linkingTarget && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Link "{linkingTarget.ingredient.name}"
                </h3>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  Recipe: {linkingTarget.recipe.name}
                </p>
              </div>
              <button
                onClick={() => setLinkingTarget(null)}
                className="p-1 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-b border-[#EEECE8] dark:border-[#332F2B] bg-[#FAF9F7] dark:bg-[#221F1C]">
              <div className="relative">
                <Search className="w-4 h-4 text-[#A39E93] absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search pantry ingredients..."
                  value={pantrySearchQuery}
                  onChange={(e) => setPantrySearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 max-h-[60vh]">
              {masterIngredients
                .filter((m) => {
                  if (!pantrySearchQuery.trim()) return true;
                  const q = pantrySearchQuery.toLowerCase();
                  return (
                    m.name.toLowerCase().includes(q) ||
                    (m.category || '').toLowerCase().includes(q)
                  );
                })
                .map((m) => {
                  const hasPricing =
                    m.costPerGram !== undefined ||
                    m.costPerEach !== undefined ||
                    !!m.preferredPurchasePackage;

                  return (
                    <div
                      key={m.id}
                      onClick={() => handleSelectMasterForLinking(m.id)}
                      className="p-3 bg-[#F9F8F6] dark:bg-[#25221F] hover:bg-[#F5F2ED] dark:hover:bg-[#2D2925] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl flex items-center justify-between gap-3 cursor-pointer transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <Package className="w-4 h-4 text-[#D4A373] shrink-0" />
                        <div>
                          <div className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                            {m.name}
                          </div>
                          <div className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                            {m.category || 'General'}
                            {m.brand ? ` • ${m.brand}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            hasPricing
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                          }`}
                        >
                          {hasPricing ? 'Cost configured' : 'No price'}
                        </span>
                      </div>
                    </div>
                  );
                })}

              {masterIngredients.length === 0 && (
                <div className="py-8 text-center text-xs text-[#A39E93]">
                  No master ingredients found in pantry.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => {
                  const t = linkingTarget;
                  setLinkingTarget(null);
                  if (t) handleOpenCreateMaster(t.recipe, t.ingredient);
                }}
                className="text-xs text-[#D4A373] font-bold hover:underline cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create new pantry item instead</span>
              </button>

              <button
                type="button"
                onClick={() => setLinkingTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-[#8B7E74] hover:text-[#5A534B] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Quick Create Master Ingredient & Link */}
      {createMasterTarget && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Create Pantry Item & Link Line
                </h3>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  For line: "{createMasterTarget.ingredient.name}" in {createMasterTarget.recipe.name}
                </p>
              </div>
              <button
                onClick={() => setCreateMasterTarget(null)}
                className="p-1 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAndLinkMaster} className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Pantry Ingredient Name *
                </label>
                <input
                  type="text"
                  required
                  value={newMasterName}
                  onChange={(e) => setNewMasterName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={newMasterCategory}
                    onChange={(e) => setNewMasterCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Dimension
                  </label>
                  <select
                    value={newMasterDimension}
                    onChange={(e) => setNewMasterDimension(e.target.value as CostingDimension)}
                    className="w-full px-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer"
                  >
                    <option value="mass">Mass (Weight)</option>
                    <option value="volume">Volume (Liquid)</option>
                    <option value="discrete">Discrete (Count)</option>
                  </select>
                </div>
              </div>

              {/* Package Purchasing Specs */}
              <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3.5 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A534B] dark:text-[#EAE6E1] block">
                  Package Pricing (Optional)
                </span>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                      Pack Qty
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newMasterPackQtyStr}
                      onChange={(e) => setNewMasterPackQtyStr(e.target.value)}
                      onBlur={() => {
                        if (newMasterPackQtyStr.trim() !== '') {
                          const val = parseInt(newMasterPackQtyStr, 10);
                          if (!isNaN(val) && val >= 1) {
                            setNewMasterPackQtyStr(String(val));
                          }
                        }
                      }}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                      Unit Size
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newMasterUnitSizeStr}
                      onChange={(e) => setNewMasterUnitSizeStr(e.target.value)}
                      onBlur={() => {
                        if (newMasterUnitSizeStr.trim() !== '') {
                          const val = parseFloat(newMasterUnitSizeStr);
                          if (!isNaN(val) && val > 0) {
                            setNewMasterUnitSizeStr(formatCleanNumeric(val));
                          }
                        }
                      }}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                      Unit
                    </label>
                    <input
                      type="text"
                      value={newMasterUnitMeasure}
                      onChange={(e) => setNewMasterUnitMeasure(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                    Package Price ($)
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1.5 text-xs text-[#8B7E74]">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 24.50"
                      value={newMasterPrice}
                      onChange={(e) => setNewMasterPrice(e.target.value)}
                      className="w-full pl-6 pr-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] font-mono font-bold"
                    />
                  </div>
                </div>

                {newMasterDimension === 'volume' && (
                  <div>
                    <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                      Density (g/ml) *Required for volume
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      placeholder="e.g. 1.05 for milk, 0.92 for oil"
                      value={newMasterDensity}
                      onChange={(e) => setNewMasterDensity(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>
                )}

                {newMasterDimension === 'discrete' && (
                  <div>
                    <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                      Piece Weight (g)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      placeholder="e.g. 50 (grams per egg)"
                      value={newMasterPieceWeight}
                      onChange={(e) => setNewMasterPieceWeight(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCreateMasterTarget(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7E74] hover:text-[#5A534B] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isEditorOrOwner}
                  className="bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Create & Link</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Quick Edit Package Pricing Modal */}
      {editingMasterCost && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Package Pricing for "{editingMasterCost.name}"
                </h3>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  Changes will update costs across all recipes linked to this pantry ingredient.
                </p>
              </div>
              <button
                onClick={() => setEditingMasterCost(null)}
                className="p-1 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePackageCost} className="p-5 space-y-4 overflow-y-auto">
              {pkgSaveFeedback && (
                <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                  {pkgSaveFeedback}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Measurement Dimension
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['mass', 'volume', 'discrete'] as CostingDimension[]).map((dim) => (
                    <button
                      key={dim}
                      type="button"
                      onClick={() => setDimensionInput(dim)}
                      className={`py-1.5 px-2 text-xs font-bold rounded-lg border transition text-center capitalize cursor-pointer ${
                        dimensionInput === dim
                          ? 'bg-[#D4A373] text-white border-[#D4A373]'
                          : 'bg-[#F9F8F6] dark:bg-[#25221F] text-[#8B7E74] border-[#EEECE8] dark:border-[#332F2B]'
                      }`}
                    >
                      {dim === 'mass' ? '⚖️ Mass' : dim === 'volume' ? '🧪 Volume' : '🥚 Discrete'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                    Pack Qty
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={packQtyInputStr}
                    onChange={(e) => setPackQtyInputStr(e.target.value)}
                    onBlur={() => {
                      if (packQtyInputStr.trim() !== '') {
                        const val = parseInt(packQtyInputStr, 10);
                        if (!isNaN(val) && val >= 1) {
                          setPackQtyInputStr(String(val));
                        }
                      }
                    }}
                    className="w-full px-2 py-1.5 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                    Unit Size
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={unitSizeInputStr}
                    onChange={(e) => setUnitSizeInputStr(e.target.value)}
                    onBlur={() => {
                      if (unitSizeInputStr.trim() !== '') {
                        const val = parseFloat(unitSizeInputStr);
                        if (!isNaN(val) && val > 0) {
                          setUnitSizeInputStr(formatCleanNumeric(val));
                        }
                      }
                    }}
                    className="w-full px-2 py-1.5 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#8B7E74] uppercase mb-0.5">
                    Unit
                  </label>
                  <input
                    type="text"
                    value={unitMeasureInput}
                    onChange={(e) => setUnitMeasureInput(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Package Price ($) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs text-[#8B7E74]">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={pkgPriceInput}
                    onChange={(e) => setPkgPriceInput(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] font-mono font-bold"
                  />
                </div>
              </div>

              {dimensionInput === 'volume' && (
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Density (g/ml) *Required
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    placeholder="e.g. 1.03 for milk, 0.92 for oil"
                    value={densityInput}
                    onChange={(e) => setDensityInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>
              )}

              {dimensionInput === 'discrete' && (
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Piece Weight (g per unit) - Optional
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    placeholder="e.g. 50 (grams per egg)"
                    value={pieceWeightInput}
                    onChange={(e) => setPieceWeightInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingMasterCost(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7E74] hover:text-[#5A534B] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isEditorOrOwner}
                  className="bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Package Pricing</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
