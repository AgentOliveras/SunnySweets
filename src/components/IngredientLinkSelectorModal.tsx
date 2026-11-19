import React, { useState, useMemo } from 'react';
import { Search, X, CheckCircle2, Link2, AlertTriangle, Sparkles, ArrowRight } from 'lucide-react';
import { MasterIngredient, AccessRole } from '../types';
import { findMatchSuggestion, MatchSuggestion } from '../services/masterIngredientLinking';

interface IngredientLinkSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipeName: string;
  ingredientName: string;
  currentMasterIngredientId?: string;
  masterIngredients: MasterIngredient[];
  userRole?: AccessRole;
  onConfirmLink: (masterIngredientId: string) => void;
  onUnlink?: () => void;
}

export const IngredientLinkSelectorModal: React.FC<IngredientLinkSelectorModalProps> = ({
  isOpen,
  onClose,
  recipeName,
  ingredientName,
  currentMasterIngredientId,
  masterIngredients,
  userRole = 'owner',
  onConfirmLink,
  onUnlink,
}) => {
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>(
    currentMasterIngredientId || ''
  );

  const suggestion: MatchSuggestion | null = useMemo(() => {
    return findMatchSuggestion(ingredientName, masterIngredients);
  }, [ingredientName, masterIngredients]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    masterIngredients.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return ['ALL', ...Array.from(cats).sort()];
  }, [masterIngredients]);

  const filteredMasterIngredients = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    return masterIngredients.filter((m) => {
      const matchesSearch =
        !query ||
        m.name.toLowerCase().includes(query) ||
        (m.category && m.category.toLowerCase().includes(query)) ||
        (m.brand && m.brand.toLowerCase().includes(query));
      const matchesCat = selectedCategory === 'ALL' || m.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [masterIngredients, searchTerm, selectedCategory]);

  const currentLinked = useMemo(() => {
    if (!currentMasterIngredientId) return null;
    return masterIngredients.find((m) => m.id === currentMasterIngredientId) || null;
  }, [currentMasterIngredientId, masterIngredients]);

  const isBroken = Boolean(currentMasterIngredientId && !currentLinked);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1C1917] w-full max-w-2xl rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between bg-stone-50/80 dark:bg-stone-900/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900 dark:text-stone-100">
                Link Master Ingredient
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Recipe: <span className="font-medium text-stone-700 dark:text-stone-300">{recipeName}</span>
                {' • '}
                Line: <span className="font-semibold text-stone-900 dark:text-stone-100 font-mono">"{ingredientName}"</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Linking Status Alert */}
        <div className="px-6 py-3 border-b border-stone-100 dark:border-stone-800/60 bg-stone-50/40 dark:bg-stone-900/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-stone-500 dark:text-stone-400">Status:</span>
            {isBroken ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                BROKEN LINK (ID: {currentMasterIngredientId})
              </span>
            ) : currentLinked ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Linked to {currentLinked.name}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                Unlinked
              </span>
            )}
          </div>

          {currentMasterIngredientId && onUnlink && isEditorOrOwner && (
            <button
              type="button"
              onClick={() => {
                onUnlink();
                onClose();
              }}
              className="text-rose-600 hover:text-rose-700 dark:text-rose-400 font-semibold hover:underline cursor-pointer"
            >
              Remove Link
            </button>
          )}
        </div>

        {/* Suggested Match Banner if exists and unlinked or different */}
        {suggestion && (!currentLinked || currentLinked.id !== suggestion.masterIngredient.id) && (
          <div className="mx-6 mt-4 p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                    Suggested: {suggestion.masterIngredient.name}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      suggestion.confidence === 'exact'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {suggestion.confidence === 'exact' ? 'Exact Match' : 'Likely Match'}
                  </span>
                </div>
                <p className="text-[11px] text-stone-600 dark:text-stone-400">
                  {suggestion.reason}
                  {suggestion.masterIngredient.category ? ` • Category: ${suggestion.masterIngredient.category}` : ''}
                </p>
              </div>
            </div>

            {isEditorOrOwner && (
              <button
                type="button"
                onClick={() => {
                  onConfirmLink(suggestion.masterIngredient.id);
                  onClose();
                }}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1"
              >
                <span>Confirm Link</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Search & Filters */}
        <div className="p-6 pb-2 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search master ingredients by name, brand, category..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl focus:border-amber-500 focus:outline-none dark:text-stone-100"
                autoFocus
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 text-xs bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl focus:border-amber-500 focus:outline-none dark:text-stone-200"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'ALL' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Master Ingredients List */}
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-1.5 divide-y divide-stone-100 dark:divide-stone-800/60">
          {filteredMasterIngredients.length === 0 ? (
            <div className="py-8 text-center text-xs text-stone-500">
              No Master Ingredients match your search.
            </div>
          ) : (
            filteredMasterIngredients.map((item) => {
              const isSelected = selectedIngredientId === item.id;
              const isCurrentlyLinked = currentMasterIngredientId === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => isEditorOrOwner && setSelectedIngredientId(item.id)}
                  className={`pt-2 pb-2 px-3 rounded-xl flex items-center justify-between cursor-pointer transition ${
                    isSelected
                      ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-900/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="selected_master"
                      checked={isSelected}
                      onChange={() => setSelectedIngredientId(item.id)}
                      disabled={!isEditorOrOwner}
                      className="accent-amber-600"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-stone-900 dark:text-stone-100">
                          {item.name}
                        </span>
                        {item.brand && (
                          <span className="text-xs text-stone-500 dark:text-stone-400">
                            ({item.brand})
                          </span>
                        )}
                        {isCurrentlyLinked && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Currently Linked
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                        {item.category && <span>Category: {item.category}</span>}
                        {item.defaultUnit && <span>• Unit: {item.defaultUnit}</span>}
                        {item.subIngredients && (
                          <span className="italic truncate max-w-xs">
                            • Contains: {item.subIngredients}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isEditorOrOwner && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfirmLink(item.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-amber-600 hover:text-white transition cursor-pointer"
                    >
                      Link This
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/80 flex items-center justify-between">
          <p className="text-[11px] text-stone-500 dark:text-stone-400 max-w-md">
            Formula Immutability: Linking links metadata only and will <strong>not</strong> modify formula quantities, units, or yield.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer"
            >
              Cancel
            </button>
            {isEditorOrOwner && (
              <button
                type="button"
                disabled={!selectedIngredientId || selectedIngredientId === currentMasterIngredientId}
                onClick={() => {
                  if (selectedIngredientId) {
                    onConfirmLink(selectedIngredientId);
                    onClose();
                  }
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition shadow-xs"
              >
                Confirm Link
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
