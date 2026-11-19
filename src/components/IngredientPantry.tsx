import React, { useState, useMemo } from 'react';
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Sparkles,
  Tag,
  AlertTriangle,
  Building2,
  Truck,
  Box,
  ArrowUpDown,
  Eye,
  DollarSign,
  Calculator,
  CheckCircle2,
  Info,
  Link2,
} from 'lucide-react';
import { Recipe, MasterIngredient, AccessRole, UserSettings, CostingDimension, PurchasePackage } from '../types';
import { SAMPLE_MASTER_INGREDIENTS } from '../services/sampleData';
import { normalizePurchasePackage } from '../utils/costing';
import { formatCleanNumeric } from '../utils/units';
import { getMasterIngredientReferences, calculateLinkingStats } from '../services/masterIngredientLinking';
import { IngredientLinkingReview } from './IngredientLinkingReview';

export type IngredientSortOption =
  | 'alphabetical'
  | 'category'
  | 'recently_added'
  | 'oldest_added'
  | 'ascending'
  | 'descending';

const STANDARD_CATEGORIES = [
  'Flour',
  'Sugar',
  'Dairy & Milk',
  'Fats & Oils',
  'Eggs',
  'Leavening',
  'Salt & Spices',
  'Flavorings',
  'Chocolate',
  'Fruit & Nuts',
  'General',
];

const STANDARD_PACKAGE_TYPES = [
  'Bag',
  'Box',
  'Case',
  'Bottle',
  'Pallet',
  'Pack',
  'Can',
  'Pail / Bucket',
  'Jug',
  'Tub',
  'Jar',
  'Sack',
  'Drum',
  'Carton',
];

const COMMON_ALLERGENS = [
  'Wheat',
  'Gluten',
  'Milk / Dairy',
  'Eggs',
  'Soy',
  'Peanuts',
  'Tree Nuts',
  'Sesame',
  'Fish / Shellfish',
];

interface IngredientPantryProps {
  userRole?: AccessRole;
  recipes?: Recipe[];
  masterIngredients: MasterIngredient[];
  settings?: UserSettings;
  onSaveIngredient: (ingredient: MasterIngredient) => void;
  onDeleteIngredient: (id: string, force?: boolean) => void;
  onBulkImport: (items: Partial<MasterIngredient>[]) => void;
  onLinkIngredient?: (recipeId: string, ingredientId: string, masterIngredientId: string) => Promise<void>;
  onUnlinkIngredient?: (recipeId: string, ingredientId: string) => Promise<void>;
  onBulkLinkGroup?: (ingredientName: string, masterIngredientId: string) => Promise<{ affectedCount: number }>;
}

export const IngredientPantry: React.FC<IngredientPantryProps> = ({
  userRole = 'owner',
  recipes = [],
  masterIngredients,
  settings,
  onSaveIngredient,
  onDeleteIngredient,
  onBulkImport,
  onLinkIngredient,
  onUnlinkIngredient,
  onBulkLinkGroup,
}) => {
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';
  const [activeSubTab, setActiveSubTab] = useState<'pantry' | 'linking'>('pantry');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<IngredientSortOption>('alphabetical');
  const [editingItem, setEditingItem] = useState<MasterIngredient | null>(null);

  const linkingStats = useMemo(() => {
    return calculateLinkingStats(recipes, masterIngredients);
  }, [recipes, masterIngredients]);

  // Custom Category State inside modal
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryText, setCustomCategoryText] = useState('');

  // Custom Package Type State inside modal
  const [isCustomPackageType, setIsCustomPackageType] = useState(false);
  const [customPackageTypeText, setCustomPackageTypeText] = useState('');

  // Phase 2.0B Purchasing & Cost State inside modal (Edit Buffer Pattern)
  const [purchaseFormActive, setPurchaseFormActive] = useState(false);
  const [pkgPriceStr, setPkgPriceStr] = useState('');
  const [packQtyStr, setPackQtyStr] = useState<string>('1');
  const [unitSizeStr, setUnitSizeStr] = useState<string>('50');
  const [unitMeasure, setUnitMeasure] = useState<string>('lb');
  const [editingDimension, setEditingDimension] = useState<CostingDimension>('mass');
  const [supplierItemCode, setSupplierItemCode] = useState<string>('');
  const [densityStr, setDensityStr] = useState<string>('');
  const [pieceWeightStr, setPieceWeightStr] = useState<string>('');

  // Live Costing Normalization Preview (Safe against partial typing)
  const liveNorm = useMemo(() => {
    if (!purchaseFormActive || pkgPriceStr.trim() === '') return null;
    const priceNum = parseFloat(pkgPriceStr);
    const pQty = parseInt(packQtyStr, 10);
    const uSize = parseFloat(unitSizeStr);
    if (isNaN(priceNum) || priceNum < 0 || isNaN(pQty) || pQty <= 0 || isNaN(uSize) || uSize <= 0) return null;

    const density = densityStr !== '' && !isNaN(parseFloat(densityStr)) ? parseFloat(densityStr) : undefined;
    const pieceWeight = pieceWeightStr !== '' && !isNaN(parseFloat(pieceWeightStr)) ? parseFloat(pieceWeightStr) : undefined;

    const pkg: PurchasePackage = {
      packQuantity: pQty,
      unitSize: uSize,
      unitMeasure: unitMeasure,
      packagePriceCents: Math.round(priceNum * 100),
    };

    return normalizePurchasePackage(pkg, editingDimension, density, pieceWeight);
  }, [purchaseFormActive, pkgPriceStr, packQtyStr, unitSizeStr, unitMeasure, editingDimension, densityStr, pieceWeightStr]);

  // Collect all unique categories from user's current ingredients + standard
  const existingUserCategories = Array.from(
    new Set(
      masterIngredients
        .map((item) => item.category?.trim())
        .filter((cat): cat is string => Boolean(cat && cat.length > 0))
    )
  );

  const allCategoryOptions = Array.from(
    new Set([...STANDARD_CATEGORIES, ...existingUserCategories])
  );

  // Collect all unique package types from user's ingredients + standard
  const existingUserPackageTypes = Array.from(
    new Set(
      masterIngredients
        .map((item) => item.packageType?.trim())
        .filter((pkg): pkg is string => Boolean(pkg && pkg.length > 0))
    )
  );

  const allPackageTypeOptions = Array.from(
    new Set([...STANDARD_PACKAGE_TYPES, ...existingUserPackageTypes])
  );

  // Category Counts
  const categoryCounts = masterIngredients.reduce((acc, item) => {
    const cat = item.category?.trim() || 'General';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Filtered List based on search term & category
  const filtered = masterIngredients.filter((item) => {
    const term = searchTerm.toLowerCase();
    const matchesName = item.name.toLowerCase().includes(term);
    const matchesSub = item.subIngredients?.toLowerCase().includes(term);
    const matchesCatSearch = item.category?.toLowerCase().includes(term);
    const matchesBrand = item.brand?.toLowerCase().includes(term);
    const matchesSupplier = item.supplier?.toLowerCase().includes(term);
    const matchesAllergens = item.allergens?.toLowerCase().includes(term);
    const matchesPackage = item.packageType?.toLowerCase().includes(term);
    const matchesSearch =
      matchesName ||
      matchesSub ||
      matchesCatSearch ||
      matchesBrand ||
      matchesSupplier ||
      matchesAllergens ||
      matchesPackage;

    const matchesCategoryFilter =
      selectedCategory === 'ALL' ||
      (item.category?.trim() || 'General') === selectedCategory;

    return matchesSearch && matchesCategoryFilter;
  });

  // Sorted List based on sortBy selection
  const sortedIngredients = [...filtered].sort((a, b) => {
    const getItemTime = (item: MasterIngredient): number => {
      if (item.createdAt) {
        const t = new Date(item.createdAt).getTime();
        if (!isNaN(t)) return t;
      }
      const match = item.id.match(/\d{10,}/);
      if (match) return parseInt(match[0], 10);
      return 0;
    };

    switch (sortBy) {
      case 'alphabetical':
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

      case 'category': {
        const catA = (a.category || 'General').trim();
        const catB = (b.category || 'General').trim();
        const catCompare = catA.localeCompare(catB, undefined, { numeric: true, sensitivity: 'base' });
        if (catCompare !== 0) return catCompare;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      case 'recently_added': {
        const tA = getItemTime(a);
        const tB = getItemTime(b);
        if (tA !== tB) return tB - tA;
        return a.name.localeCompare(b.name);
      }

      case 'oldest_added': {
        const tA = getItemTime(a);
        const tB = getItemTime(b);
        if (tA !== tB) return tA - tB;
        return a.name.localeCompare(b.name);
      }

      case 'ascending': {
        const wA = a.netWeight !== undefined && a.netWeight !== null ? Number(a.netWeight) : null;
        const wB = b.netWeight !== undefined && b.netWeight !== null ? Number(b.netWeight) : null;
        if (wA !== null && wB !== null && wA !== wB) {
          return wA - wB;
        }
        if (wA !== null && wB === null) return -1;
        if (wA === null && wB !== null) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      case 'descending': {
        const wA = a.netWeight !== undefined && a.netWeight !== null ? Number(a.netWeight) : null;
        const wB = b.netWeight !== undefined && b.netWeight !== null ? Number(b.netWeight) : null;
        if (wA !== null && wB !== null && wA !== wB) {
          return wB - wA;
        }
        if (wA !== null && wB === null) return -1;
        if (wA === null && wB !== null) return 1;
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      default:
        return 0;
    }
  });

  const handleCreateNew = () => {
    const prefUnit = settings?.defaultWeightUnit || 'g';
    setEditingItem({
      id: `mi-${Date.now()}`,
      userId: '',
      name: '',
      category: 'Flour',
      subIngredients: '',
      brand: '',
      supplier: '',
      allergens: '',
      netWeight: undefined,
      netWeightUnit: prefUnit,
      defaultUnit: prefUnit,
      packageType: 'Bag',
      dimension: 'mass',
      preferredPurchasePackage: undefined,
    });
    setIsCustomCategory(false);
    setCustomCategoryText('');
    setIsCustomPackageType(false);
    setCustomPackageTypeText('');
    setPurchaseFormActive(false);
    setPkgPriceStr('');
    setPackQtyStr('1');
    setUnitSizeStr('50');
    setUnitMeasure(prefUnit);
    setEditingDimension('mass');
    setSupplierItemCode('');
    setDensityStr('');
    setPieceWeightStr('');
  };

  const handleEditItem = (item: MasterIngredient) => {
    setEditingItem({ ...item });

    // Category check
    const currentCat = item.category?.trim() || 'General';
    if (currentCat && !allCategoryOptions.includes(currentCat)) {
      setIsCustomCategory(true);
      setCustomCategoryText(currentCat);
    } else {
      setIsCustomCategory(false);
      setCustomCategoryText('');
    }

    // Package Type check
    const currentPkg = item.packageType?.trim() || 'Bag';
    if (currentPkg && !allPackageTypeOptions.includes(currentPkg)) {
      setIsCustomPackageType(true);
      setCustomPackageTypeText(currentPkg);
    } else {
      setIsCustomPackageType(false);
      setCustomPackageTypeText('');
    }

    // Phase 2.0B Purchasing state initialization (Edit buffer pattern)
    if (item.preferredPurchasePackage) {
      setPurchaseFormActive(true);
      setPkgPriceStr(
        item.preferredPurchasePackage.packagePriceCents !== undefined
          ? (item.preferredPurchasePackage.packagePriceCents / 100).toFixed(2)
          : ''
      );
      setPackQtyStr(
        item.preferredPurchasePackage.packQuantity !== undefined
          ? formatCleanNumeric(item.preferredPurchasePackage.packQuantity)
          : '1'
      );
      setUnitSizeStr(
        item.preferredPurchasePackage.unitSize !== undefined
          ? formatCleanNumeric(item.preferredPurchasePackage.unitSize)
          : '1'
      );
      setUnitMeasure(item.preferredPurchasePackage.unitMeasure || item.netWeightUnit || 'lb');
      setEditingDimension(item.dimension || 'mass');
      setSupplierItemCode(item.preferredPurchasePackage.supplierItemCode || '');
      setDensityStr(item.densityGramsPerMl !== undefined ? formatCleanNumeric(item.densityGramsPerMl) : '');
      setPieceWeightStr(item.pieceWeightGrams !== undefined ? formatCleanNumeric(item.pieceWeightGrams) : '');
    } else {
      setPurchaseFormActive(false);
      setPkgPriceStr('');
      setPackQtyStr('1');
      setUnitSizeStr(item.netWeight ? formatCleanNumeric(Number(item.netWeight)) : '1');
      setUnitMeasure(item.netWeightUnit || 'lb');
      setEditingDimension(item.dimension || 'mass');
      setSupplierItemCode('');
      setDensityStr(item.densityGramsPerMl !== undefined ? formatCleanNumeric(item.densityGramsPerMl) : '');
      setPieceWeightStr(item.pieceWeightGrams !== undefined ? formatCleanNumeric(item.pieceWeightGrams) : '');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    if (!isEditorOrOwner) {
      setEditingItem(null);
      return;
    }
    if (!editingItem.name.trim()) {
      alert('Please enter an ingredient name.');
      return;
    }

    const finalCategory = isCustomCategory
      ? customCategoryText.trim() || 'General'
      : editingItem.category?.trim() || 'General';

    const finalPackageType = isCustomPackageType
      ? customPackageTypeText.trim() || 'Bag'
      : editingItem.packageType?.trim() || 'Bag';

    // Phase 2.0B Purchasing info processing & validation
    let costPerGram: number | undefined = editingItem.costPerGram;
    let costPerEach: number | undefined = editingItem.costPerEach;
    let prefPkg: PurchasePackage | undefined = editingItem.preferredPurchasePackage;
    let costUpdatedAt: string | undefined = editingItem.costUpdatedAt;
    const densityVal = densityStr !== '' && !isNaN(parseFloat(densityStr)) ? parseFloat(densityStr) : undefined;
    const pieceWeightVal = pieceWeightStr !== '' && !isNaN(parseFloat(pieceWeightStr)) ? parseFloat(pieceWeightStr) : undefined;

    if (purchaseFormActive && pkgPriceStr.trim() !== '') {
      const priceNum = parseFloat(pkgPriceStr);
      if (isNaN(priceNum) || priceNum < 0) {
        alert('Package price must be a valid number and cannot be negative ($0.00 is allowed).');
        return;
      }
      const pQty = parseInt(packQtyStr, 10);
      if (isNaN(pQty) || pQty <= 0) {
        alert('Pack quantity must be at least 1.');
        return;
      }
      const uSize = parseFloat(unitSizeStr);
      if (isNaN(uSize) || uSize <= 0) {
        alert('Unit size must be a valid number greater than 0.');
        return;
      }

      const packagePriceCents = Math.round(priceNum * 100);
      prefPkg = {
        packQuantity: pQty,
        unitSize: uSize,
        unitMeasure,
        packageType: finalPackageType,
        packagePriceCents,
        supplierName: editingItem.supplier?.trim() || undefined,
        supplierItemCode: supplierItemCode.trim() || undefined,
        effectiveDate: new Date().toISOString().split('T')[0],
      };

      const norm = normalizePurchasePackage(
        prefPkg,
        editingDimension,
        densityVal,
        pieceWeightVal
      );

      if (norm.error) {
        alert(`Purchasing data validation error: ${norm.error}`);
        return;
      }

      costPerGram = norm.costPerGram;
      costPerEach = norm.costPerEach;
      costUpdatedAt = new Date().toISOString();
    }

    onSaveIngredient({
      ...editingItem,
      name: editingItem.name.trim(),
      category: finalCategory,
      subIngredients: editingItem.subIngredients?.trim() || '',
      brand: editingItem.brand?.trim() || '',
      supplier: editingItem.supplier?.trim() || '',
      allergens: editingItem.allergens?.trim() || '',
      packageType: finalPackageType,
      netWeight:
        editingItem.netWeight !== undefined && editingItem.netWeight !== null && !isNaN(Number(editingItem.netWeight))
          ? Number(editingItem.netWeight)
          : undefined,
      netWeightUnit: editingItem.netWeightUnit || 'lb',
      preferredPurchasePackage: prefPkg,
      dimension: editingDimension,
      densityGramsPerMl: densityVal,
      pieceWeightGrams: pieceWeightVal,
      costPerGram,
      costPerEach,
      costUpdatedAt,
      schemaVersion: 2,
    });
    setEditingItem(null);
  };

  const toggleAllergen = (allergenName: string) => {
    if (!editingItem) return;
    const currentList = editingItem.allergens
      ? editingItem.allergens.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    let newList: string[];
    const exists = currentList.some((item) => item.toLowerCase() === allergenName.toLowerCase());
    if (exists) {
      newList = currentList.filter((item) => item.toLowerCase() !== allergenName.toLowerCase());
    } else {
      newList = [...currentList, allergenName];
    }

    setEditingItem({
      ...editingItem,
      allergens: newList.join(', '),
    });
  };

  const handleImportDefaults = () => {
    onBulkImport(SAMPLE_MASTER_INGREDIENTS);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Viewer Mode Banner */}
      {!isEditorOrOwner && (
        <div className="bg-[#FAF3E0] dark:bg-[#2C2416] border border-[#E6C875] dark:border-[#8A6D24] text-[#7A5B10] dark:text-[#EED285] px-4 py-3 rounded-xl text-xs font-semibold flex items-center gap-2.5 shadow-xs">
          <Eye className="w-4 h-4 shrink-0 text-[#D4A373]" />
          <span>
            <strong>Viewer Mode:</strong> You have read-only access. Only workspace Owners and Editors can add, edit, or delete master ingredients.
          </span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <Package className="w-6 h-6 text-[#D4A373]" />
            <span>Master Ingredient Pantry</span>
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Manage ingredients with brand, supplier, net weights, package types, allergens, and sub-components.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isEditorOrOwner && masterIngredients.length === 0 && (
            <button
              onClick={handleImportDefaults}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#D4A373]" />
              <span>Import Sample Ingredients</span>
            </button>
          )}

          {activeSubTab === 'pantry' && (
            <button
              disabled={!isEditorOrOwner}
              onClick={handleCreateNew}
              title={!isEditorOrOwner ? "Viewers cannot add ingredients" : "Add Ingredient"}
              className={`inline-flex items-center gap-2 font-bold px-4 py-2 rounded-xl text-xs transition shadow-xs ${
                isEditorOrOwner
                  ? 'bg-[#D4A373] hover:bg-[#C49363] text-white cursor-pointer'
                  : 'bg-gray-200 dark:bg-[#2A2725] text-gray-400 dark:text-gray-600 cursor-not-allowed border border-gray-300 dark:border-gray-800'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Add Ingredient</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-tab Navigation: Master Ingredients vs Ingredient Linking Review */}
      <div className="flex items-center gap-2 border-b border-[#EEECE8] dark:border-[#332F2B] pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('pantry')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'pantry'
              ? 'bg-[#5A534B] text-white shadow-xs dark:bg-[#3D3732]'
              : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] border border-[#E5E1DA] dark:border-[#2D2925] hover:text-[#5A534B]'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Master Ingredients ({masterIngredients.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('linking')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'linking'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] border border-[#E5E1DA] dark:border-[#2D2925] hover:text-[#5A534B]'
          }`}
        >
          <Link2 className="w-4 h-4 text-amber-500" />
          <span>
            Ingredient Linking ({linkingStats.linkedFormulaLines}/{linkingStats.totalFormulaLines})
          </span>
          {linkingStats.brokenLinks > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-rose-500 text-white">
              {linkingStats.brokenLinks}
            </span>
          )}
        </button>
      </div>

      {activeSubTab === 'linking' && (
        <IngredientLinkingReview
          recipes={recipes}
          masterIngredients={masterIngredients}
          userRole={userRole}
          onLinkIngredient={onLinkIngredient || (async () => {})}
          onUnlinkIngredient={onUnlinkIngredient || (async () => {})}
          onBulkLinkGroup={onBulkLinkGroup || (async () => ({ affectedCount: 0 }))}
          onBackToPantry={() => setActiveSubTab('pantry')}
        />
      )}

      {activeSubTab === 'pantry' && (
        <>

      {/* Category Filter Pills / Tags */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedCategory('ALL')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
            selectedCategory === 'ALL'
              ? 'bg-[#5A534B] text-white shadow-sm dark:bg-[#3D3732]'
              : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] border border-[#E5E1DA] dark:border-[#2D2925] hover:text-[#5A534B]'
          }`}
        >
          All ({masterIngredients.length})
        </button>

        {Object.entries(categoryCounts).map(([catName, count]) => (
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

      {/* Search & Sort Toolbar */}
      <div className="bg-white dark:bg-[#1E1B18] p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A39E93]" />
          <input
            type="text"
            placeholder="Search by ingredient, brand, supplier, allergen, or package type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:outline-none focus:border-[#D4A373] dark:text-[#EAE6E1]"
          />
        </div>

        <div className="flex items-center gap-2 justify-between sm:justify-end">
          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] px-3 py-1.5 rounded-xl text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#D4A373] shrink-0" />
            <span className="text-[#8B7E74] dark:text-[#A39E93] font-semibold hidden md:inline">Sort:</span>
            <select
              id="ingredient-pantry-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as IngredientSortOption)}
              className="bg-transparent font-bold text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none cursor-pointer"
            >
              <option value="alphabetical">Alphabetical Order</option>
              <option value="category">Category</option>
              <option value="recently_added">Recently Added</option>
              <option value="oldest_added">Oldest Added</option>
              <option value="ascending">Ascending</option>
              <option value="descending">Descending</option>
            </select>
          </div>

          <span className="text-xs text-[#8B7E74] dark:text-[#A39E93] font-mono shrink-0">
            {sortedIngredients.length} item{sortedIngredients.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Grid Display - Cards showing rich ingredient metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {sortedIngredients.map((item) => (
          <div
            key={item.id}
            onClick={() => handleEditItem(item)}
            className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-sm hover:shadow-md transition flex flex-col justify-between group cursor-pointer space-y-3"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1] block truncate">
                    {item.name}
                  </span>
                  {item.category && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#D4CEC7] border border-[#EEECE8] dark:border-[#332F2B] mt-1">
                      <Tag className="w-2.5 h-2.5 text-[#D4A373]" />
                      {item.category}
                    </span>
                  )}
                </div>

                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleEditItem(item)}
                    className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer"
                    title={isEditorOrOwner ? 'Edit Ingredient' : 'View Details'}
                  >
                    {isEditorOrOwner ? <Edit2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {isEditorOrOwner && (
                    <button
                      onClick={() => {
                        const refs = getMasterIngredientReferences(item.id, recipes);
                        const totalFormulaLines = refs.reduce((acc, r) => acc + r.ingredientCount, 0);
                        if (totalFormulaLines > 0) {
                          const recipeList = refs.map((r) => r.recipeName).slice(0, 3).join(', ');
                          const more = refs.length > 3 ? ` and ${refs.length - 3} more` : '';
                          alert(
                            `Cannot delete "${item.name}": It is currently referenced by ${totalFormulaLines} formula line(s) across ${refs.length} recipe(s) (${recipeList}${more}). Unlink or update these recipes first to prevent broken links.`
                          );
                          return;
                        }
                        if (confirm(`Remove "${item.name}"?`)) {
                          onDeleteIngredient(item.id);
                        }
                      }}
                      className="p-1.5 text-[#C97B63] hover:text-red-700 hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
                      title="Delete Ingredient"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Brand & Supplier */}
              {(item.brand || item.supplier) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  {item.brand && (
                    <span className="inline-flex items-center gap-1 font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                      <Building2 className="w-3 h-3 text-[#D4A373]" />
                      {item.brand}
                    </span>
                  )}
                  {item.supplier && (
                    <span className="inline-flex items-center gap-1 italic text-[#8B7E74]">
                      <Truck className="w-3 h-3 text-[#8B7E74]" />
                      {item.supplier}
                    </span>
                  )}
                </div>
              )}

              {/* Net Weight & Package Type */}
              {(item.netWeight !== undefined || item.packageType) && (
                <div className="flex items-center gap-1.5 text-xs font-mono text-[#D4A373] font-semibold bg-[#F9F8F6] dark:bg-[#25221F] px-2 py-1 rounded-lg border border-[#EEECE8] dark:border-[#332F2B] w-fit">
                  <Box className="w-3 h-3 shrink-0" />
                  <span>
                    {item.netWeight !== undefined ? `${item.netWeight} ${item.netWeightUnit || 'lb'}` : ''}
                    {item.netWeight !== undefined && item.packageType ? ' ' : ''}
                    {item.packageType ? `(${item.packageType})` : ''}
                  </span>
                </div>
              )}

              {/* Cost Badge (Phase 2.0B) */}
              {(item.costPerGram !== undefined || item.costPerEach !== undefined || item.preferredPurchasePackage) && (
                <div className="flex items-center gap-1.5 text-xs font-mono text-[#5A534B] dark:text-[#EAE6E1] bg-[#F5F2ED] dark:bg-[#25221F] px-2 py-1 rounded-lg border border-[#EEECE8] dark:border-[#332F2B] w-fit font-semibold">
                  <DollarSign className="w-3 h-3 text-[#D4A373] shrink-0" />
                  <span>
                    {item.costPerGram !== undefined
                      ? `$${item.costPerGram < 0.01 ? item.costPerGram.toFixed(6) : item.costPerGram.toFixed(4)} / g`
                      : item.costPerEach !== undefined
                      ? `$${item.costPerEach.toFixed(2)} / each`
                      : `$${((item.preferredPurchasePackage?.packagePriceCents || 0) / 100).toFixed(2)} / pkg`}
                  </span>
                </div>
              )}

              {/* Allergens warning badge */}
              {item.allergens && (
                <div className="inline-flex items-center gap-1 text-[11px] text-[#C97B63] dark:text-[#EAA89A] bg-[#FDF2F0] dark:bg-[#2C1916] px-2 py-1 rounded-md font-medium border border-[#F5D5CF] dark:border-[#4E2620] w-full truncate">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#C97B63]" />
                  <span className="truncate">Allergens: {item.allergens}</span>
                </div>
              )}

              {/* Recipe Usage Occurrences (Phase 2A) */}
              {(() => {
                const refs = getMasterIngredientReferences(item.id, recipes);
                const totalFormulaLines = refs.reduce((acc, r) => acc + r.ingredientCount, 0);

                if (refs.length > 0) {
                  return (
                    <div className="text-xs bg-[#F9F8F6] dark:bg-[#25221F] p-2 rounded-lg border border-[#EEECE8] dark:border-[#332F2B] space-y-1">
                      <div className="font-semibold text-[#5A534B] dark:text-[#D4CEC7] flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1">
                          <Link2 className="w-3 h-3 text-[#2D6A4F] dark:text-[#52B788] shrink-0" />
                          <span>Used in {refs.length} recipe{refs.length > 1 ? 's' : ''}:</span>
                        </span>
                        <span className="font-mono text-[10px] text-[#2D6A4F] dark:text-[#52B788] font-bold">
                          {totalFormulaLines} line{totalFormulaLines > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] truncate" title={refs.map((r) => r.recipeName).join(', ')}>
                        {refs.map((r) => r.recipeName).join(', ')}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="text-[10px] text-[#A39E93] dark:text-[#8B7E74] italic flex items-center gap-1">
                    <Info className="w-2.5 h-2.5 shrink-0" />
                    <span>Not currently linked in any recipes</span>
                  </div>
                );
              })()}
            </div>

            {item.subIngredients && (
              <div className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] border-t border-[#EEECE8] dark:border-[#332F2B] pt-2 truncate italic">
                {item.subIngredients}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-[#A39E93] text-sm bg-white dark:bg-[#1E1B18] rounded-xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] p-8">
            <p className="mb-3">No ingredients found.</p>
            {isEditorOrOwner && (
              <button
                onClick={handleCreateNew}
                className="text-[#D4A373] font-bold underline cursor-pointer"
              >
                Add an ingredient
              </button>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {/* Modal - Edit/Add Ingredient */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between shrink-0">
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                {!isEditorOrOwner
                  ? 'View Ingredient Details (Read Only)'
                  : editingItem.id.startsWith('mi-') && !editingItem.createdAt
                  ? 'Add New Ingredient'
                  : 'Edit Ingredient'}
              </h3>
              <button
                onClick={() => setEditingItem(null)}
                className="p-1 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
              {/* Ingredient Name */}
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Ingredient Name *
                </label>
                <input
                  type="text"
                  required
                  disabled={!isEditorOrOwner}
                  placeholder="e.g. Dark Chocolate Chips, Bread Flour..."
                  value={editingItem.name}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                />
              </div>

              {/* Category / Tag */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                    Category / Tag
                  </label>
                  {isEditorOrOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomCategory(!isCustomCategory);
                        if (!isCustomCategory) {
                          setCustomCategoryText(editingItem.category || '');
                        }
                      }}
                      className="text-[11px] text-[#D4A373] hover:underline cursor-pointer font-bold"
                    >
                      {isCustomCategory ? 'Select from existing tags' : '+ Create custom tag'}
                    </button>
                  )}
                </div>

                {isCustomCategory ? (
                  <input
                    type="text"
                    required
                    disabled={!isEditorOrOwner}
                    placeholder="Type custom tag name (e.g. Organic, Nuts, Glaze)..."
                    value={customCategoryText}
                    onChange={(e) => {
                      setCustomCategoryText(e.target.value);
                      setEditingItem({ ...editingItem, category: e.target.value });
                    }}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                ) : (
                  <select
                    value={editingItem.category || 'Flour'}
                    disabled={!isEditorOrOwner}
                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer disabled:opacity-75"
                  >
                    {allCategoryOptions.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Brand & Supplier */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-[#D4A373]" />
                    <span>Brand</span>
                  </label>
                  <input
                    type="text"
                    disabled={!isEditorOrOwner}
                    placeholder="e.g. King Arthur, Callebaut"
                    value={editingItem.brand || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, brand: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1 flex items-center gap-1">
                    <Truck className="w-3.5 h-3.5 text-[#D4A373]" />
                    <span>Supplier</span>
                  </label>
                  <input
                    type="text"
                    disabled={!isEditorOrOwner}
                    placeholder="e.g. Sysco, BakeMark, US Foods"
                    value={editingItem.supplier || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, supplier: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                  />
                </div>
              </div>

              {/* Net Weight & Package Type */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] flex items-center gap-1">
                    <Box className="w-3.5 h-3.5 text-[#D4A373]" />
                    <span>Net Weight & Package Type</span>
                  </label>
                  {isEditorOrOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomPackageType(!isCustomPackageType);
                        if (!isCustomPackageType) {
                          setCustomPackageTypeText(editingItem.packageType || '');
                        }
                      }}
                      className="text-[11px] text-[#D4A373] hover:underline cursor-pointer font-bold"
                    >
                      {isCustomPackageType ? 'Select package type' : '+ Custom package type'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-12 gap-2">
                  {/* Net Weight Value */}
                  <div className="col-span-4">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      disabled={!isEditorOrOwner}
                      placeholder="Net Wt (e.g. 50)"
                      value={editingItem.netWeight ?? ''}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          netWeight: e.target.value !== '' ? parseFloat(e.target.value) : undefined,
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                    />
                  </div>

                  {/* Net Weight Unit */}
                  <div className="col-span-3">
                    <select
                      value={editingItem.netWeightUnit || 'lb'}
                      disabled={!isEditorOrOwner}
                      onChange={(e) => setEditingItem({ ...editingItem, netWeightUnit: e.target.value })}
                      className="w-full px-2 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer disabled:opacity-75"
                    >
                      <option value="lb">lb</option>
                      <option value="kg">kg</option>
                      <option value="oz">oz</option>
                      <option value="g">g</option>
                      <option value="l">l</option>
                      <option value="ml">ml</option>
                      <option value="doz">doz</option>
                      <option value="pcs">pcs</option>
                    </select>
                  </div>

                  {/* Package Type Dropdown / Custom Input */}
                  <div className="col-span-5">
                    {isCustomPackageType ? (
                      <input
                        type="text"
                        disabled={!isEditorOrOwner}
                        placeholder="Custom (e.g. Tote, Crate)..."
                        value={customPackageTypeText}
                        onChange={(e) => {
                          setCustomPackageTypeText(e.target.value);
                          setEditingItem({ ...editingItem, packageType: e.target.value });
                        }}
                        className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                      />
                    ) : (
                      <select
                        value={editingItem.packageType || 'Bag'}
                        disabled={!isEditorOrOwner}
                        onChange={(e) => {
                          if (e.target.value === '__CUSTOM__') {
                            setIsCustomPackageType(true);
                            setCustomPackageTypeText('');
                          } else {
                            setEditingItem({ ...editingItem, packageType: e.target.value });
                          }
                        }}
                        className="w-full px-2 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer disabled:opacity-75"
                      >
                        {allPackageTypeOptions.map((pkg) => (
                          <option key={pkg} value={pkg}>
                            {pkg}
                          </option>
                        ))}
                        {isEditorOrOwner && <option value="__CUSTOM__">+ Custom package type...</option>}
                      </select>
                    )}
                  </div>
                </div>
              </div>

              {/* Allergens */}
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#C97B63]" />
                  <span>Allergens</span>
                </label>
                <input
                  type="text"
                  disabled={!isEditorOrOwner}
                  placeholder="e.g. Wheat, Milk, Soy, Peanuts"
                  value={editingItem.allergens || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, allergens: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] mb-2 disabled:opacity-75"
                />

                {/* Quick allergen toggle pills */}
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_ALLERGENS.map((allergen) => {
                    const isSelected = editingItem.allergens
                      ?.toLowerCase()
                      .includes(allergen.toLowerCase());
                    return (
                      <button
                        key={allergen}
                        type="button"
                        disabled={!isEditorOrOwner}
                        onClick={() => toggleAllergen(allergen)}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded-lg border transition cursor-pointer disabled:cursor-not-allowed ${
                          isSelected
                            ? 'bg-[#C97B63] text-white border-[#C97B63]'
                            : 'bg-[#F9F8F6] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}{allergen}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* PHASE 2.0B: Purchasing & Cost Foundation */}
              <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-4 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-[#D4A373]" />
                    <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                      Purchasing & Package Cost (Phase 2.0B)
                    </span>
                  </div>
                  {isEditorOrOwner && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={purchaseFormActive}
                        onChange={(e) => {
                          setPurchaseFormActive(e.target.checked);
                          if (e.target.checked && !pkgPriceStr) {
                            setPkgPriceStr('0.00');
                          }
                        }}
                        className="rounded text-[#D4A373] focus:ring-[#D4A373] cursor-pointer"
                      />
                      <span>Track Purchasing & Cost</span>
                    </label>
                  )}
                </div>

                {purchaseFormActive ? (
                  <div className="space-y-3 pt-2 border-t border-[#EEECE8] dark:border-[#332F2B]">
                    {/* Costing Dimension */}
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-[#8B7E74] dark:text-[#A39E93] mb-1">
                        Measurement Dimension
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['mass', 'volume', 'discrete'] as CostingDimension[]).map((dim) => (
                          <button
                            key={dim}
                            type="button"
                            disabled={!isEditorOrOwner}
                            onClick={() => {
                              setEditingDimension(dim);
                              if (dim === 'mass' && !['lb', 'kg', 'oz', 'g'].includes(unitMeasure)) {
                                setUnitMeasure('lb');
                              } else if (dim === 'volume' && !['ml', 'l', 'cup', 'tbsp', 'tsp', 'fl_oz', 'gal'].includes(unitMeasure)) {
                                setUnitMeasure('gal');
                              } else if (dim === 'discrete' && !['each', 'pcs', 'egg', 'doz'].includes(unitMeasure)) {
                                setUnitMeasure('each');
                              }
                            }}
                            className={`py-1.5 px-2 text-xs font-bold rounded-lg border transition text-center capitalize cursor-pointer disabled:cursor-not-allowed ${
                              editingDimension === dim
                                ? 'bg-[#D4A373] text-white border-[#D4A373]'
                                : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] dark:text-[#A39E93] border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
                            }`}
                          >
                            {dim === 'mass' ? '⚖️ Mass (Weight)' : dim === 'volume' ? '🧪 Volume (Liquid)' : '🥚 Discrete (Count)'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Package Specs Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase mb-0.5">
                          Pack Qty
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          disabled={!isEditorOrOwner}
                          placeholder="1"
                          value={packQtyStr}
                          onChange={(e) => setPackQtyStr(e.target.value)}
                          onBlur={() => {
                            if (packQtyStr.trim() !== '') {
                              const val = parseInt(packQtyStr, 10);
                              if (!isNaN(val) && val >= 1) {
                                setPackQtyStr(String(val));
                              }
                            }
                          }}
                          className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                        />
                        <span className="text-[9px] text-[#A39E93]">e.g. 1 bag or 6 boxes</span>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase mb-0.5">
                          Unit Size
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!isEditorOrOwner}
                          placeholder="50"
                          value={unitSizeStr}
                          onChange={(e) => setUnitSizeStr(e.target.value)}
                          onBlur={() => {
                            if (unitSizeStr.trim() !== '') {
                              const val = parseFloat(unitSizeStr);
                              if (!isNaN(val) && val > 0) {
                                setUnitSizeStr(formatCleanNumeric(val));
                              }
                            }
                          }}
                          className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                        />
                        <span className="text-[9px] text-[#A39E93]">e.g. 50 (for 50 lb)</span>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase mb-0.5">
                          Measure Unit
                        </label>
                        <select
                          disabled={!isEditorOrOwner}
                          value={unitMeasure}
                          onChange={(e) => setUnitMeasure(e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                        >
                          {editingDimension === 'mass' && (
                            <>
                              <option value="lb">Pounds (lb)</option>
                              <option value="kg">Kilograms (kg)</option>
                              <option value="oz">Ounces (oz)</option>
                              <option value="g">Grams (g)</option>
                            </>
                          )}
                          {editingDimension === 'volume' && (
                            <>
                              <option value="gal">Gallons (gal)</option>
                              <option value="fl_oz">Fluid Oz (fl oz)</option>
                              <option value="l">Liters (l)</option>
                              <option value="ml">Milliliters (ml)</option>
                              <option value="cup">Cups (cup)</option>
                              <option value="tbsp">Tablespoons (tbsp)</option>
                              <option value="tsp">Teaspoons (tsp)</option>
                            </>
                          )}
                          {editingDimension === 'discrete' && (
                            <>
                              <option value="each">Each (individual)</option>
                              <option value="pcs">Pieces (pcs)</option>
                              <option value="egg">Egg</option>
                              <option value="doz">Dozen (12 pcs)</option>
                            </>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase mb-0.5">
                          Package Price ($)
                        </label>
                        <div className="relative">
                          <span className="absolute left-2 top-1.5 text-xs text-[#8B7E74]">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            disabled={!isEditorOrOwner}
                            placeholder="24.50"
                            value={pkgPriceStr}
                            onChange={(e) => setPkgPriceStr(e.target.value)}
                            className="w-full pl-5 pr-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] font-mono font-bold"
                          />
                        </div>
                        <span className="text-[9px] text-[#A39E93]">$0.00 is allowed (e.g. water)</span>
                      </div>
                    </div>

                    {/* Conditional Density & Piece Weight */}
                    {editingDimension === 'volume' && (
                      <div className="p-2.5 bg-white dark:bg-[#1E1B18] rounded-lg border border-[#EEECE8] dark:border-[#332F2B] space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1">
                            <span>Density (grams per ml)</span>
                            <span className="text-[10px] text-[#C97B63] font-semibold">*Required for recipe costing</span>
                          </label>
                        </div>
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          disabled={!isEditorOrOwner}
                          placeholder="e.g. 1.05 for milk, 1.26 for honey, 0.92 for oil"
                          value={densityStr}
                          onChange={(e) => setDensityStr(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                        />
                        <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                          Costing never defaults missing density to 1.0. Liquid ingredients must have a measured density to safely convert recipe weight into volume cost.
                        </p>
                      </div>
                    )}

                    {editingDimension === 'discrete' && (
                      <div className="p-2.5 bg-white dark:bg-[#1E1B18] rounded-lg border border-[#EEECE8] dark:border-[#332F2B] space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                            Piece Weight (grams per unit) - Optional
                          </label>
                        </div>
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          disabled={!isEditorOrOwner}
                          placeholder="e.g. 50 (grams per egg)"
                          value={pieceWeightStr}
                          onChange={(e) => setPieceWeightStr(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                        />
                        <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                          Allows recipes measured by weight (e.g. 200g egg) to be costed from packages purchased by count (e.g. 15-dozen case).
                        </p>
                      </div>
                    )}

                    {/* Supplier Item Code */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase mb-0.5">
                          Supplier Item Code / SKU
                        </label>
                        <input
                          type="text"
                          disabled={!isEditorOrOwner}
                          placeholder="e.g. SYSCO-984210"
                          value={supplierItemCode}
                          onChange={(e) => setSupplierItemCode(e.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                        />
                      </div>
                    </div>

                    {/* Live Normalization Preview */}
                    {liveNorm && (
                      <div className="p-3 bg-white dark:bg-[#1E1B18] rounded-xl border border-[#D4A373]/30 dark:border-[#D4A373]/20 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                          <Calculator className="w-3.5 h-3.5 text-[#D4A373]" />
                          <span>Live Cost Normalization Preview</span>
                        </div>

                        {liveNorm.error ? (
                          <div className="text-xs text-[#C97B63] dark:text-[#EAA89A] flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>{liveNorm.error}</span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                            <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-2 rounded-lg border border-[#EEECE8] dark:border-[#332F2B]">
                              <span className="text-[10px] uppercase font-sans text-[#8B7E74] block">Package Quantity</span>
                              <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                                {editingDimension === 'mass' && liveNorm.normalizedPackageGrams !== undefined
                                  ? `${liveNorm.normalizedPackageGrams.toLocaleString(undefined, { maximumFractionDigits: 1 })} g (~${(liveNorm.normalizedPackageGrams / 453.59237).toFixed(2)} lb)`
                                  : editingDimension === 'volume' && liveNorm.totalVolumeMl !== undefined
                                  ? `${liveNorm.totalVolumeMl.toLocaleString(undefined, { maximumFractionDigits: 1 })} ml`
                                  : `${liveNorm.totalUnitsCount} ${unitMeasure}`}
                              </span>
                            </div>

                            <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-2 rounded-lg border border-[#EEECE8] dark:border-[#332F2B]">
                              <span className="text-[10px] uppercase font-sans text-[#8B7E74] block">Normalized Cost</span>
                              <span className="font-bold text-[#D4A373]">
                                {liveNorm.costPerGram !== undefined ? (
                                  <>
                                    ${liveNorm.costPerGram < 0.01 ? liveNorm.costPerGram.toFixed(6) : liveNorm.costPerGram.toFixed(4)} / g
                                    <span className="text-[10px] text-[#8B7E74] block">
                                      ~${(liveNorm.costPerGram * 453.59237).toFixed(2)} / lb
                                    </span>
                                  </>
                                ) : liveNorm.costPerEach !== undefined ? (
                                  <>${liveNorm.costPerEach.toFixed(4)} / each</>
                                ) : (
                                  'Requires density'
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                    No purchasing or cost data currently attached. Check the box above to enter package pricing for automatic recipe costing.
                  </p>
                )}
              </div>

              {/* Sub-Ingredients / Formulas */}
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Ingredients of the Ingredient (Sub-components)
                </label>
                <textarea
                  rows={3}
                  disabled={!isEditorOrOwner}
                  placeholder="e.g. Sugar, Chocolate Liquor, Cocoa Butter, Milkfat, Soy Lecithin, Natural Vanilla Extract"
                  value={editingItem.subIngredients || ''}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, subIngredients: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-75"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#EEECE8] dark:border-[#332F2B]">
                {isEditorOrOwner ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingItem(null)}
                      className="px-4 py-2 text-xs font-bold text-[#8B7E74] hover:text-[#5A534B] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-5 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm"
                    >
                      Save Ingredient
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
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
