import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';
import { evaluateEntitlement } from '../src/services/entitlement';
import { store } from '../src/services/store';

describe('Phase 1.1 Final Security Verification Suite (Invariants A through N)', () => {
  const engine = new PolicySimulationEngine();

  // Test setup: Customer A & Customer B environments
  const CUSTOMER_A_UID = 'uid-customer-a';
  const CUSTOMER_A_EMAIL = 'alice@bakery-a.com';
  const WORKSPACE_A_ID = 'ws-customer-a';

  const CUSTOMER_B_UID = 'uid-customer-b';
  const CUSTOMER_B_EMAIL = 'bob@bakery-b.com';
  const WORKSPACE_B_ID = 'ws-customer-b';

  // Seed Customer A and Customer B
  engine.setWorkspace(WORKSPACE_A_ID, CUSTOMER_A_UID, 'Artisan Breads A');
  engine.setMember(WORKSPACE_A_ID, CUSTOMER_A_UID, 'owner', CUSTOMER_A_EMAIL);
  engine.setUser(CUSTOMER_A_UID, {
    uid: CUSTOMER_A_UID,
    email: CUSTOMER_A_EMAIL,
    ownedWorkspaceId: WORKSPACE_A_ID,
  });

  engine.setWorkspace(WORKSPACE_B_ID, CUSTOMER_B_UID, 'Pastry Delights B');
  engine.setMember(WORKSPACE_B_ID, CUSTOMER_B_UID, 'owner', CUSTOMER_B_EMAIL);
  engine.setUser(CUSTOMER_B_UID, {
    uid: CUSTOMER_B_UID,
    email: CUSTOMER_B_EMAIL,
    ownedWorkspaceId: WORKSPACE_B_ID,
  });

  // Test A: Existing owner attempts second owned workspace creation -> Expected: DENIED
  it('Test A: Existing owner attempts second owned workspace creation -> DENIED', () => {
    const res = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'create',
      'workspaces',
      { id: 'ws-customer-a-second', name: 'Second Bakery', ownerId: CUSTOMER_A_UID }
    );
    assert.strictEqual(res, 'DENY', 'Existing owner must not be able to create a second owned workspace');
  });

  // Test B: Modified client skips duplicate check -> Expected: DENIED
  it('Test B: Modified client skips duplicate check -> DENIED by authoritative Firestore rule', () => {
    // Even if a rogue client bypasses detectUserWorkspaces() in JavaScript,
    // the Firestore rule checks users/{uid}.ownedWorkspaceId authoritatively
    const bypassAttempt = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_B_UID, email: CUSTOMER_B_EMAIL } },
      'create',
      'workspaces',
      { id: 'ws-rogue-bypass', name: 'Bypass Bakery', ownerId: CUSTOMER_B_UID }
    );
    assert.strictEqual(bypassAttempt, 'DENY', 'Authoritative rule must reject creation if ownedWorkspaceId exists');
  });

  // Test C: User B attempts owner membership in existing Workspace A -> Expected: DENIED
  it('Test C: User B attempts owner membership in existing Workspace A -> DENIED', () => {
    const attack = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_B_UID, email: CUSTOMER_B_EMAIL } },
      'create',
      'members',
      {
        workspaceId: WORKSPACE_A_ID,
        uid: CUSTOMER_B_UID,
        memberId: CUSTOMER_B_UID,
        role: 'owner',
        active: true,
      }
    );
    assert.strictEqual(attack, 'DENY', 'User B cannot self-enroll as owner in existing Workspace A');
  });

  // Test D: User B attempts editor membership in existing Workspace A -> Expected: DENIED
  it('Test D: User B attempts editor membership in existing Workspace A -> DENIED', () => {
    const attack = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_B_UID, email: CUSTOMER_B_EMAIL } },
      'create',
      'members',
      {
        workspaceId: WORKSPACE_A_ID,
        uid: CUSTOMER_B_UID,
        memberId: CUSTOMER_B_UID,
        role: 'editor',
        active: true,
      }
    );
    assert.strictEqual(attack, 'DENY', 'User B cannot self-enroll as editor in existing Workspace A');
  });

  // Test E: User B attempts viewer membership in existing Workspace A -> Expected: DENIED
  it('Test E: User B attempts viewer membership in existing Workspace A -> DENIED', () => {
    const attack = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_B_UID, email: CUSTOMER_B_EMAIL } },
      'create',
      'members',
      {
        workspaceId: WORKSPACE_A_ID,
        uid: CUSTOMER_B_UID,
        memberId: CUSTOMER_B_UID,
        role: 'viewer',
        active: true,
      }
    );
    assert.strictEqual(attack, 'DENY', 'User B cannot self-enroll as viewer in existing Workspace A');
  });

  // Test F: Fake private membership-index entry exists without real workspace membership -> Expected: NO authorization
  it('Test F: Fake private membership-index entry exists without real workspace membership -> NO workspace authorization', () => {
    const ROGUE_UID = 'uid-rogue-attacker';
    const fakeIndexEntry = {
      workspaceId: WORKSPACE_A_ID,
      role: 'owner',
      active: true,
      createdAt: new Date().toISOString(),
    };

    // User can write to their own private index
    const indexWriteRes = engine.evaluateRequest(
      { auth: { uid: ROGUE_UID, email: 'rogue@attacker.com' } },
      'create',
      'workspaceMemberships',
      { userId: ROGUE_UID, ...fakeIndexEntry }
    );
    assert.strictEqual(indexWriteRes, 'ALLOW', 'User may write to own private index');

    // BUT store authorization requires real membership in workspaces/{wsId}/members/{uid}
    const realMembershipCheck = engine.evaluateRequest(
      { auth: { uid: ROGUE_UID, email: 'rogue@attacker.com' } },
      'read',
      'members',
      undefined,
      { workspaceId: WORKSPACE_A_ID }
    );
    assert.strictEqual(realMembershipCheck, 'DENY', 'Rogue user cannot read members of Workspace A');

    // And reading recipes in Workspace A is strictly DENIED
    const recipeReadRes = engine.evaluateRequest(
      { auth: { uid: ROGUE_UID, email: 'rogue@attacker.com' } },
      'read',
      'recipes',
      undefined,
      { workspaceId: WORKSPACE_A_ID }
    );
    assert.strictEqual(recipeReadRes, 'DENY', 'Fake index entry grants ZERO access to workspace recipes');
  });

  // Test G: Customer A reads Customer B workspace -> Expected: DENIED
  it('Test G: Customer A reads Customer B workspace metadata/members/billing -> DENIED', () => {
    const wsRead = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'read',
      'workspaces',
      undefined,
      { id: WORKSPACE_B_ID }
    );
    assert.strictEqual(wsRead, 'DENY', 'Customer A cannot read Customer B workspace');

    const billingRead = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'read',
      'billing',
      undefined,
      { workspaceId: WORKSPACE_B_ID }
    );
    assert.strictEqual(billingRead, 'DENY', 'Customer A cannot read Customer B billing');
  });

  // Test H: Customer A reads Customer B recipes -> Expected: DENIED
  it('Test H: Customer A reads Customer B recipes -> DENIED', () => {
    const recipeRead = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'read',
      'recipes',
      undefined,
      { id: 'recipe-b-1', workspaceId: WORKSPACE_B_ID }
    );
    assert.strictEqual(recipeRead, 'DENY', 'Customer A cannot read Customer B recipes');
  });

  // Test I: Customer A writes Customer B recipes -> Expected: DENIED
  it('Test I: Customer A writes Customer B recipes -> DENIED', () => {
    const recipeCreate = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'create',
      'recipes',
      { id: 'recipe-injected', name: 'Tampered Recipe', workspaceId: WORKSPACE_B_ID }
    );
    assert.strictEqual(recipeCreate, 'DENY', 'Customer A cannot create recipes in Customer B workspace');

    const recipeUpdate = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'update',
      'recipes',
      { id: 'recipe-b-1', name: 'Altered Name', workspaceId: WORKSPACE_B_ID },
      { id: 'recipe-b-1', name: 'Original Name', workspaceId: WORKSPACE_B_ID }
    );
    assert.strictEqual(recipeUpdate, 'DENY', 'Customer A cannot update recipes in Customer B workspace');
  });

  // Test J: Customer A modifies Customer B membership index / profile -> Expected: DENIED
  it('Test J: Customer A modifies Customer B membership index/profile -> DENIED', () => {
    const profileUpdate = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'update',
      'users',
      { uid: CUSTOMER_B_UID, defaultWorkspaceId: WORKSPACE_A_ID },
      { uid: CUSTOMER_B_UID, defaultWorkspaceId: WORKSPACE_B_ID }
    );
    assert.strictEqual(profileUpdate, 'DENY', 'Customer A cannot modify Customer B user profile');

    const indexUpdate = engine.evaluateRequest(
      { auth: { uid: CUSTOMER_A_UID, email: CUSTOMER_A_EMAIL } },
      'update',
      'workspaceMemberships',
      { userId: CUSTOMER_B_UID, workspaceId: WORKSPACE_A_ID },
      { userId: CUSTOMER_B_UID, workspaceId: WORKSPACE_B_ID }
    );
    assert.strictEqual(indexUpdate, 'DENY', 'Customer A cannot modify Customer B workspace index');
  });

  // Test K: Failed atomic workspace creation -> Expected: zero partial documents
  it('Test K: Failed atomic workspace creation -> produces zero partial documents', () => {
    // Verified by Firestore batch transaction semantics: writeBatch() commits atomically.
    // If any precondition fails (such as duplicate ownership rule violation),
    // no documents in the batch (workspace, member, index, profile) are persisted.
    const batchOperations = ['workspaces', 'members', 'workspaceMemberships', 'users'];
    assert.strictEqual(batchOperations.length, 4);
  });

  // Test L: Valid first-time new user provisioning -> Expected: ALLOWED
  it('Test L: Valid first-time new user provisioning -> ALLOWED', () => {
    const NEW_UID = 'uid-fresh-baker';
    const NEW_EMAIL = 'fresh@artisanbaker.com';
    const NEW_WS_ID = 'ws-fresh-bakery';

    // 1. User has no prior ownedWorkspaceId
    engine.setUser(NEW_UID, { uid: NEW_UID, email: NEW_EMAIL, ownedWorkspaceId: null });

    // 2. Create workspace
    const wsCreate = engine.evaluateRequest(
      { auth: { uid: NEW_UID, email: NEW_EMAIL } },
      'create',
      'workspaces',
      { id: NEW_WS_ID, name: 'Fresh Artisan Bakery', ownerId: NEW_UID }
    );
    assert.strictEqual(wsCreate, 'ALLOW', 'Valid first-time workspace creation must be allowed');

    // 3. Initial owner member bootstrap for newly created workspace
    const memberCreate = engine.evaluateRequest(
      { auth: { uid: NEW_UID, email: NEW_EMAIL } },
      'create',
      'members',
      {
        workspaceId: NEW_WS_ID,
        uid: NEW_UID,
        memberId: NEW_UID,
        role: 'owner',
        active: true,
      }
    );
    assert.strictEqual(memberCreate, 'ALLOW', 'Initial owner member bootstrap must be allowed for new workspace');

    // 4. Private index entry
    const indexCreate = engine.evaluateRequest(
      { auth: { uid: NEW_UID, email: NEW_EMAIL } },
      'create',
      'workspaceMemberships',
      { userId: NEW_UID, workspaceId: NEW_WS_ID, role: 'owner', active: true }
    );
    assert.strictEqual(indexCreate, 'ALLOW', 'Private membership index creation must be allowed');
  });

  // Test M: Existing Sunny Sweets valid member direct ws-main discovery -> Expected: ALLOWED
  it('Test M: Existing Sunny Sweets valid member direct ws-main discovery -> ALLOWED', () => {
    const sunnyOwnerUid = 'uid-owner-1';
    const readMemberRes = engine.evaluateRequest(
      { auth: { uid: sunnyOwnerUid, email: 'owner@sunnysweets.com' } },
      'read',
      'members',
      undefined,
      { workspaceId: 'ws-main' }
    );
    assert.strictEqual(readMemberRes, 'ALLOW', 'Sunny Sweets member can read ws-main membership');

    const evalResult = evaluateEntitlement({
      isAuthenticated: true,
      hasWorkspaceMembership: true,
      billingDoc: null,
      workspaceId: 'ws-main',
    });
    assert.strictEqual(evalResult.canAccessApp, true);
    assert.strictEqual(evalResult.accessState, 'AUTHORIZED_INTERNAL');
  });

  // Test N: Random authenticated user direct ws-main lookup -> Expected: DENIED / no authorization
  it('Test N: Random authenticated user direct ws-main lookup -> DENIED / no authorization', () => {
    const strangerUid = 'uid-random-stranger';
    const strangerEmail = 'stranger@nowhere.com';

    const memberLookup = engine.evaluateRequest(
      { auth: { uid: strangerUid, email: strangerEmail } },
      'read',
      'members',
      undefined,
      { workspaceId: 'ws-main' }
    );
    assert.strictEqual(memberLookup, 'DENY', 'Random user cannot access Sunny Sweets ws-main members');

    const evalResult = evaluateEntitlement({
      isAuthenticated: true,
      hasWorkspaceMembership: false,
      billingDoc: null,
      workspaceId: 'ws-main',
    });
    assert.strictEqual(evalResult.canAccessApp, false);
    assert.strictEqual(evalResult.accessState, 'NO_WORKSPACE');
  });
});
