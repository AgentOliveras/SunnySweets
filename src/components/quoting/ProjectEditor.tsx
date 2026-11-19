import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Save,
  FileText,
  Copy,
  Archive,
  Lock,
  Layers,
  Package,
  History,
  Building,
  Tag,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Check,
  ChefHat,
  Sparkles,
  Plus,
} from 'lucide-react';
import {
  ProductProject,
  QuoteFormula,
  QuoteProductConfig,
  ProjectStatus,
  FormulaOwnership,
} from '../../types/quoting';
import { MasterIngredient, Recipe, ProductionPreset } from '../../types';
import { FormulaBuilder } from './FormulaBuilder';
import { ProductsPricingMatrix } from './ProductsPricingMatrix';
import { QuoteHistoryView } from './QuoteHistoryView';
import { ProjectManagementActions } from './ProjectManagementActions';
import { PromotionWizardModal } from './PromotionWizardModal';
import { ProjectDeletionModal } from './ProjectDeletionModal';
import { canUserPromoteProject } from '../../services/promotionService';
import { quotingService } from '../../services/quotingService';
import { recalculateProductsPricing } from '../../utils/quotingCalculator';
import { store } from '../../services/store';
import { auth } from '../../services/firebase';

interface ProjectEditorProps {
  project: ProductProject;
  masterIngredients: MasterIngredient[];
  presets?: ProductionPreset[];
  existingRecipes?: Recipe[];
  onBack: () => void;
  onSaveDraft: (updated: ProductProject) => Promise<ProductProject | void>;
  onUpdateMetadata?: (
    projectId: string,
    metadata: {
      productName?: string;
      customerName?: string;
      description?: string;
      status?: ProjectStatus;
      formulaOwnership?: FormulaOwnership;
    }
  ) => Promise<void>;
  onIssueRevision: (projectId: string, notes?: string, draft?: ProductProject) => Promise<void>;
  onDuplicate: (projectId: string) => Promise<void>;
  onArchive: (projectId: string) => Promise<void>;
  onUnarchive?: (projectId: string) => Promise<void>;
  onOpenRecipe?: (recipeId: string) => void;
  defaultMultiplier?: number;
  initialTab?: 'formula' | 'products' | 'history';
  onTabChange?: (tab: 'formula' | 'products' | 'history') => void;
}

export const ProjectEditor: React.FC<ProjectEditorProps> = ({
  project,
  masterIngredients,
  presets: propPresets,
  existingRecipes: propRecipes,
  onBack,
  onSaveDraft,
  onUpdateMetadata,
  onIssueRevision,
  onDuplicate,
  onArchive,
  onUnarchive,
  onOpenRecipe,
  defaultMultiplier = 1.6,
  initialTab = 'formula',
  onTabChange,
}) => {
  const [activeTab, setActiveTabState] = useState<'formula' | 'products' | 'history'>(initialTab);

  useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTabState(initialTab);
    }
  }, [initialTab]);

  const setActiveTab = (tab: 'formula' | 'products' | 'history') => {
    setActiveTabState(tab);
    onTabChange?.(tab);
  };
  // Check if there is an unsaved recovery draft in local storage for this project (scoped to user)
  const userScope = auth.currentUser?.uid || 'default_user';
  const effectiveInitialProject = useMemo(() => {
    const recovered = quotingService.getDraftRecovery(project.workspaceId, project.id, userScope);
    if (recovered) {
      const recLines = recovered.formula?.lines?.length ?? 0;
      const projLines = project.formula?.lines?.length ?? 0;
      const recTime = new Date(recovered.updatedAt || 0).getTime();
      const projTime = new Date(project.updatedAt || 0).getTime();
      if (recLines !== projLines || recTime >= projTime) {
        return recovered;
      }
      const hasDivergentLine = recovered.formula?.lines?.some((rl, idx) => {
        const pl = project.formula?.lines?.[idx];
        return !pl || Number(rl.quantity) !== Number(pl.quantity) || rl.unit !== pl.unit;
      });
      if (hasDivergentLine) {
        return recovered;
      }
    }
    return project;
  }, [project, userScope]);

  const [productName, setProductName] = useState(effectiveInitialProject.productName);
  const [customerName, setCustomerName] = useState(effectiveInitialProject.customerName || '');
  const [description, setDescription] = useState(effectiveInitialProject.description || '');
  const [status, setStatus] = useState<ProjectStatus>(effectiveInitialProject.status);
  const [formulaOwnership, setFormulaOwnership] = useState<FormulaOwnership>(
    effectiveInitialProject.formulaOwnership || 'bakery_owned'
  );
  const [formula, setFormula] = useState<QuoteFormula>(effectiveInitialProject.formula);
  const [products, setProducts] = useState<QuoteProductConfig[]>(effectiveInitialProject.products || []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'unsaved' | 'saving' | 'saved' | 'error'>(
    effectiveInitialProject !== project ? 'unsaved' : 'saved'
  );
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [isPromotionWizardOpen, setIsPromotionWizardOpen] = useState(false);
  const [isDeletionModalOpen, setIsDeletionModalOpen] = useState(false);

  const currentProjectIdRef = useRef(project.id);
  const currentDraftRef = useRef<ProductProject>(effectiveInitialProject);
  const editVersionRef = useRef(0);
  const lastSavedVersionRef = useRef(0);
  const hasUserEditedRef = useRef(effectiveInitialProject !== project);
  const isProjectDeletedRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  const isMountedRef = useRef(true);

  const presets = propPresets || store.getPresets();
  const existingRecipes = propRecipes || store.getRecipes();
  const isPinUser = false;
  const canPromote = canUserPromoteProject(store.getActiveWorkspace(), store.getUserRole(), isPinUser);

  const onSaveDraftRef = useRef(onSaveDraft);
  onSaveDraftRef.current = onSaveDraft;
  const projectWsRef = useRef(project.workspaceId);
  projectWsRef.current = project.workspaceId;
  const projectIdRef = useRef(project.id);
  projectIdRef.current = project.id;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // CRITICAL UNMOUNT FLUSH: Flush pending changes before component unmounts on section switch or navigation
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // If project was permanently deleted, DO NOT flush changes or write to recovery draft
      if (isProjectDeletedRef.current || quotingService.isProjectDeleted(projectIdRef.current)) {
        return;
      }
      if (hasUserEditedRef.current && currentDraftRef.current) {
        const nowIso = new Date().toISOString();
        const draftToFlush: ProductProject = {
          ...currentDraftRef.current,
          updatedAt: nowIso,
          hasUnsyncedLocalChanges: true,
        };
        const scope = auth.currentUser?.uid || 'default_user';
        quotingService.saveDraftRecovery(projectWsRef.current, projectIdRef.current, draftToFlush, scope);
        onSaveDraftRef.current(draftToFlush);
      }
    };
  }, []);

  // Synchronize external project identity or restore recovery draft on project switch
  useEffect(() => {
    if (currentProjectIdRef.current !== project.id) {
      currentProjectIdRef.current = project.id;
      // Check if there is an unsaved recovery draft in local storage for this project (scoped to user)
      const userScope = auth.currentUser?.uid || 'default_user';
      const recovered = quotingService.getDraftRecovery(project.workspaceId, project.id, userScope);
      let initialProject = project;
      if (recovered) {
        const recLines = recovered.formula?.lines?.length ?? 0;
        const projLines = project.formula?.lines?.length ?? 0;
        const recTime = new Date(recovered.updatedAt || 0).getTime();
        const projTime = new Date(project.updatedAt || 0).getTime();
        const hasDivergentLine = recovered.formula?.lines?.some((rl, idx) => {
          const pl = project.formula?.lines?.[idx];
          return !pl || Number(rl.quantity) !== Number(pl.quantity) || rl.unit !== pl.unit;
        });
        if (recLines !== projLines || recTime >= projTime || hasDivergentLine) {
          initialProject = recovered;
        }
      }

      setProductName(initialProject.productName);
      setCustomerName(initialProject.customerName || '');
      setDescription(initialProject.description || '');
      setStatus(initialProject.status);
      setFormulaOwnership(initialProject.formulaOwnership || 'bakery_owned');
      setFormula(initialProject.formula);
      const syncedProducts = recalculateProductsPricing(
        initialProject.products || [],
        initialProject.formula
      );
      setProducts(syncedProducts);

      currentDraftRef.current = {
        ...initialProject,
        products: syncedProducts,
      };
      editVersionRef.current = 0;
      lastSavedVersionRef.current = 0;
      hasUserEditedRef.current = !!recovered;
      setSaveStatus(recovered ? 'unsaved' : 'saved');
      setSaveErrorMsg(null);
    }
  }, [project.id, project.workspaceId]);

  // Execute canonical save operation (used for autosave, manual Save Draft, and pre-navigation flush)
  const executeSave = useCallback(async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (inFlightSaveRef.current) {
      try {
        await inFlightSaveRef.current;
      } catch {
        // Continue to fresh save attempt
      }
    }

    const versionToSave = editVersionRef.current;
    const draftToSave: ProductProject = {
      ...currentDraftRef.current,
      productName: currentDraftRef.current.productName.trim() || 'Untitled Product',
      customerName: currentDraftRef.current.customerName?.trim() || '',
      description: currentDraftRef.current.description?.trim() || '',
    };

    setIsSaving(true);
    setSaveStatus('saving');
    setSaveErrorMsg(null);

    const savePromise = (async (): Promise<boolean> => {
      try {
        const savedProject = await onSaveDraft(draftToSave);
        if (savedProject && typeof savedProject.documentVersion === 'number') {
          currentDraftRef.current = {
            ...currentDraftRef.current,
            documentVersion: savedProject.documentVersion,
          };
        }
        lastSavedVersionRef.current = versionToSave;
        if (!isMountedRef.current) {
          return true;
        }
        if (editVersionRef.current === versionToSave) {
          // No newer edits while saving
          setSaveStatus('saved');
          hasUserEditedRef.current = false;
          setSaveSuccessMsg('All changes saved');
          setTimeout(() => {
            if (isMountedRef.current) setSaveSuccessMsg(null);
          }, 3000);
          const userScope = auth.currentUser?.uid || 'default_user';
          quotingService.clearDraftRecovery(project.workspaceId, project.id, userScope, savedProject || draftToSave);
        } else {
          // Newer edits occurred during save; maintain unsaved state and schedule follow-up save
          setSaveStatus('unsaved');
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            executeSave();
          }, 100);
        }
        return true;
      } catch (err: any) {
        if (isMountedRef.current) {
          setSaveStatus('error');
          setSaveErrorMsg(err?.message || 'Failed to save changes. Your draft is preserved.');
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setIsSaving(false);
        }
        inFlightSaveRef.current = null;
      }
    })();

    inFlightSaveRef.current = savePromise;
    return savePromise;
  }, [onSaveDraft, project.id, project.workspaceId]);

  // Mark draft dirty, write to recovery storage, and schedule debounced autosave
  const markDirtyAndDebounce = useCallback(
    (incomingDraft: ProductProject, immediate = false) => {
      const nowIso = new Date().toISOString();
      const updatedDraft: ProductProject = {
        ...incomingDraft,
        updatedAt: nowIso,
        hasUnsyncedLocalChanges: true,
      };
      currentDraftRef.current = updatedDraft;
      hasUserEditedRef.current = true;
      editVersionRef.current += 1;
      setSaveStatus('unsaved');
      setSaveErrorMsg(null);

      // Save immediately to local recovery storage so browser crash/reload cannot lose work
      const userScope = auth.currentUser?.uid || 'default_user';
      quotingService.saveDraftRecovery(project.workspaceId, project.id, updatedDraft, userScope);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        executeSave();
      }, immediate ? 50 : 250);
    },
    [executeSave, project.id, project.workspaceId]
  );

  // Before-unload warning for browser refresh / close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUserEditedRef.current && (saveStatus === 'unsaved' || saveStatus === 'saving')) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [saveStatus]);

  // Canonical manual Save Draft handler (bound to both top and bottom buttons)
  const handleSaveDraft = async () => {
    await executeSave();
  };

  // Safe navigation back to dashboard: flush pending changes before leaving
  const handleBack = async () => {
    if (debounceTimerRef.current || saveStatus === 'unsaved' || saveStatus === 'saving') {
      const ok = await executeSave();
      if (!ok) {
        // Save failed: do not silently discard work. Retain editor open with error and retry option.
        return;
      }
    }
    onBack();
  };

  const handleConfirmRevision = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveErrorMsg(null);
    try {
      // 1. Verify draft is fully persisted before issuing quote revision
      const saveOk = await executeSave();
      if (!saveOk) {
        throw new Error('Cannot issue quote revision: Draft could not be persisted to server. Working draft remains safely preserved.');
      }

      // 2. Validate quote required fields
      const draft = currentDraftRef.current;
      if (!draft.productName || !draft.productName.trim()) {
        throw new Error('Cannot issue quote revision: Product name is required.');
      }

      const updated: ProductProject = {
        ...draft,
        productName: draft.productName.trim(),
        customerName: draft.customerName?.trim() || '',
        description: draft.description?.trim() || '',
        status: 'quoted',
      };

      // 3. Issue immutable revision snapshot
      await onIssueRevision(project.id, revisionNotes.trim() || undefined, updated);
      setIsRevisionModalOpen(false);
      setRevisionNotes('');
      setSaveStatus('saved');
      hasUserEditedRef.current = false;
      const userScope = auth.currentUser?.uid || 'default_user';
      quotingService.clearDraftRecovery(project.workspaceId, project.id, userScope);
      setSaveSuccessMsg('Quote revision issued and frozen.');
      setTimeout(() => {
        if (isMountedRef.current) setSaveSuccessMsg(null);
      }, 3000);
      setActiveTab('history');
    } catch (err: any) {
      setIsRevisionModalOpen(false);
      setSaveStatus('error');
      setSaveErrorMsg(err?.message || 'Failed to issue revision');
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-stone-600 dark:text-zinc-300 hover:text-stone-900 dark:hover:text-zinc-100 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
                {project.projectCode || 'PROJECT'}
              </span>
              <span className="text-stone-300 dark:text-zinc-700">•</span>
              <span className="text-xs font-semibold text-stone-500 dark:text-zinc-400">
                {customerName || 'Internal Development'}
              </span>
              {project.sourceRecipeName && (
                <>
                  <span className="text-stone-300 dark:text-zinc-700">•</span>
                  <span
                    data-testid="project-source-recipe-badge"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60"
                    title={`Imported from production recipe "${project.sourceRecipeName}"`}
                  >
                    <span>Source: {project.sourceRecipeName}</span>
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="font-serif font-bold text-lg text-stone-900 dark:text-zinc-100 line-clamp-1">
                {productName || 'Untitled Project'}
              </h2>
              {saveStatus === 'saving' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Saving...</span>
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                  <Check className="w-3 h-3" />
                  <span>All Changes Saved</span>
                </span>
              )}
              {saveStatus === 'unsaved' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>Unsaved Changes</span>
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                  <AlertCircle className="w-3 h-3" />
                  <span>Save Failed</span>
                  <button
                    type="button"
                    onClick={() => executeSave()}
                    className="underline ml-1 cursor-pointer font-bold hover:text-red-900"
                  >
                    Retry
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons (Top Instance) */}
        <ProjectManagementActions
          projectId={project.id}
          isArchived={project.archived}
          isSaving={isSaving}
          onDuplicate={onDuplicate}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onSaveDraft={handleSaveDraft}
          onOpenIssueRevision={() => setIsRevisionModalOpen(true)}
          onOpenPromotion={canPromote ? () => setIsPromotionWizardOpen(true) : undefined}
          onOpenDelete={() => setIsDeletionModalOpen(true)}
          variant="header"
        />
      </div>

      {/* Save feedback banner */}
      {saveSuccessMsg && (
        <div className="p-3 text-xs font-semibold rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Save error banner */}
      {saveErrorMsg && (
        <div className="p-3 text-xs font-semibold rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>{saveErrorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => executeSave()}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-2xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Cloud Conflict Warning Banner */}
      {project.cloudConflict && (
        <div
          data-testid="cloud-conflict-banner"
          className="p-3.5 text-xs rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 animate-in fade-in"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Cloud Conflict Detected</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                A newer cloud version exists (server version v{project.cloudConflict.serverVersion || 1} with {project.cloudConflict.serverFormulaLineCount} ingredients). Your working draft has been preserved locally and not overwritten.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => executeSave()}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shrink-0 shadow-2xs"
          >
            Save My Working Draft
          </button>
        </div>
      )}

      {/* Controlled Promotion Action Banner (Phase 2B.6) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-stone-700 dark:text-zinc-300">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <ChefHat className="w-5 h-5" />
          </div>
          <div className="text-xs">
            <span className="font-bold text-sm text-stone-900 dark:text-zinc-100 block">
              Convert to Production Recipe
            </span>
            <p className="text-[11px] text-stone-600 dark:text-zinc-400 mt-0.5">
              Promote this development formula into the live production library with full provenance. R&amp;D project and quotes remain untouched.
            </p>
          </div>
        </div>
        {canPromote ? (
          <button
            type="button"
            data-testid="btn-banner-promote-recipe"
            onClick={() => setIsPromotionWizardOpen(true)}
            className="px-4 py-2 text-xs font-black rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <ChefHat className="w-4 h-4" />
            <span>{project.productionPromotions && project.productionPromotions.length > 0 ? 'Create Another Recipe' : 'Convert to Recipe'}</span>
          </button>
        ) : (
          <span className="text-xs font-semibold text-stone-400 italic">
            Management authorization required to promote
          </span>
        )}
      </div>

      {/* Production Recipes (Promotions History) Section (Phase 2B.6) */}
      <div
        data-testid="project-promotions-section"
        className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-xs space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-stone-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <ChefHat className="w-4 h-4 text-amber-600" />
            <h3 className="text-xs sm:text-sm font-bold text-stone-900 dark:text-zinc-100 uppercase tracking-wider">
              Production Recipes
            </h3>
            {project.productionPromotions && project.productionPromotions.length > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                {project.productionPromotions.length} Promoted
              </span>
            )}
          </div>

          {canPromote && (
            <button
              type="button"
              data-testid="btn-open-promotion-wizard"
              onClick={() => setIsPromotionWizardOpen(true)}
              className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer shrink-0 self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {project.productionPromotions && project.productionPromotions.length > 0
                  ? 'Create Another Production Recipe'
                  : 'Convert to Production Recipe'}
              </span>
            </button>
          )}
        </div>

        {project.productionPromotions && project.productionPromotions.length > 0 ? (
          <div className="space-y-2">
            {project.productionPromotions.map((promo) => (
              <div
                key={promo.id}
                data-testid={`promoted-recipe-card-${promo.productionRecipeId}`}
                className="p-3 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-850 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-900 dark:text-zinc-100 truncate">
                      ✓ {promo.productionRecipeName}
                    </span>
                    <span className="text-[10px] text-stone-500 dark:text-zinc-400">
                      Created {new Date(promo.promotedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-0.5">
                    From {promo.sourceType === 'quote_revision' ? `Quote Revision #${promo.sourceRevisionNumber || ''}` : 'Current Working Formula'}
                  </p>
                </div>

                {onOpenRecipe && (
                  <button
                    type="button"
                    data-testid={`btn-open-promoted-recipe-${promo.productionRecipeId}`}
                    onClick={() => onOpenRecipe(promo.productionRecipeId)}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 transition cursor-pointer shrink-0"
                  >
                    Open Recipe
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-stone-500 dark:text-zinc-400 py-1">
            No production recipes have been promoted from this project yet. Use &quot;Convert to Production Recipe&quot; above to create one.
          </div>
        )}
      </div>

      {/* Project Metadata Section (Collapsible / Compact) */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
              Product / Project Name *
            </label>
            <input
              type="text"
              required
              value={productName}
              onChange={(e) => {
                const val = e.target.value;
                setProductName(val);
                currentDraftRef.current = { ...currentDraftRef.current, productName: val };
              }}
              onBlur={() => {
                if (productName.trim() && productName.trim() !== project.productName) {
                  onUpdateMetadata?.(project.id, { productName: productName.trim() });
                }
              }}
              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
              Customer / Company Name
            </label>
            <input
              type="text"
              placeholder="e.g. Pepe's Cantina, In-house R&D"
              value={customerName}
              onChange={(e) => {
                const val = e.target.value;
                setCustomerName(val);
                currentDraftRef.current = { ...currentDraftRef.current, customerName: val };
              }}
              onBlur={() => {
                if ((customerName.trim() || '') !== (project.customerName || '')) {
                  onUpdateMetadata?.(project.id, { customerName: customerName.trim() });
                }
              }}
              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => {
                  const val = e.target.value as ProjectStatus;
                  setStatus(val);
                  currentDraftRef.current = { ...currentDraftRef.current, status: val };
                  onUpdateMetadata?.(project.id, { status: val });
                }}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500 capitalize"
              >
                <option value="draft">Draft</option>
                <option value="testing">Testing</option>
                <option value="ready_to_quote">Ready to Quote</option>
                <option value="quoted">Quoted</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Formula Owner
              </label>
              <select
                value={formulaOwnership}
                onChange={(e) => {
                  const val = e.target.value as FormulaOwnership;
                  setFormulaOwnership(val);
                  currentDraftRef.current = { ...currentDraftRef.current, formulaOwnership: val };
                  onUpdateMetadata?.(project.id, { formulaOwnership: val });
                }}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                <option value="bakery_owned">Bakery-Owned</option>
                <option value="customer_owned">Customer-Owned</option>
                <option value="joint_development">Joint R&D</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-stone-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('formula')}
          className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors flex items-center gap-2 border-b-2 cursor-pointer ${
            activeTab === 'formula'
              ? 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>1. Formula ({formula.lines.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors flex items-center gap-2 border-b-2 cursor-pointer ${
            activeTab === 'products'
              ? 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>2. Products & Pricing ({products.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors flex items-center gap-2 border-b-2 cursor-pointer ${
            activeTab === 'history'
              ? 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20'
              : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>3. Quote History ({project.revisions?.length || 0})</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'formula' && (
        <FormulaBuilder
          formula={formula}
          masterIngredients={masterIngredients}
          onChange={(newFormula) => {
            const currentProducts = currentDraftRef.current.products || products || [];
            const updatedProducts = recalculateProductsPricing(currentProducts, newFormula);
            setFormula(newFormula);
            setProducts(updatedProducts);
            const isIntentionalFormulaClear = newFormula.lines.length === 0 && ((formula.lines?.length || 0) > 0 || (currentDraftRef.current.formula?.lines?.length || 0) > 0);
            markDirtyAndDebounce(
              {
                ...currentDraftRef.current,
                formula: newFormula,
                products: updatedProducts,
                allowEmptyFormula: isIntentionalFormulaClear ? true : (currentDraftRef.current as any).allowEmptyFormula,
              },
              true
            );
          }}
          onContinueToPricing={() => setActiveTab('products')}
        />
      )}

      {activeTab === 'products' && (
        <ProductsPricingMatrix
          products={products}
          formula={formula}
          onChange={(newProducts) => {
            setProducts(newProducts);
            markDirtyAndDebounce({ ...currentDraftRef.current, products: newProducts });
          }}
          defaultMultiplier={defaultMultiplier}
          presets={presets}
          projectCategory={project.productCategory}
          workspaceId={project.workspaceId}
        />
      )}

      {activeTab === 'history' && (
        <QuoteHistoryView
          project={project}
          onIssueRevision={() => setIsRevisionModalOpen(true)}
        />
      )}

      {/* Bottom Management Action Bar (Phase 2B.5.3) */}
      <div
        data-testid="project-editor-bottom-bar"
        className="mt-8 pt-5 pb-5 px-4 sm:px-6 rounded-2xl bg-stone-50/80 dark:bg-zinc-900/80 border border-stone-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-2xs relative z-10"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-bold text-stone-700 dark:text-zinc-300">
              Finished reviewing this project?
            </p>
            {saveStatus === 'saving' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                <Check className="w-2.5 h-2.5" /> All Changes Saved
              </span>
            )}
            {saveStatus === 'unsaved' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Unsaved Changes
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-red-400">
                <AlertCircle className="w-2.5 h-2.5" /> Save Failed
                <button
                  type="button"
                  onClick={() => executeSave()}
                  className="underline ml-1 cursor-pointer font-bold hover:text-red-800"
                >
                  Retry
                </button>
              </span>
            )}
          </div>
          <p className="text-[11px] text-stone-500 dark:text-zinc-400">
            Save draft changes or freeze this version into an immutable quote revision.
          </p>
        </div>

        <ProjectManagementActions
          projectId={project.id}
          isArchived={project.archived}
          isSaving={isSaving}
          onDuplicate={onDuplicate}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onSaveDraft={handleSaveDraft}
          onOpenIssueRevision={() => setIsRevisionModalOpen(true)}
          onOpenPromotion={canPromote ? () => setIsPromotionWizardOpen(true) : undefined}
          onOpenDelete={() => setIsDeletionModalOpen(true)}
          variant="footer"
        />
      </div>

      {/* Modal: Issue Quote Revision */}
      {isRevisionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center justify-center font-bold">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
                  Issue Quote Revision V{(project.currentRevisionNumber || 0) + 1}
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Creates an immutable economic snapshot of the current formula and product prices.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Revision Notes / Terms (Optional)
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Initial contract quote for Q4 wholesale delivery; valid 30 days."
                value={revisionNotes}
                onChange={(e) => setRevisionNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-stone-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setIsRevisionModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevision}
                disabled={isSaving}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'Issuing...' : 'Freeze & Issue Revision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promotion Wizard Modal (Phase 2B.6) */}
      {isPromotionWizardOpen && (
        <PromotionWizardModal
          project={project}
          workspaceId={project.workspaceId || store.getActiveWorkspaceId() || 'ws-main'}
          userRole={store.getUserRole()}
          currentUserId={auth.currentUser?.uid || 'user-mgmt'}
          currentUserName={auth.currentUser?.displayName || auth.currentUser?.email || 'Manager'}
          masterIngredients={masterIngredients}
          presets={presets}
          existingRecipes={existingRecipes}
          onClose={() => setIsPromotionWizardOpen(false)}
          onSuccess={(newRecipe) => {
            setIsPromotionWizardOpen(false);
            if (onOpenRecipe) {
              onOpenRecipe(newRecipe.id);
            }
          }}
        />
      )}
      {/* Project Deletion Modal (Phase 2B.5.10) */}
      <ProjectDeletionModal
        isOpen={isDeletionModalOpen}
        project={currentDraftRef.current || project}
        workspaceId={project.workspaceId || store.getActiveWorkspaceId() || 'ws-main'}
        userRole={store.getUserRole()}
        userId={auth.currentUser?.uid || 'user-mgmt'}
        onClose={() => setIsDeletionModalOpen(false)}
        onSuccess={(deletedId, message) => {
          isProjectDeletedRef.current = true;
          hasUserEditedRef.current = false;
          setIsDeletionModalOpen(false);
          onBack();
        }}
        onArchiveInstead={(id) => {
          onArchive(id);
        }}
      />
    </div>
  );
};
