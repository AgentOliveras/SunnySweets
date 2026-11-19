import Stripe from 'stripe';
import { PLAN_CATALOG, PlanId } from '../types/billing';
import {
  TrialActivationService,
  createBillingError,
  BillingServiceError,
} from './billingService';

export type BillingInterval = 'monthly' | 'annual';

export interface CreateCheckoutSessionParams {
  tokenUid: string;
  workspaceId: string;
  planId: unknown;
  billingInterval: unknown;
  origin?: string;
}

export interface CheckoutSessionResult {
  success: boolean;
  sessionId: string;
  url: string;
}

export interface StripePriceConfig {
  solo: {
    monthly: string | null;
    annual: string | null;
  };
  team: {
    monthly: string | null;
    annual: string | null;
  };
}

let mockStripeClient: any = null;
let mockPriceConfig: StripePriceConfig | null = null;
const inFlightRequests = new Map<string, { timestamp: number; promise: Promise<CheckoutSessionResult> }>();

/**
 * Resolves the configured Stripe price config for test mode.
 * Falls back to process.env keys.
 */
export function getStripePriceConfig(): StripePriceConfig {
  if (mockPriceConfig) {
    return mockPriceConfig;
  }
  return {
    solo: {
      monthly: process.env.STRIPE_PRICE_SOLO_MONTHLY || process.env.STRIPE_PRICE_ID_SOLO_MONTHLY || null,
      annual: process.env.STRIPE_PRICE_SOLO_ANNUAL || process.env.STRIPE_PRICE_ID_SOLO_ANNUAL || null,
    },
    team: {
      monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY || process.env.STRIPE_PRICE_ID_TEAM_MONTHLY || null,
      annual: process.env.STRIPE_PRICE_TEAM_ANNUAL || process.env.STRIPE_PRICE_ID_TEAM_ANNUAL || null,
    },
  };
}

/**
 * Resolves trusted Stripe Price ID for a plan and interval.
 * Returns null if not configured.
 */
export function resolveStripePriceId(
  planId: 'solo' | 'team',
  interval: BillingInterval
): string | null {
  const config = getStripePriceConfig();
  const planPrices = config[planId];
  if (!planPrices) return null;
  return planPrices[interval] || null;
}

/**
 * Lazy Stripe Client Initializer.
 * Only initializes when needed; never crashes at load time if env is missing.
 * Strictly enforces Test Mode discipline.
 */
export function getStripeClient(): Stripe {
  if (mockStripeClient) {
    return mockStripeClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.trim().length === 0) {
    throw createBillingError(
      503,
      'STRIPE_NOT_CONFIGURED',
      'Stripe billing is not configured. STRIPE_SECRET_KEY environment variable is required.'
    );
  }

  // Phase 1.4 test-mode guard: Reject live keys
  if (secretKey.startsWith('sk_live_')) {
    throw createBillingError(
      400,
      'LIVE_STRIPE_NOT_PERMITTED',
      'Phase 1.4 requires Stripe Test Mode. Live Stripe keys are strictly disallowed.'
    );
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-02-24.acacia' as any,
    typescript: true,
  });
}

/**
 * Dependency injection for testing without live Stripe credentials.
 */
export const StripeService = {
  setMockStripeClient(mock: any): void {
    mockStripeClient = mock;
  },
  resetMockStripeClient(): void {
    mockStripeClient = null;
  },
  setMockPriceConfig(config: StripePriceConfig | null): void {
    mockPriceConfig = config;
  },
  resetMockPriceConfig(): void {
    mockPriceConfig = null;
  },
  clearInFlightRequests(): void {
    inFlightRequests.clear();
  },

  /**
   * Trusted Server-Side Stripe Checkout Session Creation
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    const { tokenUid, workspaceId, planId, billingInterval, origin } = params;

    // Gate 1: Verified Authentication
    if (!tokenUid || typeof tokenUid !== 'string' || tokenUid.trim().length === 0) {
      throw createBillingError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }

    // Gate 2: Workspace Identifier Validation
    if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
      throw createBillingError(400, 'BAD_REQUEST', 'workspaceId is required.');
    }

    // Gate 3: Reject Sunny Sweets internal workspace (ws-main)
    if (workspaceId === 'ws-main') {
      throw createBillingError(
        403,
        'FORBIDDEN_INTERNAL_WORKSPACE',
        'Sunny Sweets internal workspace operates under non-billed operational access.'
      );
    }

    const adapter = TrialActivationService.getAdapter();

    // Gate 4: Verify Workspace Existence and Ownership
    const workspace = await adapter.getWorkspace(workspaceId);
    if (!workspace || workspace.ownerId !== tokenUid) {
      throw createBillingError(
        403,
        'OWNER_REQUIRED',
        'Only the verified workspace owner can initiate billing checkout.'
      );
    }

    // Gate 5: Verify Active Owner Membership in Workspace
    const member = await adapter.getWorkspaceMember(workspaceId, tokenUid);
    if (!member || member.uid !== tokenUid || member.role !== 'owner' || member.active !== true) {
      throw createBillingError(
        403,
        'OWNER_REQUIRED',
        'Only the verified workspace owner can initiate billing checkout.'
      );
    }

    // Gate 6: Verify User Profile Ownership Alignment
    const userProfile = await adapter.getUserProfile(tokenUid);
    if (userProfile && userProfile.ownedWorkspaceId && userProfile.ownedWorkspaceId !== workspaceId) {
      throw createBillingError(
        403,
        'OWNER_REQUIRED',
        'Verified owner is not registered as the owner of this workspace.'
      );
    }

    // Gate 7: Validate Plan
    if (planId !== 'solo' && planId !== 'team') {
      throw createBillingError(
        400,
        'PLAN_NOT_PURCHASABLE',
        'Requested plan is not publicly purchasable.'
      );
    }

    const planDef = PLAN_CATALOG[planId];
    if (!planDef || !planDef.publiclyVisible || !planDef.purchasable) {
      throw createBillingError(
        400,
        'PLAN_NOT_PURCHASABLE',
        'Requested plan is not publicly purchasable.'
      );
    }

    // Gate 8: Validate Billing Interval
    if (billingInterval !== 'monthly' && billingInterval !== 'annual') {
      throw createBillingError(
        400,
        'INVALID_BILLING_INTERVAL',
        'Billing interval must be either "monthly" or "annual".'
      );
    }

    // Gate 9: Inspect Existing Workspace Billing
    const existingBilling = await adapter.getBillingCurrent(workspaceId);
    if (existingBilling) {
      // Reject internal plan
      if (existingBilling.planId === 'internal') {
        throw createBillingError(
          403,
          'FORBIDDEN_INTERNAL_WORKSPACE',
          'Internal workspaces are not purchasable.'
        );
      }

      // Reject Strategic Partner complimentary access
      if (
        existingBilling.billingSource === 'strategic_partner' &&
        existingBilling.subscriptionStatus === 'complimentary'
      ) {
        throw createBillingError(
          400,
          'STRATEGIC_PARTNER_CONVERSION_REQUIRED',
          'Strategic Partner workspaces receive complimentary Team access. Direct checkout is blocked.'
        );
      }

      // Reject existing active Stripe subscriptions
      if (
        existingBilling.billingSource === 'stripe' &&
        existingBilling.subscriptionStatus === 'active'
      ) {
        throw createBillingError(
          409,
          'SUBSCRIPTION_ALREADY_EXISTS',
          'This workspace already has an active Stripe subscription. Manage your subscription through subscription settings.'
        );
      }
    }

    // Gate 10: Price Resolution from Server Configuration
    const priceId = resolveStripePriceId(planId, billingInterval);
    if (!priceId) {
      throw createBillingError(
        503,
        'BILLING_PRICE_NOT_CONFIGURED',
        `Stripe Price ID is not configured for ${planId} (${billingInterval}). Please configure STRIPE_PRICE_${planId.toUpperCase()}_${billingInterval.toUpperCase()}.`
      );
    }

    // Gate 11: Idempotency & In-Flight Request Deduplication (5-second window per workspace)
    const idempotencyKey = `${workspaceId}:${planId}:${billingInterval}`;
    const existingInFlight = inFlightRequests.get(idempotencyKey);
    const now = Date.now();
    if (existingInFlight && now - existingInFlight.timestamp < 5000) {
      return existingInFlight.promise;
    }

    // Gate 12: Stripe Client Initialization
    const stripe = getStripeClient();

    // Re-use verified customer ID if present in existing workspace billing
    const existingCustomerId = existingBilling?.stripeCustomerId && existingBilling.stripeCustomerId.startsWith('cus_')
      ? existingBilling.stripeCustomerId
      : undefined;

    // Build internal safe URLs
    const baseUrl = (origin || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const successUrl = `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&workspace_id=${encodeURIComponent(workspaceId)}`;
    const cancelUrl = `${baseUrl}/settings/billing?checkout=cancelled&workspace_id=${encodeURIComponent(workspaceId)}`;

    // Create session execution promise
    const sessionPromise = (async () => {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: [
            {
              price: priceId,
              quantity: 1,
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          customer: existingCustomerId,
          customer_creation: existingCustomerId ? undefined : 'always',
          metadata: {
            workspaceId,
            ownerUid: tokenUid,
            planId,
            billingInterval,
          },
          subscription_data: {
            metadata: {
              workspaceId,
              ownerUid: tokenUid,
              planId,
              billingInterval,
            },
          },
        });

        if (!session.url) {
          throw createBillingError(
            500,
            'CHECKOUT_SESSION_FAILED',
            'Stripe failed to return a checkout session URL.'
          );
        }

        return {
          success: true,
          sessionId: session.id,
          url: session.url,
        };
      } catch (err: any) {
        if (err.status && err.code) {
          throw err;
        }
        // Map raw Stripe errors to safe controlled application error
        const message = err.message || 'Failed to create Stripe checkout session.';
        throw createBillingError(500, 'CHECKOUT_SESSION_FAILED', message);
      } finally {
        setTimeout(() => inFlightRequests.delete(idempotencyKey), 5000);
      }
    })();

    inFlightRequests.set(idempotencyKey, { timestamp: now, promise: sessionPromise });
    return sessionPromise;
  },
};
