import {
  WorkspaceBilling,
  AppAccessState,
  EntitlementEvaluation,
  PlanId,
  EntitlementStatus,
  SubscriptionStatus,
  PLAN_CATALOG,
} from '../types/billing';

export interface EvaluateParams {
  isAuthenticated: boolean;
  hasWorkspaceMembership: boolean;
  billingDoc?: WorkspaceBilling | null;
  workspaceId?: string;
  now?: Date;
}

const KNOWN_PLANS: readonly PlanId[] = ['internal', 'solo', 'team'];

const KNOWN_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'internal',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'paused',
  'expired',
  'complimentary',
];

const KNOWN_ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = [
  'active',
  'restricted',
  'inactive',
  'expired',
  'past_due',
  'canceled',
];

/**
 * Centralized EntitlementService
 *
 * Formalizes application access as:
 * isAuthenticated
 * AND hasWorkspaceMembership
 * AND hasValidEntitlement
 * = canAccessApp
 *
 * INVARIANTS:
 * 1. ZERO-TRUST: Never assume subscription validity without explicit server doc or ws-main compatibility.
 * 2. STRICT COMPATIBILITY: Compatibility fallback applies ONLY to workspaceId === "ws-main".
 * 3. FAIL-CLOSED: Missing, malformed, or unrecognized plan/status records evaluate to NO_ENTITLEMENT.
 * 4. NO LEAKAGE: When canAccessApp is false, the Recipe Calculator must NOT mount.
 */
export class EntitlementService {
  /**
   * Evaluates subscription and entitlement status strictly.
   */
  public static evaluate(params: EvaluateParams): EntitlementEvaluation {
    try {
      const {
        isAuthenticated,
        hasWorkspaceMembership,
        billingDoc,
        workspaceId = 'ws-main',
        now = new Date(),
      } = params || {};

      // 1. Authentication Check
      if (!isAuthenticated) {
        return {
          accessState: 'SIGNED_OUT',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId: 'solo',
          entitlementStatus: 'inactive',
          seatLimit: 1,
          maxSeats: 1,
          reason: 'User is not authenticated with Google Identity.',
          expiresAt: null,
          billing: null,
        };
      }

      // 2. Workspace Membership Check
      if (!hasWorkspaceMembership) {
        return {
          accessState: 'NO_WORKSPACE',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId: 'solo',
          entitlementStatus: 'inactive',
          seatLimit: 1,
          maxSeats: 1,
          reason: 'User does not possess authorized membership in target workspace.',
          expiresAt: null,
          billing: null,
        };
      }

      // 3. TEMPORARY PHASE 1 SUNNY SWEETS COMPATIBILITY — REMOVE IN PHASE 1.9
      // Current Phase 1 compatibility allows existing Sunny Sweets members to continue
      // operating before billing/current is provisioned.
      //
      // STRICT CONSTRAINT:
      // This exception applies ONLY to workspaceId === "ws-main".
      // Do NOT infer internal entitlement from:
      // - existing membership
      // - owner role or editor role
      // - workspace creation date
      // - missing billing document in any other workspace
      // - email address or owner UID
      // - workspace name
      //
      // if activeWorkspaceId === "ws-main"
      // AND valid UID workspace membership exists
      // AND billing/current does not yet exist
      // → temporary AUTHORIZED_INTERNAL
      //
      // For EVERY other workspace:
      // missing billing/current → NO_ENTITLEMENT
      if (billingDoc === null || billingDoc === undefined) {
        if (workspaceId === 'ws-main') {
          return {
            accessState: 'AUTHORIZED_INTERNAL',
            canAccessApp: true,
            hasFullEntitlement: true,
            planId: 'internal',
            entitlementStatus: 'active',
            seatLimit: null,
            maxSeats: null,
            reason:
              'TEMPORARY PHASE 1 SUNNY SWEETS COMPATIBILITY — REMOVE IN PHASE 1.9: Implicit internal entitlement active for verified ws-main member.',
            expiresAt: null,
            billing: null,
            isCompatibilityFallback: true,
          };
        }

        // Fail-closed for all other workspaces
        return {
          accessState: 'NO_ENTITLEMENT',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId: 'solo',
          entitlementStatus: 'inactive',
          seatLimit: 1,
          maxSeats: 1,
          reason: `Workspace "${workspaceId}" missing required billing document (billing/current).`,
          expiresAt: null,
          billing: null,
        };
      }

      // 4. Fail-closed Validation of Authoritative Billing Document
      // If billing/current cannot be read, is malformed, has an unknown planId,
      // has an unknown subscriptionStatus, or has an unknown entitlementStatus → NO_ENTITLEMENT
      if (
        !billingDoc ||
        typeof billingDoc !== 'object' ||
        !KNOWN_PLANS.includes(billingDoc.planId) ||
        !KNOWN_SUBSCRIPTION_STATUSES.includes(billingDoc.subscriptionStatus) ||
        !KNOWN_ENTITLEMENT_STATUSES.includes(billingDoc.entitlementStatus)
      ) {
        return {
          accessState: 'NO_ENTITLEMENT',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId: 'solo',
          entitlementStatus: 'inactive',
          seatLimit: 1,
          maxSeats: 1,
          reason:
            'Billing document is malformed or contains unrecognized planId, subscriptionStatus, or entitlementStatus.',
          expiresAt: null,
          billing: billingDoc as any,
        };
      }

      const {
        planId,
        subscriptionStatus,
        entitlementStatus,
        trialEndsAt,
        currentPeriodEnd,
        cancelAtPeriodEnd,
      } = billingDoc;

      const catalogEntry = PLAN_CATALOG[planId] || PLAN_CATALOG.solo;
      const seatLimit =
        planId === 'internal'
          ? null
          : typeof billingDoc.seatLimit === 'number'
          ? billingDoc.seatLimit
          : catalogEntry.seatLimit;
      const maxSeats = seatLimit;

      const currentTimeMs = now instanceof Date ? now.getTime() : new Date().getTime();

      // A. INTERNAL PLAN
      if (planId === 'internal') {
        if (entitlementStatus === 'active') {
          return {
            accessState: 'AUTHORIZED_INTERNAL',
            canAccessApp: true,
            hasFullEntitlement: true,
            planId: 'internal',
            entitlementStatus: 'active',
            seatLimit: null,
            maxSeats: null,
            reason: 'Authorized founding bakery internal operational plan.',
            expiresAt: null,
            billing: billingDoc,
          };
        }
        return {
          accessState: 'NO_ENTITLEMENT',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId: 'internal',
          entitlementStatus: 'inactive',
          seatLimit: null,
          maxSeats: null,
          reason: 'Internal workspace entitlement is explicitly inactive or restricted.',
          expiresAt: null,
          billing: billingDoc,
        };
      }

      // B. TRIALING
      if (subscriptionStatus === 'trialing') {
        const trialEndsMs = trialEndsAt ? new Date(trialEndsAt).getTime() : 0;
        const isTrialValid = !isNaN(trialEndsMs) && trialEndsMs > currentTimeMs;

        if (isTrialValid && entitlementStatus === 'active') {
          return {
            accessState: 'TRIAL_ACTIVE',
            canAccessApp: true,
            hasFullEntitlement: true,
            planId,
            entitlementStatus: 'active',
            seatLimit,
            maxSeats,
            reason: 'Active 14-day production trial period.',
            expiresAt: trialEndsAt,
            billing: billingDoc,
          };
        }

        return {
          accessState: 'SUBSCRIPTION_EXPIRED',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId,
          entitlementStatus: 'expired',
          seatLimit,
          maxSeats,
          reason: 'Trial evaluation period has expired. Paid subscription required.',
          expiresAt: trialEndsAt,
          billing: billingDoc,
        };
      }

      // C. ACTIVE PAID SUBSCRIPTION
      if (subscriptionStatus === 'active') {
        if (entitlementStatus === 'active') {
          return {
            accessState: 'SUBSCRIPTION_ACTIVE',
            canAccessApp: true,
            hasFullEntitlement: true,
            planId,
            entitlementStatus: 'active',
            seatLimit,
            maxSeats,
            reason: 'Active commercial SaaS subscription in good standing.',
            expiresAt: currentPeriodEnd,
            billing: billingDoc,
          };
        }

        return {
          accessState: 'NO_ENTITLEMENT',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId,
          entitlementStatus: 'restricted',
          seatLimit,
          maxSeats,
          reason: 'Subscription entitlement is restricted or deactivated by billing policy.',
          expiresAt: currentPeriodEnd,
          billing: billingDoc,
        };
      }

      // D. STRATEGIC PARTNER COMPLIMENTARY ACCESS
      if (subscriptionStatus === 'complimentary') {
        if (entitlementStatus === 'active') {
          const compExpiresAt = billingDoc.complimentaryExpiresAt;
          const hasExpiration = Boolean(compExpiresAt);
          const compExpiresTime = hasExpiration && compExpiresAt ? new Date(compExpiresAt).getTime() : NaN;
          const isExpired = hasExpiration && !isNaN(compExpiresTime) && compExpiresTime <= currentTimeMs;

          if (!isExpired) {
            return {
              accessState: 'COMPLIMENTARY_ACTIVE',
              canAccessApp: true,
              hasFullEntitlement: true,
              planId,
              entitlementStatus: 'active',
              seatLimit,
              maxSeats,
              reason:
                billingDoc.complimentaryReason ||
                'Active strategic partner complimentary access provided by Sunny Sweets.',
              expiresAt: compExpiresAt || null,
              billing: billingDoc,
            };
          }

          return {
            accessState: 'SUBSCRIPTION_EXPIRED',
            canAccessApp: false,
            hasFullEntitlement: false,
            planId,
            entitlementStatus: 'expired',
            seatLimit,
            maxSeats,
            reason: 'Strategic partner complimentary evaluation period has concluded.',
            expiresAt: compExpiresAt || null,
            billing: billingDoc,
          };
        }

        return {
          accessState: 'SUBSCRIPTION_EXPIRED',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId,
          entitlementStatus: billingDoc.entitlementStatus,
          seatLimit,
          maxSeats,
          reason: 'Strategic partner complimentary access is inactive or has been revoked.',
          expiresAt: null,
          billing: billingDoc,
        };
      }

      // E. PAST DUE
      if (subscriptionStatus === 'past_due') {
        return {
          accessState: 'SUBSCRIPTION_PAST_DUE',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId,
          entitlementStatus: 'past_due',
          seatLimit,
          maxSeats,
          reason: 'Workspace billing payment is past due. Please update payment method.',
          expiresAt: currentPeriodEnd,
          billing: billingDoc,
        };
      }

      // F. CANCELED (Grace period check if cancelAtPeriodEnd is true)
      if (subscriptionStatus === 'canceled') {
        const periodEndMs = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : 0;
        const isWithinPaidPeriod = cancelAtPeriodEnd && !isNaN(periodEndMs) && periodEndMs > currentTimeMs;

        if (isWithinPaidPeriod && entitlementStatus === 'active') {
          return {
            accessState: 'SUBSCRIPTION_ACTIVE',
            canAccessApp: true,
            hasFullEntitlement: true,
            planId,
            entitlementStatus: 'active',
            seatLimit,
            maxSeats,
            reason: 'Subscription canceled but remains active until end of billing cycle.',
            expiresAt: currentPeriodEnd,
            billing: billingDoc,
          };
        }

        return {
          accessState: 'SUBSCRIPTION_EXPIRED',
          canAccessApp: false,
          hasFullEntitlement: false,
          planId,
          entitlementStatus: 'expired',
          seatLimit,
          maxSeats,
          reason: 'Subscription has been canceled and billing period has concluded.',
          expiresAt: currentPeriodEnd,
          billing: billingDoc,
        };
      }

      // G. INCOMPLETE, PAUSED, EXPIRED, OR OTHER RESTRICTED STATUS
      const accessState: AppAccessState =
        subscriptionStatus === 'expired' ? 'SUBSCRIPTION_EXPIRED' : 'NO_ENTITLEMENT';

      return {
        accessState,
        canAccessApp: false,
        hasFullEntitlement: false,
        planId,
        entitlementStatus: subscriptionStatus === 'expired' ? 'expired' : 'inactive',
        seatLimit,
        maxSeats,
        reason: `Subscription status is ${subscriptionStatus} (entitlement: ${entitlementStatus}).`,
        expiresAt: currentPeriodEnd,
        billing: billingDoc,
      };
    } catch (err: any) {
      console.error('[EntitlementService] Unexpected error evaluating entitlement:', err);
      return {
        accessState: 'NO_ENTITLEMENT',
        canAccessApp: false,
        hasFullEntitlement: false,
        planId: 'solo',
        entitlementStatus: 'inactive',
        seatLimit: 1,
        maxSeats: 1,
        reason: 'Error evaluating workspace billing document: safe fail-closed fallback applied.',
        expiresAt: null,
        billing: null,
      };
    }
  }

  /**
   * Helper function: Evaluates whether an entitlement result permits paid app access.
   */
  public static canAccessPaidApp(evaluation: EntitlementEvaluation): boolean {
    return evaluation.canAccessApp;
  }

  /**
   * Evaluates workspace entitlement given an ID and optional billing doc.
   */
  public static getWorkspaceEntitlement(
    workspaceId: string,
    billingDoc?: WorkspaceBilling | null,
    now?: Date
  ): EntitlementEvaluation {
    return EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc,
      workspaceId,
      now,
    });
  }
}

// Named functional exports for direct consumer usage
export const evaluateEntitlement = EntitlementService.evaluate;
export const canAccessPaidApp = EntitlementService.canAccessPaidApp;
export const getWorkspaceEntitlement = EntitlementService.getWorkspaceEntitlement;
