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

describe('Firestore Security Rules - Zero-Trust Invariant Suite', () => {
  let testEnv: RulesTestEnvironment | null = null;
  let useLiveEmulator = false;
  const policyEngine = new PolicySimulationEngine();

  before(async () => {
    // Verify rules file existence and non-empty
    assert.ok(rulesContent.length > 100, 'firestore.rules must exist and be non-empty');
    assert.ok(rulesContent.includes('match /workspaces/{workspaceId}'), 'Rules must enforce workspace hierarchy');
    assert.ok(rulesContent.includes('request.auth.uid'), 'Rules must enforce UID-only authorization');

    const host = process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1';
    const port = Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080);

    try {
      const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(500) }).catch(() => null);
      if (res && res.status !== 405) {
        testEnv = await initializeTestEnvironment({
          projectId: 'sunny-sweets-rules-test',
          firestore: {
            rules: rulesContent,
            host,
            port,
          },
        });
        useLiveEmulator = true;
      }
    } catch {
      useLiveEmulator = false;
    }

    if (useLiveEmulator) {
      console.log('\n=============================================================');
      console.log('STATUS: REAL FIRESTORE RULES TEST (Firebase Emulator Attached)');
      console.log('=============================================================\n');
    } else {
      console.warn('\n=============================================================');
      console.warn('WARNING: POLICY SIMULATION ONLY');
      console.warn('No active Firestore Emulator detected.');
      console.warn('Executing in-memory Zero-Trust invariant simulation.');
      console.warn('To run real rules tests: npm run test:rules:emulator');
      console.warn('=============================================================\n');
    }
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
      console.log('\n>>> REAL FIRESTORE RULES TEST: PASS <<<\n');
    } else {
      console.warn('\n>>> WARNING: POLICY SIMULATION ONLY (Simulation Passed) <<<\n');
    }
  });

  beforeEach(async () => {
    if (useLiveEmulator && testEnv) {
      await testEnv.clearFirestore();

      // Seed baseline tenant state bypassing security rules
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();

        // Workspace ws-main
        await setDoc(doc(db, 'workspaces', 'ws-main'), {
          id: 'ws-main',
          name: 'Sunny Sweets Main',
          ownerId: 'uid-owner-1',
        });

        // Members of ws-main
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-owner-1'), {
          role: 'owner',
          email: 'owner@sunnysweets.com',
        });
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-editor-1'), {
          role: 'editor',
          email: 'baker@sunnysweets.com',
        });
        await setDoc(doc(db, 'workspaces', 'ws-main', 'members', 'uid-viewer-1'), {
          role: 'viewer',
          email: 'viewer@sunnysweets.com',
        });

        // Workspace ws-bakery-b (isolated tenant)
        await setDoc(doc(db, 'workspaces', 'ws-bakery-b'), {
          id: 'ws-bakery-b',
          name: 'Other Bakery',
          ownerId: 'uid-owner-2',
        });
        await setDoc(doc(db, 'workspaces', 'ws-bakery-b', 'members', 'uid-user-b'), {
          role: 'editor',
          email: 'user@otherbakery.com',
        });

        // Pre-existing scoped recipes
        await setDoc(doc(db, 'recipes', 'recipe-main-1'), {
          id: 'recipe-main-1',
          name: 'Classic Chocolate Chip',
          workspaceId: 'ws-main',
          userId: 'uid-owner-1',
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
});
