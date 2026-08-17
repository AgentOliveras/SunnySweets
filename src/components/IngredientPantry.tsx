import React, { useState } from 'react';
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
} from 'lucide-react';
import { MasterIngredient, AccessRole, UserSettings } from '../types';
import { SAMPLE_MASTER_INGREDIENTS } from '../services/sampleData';

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
  masterIngredients: MasterIngredient[];
  settings?: UserSettings;
  onSaveIngredient: (ingredient: MasterIngredient) => void;
  onDeleteIngredient: (id: string) => void;
  onBulkImport: (items: Partial<MasterIngredient>[]) => void;
}

export const IngredientPantry: React.FC<IngredientPantryProps> = ({
  userRole = 'owner',
  masterIngredients,
  settings,
  onSaveIngredient,
  onDeleteIngredient,
  onBulkImport,
}) => {
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<IngredientSortOption>('alphabetical');
  const [editingItem, setEditingItem] = useState<MasterIngredient | null>(null);

  // Custom Category State inside modal
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryText, setCustomCategoryText] = useState('');

  // Custom Package Type State inside modal
  const [isCustomPackageType, setIsCustomPackageType] = useState(false);
  const [customPackageTypeText, setCustomPackageTypeText] = useState('');

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
    });
    setIsCustomCategory(false);
    setCustomCategoryText('');
    setIsCustomPackageType(false);
    setCustomPackageTypeText('');
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
        </div>
      </div>

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

              {/* Allergens warning badge */}
              {item.allergens && (
                <div className="inline-flex items-center gap-1 text-[11px] text-[#C97B63] dark:text-[#EAA89A] bg-[#FDF2F0] dark:bg-[#2C1916] px-2 py-1 rounded-md font-medium border border-[#F5D5CF] dark:border-[#4E2620] w-full truncate">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#C97B63]" />
                  <span className="truncate">Allergens: {item.allergens}</span>
                </div>
              )}
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
            <button
              onClick={handleCreateNew}
              className="text-[#D4A373] font-bold underline cursor-pointer"
            >
              Add an ingredient
            </button>
          </div>
        )}
      </div>

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
