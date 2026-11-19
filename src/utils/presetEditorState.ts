import {
  CriticalProductionNote,
  DEFAULT_PRESET_CATEGORIES,
  ProductionPreset,
} from '../types';
import {
  CryptoProviderLike,
  generateCollisionResistantPresetId,
} from './productionNotes';
import { isPresetEnabledForProduction } from './productionOptionOrdering';

export type PresetEditorMode = 'create' | 'edit' | null;

export interface PresetEditorModalState {
  editorMode: PresetEditorMode;
  editingPreset: ProductionPreset | null;
  isCustomCategory: boolean;
  customCategoryInput: string;
  presetNotes: CriticalProductionNote[];
  isAddingNote: boolean;
  editingNoteId: string | null;
  editingNoteExpectedUpdatedAt: string | null;
  selectedRecipeForNote: string;
  newNoteText: string;
  noteSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  noteSaveMessage: string;
  presetSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  presetSaveError: string;
  productionEnabledTouched?: boolean;
}

export interface PresetDeleteModalState {
  presetPendingDelete: ProductionPreset | null;
  deletingPresetId: string | null;
  deleteStatus: 'idle' | 'deleting' | 'deleted' | 'error';
  deleteFeedbackMessage: string;
}

export function createClosedPresetEditorState(): PresetEditorModalState {
  return {
    editorMode: null,
    editingPreset: null,
    isCustomCategory: false,
    customCategoryInput: '',
    presetNotes: [],
    isAddingNote: false,
    editingNoteId: null,
    editingNoteExpectedUpdatedAt: null,
    selectedRecipeForNote: '',
    newNoteText: '',
    noteSaveStatus: 'idle',
    noteSaveMessage: '',
    presetSaveStatus: 'idle',
    presetSaveError: '',
    productionEnabledTouched: false,
  };
}

export function createNewPresetEditorState(params: {
  selectedCategory: string;
  allCategories: string[];
  existingPresetIds: Iterable<string>;
  categoryOverride?: string;
  cryptoOverride?: CryptoProviderLike | null;
}): PresetEditorModalState {
  const newId = generateCollisionResistantPresetId(
    params.existingPresetIds,
    params.cryptoOverride
  );

  const rawCategory =
    params.categoryOverride && params.categoryOverride.trim()
      ? params.categoryOverride.trim()
      : params.selectedCategory && params.selectedCategory !== 'All'
      ? params.selectedCategory.trim()
      : 'Cookies';

  const isStandardCategory = (DEFAULT_PRESET_CATEGORIES as readonly string[]).includes(
    rawCategory
  );

  return {
    editorMode: 'create',
    editingPreset: {
      id: newId,
      userId: '',
      name: '',
      category: rawCategory,
      finishedWeight: 1,
      weightUnit: 'oz',
      quantityPerUnit: 80,
      unitName: 'case',
      expectedYield: '',
      productionEnabled: true,
      criticalNotes: [],
      createdAt: '',
      updatedAt: '',
    },
    isCustomCategory: !isStandardCategory,
    customCategoryInput: isStandardCategory ? '' : rawCategory,
    presetNotes: [],
    isAddingNote: false,
    editingNoteId: null,
    editingNoteExpectedUpdatedAt: null,
    selectedRecipeForNote: '',
    newNoteText: '',
    noteSaveStatus: 'idle',
    noteSaveMessage: '',
    presetSaveStatus: 'idle',
    presetSaveError: '',
    productionEnabledTouched: false,
  };
}

export function createEditPresetEditorState(
  preset: ProductionPreset,
  loadedNotes: CriticalProductionNote[] = []
): PresetEditorModalState {
  const resolvedCategory =
    preset.category && preset.category.trim() ? preset.category.trim() : 'Cookies';
  const isStandardCategory = (DEFAULT_PRESET_CATEGORIES as readonly string[]).includes(
    resolvedCategory
  );
  const enabled = isPresetEnabledForProduction(preset);

  const sanitizedNotes = Array.isArray(loadedNotes)
    ? loadedNotes
        .filter((n) => n && (!n.presetId || n.presetId === preset.id))
        .map((n) => ({ ...n, presetId: preset.id }))
    : [];

  return {
    editorMode: 'edit',
    editingPreset: {
      ...preset,
      category: resolvedCategory,
      productionEnabled: enabled,
    },
    isCustomCategory: !isStandardCategory,
    customCategoryInput: isStandardCategory ? '' : resolvedCategory,
    presetNotes: sanitizedNotes,
    isAddingNote: false,
    editingNoteId: null,
    editingNoteExpectedUpdatedAt: null,
    selectedRecipeForNote: '',
    newNoteText: '',
    noteSaveStatus: 'idle',
    noteSaveMessage: '',
    presetSaveStatus: 'idle',
    presetSaveError: '',
    productionEnabledTouched: false,
  };
}

export function buildPresetSubmissionPayload(state: PresetEditorModalState): {
  preset: ProductionPreset;
  mode: 'create' | 'edit';
  preserveRemoteProductionEnabled: boolean;
} {
  if (!state.editingPreset || !state.editorMode) {
    throw new Error('No active preset editor session.');
  }

  const trimmedName = (state.editingPreset.name || '').trim();
  if (!trimmedName) {
    throw new Error('Please enter a preset name.');
  }

  const finishedWeight = Number(state.editingPreset.finishedWeight);
  if (!Number.isFinite(finishedWeight) || finishedWeight <= 0) {
    throw new Error('Finished item weight must be greater than 0.');
  }

  const quantityPerUnit = Math.round(Number(state.editingPreset.quantityPerUnit));
  if (!Number.isFinite(quantityPerUnit) || quantityPerUnit < 1) {
    throw new Error('Pieces per unit must be at least 1.');
  }

  const trimmedUnitName = (state.editingPreset.unitName || '').trim();
  if (!trimmedUnitName) {
    throw new Error('Please enter a packaging unit name.');
  }

  const resolvedCategory = state.isCustomCategory
    ? state.customCategoryInput.trim() || 'Other'
    : (state.editingPreset.category || '').trim() || 'Cookies';

  const targetPresetId = (state.editingPreset.id || '').trim();
  if (!targetPresetId) {
    throw new Error('Preset ID is missing.');
  }

  const nowIso = new Date().toISOString();
  const normalizedNotes: CriticalProductionNote[] = [];

  for (const note of state.presetNotes) {
    if (!note || typeof note.note !== 'string' || !note.note.trim()) continue;
    if (note.presetId && note.presetId !== targetPresetId) {
      throw new Error(
        `Stale Critical Production Note detected from preset "${note.presetId}" while saving "${targetPresetId}".`
      );
    }
    normalizedNotes.push({
      ...note,
      presetId: targetPresetId,
      note: note.note.trim(),
      createdAt: note.createdAt || nowIso,
      updatedAt: note.updatedAt || nowIso,
    });
  }

  const presetPayload: ProductionPreset = {
    ...state.editingPreset,
    id: targetPresetId,
    name: trimmedName,
    category: resolvedCategory,
    finishedWeight,
    quantityPerUnit,
    unitName: trimmedUnitName,
    expectedYield: state.editingPreset.expectedYield?.trim() || '',
    productionEnabled: state.editingPreset.productionEnabled !== false,
    criticalNotes: normalizedNotes,
    createdAt:
      state.editorMode === 'edit' && state.editingPreset.createdAt
        ? state.editingPreset.createdAt
        : nowIso,
    updatedAt: nowIso,
  };

  return {
    preset: presetPayload,
    mode: state.editorMode,
    preserveRemoteProductionEnabled:
      state.editorMode === 'edit' && !state.productionEnabledTouched,
  };
}

export function createInitialPresetDeleteState(): PresetDeleteModalState {
  return {
    presetPendingDelete: null,
    deletingPresetId: null,
    deleteStatus: 'idle',
    deleteFeedbackMessage: '',
  };
}

export function openPresetDeleteConfirmationState(
  prev: PresetDeleteModalState,
  preset: ProductionPreset
): PresetDeleteModalState {
  if (prev.deleteStatus === 'deleting' || prev.deletingPresetId) {
    return prev;
  }
  return {
    presetPendingDelete: preset,
    deletingPresetId: null,
    deleteStatus: 'idle',
    deleteFeedbackMessage: '',
  };
}
