import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TrialActivationService,
  InMemoryBillingStorageAdapter,
} from '../src/server/billingService';
import {
  StripeService,
  resolveStripePriceId,
} from '../src/server/stripeService';
import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';
import { EntitlementService } from '../src/services/entitlement';

describe('Phase 1.4 — Stripe Checkout in Test Mode Suite', () => {
  let storage: InMemoryBillingStorageAdapter;
  const engine = new PolicySimulationEngine();

  const OWNER_UID = 'uid-baker-bob';
  const EDITOR_UID = 'uid-editor-eve';
  const VIEWER_UID = 'uid-viewer-victor';
  const STRANGER_UID = 'uid-stranger-sam';

  const WORKSPACE_ID = 'ws-baker-bob';
  const OTHER_WORKSPACE_ID = 'ws-other-bakery';
  const INTERNAL_WORKSPACE_ID = 'ws-main';

  // Mock Stripe price catalog
  const TEST_PRICE_CONFIG = {
    solo: {
      monthly: 'price_test_solo_monthly_123',
      annual: 'price_test_solo_annual_456',
    },
    team: {
      monthly: 'price_test_team_monthly_789',
      annual: 'price_test_team_annual_012',
    },
  };

  let capturedStripeParams: any = null;
  const mockStripe = {
    checkout: {
      sessions: {
        create: async (params: any) => {
          capturedStripeParams = params;
          return {
            id: 'cs_test_session_abc123',
            url: `https://checkout.stripe.com/c/pay/cs_test_session_abc123`,
          };
        },
      },
    },
  };

  beforeEach(() => {
    storage = new InMemoryBillingStorageAdapter();
    TrialActivationService.setAdapter(storage);

    StripeService.clearInFlightRequests();
    StripeService.setMockStripeClient(mockStripe);
    StripeService.setMockPriceConfig(TEST_PRICE_CONFIG);
    capturedStripeParams = null;

    // Seed Bob's workspace (Owner, Editor, Viewer)
    storage.seedWorkspace(WORKSPACE_ID, OWNER_UID, "Bob's Bakery");
    storage.seedMember(WORKSPACE_ID, OWNER_UID, 'owner', 'bob@bakery.com');
    storage.seedMember(WORKSPACE_ID, EDITOR_UID, 'editor', 'eve@bakery.com');
    storage.seedMember(WORKSPACE_ID, VIEWER_UID, 'viewer', 'victor@bakery.com');
    storage.seedUser(OWNER_UID, {
      uid: OWNER_UID,
      email: 'bob@bakery.com',
      ownedWorkspaceId: WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });

    // Seed Other Workspace (Sam is owner)
    storage.seedWorkspace(OTHER_WORKSPACE_ID, STRANGER_UID, "Sam's Sourdough");
    storage.seedMember(OTHER_WORKSPACE_ID, STRANGER_UID, 'owner', 'sam@sourdough.com');
    storage.seedUser(STRANGER_UID, {
      uid: STRANGER_UID,
      email: 'sam@sourdough.com',
      ownedWorkspaceId: OTHER_WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });

    // Seed Sunny Sweets internal workspace
    storage.seedWorkspace(INTERNAL_WORKSPACE_ID, 'uid-sunny-owner', 'Sunny Sweets');
    storage.seedMember(INTERNAL_WORKSPACE_ID, 'uid-sunny-owner', 'owner', 'owner@sunnysweets.com');

    // Seed security rules engine
    engine.setWorkspace(WORKSPACE_ID, OWNER_UID, "Bob's Bakery");
    engine.setMember(WORKSPACE_ID, OWNER_UID, 'owner', 'bob@bakery.com');
  });

  // ==========================================
  // 1. AUTHORIZATION TESTS
  // ==========================================
  describe('1. Authorization & Identity Invariants', () => {
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: '',
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 401);
          assert.strictEqual(err.code, 'UNAUTHORIZED');
          return true;
        }
      );
    });

    it('rejects missing or empty token UID with 401 UNAUTHORIZED', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: '   ',
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 401);
          assert.strictEqual(err.code, 'UNAUTHORIZED');
          return true;
        }
      );
    });

    it('accepts verified workspace owner', async () => {
      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'monthly',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.sessionId, 'cs_test_session_abc123');
      assert(result.url.startsWith('https://checkout.stripe.com/'));
    });

    it('rejects editor role with 403 OWNER_REQUIRED', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: EDITOR_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'OWNER_REQUIRED');
          return true;
        }
      );
    });

    it('rejects viewer role with 403 OWNER_REQUIRED', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: VIEWER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'OWNER_REQUIRED');
          return true;
        }
      );
    });

    it('rejects cross-workspace owner attack with 403 OWNER_REQUIRED', async () => {
      // Bob (owner of ws-baker-bob) attempts to create checkout session for Sam's workspace
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: OTHER_WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'OWNER_REQUIRED');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 2. PLAN VALIDATION TESTS
  // ==========================================
  describe('2. Plan Validation Invariants', () => {
    it('allows public Solo plan', async () => {
      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'monthly',
      });
      assert.strictEqual(result.success, true);
    });

    it('allows public Team plan', async () => {
      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'monthly',
      });
      assert.strictEqual(result.success, true);
    });

    it('rejects internal plan with 400 PLAN_NOT_PURCHASABLE', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'internal',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'PLAN_NOT_PURCHASABLE');
          return true;
        }
      );
    });

    it('rejects unknown/bogus plan with 400 PLAN_NOT_PURCHASABLE', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'enterprise_ultra',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'PLAN_NOT_PURCHASABLE');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 3. BILLING INTERVAL VALIDATION TESTS
  // ==========================================
  describe('3. Billing Interval Validation Invariants', () => {
    it('allows monthly interval', async () => {
      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'monthly',
      });
      assert.strictEqual(result.success, true);
    });

    it('allows annual interval', async () => {
      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'annual',
      });
      assert.strictEqual(result.success, true);
    });

    it('rejects malformed interval (e.g. lifetime, biweekly) with 400 INVALID_BILLING_INTERVAL', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'lifetime',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'INVALID_BILLING_INTERVAL');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 4. PRICE CONFIGURATION & SECURITY
  // ==========================================
  describe('4. Price Configuration & Security Invariants', () => {
    it('server maps Solo monthly to configured price ID', async () => {
      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'monthly',
      });
      assert.strictEqual(capturedStripeParams.line_items[0].price, 'price_test_solo_monthly_123');
    });

    it('server maps Solo annual to configured price ID', async () => {
      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'annual',
      });
      assert.strictEqual(capturedStripeParams.line_items[0].price, 'price_test_solo_annual_456');
    });

    it('server maps Team monthly to configured price ID', async () => {
      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'monthly',
      });
      assert.strictEqual(capturedStripeParams.line_items[0].price, 'price_test_team_monthly_789');
    });

    it('server maps Team annual to configured price ID', async () => {
      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'annual',
      });
      assert.strictEqual(capturedStripeParams.line_items[0].price, 'price_test_team_annual_012');
    });

    it('arbitrary price ID supplied by browser is ignored and cannot override server mapping', async () => {
      // Calling createCheckoutSession with extra fields will ignore them completely
      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'monthly',
        ...({ customPriceId: 'price_hack_1cent' } as any),
      });
      assert.strictEqual(capturedStripeParams.line_items[0].price, 'price_test_team_monthly_789');
    });

    it('missing configured price produces controlled 503 BILLING_PRICE_NOT_CONFIGURED failure', async () => {
      StripeService.setMockPriceConfig({
        solo: { monthly: null, annual: null },
        team: { monthly: null, annual: null },
      });

      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 503);
          assert.strictEqual(err.code, 'BILLING_PRICE_NOT_CONFIGURED');
          return true;
        }
      );
    });
  });

  // ==========================================
  // 5. WORKSPACE CLASSIFICATION TESTS
  // ==========================================
  describe('5. Workspace Classification Invariants', () => {
    it('rejects ws-main with 403 FORBIDDEN_INTERNAL_WORKSPACE', async () => {
      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: 'uid-sunny-owner',
            workspaceId: INTERNAL_WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FORBIDDEN_INTERNAL_WORKSPACE');
          return true;
        }
      );
    });

    it('rejects workspace with existing internal plan with 403 FORBIDDEN_INTERNAL_WORKSPACE', async () => {
      await storage.saveBillingCurrent(WORKSPACE_ID, {
        planId: 'internal',
        subscriptionStatus: 'active',
        entitlementStatus: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        seatLimit: null,
        activeSeatCount: 1,
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        billingUpdatedAt: new Date().toISOString(),
        billingSource: 'internal',
      });

      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'solo',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FORBIDDEN_INTERNAL_WORKSPACE');
          return true;
        }
      );
    });

    it('rejects Strategic Partner complimentary workspace with 400 STRATEGIC_PARTNER_CONVERSION_REQUIRED', async () => {
      await storage.saveBillingCurrent(WORKSPACE_ID, {
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
        currentPeriodStart: null,
        currentPeriodEnd: null,
        billingUpdatedAt: new Date().toISOString(),
        billingSource: 'strategic_partner',
        strategicPartner: true,
        strategicPartnerType: 'chef',
      });

      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'team',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'STRATEGIC_PARTNER_CONVERSION_REQUIRED');
          return true;
        }
      );
    });

    it('allows workspace owner currently in active trial', async () => {
      await storage.saveBillingCurrent(WORKSPACE_ID, {
        planId: 'team',
        subscriptionStatus: 'trialing',
        entitlementStatus: 'active',
        trialStartedAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        seatLimit: 5,
        activeSeatCount: 1,
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        billingUpdatedAt: new Date().toISOString(),
        billingSource: 'trial',
      });

      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'monthly',
      });
      assert.strictEqual(result.success, true);
    });

    it('allows NO_ENTITLEMENT workspace owner (fresh workspace, no prior billing document)', async () => {
      const initialBilling = await storage.getBillingCurrent(WORKSPACE_ID);
      assert.strictEqual(initialBilling, null);

      const result = await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'monthly',
      });
      assert.strictEqual(result.success, true);
    });
  });

  // ==========================================
  // 6. CHECKOUT SESSION CHARACTERISTICS
  // ==========================================
  describe('6. Checkout Session Characteristics', () => {
    it('sets mode to subscription, uses 1 quantity, and attaches full trusted metadata', async () => {
      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'annual',
      });

      assert.strictEqual(capturedStripeParams.mode, 'subscription');
      assert.strictEqual(capturedStripeParams.line_items.length, 1);
      assert.strictEqual(capturedStripeParams.line_items[0].quantity, 1);
      assert.strictEqual(capturedStripeParams.line_items[0].price, 'price_test_team_annual_012');

      // Top-level session metadata
      assert.deepStrictEqual(capturedStripeParams.metadata, {
        workspaceId: WORKSPACE_ID,
        ownerUid: OWNER_UID,
        planId: 'team',
        billingInterval: 'annual',
      });

      // Subscription data metadata
      assert.deepStrictEqual(capturedStripeParams.subscription_data.metadata, {
        workspaceId: WORKSPACE_ID,
        ownerUid: OWNER_UID,
        planId: 'team',
        billingInterval: 'annual',
      });

      // Internal safe URLs
      assert(capturedStripeParams.success_url.includes('/billing/success?session_id={CHECKOUT_SESSION_ID}'));
      assert(capturedStripeParams.cancel_url.includes('/settings/billing?checkout=cancelled'));
    });

    it('reuses existing verified stripeCustomerId when available', async () => {
      await storage.saveBillingCurrent(WORKSPACE_ID, {
        planId: 'solo',
        subscriptionStatus: 'incomplete',
        entitlementStatus: 'inactive',
        trialStartedAt: null,
        trialEndsAt: null,
        stripeCustomerId: 'cus_existing_bob_456',
        stripeSubscriptionId: null,
        stripePriceId: null,
        seatLimit: 1,
        activeSeatCount: 1,
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        billingUpdatedAt: new Date().toISOString(),
        billingSource: 'stripe',
      });

      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'solo',
        billingInterval: 'monthly',
      });

      assert.strictEqual(capturedStripeParams.customer, 'cus_existing_bob_456');
    });
  });

  // ==========================================
  // 7. ENTITLEMENT SAFETY INVARIANTS
  // ==========================================
  describe('7. Entitlement Safety & Anti-Tamper Invariants', () => {
    it('checkout session creation does NOT mutate Firestore billing document', async () => {
      const beforeBilling = await storage.getBillingCurrent(WORKSPACE_ID);
      assert.strictEqual(beforeBilling, null);

      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'monthly',
      });

      const afterBilling = await storage.getBillingCurrent(WORKSPACE_ID);
      assert.strictEqual(afterBilling, null, 'Billing document must remain null after session creation');

      // Entitlement remains fail-closed NO_ENTITLEMENT
      const evalResult = EntitlementService.evaluate({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        billingDoc: afterBilling,
        workspaceId: WORKSPACE_ID,
      });
      assert.strictEqual(evalResult.canAccessApp, false);
      assert.strictEqual(evalResult.accessState, 'NO_ENTITLEMENT');
    });

    it('active trial entitlement remains intact during checkout creation', async () => {
      const trialBilling = {
        planId: 'team' as const,
        subscriptionStatus: 'trialing' as const,
        entitlementStatus: 'active' as const,
        trialStartedAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        seatLimit: 5,
        activeSeatCount: 1,
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        billingUpdatedAt: new Date().toISOString(),
        billingSource: 'trial' as const,
      };
      await storage.saveBillingCurrent(WORKSPACE_ID, trialBilling);

      await StripeService.createCheckoutSession({
        tokenUid: OWNER_UID,
        workspaceId: WORKSPACE_ID,
        planId: 'team',
        billingInterval: 'monthly',
      });

      const afterBilling = await storage.getBillingCurrent(WORKSPACE_ID);
      assert.deepStrictEqual(afterBilling, trialBilling, 'Trial billing was not modified by checkout');
    });

    it('client security rules strictly deny client write to billing/current', async () => {
      const result = engine.evaluateRequest(
        { auth: { uid: OWNER_UID, email: 'bob@bakery.com' } },
        'update',
        'billing',
        {
          workspaceId: WORKSPACE_ID,
          planId: 'team',
          subscriptionStatus: 'active',
          entitlementStatus: 'active',
          billingSource: 'stripe',
          stripeSubscriptionId: 'sub_fake_client_hacked',
        }
      );
      assert.strictEqual(result, 'DENY', 'Client write to billing/current must be DENIED');
    });
  });

  // ==========================================
  // 8. DUPLICATE SUBSCRIPTION SAFETY
  // ==========================================
  describe('8. Duplicate Subscription Safety Invariants', () => {
    it('blocks checkout with 409 SUBSCRIPTION_ALREADY_EXISTS if workspace already has active Stripe subscription', async () => {
      await storage.saveBillingCurrent(WORKSPACE_ID, {
        planId: 'team',
        subscriptionStatus: 'active',
        entitlementStatus: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        stripeCustomerId: 'cus_active_123',
        stripeSubscriptionId: 'sub_active_456',
        stripePriceId: 'price_team_monthly_789',
        seatLimit: 5,
        activeSeatCount: 2,
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        billingUpdatedAt: new Date().toISOString(),
        billingSource: 'stripe',
      });

      await assert.rejects(
        async () => {
          await StripeService.createCheckoutSession({
            tokenUid: OWNER_UID,
            workspaceId: WORKSPACE_ID,
            planId: 'team',
            billingInterval: 'monthly',
          });
        },
        (err: any) => {
          assert.strictEqual(err.status, 409);
          assert.strictEqual(err.code, 'SUBSCRIPTION_ALREADY_EXISTS');
          return true;
        }
      );
    });

    it('protects against rapid duplicate submission by returning same in-flight session promise', async () => {
      const [call1, call2] = await Promise.all([
        StripeService.createCheckoutSession({
          tokenUid: OWNER_UID,
          workspaceId: WORKSPACE_ID,
          planId: 'solo',
          billingInterval: 'monthly',
        }),
        StripeService.createCheckoutSession({
          tokenUid: OWNER_UID,
          workspaceId: WORKSPACE_ID,
          planId: 'solo',
          billingInterval: 'monthly',
        }),
      ]);

      assert.strictEqual(call1.sessionId, call2.sessionId);
      assert.strictEqual(call1.url, call2.url);
    });
  });
});
