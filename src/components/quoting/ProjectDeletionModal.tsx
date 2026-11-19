import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Trash2,
  Archive,
  X,
  CheckCircle2,
  ShieldAlert,
  Layers,
  FileText,
  Clock,
  Info,
} from 'lucide-react';
import { ProductProject, ProjectDeletionPreview } from '../../types/quoting';
import { AccessRole } from '../../types';
import { quotingService } from '../../services/quotingService';

export interface ProjectDeletionModalProps {
  isOpen: boolean;
  project: ProductProject | null;
  workspaceId: string;
  userRole: AccessRole | null;
  userId: string;
  onClose: () => void;
  onSuccess: (projectId: string, message: string) => void;
  onArchiveInstead?: (projectId: string) => void;
}

export const ProjectDeletionModal: React.FC<ProjectDeletionModalProps> = ({
  isOpen,
  project,
  workspaceId,
  userRole,
  userId,
  onClose,
  onSuccess,
  onArchiveInstead,
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectDeletionPreview | null>(null);

  // Generate / refresh preview when modal opens or project changes
  useEffect(() => {
    if (isOpen && project) {
      setConfirmationInput('');
      setErrorMsg(null);
      try {
        const p = quotingService.getProjectDeletionPreview(workspaceId, project.id, userRole);
        setPreview(p);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to generate deletion preview.');
        setPreview(null);
      }
    } else {
      setPreview(null);
      setConfirmationInput('');
      setErrorMsg(null);
    }
  }, [isOpen, project, workspaceId, userRole]);

  if (!isOpen || !project) return null;

  const isOwner = userRole === 'owner';
  const isEligible = preview?.isEligible ?? false;
  const isConfirmed = confirmationInput.trim() === 'DELETE';

  const handleExecuteDelete = async () => {
    if (!isEligible || !isConfirmed || isDeleting) return;

    setIsDeleting(true);
    setErrorMsg(null);

    try {
      // Re-verify preview state immediately before execution
      const freshPreview = quotingService.getProjectDeletionPreview(workspaceId, project.id, userRole);
      if (!freshPreview.isEligible) {
        throw new Error(`Deletion blocked: ${freshPreview.blockers.join('; ')}`);
      }

      await quotingService.deleteProjectPermanently({
        workspaceId,
        projectId: project.id,
        userRole,
        userId,
        confirmationText: confirmationInput.trim(),
        expectedBaseVersion: preview?.baseDocumentVersion,
      });

      onSuccess(
        project.id,
        `Project "${project.productName}" (${project.projectCode || project.id}) was permanently deleted.`
      );
      onClose();
    } catch (err: any) {
      console.error('[ProjectDeletionModal] Deletion failed:', err);
      setErrorMsg(err?.message || 'Deletion operation failed. The project has been safely preserved.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deletion-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-stone-200 dark:border-zinc-800 flex items-start justify-between gap-3 shrink-0 bg-red-50/40 dark:bg-red-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="deletion-modal-title"
                className="font-serif font-bold text-lg text-stone-900 dark:text-zinc-100"
              >
                Delete Project Permanently
              </h2>
              <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                <span>{project.productName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{project.projectCode || project.id}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs text-stone-700 dark:text-zinc-300">
          {/* Authorization Check */}
          {!isOwner && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start gap-3 text-amber-900 dark:text-amber-200">
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">Owner Authorization Required</p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                  Permanent deletion is restricted to authorized workspace Owners. Your current role is{' '}
                  <span className="font-bold uppercase font-mono">{userRole || 'viewer'}</span>.
                </p>
              </div>
            </div>
          )}

          {/* Ineligible Blockers Notice */}
          {preview && !preview.isEligible && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 space-y-2 text-red-900 dark:text-red-200">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-xs">Deletion Blocked by Business Integrity Rules</p>
                  <p className="text-[11px] text-red-800 dark:text-red-300 mt-0.5">
                    This project cannot be permanently deleted for the following reason(s):
                  </p>
                </div>
              </div>
              <ul className="list-disc pl-5 space-y-1 text-[11px] text-red-800 dark:text-red-300">
                {preview.blockers.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
              {onArchiveInstead && !project.archived && (
                <div className="pt-2 border-t border-red-200 dark:border-red-900/60 flex items-center justify-between">
                  <span className="text-[11px] text-red-700 dark:text-red-300">
                    You can archive this project to hide it from routine views:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onArchiveInstead(project.id);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-stone-800 dark:text-zinc-200 bg-white dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 hover:bg-stone-100 transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Archive className="w-3.5 h-3.5 text-stone-600 dark:text-zinc-400" />
                    <span>Archive Instead</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Error Message if deletion attempted and failed */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-100 dark:bg-red-900/50 border border-red-300 dark:border-red-700 text-red-900 dark:text-red-100 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-300 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Project Details Grid */}
          <div className="p-3.5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50/60 dark:bg-zinc-800/40 space-y-2.5">
            <h3 className="font-bold text-xs uppercase tracking-wider text-stone-500 dark:text-zinc-400">
              Project Record Summary
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-stone-400 text-[11px] block">Project Name</span>
                <span className="font-semibold text-stone-800 dark:text-zinc-200">{project.productName}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[11px] block">Project Identifier</span>
                <span className="font-mono font-bold text-stone-800 dark:text-zinc-200">
                  {project.projectCode || project.id}
                </span>
              </div>
              <div>
                <span className="text-stone-400 text-[11px] block">Customer</span>
                <span className="text-stone-700 dark:text-zinc-300">{project.customerName || 'Internal Bakery'}</span>
              </div>
              <div>
                <span className="text-stone-400 text-[11px] block">Status</span>
                <span className="capitalize text-stone-700 dark:text-zinc-300">
                  {project.archived ? 'Archived' : project.status}
                </span>
              </div>
              <div>
                <span className="text-stone-400 text-[11px] block">Draft Product Configurations</span>
                <span className="font-mono font-bold text-stone-800 dark:text-zinc-200 tabular-nums">
                  {preview?.productConfigurationsCount ?? (project.products?.length || 0)} size(s)
                </span>
              </div>
              <div>
                <span className="text-stone-400 text-[11px] block">Issued Quote Revisions</span>
                <span className="font-mono font-bold text-stone-800 dark:text-zinc-200 tabular-nums">
                  {preview?.issuedRevisionsCount ?? (project.revisions?.length || 0)} revision(s)
                </span>
              </div>
            </div>
          </div>

          {/* Deletion Breakdown: What will be deleted vs preserved */}
          {preview && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <h4 className="font-bold text-xs text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Records Scheduled for Permanent Removal:</span>
                </h4>
                <ul className="space-y-1 pl-4 text-[11px] text-stone-600 dark:text-zinc-400 list-disc">
                  {preview.whatWillBeDeleted.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Records That Will Remain Preserved:</span>
                </h4>
                <ul className="space-y-1 pl-4 text-[11px] text-stone-600 dark:text-zinc-400 list-disc">
                  {preview.whatWillBePreserved.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Step 3: Deliberate Confirmation Input */}
          {isEligible && (
            <div className="pt-2 border-t border-stone-200 dark:border-zinc-800 space-y-2">
              <div className="p-3 rounded-xl bg-red-50/60 dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/40 text-red-900 dark:text-red-200 text-xs">
                <p className="font-bold">Irreversible Action</p>
                <p className="text-[11px] text-red-800 dark:text-red-300 mt-0.5">
                  This permanently deletes the eligible project and its associated unissued draft data. This action
                  cannot be undone.
                </p>
              </div>

              <label
                htmlFor="confirmation-delete-input"
                className="block text-xs font-bold text-stone-800 dark:text-zinc-200"
              >
                Type <span className="font-mono text-red-600 dark:text-red-400 font-extrabold">DELETE</span> to confirm
                permanent deletion:
              </label>
              <input
                id="confirmation-delete-input"
                data-testid="input-confirm-project-deletion"
                type="text"
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder="Type DELETE"
                className="w-full px-3 py-2 text-sm font-mono tracking-wider rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                autoComplete="off"
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 px-5 border-t border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-3 shrink-0 bg-stone-50/50 dark:bg-zinc-850/50">
          <button
            type="button"
            data-testid="btn-cancel-project-deletion"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            data-testid="btn-confirm-project-deletion"
            onClick={handleExecuteDelete}
            disabled={!isEligible || !isConfirmed || isDeleting}
            className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isDeleting ? 'Deleting Permanently...' : 'Delete Project Permanently'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
