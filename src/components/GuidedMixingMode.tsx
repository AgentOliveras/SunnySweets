import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  Circle,
  RotateCcw,
  Undo2,
  Check,
  ArrowLeft,
  AlertTriangle,
  ChefHat,
  BookOpen,
  RefreshCw,
} from 'lucide-react';
import { CalculationResult, CalculatedIngredient, ProductionPreset, Recipe } from '../types';
import { formatNumber, isButterIngredient, isPeanutButterIngredient, getDisplayDecimals } from '../utils/units';
import { store } from '../services/store';
import {
  resolveApplicableSafetyInstructions,
  isSafetySignatureAcknowledged,
  canProceedToMixWithSyncSafety,
  FirestoreHydrationState,
  resolveSafetyOperationalGateState,
  resolveSafetySyncStatusLabel,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
} from '../utils/productionNotes';

interface GuidedMixingModeProps {
  calculation: CalculationResult;
  presets?: ProductionPreset[];
  recipes?: Recipe[];
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  criticalNotesSyncError?: string | null;
  connectionVerified?: boolean;
  isReconnecting?: boolean;
  activeWorkspaceId?: string;
  onExit: () => void;
  decimalPlaces?: number;
  initialAcknowledgedSignatureForTest?: string | null;
  initialCompletedIdsForTest?: string[];
}

export const GuidedMixingMode: React.FC<GuidedMixingModeProps> = ({
  calculation,
  presets: presetsProp,
  recipes: recipesProp,
  recipesHydrationState: recipesHydrationProp,
  presetsHydrationState: presetsHydrationProp,
  criticalNotesSyncError,
  connectionVerified,
  isReconnecting,
  activeWorkspaceId,
  onExit,
  decimalPlaces,
  initialAcknowledgedSignatureForTest,
  initialCompletedIdsForTest,
}) => {
  const [currentBatch, setCurrentBatch] = useState(1);
  const totalBatches = calculation.suggestedBatches || 1;

  // Live subscription to canonical store updates so live edits to Recipe-Wide or Preset-Specific
  // Critical Production Notes and hydration state changes propagate immediately into Guided Mixing.
  const [livePresets, setLivePresets] = useState<ProductionPreset[]>(() => store.getPresets());
  const [liveRecipes, setLiveRecipes] = useState<Recipe[]>(() => store.getRecipes());
  const [storeSyncError, setStoreSyncError] = useState<string | null>(() =>
    store.getCriticalNotesSyncError()
  );
  const [storeRecipesHydrationState, setStoreRecipesHydrationState] =
    useState<FirestoreHydrationState>(() => store.getRecipesHydrationState());
  const [storePresetsHydrationState, setStorePresetsHydrationState] =
    useState<FirestoreHydrationState>(() => store.getPresetsHydrationState());
  const [storeConnectionVerified, setStoreConnectionVerified] = useState<boolean>(() =>
    store.isSafetyConnectionVerified()
  );
  const [storeIsReconnecting, setStoreIsReconnecting] = useState<boolean>(() =>
    store.isSafetyReconnectingState()
  );
  const [storeIsAuthorized, setStoreIsAuthorized] = useState<boolean>(() =>
    store.isAuthorized()
  );

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setLivePresets(store.getPresets());
      setLiveRecipes(store.getRecipes());
      setStoreSyncError(store.getCriticalNotesSyncError());
      setStoreRecipesHydrationState(store.getRecipesHydrationState());
      setStorePresetsHydrationState(store.getPresetsHydrationState());
      setStoreConnectionVerified(store.isSafetyConnectionVerified());
      setStoreIsReconnecting(store.isSafetyReconnectingState());
      setStoreIsAuthorized(store.isAuthorized());
    });
    return unsub;
  }, []);

  const effectivePresets = presetsProp !== undefined ? presetsProp : livePresets;
  const effectiveRecipes = recipesProp !== undefined ? recipesProp : liveRecipes;
  const effectiveSyncError =
    criticalNotesSyncError !== undefined ? criticalNotesSyncError : storeSyncError;
  const effectiveRecipesHydrationState =
    recipesHydrationProp !== undefined ? recipesHydrationProp : storeRecipesHydrationState;
  const effectivePresetsHydrationState =
    presetsHydrationProp !== undefined ? presetsHydrationProp : storePresetsHydrationState;
  const effectiveConnectionVerified =
    connectionVerified !== undefined ? connectionVerified : storeConnectionVerified;
  const effectiveIsReconnecting =
    isReconnecting !== undefined ? isReconnecting : storeIsReconnecting;
  const effectiveWorkspaceId = activeWorkspaceId || store.getActiveWorkspaceId();

  const liveRecipe = useMemo(() => {
    const found = effectiveRecipes.find((r) => r.id === calculation.recipe.id);
    return found || calculation.recipe;
  }, [effectiveRecipes, calculation.recipe]);

  const selectedPresetIds = useMemo(() => {
    return (calculation.requirements || [])
      .map((req) => req.presetId || '')
      .filter((id) => id.trim().length > 0);
  }, [calculation.requirements]);

  const safetyResolution = useMemo(() => {
    return resolveApplicableSafetyInstructions({
      recipe: liveRecipe,
      presets: effectivePresets,
      selectedPresetIds,
      activeWorkspaceId: effectiveWorkspaceId,
    });
  }, [liveRecipe, effectivePresets, selectedPresetIds, effectiveWorkspaceId]);

  const [showCriticalNotes, setShowCriticalNotes] = useState<boolean>(true);
  const [acknowledgedSafetySignature, setAcknowledgedSafetySignature] = useState<string | null>(
    () => initialAcknowledgedSignatureForTest ?? null
  );
  const [wasInvalidatedByLiveUpdate, setWasInvalidatedByLiveUpdate] = useState<boolean>(false);
  const [showInstructions, setShowInstructions] = useState<boolean>(false);

  const operationalGateState = useMemo(
    () =>
      resolveSafetyOperationalGateState({
        recipesHydrationState: effectiveRecipesHydrationState,
        presetsHydrationState: effectivePresetsHydrationState,
        syncError: effectiveSyncError,
        connectionVerified: effectiveConnectionVerified,
      }),
    [
      effectiveRecipesHydrationState,
      effectivePresetsHydrationState,
      effectiveSyncError,
      effectiveConnectionVerified,
    ]
  );

  const syncStatusLabel = useMemo(
    () =>
      resolveSafetySyncStatusLabel({
        operationalState: operationalGateState,
        isReconnecting: effectiveIsReconnecting,
      }),
    [operationalGateState, effectiveIsReconnecting]
  );

  const hasNotes = safetyResolution.hasSafetyNotes;
  const isNotesAcknowledged = useMemo(
    () => isSafetySignatureAcknowledged(safetyResolution.signature, acknowledgedSafetySignature),
    [safetyResolution.signature, acknowledgedSafetySignature]
  );
  const canProceedWithMix = useMemo(
    () =>
      canProceedToMixWithSyncSafety({
        hasNotes,
        isAcknowledged: isNotesAcknowledged,
        syncError: effectiveSyncError,
        recipesHydrationState: effectiveRecipesHydrationState,
        presetsHydrationState: effectivePresetsHydrationState,
        connectionVerified: effectiveConnectionVerified,
      }),
    [
      hasNotes,
      isNotesAcknowledged,
      effectiveSyncError,
      effectiveRecipesHydrationState,
      effectivePresetsHydrationState,
      effectiveConnectionVerified,
    ]
  );

  const prevWorkspaceRef = React.useRef<string>(
    `${calculation.recipe.id}::${effectiveWorkspaceId}`
  );
  useEffect(() => {
    const nextKey = `${calculation.recipe.id}::${effectiveWorkspaceId}`;
    if (prevWorkspaceRef.current !== nextKey || !storeIsAuthorized) {
      prevWorkspaceRef.current = nextKey;
      setAcknowledgedSafetySignature(null);
      setWasInvalidatedByLiveUpdate(false);
    }
  }, [calculation.recipe.id, effectiveWorkspaceId, storeIsAuthorized]);

  useEffect(() => {
    if (operationalGateState === 'READY' && hasNotes && !isNotesAcknowledged) {
      setShowCriticalNotes(true);
      if (
        acknowledgedSafetySignature &&
        acknowledgedSafetySignature !== safetyResolution.signature
      ) {
        setWasInvalidatedByLiveUpdate(true);
      }
    }
  }, [
    operationalGateState,
    hasNotes,
    isNotesAcknowledged,
    acknowledgedSafetySignature,
    safetyResolution.signature,
  ]);

  const hasInstructions = Boolean(
    liveRecipe.mixingInstructions && liveRecipe.mixingInstructions.trim().length > 0
  );

  // Track checked ingredient IDs
  const [completedIds, setCompletedIds] = useState<string[]>(
    () => initialCompletedIdsForTest ?? []
  );
  // History stack for Undo
  const [actionHistory, setActionHistory] = useState<string[]>([]);
  // Accidental completion toast feedback
  const [lastToggledName, setLastToggledName] = useState<string | null>(null);

  // Load saved active checklist progress from store if available
  useEffect(() => {
    const saved = store.getActiveChecklist();
    if (
      saved &&
      (saved.recipeName === calculation.recipe.name ||
        saved.calculation?.recipe?.name === calculation.recipe.name)
    ) {
      if (saved.completedIngredientIds) setCompletedIds(saved.completedIngredientIds);
      if (saved.currentBatch) setCurrentBatch(saved.currentBatch);
    }
  }, [calculation]);

  // Save active checklist state whenever completedIds or batch changes
  useEffect(() => {
    store.setActiveChecklist({
      recipeName: calculation.recipe.name,
      totalBatches,
      currentBatch,
      completedIngredientIds: completedIds,
      calculation,
    });
  }, [completedIds, currentBatch, calculation, totalBatches]);

  const handleAcknowledgeNotes = () => {
    if (operationalGateState !== 'READY' || !safetyResolution.signature) return;
    setAcknowledgedSafetySignature(safetyResolution.signature);
    setWasInvalidatedByLiveUpdate(false);
  };

  const handleRetrySafetySync = () => {
    void store.retrySafetySync();
  };

  const handleToggleIngredient = (ing: CalculatedIngredient) => {
    if (!canProceedWithMix) {
      setShowCriticalNotes(true);
      return;
    }

    const isCompleted = completedIds.includes(ing.id);
    let next: string[];

    if (isCompleted) {
      next = completedIds.filter((id) => id !== ing.id);
    } else {
      next = [...completedIds, ing.id];
    }

    setCompletedIds(next);
    setActionHistory([...actionHistory, ing.id]);
    setLastToggledName(ing.name);

    setTimeout(() => {
      setLastToggledName(null);
    }, 2500);
  };

  const handleUndo = () => {
    if (actionHistory.length === 0 || !canProceedWithMix) return;
    const lastId = actionHistory[actionHistory.length - 1];
    const nextHistory = actionHistory.slice(0, -1);

    if (completedIds.includes(lastId)) {
      setCompletedIds(completedIds.filter((id) => id !== lastId));
    } else {
      setCompletedIds([...completedIds, lastId]);
    }

    setActionHistory(nextHistory);
  };

  const handleReset = () => {
    setCompletedIds([]);
    setActionHistory([]);
    setCurrentBatch(1);
    setAcknowledgedSafetySignature(null);
    setWasInvalidatedByLiveUpdate(false);
    setShowCriticalNotes(true);
    store.setActiveChecklist({
      recipeName: calculation.recipe.name,
      totalBatches,
      currentBatch: 1,
      completedIngredientIds: [],
      calculation,
    });
    setLastToggledName('Checklist reset to beginning');
    setTimeout(() => {
      setLastToggledName(null);
    }, 2500);
  };

  const handleDiscardRun = () => {
    store.clearActiveChecklist();
    onExit();
  };

  const handleCompleteBatch = () => {
    if (!canProceedWithMix) {
      setShowCriticalNotes(true);
      return;
    }
    if (currentBatch < totalBatches) {
      setCurrentBatch(currentBatch + 1);
      setCompletedIds([]);
      setActionHistory([]);
    } else {
      store.clearActiveChecklist();
      onExit();
    }
  };

  const totalIngredientsCount = calculation.calculatedIngredients.length;
  const progressPercent =
    totalIngredientsCount > 0
      ? Math.round((completedIds.length / totalIngredientsCount) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#FDFCFB] dark:bg-[#141210] flex flex-col overflow-hidden">
      {/* Top Touch Header Bar */}
      <header className="bg-[#5A534B] dark:bg-[#1E1B18] text-white p-4 flex items-center justify-between shadow-md shrink-0 border-b border-[#47413A] dark:border-[#2D2925]">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="p-2 bg-[#47413A] dark:bg-[#25221F] hover:bg-[#3D3732] rounded-xl transition cursor-pointer"
          >
            <ArrowLeft className="w-6 h-6 text-[#EAE6E1]" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <ChefHat className="w-4 h-4 text-[#D4A373]" />
              <span className="text-xs font-semibold text-[#D4CEC7] uppercase tracking-wider">
                Guided Mixing Checklist
              </span>
              <span
                id="guided-safety-sync-status"
                className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                  syncStatusLabel === 'Safety Sync Ready'
                    ? 'bg-emerald-900/70 text-emerald-200 border-emerald-500/40'
                    : syncStatusLabel === 'Safety Sync Failed'
                    ? 'bg-rose-900/70 text-rose-200 border-rose-500/40'
                    : 'bg-amber-900/70 text-amber-200 border-amber-500/40'
                }`}
              >
                {syncStatusLabel}
              </span>
            </div>
            <h2 className="font-serif font-bold text-lg leading-tight text-white">
              {liveRecipe.name}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mixing Instructions button */}
          <button
            id="btn-guided-instructions-toggle"
            type="button"
            onClick={() => setShowInstructions((prev) => !prev)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              showInstructions
                ? 'bg-[#D4A373] text-white shadow-xs'
                : 'bg-[#47413A] dark:bg-[#25221F] text-[#EAE6E1] hover:bg-[#3D3732] border border-[#6B635A] dark:border-[#332F2B]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Instructions</span>
          </button>

          {/* Batch Selector if multi-batch */}
          {totalBatches > 1 && (
            <div className="bg-[#47413A] dark:bg-[#25221F] border border-[#6B635A] dark:border-[#332F2B] px-3 py-1.5 rounded-xl text-xs font-bold text-[#EAE6E1] flex items-center gap-2 font-mono">
              <span>Batch {currentBatch} of {totalBatches}</span>
            </div>
          )}
          <button
            onClick={handleDiscardRun}
            title="Discard this session"
            className="px-3 py-1.5 bg-[#47413A] hover:bg-red-900/40 text-red-200 border border-red-500/30 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Discard
          </button>
        </div>
      </header>

      {/* Touch Progress Bar */}
      <div className="bg-[#F5F2ED] dark:bg-[#1E1B18] px-4 py-3 shrink-0 border-b border-[#E5E1DA] dark:border-[#2D2925] flex items-center gap-4">
        <div className="flex-1 bg-[#EEECE8] dark:bg-[#25221F] h-4 rounded-full overflow-hidden p-0.5 border border-[#E5E1DA] dark:border-[#332F2B]">
          <div
            className="bg-[#D4A373] h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1] min-w-[50px] text-right font-mono">
          {progressPercent}%
        </span>
      </div>

      {/* Undo Toast Banner */}
      {lastToggledName && (
        <div className="bg-[#2D2926] text-white px-4 py-2 text-xs flex items-center justify-between shrink-0 shadow-inner">
          <span>
            Updated: <strong>{lastToggledName}</strong>
          </span>
          <button
            onClick={handleUndo}
            className="text-[#D4A373] font-bold underline flex items-center gap-1 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
        </div>
      )}

      {/* Touch Checklist Main Body */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Initial Firestore Hydration Safety Banner */}
        {operationalGateState === 'INITIAL_LOADING' && (
          <div
            id="guided-notes-hydration-loading-banner"
            className="rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3.5 sm:p-4 text-xs sm:text-sm shadow-xs flex items-center justify-between gap-2.5 flex-wrap"
          >
            <div className="flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 text-amber-700 dark:text-amber-400 animate-spin shrink-0" />
              <span className="font-black text-amber-950 dark:text-amber-100">
                {SAFETY_HYDRATION_LOADING_MESSAGE}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100">
              {syncStatusLabel}
            </span>
          </div>
        )}

        {/* Wi-Fi Interruption / Unverified Live Connection Banner */}
        {operationalGateState === 'CONNECTION_UNVERIFIED' && (
          <div
            id="guided-connection-unverified-banner"
            className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 p-3.5 sm:p-4 text-xs sm:text-sm shadow-xs space-y-2.5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-black text-amber-900 dark:text-amber-200 uppercase tracking-wider text-xs flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Live Safety Connection Unverified — Mixing Hold Active</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white">
                    {syncStatusLabel}
                  </span>
                </div>
                <p className="text-amber-950 dark:text-amber-100 font-bold leading-relaxed">
                  {SAFETY_CONNECTION_UNVERIFIED_MESSAGE}
                </p>
              </div>
              <button
                id="btn-guided-retry-safety-sync-unverified"
                type="button"
                onClick={handleRetrySafetySync}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs shadow-xs transition cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Safety Sync</span>
              </button>
            </div>
          </div>
        )}

        {/* Fail-Closed Firestore Sync Error Banner */}
        {operationalGateState === 'ERROR' && (
          <div
            id="guided-notes-sync-error-banner"
            className="rounded-xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-950/40 p-3.5 sm:p-4 text-xs sm:text-sm shadow-xs space-y-2.5"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-black text-rose-900 dark:text-rose-200 uppercase tracking-wider text-xs flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>Critical Production Notes Unavailable — Safety Hold Active</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white">
                    {syncStatusLabel}
                  </span>
                </div>
                <p className="text-rose-900 dark:text-rose-200 font-bold leading-relaxed">
                  {SAFETY_HYDRATION_ERROR_MESSAGE}
                </p>
                {effectiveSyncError && (
                  <p className="text-rose-800 dark:text-rose-300 text-xs leading-relaxed">
                    Details: {effectiveSyncError}
                  </p>
                )}
              </div>
              <button
                id="btn-guided-retry-safety-sync"
                type="button"
                onClick={handleRetrySafetySync}
                className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs shadow-xs transition cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Safety Sync</span>
              </button>
            </div>
          </div>
        )}

        {/* Unified Critical Production Notes Banner (Recipe-Wide + Preset-Specific) */}
        {(operationalGateState === 'READY' || operationalGateState === 'CONNECTION_UNVERIFIED') &&
          hasNotes && (
          <div
            id="guided-critical-notes-banner"
            className={`rounded-xl border-2 p-3 sm:p-4 text-xs sm:text-sm shadow-xs space-y-3 ${
              isNotesAcknowledged
                ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                : 'border-amber-500 bg-amber-50 dark:bg-amber-950/40'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  className={`flex items-center gap-2 font-bold uppercase tracking-wider text-xs ${
                    isNotesAcknowledged
                      ? 'text-emerald-900 dark:text-emerald-200'
                      : 'text-amber-900 dark:text-amber-200'
                  }`}
                >
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 ${
                      isNotesAcknowledged
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                  <span>Critical Production Notes</span>
                </div>
                <span
                  id="guided-notes-status-badge"
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    isNotesAcknowledged
                      ? 'bg-emerald-200/80 dark:bg-emerald-900/70 text-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-500 text-white'
                  }`}
                >
                  {isNotesAcknowledged ? 'REVIEWED' : 'REVIEW REQUIRED'}
                </span>
                {wasInvalidatedByLiveUpdate && !isNotesAcknowledged && (
                  <span
                    id="guided-notes-live-updated-badge"
                    className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-700 text-white"
                  >
                    Updated Live — Re-Review Required
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowCriticalNotes((prev) => !prev)}
                className="text-amber-800 dark:text-amber-300 font-bold hover:underline cursor-pointer text-xs"
              >
                {showCriticalNotes ? 'Hide' : 'Show'}
              </button>
            </div>

            {showCriticalNotes && (
              <div className="space-y-3">
                <div className="space-y-2.5 p-3 rounded-xl bg-white dark:bg-[#1E1B18] border border-amber-200 dark:border-amber-900/60">
                  {safetyResolution.allInstructions.map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                            item.scope === 'preset_specific'
                              ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                              : 'bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200 border-stone-300 dark:border-zinc-700'
                          }`}
                        >
                          {item.scope === 'preset_specific' && item.presetName
                            ? `Preset-Specific Critical Note — ${item.presetName}`
                            : item.scopeLabel}
                        </span>
                      </div>
                      <div className="text-amber-950 dark:text-amber-100 font-semibold leading-relaxed whitespace-pre-wrap break-words">
                        {item.note}
                      </div>
                    </div>
                  ))}
                </div>

                {!isNotesAcknowledged && (
                  <button
                    id="btn-guided-acknowledge-notes"
                    type="button"
                    disabled={operationalGateState !== 'READY'}
                    onClick={handleAcknowledgeNotes}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>I HAVE READ THESE PRODUCTION NOTES</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mixing Instructions Panel */}
        {showInstructions && (
          <div
            id="guided-mixing-instructions-panel"
            className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-[#FAF8F5] dark:bg-[#25221F] p-4 text-xs sm:text-sm shadow-xs space-y-2"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 dark:border-zinc-800 pb-2">
              <div className="flex items-center gap-2 font-bold text-stone-900 dark:text-zinc-100">
                <ChefHat className="w-4 h-4 text-[#D4A373] shrink-0" />
                <span>Mixing Instructions</span>
              </div>
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                className="text-xs text-stone-500 hover:text-stone-800 font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
            {hasInstructions ? (
              <div className="text-stone-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
                {liveRecipe.mixingInstructions}
              </div>
            ) : (
              <ol className="list-decimal list-inside space-y-1 text-stone-600 dark:text-zinc-400">
                <li>Scale and verify all required batch ingredients (mise en place).</li>
                <li>Follow standard mixer speed protocol for this recipe category.</li>
                <li>Inspect dough consistency and temperature before unloading.</li>
              </ol>
            )}
          </div>
        )}

        {totalBatches > 1 && (
          <div className="bg-[#F9F8F6] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] rounded-xl p-3 text-xs text-[#5A534B] dark:text-[#EAE6E1] font-medium">
            Showing ingredient quantities scaled for <strong>Batch {currentBatch}</strong> of {totalBatches}.
          </div>
        )}

        {!canProceedWithMix && (
          <div
            id="guided-notes-gate-notice"
            className={`p-3.5 rounded-xl border border-dashed text-xs font-bold text-center ${
              operationalGateState === 'ERROR'
                ? 'border-rose-400 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-950/20 text-rose-950 dark:text-rose-200'
                : 'border-amber-400 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 text-amber-950 dark:text-amber-200'
            }`}
          >
            {operationalGateState === 'INITIAL_LOADING'
              ? SAFETY_HYDRATION_LOADING_MESSAGE
              : operationalGateState === 'CONNECTION_UNVERIFIED'
              ? SAFETY_CONNECTION_UNVERIFIED_MESSAGE
              : operationalGateState === 'ERROR'
              ? SAFETY_HYDRATION_ERROR_MESSAGE
              : 'Review and acknowledge Critical Production Notes above to unlock ingredient check-off.'}
          </div>
        )}

        <div className={`space-y-3 ${!canProceedWithMix ? 'opacity-60' : ''}`}>
          {calculation.calculatedIngredients.map((ing) => {
            const isDone = completedIds.includes(ing.id);
            const batchAmount = totalBatches > 1 ? ing.perBatchQuantity : ing.requiredQuantity;

            return (
              <div
                key={ing.id}
                id={`guided-ing-${ing.id}`}
                onClick={() => handleToggleIngredient(ing)}
                className={`w-full p-4 rounded-xl border transition-all flex items-center justify-between gap-4 select-none min-h-[72px] ${
                  !canProceedWithMix ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${
                  isDone
                    ? 'bg-[#F9F8F6]/60 dark:bg-[#1E1B18]/60 border-[#E5E1DA] dark:border-[#2D2925] opacity-60'
                    : 'bg-white dark:bg-[#1E1B18] border-[#E5E1DA] dark:border-[#2D2925] shadow-sm hover:border-[#D4A373]'
                }`}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      isDone
                        ? 'bg-[#5A534B] text-white'
                        : 'border-2 border-[#D4A373] text-[#D4A373]'
                    }`}
                  >
                    {isDone ? <Check className="w-6 h-6 stroke-[3]" /> : <Circle className="w-5 h-5" />}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3
                        className={`font-serif font-bold text-lg sm:text-xl ${
                          isDone
                            ? 'line-through text-[#A39E93] dark:text-[#A39E93]'
                            : 'text-[#5A534B] dark:text-[#F3EFEA]'
                        }`}
                      >
                        {ing.name}
                      </h3>
                      {(ing.isPeanutButter ||
                        isPeanutButterIngredient(ing.name, liveRecipe?.name)) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] border border-[#D4A373]/50">
                          4 lb Jars
                        </span>
                      )}
                    </div>
                    {ing.notes && (
                      <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 font-medium">
                        {ing.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0 flex flex-col items-end">
                  {(() => {
                    const isPB =
                      ing.isPeanutButter ||
                      isPeanutButterIngredient(ing.name, liveRecipe?.name);
                    const isButter = !isPB && isButterIngredient(ing.name);
                    const { maxDecimals, minDecimals } = getDisplayDecimals(
                      ing.requiredUnit,
                      isButter,
                      decimalPlaces,
                      isPB
                    );
                    const noteText =
                      totalBatches > 1
                        ? ing.perBatchJarsDetail?.text || ing.jarsDetail?.text
                        : ing.jarsDetail?.text;

                    return (
                      <>
                        <div
                          className={`font-mono font-bold text-xl sm:text-2xl tracking-tight ${
                            isDone
                              ? 'line-through text-[#A39E93]'
                              : 'text-[#5A534B] dark:text-[#F3EFEA]'
                          }`}
                        >
                          {formatNumber(batchAmount || 0, maxDecimals, minDecimals)}{' '}
                          {ing.requiredUnit}
                        </div>
                        {noteText && (
                          <div
                            className={`text-xs font-mono font-bold px-2 py-0.5 rounded bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#3A3530] mt-0.5 ${
                              isDone ? 'text-[#A39E93]' : 'text-[#8B7E74] dark:text-[#D4A373]'
                            }`}
                          >
                            ({noteText})
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {ing.wastePercent > 0 && (
                    <span className="text-[10px] text-[#A39E93] mt-0.5">
                      Includes {ing.wastePercent}% waste
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom Large Touch Controls Bar */}
      <footer className="bg-white dark:bg-[#1E1B18] p-4 border-t border-[#E5E1DA] dark:border-[#2D2925] flex items-center justify-between gap-3 shrink-0 shadow-lg">
        <div className="flex items-center gap-2">
          <button
            id="guided-undo-btn"
            disabled={actionHistory.length === 0 || !canProceedWithMix}
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-4 py-3 bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-bold rounded-xl text-xs disabled:opacity-30 transition cursor-pointer min-h-[48px]"
          >
            <Undo2 className="w-4 h-4" />
            <span>Undo</span>
          </button>

          <button
            id="guided-reset-btn"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3.5 py-3 bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-semibold rounded-xl text-xs transition cursor-pointer min-h-[48px]"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset</span>
          </button>
        </div>

        <button
          id="guided-complete-btn"
          disabled={!canProceedWithMix}
          onClick={handleCompleteBatch}
          className="flex-1 max-w-xs flex items-center justify-center gap-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold py-3.5 px-5 rounded-xl shadow-md text-sm disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer min-h-[48px]"
        >
          <CheckCircle2 className="w-5 h-5 text-[#D4A373]" />
          <span>
            {currentBatch < totalBatches
              ? `Finish Batch ${currentBatch}`
              : 'Complete Production Run'}
          </span>
        </button>
      </footer>
    </div>
  );
};
