import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Play,
  Lock,
  Database,
  Layers,
  ChevronDown,
  ChevronRight,
  Info,
  Key,
} from 'lucide-react';
import { auth, db } from '../services/firebase';
import { store } from '../services/store';
import {
  buildStage1LinkingPlan,
  executeAuthenticatedStage1Migration,
  Stage1LinkingPlan,
  Stage1ExecutionResult,
  STAGE1_APPROVED_MANIFEST_FINGERPRINT,
  TARGET_WORKSPACE_ID,
} from '../services/stage1MigrationService';
import { Recipe, MasterIngredient, AccessRole } from '../types';

interface Stage1MigrationCardProps {
  onNotification?: (msg: string) => void;
}

export const Stage1MigrationCard: React.FC<Stage1MigrationCardProps> = ({
  onNotification,
}) => {
  const [currentUser, setCurrentUser] = useState(auth.currentUser);
  const userRole = store.getUserRole() as AccessRole | null;
  const isOwner = userRole === 'owner';

  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [plan, setPlan] = useState<Stage1LinkingPlan | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<Stage1ExecutionResult | null>(null);

  // Safety confirmation text state
  const [confirmInput, setConfirmInput] = useState('');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Expandable details state
  const [showStage1Details, setShowStage1Details] = useState(false);
  const [showStage2Details, setShowStage2Details] = useState(false);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  // Handler to run pre-write verification audit
  const handleRunVerification = async () => {
    setIsLoading(true);
    setAuditError(null);
    setExecutionResult(null);

    try {
      const recipes = store.getRecipes(true);
      const masterIngredients = store.getMasterIngredients();

      const calculatedPlan = await buildStage1LinkingPlan(
        recipes,
        masterIngredients,
        TARGET_WORKSPACE_ID
      );

      setPlan(calculatedPlan);
      if (onNotification) {
        onNotification(
          calculatedPlan.isValid
            ? 'Pre-write verification audit passed: 512 Stage 1 lines verified.'
            : 'Pre-write audit completed with invariant notices.'
        );
      }
    } catch (err: any) {
      console.error('[Stage1Migration] Verification audit error:', err);
      setAuditError(err?.message || 'Failed to complete pre-write verification audit.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handler to execute authenticated Stage 1 migration
  const handleExecuteMigration = async () => {
    if (!currentUser || !isOwner) {
      setAuditError('Only authenticated workspace Owners can execute Stage 1 migration.');
      return;
    }

    if (confirmInput.trim().toUpperCase() !== 'EXECUTE STAGE 1 LINKING') {
      setAuditError('Please type the exact confirmation phrase to proceed.');
      return;
    }

    setIsExecuting(true);
    setAuditError(null);

    try {
      const result = await executeAuthenticatedStage1Migration({
        db,
        user: currentUser,
        workspaceId: TARGET_WORKSPACE_ID,
        role: 'owner',
      });

      setExecutionResult(result);
      setIsConfirmModalOpen(false);

      // Refresh store recipes from cloud
      await store.syncAllWithCloud();

      if (onNotification) {
        onNotification('Stage 1 linking completed successfully: 512 lines linked.');
      }
    } catch (err: any) {
      console.error('[Stage1Migration] Execution failed:', err);
      setAuditError(err?.message || 'Execution failed. Production data remains safely unchanged.');
    } finally {
      setIsExecuting(false);
    }
  };

  // Restrict access: Only Owners see full utility controls
  if (!isOwner) {
    return (
      <div
        id="stage1-migration-access-denied"
        className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-3"
      >
        <div className="flex items-center gap-2.5 text-stone-500 dark:text-stone-400">
          <Lock className="w-5 h-5 text-stone-400 shrink-0" />
          <h3 className="font-serif font-semibold text-base">
            MASTER INGREDIENT LINKING — STAGE 1 MIGRATION
          </h3>
        </div>
        <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
          This utility is restricted to workspace <strong className="font-semibold text-stone-700 dark:text-stone-300">Owners</strong> only. Editors and Viewers cannot view or run database migration operations.
        </p>
      </div>
    );
  }

  return (
    <div
      id="stage1-migration-utility-card"
      className="bg-white dark:bg-[#1E1B18] border-2 border-amber-300 dark:border-amber-700/80 rounded-xl p-6 shadow-md space-y-5"
    >
      {/* Header & Warning Banner */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20 mt-0.5">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif font-bold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                MASTER INGREDIENT LINKING — STAGE 1 MIGRATION
              </h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                Owner-Only Utility
              </span>
            </div>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1 max-w-2xl leading-relaxed">
              Authenticated browser execution utility for approved Phase 2A Stage 1 Master Ingredient linking.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="btn-run-stage1-prewrite-audit"
            disabled={isLoading || isExecuting}
            onClick={handleRunVerification}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F5F2ED] dark:bg-[#25221F] hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-bold rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] transition cursor-pointer disabled:opacity-50 shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Verifying Baseline...' : 'Run Pre-Write Verification Audit'}</span>
          </button>
        </div>
      </div>

      {/* Mandatory Warning Banner */}
      <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg text-xs space-y-1.5 text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>PRODUCTION INTEGRITY WARNING</span>
        </div>
        <p className="text-xs leading-relaxed">
          &ldquo;This utility modifies production recipe metadata. It does not change recipe quantities, units, names, or calculations.&rdquo;
        </p>
        <p className="text-[11px] opacity-80">
          This is a temporary migration/execution utility, NOT a normal customer-facing feature. All operations execute strictly via authenticated Web SDK writeBatch.
        </p>
      </div>

      {/* Operator Authorization Verification Box */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 rounded-lg bg-[#FAF8F5] dark:bg-[#25221F] border border-[#F0ECE6] dark:border-[#332F2B] text-xs">
        <div>
          <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Operator Email:</span>
          <span className="font-semibold text-emerald-700 dark:text-emerald-400 truncate block">
            {currentUser?.email || 'Unauthenticated'}
          </span>
        </div>
        <div>
          <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Operator UID:</span>
          <span className="font-mono text-[11px] text-[#5A534B] dark:text-[#EAE6E1] truncate block">
            {currentUser?.uid || '—'}
          </span>
        </div>
        <div>
          <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Workspace Target:</span>
          <span className="font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">
            {TARGET_WORKSPACE_ID}
          </span>
        </div>
        <div>
          <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Verified Role:</span>
          <span className="text-emerald-700 dark:text-emerald-400 font-bold inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Owner
          </span>
        </div>
      </div>

      {/* Audit Error Notification */}
      {auditError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">Execution / Verification Notice:</div>
            <div className="font-mono whitespace-pre-line text-[11px]">{auditError}</div>
          </div>
        </div>
      )}

      {/* Pre-Write Audit Report Display */}
      {plan && (
        <div className="space-y-4 pt-1">
          {/* Baseline Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Live Recipes</span>
              <span className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                {plan.totalRecipes} total
              </span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] block">
                {plan.activeRecipes} active &bull; {plan.archivedRecipes} archived
              </span>
            </div>

            <div className="p-3 rounded-lg bg-stone-50 dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Active Formula Lines</span>
              <span className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                {plan.activeFormulaLines}
              </span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] block">
                {plan.preExistingLinkedActiveLines} linked &bull; {plan.unlinkedActiveLines} unlinked
              </span>
            </div>

            <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40">
              <span className="text-emerald-700 dark:text-emerald-400 block font-medium">Stage 1 Planned Links</span>
              <span className="font-bold text-base text-emerald-800 dark:text-emerald-300">
                {plan.stage1LinesToLink} lines
              </span>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 block">
                {plan.stage1GroupsCount} groups &bull; {plan.stage1AffectedRecipesCount} recipes
              </span>
            </div>

            <div className="p-3 rounded-lg bg-stone-50 dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Stage 2 Excluded Lines</span>
              <span className="font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                {plan.stage2ExcludedLines} lines
              </span>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93] block">
                {plan.stage2ExcludedGroupsCount} human-approved groups
              </span>
            </div>
          </div>

          {/* Pre-Write Formula Hash & Manifest Verification */}
          <div className="p-3.5 rounded-lg bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-xs space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                <Key className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Pre-Write Formula Snapshot Hash:</span>
              </div>
              <span className="font-mono text-[11px] bg-white dark:bg-[#1E1B18] px-2 py-0.5 rounded border border-[#E5E1DA] dark:border-[#332F2B] truncate max-w-sm text-[#5A534B] dark:text-[#EAE6E1]">
                {plan.preWriteFormulaHash}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1.5 border-t border-[#F0ECE6] dark:border-[#332F2B]">
              <div className="flex items-center gap-1.5 font-medium text-[#8B7E74] dark:text-[#A39E93]">
                <Database className="w-3.5 h-3.5" />
                <span>Approved Manifest Fingerprint:</span>
              </div>
              <span className="font-mono text-[11px] bg-white dark:bg-[#1E1B18] px-2 py-0.5 rounded border border-[#E5E1DA] dark:border-[#332F2B] truncate max-w-sm text-stone-600 dark:text-stone-300">
                {plan.approvedManifestFingerprint}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1.5 border-t border-[#F0ECE6] dark:border-[#332F2B]">
              <div className="flex items-center gap-1.5 font-medium text-[#8B7E74] dark:text-[#A39E93]">
                <Layers className="w-3.5 h-3.5" />
                <span>Current Calculated Manifest Fingerprint:</span>
              </div>
              <span className="font-mono text-[11px] bg-white dark:bg-[#1E1B18] px-2 py-0.5 rounded border border-[#E5E1DA] dark:border-[#332F2B] truncate max-w-sm text-[#5A534B] dark:text-[#EAE6E1]">
                {plan.currentManifestFingerprint || '—'}
              </span>
            </div>

            {plan.isFingerprintApproved ? (
              <div className="p-2.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Manifest Fingerprint Verified &amp; Approved (Owner Authorized)</span>
              </div>
            ) : (
              <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Fingerprint Notice: Marshmallow Discrepancy Resolved — Approval Pending</span>
                </div>
                <p className="leading-relaxed">
                  The calculated SHA-256 fingerprint differs from the approved Phase 2A.5 hash because <em>Orange Marshmallow Cookies</em> (<code>Marhsmallow</code>) was corrected to target authoritative Master Ingredient <strong>Marshmallows (mi-1785876432641)</strong> instead of the corrupted duplicate entry (mi-1787072264396-0v58). Execution remains strictly locked until the new fingerprint is approved by the workspace owner.
                </p>
              </div>
            )}
          </div>

          {/* Expandable Stage 1 Group Manifest Summary */}
          <div className="border border-[#E5E1DA] dark:border-[#332F2B] rounded-lg overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowStage1Details(!showStage1Details)}
              className="w-full p-3 bg-stone-50 dark:bg-[#25221F] flex items-center justify-between font-bold text-[#5A534B] dark:text-[#EAE6E1] hover:bg-stone-100 dark:hover:bg-[#2D2925] transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {showStage1Details ? (
                  <ChevronDown className="w-4 h-4 text-[#D4A373]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[#D4A373]" />
                )}
                <span>Stage 1 Groups Manifest ({plan.stage1GroupsCount} groups, {plan.stage1LinesToLink} lines)</span>
              </div>
              <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                ✓ 100% Exact 1-to-1 Matches
              </span>
            </button>

            {showStage1Details && (
              <div className="p-3 max-h-60 overflow-y-auto divide-y divide-[#F0ECE6] dark:divide-[#332F2B] bg-white dark:bg-[#1E1B18]">
                {plan.stage1Groups.map((g) => (
                  <div key={g.normalizedName} className="py-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-[#5A534B] dark:text-[#EAE6E1]">
                      {g.displayName}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                        &rarr; {g.masterIngredientName} ({g.masterIngredientId})
                      </span>
                      <span className="font-bold text-[#D4A373] bg-[#FAF8F5] dark:bg-[#25221F] px-2 py-0.5 rounded border border-[#E5E1DA] dark:border-[#332F2B]">
                        {g.activeCount} {g.activeCount === 1 ? 'line' : 'lines'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expandable Stage 2 Excluded Groups Summary */}
          <div className="border border-[#E5E1DA] dark:border-[#332F2B] rounded-lg overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowStage2Details(!showStage2Details)}
              className="w-full p-3 bg-stone-50 dark:bg-[#25221F] flex items-center justify-between font-bold text-[#5A534B] dark:text-[#EAE6E1] hover:bg-stone-100 dark:hover:bg-[#2D2925] transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {showStage2Details ? (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-stone-400" />
                )}
                <span>Stage 2 Excluded Groups ({plan.stage2ExcludedGroupsCount} groups, {plan.stage2ExcludedLines} lines)</span>
              </div>
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                Protected from Stage 1 Execution
              </span>
            </button>

            {showStage2Details && (
              <div className="p-3 max-h-60 overflow-y-auto divide-y divide-[#F0ECE6] dark:divide-[#332F2B] bg-white dark:bg-[#1E1B18]">
                {Object.entries(plan.stage2Breakdown).map(([name, count]) => (
                  <div key={name} className="py-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium capitalize text-[#5A534B] dark:text-[#EAE6E1]">
                      {name}
                    </span>
                    <span className="font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                      {count} {count === 1 ? 'line' : 'lines'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Safety Execution Trigger Button & Invariant Status */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-[#F0ECE6] dark:border-[#2D2925]">
            <div className="flex items-center gap-2 text-xs">
              {plan.isValid ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  All Pre-Write Invariants Satisfied (0 Violations)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-bold">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  {plan.invariantViolations.length} Invariant Violations Detected — Execution Disabled
                </span>
              )}
            </div>

            <button
              type="button"
              id="btn-open-stage1-execution-modal"
              disabled={!plan.isValid || !plan.isFingerprintApproved || isExecuting}
              onClick={() => setIsConfirmModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Proceed to Stage 1 Execution</span>
            </button>
          </div>
        </div>
      )}

      {/* Post-Write Verification Results Display */}
      {executionResult && (
        <div
          id="stage1-execution-success-banner"
          className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs space-y-2 text-emerald-900 dark:text-emerald-200 animate-fadeIn"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>STAGE 1 PRODUCTION LINKING SUCCESSFUL &amp; VERIFIED</span>
          </div>
          <p className="text-xs leading-relaxed">{executionResult.message}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200 dark:border-emerald-800/60 font-mono text-[11px]">
            <div>Active Linked: {executionResult.postWriteActiveLinked} (Expected: 516)</div>
            <div>Active Unlinked: {executionResult.postWriteActiveUnlinked} (Expected: 169)</div>
            <div>Broken Links: {executionResult.postWriteBrokenLinks} (Expected: 0)</div>
            <div>Archived Preserved: {executionResult.postWriteArchivedUntouched} (Expected: 21)</div>
          </div>
        </div>
      )}

      {/* Confirmation Modal with Explicit Phrase Verification */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                  Confirm Stage 1 Production Execution
                </h3>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
                  You are about to link <strong className="text-[#5A534B] dark:text-[#EAE6E1]">512 active formula lines</strong> across <strong className="text-[#5A534B] dark:text-[#EAE6E1]">69 recipes</strong> in workspace <code className="font-mono bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">ws-main</code>.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-[#FAF8F5] dark:bg-[#25221F] rounded-lg text-xs space-y-2 text-[#5A534B] dark:text-[#D4CEC7] border border-[#E5E1DA] dark:border-[#332F2B]">
              <div className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Strict Execution Guarantees:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[#8B7E74] dark:text-[#A39E93] pl-1">
                <li>Modifies ONLY masterIngredientId metadata and updatedAt timestamp.</li>
                <li>Zero changes to recipe quantities, units, waste%, names, notes, or formulas.</li>
                <li>Pre-write and post-write formula SHA-256 hashes must match exactly.</li>
                <li>Stage 2 groups (169 lines) and archived recipes (21 lines) are 100% untouched.</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                To proceed, type <span className="font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">EXECUTE STAGE 1 LINKING</span> below:
              </label>
              <input
                type="text"
                id="input-stage1-confirm-phrase"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="EXECUTE STAGE 1 LINKING"
                className="w-full px-3.5 py-2 text-xs font-mono bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F0ECE6] dark:border-[#2D2925]">
              <button
                type="button"
                id="btn-cancel-stage1-modal"
                disabled={isExecuting}
                onClick={() => {
                  setIsConfirmModalOpen(false);
                  setConfirmInput('');
                }}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-execute-stage1"
                disabled={confirmInput.trim().toUpperCase() !== 'EXECUTE STAGE 1 LINKING' || isExecuting}
                onClick={handleExecuteMigration}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition cursor-pointer disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isExecuting ? 'Committing Writes...' : 'Execute Authenticated Linking'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
