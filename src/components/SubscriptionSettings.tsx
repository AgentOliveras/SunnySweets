import React, { useState } from 'react';
import {
  CreditCard,
  Crown,
  Sparkles,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ExternalLink,
  ShieldCheck,
  Check,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { store } from '../services/store';
import { PLAN_CATALOG, PlanId, WorkspaceBilling } from '../types/billing';
import { ChoosePlanPlaceholderScreen } from './EntitlementScreens';

interface SubscriptionSettingsProps {
  onSuccessNotice?: (message: string) => void;
}

export const SubscriptionSettings: React.FC<SubscriptionSettingsProps> = ({ onSuccessNotice }) => {
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showDevSimulation, setShowDevSimulation] = useState(false);
  const [checkoutCancelledNotice, setCheckoutCancelledNotice] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('checkout') === 'cancelled';
    }
    return false;
  });

  const evaluation = store.getEntitlementEvaluation();
  const billing = store.getBilling();
  const activeMembersCount = store.getComputedActiveSeatCount();
  const userRole = store.getUserRole();
  const isOwner = userRole === 'owner';
  const isDevelopment = Boolean((import.meta as any)?.env?.DEV);

  const planDef = PLAN_CATALOG[evaluation.planId] || PLAN_CATALOG.solo;
  const seatLimit = evaluation.seatLimit ?? planDef.seatLimit;
  const seatPercentage =
    evaluation.planId === 'internal'
      ? 10
      : Math.min(100, Math.round((activeMembersCount / Math.max(1, seatLimit)) * 100));

  const handleSimulateBilling = (mockBilling: WorkspaceBilling | null, label: string) => {
    store.setMockBillingForTesting(mockBilling);
    if (onSuccessNotice) {
      onSuccessNotice(`Simulated billing state: ${label}`);
    }
  };

  return (
    <div className="bg-white dark:bg-[#1E1B18] rounded-2xl border border-[#E5E1DA] dark:border-[#332F2B] p-6 shadow-sm space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#EEECE8] dark:border-[#2D2925]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Subscription & Plan Entitlements
              </h3>
              {/* Entitlement Badge */}
              <span
                className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                  evaluation.accessState === 'AUTHORIZED_INTERNAL'
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800'
                    : evaluation.accessState === 'COMPLIMENTARY_ACTIVE'
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800'
                    : evaluation.accessState === 'SUBSCRIPTION_ACTIVE'
                    ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-800'
                    : evaluation.accessState === 'TRIAL_ACTIVE'
                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800'
                    : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-800'
                }`}
              >
                {evaluation.accessState === 'AUTHORIZED_INTERNAL'
                  ? 'Internal Operational'
                  : evaluation.accessState === 'COMPLIMENTARY_ACTIVE'
                  ? 'Strategic Partner'
                  : evaluation.accessState === 'SUBSCRIPTION_ACTIVE'
                  ? 'Active Subscription'
                  : evaluation.accessState === 'TRIAL_ACTIVE'
                  ? 'Active Trial'
                  : 'Restricted / Inactive'}
              </span>
            </div>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5">
              Production scaling capacity, team seat allocations, and billing plan tier.
            </p>
          </div>
        </div>

        {/* Upgrade / Pricing Modal Trigger */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setShowPlanModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#FAF8F5] dark:bg-[#25221F] hover:bg-[#F0ECE4] dark:hover:bg-[#2E2A26] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-semibold rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#D4A373]" />
            <span>View Plan Catalog</span>
          </button>
        </div>
      </div>

      {/* Cancellation Notice (Phase 1.4) */}
      {checkoutCancelledNotice && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start justify-between gap-3 text-xs text-amber-800 dark:text-amber-200">
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

      {/* Plan Card & Capacity Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tier Card */}
        <div className="rounded-xl p-4 bg-[#FAF8F5] dark:bg-[#221F1C] border border-[#E5E1DA] dark:border-[#332F2B] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">Current Plan</span>
            <Crown className="w-4 h-4 text-[#D4A373]" />
          </div>
          <p className="text-lg font-bold text-[#5A534B] dark:text-[#EAE6E1]">{planDef.name}</p>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
            {planDef.description}
          </p>
        </div>

        {/* Seat Usage Card */}
        <div className="rounded-xl p-4 bg-[#FAF8F5] dark:bg-[#221F1C] border border-[#E5E1DA] dark:border-[#332F2B] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">Seat Utilization</span>
            <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1]">{activeMembersCount}</span>
            <span className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
              / {evaluation.planId === 'internal' ? 'Unlimited' : `${seatLimit} seats`}
            </span>
          </div>
          <div className="w-full bg-[#E5E1DA] dark:bg-[#332F2B] h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                seatPercentage >= 100
                  ? 'bg-amber-600'
                  : seatPercentage >= 80
                  ? 'bg-amber-500'
                  : 'bg-emerald-600'
              }`}
              style={{ width: `${seatPercentage}%` }}
            />
          </div>
        </div>

        {/* Renewal & Billing Status Card */}
        <div className="rounded-xl p-4 bg-[#FAF8F5] dark:bg-[#221F1C] border border-[#E5E1DA] dark:border-[#332F2B] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">Billing Status</span>
            <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1]">
            {evaluation.isCompatibilityFallback
              ? 'Founding Member Access'
              : evaluation.accessState === 'COMPLIMENTARY_ACTIVE'
              ? 'Complimentary'
              : evaluation.accessState === 'TRIAL_ACTIVE'
              ? 'Trial Active'
              : billing?.subscriptionStatus
              ? billing.subscriptionStatus.toUpperCase()
              : 'Active'}
          </p>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            {evaluation.accessState === 'COMPLIMENTARY_ACTIVE'
              ? 'Complimentary access provided by Sunny Sweets.'
              : evaluation.accessState === 'TRIAL_ACTIVE' && billing?.trialEndsAt
              ? `Trial ends: ${new Date(billing.trialEndsAt).toLocaleDateString()}`
              : evaluation.expiresAt
              ? `Period ends: ${new Date(evaluation.expiresAt).toLocaleDateString()}`
              : 'Continuous operational access'}
          </p>
        </div>
      </div>

      {/* Plan Capabilities & Included Features */}
      <div className="rounded-xl p-5 bg-[#FAF8F5] dark:bg-[#221F1C] border border-[#E5E1DA] dark:border-[#332F2B] space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-xs uppercase tracking-wider text-[#5A534B] dark:text-[#EAE6E1]">
            Included in {planDef.name} ({planDef.seatLimit === null ? 'Unlimited' : `${planDef.seatLimit} Seat${planDef.seatLimit > 1 ? 's' : ''}`})
          </h4>
          <span className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
            Plan tier: <strong className="uppercase font-semibold">{evaluation.planId}</strong>
          </span>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#5A534B] dark:text-[#D1CBC5] pt-1">
          {planDef.features.map((feat, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>{feat}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Strategic Partner Complimentary Access Details Card */}
      {evaluation.accessState === 'COMPLIMENTARY_ACTIVE' && (
        <div className="rounded-xl p-5 bg-gradient-to-r from-emerald-50/70 to-teal-50/40 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-200/80 dark:border-emerald-800/40 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                  Complimentary Team Access
                </h4>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  Strategic Partner access provided by Sunny Sweets.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-emerald-200/60 dark:border-emerald-900/30 text-xs">
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Plan</span>
              <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Team</span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Access</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                Strategic Partner Access
              </span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Billing</span>
              <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Complimentary</span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Status</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">Active</span>
            </div>
          </div>

          {(billing?.organizationName ||
            billing?.propertyName ||
            billing?.relationshipLabel ||
            billing?.complimentaryReason ||
            billing?.complimentaryExpiresAt) && (
            <div className="pt-2 border-t border-emerald-200/40 dark:border-emerald-900/20 text-xs space-y-1 text-[#6B635B] dark:text-[#BFB9B0]">
              {billing?.relationshipLabel && (
                <div>
                  <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Relationship:</span>{' '}
                  {billing.relationshipLabel}
                </div>
              )}
              {billing?.organizationName && (
                <div>
                  <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Organization:</span>{' '}
                  {billing.organizationName}
                  {billing?.propertyName ? ` (${billing.propertyName})` : ''}
                </div>
              )}
              {billing?.complimentaryReason && (
                <div>
                  <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Purpose:</span>{' '}
                  {billing.complimentaryReason}
                </div>
              )}
              {billing?.complimentaryExpiresAt && (
                <div>
                  <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Expires:</span>{' '}
                  {new Date(billing.complimentaryExpiresAt).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section 11: Active Trial Details Card */}
      {evaluation.accessState === 'TRIAL_ACTIVE' && (
        <div className="rounded-xl p-5 bg-gradient-to-r from-amber-50/70 to-orange-50/40 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200/80 dark:border-amber-800/40 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                  14-Day Free Trial Active
                </h4>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  All production calculation and bakery recipe features unlocked.
                </p>
              </div>
            </div>
            <button
              type="button"
              id="btn-choose-plan-trial"
              onClick={() => setShowPlanModal(true)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#D4A373] hover:bg-[#C49363] text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Choose a Plan</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-amber-200/60 dark:border-amber-900/30 text-xs">
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Plan</span>
              <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">Solo Trial</span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Status</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">Trial Active</span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Trial Started</span>
              <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                {billing?.trialStartedAt
                  ? new Date(billing.trialStartedAt).toLocaleDateString()
                  : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block text-[11px]">Days Remaining</span>
              <span className="font-bold text-amber-700 dark:text-amber-400">
                {billing?.trialEndsAt
                  ? `${Math.max(0, Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} days remaining`
                  : '14 days remaining'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Developer & QA Preview Switcher (Development builds only - NEVER rendered in production) */}
      {isDevelopment && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowDevSimulation(!showDevSimulation)}
            className="text-xs text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] flex items-center gap-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{showDevSimulation ? 'Hide Architecture Simulation Tools' : 'Developer & QA Entitlement Preview'}</span>
          </button>

          {showDevSimulation && (
            <div className="mt-3 p-4 rounded-xl bg-[#FAF8F5] dark:bg-[#221F1C] border border-[#E5E1DA] dark:border-[#332F2B] space-y-3">
              <p className="text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                Phase 1.0 State Simulation (In-Memory Sandbox):
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSimulateBilling(null, 'Authoritative Fallback')}
                  className="px-2.5 py-1 text-xs rounded bg-white dark:bg-[#1C1A18] border border-[#D4A373] text-[#D4A373] hover:bg-[#D4A373] hover:text-white transition font-medium"
                >
                  Reset to Real State
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSimulateBilling(
                      {
                        planId: 'team',
                        subscriptionStatus: 'trialing',
                        entitlementStatus: 'active',
                        trialStartedAt: new Date().toISOString(),
                        trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
                        stripeCustomerId: null,
                        stripeSubscriptionId: null,
                        stripePriceId: null,
                        seatLimit: 5,
                        activeSeatCount: 2,
                        cancelAtPeriodEnd: false,
                        currentPeriodStart: new Date().toISOString(),
                        currentPeriodEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
                        billingUpdatedAt: new Date().toISOString(),
                        billingSource: 'internal',
                      },
                      '7-Day Active Trial'
                    )
                  }
                  className="px-2.5 py-1 text-xs rounded bg-white dark:bg-[#1C1A18] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#EEECE8] transition"
                >
                  Simulate Active Trial
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSimulateBilling(
                      {
                        planId: 'team',
                        subscriptionStatus: 'active',
                        entitlementStatus: 'active',
                        trialStartedAt: null,
                        trialEndsAt: null,
                        stripeCustomerId: 'cus_preview',
                        stripeSubscriptionId: 'sub_preview',
                        stripePriceId: 'price_preview',
                        seatLimit: 5,
                        activeSeatCount: 3,
                        cancelAtPeriodEnd: false,
                        currentPeriodStart: new Date().toISOString(),
                        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
                        billingUpdatedAt: new Date().toISOString(),
                        billingSource: 'stripe',
                      },
                      'Active Team Subscription'
                    )
                  }
                  className="px-2.5 py-1 text-xs rounded bg-white dark:bg-[#1C1A18] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#EEECE8] transition"
                >
                  Simulate Paid Team Plan
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSimulateBilling(
                      {
                        planId: 'team',
                        subscriptionStatus: 'complimentary',
                        entitlementStatus: 'active',
                        trialStartedAt: null,
                        trialEndsAt: null,
                        stripeCustomerId: null,
                        stripeSubscriptionId: null,
                        stripePriceId: null,
                        seatLimit: 5,
                        activeSeatCount: 1,
                        cancelAtPeriodEnd: false,
                        currentPeriodStart: new Date().toISOString(),
                        currentPeriodEnd: null,
                        billingUpdatedAt: new Date().toISOString(),
                        billingSource: 'strategic_partner',
                        complimentaryAccess: true,
                        complimentaryStartedAt: new Date().toISOString(),
                        complimentaryExpiresAt: null,
                        complimentaryReason: 'Executive Chef Partner Program',
                        strategicPartnerType: 'chef',
                        grantedBy: 'admin-system',
                        strategicPartner: true,
                      },
                      'Strategic Partner Access'
                    )
                  }
                  className="px-2.5 py-1 text-xs rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition"
                >
                  Simulate Strategic Partner
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSimulateBilling(
                      {
                        planId: 'solo',
                        subscriptionStatus: 'trialing',
                        entitlementStatus: 'expired',
                        trialStartedAt: new Date(Date.now() - 15 * 86400000).toISOString(),
                        trialEndsAt: new Date(Date.now() - 1 * 86400000).toISOString(),
                        stripeCustomerId: null,
                        stripeSubscriptionId: null,
                        stripePriceId: null,
                        seatLimit: 1,
                        activeSeatCount: 1,
                        cancelAtPeriodEnd: false,
                        currentPeriodStart: null,
                        currentPeriodEnd: null,
                        billingUpdatedAt: new Date().toISOString(),
                        billingSource: 'internal',
                      },
                      'Expired Trial'
                    )
                  }
                  className="px-2.5 py-1 text-xs rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-100 transition"
                >
                  Simulate Expired Trial
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSimulateBilling(
                      {
                        planId: 'team',
                        subscriptionStatus: 'past_due',
                        entitlementStatus: 'past_due',
                        trialStartedAt: null,
                        trialEndsAt: null,
                        stripeCustomerId: 'cus_preview',
                        stripeSubscriptionId: 'sub_preview',
                        stripePriceId: 'price_preview',
                        seatLimit: 5,
                        activeSeatCount: 2,
                        cancelAtPeriodEnd: false,
                        currentPeriodStart: new Date(Date.now() - 35 * 86400000).toISOString(),
                        currentPeriodEnd: new Date(Date.now() - 5 * 86400000).toISOString(),
                        billingUpdatedAt: new Date().toISOString(),
                        billingSource: 'stripe',
                      },
                      'Past Due Billing'
                    )
                  }
                  className="px-2.5 py-1 text-xs rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition"
                >
                  Simulate Past Due
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Plan Preview Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="relative w-full max-w-4xl bg-white dark:bg-[#1C1A18] rounded-2xl shadow-2xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between p-4 px-6 bg-white dark:bg-[#1C1A18] border-b border-[#EEECE8] dark:border-[#2D2925]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#D4A373]" />
                <h4 className="font-serif font-bold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Bakery SaaS Subscription Plans (Phase 1.0 Preview)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                className="p-1 rounded-lg text-[#8B7E74] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F]"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <ChoosePlanPlaceholderScreen
                onBack={() => setShowPlanModal(false)}
                onSignOut={() => setShowPlanModal(false)}
                onRefresh={() => setShowPlanModal(false)}
                isRefreshing={false}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
