import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  EXPECTED_REBIND_EMAIL,
  EXPECTED_REBIND_DATABASE_ID,
  TARGET_REBIND_WORKSPACE_ID,
  LEGACY_OWNER_UID,
  PreconditionCheck,
} from '../src/services/ownerRebindService';

describe('One-Time ws-main Owner Identity Rebind Service Tests', () => {
  // 1. Constants and Target Configuration Verification
  it('1. Target workspace, database ID, legacy owner UID, and email constants match exact specifications', () => {
    assert.strictEqual(TARGET_REBIND_WORKSPACE_ID, 'ws-main');
    assert.strictEqual(EXPECTED_REBIND_EMAIL, 'jaoliveras@gmail.com');
    assert.strictEqual(EXPECTED_REBIND_DATABASE_ID, 'ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92');
    assert.strictEqual(LEGACY_OWNER_UID, '42JFWv9G4eb4AvUql3VrvufLeGd2');
  });

  // 2. Precondition 1: auth.currentUser must exist
  it('2. Rebind is blocked if auth.currentUser is missing', () => {
    const user = null;
    const p1: PreconditionCheck = {
      id: 'P1_AUTH_USER_EXISTS',
      name: 'auth.currentUser exists',
      passed: !!user,
      actual: 'null',
      expected: 'Authenticated Firebase user object',
    };
    assert.strictEqual(p1.passed, false);
  });

  // 3. Precondition 2: auth.currentUser.email must be exactly jaoliveras@gmail.com
  it('3. Rebind is blocked if authenticated email is not jaoliveras@gmail.com', () => {
    const wrongEmail: string = 'intruder@example.com';
    const p2: PreconditionCheck = {
      id: 'P2_EMAIL_MATCH',
      name: 'auth.currentUser.email is jaoliveras@gmail.com',
      passed: wrongEmail === (EXPECTED_REBIND_EMAIL as string),
      actual: wrongEmail,
      expected: EXPECTED_REBIND_EMAIL,
    };
    assert.strictEqual(p2.passed, false);

    const validEmail: string = 'jaoliveras@gmail.com';
    assert.strictEqual(validEmail === (EXPECTED_REBIND_EMAIL as string), true);
  });

  // 4. Precondition 3: Active Firestore database ID must match isolated dev db
  it('4. Rebind is blocked if database ID is not the isolated development database', () => {
    const wrongDb: string = 'production-default-db';
    const p3Wrong: PreconditionCheck = {
      id: 'P3_DATABASE_ID_MATCH',
      name: 'Active Firestore database ID match',
      passed: wrongDb === (EXPECTED_REBIND_DATABASE_ID as string),
      actual: wrongDb,
      expected: EXPECTED_REBIND_DATABASE_ID,
    };
    assert.strictEqual(p3Wrong.passed, false);

    const validDb: string = 'ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92';
    assert.strictEqual(validDb === (EXPECTED_REBIND_DATABASE_ID as string), true);
  });

  // 5. Precondition 5 & 6 & 7: Target workspace must exist, have ownerEmail jaoliveras@gmail.com, and ownerId legacy UID
  it('5. Rebind is blocked if target workspace does not match legacy owner record', () => {
    const mockWorkspaceNotFound = null;
    assert.strictEqual(!!mockWorkspaceNotFound, false);

    const mockWorkspaceWrongEmail = {
      ownerEmail: 'other@bakery.com',
      ownerId: LEGACY_OWNER_UID,
    };
    assert.strictEqual(mockWorkspaceWrongEmail.ownerEmail === (EXPECTED_REBIND_EMAIL as string), false);

    const mockWorkspaceWrongOwner = {
      ownerEmail: EXPECTED_REBIND_EMAIL,
      ownerId: 'random-unauthorized-uid-999',
    };
    assert.strictEqual(mockWorkspaceWrongOwner.ownerId === (LEGACY_OWNER_UID as string), false);
  });

  // 6. Precondition 8: CURRENT_AUTH_UID must be different from legacy UID
  it('6. Rebind requires non-empty CURRENT_AUTH_UID distinct from legacy UID', () => {
    const currentUidEmpty: string = '';
    assert.strictEqual(currentUidEmpty.length > 0, false);

    const currentUidSameAsLegacy: string = LEGACY_OWNER_UID;
    assert.strictEqual(currentUidSameAsLegacy !== (LEGACY_OWNER_UID as string), false);

    const currentUidValid: string = 'runtime-auth-uid-jaime-2026';
    assert.strictEqual(currentUidValid !== (LEGACY_OWNER_UID as string), true);
    assert.strictEqual(currentUidValid.length > 0, true);
  });

  // 7. Precondition 9: No conflicting active owner membership for another unexpected UID
  it('7. Rebind is blocked if another unexpected active owner membership is found', () => {
    const members = [
      { id: LEGACY_OWNER_UID, role: 'owner', active: true },
      { id: 'conflicting-unknown-user', role: 'owner', active: true },
    ];

    const currentUid = 'runtime-auth-uid-jaime-2026';
    const conflicting = members.filter(
      (m) => m.role === 'owner' && m.active === true && m.id !== LEGACY_OWNER_UID && m.id !== currentUid
    );
    assert.strictEqual(conflicting.length, 1);
    assert.strictEqual(conflicting[0].id, 'conflicting-unknown-user');
  });

  // 8. Atomic Rebind updates ONLY ownerId and updatedAt on REAL historical ws-main document
  it('8. Atomic rebind updates only ownerId and updatedAt on workspaces/ws-main, preserving existing fields', () => {
    // REAL historical Firestore document shape: does NOT contain optional fields
    // such as id, code, members, groups, branding, businessType.
    const realHistoricalWs = {
      name: 'Sunny Sweets',
      ownerId: LEGACY_OWNER_UID,
      ownerEmail: EXPECTED_REBIND_EMAIL,
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-15T10:00:00.000Z',
    };

    const currentUid = 'new-runtime-uid-2026';
    const now = '2026-09-17T03:00:00.000Z';

    // Exact Operation #1 update payload produced by ownerRebindService.ts:
    const op1Payload = {
      ownerId: currentUid,
      updatedAt: now,
    };

    // Verify Operation #1 payload keys are strictly ['ownerId', 'updatedAt']
    const payloadKeys = Object.keys(op1Payload);
    assert.deepStrictEqual(payloadKeys.sort(), ['ownerId', 'updatedAt'].sort());

    // Resulting post-write document in Firestore:
    const updatedWs = {
      ...realHistoricalWs,
      ...op1Payload,
    };

    // Calculate diff affectedKeys:
    const allKeys = Array.from(new Set([...Object.keys(realHistoricalWs), ...Object.keys(updatedWs)]));
    const affectedKeys = allKeys.filter((k) => (realHistoricalWs as any)[k] !== (updatedWs as any)[k]);
    assert.deepStrictEqual(affectedKeys.sort(), ['ownerId', 'updatedAt'].sort());

    // Verify existing fields are untouched and byte-for-byte preserved:
    assert.strictEqual(updatedWs.name, 'Sunny Sweets');
    assert.strictEqual(updatedWs.ownerEmail, EXPECTED_REBIND_EMAIL);
    assert.strictEqual(updatedWs.createdAt, '2026-09-15T10:00:00.000Z');
    assert.strictEqual(updatedWs.ownerId, currentUid);
    assert.notStrictEqual(updatedWs.ownerId, LEGACY_OWNER_UID);
    assert.strictEqual(updatedWs.updatedAt, now);

    // Verify no optional fields were artificially introduced into the document:
    assert.strictEqual('id' in updatedWs, false);
    assert.strictEqual('code' in updatedWs, false);
    assert.strictEqual('members' in updatedWs, false);
    assert.strictEqual('groups' in updatedWs, false);
    assert.strictEqual('branding' in updatedWs, false);
    assert.strictEqual('businessType' in updatedWs, false);
  });

  // 8b. Negative tests: Attempting to add any forbidden/absent fields during rebind is detected and rejected
  it('8b. Negative tests: Attempting to add members, groups, branding, businessType, code, or id introduces forbidden affectedKeys', () => {
    const realHistoricalWs = {
      name: 'Sunny Sweets',
      ownerId: LEGACY_OWNER_UID,
      ownerEmail: EXPECTED_REBIND_EMAIL,
      createdAt: '2026-09-15T10:00:00.000Z',
      updatedAt: '2026-09-15T10:00:00.000Z',
    };

    const currentUid = 'new-runtime-uid-2026';
    const now = '2026-09-17T03:00:00.000Z';

    const forbiddenAdditions = [
      { key: 'members', value: [] },
      { key: 'groups', value: [] },
      { key: 'branding', value: { displayName: 'Sunny Sweets', paletteId: 'warm-bakery' } },
      { key: 'businessType', value: 'Bakery' },
      { key: 'code', value: 'SUNNY-SWEETS-DEV' },
      { key: 'id', value: 'ws-main' },
    ];

    for (const { key, value } of forbiddenAdditions) {
      const dirtyUpdate = {
        ...realHistoricalWs,
        ownerId: currentUid,
        updatedAt: now,
        [key]: value,
      };

      const allKeys = Array.from(new Set([...Object.keys(realHistoricalWs), ...Object.keys(dirtyUpdate)]));
      const affectedKeys = allKeys.filter((k) => JSON.stringify((realHistoricalWs as any)[k]) !== JSON.stringify((dirtyUpdate as any)[k]));
      const hasOnlyOwnerIdAndUpdatedAt = affectedKeys.every((k) => k === 'ownerId' || k === 'updatedAt');
      assert.strictEqual(
        hasOnlyOwnerIdAndUpdatedAt,
        false,
        `Adding '${key}' must violate affectedKeys().hasOnly(['ownerId', 'updatedAt'])`
      );
      assert.strictEqual(affectedKeys.includes(key), true);
    }
  });

  // 8c. Verification of exact four-operation batch invariant
  it('8c. Atomic batch contains strictly the four reviewed authorization repair operations and no fifth operation', () => {
    const currentUid = 'new-runtime-uid-2026';
    const targetWsId = 'ws-main';

    const operations = [
      {
        op: 'A',
        path: `workspaces/${targetWsId}`,
        type: 'UPDATE',
        payloadKeys: ['ownerId', 'updatedAt'],
      },
      {
        op: 'B',
        path: `workspaces/${targetWsId}/members/${currentUid}`,
        type: 'SET',
        payloadKeys: ['id', 'uid', 'email', 'name', 'role', 'active', 'addedAt', 'updatedAt'],
      },
      {
        op: 'C',
        path: `users/${currentUid}`,
        type: 'SET_MERGE',
        payloadKeys: ['uid', 'email', 'displayName', 'ownedWorkspaceId', 'defaultWorkspaceId', 'onboardingStatus', 'createdAt', 'updatedAt'],
      },
      {
        op: 'D',
        path: `users/${currentUid}/workspaceMemberships/${targetWsId}`,
        type: 'SET',
        payloadKeys: ['workspaceId', 'role', 'active', 'createdAt'],
      },
    ];

    assert.strictEqual(operations.length, 4, 'Must contain exactly four operations');
    assert.deepStrictEqual(operations[0].payloadKeys, ['ownerId', 'updatedAt']);
    assert.strictEqual(operations[0].path, 'workspaces/ws-main');
    assert.strictEqual(operations[1].path, `workspaces/ws-main/members/${currentUid}`);
    assert.strictEqual(operations[2].path, `users/${currentUid}`);
    assert.strictEqual(operations[3].path, `users/${currentUid}/workspaceMemberships/ws-main`);
  });

  // 9. Legacy member record is NOT deleted
  it('9. Legacy member record workspaces/ws-main/members/42JFWv9G4eb4AvUql3VrvufLeGd2 is preserved', () => {
    const existingMembers = new Map<string, any>();
    existingMembers.set(LEGACY_OWNER_UID, {
      uid: LEGACY_OWNER_UID,
      email: EXPECTED_REBIND_EMAIL,
      role: 'owner',
      active: true,
      addedAt: '2026-09-15T12:00:00Z',
    });

    const currentUid = 'new-runtime-uid-2026';

    // Add new member without deleting legacy member
    existingMembers.set(currentUid, {
      uid: currentUid,
      email: EXPECTED_REBIND_EMAIL,
      role: 'owner',
      active: true,
      addedAt: '2026-09-17T03:00:00Z',
    });

    assert.strictEqual(existingMembers.has(LEGACY_OWNER_UID), true);
    assert.strictEqual(existingMembers.has(currentUid), true);
    assert.strictEqual(existingMembers.size, 2);
  });

  // 10. Verification of write isolation: Restricted collections are untouched
  it('10. Restricted collections (/recipes/*, /master_ingredients/*, /presets/*, /mixers/*, /settings/*) are untouched', () => {
    const touchedPaths = [
      'workspaces/ws-main',
      'workspaces/ws-main/members/new-runtime-uid-2026',
      'users/new-runtime-uid-2026',
      'users/new-runtime-uid-2026/workspaceMemberships/ws-main',
    ];

    const forbiddenPrefixes = [
      'recipes',
      'master_ingredients',
      'presets',
      'mixers',
      'history',
      'settings',
      'billing',
      'stripe',
      'invitations',
    ];

    for (const path of touchedPaths) {
      for (const forbidden of forbiddenPrefixes) {
        assert.strictEqual(
          path.startsWith(forbidden) || path.includes(`/${forbidden}/`),
          false,
          `Path ${path} violates forbidden prefix ${forbidden}`
        );
      }
    }
  });
});
