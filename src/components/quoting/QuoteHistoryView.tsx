import React, { useState } from 'react';
import {
  History,
  FileText,
  Calendar,
  User,
  ChevronDown,
  Layers,
  Package,
  DollarSign,
  Lock,
} from 'lucide-react';
import { ProductProject, QuoteRevision } from '../../types/quoting';

interface QuoteHistoryViewProps {
  project: ProductProject;
  onIssueRevision: () => void;
}

export const QuoteHistoryView: React.FC<QuoteHistoryViewProps> = ({
  project,
  onIssueRevision,
}) => {
  const [expandedRevId, setExpandedRevId] = useState<string | null>(
    project.revisions && project.revisions.length > 0 ? project.revisions[0].id : null
  );

  const revisions = project.revisions || [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
              Commercial Quote History & Revisions
            </h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <Lock className="w-3 h-3" />
              <span>Immutable Economic Snapshots</span>
            </span>
          </div>
          <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
            Every issued quote preserves an immutable record of ingredient costs, packaging, labor, and commercial margins.
          </p>
        </div>

        <button
          type="button"
          onClick={onIssueRevision}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <FileText className="w-4 h-4" />
          <span>+ Issue New Quote Revision</span>
        </button>
      </div>

      {/* Revision List */}
      {revisions.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-xs space-y-3">
          <History className="w-10 h-10 text-stone-300 dark:text-zinc-600 mx-auto" />
          <h4 className="text-sm font-bold text-stone-700 dark:text-zinc-300">
            No Formal Quote Revisions Issued Yet
          </h4>
          <p className="text-xs text-stone-500 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
            When you are ready to send pricing to a customer or save a milestone, click "Issue New Quote Revision" to create an immutable snapshot.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onIssueRevision}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Issue First Quote Snapshot</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {revisions.map((rev) => {
            const isExpanded = expandedRevId === rev.id;
            const dateStr = new Date(rev.createdAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            });

            return (
              <div
                key={rev.id}
                className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-xs overflow-hidden"
              >
                {/* Revision Header Summary */}
                <button
                  type="button"
                  onClick={() => setExpandedRevId(isExpanded ? null : rev.id)}
                  className="w-full text-left p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-stone-50/60 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center justify-center font-mono font-black text-sm shrink-0">
                      V{rev.revisionNumber}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-stone-900 dark:text-zinc-100">
                          {rev.quoteCode}
                        </span>
                        <span className="text-[10px] text-stone-400 dark:text-zinc-500 font-medium">
                          ({rev.productsSnapshot.length} {rev.productsSnapshot.length === 1 ? 'product' : 'products'})
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-zinc-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{dateStr}</span>
                        </span>
                        {rev.createdByName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            <span>{rev.createdByName}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono font-bold text-amber-800 dark:text-amber-400 hidden sm:inline">
                      ${rev.formulaSnapshot.totalCost.toFixed(2)} formula cost
                    </span>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </button>

                {/* Expanded Snapshot Details */}
                {isExpanded && (
                  <div className="p-4 sm:p-6 border-t border-stone-200 dark:border-zinc-800 bg-stone-50/30 dark:bg-zinc-800/20 space-y-6">
                    {/* Notes if present */}
                    {rev.notes && (
                      <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
                        <span className="font-bold">Revision Notes: </span>
                        {rev.notes}
                      </div>
                    )}

                    {/* Formula Snapshot */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-zinc-300 flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-amber-600" />
                          <span>Formula Snapshot</span>
                        </h4>
                        <span className="text-xs font-mono text-stone-500 dark:text-zinc-400">
                          {rev.formulaSnapshot.totalWeightGrams.toLocaleString()} g • ${rev.formulaSnapshot.totalCost.toFixed(2)} total cost
                        </span>
                      </div>

                      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-stone-200 dark:border-zinc-800 overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-800/40 text-[10px] font-bold uppercase text-stone-500">
                              <th className="py-2.5 px-3">Ingredient</th>
                              <th className="py-2.5 px-3 text-right">Quantity</th>
                              <th className="py-2.5 px-3">Unit</th>
                              <th className="py-2.5 px-3 text-right">Unit Cost at Quote Time</th>
                              <th className="py-2.5 px-3 text-right">Line Cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                            {rev.formulaSnapshot.lines.map((line) => (
                              <tr key={line.id}>
                                <td className="py-2 px-3 font-medium text-stone-900 dark:text-zinc-100">
                                  {line.name}
                                </td>
                                <td className="py-2 px-3 text-right font-mono">{line.quantity}</td>
                                <td className="py-2 px-3 text-stone-500">{line.unit}</td>
                                <td className="py-2 px-3 text-right font-mono text-stone-500">
                                  {line.unitCostUsed > 0
                                    ? line.unitCostType === 'per_gram'
                                      ? `$${(line.unitCostUsed * 453.59237).toFixed(2)}/lb`
                                      : `$${line.unitCostUsed.toFixed(2)}/ea`
                                    : '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-stone-900 dark:text-zinc-100">
                                  ${line.lineCost.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Products Snapshot */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-zinc-300 flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-amber-600" />
                        <span>Sellable Products Snapshot</span>
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {rev.productsSnapshot.map((prod) => (
                          <div
                            key={prod.id}
                            className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-stone-200 dark:border-zinc-800 shadow-2xs space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-stone-900 dark:text-zinc-100">
                                {prod.name}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400">
                                {prod.productType}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs pt-1 border-t border-stone-100 dark:border-zinc-800">
                              <div>
                                <span className="text-[10px] text-stone-400 block uppercase">Raw Ingredients</span>
                                <span className="font-mono font-bold text-stone-800 dark:text-zinc-200">
                                  ${prod.rawIngredientCost.toFixed(2)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-stone-400 block uppercase">Cost (COGS) / Case</span>
                                <span className="font-mono font-bold text-stone-800 dark:text-zinc-200">
                                  ${prod.totalProductionCost.toFixed(2)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-amber-700 dark:text-amber-400 block uppercase font-bold">Cost / Unit</span>
                                <span className="font-mono font-bold text-stone-900 dark:text-zinc-100">
                                  ${(prod.costPerUnit != null ? prod.costPerUnit : (prod.piecesPerCase > 0 ? prod.totalProductionCost / prod.piecesPerCase : 0)).toFixed(2)}/ea
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-stone-400 block uppercase">Target Price</span>
                                <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                                  ${prod.calculatedTargetPrice.toFixed(2)}
                                  <span className="text-[10px] font-normal text-stone-400 ml-1">
                                    (${((prod.targetPricePerUnit != null ? prod.targetPricePerUnit : (prod.piecesPerCase > 0 ? prod.calculatedTargetPrice / prod.piecesPerCase : 0))).toFixed(2)}/ea)
                                  </span>
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-stone-400 block uppercase">Actual Quoted Price</span>
                                <span className="font-mono font-bold text-stone-900 dark:text-zinc-100">
                                  {prod.quotedPrice != null && prod.quotedPrice > 0 ? (
                                    <>
                                      ${prod.quotedPrice.toFixed(2)}
                                      <span className="text-[10px] font-normal text-stone-400 ml-1">
                                        (${((prod.quotedPricePerUnit != null ? prod.quotedPricePerUnit : (prod.piecesPerCase > 0 ? prod.quotedPrice / prod.piecesPerCase : 0))).toFixed(2)}/ea)
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-stone-400">Not Quoted</span>
                                  )}
                                </span>
                              </div>
                            </div>

                            {prod.quotedPrice != null && prod.quotedPrice > 0 && (
                              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 text-xs">
                                <span className="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold">
                                  Profit: <span className="font-mono font-bold">${prod.dollarProfit.toFixed(2)}</span>
                                </span>
                                <span className="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold">
                                  Margin: <span className="font-mono font-bold">{prod.grossMarginPercent.toFixed(2)}%</span>
                                </span>
                                <span className="text-[11px] text-stone-600 dark:text-zinc-400 font-semibold">
                                  Markup: <span className="font-mono font-bold">{prod.markupPercent.toFixed(2)}%</span>
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
