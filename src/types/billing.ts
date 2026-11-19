export type PlanId = 'internal' | 'solo' | 'team';

export type SubscriptionStatus =
  | 'internal'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'paused'
  | 'expired'
  | 'complimentary';

export type EntitlementStatus =
  | 'active'
  | 'restricted'
  | 'inactive'
  | 'expired'
  | 'past_due'
  | 'canceled';

export type BillingSource = 'internal' | 'stripe' | 'trial' | 'strategic_partner';

/**
 * Authoritative immutable trial-consumption record stored at:
 * `workspaces/{workspaceId}/billing/trial`
 *
 * NOTE: Written once by trusted server logic upon trial activation.
 * Browser clients are strictly forbidden from writing or deleting this record.
 */
export interface WorkspaceTrialRecord {
  workspaceId: string;
  ownerUid: string;
  activatedByUid?: string;
  trialStartedAt: string;
  trialEndsAt: string;
  trialConsumed: boolean;
  createdAt: string;
}

/**
 * Workspace billing document stored at:
 * `workspaces/{workspaceId}/billing/current`
 *
 * NOTE: Normal browser clients are STRICTLY forbidden from writing to this document.
 * Only trusted server-side billing logic (or Cloud Functions/admin SDK) may mutate
 * authoritative subscription & entitlement fields.
 *
 * SENSITIVITY NOTICE:
 * We NEVER store:
 * - Stripe secret keys
 * - Webhook signing secrets
 * - Credit card / payment method details
 */
export interface WorkspaceBilling {
  planId: PlanId;
  subscriptionStatus: SubscriptionStatus;
  entitlementStatus: EntitlementStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  seatLimit: number;
  activeSeatCount: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  billingUpdatedAt: string;
  billingSource: BillingSource;
  // Strategic Partner Complimentary Access fields:
  complimentaryAccess?: boolean;
  complimentaryStartedAt?: string | null;
  complimentaryExpiresAt?: string | null;
  complimentaryReason?: string | null;
  strategicPartnerType?: 'chef' | string | null;
  grantedBy?: string | null;
  // Non-sensitive administrative metadata (reporting only, never for authorization)
  strategicPartner?: boolean;
  source?: string | null;
  relationshipLabel?: string | null;
  organizationName?: string | null;
  propertyName?: string | null;
  notes?: string | null;
}

/**
 * Explicit application-level access states for SaaS lifecycle
 */
export type AppAccessState =
  | 'AUTH_LOADING'
  | 'INITIALIZATION_ERROR'
  | 'WORKSPACE_LOADING'
  | 'BILLING_LOADING'
  | 'SIGNED_OUT'
  | 'NO_WORKSPACE'
  | 'NO_ENTITLEMENT'
  | 'TRIAL_ACTIVE'
  | 'SUBSCRIPTION_ACTIVE'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'SUBSCRIPTION_EXPIRED'
  | 'AUTHORIZED_INTERNAL'
  | 'COMPLIMENTARY_ACTIVE';

/**
 * Reusable entitlement evaluation result returned by EntitlementService
 */
export interface EntitlementEvaluation {
  accessState: AppAccessState;
  canAccessApp: boolean;
  hasFullEntitlement: boolean;
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  reason: string;
  expiresAt: string | null;
  seatLimit?: number | null;
  maxSeats?: number | null;
  billing?: WorkspaceBilling | null;
  isCompatibilityFallback?: boolean;
}

export type {
  FeatureKey,
  BillingInterval,
  PlanDefinition,
  SeatUsageSummary,
  ValidActiveRole,
  OwnerIntegrityResult,
} from '../config/plans';

export {
  PLAN_CATALOG,
  PUBLIC_PLANS,
  STRIPE_PRICE_KEYS,
  DISPLAY_PRICING_PLACEHOLDERS,
  VALID_ACTIVE_ROLES,
  getPlanDefinition,
  isUnlimitedSeats,
  getSeatLimit,
  hasPlanFeature,
  canManageTeam,
  supportsBranding,
  computeSeatUsage,
  isValidActiveRole,
  isActiveSeatMember,
  countActiveSeats,
  checkOwnerMembershipIntegrity,
} from '../config/plans';

