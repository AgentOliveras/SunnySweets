import React, { useState } from 'react';
import {
  History,
  Search,
  FileText,
  Copy,
  Trash2,
  Calendar,
  AlertTriangle,
  Scale,
  CheckCircle2,
  Eye,
  X,
} from 'lucide-react';
import { ProductionHistoryEntry } from '../types';
import { formatNumber } from '../utils/units';
import { exportProductionSheetPDF } from '../utils/pdfExport';

interface HistoryViewProps {
  history: ProductionHistoryEntry[];
  onDeleteHistoryEntry: (id: string) => void;
  onReopenInCalculator: (entry: ProductionHistoryEntry) => void;
  businessName?: string;
  decimalPlaces?: number;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onDeleteHistoryEntry,
  onReopenInCalculator,
  businessName,
  decimalPlaces,
}) => {
  const decimals = decimalPlaces !== undefined ? decimalPlaces : 2;
  const [searchTerm, setSearchTerm] = useState('');
  const [viewingEntry, setViewingEntry] = useState<ProductionHistoryEntry | null>(null);

  const filtered = history.filter(
    (h) =>
      h.recipeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (h.mixerName && h.mixerName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <History className="w-6 h-6 text-[#D4A373]" />
            <span>Production History</span>
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Archive of completed production sheets, mixer capacity records, and batch formulas.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative w-full sm:w-80">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#A39E93]" />
        <input
          type="text"
          placeholder="Search history by recipe or mixer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl focus:outline-none focus:border-[#D4A373] dark:text-[#EAE6E1]"
        />
      </div>

      {/* History Table / Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((entry) => (
          <div
            key={entry.id}
            id={`history-card-${entry.id}`}
            className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                  {entry.recipeName}
                </h3>
                {entry.capacityExceeded && (
                  <span className="px-2 py-0.5 bg-[#FDF2F0] text-[#C97B63] dark:bg-[#2C1916] rounded text-[10px] font-bold flex items-center gap-1 font-mono">
                    <AlertTriangle className="w-3 h-3" />
                    Exceeded
                  </span>
                )}
              </div>

              <div className="text-xs text-[#8B7E74] dark:text-[#A39E93] mb-4 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>{new Date(entry.calculatedAt).toLocaleString()}</span>
              </div>

              <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B] text-xs space-y-1 text-[#5A534B] dark:text-[#EAE6E1] mb-4">
                <div className="flex justify-between">
                  <span className="text-[#8B7E74]">Finished Pieces:</span>
                  <span className="font-bold font-mono">{entry.totalPieces.toLocaleString()} pcs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B7E74]">Batch Weight:</span>
                  <span className="font-bold font-mono">
                    {formatNumber(entry.displayBatchWeight, decimals)} {entry.displayWeightUnit.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8B7E74]">Multiplier:</span>
                  <span className="font-bold font-mono">{formatNumber(entry.scalingMultiplier, 2)}x</span>
                </div>
                {entry.mixerName && (
                  <div className="flex justify-between">
                    <span className="text-[#8B7E74]">Mixer Equipment:</span>
                    <span className="font-semibold">{entry.mixerName}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#EEECE8] dark:border-[#332F2B]">
              <button
                id={`history-view-btn-${entry.id}`}
                onClick={() => setViewingEntry(entry)}
                className="inline-flex items-center gap-1 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold text-xs px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Sheet</span>
              </button>

              <div className="flex items-center gap-1">
                <button
                  id={`history-export-btn-${entry.id}`}
                  onClick={() => exportProductionSheetPDF(entry, businessName, decimals)}
                  title="Export PDF"
                  className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  id={`history-delete-btn-${entry.id}`}
                  onClick={() => {
                    if (confirm('Delete this history record?')) {
                      onDeleteHistoryEntry(entry.id);
                    }
                  }}
                  title="Delete Record"
                  className="p-1.5 text-[#C97B63] hover:text-red-700 hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-[#A39E93] text-sm bg-white dark:bg-[#1E1B18] rounded-xl border border-dashed border-[#E5E1DA] dark:border-[#2D2925] p-8">
            <p>No production history records found.</p>
          </div>
        )}
      </div>

      {/* Production Sheet Detail Modal */}
      {viewingEntry && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl my-auto">
            <div className="p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between">
              <div>
                <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                  {viewingEntry.recipeName}
                </h3>
                <p className="text-xs text-[#8B7E74]">
                  Saved Sheet • {new Date(viewingEntry.calculatedAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setViewingEntry(null)}
                className="p-1.5 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] text-[#8B7E74] uppercase font-semibold">Total Pieces</span>
                  <div className="text-lg font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                    {viewingEntry.totalPieces.toLocaleString()}
                  </div>
                </div>

                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] text-[#8B7E74] uppercase font-semibold">Batch Weight</span>
                  <div className="text-lg font-bold font-mono text-[#D4A373]">
                    {formatNumber(viewingEntry.displayBatchWeight, decimals)}{' '}
                    {viewingEntry.displayWeightUnit.toUpperCase()}
                  </div>
                </div>

                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] text-[#8B7E74] uppercase font-semibold">Multiplier</span>
                  <div className="text-lg font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                    {formatNumber(viewingEntry.scalingMultiplier, 3)}x
                  </div>
                </div>

                <div className="bg-[#F9F8F6] dark:bg-[#25221F] p-3 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <span className="text-[10px] text-[#8B7E74] uppercase font-semibold">Waste Allowance</span>
                  <div className="text-lg font-bold font-mono text-[#5A534B] dark:text-[#EAE6E1]">
                    {viewingEntry.wastePercent}%
                  </div>
                </div>
              </div>

              {/* Ingredients Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">Formula Breakdown</h4>
                <div className="overflow-x-auto rounded-xl border border-[#E5E1DA] dark:border-[#332F2B]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-3">Ingredient</th>
                        <th className="p-3 text-right">Base Qty</th>
                        <th className="p-3 text-right">Waste %</th>
                        <th className="p-3 text-right">Required Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEECE8] dark:divide-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7]">
                      {viewingEntry.calculatedIngredients.map((ing) => (
                        <tr key={ing.id}>
                          <td className="p-3 font-semibold">{ing.name}</td>
                          <td className="p-3 text-right font-mono">
                            {formatNumber(ing.baseQuantity, decimals)} {ing.baseUnit}
                          </td>
                          <td className="p-3 text-right text-[#8B7E74] font-mono">{ing.wastePercent}%</td>
                          <td className="p-3 text-right font-bold text-[#D4A373] font-mono">
                            {formatNumber(ing.requiredQuantity, decimals)} {ing.requiredUnit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between bg-[#F9F8F6] dark:bg-[#25221F]">
              <button
                onClick={() => exportProductionSheetPDF(viewingEntry, businessName, decimals)}
                className="inline-flex items-center gap-1.5 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Export PDF Sheet</span>
              </button>

              <button
                onClick={() => setViewingEntry(null)}
                className="px-4 py-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

