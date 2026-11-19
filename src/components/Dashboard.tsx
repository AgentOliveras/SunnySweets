import React, { useState } from 'react';
import {
  BookOpen,
  Calculator,
  History,
  Scale,
  Plus,
  ArrowLeft,
  Play,
  FlaskConical,
  Sliders,
  RotateCcw,
  Trash2,
  DollarSign,
  ChefHat,
  SlidersHorizontal,
  Package,
  Settings as SettingsIcon,
  Layers,
  FileText,
} from 'lucide-react';
import { AccessRole, Recipe, ProductionPreset, Mixer, ProductionHistoryEntry, UserSettings, MasterIngredient } from '../types';
import { TabType } from './Navbar';
import { analyzeWorkspaceCosting } from '../utils/costingCompletion';
import { store } from '../services/store';
import { loadManagementLockConfig } from '../utils/managementLock';
import { ManagementLockModal } from './ManagementLockModal';

export interface DashboardProps {
  mode?: 'main' | 'management';
  userRole?: AccessRole | null;
  recipes: Recipe[];
  presets: ProductionPreset[];
  mixers: Mixer[];
  history: ProductionHistoryEntry[];
  masterIngredients?: MasterIngredient[];
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
  onSwitchToProductionMode?: () => void;
  onSwitchToManagementMode?: () => void;
  onRequestManagementAccess?: (targetTab?: TabType) => void;
  onBackToMain?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  mode = 'main',
  userRole,
  recipes,
  presets,
  mixers,
  history,
  masterIngredients,
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
  onSwitchToProductionMode,
  onSwitchToManagementMode,
  onRequestManagementAccess,
  onBackToMain,
}) => {
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingTab, setPendingTab] = useState<TabType | null>(null);

  const isManagement = mode === 'management';
  const effectiveRole = userRole !== undefined ? userRole : store.getUserRole();
  const isEditorOrOwner = effectiveRole === 'owner' || effectiveRole === 'editor';
  const localLockConfig = loadManagementLockConfig();
  const effectiveLockResolution = store.getEffectiveManagementLockResolution();
  const isEffectiveLockActive =
    effectiveLockResolution.isLockActive || Boolean(localLockConfig.enabled && localLockConfig.hash);

  const activeRecipesCount = recipes.filter((r) => !r.archived).length;

  const costingStats = React.useMemo(() => {
    if (!masterIngredients) return null;
    return analyzeWorkspaceCosting(recipes, masterIngredients).stats;
  }, [recipes, masterIngredients]);

  const handleManagementModeClick = () => {
    if (onRequestManagementAccess) {
      onRequestManagementAccess();
      return;
    }
    if (isEffectiveLockActive) {
      setPendingTab(null);
      setShowPinModal(true);
    } else {
      onSwitchToManagementMode?.();
    }
  };

  const handleCardClick = (targetTab: TabType) => {
    if (isManagement) {
      setActiveTab(targetTab);
      return;
    }

    if (onRequestManagementAccess) {
      onRequestManagementAccess(targetTab);
      return;
    }

    if (isEffectiveLockActive) {
      setPendingTab(targetTab);
      setShowPinModal(true);
    } else {
      onSwitchToManagementMode?.();
      setActiveTab(targetTab);
    }
  };

  const handlePinSuccess = () => {
    setShowPinModal(false);
    onSwitchToManagementMode?.();
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  };

  const branding = store.getWorkspaceBranding();
  const displayName = branding.displayName || settings.businessName || 'Main Bakery Workspace';
  const weightUnit = (settings.defaultWeightUnit || 'g').toUpperCase();

  return (
    <div id={isManagement ? 'management-dashboard-view' : 'main-dashboard-view'} className="space-y-6 pb-20 md:pb-8 w-full max-w-full min-w-0">
      {/* Back to Main Bar (Only in Management Mode) */}
      {isManagement && onBackToMain && (
        <div className="flex items-center justify-between bg-stone-100 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs w-full min-w-0">
          <button
            id="dashboard-back-to-main-btn"
            type="button"
            onClick={onBackToMain}
            className="inline-flex items-center gap-1.5 font-bold text-stone-700 dark:text-zinc-200 hover:text-amber-700 dark:hover:text-amber-400 transition cursor-pointer min-h-[36px] truncate"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="truncate">← Back to Main</span>
          </button>
          <span className="text-[11px] text-stone-500 font-mono shrink-0 ml-2 hidden xs:inline">Management Mode</span>
        </div>
      )}

      {/* Hero Header Card */}
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] text-[#2D2926] dark:text-[#EAE6E1] rounded-xl p-4 sm:p-6 md:p-8 shadow-sm relative overflow-hidden w-full max-w-full min-w-0">
        <div className="absolute -right-8 -bottom-8 opacity-[0.04] dark:opacity-[0.06] pointer-events-none text-[#5A534B]">
          <BookOpen className="w-72 h-72" />
        </div>
        <div className="relative z-10 max-w-2xl min-w-0">
          <div className="inline-flex items-center gap-2 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] px-3 py-1 rounded-full text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-3 max-w-full flex-wrap">
            <span className="truncate">{displayName}</span>
            <span>•</span>
            <span className="uppercase tracking-widest text-[#D4A373] font-bold">{weightUnit} BASE SYSTEM</span>
          </div>

          <h2 className="text-xl sm:text-2xl md:text-3xl font-serif text-[#5A534B] dark:text-[#EAE6E1] mb-2 leading-tight break-words">
            {isManagement ? 'Management & Recipe Administration Hub' : 'Production & Batch Scaling Hub'}
          </h2>
          <p className="text-[#8B7E74] dark:text-[#A39E93] text-xs sm:text-sm md:text-base leading-relaxed mb-6 break-words">
            {isManagement
              ? 'Manage recipes, ingredients, packaging presets, mixer capacities, ingredient costing, and system configuration.'
              : 'Scale formulas, manage mixer capacities, generate touch checklists, and export precise PDF production sheets.'}
          </p>

          {/* Hero Actions */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 w-full">
            {/* 1. Production Floor Mode (Visually Dominant in both views) */}
            {onSwitchToProductionMode && (
              <button
                id="dashboard-production-mode-btn"
                type="button"
                onClick={onSwitchToProductionMode}
                className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm transition shadow-sm cursor-pointer active:scale-95 min-h-[44px]"
              >
                <ChefHat className="w-4 h-4 stroke-[2.5] shrink-0" />
                <span>Production Floor Mode</span>
              </button>
            )}

            {/* In Main Mode: EXACTLY TWO primary workflow buttons: Production Floor Mode and Management Mode */}
            {!isManagement && (
              <button
                id="dashboard-management-mode-btn"
                type="button"
                onClick={handleManagementModeClick}
                className="inline-flex items-center justify-center gap-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] dark:hover:bg-[#4A433D] text-white font-bold px-4 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm transition cursor-pointer active:scale-95 shadow-sm min-h-[44px]"
              >
                <SlidersHorizontal className="w-4 h-4 shrink-0" />
                <span>Management Mode</span>
              </button>
            )}

            {/* In Management Mode: Administrative actions */}
            {isManagement && (
              <>
                <button
                  id="dashboard-start-calc-btn"
                  type="button"
                  onClick={() => setActiveTab('calculate')}
                  className="inline-flex items-center justify-center gap-2 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm transition shadow-sm cursor-pointer min-h-[44px]"
                >
                  <Calculator className="w-4 h-4 shrink-0" />
                  <span>New Calculation</span>
                </button>
                {isEditorOrOwner && (
                  <button
                    id="dashboard-new-recipe-btn"
                    type="button"
                    onClick={onOpenRecipeModal}
                    className="inline-flex items-center justify-center gap-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] dark:hover:bg-[#4A433D] text-white font-bold px-3.5 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm transition cursor-pointer min-h-[44px]"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Add Recipe</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Administration Hub Shortcuts Overview Card */}
      {isManagement && (
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-serif font-bold text-sm sm:text-base text-[#5A534B] dark:text-[#EAE6E1]">
              Administration Hub Shortcuts
            </h3>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] uppercase font-bold tracking-wider text-[#A39E93]">
                Quick Management Access
              </span>
              <button
                id="dashboard-unit-tests-btn"
                type="button"
                onClick={onRunUnitTests}
                className="inline-flex items-center justify-center gap-1.5 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] font-bold px-2.5 py-1 rounded-lg text-xs transition cursor-pointer"
                title="Run Verification Tests"
              >
                <FlaskConical className="w-3.5 h-3.5 text-[#D4A373] shrink-0" />
                <span>Run Tests {testPassedCount !== undefined ? `(${testPassedCount})` : ''}</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
            <button
              type="button"
              data-testid="admin-hub-card-ingredients"
              onClick={() => handleCardClick('ingredients')}
              className="flex flex-col items-start p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] bg-[#FDFBF7] dark:bg-[#25221F] hover:border-[#D4A373] hover:shadow-xs transition cursor-pointer text-left group min-h-[90px]"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[#D4A373] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <Package className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">Ingredients</span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1 mt-0.5">Pantry & Linking</span>
            </button>

            <button
              type="button"
              data-testid="admin-hub-card-quotes"
              onClick={() => handleCardClick('quotes')}
              className="flex flex-col items-start p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] bg-[#FDFBF7] dark:bg-[#25221F] hover:border-[#D4A373] hover:shadow-xs transition cursor-pointer text-left group min-h-[90px]"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[#D4A373] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <FileText className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">Product Quotes</span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1 mt-0.5">R&D & Pricing</span>
            </button>

            <button
              type="button"
              data-testid="admin-hub-card-costing"
              onClick={() => handleCardClick('costing')}
              className="flex flex-col items-start p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] bg-[#FDFBF7] dark:bg-[#25221F] hover:border-[#D4A373] hover:shadow-xs transition cursor-pointer text-left group min-h-[90px]"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[#D4A373] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <DollarSign className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">Costing</span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1 mt-0.5">Margins & Audit</span>
            </button>

            <button
              type="button"
              data-testid="admin-hub-card-presets"
              onClick={() => handleCardClick('presets')}
              className="flex flex-col items-start p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] bg-[#FDFBF7] dark:bg-[#25221F] hover:border-[#D4A373] hover:shadow-xs transition cursor-pointer text-left group min-h-[90px]"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[#D4A373] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <Sliders className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">Presets</span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1 mt-0.5">Packaging Rules</span>
            </button>

            <button
              type="button"
              data-testid="admin-hub-card-mixers"
              onClick={() => handleCardClick('mixers')}
              className="flex flex-col items-start p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] bg-[#FDFBF7] dark:bg-[#25221F] hover:border-[#D4A373] hover:shadow-xs transition cursor-pointer text-left group min-h-[90px]"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[#D4A373] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <Scale className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">Mixers</span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1 mt-0.5">Bowl Capacities</span>
            </button>

            <button
              type="button"
              data-testid="admin-hub-card-settings"
              onClick={() => handleCardClick('settings')}
              className="flex flex-col items-start p-3 rounded-xl border border-[#E5E1DA] dark:border-[#2D2925] bg-[#FDFBF7] dark:bg-[#25221F] hover:border-[#D4A373] hover:shadow-xs transition cursor-pointer text-left group min-h-[90px]"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[#D4A373] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                <SettingsIcon className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">Settings</span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1 mt-0.5">Workspace Config</span>
            </button>
          </div>
        </div>
      )}

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
              type="button"
              onClick={() => onResumeChecklist(activeChecklist)}
              className="bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm min-h-[44px]"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Resume Checklist</span>
            </button>
            <button
              id="dashboard-reset-checklist-btn"
              type="button"
              onClick={onResetChecklist}
              title="Reset checklist progress to 0"
              className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#EEECE8] text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 min-h-[44px]"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#8B7E74]" />
              <span>Reset</span>
            </button>
            <button
              id="dashboard-delete-checklist-btn"
              type="button"
              onClick={onDeleteChecklist}
              title="Delete session notification"
              className="bg-[#FDF2F0] dark:bg-[#2C1916] border border-[#F5D5CF] dark:border-[#4E2620] text-[#A65B48] dark:text-[#EAA89A] hover:bg-[#FADBD8] text-xs font-bold px-3 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 min-h-[44px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Operational Summary Cards (Authoritative, dynamically derived) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 sm:gap-3 md:gap-4 w-full max-w-full min-w-0">
        <div
          id="dashboard-recipes-metric-btn"
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick('recipes')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick('recipes');
            }
          }}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-3 sm:p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm select-none min-w-0 w-full"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5 sm:mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93] truncate">Recipes</span>
            <BookOpen className="w-4 h-4 text-[#D4A373] shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{activeRecipesCount}</div>
          <p className="text-[11px] sm:text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 sm:mt-1 truncate">Active formulas</p>
        </div>

        <div
          id="dashboard-costing-metric-btn"
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick('costing')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick('costing');
            }
          }}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-3 sm:p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm select-none min-w-0 w-full"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5 sm:mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93] truncate">Costing</span>
            <DollarSign className="w-4 h-4 text-[#D4A373] shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
            {costingStats ? `${costingStats.coveragePercent}%` : '0%'}
          </div>
          <p className="text-[11px] sm:text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 sm:mt-1 truncate">
            {costingStats ? `${costingStats.fullyCostedCount}/${costingStats.totalRecipes} costed` : '0/0 costed'}
          </p>
        </div>

        <div
          id="dashboard-presets-metric-btn"
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick('presets')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick('presets');
            }
          }}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-3 sm:p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm select-none min-w-0 w-full"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5 sm:mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93] truncate">Presets</span>
            <Sliders className="w-4 h-4 text-[#D4A373] shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{presets.length}</div>
          <p className="text-[11px] sm:text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 sm:mt-1 truncate">Packaging presets</p>
        </div>

        <div
          id="dashboard-mixers-metric-btn"
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick('mixers')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick('mixers');
            }
          }}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-3 sm:p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm select-none min-w-0 w-full"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5 sm:mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93] truncate">Mixers</span>
            <Scale className="w-4 h-4 text-[#D4A373] shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{mixers.length}</div>
          <p className="text-[11px] sm:text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 sm:mt-1 truncate">Equipment capacity</p>
        </div>

        <div
          id="dashboard-history-metric-btn"
          role="button"
          tabIndex={0}
          onClick={() => handleCardClick('history')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick('history');
            }
          }}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-3 sm:p-4 cursor-pointer hover:border-[#D4A373] transition shadow-sm select-none min-w-0 w-full"
        >
          <div className="flex items-center justify-between text-[#8B7E74] dark:text-[#A39E93] mb-1.5 sm:mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#A39E93] truncate">History</span>
            <History className="w-4 h-4 text-[#D4A373] shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">{history.length}</div>
          <p className="text-[11px] sm:text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 sm:mt-1 truncate">Saved batch runs</p>
        </div>
      </div>

      {/* Management PIN Modal (if opened via Management button or locked card) */}
      {showPinModal && (
        <ManagementLockModal
          isOpen={showPinModal}
          lockConfig={effectiveLockResolution.effectiveConfig}
          verificationBlockedReason={
            effectiveLockResolution.isVerificationBlocked
              ? effectiveLockResolution.blockReason
              : null
          }
          onRetryPolicySync={() => store.retryWorkspaceLockHydration()}
          onClose={() => {
            setShowPinModal(false);
            setPendingTab(null);
          }}
          onUnlockSuccess={handlePinSuccess}
        />
      )}
    </div>
  );
};

export const ManagementDashboard: React.FC<DashboardProps> = (props) => (
  <Dashboard {...props} mode="management" />
);

