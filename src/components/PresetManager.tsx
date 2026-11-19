import React, { useState, useMemo, useRef } from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Search,
  Layers,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Tag,
  AlertTriangle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { ProductionPreset, WeightUnit, DEFAULT_PRESET_CATEGORIES, AccessRole, Recipe, CriticalProductionNote } from '../types';
import { WEIGHT_UNITS } from '../utils/units';
import { getApplicablePresetsForRecipe } from '../utils/calculator';
import { store } from '../services/store';
import { CriticalNotesSyncReview } from './CriticalNotesSyncReview';
import {
  PresetDeleteModalState,
  PresetEditorModalState,
  PresetEditorMode,
  buildPresetSubmissionPayload,
  createClosedPresetEditorState,
  createEditPresetEditorState,
  createInitialPresetDeleteState,
  createNewPresetEditorState,
  openPresetDeleteConfirmationState,
} from '../utils/presetEditorState';
import {
  CryptoProviderLike,
  generateCryptographicallySecureUuidV4,
} from '../utils/productionNotes';
import { normalizePresetCategory } from '../utils/calculator';
import { isPresetEnabledForProduction } from '../utils/productionOptionOrdering';

interface PresetManagerProps {
  presets: ProductionPreset[];
  recipes?: Recipe[];
  userRole?: AccessRole;
  onSavePreset: (
    preset: ProductionPreset,
    options?: { mode?: PresetEditorMode; preserveRemoteProductionEnabled?: boolean }
  ) => Promise<void> | void;
  onDeletePreset: (id: string) => Promise<void> | void;
  onTogglePresetProductionEnabled?: (
    id: string,
    enabled: boolean
  ) => Promise<ProductionPreset | void> | void;
  initialEditorStateForTest?: PresetEditorModalState;
  initialDeleteStateForTest?: PresetDeleteModalState;
  cryptoOverrideForTest?: CryptoProviderLike | null;
}

const CATEGORY_ICONS: Record<string, string> = {
  Cookies: '🍪',
  'Pie Dough': '🥧',
  'Base Dough': '🍞',
  Shortbread: '🧈',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  Cookies: 'Standard and jumbo cookie cases, drop cookies, and tray portions.',
  'Pie Dough': 'Single crust shells, double crust top/bottom sets, and hand pie rounds.',
  'Base Dough': 'Artisan loaves, sourdough batards, boules, and sheet pan focaccia tubs.',
  Shortbread: 'Delicate shortbread fingers, tart shells, and portioned rounds.',
};

export const PresetManager: React.FC<PresetManagerProps> = ({
  presets,
  recipes,
  userRole = 'owner',
  onSavePreset,
  onDeletePreset,
  onTogglePresetProductionEnabled,
  initialEditorStateForTest,
  initialDeleteStateForTest,
  cryptoOverrideForTest,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grouped' | 'grid'>('grouped');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [togglingPresetIds, setTogglingPresetIds] = useState<Record<string, boolean>>({});
  const [toggleErrorMessage, setToggleErrorMessage] = useState<string | null>(null);
  const [presetCreationSecurityError, setPresetCreationSecurityError] = useState<string | null>(
    () => {
      if (cryptoOverrideForTest === null) {
        try {
          generateCryptographicallySecureUuidV4(null);
        } catch (err) {
          return err instanceof Error
            ? err.message
            : 'Unable to generate a cryptographically secure preset ID.';
        }
      }
      return null;
    }
  );

  // Centralized Create/Edit Modal State (guarantees zero stale Critical Notes carryover)
  const [editorState, setEditorState] = useState<PresetEditorModalState>(
    () => initialEditorStateForTest ?? createClosedPresetEditorState()
  );

  // Centralized In-App Delete Confirmation & Status State
  const [deleteState, setDeleteState] = useState<PresetDeleteModalState>(
    () => initialDeleteStateForTest ?? createInitialPresetDeleteState()
  );
  const deleteInFlightRef = useRef<boolean>(false);

  const {
    editorMode,
    editingPreset,
    isCustomCategory,
    customCategoryInput,
    presetNotes,
    isAddingNote,
    editingNoteId,
    editingNoteExpectedUpdatedAt,
    selectedRecipeForNote,
    newNoteText,
    noteSaveStatus,
    noteSaveMessage,
    presetSaveStatus,
    presetSaveError,
  } = editorState;

  const patchEditorState = (patch: Partial<PresetEditorModalState>) => {
    setEditorState((prev) => ({ ...prev, ...patch }));
  };

  const isOwner = userRole === 'owner';
  const isEditorOrOwner = userRole === 'owner' || userRole === 'editor';
  const availableRecipes = recipes && recipes.length > 0 ? recipes : store.getRecipes();
  const activeNonArchivedRecipes = useMemo(
    () => availableRecipes.filter((r) => !r.archived),
    [availableRecipes]
  );

  // Compute all unique categories available
  const allCategories = useMemo(() => {
    const categoriesSet = new Set<string>(DEFAULT_PRESET_CATEGORIES);
    presets.forEach((p) => {
      categoriesSet.add(normalizePresetCategory(p));
    });
    return Array.from(categoriesSet);
  }, [presets]);

  // Count presets per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: presets.length };
    allCategories.forEach((cat) => {
      counts[cat] = 0;
    });
    presets.forEach((p) => {
      const cat = normalizePresetCategory(p);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [presets, allCategories]);

  // Filter presets based on category and search query (Management NEVER hides disabled presets)
  const filteredPresets = useMemo(() => {
    return presets.filter((preset) => {
      const presetCat = normalizePresetCategory(preset);
      const matchesCategory =
        selectedCategory === 'All' || presetCat.toLowerCase() === selectedCategory.toLowerCase();

      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        preset.name.toLowerCase().includes(query) ||
        presetCat.toLowerCase().includes(query) ||
        preset.unitName.toLowerCase().includes(query) ||
        (preset.expectedYield && preset.expectedYield.toLowerCase().includes(query));

      return matchesCategory && matchesSearch;
    });
  }, [presets, selectedCategory, searchQuery]);

  // Group filtered presets by category
  const groupedPresets = useMemo(() => {
    const groups: Record<string, ProductionPreset[]> = {};
    filteredPresets.forEach((preset) => {
      const cat = normalizePresetCategory(preset);
      if (!groups[cat]) {
        groups[cat] = [];
      }
      groups[cat].push(preset);
    });
    return groups;
  }, [filteredPresets]);

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  // Available recipes matching current preset category (using shared workspace categoryPresetMap!)
  const currentCategoryForPreset = isCustomCategory
    ? customCategoryInput.trim() || 'Other'
    : editingPreset?.category || 'Cookies';

  const categoryMatchingRecipes = useMemo(() => {
    const sharedMap = store.getCategoryPresetMap();
    const probePreset: ProductionPreset = {
      id: editingPreset?.id || 'probe-preset',
      name: editingPreset?.name || 'Probe Preset',
      category: currentCategoryForPreset,
      finishedWeight: editingPreset?.finishedWeight || 1,
      weightUnit: editingPreset?.weightUnit || 'oz',
      quantityPerUnit: editingPreset?.quantityPerUnit || 1,
      unitName: editingPreset?.unitName || 'case',
      createdAt: '',
      updatedAt: '',
      userId: '',
    };

    const routed = activeNonArchivedRecipes.filter((r) => {
      const matched = getApplicablePresetsForRecipe(r, [probePreset], sharedMap);
      return matched.length > 0;
    });

    return routed.length > 0 ? routed : activeNonArchivedRecipes;
  }, [activeNonArchivedRecipes, currentCategoryForPreset, editingPreset]);

  const otherActiveRecipes = useMemo(() => {
    const matchedIds = new Set(categoryMatchingRecipes.map((r) => r.id));
    return activeNonArchivedRecipes.filter((r) => !matchedIds.has(r.id));
  }, [activeNonArchivedRecipes, categoryMatchingRecipes]);

  const isPersistedPreset = useMemo(() => {
    if (!editingPreset || editorMode !== 'edit') return false;
    return presets.some((p) => p.id === editingPreset.id);
  }, [presets, editingPreset?.id, editorMode]);

  // Keep modal's presetNotes synchronized ONLY when editing an existing persisted preset
  React.useEffect(() => {
    if (editorMode !== 'edit' || !editingPreset || !isPersistedPreset) return;
    const canonical = store.getCriticalNotesForPreset(editingPreset.id);
    setEditorState((prev) => {
      if (prev.editorMode !== 'edit' || prev.editingPreset?.id !== editingPreset.id) {
        return prev;
      }
      return { ...prev, presetNotes: canonical };
    });
  }, [presets, editingPreset?.id, isPersistedPreset, editorMode]);

  const handleCloseEditorModal = () => {
    setEditorState(createClosedPresetEditorState());
  };

  const handleOpenNewPreset = (categoryOverride?: string) => {
    try {
      const nextState = createNewPresetEditorState({
        selectedCategory,
        allCategories,
        existingPresetIds: presets.map((p) => p.id),
        categoryOverride,
        cryptoOverride: cryptoOverrideForTest,
      });
      setPresetCreationSecurityError(null);
      setEditorState(nextState);
    } catch (err: unknown) {
      setEditorState(createClosedPresetEditorState());
      setPresetCreationSecurityError(
        err instanceof Error
          ? err.message
          : 'Preset creation failed: Cryptographically secure UUID generation is unavailable.'
      );
    }
  };

  const handleOpenEdit = (preset: ProductionPreset) => {
    setPresetCreationSecurityError(null);
    const loadedNotes = store.getCriticalNotesForPreset(preset.id);
    setEditorState(createEditPresetEditorState(preset, loadedNotes));
  };

  const handleToggleProductionEnabled = async (preset: ProductionPreset) => {
    if (!isEditorOrOwner || togglingPresetIds[preset.id]) return;
    const nextEnabled = !isPresetEnabledForProduction(preset);
    setToggleErrorMessage(null);
    setTogglingPresetIds((prev) => ({ ...prev, [preset.id]: true }));
    try {
      if (onTogglePresetProductionEnabled) {
        await onTogglePresetProductionEnabled(preset.id, nextEnabled);
      } else {
        await store.setPresetProductionEnabled(preset.id, nextEnabled, userRole);
      }
    } catch (err: unknown) {
      const reason =
        err instanceof Error
          ? err.message
          : 'Unable to update Production Floor preset availability in Cloud Firestore.';
      setToggleErrorMessage(
        reason.startsWith('Status Update Failed') ? reason : `Status Update Failed: ${reason}`
      );
    } finally {
      setTogglingPresetIds((prev) => {
        const next = { ...prev };
        delete next[preset.id];
        return next;
      });
    }
  };

  const handleRequestDeletePreset = (preset: ProductionPreset) => {
    if (!isOwner || deleteInFlightRef.current) return;
    setDeleteState((prev) => openPresetDeleteConfirmationState(prev, preset));
  };

  const handleCancelDeletePreset = () => {
    if (deleteInFlightRef.current || deleteState.deletingPresetId) return;
    setDeleteState(createInitialPresetDeleteState());
  };

  const handleConfirmDeletePreset = async () => {
    if (!isOwner) return;
    const target = deleteState.presetPendingDelete;
    if (!target || deleteInFlightRef.current || deleteState.deletingPresetId) {
      return;
    }

    deleteInFlightRef.current = true;
    setDeleteState({
      presetPendingDelete: target,
      deletingPresetId: target.id,
      deleteStatus: 'deleting',
      deleteFeedbackMessage: `Deleting "${target.name}"...`,
    });

    try {
      await onDeletePreset(target.id);
      if (editingPreset?.id === target.id) {
        setEditorState(createClosedPresetEditorState());
      }
      setDeleteState({
        presetPendingDelete: null,
        deletingPresetId: null,
        deleteStatus: 'deleted',
        deleteFeedbackMessage: `Deleted preset "${target.name}".`,
      });
    } catch (err: unknown) {
      const reason =
        err instanceof Error
          ? err.message
          : 'Unable to delete preset from Cloud Firestore.';
      setDeleteState({
        presetPendingDelete: target,
        deletingPresetId: null,
        deleteStatus: 'error',
        deleteFeedbackMessage: reason.startsWith('Delete Failed')
          ? reason
          : `Delete Failed: ${reason}`,
      });
    } finally {
      deleteInFlightRef.current = false;
    }
  };

  const handleStartEditNote = (note: CriticalProductionNote) => {
    patchEditorState({
      isAddingNote: true,
      editingNoteId: note.id,
      editingNoteExpectedUpdatedAt: note.updatedAt || note.createdAt || '',
      selectedRecipeForNote: note.recipeId,
      newNoteText: note.note,
      noteSaveStatus: 'idle',
      noteSaveMessage: '',
    });
  };

  const handleSaveCriticalNoteInline = async () => {
    if (!editingPreset) return;
    const targetRecipeId =
      selectedRecipeForNote || categoryMatchingRecipes[0]?.id || activeNonArchivedRecipes[0]?.id;
    if (!targetRecipeId) {
      patchEditorState({
        noteSaveStatus: 'error',
        noteSaveMessage: 'Save Failed: Please select a valid recipe for this critical note.',
      });
      return;
    }
    if (!newNoteText.trim()) {
      patchEditorState({
        noteSaveStatus: 'error',
        noteSaveMessage: 'Save Failed: Critical note text cannot be empty.',
      });
      return;
    }

    // If editing an already-persisted preset, persist directly to Cloud Firestore and await confirmation
    if (editorMode === 'edit' && isPersistedPreset) {
      patchEditorState({
        noteSaveStatus: 'saving',
        noteSaveMessage: 'Saving to Cloud Firestore...',
      });
      try {
        const existingForRecipe = !editingNoteId
          ? presetNotes.find((n) => n.recipeId === targetRecipeId)
          : null;
        const expectedTs = editingNoteId
          ? editingNoteExpectedUpdatedAt
          : existingForRecipe
          ? existingForRecipe.updatedAt || existingForRecipe.createdAt || ''
          : null;

        await store.saveCriticalProductionNote(
          {
            id: editingNoteId || existingForRecipe?.id,
            presetId: editingPreset.id,
            recipeId: targetRecipeId,
            note: newNoteText.trim(),
            expectedUpdatedAt: expectedTs,
          },
          userRole
        );

        const refreshed = store.getCriticalNotesForPreset(editingPreset.id);
        patchEditorState({
          presetNotes: refreshed,
          newNoteText: '',
          editingNoteId: null,
          editingNoteExpectedUpdatedAt: null,
          isAddingNote: false,
          noteSaveStatus: 'saved',
          noteSaveMessage: 'Saved to shared workspace (synced across all devices).',
        });
      } catch (err: unknown) {
        patchEditorState({
          noteSaveStatus: 'error',
          noteSaveMessage:
            err instanceof Error
              ? `Save Failed: ${err.message}`
              : 'Save Failed: Unable to save Critical Production Note to Cloud Firestore.',
        });
      }
      return;
    }

    // Brand-new unsaved preset: stage note locally for THIS new preset ID ONLY until "Save Preset" persists atomically
    const nowIso = new Date().toISOString();
    setEditorState((prev) => {
      if (!prev.editingPreset) return prev;
      let nextNotes = [...prev.presetNotes];
      if (prev.editingNoteId) {
        nextNotes = nextNotes.map((n) =>
          n.id === prev.editingNoteId
            ? { ...n, recipeId: targetRecipeId, note: prev.newNoteText.trim(), updatedAt: nowIso }
            : n
        );
      } else {
        const existingIdx = nextNotes.findIndex((n) => n.recipeId === targetRecipeId);
        if (existingIdx >= 0) {
          nextNotes[existingIdx] = {
            ...nextNotes[existingIdx],
            note: prev.newNoteText.trim(),
            updatedAt: nowIso,
          };
        } else {
          let generatedNoteId: string;
          try {
            generatedNoteId = `cpn-${generateCryptographicallySecureUuidV4(cryptoOverrideForTest)}`;
          } catch (err: unknown) {
            return {
              ...prev,
              noteSaveStatus: 'error',
              noteSaveMessage:
                err instanceof Error
                  ? `Save Failed: ${err.message}`
                  : 'Save Failed: Unable to generate a secure note ID.',
            };
          }
          nextNotes.push({
            id: generatedNoteId,
            presetId: prev.editingPreset.id,
            recipeId: targetRecipeId,
            workspaceId: store.getActiveWorkspaceId(),
            note: prev.newNoteText.trim(),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      return {
        ...prev,
        presetNotes: nextNotes,
        newNoteText: '',
        editingNoteId: null,
        editingNoteExpectedUpdatedAt: null,
        isAddingNote: false,
        noteSaveStatus: 'idle',
        noteSaveMessage:
          'Staged — click "Save Preset" below to save this new preset and note to Cloud Firestore.',
      };
    });
  };

  const handleDeleteCriticalNoteInline = async (note: CriticalProductionNote) => {
    if (!editingPreset) return;

    if (editorMode === 'edit' && isPersistedPreset) {
      patchEditorState({
        noteSaveStatus: 'saving',
        noteSaveMessage: 'Deleting note from shared workspace...',
      });
      try {
        await store.deleteCriticalProductionNote(note.id, userRole, {
          presetId: editingPreset.id,
          expectedUpdatedAt: note.updatedAt || note.createdAt || undefined,
        });
        const refreshed = store.getCriticalNotesForPreset(editingPreset.id);
        patchEditorState({
          presetNotes: refreshed,
          noteSaveStatus: 'saved',
          noteSaveMessage: 'Deleted from shared workspace.',
        });
      } catch (err: unknown) {
        patchEditorState({
          noteSaveStatus: 'error',
          noteSaveMessage:
            err instanceof Error
              ? `Delete Failed: ${err.message}`
              : 'Delete Failed: Unable to remove note from Cloud Firestore.',
        });
      }
      return;
    }

    setEditorState((prev) => ({
      ...prev,
      presetNotes: prev.presetNotes.filter((n) => n.id !== note.id),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPreset || !editorMode) return;

    let submission: {
      preset: ProductionPreset;
      mode: 'create' | 'edit';
      preserveRemoteProductionEnabled: boolean;
    };
    try {
      submission = buildPresetSubmissionPayload(editorState);
    } catch (validationErr: unknown) {
      patchEditorState({
        presetSaveStatus: 'error',
        presetSaveError:
          validationErr instanceof Error
            ? `Save Failed: ${validationErr.message}`
            : 'Save Failed: Please enter a preset name.',
      });
      return;
    }

    patchEditorState({
      presetSaveStatus: 'saving',
      presetSaveError: '',
    });

    try {
      await onSavePreset(submission.preset, {
        mode: submission.mode,
        preserveRemoteProductionEnabled: submission.preserveRemoteProductionEnabled,
      });
      setEditorState(createClosedPresetEditorState());
    } catch (err: unknown) {
      patchEditorState({
        presetSaveStatus: 'error',
        presetSaveError:
          err instanceof Error
            ? err.message.startsWith('Save Failed')
              ? err.message
              : `Save Failed: ${err.message}`
            : 'Save Failed: Unable to persist preset to Cloud Firestore.',
      });
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Owner-Only Critical Production Notes Synchronization Review */}
      <CriticalNotesSyncReview
        userRole={userRole}
        presets={presets}
        recipes={availableRecipes}
      />
      {/* Viewer Notice Banner */}
      {!isEditorOrOwner && (
        <div
          id="preset-viewer-readonly-banner"
          className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl px-4 py-3 flex items-center gap-3 text-xs text-amber-900 dark:text-amber-200"
        >
          <Eye className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            <strong>Read-Only Access:</strong> You are viewing packaging presets with Viewer permissions. Editors and Owners can create, edit, or enable/disable presets on the Production Floor; only Owners can permanently delete presets.
          </span>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
              <Sliders className="w-6 h-6 text-[#D4A373]" />
              <span>Production Presets</span>
            </h2>
            <span className="bg-[#FAF7F2] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border border-[#EEECE8] dark:border-[#332F2B]">
              {presets.length} Presets
            </span>
          </div>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Organize packaging specs grouped by bakery categories: Cookies, Pie Dough, Base Dough, and Shortbread.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl p-0.5">
            <button
              type="button"
              id="preset-view-grouped-btn"
              onClick={() => setViewMode('grouped')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'grouped'
                  ? 'bg-[#5A534B] text-white shadow-xs'
                  : 'text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1]'
              }`}
              title="Group by Category"
            >
              <Layers className="w-4 h-4" />
              <span className="hidden md:inline">Grouped</span>
            </button>
            <button
              type="button"
              id="preset-view-grid-btn"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-[#5A534B] text-white shadow-xs'
                  : 'text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1]'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden md:inline">Grid</span>
            </button>
          </div>

          {isEditorOrOwner && (
            <button
              type="button"
              id="preset-add-btn"
              onClick={() => handleOpenNewPreset()}
              className="inline-flex items-center justify-center gap-2 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 py-2 rounded-xl text-sm transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Preset</span>
            </button>
          )}
        </div>
      </div>

      {/* Preset Creation Security / CSPRNG Error Banner */}
      {presetCreationSecurityError && (
        <div
          id="preset-creation-security-error-banner"
          role="alert"
          className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{presetCreationSecurityError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPresetCreationSecurityError(null)}
            className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer"
            aria-label="Dismiss preset creation error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Preset Floor Status Toggle Error Banner */}
      {toggleErrorMessage && (
        <div
          id="preset-toggle-error-banner"
          role="alert"
          className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{toggleErrorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToggleErrorMessage(null)}
            className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer"
            aria-label="Dismiss preset status error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Confirmed Preset Deletion Status Banner */}
      {deleteState.deleteStatus === 'deleted' && deleteState.deleteFeedbackMessage && (
        <div
          id="preset-delete-status-banner"
          role="status"
          className="px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 stroke-[3] shrink-0" />
            <span>{deleteState.deleteFeedbackMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setDeleteState(createInitialPresetDeleteState())}
            className="p-1 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 cursor-pointer"
            aria-label="Dismiss delete status"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Category Navigation Bar & Search */}
      <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8B7E74] dark:text-[#A39E93] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              id="preset-search-input"
              placeholder="Search presets by name, yield, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs md:text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#A39E93] hover:text-[#5A534B] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 scrollbar-thin">
          <button
            type="button"
            id="preset-cat-all"
            onClick={() => setSelectedCategory('All')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
              selectedCategory === 'All'
                ? 'bg-[#5A534B] text-white shadow-xs'
                : 'bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#D4CEC7] border border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
            }`}
          >
            <span>All Categories</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                selectedCategory === 'All'
                  ? 'bg-white/20 text-white'
                  : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] dark:text-[#A39E93]'
              }`}
            >
              {categoryCounts['All'] || 0}
            </span>
          </button>

          {allCategories.map((cat) => {
            const isSelected = selectedCategory === cat;
            const icon = CATEGORY_ICONS[cat] || '📦';
            const count = categoryCounts[cat] || 0;

            return (
              <button
                key={cat}
                type="button"
                id={`preset-cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-[#D4A373] text-white shadow-xs'
                    : 'bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#D4CEC7] border border-[#EEECE8] dark:border-[#332F2B] hover:border-[#D4A373]'
                }`}
              >
                <span>{icon}</span>
                <span>{cat}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : 'bg-white dark:bg-[#1E1B18] text-[#8B7E74] dark:text-[#A39E93]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty State */}
      {filteredPresets.length === 0 && (
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#D4A373] flex items-center justify-center mx-auto">
            <Sliders className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
            No Presets Found
          </h3>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] max-w-sm mx-auto">
            {searchQuery
              ? `No presets matched "${searchQuery}" in ${selectedCategory === 'All' ? 'any category' : selectedCategory}.`
              : `No presets currently exist in the "${selectedCategory}" category.`}
          </p>
          {isEditorOrOwner && (
            <button
              type="button"
              id="preset-empty-create-btn"
              onClick={() => handleOpenNewPreset()}
              className="inline-flex items-center gap-2 bg-[#D4A373] text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create {selectedCategory !== 'All' ? `${selectedCategory} Preset` : 'New Preset'}</span>
            </button>
          )}
        </div>
      )}

      {/* Grouped View */}
      {viewMode === 'grouped' && filteredPresets.length > 0 && (
        <div className="space-y-6">
          {(Object.entries(groupedPresets) as [string, ProductionPreset[]][]).map(([category, items]) => {
            const isCollapsed = collapsedCategories[category];
            const icon = CATEGORY_ICONS[category] || '📦';
            const desc = CATEGORY_DESCRIPTIONS[category];

            return (
              <div
                key={category}
                id={`preset-group-${category.toLowerCase().replace(/\s+/g, '-')}`}
                className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl overflow-hidden shadow-xs"
              >
                {/* Group Category Header */}
                <div
                  onClick={() => toggleCategoryCollapse(category)}
                  className="p-4 bg-[#FAF7F2] dark:bg-[#25221F] border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between cursor-pointer select-none hover:bg-[#F5EFE6] dark:hover:bg-[#2B2723] transition"
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="p-1 rounded-lg text-[#8B7E74] dark:text-[#A39E93]"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-center text-base shadow-2xs">
                      {icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                          {category}
                        </h3>
                        <span className="bg-white dark:bg-[#1E1B18] text-[#D4A373] text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border border-[#EEECE8] dark:border-[#332F2B]">
                          {items.length} {items.length === 1 ? 'Preset' : 'Presets'}
                        </span>
                      </div>
                      {desc && (
                        <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                          {desc}
                        </p>
                      )}
                    </div>
                  </div>

                  {isEditorOrOwner && (
                    <button
                      type="button"
                      id={`preset-group-add-btn-${category.toLowerCase().replace(/\s+/g, '-')}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenNewPreset(category);
                      }}
                      className="text-xs text-[#5A534B] dark:text-[#D4CEC7] hover:text-[#D4A373] font-bold inline-flex items-center gap-1 bg-white dark:bg-[#1E1B18] px-2.5 py-1 rounded-lg border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to {category}</span>
                    </button>
                  )}
                </div>

                {/* Group Body */}
                {!isCollapsed && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        preset={preset}
                        isOwner={isOwner}
                        isEditorOrOwner={isEditorOrOwner}
                        isDeleting={deleteState.deletingPresetId === preset.id}
                        isTogglingStatus={Boolean(togglingPresetIds[preset.id])}
                        onToggleProductionEnabled={() => handleToggleProductionEnabled(preset)}
                        onEdit={() => handleOpenEdit(preset)}
                        onDelete={() => handleRequestDeletePreset(preset)}
                        onFilterCategory={(cat) => setSelectedCategory(cat)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Grid View (Flat) */}
      {viewMode === 'grid' && filteredPresets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPresets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              isOwner={isOwner}
              isEditorOrOwner={isEditorOrOwner}
              isDeleting={deleteState.deletingPresetId === preset.id}
              isTogglingStatus={Boolean(togglingPresetIds[preset.id])}
              onToggleProductionEnabled={() => handleToggleProductionEnabled(preset)}
              onEdit={() => handleOpenEdit(preset)}
              onDelete={() => handleRequestDeletePreset(preset)}
              onFilterCategory={(cat) => setSelectedCategory(cat)}
            />
          ))}
        </div>
      )}

      {/* Accessible In-App Preset Delete Confirmation Modal */}
      {deleteState.presetPendingDelete && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            id="preset-delete-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="preset-delete-modal-title"
            aria-describedby="preset-delete-modal-desc"
            className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between bg-[#FAF7F2] dark:bg-[#25221F]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400">
                  <Trash2 className="w-4 h-4" />
                </div>
                <h3
                  id="preset-delete-modal-title"
                  className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]"
                >
                  Delete Packaging Preset
                </h3>
              </div>
              <button
                type="button"
                disabled={deleteState.deleteStatus === 'deleting'}
                onClick={handleCancelDeletePreset}
                className="p-1.5 text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] rounded-lg cursor-pointer transition disabled:opacity-50"
                aria-label="Close delete confirmation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p
                id="preset-delete-modal-desc"
                className="text-xs sm:text-sm text-[#5A534B] dark:text-[#EAE6E1] leading-relaxed"
              >
                Are you sure you want to permanently delete the preset{' '}
                <span className="font-bold text-[#2D2926] dark:text-white">
                  &ldquo;{deleteState.presetPendingDelete.name}&rdquo;
                </span>{' '}
                from this shared workspace?
              </p>

              <div className="p-3 rounded-xl bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-xs text-[#8B7E74] dark:text-[#A39E93] space-y-1">
                <div>
                  <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">Category:</span>{' '}
                  {deleteState.presetPendingDelete.category || 'Cookies'}
                </div>
                <div>
                  <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">Packaging:</span>{' '}
                  {deleteState.presetPendingDelete.quantityPerUnit} pieces per{' '}
                  {deleteState.presetPendingDelete.unitName} ({deleteState.presetPendingDelete.finishedWeight}{' '}
                  {deleteState.presetPendingDelete.weightUnit})
                </div>
              </div>

              {deleteState.deleteStatus === 'error' && deleteState.deleteFeedbackMessage && (
                <div
                  id="preset-delete-error-banner"
                  role="alert"
                  className="px-3.5 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{deleteState.deleteFeedbackMessage}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  id="preset-delete-cancel-btn"
                  disabled={deleteState.deleteStatus === 'deleting'}
                  onClick={handleCancelDeletePreset}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="preset-delete-confirm-btn"
                  disabled={deleteState.deleteStatus === 'deleting'}
                  onClick={handleConfirmDeletePreset}
                  className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {deleteState.deleteStatus === 'deleting' && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>
                    {deleteState.deleteStatus === 'deleting' ? 'Deleting...' : 'Delete Preset'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Preset Modal */}
      {editingPreset && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between bg-[#FAF7F2] dark:bg-[#25221F]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-center text-[#D4A373]">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                    {editorMode === 'create'
                      ? 'Create Production Preset'
                      : 'Edit Production Preset'}
                  </h3>
                  <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                    Configure batch scaling specifications and packaging group.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={presetSaveStatus === 'saving' || noteSaveStatus === 'saving'}
                onClick={handleCloseEditorModal}
                className="p-1.5 text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] rounded-lg cursor-pointer transition disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              {/* Category Selector */}
              <div>
                <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] mb-1.5">
                  Category Group *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  {DEFAULT_PRESET_CATEGORIES.map((cat) => {
                    const isSelected = !isCustomCategory && editingPreset.category === cat;
                    const icon = CATEGORY_ICONS[cat];
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          patchEditorState({
                            isCustomCategory: false,
                            editingPreset: { ...editingPreset, category: cat },
                          });
                        }}
                        className={`p-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-1 cursor-pointer ${
                          isSelected
                            ? 'bg-[#FAF7F2] dark:bg-[#25221F] border-[#D4A373] text-[#5A534B] dark:text-[#EAE6E1] shadow-2xs'
                            : 'bg-white dark:bg-[#1E1B18] border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] hover:border-[#D4A373]'
                        }`}
                      >
                        <span className="text-base">{icon}</span>
                        <span>{cat}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      patchEditorState({
                        isCustomCategory: !isCustomCategory,
                        ...(!isCustomCategory && !customCategoryInput
                          ? { customCategoryInput: '' }
                          : {}),
                      });
                    }}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer flex items-center gap-1.5 ${
                      isCustomCategory
                        ? 'bg-[#D4A373] text-white border-[#D4A373]'
                        : 'bg-[#FAF7F2] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] hover:text-[#5A534B]'
                    }`}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>+ Custom Category</span>
                  </button>

                  {isCustomCategory && (
                    <input
                      type="text"
                      required
                      placeholder="e.g., Tart Dough, Brioche, Viennoiserie"
                      value={customCategoryInput}
                      onChange={(e) => patchEditorState({ customCategoryInput: e.target.value })}
                      className="flex-1 px-3 py-1.5 text-xs bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                    />
                  )}
                </div>
              </div>

              {/* Preset Name */}
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Preset Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., 4 oz Jumbo Cookie Case"
                  value={editingPreset.name}
                  onChange={(e) =>
                    patchEditorState({ editingPreset: { ...editingPreset, name: e.target.value } })
                  }
                  className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Finished Item Weight *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    value={editingPreset.finishedWeight}
                    onChange={(e) =>
                      patchEditorState({
                        editingPreset: {
                          ...editingPreset,
                          finishedWeight: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Weight Unit *
                  </label>
                  <select
                    value={editingPreset.weightUnit}
                    onChange={(e) =>
                      patchEditorState({
                        editingPreset: {
                          ...editingPreset,
                          weightUnit: e.target.value as WeightUnit,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer"
                  >
                    {WEIGHT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Pieces per Unit / Packaging *
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={editingPreset.quantityPerUnit}
                    onChange={(e) =>
                      patchEditorState({
                        editingPreset: {
                          ...editingPreset,
                          quantityPerUnit: parseInt(e.target.value, 10) || 1,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Packaging Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., case, tray, box, rack, tub"
                    value={editingPreset.unitName}
                    onChange={(e) =>
                      patchEditorState({
                        editingPreset: { ...editingPreset, unitName: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Optional Target Yield Description
                </label>
                <input
                  type="text"
                  placeholder="e.g., 80 cookies @ 4 oz each"
                  value={editingPreset.expectedYield || ''}
                  onChange={(e) =>
                    patchEditorState({
                      editingPreset: { ...editingPreset, expectedYield: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 text-sm bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              {/* Production Floor Availability Switch */}
              <div className="p-3.5 rounded-xl bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                    Available on Production Floor
                  </div>
                  <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
                    {isPresetEnabledForProduction(editingPreset)
                      ? 'Enabled — operators can select this preset on the Production Floor.'
                      : 'Disabled — hidden from Production Floor only. Remains usable in Management.'}
                  </p>
                </div>
                <button
                  type="button"
                  id="preset-modal-floor-enabled-toggle"
                  role="switch"
                  aria-checked={isPresetEnabledForProduction(editingPreset)}
                  aria-label="Toggle Production Floor availability"
                  disabled={!isEditorOrOwner || presetSaveStatus === 'saving'}
                  onClick={() => {
                    const nextEnabled = !isPresetEnabledForProduction(editingPreset);
                    patchEditorState({
                      editingPreset: { ...editingPreset, productionEnabled: nextEnabled },
                      productionEnabledTouched: true,
                    });
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                    isPresetEnabledForProduction(editingPreset)
                      ? 'bg-emerald-600'
                      : 'bg-stone-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isPresetEnabledForProduction(editingPreset)
                        ? 'translate-x-6'
                        : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* CRITICAL PRODUCTION NOTES Section (Canonical Cloud Firestore: presets/{presetId}.criticalNotes) */}
              <div
                id="section-preset-critical-notes"
                className="pt-4 border-t border-[#EEECE8] dark:border-[#332F2B] space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                      CRITICAL PRODUCTION NOTES (PRESET + RECIPE SPECIFIC)
                    </label>
                    <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                      Shared across all workspace devices via Cloud Firestore when this packaging preset and recipe are selected together.
                    </p>
                  </div>

                  {isEditorOrOwner && !isAddingNote && (
                    <button
                      type="button"
                      id="btn-add-critical-note"
                      disabled={noteSaveStatus === 'saving'}
                      onClick={() => {
                        const defaultRecipe =
                          categoryMatchingRecipes.length > 0
                            ? categoryMatchingRecipes[0].id
                            : activeNonArchivedRecipes.length > 0
                            ? activeNonArchivedRecipes[0].id
                            : '';
                        patchEditorState({
                          isAddingNote: true,
                          editingNoteId: null,
                          editingNoteExpectedUpdatedAt: null,
                          selectedRecipeForNote: defaultRecipe,
                          newNoteText: '',
                          noteSaveStatus: 'idle',
                          noteSaveMessage: '',
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60 disabled:opacity-50 transition cursor-pointer self-start sm:self-auto shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                      <span>+ Add Critical Production Note</span>
                    </button>
                  )}
                </div>

                {/* Cloud Persistence Status Banner (Saving / Saved / Save Failed) */}
                {(noteSaveStatus !== 'idle' || noteSaveMessage) && (
                  <div
                    id="preset-critical-note-save-status"
                    className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                      noteSaveStatus === 'saving'
                        ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                        : noteSaveStatus === 'saved'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : noteSaveStatus === 'error'
                        ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                        : 'bg-[#FAF8F5] dark:bg-[#25221F] border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
                    }`}
                  >
                    {noteSaveStatus === 'saving' && <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />}
                    {noteSaveStatus === 'saved' && <Check className="w-3.5 h-3.5 stroke-[3] shrink-0" />}
                    {noteSaveStatus === 'error' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                    <span>{noteSaveMessage}</span>
                  </div>
                )}

                {/* Inline Note Addition / Edit Form */}
                {isAddingNote && (
                  <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/50 dark:bg-amber-950/30 space-y-3 animate-in fade-in-50 duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        {editingNoteId ? 'Edit Critical Production Note' : 'New Critical Note'} for Preset:{' '}
                        {editingPreset.name || 'Current Preset'}
                      </span>
                      <button
                        type="button"
                        disabled={noteSaveStatus === 'saving'}
                        onClick={() => {
                          patchEditorState({
                            isAddingNote: false,
                            editingNoteId: null,
                            editingNoteExpectedUpdatedAt: null,
                          });
                        }}
                        className="text-stone-400 hover:text-stone-600 dark:hover:text-zinc-200 text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                        Applicable Recipe / Flavor *
                      </label>
                      <select
                        id="select-critical-note-recipe"
                        disabled={Boolean(editingNoteId) || noteSaveStatus === 'saving'}
                        value={selectedRecipeForNote}
                        onChange={(e) => patchEditorState({ selectedRecipeForNote: e.target.value })}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] cursor-pointer disabled:opacity-70"
                      >
                        <optgroup label={`Mapped to ${currentCategoryForPreset}`}>
                          {categoryMatchingRecipes.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} {r.category ? `(${r.category})` : ''}
                            </option>
                          ))}
                        </optgroup>
                        {otherActiveRecipes.length > 0 && (
                          <optgroup label="Other Active Workspace Recipes">
                            {otherActiveRecipes.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} {r.category ? `(${r.category})` : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                        Critical Note Content *
                      </label>
                      <textarea
                        id="input-critical-note-text"
                        rows={2}
                        disabled={noteSaveStatus === 'saving'}
                        placeholder="e.g. Use 4000-count chocolate chips for the 2.5 oz cookies."
                        value={newNoteText}
                        onChange={(e) => patchEditorState({ newNoteText: e.target.value })}
                        className="w-full px-3 py-2 text-xs bg-white dark:bg-[#1E1B18] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-70"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={noteSaveStatus === 'saving'}
                        onClick={() => {
                          patchEditorState({
                            isAddingNote: false,
                            editingNoteId: null,
                            editingNoteExpectedUpdatedAt: null,
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        id="btn-save-critical-note-inline"
                        disabled={noteSaveStatus === 'saving'}
                        onClick={handleSaveCriticalNoteInline}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                      >
                        {noteSaveStatus === 'saving' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>
                          {noteSaveStatus === 'saving'
                            ? 'Saving...'
                            : isPersistedPreset
                            ? 'Save Note to Shared Workspace'
                            : 'Stage Note on New Preset'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* List of active critical notes on this preset */}
                <div id="preset-critical-notes-list" className="space-y-2">
                  {presetNotes.length === 0 ? (
                    <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] italic py-1">
                      No preset-specific critical production notes assigned to this preset yet.
                    </p>
                  ) : (
                    presetNotes.map((note) => {
                      const matchedRecipe = availableRecipes.find((r) => r.id === note.recipeId);
                      const recipeName = matchedRecipe ? matchedRecipe.name : note.recipeId;

                      return (
                        <div
                          key={note.id}
                          id={`critical-note-row-${note.id}`}
                          className="flex items-start justify-between gap-3 p-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-[#FAF8F5] dark:bg-[#25221F]"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800/80">
                                {recipeName}
                              </span>
                              <span className="text-[10px] text-stone-400 dark:text-zinc-500 font-mono">
                                Preset-Specific Critical Note
                              </span>
                            </div>
                            <p className="text-xs text-stone-800 dark:text-zinc-200 font-medium whitespace-pre-wrap break-words">
                              {note.note}
                            </p>
                          </div>

                          {isEditorOrOwner && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                id={`btn-edit-critical-note-${note.id}`}
                                disabled={noteSaveStatus === 'saving'}
                                onClick={() => handleStartEditNote(note)}
                                title="Edit Critical Production Note"
                                className="p-1 text-stone-500 hover:text-[#5A534B] dark:hover:text-zinc-200 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                id={`btn-delete-critical-note-${note.id}`}
                                disabled={noteSaveStatus === 'saving'}
                                onClick={() => handleDeleteCriticalNoteInline(note)}
                                title="Delete Critical Production Note"
                                className="p-1 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {presetSaveStatus === 'error' && presetSaveError && (
                <div
                  id="preset-modal-save-error"
                  className="px-3.5 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{presetSaveError}</span>
                </div>
              )}

              <div className="pt-4 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-end gap-3">
                <button
                  type="button"
                  id="preset-modal-cancel-btn"
                  disabled={presetSaveStatus === 'saving' || noteSaveStatus === 'saving'}
                  onClick={handleCloseEditorModal}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="preset-modal-save-btn"
                  disabled={presetSaveStatus === 'saving' || noteSaveStatus === 'saving'}
                  className="px-5 py-2 text-xs font-bold text-white bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#D4A373] dark:hover:bg-[#C49363] rounded-xl shadow-sm cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {presetSaveStatus === 'saving' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{presetSaveStatus === 'saving' ? 'Saving...' : 'Save Preset'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface PresetCardProps {
  preset: ProductionPreset;
  isOwner: boolean;
  isEditorOrOwner: boolean;
  isDeleting?: boolean;
  isTogglingStatus?: boolean;
  onToggleProductionEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFilterCategory: (cat: string) => void;
}

const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  isOwner,
  isEditorOrOwner,
  isDeleting = false,
  isTogglingStatus = false,
  onToggleProductionEnabled,
  onEdit,
  onDelete,
  onFilterCategory,
}) => {
  const category = normalizePresetCategory(preset);
  const icon = CATEGORY_ICONS[category] || '📦';
  const isEnabled = isPresetEnabledForProduction(preset);

  return (
    <div
      id={`preset-card-${preset.id}`}
      className={`bg-white dark:bg-[#1E1B18] border rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between ${
        isEnabled
          ? 'border-[#E5E1DA] dark:border-[#2D2925]'
          : 'border-dashed border-stone-300 dark:border-zinc-700 bg-stone-50/60 dark:bg-zinc-900/60'
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={() => onFilterCategory(category)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-xs font-bold text-[#5A534B] dark:text-[#D4CEC7] hover:border-[#D4A373] transition cursor-pointer"
            title={`Filter by ${category}`}
          >
            <span>{icon}</span>
            <span>{category}</span>
          </button>

          <span className="text-xs font-bold text-[#D4A373] bg-[#FAF7F2] dark:bg-[#25221F] px-2.5 py-1 rounded-full border border-[#EEECE8] dark:border-[#332F2B] font-mono tabular-nums">
            {preset.finishedWeight} {preset.weightUnit.toUpperCase()} / item
          </span>
        </div>

        <h3 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1] mb-1">
          {preset.name}
        </h3>
        <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mb-3 tabular-nums">
          <span className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
            {preset.quantityPerUnit} pieces
          </span>{' '}
          per {preset.unitName}
        </p>

        {preset.expectedYield && (
          <div className="text-[11px] text-[#5A534B] dark:text-[#D4CEC7] bg-[#FAF7F2] dark:bg-[#25221F] p-2.5 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] mb-3">
            <span className="font-bold text-[#8B7E74]">Target Yield: </span>
            {preset.expectedYield}
          </div>
        )}

        {Array.isArray(preset.criticalNotes) &&
          preset.criticalNotes.filter((n) => n && typeof n.note === 'string' && n.note.trim()).length > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/70 text-[11px] font-bold text-amber-900 dark:text-amber-200 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
              <span>
                {preset.criticalNotes.filter((n) => n && typeof n.note === 'string' && n.note.trim()).length}{' '}
                Critical Note
                {preset.criticalNotes.filter((n) => n && typeof n.note === 'string' && n.note.trim()).length === 1
                  ? ''
                  : 's'}
              </span>
            </div>
          )}

        {/* Shared Production Floor Availability Control / Read-Only Status */}
        <div
          id={`preset-floor-availability-row-${preset.id}`}
          className="mb-3 px-3 py-2 rounded-xl bg-[#FAF7F2] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between gap-2"
        >
          <span
            id={`preset-floor-status-${preset.id}`}
            className={`text-[11px] font-bold ${
              isEnabled
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-stone-600 dark:text-zinc-400'
            }`}
          >
            {isEnabled ? 'Available on Floor' : 'Hidden on Floor'}
          </span>

          {isEditorOrOwner ? (
            <button
              type="button"
              id={`preset-floor-toggle-${preset.id}`}
              role="switch"
              aria-checked={isEnabled}
              aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${preset.name} on Production Floor`}
              disabled={isTogglingStatus || isDeleting}
              onClick={onToggleProductionEnabled}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                isEnabled ? 'bg-emerald-600' : 'bg-stone-300 dark:bg-zinc-700'
              }`}
              title={
                isEnabled
                  ? 'Available on Production Floor — click to hide from Production Floor'
                  : 'Hidden from Production Floor — click to re-enable on Production Floor'
              }
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  isEnabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          ) : (
            <span className="text-[10px] font-medium text-[#8B7E74] dark:text-[#A39E93]">
              {isEnabled ? 'Enabled' : 'Disabled'}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[#EEECE8] dark:border-[#332F2B] text-xs">
        <span className="text-[10px] text-[#A39E93] font-mono uppercase">
          Pack: {preset.unitName}
        </span>

        {isEditorOrOwner && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              id={`preset-edit-btn-${preset.id}`}
              disabled={isDeleting || isTogglingStatus}
              onClick={onEdit}
              className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer disabled:opacity-50"
              title="Edit preset"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            {isOwner && (
              <button
                type="button"
                id={`preset-delete-btn-${preset.id}`}
                disabled={isDeleting || isTogglingStatus}
                onClick={onDelete}
                className="p-1.5 text-[#C97B63] hover:text-red-700 hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer disabled:opacity-50"
                title={`Delete preset ${preset.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
