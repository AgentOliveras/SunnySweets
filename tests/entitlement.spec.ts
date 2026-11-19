import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EntitlementService, evaluateEntitlement } from '../src/services/entitlement';
import { WorkspaceBilling, PLAN_CATALOG, DISPLAY_PRICING_PLACEHOLDERS } from '../src/types/billing';
import { store } from '../src/services/store';

describe('Phase 1.0 SaaS Entitlement Architecture - Hardened Verification Suite', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    // Reset store state
    store.setMockBillingForTesting(null);
  });

  // Test Case A:
  // ws-main + valid UID membership + no billing/current
  // Expected: AUTHORIZED_INTERNAL through temporary compatibility.
  it('Case A: ws-main + valid UID membership + no billing/current → AUTHORIZED_INTERNAL (temporary compatibility)', () => {
    const evalResult = evaluateEntitlement({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: null,
      workspaceId: 'ws-main',
    });

    assert.strictEqual(evalResult.canAccessApp, true);
    assert.strictEqual(evalResult.accessState, 'AUTHORIZED_INTERNAL');
    assert.strictEqual(evalResult.planId, 'internal');
    assert.strictEqual(evalResult.entitlementStatus, 'active');
    assert.strictEqual(evalResult.isCompatibilityFallback, true);
  });

  // Test Case B:
  // different workspace + valid UID membership + no billing/current
  // Expected: NO_ENTITLEMENT.
  it('Case B: different workspace + valid UID membership + no billing/current → NO_ENTITLEMENT', () => {
    const evalResult = evaluateEntitlement({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: null,
      workspaceId: 'ws-bakery-secondary',
    });

    assert.strictEqual(evalResult.canAccessApp, false);
    assert.strictEqual(evalResult.accessState, 'NO_ENTITLEMENT');
    assert.strictEqual(evalResult.entitlementStatus, 'inactive');
    assert.strictEqual(evalResult.isCompatibilityFallback, undefined);
  });

  // Test Case C:
  // different workspace manually attempts to claim internal without server document
  // Expected: NO access change (strictly NO_ENTITLEMENT).
  it('Case C: different workspace cannot infer internal entitlement → NO access change', () => {
    const evalResult = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: null,
      workspaceId: 'ws-commercial-99',
    });

    assert.strictEqual(evalResult.canAccessApp, false);
    assert.strictEqual(evalResult.accessState, 'NO_ENTITLEMENT');
  });

  // Test Case D:
  // production user activates QA simulation locally
  // Expected: No entitlement change (simulator strictly disabled in production builds).
  it('Case D: production user activates QA simulation locally → No entitlement change', () => {
    process.env.NODE_ENV = 'production';

    const fakeBilling: WorkspaceBilling = {
      planId: 'team',
      subscriptionStatus: 'active',
      entitlementStatus: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      stripeCustomerId: 'cus_simulated',
      stripeSubscriptionId: 'sub_simulated',
      stripePriceId: 'price_team',
      seatLimit: 5,
      activeSeatCount: 1,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      billingUpdatedAt: new Date().toISOString(),
      billingSource: 'stripe',
    };

    // Attempt simulation while in production mode
    store.setMockBillingForTesting(fakeBilling);

    // Billing should remain null, not overridden by simulator
    assert.strictEqual(store.getBilling(), null);
  });

  // Test Case E:
  // unknown planId in billing document
  // Expected: fail-closed NO_ENTITLEMENT.
  it('Case E: unknown planId (e.g. scale, enterprise) in billing document → fail-closed NO_ENTITLEMENT', () => {
    const unknownPlanBilling = {
      planId: 'scale' as any, // Scale was removed from V1
      subscriptionStatus: 'active' as const,
      entitlementStatus: 'active' as const,
      trialStartedAt: null,
      trialEndsAt: null,
      stripeCustomerId: 'cus_unknown',
      stripeSubscriptionId: 'sub_unknown',
      stripePriceId: 'price_scale',
      seatLimit: 15,
      activeSeatCount: 2,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      billingUpdatedAt: new Date().toISOString(),
      billingSource: 'stripe' as const,
    };

    const evalResult = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: unknownPlanBilling,
      workspaceId: 'ws-test',
    });

    assert.strictEqual(evalResult.canAccessApp, false);
    assert.strictEqual(evalResult.accessState, 'NO_ENTITLEMENT');
  });

  // Test Case F:
  // trialing + future valid trialEndsAt
  // Expected: TRIAL_ACTIVE.
  it('Case F: trialing + future valid trialEndsAt → TRIAL_ACTIVE', () => {
    const futureDate = new Date(Date.now() + 10 * 86400000).toISOString();
    const trialBilling: WorkspaceBilling = {
      planId: 'solo',
      subscriptionStatus: 'trialing',
      entitlementStatus: 'active',
      trialStartedAt: new Date().toISOString(),
      trialEndsAt: futureDate,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      seatLimit: 1,
      activeSeatCount: 1,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: futureDate,
      billingUpdatedAt: new Date().toISOString(),
      billingSource: 'internal',
    };

    const evalResult = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: trialBilling,
      workspaceId: 'ws-test',
    });

    assert.strictEqual(evalResult.canAccessApp, true);
    assert.strictEqual(evalResult.accessState, 'TRIAL_ACTIVE');
    assert.strictEqual(evalResult.entitlementStatus, 'active');
  });

  // Test Case G:
  // trial expired
  // Expected: SUBSCRIPTION_EXPIRED.
  it('Case G: trial expired with past trialEndsAt → SUBSCRIPTION_EXPIRED', () => {
    const pastDate = new Date(Date.now() - 2 * 86400000).toISOString();
    const expiredTrialBilling: WorkspaceBilling = {
      planId: 'team',
      subscriptionStatus: 'trialing',
      entitlementStatus: 'active', // stale active status must be superseded by expired timestamp
      trialStartedAt: new Date(Date.now() - 16 * 86400000).toISOString(),
      trialEndsAt: pastDate,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      seatLimit: 5,
      activeSeatCount: 2,
      cancelAtPeriodEnd: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      billingUpdatedAt: new Date().toISOString(),
      billingSource: 'internal',
    };

    const evalResult = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: expiredTrialBilling,
      workspaceId: 'ws-test',
    });

    assert.strictEqual(evalResult.canAccessApp, false);
    assert.strictEqual(evalResult.accessState, 'SUBSCRIPTION_EXPIRED');
    assert.strictEqual(evalResult.entitlementStatus, 'expired');
  });

  // Test Case H:
  // active paid entitlement
  // Expected: SUBSCRIPTION_ACTIVE.
  it('Case H: active paid entitlement → SUBSCRIPTION_ACTIVE', () => {
    const activePaidBilling: WorkspaceBilling = {
      planId: 'team',
      subscriptionStatus: 'active',
      entitlementStatus: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      stripeCustomerId: 'cus_active_123',
      stripeSubscriptionId: 'sub_active_123',
      stripePriceId: 'price_team',
      seatLimit: 5,
      activeSeatCount: 3,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(Date.now() - 5 * 86400000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 25 * 86400000).toISOString(),
      billingUpdatedAt: new Date().toISOString(),
      billingSource: 'stripe',
    };

    const evalResult = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: activePaidBilling,
      workspaceId: 'ws-test',
    });

    assert.strictEqual(evalResult.canAccessApp, true);
    assert.strictEqual(evalResult.accessState, 'SUBSCRIPTION_ACTIVE');
    assert.strictEqual(evalResult.planId, 'team');
    assert.strictEqual(evalResult.seatLimit, 5);
  });

  // Test Case I:
  // past_due subscription
  // Expected: SUBSCRIPTION_PAST_DUE.
  it('Case I: past_due subscription → SUBSCRIPTION_PAST_DUE', () => {
    const pastDueBilling: WorkspaceBilling = {
      planId: 'solo',
      subscriptionStatus: 'past_due',
      entitlementStatus: 'past_due',
      trialStartedAt: null,
      trialEndsAt: null,
      stripeCustomerId: 'cus_past_due',
      stripeSubscriptionId: 'sub_past_due',
      stripePriceId: 'price_solo',
      seatLimit: 1,
      activeSeatCount: 1,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(Date.now() - 35 * 86400000).toISOString(),
      currentPeriodEnd: new Date(Date.now() - 5 * 86400000).toISOString(),
      billingUpdatedAt: new Date().toISOString(),
      billingSource: 'stripe',
    };

    const evalResult = EntitlementService.evaluate({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: pastDueBilling,
      workspaceId: 'ws-test',
    });

    assert.strictEqual(evalResult.canAccessApp, false);
    assert.strictEqual(evalResult.accessState, 'SUBSCRIPTION_PAST_DUE');
  });

  // Section 2 Verification:
  // PLAN_CATALOG must contain only: INTERNAL, SOLO, TEAM (No Scale plan).
  it('Section 2: PLAN_CATALOG contains only internal, solo, and team', () => {
    const catalogKeys = Object.keys(PLAN_CATALOG);
    assert.deepStrictEqual(catalogKeys.sort(), ['internal', 'solo', 'team'].sort());
    assert.strictEqual((PLAN_CATALOG as any).scale, undefined);
  });

  // Section 3 Verification:
  // No dollar pricing in PLAN_CATALOG; placeholders isolated in DISPLAY_PRICING_PLACEHOLDERS
  it('Section 3: Plan definitions do not hardcode dollar prices', () => {
    assert.strictEqual((PLAN_CATALOG.solo as any).pricePlaceholder, undefined);
    assert.strictEqual((PLAN_CATALOG.team as any).pricePlaceholder, undefined);
    assert.strictEqual(DISPLAY_PRICING_PLACEHOLDERS.solo, 'Pricing coming soon');
    assert.strictEqual(DISPLAY_PRICING_PLACEHOLDERS.team, 'Pricing coming soon');
  });

  // Section 5 Verification:
  // Authoritative active seat count derives exclusively from members where active === true
  it('Section 5: store.getComputedActiveSeatCount() derives exclusively from members', () => {
    assert.strictEqual(typeof store.getComputedActiveSeatCount, 'function');
    // When no members are loaded in store, strict fail-closed returns 0
    const count = store.getComputedActiveSeatCount();
    assert.strictEqual(typeof count, 'number');
    assert.strictEqual(count, 0);

    // Verify diagnostic check for owner integrity
    assert.strictEqual(typeof store.getOwnerMembershipIntegrity, 'function');
    const integrity = store.getOwnerMembershipIntegrity();
    assert.strictEqual(typeof integrity.isValid, 'boolean');
  });
});
