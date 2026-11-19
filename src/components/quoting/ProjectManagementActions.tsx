import React from 'react';
import { Copy, Archive, Save, FileText, ChefHat, Trash2 } from 'lucide-react';

export interface ProjectManagementActionsProps {
  projectId: string;
  isArchived?: boolean;
  isSaving: boolean;
  onDuplicate: (projectId: string) => void;
  onArchive: (projectId: string) => void;
  onUnarchive?: (projectId: string) => void;
  onSaveDraft: () => void;
  onOpenIssueRevision: () => void;
  onOpenPromotion?: () => void;
  onOpenDelete?: () => void;
  variant?: 'header' | 'footer';
}

export const ProjectManagementActions: React.FC<ProjectManagementActionsProps> = ({
  projectId,
  isArchived,
  isSaving,
  onDuplicate,
  onArchive,
  onUnarchive,
  onSaveDraft,
  onOpenIssueRevision,
  onOpenPromotion,
  onOpenDelete,
  variant = 'header',
}) => {
  return (
    <div
      data-testid={variant === 'footer' ? 'project-actions-bottom' : 'project-actions-top'}
      className="flex items-center gap-2 flex-wrap"
    >
      {/* Create / Promote Production Recipe (Phase 2B.6) */}
      {onOpenPromotion && (
        <button
          type="button"
          data-testid={`${variant}-action-promote-recipe`}
          onClick={onOpenPromotion}
          className="px-3 py-2 text-xs font-bold rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          title="Create Production Recipe"
        >
          <ChefHat className="w-3.5 h-3.5" />
          <span className={variant === 'header' ? 'hidden sm:inline' : 'inline'}>Create Recipe</span>
        </button>
      )}

      {/* Duplicate */}
      <button
        type="button"
        data-testid={`${variant}-action-duplicate`}
        onClick={() => onDuplicate(projectId)}
        className="px-3 py-2 text-xs font-bold rounded-xl border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
        title="Duplicate Project"
      >
        <Copy className="w-3.5 h-3.5" />
        <span className={variant === 'header' ? 'hidden sm:inline' : 'inline'}>Duplicate</span>
      </button>

      {/* Archive / Unarchive */}
      {isArchived ? (
        onUnarchive && (
          <button
            type="button"
            data-testid={`${variant}-action-unarchive`}
            onClick={() => onUnarchive(projectId)}
            className="px-3 py-2 text-xs font-bold rounded-xl border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <span>Unarchive</span>
          </button>
        )
      ) : (
        <button
          type="button"
          data-testid={`${variant}-action-archive`}
          onClick={() => onArchive(projectId)}
          className="px-3 py-2 text-xs font-bold rounded-xl border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          title="Archive Project"
        >
          <Archive className="w-3.5 h-3.5" />
          <span className={variant === 'header' ? 'hidden sm:inline' : 'inline'}>Archive</span>
        </button>
      )}

      {/* Delete Project Permanently (Owner Administration) */}
      {onOpenDelete && (
        <button
          type="button"
          data-testid={`${variant}-action-delete-permanently`}
          onClick={onOpenDelete}
          className="px-3 py-2 text-xs font-bold rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          title="Delete Project Permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className={variant === 'header' ? 'hidden sm:inline' : 'inline'}>Delete Permanently</span>
        </button>
      )}

      {/* Save Draft */}
      <button
        type="button"
        data-testid={`${variant}-action-save-draft`}
        onClick={onSaveDraft}
        disabled={isSaving}
        className="px-4 py-2 text-xs font-bold rounded-xl border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-800 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-700/80 shadow-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
      >
        <Save className="w-4 h-4" />
        <span>Save Draft</span>
      </button>

      {/* Issue Quote / New Revision */}
      <button
        type="button"
        data-testid={`${variant}-action-issue-quote`}
        onClick={onOpenIssueRevision}
        disabled={isSaving}
        className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
      >
        <FileText className="w-4 h-4" />
        <span>Issue Quote / New Revision</span>
      </button>
    </div>
  );
};
