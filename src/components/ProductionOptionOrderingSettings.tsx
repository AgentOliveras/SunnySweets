import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ProductionPreset, AccessRole, DEFAULT_PRESET_CATEGORIES } from '../types';
import {
  SYSTEM_OPTION_KEYS,
  isSystemOptionKey,
  normalizeLegacyOptionKey,
  matchesPresetKey,
  isPresetEnabledForProduction,
  ProductionOptionOrderMigrationInspection,
} from '../utils/productionOptionOrdering';
import { normalizePresetCategory } from '../utils/calculator';
import { FirestoreHydrationState } from '../utils/productionNotes';
import { store } from '../services/store';
import {
  ArrowUp,
  ArrowDown,
  RotateCcw,
  CheckCircle2,
  GripVertical,
  Sparkles,
  Scale,
  ChefHat,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Lock,
  AlertTriangle,
  EyeOff,
  UploadCloud,
} from 'lucide-react';

interface ProductionOptionOrderingSettingsProps {
  presets: ProductionPreset[];
  productionOptionOrder?: string[] | null;
  userRole?: AccessRole | null;
  onNotification?: (msg: string) => void;
  initialOpenCategoriesForTest?: Record<string, boolean>;
}

const SYSTEM_OPTIONS_CATEGORY = 'System Production Options';

const CATEGORY_ICONS: Record<string, string> = {
  Cookies: '🍪',
  'Pie Dough': '🥧',
  'Base Dough': '🍞',
  Shortbread: '🧈',
  [SYSTEM_OPTIONS_CATEGORY]: '⚙️',
};

function getSystemOptionInfo(key: string) {
  if (key === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY) {
    return {
      title: 'Custom Quantity',
      subtitle: 'Enter total pieces & piece weight manually',
      badge: 'System Option',
      icon: <SlidersHorizontal className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    };
  }
  if (key === SYSTEM_OPTION_KEYS.FULL_RECIPE) {
    return {
      title: 'Full Recipe',
      subtitle: 'Produce 1x, 2x, 3x... base recipe batches',
      badge: 'System Option',
      icon: <ChefHat className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    };
  }
  if (key === SYSTEM_OPTION_KEYS.FULL_MIXER) {
    return {
      title: 'Full Mixer Capacity',
      subtitle: 'Fill mixer bowl(s) to safe capacity limit',
      badge: 'System Option',
      icon: <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
    };
  }
  return null;
}

/**
 * Helper to derive categorized ordering state from normalized preset categories
 * and the authoritative shared workspace `productionOptionOrder`.
 * Disabled presets (`productionEnabled === false`) remain in their exact category slot
 * so disabling/re-enabling never loses their Production Floor display position.
 */
function buildCategorizedState(
  allPresets: ProductionPreset[],
  savedOrder: string[] | null | undefined
): {
  orderedCategories: string[];
  itemsByCategory: Record<string, string[]>;
} {
  const categorySet = new Set<string>(DEFAULT_PRESET_CATEGORIES);
  allPresets.forEach((p) => {
    categorySet.add(normalizePresetCategory(p));
  });

  const allPresetCategories = Array.from(categorySet);

  const itemsMap: Record<string, string[]> = {};
  allPresetCategories.forEach((cat) => {
    itemsMap[cat] = [];
  });
  itemsMap[SYSTEM_OPTIONS_CATEGORY] = [];

  const usedPresetIds = new Set<string>();
  const usedSystemKeys = new Set<string>();
  const seenCategoryOrder: string[] = [];

  if (savedOrder && Array.isArray(savedOrder) && savedOrder.length > 0) {
    for (const rawKey of savedOrder) {
      if (typeof rawKey !== 'string' || !rawKey.trim()) continue;
      const normKey = normalizeLegacyOptionKey(rawKey);

      if (isSystemOptionKey(normKey)) {
        if (!usedSystemKeys.has(normKey)) {
          usedSystemKeys.add(normKey);
          itemsMap[SYSTEM_OPTIONS_CATEGORY].push(normKey);
          if (!seenCategoryOrder.includes(SYSTEM_OPTIONS_CATEGORY)) {
            seenCategoryOrder.push(SYSTEM_OPTIONS_CATEGORY);
          }
        }
        continue;
      }

      const matched = allPresets.find(
        (p) => !usedPresetIds.has(p.id) && matchesPresetKey(p, normKey)
      );
      if (matched) {
        usedPresetIds.add(matched.id);
        const cat = normalizePresetCategory(matched);
        if (!itemsMap[cat]) itemsMap[cat] = [];
        itemsMap[cat].push(matched.id);
        if (!seenCategoryOrder.includes(cat)) {
          seenCategoryOrder.push(cat);
        }
      }
    }
  }

  for (const cat of allPresetCategories) {
    const remaining = allPresets
      .filter((p) => normalizePresetCategory(p) === cat && !usedPresetIds.has(p.id))
      .sort((a, b) => {
        if (a.finishedWeight !== b.finishedWeight) return a.finishedWeight - b.finishedWeight;
        return a.name.localeCompare(b.name);
      });
    for (const p of remaining) {
      usedPresetIds.add(p.id);
      itemsMap[cat].push(p.id);
    }
  }

  const defaultSysKeys = [
    SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
    SYSTEM_OPTION_KEYS.FULL_RECIPE,
    SYSTEM_OPTION_KEYS.FULL_MIXER,
  ];
  for (const sysKey of defaultSysKeys) {
    if (!usedSystemKeys.has(sysKey)) {
      usedSystemKeys.add(sysKey);
      itemsMap[SYSTEM_OPTIONS_CATEGORY].push(sysKey);
    }
  }

  const finalCategoryOrder: string[] = [...seenCategoryOrder];
  const defaultPriority = [...DEFAULT_PRESET_CATEGORIES];

  for (const defCat of defaultPriority) {
    if (!finalCategoryOrder.includes(defCat)) {
      const sysIdx = finalCategoryOrder.indexOf(SYSTEM_OPTIONS_CATEGORY);
      if (sysIdx >= 0 && seenCategoryOrder.length > 0) {
        finalCategoryOrder.splice(sysIdx, 0, defCat);
      } else {
        finalCategoryOrder.push(defCat);
      }
    }
  }

  for (const cat of allPresetCategories) {
    if (!finalCategoryOrder.includes(cat)) {
      const sysIdx = finalCategoryOrder.indexOf(SYSTEM_OPTIONS_CATEGORY);
      if (sysIdx >= 0) {
        finalCategoryOrder.splice(sysIdx, 0, cat);
      } else {
        finalCategoryOrder.push(cat);
      }
    }
  }

  if (!finalCategoryOrder.includes(SYSTEM_OPTIONS_CATEGORY)) {
    finalCategoryOrder.push(SYSTEM_OPTIONS_CATEGORY);
  }

  return {
    orderedCategories: finalCategoryOrder,
    itemsByCategory: itemsMap,
  };
}

export const ProductionOptionOrderingSettings: React.FC<ProductionOptionOrderingSettingsProps> = ({
  presets,
  productionOptionOrder,
  userRole,
  onNotification,
  initialOpenCategoriesForTest,
}) => {
  const effectiveRole = userRole !== undefined ? userRole : store.getUserRole();
  const canEditOrder = effectiveRole === 'owner' || effectiveRole === 'editor';
  const isOwner = effectiveRole === 'owner';

  const [liveStoreOrder, setLiveStoreOrder] = useState<string[] | null>(() =>
    productionOptionOrder !== undefined ? productionOptionOrder : store.getProductionOptionOrder()
  );
  const [livePresets, setLivePresets] = useState<ProductionPreset[]>(() =>
    presets && presets.length > 0 ? presets : store.getPresets()
  );
  const [workspaceHydrationState, setWorkspaceHydrationState] = useState<FirestoreHydrationState>(
    () => store.getWorkspaceDocHydrationState()
  );
  const [workspaceSyncError, setWorkspaceSyncError] = useState<string | null>(() =>
    store.getWorkspaceDocSyncError()
  );
  const [migrationInspection, setMigrationInspection] =
    useState<ProductionOptionOrderMigrationInspection | null>(() =>
      store.inspectPendingProductionOrderMigration()
    );

  const authoritativeOrder =
    productionOptionOrder !== undefined ? productionOptionOrder : liveStoreOrder;
  const effectivePresets = presets && presets.length > 0 ? presets : livePresets;

  const [orderedCategories, setOrderedCategories] = useState<string[]>(
    () => buildCategorizedState(effectivePresets, authoritativeOrder).orderedCategories
  );
  const [itemsByCategory, setItemsByCategory] = useState<Record<string, string[]>>(
    () => buildCategorizedState(effectivePresets, authoritativeOrder).itemsByCategory
  );
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    () => initialOpenCategoriesForTest || {}
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPromotingLegacy, setIsPromotingLegacy] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;

  // Subscribe to live store updates so cross-device workspace snapshots and preset toggles reflect immediately
  useEffect(() => {
    const syncFromStore = () => {
      const nextStoreOrder = store.getProductionOptionOrder();
      const nextStorePresets = store.getPresets();
      const nextHydration = store.getWorkspaceDocHydrationState();
      const nextErr = store.getWorkspaceDocSyncError();
      const nextMigration = store.inspectPendingProductionOrderMigration();

      setLiveStoreOrder(nextStoreOrder);
      if (nextStorePresets.length > 0 || (!presets || presets.length === 0)) {
        setLivePresets(nextStorePresets);
      }
      setWorkspaceHydrationState(nextHydration);
      setWorkspaceSyncError(nextErr);
      setMigrationInspection(nextMigration);
    };

    syncFromStore();
    return store.subscribe(syncFromStore);
  }, [presets]);

  // Rebuild categorized view from authoritative workspace order + normalized presets whenever no unsaved local edits exist
  useEffect(() => {
    if (hasChangesRef.current) return;
    const next = buildCategorizedState(effectivePresets, authoritativeOrder);
    setOrderedCategories(next.orderedCategories);
    setItemsByCategory(next.itemsByCategory);
  }, [effectivePresets, authoritativeOrder]);

  const presetMap = useMemo(() => {
    const map = new Map<string, ProductionPreset>();
    effectivePresets.forEach((p) => map.set(p.id, p));
    return map;
  }, [effectivePresets]);

  const dragItemInfo = useRef<{ type: 'category' | 'item'; category?: string; index: number } | null>(
    null
  );
  const [dragOverTarget, setDragOverTarget] = useState<{
    type: 'category' | 'item';
    category?: string;
    index: number;
  } | null>(null);

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleExpandAllCategories = () => {
    const next: Record<string, boolean> = {};
    orderedCategories.forEach((c) => {
      next[c] = true;
    });
    setOpenCategories(next);
  };

  const handleCollapseAllCategories = () => {
    setOpenCategories({});
  };

  const moveCategory = (index: number, direction: 'up' | 'down') => {
    if (!canEditOrder) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= orderedCategories.length) return;
    const next = [...orderedCategories];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    setOrderedCategories(next);
    setHasChanges(true);
    setSavedSuccess(false);
    setSaveError(null);
  };

  const reorderCategories = (fromIndex: number, toIndex: number) => {
    if (!canEditOrder) return;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = [...orderedCategories];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setOrderedCategories(next);
    setHasChanges(true);
    setSavedSuccess(false);
    setSaveError(null);
  };

  const moveItemInCategory = (category: string, index: number, direction: 'up' | 'down') => {
    if (!canEditOrder) return;
    const list = itemsByCategory[category] || [];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const nextList = [...list];
    const [moved] = nextList.splice(index, 1);
    nextList.splice(targetIdx, 0, moved);
    setItemsByCategory((prev) => ({ ...prev, [category]: nextList }));
    setHasChanges(true);
    setSavedSuccess(false);
    setSaveError(null);
  };

  const reorderItemInCategory = (category: string, fromIndex: number, toIndex: number) => {
    if (!canEditOrder) return;
    const list = itemsByCategory[category] || [];
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const nextList = [...list];
    const [moved] = nextList.splice(fromIndex, 1);
    nextList.splice(toIndex, 0, moved);
    setItemsByCategory((prev) => ({ ...prev, [category]: nextList }));
    setHasChanges(true);
    setSavedSuccess(false);
    setSaveError(null);
  };

  const fullAssembledOrder = useMemo(() => {
    const result: string[] = [];
    for (const cat of orderedCategories) {
      const items = itemsByCategory[cat] || [];
      result.push(...items);
    }
    return result;
  }, [orderedCategories, itemsByCategory]);

  const handleSaveOrder = async () => {
    if (!canEditOrder || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedSuccess(false);
    try {
      await store.setProductionOptionOrder(fullAssembledOrder, effectiveRole);
      setHasChanges(false);
      setSavedSuccess(true);
      if (onNotification) {
        onNotification('Production option display order saved to shared workspace and synced across devices.');
      }
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err: any) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to save production option order to Cloud Firestore.';
      setSaveError(msg);
      setSavedSuccess(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!canEditOrder || isSaving) return;
    setSaveError(null);
    setSavedSuccess(false);
    const defaultState = buildCategorizedState(effectivePresets, null);
    const defaultAssembled: string[] = [];
    for (const cat of defaultState.orderedCategories) {
      defaultAssembled.push(...(defaultState.itemsByCategory[cat] || []));
    }
    setIsSaving(true);
    try {
      await store.setProductionOptionOrder(defaultAssembled, effectiveRole);
      setOrderedCategories(defaultState.orderedCategories);
      setItemsByCategory(defaultState.itemsByCategory);
      setHasChanges(false);
      setSavedSuccess(true);
      if (onNotification) {
        onNotification('Production option order reset to default ascending weight order.');
      }
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err: any) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to reset production option order in Cloud Firestore.';
      setSaveError(msg);
      setSavedSuccess(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromoteLegacyOrder = async () => {
    if (!isOwner || isPromotingLegacy) return;
    setIsPromotingLegacy(true);
    setSaveError(null);
    setSavedSuccess(false);
    try {
      const promoted = await store.promoteLegacyProductionOptionOrder(effectiveRole);
      const next = buildCategorizedState(effectivePresets, promoted);
      setOrderedCategories(next.orderedCategories);
      setItemsByCategory(next.itemsByCategory);
      setHasChanges(false);
      setSavedSuccess(true);
      if (onNotification) {
        onNotification(
          'Saved device production option order promoted to shared workspace across all devices.'
        );
      }
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err: any) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to promote saved device order to Cloud Firestore.';
      setSaveError(msg);
    } finally {
      setIsPromotingLegacy(false);
    }
  };

  const handleDismissLegacyOrder = () => {
    if (!isOwner) return;
    store.dismissLegacyProductionOrderCandidate();
  };

  const isWorkspaceHydratedReady = workspaceHydrationState === 'READY';

  return (
    <div className="bg-white dark:bg-[#1E1B18] p-5 md:p-6 rounded-2xl border border-[#EEECE8] dark:border-[#2D2925] shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#D4A373]" />
            <span>Production Option Display Order</span>
          </h3>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 leading-relaxed">
            Shared workspace order for Production Mode quantity options across all bakery devices. Disabled presets remain listed here so their slot is preserved if re-enabled.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
          <button
            type="button"
            onClick={handleExpandAllCategories}
            className="px-2.5 py-1.5 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-[11px] font-bold hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] transition cursor-pointer"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={handleCollapseAllCategories}
            className="px-2.5 py-1.5 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-[11px] font-bold hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] transition cursor-pointer"
          >
            Collapse All
          </button>

          {canEditOrder ? (
            <>
              <button
                id="btn-reset-prod-option-order"
                type="button"
                disabled={isSaving || !isWorkspaceHydratedReady}
                onClick={handleResetToDefault}
                className="px-3 py-1.5 rounded-xl border border-[#E5E1DA] dark:border-[#332F2B] bg-[#FAF7F2] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Default</span>
              </button>

              <button
                id="btn-save-prod-option-order"
                type="button"
                disabled={(!hasChanges && !savedSuccess) || isSaving || !isWorkspaceHydratedReady}
                onClick={handleSaveOrder}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs ${
                  savedSuccess
                    ? 'bg-emerald-600 text-white cursor-default'
                    : hasChanges && isWorkspaceHydratedReady
                    ? 'bg-[#D4A373] hover:bg-[#C29363] text-white cursor-pointer'
                    : 'bg-[#EEECE8] dark:bg-[#2D2925] text-[#A39E93] dark:text-[#6E675F] cursor-not-allowed'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {isSaving
                    ? 'Saving...'
                    : savedSuccess
                    ? 'Order Saved'
                    : 'Save Order'}
                </span>
              </button>
            </>
          ) : (
            <span
              id="prod-option-order-viewer-readonly"
              className="px-3 py-1.5 rounded-xl border border-[#E5E1DA] dark:border-[#332F2B] bg-[#F5F2ED] dark:bg-[#25221F] text-[11px] font-bold text-[#8B7E74] dark:text-[#A39E93] inline-flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5 text-[#D4A373]" />
              <span>View-only (Owner or Editor required)</span>
            </span>
          )}
        </div>
      </div>

      {/* Missing / Unhydrated Workspace Diagnostic Banner */}
      {!isWorkspaceHydratedReady && (
        <div
          id="prod-option-order-hydration-warning"
          role="alert"
          className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="font-bold">
              {workspaceHydrationState === 'ERROR'
                ? 'Workspace ordering synchronization unavailable'
                : 'Syncing shared workspace ordering from Cloud Firestore...'}
            </p>
            <p className="text-[11px] opacity-90">
              {workspaceSyncError ||
                'Saving is temporarily locked until the authoritative workspace document finishes hydrating.'}
            </p>
          </div>
        </div>
      )}

      {/* Save Error Diagnostic Banner (Never reports false success) */}
      {saveError && (
        <div
          id="prod-option-order-save-error"
          role="alert"
          className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 text-xs flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
          <div className="space-y-1">
            <p className="font-bold">Could not save shared Production Option Display Order</p>
            <p className="text-[11px] opacity-90">{saveError}</p>
          </div>
        </div>
      )}

      {/* Non-Destructive Owner Legacy Device Order Reconciliation Panel */}
      {isOwner && migrationInspection?.hasDifferences && (
        <div
          id="legacy-prod-order-reconciliation-banner"
          className="p-4 rounded-xl border-2 border-[#D4A373] bg-[#FAF6F0] dark:bg-[#26211C] space-y-3"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5">
              <UploadCloud className="w-5 h-5 text-[#D4A373] shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                  Saved Device Order Available for Shared Workspace Promotion
                </h4>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] mt-0.5 leading-relaxed">
                  A previously saved production option order was detected on your Owner account/device that differs from the current shared workspace order. Review both sequences below before choosing whether to promote your saved order to all bakery devices.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div className="p-3 rounded-lg bg-white dark:bg-[#1E1B18] border border-[#D4A373]/60 space-y-1.5">
              <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1] uppercase tracking-wider text-[10px]">
                Saved Owner Candidate Order
              </div>
              <ol className="list-decimal list-inside space-y-0.5 text-[#5A534B] dark:text-[#EAE6E1] font-medium">
                {migrationInspection.candidateLabels.map((label, idx) => (
                  <li key={`cand-${idx}`}>{label}</li>
                ))}
              </ol>
            </div>

            <div className="p-3 rounded-lg bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] space-y-1.5">
              <div className="font-bold text-[#8B7E74] dark:text-[#A39E93] uppercase tracking-wider text-[10px]">
                Current Shared Workspace Order
              </div>
              <ol className="list-decimal list-inside space-y-0.5 text-[#6E675F] dark:text-[#A39E93]">
                {migrationInspection.workspaceLabels.map((label, idx) => (
                  <li key={`ws-${idx}`}>{label}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button
              id="btn-promote-legacy-prod-order"
              type="button"
              disabled={isPromotingLegacy || !isWorkspaceHydratedReady}
              onClick={handlePromoteLegacyOrder}
              className="px-3.5 py-2 rounded-xl bg-[#D4A373] hover:bg-[#C29363] text-white text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>
                {isPromotingLegacy
                  ? 'Promoting to Shared Workspace...'
                  : 'Promote Saved Device Order to Shared Workspace'}
              </span>
            </button>
            <button
              id="btn-dismiss-legacy-prod-order"
              type="button"
              disabled={isPromotingLegacy}
              onClick={handleDismissLegacyOrder}
              className="px-3 py-2 rounded-xl border border-[#E5E1DA] dark:border-[#332F2B] bg-white dark:bg-[#1E1B18] text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] text-xs font-bold transition cursor-pointer"
            >
              Keep Current Shared Order
            </button>
          </div>
        </div>
      )}

      {/* Categorized Collapsible Sections */}
      <div className="space-y-2.5">
        {orderedCategories.map((catName, catIdx) => {
          const isOpen = !!openCategories[catName];
          const items = itemsByCategory[catName] || [];
          const catIcon = CATEGORY_ICONS[catName] || '📦';
          const isCatDragOver =
            dragOverTarget?.type === 'category' && dragOverTarget.index === catIdx;

          const hiddenCountInCat =
            catName === SYSTEM_OPTIONS_CATEGORY
              ? 0
              : items.filter((id) => {
                  const p = presetMap.get(id);
                  return p ? !isPresetEnabledForProduction(p) : false;
                }).length;

          return (
            <div
              key={catName}
              draggable={canEditOrder}
              onDragStart={(e) => {
                if (!canEditOrder) return;
                if ((e.target as HTMLElement).closest('[data-item-row="true"]')) return;
                dragItemInfo.current = { type: 'category', index: catIdx };
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!canEditOrder) return;
                if (dragItemInfo.current?.type === 'category') {
                  e.preventDefault();
                  setDragOverTarget({ type: 'category', index: catIdx });
                }
              }}
              onDragLeave={() => {
                if (dragOverTarget?.type === 'category' && dragOverTarget.index === catIdx) {
                  setDragOverTarget(null);
                }
              }}
              onDrop={(e) => {
                if (!canEditOrder) return;
                if (dragItemInfo.current?.type === 'category') {
                  e.preventDefault();
                  reorderCategories(dragItemInfo.current.index, catIdx);
                  dragItemInfo.current = null;
                  setDragOverTarget(null);
                }
              }}
              onDragEnd={() => {
                dragItemInfo.current = null;
                setDragOverTarget(null);
              }}
              className={`rounded-xl border transition-all overflow-hidden ${
                isCatDragOver
                  ? 'border-[#D4A373] bg-[#FAF6F0] dark:bg-[#2A241E] ring-2 ring-[#D4A373]/40'
                  : 'border-[#EEECE8] dark:border-[#332F2B] bg-[#F9F8F6] dark:bg-[#25221F]'
              }`}
            >
              {/* Category Accordion Header */}
              <div className="flex items-center justify-between gap-2 px-3.5 py-3 select-none">
                <div
                  className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                  onClick={() => toggleCategory(catName)}
                >
                  {canEditOrder && (
                    <div
                      className="text-[#A39E93] dark:text-[#6E675F] cursor-grab active:cursor-grabbing shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to reorder category priority"
                    >
                      <GripVertical className="w-4 h-4" />
                    </div>
                  )}

                  <span className="w-6 h-6 rounded-lg bg-[#EAE6E1] dark:bg-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-black font-mono flex items-center justify-center shrink-0">
                    {catIdx + 1}
                  </span>

                  <span className="text-base shrink-0">{catIcon}</span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1] truncate">
                        {catName}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE6E1] dark:bg-[#332F2B] text-[#8B7E74] dark:text-[#A39E93]">
                        {items.length} {items.length === 1 ? 'option' : 'options'}
                      </span>
                      {hiddenCountInCat > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 inline-flex items-center gap-1">
                          <EyeOff className="w-3 h-3" />
                          <span>{hiddenCountInCat} Hidden on Floor</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Category Move Up/Down & Expand Toggle */}
                <div className="flex items-center gap-1 shrink-0">
                  {canEditOrder && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveCategory(catIdx, 'up')}
                        disabled={catIdx === 0}
                        aria-label={`Move ${catName} category up`}
                        className="w-7 h-7 rounded-lg border border-[#E5E1DA] dark:border-[#3D3732] bg-white dark:bg-[#1E1B18] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373] flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCategory(catIdx, 'down')}
                        disabled={catIdx === orderedCategories.length - 1}
                        aria-label={`Move ${catName} category down`}
                        className="w-7 h-7 rounded-lg border border-[#E5E1DA] dark:border-[#3D3732] bg-white dark:bg-[#1E1B18] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373] flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleCategory(catName)}
                    aria-label={isOpen ? `Collapse ${catName}` : `Expand ${catName}`}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#EAE6E1] dark:hover:bg-[#332F2B] transition cursor-pointer ml-1"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Category Items List (Collapsible) */}
              {isOpen && (
                <div className="px-3.5 pb-3.5 pt-1 border-t border-[#EEECE8] dark:border-[#332F2B] space-y-2 bg-white/60 dark:bg-[#1E1B18]/50">
                  {items.length === 0 ? (
                    <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] italic py-2 px-1">
                      No presets currently assigned to {catName}.
                    </p>
                  ) : (
                    items.map((key, idx) => {
                      const sysInfo = isSystemOptionKey(key) ? getSystemOptionInfo(key) : null;
                      const preset = !sysInfo ? presetMap.get(key) : null;
                      if (!sysInfo && !preset) return null;

                      const isPresetEnabled = preset
                        ? isPresetEnabledForProduction(preset)
                        : true;

                      const isItemDragOver =
                        dragOverTarget?.type === 'item' &&
                        dragOverTarget.category === catName &&
                        dragOverTarget.index === idx;

                      return (
                        <div
                          key={key}
                          data-item-row="true"
                          id={`prod-order-row-${key}`}
                          draggable={canEditOrder}
                          onDragStart={(e) => {
                            if (!canEditOrder) return;
                            e.stopPropagation();
                            dragItemInfo.current = { type: 'item', category: catName, index: idx };
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            if (!canEditOrder) return;
                            if (
                              dragItemInfo.current?.type === 'item' &&
                              dragItemInfo.current.category === catName
                            ) {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverTarget({ type: 'item', category: catName, index: idx });
                            }
                          }}
                          onDragLeave={() => {
                            if (
                              dragOverTarget?.type === 'item' &&
                              dragOverTarget.category === catName &&
                              dragOverTarget.index === idx
                            ) {
                              setDragOverTarget(null);
                            }
                          }}
                          onDrop={(e) => {
                            if (!canEditOrder) return;
                            if (
                              dragItemInfo.current?.type === 'item' &&
                              dragItemInfo.current.category === catName
                            ) {
                              e.preventDefault();
                              e.stopPropagation();
                              reorderItemInCategory(catName, dragItemInfo.current.index, idx);
                              dragItemInfo.current = null;
                              setDragOverTarget(null);
                            }
                          }}
                          onDragEnd={() => {
                            dragItemInfo.current = null;
                            setDragOverTarget(null);
                          }}
                          className={`flex items-center justify-between gap-3 p-2.5 sm:px-3.5 rounded-xl border transition-all select-none ${
                            isItemDragOver
                              ? 'border-[#D4A373] bg-[#FAF6F0] dark:bg-[#2A241E] ring-2 ring-[#D4A373]/40'
                              : !isPresetEnabled
                              ? 'border-dashed border-stone-300 dark:border-zinc-700 bg-stone-100/70 dark:bg-zinc-900/60 opacity-85'
                              : 'border-[#EEECE8] dark:border-[#332F2B] bg-white dark:bg-[#1E1B18] hover:border-[#D4A373]/60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {canEditOrder && (
                              <div className="text-[#A39E93] dark:text-[#6E675F] cursor-grab active:cursor-grabbing shrink-0">
                                <GripVertical className="w-4 h-4" />
                              </div>
                            )}

                            <span className="w-5 h-5 rounded-md bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-[11px] font-black font-mono flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs sm:text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1] truncate">
                                  {sysInfo ? sysInfo.title : preset!.name}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    sysInfo
                                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50'
                                      : 'bg-[#FAF7F2] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] border border-[#E5E1DA] dark:border-[#3D3732]'
                                  }`}
                                >
                                  {sysInfo ? sysInfo.badge : normalizePresetCategory(preset!)}
                                </span>
                                {!isPresetEnabled && (
                                  <span
                                    id={`prod-order-hidden-badge-${preset!.id}`}
                                    className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-stone-200 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 inline-flex items-center gap-1"
                                  >
                                    <EyeOff className="w-3 h-3" />
                                    <span>Hidden on Floor</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] truncate mt-0.5">
                                {sysInfo
                                  ? sysInfo.subtitle
                                  : `${preset!.quantityPerUnit} / ${preset!.unitName || 'case'} • ${preset!.finishedWeight} ${preset!.weightUnit} each`}
                              </p>
                            </div>
                          </div>

                          {/* Item Up / Down Buttons */}
                          {canEditOrder && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                id={`btn-order-up-${key}`}
                                type="button"
                                onClick={() => moveItemInCategory(catName, idx, 'up')}
                                disabled={idx === 0}
                                aria-label={`Move ${sysInfo ? sysInfo.title : preset!.name} up`}
                                className="w-7 h-7 rounded-lg border border-[#E5E1DA] dark:border-[#3D3732] bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373] flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                id={`btn-order-down-${key}`}
                                type="button"
                                onClick={() => moveItemInCategory(catName, idx, 'down')}
                                disabled={idx === items.length - 1}
                                aria-label={`Move ${sysInfo ? sysInfo.title : preset!.name} down`}
                                className="w-7 h-7 rounded-lg border border-[#E5E1DA] dark:border-[#3D3732] bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373] flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
