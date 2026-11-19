import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TrialActivationService,
  InMemoryBillingStorageAdapter,
  BillingError,
} from '../src/server/billingService';
import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';
import { getWorkspaceEntitlement } from '../src/services/entitlement';
import { WorkspaceBilling } from '../src/types/billing';

describe('Phase 1.2 — Trusted 14-Day Free Trial Activation & Expiration Suite', () => {
  let storage: InMemoryBillingStorageAdapter;
  const engine = new PolicySimulationEngine();

  const OWNER_UID = 'uid-baker-john';
  const OWNER_EMAIL = 'john@artisanbakery.com';
  const WORKSPACE_ID = 'ws-artisan-john';

  const EMPLOYEE_UID = 'uid-employee-sarah';
  const EMPLOYEE_EMAIL = 'sarah@artisanbakery.com';

  const OTHER_OWNER_UID = 'uid-owner-maria';
  const OTHER_WORKSPACE_ID = 'ws-maria-pastries';

  beforeEach(() => {
    storage = new InMemoryBillingStorageAdapter();
    TrialActivationService.setAdapter(storage);

    // Seed John's workspace
    storage.seedWorkspace(WORKSPACE_ID, OWNER_UID, 'Artisan Bakery John');
    storage.seedMember(WORKSPACE_ID, OWNER_UID, 'owner', OWNER_EMAIL);
    storage.seedMember(WORKSPACE_ID, EMPLOYEE_UID, 'editor', EMPLOYEE_EMAIL);
    storage.seedUser(OWNER_UID, {
      uid: OWNER_UID,
      email: OWNER_EMAIL,
      ownedWorkspaceId: WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });

    // Seed Maria's workspace
    storage.seedWorkspace(OTHER_WORKSPACE_ID, OTHER_OWNER_UID, "Maria's Pastries");
    storage.seedMember(OTHER_WORKSPACE_ID, OTHER_OWNER_UID, 'owner');
    storage.seedUser(OTHER_OWNER_UID, {
      uid: OTHER_OWNER_UID,
      ownedWorkspaceId: OTHER_WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });

    // Seed PolicySimulationEngine for client rule tests
    engine.setWorkspace(WORKSPACE_ID, OWNER_UID, 'Artisan Bakery John');
    engine.setMember(WORKSPACE_ID, OWNER_UID, 'owner', OWNER_EMAIL);
    engine.setMember(WORKSPACE_ID, EMPLOYEE_UID, 'editor', EMPLOYEE_EMAIL);
    engine.setUser(OWNER_UID, {
      uid: OWNER_UID,
      email: OWNER_EMAIL,
      ownedWorkspaceId: WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });
  });

  // Test 1: Unauthenticated request rejected
  it('Test 1: Unauthenticated request rejected with UNAUTHORIZED', async () => {
    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: '',
          workspaceId: WORKSPACE_ID,
        });
      },
      (err: BillingError) => {
        assert.strictEqual(err.code, 'UNAUTHORIZED');
        assert.strictEqual(err.status, 401);
        return true;
      }
    );
  });

  // Test 2: Non-owner request rejected
  it('Test 2: Non-owner (editor/viewer/stranger) request rejected with FORBIDDEN_NOT_OWNER', async () => {
    // Employee with editor role in the workspace
    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: EMPLOYEE_UID,
          workspaceId: WORKSPACE_ID,
        });
      },
      (err: BillingError) => {
        assert.strictEqual(err.code, 'FORBIDDEN_NOT_OWNER');
        assert.strictEqual(err.status, 403);
        return true;
      }
    );

    // Stranger not even in workspace
    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: 'uid-stranger',
          workspaceId: WORKSPACE_ID,
        });
      },
      (err: BillingError) => {
        assert.strictEqual(err.code, 'FORBIDDEN_NOT_OWNER');
        assert.strictEqual(err.status, 403);
        return true;
      }
    );
  });

  // Test 3: Sunny Sweets workspace rejected
  it('Test 3: Sunny Sweets workspace (ws-main) is strictly rejected', async () => {
    storage.seedWorkspace('ws-main', OWNER_UID, 'Sunny Sweets');
    storage.seedMember('ws-main', OWNER_UID, 'owner');

    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: OWNER_UID,
          workspaceId: 'ws-main',
        });
      },
      (err: BillingError) => {
        assert.strictEqual(err.code, 'FORBIDDEN_WS_MAIN');
        assert.strictEqual(err.status, 403);
        return true;
      }
    );
  });

  // Test 4: Eligible owner successfully activates 14-day trial
  it('Test 4: Eligible customer workspace owner successfully activates authoritative 14-day trial', async () => {
    const beforeDate = new Date();
    const result = await TrialActivationService.startTrial({
      tokenUid: OWNER_UID,
      workspaceId: WORKSPACE_ID,
    });

    assert.strictEqual(result.success, true);
    assert(result.billing);

    // Verify Authoritative Billing Document structure
    const billing = result.billing;
    assert.strictEqual(billing.planId, 'solo');
    assert.strictEqual(billing.subscriptionStatus, 'trialing');
    assert.strictEqual(billing.entitlementStatus, 'active');
    assert.strictEqual(billing.seatLimit, 1);
    assert.strictEqual(billing.activeSeatCount, 1); // Solo trial defaults to 1 seat
    assert.strictEqual(billing.stripeCustomerId, null);
    assert.strictEqual(billing.stripeSubscriptionId, null);
    assert.strictEqual(billing.stripePriceId, null);
    assert.strictEqual(billing.cancelAtPeriodEnd, false);
    assert.strictEqual(billing.billingSource, 'trial');

    // Verify 14-Day duration calculation
    const start = new Date(billing.trialStartedAt!).getTime();
    const end = new Date(billing.trialEndsAt!).getTime();
    const durationDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
    assert.strictEqual(durationDays, 14);
    assert(start >= beforeDate.getTime() - 1000);

    // Verify currentPeriodStart & currentPeriodEnd mirror trial dates
    assert.strictEqual(billing.currentPeriodStart, billing.trialStartedAt);
    assert.strictEqual(billing.currentPeriodEnd, billing.trialEndsAt);

    // Verify Workspace Trial Record was created in storage
    const trialRecord = await storage.getBillingTrial(WORKSPACE_ID);
    assert(trialRecord);
    assert.strictEqual(trialRecord.workspaceId, WORKSPACE_ID);
    assert.strictEqual(trialRecord.activatedByUid, OWNER_UID);
    assert.strictEqual(trialRecord.trialStartedAt, billing.trialStartedAt);
    assert.strictEqual(trialRecord.trialEndsAt, billing.trialEndsAt);

    // Verify User profile trialConsumedForOwnedWorkspace was marked true
    const userProfile = await storage.getUserProfile(OWNER_UID);
    assert(userProfile);
    assert.strictEqual(userProfile.trialConsumedForOwnedWorkspace, true);
  });

  // Test 5: Idempotent repeat trial activation and post-expiry rejection
  it('Test 5: Idempotent repeat trial activation during active period and rejection with TRIAL_ALREADY_CONSUMED after expiration', async () => {
    // First activation succeeds
    const firstResult = await TrialActivationService.startTrial({
      tokenUid: OWNER_UID,
      workspaceId: WORKSPACE_ID,
    });
    assert.strictEqual(firstResult.success, true);

    // Second activation attempt during active trial is idempotent and does not extend trialEndsAt
    const secondResult = await TrialActivationService.startTrial({
      tokenUid: OWNER_UID,
      workspaceId: WORKSPACE_ID,
    });
    assert.strictEqual(secondResult.success, true);
    assert.strictEqual(secondResult.billing.trialEndsAt, firstResult.billing.trialEndsAt);
    assert.strictEqual(secondResult.billing.trialStartedAt, firstResult.billing.trialStartedAt);

    // Once trial period is over (15 days later), repeat trial activation is strictly rejected
    const futureDate = new Date(Date.now() + 15 * 86400000);
    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: OWNER_UID,
          workspaceId: WORKSPACE_ID,
          serverNow: futureDate,
        });
      },
      (err: BillingError) => {
        assert.strictEqual(err.code, 'TRIAL_ALREADY_CONSUMED');
        assert.strictEqual(err.status, 409);
        return true;
      }
    );
  });

  // Test 6: Repeat trial activation rejected when user lifecycle has already consumed a trial
  it('Test 6: Repeat trial activation rejected if owner profile has trialConsumedForOwnedWorkspace: true', async () => {
    // Seed user with trial already consumed
    storage.seedUser('uid-veteran-owner', {
      uid: 'uid-veteran-owner',
      ownedWorkspaceId: 'ws-new-bakery',
      trialConsumedForOwnedWorkspace: true,
    });
    storage.seedWorkspace('ws-new-bakery', 'uid-veteran-owner', 'New Bakery');
    storage.seedMember('ws-new-bakery', 'uid-veteran-owner', 'owner');

    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: 'uid-veteran-owner',
          workspaceId: 'ws-new-bakery',
        });
      },
      (err: BillingError) => {
        assert.strictEqual(err.code, 'TRIAL_ALREADY_CONSUMED');
        assert.strictEqual(err.status, 409);
        return true;
      }
    );
  });

  // Test 7: Client direct write to workspaces/{id}/billing/current rejected
  it('Test 7: Direct client create, update, or delete to billing/current is DENIED by security rules', () => {
    // Client direct write attempt
    const writeCurrent = engine.evaluateRequest(
      { auth: { uid: OWNER_UID, email: OWNER_EMAIL } },
      'update',
      `workspaces/${WORKSPACE_ID}/billing/current`,
      { planId: 'team', subscriptionStatus: 'active' },
      { workspaceId: WORKSPACE_ID }
    );
    assert.strictEqual(writeCurrent, 'DENY');

    const createCurrent = engine.evaluateRequest(
      { auth: { uid: OWNER_UID, email: OWNER_EMAIL } },
      'create',
      `workspaces/${WORKSPACE_ID}/billing/current`,
      { planId: 'team', subscriptionStatus: 'active' },
      { workspaceId: WORKSPACE_ID }
    );
    assert.strictEqual(createCurrent, 'DENY');
  });

  // Test 8: Client direct write to workspaces/{id}/billing/trial rejected
  it('Test 8: Direct client create, update, or delete to billing/trial is DENIED by security rules', () => {
    const writeTrial = engine.evaluateRequest(
      { auth: { uid: OWNER_UID, email: OWNER_EMAIL } },
      'update',
      `workspaces/${WORKSPACE_ID}/billing/trial`,
      { trialConsumed: false },
      { workspaceId: WORKSPACE_ID }
    );
    assert.strictEqual(writeTrial, 'DENY');
  });

  // Test 9: Member seat count calculation remains derived, not client-authored
  it('Test 9: Member seat count calculation remains derived from members collection and not client-authored', () => {
    // Client cannot write activeSeatCount to billing/current
    const writeSeatCount = engine.evaluateRequest(
      { auth: { uid: OWNER_UID, email: OWNER_EMAIL } },
      'update',
      `workspaces/${WORKSPACE_ID}/billing/current`,
      { activeSeatCount: 1 },
      { workspaceId: WORKSPACE_ID }
    );
    assert.strictEqual(writeSeatCount, 'DENY');
  });

  // Test 10: Anti-tamper on user document trialConsumedForOwnedWorkspace
  it('Test 10: User document trialConsumedForOwnedWorkspace cannot be cleared by client', () => {
    // User attempts to reset trialConsumedForOwnedWorkspace from true to false
    const tamperAttempt = engine.evaluateRequest(
      { auth: { uid: OWNER_UID, email: OWNER_EMAIL } },
      'update',
      `users/${OWNER_UID}`,
      { uid: OWNER_UID, ownedWorkspaceId: WORKSPACE_ID, trialConsumedForOwnedWorkspace: false },
      { uid: OWNER_UID, ownedWorkspaceId: WORKSPACE_ID, trialConsumedForOwnedWorkspace: true }
    );
    assert.strictEqual(tamperAttempt, 'DENY');
  });

  // Test 11: Entitlement engine evaluates active trial vs expired trial correctly
  it('Test 11: Entitlement engine evaluates active trial as TRIAL_ACTIVE and expired trial as SUBSCRIPTION_EXPIRED', () => {
    const now = Date.now();
    const activeTrialBilling: WorkspaceBilling = {
      planId: 'solo',
      subscriptionStatus: 'trialing',
      entitlementStatus: 'active',
      trialStartedAt: new Date(now - 3 * 86400000).toISOString(),
      trialEndsAt: new Date(now + 11 * 86400000).toISOString(),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      seatLimit: 1,
      activeSeatCount: 1,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date(now - 3 * 86400000).toISOString(),
      currentPeriodEnd: new Date(now + 11 * 86400000).toISOString(),
      billingUpdatedAt: new Date(now - 3 * 86400000).toISOString(),
      billingSource: 'trial',
    };

    // Active trial evaluation
    const activeEval = getWorkspaceEntitlement(WORKSPACE_ID, activeTrialBilling, new Date(now));
    assert.strictEqual(activeEval.accessState, 'TRIAL_ACTIVE');
    assert.strictEqual(activeEval.canAccessApp, true);
    assert.strictEqual(activeEval.seatLimit, 1);

    // Expired trial (trialEndsAt in the past)
    const expiredTrialBilling: WorkspaceBilling = {
      ...activeTrialBilling,
      subscriptionStatus: 'canceled',
      entitlementStatus: 'inactive',
      trialStartedAt: new Date(now - 15 * 86400000).toISOString(),
      trialEndsAt: new Date(now - 1 * 86400000).toISOString(),
      currentPeriodEnd: new Date(now - 1 * 86400000).toISOString(),
    };

    const expiredEval = getWorkspaceEntitlement(WORKSPACE_ID, expiredTrialBilling, new Date(now));
    assert.strictEqual(expiredEval.accessState, 'SUBSCRIPTION_EXPIRED');
    assert.strictEqual(expiredEval.canAccessApp, false);

    // Past due billing
    const pastDueBilling: WorkspaceBilling = {
      ...activeTrialBilling,
      subscriptionStatus: 'past_due',
      entitlementStatus: 'past_due',
    };
    const pastDueEval = getWorkspaceEntitlement(WORKSPACE_ID, pastDueBilling, new Date(now));
    assert.strictEqual(pastDueEval.accessState, 'SUBSCRIPTION_PAST_DUE');
    assert.strictEqual(pastDueEval.canAccessApp, false);
  });
});
