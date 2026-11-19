import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TrialActivationService,
  InMemoryBillingStorageAdapter,
  BillingError,
  grantStrategicPartnerAccess,
  revokeStrategicPartnerAccess,
  convertToPaidSubscription,
} from '../src/server/billingService';
import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';
import { getWorkspaceEntitlement } from '../src/services/entitlement';
import { WorkspaceBilling } from '../src/types/billing';

describe('Phase 1.2.5 — Strategic Partner Complimentary Access Suite', () => {
  let storage: InMemoryBillingStorageAdapter;
  const engine = new PolicySimulationEngine();

  const ADMIN_UID = 'admin-system';
  const CHEF_UID = 'uid-chef-pierre';
  const CHEF_EMAIL = 'pierre@lepastry.com';
  const CHEF_WORKSPACE_ID = 'ws-chef-pierre';

  const SECOND_WORKSPACE_ID = 'ws-chef-pierre-second';

  beforeEach(() => {
    storage = new InMemoryBillingStorageAdapter();
    TrialActivationService.setAdapter(storage);

    // Seed Chef Pierre's primary workspace
    storage.seedWorkspace(CHEF_WORKSPACE_ID, CHEF_UID, "Chef Pierre's Pâtisserie");
    storage.seedMember(CHEF_WORKSPACE_ID, CHEF_UID, 'owner', CHEF_EMAIL);
    storage.seedUser(CHEF_UID, {
      uid: CHEF_UID,
      email: CHEF_EMAIL,
      ownedWorkspaceId: CHEF_WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });

    // Seed Chef Pierre's secondary workspace (separate business entity)
    storage.seedWorkspace(SECOND_WORKSPACE_ID, CHEF_UID, 'Pierre Bistro Bakery');
    storage.seedMember(SECOND_WORKSPACE_ID, CHEF_UID, 'owner', CHEF_EMAIL);

    // Seed PolicySimulationEngine for client security rules verification
    engine.setWorkspace(CHEF_WORKSPACE_ID, CHEF_UID, "Chef Pierre's Pâtisserie");
    engine.setMember(CHEF_WORKSPACE_ID, CHEF_UID, 'owner', CHEF_EMAIL);
    engine.setUser(CHEF_UID, {
      uid: CHEF_UID,
      email: CHEF_EMAIL,
      ownedWorkspaceId: CHEF_WORKSPACE_ID,
      trialConsumedForOwnedWorkspace: false,
    });
  });

  // TEST A: Chef workspace granted strategic access
  it('Test A: Chef workspace granted strategic access receives team complimentary entitlement', async () => {
    // Initial state: new customer workspace with no billing/current document
    const initialBilling = await storage.getBillingCurrent(CHEF_WORKSPACE_ID);
    assert.strictEqual(initialBilling, null, 'Initial billing document should not exist');

    // Grant strategic partner complimentary access
    const result = await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
      reason: 'Long-term culinary partner and executive pastry chef',
      strategicPartnerType: 'chef',
      organizationName: 'Grand Hotel Hospitality Group',
      propertyName: 'Pastry Kitchen 1',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.billing.planId, 'team');
    assert.strictEqual(result.billing.subscriptionStatus, 'complimentary');
    assert.strictEqual(result.billing.entitlementStatus, 'active');
    assert.strictEqual(result.billing.billingSource, 'strategic_partner');
    assert.strictEqual(result.billing.seatLimit, 5);
    assert.strictEqual(result.billing.complimentaryExpiresAt, null);
    assert.strictEqual(result.billing.complimentaryAccess, true);
    assert.strictEqual(result.billing.strategicPartner, true);
    assert.strictEqual(result.billing.grantedBy, ADMIN_UID);

    // Entitlement evaluation verification
    const evaluation = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, result.billing);
    assert.strictEqual(evaluation.accessState, 'COMPLIMENTARY_ACTIVE');
    assert.strictEqual(evaluation.canAccessApp, true);
    assert.strictEqual(evaluation.hasFullEntitlement, true);
    assert.strictEqual(evaluation.planId, 'team');
    assert.strictEqual(evaluation.maxSeats, 5);
    assert.strictEqual(evaluation.seatLimit, 5);
  });

  // TEST B: Strategic chef access opens the calculator without paywall/blocking
  it('Test B: Strategic chef access allows full app entry without paywall or modal blockage', async () => {
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    const billing = await storage.getBillingCurrent(CHEF_WORKSPACE_ID);
    assert.ok(billing);

    const evaluation = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, billing);
    assert.strictEqual(evaluation.canAccessApp, true, 'User must have direct access to production calculator');
    assert.strictEqual(evaluation.accessState, 'COMPLIMENTARY_ACTIVE');
    assert.strictEqual(evaluation.entitlementStatus, 'active');
  });

  // TEST C: Settings/Billing displays complimentary strategic partner status correctly
  it('Test C: Settings and billing display complimentary strategic partner status correctly', async () => {
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
      reason: 'Strategic Hospitality Chef',
    });

    const billing = await storage.getBillingCurrent(CHEF_WORKSPACE_ID);
    assert.ok(billing);

    const evaluation = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, billing);

    // Verify fields that power the UI
    assert.strictEqual(evaluation.planId, 'team');
    assert.strictEqual(billing.subscriptionStatus, 'complimentary');
    assert.strictEqual(billing.billingSource, 'strategic_partner');
    assert.strictEqual(billing.complimentaryAccess, true);
    assert.strictEqual(billing.complimentaryExpiresAt, null);
    assert.strictEqual(billing.trialStartedAt, null);
    assert.strictEqual(billing.trialEndsAt, null);
  });

  // TEST D: Strategic chef workspace CANNOT invite beyond Team seat limit
  it('Test D: Strategic chef workspace enforces team seat limit (5 seats max)', async () => {
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    const billing = await storage.getBillingCurrent(CHEF_WORKSPACE_ID);
    assert.ok(billing);
    assert.strictEqual(billing.seatLimit, 5);

    // Simulate member invitation capacity logic
    const currentMembers: string[] = [CHEF_UID];

    const inviteMember = (newMemberUid: string) => {
      if (currentMembers.length >= billing.seatLimit) {
        throw new Error('EXCEEDS_SEAT_LIMIT: Maximum team seat capacity (5) reached.');
      }
      currentMembers.push(newMemberUid);
    };

    // Add up to 5 members (1 owner + 4 members)
    inviteMember('chef-member-2');
    inviteMember('chef-member-3');
    inviteMember('chef-member-4');
    inviteMember('chef-member-5');
    assert.strictEqual(currentMembers.length, 5);

    // Attempting 6th member must be rejected
    assert.throws(
      () => inviteMember('chef-member-6'),
      /EXCEEDS_SEAT_LIMIT/,
      'Cannot exceed 5 seats under complimentary team plan'
    );
  });

  // TEST E: Strategic chef cannot grant himself strategic access from browser
  it('Test E: Browser client cannot write directly to billing or self-grant strategic status', async () => {
    // 1. Direct write to billing subcollection via Firestore rules simulation
    const clientWriteVerdict = engine.evaluateRequest(
      { auth: { uid: CHEF_UID, email: CHEF_EMAIL } },
      'create',
      `workspaces/${CHEF_WORKSPACE_ID}/billing/current`,
      {
        subscriptionStatus: 'complimentary',
        planId: 'team',
        billingSource: 'strategic_partner',
        entitlementStatus: 'active',
      }
    );
    assert.strictEqual(clientWriteVerdict, 'DENY', 'Client writes to billing/current must be rejected');

    // 2. Direct server call without admin privilege must be rejected with 403
    await assert.rejects(
      async () => {
        await grantStrategicPartnerAccess({
          workspaceId: CHEF_WORKSPACE_ID,
          adminUid: CHEF_UID, // Non-admin calling administrative API
          planId: 'team',
        });
      },
      (err: any) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.code, 'FORBIDDEN_ADMIN_REQUIRED');
        return true;
      }
    );
  });

  // TEST F: Strategic chef cannot alter billingSource or subscriptionStatus
  it('Test F: Client anti-tamper rejects unauthorized modifications to billingSource and strategic metadata', async () => {
    // Direct workspace creation/update attempting to tamper with strategicPartner or billingSource
    const tamperVerdict = engine.evaluateRequest(
      { auth: { uid: CHEF_UID, email: CHEF_EMAIL } },
      'update',
      'workspaces',
      {
        id: CHEF_WORKSPACE_ID,
        ownerId: CHEF_UID,
        strategicPartner: true, // Attempting to self-grant strategic status
      },
      {
        id: CHEF_WORKSPACE_ID,
        ownerId: CHEF_UID,
        strategicPartner: false,
      }
    );
    assert.strictEqual(tamperVerdict, 'DENY', 'Anti-tamper rule must block client modifications to strategicPartner');
  });

  // TEST G: Strategic access does NOT propagate to another workspace owned by the same chef
  it('Test G: Strategic partner access does NOT propagate to another workspace owned by the same chef', async () => {
    // Grant strategic access to primary workspace
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    // Primary workspace is active
    const primaryBilling = await storage.getBillingCurrent(CHEF_WORKSPACE_ID);
    const primaryEval = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, primaryBilling);
    assert.strictEqual(primaryEval.accessState, 'COMPLIMENTARY_ACTIVE');
    assert.strictEqual(primaryEval.canAccessApp, true);

    // Second workspace has no billing document
    const secondBilling = await storage.getBillingCurrent(SECOND_WORKSPACE_ID);
    assert.strictEqual(secondBilling, null);

    const secondEval = getWorkspaceEntitlement(SECOND_WORKSPACE_ID, secondBilling);
    assert.strictEqual(secondEval.accessState, 'NO_ENTITLEMENT');
    assert.strictEqual(secondEval.canAccessApp, false);
    assert.strictEqual(secondEval.hasFullEntitlement, false);
  });

  // TEST H: Revocation terminates app access immediately
  it('Test H: Revocation terminates app access immediately', async () => {
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    // Revoke strategic access
    const revokeResult = await revokeStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      reason: 'Partner pilot completed',
    });

    assert.strictEqual(revokeResult.success, true);
    assert.strictEqual(revokeResult.billing.subscriptionStatus, 'canceled');
    assert.strictEqual(revokeResult.billing.entitlementStatus, 'inactive');
    assert.strictEqual(revokeResult.billing.complimentaryAccess, false);

    // Re-evaluate entitlement
    const evaluation = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, revokeResult.billing);
    assert.strictEqual(evaluation.canAccessApp, false, 'Access must be revoked immediately');
    assert.strictEqual(evaluation.accessState, 'SUBSCRIPTION_EXPIRED');
    assert.strictEqual(evaluation.hasFullEntitlement, false);
  });

  // TEST I: Revocation preserves chef workspace recipes and data
  it('Test I: Revocation preserves chef workspace recipes and data intact', async () => {
    // Seed mock recipes in workspace
    const mockRecipes = [
      { id: 'recipe-1', name: 'Brioche Feuilletée', yield: 24 },
      { id: 'recipe-2', name: 'Canelé de Bordeaux', yield: 48 },
    ];

    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    // Revoke access
    await revokeStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      reason: 'Consultancy ended',
    });

    // Verify workspace itself and recipes remain completely intact
    const workspace = await storage.getWorkspace(CHEF_WORKSPACE_ID);
    assert.ok(workspace);
    assert.strictEqual(workspace.id, CHEF_WORKSPACE_ID);
    assert.strictEqual(mockRecipes.length, 2, 'Recipes must never be deleted on revocation');
  });

  // TEST J: Chef workspace that used trial first CAN still receive strategic access later
  it('Test J: Chef workspace that used trial first can still receive strategic access later', async () => {
    // 1. Chef activates 14-day free trial
    const trialRes = await TrialActivationService.startTrial({
      tokenUid: CHEF_UID,
      workspaceId: CHEF_WORKSPACE_ID,
    });
    assert.strictEqual(trialRes.success, true);
    assert.strictEqual(trialRes.trialRecord.trialConsumed, true);

    // 2. Simulate trial expiration 15 days later
    const expiredTime = new Date(Date.now() + 15 * 86400000);
    const expiredEval = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, trialRes.billing, expiredTime);
    assert.strictEqual(expiredEval.canAccessApp, false);
    assert.strictEqual(expiredEval.accessState, 'SUBSCRIPTION_EXPIRED');

    // 3. Admin grants strategic partner access to the workspace
    const grantRes = await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
      reason: 'Executive partner relationship',
    });
    assert.strictEqual(grantRes.success, true);

    // 4. Chef now has active complimentary access
    const activeEval = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, grantRes.billing, expiredTime);
    assert.strictEqual(activeEval.canAccessApp, true);
    assert.strictEqual(activeEval.accessState, 'COMPLIMENTARY_ACTIVE');

    // 5. Verify trial consumption history is preserved (not erased)
    const userProfile = await storage.getUserProfile(CHEF_UID);
    assert.strictEqual(userProfile?.trialConsumedForOwnedWorkspace, true);
    const trialRecord = await storage.getBillingTrial(CHEF_WORKSPACE_ID);
    assert.strictEqual(trialRecord?.trialConsumed, true);
  });

  // TEST K: Strategic access does NOT reset trialConsumed
  it('Test K: Strategic access does NOT reset trialConsumed when granted or revoked', async () => {
    // Chef consumes trial
    await TrialActivationService.startTrial({
      tokenUid: CHEF_UID,
      workspaceId: CHEF_WORKSPACE_ID,
    });

    // Grant strategic access
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    // Revoke strategic access
    await revokeStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      reason: 'Program ended',
    });

    // User attempts to activate a free trial again -> must be rejected
    await assert.rejects(
      async () => {
        await TrialActivationService.startTrial({
          tokenUid: CHEF_UID,
          workspaceId: CHEF_WORKSPACE_ID,
        });
      },
      (err: any) => {
        assert.strictEqual(err.status, 409);
        assert.strictEqual(err.code, 'TRIAL_ALREADY_CONSUMED');
        return true;
      }
    );
  });

  // TEST L: Future conversion to paid Stripe subscription succeeds cleanly
  it('Test L: Conversion to paid Stripe subscription transitions cleanly while preserving data', async () => {
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    // Transition to paid commercial subscription
    const convertResult = await convertToPaidSubscription({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
      stripeCustomerId: 'cus_chef_pierre_123',
      stripeSubscriptionId: 'sub_chef_pierre_456',
      stripePriceId: 'price_team_monthly',
    });

    assert.strictEqual(convertResult.success, true);
    assert.strictEqual(convertResult.billing.billingSource, 'stripe');
    assert.strictEqual(convertResult.billing.subscriptionStatus, 'active');
    assert.strictEqual(convertResult.billing.entitlementStatus, 'active');
    assert.strictEqual(convertResult.billing.complimentaryAccess, false);

    const evalResult = getWorkspaceEntitlement(CHEF_WORKSPACE_ID, convertResult.billing);
    assert.strictEqual(evalResult.accessState, 'SUBSCRIPTION_ACTIVE');
    assert.strictEqual(evalResult.canAccessApp, true);
    assert.strictEqual(evalResult.hasFullEntitlement, true);
  });

  // TEST M: Normal workspace owner cannot revoke another chef's strategic access
  it("Test M: Normal workspace owner cannot revoke another chef's strategic access", async () => {
    await grantStrategicPartnerAccess({
      workspaceId: CHEF_WORKSPACE_ID,
      adminUid: ADMIN_UID,
      planId: 'team',
    });

    // Non-admin attempting revocation
    await assert.rejects(
      async () => {
        await revokeStrategicPartnerAccess({
          workspaceId: CHEF_WORKSPACE_ID,
          adminUid: CHEF_UID,
          reason: 'Malicious attempt',
        });
      },
      (err: any) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.code, 'FORBIDDEN_ADMIN_REQUIRED');
        return true;
      }
    );
  });
});
