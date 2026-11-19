import React, { useState, useMemo } from 'react';
import {
  X,
  Check,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Search,
  Plus,
  Scale,
  ChefHat,
  FileText,
  Lock,
  Sparkles,
  Layers,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  ProductProject,
  QuoteRevision,
  QuoteFormula,
  QuoteFormulaLine,
  FormulaOwnership,
} from '../../types/quoting';
import {
  Recipe,
  MasterIngredient,
  ProductionPreset,
  Workspace,
  AccessRole,
} from '../../types';
import { isVolumeUnit } from '../../utils/units';
import { store } from '../../services/store';
import {
  promotionService,
  PromotionStagedIngredient,
  PromotionPayload,
  checkDuplicatePromotion,
} from '../../services/promotionService';
import { generateFormulaFingerprint } from '../../utils/formulaFingerprint';

interface PromotionWizardModalProps {
  project: ProductProject;
  workspaceId: string;
  userRole?: AccessRole;
  currentUserId: string;
  currentUserName?: string;
  masterIngredients: MasterIngredient[];
  presets: ProductionPreset[];
  existingRecipes: Recipe[];
  onClose: () => void;
  onSuccess: (newRecipe: Recipe) => void;
}

export const PromotionWizardModal: React.FC<PromotionWizardModalProps> = ({
  project,
  workspaceId,
  userRole,
  currentUserId,
  currentUserName,
  masterIngredients,
  presets,
  existingRecipes,
  onClose,
  onSuccess,
}) => {
  // Wizard step: 1 (Source) -> 2 (Identity) -> 3 (Resolution) -> 4 (Setup) -> 5 (Review) -> 6 (Success)
  const [step, setStep] = useState<number>(1);

  // STEP 1: Source Selection
  // 'working_formula' or quote revision ID
  const [selectedSourceType, setSelectedSourceType] = useState<'working_formula' | 'quote_revision'>('working_formula');
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>(
    project.revisions && project.revisions.length > 0 ? project.revisions[0].id : ''
  );

  // Selected formula snapshot based on source
  const selectedSourceRevision: QuoteRevision | undefined = useMemo(() => {
    if (selectedSourceType === 'quote_revision' && project.revisions) {
      return project.revisions.find((r) => r.id === selectedRevisionId);
    }
    return undefined;
  }, [selectedSourceType, selectedRevisionId, project.revisions]);

  const activeSourceFormula: QuoteFormula = useMemo(() => {
    if (selectedSourceType === 'quote_revision' && selectedSourceRevision) {
      return selectedSourceRevision.formulaSnapshot;
    }
    return project.formula;
  }, [selectedSourceType, selectedSourceRevision, project.formula]);

  // STEP 2: Recipe Identity
  const [recipeName, setRecipeName] = useState<string>(project.productName || 'New Production Recipe');
  const [recipeCategory, setRecipeCategory] = useState<string>(project.productCategory || 'Cookies');
  const [recipeDescription, setRecipeDescription] = useState<string>(project.description || '');

  // Workspace recipe categories
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    cats.add('Cookies');
    cats.add('Pie Dough');
    cats.add('Base Dough');
    cats.add('Shortbread');
    existingRecipes.forEach((r) => {
      if (r.category) cats.add(r.category);
    });
    if (project.productCategory) cats.add(project.productCategory);
    return Array.from(cats);
  }, [existingRecipes, project.productCategory]);

  // STEP 3: Ingredient Resolution
  // Map of formula line ID -> PromotionStagedIngredient
  const [stagedIngredients, setStagedIngredients] = useState<PromotionStagedIngredient[]>(() => {
    const lines = activeSourceFormula.lines || [];
    const masterMap = new Map(masterIngredients.map((m) => [m.id, m]));

    return lines.map((line) => {
      const master = line.masterIngredientId ? masterMap.get(line.masterIngredientId) : undefined;
      return {
        id: line.id,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        masterIngredientId: master ? master.id : '',
        masterIngredientName: master ? master.name : undefined,
        pieceWeightGrams: master?.pieceWeightGrams,
        densityGramsPerMl: line.densityGramsPerMl ?? master?.densityGramsPerMl,
        notes: line.notes,
      };
    });
  });

  // Whenever active source formula changes, re-initialize staged ingredients
  React.useEffect(() => {
    const lines = activeSourceFormula.lines || [];
    const masterMap = new Map(masterIngredients.map((m) => [m.id, m]));

    setStagedIngredients(
      lines.map((line) => {
        const master = line.masterIngredientId ? masterMap.get(line.masterIngredientId) : undefined;
        return {
          id: line.id,
          name: line.name,
          quantity: line.quantity,
          unit: line.unit,
          masterIngredientId: master ? master.id : '',
          masterIngredientName: master ? master.name : undefined,
          pieceWeightGrams: master?.pieceWeightGrams,
          densityGramsPerMl: line.densityGramsPerMl ?? master?.densityGramsPerMl,
          notes: line.notes,
        };
      })
    );
  }, [activeSourceFormula, masterIngredients]);

  // Sub-modal state for linking existing Master Ingredient
  const [linkingLineId, setLinkingLineId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sub-modal state for creating new Master Ingredient
  const [isCreatingMaster, setIsCreatingMaster] = useState<boolean>(false);
  const [creatingForLineId, setCreatingForLineId] = useState<string | null>(null);
  const [newMasterName, setNewMasterName] = useState<string>('');
  const [newMasterCategory, setNewMasterCategory] = useState<string>('Pantry');
  const [newMasterUnit, setNewMasterUnit] = useState<string>('g');
  const [newMasterPackSize, setNewMasterPackSize] = useState<number>(1000);
  const [newMasterPackCost, setNewMasterPackCost] = useState<number>(5.0);
  const [newMasterSupplier, setNewMasterSupplier] = useState<string>('');
  const [newMasterDensity, setNewMasterDensity] = useState<string>('');
  const [newMasterPieceWeight, setNewMasterPieceWeight] = useState<string>('');
  const [masterCreationError, setMasterCreationError] = useState<string | null>(null);

  // STEP 4: Production Setup
  const [batchYieldQuantity, setBatchYieldQuantity] = useState<number>(100);
  const [batchYieldUnit, setBatchYieldUnit] = useState<string>('Cookies');
  const [defaultWastePercent, setDefaultWastePercent] = useState<number>(0);
  const [mixingInstructions, setMixingInstructions] = useState<string>('');
  const [generalNotes, setGeneralNotes] = useState<string>('');
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [stagedCriticalNotes, setStagedCriticalNotes] = useState<{ presetId: string; note: string }[]>([]);
  const [newNotePresetId, setNewNotePresetId] = useState<string>('');
  const [newNoteText, setNewNoteText] = useState<string>('');

  // STEP 5: Review & Confirmation
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [forceDuplicateOverride, setForceDuplicateOverride] = useState<boolean>(false);
  const [createdRecipe, setCreatedRecipe] = useState<Recipe | null>(null);

  // Applicable Presets in current category
  const categoryPresets = useMemo(() => {
    return presets.filter(
      (p) => !p.category || p.category.toLowerCase() === recipeCategory.toLowerCase()
    );
  }, [presets, recipeCategory]);

  // Duplicate promotion check
  const fingerprint = useMemo(() => {
    return generateFormulaFingerprint(stagedIngredients);
  }, [stagedIngredients]);

  const duplicateCheck = useMemo(() => {
    return checkDuplicatePromotion(project, recipeName, fingerprint, existingRecipes);
  }, [project, recipeName, fingerprint, existingRecipes]);

  // Filtered Master Ingredients for linking search
  const filteredMasterIngredients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return masterIngredients.slice(0, 15);
    return masterIngredients
      .filter((m) => m.name.toLowerCase().includes(q) || (m.category && m.category.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [masterIngredients, searchQuery]);

  // Check if any ingredient in Step 3 is unresolved
  const unresolvedIngredients = useMemo(() => {
    return stagedIngredients.filter((i) => !i.masterIngredientId);
  }, [stagedIngredients]);

  // Handle linking line to existing Master Ingredient
  const handleLinkMasterIngredient = (lineId: string, master: MasterIngredient) => {
    setStagedIngredients((prev) =>
      prev.map((item) =>
        item.id === lineId
          ? {
              ...item,
              masterIngredientId: master.id,
              masterIngredientName: master.name,
              pieceWeightGrams: master.pieceWeightGrams,
              densityGramsPerMl: item.densityGramsPerMl ?? master.densityGramsPerMl,
            }
          : item
      )
    );
    setLinkingLineId(null);
    setSearchQuery('');
  };

  // Open Create Master Ingredient form pre-filled from quote line
  const handleOpenCreateMaster = (line: PromotionStagedIngredient) => {
    setCreatingForLineId(line.id);
    setNewMasterName(line.name);
    setNewMasterCategory('Pantry');
    setNewMasterUnit(line.unit || 'g');
    setNewMasterPackSize(1000);
    setNewMasterPackCost(5.0);
    setNewMasterSupplier('');
    setNewMasterDensity(line.densityGramsPerMl ? String(line.densityGramsPerMl) : '');
    setNewMasterPieceWeight(line.pieceWeightGrams ? String(line.pieceWeightGrams) : '');
    setMasterCreationError(null);
    setIsCreatingMaster(true);
  };

  // Save new Master Ingredient intentionally and link it to staged line
  const handleSaveNewMasterIngredient = async () => {
    if (!newMasterName.trim()) {
      setMasterCreationError('Ingredient name is required.');
      return;
    }
    if (newMasterPackCost < 0 || newMasterPackSize <= 0) {
      setMasterCreationError('Package size and cost must be positive numbers.');
      return;
    }

    try {
      const densityNum = newMasterDensity ? parseFloat(newMasterDensity) : undefined;
      const pieceWeightNum = newMasterPieceWeight ? parseFloat(newMasterPieceWeight) : undefined;

      const newMaster: MasterIngredient = {
        id: `mi-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: newMasterName.trim(),
        category: newMasterCategory.trim() || 'Pantry',
        defaultUnit: newMasterUnit.trim() || 'g',
        supplier: newMasterSupplier.trim() || undefined,
        densityGramsPerMl: !isNaN(densityNum as number) && densityNum ? densityNum : undefined,
        pieceWeightGrams: !isNaN(pieceWeightNum as number) && pieceWeightNum ? pieceWeightNum : undefined,
        preferredPurchasePackage: {
          packQuantity: 1,
          unitSize: newMasterPackSize,
          unitMeasure: newMasterUnit.trim() || 'g',
          packagePriceCents: Math.round(newMasterPackCost * 100),
          packageType: 'Standard Pack',
        },
      };

      const saved = await store.saveMasterIngredient(newMaster);

      // Link to currently targeted line
      if (creatingForLineId) {
        handleLinkMasterIngredient(creatingForLineId, saved);
      }

      setIsCreatingMaster(false);
      setCreatingForLineId(null);
    } catch (err: any) {
      setMasterCreationError(err.message || 'Failed to create Master Ingredient.');
    }
  };

  // Handle adding critical note
  const handleAddCriticalNote = () => {
    if (!newNotePresetId || !newNoteText.trim()) return;
    setStagedCriticalNotes((prev) => [
      ...prev,
      { presetId: newNotePresetId, note: newNoteText.trim() },
    ]);
    setNewNotePresetId('');
    setNewNoteText('');
  };

  const handleRemoveCriticalNote = (index: number) => {
    setStagedCriticalNotes((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Final submit handler
  const handleConfirmPromotion = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload: PromotionPayload = {
        workspaceId,
        projectId: project.id,
        projectName: project.productName,
        sourceType: selectedSourceType,
        sourceRevisionId: selectedSourceType === 'quote_revision' ? selectedRevisionId : undefined,
        sourceRevisionNumber: selectedSourceRevision?.revisionNumber,
        recipeName: recipeName.trim(),
        recipeCategory: recipeCategory.trim(),
        description: recipeDescription.trim(),
        batchYieldQuantity,
        batchYieldUnit: batchYieldUnit.trim(),
        defaultWastePercent,
        mixingInstructions: mixingInstructions.trim() || undefined,
        generalNotes: generalNotes.trim() || undefined,
        formulaOwnership: project.formulaOwnership,
        ingredients: stagedIngredients,
        selectedPresetIds,
        stagedCriticalNotes,
        userId: currentUserId,
        userName: currentUserName,
        forceDuplicateOverride,
      };

      const result = await promotionService.promoteProject(payload);
      setCreatedRecipe(result.recipe);
      setStep(6); // Move to Success step
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to promote recipe.');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="promotion-wizard-modal"
      data-testid="promotion-wizard-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-stone-50 dark:bg-zinc-850">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <ChefHat className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-stone-900 dark:text-zinc-100 truncate">
                Promote to Production Recipe
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400 truncate">
                {project.productName} • Step {step <= 5 ? step : 5} of 5
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="promotion-wizard-close-btn"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper Progress Bar */}
        {step <= 5 && (
          <div className="px-5 py-2.5 bg-stone-100 dark:bg-zinc-800/80 border-b border-stone-200 dark:border-zinc-700/60 overflow-x-auto">
            <div className="flex items-center justify-between min-w-[500px] text-xs font-bold text-stone-500 dark:text-zinc-400">
              <span className={`flex items-center gap-1.5 ${step === 1 ? 'text-amber-600 font-black' : step > 1 ? 'text-emerald-600' : ''}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 1 ? 'bg-amber-600 text-white' : step > 1 ? 'bg-emerald-600 text-white' : 'bg-stone-300 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300'}`}>1</span>
                Source
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />

              <span className={`flex items-center gap-1.5 ${step === 2 ? 'text-amber-600 font-black' : step > 2 ? 'text-emerald-600' : ''}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 2 ? 'bg-amber-600 text-white' : step > 2 ? 'bg-emerald-600 text-white' : 'bg-stone-300 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300'}`}>2</span>
                Recipe Identity
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />

              <span className={`flex items-center gap-1.5 ${step === 3 ? 'text-amber-600 font-black' : step > 3 ? 'text-emerald-600' : ''}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 3 ? 'bg-amber-600 text-white' : step > 3 ? 'bg-emerald-600 text-white' : 'bg-stone-300 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300'}`}>3</span>
                Ingredient Resolution
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />

              <span className={`flex items-center gap-1.5 ${step === 4 ? 'text-amber-600 font-black' : step > 4 ? 'text-emerald-600' : ''}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 4 ? 'bg-amber-600 text-white' : step > 4 ? 'bg-emerald-600 text-white' : 'bg-stone-300 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300'}`}>4</span>
                Production Setup
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-stone-400" />

              <span className={`flex items-center gap-1.5 ${step === 5 ? 'text-amber-600 font-black' : ''}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 5 ? 'bg-amber-600 text-white' : 'bg-stone-300 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300'}`}>5</span>
                Review & Create
              </span>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs font-semibold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="whitespace-pre-line">{errorMessage}</div>
            </div>
          )}

          {/* STEP 1: SOURCE SELECTION */}
          {step === 1 && (
            <div className="space-y-5" data-testid="wizard-step-1">
              <div>
                <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 mb-1">
                  1. Select Source Formulation
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Choose which formulation from this project will become the new production recipe. The source formula and quote history will remain completely untouched.
                </p>
              </div>

              {/* Source Options */}
              <div className="space-y-3">
                {/* Working Formula */}
                <label
                  data-testid="source-option-working-formula"
                  className={`p-4 rounded-2xl border-2 transition flex items-start gap-3 cursor-pointer ${
                    selectedSourceType === 'working_formula'
                      ? 'border-amber-600 bg-amber-50/50 dark:bg-amber-950/20'
                      : 'border-stone-200 dark:border-zinc-800 hover:border-stone-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="sourceType"
                    value="working_formula"
                    checked={selectedSourceType === 'working_formula'}
                    onChange={() => setSelectedSourceType('working_formula')}
                    className="mt-1 accent-amber-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs sm:text-sm text-stone-900 dark:text-zinc-100">
                        Current Working Formula
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 dark:bg-zinc-700 text-stone-700 dark:text-zinc-300">
                        Active Draft
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                      {project.formula.lines?.length || 0} ingredients • Total weight:{' '}
                      {(project.formula.totalWeightGrams || 0).toLocaleString()} g
                    </p>
                  </div>
                </label>

                {/* Issued Quote Revisions if any */}
                {project.revisions && project.revisions.length > 0 ? (
                  project.revisions.map((rev) => (
                    <label
                      key={rev.id}
                      data-testid={`source-option-revision-${rev.revisionNumber}`}
                      className={`p-4 rounded-2xl border-2 transition flex items-start gap-3 cursor-pointer ${
                        selectedSourceType === 'quote_revision' && selectedRevisionId === rev.id
                          ? 'border-amber-600 bg-amber-50/50 dark:bg-amber-950/20'
                          : 'border-stone-200 dark:border-zinc-800 hover:border-stone-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sourceType"
                        value={rev.id}
                        checked={selectedSourceType === 'quote_revision' && selectedRevisionId === rev.id}
                        onChange={() => {
                          setSelectedSourceType('quote_revision');
                          setSelectedRevisionId(rev.id);
                        }}
                        className="mt-1 accent-amber-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm text-stone-900 dark:text-zinc-100">
                            Issued Quote Revision #{rev.revisionNumber} ({rev.quoteCode})
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            Immutable Snapshot
                          </span>
                        </div>
                        <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                          Issued {new Date(rev.createdAt).toLocaleDateString()} by {rev.createdByName || 'Manager'} •{' '}
                          {rev.formulaSnapshot.lines?.length || 0} ingredients
                        </p>
                        {rev.notes && (
                          <p className="text-xs italic text-stone-600 dark:text-zinc-400 mt-0.5">
                            &quot;{rev.notes}&quot;
                          </p>
                        )}
                      </div>
                    </label>
                  ))
                ) : (
                  <div className="p-3 text-xs text-stone-500 dark:text-zinc-400 italic bg-stone-50 dark:bg-zinc-800/40 rounded-xl">
                    No issued quote revisions recorded yet for this project.
                  </div>
                )}
              </div>

              {/* Source Formulation Preview */}
              <div className="p-4 rounded-2xl bg-stone-50 dark:bg-zinc-850 border border-stone-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-zinc-300">
                  <span>Selected Source Preview</span>
                  <span>{activeSourceFormula.lines?.length || 0} Ingredients</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {activeSourceFormula.lines?.map((line) => (
                    <div
                      key={line.id}
                      className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 flex items-center justify-between"
                    >
                      <span className="font-semibold text-stone-800 dark:text-zinc-200 truncate pr-2">
                        {line.name}
                      </span>
                      <span className="font-mono font-bold text-amber-700 dark:text-amber-400 shrink-0">
                        {line.quantity} {line.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: RECIPE IDENTITY */}
          {step === 2 && (
            <div className="space-y-4" data-testid="wizard-step-2">
              <div>
                <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 mb-1">
                  2. Production Recipe Identity
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Configure how this recipe will appear in the bakery&apos;s production catalog.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Production Recipe Name *
                  </label>
                  <input
                    type="text"
                    required
                    data-testid="input-recipe-name"
                    value={recipeName}
                    onChange={(e) => setRecipeName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    placeholder="e.g. ABC Hotel Chocolate Chip"
                  />
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1">
                    Pre-filled from project name. Editable to distinguish variants (e.g. Chocolate Chip vs Macadamia).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Recipe Category *
                  </label>
                  <select
                    value={recipeCategory}
                    data-testid="select-recipe-category"
                    onChange={(e) => setRecipeCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  >
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Formula Ownership
                  </label>
                  <div className="px-3.5 py-2.5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-100 dark:bg-zinc-850 text-xs font-semibold text-stone-700 dark:text-zinc-300 capitalize">
                    {project.formulaOwnership.replace('_', ' ')}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Internal Description / Context (Optional)
                  </label>
                  <textarea
                    rows={2}
                    data-testid="input-recipe-description"
                    value={recipeDescription}
                    onChange={(e) => setRecipeDescription(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    placeholder="Notes for production management regarding this formulation..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: INGREDIENT RESOLUTION */}
          {step === 3 && (
            <div className="space-y-4" data-testid="wizard-step-3">
              <div>
                <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 mb-1">
                  3. Ingredient Resolution Safety Gate
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Every production ingredient must be linked to an authoritative Master Ingredient in your workspace. Unlinked or temporary R&amp;D items must be resolved before promotion.
                </p>
              </div>

              {unresolvedIngredients.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    {unresolvedIngredients.length} ingredient{unresolvedIngredients.length > 1 ? 's require' : ' requires'} resolution before proceeding.
                  </span>
                </div>
              )}

              {/* Ingredient Resolution Table / List */}
              <div className="space-y-2.5">
                {stagedIngredients.map((line, idx) => {
                  const isResolved = Boolean(line.masterIngredientId);
                  const isVol = isVolumeUnit(line.unit);

                  return (
                    <div
                      key={line.id}
                      data-testid={`ingredient-row-${idx}`}
                      className={`p-3.5 sm:p-4 rounded-2xl border-2 transition ${
                        isResolved
                          ? 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                          : 'border-amber-400 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-stone-900 dark:text-zinc-100">
                              {line.name}
                            </h4>
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-zinc-800 text-amber-700 dark:text-amber-400">
                              {line.quantity} {line.unit}
                            </span>
                            {isVol && !line.densityGramsPerMl && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                Volume (Density needed)
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-xs">
                            {isResolved ? (
                              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                                <span>Linked to Master Ingredient: <strong>{line.masterIngredientName || line.masterIngredientId}</strong></span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Temporary or unlinked ingredient — Action required</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            data-testid={`btn-link-master-${idx}`}
                            onClick={() => {
                              setLinkingLineId(line.id);
                              setSearchQuery(line.name);
                            }}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-700 transition cursor-pointer"
                          >
                            {isResolved ? 'Change Link' : 'Link Existing'}
                          </button>

                          <button
                            type="button"
                            data-testid={`btn-create-master-${idx}`}
                            onClick={() => handleOpenCreateMaster(line)}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition cursor-pointer"
                          >
                            + Create New
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Modal for Linking Existing Master Ingredient */}
              {linkingLineId && (
                <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-zinc-800">
                      <h4 className="font-bold text-sm text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                        <Search className="w-4 h-4 text-amber-600" />
                        <span>Link to Master Ingredient</span>
                      </h4>
                      <button
                        type="button"
                        onClick={() => setLinkingLineId(null)}
                        className="text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div>
                      <input
                        type="text"
                        autoFocus
                        data-testid="input-master-search"
                        placeholder="Search pantry by ingredient name or category..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                      />
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-1.5 divide-y divide-stone-100 dark:divide-zinc-800">
                      {filteredMasterIngredients.map((m) => (
                        <div
                          key={m.id}
                          className="pt-2 pb-2 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <span className="font-bold text-stone-800 dark:text-zinc-200">{m.name}</span>
                            <span className="text-[11px] text-stone-500 dark:text-zinc-400 ml-2">({m.category || 'Pantry'})</span>
                            {m.supplier && (
                              <p className="text-[10px] text-stone-400 dark:text-zinc-500">Supplier: {m.supplier}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            data-testid={`btn-select-master-${m.id}`}
                            onClick={() => handleLinkMasterIngredient(linkingLineId, m)}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                          >
                            Select
                          </button>
                        </div>
                      ))}
                      {filteredMasterIngredients.length === 0 && (
                        <p className="text-xs text-stone-400 italic py-4 text-center">
                          No matching Master Ingredients found.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Modal for Creating New Master Ingredient */}
              {isCreatingMaster && (
                <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                  <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl p-5 space-y-4 my-auto">
                    <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-zinc-800">
                      <h4 className="font-bold text-sm text-stone-900 dark:text-zinc-100 flex items-center gap-2">
                        <Plus className="w-4 h-4 text-amber-600" />
                        <span>Create New Master Ingredient</span>
                      </h4>
                      <button
                        type="button"
                        onClick={() => setIsCreatingMaster(false)}
                        className="text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {masterCreationError && (
                      <p className="text-xs text-rose-600 font-semibold">{masterCreationError}</p>
                    )}

                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">
                          Ingredient Name *
                        </label>
                        <input
                          type="text"
                          required
                          data-testid="input-new-master-name"
                          value={newMasterName}
                          onChange={(e) => setNewMasterName(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">Category</label>
                          <input
                            type="text"
                            value={newMasterCategory}
                            onChange={(e) => setNewMasterCategory(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">Supplier</label>
                          <input
                            type="text"
                            value={newMasterSupplier}
                            onChange={(e) => setNewMasterSupplier(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">Package Size</label>
                          <input
                            type="number"
                            value={newMasterPackSize}
                            onChange={(e) => setNewMasterPackSize(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">Unit</label>
                          <input
                            type="text"
                            value={newMasterUnit}
                            onChange={(e) => setNewMasterUnit(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">Cost ($)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={newMasterPackCost}
                            onChange={(e) => setNewMasterPackCost(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">
                            Density (g/ml)
                          </label>
                          <input
                            type="number"
                            step="0.001"
                            placeholder="e.g. 1.03"
                            value={newMasterDensity}
                            onChange={(e) => setNewMasterDensity(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-stone-700 dark:text-zinc-300 mb-1">
                            Piece Weight (g)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            placeholder="e.g. 50"
                            value={newMasterPieceWeight}
                            onChange={(e) => setNewMasterPieceWeight(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-200 dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setIsCreatingMaster(false)}
                        className="px-3 py-2 text-xs font-bold rounded-xl border border-stone-300 text-stone-600 dark:text-zinc-400"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid="btn-save-new-master"
                        onClick={handleSaveNewMasterIngredient}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        Save &amp; Link
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: PRODUCTION SETUP */}
          {step === 4 && (
            <div className="space-y-5" data-testid="wizard-step-4">
              <div>
                <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 mb-1">
                  4. Production Setup &amp; Presets
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Configure batch yield, production waste, mixing instructions, and preset eligibility.
                </p>
              </div>

              {/* Yield & Waste */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 p-4 rounded-2xl bg-stone-50 dark:bg-zinc-850 border border-stone-200 dark:border-zinc-800">
                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Base Recipe Yield *
                  </label>
                  <input
                    type="number"
                    min="1"
                    data-testid="input-yield-quantity"
                    value={batchYieldQuantity}
                    onChange={(e) => setBatchYieldQuantity(parseFloat(e.target.value) || 1)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Yield Unit *
                  </label>
                  <input
                    type="text"
                    data-testid="input-yield-unit"
                    value={batchYieldUnit}
                    onChange={(e) => setBatchYieldUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                    placeholder="e.g. Cookies, loaves, batch"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                    Default Production Waste %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    data-testid="input-default-waste"
                    value={defaultWastePercent}
                    onChange={(e) => setDefaultWastePercent(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                  />
                </div>
              </div>

              {/* Mixing Instructions */}
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                  Mixing Instructions (Reference-only operating procedure)
                </label>
                <textarea
                  rows={3}
                  data-testid="input-mixing-instructions"
                  value={mixingInstructions}
                  onChange={(e) => setMixingInstructions(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                  placeholder="1. Cream butter and sugar for 3 minutes on speed 2.&#10;2. Add eggs one at a time..."
                />
                <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1">
                  Reference-only. Collapsed by default on the production floor; does not gate workflow.
                </p>
              </div>

              {/* Production Presets Eligibility */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300">
                  Applicable Production Presets ({recipeCategory})
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {categoryPresets.map((preset) => {
                    const isSelected = selectedPresetIds.includes(preset.id);
                    return (
                      <label
                        key={preset.id}
                        className={`p-3 rounded-xl border transition flex items-center gap-2.5 cursor-pointer ${
                          isSelected
                            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-500 font-bold text-amber-900 dark:text-amber-200'
                            : 'bg-white dark:bg-zinc-900 border-stone-200 dark:border-zinc-800 text-stone-700 dark:text-zinc-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPresetIds([...selectedPresetIds, preset.id]);
                            } else {
                              setSelectedPresetIds(selectedPresetIds.filter((id) => id !== preset.id));
                            }
                          }}
                          className="accent-amber-600 rounded"
                        />
                        <span>
                          {preset.name} ({preset.finishedWeight} {preset.weightUnit}, {preset.quantityPerUnit} / {preset.unitName})
                        </span>
                      </label>
                    );
                  })}
                  {categoryPresets.length === 0 && (
                    <p className="text-xs text-stone-500 dark:text-zinc-400 italic">
                      No presets found under category &quot;{recipeCategory}&quot;. Presets can be added anytime in Management.
                    </p>
                  )}
                </div>
              </div>

              {/* Preset-specific Critical Notes Staging */}
              <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Stage Preset-Specific Critical Production Notes (Optional)
                  </span>
                </div>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                  Critical notes require explicit floor operator review and apply strictly to a specific (Preset + Recipe) combination.
                </p>

                {stagedCriticalNotes.map((noteItem, idx) => {
                  const presetName = presets.find((p) => p.id === noteItem.presetId)?.name || noteItem.presetId;
                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700 flex items-center justify-between text-xs gap-2"
                    >
                      <div>
                        <span className="font-bold text-amber-900 dark:text-amber-300">[{presetName}]</span>{' '}
                        <span className="text-stone-700 dark:text-zinc-200">{noteItem.note}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCriticalNote(idx)}
                        className="text-stone-400 hover:text-red-600 shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}

                <div className="flex flex-col sm:flex-row gap-2 pt-1 text-xs">
                  <select
                    value={newNotePresetId}
                    onChange={(e) => setNewNotePresetId(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                  >
                    <option value="">-- Choose Preset --</option>
                    {categoryPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    placeholder="e.g. Use 4000-count chocolate chips for this preset"
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100"
                  />

                  <button
                    type="button"
                    onClick={handleAddCriticalNote}
                    disabled={!newNotePresetId || !newNoteText.trim()}
                    className="px-3 py-2 font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    Add Note
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW & FINAL CONFIRMATION */}
          {step === 5 && (
            <div className="space-y-5" data-testid="wizard-step-5">
              <div>
                <h3 className="text-sm font-bold text-stone-900 dark:text-zinc-100 mb-1">
                  5. Review &amp; Create Production Recipe
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Verify the formulation and metadata below. The original Product Development project will remain active.
                </p>
              </div>

              {/* Duplicate Warning */}
              {duplicateCheck.isDuplicate && (
                <div
                  data-testid="duplicate-warning-box"
                  className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-700 space-y-2 text-xs"
                >
                  <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span>Possible Duplicate Production Recipe Detected</span>
                  </div>
                  <p className="text-amber-800 dark:text-amber-300">
                    {duplicateCheck.warning}
                  </p>
                  <label className="flex items-center gap-2 pt-1 font-bold text-stone-800 dark:text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceDuplicateOverride}
                      onChange={(e) => setForceDuplicateOverride(e.target.checked)}
                      className="accent-amber-600 rounded"
                    />
                    <span>I intentionally want to create this recipe despite the duplicate notice</span>
                  </label>
                </div>
              )}

              {/* Review Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Source Provenance */}
                <div className="p-4 rounded-2xl bg-stone-50 dark:bg-zinc-850 border border-stone-200 dark:border-zinc-800 space-y-2">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-stone-500 dark:text-zinc-400 block">
                    Source Provenance
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-stone-900 dark:text-zinc-100 text-sm">{project.productName}</p>
                    <p className="text-stone-600 dark:text-zinc-400">
                      Source: {selectedSourceType === 'working_formula' ? 'Current Working Formula' : `Quote Revision #${selectedSourceRevision?.revisionNumber}`}
                    </p>
                    <p className="text-stone-500 dark:text-zinc-500 text-[11px]">
                      Ownership: {project.formulaOwnership.replace('_', ' ')}
                    </p>
                  </div>
                </div>

                {/* Production Identity */}
                <div className="p-4 rounded-2xl bg-stone-50 dark:bg-zinc-850 border border-stone-200 dark:border-zinc-800 space-y-2">
                  <span className="font-bold uppercase tracking-wider text-[10px] text-stone-500 dark:text-zinc-400 block">
                    Production Recipe Identity
                  </span>
                  <div className="space-y-1">
                    <p className="font-bold text-stone-900 dark:text-zinc-100 text-sm">{recipeName}</p>
                    <p className="text-stone-600 dark:text-zinc-400">Category: {recipeCategory}</p>
                    <p className="text-stone-600 dark:text-zinc-400">
                      Base Yield: {batchYieldQuantity} {batchYieldUnit} • Waste: {defaultWastePercent}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Formula Formulation Review */}
              <div className="border border-stone-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-stone-100 dark:bg-zinc-800 text-xs font-bold text-stone-700 dark:text-zinc-300 flex items-center justify-between">
                  <span>Preserved Formula ({stagedIngredients.length} ingredients)</span>
                  <span className="text-[11px] text-stone-500">Original entry units preserved</span>
                </div>
                <div className="divide-y divide-stone-100 dark:divide-zinc-800 max-h-56 overflow-y-auto">
                  {stagedIngredients.map((line) => (
                    <div key={line.id} className="p-3 text-xs flex items-center justify-between gap-3">
                      <div>
                        <span className="font-bold text-stone-900 dark:text-zinc-100">{line.name}</span>
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          ✓ Master: {line.masterIngredientName || line.masterIngredientId}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                        {line.quantity} {line.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {mixingInstructions && (
                <div className="p-3 rounded-xl bg-stone-50 dark:bg-zinc-850 border border-stone-200 dark:border-zinc-800 text-xs">
                  <span className="font-bold text-stone-700 dark:text-zinc-300 block mb-1">Mixing Instructions:</span>
                  <p className="text-stone-600 dark:text-zinc-400 whitespace-pre-line text-[11px]">{mixingInstructions}</p>
                </div>
              )}

              {/* Confirmation Dialog / Modal */}
              {showConfirmModal && (
                <div
                  data-testid="promotion-confirm-modal"
                  className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border-2 border-amber-500 space-y-3 text-xs"
                >
                  <h4 className="font-bold text-sm text-amber-950 dark:text-amber-100 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>Confirm Production Recipe Promotion</span>
                  </h4>
                  <p className="text-amber-900 dark:text-amber-200">
                    You are about to create the new production recipe <strong>&quot;{recipeName}&quot;</strong> from this Product Development project. The project, formula, and quote revisions will remain completely intact.
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowConfirmModal(false)}
                      className="px-3 py-2 font-bold rounded-xl border border-stone-300 bg-white text-stone-700 dark:bg-zinc-800 dark:text-zinc-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-testid="btn-confirm-final-promote"
                      disabled={isSubmitting}
                      onClick={handleConfirmPromotion}
                      className="px-4 py-2 font-black rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmitting ? 'Creating Recipe...' : 'Confirm & Create Recipe'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 6: SUCCESS */}
          {step === 6 && createdRecipe && (
            <div className="text-center py-8 space-y-4" data-testid="wizard-step-success">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <h3 className="text-xl font-black text-stone-900 dark:text-zinc-100">
                Production Recipe Created!
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 dark:text-zinc-400 max-w-md mx-auto">
                <strong>{createdRecipe.name}</strong> has been successfully added to your authoritative production library with full provenance link to this project.
              </p>
              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  type="button"
                  data-testid="btn-success-open-recipe"
                  onClick={() => {
                    onSuccess(createdRecipe);
                  }}
                  className="px-5 py-2.5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer flex items-center gap-2"
                >
                  <ChefHat className="w-4 h-4" />
                  <span>Open Production Recipe</span>
                </button>
                <button
                  type="button"
                  data-testid="btn-success-return-project"
                  onClick={onClose}
                  className="px-4 py-2.5 text-xs font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 cursor-pointer"
                >
                  Return to Project
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Bar */}
        {step <= 5 && (
          <div className="px-5 py-3.5 border-t border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-stone-50 dark:bg-zinc-850">
            <div>
              {step > 1 ? (
                <button
                  type="button"
                  data-testid="wizard-prev-btn"
                  onClick={() => setStep(step - 1)}
                  className="px-3.5 py-2 text-xs font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-700 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 transition cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {step < 5 ? (
                <button
                  type="button"
                  data-testid="wizard-next-btn"
                  disabled={
                    (step === 1 && !activeSourceFormula.lines?.length) ||
                    (step === 2 && (!recipeName.trim() || !recipeCategory.trim())) ||
                    (step === 3 && unresolvedIngredients.length > 0) ||
                    (step === 4 && (!batchYieldQuantity || !batchYieldUnit.trim()))
                  }
                  onClick={() => setStep(step + 1)}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                !showConfirmModal && (
                  <button
                    type="button"
                    data-testid="btn-create-production-recipe"
                    disabled={duplicateCheck.isDuplicate && !forceDuplicateOverride}
                    onClick={() => setShowConfirmModal(true)}
                    className="px-5 py-2.5 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <ChefHat className="w-4 h-4" />
                    <span>Create Production Recipe</span>
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
