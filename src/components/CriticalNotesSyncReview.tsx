import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CloudUpload,
  FileText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { AccessRole, ProductionPreset, Recipe } from '../types';
import { store } from '../services/store';
import {
  CriticalNoteReconciliationItem,
  OwnerReconciliationAction,
} from '../utils/criticalNotesReconciliation';

interface CriticalNotesSyncReviewProps {
  userRole?: AccessRole | null;
  presets?: ProductionPreset[];
  recipes?: Recipe[];
  defaultExpanded?: boolean;
}

type SyncExecutionState = 'idle' | 'saving' | 'saved' | 'error';

function formatTimestamp(iso?: string): string {
  if (!iso || !iso.trim()) return 'Timestamp unavailable';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const CriticalNotesSyncReview: React.FC<CriticalNotesSyncReviewProps> = ({
  userRole,
  presets,
  recipes,
  defaultExpanded,
}) => {
  const effectiveRole = userRole !== undefined ? userRole : store.getUserRole();
  const [storeTick, setStoreTick] = useState(0);

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setStoreTick((t) => t + 1);
    });
    return unsub;
  }, []);

  const report = useMemo(() => {
    if (effectiveRole !== 'owner') return null;
    return store.inspectCriticalNotesReconciliation(effectiveRole);
  }, [effectiveRole, presets, recipes, storeTick]);

  const [isExpanded, setIsExpanded] = useState<boolean>(() => Boolean(defaultExpanded));
  const [showAllItems, setShowAllItems] = useState<boolean>(false);
  const [showRecipeWideReference, setShowRecipeWideReference] = useState<boolean>(false);
  const [decisions, setDecisions] = useState<Record<string, OwnerReconciliationAction>>({});
  const [manualTextByKey, setManualTextByKey] = useState<Record<string, string>>({});
  const [executionState, setExecutionState] = useState<SyncExecutionState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Auto-open when actionable local notes or conflicts are detected on this browser
  useEffect(() => {
    if (report?.hasActionableDifferences) {
      setIsExpanded(true);
    }
  }, [report?.hasActionableDifferences]);

  // Seed default proposed actions for items without overwriting explicit Owner edits
  useEffect(() => {
    if (!report) return;
    setDecisions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const item of report.items) {
        if (!next[item.itemKey]) {
          next[item.itemKey] = item.proposedAction;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [report]);

  // Strictly Owner-only visibility
  if (effectiveRole !== 'owner' || !report || !report.isOwnerAuthorized) {
    return null;
  }

  const visibleItems: CriticalNoteReconciliationItem[] = showAllItems
    ? report.items
    : report.actionableItems.length > 0
    ? report.actionableItems
    : report.items;

  const handleDecisionChange = (itemKey: string, action: OwnerReconciliationAction, item: CriticalNoteReconciliationItem) => {
    setDecisions((prev) => ({
      ...prev,
      [itemKey]: action,
    }));
    if (action === 'manual_review' && manualTextByKey[itemKey] === undefined) {
      setManualTextByKey((prev) => ({
        ...prev,
        [itemKey]: item.localNote?.note || item.cloudNote?.note || '',
      }));
    }
    if (executionState === 'saved' || executionState === 'error') {
      setExecutionState('idle');
      setStatusMessage('');
    }
  };

  const handleApplyApproved = async () => {
    setExecutionState('saving');
    setStatusMessage('Saving approved Critical Production Notes to shared Cloud Firestore...');

    try {
      const targetDecisions: Record<string, OwnerReconciliationAction> = {};
      for (const item of visibleItems) {
        targetDecisions[item.itemKey] = decisions[item.itemKey] || item.proposedAction;
      }

      const result = await store.applyCriticalNotesReconciliationDecisions(
        targetDecisions,
        manualTextByKey,
        effectiveRole
      );

      setExecutionState('saved');
      const parts: string[] = [];
      if (result.promotedCount > 0) {
        parts.push(`${result.promotedCount} promoted to shared workspace`);
      }
      if (result.keptCloudCount > 0) {
        parts.push(`${result.keptCloudCount} kept cloud version`);
      }
      if (result.leftUnchangedCount > 0) {
        parts.push(`${result.leftUnchangedCount} left unchanged`);
      }
      if (result.manualReviewDeferredCount > 0) {
        parts.push(`${result.manualReviewDeferredCount} held for manual review`);
      }
      setStatusMessage(
        parts.length > 0
          ? `Saved: ${parts.join(', ')}. Local durable backup preserved.`
          : 'Reconciliation verified. Local durable backup preserved.'
      );
    } catch (err: any) {
      setExecutionState('error');
      setStatusMessage(
        err instanceof Error
          ? `Save Failed: ${err.message}`
          : 'Save Failed: Could not synchronize Critical Production Notes to Cloud Firestore.'
      );
    }
  };

  return (
    <section
      id="critical-notes-sync-review-panel"
      className={`rounded-2xl border transition-all shadow-2xs ${
        report.hasActionableDifferences
          ? 'bg-amber-50/80 dark:bg-amber-950/25 border-amber-300 dark:border-amber-800/80'
          : 'bg-white dark:bg-[#1E1B18] border-[#E5E1DA] dark:border-[#2D2925]'
      }`}
    >
      {/* Header Bar */}
      <button
        type="button"
        id="critical-notes-sync-review-toggle"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left cursor-pointer"
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              report.hasActionableDifferences
                ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                : 'bg-[#FAF7F2] dark:bg-[#25221F] border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4A373]'
            }`}
          >
            {report.hasActionableDifferences ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif font-bold text-sm sm:text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Critical Production Notes — Owner Synchronization Review
              </h3>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#5A534B] text-white dark:bg-[#D4A373] dark:text-[#1E1B18]">
                Owner Only
              </span>
            </div>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
              {report.hasActionableDifferences
                ? `${report.actionableItems.length} device-local note${
                    report.actionableItems.length === 1 ? '' : 's'
                  } or conflict${
                    report.actionableItems.length === 1 ? '' : 's'
                  } detected on this browser — explicit Owner approval required before cloud promotion.`
                : `Shared workspace presets/${'{presetId}'}.criticalNotes is authoritative (${
                    report.inSyncCount + report.cloudOnlyCount
                  } shared preset note${
                    report.inSyncCount + report.cloudOnlyCount === 1 ? '' : 's'
                  }, ${report.durableBackupRecordCount} local backup record${
                    report.durableBackupRecordCount === 1 ? '' : 's'
                  } preserved).`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {report.hasActionableDifferences ? (
            <span
              id="critical-notes-review-pending-badge"
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-600 text-white"
            >
              Review Required ({report.actionableItems.length})
            </span>
          ) : (
            <span
              id="critical-notes-review-synced-badge"
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
            >
              Cloud Authoritative
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-[#8B7E74] transition-transform duration-150 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* Expanded Review Workspace */}
      {isExpanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-2 border-t border-[#EEECE8] dark:border-[#332F2B] space-y-4">
          {/* Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-white dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#8B7E74] dark:text-[#A39E93]">
                Local Unmigrated
              </div>
              <div className="font-mono font-bold text-base text-amber-800 dark:text-amber-300 mt-0.5">
                {report.localOnlyCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#8B7E74] dark:text-[#A39E93]">
                Text Conflicts
              </div>
              <div className="font-mono font-bold text-base text-rose-700 dark:text-rose-300 mt-0.5">
                {report.conflictCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#8B7E74] dark:text-[#A39E93]">
                Shared in Cloud
              </div>
              <div className="font-mono font-bold text-base text-emerald-700 dark:text-emerald-300 mt-0.5">
                {report.inSyncCount + report.cloudOnlyCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#8B7E74] dark:text-[#A39E93]">
                Local Backup Kept
              </div>
              <div className="font-mono font-bold text-base text-[#5A534B] dark:text-[#EAE6E1] mt-0.5">
                {report.durableBackupRecordCount}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-[#8B7E74] dark:text-[#A39E93]">
              Open this screen on the desktop browser where local Critical Production Notes were created to inspect and promote them to shared Cloud Firestore (`presets/{'{presetId}'}.criticalNotes`). Local backups remain preserved on disk even after promotion.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {report.items.length > report.actionableItems.length && (
                <button
                  type="button"
                  onClick={() => setShowAllItems((prev) => !prev)}
                  className="px-2.5 py-1 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] bg-white dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-semibold cursor-pointer hover:border-[#D4A373]"
                >
                  {showAllItems
                    ? `Show Actionable Only (${report.actionableItems.length})`
                    : `Show All Preset Notes (${report.items.length})`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowRecipeWideReference((prev) => !prev)}
                className="px-2.5 py-1 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] bg-white dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-semibold cursor-pointer hover:border-[#D4A373] inline-flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Recipe-Wide Notes ({report.recipeWideNotes.length})</span>
              </button>
            </div>
          </div>

          {/* Item Comparison List */}
          {visibleItems.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-xs text-[#8B7E74] dark:text-[#A39E93]">
              No preset-specific Critical Production Notes found in this browser’s local storage or shared Cloud Firestore for workspace <strong>{report.workspaceId}</strong>. If notes exist on another desktop browser, sign in as Owner on that browser to review and promote them.
            </div>
          ) : (
            <div id="critical-notes-reconciliation-list" className="space-y-3">
              {visibleItems.map((item) => {
                const selectedAction = decisions[item.itemKey] || item.proposedAction;
                return (
                  <div
                    key={item.itemKey}
                    id={`reconcile-item-${item.presetId}-${item.recipeId}`}
                    className="p-4 rounded-xl bg-white dark:bg-[#1A1816] border border-[#E5E1DA] dark:border-[#332F2B] space-y-3"
                  >
                    {/* Top Row: Preset Name, Recipe Name, Source, Timestamp */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#EEECE8] dark:border-[#2D2925]">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-serif font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                            {item.presetName}
                          </span>
                          <span className="text-[#8B7E74]">×</span>
                          <span className="font-bold text-sm text-amber-900 dark:text-amber-200">
                            {item.recipeName}
                          </span>
                          {item.isProtected1ozBaselineNote && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
                              Protected 1 oz Note ({item.hasAuthoritativeCloudCopy ? 'Cloud Copy Verified' : 'No Cloud Copy Yet'})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] flex items-center gap-2 flex-wrap">
                          <span>
                            Source: <strong className="text-[#5A534B] dark:text-[#EAE6E1]">{item.sourceLabel}</strong>
                          </span>
                          <span>•</span>
                          <span>Last Modified: {formatTimestamp(item.lastModifiedTimestamp)}</span>
                        </div>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider self-start sm:self-auto ${
                          item.status === 'CONFLICT_TEXT_MISMATCH'
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800'
                            : item.status === 'LOCAL_ONLY'
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800'
                        }`}
                      >
                        {item.status === 'CONFLICT_TEXT_MISMATCH'
                          ? 'Conflict — Owner Choice Required'
                          : item.status === 'LOCAL_ONLY'
                          ? 'Local Only — Not Yet Shared'
                          : item.status === 'ALREADY_IN_SYNC'
                          ? 'In Sync (Local + Cloud)'
                          : 'Shared in Cloud'}
                      </span>
                    </div>

                    {/* Side-by-Side Comparison: Local Note vs Existing Cloud Version vs Recipe-Wide */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8B7E74] dark:text-[#A39E93]">
                          <span>Desktop Local Storage Note</span>
                          {item.localNote?.updatedAt && (
                            <span className="font-mono font-normal">
                              {formatTimestamp(item.localNote.updatedAt)}
                            </span>
                          )}
                        </div>
                        {item.localNote ? (
                          <p className="text-[#5A534B] dark:text-[#EAE6E1] font-medium whitespace-pre-wrap break-words">
                            {item.localNote.note}
                          </p>
                        ) : (
                          <p className="italic text-[#A39E93]">Not present in this browser’s local storage</p>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8B7E74] dark:text-[#A39E93]">
                          <span>Existing Cloud Version (presets/{item.presetId})</span>
                          {item.cloudNote?.updatedAt && (
                            <span className="font-mono font-normal">
                              {formatTimestamp(item.cloudNote.updatedAt)}
                            </span>
                          )}
                        </div>
                        {item.cloudNote ? (
                          <p className="text-[#5A534B] dark:text-[#EAE6E1] font-medium whitespace-pre-wrap break-words">
                            {item.cloudNote.note}
                          </p>
                        ) : (
                          <p className="italic text-amber-800 dark:text-amber-300">
                            None in Cloud Firestore (not yet visible on phones/tablets)
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Recipe-Wide Note Context if present */}
                    {item.recipeWideNoteText && (
                      <div className="px-3 py-2 rounded-lg bg-[#FAF7F2] dark:bg-[#221F1C] border border-[#EEECE8] dark:border-[#332F2B] text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                        <span className="font-bold uppercase tracking-wider text-[#5A534B] dark:text-[#D4A373] mr-1.5">
                          Recipe-Wide Critical Note (Recipe.description — Kept Separate):
                        </span>
                        <span>{item.recipeWideNoteText}</span>
                      </div>
                    )}

                    {item.cannotPromoteReason && (
                      <div className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
                        {item.cannotPromoteReason}
                      </div>
                    )}

                    {/* Proposed Action & Owner Explicit Selector */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                      <div className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                        Proposed Action:{' '}
                        <strong className="text-[#5A534B] dark:text-[#EAE6E1]">
                          {item.proposedAction === 'promote_local'
                            ? 'Promote local note to shared workspace'
                            : item.proposedAction === 'keep_cloud'
                            ? 'Keep existing cloud note'
                            : item.proposedAction === 'manual_review'
                            ? 'Review conflict manually'
                            : 'Leave unchanged'}
                        </strong>
                      </div>

                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`select-reconcile-${item.presetId}-${item.recipeId}`}
                          className="text-[11px] font-bold text-[#5A534B] dark:text-[#EAE6E1]"
                        >
                          Owner Action:
                        </label>
                        <select
                          id={`select-reconcile-${item.presetId}-${item.recipeId}`}
                          value={selectedAction}
                          onChange={(e) =>
                            handleDecisionChange(
                              item.itemKey,
                              e.target.value as OwnerReconciliationAction,
                              item
                            )
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FAF8F5] dark:bg-[#25221F] border border-[#D4A373] text-[#5A534B] dark:text-[#EAE6E1] cursor-pointer focus:outline-none"
                        >
                          <option
                            value="promote_local"
                            disabled={!item.localNote || !item.canPromoteToCloud}
                          >
                            Promote local note to shared workspace
                          </option>
                          <option
                            value="keep_cloud"
                            disabled={
                              !item.hasAuthoritativeCloudCopy && item.isProtected1ozBaselineNote
                            }
                          >
                            Keep existing cloud note
                          </option>
                          <option value="manual_review">Review conflict manually</option>
                          <option value="leave_unchanged">Leave unchanged</option>
                        </select>
                      </div>
                    </div>

                    {/* Manual Review Resolution Editor */}
                    {selectedAction === 'manual_review' && (
                      <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800/70 space-y-2">
                        <label className="block text-[11px] font-bold text-amber-950 dark:text-amber-200">
                          Manual Conflict Review — Edit Approved Shared Note Text (or clear to hold without saving):
                        </label>
                        <textarea
                          rows={2}
                          value={manualTextByKey[item.itemKey] ?? ''}
                          onChange={(e) =>
                            setManualTextByKey((prev) => ({
                              ...prev,
                              [item.itemKey]: e.target.value,
                            }))
                          }
                          placeholder="Enter exact approved safety note to save to shared Cloud Firestore, or leave blank to defer..."
                          className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#1E1B18] border border-amber-300 dark:border-amber-700 text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Optional Recipe-Wide Critical Notes Reference Panel */}
          {showRecipeWideReference && (
            <div
              id="recipe-wide-safety-reference-panel"
              className="p-3.5 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] space-y-2"
            >
              <div className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                Recipe-Wide Critical Notes (`Recipe.description`) — Shared Across All Presets
              </div>
              {report.recipeWideNotes.length === 0 ? (
                <p className="text-xs italic text-[#8B7E74] dark:text-[#A39E93]">
                  No active recipes currently have a Recipe-Wide Critical Note in `Recipe.description`.
                </p>
              ) : (
                <div className="divide-y divide-[#EEECE8] dark:divide-[#332F2B]">
                  {report.recipeWideNotes.map((rw) => (
                    <div key={rw.recipeId} className="py-2 text-xs space-y-0.5">
                      <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                        {rw.recipeName}{' '}
                        <span className="font-normal text-[#8B7E74]">({rw.category})</span>
                      </div>
                      <p className="text-[#8B7E74] dark:text-[#A39E93] whitespace-pre-wrap">
                        {rw.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Execution Feedback & Approval Action Bar */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs">
              {executionState === 'saving' && (
                <span
                  id="critical-notes-sync-saving-status"
                  className="inline-flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300"
                >
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving... {statusMessage}</span>
                </span>
              )}
              {executionState === 'saved' && (
                <span
                  id="critical-notes-sync-saved-status"
                  className="inline-flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>{statusMessage}</span>
                </span>
              )}
              {executionState === 'error' && (
                <span
                  id="critical-notes-sync-error-status"
                  className="inline-flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>{statusMessage}</span>
                </span>
              )}
            </div>

            {visibleItems.length > 0 && (
              <button
                type="button"
                id="btn-apply-critical-notes-reconciliation"
                disabled={executionState === 'saving'}
                onClick={handleApplyApproved}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#D4A373] dark:text-[#1E1B18] dark:hover:bg-[#C49363] disabled:opacity-50 transition cursor-pointer self-end sm:self-auto"
              >
                {executionState === 'saving' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4" />
                )}
                <span>
                  {executionState === 'saving'
                    ? 'Saving to Shared Workspace...'
                    : 'Apply Owner Reconciliation Decisions'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
