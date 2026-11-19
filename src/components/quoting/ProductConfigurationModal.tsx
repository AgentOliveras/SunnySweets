import React, { useState, useEffect, useMemo } from 'react';
import { X, DollarSign, Package, Users, Layers, TrendingUp, Sparkles } from 'lucide-react';
import { QuoteProductConfig, QuoteFormula, DEFAULT_PRODUCT_TYPES } from '../../types/quoting';
import { WeightUnit } from '../../types';
import { calculateProductPricing } from '../../utils/quotingCalculator';
import { PricingSummaryHierarchy } from './PricingSummaryHierarchy';

interface ProductConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: QuoteProductConfig) => void;
  formula: QuoteFormula;
  initialConfig?: QuoteProductConfig | null;
  defaultMultiplier?: number;
}

export const ProductConfigurationModal: React.FC<ProductConfigurationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  formula,
  initialConfig,
  defaultMultiplier = 1.6,
}) => {
  const [productType, setProductType] = useState<string>('Cookie');
  const [name, setName] = useState('');
  const [pieceWeight, setPieceWeight] = useState('4');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('oz');
  const [piecesPerCase, setPiecesPerCase] = useState('80');
  const [unitName, setUnitName] = useState('case');
  const [packagingCost, setPackagingCost] = useState('3.00');
  const [laborCost, setLaborCost] = useState('11.45');
  const [otherCost, setOtherCost] = useState('0.00');
  const [ingredientMultiplier, setIngredientMultiplier] = useState(defaultMultiplier.toString());
  const [quotedPrice, setQuotedPrice] = useState('80.82');

  useEffect(() => {
    if (initialConfig) {
      setProductType(initialConfig.productType || 'Cookie');
      setName(initialConfig.name);
      setPieceWeight(initialConfig.pieceWeight.toString());
      setWeightUnit(initialConfig.weightUnit);
      setPiecesPerCase(initialConfig.piecesPerCase.toString());
      setUnitName(initialConfig.unitName || 'case');
      setPackagingCost(initialConfig.packagingCost.toString());
      setLaborCost(initialConfig.laborCost.toString());
      setOtherCost(initialConfig.otherCost.toString());
      setIngredientMultiplier(initialConfig.ingredientMultiplier.toString());
      setQuotedPrice(initialConfig.quotedPrice.toString());
    } else {
      // Defaults
      setProductType('Cookie');
      setName('');
      setPieceWeight('4');
      setWeightUnit('oz');
      setPiecesPerCase('80');
      setUnitName('case');
      setPackagingCost('3.00');
      setLaborCost('11.45');
      setOtherCost('0.00');
      setIngredientMultiplier(defaultMultiplier.toString());
      setQuotedPrice('80.82');
    }
  }, [initialConfig, isOpen, defaultMultiplier]);

  // Live calculation preview
  const livePreview = useMemo(() => {
    const pWeight = parseFloat(pieceWeight) || 0;
    const pCount = parseInt(piecesPerCase, 10) || 0;
    const pkg = parseFloat(packagingCost) || 0;
    const lbr = parseFloat(laborCost) || 0;
    const oth = parseFloat(otherCost) || 0;
    const mult = parseFloat(ingredientMultiplier) || 1.0;
    const qPrice = parseFloat(quotedPrice) || 0;

    return calculateProductPricing({
      id: initialConfig?.id,
      productType,
      name,
      pieceWeight: pWeight,
      weightUnit,
      piecesPerCase: pCount,
      unitName,
      packagingCost: pkg,
      laborCost: lbr,
      otherCost: oth,
      ingredientMultiplier: mult,
      quotedPrice: qPrice,
      formula,
    });
  }, [
    initialConfig,
    productType,
    name,
    pieceWeight,
    weightUnit,
    piecesPerCase,
    unitName,
    packagingCost,
    laborCost,
    otherCost,
    ingredientMultiplier,
    quotedPrice,
    formula,
  ]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(livePreview);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-stone-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
                {initialConfig ? 'Edit Product Configuration' : 'Add Sellable Product Configuration'}
              </h3>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Define portion size, case count, packaging, labor, and commercial pricing.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-600 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* Row 1: Product Type & Variant Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Product Type *
              </label>
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                {DEFAULT_PRODUCT_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Variant Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. 4 oz Standard Wholesale Case"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Row 2: Piece Weight, Unit, Pieces per Case */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Piece Size *
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={pieceWeight}
                onChange={(e) => setPieceWeight(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Weight Unit *
              </label>
              <select
                value={weightUnit}
                onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                <option value="oz">oz (Ounces)</option>
                <option value="g">g (Grams)</option>
                <option value="lb">lb (Pounds)</option>
                <option value="kg">kg (Kilograms)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Units / Case *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={piecesPerCase}
                onChange={(e) => setPiecesPerCase(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Case Unit
              </label>
              <input
                type="text"
                placeholder="case"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Row 3: Direct Cost Inputs */}
          <div className="p-4 rounded-xl bg-stone-50 dark:bg-zinc-800/60 border border-stone-200 dark:border-zinc-700 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 dark:text-zinc-400">
              Direct Production Cost Inputs (Per {unitName.toUpperCase()})
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                  Packaging Cost ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={packagingCost}
                  onChange={(e) => setPackagingCost(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                  Labor Cost ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-zinc-300 mb-1">
                  Other Direct Cost ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={otherCost}
                  onChange={(e) => setOtherCost(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Row 4: Commercial Pricing Model (Multiplier vs Quoted Price) */}
          <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
              Commercial Pricing Model
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Ingredient Multiplier
                  </label>
                  <span className="text-[10px] text-amber-700 dark:text-amber-400">
                    Applies strictly to raw ingredients
                  </span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="1.0"
                  value={ingredientMultiplier}
                  onChange={(e) => setIngredientMultiplier(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold font-mono rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 text-amber-900 dark:text-amber-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1">
                  Target = (Raw Ingredients × {parseFloat(ingredientMultiplier) || 1}) + Packaging + Labor + Other
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-stone-900 dark:text-zinc-100">
                    Actual Quoted Selling Price ($) *
                  </label>
                  <span className="text-[10px] text-stone-500 dark:text-zinc-400">
                    Target: ${livePreview.calculatedTargetPrice.toFixed(2)}
                  </span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={quotedPrice}
                  onChange={(e) => setQuotedPrice(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold font-mono rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
                <div className="flex items-center justify-between mt-1 text-[11px]">
                  <span className="text-stone-500">Unit: ${livePreview.unitPrice.toFixed(2)} / ea</span>
                  <button
                    type="button"
                    onClick={() => setQuotedPrice(livePreview.calculatedTargetPrice.toFixed(2))}
                    className="text-amber-700 dark:text-amber-400 font-semibold hover:underline"
                  >
                    Match Target Price
                  </button>
                </div>
              </div>
            </div>

            {/* Live Economics KPI Summary */}
            <div className="pt-3 border-t border-amber-200 dark:border-amber-900/60">
              <PricingSummaryHierarchy
                mode="actual"
                costPerCase={livePreview.totalProductionCost}
                suggestedPricePerCase={livePreview.calculatedTargetPrice}
                actualQuotedPricePerCase={livePreview.quotedPrice}
                actualQuotedPricePerUnit={livePreview.unitPrice}
                expectedProfitPerCase={livePreview.dollarProfit}
                grossMarginPercent={livePreview.grossMarginPercent}
                costPerUnit={livePreview.costPerUnit}
                suggestedPricePerUnit={livePreview.targetPricePerUnit}
                unitName={unitName || 'case'}
                rawIngredientCostPerCase={livePreview.rawIngredientCost}
                markupPercent={livePreview.markupPercent}
                isTargetComplete={livePreview.isTargetPriceComplete}
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              {initialConfig ? 'Update Configuration' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
