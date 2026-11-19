import React, { useState, useMemo } from 'react';
import {
  Link2,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Layers,
  ArrowRight,
  Info,
  ShieldAlert,
  RotateCcw,
  BookOpen,
} from 'lucide-react';
import { Recipe, MasterIngredient, AccessRole } from '../types';
import {
  calculateLinkingStats,
  collectFormulaLineOccurrences,
  groupOccurrencesByName,
  FormulaLineOccurrence,
  GroupedIngredientOccurrence,
} from '../services/masterIngredientLinking';
import { IngredientLinkSelectorModal } from './IngredientLinkSelectorModal';

interface IngredientLinkingReviewProps {
  recipes: Recipe[];
  masterIngredients: MasterIngredient[];
  userRole?: AccessRole;
  onLinkIngredient: (recipeId: string, ingredientId: string, masterIngredientId: string) => Promise<void>;
  onUnlinkIngredient: (recipeId: string, ingredientId: string) => Promise<void>;
  onBulkLinkGroup: (ingredientName: string, masterIngredientId: string) => Promise<{ affectedCount: number }>;
  onBackToPantry?: () => void;
}

type FilterStatus = 'all' | 'unlinked' | 'linked' | 'exact_match' | 'needs_review';
type ViewMode = 'grouped' | 'lines';

export const IngredientLinkingReview: React.FC<IngredientLinkingReviewProps> = ({
  recipes,
  masterIngredients,
  userRole = 'owner',
  onLinkIngredient,
  onUnlinkIngredient,
  onBulkLinkGroup,
  onBackToPantry,
}) => {
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedRecipeFilter, setSelectedRecipeFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Modal State for Single Linking / Repairing
  const [modalTarget, setModalTarget] = useState<{
    recipeId: string;
    recipeName: string;
    ingredientId: string;
    ingredientName: string;
    currentMasterIngredientId?: string;
  } | null>(null);

  // Confirmation Dialog for Bulk Linking
  const [bulkConfirmTarget, setBulkConfirmTarget] = useState<{
    displayName: string;
    affectedCount: number;
    masterIngredient: MasterIngredient;
  } | null>(null);

  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Derived Dynamic Statistics
  const stats = useMemo(() => {
    return calculateLinkingStats(recipes, masterIngredients);
  }, [recipes, masterIngredients]);

  // Derived Occurrences
  const allOccurrences = useMemo(() => {
    return collectFormulaLineOccurrences(recipes, masterIngredients);
  }, [recipes, masterIngredients]);

  // Derived Groups
  const allGroups = useMemo(() => {
    return groupOccurrencesByName(allOccurrences, masterIngredients);
  }, [allOccurrences, masterIngredients]);

  // Filtered Groups
  const filteredGroups = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();

    return allGroups.filter((group) => {
      // Recipe filter check
      if (selectedRecipeFilter !== 'ALL') {
        const hasRecipe = group.occurrences.some((o) => o.recipeId === selectedRecipeFilter);
        if (!hasRecipe) return false;
      }

      // Search check
      if (query) {
        const matchesName = group.displayName.toLowerCase().includes(query);
        const matchesLinked = group.occurrences.some((o) =>
          o.linkedMasterIngredient?.name.toLowerCase().includes(query)
        );
        const matchesSuggestion = group.suggestedMasterIngredient?.name.toLowerCase().includes(query);
        if (!matchesName && !matchesLinked && !matchesSuggestion) return false;
      }

      // Status check
      if (filterStatus === 'unlinked') {
        return group.unlinkedCount > 0;
      }
      if (filterStatus === 'linked') {
        return group.allLinked;
      }
      if (filterStatus === 'exact_match') {
        return group.suggestionConfidence === 'exact' && group.unlinkedCount > 0;
      }
      if (filterStatus === 'needs_review') {
        return group.brokenCount > 0 || (group.suggestionConfidence === 'none' && group.unlinkedCount > 0);
      }

      return true;
    });
  }, [allGroups, searchTerm, selectedRecipeFilter, filterStatus]);

  // Filtered Individual Lines
  const filteredOccurrences = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();

    return allOccurrences.filter((occ) => {
      if (selectedRecipeFilter !== 'ALL' && occ.recipeId !== selectedRecipeFilter) {
        return false;
      }

      if (query) {
        const matchesName = occ.ingredientName.toLowerCase().includes(query);
        const matchesRecipe = occ.recipeName.toLowerCase().includes(query);
        const matchesLinked = occ.linkedMasterIngredient?.name.toLowerCase().includes(query);
        const matchesSuggestion = occ.suggestion?.masterIngredient.name.toLowerCase().includes(query);
        if (!matchesName && !matchesRecipe && !matchesLinked && !matchesSuggestion) return false;
      }

      if (filterStatus === 'unlinked') {
        return !occ.masterIngredientId;
      }
      if (filterStatus === 'linked') {
        return Boolean(occ.masterIngredientId && !occ.isBroken);
      }
      if (filterStatus === 'exact_match') {
        return !occ.masterIngredientId && occ.suggestion?.confidence === 'exact';
      }
      if (filterStatus === 'needs_review') {
        return occ.isBroken || (!occ.masterIngredientId && !occ.suggestion);
      }

      return true;
    });
  }, [allOccurrences, searchTerm, selectedRecipeFilter, filterStatus]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleExecuteBulkLink = async () => {
    if (!bulkConfirmTarget || !isEditorOrOwner) return;
    setBulkLoading(true);
    setStatusMessage(null);
    try {
      const res = await onBulkLinkGroup(
        bulkConfirmTarget.displayName,
        bulkConfirmTarget.masterIngredient.id
      );
      setStatusMessage(
        `Successfully linked ${res.affectedCount} occurrence(s) of "${bulkConfirmTarget.displayName}" to "${bulkConfirmTarget.masterIngredient.name}".`
      );
      setBulkConfirmTarget(null);
    } catch (err: any) {
      alert(`Error linking group: ${err.message}`);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#1E1B18] p-5 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center font-bold">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-stone-900 dark:text-stone-100 font-serif">
                Master Ingredient Linking
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Authoritative mapping of recipe formula lines to Master Ingredients (Management Mode)
              </p>
            </div>
          </div>
        </div>

        {onBackToPantry && (
          <button
            type="button"
            onClick={onBackToPantry}
            className="px-4 py-2 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-xl text-xs font-semibold cursor-pointer transition shrink-0 self-start sm:self-auto"
          >
            ← Back to Pantry
          </button>
        )}
      </div>

      {/* Role Notice for Viewer */}
      {!isEditorOrOwner && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            <strong>Read-Only Access:</strong> You are viewing this workspace as a Viewer. Only Workspace Owners and Editors can create, modify, or remove ingredient links.
          </span>
        </div>
      )}

      {/* Success Status Notice */}
      {statusMessage && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl flex items-center justify-between gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-stone-400 hover:text-stone-600 cursor-pointer font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Dynamic Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-[#1E1B18] p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-stone-500 dark:text-stone-400 block tracking-wider">
            Total Formula Lines
          </span>
          <span className="text-xl font-bold font-mono text-stone-900 dark:text-stone-100 mt-1 block">
            {stats.totalFormulaLines}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">
            {stats.activeFormulaLines} active • {stats.archivedFormulaLines} sample/archived
          </span>
        </div>

        <div className="bg-white dark:bg-[#1E1B18] p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 block tracking-wider">
            Linked Lines
          </span>
          <span className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1 block">
            {stats.linkedFormulaLines}
          </span>
          <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 block mt-0.5">
            {stats.percentageLinked}% complete
          </span>
        </div>

        <div className="bg-white dark:bg-[#1E1B18] p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-stone-500 dark:text-stone-400 block tracking-wider">
            Unlinked Lines
          </span>
          <span className="text-xl font-bold font-mono text-stone-800 dark:text-stone-200 mt-1 block">
            {stats.unlinkedFormulaLines}
          </span>
          <span className="text-[10px] text-stone-400 block mt-0.5">
            Require verification
          </span>
        </div>

        <div className="bg-white dark:bg-[#1E1B18] p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400 block tracking-wider">
            Exact Suggestions
          </span>
          <span className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1 block">
            {stats.exactMatchSuggestions}
          </span>
          <span className="text-[10px] text-amber-600/80 block mt-0.5">
            Ready for operator review
          </span>
        </div>

        <div className="bg-white dark:bg-[#1E1B18] p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-400 block tracking-wider">
            Broken Links
          </span>
          <span className="text-xl font-bold font-mono text-rose-700 dark:text-rose-400 mt-1 block">
            {stats.brokenLinks}
          </span>
          <span className="text-[10px] text-rose-600/80 block mt-0.5">
            {stats.brokenLinks === 0 ? 'Zero orphaned links' : 'Action required'}
          </span>
        </div>

        <div className="bg-white dark:bg-[#1E1B18] p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs">
          <span className="text-[10px] uppercase font-bold text-stone-500 dark:text-stone-400 block tracking-wider">
            Inventory Readiness
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                stats.isInventoryReady
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
              }`}
            >
              {stats.isInventoryReady ? 'Ready' : 'Not Ready'}
            </span>
          </div>
          <span className="text-[10px] text-stone-400 block mt-0.5">
            {stats.isInventoryReady ? 'All formula lines linked' : 'Requires 100% active links'}
          </span>
        </div>
      </div>

      {/* Filters & View Mode Bar */}
      <div className="bg-white dark:bg-[#1E1B18] p-4 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by ingredient name, recipe, or linked master ingredient..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl focus:border-amber-500 focus:outline-none dark:text-stone-100"
            />
          </div>

          {/* Recipe Selector */}
          <div className="w-full md:w-64">
            <select
              value={selectedRecipeFilter}
              onChange={(e) => setSelectedRecipeFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl focus:border-amber-500 focus:outline-none dark:text-stone-200"
            >
              <option value="ALL">All Recipes ({recipes.length})</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} {r.archived ? '(Archived)' : ''} ({r.ingredients.length} items)
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center p-1 bg-stone-100 dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'grouped'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Grouped Review ({allGroups.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('lines')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'lines'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Individual Lines ({allOccurrences.length})</span>
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-stone-100 dark:border-stone-800/60 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('unlinked')}
            className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
              filterStatus === 'unlinked'
                ? 'bg-amber-600 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            Unlinked Only ({stats.unlinkedFormulaLines})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('exact_match')}
            className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
              filterStatus === 'exact_match'
                ? 'bg-amber-600 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            Exact Suggestions ({stats.exactMatchSuggestions})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('linked')}
            className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
              filterStatus === 'linked'
                ? 'bg-emerald-700 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            Linked Only ({stats.linkedFormulaLines})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('needs_review')}
            className={`px-3 py-1 rounded-full font-medium transition cursor-pointer ${
              filterStatus === 'needs_review'
                ? 'bg-rose-700 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200'
            }`}
          >
            Needs Review / Broken ({stats.brokenLinks})
          </button>
        </div>
      </div>

      {/* GROUPED VIEW */}
      {viewMode === 'grouped' && (
        <div className="space-y-3">
          {filteredGroups.length === 0 ? (
            <div className="bg-white dark:bg-[#1E1B18] p-8 rounded-2xl border border-stone-200 dark:border-stone-800 text-center text-stone-500 text-xs">
              No ingredient groups match your filters.
            </div>
          ) : (
            filteredGroups.map((group) => {
              const isExpanded = expandedGroups.has(group.normalizedName);
              const hasExactSuggestion = group.suggestionConfidence === 'exact' && group.suggestedMasterIngredient;
              const hasLikelySuggestion = group.suggestionConfidence === 'likely' && group.suggestedMasterIngredient;

              return (
                <div
                  key={group.normalizedName}
                  className="bg-white dark:bg-[#1E1B18] rounded-2xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition"
                >
                  <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-stone-50/50 dark:bg-stone-900/30">
                    <div className="flex items-start md:items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.normalizedName)}
                        className="p-1 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer mt-0.5 md:mt-0"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 font-serif">
                            {group.displayName}
                          </h3>
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                            {group.count} occurrence{group.count > 1 ? 's' : ''}
                          </span>

                          {group.brokenCount > 0 && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {group.brokenCount} Broken Link{group.brokenCount > 1 ? 's' : ''}
                            </span>
                          )}

                          {group.allLinked ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              All Linked ({group.linkedCount}/{group.count})
                            </span>
                          ) : group.anyLinked ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Partially Linked ({group.linkedCount}/{group.count})
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400">
                              0/{group.count} Linked
                            </span>
                          )}
                        </div>

                        {/* Suggestion Indicator */}
                        {group.unlinkedCount > 0 && group.suggestedMasterIngredient && (
                          <div className="flex items-center gap-2 mt-1 text-xs">
                            <span className="text-stone-500 dark:text-stone-400">Suggested Master:</span>
                            <span className="font-semibold text-stone-900 dark:text-stone-100">
                              {group.suggestedMasterIngredient.name}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.2 rounded-full ${
                                group.suggestionConfidence === 'exact'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {group.suggestionConfidence === 'exact' ? 'Exact Match' : 'Likely Match'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end md:self-auto">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.normalizedName)}
                        className="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 cursor-pointer font-medium"
                      >
                        {isExpanded ? 'Hide Lines' : 'Review Occurrences'}
                      </button>

                      {isEditorOrOwner && group.unlinkedCount > 0 && group.suggestedMasterIngredient && (
                        <button
                          type="button"
                          onClick={() => {
                            setBulkConfirmTarget({
                              displayName: group.displayName,
                              affectedCount: group.unlinkedCount,
                              masterIngredient: group.suggestedMasterIngredient!,
                            });
                          }}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Link All {group.unlinkedCount}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Recipe Occurrences List */}
                  {isExpanded && (
                    <div className="p-4 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-[#1E1B18] space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 pb-1">
                        Recipe Occurrences ({group.occurrences.length}):
                      </div>

                      <div className="divide-y divide-stone-100 dark:divide-stone-800/60 max-h-80 overflow-y-auto pr-2">
                        {group.occurrences.map((occ) => (
                          <div
                            key={`${occ.recipeId}-${occ.ingredientIndex}`}
                            className="py-2 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-stone-800 dark:text-stone-200">
                                {occ.recipeName}
                              </span>
                              {occ.recipeArchived && (
                                <span className="text-[10px] bg-stone-100 dark:bg-stone-800 text-stone-500 px-1.5 py-0.5 rounded font-mono">
                                  Archived
                                </span>
                              )}
                              <span className="text-stone-400 font-mono">
                                • {occ.quantity} {occ.unit}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {occ.isBroken ? (
                                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  Broken Link
                                </span>
                              ) : occ.linkedMasterIngredient ? (
                                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {occ.linkedMasterIngredient.name}
                                </span>
                              ) : (
                                <span className="text-[10px] text-stone-400 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                                  Unlinked
                                </span>
                              )}

                              {isEditorOrOwner && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setModalTarget({
                                      recipeId: occ.recipeId,
                                      recipeName: occ.recipeName,
                                      ingredientId: occ.ingredientId,
                                      ingredientName: occ.ingredientName,
                                      currentMasterIngredientId: occ.masterIngredientId,
                                    })
                                  }
                                  className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer ml-2 hover:underline"
                                >
                                  {occ.masterIngredientId ? 'Change' : 'Link'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* INDIVIDUAL FORMULA LINES VIEW */}
      {viewMode === 'lines' && (
        <div className="bg-white dark:bg-[#1E1B18] rounded-2xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50 dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 text-stone-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Recipe</th>
                  <th className="py-3 px-4">Formula Line</th>
                  <th className="py-3 px-4 font-mono">Quantity</th>
                  <th className="py-3 px-4">Linking Status</th>
                  <th className="py-3 px-4">Suggestion</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800/60">
                {filteredOccurrences.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-stone-500">
                      No formula lines match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredOccurrences.map((occ) => (
                    <tr
                      key={`${occ.recipeId}-${occ.ingredientIndex}`}
                      className="hover:bg-stone-50/60 dark:hover:bg-stone-900/40 transition"
                    >
                      <td className="py-2.5 px-4 font-semibold text-stone-900 dark:text-stone-100">
                        {occ.recipeName}
                        {occ.recipeArchived && (
                          <span className="ml-1 text-[9px] bg-stone-100 dark:bg-stone-800 text-stone-500 px-1 py-0.2 rounded font-mono">
                            Archived
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-medium text-stone-800 dark:text-stone-200">
                        {occ.ingredientName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-stone-600 dark:text-stone-400">
                        {occ.quantity} {occ.unit}
                      </td>
                      <td className="py-2.5 px-4">
                        {occ.isBroken ? (
                          <span className="inline-flex items-center gap-1 font-bold text-rose-700 dark:text-rose-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            BROKEN LINK
                          </span>
                        ) : occ.linkedMasterIngredient ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {occ.linkedMasterIngredient.name}
                          </span>
                        ) : (
                          <span className="text-stone-400 italic">Not Linked</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        {occ.suggestion ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-stone-800 dark:text-stone-200">
                              {occ.suggestion.masterIngredient.name}
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded-full ${
                                occ.suggestion.confidence === 'exact'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {occ.suggestion.confidence === 'exact' ? 'Exact' : 'Likely'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {isEditorOrOwner ? (
                          <button
                            type="button"
                            onClick={() =>
                              setModalTarget({
                                recipeId: occ.recipeId,
                                recipeName: occ.recipeName,
                                ingredientId: occ.ingredientId,
                                ingredientName: occ.ingredientName,
                                currentMasterIngredientId: occ.masterIngredientId,
                              })
                            }
                            className="px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/60 rounded-lg cursor-pointer transition"
                          >
                            {occ.isBroken ? 'Repair' : occ.masterIngredientId ? 'Change' : 'Link'}
                          </button>
                        ) : (
                          <span className="text-stone-400 text-[10px]">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bulk Link Explicit Confirmation Modal */}
      {bulkConfirmTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-[#1C1917] w-full max-w-lg rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                  Confirm Grouped Ingredient Linking
                </h3>
                <p className="text-xs text-stone-500">Explicit operator confirmation required</p>
              </div>
            </div>

            <div className="p-4 bg-stone-50 dark:bg-stone-900/80 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-stone-500">Ingredient Name:</span>
                <span className="font-bold text-stone-900 dark:text-stone-100">
                  "{bulkConfirmTarget.displayName}"
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Target Master Ingredient:</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {bulkConfirmTarget.masterIngredient.name}
                </span>
              </div>
              <div className="flex justify-between border-t border-stone-200 dark:border-stone-800 pt-2">
                <span className="text-stone-500">Recipe Lines Affected:</span>
                <span className="font-mono font-bold text-stone-900 dark:text-stone-100">
                  {bulkConfirmTarget.affectedCount} formula line(s)
                </span>
              </div>
            </div>

            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Formula Immutability: This will link the relationship across all {bulkConfirmTarget.affectedCount} occurrences. No recipe names, quantities, units, or yield calculations will be changed.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => setBulkConfirmTarget(null)}
                className="px-4 py-2 text-xs font-medium text-stone-600 hover:text-stone-800 dark:text-stone-400 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkLoading}
                onClick={handleExecuteBulkLink}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition shadow-xs"
              >
                {bulkLoading ? 'Linking...' : `Confirm All ${bulkConfirmTarget.affectedCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Link Selector Modal */}
      {modalTarget && (
        <IngredientLinkSelectorModal
          isOpen={Boolean(modalTarget)}
          onClose={() => setModalTarget(null)}
          recipeName={modalTarget.recipeName}
          ingredientName={modalTarget.ingredientName}
          currentMasterIngredientId={modalTarget.currentMasterIngredientId}
          masterIngredients={masterIngredients}
          userRole={userRole}
          onConfirmLink={async (masterId) => {
            if (modalTarget) {
              await onLinkIngredient(
                modalTarget.recipeId,
                modalTarget.ingredientId,
                masterId
              );
              setModalTarget(null);
            }
          }}
          onUnlink={async () => {
            if (modalTarget) {
              await onUnlinkIngredient(
                modalTarget.recipeId,
                modalTarget.ingredientId
              );
              setModalTarget(null);
            }
          }}
        />
      )}
    </div>
  );
};
