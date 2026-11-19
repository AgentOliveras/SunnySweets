import React, { useState, useMemo, useRef } from 'react';
import { X, Search, Package, Box, Sparkles, Plus, AlertCircle, Check, Scale } from 'lucide-react';
import { ProductionPreset } from '../../types';
import { normalizePresetCategory } from '../../utils/calculator';
import { getTargetPresetCategoriesForRecipeCategory } from '../../utils/categoryPresetMapping';
import { isPresetEnabledForProduction } from '../../utils/productionOptionOrdering';
import { store } from '../../services/store';

export interface PackagingPresetSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  presets: ProductionPreset[];
  categoryHint?: string;
  workspaceId?: string;
  onSelectPreset: (preset: ProductionPreset) => void;
  onSelectCustom: () => void;
}

export const PackagingPresetSelectorModal: React.FC<PackagingPresetSelectorModalProps> = ({
  isOpen,
  onClose,
  presets,
  categoryHint,
  workspaceId,
  onSelectPreset,
  onSelectCustom,
}) => {
  const isSelectingRef = useRef(false);

  // Filter authorized presets by workspace and ensure normalized category
  const authorizedPresets = useMemo(() => {
    return presets
      .filter((p) => {
        if (p.workspaceId && workspaceId && p.workspaceId !== workspaceId) {
          return false;
        }
        return true;
      })
      .map((p) => {
        const normCat = normalizePresetCategory(p);
        return p.category === normCat ? p : { ...p, category: normCat };
      });
  }, [presets, workspaceId]);

  // Extract available categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    authorizedPresets.forEach((p) => {
      const cat = normalizePresetCategory(p);
      if (cat) set.add(cat);
    });
    return ['All', ...Array.from(set).sort()];
  }, [authorizedPresets]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    if (!categoryHint) return 'All';
    const hintClean = categoryHint.trim();
    const hintLower = hintClean.toLowerCase();

    // Check authoritative shared workspace categoryPresetMap
    try {
      const wsMap = store.getCategoryPresetMap(workspaceId);
      const targets = getTargetPresetCategoriesForRecipeCategory(hintClean, wsMap);
      if (targets.includes('All')) {
        return 'All';
      }
      const match = presets.find((p) =>
        targets.some((t) => t.toLowerCase() === normalizePresetCategory(p).toLowerCase())
      );
      if (match) return normalizePresetCategory(match);
    } catch (_) {}

    const match = presets.find(
      (p) => normalizePresetCategory(p).toLowerCase() === hintLower
    );
    return match ? normalizePresetCategory(match) : 'All';
  });

  // Filter presets by category and search query
  const filteredPresets = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return authorizedPresets.filter((p) => {
      const cat = normalizePresetCategory(p);
      const matchesCat =
        selectedCategory === 'All' || cat.toLowerCase() === selectedCategory.toLowerCase();
      if (!matchesCat) return false;

      if (!query) return true;

      const nameMatch = p.name.toLowerCase().includes(query);
      const catMatch = cat.toLowerCase().includes(query);
      const unitMatch = (p.unitName || '').toLowerCase().includes(query);
      const weightMatch = `${p.finishedWeight} ${p.weightUnit}`.toLowerCase().includes(query);

      return nameMatch || catMatch || unitMatch || weightMatch;
    });
  }, [authorizedPresets, selectedCategory, searchTerm]);

  if (!isOpen) return null;

  const handlePresetClick = (preset: ProductionPreset) => {
    if (isSelectingRef.current) return;
    // Check validity
    if (!preset.finishedWeight || preset.finishedWeight <= 0 || !preset.quantityPerUnit || preset.quantityPerUnit <= 0) {
      return;
    }
    isSelectingRef.current = true;
    const normalizedPreset: ProductionPreset = {
      ...preset,
      category: normalizePresetCategory(preset),
    };
    onSelectPreset(normalizedPreset);
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 400);
  };

  const handleCustomClick = () => {
    if (isSelectingRef.current) return;
    isSelectingRef.current = true;
    onSelectCustom();
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 400);
  };

  return (
    <div
      data-testid="packaging-preset-selector-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-stone-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-serif font-bold text-base sm:text-lg text-stone-900 dark:text-zinc-100 truncate">
                Select Packaging Preset
              </h3>
              <p className="text-xs text-stone-500 dark:text-zinc-400 truncate">
                Choose an authorized preset to configure portion size and case pack.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-600 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 border-b border-stone-200 dark:border-zinc-800 space-y-3 shrink-0 bg-stone-50/50 dark:bg-zinc-800/40">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              data-testid="preset-search-input"
              type="text"
              placeholder="Search packaging presets by name, category, or weight..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 focus:outline-hidden focus:ring-2 focus:ring-amber-500/50"
            />
          </div>

          {/* Category Chips */}
          {categories.length > 2 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-white dark:bg-zinc-900 text-stone-600 dark:text-zinc-400 hover:bg-stone-200/60 dark:hover:bg-zinc-800 border border-stone-200 dark:border-zinc-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Presets List */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 min-h-[220px]">
          {authorizedPresets.length === 0 ? (
            <div className="p-8 text-center space-y-3 my-auto">
              <Package className="w-10 h-10 text-stone-300 dark:text-zinc-600 mx-auto" />
              <div>
                <h4 className="text-sm font-bold text-stone-800 dark:text-zinc-200">
                  No Packaging Presets Available
                </h4>
                <p className="text-xs text-stone-500 dark:text-zinc-400 max-w-sm mx-auto mt-1">
                  No packaging presets are currently defined in this workspace. You can create a custom product size below.
                </p>
              </div>
              <button
                data-testid="create-custom-config-btn"
                type="button"
                onClick={handleCustomClick}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-xs cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Create Custom Product Size</span>
              </button>
            </div>
          ) : filteredPresets.length === 0 ? (
            <div className="p-8 text-center space-y-3 my-auto">
              <Search className="w-8 h-8 text-stone-300 dark:text-zinc-600 mx-auto" />
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                No presets found matching &quot;{searchTerm}&quot;
                {selectedCategory !== 'All' ? ` in category "${selectedCategory}"` : ''}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedCategory('All');
                }}
                className="text-xs font-bold text-amber-600 hover:underline cursor-pointer"
              >
                Clear Search & Category Filter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredPresets.map((preset) => {
                const isInvalid =
                  !preset.finishedWeight ||
                  preset.finishedWeight <= 0 ||
                  !preset.quantityPerUnit ||
                  preset.quantityPerUnit <= 0;

                const caseWeightApprox =
                  !isInvalid && preset.finishedWeight && preset.quantityPerUnit
                    ? (preset.finishedWeight * preset.quantityPerUnit).toFixed(1)
                    : null;

                return (
                  <div
                    key={preset.id}
                    data-testid={`preset-card-${preset.id}`}
                    onClick={() => !isInvalid && handlePresetClick(preset)}
                    className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      isInvalid
                        ? 'bg-stone-50 dark:bg-zinc-800/40 border-stone-200 dark:border-zinc-800 opacity-60 cursor-not-allowed'
                        : 'bg-white dark:bg-zinc-900 border-stone-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-sm cursor-pointer group'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-bold text-xs sm:text-sm text-stone-900 dark:text-zinc-100 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
                            {preset.name}
                          </h4>
                          {!isPresetEnabledForProduction(preset) && (
                            <p className="text-[10px] font-medium text-stone-500 dark:text-zinc-400 mt-0.5">
                              Hidden on Floor · Usable in Management
                            </p>
                          )}
                        </div>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 shrink-0">
                          {normalizePresetCategory(preset)}
                        </span>
                      </div>

                      <div className="mt-2.5 space-y-1 text-xs text-stone-600 dark:text-zinc-400">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-stone-400">Portion Size:</span>
                          <span className="font-bold text-stone-800 dark:text-zinc-200 font-mono">
                            {preset.finishedWeight} {preset.weightUnit}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-stone-400">Case Pack:</span>
                          <span className="font-bold text-stone-800 dark:text-zinc-200 font-mono">
                            {preset.quantityPerUnit} pcs / {preset.unitName || 'case'}
                          </span>
                        </div>
                        {caseWeightApprox && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-stone-400">Total Pack Weight:</span>
                            <span className="font-medium text-stone-500 dark:text-zinc-400 font-mono">
                              ~{caseWeightApprox} {preset.weightUnit}
                            </span>
                          </div>
                        )}
                      </div>

                      {isInvalid && (
                        <div className="mt-2 p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-[10px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Incomplete specifications (missing piece weight or case count).</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-zinc-800 flex items-center justify-end">
                      <button
                        data-testid={`select-preset-btn-${preset.id}`}
                        type="button"
                        disabled={isInvalid}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePresetClick(preset);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-600 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Select Preset
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with Custom Configuration option */}
        <div className="p-3 sm:p-4 border-t border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-800/50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            data-testid="create-custom-config-btn"
            type="button"
            onClick={handleCustomClick}
            className="text-xs font-semibold text-stone-600 dark:text-zinc-400 hover:text-amber-700 dark:hover:text-amber-400 inline-flex items-center gap-1.5 cursor-pointer order-2 sm:order-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Or configure custom size & pack manually</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold text-stone-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-stone-100 dark:hover:bg-zinc-700 border border-stone-200 dark:border-zinc-700 transition-colors cursor-pointer order-1 sm:order-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
