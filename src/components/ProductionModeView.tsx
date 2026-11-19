import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Check,
  RotateCcw,
  Search,
  Scale,
  AlertTriangle,
  Minus,
  Plus,
  SlidersHorizontal,
  Package,
  Layers,
  Sparkles,
  ChevronDown,
  FileText,
  ChefHat,
  BookOpen,
  RefreshCw,
} from 'lucide-react';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  UserSettings,
  ProductionItemRequirement,
  WeightUnit,
  CriticalProductionNote,
  ProductionMeasurementDisplayMode,
} from '../types';
import {
  calculateProduction,
  getApplicablePresetsForRecipe,
  resolveEffectiveWastePercent,
} from '../utils/calculator';
import {
  getOrderedProductionOptionKeys,
  isPresetEnabledForProduction,
  SYSTEM_OPTION_KEYS,
} from '../utils/productionOptionOrdering';
import { store } from '../services/store';
import {
  getProductionNotesStatus,
  resolveApplicableSafetyInstructions,
  isSafetySignatureAcknowledged,
  canProceedToMix,
  canProceedToMixWithSyncSafety,
  FirestoreHydrationState,
  resolveSafetyHydrationGateState,
  resolveSafetyOperationalGateState,
  resolveSafetySyncStatusLabel,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
} from '../utils/productionNotes';
import {
  formatNumber,
  fromGrams,
  toGrams,
  convertWeight,
  isWeightUnit,
  isButterIngredient,
  isPeanutButterIngredient,
  getDisplayDecimals,
  PRODUCTION_DISPLAY_MODES,
} from '../utils/units';
import {
  loadRecipeUsageMap,
  loadSortPreference,
  recordProductionRun,
  saveSortPreference,
  sortRecipes,
  ProductionSortOption,
  RecipeUsageMap,
} from '../utils/productionHistory';
import { ProductionNumericInput } from './ProductionNumericInput';

interface ProductionModeViewProps {
  recipes: Recipe[];
  presets: ProductionPreset[];
  mixers: Mixer[];
  settings: UserSettings;
  categoryPresetMap?: Record<string, string | string[]>;
  productionOptionOrder?: string[] | null;
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  criticalNotesSyncError?: string | null;
  connectionVerified?: boolean;
  isReconnecting?: boolean;
  activeWorkspaceId?: string;
  onExit: () => void;
  initialRecipeId?: string;
  initialAcknowledgedSignatureForTest?: string | null;
  initialCheckedIngredientsForTest?: Record<string, boolean>;
  initialPresetQuantitiesForTest?: Record<string, number>;
}

export const ProductionModeView: React.FC<ProductionModeViewProps> = ({
  recipes,
  presets,
  mixers,
  settings,
  categoryPresetMap,
  productionOptionOrder,
  recipesHydrationState,
  presetsHydrationState,
  criticalNotesSyncError,
  connectionVerified,
  isReconnecting,
  activeWorkspaceId,
  onExit,
  initialRecipeId,
  initialAcknowledgedSignatureForTest,
  initialCheckedIngredientsForTest,
  initialPresetQuantitiesForTest,
}) => {
  // Navigation within Production Mode: null means Recipe Selector
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(
    initialRecipeId || null
  );

  // Search and category filter on the selector screen
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortOption, setSortOption] = useState<ProductionSortOption>(() => loadSortPreference());
  const [usageMap, setUsageMap] = useState<RecipeUsageMap>(() => loadRecipeUsageMap());
  const recordedRecipeIdRef = useRef<string | null>(null);

  const handleSortChange = (newSort: ProductionSortOption) => {
    setSortOption(newSort);
    saveSortPreference(newSort);
  };

  // Collapsible state for production options cards
  const [expandedOptions, setExpandedOptions] = useState<Record<string, boolean>>({});

  const toggleOptionExpanded = (key: string) => {
    setExpandedOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // 1. Full Recipe state & handlers
  const [fullRecipeCount, setFullRecipeCount] = useState<number>(0);

  const handleUpdateFullRecipe = (delta: number) => {
    const next = Math.max(0, fullRecipeCount + delta);
    setFullRecipeCount(next);
    if (next > 0) {
      setFullMixerBatches(0);
      setPresetQuantities({});
      setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
    }
  };

  const handleSetFullRecipe = (val: number) => {
    const next = Math.max(0, val);
    setFullRecipeCount(next);
    if (next > 0) {
      setFullMixerBatches(0);
      setPresetQuantities({});
      setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
    }
  };

  // 2. Full Mixer Capacity state & handlers
  const [fullMixerBatches, setFullMixerBatches] = useState<number>(0);

  const handleUpdateFullMixer = (delta: number) => {
    const next = Math.max(0, fullMixerBatches + delta);
    setFullMixerBatches(next);
    if (next > 0) {
      setFullRecipeCount(0);
      setPresetQuantities({});
      setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
    }
  };

  const handleSetFullMixer = (val: number) => {
    const next = Math.max(0, val);
    setFullMixerBatches(next);
    if (next > 0) {
      setFullRecipeCount(0);
      setPresetQuantities({});
      setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
    }
  };

  // 3. Saved Presets state & handlers (with active mid-run spec lock for presets disabled mid-calculation)
  const [presetQuantities, setPresetQuantities] = useState<Record<string, number>>(
    () => initialPresetQuantitiesForTest ?? {}
  );
  const lockedActivePresetSpecsRef = useRef<
    Record<
      string,
      Pick<
        ProductionPreset,
        'id' | 'name' | 'category' | 'finishedWeight' | 'weightUnit' | 'quantityPerUnit' | 'unitName'
      >
    >
  >({});

  const handleUpdatePresetQuantity = (presetId: string, delta: number) => {
    const current = presetQuantities[presetId] || 0;
    const matchedPreset = presets.find((p) => p.id === presetId);
    if (delta > 0 && matchedPreset && !isPresetEnabledForProduction(matchedPreset)) {
      return;
    }
    const next = Math.max(0, current + delta);
    if (next <= 0) {
      delete lockedActivePresetSpecsRef.current[presetId];
    }
    setPresetQuantities((prev) => ({
      ...prev,
      [presetId]: next,
    }));
    if (next > 0) {
      setFullRecipeCount(0);
      setFullMixerBatches(0);
    }
  };

  const handleSetPresetQuantity = (presetId: string, val: number) => {
    const current = presetQuantities[presetId] || 0;
    const next = Math.max(0, val);
    const matchedPreset = presets.find((p) => p.id === presetId);
    if (matchedPreset && !isPresetEnabledForProduction(matchedPreset) && next > current) {
      return;
    }
    if (next <= 0) {
      delete lockedActivePresetSpecsRef.current[presetId];
    }
    setPresetQuantities((prev) => ({
      ...prev,
      [presetId]: next,
    }));
    if (next > 0) {
      setFullRecipeCount(0);
      setFullMixerBatches(0);
    }
  };

  // 4. Custom Quantity state & handlers
  const [customQuantity, setCustomQuantity] = useState<{
    pieces: number | null;
    pieceWeight: number | null;
    unit: WeightUnit;
  }>({
    pieces: null,
    pieceWeight: null,
    unit: 'oz',
  });

  const handleCustomPiecesCommit = (val: number) => {
    const nextVal = val > 0 ? val : null;
    setCustomQuantity((prev) => ({ ...prev, pieces: nextVal }));
    if (nextVal !== null) {
      setFullRecipeCount(0);
      setFullMixerBatches(0);
    }
  };

  const handleCustomPiecesRaw = (_raw: string, parsed: number | null) => {
    const nextVal = parsed !== null && parsed > 0 ? parsed : null;
    setCustomQuantity((prev) => ({ ...prev, pieces: nextVal }));
    if (nextVal !== null) {
      setFullRecipeCount(0);
      setFullMixerBatches(0);
    }
  };

  const handleCustomWeightCommit = (val: number) => {
    const nextVal = val > 0 ? val : null;
    setCustomQuantity((prev) => ({ ...prev, pieceWeight: nextVal }));
    if (nextVal !== null) {
      setFullRecipeCount(0);
      setFullMixerBatches(0);
    }
  };

  const handleCustomWeightRaw = (_raw: string, parsed: number | null) => {
    const nextVal = parsed !== null && parsed > 0 ? parsed : null;
    setCustomQuantity((prev) => ({ ...prev, pieceWeight: nextVal }));
    if (nextVal !== null) {
      setFullRecipeCount(0);
      setFullMixerBatches(0);
    }
  };

  const handleCustomUnitChange = (u: WeightUnit) => {
    setCustomQuantity((prev) => ({ ...prev, unit: u }));
  };

  const handleClearCustomQuantity = () => {
    setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
  };

  const isCustomActive =
    customQuantity.pieces !== null &&
    customQuantity.pieces > 0 &&
    customQuantity.pieceWeight !== null &&
    customQuantity.pieceWeight > 0;

  // Display unit: defaults to settings defaultWeightUnit or 'lb'
  const [displayUnit, setDisplayUnit] = useState<WeightUnit>(
    settings.defaultWeightUnit || 'lb'
  );

  // Production measurement display mode: defaults to settings defaultProductionDisplayMode or 'as_entered' (Phase 2B.5.5)
  const [displayMode, setDisplayMode] = useState<ProductionMeasurementDisplayMode>(
    settings.defaultProductionDisplayMode || 'as_entered'
  );

  // Waste override (defaults to undefined to use recipe/settings default waste)
  const [wastePercentOverride, setWastePercentOverride] = useState<number | null>(null);

  // Active batch mix view when split into multiple batches: 'per_batch' | 'total'
  const [batchViewMode, setBatchViewMode] = useState<'per_batch' | 'total'>('per_batch');

  // Checked off ingredients during floor scaling
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>(
    () => initialCheckedIngredientsForTest ?? {}
  );

  // Production Notes acknowledgment state (signature-based per production run; invalidates automatically if note text/timestamp changes)
  const [acknowledgedSafetySignature, setAcknowledgedSafetySignature] = useState<string | null>(
    () => initialAcknowledgedSignatureForTest ?? null
  );
  const [wasInvalidatedByLiveUpdate, setWasInvalidatedByLiveUpdate] = useState<boolean>(false);
  const [isNotesExpanded, setIsNotesExpanded] = useState<boolean>(false);
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
  const [storeProductionOptionOrder, setStoreProductionOptionOrder] = useState<string[] | null>(
    () => store.getProductionOptionOrder()
  );

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setStoreSyncError(store.getCriticalNotesSyncError());
      setStoreRecipesHydrationState(store.getRecipesHydrationState());
      setStorePresetsHydrationState(store.getPresetsHydrationState());
      setStoreConnectionVerified(store.isSafetyConnectionVerified());
      setStoreIsReconnecting(store.isSafetyReconnectingState());
      setStoreIsAuthorized(store.isAuthorized());
      setStoreProductionOptionOrder(store.getProductionOptionOrder());
    });
    return unsub;
  }, []);

  // Determine default mixer ID based on configuration
  const getDefaultMixerId = (): string | null => {
    if (!mixers || mixers.length === 0) return null;
    if ((settings as any)?.defaultMixerId) {
      const found = mixers.find((m) => m.id === (settings as any).defaultMixerId);
      if (found) return found.id;
    }
    const defaultFlagged = mixers.find((m) => (m as any).isDefault);
    if (defaultFlagged) return defaultFlagged.id;
    return mixers[0].id;
  };

  const [selectedMixerId, setSelectedMixerId] = useState<string | null>(() => getDefaultMixerId());

  // Derive active mixer dynamically based on selectedMixerId, falling back deterministically
  const activeMixer: Mixer | undefined = useMemo(() => {
    if (!mixers || mixers.length === 0) return undefined;
    if (selectedMixerId) {
      const found = mixers.find((m) => m.id === selectedMixerId);
      if (found) return found;
    }
    const defId = getDefaultMixerId();
    return defId ? mixers.find((m) => m.id === defId) : mixers[0];
  }, [mixers, selectedMixerId, settings]);

  // Active recipes only (archived excluded by default)
  const activeRecipes = useMemo(() => {
    return recipes.filter((r) => !r.archived);
  }, [recipes]);

  // Distinct categories among active recipes
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    activeRecipes.forEach((r) => {
      if (r.category && r.category.trim()) cats.add(r.category.trim());
    });
    return ['All', ...Array.from(cats).sort()];
  }, [activeRecipes]);

  // Filtered and sorted recipes for the selector grid
  const filteredAndSortedRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = activeRecipes.filter((r) => {
      const matchesCategory =
        selectedCategory === 'All' ||
        (r.category && r.category.toLowerCase() === selectedCategory.toLowerCase());
      const matchesSearch =
        !query ||
        r.name.toLowerCase().includes(query) ||
        (r.category && r.category.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
    return sortRecipes(filtered, sortOption, usageMap);
  }, [activeRecipes, selectedCategory, searchQuery, sortOption, usageMap]);

  // Currently selected recipe object
  const currentRecipe = useMemo(() => {
    if (!selectedRecipeId) return null;
    return recipes.find((r) => r.id === selectedRecipeId) || null;
  }, [recipes, selectedRecipeId]);

  // Authoritative shared workspace categoryPresetMap (never device-local settings.categoryPresetMap)
  const effectiveCategoryPresetMap = useMemo(() => {
    return categoryPresetMap ?? store.getCategoryPresetMap();
  }, [categoryPresetMap]);

  // Applicable presets for the current recipe authoritatively filtered by shared workspace category mapping
  const applicablePresets = useMemo(() => {
    return getApplicablePresetsForRecipe(currentRecipe, presets, effectiveCategoryPresetMap);
  }, [currentRecipe, presets, effectiveCategoryPresetMap]);

  // Synchronously maintain locked packaging specifications for any active (quantity > 0) preset
  // so mid-run disabling or remote edits on a disabled preset never alter an active batch calculation
  applicablePresets.forEach((p) => {
    const qty = presetQuantities[p.id] || 0;
    if (qty > 0) {
      if (isPresetEnabledForProduction(p) || !lockedActivePresetSpecsRef.current[p.id]) {
        lockedActivePresetSpecsRef.current[p.id] = {
          id: p.id,
          name: p.name,
          category: p.category,
          finishedWeight: p.finishedWeight,
          weightUnit: p.weightUnit,
          quantityPerUnit: p.quantityPerUnit,
          unitName: p.unitName,
        };
      }
    } else if (lockedActivePresetSpecsRef.current[p.id]) {
      delete lockedActivePresetSpecsRef.current[p.id];
    }
  });

  // Floor-visible presets: enabled presets PLUS any preset already active (quantity > 0) in the current batch
  const floorVisiblePresets = useMemo(() => {
    return applicablePresets.filter(
      (p) => isPresetEnabledForProduction(p) || (presetQuantities[p.id] || 0) > 0
    );
  }, [applicablePresets, presetQuantities]);

  // Presets that were active (quantity > 0) when disabled in Management on another device
  const disabledActivePresets = useMemo(() => {
    return floorVisiblePresets.filter(
      (p) => (presetQuantities[p.id] || 0) > 0 && !isPresetEnabledForProduction(p)
    );
  }, [floorVisiblePresets, presetQuantities]);

  // Ordered production option keys based strictly on authoritative shared workspace order (never per-user settings)
  const orderedOptionKeys = useMemo(() => {
    const customOrder =
      productionOptionOrder !== undefined ? productionOptionOrder : storeProductionOptionOrder;
    return getOrderedProductionOptionKeys(floorVisiblePresets, customOrder);
  }, [floorVisiblePresets, productionOptionOrder, storeProductionOptionOrder]);

  // Active/selected presets for safety notes: any preset where quantity > 0 OR an enabled option card is expanded
  const selectedPresetIds = useMemo(() => {
    const set = new Set<string>();
    floorVisiblePresets.forEach((p) => {
      const qty = presetQuantities[p.id] || 0;
      if (qty > 0 || (isPresetEnabledForProduction(p) && expandedOptions[p.id])) {
        set.add(p.id);
      }
    });
    return Array.from(set);
  }, [floorVisiblePresets, presetQuantities, expandedOptions]);

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

  const hydrationGateState = useMemo(
    () =>
      resolveSafetyHydrationGateState({
        recipesHydrationState: effectiveRecipesHydrationState,
        presetsHydrationState: effectivePresetsHydrationState,
        syncError: effectiveSyncError,
      }),
    [effectiveRecipesHydrationState, effectivePresetsHydrationState, effectiveSyncError]
  );

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

  // Resolve BOTH Recipe-Wide Critical Notes (Recipe.description) AND canonical Preset-Specific
  // Critical Notes (presets/{presetId}.criticalNotes) reactively from live props.
  const safetyResolution = useMemo(() => {
    return resolveApplicableSafetyInstructions({
      recipe: currentRecipe,
      presets,
      selectedPresetIds,
      activeWorkspaceId: effectiveWorkspaceId,
    });
  }, [currentRecipe, presets, selectedPresetIds, effectiveWorkspaceId]);

  const recipeHasNotes = safetyResolution.hasSafetyNotes;
  const isNotesAcknowledged = useMemo(
    () => isSafetySignatureAcknowledged(safetyResolution.signature, acknowledgedSafetySignature),
    [safetyResolution.signature, acknowledgedSafetySignature]
  );

  const notesStatus = useMemo(
    () => getProductionNotesStatus(recipeHasNotes, isNotesAcknowledged),
    [recipeHasNotes, isNotesAcknowledged]
  );

  // Fail-closed safety gate: blocks mix interactions while INITIAL_LOADING, CONNECTION_UNVERIFIED, ERROR, or unacknowledged
  const canProceedWithMix = useMemo(
    () =>
      canProceedToMixWithSyncSafety({
        hasNotes: recipeHasNotes,
        isAcknowledged: isNotesAcknowledged,
        syncError: effectiveSyncError,
        recipesHydrationState: effectiveRecipesHydrationState,
        presetsHydrationState: effectivePresetsHydrationState,
        connectionVerified: effectiveConnectionVerified,
      }),
    [
      recipeHasNotes,
      isNotesAcknowledged,
      effectiveSyncError,
      effectiveRecipesHydrationState,
      effectivePresetsHydrationState,
      effectiveConnectionVerified,
    ]
  );

  // During CONNECTION_UNVERIFIED after prior approval, preserve visible ingredient checklist & checked progress in read-only hold
  const canShowOperationalChecklist = useMemo(
    () =>
      canProceedWithMix ||
      (operationalGateState === 'CONNECTION_UNVERIFIED' &&
        canProceedToMix(recipeHasNotes, isNotesAcknowledged)),
    [canProceedWithMix, operationalGateState, recipeHasNotes, isNotesAcknowledged]
  );

  const [isMixingInstructionsExpanded, setIsMixingInstructionsExpanded] = useState<boolean>(false);
  const rawMixingInstructions = currentRecipe?.mixingInstructions ?? '';
  const recipeHasMixingInstructions = useMemo(
    () => Boolean(rawMixingInstructions && rawMixingInstructions.trim().length > 0),
    [rawMixingInstructions]
  );

  const prevContextKeyRef = useRef<string>(`${selectedRecipeId || ''}::${effectiveWorkspaceId}`);
  useEffect(() => {
    const nextKey = `${selectedRecipeId || ''}::${effectiveWorkspaceId}`;
    if (prevContextKeyRef.current !== nextKey) {
      prevContextKeyRef.current = nextKey;
      setAcknowledgedSafetySignature(null);
      setWasInvalidatedByLiveUpdate(false);
    }
  }, [selectedRecipeId, effectiveWorkspaceId]);

  useEffect(() => {
    if (!storeIsAuthorized) {
      setAcknowledgedSafetySignature(null);
      setWasInvalidatedByLiveUpdate(false);
    }
  }, [storeIsAuthorized]);

  // Expand notes card automatically whenever new or live-updated safety instructions require acknowledgment
  useEffect(() => {
    if (operationalGateState === 'READY' && safetyResolution.hasSafetyNotes && !isNotesAcknowledged) {
      setIsNotesExpanded(true);
      if (
        acknowledgedSafetySignature &&
        selectedRecipeId &&
        acknowledgedSafetySignature.startsWith(`${selectedRecipeId}::`) &&
        acknowledgedSafetySignature !== safetyResolution.signature
      ) {
        setWasInvalidatedByLiveUpdate(true);
      }
    }
  }, [
    operationalGateState,
    safetyResolution.hasSafetyNotes,
    safetyResolution.signature,
    isNotesAcknowledged,
    acknowledgedSafetySignature,
    selectedRecipeId,
  ]);

  const handleAcknowledgeNotes = () => {
    if (operationalGateState !== 'READY' || !safetyResolution.signature) return;
    setAcknowledgedSafetySignature(safetyResolution.signature);
    setWasInvalidatedByLiveUpdate(false);
  };

  const handleRetrySafetySync = () => {
    void store.retrySafetySync();
  };

  const toggleNotesExpanded = () => {
    setIsNotesExpanded((prev) => !prev);
  };

  // Effective waste percent for calculation using authoritative single resolution contract
  const effectiveWastePercent = useMemo(() => {
    return resolveEffectiveWastePercent({
      overrideWastePercent: wastePercentOverride,
      recipeWastePercent: currentRecipe?.defaultWastePercent,
      settingsWastePercent: settings.defaultWastePercent,
    });
  }, [wastePercentOverride, currentRecipe?.defaultWastePercent, settings.defaultWastePercent]);

  // Total production cases selected from presets
  const totalCasesSelected = useMemo(() => {
    return Object.values(presetQuantities).reduce((sum, q) => sum + (q > 0 ? q : 0), 0);
  }, [presetQuantities]);

  const hasActiveProduction =
    totalCasesSelected > 0 ||
    fullRecipeCount > 0 ||
    fullMixerBatches > 0 ||
    isCustomActive;

  // Perform calculation using the authoritative calculation engine
  const calculationResult = useMemo(() => {
    if (!currentRecipe || !hasActiveProduction) return null;

    if (fullRecipeCount > 0) {
      return calculateProduction(currentRecipe, [], {
        mode: 'full_recipe',
        fullRecipeBatches: fullRecipeCount,
        mixer: activeMixer,
        defaultWeightUnit: displayUnit,
        displayMode,
      });
    }

    if (fullMixerBatches > 0) {
      return calculateProduction(currentRecipe, [], {
        mode: 'full_mixer',
        fullMixerBatches: fullMixerBatches,
        mixer: activeMixer,
        defaultWeightUnit: displayUnit,
        displayMode,
      });
    }

    // Presets & Custom Quantity combined
    const reqs: ProductionItemRequirement[] = [];

    // Presets (using locked active specifications if preset was disabled mid-calculation)
    floorVisiblePresets.forEach((p) => {
      const q = presetQuantities[p.id] || 0;
      if (q > 0) {
        const spec =
          !isPresetEnabledForProduction(p) && lockedActivePresetSpecsRef.current[p.id]
            ? lockedActivePresetSpecsRef.current[p.id]
            : p;
        reqs.push({
          id: `prod-req-${p.id}`,
          presetId: p.id,
          presetName: spec.name,
          quantity: q,
          piecesPerUnit: spec.quantityPerUnit,
          itemWeight: spec.finishedWeight,
          itemWeightUnit: spec.weightUnit,
        });
      }
    });

    // Custom Quantity
    if (isCustomActive) {
      reqs.push({
        id: 'custom-qty-req',
        presetName: 'Custom Quantity',
        quantity: customQuantity.pieces!,
        piecesPerUnit: 1,
        itemWeight: customQuantity.pieceWeight!,
        itemWeightUnit: customQuantity.unit,
      });
    }

    if (reqs.length === 0) return null;

    return calculateProduction(currentRecipe, reqs, {
      overrideWastePercent: wastePercentOverride ?? undefined,
      defaultWastePercent: effectiveWastePercent,
      mixer: activeMixer,
      defaultWeightUnit: displayUnit,
      displayMode,
    });
  }, [
    currentRecipe,
    hasActiveProduction,
    fullRecipeCount,
    fullMixerBatches,
    presetQuantities,
    floorVisiblePresets,
    isCustomActive,
    customQuantity,
    wastePercentOverride,
    effectiveWastePercent,
    activeMixer,
    displayUnit,
    displayMode,
  ]);

  // Reset recorded session ref when selected recipe changes
  const prevRecordedRecipeRef = useRef<string | null>(selectedRecipeId);
  useEffect(() => {
    if (prevRecordedRecipeRef.current !== selectedRecipeId) {
      prevRecordedRecipeRef.current = selectedRecipeId;
      recordedRecipeIdRef.current = null;
      setAcknowledgedSafetySignature(null);
      setWasInvalidatedByLiveUpdate(false);
      setIsNotesExpanded(false);
    }
  }, [selectedRecipeId]);

  // When a valid production calculation occurs, record local usage for the recipe once per session.
  useEffect(() => {
    if (selectedRecipeId && hasActiveProduction && calculationResult) {
      if (recordedRecipeIdRef.current !== selectedRecipeId) {
        recordedRecipeIdRef.current = selectedRecipeId;
        const nextMap = recordProductionRun(selectedRecipeId);
        setUsageMap(nextMap);
      }
    }
  }, [selectedRecipeId, hasActiveProduction, calculationResult]);

  // Handler to select a recipe and open its production screen
  const handleSelectRecipe = (recipe: Recipe) => {
    lockedActivePresetSpecsRef.current = {};
    setSelectedRecipeId(recipe.id);
    setPresetQuantities({});
    setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
    setFullRecipeCount(0);
    setFullMixerBatches(0);
    setCheckedIngredients({});
    setWastePercentOverride(null);
    setBatchViewMode('per_batch');
    setAcknowledgedSafetySignature(null);
    setWasInvalidatedByLiveUpdate(false);
    setIsNotesExpanded(false);
  };

  // Handler to update quantity for a preset
  const handleUpdateQuantity = (presetId: string, delta: number) => {
    handleUpdatePresetQuantity(presetId, delta);
  };

  // Handler for direct input on quantity
  const handleDirectQuantityChange = (presetId: string, valStr: string) => {
    const cleaned = valStr.replace(/[^0-9]/g, '');
    const num = cleaned === '' ? 0 : parseInt(cleaned, 10);
    handleSetPresetQuantity(presetId, isNaN(num) || num < 0 ? 0 : num);
  };

  // Handler to reset the current batch back to empty state
  const handleResetBatch = () => {
    lockedActivePresetSpecsRef.current = {};
    setPresetQuantities({});
    setCustomQuantity({ pieces: null, pieceWeight: null, unit: 'oz' });
    setFullRecipeCount(0);
    setFullMixerBatches(0);
    setCheckedIngredients({});
    setWastePercentOverride(null);
    recordedRecipeIdRef.current = null;
    setAcknowledgedSafetySignature(null);
    setWasInvalidatedByLiveUpdate(false);
    setIsNotesExpanded(false);
  };

  // Toggle ingredient check state (strictly blocked while safety gate is not READY/acknowledged)
  const handleToggleIngredient = (ingredientId: string) => {
    if (!canProceedWithMix) return;
    setCheckedIngredients((prev) => ({
      ...prev,
      [ingredientId]: !prev[ingredientId],
    }));
  };

  // Reset checklist
  const handleResetChecklist = () => {
    if (!canProceedWithMix) return;
    setCheckedIngredients({});
  };

  const decimals = settings.decimalPlaces ?? 2;

  // -------------------------------------------------------------
  // SCREEN 1: RECIPE SELECTION
  // -------------------------------------------------------------
  if (!currentRecipe) {
    return (
      <div className="min-h-screen bg-stone-100 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 p-4 sm:p-6 md:p-8 flex flex-col">
        {/* Top Operational Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-stone-300 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg text-xs font-black tracking-wider uppercase bg-amber-500 text-white shadow-xs">
                PRODUCTION MODE
              </span>
              <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                Tablet & Floor Interface
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black font-serif tracking-tight mt-1 text-stone-900 dark:text-zinc-100">
              Select Recipe to Produce
            </h1>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              id="btn-exit-production-mode"
              onClick={onExit}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-white dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 text-stone-800 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 transition active:scale-98 shadow-xs cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-stone-600 dark:text-zinc-400" />
              <span>Exit Production</span>
            </button>
          </div>
        </header>

        {/* Fast Filter / Search Bar */}
        <div className="py-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-stone-600 dark:text-zinc-400" />
            <input
              id="prod-recipe-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recipes (e.g., Chocolate Chip, Macadamia)..."
              className="w-full pl-13 pr-10 py-4 text-lg font-medium bg-white dark:bg-zinc-900 border-2 border-stone-300 dark:border-zinc-700 focus:border-amber-500 rounded-2xl outline-none shadow-sm dark:text-zinc-100 placeholder:text-stone-600 dark:placeholder:text-zinc-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold px-2 py-1 rounded bg-stone-200 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200"
              >
                Clear
              </button>
            )}
          </div>

          {/* Category Chips & Compact Tablet Sort Control */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar flex-1">
              {availableCategories.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition cursor-pointer shrink-0 ${
                      isSelected
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-white dark:bg-zinc-900 border border-stone-300 dark:border-zinc-800 text-stone-800 dark:text-zinc-200 hover:border-amber-400'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Compact Tablet-friendly Sort Control */}
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <label
                htmlFor="prod-sort-select"
                className="text-xs font-bold text-stone-600 dark:text-zinc-400 whitespace-nowrap"
              >
                Sort:
              </label>
              <div className="relative">
                <select
                  id="prod-sort-select"
                  aria-label="Sort recipes by"
                  value={sortOption}
                  onChange={(e) => handleSortChange(e.target.value as ProductionSortOption)}
                  className="pl-3 pr-8 py-2 text-xs sm:text-sm font-bold bg-white dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-xl text-stone-800 dark:text-zinc-200 outline-none focus:border-amber-500 shadow-xs cursor-pointer appearance-none"
                >
                  <option value="recent">Recently Used</option>
                  <option value="most_used">Most Used</option>
                  <option value="alphabetical">A–Z</option>
                  <option value="category">Category</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Recipe Grid with Large Touch Targets */}
        <div className="flex-1 overflow-y-auto">
          {filteredAndSortedRecipes.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 p-8">
              <Package className="w-12 h-12 mx-auto text-stone-400 mb-3" />
              <p className="text-lg font-bold text-stone-700 dark:text-zinc-300">
                No active recipes match &ldquo;{searchQuery}&rdquo;
              </p>
              <p className="text-sm text-stone-500 dark:text-zinc-400 mt-1">
                Try searching for another recipe name or clear filters.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 pb-12">
              {filteredAndSortedRecipes.map((recipe) => (
                <button
                  key={recipe.id}
                  id={`btn-select-recipe-${recipe.id}`}
                  onClick={() => handleSelectRecipe(recipe)}
                  className="flex flex-col justify-between p-5 min-h-[96px] bg-white dark:bg-zinc-900 hover:bg-amber-50/70 dark:hover:bg-zinc-800/80 border-2 border-stone-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-500 rounded-2xl text-left transition shadow-xs active:scale-98 cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                        {recipe.category || 'Recipe'}
                      </span>
                      <span className="text-xs font-mono text-stone-600 dark:text-zinc-400 font-bold">
                        {recipe.ingredients.length} ingr.
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-black font-serif text-stone-900 dark:text-zinc-100 group-hover:text-amber-900 dark:group-hover:text-amber-300 leading-snug">
                      {recipe.name}
                    </h3>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-stone-600 dark:text-zinc-400 pt-2 border-t border-stone-100 dark:border-zinc-800/80">
                    <span>Tap to scale & calculate</span>
                    <span className="font-bold text-amber-700 dark:text-amber-400 group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SCREEN 2: RECIPE PRODUCTION SCREEN (MINIMALIST FLOOR CALCULATOR)
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-stone-100 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 flex flex-col">
      {/* Top Floor Bar */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm border-b border-stone-300 dark:border-zinc-800 px-4 py-3 sm:px-6 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <button
            id="btn-prod-back-recipes"
            onClick={() => setSelectedRecipeId(null)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-stone-200 dark:bg-zinc-800 hover:bg-stone-300 dark:hover:bg-zinc-700 text-stone-900 dark:text-zinc-100 transition active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            <span className="hidden sm:inline">All Recipes</span>
          </button>

          <div className="text-center flex-1 min-w-0 px-2">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-amber-800 dark:text-amber-400 truncate">
                {currentRecipe.category || 'Recipe'} • Production Run
              </span>
              <span
                id="prod-safety-sync-status"
                className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                  syncStatusLabel === 'Safety Sync Ready'
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                    : syncStatusLabel === 'Safety Sync Failed'
                    ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                }`}
              >
                {syncStatusLabel}
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-black font-serif truncate text-stone-900 dark:text-zinc-100">
              {currentRecipe.name}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-prod-reset"
              onClick={handleResetBatch}
              title="Reset all preset quantities and calculation"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden md:inline">Reset Batch</span>
            </button>

            <button
              id="btn-prod-exit-full-mode"
              onClick={onExit}
              title="Return to Main Mode Launcher"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-stone-700 dark:text-zinc-300 hover:text-stone-900 dark:hover:text-zinc-100 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 border border-stone-200 dark:border-zinc-700 transition cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit Production</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8 space-y-6 flex-1">
        {/* Section 0: Dedicated Mixer Selection Card */}
        <section
          id="prod-mixer-selection-card"
          className="bg-white dark:bg-zinc-900 border-2 border-stone-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800/80 text-amber-900 dark:text-amber-300 flex items-center justify-center shrink-0 shadow-2xs">
              <Scale className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-400">
                  Equipment
                </span>
                <span className="text-xs text-stone-300 dark:text-zinc-600">•</span>
                <span className="text-xs font-bold text-stone-600 dark:text-zinc-400">
                  MIXER
                </span>
              </div>
              {activeMixer ? (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-bold text-stone-900 dark:text-zinc-100">
                    {activeMixer.name}
                  </h3>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 border border-stone-200 dark:border-zinc-700 font-mono">
                    {activeMixer.maxWeight} {activeMixer.weightUnit.toUpperCase()} Capacity
                  </span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                  No Mixer Configured
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {mixers.length > 1 ? (
              <div className="relative w-full sm:w-64">
                <label htmlFor="prod-mixer-select" className="sr-only">
                  Select Production Mixer
                </label>
                <select
                  id="prod-mixer-select"
                  value={activeMixer?.id || ''}
                  onChange={(e) => setSelectedMixerId(e.target.value)}
                  className="w-full min-h-[44px] appearance-none bg-stone-50 dark:bg-zinc-800/80 border-2 border-stone-300 dark:border-zinc-700 hover:border-amber-500 dark:hover:border-amber-500 rounded-xl px-3.5 py-2.5 pr-10 text-xs sm:text-sm font-bold text-stone-900 dark:text-zinc-100 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                >
                  {mixers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.maxWeight} {m.weightUnit.toUpperCase()})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-stone-500 dark:text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            ) : mixers.length === 1 ? (
              <span
                id="prod-single-mixer-badge"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-xs font-bold text-stone-700 dark:text-zinc-300"
              >
                <span>Active Mixer</span>
                <span className="font-mono text-[11px] text-amber-800 dark:text-amber-400">
                  ({mixers[0].maxWeight} {mixers[0].weightUnit.toUpperCase()})
                </span>
              </span>
            ) : (
              <span
                id="prod-no-mixer-warning"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-700 dark:text-rose-400"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Configure in Management</span>
              </span>
            )}
          </div>
        </section>
        {/* Section 1: Collapsible Production Options */}
        <section className="bg-white dark:bg-zinc-900 border-2 border-stone-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-stone-200 dark:border-zinc-800">
            <div>
              <h2 className="text-lg sm:text-xl font-black text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-700 dark:text-amber-400" />
                <span>Production Options</span>
              </h2>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-zinc-400 font-medium">
                Choose a production option below. Tap any card to expand or collapse controls.
              </p>
            </div>

            {/* Waste or Formulation Notice */}
            <div className="inline-flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
              <span>
                {fullRecipeCount > 0 || fullMixerBatches > 0
                  ? 'Direct formulation (0% added waste)'
                  : `Includes ${effectiveWastePercent}% production waste`}
              </span>
            </div>
          </div>

          {/* Warning Banner when an active preset was disabled in Management during this calculation */}
          {disabledActivePresets.length > 0 && (
            <div
              id="prod-disabled-active-preset-warning"
              role="alert"
              className="p-4 rounded-2xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 text-xs sm:text-sm space-y-1.5"
            >
              <div className="flex items-center gap-2 font-black text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  Preset Disabled in Management — Active Batch Calculation Locked
                </span>
              </div>
              <p className="font-medium leading-relaxed">
                <strong>
                  {disabledActivePresets.map((p) => p.name).join(', ')}
                </strong>{' '}
                was disabled in Management while selected in this run. Your current batch weights,{' '}
                {effectiveWastePercent}% waste calculation, mixer splits, checked ingredients, and acknowledged Critical Production Notes remain locked to the selected values until you complete, clear, or reset this batch. Quantity increases are disabled unless re-enabled in Management.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {(() => {
              const renderFullRecipeCard = () => {
                const isExpanded = !!expandedOptions['full_recipe'];
                const isActive = fullRecipeCount > 0;
                return (
                <div
                  id="card-prod-option-full-recipe"
                  className={`rounded-2xl border-2 transition-all ${
                    isActive
                      ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-500 dark:border-amber-500 shadow-xs'
                      : 'bg-stone-50 dark:bg-zinc-800/40 border-stone-200 dark:border-zinc-800 hover:border-stone-300'
                  }`}
                >
                  <button
                    id="btn-toggle-option-full-recipe"
                    type="button"
                    onClick={() => toggleOptionExpanded('full_recipe')}
                    className="w-full p-3.5 sm:px-5 flex items-center justify-between gap-3 text-left cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base sm:text-lg font-bold text-stone-900 dark:text-zinc-100">
                          Full Recipe
                        </span>
                        {isActive && (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-black font-mono">
                            {fullRecipeCount}×
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 text-stone-600 dark:text-zinc-400">
                        {isActive ? (
                          <span className="font-bold text-amber-800 dark:text-amber-300 font-mono tracking-wide">
                            {fullRecipeCount} FULL {fullRecipeCount === 1 ? 'RECIPE' : 'RECIPES'}
                          </span>
                        ) : (
                          'Authoritative base formula (1×)'
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-stone-200/60 dark:bg-zinc-700/60 text-stone-700 dark:text-zinc-300">
                        <ChevronDown
                          className={`w-5 h-5 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3.5 sm:px-5 pb-4 pt-2 border-t border-stone-200/60 dark:border-zinc-800 space-y-3">
                      <p className="text-xs text-stone-600 dark:text-zinc-400">
                        Produces the authoritative base recipe formulation as defined in Management Mode without finished-item presets or added waste.
                      </p>
                      <div className="flex items-center justify-between sm:justify-start gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            id="btn-prod-dec-full-recipe"
                            type="button"
                            onClick={() => handleUpdateFullRecipe(-1)}
                            disabled={fullRecipeCount <= 0}
                            aria-label="Decrease full recipes"
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black bg-white dark:bg-zinc-900 border-2 border-stone-300 dark:border-zinc-700 text-stone-800 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-95 disabled:opacity-25 disabled:pointer-events-none transition cursor-pointer shadow-xs"
                          >
                            <Minus className="w-5 h-5 stroke-[2.5]" />
                          </button>

                          <ProductionNumericInput
                            id="input-prod-qty-full-recipe"
                            value={fullRecipeCount === 0 ? '' : fullRecipeCount}
                            placeholder="0"
                            allowDecimal={false}
                            min={0}
                            ariaLabel="Full recipes to produce"
                            className={`w-20 h-12 text-center text-xl sm:text-2xl font-black font-mono rounded-xl border-2 outline-none transition bg-white dark:bg-zinc-900 dark:text-zinc-100 ${
                              isActive
                                ? 'border-amber-500 text-amber-900 dark:text-amber-200'
                                : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                            }`}
                            onCommit={handleSetFullRecipe}
                          />

                          <button
                            id="btn-prod-inc-full-recipe"
                            type="button"
                            onClick={() => handleUpdateFullRecipe(1)}
                            aria-label="Increase full recipes"
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black bg-amber-600 border-2 border-amber-600 text-white hover:bg-amber-700 active:scale-95 transition cursor-pointer shadow-xs"
                          >
                            <Plus className="w-5 h-5 stroke-[2.5]" />
                          </button>
                        </div>

                        {isActive && (
                          <button
                            type="button"
                            onClick={() => handleSetFullRecipe(0)}
                            className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline px-2 cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            const renderFullMixerCard = () => {
              const isExpanded = !!expandedOptions['full_mixer'];
              const isActive = fullMixerBatches > 0;
              const hasMixer = !!activeMixer;
              return (
                <div
                  id="card-prod-option-full-mixer"
                  className={`rounded-2xl border-2 transition-all ${
                    isActive
                      ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-500 dark:border-amber-500 shadow-xs'
                      : 'bg-stone-50 dark:bg-zinc-800/40 border-stone-200 dark:border-zinc-800 hover:border-stone-300'
                  }`}
                >
                  <button
                    id="btn-toggle-option-full-mixer"
                    type="button"
                    onClick={() => toggleOptionExpanded('full_mixer')}
                    className="w-full p-3.5 sm:px-5 flex items-center justify-between gap-3 text-left cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base sm:text-lg font-bold text-stone-900 dark:text-zinc-100">
                          Full Mixer Capacity
                        </span>
                        {!hasMixer ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-xs font-bold">
                            Unavailable
                          </span>
                        ) : (
                          isActive && (
                            <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-black font-mono">
                              {fullMixerBatches} {fullMixerBatches === 1 ? 'BATCH' : 'BATCHES'}
                            </span>
                          )
                        )}
                      </div>
                      <p className="text-xs mt-0.5 text-stone-600 dark:text-zinc-400">
                        {!hasMixer ? (
                          'Capacity cannot be verified — no mixer configured'
                        ) : isActive ? (
                          <span className="font-bold text-amber-800 dark:text-amber-300 font-mono tracking-wide">
                            {fullMixerBatches} MAXIMUM MIXER {fullMixerBatches === 1 ? 'BATCH' : 'BATCHES'}
                          </span>
                        ) : (
                          `Scale to max safe capacity (${activeMixer.name})`
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-stone-200/60 dark:bg-zinc-700/60 text-stone-700 dark:text-zinc-300">
                        <ChevronDown
                          className={`w-5 h-5 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3.5 sm:px-5 pb-4 pt-2 border-t border-stone-200/60 dark:border-zinc-800 space-y-3">
                      {!hasMixer ? (
                        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 font-medium">
                          Capacity cannot be verified — no mixer configured. Equipment and mixer capacities must be configured in Management Mode.
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-stone-600 dark:text-zinc-400">
                            {isActive ? (
                              <span>
                                <strong>FULL MIXER CAPACITY</strong> • {fullMixerBatches} mixer {fullMixerBatches === 1 ? 'batch' : 'batches'} • {formatNumber(fromGrams(activeMixer.maxWeight, activeMixer.weightUnit), 0)} {activeMixer.weightUnit.toUpperCase()} maximum per batch • {formatNumber(fromGrams(activeMixer.maxWeight * fullMixerBatches, activeMixer.weightUnit), 0)} {activeMixer.weightUnit.toUpperCase()} total scheduled production
                              </span>
                            ) : (
                              <span>
                                Scales recipe to the maximum safe capacity of <strong>{activeMixer.name}</strong> ({activeMixer.maxWeight} {activeMixer.weightUnit.toUpperCase()} per batch) with 0% added waste.
                              </span>
                            )}
                          </p>

                          <div className="flex items-center justify-between sm:justify-start gap-3">
                            <div className="flex items-center gap-2">
                              <button
                                id="btn-prod-dec-full-mixer"
                                type="button"
                                onClick={() => handleUpdateFullMixer(-1)}
                                disabled={fullMixerBatches <= 0}
                                aria-label="Decrease mixer batches"
                                className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black bg-white dark:bg-zinc-900 border-2 border-stone-300 dark:border-zinc-700 text-stone-800 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-95 disabled:opacity-25 disabled:pointer-events-none transition cursor-pointer shadow-xs"
                              >
                                <Minus className="w-5 h-5 stroke-[2.5]" />
                              </button>

                              <ProductionNumericInput
                                id="input-prod-qty-full-mixer"
                                value={fullMixerBatches === 0 ? '' : fullMixerBatches}
                                placeholder="0"
                                allowDecimal={false}
                                min={0}
                                ariaLabel="Mixer batches to produce"
                                className={`w-20 h-12 text-center text-xl sm:text-2xl font-black font-mono rounded-xl border-2 outline-none transition bg-white dark:bg-zinc-900 dark:text-zinc-100 ${
                                  isActive
                                    ? 'border-amber-500 text-amber-900 dark:text-amber-200'
                                    : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                                }`}
                                onCommit={handleSetFullMixer}
                              />

                              <button
                                id="btn-prod-inc-full-mixer"
                                type="button"
                                onClick={() => handleUpdateFullMixer(1)}
                                aria-label="Increase mixer batches"
                                className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black bg-amber-600 border-2 border-amber-600 text-white hover:bg-amber-700 active:scale-95 transition cursor-pointer shadow-xs"
                              >
                                <Plus className="w-5 h-5 stroke-[2.5]" />
                              </button>
                            </div>

                            {isActive && (
                              <button
                                type="button"
                                onClick={() => handleSetFullMixer(0)}
                                className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline px-2 cursor-pointer"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            const renderPresetCard = (preset: ProductionPreset) => {
              const qty = presetQuantities[preset.id] || 0;
              const isActive = qty > 0;
              const isPresetEnabled = isPresetEnabledForProduction(preset);
              const spec =
                !isPresetEnabled && lockedActivePresetSpecsRef.current[preset.id]
                  ? lockedActivePresetSpecsRef.current[preset.id]
                  : preset;
              const isExpanded = !!expandedOptions[preset.id] || (isActive && !isPresetEnabled);
              const totalPiecesForPreset = qty * spec.quantityPerUnit;
              const totalWeightForPreset = totalPiecesForPreset * spec.finishedWeight;

              return (
                <div
                  key={preset.id}
                  id={`card-prod-option-preset-${preset.id}`}
                  className={`rounded-2xl border-2 transition-all ${
                    isActive
                      ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-500 dark:border-amber-500 shadow-xs'
                      : 'bg-stone-50 dark:bg-zinc-800/40 border-stone-200 dark:border-zinc-800 hover:border-stone-300'
                  }`}
                >
                  <button
                    id={`btn-toggle-option-preset-${preset.id}`}
                    type="button"
                    onClick={() => toggleOptionExpanded(preset.id)}
                    className="w-full p-3.5 sm:px-5 flex items-center justify-between gap-3 text-left cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base sm:text-lg font-bold text-stone-900 dark:text-zinc-100 truncate">
                          {spec.name}
                        </span>
                        {isActive ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-black font-mono tabular-nums">
                            {qty} {qty === 1 ? 'CASE' : 'CASES'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-stone-200 dark:bg-zinc-700 text-stone-800 dark:text-zinc-200 text-xs font-bold font-mono tabular-nums">
                            {spec.quantityPerUnit} / CS
                          </span>
                        )}
                        {!isPresetEnabled && (
                          <span
                            id={`badge-prod-preset-disabled-locked-${preset.id}`}
                            className="px-2.5 py-0.5 rounded-lg bg-amber-200/80 dark:bg-amber-900/70 text-amber-950 dark:text-amber-100 text-[11px] font-bold"
                          >
                            Disabled in Management · Batch Locked
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 text-stone-600 dark:text-zinc-400">
                        {isActive ? (
                          <span className="font-bold text-amber-800 dark:text-amber-300 font-mono tabular-nums tracking-wide">
                            {qty} {qty === 1 ? 'CASE' : 'CASES'} • {totalPiecesForPreset.toLocaleString()} COOKIES • {totalWeightForPreset.toLocaleString()} {spec.weightUnit.toUpperCase()} NET
                          </span>
                        ) : (
                          `${spec.quantityPerUnit} / CASE • ${spec.finishedWeight} ${spec.weightUnit.toUpperCase()} each`
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-stone-200/60 dark:bg-zinc-700/60 text-stone-700 dark:text-zinc-300">
                        <ChevronDown
                          className={`w-5 h-5 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3.5 sm:px-5 pb-4 pt-2 border-t border-stone-200/60 dark:border-zinc-800 space-y-3">
                      <p className="text-xs text-stone-500 dark:text-zinc-400 font-medium">
                        {spec.quantityPerUnit} pieces/case • {spec.finishedWeight} {spec.weightUnit} piece weight{' '}
                        {!isPresetEnabled
                          ? '(Disabled in Management — quantity increases locked; decrease, Clear, or Reset Batch allowed)'
                          : '(Approved standard — only cases can be adjusted on floor)'}
                      </p>
                      <div className="flex items-center justify-between sm:justify-start gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            id={`btn-prod-dec-${preset.id}`}
                            type="button"
                            onClick={() => handleUpdatePresetQuantity(preset.id, -1)}
                            disabled={qty <= 0}
                            aria-label={`Decrease cases for ${spec.name}`}
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black bg-white dark:bg-zinc-900 border-2 border-stone-300 dark:border-zinc-700 text-stone-800 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 active:scale-95 disabled:opacity-25 disabled:pointer-events-none transition cursor-pointer shadow-xs"
                          >
                            <Minus className="w-5 h-5 stroke-[2.5]" />
                          </button>

                          <ProductionNumericInput
                            id={`input-prod-qty-${preset.id}`}
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            allowDecimal={false}
                            min={0}
                            max={!isPresetEnabled ? qty : undefined}
                            ariaLabel={`Cases to produce for ${spec.name}`}
                            className={`w-20 h-12 text-center text-xl sm:text-2xl font-black font-mono tabular-nums rounded-xl border-2 outline-none transition bg-white dark:bg-zinc-900 dark:text-zinc-100 ${
                              isActive
                                ? 'border-amber-500 text-amber-900 dark:text-amber-200'
                                : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300'
                            }`}
                            onCommit={(val) => handleSetPresetQuantity(preset.id, val)}
                          />

                          <button
                            id={`btn-prod-inc-${preset.id}`}
                            type="button"
                            disabled={!isPresetEnabled}
                            onClick={() => handleUpdatePresetQuantity(preset.id, 1)}
                            aria-label={`Increase cases for ${spec.name}`}
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black bg-amber-600 border-2 border-amber-600 text-white hover:bg-amber-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer shadow-xs"
                          >
                            <Plus className="w-5 h-5 stroke-[2.5]" />
                          </button>
                        </div>

                        {isActive && (
                          <button
                            id={`btn-prod-clear-${preset.id}`}
                            type="button"
                            onClick={() => handleSetPresetQuantity(preset.id, 0)}
                            className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline px-2 cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            const renderCustomQuantityCard = () => {
              const isExpanded = !!expandedOptions['custom_quantity'];
              return (
                <div
                  id="card-prod-option-custom-qty"
                  className={`rounded-2xl border-2 transition-all ${
                    isCustomActive
                      ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-500 dark:border-amber-500 shadow-xs'
                      : 'bg-stone-50 dark:bg-zinc-800/40 border-stone-200 dark:border-zinc-800 hover:border-stone-300'
                  }`}
                >
                  <button
                    id="btn-toggle-option-custom-qty"
                    type="button"
                    onClick={() => toggleOptionExpanded('custom_quantity')}
                    className="w-full p-3.5 sm:px-5 flex items-center justify-between gap-3 text-left cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base sm:text-lg font-bold text-stone-900 dark:text-zinc-100">
                          Custom Quantity
                        </span>
                        {isCustomActive && (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-black font-mono">
                            {customQuantity.pieces} pcs
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 text-stone-600 dark:text-zinc-400">
                        {isCustomActive ? (
                          <span className="font-bold text-amber-800 dark:text-amber-300 font-mono tracking-wide">
                            {customQuantity.pieces} PIECES • {customQuantity.pieceWeight} {customQuantity.unit.toUpperCase()} EACH
                          </span>
                        ) : (
                          'Nonstandard piece sizes, partial cases, or test batches'
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-stone-200/60 dark:bg-zinc-700/60 text-stone-700 dark:text-zinc-300">
                        <ChevronDown
                          className={`w-5 h-5 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3.5 sm:px-5 pb-4 pt-2 border-t border-stone-200/60 dark:border-zinc-800 space-y-4">
                      <p className="text-xs text-stone-500 dark:text-zinc-400 font-medium">
                        Temporary production input only. Does NOT create or modify presets, recipes, or standards.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Pieces Input */}
                        <div>
                          <label
                            htmlFor="input-custom-qty-pieces"
                            className="block text-[11px] font-bold uppercase tracking-wider text-stone-600 dark:text-zinc-400 mb-1"
                          >
                            Quantity (Pieces)
                          </label>
                          <ProductionNumericInput
                            id="input-custom-qty-pieces"
                            value={customQuantity.pieces ?? ''}
                            placeholder="e.g. 19"
                            allowDecimal={false}
                            min={1}
                            ariaLabel="Custom piece count"
                            className="w-full h-11 px-3 text-base font-bold font-mono rounded-xl border-2 border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 outline-none focus:border-amber-500"
                            onCommit={handleCustomPiecesCommit}
                            onRawChange={handleCustomPiecesRaw}
                          />
                        </div>

                        {/* Piece Weight Input */}
                        <div>
                          <label
                            htmlFor="input-custom-qty-weight"
                            className="block text-[11px] font-bold uppercase tracking-wider text-stone-600 dark:text-zinc-400 mb-1"
                          >
                            Piece Weight
                          </label>
                          <ProductionNumericInput
                            id="input-custom-qty-weight"
                            value={customQuantity.pieceWeight ?? ''}
                            placeholder="e.g. 3.0"
                            allowDecimal={true}
                            min={0.01}
                            ariaLabel="Custom piece weight"
                            className="w-full h-11 px-3 text-base font-bold font-mono rounded-xl border-2 border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 outline-none focus:border-amber-500"
                            onCommit={handleCustomWeightCommit}
                            onRawChange={handleCustomWeightRaw}
                          />
                        </div>

                        {/* Unit Select */}
                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-600 dark:text-zinc-400 mb-1">
                            Unit
                          </label>
                          <div className="flex h-11 bg-stone-100 dark:bg-zinc-800 p-1 rounded-xl border border-stone-300 dark:border-zinc-700">
                            <button
                              id="btn-custom-unit-oz"
                              type="button"
                              onClick={() => handleCustomUnitChange('oz')}
                              className={`flex-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                                customQuantity.unit === 'oz'
                                  ? 'bg-amber-600 text-white shadow-xs'
                                  : 'text-stone-700 dark:text-zinc-300 hover:text-stone-900'
                              }`}
                            >
                              oz
                            </button>
                            <button
                              id="btn-custom-unit-g"
                              type="button"
                              onClick={() => handleCustomUnitChange('g')}
                              className={`flex-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                                customQuantity.unit === 'g'
                                  ? 'bg-amber-600 text-white shadow-xs'
                                  : 'text-stone-700 dark:text-zinc-300 hover:text-stone-900'
                              }`}
                            >
                              g
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Validation / Helper Status */}
                      <div
                        id="custom-qty-validation-msg"
                        className="text-xs font-medium"
                      >
                        {customQuantity.pieces && !customQuantity.pieceWeight ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            Enter piece weight to calculate production.
                          </span>
                        ) : !customQuantity.pieces && customQuantity.pieceWeight ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            Enter piece count to calculate production.
                          </span>
                        ) : isCustomActive ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                            ✓ {customQuantity.pieces} pieces × {customQuantity.pieceWeight} {customQuantity.unit} = {(customQuantity.pieces! * customQuantity.pieceWeight!).toFixed(2)} {customQuantity.unit} before waste
                          </span>
                        ) : (
                          <span className="text-stone-500 dark:text-zinc-400">
                            Enter both piece count and piece weight to calculate.
                          </span>
                        )}
                      </div>

                      {(customQuantity.pieces || customQuantity.pieceWeight) && (
                        <div className="pt-1">
                          <button
                            id="btn-clear-custom-qty"
                            type="button"
                            onClick={handleClearCustomQuantity}
                            className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                          >
                            Clear Custom Quantity
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            return orderedOptionKeys.map((optionKey) => {
              if (optionKey === SYSTEM_OPTION_KEYS.FULL_RECIPE) {
                return (
                  <React.Fragment key="full_recipe">
                    {renderFullRecipeCard()}
                  </React.Fragment>
                );
              }
              if (optionKey === SYSTEM_OPTION_KEYS.FULL_MIXER) {
                return (
                  <React.Fragment key="full_mixer">
                    {renderFullMixerCard()}
                  </React.Fragment>
                );
              }
              if (optionKey === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY) {
                return (
                  <React.Fragment key="custom_quantity">
                    {renderCustomQuantityCard()}
                  </React.Fragment>
                );
              }
              const preset = floorVisiblePresets.find((p) => p.id === optionKey);
              if (preset) {
                return (
                  <React.Fragment key={preset.id}>
                    {renderPresetCard(preset)}
                  </React.Fragment>
                );
              }
              return null;
            });
          })()}
          </div>
        </section>

        {/* Initial Firestore Hydration Safety Banner: Never treat unhydrated or cached state as "no notes" */}
        {operationalGateState === 'INITIAL_LOADING' && (
          <section
            id="prod-notes-hydration-loading-banner"
            className="rounded-3xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/35 p-4 sm:p-5 shadow-xs"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-amber-700 dark:text-amber-400 animate-spin shrink-0" />
                <p className="text-sm sm:text-base font-black text-amber-950 dark:text-amber-100">
                  {SAFETY_HYDRATION_LOADING_MESSAGE}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100">
                {syncStatusLabel}
              </span>
            </div>
          </section>
        )}

        {/* Wi-Fi Interruption / Unverified Live Connection Banner: Preserves checklist & acknowledgment while pausing new check-offs */}
        {operationalGateState === 'CONNECTION_UNVERIFIED' && (
          <section
            id="prod-connection-unverified-banner"
            className="rounded-3xl border-2 border-amber-500 dark:border-amber-600 bg-amber-50/95 dark:bg-amber-950/40 p-4 sm:p-5 shadow-xs space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-base font-black tracking-wide uppercase text-amber-950 dark:text-amber-100">
                      Live Safety Connection Unverified — Mixing Hold Active
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white">
                      {syncStatusLabel}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200 leading-relaxed">
                    {SAFETY_CONNECTION_UNVERIFIED_MESSAGE}
                  </p>
                </div>
              </div>
              <button
                id="btn-prod-retry-safety-sync-unverified"
                type="button"
                onClick={handleRetrySafetySync}
                className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs sm:text-sm shadow-xs transition cursor-pointer shrink-0"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Safety Sync</span>
              </button>
            </div>
          </section>
        )}

        {/* Fail-Closed Firestore Sync Error Banner: Never treat Cloud loading errors as "no notes" */}
        {operationalGateState === 'ERROR' && (
          <section
            id="prod-notes-sync-error-banner"
            className="rounded-3xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-950/35 p-4 sm:p-5 shadow-xs space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm sm:text-base font-black tracking-wide uppercase text-rose-950 dark:text-rose-100">
                      Critical Production Notes Unavailable — Safety Hold Active
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white">
                      {syncStatusLabel}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-rose-900 dark:text-rose-200 leading-relaxed">
                    {SAFETY_HYDRATION_ERROR_MESSAGE}
                  </p>
                  {effectiveSyncError && (
                    <p className="text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
                      Details: {effectiveSyncError}
                    </p>
                  )}
                </div>
              </div>
              <button
                id="btn-prod-retry-safety-sync"
                type="button"
                onClick={handleRetrySafetySync}
                className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs sm:text-sm shadow-xs transition cursor-pointer shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry Safety Sync</span>
              </button>
            </div>
          </section>
        )}

        {/* Production Notes Section: Displays clearly labeled Recipe-Wide AND Preset-Specific Critical Notes once authoritative snapshots have arrived */}
        {(operationalGateState === 'READY' || operationalGateState === 'CONNECTION_UNVERIFIED') &&
          recipeHasNotes && (
          <section
            id="prod-notes-card"
            className={`rounded-3xl border-2 transition-all shadow-xs ${
              isNotesAcknowledged
                ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-400 dark:border-emerald-800/80'
                : 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600/80'
            }`}
          >
            <button
              id="prod-notes-header-btn"
              type="button"
              onClick={toggleNotesExpanded}
              className="w-full flex items-center justify-between p-4 sm:p-5 text-left cursor-pointer min-h-[48px] rounded-3xl focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  id="prod-notes-checkbox-indicator"
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 font-bold transition-colors ${
                    isNotesAcknowledged
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'border-2 border-amber-600 dark:border-amber-400 text-transparent bg-white dark:bg-zinc-900'
                  }`}
                >
                  {isNotesAcknowledged ? (
                    <Check className="w-4 h-4 stroke-[3]" />
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        isNotesAcknowledged
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-800 dark:text-amber-400'
                      }`}
                    />
                    <h2
                      className={`text-sm sm:text-base font-black tracking-wide uppercase ${
                        isNotesAcknowledged
                          ? 'text-emerald-950 dark:text-emerald-100'
                          : 'text-amber-950 dark:text-amber-100'
                      }`}
                    >
                      Critical Production Notes
                    </h2>
                    {wasInvalidatedByLiveUpdate && !isNotesAcknowledged && (
                      <span
                        id="prod-notes-live-updated-badge"
                        className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-600 text-white"
                      >
                        Updated Live — Re-Review Required
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0 ml-2">
                <span
                  id="prod-notes-status-badge"
                  className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                    isNotesAcknowledged
                      ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                      : 'bg-amber-500 text-white shadow-xs animate-pulse'
                  }`}
                >
                  {notesStatus === 'REVIEWED' ? 'REVIEWED' : 'REVIEW REQUIRED'}
                </span>
                <ChevronDown
                  className={`w-5 h-5 transition-transform duration-200 ${
                    isNotesExpanded ? 'rotate-180' : ''
                  } ${
                    isNotesAcknowledged
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}
                />
              </div>
            </button>

            {/* Expanded Note Content */}
            {isNotesExpanded && (
              <div
                id="prod-notes-content"
                className="px-4 pb-4 sm:px-5 sm:pb-5 pt-1 space-y-4 border-t border-stone-200 dark:border-zinc-800/80"
              >
                <div
                  id="prod-notes-text"
                  className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 text-stone-900 dark:text-zinc-100 text-sm sm:text-base leading-relaxed space-y-3.5 font-medium shadow-2xs"
                >
                  {safetyResolution.allInstructions.map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
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
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <span className="font-semibold text-amber-950 dark:text-amber-100 leading-snug whitespace-pre-wrap break-words">
                          {item.note}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {!isNotesAcknowledged ? (
                  <button
                    id="btn-acknowledge-production-notes"
                    type="button"
                    disabled={operationalGateState !== 'READY'}
                    onClick={handleAcknowledgeNotes}
                    className="w-full min-h-[48px] py-3 px-5 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-black text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-sm transition active:scale-[0.99] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <Check className="w-5 h-5 stroke-[3]" />
                    <span>I HAVE READ THESE PRODUCTION NOTES</span>
                  </button>
                ) : (
                  <div
                    id="prod-notes-acknowledged-msg"
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-xl bg-emerald-100/80 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm font-bold"
                  >
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 stroke-[3] text-emerald-600 dark:text-emerald-400" />
                      <span>Production notes reviewed for this run</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsNotesExpanded(false)}
                      className="text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer self-start sm:self-auto"
                    >
                      Collapse Notes
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* General Mixing Instructions Section */}
        <section
          id="prod-mixing-instructions-card"
          className="rounded-3xl border-2 border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-all shadow-xs"
        >
          <button
            id="prod-mixing-instructions-header-btn"
            type="button"
            onClick={() => setIsMixingInstructionsExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-left cursor-pointer min-h-[48px] rounded-3xl focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border-2 border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400">
                <ChefHat className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-stone-500 dark:text-zinc-400 shrink-0" />
                  <h2 className="text-sm sm:text-base font-black tracking-wide uppercase text-stone-900 dark:text-zinc-100">
                    General Mixing Instructions
                  </h2>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ml-2">
              <span
                id="prod-mixing-instructions-badge"
                className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 border border-stone-200 dark:border-zinc-700"
              >
                {recipeHasMixingInstructions ? 'Standard Procedure' : 'General Guidance'}
              </span>
              <ChevronDown
                className={`w-5 h-5 text-stone-400 dark:text-zinc-500 transition-transform duration-200 ${
                  isMixingInstructionsExpanded ? 'rotate-180' : ''
                }`}
              />
            </div>
          </button>

          {isMixingInstructionsExpanded && (
            <div
              id="prod-mixing-instructions-content"
              className="px-4 pb-4 sm:px-5 sm:pb-5 pt-1 space-y-3 border-t border-stone-200 dark:border-zinc-800/80"
            >
              {recipeHasMixingInstructions ? (
                <div className="p-4 sm:p-5 rounded-2xl bg-[#FAF8F5] dark:bg-zinc-800/60 border border-stone-200 dark:border-zinc-700 text-stone-900 dark:text-zinc-100 text-sm sm:text-base leading-relaxed whitespace-pre-wrap break-words font-medium shadow-2xs">
                  {rawMixingInstructions}
                </div>
              ) : (
                <div className="p-4 sm:p-5 rounded-2xl bg-[#FAF8F5] dark:bg-zinc-800/60 border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 text-xs sm:text-sm space-y-2 leading-relaxed font-medium">
                  <p className="font-bold text-stone-900 dark:text-zinc-100">
                    Standard Commercial Bakery Mixing Protocol:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 pl-1 text-stone-700 dark:text-zinc-300">
                    <li>Scale and verify all required batch ingredients (mise en place) before starting mixer.</li>
                    <li>Follow standard planetary or spiral mixer speed protocols for this dough category.</li>
                    <li>Verify final dough temperature and consistency before unloading to portioning tables.</li>
                  </ol>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section 2: Calculated Results & Mixing Formula */}
        {!calculationResult || !hasActiveProduction ? (
          /* Empty Prompt State */
          <div
            id="prod-empty-state"
            className="bg-white dark:bg-zinc-900 border-2 border-dashed border-stone-300 dark:border-zinc-800 rounded-3xl p-8 sm:p-12 text-center space-y-3"
          >
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Package className="w-8 h-8" />
            </div>
            <h3 className="text-xl sm:text-2xl font-black font-serif text-stone-800 dark:text-zinc-200">
              Select Production Options to Calculate Scaled Mix
            </h3>
            <p className="max-w-md mx-auto text-sm text-stone-600 dark:text-zinc-400 font-medium">
              Choose Full Recipe, Full Mixer Capacity, Saved Presets, or Custom Quantity above. The calculator will automatically scale dough weight, verify mixer capacity, and produce the mix sheet.
            </p>
          </div>
        ) : !canShowOperationalChecklist ? (
          /* Inline Gate: INITIAL_LOADING, CONNECTION_UNVERIFIED (before approval), Sync ERROR Fail-Closed, OR Notes Review Required */
          <div
            id="prod-notes-proceed-gate"
            className={`bg-white dark:bg-zinc-900 border-2 border-dashed rounded-3xl p-6 sm:p-10 text-center space-y-4 shadow-xs ${
              operationalGateState === 'ERROR'
                ? 'border-rose-400 dark:border-rose-600'
                : 'border-amber-400 dark:border-amber-600'
            }`}
          >
            <div
              className={`w-14 h-14 mx-auto rounded-2xl border flex items-center justify-center ${
                operationalGateState === 'ERROR'
                  ? 'bg-rose-100 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-400'
                  : 'bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-400'
              }`}
            >
              {operationalGateState === 'ERROR' ? (
                <AlertTriangle className="w-7 h-7 stroke-[2.5]" />
              ) : operationalGateState === 'INITIAL_LOADING' ? (
                <RefreshCw className="w-7 h-7 stroke-[2.5] animate-spin" />
              ) : (
                <FileText className="w-7 h-7 stroke-[2.5]" />
              )}
            </div>
            <div className="space-y-1">
              <h3 className="text-xl sm:text-2xl font-black font-serif text-stone-900 dark:text-zinc-100">
                {operationalGateState === 'INITIAL_LOADING'
                  ? SAFETY_HYDRATION_LOADING_MESSAGE
                  : operationalGateState === 'CONNECTION_UNVERIFIED'
                  ? SAFETY_CONNECTION_UNVERIFIED_MESSAGE
                  : operationalGateState === 'ERROR'
                  ? SAFETY_HYDRATION_ERROR_MESSAGE
                  : 'Review Production Notes before proceeding.'}
              </h3>
              <p className="max-w-md mx-auto text-xs sm:text-sm text-stone-600 dark:text-zinc-400 font-medium">
                {operationalGateState === 'INITIAL_LOADING'
                  ? 'Waiting for server-confirmed recipes and packaging presets from Cloud Firestore before unlocking the mixing checklist.'
                  : operationalGateState === 'CONNECTION_UNVERIFIED'
                  ? 'Live Cloud Firestore connection must be verified before approving safety instructions and starting a new mix.'
                  : operationalGateState === 'ERROR'
                  ? `Critical Production Notes cannot be verified while Cloud Firestore sync is unavailable${effectiveSyncError ? ` (${effectiveSyncError})` : ''}. Please restore connection and retry.`
                  : 'This production run has safety or handling instructions that must be reviewed and acknowledged before viewing the scaled mixing checklist.'}
              </p>
            </div>
            <div>
              {operationalGateState === 'ERROR' || operationalGateState === 'CONNECTION_UNVERIFIED' ? (
                <button
                  id="btn-retry-notes-sync-from-gate"
                  type="button"
                  onClick={handleRetrySafetySync}
                  className={`inline-flex items-center gap-2 min-h-[44px] px-5 py-3 rounded-xl text-white font-bold text-sm shadow-xs transition cursor-pointer ${
                    operationalGateState === 'ERROR'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-amber-600 hover:bg-amber-500'
                  }`}
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Retry Safety Sync</span>
                </button>
              ) : operationalGateState === 'READY' ? (
                <button
                  id="btn-open-notes-from-gate"
                  type="button"
                  onClick={() => {
                    setIsNotesExpanded(true);
                    const el = document.getElementById('prod-notes-card');
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="inline-flex items-center gap-2 min-h-[44px] px-5 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold text-sm shadow-xs transition cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>Review Production Notes</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          /* Active Scaled Production Mix Sheet (remains visible in read-only hold during CONNECTION_UNVERIFIED) */
          <div className="space-y-6">
            {/* Mixer Status Banner */}
            {!activeMixer ? (
              <div
                id="prod-mixer-status-banner"
                className="p-5 rounded-3xl border-2 shadow-2xs bg-amber-50 dark:bg-amber-950/40 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-amber-500 text-white shadow-xs">
                      <AlertTriangle className="w-7 h-7 stroke-[2.5]" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-black tracking-tight">
                        CAPACITY CANNOT BE VERIFIED — NO MIXER CONFIGURED
                      </h3>
                      <p className="text-xs sm:text-sm font-medium opacity-90">
                        Equipment and mixer capacities must be configured in Management Mode to enable automated capacity checks and batch splits.
                      </p>
                    </div>
                  </div>
                  <div className="px-3.5 py-1.5 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs font-black shrink-0">
                    No active mixer
                  </div>
                </div>
              </div>
            ) : (
              <div
                id="prod-mixer-status-banner"
                className={`p-5 rounded-3xl border-2 shadow-2xs ${
                  calculationResult.isCapacityExceeded
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 dark:border-amber-700 text-amber-950 dark:text-amber-100'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-xs ${
                        calculationResult.isCapacityExceeded
                          ? 'bg-amber-500 text-white'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {calculationResult.isCapacityExceeded ? (
                        <AlertTriangle className="w-7 h-7 stroke-[2.5]" />
                      ) : (
                        <Check className="w-7 h-7 stroke-[3]" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-black tracking-tight">
                        {fullMixerBatches > 0
                          ? (fullMixerBatches === 1
                              ? '✓ GOOD TO PROCEED — ONE FULL MIXER BATCH'
                              : `✓ GOOD TO PROCEED — ${fullMixerBatches} MIXER BATCHES SCHEDULED`)
                          : fullRecipeCount > 0
                          ? (calculationResult.isCapacityExceeded
                              ? `⚠ ${calculationResult.suggestedBatches} MIXES REQUIRED`
                              : `✓ GOOD TO PROCEED — ${fullRecipeCount} FULL ${fullRecipeCount === 1 ? 'RECIPE' : 'RECIPES'}`)
                          : (calculationResult.isCapacityExceeded
                              ? `⚠ ${calculationResult.suggestedBatches} MIXES REQUIRED`
                              : '✓ GOOD TO PROCEED — ONE MIX')}
                      </h3>
                      <p className="text-xs sm:text-sm font-semibold opacity-90">
                        {fullMixerBatches > 0 ? (
                          <span>
                            FULL MIXER CAPACITY • {fullMixerBatches} mixer {fullMixerBatches === 1 ? 'batch' : 'batches'} • {formatNumber(fromGrams(activeMixer.maxWeight, activeMixer.weightUnit), 0)} {activeMixer.weightUnit.toUpperCase()} maximum per batch • {formatNumber(fromGrams(calculationResult.totalBatchWeightGrams, activeMixer.weightUnit), 0)} {activeMixer.weightUnit.toUpperCase()} total scheduled production
                          </span>
                        ) : (
                          <span>
                            {activeMixer.name} Limit:{' '}
                            <strong>
                              {activeMixer.maxWeight} {activeMixer.weightUnit.toUpperCase()}
                            </strong>{' '}
                            • Total Required Mix:{' '}
                            <strong>
                              {formatNumber(
                                calculationResult.displayBatchWeight,
                                calculationResult.displayWeightUnit === 'g' ? 0 : decimals
                              )}{' '}
                              {calculationResult.displayWeightUnit.toUpperCase()}
                            </strong>
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {calculationResult.isCapacityExceeded && (
                    <div className="px-4 py-2 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs font-black">
                      Split batch into {calculationResult.suggestedBatches} equal mixes
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* High-Level Production Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border-2 border-stone-200 dark:border-zinc-800 shadow-xs">
                <span className="text-[10px] sm:text-xs uppercase tracking-wider font-bold text-stone-600 dark:text-zinc-400 block">
                  {fullRecipeCount > 0
                    ? 'Full Recipes'
                    : fullMixerBatches > 0
                    ? 'Mixer Batches'
                    : isCustomActive && totalCasesSelected === 0
                    ? 'Custom Pieces'
                    : 'Total Cases'}
                </span>
                <span className="text-2xl sm:text-3xl font-black font-mono text-stone-900 dark:text-zinc-100">
                  {fullRecipeCount > 0
                    ? fullRecipeCount
                    : fullMixerBatches > 0
                    ? fullMixerBatches
                    : isCustomActive && totalCasesSelected === 0
                    ? customQuantity.pieces
                    : totalCasesSelected}
                </span>
              </div>

              <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border-2 border-stone-200 dark:border-zinc-800 shadow-xs">
                <span className="text-[10px] sm:text-xs uppercase tracking-wider font-bold text-stone-600 dark:text-zinc-400 block">
                  {fullRecipeCount > 0 || fullMixerBatches > 0 ? 'Batch Yield' : 'Net Production Requirement'}
                </span>
                <span className="text-2xl sm:text-3xl font-black font-mono text-stone-900 dark:text-zinc-100">
                  {calculationResult.totalPieces > 0
                    ? calculationResult.totalPieces.toLocaleString()
                    : `${formatNumber(calculationResult.displayBatchWeight, calculationResult.displayWeightUnit === 'g' ? 0 : decimals)} ${calculationResult.displayWeightUnit.toUpperCase()}`}
                </span>
                {calculationResult.totalPieces > 0 && calculationResult.totalFinishedWeightGrams > 0 && (
                  <span className="text-xs font-semibold text-stone-500 dark:text-zinc-400 block mt-0.5">
                    {formatNumber(fromGrams(calculationResult.totalFinishedWeightGrams, calculationResult.displayWeightUnit), calculationResult.displayWeightUnit === 'g' ? 0 : decimals)} {calculationResult.displayWeightUnit.toUpperCase()} finished
                  </span>
                )}
              </div>

              <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border-2 border-stone-200 dark:border-zinc-800 shadow-xs">
                <span className="text-[10px] sm:text-xs uppercase tracking-wider font-bold text-stone-600 dark:text-zinc-400 block">
                  Total Mix Required
                </span>
                <span className="text-2xl sm:text-3xl font-black font-mono text-amber-800 dark:text-amber-400">
                  {formatNumber(
                    calculationResult.displayBatchWeight,
                    calculationResult.displayWeightUnit === 'g' ? 0 : decimals
                  )}{' '}
                  <span className="text-sm font-bold text-stone-600 dark:text-zinc-400">
                    {calculationResult.displayWeightUnit.toUpperCase()}
                  </span>
                </span>
                {calculationResult.productionWastePercent > 0 && (
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 block mt-0.5">
                    +{formatNumber(fromGrams(calculationResult.totalBatchWeightGrams - calculationResult.totalFinishedWeightGrams, calculationResult.displayWeightUnit), calculationResult.displayWeightUnit === 'g' ? 0 : decimals)} {calculationResult.displayWeightUnit.toUpperCase()} waste ({calculationResult.productionWastePercent}%)
                  </span>
                )}
              </div>

              <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border-2 border-stone-200 dark:border-zinc-800 shadow-xs">
                <span className="text-[10px] sm:text-xs uppercase tracking-wider font-bold text-stone-600 dark:text-zinc-400 block">
                  Production Waste
                </span>
                <span className="text-2xl sm:text-3xl font-black font-mono text-stone-900 dark:text-zinc-100">
                  {calculationResult.overrideWastePercent ?? calculationResult.recipeWastePercent}%
                </span>
              </div>
            </div>

            {/* Section 3: Scaled Formula (MAKE THIS MIX) */}
            <section className="bg-white dark:bg-zinc-900 border-2 border-stone-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl sm:text-2xl font-black font-serif text-stone-900 dark:text-zinc-100">
                    MAKE THIS MIX
                  </h2>
                  <span className="text-xs sm:text-sm font-mono font-bold text-stone-600 dark:text-zinc-400">
                    ({Object.values(checkedIngredients).filter(Boolean).length} /{' '}
                    {calculationResult.calculatedIngredients.length} scaled)
                  </span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {/* Production Measurement Display Mode Selector (Phase 2B.5.5) */}
                  <div
                    id="production-display-mode-selector"
                    className="flex items-center bg-stone-100 dark:bg-zinc-800 rounded-xl p-1 border border-stone-200 dark:border-zinc-700 text-xs font-bold"
                  >
                    {PRODUCTION_DISPLAY_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        id={`display-mode-btn-${mode.value}`}
                        onClick={() => {
                          setDisplayMode(mode.value);
                          if (isWeightUnit(mode.value)) {
                            setDisplayUnit(mode.value as WeightUnit);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          displayMode === mode.value
                            ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 shadow-xs font-black ring-1 ring-amber-500/30'
                            : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
                        }`}
                      >
                        {mode.shortLabel}
                      </button>
                    ))}
                  </div>

                  {/* Multi-batch toggle if split */}
                  {calculationResult.suggestedBatches > 1 && (
                    <div className="flex items-center bg-amber-100 dark:bg-amber-950/60 p-1 rounded-xl border border-amber-300 dark:border-amber-800 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setBatchViewMode('per_batch')}
                        className={`px-3 py-1.5 rounded-lg transition ${
                          batchViewMode === 'per_batch'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        Per Mix (1 of {calculationResult.suggestedBatches})
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchViewMode('total')}
                        className={`px-3 py-1.5 rounded-lg transition ${
                          batchViewMode === 'total'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        Total Mix
                      </button>
                    </div>
                  )}

                  {Object.values(checkedIngredients).some(Boolean) && canProceedWithMix && (
                    <button
                      onClick={handleResetChecklist}
                      className="text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 underline cursor-pointer"
                    >
                      Clear Checklist
                    </button>
                  )}
                </div>
              </div>

              {!canProceedWithMix && operationalGateState === 'CONNECTION_UNVERIFIED' && (
                <div
                  id="prod-checklist-unverified-hold-notice"
                  className="p-3.5 rounded-2xl border border-dashed border-amber-400 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-100 text-center"
                >
                  {SAFETY_CONNECTION_UNVERIFIED_MESSAGE}
                </div>
              )}

              {/* Ingredients Interactive Floor Rows */}
              <div className="space-y-2">
                {calculationResult.calculatedIngredients.map((ing) => {
                  const isChecked = !!checkedIngredients[ing.id];
                  const isPB = ing.isPeanutButter || isPeanutButterIngredient(ing.name, currentRecipe?.name);
                  const recipeIng = currentRecipe?.ingredients.find((i) => i.id === ing.id);
                  const ingCategory = (recipeIng as any)?.category || (ing as any)?.category;
                  const isButter = !isPB && isButterIngredient(ing.name, ingCategory);

                  // Determine quantity and unit to display
                  const isPerBatch = batchViewMode === 'per_batch' && calculationResult.suggestedBatches > 1;
                  const rawQty = isPerBatch
                    ? (ing.perBatchQuantity !== undefined ? ing.perBatchQuantity : ing.requiredQuantity / calculationResult.suggestedBatches)
                    : ing.requiredQuantity;
                  const unitToDisplay = ing.requiredUnit;
                  let secondaryQty: number | undefined = undefined;
                  let secondaryUnit: string | undefined = undefined;
                  let butterPounds: number | undefined = undefined;

                  if (isButter && unitToDisplay.toLowerCase() === 'g') {
                    // Butter in grams: secondary lb equivalent
                    butterPounds = fromGrams(rawQty, 'lb');
                  } else if (
                    ing.convertedQuantityInDefaultUnit !== undefined &&
                    ing.defaultUnit &&
                    ing.requiredUnit !== ing.defaultUnit
                  ) {
                    secondaryQty = isPerBatch
                      ? ing.convertedQuantityInDefaultUnit / calculationResult.suggestedBatches
                      : ing.convertedQuantityInDefaultUnit;
                    secondaryUnit = ing.defaultUnit;
                  }

                  const qtyToDisplay = rawQty;

                  const { maxDecimals, minDecimals } = isButter && unitToDisplay.toLowerCase() === 'g'
                    ? { maxDecimals: 0, minDecimals: 0 }
                    : getDisplayDecimals(unitToDisplay, isButter, decimals, isPB);

                  // Peanut butter formatted notes
                  const pbDetail =
                    batchViewMode === 'per_batch' && calculationResult.suggestedBatches > 1
                      ? ing.perBatchJarsDetail
                      : ing.jarsDetail;

                  return (
                    <div
                      key={ing.id}
                      id={`prod-ing-row-${ing.id}`}
                      onClick={() => handleToggleIngredient(ing.id)}
                      className={`flex items-center justify-between p-4 rounded-2xl border-2 transition select-none ${
                        !canProceedWithMix ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'
                      } ${
                        isChecked
                          ? 'bg-stone-100/70 dark:bg-zinc-800/40 border-stone-300 dark:border-zinc-800 opacity-50'
                          : 'bg-white dark:bg-zinc-900 border-stone-200 dark:border-zinc-800 hover:border-amber-400 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Large Touch Checkbox */}
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center border-2 transition shrink-0 ${
                            isChecked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'bg-white dark:bg-zinc-900 border-stone-400 dark:border-zinc-600 text-transparent'
                          }`}
                        >
                          <Check className="w-6 h-6 stroke-[3]" />
                        </div>

                        <div className="min-w-0">
                          <h4
                            className={`text-lg sm:text-xl font-bold truncate ${
                              isChecked
                                ? 'line-through text-stone-600 dark:text-zinc-400'
                                : 'text-stone-900 dark:text-zinc-100'
                            }`}
                          >
                            {ing.name}
                          </h4>
                          {ing.notes && (
                            <p className="text-xs text-stone-600 dark:text-zinc-400 truncate">
                              {ing.notes}
                            </p>
                          )}
                          {pbDetail && (
                            <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
                              {pbDetail.text}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Scaled Quantity Display */}
                      <div className="text-right shrink-0 pl-3">
                        <div
                          className={`text-xl sm:text-2xl md:text-3xl font-black font-mono ${
                            isChecked
                              ? 'text-stone-600 dark:text-zinc-400'
                              : 'text-amber-800 dark:text-amber-400'
                          }`}
                        >
                          {formatNumber(qtyToDisplay, maxDecimals, minDecimals)}{' '}
                          <span className="text-base sm:text-lg font-bold text-stone-600 dark:text-zinc-300">
                            {unitToDisplay}
                          </span>
                        </div>

                        {/* Part 7: Butter secondary LB equivalent, directly underneath the gram amount, always 2 decimal places */}
                        {isButter && butterPounds !== undefined && (
                          <div
                            id={`butter-lb-${ing.id}`}
                            className="text-sm sm:text-base font-bold font-mono text-stone-500 dark:text-zinc-400 mt-0.5"
                          >
                            {formatNumber(butterPounds, 2, 2)} lb
                          </div>
                        )}

                        {/* Part 8: Other non-butter secondary unit conversion if present */}
                        {!isButter && secondaryQty !== undefined && secondaryUnit && (
                          <span className="text-xs font-mono text-stone-600 dark:text-zinc-400">
                            (
                            {(() => {
                              const secDisplayDecimals = getDisplayDecimals(
                                secondaryUnit,
                                isButter,
                                decimals,
                                isPB
                              );
                              const secQty =
                                batchViewMode === 'per_batch' && calculationResult.suggestedBatches > 1
                                  ? secondaryQty / calculationResult.suggestedBatches
                                  : secondaryQty;
                              return `${formatNumber(secQty, secDisplayDecimals.maxDecimals, secDisplayDecimals.minDecimals)} ${secondaryUnit}`;
                            })()}
                            )
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
