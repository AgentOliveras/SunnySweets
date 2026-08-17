import React, { useState, useMemo } from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Box,
  Check,
  X,
  Search,
  Layers,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Cookie,
  PieChart,
  Croissant,
  Sparkles,
  Tag,
} from 'lucide-react';
import { ProductionPreset, WeightUnit, DEFAULT_PRESET_CATEGORIES, AccessRole } from '../types';
import { WEIGHT_UNITS } from '../utils/units';

interface PresetManagerProps {
  presets: ProductionPreset[];
  userRole?: AccessRole;
  onSavePreset: (preset: ProductionPreset) => void;
  onDeletePreset: (id: string) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  Cookies: '🍪',
  'Pie Dough': '🥧',
  'Base Dough': '🍞',
  Shortbread: '🧈',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  Cookies: 'Standard and jumbo cookie cases, drop cookies, and tray portions.',
  'Pie Dough': 'Single crust shells, double crust top/bottom sets, and hand pie rounds.',
  'Base Dough': 'Artisan loaves, sourdough batards, boules, and sheet pan focaccia tubs.',
  Shortbread: 'Delicate shortbread fingers, tart shells, and portioned rounds.',
};

export const PresetManager: React.FC<PresetManagerProps> = ({
  presets,
  userRole = 'owner',
  onSavePreset,
  onDeletePreset,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grouped' | 'grid'>('grouped');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [editingPreset, setEditingPreset] = useState<ProductionPreset | null>(null);
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(false);
  const [customCategoryInput, setCustomCategoryInput] = useState<string>('');

  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';

  // Compute all unique categories available
  const allCategories = useMemo(() => {
    const categoriesSet = new Set<string>(DEFAULT_PRESET_CATEGORIES);
    presets.forEach((p) => {
      if (p.category && p.category.trim()) {
        categoriesSet.add(p.category.trim());
      }
    });
    return Array.from(categoriesSet);
  }, [presets]);

  // Count presets per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: presets.length };
    allCategories.forEach((cat) => {
      counts[cat] = 0;
    });
    presets.forEach((p) => {
      const cat = p.category || 'Cookies';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [presets, allCategories]);

  // Filter presets based on category and search query
  const filteredPresets = useMemo(() => {
    return presets.filter((preset) => {
      const presetCat = preset.category || 'Cookies';
      const matchesCategory =
        selectedCategory === 'All' || presetCat.toLowerCase() === selectedCategory.toLowerCase();

      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        preset.name.toLowerCase().includes(query) ||
        presetCat.toLowerCase().includes(query) ||
        preset.unitName.toLowerCase().includes(query) ||
        (preset.expectedYield && preset.expectedYield.toLowerCase().includes(query));

      return matchesCategory && matchesSearch;
    });
  }, [presets, selectedCategory, searchQuery]);

  // Group filtered presets by category
  const groupedPresets = useMemo(() => {
    const groups: Record<string, ProductionPreset[]> = {};
    filteredPresets.forEach((preset) => {
      const cat = preset.category || 'Cookies';
      if (!groups[cat]) {
        groups[cat] = [];
      }
      groups[cat].push(preset);
    });
    return groups;
  }, [filteredPresets]);

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleCreateNew = () => {
    const defaultCat =
      selectedCategory !== 'All' && allCategories.includes(selectedCategory)
        ? selectedCategory
        : 'Cookies';

    setEditingPreset({
      id: `preset-${Date.now()}`,
      userId: '',
      name: '',
      category: defaultCat,
      finishedWeight: 4,
      weightUnit: 'oz',
      quantityPerUnit: 80,
      unitName: 'case',
      expectedYield: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setIsCustomCategory(false);
    setCustomCategoryInput('');
  };

  const handleOpenEdit = (preset: ProductionPreset) => {
    const cat = preset.category || 'Cookies';
    const isStandard = DEFAULT_PRESET_CATEGORIES.includes(cat as any);
    setEditingPreset({
      ...preset,
      category: cat,
    });
    setIsCustomCategory(!isStandard);
    setCustomCategoryInput(!isStandard ? cat : '');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPreset) return;
    if (!editingPreset.name.trim()) {
      alert('Please enter a preset name.');
      return;
    }

    const finalCategory = isCustomCategory
      ? customCategoryInput.trim() || 'Other'
      : editingPreset.category || 'Cookies';

    const presetToSave: ProductionPreset = {
      ...editingPreset,
      category: finalCategory,
      updatedAt: new Date().toISOString(),
    };

    onSavePreset(presetToSave);
    setEditingPreset(null);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
              <Sliders className="w-6 h-6 text-[#D4A373]" />
              <span>Production Presets</span>
            </h2>
            <span className="bg-[#FAF7F2] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border border-[#EEECE8] dark:border-[#332F2B]">
              {presets.length} Presets
            </span>
          </div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Organize packaging specs grouped by bakery categories: Cookies, Pie Dough, Base Dough, and Shortbread.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl p-0.5">
            <button
              type="button"
              id="preset-view-grouped-btn"
              onClick={() => setViewMode('grouped')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'grouped'
                  ? 'bg-[#5A534B] text-white shadow-xs'
                  : 'text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1]'
              }`}
              title="Group by Category"
            >
              <Layers className="w-4 h-4" />
              <span className="hidden md:inline">Grouped</span>
            </button>
            <button
              type="button"
              id="preset-view-grid-btn"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-[#5A534B] text-white shadow-xs'
                  : 'text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1]'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden md:inline">Grid</span>
            </button>
          </div>

          {isEditorOrOwner && (
            <button
              id="preset-add-btn"
              onClick={handleCreateNew}
              className="inline-flex items-center justify-center gap-2 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 py-2 rounded-xl text-sm transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Preset</span>
            </button>
          )}
        </div>
      </div>

      {/* Category Navigation Bar & Search */}
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8B7E74] dark:text-[#A39E93] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              id="preset-search-input"
              placeholder="Search presets by name, yield, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs md:text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A39E93] hover:text-[#5A534B] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 scrollbar-thin">
          <button
            type="button"
            id="preset-cat-all"
            onClick={() => setSelectedCategory('All')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
              selectedCategory === 'All'
                ? 'bg-[#5A534B] text-white shadow-xs'
                : 'bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#D4CEC7] border border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
            }`}
          >
            <span>All Categories</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                selectedCategory === 'All'
                  ? 'bg-white/20 text-white'
                  : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] dark:text-[#A39E93]'
              }`}
            >
              {categoryCounts['All'] || 0}
            </span>
          </button>

          {allCategories.map((cat) => {
            const isSelected = selectedCategory === cat;
            const icon = CATEGORY_ICONS[cat] || '📦';
            const count = categoryCounts[cat] || 0;

            return (
              <button
                key={cat}
                type="button"
                id={`preset-cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#D4A373] text-white shadow-xs'
                    : 'bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#D4CEC7] border border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
                }`}
              >
                <span>{icon}</span>
                <span>{cat}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] dark:text-[#A39E93]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty State */}
      {filteredPresets.length === 0 && (
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#D4A373] flex items-center justify-center mx-auto">
            <Sliders className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
            No Presets Found
          </h3>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] max-w-sm mx-auto">
            {searchQuery
              ? `No presets matched "${searchQuery}" in ${selectedCategory === 'All' ? 'any category' : selectedCategory}.`
              : `No presets currently exist in the "${selectedCategory}" category.`}
          </p>
          {isEditorOrOwner && (
            <button
              onClick={handleCreateNew}
              className="inline-flex items-center gap-2 bg-[#D4A373] text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create {selectedCategory !== 'All' ? `${selectedCategory} Preset` : 'New Preset'}</span>
            </button>
          )}
        </div>
      )}

      {/* Grouped View */}
      {viewMode === 'grouped' && filteredPresets.length > 0 && (
        <div className="space-y-6">
          {(Object.entries(groupedPresets) as [string, ProductionPreset[]][]).map(([category, items]) => {
            const isCollapsed = collapsedCategories[category];
            const icon = CATEGORY_ICONS[category] || '📦';
            const desc = CATEGORY_DESCRIPTIONS[category];

            return (
              <div
                key={category}
                id={`preset-group-${category.toLowerCase().replace(/\s+/g, '-')}`}
                className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl overflow-hidden shadow-xs"
              >
                {/* Group Category Header */}
                <div
                  onClick={() => toggleCategoryCollapse(category)}
                  className="p-4 bg-[#FAF7F2] dark:bg-[#25221F] border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between cursor-pointer select-none hover:bg-[#F5EFE6] dark:hover:bg-[#2B2723] transition"
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="p-1 rounded-lg text-[#8B7E74] dark:text-[#A39E93]"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-center text-base shadow-2xs">
                      {icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                          {category}
                        </h3>
                        <span className="bg-white dark:bg-[#1E1B18] text-[#D4A373] text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border border-[#EEECE8] dark:border-[#332F2B]">
                          {items.length} {items.length === 1 ? 'Preset' : 'Presets'}
                        </span>
                      </div>
                      {desc && (
                        <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                          {desc}
                        </p>
                      )}
                    </div>
                  </div>

                  {isEditorOrOwner && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPreset({
                          id: `preset-${Date.now()}`,
                          userId: '',
                          name: '',
                          category,
                          finishedWeight: 4,
                          weightUnit: 'oz',
                          quantityPerUnit: 80,
                          unitName: 'case',
                          expectedYield: '',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        });
                        setIsCustomCategory(false);
                      }}
                      className="text-xs text-[#5A534B] dark:text-[#D4CEC7] hover:text-[#D4A373] font-bold inline-flex items-center gap-1 bg-white dark:bg-[#1E1B18] px-2.5 py-1 rounded-lg border border-[#EEECE8] dark:border-[#332F2B] transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to {category}</span>
                    </button>
                  )}
                </div>

                {/* Group Body */}
                {!isCollapsed && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        preset={preset}
                        isEditorOrOwner={isEditorOrOwner}
                        onEdit={() => handleOpenEdit(preset)}
                        onDelete={() => onDeletePreset(preset.id)}
                        onFilterCategory={(cat) => setSelectedCategory(cat)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Grid View (Flat) */}
      {viewMode === 'grid' && filteredPresets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPresets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              isEditorOrOwner={isEditorOrOwner}
              onEdit={() => handleOpenEdit(preset)}
              onDelete={() => onDeletePreset(preset.id)}
              onFilterCategory={(cat) => setSelectedCategory(cat)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Preset Modal */}
      {editingPreset && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between bg-[#FAF7F2] dark:bg-[#25221F]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-center text-[#D4A373]">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                    {editingPreset.id.includes('preset-') && !presets.find((p) => p.id === editingPreset.id)
                      ? 'Create Production Preset'
                      : 'Edit Production Preset'}
                  </h3>
                  <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                    Configure batch scaling specifications and packaging group.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingPreset(null)}
                className="p-1.5 text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] rounded-lg cursor-pointer transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              {/* Category Selector */}
              <div>
                <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] mb-1.5">
                  Category Group *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  {DEFAULT_PRESET_CATEGORIES.map((cat) => {
                    const isSelected = !isCustomCategory && editingPreset.category === cat;
                    const icon = CATEGORY_ICONS[cat];
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setIsCustomCategory(false);
                          setEditingPreset({ ...editingPreset, category: cat });
                        }}
                        className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 cursor-pointer ${
                          isSelected
                            ? 'bg-[#FAF7F2] dark:bg-[#25221F] border-[#D4A373] text-[#5A534B] dark:text-[#EAE6E1] shadow-2xs'
                            : 'bg-white dark:bg-[#1E1B18] border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] hover:border-[#D4A373]'
                        }`}
                      >
                        <span className="text-base">{icon}</span>
                        <span>{cat}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomCategory(!isCustomCategory);
                      if (!isCustomCategory && !customCategoryInput) {
                        setCustomCategoryInput('');
                      }
                    }}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer flex items-center gap-1.5 ${
                      isCustomCategory
                        ? 'bg-[#D4A373] text-white border-[#D4A373]'
                        : 'bg-[#FAF7F2] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] hover:text-[#5A534B]'
                    }`}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>+ Custom Category</span>
                  </button>

                  {isCustomCategory && (
                    <input
                      type="text"
                      required
                      placeholder="e.g., Tart Dough, Brioche, Viennoiserie"
                      value={customCategoryInput}
                      onChange={(e) => setCustomCategoryInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  )}
                </div>
              </div>

              {/* Preset Name */}
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Preset Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., 4 oz Jumbo Cookie Case"
                  value={editingPreset.name}
                  onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Finished Item Weight *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    value={editingPreset.finishedWeight}
                    onChange={(e) =>
                      setEditingPreset({
                        ...editingPreset,
                        finishedWeight: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Weight Unit *
                  </label>
                  <select
                    value={editingPreset.weightUnit}
                    onChange={(e) =>
                      setEditingPreset({
                        ...editingPreset,
                        weightUnit: e.target.value as WeightUnit,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer"
                  >
                    {WEIGHT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Pieces per Unit / Packaging *
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={editingPreset.quantityPerUnit}
                    onChange={(e) =>
                      setEditingPreset({
                        ...editingPreset,
                        quantityPerUnit: parseInt(e.target.value, 10) || 1,
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Packaging Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., case, tray, box, rack, tub"
                    value={editingPreset.unitName}
                    onChange={(e) => setEditingPreset({ ...editingPreset, unitName: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Optional Target Yield Description
                </label>
                <input
                  type="text"
                  placeholder="e.g., 80 cookies @ 4 oz each"
                  value={editingPreset.expectedYield || ''}
                  onChange={(e) =>
                    setEditingPreset({ ...editingPreset, expectedYield: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              <div className="pt-4 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingPreset(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#D4A373] dark:hover:bg-[#C49363] rounded-xl shadow-sm cursor-pointer"
                >
                  Save Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface PresetCardProps {
  preset: ProductionPreset;
  isEditorOrOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onFilterCategory: (cat: string) => void;
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isEditorOrOwner,
  onEdit,
  onDelete,
  onFilterCategory,
}) => {
  const category = preset.category || 'Cookies';
  const icon = CATEGORY_ICONS[category] || '📦';

  return (
    <div
      id={`preset-card-${preset.id}`}
      className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={() => onFilterCategory(category)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-xs font-bold text-[#5A534B] dark:text-[#D4CEC7] hover:border-[#D4A373] transition cursor-pointer"
            title={`Filter by ${category}`}
          >
            <span>{icon}</span>
            <span>{category}</span>
          </button>

          <span className="text-xs font-bold text-[#D4A373] bg-[#FAF7F2] dark:bg-[#25221F] px-2.5 py-1 rounded-full border border-[#EEECE8] dark:border-[#332F2B] font-mono">
            {preset.finishedWeight} {preset.weightUnit.toUpperCase()} / item
          </span>
        </div>

        <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1] mb-1">
          {preset.name}
        </h3>
        <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mb-3">
          <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
            {preset.quantityPerUnit} pieces
          </span>{' '}
          per {preset.unitName}
        </p>

        {preset.expectedYield && (
          <div className="text-[11px] text-[#5A534B] dark:text-[#D4CEC7] bg-[#FAF7F2] dark:bg-[#25221F] p-2.5 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] mb-3">
            <span className="font-bold text-[#8B7E74]">Target Yield: </span>
            {preset.expectedYield}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[#EEECE8] dark:border-[#332F2B] text-xs">
        <span className="text-[10px] text-[#A39E93] font-mono uppercase">
          Pack: {preset.unitName}
        </span>

        {isEditorOrOwner && (
          <div className="flex items-center gap-1">
            <button
              id={`preset-edit-btn-${preset.id}`}
              onClick={onEdit}
              className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer"
              title="Edit preset"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              id={`preset-delete-btn-${preset.id}`}
              onClick={() => {
                if (confirm(`Delete preset "${preset.name}"?`)) {
                  onDelete();
                }
              }}
              className="p-1.5 text-[#C97B63] hover:text-red-700 hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
              title="Delete preset"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
