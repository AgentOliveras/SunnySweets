import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionItemRequirement,
  CalculationResult,
  UserSettings,
  WeightUnit,
  ProductionHistoryEntry,
} from '../types';
import { calculateProduction, calculateRecipeTotal } from '../utils/calculator';
import {
  formatNumber,
  WEIGHT_UNITS,
  convertWeight,
  getUnitLabel,
  isButterIngredient,
  isPeanutButterIngredient,
  getDisplayDecimals,
} from '../utils/units';
import { exportProductionSheetPDF } from '../utils/pdfExport';
import { store } from '../services/store';

interface ProductionCalculatorProps {
  recipes: Recipe[];
  presets: ProductionPreset[];
  mixers: Mixer[];
  settings: UserSettings;
  initialRecipeId?: string;
  onStartGuidedMixing: (calc: CalculationResult) => void;
  onSaveToHistory: (entry: ProductionHistoryEntry) => void;
}

export const ProductionCalculator: React.FC<ProductionCalculatorProps> = ({
  recipes,
  presets,
  mixers,
  settings,
  initialRecipeId,
  onStartGuidedMixing,
  onSaveToHistory,
}) => {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(
    initialRecipeId || (recipes.length > 0 ? recipes[0].id : '')
  );

  useEffect(() => {
    if (initialRecipeId) {
      setSelectedRecipeId(initialRecipeId);
    }
  }, [initialRecipeId]);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

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

  // Waste override (temporary calculation waste %) - defaults to 6%
  const [wasteOverride, setWasteOverride] = useState<string>(
    settings.defaultWastePercent !== undefined ? String(settings.defaultWastePercent) : '6'
  );

  // Selected Mixer
  const [selectedMixerId, setSelectedMixerId] = useState<string>(
    mixers.length > 0 ? mixers[0].id : ''
  );
  const selectedMixer = mixers.find((m) => m.id === selectedMixerId);

  // Display Unit Toggle
  const [displayUnit, setDisplayUnit] = useState<WeightUnit>(settings.defaultWeightUnit || 'lb');

  // Active preset routing categories for the currently selected recipe
  const mappedPresetCategories = React.useMemo<string[]>(() => {
    if (!selectedRecipe || !selectedRecipe.category) return ['All'];
    const mapVal = settings.categoryPresetMap && settings.categoryPresetMap[selectedRecipe.category];
    if (!mapVal) return ['All'];
    if (Array.isArray(mapVal)) {
      return mapVal.length === 0 ? ['All'] : mapVal;
    }
    return [mapVal];
  }, [selectedRecipe, settings.categoryPresetMap]);

  // Group presets by category for organized selection, prioritizing mapped categories
  const groupedPresets = React.useMemo(() => {
    const groups: Record<string, ProductionPreset[]> = {};
    presets.forEach((p) => {
      const cat = p.category || 'Cookies';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });

    const isAll = mappedPresetCategories.includes('All');
    if (isAll) return groups;

    // Place all mapped categories at the front of categories
    const sortedGroups: Record<string, ProductionPreset[]> = {};
    mappedPresetCategories.forEach((cat) => {
      if (groups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    });
    Object.keys(groups).forEach((key) => {
      if (!sortedGroups[key]) {
        sortedGroups[key] = groups[key];
      }
    });
    return sortedGroups;
  }, [presets, mappedPresetCategories]);

  // Update requirement preset when recipe changes if default empty
  useEffect(() => {
    if (requirements.length === 1 && (!requirements[0].quantity || requirements[0].quantity === ('' as any))) {
      let targetPreset = presets[0] || null;
      const isAll = mappedPresetCategories.includes('All');
      if (!isAll && mappedPresetCategories.length > 0) {
        const found = presets.find((p) =>
          mappedPresetCategories.some((mc) => mc.toLowerCase() === (p.category || 'Cookies').toLowerCase())
        );
        if (found) targetPreset = found;
      }
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
      }
    }
  }, [selectedRecipeId, mappedPresetCategories]);

  // Capacity Warning Override State
  const [capacityOverridden, setCapacityOverridden] = useState(false);
  const [showCapacityModal, setShowCapacityModal] = useState(false);

  // Checked ingredients state for checking off during production
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});

  // Calculation Result
  const [calculationResult, setCalculationResult] = useState<CalculationResult | null>(null);

  // Synchronize display unit and default waste when business settings change
  useEffect(() => {
    if (settings.defaultWeightUnit) {
      setDisplayUnit(settings.defaultWeightUnit);
    }
  }, [settings.defaultWeightUnit]);

  useEffect(() => {
    if (settings.defaultWastePercent !== undefined) {
      setWasteOverride(String(settings.defaultWastePercent));
    }
  }, [settings.defaultWastePercent]);

  // Perform Calculation function
  const handleCalculate = (
    forceOverride = false,
    customWasteOverride?: string,
    customMixerId?: string,
    customUnit?: WeightUnit
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
        r.quantity === '' ||
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
    const overrideVal = wasteStr !== '' ? parseFloat(wasteStr) : undefined;
    const mixerIdToUse = customMixerId !== undefined ? customMixerId : selectedMixerId;
    const mixerToUse = mixers.find((m) => m.id === mixerIdToUse);
    const unitToUse = customUnit || displayUnit;

    const res = calculateProduction(selectedRecipe, requirements, {
      overrideWastePercent: overrideVal,
      defaultWastePercent: settings.defaultWastePercent,
      mixer: mixerToUse,
      defaultWeightUnit: unitToUse,
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
        r.quantity === '' ||
        r.quantity === undefined ||
        r.quantity === null ||
        isNaN(Number(r.quantity)) ||
        Number(r.quantity) <= 0
    );
    if (hasInvalidQuantity || requirements.length === 0) return;

    const overrideVal = newWasteStr !== '' ? parseFloat(newWasteStr) : undefined;
    const res = calculateProduction(selectedRecipe, requirements, {
      overrideWastePercent: overrideVal,
      defaultWastePercent: settings.defaultWastePercent,
      mixer: selectedMixer,
      defaultWeightUnit: displayUnit,
      capacityOverridden: capacityOverridden,
    });
    setCalculationResult(res);
  };

  // Add requirement item
  const handleAddRequirement = () => {
    let firstPreset = presets.length > 0 ? presets[0] : null;
    const isAll = mappedPresetCategories.includes('All');
    if (!isAll && mappedPresetCategories.length > 0) {
      const found = presets.find((p) =>
        mappedPresetCategories.some((mc) => mc.toLowerCase() === (p.category || 'Cookies').toLowerCase())
      );
      if (found) firstPreset = found;
    }
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

  const handleSaveToHistoryClick = () => {
    if (!calculationResult) return;
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

    onSaveToHistory(historyEntry);
    alert('Production calculation saved to History!');
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
          <Calculator className="w-6 h-6 text-[#D4A373]" />
          <span>Production Calculator</span>
        </h2>
        <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
          Combine packaging presets, adjust waste percentages, and validate mixer capacities.
        </p>
      </div>

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
                    <span className="font-mono">{selectedRecipe.defaultWastePercent ?? settings.defaultWastePercent ?? 6}%</span>
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
                          req.quantity === '' ||
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
                  placeholder={`Default (${selectedRecipe?.defaultWastePercent ?? settings.defaultWastePercent ?? 6}%)`}
                  value={wasteOverride}
                  onChange={(e) => handleLiveWasteChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
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
                      const overrideVal = wasteOverride !== '' ? parseFloat(wasteOverride) : undefined;
                      const res = calculateProduction(selectedRecipe, requirements, {
                        overrideWastePercent: overrideVal,
                        defaultWastePercent: settings.defaultWastePercent,
                        mixer: mixerObj,
                        defaultWeightUnit: displayUnit,
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

            {/* Display Weight Unit Switcher */}
            <div>
              <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                Display Weight Unit System
              </label>
              <div className="flex items-center gap-2">
                {WEIGHT_UNITS.map((u) => (
                  <button
                    key={u.value}
                    type="button"
                    onClick={() => {
                      setDisplayUnit(u.value);
                      if (calculationResult && selectedRecipe) {
                        handleCalculate(capacityOverridden, undefined, undefined, u.value);
                      }
                    }}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      displayUnit === u.value
                        ? 'bg-[#D4A373] text-white shadow-sm'
                        : 'bg-[#F5F2ED] dark:bg-[#25221F] text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#EEECE8]'
                    }`}
                  >
                    {u.value.toUpperCase()}
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
                    onClick={() => onStartGuidedMixing(calculationResult)}
                    className="inline-flex items-center gap-1.5 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-3.5 py-2 rounded-xl text-xs transition cursor-pointer shadow-sm"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Guided Mixing</span>
                  </button>

                  <button
                    id="calc-export-pdf-btn"
                    onClick={() => {
                      const branding = store.getWorkspaceBranding();
                      exportProductionSheetPDF(
                        calculationResult,
                        {
                          displayName: branding.displayName || settings.businessName,
                          paletteId: branding.paletteId,
                        },
                        decimals
                      );
                    }}
                    className="inline-flex items-center gap-1.5 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export PDF</span>
                  </button>

                  <button
                    id="calc-save-history-btn"
                    onClick={handleSaveToHistoryClick}
                    className="inline-flex items-center gap-1.5 bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] hover:bg-[#EEECE8] font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#D4A373]" />
                    <span>Save History</span>
                  </button>
                </div>
              </div>

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

                  <div className="flex items-center gap-3">
                    {Object.values(checkedIngredients).some(Boolean) && (
                      <button
                        onClick={() => setCheckedIngredients({})}
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

                <div className="overflow-x-auto rounded-xl border border-[#E5E1DA] dark:border-[#2D2925]">
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
                            onClick={() =>
                              setCheckedIngredients((prev) => ({
                                ...prev,
                                [ing.id]: !prev[ing.id],
                              }))
                            }
                            className={`cursor-pointer transition-all select-none ${
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

