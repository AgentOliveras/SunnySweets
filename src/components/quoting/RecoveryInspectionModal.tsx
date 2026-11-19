import React, { useState } from 'react';
import {
  Download,
  AlertCircle,
  Database,
  History,
  HardDrive,
  FileText,
  X,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { CandidateRecoveryRecord } from '../../types/quoting';
import { quotingService } from '../../services/quotingService';

interface RecoveryInspectionModalProps {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onNotification?: (msg: string) => void;
}

export const RecoveryInspectionModal: React.FC<RecoveryInspectionModalProps> = ({
  workspaceId,
  isOpen,
  onClose,
  onNotification,
}) => {
  const [candidates, setCandidates] = useState<CandidateRecoveryRecord[]>(() =>
    quotingService.inspectRecoveryCandidates(workspaceId)
  );
  const [isScanning, setIsScanning] = useState(false);

  if (!isOpen) return null;

  const handleRefreshScan = () => {
    setIsScanning(true);
    try {
      const records = quotingService.inspectRecoveryCandidates(workspaceId);
      setCandidates(records);
      onNotification?.(`Recovery scan complete: ${records.length} candidate(s) found.`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleExportJson = () => {
    const payload = {
      exportTimestamp: new Date().toISOString(),
      workspaceId,
      totalCandidates: candidates.length,
      candidates,
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `bakery_recovery_candidates_${workspaceId}_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    onNotification?.('Exported recovery candidates to JSON backup file.');
  };

  const getSourceIcon = (source: CandidateRecoveryRecord['source']) => {
    switch (source) {
      case 'local_storage_recovery':
        return <HardDrive className="w-4 h-4 text-amber-600 dark:text-amber-400" />;
      case 'project_cache':
        return <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
      case 'quote_revision':
        return <History className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      default:
        return <FileText className="w-4 h-4 text-stone-500" />;
    }
  };

  const getSourceBadge = (source: CandidateRecoveryRecord['source']) => {
    switch (source) {
      case 'local_storage_recovery':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
            Emergency Draft Recovery
          </span>
        );
      case 'project_cache':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300">
            Local Workspace Cache
          </span>
        );
      case 'quote_revision':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
            Immutable Quote Revision
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-testid="recovery-inspection-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in"
    >
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-5 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center justify-center font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
                Data Recovery & Candidate Inspection
              </h3>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Read-only inspection of surviving draft recovery keys, caches, and quote revisions.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action strip */}
        <div className="px-5 py-3 bg-stone-50 dark:bg-zinc-850 border-b border-stone-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshScan}
              disabled={isScanning}
              className="px-3 py-1.5 rounded-xl font-bold border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>Rescan Local Storage</span>
            </button>
            <span className="text-stone-400">•</span>
            <span className="text-stone-600 dark:text-zinc-400">
              Found <strong className="text-stone-900 dark:text-zinc-100">{candidates.length}</strong> record(s) (
              <strong className="text-emerald-700 dark:text-emerald-400">
                {candidates.filter((c) => c.isPopulated).length} populated
              </strong>
              , {candidates.filter((c) => !c.isPopulated).length} empty shells)
            </span>
          </div>

          {candidates.length > 0 && (
            <button
              type="button"
              data-testid="btn-export-recovery-json"
              onClick={handleExportJson}
              className="px-3.5 py-1.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Raw JSON Backup</span>
            </button>
          )}
        </div>

        {/* Content list */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {candidates.length === 0 ? (
            <div className="p-8 text-center bg-stone-50 dark:bg-zinc-850 rounded-xl border border-stone-200 dark:border-zinc-800 space-y-2">
              <AlertCircle className="w-8 h-8 text-stone-400 mx-auto" />
              <h4 className="font-bold text-sm text-stone-800 dark:text-zinc-200">
                No Candidate Records Found in This Browser
              </h4>
              <p className="text-xs text-stone-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                If projects were formulated on a different device or browser, their local emergency recovery drafts remain on that browser. You can inspect that browser using this tool or export from that machine.
              </p>
            </div>
          ) : (
            candidates.map((cand, idx) => (
              <div
                key={`${cand.projectId}_${cand.source}_${idx}`}
                data-testid={`recovery-candidate-card-${cand.projectId}`}
                className="p-3.5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-850/60 shadow-2xs space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getSourceIcon(cand.source)}
                    <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
                      {cand.projectCode || 'PROJECT'}
                    </span>
                    <span className="font-bold text-sm text-stone-900 dark:text-zinc-100">
                      {cand.productName}
                    </span>
                    {getSourceBadge(cand.source)}
                    {cand.isPopulated ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                        Populated ({cand.ingredientCount} ings)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400">
                        Empty Shell
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-stone-400 dark:text-zinc-500 font-mono">
                    {new Date(cand.timestamp).toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-stone-100 dark:border-zinc-800 text-xs">
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase font-semibold block">Ingredients</span>
                    <span className="font-bold font-mono text-stone-800 dark:text-zinc-200">
                      {cand.ingredientCount} ingredient(s)
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase font-semibold block">Batch Weight</span>
                    <span className="font-bold font-mono text-stone-800 dark:text-zinc-200">
                      {cand.totalWeightGrams > 0 ? `${cand.totalWeightGrams.toFixed(1)} g` : '0 g'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase font-semibold block">Products / Sizes</span>
                    <span className="font-bold font-mono text-stone-800 dark:text-zinc-200">
                      {cand.productCount} size(s)
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase font-semibold block">Project ID</span>
                    <span className="font-mono text-[11px] text-stone-500 truncate block" title={cand.projectId}>
                      {cand.projectId}
                    </span>
                  </div>
                </div>

                {cand.customerName && (
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 italic">
                    Customer: {cand.customerName}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-stone-50 dark:bg-zinc-850 border-t border-stone-200 dark:border-zinc-800 flex items-center justify-between text-xs">
          <p className="text-[11px] text-stone-500 dark:text-zinc-400">
            Read-only mode: No records will be replaced, overwritten, or cleared by this tool.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl font-bold bg-stone-200 dark:bg-zinc-700 text-stone-800 dark:text-zinc-200 hover:bg-stone-300 dark:hover:bg-zinc-600 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
