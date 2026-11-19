import React from 'react';
import { CheckCircle2, Clock, ArrowRight, ShieldCheck } from 'lucide-react';

interface BillingSuccessScreenProps {
  sessionId?: string | null;
  workspaceId?: string | null;
  onReturnToApp: () => void;
}

/**
 * Safe Internal Success Screen (Phase 1.4)
 *
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * This screen is NOT proof of payment.
 * It NEVER writes to Firestore billing documents.
 * It NEVER mutates entitlement status or marks subscriptions active.
 * Real subscription activation is deferred exclusively to verified Stripe webhooks in Phase 1.5.
 */
export const BillingSuccessScreen: React.FC<BillingSuccessScreenProps> = ({
  sessionId,
  workspaceId,
  onReturnToApp,
}) => {
  return (
    <div
      id="billing-success-screen"
      className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 font-sans select-none"
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#1C1A18] rounded-2xl shadow-xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
        <div className="h-1.5 bg-emerald-500 w-full" />

        <div className="p-6 sm:p-8 space-y-6 text-center">
          {/* Header Icon */}
          <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 ring-8 ring-emerald-50/50 dark:ring-emerald-950/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
              Payment Received
            </h1>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              We're confirming your subscription.
            </p>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto leading-relaxed pt-1">
              Your Stripe Checkout session was completed. Your workspace subscription is being activated
              and will synchronize automatically once verified.
            </p>
          </div>

          {/* Verification Status Banner */}
          <div className="rounded-xl p-4 bg-[#FAF8F5] dark:bg-[#221F1C] border border-[#E5E1DA] dark:border-[#332F2B] text-left space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
              <Clock className="w-4 h-4 text-amber-600 animate-pulse shrink-0" />
              <span>Subscription Synchronization Pending</span>
            </div>
            <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
              In accordance with secure SaaS architecture, access entitlements are activated strictly through
              cryptographically verified Stripe webhook events.
            </p>

            {sessionId && (
              <div className="pt-2 border-t border-[#EEECE8] dark:border-[#2D2925] flex items-center justify-between text-[11px]">
                <span className="text-[#8B7E74] dark:text-[#A39E93]">Stripe Session:</span>
                <span className="font-mono text-[#5A534B] dark:text-[#D1CBC5] truncate max-w-[200px]">
                  {sessionId}
                </span>
              </div>
            )}

            {workspaceId && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#8B7E74] dark:text-[#A39E93]">Workspace:</span>
                <span className="font-mono text-[#5A534B] dark:text-[#D1CBC5]">{workspaceId}</span>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="button"
              id="btn-return-workspace"
              onClick={onReturnToApp}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold bg-[#5A534B] text-white hover:bg-[#48423C] dark:bg-[#D4A373] dark:text-[#1E1B18] dark:hover:bg-[#C49363] transition shadow-xs cursor-pointer"
            >
              <span>Return to Bakery Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#F5F2ED]/60 dark:bg-[#141210]/60 border-t border-[#EEECE8] dark:border-[#2D2925] flex items-center justify-center gap-2 text-center text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Sunny Sweets Platform • Secure Test Mode</span>
        </div>
      </div>
    </div>
  );
};
