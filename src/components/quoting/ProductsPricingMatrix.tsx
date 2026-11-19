import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Package,
  DollarSign,
  TrendingUp,
  Percent,
  Layers,
  ArrowRight,
  Scale,
  Clock,
  Box,
  Info,
  Check,
} from 'lucide-react';
import {
  QuoteProductConfig,
  QuoteFormula,
  QuotePricingBasis,
  QuotedPricingMethod,
  DEFAULT_PRODUCT_TYPES,
} from '../../types/quoting';
import { WeightUnit, ProductionPreset } from '../../types';
import { calculateProductPricing } from '../../utils/quotingCalculator';
import { toGrams } from '../../utils/units';
import { store } from '../../services/store';
import { normalizePresetCategory } from '../../utils/calculator';
import { PricingSummaryHierarchy } from './PricingSummaryHierarchy';
import { PackagingPresetSelectorModal } from './PackagingPresetSelectorModal';

interface ProductsPricingMatrixProps {
  products: QuoteProductConfig[];
  formula: QuoteFormula;
  onChange: (updatedProducts: QuoteProductConfig[]) => void;
  defaultMultiplier?: number;
  presets?: ProductionPreset[];
  projectCategory?: string;
  workspaceId?: string;
}

export const ProductsPricingMatrix: React.FC<ProductsPricingMatrixProps> = ({
  products,
  formula,
  onChange,
  defaultMultiplier = 1.6,
  presets: propPresets,
  projectCategory,
  workspaceId,
}) => {
  const presets = propPresets && propPresets.length > 0 ? propPresets : store.getPresets();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const isAddingRef = useRef(false);

  // Currently active configuration ID for immediate editing
  const [selectedConfigId, setSelectedConfigId] = useState<string>(() => {
    return products[0]?.id || '';
  });

  // Ensure selectedConfigId is valid when products change
  useEffect(() => {
    if (products.length > 0) {
      const exists = products.some((p) => p.id === selectedConfigId);
      if (!exists) {
        setSelectedConfigId(products[0].id);
      }
    } else {
      setSelectedConfigId('');
    }
  }, [products, selectedConfigId]);

  const activeConfig = products.find((p) => p.id === selectedConfigId) || null;

  // Local editable form states for the active configuration
  const [productType, setProductType] = useState<string>('Cookie');
  const [name, setName] = useState<string>('');
  const [pieceWeightStr, setPieceWeightStr] = useState<string>('4');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('oz');
  const [piecesPerCaseStr, setPiecesPerCaseStr] = useState<string>('80');
  const [unitName, setUnitName] = useState<string>('case');
  const [packagingCostStr, setPackagingCostStr] = useState<string>('3.00');
  const [laborCostStr, setLaborCostStr] = useState<string>('11.45');
  const [otherCostStr, setOtherCostStr] = useState<string>('0.00');
  const [multiplierStr, setMultiplierStr] = useState<string>(defaultMultiplier.toString());
  
  // Phase 2B.5.9: 4 Mutually Exclusive Quoted Pricing Methods
  const [quotedMethod, setQuotedMethod] = useState<QuotedPricingMethod>('price_per_case');
  const [casePriceInput, setCasePriceInput] = useState<string>('');
  const [unitPriceInput, setUnitPriceInput] = useState<string>('');
  const [desiredProfitInput, setDesiredProfitInput] = useState<string>('');
  const [multiplierInput, setMultiplierInput] = useState<string>('');

  // Sync activeConfig into form state when active configuration switches
  useEffect(() => {
    if (!activeConfig) return;

    setProductType(activeConfig.productType || 'Cookie');
    setName(activeConfig.name || '');
    setPieceWeightStr(activeConfig.pieceWeight ? activeConfig.pieceWeight.toString() : '');
    setWeightUnit(activeConfig.weightUnit || 'oz');
    setPiecesPerCaseStr(activeConfig.piecesPerCase ? activeConfig.piecesPerCase.toString() : '');
    setUnitName(activeConfig.unitName || 'case');

    // Blank vs Zero inputs: preserve actual string representation
    setPackagingCostStr(
      activeConfig.packagingCost !== undefined && activeConfig.packagingCost !== null
        ? activeConfig.packagingCost.toString()
        : ''
    );
    setLaborCostStr(
      activeConfig.laborCost !== undefined && activeConfig.laborCost !== null
        ? activeConfig.laborCost.toString()
        : ''
    );
    setOtherCostStr(
      activeConfig.otherCost !== undefined && activeConfig.otherCost !== null
        ? activeConfig.otherCost.toString()
        : ''
    );
    setMultiplierStr(
      activeConfig.ingredientMultiplier !== undefined && activeConfig.ingredientMultiplier !== null
        ? activeConfig.ingredientMultiplier.toString()
        : defaultMultiplier.toString()
    );

    // Resolve active pricing method
    let method: QuotedPricingMethod = 'price_per_case';
    if (activeConfig.quotedMethod) {
      method = activeConfig.quotedMethod;
    } else if (activeConfig.pricingBasis === 'unit' || activeConfig.quotedPricePerUnit != null) {
      method = 'price_per_unit';
    } else if (activeConfig.pricingBasis === 'profit_case' || activeConfig.desiredProfitPerCase != null) {
      method = 'desired_profit';
    } else if (activeConfig.pricingBasis === 'multiplier' || activeConfig.quotedMultiplier != null) {
      method = 'ingredients_multiplier';
    }
    setQuotedMethod(method);

    // IMPORTANT INITIAL STATE: All 4 fields must initially be BLANK unless quoted
    // Only the selected method's field receives a value if a quote was actually set
    setCasePriceInput('');
    setUnitPriceInput('');
    setDesiredProfitInput('');
    setMultiplierInput('');

    if (activeConfig.isQuotedPriceSet || (activeConfig.quotedPrice != null && activeConfig.quotedPrice > 0)) {
      if (method === 'price_per_case') {
        const val = activeConfig.quotedMethodValue ?? activeConfig.quotedPrice;
        if (val != null) setCasePriceInput(val.toString());
      } else if (method === 'price_per_unit') {
        const val = activeConfig.quotedMethodValue ?? activeConfig.quotedPricePerUnit;
        if (val != null) setUnitPriceInput(val.toString());
      } else if (method === 'desired_profit') {
        const val = activeConfig.quotedMethodValue ?? activeConfig.desiredProfitPerCase;
        if (val != null) setDesiredProfitInput(val.toString());
      } else if (method === 'ingredients_multiplier') {
        const val = activeConfig.quotedMethodValue ?? activeConfig.quotedMultiplier;
        if (val != null) setMultiplierInput(val.toString());
      }
    }
  }, [activeConfig?.id, defaultMultiplier]);

  // Handle updates to the active configuration
  const applyFormChanges = (overrides?: {
    productType?: string;
    name?: string;
    pieceWeightStr?: string;
    weightUnit?: WeightUnit;
    piecesPerCaseStr?: string;
    unitName?: string;
    packagingCostStr?: string;
    laborCostStr?: string;
    otherCostStr?: string;
    multiplierStr?: string;
    quotedMethod?: QuotedPricingMethod;
    casePriceInput?: string;
    unitPriceInput?: string;
    desiredProfitInput?: string;
    multiplierInput?: string;
  }) => {
    if (!activeConfig) return;

    const effType = overrides?.productType ?? productType;
    const effName = overrides?.name ?? name;
    const effPieceWeightStr = overrides?.pieceWeightStr ?? pieceWeightStr;
    const effWeightUnit = overrides?.weightUnit ?? weightUnit;
    const effPiecesPerCaseStr = overrides?.piecesPerCaseStr ?? piecesPerCaseStr;
    const effUnitName = overrides?.unitName ?? unitName;
    const effPkgStr = overrides?.packagingCostStr ?? packagingCostStr;
    const effLbrStr = overrides?.laborCostStr ?? laborCostStr;
    const effOthStr = overrides?.otherCostStr ?? otherCostStr;
    const effMultStr = overrides?.multiplierStr ?? multiplierStr;
    const effMethod = overrides?.quotedMethod ?? quotedMethod;

    const effCaseStr = overrides?.casePriceInput !== undefined ? overrides.casePriceInput : casePriceInput;
    const effUnitStr = overrides?.unitPriceInput !== undefined ? overrides.unitPriceInput : unitPriceInput;
    const effProfitStr = overrides?.desiredProfitInput !== undefined ? overrides.desiredProfitInput : desiredProfitInput;
    const effMultInputStr = overrides?.multiplierInput !== undefined ? overrides.multiplierInput : multiplierInput;

    const pWeight = effPieceWeightStr.trim() === '' ? 0 : parseFloat(effPieceWeightStr);
    const pCount = effPiecesPerCaseStr.trim() === '' ? 0 : parseInt(effPiecesPerCaseStr, 10);
    const pkg = effPkgStr.trim() === '' ? null : parseFloat(effPkgStr);
    const lbr = effLbrStr.trim() === '' ? null : parseFloat(effLbrStr);
    const oth = effOthStr.trim() === '' ? null : parseFloat(effOthStr);
    const mult = effMultStr.trim() === '' ? null : parseFloat(effMultStr);

    let activeInputStr = '';
    if (effMethod === 'price_per_case') activeInputStr = effCaseStr;
    else if (effMethod === 'price_per_unit') activeInputStr = effUnitStr;
    else if (effMethod === 'desired_profit') activeInputStr = effProfitStr;
    else if (effMethod === 'ingredients_multiplier') activeInputStr = effMultInputStr;

    const parsedVal = activeInputStr.trim() === '' ? null : parseFloat(activeInputStr);
    const isValidVal =
      parsedVal !== null &&
      !isNaN(parsedVal) &&
      (effMethod === 'desired_profit' ? parsedVal >= 0 : parsedVal > 0);

    const recalculated = calculateProductPricing({
      id: activeConfig.id,
      productType: effType,
      name: effName,
      pieceWeight: isNaN(pWeight) ? 0 : pWeight,
      weightUnit: effWeightUnit,
      piecesPerCase: isNaN(pCount) ? 0 : pCount,
      unitName: effUnitName,
      packagingCost: pkg,
      packagingLines: activeConfig.packagingLines,
      laborCost: lbr,
      otherCost: oth,
      otherLines: activeConfig.otherLines,
      ingredientMultiplier: mult,
      pricingBasis: effMethod === 'price_per_unit' ? 'unit' : 'case',
      quotedMethod: effMethod,
      quotedMethodValue: isValidVal ? parsedVal : null,
      desiredProfitPerCase: effMethod === 'desired_profit' && isValidVal ? parsedVal : null,
      quotedMultiplier: effMethod === 'ingredients_multiplier' && isValidVal ? parsedVal : null,
      quotedPrice: effMethod === 'price_per_case' && isValidVal ? parsedVal : null,
      quotedPricePerUnit: effMethod === 'price_per_unit' && isValidVal ? parsedVal : null,
      formula,
    });

    const nextProducts = products.map((p) => (p.id === activeConfig.id ? recalculated : p));
    onChange(nextProducts);
  };

  // Switching radio button changes the active method.
  // In accordance with Phase 2B.5.9:
  // "The radio selection itself must not populate a value.
  //  A calculated quote must appear ONLY after the user enters a valid value into the selected field.
  //  All other fields remain blank and disabled."
  const handleMethodSelect = (newMethod: QuotedPricingMethod) => {
    if (newMethod === quotedMethod) return;
    setQuotedMethod(newMethod);
    setCasePriceInput('');
    setUnitPriceInput('');
    setDesiredProfitInput('');
    setMultiplierInput('');

    applyFormChanges({
      quotedMethod: newMethod,
      casePriceInput: '',
      unitPriceInput: '',
      desiredProfitInput: '',
      multiplierInput: '',
    });
  };

  // Add a new product configuration from selected Packaging Preset
  const handleSelectPreset = (preset: ProductionPreset) => {
    if (isAddingRef.current) return;
    isAddingRef.current = true;

    const pieceWeight = preset.finishedWeight > 0 ? preset.finishedWeight : 4;
    const weightUnit = preset.weightUnit || 'oz';
    const piecesPerCase = preset.quantityPerUnit > 0 ? preset.quantityPerUnit : 80;
    const unitName = preset.unitName || 'case';
    const productType = normalizePresetCategory(preset) || projectCategory || 'Cookie';
    const name = preset.name || `${pieceWeight} ${weightUnit.toUpperCase()} (${piecesPerCase}/${unitName})`;

    const newId = `scen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newConfig = calculateProductPricing({
      id: newId,
      productType,
      name,
      pieceWeight,
      weightUnit,
      piecesPerCase,
      unitName,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: defaultMultiplier,
      pricingBasis: 'case',
      quotedMethod: 'price_per_case',
      quotedMethodValue: null,
      desiredProfitPerCase: null,
      quotedMultiplier: null,
      quotedPrice: null, // Crucial: Starts blank! Never inherits previous quoted pricing
      quotedPricePerUnit: null,
      formula,
    });

    const nextList = [...products, newConfig];
    onChange(nextList);
    setSelectedConfigId(newId);
    setIsPresetModalOpen(false);

    setTimeout(() => {
      isAddingRef.current = false;
    }, 400);
  };

  // Add custom product configuration manually
  const handleSelectCustom = () => {
    if (isAddingRef.current) return;
    isAddingRef.current = true;
    const newId = `scen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newConfig = calculateProductPricing({
      id: newId,
      productType: projectCategory || 'Cookie',
      name: 'Custom Product Size',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      unitName: 'case',
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: defaultMultiplier,
      pricingBasis: 'case',
      quotedMethod: 'price_per_case',
      quotedMethodValue: null,
      desiredProfitPerCase: null,
      quotedMultiplier: null,
      quotedPrice: null, // Crucial: Starts blank!
      quotedPricePerUnit: null,
      formula,
    });

    const nextList = [...products, newConfig];
    onChange(nextList);
    setSelectedConfigId(newId);
    setIsPresetModalOpen(false);

    setTimeout(() => {
      isAddingRef.current = false;
    }, 400);
  };

  // Duplicate the currently selected configuration
  const handleDuplicateConfig = () => {
    if (!activeConfig) return;
    const newId = `scen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const copyName = activeConfig.name
      ? `${activeConfig.name} (Copy)`
      : `${activeConfig.pieceWeight} ${activeConfig.weightUnit.toUpperCase()} (Copy)`;

    const duplicated = calculateProductPricing({
      ...activeConfig,
      id: newId,
      name: copyName,
      formula,
    });

    const nextList = [...products, duplicated];
    onChange(nextList);
    setSelectedConfigId(newId);
  };

  // Delete the currently selected configuration
  const handleDeleteConfig = (idToDelete: string) => {
    const nextList = products.filter((p) => p.id !== idToDelete);
    onChange(nextList);
    if (selectedConfigId === idToDelete) {
      setSelectedConfigId(nextList[0]?.id || '');
    }
  };

  // Dough weight per case live calculation
  const pieceWeightNum = parseFloat(pieceWeightStr) || 0;
  const piecesCountNum = parseInt(piecesPerCaseStr, 10) || 0;
  const pieceGrams = pieceWeightNum > 0 ? toGrams(pieceWeightNum, weightUnit) : 0;
  const totalDoughGrams = Number((piecesCountNum * pieceGrams).toFixed(2));
  const totalDoughOz = Number((totalDoughGrams / 28.349523125).toFixed(2));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-xs">
        <div>
          <h3 className="font-serif font-bold text-lg sm:text-xl text-stone-900 dark:text-zinc-100">
            Step 2 — Products & Commercial Pricing
          </h3>
          <p className="text-xs sm:text-sm text-stone-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Configure portion sizes, case packs, and direct production costs. Evaluate target prices from your commercial model, then set your actual quoted selling price.
          </p>
        </div>

        <button
          data-testid="add-product-config-btn"
          type="button"
          onClick={() => setIsPresetModalOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>+ Add Product Size / Case</span>
        </button>
      </div>

      {/* Empty State when no configurations exist */}
      {products.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-xs space-y-4">
          <Package className="w-12 h-12 text-stone-300 dark:text-zinc-600 mx-auto" />
          <div>
            <h4 className="text-base font-bold text-stone-800 dark:text-zinc-200">
              No Product Configurations Yet
            </h4>
            <p className="text-xs text-stone-500 dark:text-zinc-400 max-w-md mx-auto mt-1 leading-relaxed">
              Create a sellable configuration (such as 4 oz cookies, 80/case) to calculate raw ingredient costs, direct production expenses, target pricing, and commercial margins.
            </p>
          </div>
          <div className="pt-2">
            <button
              data-testid="create-first-product-config-btn"
              type="button"
              onClick={() => setIsPresetModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Product Configuration</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Multiple Product Configurations Selector Tabs */}
          <div className="flex items-center justify-between gap-3 p-2 rounded-2xl bg-stone-100 dark:bg-zinc-800/70 border border-stone-200 dark:border-zinc-700 overflow-x-auto">
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {products.map((p, idx) => {
                const isSelected = p.id === selectedConfigId;
                const displayName = p.name || `${p.pieceWeight} ${p.weightUnit.toUpperCase()} (${p.piecesPerCase}/${p.unitName})`;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedConfigId(p.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-white dark:bg-zinc-900 text-amber-800 dark:text-amber-400 shadow-xs border border-amber-300 dark:border-amber-700/80 ring-2 ring-amber-500/20'
                        : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 hover:bg-stone-200/60 dark:hover:bg-zinc-700/50'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-md flex items-center justify-center bg-stone-200 dark:bg-zinc-800 text-[10px] font-mono text-stone-700 dark:text-zinc-300">
                      {idx + 1}
                    </span>
                    <span className="line-clamp-1">{displayName}</span>
                    {p.quotedPrice != null && p.quotedPrice > 0 ? (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[10px] font-mono">
                        ${p.quotedPrice.toFixed(2)}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-stone-200/80 dark:bg-zinc-700 text-stone-500 dark:text-zinc-400 text-[10px]">
                        Draft
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Quick Actions for Selected Configuration */}
            {activeConfig && (
              <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-stone-200 dark:border-zinc-700">
                <button
                  data-testid="duplicate-config-btn"
                  type="button"
                  onClick={handleDuplicateConfig}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 hover:bg-stone-200/80 dark:hover:bg-zinc-700 transition-colors inline-flex items-center gap-1 cursor-pointer"
                  title="Duplicate this configuration"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Duplicate</span>
                </button>

                {products.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteConfig(activeConfig.id)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-stone-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors inline-flex items-center gap-1 cursor-pointer"
                    title="Delete this configuration"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Delete</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ACTIVE CONFIGURATION WORKSPACE (Direct Inline Editing) */}
          {activeConfig && (
            <div className="space-y-6">
              {/* Card 1: Configuration Specifications */}
              <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-xs space-y-4">
                <div className="flex items-center gap-2 border-b border-stone-100 dark:border-zinc-800 pb-3">
                  <Package className="w-4 h-4 text-amber-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-zinc-200">
                    Product Specifications
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Product Type */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Product Type
                    </label>
                    <select
                      value={productType}
                      onChange={(e) => {
                        setProductType(e.target.value);
                        applyFormChanges({ productType: e.target.value });
                      }}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    >
                      {DEFAULT_PRODUCT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Variant Name */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Variant / Custom Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 4 oz Giant Cookie (80/cs)"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        applyFormChanges({ name: e.target.value });
                      }}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  {/* Piece Size & Unit */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Finished Piece Size *
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="any"
                        min="0.01"
                        required
                        value={pieceWeightStr}
                        onChange={(e) => {
                          setPieceWeightStr(e.target.value);
                          applyFormChanges({ pieceWeightStr: e.target.value });
                        }}
                        className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                      <select
                        value={weightUnit}
                        onChange={(e) => {
                          const unit = e.target.value as WeightUnit;
                          setWeightUnit(unit);
                          applyFormChanges({ weightUnit: unit });
                        }}
                        className="w-20 px-2 py-2 text-xs rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-bold"
                      >
                        <option value="oz">oz</option>
                        <option value="g">g</option>
                        <option value="lb">lb</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                  </div>

                  {/* Units per Case & Case Unit */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Units / Case *
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={piecesPerCaseStr}
                        onChange={(e) => {
                          setPiecesPerCaseStr(e.target.value);
                          applyFormChanges({ piecesPerCaseStr: e.target.value });
                        }}
                        className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                      <select
                        value={unitName}
                        onChange={(e) => {
                          setUnitName(e.target.value);
                          applyFormChanges({ unitName: e.target.value });
                        }}
                        className="w-24 px-2 py-2 text-xs rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500 capitalize font-medium"
                      >
                        <option value="case">case</option>
                        <option value="box">box</option>
                        <option value="tray">tray</option>
                        <option value="tub">tub</option>
                        <option value="pack">pack</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Proportional Finished Dough Weight Info */}
                <div className="flex items-center gap-2 p-3 rounded-xl bg-stone-50 dark:bg-zinc-800/60 border border-stone-200/80 dark:border-zinc-700 text-xs text-stone-600 dark:text-zinc-300 font-medium">
                  <Scale className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Required finished dough per case: <strong className="font-mono text-stone-900 dark:text-zinc-100">{totalDoughOz.toFixed(2)} oz</strong> ({totalDoughGrams.toLocaleString()} g). Scaled proportionally from base formula weight ({formula.totalWeightGrams.toLocaleString()} g).
                  </span>
                </div>
              </div>

              {/* Card 2: Direct Production Cost Inputs */}
              <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-stone-100 dark:border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-zinc-200">
                      Direct Production Cost Inputs (Per Case)
                    </h4>
                  </div>
                  <span className="text-[11px] text-stone-400">
                    Blank = Incomplete • $0.00 = No cost
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Packaging Cost */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Packaging Cost ($) / Case
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-xs font-mono text-stone-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={packagingCostStr}
                        onChange={(e) => {
                          setPackagingCostStr(e.target.value);
                          applyFormChanges({ packagingCostStr: e.target.value });
                        }}
                        className="w-full pl-7 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <span className="text-[10px] text-stone-400 mt-1 block">
                      Boxes, liners, labels, tape
                    </span>
                  </div>

                  {/* Labor Cost */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Labor Cost ($) / Case
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-xs font-mono text-stone-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={laborCostStr}
                        onChange={(e) => {
                          setLaborCostStr(e.target.value);
                          applyFormChanges({ laborCostStr: e.target.value });
                        }}
                        className="w-full pl-7 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <span className="text-[10px] text-stone-400 mt-1 block">
                      Direct mixing, portioning, packing
                    </span>
                  </div>

                  {/* Other Direct Cost */}
                  <div>
                    <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                      Other Direct Cost ($) / Case
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-xs font-mono text-stone-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={otherCostStr}
                        onChange={(e) => {
                          setOtherCostStr(e.target.value);
                          applyFormChanges({ otherCostStr: e.target.value });
                        }}
                        className="w-full pl-7 pr-3 py-2 text-xs font-mono font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <span className="text-[10px] text-stone-400 mt-1 block">
                      Special tooling, freight, dry ice
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: SECTION A — TARGET PRICING MODEL */}
              <div className="p-5 sm:p-6 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border-2 border-amber-200 dark:border-amber-800/60 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/80 dark:border-amber-800/60 pb-3">
                  <div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                      Section A
                    </span>
                    <h4 className="font-serif font-bold text-base sm:text-lg text-amber-950 dark:text-amber-100 mt-1">
                      TARGET PRICING MODEL
                    </h4>
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300 max-w-md leading-relaxed">
                    Calculates recommended selling price from the bakery's pricing rules. Multiplier applies <strong>strictly</strong> to raw ingredients; packaging, labor, and other costs remain additive.
                  </p>
                </div>

                {/* Multiplier Input & Equation Banner */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800/40">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-bold text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                      Ingredient Multiplier *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="e.g. 1.61"
                      value={multiplierStr}
                      onChange={(e) => {
                        setMultiplierStr(e.target.value);
                        applyFormChanges({ multiplierStr: e.target.value });
                      }}
                      className="w-28 px-3 py-2 text-xs font-mono font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div className="text-[11px] font-mono text-stone-500 dark:text-zinc-400 bg-stone-50 dark:bg-zinc-800 px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-700">
                    Target Price / Case = (Raw Ingredients × {parseFloat(multiplierStr) || '—'}) + Packaging + Labor + Other
                  </div>
                </div>

                {/* TARGET PRICING FINANCIAL METRICS HIERARCHY (Cost / Unit & Suggested Selling Price / Unit) */}
                <PricingSummaryHierarchy
                  mode="target"
                  costPerCase={activeConfig.totalProductionCost}
                  suggestedPricePerCase={activeConfig.calculatedTargetPrice}
                  expectedProfitPerCase={activeConfig.targetDollarProfit ?? 0}
                  grossMarginPercent={activeConfig.targetGrossMarginPercent ?? 0}
                  costPerUnit={activeConfig.costPerUnit != null ? activeConfig.costPerUnit : (activeConfig.piecesPerCase > 0 ? activeConfig.totalProductionCost / activeConfig.piecesPerCase : 0)}
                  suggestedPricePerUnit={activeConfig.targetPricePerUnit != null ? activeConfig.targetPricePerUnit : (activeConfig.piecesPerCase > 0 ? activeConfig.calculatedTargetPrice / activeConfig.piecesPerCase : 0)}
                  unitName={activeConfig.unitName || 'unit'}
                  rawIngredientCostPerCase={activeConfig.rawIngredientCost}
                  markupPercent={activeConfig.targetMarkupPercent ?? 0}
                  isTargetComplete={activeConfig.isTargetPriceComplete}
                />
              </div>

              {/* Card 4: SECTION B — INTERACTIVE QUOTED PRICING */}
              <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-stone-300 dark:border-zinc-700 shadow-md space-y-6">
                {/* Section Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 dark:border-zinc-800 pb-3">
                  <div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-stone-200 dark:bg-zinc-700 text-stone-800 dark:text-zinc-200">
                      Section B
                    </span>
                    <h4 className="font-serif font-bold text-base sm:text-lg text-stone-900 dark:text-zinc-100 mt-1">
                      INTERACTIVE QUOTED PRICING
                    </h4>
                  </div>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 max-w-md leading-relaxed">
                    Calculate commercial selling price using one of four pricing methods. Select a method, then enter a value to evaluate commercial profitability.
                  </p>
                </div>

                {/* 4 Mutually Exclusive Pricing Input Modes with Radio Buttons */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-zinc-300">
                      Pricing Method (Choose One)
                    </span>
                    <span className="text-[11px] text-stone-400">
                      Only active method is enabled • Inactive fields remain blank
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                    {/* MODE A: PRICE PER CASE */}
                    <div
                      data-testid="pricing-method-case-card"
                      onClick={() => handleMethodSelect('price_per_case')}
                      className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                        quotedMethod === 'price_per_case'
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-500 shadow-xs ring-2 ring-amber-500/20'
                          : 'bg-stone-50/60 dark:bg-zinc-800/50 border-stone-200 dark:border-zinc-700/80 hover:border-stone-300 opacity-90'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="radio"
                            data-testid="pricing-method-case"
                            name={`pricing-method-${activeConfig.id}`}
                            value="price_per_case"
                            checked={quotedMethod === 'price_per_case'}
                            onChange={() => handleMethodSelect('price_per_case')}
                            className="w-4 h-4 text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                          />
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-zinc-100">
                            A. Price Per Case
                          </span>
                        </label>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-zinc-700 text-stone-600 dark:text-zinc-300">
                          $/case
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400 mb-3">
                        Enter quoted selling price per case. Unit price derives automatically.
                      </p>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-sm font-mono text-stone-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          data-testid="quoted-price-case-input"
                          placeholder={quotedMethod === 'price_per_case' ? '0.00 (Enter price / case)' : ''}
                          disabled={quotedMethod !== 'price_per_case'}
                          value={quotedMethod === 'price_per_case' ? casePriceInput : ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCasePriceInput(val);
                            applyFormChanges({ casePriceInput: val });
                          }}
                          className={`w-full pl-8 pr-3 py-2 text-sm font-mono font-bold rounded-xl border transition-all ${
                            quotedMethod === 'price_per_case'
                              ? 'border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500'
                              : 'border-transparent bg-stone-100/70 dark:bg-zinc-800/60 text-stone-400 dark:text-zinc-600 cursor-not-allowed'
                          }`}
                        />
                      </div>
                    </div>

                    {/* MODE B: PRICE PER UNIT */}
                    <div
                      data-testid="pricing-method-unit-card"
                      onClick={() => handleMethodSelect('price_per_unit')}
                      className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                        quotedMethod === 'price_per_unit'
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-500 shadow-xs ring-2 ring-amber-500/20'
                          : 'bg-stone-50/60 dark:bg-zinc-800/50 border-stone-200 dark:border-zinc-700/80 hover:border-stone-300 opacity-90'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="radio"
                            data-testid="pricing-method-unit"
                            name={`pricing-method-${activeConfig.id}`}
                            value="price_per_unit"
                            checked={quotedMethod === 'price_per_unit'}
                            onChange={() => handleMethodSelect('price_per_unit')}
                            className="w-4 h-4 text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                          />
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-zinc-100">
                            B. Price Per Unit
                          </span>
                        </label>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-zinc-700 text-stone-600 dark:text-zinc-300">
                          $/unit
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400 mb-3">
                        Enter quoted price per unit. Case price = unit price × {activeConfig.piecesPerCase} units.
                      </p>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-sm font-mono text-stone-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          data-testid="quoted-price-unit-input"
                          placeholder={quotedMethod === 'price_per_unit' ? '0.00 (Enter price / unit)' : ''}
                          disabled={quotedMethod !== 'price_per_unit'}
                          value={quotedMethod === 'price_per_unit' ? unitPriceInput : ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const val = e.target.value;
                            setUnitPriceInput(val);
                            applyFormChanges({ unitPriceInput: val });
                          }}
                          className={`w-full pl-8 pr-3 py-2 text-sm font-mono font-bold rounded-xl border transition-all ${
                            quotedMethod === 'price_per_unit'
                              ? 'border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500'
                              : 'border-transparent bg-stone-100/70 dark:bg-zinc-800/60 text-stone-400 dark:text-zinc-600 cursor-not-allowed'
                          }`}
                        />
                      </div>
                    </div>

                    {/* MODE C: DESIRED GROSS PROFIT PER CASE */}
                    <div
                      data-testid="pricing-method-profit-card"
                      onClick={() => handleMethodSelect('desired_profit')}
                      className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                        quotedMethod === 'desired_profit'
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-500 shadow-xs ring-2 ring-amber-500/20'
                          : 'bg-stone-50/60 dark:bg-zinc-800/50 border-stone-200 dark:border-zinc-700/80 hover:border-stone-300 opacity-90'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="radio"
                            data-testid="pricing-method-profit"
                            name={`pricing-method-${activeConfig.id}`}
                            value="desired_profit"
                            checked={quotedMethod === 'desired_profit'}
                            onChange={() => handleMethodSelect('desired_profit')}
                            className="w-4 h-4 text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                          />
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-zinc-100">
                            C. Desired Gross Profit Per Case
                          </span>
                        </label>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-zinc-700 text-stone-600 dark:text-zinc-300">
                          Net $
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400 mb-3">
                        Enter desired dollar profit. Quoted case price = COGS (${activeConfig.totalProductionCost.toFixed(2)}) + Desired Profit.
                      </p>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-sm font-mono text-stone-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          data-testid="quoted-desired-profit-input"
                          placeholder={quotedMethod === 'desired_profit' ? '0.00 (Enter profit / case)' : ''}
                          disabled={quotedMethod !== 'desired_profit'}
                          value={quotedMethod === 'desired_profit' ? desiredProfitInput : ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDesiredProfitInput(val);
                            applyFormChanges({ desiredProfitInput: val });
                          }}
                          className={`w-full pl-8 pr-3 py-2 text-sm font-mono font-bold rounded-xl border transition-all ${
                            quotedMethod === 'desired_profit'
                              ? 'border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500'
                              : 'border-transparent bg-stone-100/70 dark:bg-zinc-800/60 text-stone-400 dark:text-zinc-600 cursor-not-allowed'
                          }`}
                        />
                      </div>
                    </div>

                    {/* MODE D: INGREDIENTS MULTIPLIER */}
                    <div
                      data-testid="pricing-method-multiplier-card"
                      onClick={() => handleMethodSelect('ingredients_multiplier')}
                      className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                        quotedMethod === 'ingredients_multiplier'
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-500 shadow-xs ring-2 ring-amber-500/20'
                          : 'bg-stone-50/60 dark:bg-zinc-800/50 border-stone-200 dark:border-zinc-700/80 hover:border-stone-300 opacity-90'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="radio"
                            data-testid="pricing-method-multiplier"
                            name={`pricing-method-${activeConfig.id}`}
                            value="ingredients_multiplier"
                            checked={quotedMethod === 'ingredients_multiplier'}
                            onChange={() => handleMethodSelect('ingredients_multiplier')}
                            className="w-4 h-4 text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                          />
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-zinc-100">
                            D. Ingredients Multiplier
                          </span>
                        </label>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-zinc-700 text-stone-600 dark:text-zinc-300">
                          × Mult
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400 mb-3">
                        Multiplies raw ingredients (${activeConfig.rawIngredientCost.toFixed(2)}) strictly; pack & labor added separately.
                      </p>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-sm font-mono text-stone-400">×</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          data-testid="quoted-multiplier-input"
                          placeholder={quotedMethod === 'ingredients_multiplier' ? 'e.g. 2.50' : ''}
                          disabled={quotedMethod !== 'ingredients_multiplier'}
                          value={quotedMethod === 'ingredients_multiplier' ? multiplierInput : ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMultiplierInput(val);
                            applyFormChanges({ multiplierInput: val });
                          }}
                          className={`w-full pl-8 pr-3 py-2 text-sm font-mono font-bold rounded-xl border transition-all ${
                            quotedMethod === 'ingredients_multiplier'
                              ? 'border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500'
                              : 'border-transparent bg-stone-100/70 dark:bg-zinc-800/60 text-stone-400 dark:text-zinc-600 cursor-not-allowed'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* CALCULATED QUOTE RESULTS (5 EQUALLY PROMINENT CARDS) */}
                <div className="space-y-4 pt-3 border-t border-stone-200 dark:border-zinc-800">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h5
                        data-testid="calculated-quote-results-heading"
                        className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-zinc-100"
                      >
                        CALCULATED QUOTE RESULTS
                      </h5>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          activeConfig.isQuotedPriceSet && activeConfig.quotedPrice != null && activeConfig.quotedPrice > 0
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                            : 'bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400 border-stone-200 dark:border-zinc-700'
                        }`}
                      >
                        {activeConfig.isQuotedPriceSet && activeConfig.quotedPrice != null && activeConfig.quotedPrice > 0
                          ? 'Quote Calculated'
                          : 'Awaiting Valid Input'}
                      </span>
                    </div>
                  </div>

                  {(!activeConfig.isQuotedPriceSet || activeConfig.quotedPrice == null || activeConfig.quotedPrice === 0) && (
                    <div
                      data-testid="unquoted-notice-banner"
                      className="p-3.5 rounded-xl bg-stone-50 dark:bg-zinc-800/60 border border-dashed border-stone-300 dark:border-zinc-700 text-center space-y-1"
                    >
                      <p className="text-xs font-semibold text-stone-600 dark:text-zinc-300">
                        Actual quoted price has not been calculated yet.
                      </p>
                      <p className="text-[11px] text-stone-400 dark:text-zinc-500">
                        Select one of the four pricing methods above and enter a value to calculate quoted selling price, gross profit, and margin.
                      </p>
                    </div>
                  )}

                  <PricingSummaryHierarchy
                    mode="actual"
                    costPerCase={activeConfig.totalProductionCost}
                    suggestedPricePerCase={activeConfig.calculatedTargetPrice}
                    actualQuotedPricePerCase={activeConfig.isQuotedPriceSet ? activeConfig.quotedPrice : null}
                    actualQuotedPricePerUnit={activeConfig.isQuotedPriceSet ? (activeConfig.quotedPricePerUnit ?? activeConfig.unitPrice) : null}
                    expectedProfitPerCase={activeConfig.isQuotedPriceSet ? activeConfig.dollarProfit : 0}
                    grossMarginPercent={activeConfig.isQuotedPriceSet ? activeConfig.grossMarginPercent : 0}
                    costPerUnit={activeConfig.costPerUnit != null ? activeConfig.costPerUnit : (activeConfig.piecesPerCase > 0 ? activeConfig.totalProductionCost / activeConfig.piecesPerCase : 0)}
                    suggestedPricePerUnit={activeConfig.targetPricePerUnit != null ? activeConfig.targetPricePerUnit : (activeConfig.piecesPerCase > 0 ? activeConfig.calculatedTargetPrice / activeConfig.piecesPerCase : 0)}
                    unitName={activeConfig.unitName || 'unit'}
                    rawIngredientCostPerCase={activeConfig.rawIngredientCost}
                    markupPercent={activeConfig.isQuotedPriceSet ? activeConfig.markupPercent : 0}
                    isTargetComplete={activeConfig.isTargetPriceComplete}
                  />
                </div>
              </div>

              {/* Card 5: SECTION C — TARGET VS ACTUAL PRICING COMPARISON */}
              {activeConfig.isTargetPriceComplete &&
                activeConfig.quotedPrice != null &&
                activeConfig.quotedPrice > 0 && (
                  <div className="p-5 rounded-2xl bg-stone-50 dark:bg-zinc-800/80 border border-stone-200 dark:border-zinc-700 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 border-b border-stone-200 dark:border-zinc-700 pb-3">
                      <TrendingUp className="w-4 h-4 text-stone-600 dark:text-zinc-300" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-zinc-200">
                        Target vs Actual Pricing Comparison
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* Target Summary */}
                      <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-700">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-stone-400 block mb-1">
                          Target Pricing Model
                        </span>
                        <div className="text-base font-mono font-bold text-amber-800 dark:text-amber-300">
                          ${activeConfig.calculatedTargetPrice.toFixed(2)} / case
                        </div>
                        <div className="text-xs font-mono text-stone-500 dark:text-zinc-400 mt-0.5">
                          ${activeConfig.targetPricePerUnit.toFixed(2)} / unit • {(activeConfig.targetGrossMarginPercent ?? 0).toFixed(1)}% margin
                        </div>
                      </div>

                      {/* Actual Quote Summary */}
                      <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-700">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-stone-400 block mb-1">
                          Actual Quoted Price
                        </span>
                        <div className="text-base font-mono font-bold text-stone-900 dark:text-zinc-100">
                          ${activeConfig.quotedPrice.toFixed(2)} / case
                        </div>
                        <div className="text-xs font-mono text-stone-500 dark:text-zinc-400 mt-0.5">
                          ${(activeConfig.quotedPricePerUnit ?? activeConfig.unitPrice).toFixed(2)} / unit • {activeConfig.grossMarginPercent.toFixed(1)}% margin
                        </div>
                      </div>

                      {/* Variance Comparison */}
                      <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-700">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-stone-400 block mb-1">
                          Commercial Variance
                        </span>
                        {Math.abs(activeConfig.targetVarianceDollars) < 0.005 ? (
                          <div>
                            <div className="text-base font-mono font-bold text-stone-700 dark:text-zinc-300">
                              $0.00 / case
                            </div>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300">
                              Exactly on target
                            </span>
                          </div>
                        ) : activeConfig.targetVarianceDollars > 0 ? (
                          <div>
                            <div className="text-base font-mono font-bold text-stone-800 dark:text-zinc-200">
                              +${activeConfig.targetVarianceDollars.toFixed(2)} / case
                            </div>
                            <div className="text-xs font-mono text-stone-500 dark:text-zinc-400 mt-0.5">
                              +${(activeConfig.targetVarianceUnitDollars ?? 0).toFixed(2)} / unit
                            </div>
                            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200 border border-stone-200 dark:border-zinc-700">
                              ${activeConfig.targetVarianceDollars.toFixed(2)} above target ({Math.abs(activeConfig.targetVariancePercent ?? 0).toFixed(2)}% above target)
                            </span>
                          </div>
                        ) : (
                          <div>
                            <div className="text-base font-mono font-bold text-stone-800 dark:text-zinc-200">
                              -${Math.abs(activeConfig.targetVarianceDollars).toFixed(2)} / case
                            </div>
                            <div className="text-xs font-mono text-stone-500 dark:text-zinc-400 mt-0.5">
                              -${Math.abs(activeConfig.targetVarianceUnitDollars ?? 0).toFixed(2)} / unit
                            </div>
                            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-stone-100 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200 border border-stone-200 dark:border-zinc-700">
                              ${Math.abs(activeConfig.targetVarianceDollars).toFixed(2)} below target ({Math.abs(activeConfig.targetVariancePercent ?? 0).toFixed(2)}% below target)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* Packaging Preset Selector Modal */}
      <PackagingPresetSelectorModal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        presets={presets}
        categoryHint={projectCategory}
        workspaceId={workspaceId}
        onSelectPreset={handleSelectPreset}
        onSelectCustom={handleSelectCustom}
      />
    </div>
  );
};
