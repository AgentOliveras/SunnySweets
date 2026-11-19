import React, { useState } from 'react';
import {
  ShieldAlert,
  CreditCard,
  Sparkles,
  AlertTriangle,
  Clock,
  LogOut,
  RefreshCw,
  CheckCircle2,
  Lock,
  Store,
  Users,
  ChevronRight,
  HelpCircle,
  XCircle,
} from 'lucide-react';
import { auth, logoutUser } from '../services/firebase';
import { store } from '../services/store';
import {
  AppAccessState,
  EntitlementEvaluation,
  PLAN_CATALOG,
  DISPLAY_PRICING_PLACEHOLDERS,
} from '../types/billing';
import { createCheckoutSession, BillingInterval } from '../services/stripeCheckout';

interface EntitlementScreenProps {
  accessState: AppAccessState;
  evaluation: EntitlementEvaluation;
  onRefresh?: () => void;
}

type PlaceholderViewMode = 'default' | 'choose_plan';

export const EntitlementScreen: React.FC<EntitlementScreenProps> = ({
  accessState,
  evaluation,
  onRefresh,
}) => {
  const [viewMode, setViewMode] = useState<PlaceholderViewMode>('default');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const currentUser = auth.currentUser;
  const isOwner = store.getUserRole() === 'owner';

  const handleSignOut = async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleRecheck = async () => {
    setIsRefreshing(true);
    try {
      if (currentUser?.uid) {
        await store.validateMembershipForUser(currentUser.uid);
      }
      if (onRefresh) {
        onRefresh();
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // If user clicked "Choose Plan"
  if (viewMode === 'choose_plan') {
    return (
      <ChoosePlanPlaceholderScreen
        onBack={() => setViewMode('default')}
        onSignOut={handleSignOut}
        onRefresh={handleRecheck}
        isRefreshing={isRefreshing}
      />
    );
  }

  // Render according to access state
  switch (accessState) {
    case 'SUBSCRIPTION_PAST_DUE':
      return (
        <BillingProblemScreen
          evaluation={evaluation}
          onSignOut={handleSignOut}
          onRefresh={handleRecheck}
          isRefreshing={isRefreshing}
        />
      );

    case 'SUBSCRIPTION_EXPIRED':
      return (
        <SubscriptionExpiredScreen
          evaluation={evaluation}
          onChoosePlan={() => setViewMode('choose_plan')}
          onSignOut={handleSignOut}
          onRefresh={handleRecheck}
          isRefreshing={isRefreshing}
        />
      );

    case 'NO_ENTITLEMENT':
    default:
      return (
        <NoEntitlementWorkspaceReadyScreen
          isOwner={isOwner}
          evaluation={evaluation}
          onChoosePlan={() => setViewMode('choose_plan')}
          onSignOut={handleSignOut}
          onRefresh={handleRecheck}
          isRefreshing={isRefreshing}
        />
      );
  }
};

/**
 * 1. NO_ENTITLEMENT Screen: Workspace Ready / Start 14-Day Free Trial (Section 10 & 13)
 */
export const NoEntitlementWorkspaceReadyScreen: React.FC<{
  isOwner: boolean;
  evaluation: EntitlementEvaluation;
  onChoosePlan: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}> = ({ isOwner, evaluation, onChoosePlan, onSignOut, onRefresh, isRefreshing }) => {
  const [isStartingTrial, setIsStartingTrial] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleStartTrial = async () => {
    if (isStartingTrial) return; // Prevent double-clicks
    setIsStartingTrial(true);
    setErrorMessage(null);

    try {
      await store.startFreeTrial();
      // On success, store updates billing and notifies subscribers,
      // re-evaluating accessState to TRIAL_ACTIVE and mounting calculator.
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      console.error('Failed to start trial:', err);
      const msg = err.message || "We couldn't start your trial. Please try again.";
      setErrorMessage(msg);
    } finally {
      setIsStartingTrial(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-white dark:bg-[#1C1A18] rounded-2xl shadow-xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
        <div className="h-1.5 bg-[#D4A373] w-full" />

        <div className="p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 ring-8 ring-amber-50/50 dark:ring-amber-950/20">
              <Sparkles className="w-8 h-8" />
            </div>

            {isOwner ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#D4A373]">
                  Your workspace is ready.
                </p>
                <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
                  Start your 14-day free trial.
                </h1>
                <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto leading-relaxed">
                  Explore the full Recipe &amp; Production Calculator for 14 days. No credit card required.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="inline-flex p-1.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 text-xs font-semibold px-3 mb-1">
                  Team Member Notice
                </div>
                <h1 className="text-xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
                  Your workspace owner has not started the trial yet.
                </h1>
                <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto leading-relaxed">
                  Your account is authorized in this bakery workspace, but the workspace owner must start the free trial before team members can access the production calculator.
                </p>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5 text-xs text-red-800 dark:text-red-300">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="space-y-0.5">
                <span className="font-semibold">Unable to activate trial</span>
                <p className="text-[11px] opacity-90">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Included Features */}
          <div className="rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] p-4 space-y-2.5 text-xs">
            <h3 className="font-semibold text-[#5A534B] dark:text-[#EAE6E1] uppercase tracking-wider text-[10px]">
              Included in your 14-day trial:
            </h3>
            <ul className="space-y-2 text-[#5A534B] dark:text-[#D1CBC5]">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Full Recipe &amp; Production Batch Calculator</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Baker&apos;s waste percentage adjustments &amp; flour scaling</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Equipment mixer capacity overload verification</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Master pantry ingredient specifications &amp; allergens</span>
              </li>
            </ul>
          </div>

          {/* Action Area */}
          <div className="space-y-2.5 pt-2">
            {isOwner ? (
              <button
                type="button"
                id="btn-start-trial"
                onClick={handleStartTrial}
                disabled={isStartingTrial}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold text-white shadow-sm transition ${
                  isStartingTrial
                    ? 'bg-[#D4A373]/70 cursor-not-allowed'
                    : 'bg-[#D4A373] hover:bg-[#C49363] cursor-pointer'
                }`}
              >
                {isStartingTrial ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Starting Trial...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Start 14-Day Free Trial</span>
                  </>
                )}
              </button>
            ) : null}

            <button
              type="button"
              id="btn-choose-plan"
              onClick={onChoosePlan}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>View Commercial Plans</span>
              <ChevronRight className="w-3.5 h-3.5 ml-auto text-[#8B7E74]" />
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                id="btn-recheck-access"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Check Access</span>
              </button>

              <button
                type="button"
                id="btn-sign-out"
                onClick={onSignOut}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#F5F2ED]/60 dark:bg-[#141210]/60 border-t border-[#EEECE8] dark:border-[#2D2925] text-center">
          <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
            Sunny Sweets Platform • 14-Day Free Trial
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * 2. SUBSCRIPTION_EXPIRED Screen: Trial Ended (Section 12)
 */
export const SubscriptionExpiredScreen: React.FC<{
  evaluation: EntitlementEvaluation;
  onChoosePlan: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}> = ({ evaluation, onChoosePlan, onSignOut, onRefresh, isRefreshing }) => {
  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-white dark:bg-[#1C1A18] rounded-2xl shadow-xl border border-amber-200 dark:border-amber-900/40 overflow-hidden">
        <div className="h-1.5 bg-amber-500 w-full" />

        <div className="p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 ring-8 ring-amber-50/50 dark:ring-amber-950/20">
              <Clock className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
                Your free trial has ended.
              </h1>
              <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto leading-relaxed">
                Your recipes and workspace data are safely preserved. Choose a plan to continue using the calculator.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <div className="space-y-0.5">
              <span className="font-semibold">Recipes &amp; workspace data safely preserved</span>
              <p className="text-[11px] opacity-90">
                All recipes, custom equipment presets, mixer configurations, and pantry ingredients are securely stored in your private workspace.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#8B7E74] dark:text-[#A39E93]">Access State</span>
              <span className="font-mono uppercase text-[11px] font-bold text-amber-700 dark:text-amber-400">
                {evaluation.accessState}
              </span>
            </div>
            <div className="flex items-start justify-between pt-1 border-t border-[#EEECE8] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93]">Status</span>
              <span className="text-right text-[#5A534B] dark:text-[#D1CBC5] max-w-[240px] leading-tight">
                {evaluation.reason}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              id="btn-choose-plan-expired"
              onClick={onChoosePlan}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold bg-[#D4A373] text-white hover:bg-[#C49363] transition shadow-sm cursor-pointer"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Choose Plan</span>
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                id="btn-refresh-expired"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Check Status</span>
              </button>

              <button
                type="button"
                id="btn-signout-expired"
                onClick={onSignOut}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#F5F2ED]/60 dark:bg-[#141210]/60 border-t border-[#EEECE8] dark:border-[#2D2925] text-center">
          <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
            Sunny Sweets Platform • Data Preserved
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * 3. Choose Plan Screen: Pricing Catalog Preview
 */
export const ChoosePlanPlaceholderScreen: React.FC<{
  onBack?: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}> = ({ onBack, onSignOut, onRefresh, isRefreshing }) => {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [submittingPlan, setSubmittingPlan] = useState<'solo' | 'team' | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutCancelledNotice, setCheckoutCancelledNotice] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('checkout') === 'cancelled';
    }
    return false;
  });

  const activeWorkspaceId = store.getActiveWorkspaceId();
  const userRole = store.getUserRole();
  const isOwner = userRole === 'owner';
  const evaluation = store.getEntitlementEvaluation();
  const billing = store.getBilling();

  const isInternalWorkspace = activeWorkspaceId === 'ws-main' || evaluation.planId === 'internal';
  const isStrategicPartner =
    evaluation.accessState === 'COMPLIMENTARY_ACTIVE' ||
    billing?.billingSource === 'strategic_partner' ||
    billing?.subscriptionStatus === 'complimentary';
  const hasActiveStripe =
    billing?.billingSource === 'stripe' && billing?.subscriptionStatus === 'active';

  const handleSubscribe = async (planId: 'solo' | 'team') => {
    if (!activeWorkspaceId) {
      setCheckoutError('Active workspace not found.');
      return;
    }
    if (!isOwner) {
      setCheckoutError('Only the workspace owner can manage subscriptions.');
      return;
    }
    setSubmittingPlan(planId);
    setCheckoutError(null);
    try {
      await createCheckoutSession({
        workspaceId: activeWorkspaceId,
        planId,
        billingInterval,
      });
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to start checkout. Please try again.');
      setSubmittingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-4xl bg-white dark:bg-[#1C1A18] rounded-2xl shadow-xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
        <div className="h-1.5 bg-[#D4A373] w-full" />

        <div className="p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 ring-8 ring-amber-50/50 dark:ring-amber-950/20">
              <CreditCard className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
              Select Bakery Subscription Plan
            </h1>
            <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-lg mx-auto leading-relaxed">
              Transparent, capacity-based plans for artisan bakers and growing commercial production operations.
            </p>
          </div>

          {/* Billing Interval Toggle (Monthly / Annual) */}
          <div className="flex items-center justify-center pt-1">
            <div className="inline-flex items-center p-1 rounded-xl bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B]">
              <button
                type="button"
                id="btn-interval-monthly"
                onClick={() => setBillingInterval('monthly')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  billingInterval === 'monthly'
                    ? 'bg-white dark:bg-[#1C1A18] text-[#5A534B] dark:text-[#EAE6E1] shadow-xs'
                    : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
                }`}
              >
                Monthly Billing
              </button>
              <button
                type="button"
                id="btn-interval-annual"
                onClick={() => setBillingInterval('annual')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  billingInterval === 'annual'
                    ? 'bg-white dark:bg-[#1C1A18] text-[#5A534B] dark:text-[#EAE6E1] shadow-xs'
                    : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B]'
                }`}
              >
                <span>Annual Billing</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Save
                </span>
              </button>
            </div>
          </div>

          {/* Cancellation Notice */}
          {checkoutCancelledNotice && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start justify-between gap-3 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Checkout was cancelled. Your workspace plan and entitlements remain unchanged.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCheckoutCancelledNotice(false);
                  if (typeof window !== 'undefined' && window.history) {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('checkout');
                    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
                  }
                }}
                className="text-amber-600 hover:text-amber-800 dark:text-amber-300 font-bold ml-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Error Banner */}
          {checkoutError && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1">
                <span className="font-semibold">Checkout Notice: </span>
                <span>{checkoutError}</span>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutError(null)}
                className="text-red-500 hover:text-red-700 font-bold ml-1"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {/* Solo Plan */}
            <div className="rounded-xl border border-[#E5E1DA] dark:border-[#332F2B] bg-[#FAFAF8] dark:bg-[#201D1A] p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-[#D4A373]" />
                    <span className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                      {PLAN_CATALOG.solo.name}
                    </span>
                  </div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded bg-[#EEECE8] dark:bg-[#2D2925] text-[#8B7E74] dark:text-[#A39E93]">
                    1 Seat
                  </span>
                </div>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
                  {PLAN_CATALOG.solo.description}
                </p>
                <div className="pt-1 flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                    {DISPLAY_PRICING_PLACEHOLDERS.solo}
                  </span>
                  <span className="text-[11px] font-mono text-[#8B7E74] dark:text-[#A39E93] uppercase">
                    {billingInterval}
                  </span>
                </div>
                <ul className="space-y-1.5 text-xs text-[#5A534B] dark:text-[#D1CBC5] pt-2 border-t border-[#EEECE8] dark:border-[#2D2925]">
                  {PLAN_CATALOG.solo.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {isInternalWorkspace ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#F5F2ED] dark:bg-[#2A2622] text-[#8B7E74] dark:text-[#A39E93] opacity-75 cursor-not-allowed border border-[#EEECE8] dark:border-[#332F2B]"
                >
                  Internal Operational Access (Non-Billed)
                </button>
              ) : isStrategicPartner ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 opacity-75 cursor-not-allowed border border-emerald-200 dark:border-emerald-800"
                >
                  Complimentary Team Access Active
                </button>
              ) : hasActiveStripe ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#F5F2ED] dark:bg-[#2A2622] text-[#8B7E74] dark:text-[#A39E93] opacity-75 cursor-not-allowed border border-[#EEECE8] dark:border-[#332F2B]"
                >
                  Active Subscription
                </button>
              ) : !isOwner ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#F5F2ED] dark:bg-[#2A2622] text-[#8B7E74] dark:text-[#A39E93] opacity-75 cursor-not-allowed border border-[#EEECE8] dark:border-[#332F2B]"
                >
                  Workspace Owner Required to Subscribe
                </button>
              ) : (
                <button
                  type="button"
                  id="btn-subscribe-solo"
                  onClick={() => handleSubscribe('solo')}
                  disabled={submittingPlan !== null}
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#5A534B] text-white hover:bg-[#48423C] dark:bg-[#D4A373] dark:text-[#1E1B18] dark:hover:bg-[#C49363] transition shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {submittingPlan === 'solo' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting to Stripe...</span>
                    </>
                  ) : (
                    <span>Subscribe to Solo ({billingInterval})</span>
                  )}
                </button>
              )}
            </div>

            {/* Team Plan */}
            <div className="rounded-xl border-2 border-[#D4A373] bg-[#FAFAF8] dark:bg-[#201D1A] p-5 flex flex-col justify-between space-y-4 relative">
              <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-[#D4A373] text-white text-[10px] font-bold uppercase tracking-wider">
                Recommended
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#D4A373]" />
                    <span className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                      {PLAN_CATALOG.team.name}
                    </span>
                  </div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                    5 Seats
                  </span>
                </div>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
                  {PLAN_CATALOG.team.description}
                </p>
                <div className="pt-1 flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                    {DISPLAY_PRICING_PLACEHOLDERS.team}
                  </span>
                  <span className="text-[11px] font-mono text-[#8B7E74] dark:text-[#A39E93] uppercase">
                    {billingInterval}
                  </span>
                </div>
                <ul className="space-y-1.5 text-xs text-[#5A534B] dark:text-[#D1CBC5] pt-2 border-t border-[#EEECE8] dark:border-[#2D2925]">
                  {PLAN_CATALOG.team.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {isInternalWorkspace ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#F5F2ED] dark:bg-[#2A2622] text-[#8B7E74] dark:text-[#A39E93] opacity-75 cursor-not-allowed border border-[#EEECE8] dark:border-[#332F2B]"
                >
                  Internal Operational Access (Non-Billed)
                </button>
              ) : isStrategicPartner ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 opacity-75 cursor-not-allowed border border-emerald-200 dark:border-emerald-800"
                >
                  Complimentary Team Access Active
                </button>
              ) : hasActiveStripe ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#F5F2ED] dark:bg-[#2A2622] text-[#8B7E74] dark:text-[#A39E93] opacity-75 cursor-not-allowed border border-[#EEECE8] dark:border-[#332F2B]"
                >
                  Active Subscription
                </button>
              ) : !isOwner ? (
                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#F5F2ED] dark:bg-[#2A2622] text-[#8B7E74] dark:text-[#A39E93] opacity-75 cursor-not-allowed border border-[#EEECE8] dark:border-[#332F2B]"
                >
                  Workspace Owner Required to Subscribe
                </button>
              ) : (
                <button
                  type="button"
                  id="btn-subscribe-team"
                  onClick={() => handleSubscribe('team')}
                  disabled={submittingPlan !== null}
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-[#D4A373] text-white hover:bg-[#C49363] transition shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {submittingPlan === 'team' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting to Stripe...</span>
                    </>
                  ) : (
                    <span>Subscribe to Team ({billingInterval})</span>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[#EEECE8] dark:border-[#2D2925]">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-3 py-2 rounded-xl text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition"
              >
                ← Back
              </button>
            )}

            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition ml-auto"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 4. Billing Problem Screen: Past Due
 */
export const BillingProblemScreen: React.FC<{
  evaluation: EntitlementEvaluation;
  onSignOut: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}> = ({ evaluation, onSignOut, onRefresh, isRefreshing }) => {
  const activeWorkspace = store.getActiveWorkspace();

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-white dark:bg-[#1C1A18] rounded-2xl shadow-xl border border-red-200 dark:border-red-900/40 overflow-hidden">
        <div className="h-1.5 bg-red-500 w-full" />

        <div className="p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 ring-8 ring-red-50/50 dark:ring-red-950/20">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
                Payment Resolution Required
              </h1>
              <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto leading-relaxed">
                Your workspace subscription renewal is past due. Application tools are temporarily restricted until payment is resolved.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200">
            <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div className="space-y-0.5">
              <span className="font-semibold">Your bakery data is safe</span>
              <p className="text-[11px] opacity-90">
                All formulations, custom equipment presets, and historical batch logs remain preserved and will be instantly available once billing is restored.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#EEECE8] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93]">Target Workspace</span>
              <span className="font-mono font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                {activeWorkspace?.id || 'ws-main'}
              </span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-[#EEECE8] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93]">Billing State</span>
              <span className="font-mono uppercase font-bold text-red-600">
                {evaluation.accessState}
              </span>
            </div>
            <div className="flex items-start justify-between pt-0.5">
              <span className="text-[#8B7E74] dark:text-[#A39E93]">Notice</span>
              <span className="text-right text-[#5A534B] dark:text-[#D1CBC5] max-w-[240px] leading-tight">
                {evaluation.reason}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              disabled
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-red-600 text-white opacity-60 cursor-not-allowed shadow-sm"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Update Payment Method (Stripe Portal Placeholder)</span>
            </button>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Recheck Payment Status</span>
              </button>

              <button
                type="button"
                onClick={onSignOut}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
