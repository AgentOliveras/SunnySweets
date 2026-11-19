import React from 'react';
import { TrendingUp, TrendingDown, Minus, DollarSign, Percent, ShieldCheck } from 'lucide-react';

interface PricingSummaryHierarchyProps {
  // Primary Metrics
  costPerCase: number;              // Fully loaded COGS / Case
  suggestedPricePerCase: number;    // Suggested Selling Price / Case (from target pricing model)
  expectedProfitPerCase: number;    // Expected Gross Profit / Case
  grossMarginPercent: number;       // Gross Margin %
  // Secondary Metrics
  costPerUnit: number;              // Cost / Unit
  suggestedPricePerUnit: number;    // Suggested Selling Price / Unit
  unitName?: string;                // e.g. "unit", "piece", "ea"
  // Tertiary Metrics
  rawIngredientCostPerCase: number; // Raw Ingredient Cost / Case
  markupPercent: number;            // Markup %
  // Context & Mode
  isTargetComplete?: boolean;
  actualQuotedPricePerCase?: number | null;
  actualQuotedPricePerUnit?: number | null;
  mode: 'target' | 'actual';        // 'target' = Target Pricing Model, 'actual' = Management Actual Quoted
}

export const PricingSummaryHierarchy: React.FC<PricingSummaryHierarchyProps> = ({
  costPerCase,
  suggestedPricePerCase,
  expectedProfitPerCase,
  grossMarginPercent,
  costPerUnit,
  suggestedPricePerUnit,
  unitName = 'unit',
  rawIngredientCostPerCase,
  markupPercent,
  isTargetComplete = true,
  actualQuotedPricePerCase,
  actualQuotedPricePerUnit,
  mode,
}) => {
  const isActual = mode === 'actual';

  // Format currency helpers
  const fmtCurrency = (val: number | null | undefined, fallback = '—') => {
    if (val === null || val === undefined || isNaN(val)) return fallback;
    return `$${val.toFixed(2)}`;
  };

  const fmtProfit = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (Math.abs(val) < 0.005) return '$0.00';
    if (val > 0) return `+$${val.toFixed(2)}`;
    return `-$${Math.abs(val).toFixed(2)}`;
  };

  const fmtPercent = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return `${val.toFixed(2)}%`;
  };

  // Safe visual breakdown calculations:
  // Total Selling Price = COGS + Gross Profit (or max(COGS, Selling Price) if negative profit)
  const hasActualQuote = isActual ? actualQuotedPricePerCase != null : true;
  const sellingPrice = isActual
    ? (actualQuotedPricePerCase ?? suggestedPricePerCase)
    : suggestedPricePerCase;

  const isProfitable = hasActualQuote && expectedProfitPerCase > 0.005;
  const isBreakEven = hasActualQuote && Math.abs(expectedProfitPerCase) <= 0.005;
  const isLoss = hasActualQuote && expectedProfitPerCase < -0.005;

  // Determine percentages for visual bar
  let cogsPct = 0;
  let profitPct = 0;
  let lossPct = 0;

  if (hasActualQuote && sellingPrice > 0 && costPerCase >= 0) {
    if (isProfitable) {
      cogsPct = Math.min(100, Math.max(0, (costPerCase / sellingPrice) * 100));
      profitPct = Math.min(100, Math.max(0, 100 - cogsPct));
    } else if (isBreakEven) {
      cogsPct = 100;
      profitPct = 0;
    } else {
      // Selling price below COGS: cost exceeds price
      // Base bar is costPerCase, showing what portion is covered vs loss
      cogsPct = Math.min(100, Math.max(0, (sellingPrice / costPerCase) * 100));
      lossPct = Math.max(0, 100 - cogsPct);
    }
  } else if (costPerCase > 0) {
    cogsPct = 100;
  }

  // Margin color badges
  const marginBadgeClass = !hasActualQuote
    ? 'text-stone-500 dark:text-zinc-400 bg-stone-100 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700'
    : isProfitable
      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800'
      : isBreakEven
        ? 'text-stone-700 dark:text-stone-300 bg-stone-100 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700'
        : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800';

  return (
    <div className="space-y-4">
      {/* Tier Label & Context */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
            {isActual ? 'Management Quoted Economics' : 'Target Economic Structure'}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              isActual
                ? 'bg-stone-100 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 border-stone-300 dark:border-zinc-700'
                : 'bg-amber-100/80 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-800'
            }`}
          >
            {isActual ? 'Actual Quote' : 'Suggested Target'}
          </span>
        </div>

        {/* Profitability Status Pill */}
        <div className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1 ${marginBadgeClass}`}>
          {isProfitable && <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
          {isBreakEven && <Minus className="w-3 h-3 text-stone-500" />}
          {isLoss && <TrendingDown className="w-3 h-3 text-rose-600 dark:text-rose-400" />}
          <span>
            {!hasActualQuote
              ? 'Awaiting Quote Entry'
              : isProfitable
                ? 'Positive Margin'
                : isBreakEven
                  ? 'Break-Even (0%)'
                  : 'Negative Margin / Loss'}
          </span>
        </div>
      </div>

      {/* PRIMARY TIER: 5 Equally Prominent Core Metric Cards */}
      {/* Responsive layout: grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* 1. COST PER CASE */}
        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-stone-200 dark:border-zinc-800 shadow-xs hover:border-stone-300 transition-colors flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                Cost Per Case
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400">
                COGS
              </span>
            </div>
            <div className="text-xl font-mono font-extrabold text-stone-900 dark:text-zinc-100">
              {fmtCurrency(costPerCase)}
            </div>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-zinc-500 mt-2">
            Ingredients + pack + labor + other
          </p>
        </div>

        {/* 2. SUGGESTED PRICE PER CASE (or QUOTED PRICE PER CASE) */}
        <div
          className={`p-4 rounded-2xl border-2 shadow-xs transition-colors flex flex-col justify-between ${
            isActual
              ? 'bg-white dark:bg-zinc-900 border-stone-300 dark:border-zinc-700'
              : 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700/60'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  isActual ? 'text-stone-700 dark:text-zinc-300' : 'text-amber-900 dark:text-amber-200'
                }`}
              >
                {isActual ? 'Actual Quoted Price / Case' : 'Suggested Price / Case'}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  isActual
                    ? 'bg-stone-200 dark:bg-zinc-800 text-stone-800 dark:text-zinc-200'
                    : 'bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200'
                }`}
              >
                {isActual ? 'Quoted' : 'Target'}
              </span>
            </div>
            <div
              className={`text-xl font-mono font-extrabold ${
                isActual ? 'text-stone-900 dark:text-zinc-100' : 'text-amber-900 dark:text-amber-200'
              }`}
            >
              {isActual
                ? fmtCurrency(actualQuotedPricePerCase)
                : isTargetComplete
                  ? fmtCurrency(suggestedPricePerCase)
                  : '—'}
            </div>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-zinc-500 mt-2">
            {isActual ? 'Management quoted case price' : 'Calculated target price'}
          </p>
        </div>

        {/* 3. SUGGESTED PRICE PER UNIT (or QUOTED PRICE PER UNIT) */}
        <div
          className={`p-4 rounded-2xl border-2 shadow-xs transition-colors flex flex-col justify-between ${
            isActual
              ? 'bg-white dark:bg-zinc-900 border-stone-300 dark:border-zinc-700'
              : 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700/60'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  isActual ? 'text-stone-700 dark:text-zinc-300' : 'text-amber-900 dark:text-amber-200'
                }`}
              >
                {isActual ? 'Actual Quoted Price / Unit' : 'Suggested Price / Unit'}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400 lowercase">
                per {unitName}
              </span>
            </div>
            <div
              className={`text-xl font-mono font-extrabold ${
                isActual ? 'text-stone-900 dark:text-zinc-100' : 'text-amber-900 dark:text-amber-200'
              }`}
            >
              {isActual
                ? fmtCurrency(actualQuotedPricePerUnit)
                : isTargetComplete
                  ? fmtCurrency(suggestedPricePerUnit)
                  : '—'}
            </div>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-zinc-500 mt-2">
            Selling price per individual unit
          </p>
        </div>

        {/* 4. EXPECTED GROSS PROFIT PER CASE */}
        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-stone-200 dark:border-zinc-800 shadow-xs hover:border-stone-300 transition-colors flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                {isActual ? 'Gross Profit / Case' : 'Expected Gross Profit / Case'}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400">
                Net $
              </span>
            </div>
            <div
              className={`text-xl font-mono font-extrabold ${
                !hasActualQuote
                  ? 'text-stone-400 dark:text-zinc-600'
                  : isProfitable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isBreakEven
                      ? 'text-stone-700 dark:text-zinc-300'
                      : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {!isActual
                ? !isTargetComplete
                  ? '—'
                  : fmtProfit(expectedProfitPerCase)
                : !hasActualQuote
                  ? '—'
                  : fmtProfit(expectedProfitPerCase)}
            </div>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-zinc-500 mt-2">
            Selling price minus COGS
          </p>
        </div>

        {/* 5. GROSS MARGIN */}
        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-stone-200 dark:border-zinc-800 shadow-xs hover:border-stone-300 transition-colors flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                Gross Margin
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400">
                Margin
              </span>
            </div>
            <div
              className={`text-xl font-mono font-extrabold ${
                !hasActualQuote || (isActual && actualQuotedPricePerCase === 0)
                  ? 'text-stone-400 dark:text-zinc-600'
                  : isProfitable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isBreakEven
                      ? 'text-stone-700 dark:text-zinc-300'
                      : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {!isActual
                ? !isTargetComplete
                  ? '—'
                  : fmtPercent(grossMarginPercent)
                : !hasActualQuote || actualQuotedPricePerCase === 0
                  ? '—'
                  : fmtPercent(grossMarginPercent)}
            </div>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-zinc-500 mt-2">
            Gross profit ÷ selling price
          </p>
        </div>
      </div>

      {/* Cost-versus-Profit Visual Breakdown Bar */}
      <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-zinc-900/60 border border-stone-200 dark:border-zinc-800 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-stone-600 dark:text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-stone-400 dark:bg-zinc-500 inline-block" />
            <span>Cost of Goods (COGS): {cogsPct.toFixed(1)}%</span>
          </div>

          {isProfitable && (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
              <span className="text-emerald-700 dark:text-emerald-400">Gross Profit: {profitPct.toFixed(1)}%</span>
            </div>
          )}

          {isBreakEven && (
            <span className="text-stone-500">Break-even (0% Profit)</span>
          )}

          {isLoss && (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
              <span className="text-rose-600 dark:text-rose-400">Shortfall / Loss: {lossPct.toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Stacked Progress Bar */}
        <div className="h-2.5 w-full bg-stone-200 dark:bg-zinc-800 rounded-full overflow-hidden flex">
          {isProfitable && (
            <>
              <div
                style={{ width: `${cogsPct}%` }}
                className="bg-stone-400 dark:bg-zinc-500 h-full transition-all"
                title={`COGS: ${cogsPct.toFixed(1)}%`}
              />
              <div
                style={{ width: `${profitPct}%` }}
                className="bg-emerald-500 h-full transition-all"
                title={`Gross Profit: ${profitPct.toFixed(1)}%`}
              />
            </>
          )}

          {isBreakEven && (
            <div
              style={{ width: '100%' }}
              className="bg-stone-400 dark:bg-zinc-500 h-full transition-all"
              title="Break-even: 100% COGS"
            />
          )}

          {isLoss && (
            <>
              <div
                style={{ width: `${cogsPct}%` }}
                className="bg-stone-400 dark:bg-zinc-500 h-full transition-all"
                title={`Covered Revenue: ${cogsPct.toFixed(1)}%`}
              />
              <div
                style={{ width: `${lossPct}%` }}
                className="bg-rose-500 h-full transition-all"
                title={`Uncovered Cost: ${lossPct.toFixed(1)}%`}
              />
            </>
          )}
        </div>
      </div>

      {/* SECONDARY & TERTIARY TIERS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {/* SECONDARY TIER: Unit Economics */}
        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 space-y-2">
          <div className="flex items-center justify-between border-b border-stone-100 dark:border-zinc-800 pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
              Secondary: Unit Economics
            </span>
            <span className="text-[10px] text-stone-400 dark:text-zinc-500 lowercase">
              per {unitName}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-stone-500 dark:text-zinc-400 block mb-0.5">
                Cost / Unit
              </span>
              <span className="text-sm font-mono font-bold text-stone-800 dark:text-zinc-200">
                {fmtCurrency(costPerUnit)}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-stone-500 dark:text-zinc-400 block mb-0.5">
                {isActual ? 'Quoted Price / Unit' : 'Suggested Price / Unit'}
              </span>
              <span
                className={`text-sm font-mono font-bold ${
                  isActual ? 'text-stone-900 dark:text-zinc-100' : 'text-amber-800 dark:text-amber-300'
                }`}
              >
                {isActual
                  ? fmtCurrency(actualQuotedPricePerUnit)
                  : isTargetComplete
                    ? fmtCurrency(suggestedPricePerUnit)
                    : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* TERTIARY TIER: Cost Structure & Markup */}
        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 space-y-2">
          <div className="flex items-center justify-between border-b border-stone-100 dark:border-zinc-800 pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400">
              Tertiary: Cost Structure & Markup
            </span>
            <span className="text-[10px] text-stone-400 dark:text-zinc-500">
              details
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-stone-500 dark:text-zinc-400 block mb-0.5">
                Raw Ingredients / Case
              </span>
              <span className="text-sm font-mono font-bold text-stone-800 dark:text-zinc-200">
                {fmtCurrency(rawIngredientCostPerCase)}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-stone-500 dark:text-zinc-400 block mb-0.5">
                Markup %
              </span>
              <span
                className={`text-sm font-mono font-bold ${
                  markupPercent >= 0
                    ? 'text-stone-800 dark:text-zinc-200'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {!isActual && !isTargetComplete ? '—' : fmtPercent(markupPercent)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
