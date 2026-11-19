import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Trash2,
  Pencil,
  Search,
  Beaker,
  AlertTriangle,
  Scale,
  DollarSign,
  HelpCircle,
  RefreshCw,
  Layers,
  ArrowUp,
  ArrowDown,
  Check,
  X,
} from 'lucide-react';
import { QuoteFormula, QuoteFormulaLine, TemporaryIngredientData } from '../../types/quoting';
import { MasterIngredient, WeightUnit } from '../../types';
import { calculateFormulaTotals, checkFormulaCostDrift } from '../../utils/quotingCalculator';
import { formatCleanNumeric, isWeightUnit, toGrams } from '../../utils/units';
import { TemporaryIngredientModal } from './TemporaryIngredientModal';

interface FormulaQuantityCellInputProps {
  lineId: string;
  value: number;
  onCommit: (lineId: string, newQty: number) => void;
  onLiveChange?: (lineId: string, newQty: number) => void;
}

const FormulaQuantityCellInput: React.FC<FormulaQuantityCellInputProps> = ({
  lineId,
  value,
  onCommit,
  onLiveChange,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [rawText, setRawText] = useState(() => (value > 0 ? String(value) : ''));
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rawTextRef = useRef(rawText);
  rawTextRef.current = rawText;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const lineIdRef = useRef(lineId);
  lineIdRef.current = lineId;
  const valueRef = useRef(value);
  valueRef.current = value;
  const isDirtyRef = useRef(false);

  // Synchronize external value changes while not actively focused
  useEffect(() => {
    if (!isFocused) {
      setRawText(value > 0 ? String(value) : '');
      isDirtyRef.current = false;
    }
  }, [value, isFocused]);

  // Unmount safety: If component unmounts while user has uncommitted valid edits, commit on unmount only
  useEffect(() => {
    return () => {
      if (!isDirtyRef.current) return;
      const trimmed = rawTextRef.current.trim();
      if (trimmed !== '' && trimmed !== '.') {
        const parsed = parseFloat(trimmed);
        if (!isNaN(parsed) && isFinite(parsed) && parsed > 0 && parsed !== valueRef.current) {
          onCommitRef.current(lineIdRef.current, parsed);
        }
      }
    };
  }, []);

  const handleFocus = () => {
    setIsFocused(true);
    setValidationError(null);
    setRawText(value > 0 ? String(value) : '');
    setTimeout(() => {
      inputRef.current?.select();
    }, 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = e.target.value;
    // Allow digits and at most one decimal point
    const cleaned = incoming.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    let normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;

    // Normalization during typing: prevent sticky leading zeros like "05" or "050"
    // If the input starts with '0' and has subsequent digits not following a decimal point (e.g. "05"), strip leading zero
    if (normalized.length > 1 && normalized.startsWith('0') && normalized[1] !== '.') {
      normalized = normalized.replace(/^0+/, '') || '0';
    }

    setRawText(normalized);
    setValidationError(null);
    isDirtyRef.current = true;

    // If valid positive finite number, propagate live immediately to working draft
    if (normalized !== '' && normalized !== '.') {
      const parsed = parseFloat(normalized);
      if (!isNaN(parsed) && isFinite(parsed) && parsed > 0) {
        onLiveChange?.(lineId, parsed);
      }
    }
  };

  const commit = () => {
    setIsFocused(false);
    isDirtyRef.current = false;
    const trimmed = rawText.trim();
    if (trimmed === '' || trimmed === '.') {
      // Revert to current valid value if cleared completely on blur
      setRawText(String(value));
      setValidationError('Quantity cannot be empty. Restoring last valid value.');
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed) || !isFinite(parsed) || parsed <= 0) {
      setRawText(String(value));
      setValidationError('Quantity must be greater than zero. Restoring last valid value.');
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    // Normalize string representation (e.g. "050" -> "50", "0.50" -> "0.5")
    const cleanNum = String(parsed);
    setRawText(cleanNum);
    onCommitRef.current(lineId, parsed);
  };

  const handleBlur = () => {
    commit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      inputRef.current?.blur();
    }
  };

  const displayVal = isFocused ? rawText : value > 0 ? String(value) : '';

  return (
    <div className="relative inline-block">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.]?[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        aria-label="Ingredient quantity"
        value={displayVal}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-24 px-2 py-1 text-right text-xs font-mono font-bold rounded-lg border bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-amber-500 transition-colors ${
          validationError
            ? 'border-red-400 dark:border-red-600 ring-1 ring-red-400'
            : 'border-stone-300 dark:border-zinc-700'
        }`}
      />
      {validationError && (
        <div className="absolute right-0 top-full mt-1 z-30 p-1.5 text-[10px] font-medium bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-lg shadow-md whitespace-nowrap animate-in fade-in">
          {validationError}
        </div>
      )}
    </div>
  );
};

interface FormulaBuilderProps {
  formula: QuoteFormula;
  masterIngredients: MasterIngredient[];
  onChange: (updatedFormula: QuoteFormula) => void;
  onContinueToPricing?: () => void;
}

export const FormulaBuilder: React.FC<FormulaBuilderProps> = ({
  formula,
  masterIngredients,
  onChange,
  onContinueToPricing,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMaster, setSelectedMaster] = useState<MasterIngredient | null>(null);
  const [addQty, setAddQty] = useState('');
  const [addUnit, setAddUnit] = useState('g');
  const [isTempModalOpen, setIsTempModalOpen] = useState(false);
  const [editingTempLineId, setEditingTempLineId] = useState<string | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [inlineWarning, setInlineWarning] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{
    top: number;
    left: number;
    width: number;
    flipUp: boolean;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const isAddingRef = useRef(false);
  const [isAdding, setIsAdding] = useState(false);

  const masterMap = useMemo(() => {
    return new Map(masterIngredients.map((m) => [m.id, m]));
  }, [masterIngredients]);

  // Autocomplete matching
  const matchingMasterList = useMemo(() => {
    if (!searchTerm.trim() || selectedMaster) return [];
    const term = searchTerm.toLowerCase();
    return masterIngredients
      .filter((m) => m.name.toLowerCase().includes(term))
      .slice(0, 8);
  }, [searchTerm, selectedMaster, masterIngredients]);

  // Dynamic dropdown positioning with viewport overflow detection and flip-upward support
  const updateDropdownPosition = useCallback(() => {
    if (!searchInputRef.current) return;
    const rect = searchInputRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(matchingMasterList.length * 52 + 16, 260);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
    const top = flipUp ? Math.max(8, rect.top - dropdownHeight - 4) : rect.bottom + 4;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
    const targetWidth = Math.min(Math.max(rect.width, 280), viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - targetWidth - 8));
    setPopoverCoords({
      top,
      left,
      width: targetWidth,
      flipUp,
    });
  }, [matchingMasterList.length]);

  useEffect(() => {
    if (matchingMasterList.length > 0 && searchTerm.trim() && !selectedMaster) {
      setIsDropdownOpen(true);
      setHighlightIndex(0);
      updateDropdownPosition();
    } else {
      setIsDropdownOpen(false);
    }
  }, [matchingMasterList.length, searchTerm, selectedMaster, updateDropdownPosition]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleScrollOrResize = () => updateDropdownPosition();
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isDropdownOpen, updateDropdownPosition]);

  // Dismiss dropdown on click outside
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        const popoverEl = document.getElementById('formula-ingredient-popover');
        if (popoverEl && popoverEl.contains(e.target as Node)) {
          return;
        }
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isDropdownOpen]);

  // Check live cost drift
  const costDrift = useMemo(() => {
    return checkFormulaCostDrift(formula, masterMap);
  }, [formula, masterMap]);

  // Step 1: Select ingredient from pantry dropdown — stores in temporary state, does NOT append or save!
  const handleSelectMaster = (master: MasterIngredient) => {
    setSelectedMaster(master);
    setSearchTerm(master.name);
    setIsDropdownOpen(false);
    setInlineWarning(null);

    // Smart default unit based on master ingredient metadata
    let defaultUnit = 'g';
    if (
      master.dimension === 'discrete' ||
      ['eggs', 'each', 'pcs', 'doz', 'units'].includes(master.defaultUnit?.toLowerCase() || '')
    ) {
      defaultUnit = master.defaultUnit || 'each';
    } else if (
      master.dimension === 'volume' ||
      ['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz'].includes(master.defaultUnit?.toLowerCase() || '')
    ) {
      defaultUnit = master.defaultUnit || 'ml';
    } else if (master.defaultUnit) {
      defaultUnit = master.defaultUnit;
    }
    setAddUnit(defaultUnit);
    setAddQty(''); // Strictly blank for each newly selected ingredient! Never commit 100g automatically.

    // Shift focus to quantity input for immediate numeric typing
    setTimeout(() => {
      qtyInputRef.current?.focus();
    }, 50);
  };

  const handleClearSelectedMaster = () => {
    setSelectedMaster(null);
    setSearchTerm('');
    setAddQty('');
    setAddUnit('g');
    setInlineWarning(null);
    setIsDropdownOpen(false);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleFocusNewRow = () => {
    if (selectedMaster) {
      qtyInputRef.current?.focus();
    } else {
      searchInputRef.current?.focus();
    }
  };

  const handleMoveLine = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= formula.lines.length) return;
    const nextLines = [...formula.lines];
    const temp = nextLines[index];
    nextLines[index] = nextLines[targetIndex];
    nextLines[targetIndex] = temp;
    const recalculated = calculateFormulaTotals(nextLines, masterMap);
    onChange(recalculated);
  };

  // Step 2: Explicitly add ingredient to formula with entered quantity
  const handleAddMasterLine = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isAddingRef.current) return; // Prevent rapid double-tap duplicate commits

    const matchedMaster =
      selectedMaster ||
      masterIngredients.find((m) => m.name.toLowerCase() === searchTerm.trim().toLowerCase());

    if (!matchedMaster && !searchTerm.trim()) {
      setInlineWarning('Please select or type an ingredient name.');
      searchInputRef.current?.focus();
      return;
    }

    const trimmedQty = addQty.trim();
    if (!trimmedQty || trimmedQty === '.') {
      setInlineWarning('Please enter a quantity greater than zero.');
      qtyInputRef.current?.focus();
      return;
    }

    const qty = parseFloat(trimmedQty);
    if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
      setInlineWarning('Please enter a valid positive quantity.');
      qtyInputRef.current?.focus();
      return;
    }

    isAddingRef.current = true;
    setIsAdding(true);

    try {
      const isDiscrete = ['eggs', 'each', 'pcs', 'doz', 'units'].includes(addUnit.toLowerCase());

      const newLine: QuoteFormulaLine = {
        id: `line-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: matchedMaster ? matchedMaster.name : searchTerm.trim(),
        quantity: qty,
        unit: addUnit,
        masterIngredientId: matchedMaster?.id,
        unitCostUsed: 0,
        unitCostType: isDiscrete ? 'per_each' : 'per_gram',
        lineCost: 0,
        densityGramsPerMl: matchedMaster?.densityGramsPerMl,
      };

      // Strictly append in original top-to-bottom order
      const nextLines = [...formula.lines, newLine];
      const recalculated = calculateFormulaTotals(nextLines, masterMap);
      onChange(recalculated);

      // Reset inputs
      setSearchTerm('');
      setSelectedMaster(null);
      setAddQty('');
      setAddUnit('g');
      setInlineWarning(null);
      setIsDropdownOpen(false);

      // Re-focus search input for next blank ingredient row underneath
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } finally {
      setTimeout(() => {
        isAddingRef.current = false;
        setIsAdding(false);
      }, 150);
    }
  };

  const handleSaveTempIngredient = (data: TemporaryIngredientData) => {
    const isWeight = isWeightUnit(data.unitMeasure);

    if (editingTempLineId) {
      // Edit existing temporary ingredient line while preserving id and user's entered quantity
      const nextLines = formula.lines.map((line) => {
        if (line.id === editingTempLineId) {
          return {
            ...line,
            name: data.name,
            temporaryData: data,
            densityGramsPerMl: data.densityGramsPerMl,
            notes: data.notes,
          };
        }
        return line;
      });
      const recalculated = calculateFormulaTotals(nextLines, masterMap);
      onChange(recalculated);
      setEditingTempLineId(null);
      setIsTempModalOpen(false);
    } else {
      // Add new temporary ingredient line
      const initialQty = isWeight ? toGrams(data.unitSize, data.unitMeasure as WeightUnit) : data.unitSize;
      const initialUnit = isWeight ? 'g' : data.unitMeasure;

      const newLine: QuoteFormulaLine = {
        id: `line-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: data.name,
        quantity: initialQty,
        unit: initialUnit,
        isTemporary: true,
        temporaryData: data,
        unitCostUsed: 0,
        unitCostType: isWeight ? 'per_gram' : 'per_each',
        lineCost: 0,
        densityGramsPerMl: data.densityGramsPerMl,
        notes: data.notes,
      };

      const nextLines = [...formula.lines, newLine];
      const recalculated = calculateFormulaTotals(nextLines, masterMap);
      onChange(recalculated);
      setIsTempModalOpen(false);
    }
  };

  const handleUpdateLineQty = useCallback(
    (lineId: string, newQty: number | string) => {
      const qty = typeof newQty === 'number' ? newQty : parseFloat(newQty);
      if (isNaN(qty) || qty <= 0) return;
      const existing = formula.lines.find((line) => line.id === lineId);
      if (existing && Number(existing.quantity) === qty) {
        return; // Guard against redundant re-render cascades
      }
      const nextLines = formula.lines.map((line) => {
        if (line.id === lineId) {
          return { ...line, quantity: qty };
        }
        return line;
      });
      const recalculated = calculateFormulaTotals(nextLines, masterMap);
      onChange(recalculated);
    },
    [formula.lines, masterMap, onChange]
  );

  const handleUpdateLineUnit = (lineId: string, newUnit: string) => {
    const nextLines = formula.lines.map((line) => {
      if (line.id === lineId) {
        return { ...line, unit: newUnit };
      }
      return line;
    });
    const recalculated = calculateFormulaTotals(nextLines, masterMap);
    onChange(recalculated);
  };

  const handleRemoveLine = (lineId: string) => {
    const nextLines = formula.lines.filter((line) => line.id !== lineId);
    const recalculated = calculateFormulaTotals(nextLines, masterMap);
    onChange(recalculated);
  };

  const handleApplyLiveCosts = () => {
    const recalculated = calculateFormulaTotals(formula.lines, masterMap);
    onChange(recalculated);
  };

  const handleLinkMasterIngredient = (lineId: string, masterId: string) => {
    const master = masterMap.get(masterId);
    const nextLines = formula.lines.map((line) => {
      if (line.id === lineId) {
        return {
          ...line,
          name: master ? master.name : line.name,
          masterIngredientId: masterId || undefined,
          densityGramsPerMl: master?.densityGramsPerMl ?? line.densityGramsPerMl,
        };
      }
      return line;
    });
    const recalculated = calculateFormulaTotals(nextLines, masterMap);
    onChange(recalculated);
  };

  const isQtyValid = Boolean(
    addQty.trim() !== '' &&
    addQty.trim() !== '.' &&
    !isNaN(parseFloat(addQty)) &&
    isFinite(parseFloat(addQty)) &&
    parseFloat(addQty) > 0
  );
  const isIngredientValid = Boolean(selectedMaster || searchTerm.trim());
  const isAddDisabled = isAdding || !isIngredientValid || !isQtyValid;

  const handleContinueToPricing = () => {
    if (selectedMaster || (searchTerm.trim() && addQty.trim())) {
      setInlineWarning(
        `Pending ingredient "${selectedMaster?.name || searchTerm.trim()}" is not yet added to the formula. Tap "Add to Formula" to include it, or clear it to proceed.`
      );
      return;
    }
    onContinueToPricing?.();
  };

  return (
    <div className="space-y-6">
      {/* Live Cost Drift Alert */}
      {costDrift.hasDrift && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-5 h-5 text-amber-600 shrink-0 animate-spin-slow" />
            <div className="text-xs">
              <span className="font-bold">Live Pantry Costs Changed: </span>
              {costDrift.driftCount} {costDrift.driftCount === 1 ? 'ingredient has' : 'ingredients have'} updated purchasing prices in the pantry (formula impact: {costDrift.costDifference > 0 ? `+$${costDrift.costDifference.toFixed(2)}` : `-$${Math.abs(costDrift.costDifference).toFixed(2)}`}).
            </div>
          </div>
          <button
            type="button"
            onClick={handleApplyLiveCosts}
            className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            Update to Current Live Costs
          </button>
        </div>
      )}

      {/* Formula Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 block">
            Formula Total Weight
          </span>
          <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 dark:text-zinc-100 mt-1 block">
            {formula.totalWeightGrams.toLocaleString()} <span className="text-xs font-bold text-stone-500">g</span>
          </span>
          <span className="text-xs text-stone-400 dark:text-zinc-500 mt-0.5 block">
            {(formula.totalWeightGrams / 453.59237).toFixed(2)} lb
          </span>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 block">
            Formula Total Cost
          </span>
          <span className="text-xl sm:text-2xl font-black font-mono text-amber-700 dark:text-amber-400 mt-1 block">
            ${formula.totalCost.toFixed(2)}
          </span>
          <span className="text-xs text-stone-400 dark:text-zinc-500 mt-0.5 block">
            {formula.lines.length} {formula.lines.length === 1 ? 'ingredient' : 'ingredients'}
          </span>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 block">
            Formula Cost / lb
          </span>
          <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 dark:text-zinc-100 mt-1 block">
            ${(formula.costPerLb || 0).toFixed(2)}
          </span>
          <span className="text-xs text-stone-400 dark:text-zinc-500 mt-0.5 block">
            per finished pound
          </span>
        </div>

        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 block">
            Formula Cost / kg
          </span>
          <span className="text-xl sm:text-2xl font-black font-mono text-stone-900 dark:text-zinc-100 mt-1 block">
            ${(formula.costPerKg || 0).toFixed(2)}
          </span>
          <span className="text-xs text-stone-400 dark:text-zinc-500 mt-0.5 block">
            per finished kilogram
          </span>
        </div>
      </div>

      {/* Formula Ingredients Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs">
        <div>
          <h4 className="text-sm font-bold text-stone-900 dark:text-zinc-100 flex items-center gap-2">
            <span>Formula Ingredients</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
              {formula.lines.length} {formula.lines.length === 1 ? 'item' : 'items'}
            </span>
          </h4>
          <p className="text-xs text-stone-500 dark:text-zinc-400">
            Ingredients are preserved in exact top-to-bottom order. Enter ingredients directly in the row below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="btn-add-temporary-ingredient"
            onClick={() => {
              setEditingTempLineId(null);
              setIsTempModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
          >
            <Beaker className="w-4 h-4" />
            <span>+ Add Temporary R&D Ingredient</span>
          </button>
          <button
            type="button"
            onClick={handleFocusNewRow}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Ingredient</span>
          </button>
        </div>
      </div>

      {/* Desktop / Tablet View: Full Table (md and above) */}
      <div className="hidden md:block bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/40 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                <th className="py-3 px-4">Ingredient</th>
                <th className="py-3 px-3 text-right">Quantity</th>
                <th className="py-3 px-3">Unit</th>
                <th className="py-3 px-3 text-right">Unit Cost</th>
                <th className="py-3 px-4 text-right">Line Cost</th>
                <th className="py-3 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
              {formula.lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-stone-400 dark:text-zinc-500 text-xs">
                    No ingredients in formula yet. Use the entry section below to add your first ingredient.
                  </td>
                </tr>
              ) : (
                formula.lines.map((line, index) => {
                  const isLinked = Boolean(line.masterIngredientId);
                  const isTemp = Boolean(line.isTemporary);

                  return (
                    <tr key={line.id} className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="py-3 px-4 font-medium text-stone-900 dark:text-zinc-100">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-stone-900 dark:text-zinc-100">{line.name}</span>
                            {isTemp ? (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                                Temporary R&D
                              </span>
                            ) : isLinked ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                Pantry Linked
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                Unlinked
                              </span>
                            )}
                            {!isTemp && editingLinkId !== line.id && (
                              <button
                                type="button"
                                onClick={() => setEditingLinkId(line.id)}
                                className="text-[10px] text-stone-400 hover:text-amber-700 dark:hover:text-amber-400 hover:underline px-1 py-0.5 cursor-pointer font-medium"
                                title={isLinked ? 'Change pantry link' : 'Link to pantry'}
                              >
                                {isLinked ? 'Relink' : 'Link to Pantry'}
                              </button>
                            )}
                          </div>

                          {/* Secondary inline link selector (only visible when user explicitly clicks Relink or Link to Pantry) */}
                          {editingLinkId === line.id && !isTemp && (
                            <div className="flex items-center gap-1.5 mt-1 animate-in fade-in">
                              <select
                                aria-label="Change pantry ingredient link"
                                value={line.masterIngredientId || ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleLinkMasterIngredient(line.id, e.target.value);
                                  }
                                  setEditingLinkId(null);
                                }}
                                autoFocus
                                className="text-xs py-1 px-2 rounded-lg border border-amber-400 dark:border-amber-600 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs cursor-pointer focus:outline-hidden"
                              >
                                <option value="">-- Choose pantry ingredient --</option>
                                {masterIngredients.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => setEditingLinkId(null)}
                                className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 px-1 py-0.5 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="py-2 px-3 text-right">
                        <FormulaQuantityCellInput
                          lineId={line.id}
                          value={line.quantity}
                          onLiveChange={handleUpdateLineQty}
                          onCommit={handleUpdateLineQty}
                        />
                      </td>

                      <td className="py-2 px-3">
                        <select
                          value={line.unit}
                          onChange={(e) => handleUpdateLineUnit(line.id, e.target.value)}
                          className="px-2 py-1 text-xs rounded-lg border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                        >
                          <option value="g">g</option>
                          <option value="kg">kg</option>
                          <option value="oz">oz</option>
                          <option value="lb">lb</option>
                          <option value="eggs">eggs</option>
                          <option value="each">each</option>
                          <option value="ml">ml</option>
                          <option value="cup">cup</option>
                          <option value="tbsp">tbsp</option>
                          <option value="tsp">tsp</option>
                        </select>
                      </td>

                      <td className="py-3 px-3 text-right font-mono text-xs text-stone-500 dark:text-zinc-400">
                        {line.unitCostUsed > 0 ? (
                          line.unitCostType === 'per_gram'
                            ? `$${(line.unitCostUsed * 453.59237).toFixed(2)}/lb`
                            : `$${line.unitCostUsed.toFixed(2)}/ea`
                        ) : (
                          <span className="text-stone-400 dark:text-zinc-600">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-800 dark:text-amber-300">
                        ${line.lineCost.toFixed(2)}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveLine(index, 'up')}
                            className="w-6 h-6 inline-flex items-center justify-center rounded text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                            title="Move ingredient up"
                            aria-label="Move ingredient up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === formula.lines.length - 1}
                            onClick={() => handleMoveLine(index, 'down')}
                            className="w-6 h-6 inline-flex items-center justify-center rounded text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                            title="Move ingredient down"
                            aria-label="Move ingredient down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          {isTemp && (
                            <button
                              type="button"
                              data-testid={`btn-edit-temp-${line.id}`}
                              onClick={() => {
                                setEditingTempLineId(line.id);
                                setIsTempModalOpen(true);
                              }}
                              className="w-6 h-6 inline-flex items-center justify-center rounded text-stone-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors"
                              title="Edit temporary ingredient"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            className="w-6 h-6 inline-flex items-center justify-center rounded text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            title="Remove line"
                            aria-label="Remove ingredient"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile View: Compact Ingredient Cards (< md) */}
      <div className="md:hidden space-y-2.5" data-testid="mobile-ingredients-container">
        {formula.lines.length === 0 ? (
          <div className="p-6 text-center bg-white dark:bg-zinc-900 rounded-xl border border-dashed border-stone-200 dark:border-zinc-800 text-stone-400 dark:text-zinc-500 text-xs">
            No ingredients in formula yet. Use the entry section below to add your first ingredient.
          </div>
        ) : (
          formula.lines.map((line, index) => {
            const isLinked = Boolean(line.masterIngredientId);
            const isTemp = Boolean(line.isTemporary);

            return (
              <div
                key={line.id}
                data-testid={`mobile-ingredient-card-${line.id}`}
                className="bg-white dark:bg-zinc-900 rounded-xl p-3.5 border border-stone-200 dark:border-zinc-800 shadow-xs space-y-2.5"
              >
                {/* Card Top: Ingredient Name, Status Badge, Relink Button, Action Buttons */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm text-stone-900 dark:text-zinc-100 break-words">
                        {line.name}
                      </span>
                      {isTemp ? (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                          Temporary R&D
                        </span>
                      ) : isLinked ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Pantry Linked
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          Unlinked
                        </span>
                      )}
                    </div>

                    {!isTemp && editingLinkId !== line.id && (
                      <button
                        type="button"
                        onClick={() => setEditingLinkId(line.id)}
                        className="text-[11px] text-stone-400 hover:text-amber-700 dark:hover:text-amber-400 hover:underline pt-0.5 font-medium cursor-pointer inline-block"
                        title={isLinked ? 'Change pantry link' : 'Link to pantry'}
                      >
                        {isLinked ? 'Relink' : 'Link to Pantry'}
                      </button>
                    )}

                    {editingLinkId === line.id && !isTemp && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <select
                          aria-label="Change pantry ingredient link"
                          value={line.masterIngredientId || ''}
                          onChange={(e) => {
                            if (e.target.value) {
                              handleLinkMasterIngredient(line.id, e.target.value);
                            }
                            setEditingLinkId(null);
                          }}
                          autoFocus
                          className="text-xs py-1.5 px-2 rounded-lg border border-amber-400 dark:border-amber-600 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs cursor-pointer focus:outline-hidden flex-1"
                        >
                          <option value="">-- Choose pantry ingredient --</option>
                          {masterIngredients.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setEditingLinkId(null)}
                          className="text-xs text-stone-400 hover:text-stone-600 px-1 py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Card Actions: Move up/down, Edit (if temp), Remove */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMoveLine(index, 'up')}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                      title="Move up"
                      aria-label="Move ingredient up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === formula.lines.length - 1}
                      onClick={() => handleMoveLine(index, 'down')}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                      title="Move down"
                      aria-label="Move ingredient down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {isTemp && (
                      <button
                        type="button"
                        data-testid={`btn-edit-temp-${line.id}`}
                        onClick={() => {
                          setEditingTempLineId(line.id);
                          setIsTempModalOpen(true);
                        }}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                        title="Edit temporary ingredient"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(line.id)}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                      title="Remove ingredient"
                      aria-label="Remove ingredient"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Card Bottom: Labeled Quantity, Labeled Unit, and Line Cost */}
                <div className="pt-2 border-t border-stone-100 dark:border-zinc-800 flex items-end justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-zinc-500 mb-1">
                        Quantity
                      </label>
                      <FormulaQuantityCellInput
                        lineId={line.id}
                        value={line.quantity}
                        onLiveChange={handleUpdateLineQty}
                        onCommit={handleUpdateLineQty}
                      />
                    </div>
                    <div className="w-20">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-zinc-500 mb-1">
                        Unit
                      </label>
                      <select
                        value={line.unit}
                        onChange={(e) => handleUpdateLineUnit(line.id, e.target.value)}
                        className="w-full h-8 px-2 text-xs rounded-lg border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                        <option value="oz">oz</option>
                        <option value="lb">lb</option>
                        <option value="eggs">eggs</option>
                        <option value="each">each</option>
                        <option value="ml">ml</option>
                        <option value="cup">cup</option>
                        <option value="tbsp">tbsp</option>
                        <option value="tsp">tsp</option>
                      </select>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-zinc-500 mb-0.5">
                      Line Cost
                    </span>
                    <span className="font-mono font-bold text-sm text-amber-800 dark:text-amber-300">
                      ${line.lineCost.toFixed(2)}
                    </span>
                    <span className="block font-mono text-[10px] text-stone-400 dark:text-zinc-500">
                      {line.unitCostUsed > 0
                        ? line.unitCostType === 'per_gram'
                          ? `$${(line.unitCostUsed * 453.59237).toFixed(2)}/lb`
                          : `$${line.unitCostUsed.toFixed(2)}/ea`
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Explicit Add Ingredient Section (Responsive 2-Step Workflow) */}
      <div
        data-testid="add-ingredient-section"
        className="bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-800 p-3.5 sm:p-4 shadow-xs space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-700 dark:text-amber-400 font-bold text-xs">
              +
            </div>
            <h5 className="text-xs sm:text-sm font-bold text-stone-900 dark:text-zinc-100">
              Add Ingredient to Formula
            </h5>
          </div>
          <span className="text-[11px] text-stone-400 dark:text-zinc-500">
            Step 1: Select • Step 2: Quantity
          </span>
        </div>

        <form onSubmit={handleAddMasterLine} className="space-y-3">
          {/* Step 1: Ingredient Selection */}
          <div>
            {selectedMaster ? (
              <div className="flex items-center justify-between p-2.5 sm:p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 animate-in fade-in">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] shrink-0 font-bold">
                    ✓
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-xs sm:text-sm text-stone-900 dark:text-zinc-100 truncate">
                        {selectedMaster.name}
                      </span>
                      <span className="px-1.5 py-0.2 text-[9px] font-bold rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Pantry Linked
                      </span>
                    </div>
                    <span className="text-[10px] text-stone-500 dark:text-zinc-400 block truncate">
                      {selectedMaster.preferredPurchasePackage
                        ? `$${(selectedMaster.preferredPurchasePackage.packagePriceCents / 100).toFixed(2)} / ${formatCleanNumeric(selectedMaster.preferredPurchasePackage.unitSize)} ${selectedMaster.preferredPurchasePackage.unitMeasure}`
                        : 'Pantry item'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelectedMaster}
                  className="text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 font-bold px-2.5 py-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer shrink-0 transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
                <input
                  ref={searchInputRef}
                  data-testid="formula-ingredient-search-input"
                  type="text"
                  placeholder="Type ingredient name to search pantry..."
                  value={searchTerm}
                  onFocus={() => {
                    if (matchingMasterList.length > 0) {
                      setIsDropdownOpen(true);
                      updateDropdownPosition();
                    }
                  }}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setSelectedMaster(null);
                    setInlineWarning(null);
                  }}
                  onKeyDown={(e) => {
                    if (isDropdownOpen && matchingMasterList.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setHighlightIndex((prev) => (prev + 1) % matchingMasterList.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlightIndex((prev) => (prev - 1 + matchingMasterList.length) % matchingMasterList.length);
                        return;
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (matchingMasterList[highlightIndex]) {
                          handleSelectMaster(matchingMasterList[highlightIndex]);
                        }
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setIsDropdownOpen(false);
                        return;
                      }
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      qtyInputRef.current?.focus();
                    }
                  }}
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
            )}
          </div>

          {/* Step 2: Quantity, Unit, and Add to Formula Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5 sm:gap-3">
            <div className="flex-1 sm:w-40 sm:flex-none">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 mb-1">
                Quantity {selectedMaster && <span className="text-amber-600">*</span>}
              </label>
              <input
                ref={qtyInputRef}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[.]?[0-9]*"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                aria-label="Add ingredient quantity"
                placeholder="e.g. 50"
                value={addQty}
                onChange={(e) => {
                  const incoming = e.target.value;
                  const cleaned = incoming.replace(/[^0-9.]/g, '');
                  const parts = cleaned.split('.');
                  let normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
                  if (normalized.length > 1 && normalized.startsWith('0') && normalized[1] !== '.') {
                    normalized = normalized.replace(/^0+/, '') || '0';
                  }
                  setAddQty(normalized);
                  setInlineWarning(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMasterLine();
                  }
                }}
                className="w-full px-3 py-2 text-xs sm:text-sm font-mono font-bold rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="w-full sm:w-28">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 mb-1">
                Unit
              </label>
              <select
                value={addUnit}
                onChange={(e) => setAddUnit(e.target.value)}
                className="w-full px-2.5 py-2 text-xs rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500 cursor-pointer"
              >
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="oz">oz</option>
                <option value="lb">lb</option>
                <option value="eggs">eggs</option>
                <option value="each">each</option>
                <option value="ml">ml</option>
                <option value="cup">cup</option>
                <option value="tbsp">tbsp</option>
                <option value="tsp">tsp</option>
              </select>
            </div>

            <div className="flex-1 sm:flex-initial">
              <button
                type="button"
                data-testid="btn-add-ingredient-inline"
                disabled={isAddDisabled}
                onClick={() => handleAddMasterLine()}
                className="w-full sm:w-auto h-[38px] px-5 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer"
                title="Add ingredient to formula"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Add to Formula</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Inline Warning if required fields missing when attempting to add ingredient */}
      {inlineWarning && (
        <div
          data-testid="formula-inline-warning"
          className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs animate-in fade-in"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{inlineWarning}</span>
        </div>
      )}

      {/* Fully visible, unclipped popover anchored to search input via React Portal */}
      {typeof document !== 'undefined' &&
        isDropdownOpen &&
        matchingMasterList.length > 0 &&
        popoverCoords &&
        createPortal(
          <div
            id="formula-ingredient-popover"
            data-testid="ingredient-search-popover"
            style={{
              position: 'fixed',
              top: popoverCoords.top,
              left: popoverCoords.left,
              width: popoverCoords.width,
              zIndex: 99999,
            }}
            className="bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-xl shadow-2xl overflow-hidden divide-y divide-stone-100 dark:divide-zinc-700/60 max-h-64 overflow-y-auto"
          >
            {matchingMasterList.map((m, idx) => (
              <button
                key={m.id}
                type="button"
                onMouseEnter={() => setHighlightIndex(idx)}
                onClick={() => handleSelectMaster(m)}
                className={`w-full text-left px-3 py-2.5 transition-colors flex items-center justify-between text-xs cursor-pointer ${
                  highlightIndex === idx
                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-100'
                    : 'hover:bg-amber-50 dark:hover:bg-zinc-700/60 text-stone-900 dark:text-zinc-100'
                }`}
              >
                <div>
                  <span className="font-bold">{m.name}</span>
                  {m.category && (
                    <span className="text-[10px] text-stone-400 dark:text-zinc-400 ml-2">
                      ({m.category})
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-stone-500 dark:text-zinc-400">
                  {m.preferredPurchasePackage
                    ? `$${(m.preferredPurchasePackage.packagePriceCents / 100).toFixed(2)} / ${formatCleanNumeric(m.preferredPurchasePackage.unitSize)} ${m.preferredPurchasePackage.unitMeasure}`
                    : 'No price set'}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}

      <TemporaryIngredientModal
        key={editingTempLineId ? `edit-${editingTempLineId}` : 'new-temp-ingredient'}
        isOpen={isTempModalOpen}
        isEditing={!!editingTempLineId}
        initialData={
          editingTempLineId
            ? formula.lines.find((l) => l.id === editingTempLineId)?.temporaryData || null
            : null
        }
        onClose={() => {
          setIsTempModalOpen(false);
          setEditingTempLineId(null);
        }}
        onSave={handleSaveTempIngredient}
      />

      {/* Prominent Continue Action */}
      {onContinueToPricing && (
        <div className="flex justify-end pt-4 border-t border-stone-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleContinueToPricing}
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 shadow-md hover:shadow-lg transition-all hover:translate-x-0.5 cursor-pointer"
          >
            <span>Continue to Products & Pricing →</span>
          </button>
        </div>
      )}
    </div>
  );
};
