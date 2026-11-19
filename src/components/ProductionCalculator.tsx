import React, { useState, useEffect, useMemo } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Check,
  FileText,
  Play,
  RotateCcw,
  Scale,
  Percent,
  Box,
  Sliders,
  Printer,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import {
  AccessRole,
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionItemRequirement,
  CalculationResult,
  UserSettings,
  WeightUnit,
  ProductionHistoryEntry,
  MasterIngredient,
  ProductionMeasurementDisplayMode,
} from '../types';
import {
  calculateProduction,
  calculateRecipeTotal,
  getApplicablePresetsForRecipe,
  normalizePresetCategory,
  resolveEffectiveWastePercent,
  isValidWastePercent,
} from '../utils/calculator';
import { getTargetPresetCategoriesForRecipeCategory } from '../utils/categoryPresetMapping';
import { isPresetEnabledForProduction } from '../utils/productionOptionOrdering';
import {
  formatNumber,
  WEIGHT_UNITS,
  convertWeight,
  getUnitLabel,
  isButterIngredient,
  isPeanutButterIngredient,
  getDisplayDecimals,
  PRODUCTION_DISPLAY_MODES,
  isWeightUnit,
} from '../utils/units';
import { exportProductionSheetPDF } from '../utils/pdfExport';
import { store } from '../services/store';
import { calculateRecipeCostSummary, calculateScaledProductionCost } from '../utils/costing';
import {
  resolveApplicableSafetyInstructions,
  isSafetySignatureAcknowledged,
  canProceedToMix,
  canProceedToMixWithSyncSafety,
  FirestoreHydrationState,
  resolveSafetyOperationalGateState,
  resolveSafetySyncStatusLabel,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
} from '../utils/productionNotes';

interface ProductionCalculatorProps {
  recipes: Recipe[];
  presets: ProductionPreset[];
  mixers: Mixer[];
  settings: UserSettings;
  userRole?: AccessRole | null;
  categoryPresetMap?: Record<string, string | string[]>;
  initialRecipeId?: string;
  initialCalculation?: CalculationResult | null;
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  criticalNotesSyncError?: string | null;
  connectionVerified?: boolean;
  isReconnecting?: boolean;
  activeWorkspaceId?: string;
  onStartGuidedMixing: (calc: CalculationResult) => void;
  onSaveToHistory: (entry: ProductionHistoryEntry) => Promise<void> | void;
  masterIngredients?: MasterIngredient[];
  initialAcknowledgedSignatureForTest?: string | null;
  initialCheckedIngredientsForTest?: Record<string, boolean>;
}

export const ProductionCalculator: React.FC<ProductionCalculatorProps> = ({
  recipes,
  presets,
  mixers,
  settings,
  userRole,
  categoryPresetMap,
  initialRecipeId,
  initialCalculation = null,
  recipesHydrationState,
  presetsHydrationState,
  criticalNotesSyncError,
  connectionVerified,
  isReconnecting,
  activeWorkspaceId,
  onStartGuidedMixing,
  onSaveToHistory,
  masterIngredients,
  initialAcknowledgedSignatureForTest,
  initialCheckedIngredientsForTest,
}) => {
  const effectiveRole = userRole !== undefined ? userRole : (store.getUserRole() ?? 'owner');
  const canSaveHistory = effectiveRole === 'owner' || effectiveRole === 'editor';
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(
    initialRecipeId || (recipes.length > 0 ? recipes[0].id : '')
  );

  useEffect(() => {
    if (initialRecipeId) {
      setSelectedRecipeId(initialRecipeId);
      setWasteOverride(''); // Rule 8: Switching recipes clears temporary calculation override
    }
  }, [initialRecipeId]);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  // Authoritative effective default waste percentage for selected recipe (recipe-specific with bakery-wide fallback)
  const effectiveRecipeWaste = React.useMemo(() => {
    return resolveEffectiveWastePercent({
      recipeWastePercent: selectedRecipe?.defaultWastePercent,
      settingsWastePercent: settings.defaultWastePercent,
    });
  }, [selectedRecipe?.defaultWastePercent, settings.defaultWastePercent]);

  // Requirements list (multiple presets or custom items in 1 calculation)
  const [requirements, setRequirements] = useState<ProductionItemRequirement[]>([
    {
      id: `req-1`,
      presetId: presets.length > 0 ? presets[0].id : undefined,
      presetName: presets.length > 0 ? presets[0].name : '4 oz Cookie Case',
      quantity: '' as any,
      piecesPerUnit: presets.length > 0 ? presets[0].quantityPerUnit : 80,
      itemWeight: presets.length > 0 ? presets[0].finishedWeight : 4,
      itemWeightUnit: presets.length > 0 ? presets[0].weightUnit : 'oz',
    },
  ]);

  // Waste override (temporary calculation waste %) - blank by default (uses recipe default unless explicitly overridden)
  const [wasteOverride, setWasteOverride] = useState<string>('');

  // Selected Mixer
  const [selectedMixerId, setSelectedMixerId] = useState<string>(
    mixers.length > 0 ? mixers[0].id : ''
  );
  const selectedMixer = mixers.find((m) => m.id === selectedMixerId);

  // Display Unit Toggle
  const [displayUnit, setDisplayUnit] = useState<WeightUnit>(settings.defaultWeightUnit || 'lb');

  // Display Mode (Phase 2B.5.5)
  const [displayMode, setDisplayMode] = useState<ProductionMeasurementDisplayMode>(
    settings.defaultProductionDisplayMode || 'as_entered'
  );

  // Authoritative shared workspace category mapping (identical to Production Floor Mode)
  const effectiveCategoryPresetMap = React.useMemo(() => {
    return categoryPresetMap ?? store.getCategoryPresetMap();
  }, [categoryPresetMap]);

  // Active preset routing categories for the currently selected recipe (no automatic 'All' fallback for unmapped categories)
  const mappedPresetCategories = React.useMemo<string[]>(() => {
    return getTargetPresetCategoriesForRecipeCategory(
      selectedRecipe?.category,
      effectiveCategoryPresetMap
    );
  }, [selectedRecipe, effectiveCategoryPresetMap]);

  // Applicable presets filtered via the exact same logic used in Production Floor Mode
  const applicablePresets = React.useMemo(() => {
    return getApplicablePresetsForRecipe(selectedRecipe, presets, effectiveCategoryPresetMap);
  }, [selectedRecipe, presets, effectiveCategoryPresetMap]);

  // Group applicable presets by normalized category for organized selection
  const groupedPresets = React.useMemo(() => {
    const groups: Record<string, ProductionPreset[]> = {};
    applicablePresets.forEach((p) => {
      const cat = normalizePresetCategory(p);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });

    const isAll = mappedPresetCategories.includes('All');
    if (isAll) return groups;

    const sortedGroups: Record<string, ProductionPreset[]> = {};
    mappedPresetCategories.forEach((cat) => {
      const matchingKey = Object.keys(groups).find((k) => k.toLowerCase() === cat.toLowerCase());
      if (matchingKey && groups[matchingKey]) {
        sortedGroups[matchingKey] = groups[matchingKey];
      }
    });
    Object.keys(groups).forEach((key) => {
      if (!sortedGroups[key]) {
        sortedGroups[key] = groups[key];
      }
    });
    return sortedGroups;
  }, [applicablePresets, mappedPresetCategories]);

  // Update requirement preset when recipe or applicable presets change if default empty
  useEffect(() => {
    if (requirements.length === 1 && (!requirements[0].quantity || requirements[0].quantity === ('' as any))) {
      const targetPreset = applicablePresets[0] || null;
      if (targetPreset) {
        setRequirements([
          {
            id: `req-1`,
            presetId: targetPreset.id,
            presetName: targetPreset.name,
            quantity: '' as any,
            piecesPerUnit: targetPreset.quantityPerUnit,
            itemWeight: targetPreset.finishedWeight,
            itemWeightUnit: targetPreset.weightUnit,
          },
        ]);
      } else {
        setRequirements([
          {
            id: `req-1`,
            presetId: undefined,
            presetName: 'Custom Item',
            quantity: '' as any,
            piecesPerUnit: 100,
            itemWeight: 2,
            itemWeightUnit: 'oz',
          },
        ]);
      }
    }
  }, [selectedRecipeId, applicablePresets]);

  // Capacity Warning Override State
  const [capacityOverridden, setCapacityOverridden] = useState(false);
  const [showCapacityModal, setShowCapacityModal] = useState(false);

  // Checked ingredients state for checking off during production
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>(
    () => initialCheckedIngredientsForTest ?? {}
  );

  // Calculation Result
  const [calculationResult, setCalculationResult] = useState<CalculationResult | null>(
    initialCalculation
  );

  // Safety Hydration & Critical Production Notes acknowledgment state
  const [acknowledgedSafetySignature, setAcknowledgedSafetySignature] = useState<string | null>(
    () => initialAcknowledgedSignatureForTest ?? null
  );
  const [wasInvalidatedByLiveUpdate, setWasInvalidatedByLiveUpdate] = useState<boolean>(false);
  const [historySaveMessage, setHistorySaveMessage] = useState<{
    status: 'saved' | 'error';
    text: string;
  } | null>(null);

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
      setStoreSyncError(store.getCriticalNotesSyncError());
      setStoreRecipesHydrationState(store.getRecipesHydrationState());
      setStorePresetsHydrationState(store.getPresetsHydrationState());
      setStoreConnectionVerified(store.isSafetyConnectionVerified());
      setStoreIsReconnecting(store.isSafetyReconnectingState());
      setStoreIsAuthorized(store.isAuthorized());
    });
    return unsub;
  }, []);

  const effectiveWorkspaceId = activeWorkspaceId || store.getActiveWorkspaceId();
  const effectiveSyncError =
    criticalNotesSyncError !== undefined ? criticalNotesSyncError : storeSyncError;
  const effectiveRecipesHydrationState =
    recipesHydrationState !== undefined ? recipesHydrationState : storeRecipesHydrationState;
  const effectivePresetsHydrationState =
    presetsHydrationState !== undefined ? presetsHydrationState : storePresetsHydrationState;
  const effectiveConnectionVerified =
    connectionVerified !== undefined ? connectionVerified : storeConnectionVerified;
  const effectiveIsReconnecting =
    isReconnecting !== undefined ? isReconnecting : storeIsReconnecting;

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

  const activeRecipeForSafety = useMemo(() => {
    if (calculationResult?.recipe) {
      return recipes.find((r) => r.id === calculationResult.recipe.id) || calculationResult.recipe;
    }
    return selectedRecipe || null;
  }, [calculationResult?.recipe, recipes, selectedRecipe]);

  const selectedPresetIdsForSafety = useMemo(() => {
    const ids = new Set<string>();
    requirements.forEach((req) => {
      if (req.presetId && req.presetId.trim()) ids.add(req.presetId.trim());
    });
    calculationResult?.requirements?.forEach((req) => {
      if (req.presetId && req.presetId.trim()) ids.add(req.presetId.trim());
    });
    return Array.from(ids);
  }, [requirements, calculationResult?.requirements]);

  const safetyResolution = useMemo(
    () =>
      resolveApplicableSafetyInstructions({
        recipe: activeRecipeForSafety,
        presets,
        selectedPresetIds: selectedPresetIdsForSafety,
        activeWorkspaceId: effectiveWorkspaceId,
      }),
    [activeRecipeForSafety, presets, selectedPresetIdsForSafety, effectiveWorkspaceId]
  );

  const hasSafetyNotes = safetyResolution.hasSafetyNotes;
  const isNotesAcknowledged = useMemo(
    () => isSafetySignatureAcknowledged(safetyResolution.signature, acknowledgedSafetySignature),
    [safetyResolution.signature, acknowledgedSafetySignature]
  );

  const canProceedWithMix = useMemo(
    () =>
      canProceedToMixWithSyncSafety({
        hasNotes: hasSafetyNotes,
        isAcknowledged: isNotesAcknowledged,
        syncError: effectiveSyncError,
        recipesHydrationState: effectiveRecipesHydrationState,
        presetsHydrationState: effectivePresetsHydrationState,
        connectionVerified: effectiveConnectionVerified,
      }),
    [
      hasSafetyNotes,
      isNotesAcknowledged,
      effectiveSyncError,
      effectiveRecipesHydrationState,
      effectivePresetsHydrationState,
      effectiveConnectionVerified,
    ]
  );

  // Operational checklist visibility: gated behind safety approval on initial view,
  // and preserved in read-only hold if Wi-Fi drops (CONNECTION_UNVERIFIED) after approval.
  const canShowOperationalChecklist = useMemo(
    () =>
      canProceedWithMix ||
      (operationalGateState === 'CONNECTION_UNVERIFIED' &&
        canProceedToMix(hasSafetyNotes, isNotesAcknowledged)),
    [canProceedWithMix, operationalGateState, hasSafetyNotes, isNotesAcknowledged]
  );

  const prevCalcContextRef = React.useRef<string>(`${selectedRecipeId}::${effectiveWorkspaceId}`);
  useEffect(() => {
    const nextKey = `${selectedRecipeId}::${effectiveWorkspaceId}`;
    if (prevCalcContextRef.current !== nextKey || !storeIsAuthorized) {
      prevCalcContextRef.current = nextKey;
      setAcknowledgedSafetySignature(null);
      setWasInvalidatedByLiveUpdate(false);
      setHistorySaveMessage(null);
    }
  }, [selectedRecipeId, effectiveWorkspaceId, storeIsAuthorized]);

  useEffect(() => {
    if (
      operationalGateState === 'READY' &&
      hasSafetyNotes &&
      !isNotesAcknowledged &&
      acknowledgedSafetySignature &&
      acknowledgedSafetySignature !== safetyResolution.signature
    ) {
      setWasInvalidatedByLiveUpdate(true);
    }
  }, [
    operationalGateState,
    hasSafetyNotes,
    isNotesAcknowledged,
    acknowledgedSafetySignature,
    safetyResolution.signature,
  ]);

  const handleAcknowledgeSafetyNotes = () => {
    if (operationalGateState !== 'READY' || !safetyResolution.signature) return;
    setAcknowledgedSafetySignature(safetyResolution.signature);
    setWasInvalidatedByLiveUpdate(false);
  };

  const handleRetrySafetySync = () => {
    void store.retrySafetySync();
  };

  // Scaled Recipe Cost Summary (Read-Only Informational Display)
  const [showCostDetails, setShowCostDetails] = useState(false);

  const effectiveMasterIngredients = masterIngredients || store.getMasterIngredients();

  const recipeCostSummary = useMemo(() => {
    if (!calculationResult?.recipe) return null;
    return calculateRecipeCostSummary(calculationResult.recipe, effectiveMasterIngredients);
  }, [calculationResult?.recipe, effectiveMasterIngredients]);

  const scaledCostResult = useMemo(() => {
    if (!recipeCostSummary || !calculationResult) return null;
    return calculateScaledProductionCost(recipeCostSummary, calculationResult.scalingMultiplier);
  }, [recipeCostSummary, calculationResult?.scalingMultiplier]);

  const getHumanReadableReason = (reason?: string): string => {
    switch (reason) {
      case 'UNLINKED':
        return 'Link this recipe ingredient to a Pantry item.';
      case 'NO_PURCHASE_PRICE':
        return 'Purchase cost has not been entered.';
      case 'MISSING_DENSITY':
        return 'Density is required to cost this volume ingredient.';
      case 'MISSING_PIECE_WEIGHT':
        return 'Piece weight is required for this count ingredient.';
      case 'MASTER_INGREDIENT_NOT_FOUND':
        return 'The linked Pantry item is unavailable.';
      case 'UNSUPPORTED_UNIT':
        return 'This unit cannot currently be costed.';
      default:
        return 'Cost information incomplete.';
    }
  };

  // Synchronize display unit when business settings change
  useEffect(() => {
    if (settings.defaultWeightUnit) {
      setDisplayUnit(settings.defaultWeightUnit);
    }
  }, [settings.defaultWeightUnit]);

  // Perform Calculation function
  const handleCalculate = (
    forceOverride = false,
    customWasteOverride?: string,
    customMixerId?: string,
    customUnit?: WeightUnit,
    customDisplayMode?: ProductionMeasurementDisplayMode
  ) => {
    if (!selectedRecipe) {
      alert('Please select a recipe.');
      return;
    }

    if (requirements.length === 0) {
      alert('Please add at least one production item requirement.');
      return;
    }

    // Batch Calculation will not generate if there is an empty space in quantity (units)
    const hasEmptyQuantity = requirements.some(
      (r) =>
        (r.quantity as unknown as string) === '' ||
        r.quantity === undefined ||
        r.quantity === null ||
        isNaN(Number(r.quantity)) ||
        Number(r.quantity) <= 0
    );

    if (hasEmptyQuantity) {
      alert('Batch Calculation cannot generate because the Quantity (units) field is blank or invalid.');
      return;
    }

    setCheckedIngredients({});

    const wasteStr = customWasteOverride !== undefined ? customWasteOverride : wasteOverride;
    const overrideVal = isValidWastePercent(wasteStr) ? parseFloat(wasteStr) : undefined;
    const mixerIdToUse = customMixerId !== undefined ? customMixerId : selectedMixerId;
    const mixerToUse = mixers.find((m) => m.id === mixerIdToUse);
    const unitToUse = customUnit || displayUnit;
    const modeToUse = customDisplayMode || displayMode;

    const res = calculateProduction(selectedRecipe, requirements, {
      overrideWastePercent: overrideVal,
      defaultWastePercent: settings.defaultWastePercent,
      mixer: mixerToUse,
      defaultWeightUnit: unitToUse,
      displayMode: modeToUse,
      capacityOverridden: forceOverride || capacityOverridden,
    });

    // Check if mixer capacity is exceeded and user hasn't forced override yet
    if (res.isCapacityExceeded && !forceOverride && !capacityOverridden) {
      setCalculationResult(res);
      setShowCapacityModal(true);
      return;
    }

    setCalculationResult(res);
  };

  // Live recalculate when changing waste override or mixer if a calculation is already active
  const handleLiveWasteChange = (newWasteStr: string) => {
    setWasteOverride(newWasteStr);
    if (!calculationResult || !selectedRecipe) return;

    const hasInvalidQuantity = requirements.some(
      (r) =>
        (r.quantity as unknown as string) === '' ||
        r.quantity === undefined ||
        r.quantity === null ||
        isNaN(Number(r.quantity)) ||
        Number(r.quantity) <= 0
    );
    if (hasInvalidQuantity || requirements.length === 0) return;

    const overrideVal = isValidWastePercent(newWasteStr) ? parseFloat(newWasteStr) : undefined;
    const res = calculateProduction(selectedRecipe, requirements, {
      overrideWastePercent: overrideVal,
      defaultWastePercent: settings.defaultWastePercent,
      mixer: selectedMixer,
      defaultWeightUnit: displayUnit,
      displayMode,
      capacityOverridden: capacityOverridden,
    });
    setCalculationResult(res);
  };

  // Add requirement item
  const handleAddRequirement = () => {
    const firstPreset = applicablePresets.length > 0 ? applicablePresets[0] : null;
    const newReq: ProductionItemRequirement = {
      id: `req-${Date.now()}`,
      presetId: firstPreset ? firstPreset.id : undefined,
      presetName: firstPreset ? firstPreset.name : 'Custom Item',
      quantity: '' as any,
      piecesPerUnit: firstPreset ? firstPreset.quantityPerUnit : 100,
      itemWeight: firstPreset ? firstPreset.finishedWeight : 2,
      itemWeightUnit: firstPreset ? firstPreset.weightUnit : 'oz',
    };
    setRequirements([...requirements, newReq]);
  };

  // Update requirement
  const handleUpdateRequirement = (index: number, updates: Partial<ProductionItemRequirement>) => {
    const copy = [...requirements];
    copy[index] = { ...copy[index], ...updates };

    // If presetId changed, sync preset values
    if (updates.presetId) {
      const preset = presets.find((p) => p.id === updates.presetId);
      if (preset) {
        copy[index].presetName = preset.name;
        copy[index].piecesPerUnit = preset.quantityPerUnit;
        copy[index].itemWeight = preset.finishedWeight;
        copy[index].itemWeightUnit = preset.weightUnit;
      }
    }

    setRequirements(copy);
  };

  const handleRemoveRequirement = (index: number) => {
    setRequirements(requirements.filter((_, i) => i !== index));
  };

  const decimals = settings.decimalPlaces !== undefined ? settings.decimalPlaces : 2;

  const handleSaveToHistoryClick = async () => {
    if (!canSaveHistory || !calculationResult || !canProceedWithMix) return;
    const historyEntry: ProductionHistoryEntry = {
      id: `hist-${Date.now()}`,
      userId: '',
      recipeId: calculationResult.recipe.id,
      recipeName: calculationResult.recipe.name,
      calculatedAt: new Date().toISOString(),
      requirements: calculationResult.requirements,
      totalPieces: calculationResult.totalPieces,
      totalFinishedWeightGrams: calculationResult.totalFinishedWeightGrams,
      displayBatchWeight: calculationResult.displayBatchWeight,
      displayWeightUnit: calculationResult.displayWeightUnit,
      scalingMultiplier: calculationResult.scalingMultiplier,
      wastePercent: calculationResult.overrideWastePercent ?? calculationResult.recipeWastePercent,
      mixerName: calculationResult.mixer?.name,
      mixerMaxWeight: calculationResult.mixer?.maxWeight,
      mixerWeightUnit: calculationResult.mixer?.weightUnit,
      capacityExceeded: calculationResult.isCapacityExceeded,
      capacityOverridden: calculationResult.capacityOverridden,
      suggestedBatches: calculationResult.suggestedBatches,
      calculatedIngredients: calculationResult.calculatedIngredients,
      status: 'draft',
    };

    try {
      await Promise.resolve(onSaveToHistory(historyEntry));
      setHistorySaveMessage({
        status: 'saved',
        text: 'Production calculation saved to History.',
      });
    } catch (err: any) {
      setHistorySaveMessage({
        status: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to save production calculation to History.',
      });
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <Calculator className="w-6 h-6 text-[#D4A373]" />
            <span>Production Calculator</span>
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Combine packaging presets, adjust waste percentages, and validate mixer capacities.
          </p>
        </div>
        <span
          id="calc-safety-sync-status"
          className={`self-start sm:self-auto px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border ${
            syncStatusLabel === 'Safety Sync Ready'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
              : syncStatusLabel === 'Safety Sync Failed'
              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
          }`}
        >
          {syncStatusLabel}
        </span>
      </div>

      {/* Initial Firestore Hydration Safety Banner */}
      {operationalGateState === 'INITIAL_LOADING' && (
        <div
          id="calc-hydration-loading-banner"
          className="rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs sm:text-sm shadow-xs flex items-center justify-between gap-2.5 flex-wrap"
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
          id="calc-connection-unverified-banner"
          className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs sm:text-sm shadow-xs space-y-2.5"
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
              id="btn-calc-retry-safety-sync-unverified"
              type="button"
              onClick={handleRetrySafetySync}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs shadow-xs transition cursor-pointer shrink-0"
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
          id="calc-notes-sync-error-banner"
          className="rounded-xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-950/40 p-4 text-xs sm:text-sm shadow-xs space-y-2.5"
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
              id="btn-calc-retry-safety-sync"
              type="button"
              onClick={handleRetrySafetySync}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs shadow-xs transition cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Safety Sync</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Input Column */}
        <div className="lg:col-span-5 space-y-5">
          {/* Step 1: Select Recipe */}
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-[#D4A373] text-white flex items-center justify-center text-xs font-bold">
                1
              </span>
              <span>Select Recipe Formula</span>
            </h3>

            <select
              id="calc-recipe-select"
              value={selectedRecipeId}
              onChange={(e) => {
                setSelectedRecipeId(e.target.value);
                setWasteOverride(''); // Rule 8: Switching recipes clears temporary calculation overrides
                setCalculationResult(null);
                setCapacityOverridden(false);
              }}
              className="w-full px-3.5 py-2.5 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] font-medium"
            >
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (Base Yield: {r.batchYieldQuantity} {r.batchYieldUnit})
                </option>
              ))}
            </select>

            {selectedRecipe && (() => {
              const selectedRecipeTotal = calculateRecipeTotal(
                selectedRecipe,
                displayUnit,
                settings?.decimalPlaces
              );
              return (
                <div className="text-xs text-[#8B7E74] dark:text-[#A39E93] bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">Default Waste:</span>
                    <span className="font-mono">{effectiveRecipeWaste}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">Ingredients:</span>
                    <span>{selectedRecipe.ingredients.length} items</span>
                  </div>
                  <div className="pt-1.5 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between">
                    <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-1">
                      <Scale className="w-3.5 h-3.5 text-[#D4A373]" />
                      <span>Recipe Total:</span>
                    </span>
                    <span className="font-mono font-bold text-sm text-[#D4A373]">
                      {selectedRecipeTotal.formattedTargetUnit} {selectedRecipeTotal.targetUnit}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Step 2: Production Requirements (Presets or Custom) */}
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-[#D4A373] text-white flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <span>Production Requirements</span>
                </h3>
                {selectedRecipe && mappedPresetCategories && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] dark:text-[#A39E93]">
                    Preset Routing:{' '}
                    <span className="text-[#D4A373] font-bold">
                      {mappedPresetCategories.includes('All')
                        ? '✨ All Presets'
                        : `${mappedPresetCategories.join(', ')} Presets`}
                    </span>
                  </span>
                )}
              </div>

              <button
                id="calc-add-req-btn"
                onClick={handleAddRequirement}
                className="inline-flex items-center gap-1 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] hover:bg-[#EEECE8] font-bold px-2.5 py-1 rounded-lg text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Add Item</span>
              </button>
            </div>

            <div className="space-y-3">
              {requirements.map((req, idx) => (
                <div
                  key={req.id || idx}
                  className="p-3.5 bg-[#F9F8F6] dark:bg-[#25221F] rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    {/* Select Preset */}
                    <div className="flex-1 flex items-center gap-2">
                      <select
                        value={req.presetId || ''}
                        onChange={(e) => handleUpdateRequirement(idx, { presetId: e.target.value || undefined })}
                        className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-lg focus:outline-none dark:text-[#EAE6E1] font-medium cursor-pointer"
                      >
                        <option value="">-- Custom Item (Manual Specifications) --</option>
                        {(Object.entries(groupedPresets) as [string, ProductionPreset[]][]).map(([category, items]) => (
                          <optgroup key={category} label={`📂 ${category} (${items.length})`}>
                            {items.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {p.finishedWeight} {p.weightUnit} ({p.quantityPerUnit} / {p.unitName})
                                {!isPresetEnabledForProduction(p) ? ' (Hidden on Floor)' : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {req.presetId && (() => {
                        const matched = presets.find((p) => p.id === req.presetId);
                        const cat = matched?.category || 'Cookies';
                        return (
                          <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#FAF7F2] dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] shrink-0">
                            {cat}
                          </span>
                        );
                      })()}
                    </div>

                    {requirements.length > 1 && (
                      <button
                        onClick={() => handleRemoveRequirement(idx)}
                        className="p-1 text-[#C97B63] hover:text-red-700 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] text-[#A39E93] uppercase font-bold block mb-0.5">Quantity (Units)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Qty"
                        value={
                          (req.quantity as unknown as string) === '' ||
                          req.quantity === undefined ||
                          req.quantity === null ||
                          isNaN(Number(req.quantity))
                            ? ''
                            : req.quantity
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          handleUpdateRequirement(idx, {
                            quantity: val === '' ? ('' as any) : parseInt(val, 10),
                          });
                        }}
                        className="w-full px-2 py-1 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-md dark:text-[#EAE6E1]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-[#A39E93] uppercase font-bold block mb-0.5">Pcs / Unit</label>
                      <input
                        type="number"
                        min="1"
                        value={req.piecesPerUnit}
                        onChange={(e) =>
                          handleUpdateRequirement(idx, { piecesPerUnit: parseInt(e.target.value, 10) || 1 })
                        }
                        className="w-full px-2 py-1 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-md dark:text-[#EAE6E1]"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-[#A39E93] uppercase font-bold block mb-0.5">Item Weight</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          min="0.001"
                          value={req.itemWeight}
                          onChange={(e) =>
                            handleUpdateRequirement(idx, { itemWeight: parseFloat(e.target.value) || 0 })
                          }
                          className="w-full px-1.5 py-1 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-md dark:text-[#EAE6E1]"
                        />
                        <select
                          value={req.itemWeightUnit}
                          onChange={(e) =>
                            handleUpdateRequirement(idx, { itemWeightUnit: e.target.value as WeightUnit })
                          }
                          className="w-14 px-1 py-1 text-[11px] bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-md dark:text-[#EAE6E1]"
                        >
                          {WEIGHT_UNITS.map((u) => (
                            <option key={u.value} value={u.value}>
                              {u.value.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-[#D4A373] font-bold text-right font-mono">
                    Subtotal: {((Number(req.quantity) || 0) * req.piecesPerUnit).toLocaleString()} pcs (
                    {((Number(req.quantity) || 0) * req.piecesPerUnit * req.itemWeight).toFixed(1)} {req.itemWeightUnit})
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 3: Waste & Mixer Selection */}
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-[#D4A373] text-white flex items-center justify-center text-xs font-bold">
                3
              </span>
              <span>Waste & Equipment Selection</span>
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Temp Waste Override (%)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  placeholder={`Default (${effectiveRecipeWaste}%)`}
                  value={wasteOverride}
                  onChange={(e) => handleLiveWasteChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
                <p className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] mt-1">
                  Leave blank to use recipe/bakery default ({effectiveRecipeWaste}%). Explicit 0% is supported.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Select Mixer Equipment
                </label>
                <select
                  value={selectedMixerId}
                  onChange={(e) => {
                    const newMixerId = e.target.value;
                    setSelectedMixerId(newMixerId);
                    setCapacityOverridden(false);
                    if (calculationResult && selectedRecipe) {
                      const mixerObj = mixers.find((m) => m.id === newMixerId);
                      const overrideVal = isValidWastePercent(wasteOverride) ? parseFloat(wasteOverride) : undefined;
                      const res = calculateProduction(selectedRecipe, requirements, {
                        overrideWastePercent: overrideVal,
                        defaultWastePercent: settings.defaultWastePercent,
                        mixer: mixerObj,
                        defaultWeightUnit: displayUnit,
                        displayMode,
                        capacityOverridden: false,
                      });
                      setCalculationResult(res);
                    }
                  }}
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                >
                  <option value="">-- None (No Capacity Check) --</option>
                  {mixers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} (Max: {m.maxWeight} {m.weightUnit.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Production Measurement Display Mode Selector (Phase 2B.5.5) */}
            <div>
              <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                Measurement Display Mode
              </label>
              <div id="calc-display-mode-selector" className="flex items-center gap-1.5 flex-wrap">
                {PRODUCTION_DISPLAY_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    id={`calc-display-mode-${mode.value}`}
                    type="button"
                    onClick={() => {
                      setDisplayMode(mode.value);
                      const unitForWeight = isWeightUnit(mode.value) ? (mode.value as WeightUnit) : displayUnit;
                      if (isWeightUnit(mode.value)) {
                        setDisplayUnit(unitForWeight);
                      }
                      if (calculationResult && selectedRecipe) {
                        handleCalculate(capacityOverridden, undefined, undefined, unitForWeight, mode.value);
                      }
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition cursor-pointer text-center ${
                      displayMode === mode.value
                        ? 'bg-[#D4A373] text-white shadow-sm font-black'
                        : 'bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#EEECE8]'
                    }`}
                  >
                    {mode.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            <button
              id="calc-run-btn"
              onClick={() => handleCalculate(false)}
              className="w-full bg-[#D4A373] hover:bg-[#C49363] text-white font-bold py-3 rounded-xl shadow transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
            >
              <Calculator className="w-5 h-5" />
              <span>Calculate Scaled Recipe</span>
            </button>
          </div>
        </div>

        {/* Right Output Column */}
        <div className="lg:col-span-7">
          {calculationResult ? (
            <div className="space-y-5 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm">
              {/* Header Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EEECE8] dark:border-[#332F2B]">
                <div>
                  <h3 className="font-serif font-semibold text-xl text-[#5A534B] dark:text-[#EAE6E1]">
                    {calculationResult.recipe.name}
                  </h3>
                  <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                    Scaled Production Sheet • {calculationResult.requirements.length} item requirements
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    id="calc-guided-mixing-btn"
                    disabled={!canProceedWithMix}
                    onClick={() => {
                      if (!canProceedWithMix) return;
                      onStartGuidedMixing(calculationResult);
                    }}
                    className="inline-flex items-center gap-1.5 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-3.5 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Guided Mixing</span>
                  </button>

                  <button
                    id="calc-export-pdf-btn"
                    disabled={!canProceedWithMix}
                    onClick={() => {
                      if (!canProceedWithMix) return;
                      try {
                        const branding = store.getWorkspaceBranding();
                        exportProductionSheetPDF(
                          calculationResult,
                          {
                            displayName: branding.displayName || settings.businessName,
                            paletteId: branding.paletteId,
                          },
                          decimals,
                          {
                            recipes,
                            presets,
                            activeWorkspaceId: effectiveWorkspaceId,
                            recipesHydrationState: effectiveRecipesHydrationState,
                            presetsHydrationState: effectivePresetsHydrationState,
                            syncError: effectiveSyncError,
                            connectionVerified: effectiveConnectionVerified,
                            acknowledgedSafetySignature,
                          }
                        );
                      } catch (err: unknown) {
                        setHistorySaveMessage({
                          status: 'error',
                          text:
                            err instanceof Error
                              ? err.message
                              : 'Unable to export production sheet PDF.',
                        });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export PDF</span>
                  </button>

                  <button
                    id="calc-save-history-btn"
                    disabled={!canProceedWithMix || !canSaveHistory}
                    title={
                      !canSaveHistory
                        ? 'Viewer role is read-only — Editor or Owner access required to save batch history'
                        : undefined
                    }
                    onClick={handleSaveToHistoryClick}
                    className="inline-flex items-center gap-1.5 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] hover:bg-[#EEECE8] font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#D4A373]" />
                    <span>{canSaveHistory ? 'Save History' : 'Save History (Read-Only)'}</span>
                  </button>
                </div>
              </div>

              {historySaveMessage && (
                <div
                  id="calc-history-save-status"
                  className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                    historySaveMessage.status === 'saved'
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                  }`}
                >
                  {historySaveMessage.status === 'saved' ? (
                    <Check className="w-4 h-4 stroke-[3] shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{historySaveMessage.text}</span>
                </div>
              )}

              {/* Critical Production Notes Safety Gate (Recipe-Wide + Preset-Specific) */}
              {(operationalGateState === 'READY' || operationalGateState === 'CONNECTION_UNVERIFIED') &&
                hasSafetyNotes && (
                <div
                  id="calc-critical-notes-card"
                  className={`rounded-xl border-2 p-4 text-xs sm:text-sm space-y-3 ${
                    isNotesAcknowledged
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-amber-500 bg-amber-50 dark:bg-amber-950/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle
                        className={`w-4 h-4 shrink-0 ${
                          isNotesAcknowledged
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      />
                      <span
                        className={`font-black uppercase tracking-wider text-xs ${
                          isNotesAcknowledged
                            ? 'text-emerald-900 dark:text-emerald-200'
                            : 'text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        Critical Production Notes
                      </span>
                      <span
                        id="calc-notes-status-badge"
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
                          id="calc-notes-live-updated-badge"
                          className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-700 text-white"
                        >
                          Updated Live — Re-Review Required
                        </span>
                      )}
                    </div>
                  </div>

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
                      id="btn-calc-acknowledge-notes"
                      type="button"
                      disabled={operationalGateState !== 'READY'}
                      onClick={handleAcknowledgeSafetyNotes}
                      className="w-full min-h-[42px] py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>I HAVE READ THESE PRODUCTION NOTES</span>
                    </button>
                  )}
                </div>
              )}

              {/* Persistent Mixer Capacity Warning Banner if capacity exceeded */}
              {(calculationResult.isCapacityExceeded || calculationResult.capacityOverridden) && (
                <div className="bg-[#FDF2F0] dark:bg-[#2C1916] border border-[#F5D5CF] dark:border-[#4E2620] rounded-xl p-4 text-[#A65B48] dark:text-[#EAA89A] space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <AlertTriangle className="w-5 h-5 text-[#C97B63] shrink-0" />
                    <span>Capacity Warning</span>
                  </div>
                  <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
                    Calculated batch weight (<strong>{formatNumber(calculationResult.displayBatchWeight, calculationResult.displayWeightUnit === 'g' ? 0 : decimals)} {calculationResult.displayWeightUnit.toUpperCase()}</strong>) exceeds {calculationResult.mixer?.name || 'Mixer'} capacity (<strong>{calculationResult.mixer?.maxWeight} {calculationResult.mixer?.weightUnit.toUpperCase()}</strong>).
                  </p>
                  <div className="bg-white/90 dark:bg-[#1E1B18]/90 p-2.5 rounded-lg text-xs border border-[#F5D5CF] dark:border-[#4E2620] font-bold text-[#A65B48] dark:text-[#EAA89A]">
                    💡 Suggested Split: Mix into <strong>{calculationResult.suggestedBatches} batches</strong>.
                  </div>
                </div>
              )}

              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#A39E93]">
                    Total Pieces
                  </span>
                  <div className="text-xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                    {calculationResult.totalPieces.toLocaleString()}
                  </div>
                </div>

                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#A39E93]">
                    Total Batch Weight
                  </span>
                  <div className="text-xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                    {formatNumber(calculationResult.displayBatchWeight, calculationResult.displayWeightUnit === 'g' ? 0 : decimals)}{' '}
                    <span className="text-xs font-normal text-[#8B7E74]">
                      {calculationResult.displayWeightUnit.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#A39E93]">
                    Scaling Multiplier
                  </span>
                  <div className="text-xl font-bold font-mono text-[#D4A373]">
                    {formatNumber(calculationResult.scalingMultiplier, 3)}x
                  </div>
                </div>

                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#A39E93]">
                    Waste Allowance
                  </span>
                  <div className="text-xl font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                    {calculationResult.overrideWastePercent ?? calculationResult.recipeWastePercent}%
                  </div>
                </div>
              </div>

              {/* Read-Only Estimated Ingredient Cost Summary */}
              <div
                id="production-cost-summary"
                className="p-3.5 bg-[#F9F8F6] dark:bg-[#25221F] rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-[#8B7E74] dark:text-[#A39E93]">
                      Estimated Ingredient Cost
                    </span>
                    {scaledCostResult?.isComplete ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#E8F5E9] dark:bg-[#1B382B] text-[#2D6A4F] dark:text-[#52B788]">
                        Complete
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#FDF2F0] dark:bg-[#2C1916] text-[#A65B48] dark:text-[#EAA89A]">
                        Incomplete ({recipeCostSummary?.costedIngredientCount ?? 0} of {recipeCostSummary?.totalIngredientCount ?? 0} ingredients costed)
                      </span>
                    )}
                  </div>

                  {!scaledCostResult?.isComplete && recipeCostSummary && recipeCostSummary.missing.length > 0 && (
                    <button
                      id="view-missing-cost-btn"
                      type="button"
                      onClick={() => setShowCostDetails(!showCostDetails)}
                      className="text-xs font-semibold text-[#D4A373] hover:text-[#C49363] hover:underline cursor-pointer flex items-center gap-1 self-start sm:self-auto"
                    >
                      <span>{showCostDetails ? 'Hide Missing Cost Information' : 'View Missing Cost Information'}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCostDetails ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>

                <div className="flex items-baseline gap-3 flex-wrap">
                  {scaledCostResult?.isComplete && scaledCostResult.estimatedCost !== undefined ? (
                    <>
                      <div className="text-xl font-bold font-mono text-[#2D6A4F] dark:text-[#52B788]">
                        ${scaledCostResult.estimatedCost.toFixed(2)}
                      </div>
                      {calculationResult.totalPieces > 0 && (
                        <div className="text-xs text-[#8B7E74] dark:text-[#A39E93] font-mono">
                          (${ (scaledCostResult.estimatedCost / calculationResult.totalPieces).toFixed(2)} / piece)
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                      <span className="font-semibold text-[#C97B63] dark:text-[#EAA89A]">Incomplete</span> — {recipeCostSummary?.costedIngredientCount ?? 0} of {recipeCostSummary?.totalIngredientCount ?? 0} ingredients costed
                    </div>
                  )}
                </div>

                {/* Expandable Missing Cost Information Details */}
                {showCostDetails && !scaledCostResult?.isComplete && recipeCostSummary && (
                  <div id="missing-cost-details-panel" className="mt-2 pt-2 border-t border-[#EEECE8] dark:border-[#332F2B] space-y-1.5">
                    <span className="text-[11px] font-bold text-[#5A534B] dark:text-[#EAE6E1] block">
                      Missing Cost Details:
                    </span>
                    <div className="space-y-1">
                      {recipeCostSummary.missing.map((item) => (
                        <div
                          key={item.ingredientId}
                          className="flex flex-col sm:flex-row sm:items-center justify-between text-xs px-2.5 py-1.5 bg-white dark:bg-[#1E1B18] rounded-lg border border-[#EEECE8] dark:border-[#332F2B] gap-1"
                        >
                          <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                            {item.ingredientName}
                          </span>
                          <span className="text-[#C97B63] dark:text-[#EAA89A] text-[11px]">
                            {getHumanReadableReason(item.reason)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Ingredients Scaled Formula Table */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                      Scaled Formula Requirements
                    </h4>
                    <span className="text-xs text-[#8B7E74] dark:text-[#A39E93] font-medium font-mono">
                      ({Object.values(checkedIngredients).filter(Boolean).length} / {calculationResult.calculatedIngredients.length} checked)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Quick Mode Switcher */}
                    <div id="table-display-mode-selector" className="flex items-center bg-[#F5F2ED] dark:bg-[#25221F] p-0.5 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] text-[11px] font-bold">
                      {PRODUCTION_DISPLAY_MODES.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          id={`table-display-mode-${mode.value}`}
                          onClick={() => {
                            setDisplayMode(mode.value);
                            const unitForWeight = isWeightUnit(mode.value) ? (mode.value as WeightUnit) : displayUnit;
                            if (isWeightUnit(mode.value)) {
                              setDisplayUnit(unitForWeight);
                            }
                            if (calculationResult && selectedRecipe) {
                              handleCalculate(capacityOverridden, undefined, undefined, unitForWeight, mode.value);
                            }
                          }}
                          className={`px-2 py-0.5 rounded transition cursor-pointer ${
                            displayMode === mode.value
                              ? 'bg-[#D4A373] text-white shadow-xs font-black'
                              : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
                          }`}
                        >
                          {mode.shortLabel}
                        </button>
                      ))}
                    </div>

                    {Object.values(checkedIngredients).some(Boolean) && canProceedWithMix && (
                      <button
                        onClick={() => {
                          if (!canProceedWithMix) return;
                          setCheckedIngredients({});
                        }}
                        className="text-xs font-semibold text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] underline cursor-pointer"
                      >
                        Reset Checklist
                      </button>
                    )}
                    {calculationResult.suggestedBatches > 1 && (
                      <span className="text-xs font-bold text-[#C97B63]">
                        Split into {calculationResult.suggestedBatches} Batches
                      </span>
                    )}
                  </div>
                </div>

                {!canShowOperationalChecklist ? (
                  <div
                    id="calc-checklist-safety-gate"
                    className={`p-6 rounded-xl border-2 border-dashed text-center space-y-3 ${
                      operationalGateState === 'ERROR'
                        ? 'border-rose-400 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-950/20 text-rose-950 dark:text-rose-200'
                        : 'border-amber-400 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 text-amber-950 dark:text-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-center">
                      {operationalGateState === 'ERROR' ? (
                        <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                      ) : operationalGateState === 'INITIAL_LOADING' ? (
                        <RefreshCw className="w-6 h-6 text-amber-700 dark:text-amber-400 animate-spin" />
                      ) : (
                        <FileText className="w-6 h-6 text-amber-700 dark:text-amber-400" />
                      )}
                    </div>
                    <p id="calc-notes-gate-notice" className="text-xs sm:text-sm font-black">
                      {operationalGateState === 'INITIAL_LOADING'
                        ? SAFETY_HYDRATION_LOADING_MESSAGE
                        : operationalGateState === 'CONNECTION_UNVERIFIED'
                        ? SAFETY_CONNECTION_UNVERIFIED_MESSAGE
                        : operationalGateState === 'ERROR'
                        ? SAFETY_HYDRATION_ERROR_MESSAGE
                        : 'Review and acknowledge Critical Production Notes above to unlock the operational ingredient checklist, Guided Mixing, PDF export, and batch history logging.'}
                    </p>
                    {(operationalGateState === 'ERROR' ||
                      operationalGateState === 'CONNECTION_UNVERIFIED') && (
                      <div>
                        <button
                          id="btn-calc-gate-retry-safety-sync"
                          type="button"
                          onClick={handleRetrySafetySync}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white font-bold text-xs shadow-xs transition cursor-pointer ${
                            operationalGateState === 'ERROR'
                              ? 'bg-rose-600 hover:bg-rose-500'
                              : 'bg-amber-600 hover:bg-amber-500'
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Retry Safety Sync</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {!canProceedWithMix && (
                      <div
                        id="calc-notes-gate-notice"
                        className="p-3.5 rounded-xl border border-dashed border-amber-400 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/25 text-amber-950 dark:text-amber-200 text-xs font-bold text-center"
                      >
                        {SAFETY_CONNECTION_UNVERIFIED_MESSAGE}
                      </div>
                    )}

                    <div
                      className={`overflow-x-auto rounded-xl border border-[#E5E1DA] dark:border-[#332F2B] ${
                        !canProceedWithMix ? 'opacity-65' : ''
                      }`}
                    >
                  <table className="w-full text-left">
                    <thead className="bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-bold uppercase text-xs tracking-wider">
                      <tr>
                        <th className="p-3.5 w-14 text-center">Done</th>
                        <th className="p-3.5">Ingredient</th>
                        <th className="p-3.5 text-right">Required Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0EEEA] dark:divide-[#2D2925] text-[#5A534B] dark:text-[#F3EFEA] font-medium">
                      {calculationResult.calculatedIngredients.map((ing) => {
                        const isDone = !!checkedIngredients[ing.id];
                        return (
                          <tr
                            key={ing.id}
                            id={`calc-ing-row-${ing.id}`}
                            onClick={() => {
                              if (!canProceedWithMix) return;
                              setCheckedIngredients((prev) => ({
                                ...prev,
                                [ing.id]: !prev[ing.id],
                              }));
                            }}
                            className={`transition-all select-none ${
                              !canProceedWithMix ? 'cursor-not-allowed' : 'cursor-pointer'
                            } ${
                              isDone
                                ? 'bg-[#F5F2ED]/60 dark:bg-[#25221F]/40 opacity-55'
                                : 'hover:bg-[#F9F8F6] dark:hover:bg-[#25221F]/60'
                            }`}
                          >
                            <td className="p-3.5 text-center">
                              <div
                                className={`w-6 h-6 mx-auto rounded-md flex items-center justify-center transition-colors border ${
                                  isDone
                                    ? 'bg-[#5A534B] border-[#5A534B] text-white'
                                    : 'border-[#5A534B]/40 dark:border-[#A39E93]/40 bg-white dark:bg-[#1E1B18] text-transparent hover:border-[#5A534B]'
                                }`}
                              >
                                {isDone && <Check className="w-4 h-4 stroke-[3]" />}
                              </div>
                            </td>
                            <td className="p-3.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-base sm:text-lg font-bold ${
                                    isDone
                                      ? 'line-through text-[#8B7E74] dark:text-[#8B7E74]'
                                      : 'text-[#5A534B] dark:text-[#F3EFEA]'
                                  }`}
                                >
                                  {ing.name}
                                </span>
                                {isButterIngredient(ing.name) && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] border border-[#D4A373]/50">
                                    🧈 lbs (2 decimals)
                                  </span>
                                )}
                                {(ing.isPeanutButter || isPeanutButterIngredient(ing.name, selectedRecipe?.name)) && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] border border-[#D4A373]/50 flex items-center gap-1">
                                    <span>🥜</span> 4 lb Jars
                                  </span>
                                )}
                              </div>
                              {ing.notes && (
                                <div className="text-xs font-normal text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                                  {ing.notes}
                                </div>
                              )}
                            </td>
                            <td className="p-3.5 text-right">
                              {(() => {
                                const isPB = ing.isPeanutButter || isPeanutButterIngredient(ing.name, selectedRecipe?.name);
                                const isButter = !isPB && isButterIngredient(ing.name);
                                const { maxDecimals, minDecimals } = getDisplayDecimals(
                                  ing.requiredUnit,
                                  isButter,
                                  decimals,
                                  isPB
                                );
                                return (
                                  <div className="flex flex-col items-end">
                                    <div
                                      className={`font-bold font-mono text-lg sm:text-xl tracking-tight ${
                                        isDone
                                          ? 'line-through text-[#8B7E74]'
                                          : 'text-[#5A534B] dark:text-[#F3EFEA]'
                                      }`}
                                    >
                                      {formatNumber(ing.requiredQuantity, maxDecimals, minDecimals)} {ing.requiredUnit}
                                    </div>
                                    {ing.jarsDetail?.text && (
                                      <div
                                        className={`inline-flex items-center gap-1 text-xs font-mono font-bold mt-0.5 px-2 py-0.5 rounded bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#3A3530] ${
                                          isDone ? 'text-[#8B7E74]' : 'text-[#8B7E74] dark:text-[#D4A373]'
                                        }`}
                                      >
                                        <span>({ing.jarsDetail.text})</span>
                                      </div>
                                    )}
                                    {calculationResult.suggestedBatches > 1 && ing.perBatchQuantity !== undefined && (
                                      <div className="text-xs sm:text-sm font-mono text-[#5A534B]/80 dark:text-[#F3EFEA]/80 font-bold mt-0.5">
                                        ({formatNumber(ing.perBatchQuantity, maxDecimals, minDecimals)} {ing.requiredUnit} / batch
                                        {ing.perBatchJarsDetail?.text ? ` • ${ing.perBatchJarsDetail.text}` : ''})
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-[#F5F2ED] dark:bg-[#25221F] border-t-2 border-[#E5E1DA] dark:border-[#332F2B] font-bold text-sm">
                      <tr>
                        <td colSpan={2} className="p-3.5 text-[#5A534B] dark:text-[#EAE6E1]">
                          <div className="flex items-center gap-2">
                            <Scale className="w-5 h-5 text-[#5A534B] dark:text-[#D4A373]" />
                            <span className="text-sm sm:text-base">Total Scaled Batch Weight:</span>
                          </div>
                        </td>
                        <td className="p-3.5 text-right">
                          <span className="font-mono font-bold text-base sm:text-lg text-[#5A534B] dark:text-[#F3EFEA]">
                            {formatNumber(
                              calculationResult.displayBatchWeight,
                              calculationResult.displayWeightUnit === 'g' ? 0 : decimals
                            )}{' '}
                            {calculationResult.displayWeightUnit.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[350px] bg-white dark:bg-[#1E1B18] border border-dashed border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-8 flex flex-col items-center justify-center text-center text-[#A39E93]">
              <Calculator className="w-12 h-12 text-[#D4A373]/50 mb-3 stroke-[1.5]" />
              <h4 className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1] mb-1">
                Calculation Ready
              </h4>
              <p className="text-xs max-w-sm text-[#8B7E74] dark:text-[#A39E93]">
                Select a recipe formula, specify packaging item counts on the left, and click &quot;Calculate Scaled Recipe&quot;.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mixer Capacity Exceeded Modal Gate */}
      {showCapacityModal && calculationResult && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#F5D5CF] rounded-xl w-full max-w-md shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#A65B48]">
              <div className="w-10 h-10 rounded-full bg-[#FDF2F0] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-[#C97B63]" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Capacity Warning
                </h3>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  Calculated weight exceeds mixer threshold.
                </p>
              </div>
            </div>

            <div className="bg-[#FDF2F0] dark:bg-[#2C1916] p-4 rounded-xl border border-[#F5D5CF] dark:border-[#4E2620] space-y-2 text-xs text-[#5A534B] dark:text-[#EAE6E1]">
              <div className="flex justify-between">
                <span>Calculated Batch Weight:</span>
                <span className="font-bold font-mono text-[#A65B48]">
                  {formatNumber(calculationResult.displayBatchWeight, decimals)}{' '}
                  {calculationResult.displayWeightUnit.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Mixer Safe Limit ({calculationResult.mixer?.name}):</span>
                <span className="font-bold font-mono">
                  {calculationResult.mixer?.maxWeight}{' '}
                  {calculationResult.mixer?.weightUnit.toUpperCase()}
                </span>
              </div>
              <div className="pt-2 border-t border-[#F5D5CF] dark:border-[#4E2620] flex justify-between font-bold text-[#D4A373]">
                <span>Suggested Batches Required:</span>
                <span>{calculationResult.suggestedBatches} Batches</span>
              </div>
            </div>

            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
              Exceeding mixer capacity can overload motors or cause dough spillover. You can split the batch or calculate anyway.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                id="capacity-modal-cancel-btn"
                onClick={() => {
                  setShowCapacityModal(false);
                  setCalculationResult(null);
                }}
                className="py-2.5 bg-white border border-[#F5D5CF] text-[#A65B48] text-xs font-bold rounded-xl hover:bg-[#FDF2F0] cursor-pointer"
              >
                Split / Edit
              </button>
              <button
                id="capacity-modal-override-btn"
                onClick={() => {
                  setCapacityOverridden(true);
                  setShowCapacityModal(false);
                  handleCalculate(true);
                }}
                className="py-2.5 bg-[#C97B63] hover:bg-[#B86A52] text-white text-xs font-bold rounded-xl shadow cursor-pointer"
              >
                Calculate Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

