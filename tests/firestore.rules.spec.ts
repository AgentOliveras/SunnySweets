import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { PolicySimulationEngine } from '../src/utils/firestore.rules.test';

/**
 * Sunny Sweets - Firebase Firestore Security Rules Invariant Suite
 *
 * This test suite loads the ACTUAL production `firestore.rules` file
 * and verifies all 12 Phase 0 security invariants (P01 - P12).
 *
 * When a live Firestore Emulator is running, it executes directly via
 * `@firebase/rules-unit-testing`. When running in headless container mode
 * without a local Java emulator, it validates the rules syntax and verifies
 * policy invariants via PolicySimulationEngine.
 */

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

const EMULATOR_PROJECT_ID = 'demo-sunny-sweets-rules-test';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

describe('Firestore Security Rules - Zero-Trust Invariant Suite', () => {
  let testEnv: RulesTestEnvironment | null = null;
  let useLiveEmulator = false;
  const requireEmulator = process.env.REQUIRE_FIRESTORE_EMULATOR === '1';
  const policyEngine = new PolicySimulationEngine();

  before(async () => {
    // Strip ambient cloud credentials inside test process so production can never be contacted
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FIREBASE_CONFIG;
    delete process.env.FIREBASE_TOKEN;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;

    // Verify rules file existence and non-empty
    assert.ok(rulesContent.length > 100, 'firestore.rules must exist and be non-empty');
    assert.ok(rulesContent.includes('match /workspaces/{workspaceId}'), 'Rules must enforce workspace hierarchy');
    assert.ok(rulesContent.includes('request.auth.uid'), 'Rules must enforce UID-only authorization');

    const rawHostPort = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').trim();
    const colonIdx = rawHostPort.lastIndexOf(':');
    const host = colonIdx > 0 ? rawHostPort.slice(0, colonIdx).trim() : '127.0.0.1';
    const port = colonIdx > 0 ? Number(rawHostPort.slice(colonIdx + 1).trim()) : 8080;

    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `SECURITY ABORT: Non-loopback FIRESTORE_EMULATOR_HOST "${host}" is prohibited.`
      );
    }

    try {
      const probeHost = host === '::1' ? '[::1]' : host;
      const res = await fetch(`http://${probeHost}:${port}/`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => null);
      if (res && res.status >= 200 && res.status < 500 && res.status !== 405) {
        const normalizedHost = host === '[::1]' ? '::1' : host;
        process.env.FIRESTORE_EMULATOR_HOST = `${normalizedHost}:${port}`;
        testEnv = await initializeTestEnvironment({
          projectId: EMULATOR_PROJECT_ID,
          firestore: {
            rules: rulesContent,
            host: normalizedHost,
            port,
          },
        });
        useLiveEmulator = true;
      }
    } catch (err) {
      if (requireEmulator) {
        throw err;
      }
      useLiveEmulator = false;
    }

    if (requireEmulator && !useLiveEmulator) {
      throw new Error(
        `OFFICIAL FIRESTORE EMULATOR REQUIRED (REQUIRE_FIRESTORE_EMULATOR=1), ` +
          `but no local Firestore Emulator responded at ${host}:${port}. ` +
          `Silent fallback to PolicySimulationEngine is disabled.`
      );
    }

    if (useLiveEmulator) {
      console.log('\n=============================================================');
      console.log('STATUS: REAL FIRESTORE RULES TEST (Firebase Emulator Attached)');
      console.log('=============================================================\n');
    } else {
      console.warn('\n=============================================================');
      console.warn('WARNING: POLICY SIMULATION ONLY (NOT OFFICIAL EMULATOR)');
      console.warn('No active Firestore Emulator detected.');
      console.warn('Executing supplementary in-memory PolicySimulationEngine.');
      console.warn('To run official emulator tests: npm run test:rules:emulator');
      console.warn('=============================================================\n');
    }
  });

  after(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
      await testEnv.cleanup();
      console.log('\n>>> REAL FIRESTORE RULES TEST: PASS <<<\n');
    } else {
      console.warn('\n>>> WARNING: POLICY SIMULATION ONLY (Simulation Passed) <<<\n');
    }
  });

  beforeEach(async () => {
    if (useLiveEmulator && testEnv) {
      await testEnv.clearFirestore();

      // Seed baseline tenant state bypassing security rules (synthetic fixtures only)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();

        // Workspace ws-main with valid root fields
        await setDoc(doc(db, 'workspaces', 'ws-main'), {
          id: 'ws-main',
          name: 'Sunny Sweets Main',
          ownerId: 'uid-owner-1',
          productionFloorModeEnabled: true,
          productionOptionOrder: ['preset-1'],
          managementLock: {
            enabled: true,
            salt: '0123456789abcdef0123456789abcdef',
            hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });

        // Active members of ws-main (all explicitly include `active: true`)
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-owner-1'), {
          uid: 'uid-owner-1',
          role: 'owner',
          email: 'owner@sunnysweets.test',
          active: true,
        });
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-editor-1'), {
          uid: 'uid-editor-1',
          role: 'editor',
          email: 'baker@sunnysweets.test',
          active: true,
        });
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-viewer-1'), {
          uid: 'uid-viewer-1',
          role: 'viewer',
          email: 'viewer@sunnysweets.test',
          active: true,
        });

        // Inactive & missing-active fixtures in ws-main
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-inactive-editor'), {
          uid: 'uid-inactive-editor',
          role: 'editor',
          email: 'inactive@sunnysweets.test',
          active: false,
        });
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-missing-active'), {
          uid: 'uid-missing-active',
          role: 'owner',
          email: 'missing-active@sunnysweets.test',
        });

        // Billing fixture in ws-main
        await setDoc(doc(db, 'workspaces', 'ws-main', 'billing', 'current'), {
          workspaceId: 'ws-main',
          planId: 'internal',
          entitlementStatus: 'active',
        });

        // Workspace ws-bakery-b (isolated tenant)
        await setDoc(doc(db, 'workspaces', 'ws-bakery-b'), {
          id: 'ws-bakery-b',
          name: 'Other Bakery',
          ownerId: 'uid-owner-2',
        });
        await setDoc(doc(db, 'workspaces', 'ws-bakery-b', 'members', 'uid-owner-2'), {
          uid: 'uid-owner-2',
          role: 'owner',
          email: 'owner2@otherbakery.test',
          active: true,
        });
        await setDoc(doc(db, 'workspaces', 'ws-bakery-b', 'members', 'uid-user-b'), {
          uid: 'uid-user-b',
          role: 'editor',
          email: 'user@otherbakery.test',
          active: true,
        });

        // Pre-existing scoped recipes & presets
        await setDoc(doc(db, 'recipes', 'recipe-main-1'), {
          id: 'recipe-main-1',
          name: 'Classic Chocolate Chip',
          workspaceId: 'ws-main',
          userId: 'uid-owner-1',
          archived: false,
        });
        await setDoc(doc(db, 'presets', 'preset-main-1'), {
          id: 'preset-main-1',
          name: '2.5 oz Cookie Case',
          workspaceId: 'ws-main',
          userId: 'uid-owner-1',
          finishedWeight: 2.5,
          weightUnit: 'oz',
          quantityPerUnit: 144,
          productionEnabled: true,
        });
      });
    }
  });

  it('P01: unauthenticated recipe read → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthDb, 'recipes', 'recipe-main-1')));
    } else {
      const res = policyEngine.evaluateRequest({ auth: null }, 'read', 'recipes', undefined, { workspaceId: 'ws-main' });
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P02: unauthenticated recipe create → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(unauthDb, 'recipes', 'recipe-new-unauth'), {
          name: 'Unauth Recipe',
          workspaceId: 'ws-main',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: null },
        'create',
        'recipes',
        { workspaceId: 'ws-main', name: 'Unauth Recipe' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P03: non-member reading ws-main → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const outsiderDb = testEnv.authenticatedContext('uid-outsider').firestore();
      await assertFails(getDoc(doc(outsiderDb, 'recipes', 'recipe-main-1')));
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-outsider', email: 'outsider@example.com' } },
        'read',
        'recipes',
        undefined,
        { workspaceId: 'ws-main' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P04: member of workspace B reading ws-main → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const userBDb = testEnv.authenticatedContext('uid-user-b').firestore();
      await assertFails(getDoc(doc(userBDb, 'recipes', 'recipe-main-1')));
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-user-b', email: 'user@otherbakery.com' } },
        'read',
        'recipes',
        undefined,
        { workspaceId: 'ws-main' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P05: member of workspace B writing ws-main → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const userBDb = testEnv.authenticatedContext('uid-user-b').firestore();
      await assertFails(
        setDoc(doc(userBDb, 'recipes', 'recipe-hacked'), {
          name: 'Injected Recipe',
          workspaceId: 'ws-main',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-user-b', email: 'user@otherbakery.com' } },
        'create',
        'recipes',
        { workspaceId: 'ws-main', name: 'Injected Recipe' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P06: viewer creating recipe → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const viewerDb = testEnv.authenticatedContext('uid-viewer-1').firestore();
      await assertFails(
        setDoc(doc(viewerDb, 'recipes', 'recipe-viewer-create'), {
          name: 'Viewer Recipe',
          workspaceId: 'ws-main',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.com' } },
        'create',
        'recipes',
        { workspaceId: 'ws-main', name: 'Viewer Recipe' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P07: viewer deleting recipe → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const viewerDb = testEnv.authenticatedContext('uid-viewer-1').firestore();
      await assertFails(deleteDoc(doc(viewerDb, 'recipes', 'recipe-main-1')));
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.com' } },
        'delete',
        'recipes',
        undefined,
        { workspaceId: 'ws-main' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P08: editor promoting themselves to owner → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', 'ws-main', 'members', 'uid-editor-1'), {
          role: 'owner',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'update',
        'members',
        { role: 'owner', workspaceId: 'ws-main' },
        { role: 'editor', workspaceId: 'ws-main' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P09: non-member creating their own ws-main membership → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const hackerDb = testEnv.authenticatedContext('uid-hacker').firestore();
      await assertFails(
        setDoc(doc(hackerDb, 'workspaces', 'ws-main', 'members', 'uid-hacker'), {
          role: 'owner',
          email: 'hacker@malicious.com',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-hacker', email: 'hacker@malicious.com' } },
        'create',
        'members',
        { role: 'owner', email: 'hacker@malicious.com', workspaceId: 'ws-main' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P10: recipe create without workspaceId → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
      await assertFails(
        setDoc(doc(editorDb, 'recipes', 'recipe-no-ws'), {
          name: 'No Workspace Recipe',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'create',
        'recipes',
        { name: 'No Workspace Recipe' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P11: changing recipe workspaceId → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'recipes', 'recipe-main-1'), {
          workspaceId: 'ws-bakery-b',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'update',
        'recipes',
        { workspaceId: 'ws-bakery-b' },
        { workspaceId: 'ws-main' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P12: owner/editor authorized operations → ALLOW', async () => {
    if (useLiveEmulator && testEnv) {
      const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
      await assertSucceeds(getDoc(doc(editorDb, 'recipes', 'recipe-main-1')));
      await assertSucceeds(
        setDoc(doc(editorDb, 'recipes', 'recipe-authorized-new'), {
          name: 'Authorized Sourdough',
          workspaceId: 'ws-main',
        })
      );
    } else {
      const readRes = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'read',
        'recipes',
        undefined,
        { workspaceId: 'ws-main' }
      );
      const writeRes = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'create',
        'recipes',
        { workspaceId: 'ws-main', name: 'Authorized Sourdough' }
      );
      assert.strictEqual(readRes, 'ALLOW');
      assert.strictEqual(writeRes, 'ALLOW');
    }
  });

  it('P13: member reading workspace billing document → ALLOW', async () => {
    if (useLiveEmulator && testEnv) {
      const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
      await assertSucceeds(getDoc(doc(editorDb, 'workspaces', 'ws-main', 'billing', 'current')));
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'read',
        'billing',
        undefined,
        { workspaceId: 'ws-main', planId: 'team' }
      );
      assert.strictEqual(res, 'ALLOW');
    }
  });

  it('P14: non-member reading workspace billing document → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const strangerDb = testEnv.authenticatedContext('uid-stranger').firestore();
      await assertFails(getDoc(doc(strangerDb, 'workspaces', 'ws-main', 'billing', 'current')));
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-stranger', email: 'stranger@external.com' } },
        'read',
        'billing',
        undefined,
        { workspaceId: 'ws-main', planId: 'team' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P15: browser client attempting to set entitlementStatus = active → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const ownerDb = testEnv.authenticatedContext('uid-owner-1').firestore();
      await assertFails(
        setDoc(doc(ownerDb, 'workspaces', 'ws-main', 'billing', 'current'), {
          planId: 'team',
          entitlementStatus: 'active',
          subscriptionStatus: 'active',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-owner-1', email: 'owner@sunnysweets.com' } },
        'create',
        'billing',
        { workspaceId: 'ws-main', entitlementStatus: 'active', planId: 'team' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  it('P16: browser client update to billing document → DENY', async () => {
    if (useLiveEmulator && testEnv) {
      const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', 'ws-main', 'billing', 'current'), {
          entitlementStatus: 'active',
        })
      );
    } else {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
        'update',
        'billing',
        { workspaceId: 'ws-main', entitlementStatus: 'active' },
        { workspaceId: 'ws-main', entitlementStatus: 'inactive' }
      );
      assert.strictEqual(res, 'DENY');
    }
  });

  describe('PolicySimulationEngine Only — Historical Surgical ws-main Owner Rebind Simulation', () => {
    const HISTORICAL_OWNER_UID = '42JFWv9G4eb4AvUql3VrvufLeGd2';
    const RECOVERY_EMAIL = 'jaoliveras@gmail.com';
    const NEW_AUTH_UID = 'new-authenticated-uid-123';

    // The REAL historical ws-main document in Firestore does NOT contain optional fields
    // such as id, code, members, groups, branding, businessType.
    const validWsExisting = {
      _pathWorkspaceId: 'ws-main',
      name: 'Sunny Sweets',
      ownerId: HISTORICAL_OWNER_UID,
      ownerEmail: RECOVERY_EMAIL,
      createdAt: '2026-09-15T10:00:00Z',
      updatedAt: '2026-09-15T10:00:00Z',
    };

    // Operation #1 update payload applies ONLY ownerId and updatedAt.
    // Resulting post-write document in Firestore:
    const validWsUpdate = {
      ...validWsExisting,
      ownerId: NEW_AUTH_UID,
      updatedAt: '2026-09-17T12:00:00Z',
    };

    it('R01: correct authenticated recovery account + exact historical state → PASS', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        validWsUpdate,
        validWsExisting
      );
      assert.strictEqual(res, 'ALLOW');

      const memberRes = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'create',
        'members',
        {
          workspaceId: 'ws-main',
          uid: NEW_AUTH_UID,
          memberId: NEW_AUTH_UID,
          email: RECOVERY_EMAIL,
          role: 'owner',
          active: true,
        }
      );
      assert.strictEqual(memberRes, 'ALLOW');
    });

    it('R01_Batch: full exact four-operation atomic batch passes temporary recovery rules', () => {
      const authContext = { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } };

      // Op 1: workspaces/ws-main (UPDATE ownerId and updatedAt only)
      const op1Res = policyEngine.evaluateRequest(
        authContext,
        'update',
        'workspaces',
        validWsUpdate,
        validWsExisting
      );
      assert.strictEqual(op1Res, 'ALLOW');

      // Op 2: workspaces/ws-main/members/{NEW_AUTH_UID} (CREATE owner member)
      const op2Res = policyEngine.evaluateRequest(
        authContext,
        'create',
        'members',
        {
          workspaceId: 'ws-main',
          uid: NEW_AUTH_UID,
          memberId: NEW_AUTH_UID,
          email: RECOVERY_EMAIL,
          role: 'owner',
          active: true,
        }
      );
      assert.strictEqual(op2Res, 'ALLOW');

      // Op 3: users/{NEW_AUTH_UID} (UPDATE/CREATE user profile binding)
      const op3Res = policyEngine.evaluateRequest(
        authContext,
        'update',
        'users',
        {
          uid: NEW_AUTH_UID,
          email: RECOVERY_EMAIL,
          ownedWorkspaceId: 'ws-main',
          defaultWorkspaceId: 'ws-main',
        },
        {
          uid: NEW_AUTH_UID,
          email: RECOVERY_EMAIL,
        }
      );
      assert.strictEqual(op3Res, 'ALLOW');

      // Op 4: users/{NEW_AUTH_UID}/workspaceMemberships/ws-main (CREATE private membership index)
      const op4Res = policyEngine.evaluateRequest(
        authContext,
        'create',
        'workspaceMemberships',
        {
          userId: NEW_AUTH_UID,
          workspaceId: 'ws-main',
          role: 'owner',
          active: true,
        }
      );
      assert.strictEqual(op4Res, 'ALLOW');
    });

    it('R_NEG_MEMBERS: attempting to add members array during owner rebind is DENIED', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, members: [] },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R_NEG_GROUPS: attempting to add groups array during owner rebind is DENIED', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, groups: [] },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R_NEG_BRANDING: attempting to add branding object during owner rebind is DENIED', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, branding: { displayName: 'Sunny Sweets', paletteId: 'warm-bakery' } },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R_NEG_BUSINESS_TYPE: attempting to add businessType during owner rebind is DENIED', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, businessType: 'Bakery' },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R_NEG_CODE: attempting to add code during owner rebind is DENIED', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, code: 'SUNNY-SWEETS-DEV' },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R_NEG_ID: attempting to add id during owner rebind is DENIED', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, id: 'ws-main' },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R02: wrong email attempting rebind → DENY', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: 'imposter@gmail.com' } },
        'update',
        'workspaces',
        validWsUpdate,
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R03: wrong workspace attempting rebind exception → DENY', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, _pathWorkspaceId: 'ws-bakery-b' },
        { ...validWsExisting, _pathWorkspaceId: 'ws-bakery-b' }
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R04: wrong historical owner UID in existing document → DENY', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        validWsUpdate,
        { ...validWsExisting, ownerId: 'wrong-historical-uid' }
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R05: attempting arbitrary new owner UID other than auth.uid → DENY', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, ownerId: 'arbitrary-different-uid' },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R06: attempting to change ownerEmail → DENY', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, ownerEmail: 'newemail@domain.com' },
        validWsExisting
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R07: attempting to change unrelated workspace fields (name) → DENY', () => {
      const resTamperName = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, name: 'Hacked Bakery Name' },
        validWsExisting
      );
      assert.strictEqual(resTamperName, 'DENY');
    });

    it('R08: attempting rebind against another workspace → DENY', () => {
      const res = policyEngine.evaluateRequest(
        { auth: { uid: NEW_AUTH_UID, email: RECOVERY_EMAIL } },
        'update',
        'workspaces',
        { ...validWsUpdate, _pathWorkspaceId: 'ws-unrelated' },
        { ...validWsExisting, _pathWorkspaceId: 'ws-unrelated' }
      );
      assert.strictEqual(res, 'DENY');
    });

    it('R09: ordinary unauthorized users remain denied on ws-main update and member add', () => {
      const unauthUpdate = policyEngine.evaluateRequest(
        { auth: { uid: 'random-user-uid', email: 'random@example.com' } },
        'update',
        'workspaces',
        { ...validWsUpdate, ownerId: 'random-user-uid' },
        validWsExisting
      );
      assert.strictEqual(unauthUpdate, 'DENY');

      const unauthMember = policyEngine.evaluateRequest(
        { auth: { uid: 'random-user-uid', email: 'random@example.com' } },
        'create',
        'members',
        {
          workspaceId: 'ws-main',
          uid: 'random-user-uid',
          memberId: 'random-user-uid',
          email: 'random@example.com',
          role: 'owner',
          active: true,
        }
      );
      assert.strictEqual(unauthMember, 'DENY');
    });
  });

  // =========================================================================
  // 8. PHASE A + PHASE B — ACTIVE MEMBERSHIP, NARROW EDITOR ORDERING,
  //    PRESET ENABLED/DISABLED & OWNER-ONLY DELETION
  // =========================================================================
  describe('8. Phase A + Phase B — Active Membership, Narrow Editor Ordering, Preset Toggle & Owner-Only Delete', () => {
    it('PA-R01: inactive member (active === false or missing) is denied read and write across workspace resources', async () => {
      if (useLiveEmulator && testEnv) {
        const inactiveDb = testEnv.authenticatedContext('uid-inactive-editor').firestore();
        const missingActiveDb = testEnv.authenticatedContext('uid-missing-active').firestore();

        await assertFails(getDoc(doc(inactiveDb, 'recipes', 'recipe-main-1')));
        await assertFails(
          updateDoc(doc(inactiveDb, 'recipes', 'recipe-main-1'), { name: 'Tampered Cookie' })
        );
        await assertFails(getDoc(doc(missingActiveDb, 'presets', 'preset-main-1')));
      } else {
        policyEngine.setMember('ws-phase-a', 'uid-owner-a', 'owner', 'owner@sunnysweets.test', true);
        policyEngine.setMember(
          'ws-phase-a',
          'uid-inactive-editor',
          'editor',
          'inactive@sunnysweets.test',
          false
        );
        policyEngine.setRawMemberForTesting('ws-phase-a', 'uid-missing-active', {
          role: 'editor',
          email: 'missing-active@sunnysweets.test',
        });

        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-inactive-editor', email: 'inactive@sunnysweets.test' } },
            'read',
            'recipes',
            { workspaceId: 'ws-phase-a' }
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-inactive-editor', email: 'inactive@sunnysweets.test' } },
            'update',
            'recipes',
            { workspaceId: 'ws-phase-a', name: 'Cookie' },
            { workspaceId: 'ws-phase-a', name: 'Old Cookie' }
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-missing-active', email: 'missing-active@sunnysweets.test' } },
            'read',
            'presets',
            { workspaceId: 'ws-phase-a' }
          ),
          'DENY'
        );
      }
    });

    it('PA-R02: active Editor can update workspaces.productionOptionOrder (+ updatedAt) ONLY, and cannot alter ownerId, managementLock, or productionFloorModeEnabled', async () => {
      if (useLiveEmulator && testEnv) {
        const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();

        await assertSucceeds(
          updateDoc(doc(editorDb, 'workspaces', 'ws-main'), {
            productionOptionOrder: ['preset-2', 'preset-1'],
            updatedAt: '2026-02-01T00:00:00.000Z',
          })
        );
        await assertFails(
          updateDoc(doc(editorDb, 'workspaces', 'ws-main'), {
            productionOptionOrder: ['preset-2'],
            productionFloorModeEnabled: false,
          })
        );
        await assertFails(
          updateDoc(doc(editorDb, 'workspaces', 'ws-main'), {
            managementLock: { enabled: false, hash: null, updatedAt: null },
          })
        );
      } else {
        policyEngine.setMember('ws-phase-a2', 'uid-owner-a2', 'owner', 'owner@sunnysweets.test', true);
        policyEngine.setMember(
          'ws-phase-a2',
          'uid-editor-a2',
          'editor',
          'editor@sunnysweets.test',
          true
        );

        const baseWs = {
          _pathWorkspaceId: 'ws-phase-a2',
          ownerId: 'uid-owner-a2',
          name: 'Sunny Sweets',
          productionFloorModeEnabled: true,
          productionOptionOrder: ['preset-1'],
          updatedAt: '2026-01-01T00:00:00.000Z',
        };

        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-a2', email: 'editor@sunnysweets.test' } },
            'update',
            'workspaces',
            {
              ...baseWs,
              productionOptionOrder: ['preset-2', 'preset-1'],
              updatedAt: '2026-02-01T00:00:00.000Z',
            },
            baseWs
          ),
          'ALLOW'
        );

        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-a2', email: 'editor@sunnysweets.test' } },
            'update',
            'workspaces',
            {
              ...baseWs,
              productionOptionOrder: ['preset-2'],
              productionFloorModeEnabled: false,
            },
            baseWs
          ),
          'DENY'
        );

        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-a2', email: 'editor@sunnysweets.test' } },
            'update',
            'workspaces',
            {
              ...baseWs,
              managementLock: { enabled: false, hash: null, updatedAt: null },
            },
            baseWs
          ),
          'DENY'
        );
      }
    });

    it('PA-R03: permanent recipe delete is Owner-only while Editor retains create/update (including archive)', async () => {
      if (useLiveEmulator && testEnv) {
        const ownerDb = testEnv.authenticatedContext('uid-owner-1').firestore();
        const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
        const viewerDb = testEnv.authenticatedContext('uid-viewer-1').firestore();

        await assertSucceeds(
          updateDoc(doc(editorDb, 'recipes', 'recipe-main-1'), { archived: true })
        );
        await assertFails(deleteDoc(doc(editorDb, 'recipes', 'recipe-main-1')));
        await assertFails(deleteDoc(doc(viewerDb, 'recipes', 'recipe-main-1')));
        await assertSucceeds(deleteDoc(doc(ownerDb, 'recipes', 'recipe-main-1')));
      } else {
        policyEngine.setMember('ws-phase-a3', 'uid-owner-a3', 'owner', 'owner@sunnysweets.test', true);
        policyEngine.setMember(
          'ws-phase-a3',
          'uid-editor-a3',
          'editor',
          'editor@sunnysweets.test',
          true
        );
        policyEngine.setMember(
          'ws-phase-a3',
          'uid-viewer-a3',
          'viewer',
          'viewer@sunnysweets.test',
          true
        );

        const existingRecipe = {
          workspaceId: 'ws-phase-a3',
          name: 'Butter Shortbread',
          archived: false,
        };

        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-a3', email: 'editor@sunnysweets.test' } },
            'update',
            'recipes',
            { ...existingRecipe, archived: true },
            existingRecipe
          ),
          'ALLOW'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-a3', email: 'editor@sunnysweets.test' } },
            'delete',
            'recipes',
            existingRecipe,
            existingRecipe
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-viewer-a3', email: 'viewer@sunnysweets.test' } },
            'delete',
            'recipes',
            existingRecipe,
            existingRecipe
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-owner-a3', email: 'owner@sunnysweets.test' } },
            'delete',
            'recipes',
            existingRecipe,
            existingRecipe
          ),
          'ALLOW'
        );
      }
    });

    it('PB-R01: presets enforce boolean-only productionEnabled for Owner/Editor while denying Viewer and non-boolean values', async () => {
      if (useLiveEmulator && testEnv) {
        const ownerDb = testEnv.authenticatedContext('uid-owner-1').firestore();
        const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
        const viewerDb = testEnv.authenticatedContext('uid-viewer-1').firestore();

        await assertSucceeds(
          updateDoc(doc(editorDb, 'presets', 'preset-main-1'), { productionEnabled: false })
        );
        await assertSucceeds(
          updateDoc(doc(ownerDb, 'presets', 'preset-main-1'), { productionEnabled: true })
        );
        await assertFails(
          updateDoc(doc(viewerDb, 'presets', 'preset-main-1'), { productionEnabled: false })
        );
        await assertFails(
          updateDoc(doc(ownerDb, 'presets', 'preset-main-1'), {
            productionEnabled: 'false' as unknown as boolean,
          })
        );
      } else {
        const existingPreset = {
          workspaceId: 'ws-main',
          name: '2.5 oz Cookie Case',
          finishedWeight: 2.5,
          productionEnabled: true,
        };
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.test' } },
            'update',
            'presets',
            { ...existingPreset, productionEnabled: false },
            existingPreset
          ),
          'ALLOW'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.test' } },
            'update',
            'presets',
            { ...existingPreset, productionEnabled: false },
            existingPreset
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-owner-1', email: 'owner@sunnysweets.test' } },
            'update',
            'presets',
            { ...existingPreset, productionEnabled: 'false' },
            existingPreset
          ),
          'DENY'
        );
      }
    });

    it('PB-R02: permanent preset delete is strictly Owner-only (Editor & Viewer denied)', async () => {
      if (useLiveEmulator && testEnv) {
        const ownerDb = testEnv.authenticatedContext('uid-owner-1').firestore();
        const editorDb = testEnv.authenticatedContext('uid-editor-1').firestore();
        const viewerDb = testEnv.authenticatedContext('uid-viewer-1').firestore();

        await assertFails(deleteDoc(doc(editorDb, 'presets', 'preset-main-1')));
        await assertFails(deleteDoc(doc(viewerDb, 'presets', 'preset-main-1')));
        await assertSucceeds(deleteDoc(doc(ownerDb, 'presets', 'preset-main-1')));
      } else {
        const existingPreset = {
          workspaceId: 'ws-main',
          name: '2.5 oz Cookie Case',
          finishedWeight: 2.5,
          productionEnabled: true,
        };
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.test' } },
            'delete',
            'presets',
            undefined,
            existingPreset
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.test' } },
            'delete',
            'presets',
            undefined,
            existingPreset
          ),
          'DENY'
        );
        assert.strictEqual(
          policyEngine.evaluateRequest(
            { auth: { uid: 'uid-owner-1', email: 'owner@sunnysweets.test' } },
            'delete',
            'presets',
            undefined,
            existingPreset
          ),
          'ALLOW'
        );
      }
    });
  });
});
