import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EntitlementService } from '../src/services/entitlement';
import { WorkspaceBilling, AppAccessState } from '../src/types/billing';

describe('Preview State Matrix Verification (Section 15)', () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  it('State 1: Signed Out -> evaluates to SIGNED_OUT with zero calculator access', () => {
    const res = EntitlementService.evaluate({
      isAuthenticated: false,
      hasWorkspaceMembership: false,
      billingDoc: null,
      workspaceId: 'ws-preview-test',
    });

    assert.strictEqual(res.accessState, 'SIGNED_OUT');
    assert.strictEqual(res.canAccessApp, false);
    assert.strictEqual(res.hasFullEntitlement, false);
  });

  it('State 2: Signed In + No Workspace -> evaluates to NO_WORKSPACE', () => {
    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: false,
      billingDoc: null,
      workspaceId: 'ws-preview-test',
    });

    assert.strictEqual(res.accessState, 'NO_WORKSPACE');
    assert.strictEqual(res.canAccessApp, false);
    assert.strictEqual(res.hasFullEntitlement, false);
  });

  it('State 3: Signed In + Workspace + No Entitlement -> evaluates to NO_ENTITLEMENT', () => {
    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: null,
      workspaceId: 'ws-chef-demo',
    });

    assert.strictEqual(res.accessState, 'NO_ENTITLEMENT');
    assert.strictEqual(res.canAccessApp, false);
    assert.strictEqual(res.hasFullEntitlement, false);
  });

  it('State 4: Signed In + Workspace + Active Trial -> evaluates to TRIAL_ACTIVE with full app access', () => {
    const trialBilling: WorkspaceBilling = {
      planId: 'solo',
      subscriptionStatus: 'trialing',
      entitlementStatus: 'active',
      billingSource: 'trial',
      trialStartedAt: pastDate,
      trialEndsAt: futureDate,
      cancelAtPeriodEnd: false,
      currentPeriodStart: pastDate,
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      seatLimit: 1,
      activeSeatCount: 1,
      billingUpdatedAt: pastDate,
    };

    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: trialBilling,
      workspaceId: 'ws-chef-trial',
    });

    assert.strictEqual(res.accessState, 'TRIAL_ACTIVE');
    assert.strictEqual(res.canAccessApp, true);
    assert.strictEqual(res.hasFullEntitlement, true);
    assert.strictEqual(res.expiresAt, futureDate);
  });

  it('State 5: Signed In + Workspace + Active Paid Subscription -> evaluates to SUBSCRIPTION_ACTIVE', () => {
    const paidBilling: WorkspaceBilling = {
      planId: 'team',
      subscriptionStatus: 'active',
      entitlementStatus: 'active',
      billingSource: 'stripe',
      trialStartedAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodStart: pastDate,
      currentPeriodEnd: futureDate,
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      stripePriceId: 'price_team_monthly',
      seatLimit: 5,
      activeSeatCount: 2,
      billingUpdatedAt: pastDate,
    };

    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: paidBilling,
      workspaceId: 'ws-chef-paid',
    });

    assert.strictEqual(res.accessState, 'SUBSCRIPTION_ACTIVE');
    assert.strictEqual(res.canAccessApp, true);
    assert.strictEqual(res.hasFullEntitlement, true);
  });

  it('State 6: Signed In + Workspace + Strategic Partner Complimentary -> evaluates to COMPLIMENTARY_ACTIVE', () => {
    const complimentaryBilling: WorkspaceBilling = {
      planId: 'team',
      subscriptionStatus: 'complimentary',
      entitlementStatus: 'active',
      billingSource: 'strategic_partner',
      trialStartedAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodStart: pastDate,
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      complimentaryAccess: true,
      complimentaryReason: '5-year executive chef relationship',
      relationshipLabel: 'Executive Chef Partner',
      organizationName: 'Grand Hyatt Pastry Kitchen',
      seatLimit: 5,
      activeSeatCount: 1,
      billingUpdatedAt: pastDate,
    };

    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: complimentaryBilling,
      workspaceId: 'ws-chef-strategic',
    });

    assert.strictEqual(res.accessState, 'COMPLIMENTARY_ACTIVE');
    assert.strictEqual(res.canAccessApp, true);
    assert.strictEqual(res.hasFullEntitlement, true);
  });

  it('State 7: Signed In + Workspace + Expired Trial -> evaluates to SUBSCRIPTION_EXPIRED', () => {
    const expiredTrialBilling: WorkspaceBilling = {
      planId: 'solo',
      subscriptionStatus: 'trialing',
      entitlementStatus: 'active',
      billingSource: 'trial',
      trialStartedAt: pastDate,
      trialEndsAt: pastDate,
      cancelAtPeriodEnd: false,
      currentPeriodStart: pastDate,
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      seatLimit: 1,
      activeSeatCount: 1,
      billingUpdatedAt: pastDate,
    };

    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: expiredTrialBilling,
      workspaceId: 'ws-chef-expired',
    });

    assert.strictEqual(res.accessState, 'SUBSCRIPTION_EXPIRED');
    assert.strictEqual(res.canAccessApp, false);
    assert.strictEqual(res.hasFullEntitlement, false);
  });

  it('State 8: Signed In + Workspace + Past Due -> evaluates to SUBSCRIPTION_PAST_DUE', () => {
    const pastDueBilling: WorkspaceBilling = {
      planId: 'solo',
      subscriptionStatus: 'past_due',
      entitlementStatus: 'past_due',
      billingSource: 'stripe',
      trialStartedAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodStart: pastDate,
      currentPeriodEnd: pastDate,
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      stripePriceId: 'price_solo_monthly',
      seatLimit: 1,
      activeSeatCount: 1,
      billingUpdatedAt: pastDate,
    };

    const res = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: pastDueBilling,
      workspaceId: 'ws-chef-past-due',
    });

    assert.strictEqual(res.accessState, 'SUBSCRIPTION_PAST_DUE');
    assert.strictEqual(res.canAccessApp, false);
    assert.strictEqual(res.hasFullEntitlement, false);
  });

  it('Defensive Handling: Malformed or missing billing fields fail closed without throwing', () => {
    const malformed1 = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: { invalidField: true } as any,
      workspaceId: 'ws-malformed-1',
    });
    assert.strictEqual(malformed1.accessState, 'NO_ENTITLEMENT');
    assert.strictEqual(malformed1.canAccessApp, false);

    const malformed2 = EntitlementService.evaluate(null as any);
    assert.strictEqual(malformed2.accessState, 'SIGNED_OUT');
    assert.strictEqual(malformed2.canAccessApp, false);
  });
});
