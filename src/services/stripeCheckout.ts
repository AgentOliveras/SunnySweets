import { auth } from './firebase';
import { PlanId } from '../types/billing';

export type BillingInterval = 'monthly' | 'annual';

export interface CreateCheckoutSessionClientParams {
  workspaceId: string;
  planId: 'solo' | 'team';
  billingInterval: BillingInterval;
}

export interface CreateCheckoutSessionResponse {
  success: boolean;
  sessionId: string;
  url: string;
}

/**
 * Initiates secure Stripe Checkout session creation.
 * Obtains fresh Firebase ID token, submits request to trusted server endpoint,
 * and navigates to the Stripe-hosted Checkout page.
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionClientParams
): Promise<CreateCheckoutSessionResponse> {
  const { workspaceId, planId, billingInterval } = params;

  if (!workspaceId) {
    throw new Error('Workspace ID is required to initiate checkout.');
  }

  if (planId !== 'solo' && planId !== 'team') {
    throw new Error('Please select either the Solo or Team plan.');
  }

  if (billingInterval !== 'monthly' && billingInterval !== 'annual') {
    throw new Error('Please select either monthly or annual billing.');
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to manage subscription billing.');
  }

  // Obtain fresh Firebase ID token
  const idToken = await currentUser.getIdToken(true);

  const response = await fetch('/api/billing/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      workspaceId,
      planId,
      billingInterval,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.code === 'STRIPE_NOT_CONFIGURED' || data.code === 'BILLING_PRICE_NOT_CONFIGURED'
        ? 'Billing setup is not yet configured for this plan in test mode.'
        : data.error || 'Failed to initiate checkout session. Please try again.';
    const error = new Error(message) as Error & { code?: string };
    error.code = data.code;
    throw error;
  }

  if (!data.url) {
    throw new Error('Stripe checkout URL was not received.');
  }

  // Redirect to Stripe-hosted Checkout page
  if (typeof window !== 'undefined' && window.location) {
    window.location.href = data.url;
  }

  return data;
}
