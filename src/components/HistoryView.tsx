import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  Search,
  FileText,
  Trash2,
  Calendar,
  AlertTriangle,
  Check,
  Eye,
  X,
} from 'lucide-react';
import { AccessRole, ProductionHistoryEntry, ProductionPreset, Recipe } from '../types';
import { formatNumber, isButterIngredient, isPeanutButterIngredient, getDisplayDecimals } from '../utils/units';
import { exportProductionSheetPDF } from '../utils/pdfExport';
import { store } from '../services/store';
import {
  FirestoreHydrationState,
  resolveApplicableSafetyInstructions,
  isSafetySignatureAcknowledged,
  canProceedToMixWithSyncSafety,
  resolveSafetyOperationalGateState,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
} from '../utils/productionNotes';

interface HistoryViewProps {
  history: ProductionHistoryEntry[];
  userRole?: AccessRole | null;
  onDeleteHistoryEntry: (id: string) => void;
  onReopenInCalculator: (entry: ProductionHistoryEntry) => void;
  businessName?: string;
  decimalPlaces?: number;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  userRole,
  onDeleteHistoryEntry,
  businessName,
  decimalPlaces,
}) => {
  const effectiveRole = userRole !== undefined ? userRole : store.getUserRole();
  const isEditorOrOwner = effectiveRole === 'owner' || effectiveRole === 'editor';
  const decimals = decimalPlaces !== undefined ? decimalPlaces : 2;
  const [searchTerm, setSearchTerm] = useState('');
  const [viewingEntry, setViewingEntry] = useState<ProductionHistoryEntry | null>(null);
  const [acknowledgedSignature, setAcknowledgedSignature] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [recipes, setRecipes] = useState<Recipe[]>(() => store.getRecipes(true));
  const [presets, setPresets] = useState<ProductionPreset[]>(() => store.getPresets());
  const [recipesHydrationState, setRecipesHydrationState] = useState<FirestoreHydrationState>(() =>
    store.getRecipesHydrationState()
  );
  const [presetsHydrationState, setPresetsHydrationState] = useState<FirestoreHydrationState>(() =>
    store.getPresetsHydrationState()
  );
  const [syncError, setSyncError] = useState<string | null>(() =>
    store.getCriticalNotesSyncError()
  );
  const [connectionVerified, setConnectionVerified] = useState<boolean>(() =>
    store.isSafetyConnectionVerified()
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() =>
    store.getActiveWorkspaceId()
  );

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setRecipes(store.getRecipes(true));
      setPresets(store.getPresets());
      setRecipesHydrationState(store.getRecipesHydrationState());
      setPresetsHydrationState(store.getPresetsHydrationState());
      setSyncError(store.getCriticalNotesSyncError());
      setConnectionVerified(store.isSafetyConnectionVerified());
      setActiveWorkspaceId(store.getActiveWorkspaceId());
    });
    return unsub;
  }, []);

  const operationalGateState = useMemo(
    () =>
      resolveSafetyOperationalGateState({
        recipesHydrationState,
        presetsHydrationState,
        syncError,
        connectionVerified,
      }),
    [recipesHydrationState, presetsHydrationState, syncError, connectionVerified]
  );

  const resolveEntrySafety = (entry: ProductionHistoryEntry | null) => {
    if (!entry) return null;
    const matchedRecipe =
      recipes.find((r) => r.id === entry.recipeId) ||
      ({
        id: entry.recipeId,
        name: entry.recipeName,
        workspaceId: entry.workspaceId || activeWorkspaceId,
      } as Recipe);
    const presetIds = (entry.requirements || [])
      .map((r) => (r.presetId || '').trim())
      .filter(Boolean);
    return resolveApplicableSafetyInstructions({
      recipe: matchedRecipe,
      presets,
      selectedPresetIds: presetIds,
      activeWorkspaceId: entry.workspaceId || activeWorkspaceId,
    });
  };

  const viewingSafety = useMemo(
    () => resolveEntrySafety(viewingEntry),
    [viewingEntry, recipes, presets, activeWorkspaceId]
  );

  const isViewingAcknowledged = useMemo(
    () =>
      viewingSafety
        ? isSafetySignatureAcknowledged(viewingSafety.signature, acknowledgedSignature)
        : true,
    [viewingSafety, acknowledgedSignature]
  );

  const canExportViewingEntry = useMemo(
    () =>
      Boolean(viewingEntry) &&
      canProceedToMixWithSyncSafety({
        hasNotes: Boolean(viewingSafety?.hasSafetyNotes),
        isAcknowledged: isViewingAcknowledged,
        syncError,
        recipesHydrationState,
        presetsHydrationState,
        connectionVerified,
      }),
    [
      viewingEntry,
      viewingSafety?.hasSafetyNotes,
      isViewingAcknowledged,
      syncError,
      recipesHydrationState,
      presetsHydrationState,
      connectionVerified,
    ]
  );

  const handleExportEntry = (entry: ProductionHistoryEntry, ackSig: string | null) => {
    try {
      setExportError(null);
      const branding = store.getWorkspaceBranding();
      exportProductionSheetPDF(
        entry,
        {
          displayName: branding.displayName || businessName,
          paletteId: branding.paletteId,
        },
        decimals,
        {
          recipes,
          presets,
          activeWorkspaceId: entry.workspaceId || activeWorkspaceId,
          recipesHydrationState,
          presetsHydrationState,
          syncError,
          connectionVerified,
          acknowledgedSafetySignature: ackSig,
        }
      );
    } catch (err: unknown) {
      setExportError(
        err instanceof Error ? err.message : 'Unable to export production sheet PDF.'
      );
    }
  };

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

      {exportError && (
        <div
          id="history-export-error-banner"
          className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-bold text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{exportError}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="p-1 rounded hover:bg-rose-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
                onClick={() => {
                  setExportError(null);
                  setAcknowledgedSignature(null);
                  setViewingEntry(entry);
                }}
                className="inline-flex items-center gap-1 bg-[#D4A373] hover:bg-[#C49363] text-white font-bold text-xs px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Sheet</span>
              </button>

              <div className="flex items-center gap-1">
                <button
                  id={`history-export-btn-${entry.id}`}
                  disabled={operationalGateState !== 'READY'}
                  onClick={() => {
                    if (operationalGateState !== 'READY') return;
                    const entrySafety = resolveEntrySafety(entry);
                    if (entrySafety?.hasSafetyNotes) {
                      setExportError(null);
                      setAcknowledgedSignature(null);
                      setViewingEntry(entry);
                      return;
                    }
                    handleExportEntry(entry, null);
                  }}
                  title={
                    operationalGateState !== 'READY'
                      ? 'Safety sync must be verified before exporting PDF'
                      : 'Export PDF'
                  }
                  className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                </button>
                {isEditorOrOwner && (
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
                )}
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
              {operationalGateState !== 'READY' && (
                <div
                  id="history-modal-safety-hold-banner"
                  className="p-3.5 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-xs font-bold text-amber-950 dark:text-amber-100"
                >
                  {operationalGateState === 'INITIAL_LOADING'
                    ? SAFETY_HYDRATION_LOADING_MESSAGE
                    : operationalGateState === 'CONNECTION_UNVERIFIED'
                    ? SAFETY_CONNECTION_UNVERIFIED_MESSAGE
                    : SAFETY_HYDRATION_ERROR_MESSAGE}
                </div>
              )}

              {viewingSafety?.hasSafetyNotes && (
                <div
                  id="history-critical-notes-card"
                  className={`rounded-xl border-2 p-4 text-xs space-y-3 ${
                    isViewingAcknowledged
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-amber-500 bg-amber-50 dark:bg-amber-950/40'
                  }`}
                >
                  <div className="flex items-center gap-2 font-black uppercase tracking-wider text-amber-950 dark:text-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Critical Production Notes</span>
                  </div>
                  <div className="space-y-2 p-3 rounded-xl bg-white dark:bg-[#1E1B18] border border-amber-200 dark:border-amber-900/60">
                    {viewingSafety.allInstructions.map((item) => (
                      <div key={item.id} className="space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950 text-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                          {item.scope === 'preset_specific' && item.presetName
                            ? `Preset-Specific Critical Note — ${item.presetName}`
                            : item.scopeLabel}
                        </span>
                        <div className="font-semibold text-amber-950 dark:text-amber-100 whitespace-pre-wrap break-words">
                          {item.note}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!isViewingAcknowledged && (
                    <button
                      id="btn-history-acknowledge-notes"
                      type="button"
                      disabled={operationalGateState !== 'READY'}
                      onClick={() => {
                        if (operationalGateState !== 'READY' || !viewingSafety.signature) return;
                        setAcknowledgedSignature(viewingSafety.signature);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>I HAVE READ THESE PRODUCTION NOTES</span>
                    </button>
                  )}
                </div>
              )}

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
                    <tbody className="divide-y divide-[#EEECE8] dark:divide-[#332F2B] text-[#5A534B] dark:text-[#F3EFEA]">
                      {viewingEntry.calculatedIngredients.map((ing) => {
                        const isPB = ing.isPeanutButter || isPeanutButterIngredient(ing.name, viewingEntry.recipeName);
                        const isButter = !isPB && isButterIngredient(ing.name);
                        const { maxDecimals, minDecimals } = getDisplayDecimals(
                          ing.requiredUnit,
                          isButter,
                          decimals,
                          isPB
                        );
                        const baseUnitIsGrams = ing.baseUnit.trim().toLowerCase() === 'g';
                        return (
                          <tr key={ing.id}>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-sm sm:text-base text-[#5A534B] dark:text-[#F3EFEA]">{ing.name}</span>
                                {isButter && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] border border-[#D4A373]/50">
                                    🧈 lbs (2 decimals)
                                  </span>
                                )}
                                {isPB && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#FAF7F2] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] border border-[#D4A373]/50">
                                    🥜 4 lb Jars
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono text-xs sm:text-sm text-[#8B7E74] dark:text-[#A39E93]">
                              {formatNumber(ing.baseQuantity, baseUnitIsGrams ? 0 : decimals)} {ing.baseUnit}
                            </td>
                            <td className="p-3 text-right text-[#8B7E74] dark:text-[#A39E93] font-mono text-xs sm:text-sm">{ing.wastePercent}%</td>
                            <td className="p-3 text-right font-bold text-base sm:text-lg text-[#5A534B] dark:text-[#F3EFEA] font-mono">
                              <div>{formatNumber(ing.requiredQuantity, maxDecimals, minDecimals)} {ing.requiredUnit}</div>
                              {ing.jarsDetail?.text && (
                                <div className="text-[11px] font-normal text-[#8B7E74] dark:text-[#D4A373] mt-0.5 font-mono">
                                  ({ing.jarsDetail.text})
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between bg-[#F9F8F6] dark:bg-[#25221F]">
              <button
                id="history-modal-export-pdf-btn"
                disabled={!canExportViewingEntry}
                onClick={() => {
                  if (!viewingEntry || !canExportViewingEntry) return;
                  handleExportEntry(viewingEntry, acknowledgedSignature);
                }}
                className="inline-flex items-center gap-1.5 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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

