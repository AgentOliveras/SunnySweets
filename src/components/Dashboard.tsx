import React from 'react';
import {
  BookOpen,
  Calculator,
  History,
  Scale,
  Plus,
  ArrowRight,
  CheckCircle2,
  Clock,
  Play,
  FlaskConical,
  Sliders,
  Sparkles,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Recipe, ProductionPreset, Mixer, ProductionHistoryEntry, UserSettings } from '../types';
import { TabType } from './Navbar';
import { formatNumber } from '../utils/units';
import { calculateRecipeTotal } from '../utils/calculator';
import { store } from '../services/store';

interface DashboardProps {
  recipes: Recipe[];
  presets: ProductionPreset[];
  mixers: Mixer[];
  history: ProductionHistoryEntry[];
  settings: UserSettings;
  activeChecklist: any;
  setActiveTab: (tab: TabType) => void;
  onOpenRecipeModal: () => void;
  onOpenCalculatorWithRecipe?: (recipeId: string) => void;
  onResumeChecklist: (checklist: any) => void;
  onResetChecklist: () => void;
  onDeleteChecklist: () => void;
  onRunUnitTests: () => void;
  testPassedCount?: number;
}

export const Dashboard: React.FC<DashboardProps> = ({
  recipes,
  presets,
  mixers,
  history,
  settings,
  activeChecklist,
  setActiveTab,
  onOpenRecipeModal,
  onOpenCalculatorWithRecipe,
  onResumeChecklist,
  onResetChecklist,
  onDeleteChecklist,
  onRunUnitTests,
  testPassedCount,
}) => {
  const recentHistory = history.slice(0, 4);

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Hero Header Card */}
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] text-[#2D2926] dark:text-[#EAE6E1] rounded-xl p-6 md:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute -right-8 -bottom-8 opacity-[0.04] dark:opacity-[0.06] pointer-events-none text-[#5A534B]">
          <BookOpen className="w-72 h-72" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] px-3 py-1 rounded-full text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-3">
            <span>{store.getWorkspaceBranding().displayName || settings.businessName || 'Artisan Bakery Co.'}</span>
            <span>•</span>
            <span className="uppercase tracking-widest text-[#D4A373] font-bold">{settings.defaultWeightUnit} Base System</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-serif text-[#5A534B] dark:text-[#EAE6E1] mb-2 leading-tight">
            Production & Batch Scaling Hub
          </h2>
          <p className="text-[#8B7E74] dark:text-[#A39E93] text-sm md:text-base leading-relaxed mb-6">
            Scale formulas, manage mixer capacities, generate touch checklists, and export precise PDF production sheets.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              id="dashboard-start-calc-btn"
              onClick={() => setActiveTab('calculate')}
              className="inline-flex items-center gap-2 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-5 py-2.5 rounded-xl text-sm transition shadow-sm cursor-pointer"
            >
              <Calculator className="w-4 h-4" />
              <span>New Calculation</span>
            </button>
            <button
              id="dashboard-new-recipe-btn"
              onClick={onOpenRecipeModal}
              className="inline-flex items-center gap-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] dark:hover:bg-[#4A433D] text-white font-bold px-4 py-2.5 rounded-xl text-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Recipe</span>
            </button>
            <button
              id="dashboard-unit-tests-btn"
              onClick={onRunUnitTests}
              className="inline-flex items-center gap-2 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] hover:bg-[#EEECE8] font-bold px-3.5 py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              <FlaskConical className="w-3.5 h-3.5 text-[#D4A373]" />
              <span>Run Verification Suite {testPassedCount !== undefined ? `(${testPassedCount} Passed)` : ''}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Guided Mixing Alert Banner if checklist in progress */}
      {activeChecklist && (
        <div className="bg-[#F5F2ED] dark:bg-[#25221F] border border-[#D4A373] rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#D4A373] text-white flex items-center justify-center font-bold shrink-0">
              <Play className="w-5 h-5 ml-0.5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#D4A373]">
                  Mixing Session In Progress
                </span>
              </div>
              <h4 className="font-bold text-[#5A534B] dark:text-[#EAE6E1] text-base">
                {activeChecklist.recipeName}
              </h4>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Batch {activeChecklist.currentBatch || 1} of {activeChecklist.totalBatches || 1} • {activeChecklist.completedIngredientIds?.length || 0} ingredients checked
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
            <button
              id="dashboard-resume-checklist-btn"
              onClick={() => onResumeChecklist(activeChecklist)}
              className="bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Resume Checklist</span>
            </button>
            <button
              id="dashboard-reset-checklist-btn"
              onClick={onResetChecklist}
              title="Reset checklist progress to 0"
              className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#EEECE8] text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#8B7E74]" />
              <span>Reset</span>
            </button>
            <button
              id="dashboard-delete-checklist-btn"
              onClick={onDeleteChecklist}
              title="Delete session notification"
              className="bg-[#FDF2F0] dark:bg-[#2C1916] border border-[#F5D5CF] dark:border-[#4E2620] text-[#A65B48] dark:text-[#EAA89A] hover:bg-[#FADBD8] text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div
          onClick={() => setActiveTab('recipes')}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93]">Recipes</span>
            <BookOpen className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{recipes.length}</div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">Active formulas</p>
        </div>

        <div
          onClick={() => setActiveTab('presets')}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93]">Presets</span>
            <Sliders className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{presets.length}</div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">Packaging presets</p>
        </div>

        <div
          onClick={() => setActiveTab('mixers')}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93]">Mixers</span>
            <Scale className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{mixers.length}</div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">Equipment capacity</p>
        </div>

        <div
          onClick={() => setActiveTab('history')}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93]">History</span>
            <History className="w-4 h-4 text-[#D4A373]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{history.length}</div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">Saved batch runs</p>
        </div>
      </div>

      {/* Quick Launch Recent Recipes & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Recipes Column */}
        <div className="lg:col-span-2 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#5A534B] dark:text-[#EAE6E1] text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#D4A373]" />
              <span>Recent Recipes</span>
            </h3>
            <button
              id="dashboard-view-all-recipes-btn"
              onClick={() => setActiveTab('recipes')}
              className="text-xs text-[#D4A373] hover:underline font-bold flex items-center gap-1 cursor-pointer"
            >
              <span>View All ({recipes.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...recipes]
              .sort(
                (a, b) =>
                  new Date(b.updatedAt || b.createdAt).getTime() -
                  new Date(a.updatedAt || a.createdAt).getTime()
              )
              .slice(0, 5)
              .map((recipe) => (
                <div
                  key={recipe.id}
                  id={`recipe-quick-card-${recipe.id}`}
                  onClick={() => {
                    if (onOpenCalculatorWithRecipe) {
                      onOpenCalculatorWithRecipe(recipe.id);
                    } else {
                      setActiveTab('calculate');
                    }
                  }}
                  className="group p-4 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] bg-[#F9F8F6] dark:bg-[#25221F] hover:border-[#D4A373] transition cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-serif font-semibold text-[#5A534B] dark:text-[#EAE6E1] group-hover:text-[#D4A373] transition text-base leading-snug">
                        {recipe.name}
                      </h4>
                      {recipe.category && (
                        <span className="shrink-0 px-2 py-0.5 bg-[#F5F2ED] dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] rounded text-[10px] font-bold">
                          {recipe.category}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] line-clamp-2 mt-1">
                      {recipe.description || 'Standard bakery formulation'}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between text-xs text-[#8B7E74] dark:text-[#A39E93]">
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span>{recipe.ingredients.length} items</span>
                      <span>•</span>
                      <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                        {calculateRecipeTotal(recipe, settings.defaultWeightUnit, settings.decimalPlaces).formattedTargetUnit}{' '}
                        {settings.defaultWeightUnit}
                      </span>
                    </div>
                    <span className="font-bold text-[#D4A373] flex items-center gap-1 group-hover:translate-x-0.5 transition">
                      <span>Calculate</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Recent Activity Log */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#5A534B] dark:text-[#EAE6E1] text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#D4A373]" />
              <span>Recent Production Runs</span>
            </h3>
          </div>

          {recentHistory.length === 0 ? (
            <div className="text-center py-8 text-[#A39E93] text-xs space-y-2">
              <p>No production sheets saved yet.</p>
              <button
                onClick={() => setActiveTab('calculate')}
                className="text-[#D4A373] font-bold underline cursor-pointer"
              >
                Create your first calculation
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {recentHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] bg-[#F9F8F6] dark:bg-[#25221F] flex items-start justify-between"
                >
                  <div>
                    <h5 className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">{item.recipeName}</h5>
                    <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                      {item.totalPieces.toLocaleString()} pcs • {formatNumber(item.displayBatchWeight, 1)}{' '}
                      {item.displayWeightUnit.toUpperCase()}
                    </p>
                    <span className="text-[10px] text-[#A39E93]">
                      {new Date(item.calculatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {item.capacityExceeded && (
                    <span className="px-2 py-0.5 bg-[#FDF2F0] dark:bg-[#321E1A] text-[#A65B48] dark:text-[#EAA89A] border border-[#F5D5CF] rounded text-[10px] font-bold">
                      Exceeded
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

