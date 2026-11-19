import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
} from 'firebase/firestore';

/**
 * Sunny Sweets Recipe Calculator — Official Firebase Firestore Rules Emulator Suite
 * (Phase A + Phase B Pre-Deployment Security Gate)
 *
 * STRICT ISOLATION & FAIL-CLOSED GUARANTEES:
 * 1. Evaluates the ACTUAL local `/firestore.rules` file inside the official
 *    Firebase Firestore Rules Emulator via `@firebase/rules-unit-testing`.
 * 2. ZERO `PolicySimulationEngine` imports and ZERO silent simulation fallback.
 * 3. Fails closed with a nonzero exit code if Java or the local Firestore Emulator
 *    is unavailable or unreachable.
 * 4. Strictly isolated offline `demo-*` project ID (`demo-sunny-sweets-rules-test`)
 *    and loopback-only host enforcement (`127.0.0.1`, `localhost`, `::1`).
 * 5. Strips ambient cloud/admin environment variables in-process so this runner can
 *    NEVER contact production project `imposing-router-d3bk6` or named database
 *    `ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92`.
 * 6. Uses synthetic test UIDs and `@*.test` addresses only — never real user UIDs.
 */

const EMULATOR_PROJECT_ID = 'demo-sunny-sweets-rules-test';
const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// Synthetic test-only identities (NEVER real Owner or Samsung tablet UIDs)
const UID_OWNER_1 = 'uid-owner-1';
const UID_EDITOR_1 = 'uid-editor-1';
const UID_VIEWER_1 = 'uid-viewer-1';
const UID_INACTIVE_EDITOR = 'uid-inactive-editor';
const UID_MISSING_ACTIVE_MEMBER = 'uid-missing-active-owner';
const UID_STRING_ACTIVE_MEMBER = 'uid-string-active-editor';
const UID_NULL_ACTIVE_MEMBER = 'uid-null-active-editor';
const UID_REVOKED_OWNER = 'uid-revoked-owner';
const UID_MALFORMED_OWNER = 'uid-malformed-owner';
const UID_OWNER_2 = 'uid-owner-2';
const UID_USER_B = 'uid-user-b';
const UID_OUTSIDER = 'uid-outsider';

const WS_MAIN = 'ws-main';
const WS_BAKERY_B = 'ws-bakery-b';
const WS_REVOKED_OWNER = 'ws-revoked-owner';
const WS_MALFORMED_OWNER = 'ws-malformed-owner';
const WS_NO_PRIOR_ORDER = 'ws-no-prior-order';

function enforceProductionIsolationAndResolveEmulatorEndpoint(): { host: string; port: number } {
  // Strip any ambient cloud credentials inside this test process
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_CONFIG;
  delete process.env.FIREBASE_TOKEN;
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;

  assert.ok(
    EMULATOR_PROJECT_ID.startsWith('demo-'),
    'Emulator project ID must use the offline demo-* namespace'
  );
  assert.notEqual(
    EMULATOR_PROJECT_ID,
    'imposing-router-d3bk6',
    'Emulator test runner must NEVER target the production project ID'
  );

  const rawHostPort = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').trim();
  const lastColon = rawHostPort.lastIndexOf(':');
  if (lastColon <= 0) {
    throw new Error(
      `Invalid FIRESTORE_EMULATOR_HOST "${rawHostPort}". Expected loopback <host>:<port> (e.g. 127.0.0.1:8080).`
    );
  }

  const host = rawHostPort.slice(0, lastColon).trim();
  const port = Number(rawHostPort.slice(lastColon + 1).trim());

  if (!ALLOWED_LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `SECURITY ABORT: Refusing non-loopback Firestore host "${host}". Official rules tests may connect ONLY to a local emulator.`
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Firestore emulator port in "${rawHostPort}".`);
  }

  const normalizedHost = host === '[::1]' ? '::1' : host;
  process.env.FIRESTORE_EMULATOR_HOST = `${normalizedHost}:${port}`;
  return { host: normalizedHost, port };
}

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

describe('Official Firebase Firestore Rules Emulator Suite (Phase A + Phase B)', () => {
  let testEnv!: RulesTestEnvironment;

  before(async () => {
    assert.ok(rulesContent.length > 100, 'firestore.rules must exist and be non-empty');
    const { host, port } = enforceProductionIsolationAndResolveEmulatorEndpoint();
    const probeHost = host === '::1' ? '[::1]' : host;
    const probeUrl = `http://${probeHost}:${port}/`;

    let reachable = false;
    try {
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(1500) });
      reachable = Boolean(res && res.status >= 200 && res.status < 500 && res.status !== 405);
    } catch {
      reachable = false;
    }

    if (!reachable) {
      throw new Error(
        `OFFICIAL FIRESTORE EMULATOR UNAVAILABLE at ${probeUrl}. ` +
          `Silent fallback to PolicySimulationEngine is strictly disabled. ` +
          `Install Java 17+ and run: npm run test:rules:emulator`
      );
    }

    testEnv = await initializeTestEnvironment({
      projectId: EMULATOR_PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host,
        port,
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();

      // 1. Primary workspace fixture (`ws-main`) with valid root fields
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN), {
        id: WS_MAIN,
        name: 'Sunny Sweets Main',
        ownerId: UID_OWNER_1,
        code: 'SUNNY-TEST',
        productionFloorModeEnabled: true,
        productionOptionOrder: ['preset-1oz', 'preset-2oz', 'preset-3oz'],
        managementLock: {
          enabled: true,
          salt: '0123456789abcdef0123456789abcdef',
          hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      // Active members of `ws-main` (all explicitly have `active: true`)
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_OWNER_1), {
        uid: UID_OWNER_1,
        role: 'owner',
        email: 'owner@sunnysweets.test',
        active: true,
      });
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_EDITOR_1), {
        uid: UID_EDITOR_1,
        role: 'editor',
        email: 'editor@sunnysweets.test',
        active: true,
      });
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_VIEWER_1), {
        uid: UID_VIEWER_1,
        role: 'viewer',
        email: 'viewer@sunnysweets.test',
        active: true,
      });

      // Explicit inactive & malformed member fixtures in `ws-main`
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_INACTIVE_EDITOR), {
        uid: UID_INACTIVE_EDITOR,
        role: 'editor',
        email: 'inactive-editor@sunnysweets.test',
        active: false,
      });
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_MISSING_ACTIVE_MEMBER), {
        uid: UID_MISSING_ACTIVE_MEMBER,
        role: 'owner',
        email: 'missing-active@sunnysweets.test',
        // `active` intentionally omitted
      });
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_STRING_ACTIVE_MEMBER), {
        uid: UID_STRING_ACTIVE_MEMBER,
        role: 'editor',
        email: 'string-active@sunnysweets.test',
        active: 'true',
      });
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'members', UID_NULL_ACTIVE_MEMBER), {
        uid: UID_NULL_ACTIVE_MEMBER,
        role: 'editor',
        email: 'null-active@sunnysweets.test',
        active: null,
      });

      // Billing document in `ws-main`
      await setDoc(doc(adminDb, 'workspaces', WS_MAIN, 'billing', 'current'), {
        workspaceId: WS_MAIN,
        planId: 'internal',
        subscriptionStatus: 'internal',
        entitlementStatus: 'active',
      });

      // Operational collections in `ws-main`
      await setDoc(doc(adminDb, 'recipes', 'recipe-main-1'), {
        id: 'recipe-main-1',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        name: 'Four Seasons Chocolate Chip Cookies (Test Fixture)',
        batchYieldQuantity: 100,
        batchYieldUnit: 'cookies',
        defaultWastePercent: 6,
        archived: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      await setDoc(doc(adminDb, 'presets', 'preset-enabled-1'), {
        id: 'preset-enabled-1',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        name: '2.5 oz Cookie Case',
        category: 'Cookies',
        finishedWeight: 2.5,
        weightUnit: 'oz',
        quantityPerUnit: 144,
        unitName: 'Case',
        productionEnabled: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      await setDoc(doc(adminDb, 'presets', 'preset-disabled-1'), {
        id: 'preset-disabled-1',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        name: '4 oz Seasonal Cookie Case',
        category: 'Cookies',
        finishedWeight: 4,
        weightUnit: 'oz',
        quantityPerUnit: 80,
        unitName: 'Case',
        productionEnabled: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      await setDoc(doc(adminDb, 'presets', 'preset-legacy-no-flag'), {
        id: 'preset-legacy-no-flag',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        name: 'Legacy 2 oz Cookie Case',
        category: 'Cookies',
        finishedWeight: 2,
        weightUnit: 'oz',
        quantityPerUnit: 140,
        unitName: 'Case',
        // `productionEnabled` intentionally omitted
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      await setDoc(doc(adminDb, 'mixers', 'mixer-main-1'), {
        id: 'mixer-main-1',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        name: 'Hobart 80-Qt',
        maxWeight: 100,
        weightUnit: 'lb',
      });

      await setDoc(doc(adminDb, 'history', 'history-main-1'), {
        id: 'history-main-1',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        recipeId: 'recipe-main-1',
        recipeName: 'Four Seasons Chocolate Chip Cookies (Test Fixture)',
        calculatedAt: '2026-01-01T00:00:00.000Z',
      });

      await setDoc(doc(adminDb, 'master_ingredients', 'ing-main-1'), {
        id: 'ing-main-1',
        workspaceId: WS_MAIN,
        userId: UID_OWNER_1,
        name: 'All-Purpose Flour',
      });

      await setDoc(doc(adminDb, 'product_projects', 'proj-main-1'), {
        id: 'proj-main-1',
        workspaceId: WS_MAIN,
        name: 'Holiday Tin R&D Quote',
      });

      // 2. Workspace without prior `productionOptionOrder` field (first-time Editor save check)
      await setDoc(doc(adminDb, 'workspaces', WS_NO_PRIOR_ORDER), {
        id: WS_NO_PRIOR_ORDER,
        name: 'Fresh Bakery Workspace',
        ownerId: UID_OWNER_1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(adminDb, 'workspaces', WS_NO_PRIOR_ORDER, 'members', UID_EDITOR_1), {
        uid: UID_EDITOR_1,
        role: 'editor',
        email: 'editor@sunnysweets.test',
        active: true,
      });

      // 3. Explicitly revoked Owner workspace (`ownerId == UID_REVOKED_OWNER`, `active: false`)
      await setDoc(doc(adminDb, 'workspaces', WS_REVOKED_OWNER), {
        id: WS_REVOKED_OWNER,
        name: 'Revoked Owner Workspace',
        ownerId: UID_REVOKED_OWNER,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(adminDb, 'workspaces', WS_REVOKED_OWNER, 'members', UID_REVOKED_OWNER), {
        uid: UID_REVOKED_OWNER,
        role: 'owner',
        email: 'revoked-owner@sunnysweets.test',
        active: false,
      });
      await setDoc(doc(adminDb, 'recipes', 'recipe-revoked-ws'), {
        id: 'recipe-revoked-ws',
        workspaceId: WS_REVOKED_OWNER,
        name: 'Revoked Workspace Recipe',
      });
      await setDoc(doc(adminDb, 'presets', 'preset-revoked-ws'), {
        id: 'preset-revoked-ws',
        workspaceId: WS_REVOKED_OWNER,
        name: 'Revoked Workspace Preset',
        finishedWeight: 2,
        weightUnit: 'oz',
        quantityPerUnit: 140,
      });

      // 4. Malformed Owner workspace (`ownerId == UID_MALFORMED_OWNER`, `active` field absent)
      await setDoc(doc(adminDb, 'workspaces', WS_MALFORMED_OWNER), {
        id: WS_MALFORMED_OWNER,
        name: 'Malformed Owner Workspace',
        ownerId: UID_MALFORMED_OWNER,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(adminDb, 'workspaces', WS_MALFORMED_OWNER, 'members', UID_MALFORMED_OWNER), {
        uid: UID_MALFORMED_OWNER,
        role: 'owner',
        email: 'malformed-owner@sunnysweets.test',
        // `active` intentionally omitted to verify no ownerId fallback bypass
      });
      await setDoc(doc(adminDb, 'presets', 'preset-malformed-ws'), {
        id: 'preset-malformed-ws',
        workspaceId: WS_MALFORMED_OWNER,
        name: 'Malformed Workspace Preset',
        finishedWeight: 2,
        weightUnit: 'oz',
        quantityPerUnit: 140,
      });

      // 5. Isolated second tenant (`ws-bakery-b`)
      await setDoc(doc(adminDb, 'workspaces', WS_BAKERY_B), {
        id: WS_BAKERY_B,
        name: 'Other Bakery Tenant',
        ownerId: UID_OWNER_2,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      await setDoc(doc(adminDb, 'workspaces', WS_BAKERY_B, 'members', UID_OWNER_2), {
        uid: UID_OWNER_2,
        role: 'owner',
        email: 'owner2@otherbakery.test',
        active: true,
      });
      await setDoc(doc(adminDb, 'workspaces', WS_BAKERY_B, 'members', UID_USER_B), {
        uid: UID_USER_B,
        role: 'editor',
        email: 'baker@otherbakery.test',
        active: true,
      });
    });
  });

  // ===========================================================================
  // GROUP A — WORKSPACE ACCESS AND MEMBERSHIP
  // ===========================================================================
  describe('A. Workspace Access and Active Membership', () => {
    it('EM-A01: Active Owner can read workspace, operational collections, members, billing, and product_projects', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      await assertSucceeds(getDoc(doc(ownerDb, 'workspaces', WS_MAIN)));
      await assertSucceeds(getDoc(doc(ownerDb, 'recipes', 'recipe-main-1')));
      await assertSucceeds(getDoc(doc(ownerDb, 'presets', 'preset-enabled-1')));
      await assertSucceeds(getDoc(doc(ownerDb, 'mixers', 'mixer-main-1')));
      await assertSucceeds(getDoc(doc(ownerDb, 'history', 'history-main-1')));
      await assertSucceeds(getDoc(doc(ownerDb, 'master_ingredients', 'ing-main-1')));
      await assertSucceeds(getDoc(doc(ownerDb, 'product_projects', 'proj-main-1')));
      await assertSucceeds(getDoc(doc(ownerDb, 'workspaces', WS_MAIN, 'members', UID_EDITOR_1)));
      await assertSucceeds(getDoc(doc(ownerDb, 'workspaces', WS_MAIN, 'billing', 'current')));
    });

    it('EM-A02: Active Editor can read workspace, operational collections, members, billing, and product_projects', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertSucceeds(getDoc(doc(editorDb, 'workspaces', WS_MAIN)));
      await assertSucceeds(getDoc(doc(editorDb, 'recipes', 'recipe-main-1')));
      await assertSucceeds(getDoc(doc(editorDb, 'presets', 'preset-enabled-1')));
      await assertSucceeds(getDoc(doc(editorDb, 'mixers', 'mixer-main-1')));
      await assertSucceeds(getDoc(doc(editorDb, 'history', 'history-main-1')));
      await assertSucceeds(getDoc(doc(editorDb, 'master_ingredients', 'ing-main-1')));
      await assertSucceeds(getDoc(doc(editorDb, 'product_projects', 'proj-main-1')));
      await assertSucceeds(getDoc(doc(editorDb, 'workspaces', WS_MAIN, 'members', UID_OWNER_1)));
      await assertSucceeds(getDoc(doc(editorDb, 'workspaces', WS_MAIN, 'billing', 'current')));
    });

    it('EM-A03: Active Viewer can read workspace & Production Floor data, but is denied Management-only product_projects', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertSucceeds(getDoc(doc(viewerDb, 'workspaces', WS_MAIN)));
      await assertSucceeds(getDoc(doc(viewerDb, 'recipes', 'recipe-main-1')));
      await assertSucceeds(getDoc(doc(viewerDb, 'presets', 'preset-enabled-1')));
      await assertSucceeds(getDoc(doc(viewerDb, 'mixers', 'mixer-main-1')));
      await assertSucceeds(getDoc(doc(viewerDb, 'history', 'history-main-1')));
      await assertSucceeds(getDoc(doc(viewerDb, 'master_ingredients', 'ing-main-1')));
      await assertSucceeds(getDoc(doc(viewerDb, 'workspaces', WS_MAIN, 'members', UID_OWNER_1)));
      await assertSucceeds(getDoc(doc(viewerDb, 'workspaces', WS_MAIN, 'billing', 'current')));
      await assertFails(getDoc(doc(viewerDb, 'product_projects', 'proj-main-1')));
    });

    it('EM-A04: Inactive member (active: false) cannot read protected workspace or operational documents', async () => {
      const inactiveDb = testEnv.authenticatedContext(UID_INACTIVE_EDITOR).firestore();
      await assertFails(getDoc(doc(inactiveDb, 'workspaces', WS_MAIN)));
      await assertFails(getDoc(doc(inactiveDb, 'recipes', 'recipe-main-1')));
      await assertFails(getDoc(doc(inactiveDb, 'presets', 'preset-enabled-1')));
      await assertFails(getDoc(doc(inactiveDb, 'mixers', 'mixer-main-1')));
      await assertFails(getDoc(doc(inactiveDb, 'history', 'history-main-1')));
      await assertFails(getDoc(doc(inactiveDb, 'master_ingredients', 'ing-main-1')));
      await assertFails(getDoc(doc(inactiveDb, 'product_projects', 'proj-main-1')));
      await assertFails(getDoc(doc(inactiveDb, 'workspaces', WS_MAIN, 'members', UID_OWNER_1)));
      await assertFails(getDoc(doc(inactiveDb, 'workspaces', WS_MAIN, 'billing', 'current')));
    });

    it('EM-A05: Members with missing or non-boolean active field (absent, "true", null) are denied', async () => {
      for (const malformedUid of [
        UID_MISSING_ACTIVE_MEMBER,
        UID_STRING_ACTIVE_MEMBER,
        UID_NULL_ACTIVE_MEMBER,
      ]) {
        const db = testEnv.authenticatedContext(malformedUid).firestore();
        await assertFails(getDoc(doc(db, 'workspaces', WS_MAIN)));
        await assertFails(getDoc(doc(db, 'recipes', 'recipe-main-1')));
        await assertFails(getDoc(doc(db, 'presets', 'preset-enabled-1')));
      }
    });

    it('EM-A06: Unauthenticated caller is denied across workspace, recipes, presets, members, and billing', async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthDb, 'workspaces', WS_MAIN)));
      await assertFails(getDoc(doc(unauthDb, 'recipes', 'recipe-main-1')));
      await assertFails(getDoc(doc(unauthDb, 'presets', 'preset-enabled-1')));
      await assertFails(getDoc(doc(unauthDb, 'workspaces', WS_MAIN, 'members', UID_OWNER_1)));
      await assertFails(getDoc(doc(unauthDb, 'workspaces', WS_MAIN, 'billing', 'current')));
    });

    it('EM-A07: Explicitly revoked Owner (active: false) cannot bypass revocation through ownerId fallback', async () => {
      const revokedOwnerDb = testEnv.authenticatedContext(UID_REVOKED_OWNER).firestore();
      await assertFails(getDoc(doc(revokedOwnerDb, 'workspaces', WS_REVOKED_OWNER)));
      await assertFails(
        updateDoc(doc(revokedOwnerDb, 'workspaces', WS_REVOKED_OWNER), {
          productionOptionOrder: ['preset-1oz'],
          updatedAt: '2026-10-26T12:00:00.000Z',
        })
      );
      await assertFails(getDoc(doc(revokedOwnerDb, 'recipes', 'recipe-revoked-ws')));
      await assertFails(deleteDoc(doc(revokedOwnerDb, 'presets', 'preset-revoked-ws')));
    });

    it('EM-A08: Malformed Owner member record (active field absent) does NOT regain access through ownerId fallback', async () => {
      const malformedOwnerDb = testEnv.authenticatedContext(UID_MALFORMED_OWNER).firestore();
      await assertFails(getDoc(doc(malformedOwnerDb, 'workspaces', WS_MALFORMED_OWNER)));
      await assertFails(getDoc(doc(malformedOwnerDb, 'presets', 'preset-malformed-ws')));
      await assertFails(deleteDoc(doc(malformedOwnerDb, 'presets', 'preset-malformed-ws')));
    });

    it('EM-A09: Cross-workspace access from another workspace Owner or Editor is strictly denied', async () => {
      for (const foreignUid of [UID_USER_B, UID_OWNER_2]) {
        const foreignDb = testEnv.authenticatedContext(foreignUid).firestore();
        await assertFails(getDoc(doc(foreignDb, 'workspaces', WS_MAIN)));
        await assertFails(getDoc(doc(foreignDb, 'recipes', 'recipe-main-1')));
        await assertFails(getDoc(doc(foreignDb, 'presets', 'preset-enabled-1')));
        await assertFails(getDoc(doc(foreignDb, 'workspaces', WS_MAIN, 'members', UID_OWNER_1)));
        await assertFails(getDoc(doc(foreignDb, 'workspaces', WS_MAIN, 'billing', 'current')));
      }
    });
  });

  // ===========================================================================
  // GROUP B — PRODUCTION OPTION ORDERING
  // ===========================================================================
  describe('B. Shared Workspace Production Option Ordering', () => {
    it('EM-B01: Active Owner can update productionOptionOrder with app payload shape', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      const nextOrder = ['preset-1oz', 'preset-2oz', 'preset-enabled-1', 'preset-3oz'];
      await assertSucceeds(
        updateDoc(doc(ownerDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: nextOrder,
          updatedAt: '2026-10-26T12:00:00.000Z',
        })
      );

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDoc(doc(ctx.firestore(), 'workspaces', WS_MAIN));
        assert.deepEqual(snap.data()?.productionOptionOrder, nextOrder);
      });
    });

    it('EM-B02: Active Editor can update productionOptionOrder with narrow payload (existing or first-time field)', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      const nextOrder = ['preset-1oz', 'preset-2oz', 'preset-enabled-1', 'preset-3oz'];

      await assertSucceeds(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: nextOrder,
          updatedAt: '2026-10-26T12:05:00.000Z',
        })
      );

      // Also succeeds when workspace did not previously have `productionOptionOrder`
      await assertSucceeds(
        updateDoc(doc(editorDb, 'workspaces', WS_NO_PRIOR_ORDER), {
          productionOptionOrder: nextOrder,
          updatedAt: '2026-10-26T12:06:00.000Z',
        })
      );
    });

    it('EM-B03: Active Viewer cannot update productionOptionOrder', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertFails(
        updateDoc(doc(viewerDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: ['preset-3oz', 'preset-2oz'],
          updatedAt: '2026-10-26T12:10:00.000Z',
        })
      );
    });

    it('EM-B04: Inactive Editor cannot update productionOptionOrder', async () => {
      const inactiveDb = testEnv.authenticatedContext(UID_INACTIVE_EDITOR).firestore();
      await assertFails(
        updateDoc(doc(inactiveDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: ['preset-3oz', 'preset-2oz'],
          updatedAt: '2026-10-26T12:11:00.000Z',
        })
      );
    });

    it('EM-B05: Editor cannot change ownerId', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          ownerId: UID_EDITOR_1,
          productionOptionOrder: ['preset-1oz'],
          updatedAt: '2026-10-26T12:12:00.000Z',
        })
      );
    });

    it('EM-B06: Editor cannot change managementLock', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          managementLock: { enabled: false, salt: null, hash: null, updatedAt: null },
          productionOptionOrder: ['preset-1oz'],
          updatedAt: '2026-10-26T12:13:00.000Z',
        })
      );
    });

    it('EM-B07: Editor cannot change productionFloorModeEnabled', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionFloorModeEnabled: false,
          productionOptionOrder: ['preset-1oz'],
          updatedAt: '2026-10-26T12:14:00.000Z',
        })
      );
    });

    it('EM-B08: Editor cannot change unrelated workspace fields (name, code, ownerEmail)', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      for (const extra of [
        { name: 'Tampered Bakery Name' },
        { code: 'HIJACKED' },
        { ownerEmail: 'intruder@sunnysweets.test' },
      ]) {
        await assertFails(
          updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
            ...extra,
            productionOptionOrder: ['preset-1oz'],
            updatedAt: '2026-10-26T12:15:00.000Z',
          })
        );
      }
    });

    it('EM-B09: Non-list productionOptionOrder is rejected', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      for (const invalidOrder of ['preset-1oz,preset-2oz', 42, { first: 'preset-1oz' }, null, true]) {
        await assertFails(
          updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
            productionOptionOrder: invalidOrder,
            updatedAt: '2026-10-26T12:16:00.000Z',
          })
        );
      }
    });

    it('EM-B10: productionOptionOrder exceeding 500 entries is rejected (500 allowed, 501 rejected)', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      const maxAllowedOrder = Array.from({ length: 500 }, (_, i) => `preset-${i}`);
      const overLimitOrder = Array.from({ length: 501 }, (_, i) => `preset-${i}`);

      await assertSucceeds(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: maxAllowedOrder,
          updatedAt: '2026-10-26T12:17:00.000Z',
        })
      );
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: overLimitOrder,
          updatedAt: '2026-10-26T12:18:00.000Z',
        })
      );
    });

    it('EM-B11: Approved updatedAt string format (ISO timestamp and 64-char max boundary) is accepted', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertSucceeds(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: ['preset-1oz', 'preset-2oz'],
          updatedAt: '2026-10-26T12:19:00.000Z',
        })
      );
      await assertSucceeds(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: ['preset-2oz', 'preset-1oz'],
          updatedAt: '2'.repeat(64),
        })
      );
    });

    it('EM-B12: Disallowed updatedAt types (number, bool, null, object) and strings > 64 chars are rejected', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      for (const badUpdatedAt of [1761480000000, true, null, { iso: 'now' }, 'x'.repeat(65)]) {
        await assertFails(
          updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
            productionOptionOrder: ['preset-1oz'],
            updatedAt: badUpdatedAt,
          })
        );
      }
    });
  });

  // ===========================================================================
  // GROUP C — PRESET ENABLED / DISABLED
  // ===========================================================================
  describe('C. Preset Enabled/Disabled Security & Backward Compatibility', () => {
    it('EM-C01: Active Owner can create and update presets with productionEnabled: true and false', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      await assertSucceeds(
        setDoc(doc(ownerDb, 'presets', 'preset-owner-new'), {
          id: 'preset-owner-new',
          workspaceId: WS_MAIN,
          userId: UID_OWNER_1,
          name: 'Owner 1.5 oz Cookie Case',
          finishedWeight: 1.5,
          weightUnit: 'oz',
          quantityPerUnit: 200,
          productionEnabled: true,
        })
      );
      await assertSucceeds(
        updateDoc(doc(ownerDb, 'presets', 'preset-owner-new'), {
          productionEnabled: false,
          updatedAt: '2026-10-26T13:00:00.000Z',
        })
      );
    });

    it('EM-C02: Active Editor can create and transactionally toggle presets with productionEnabled: false and true', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertSucceeds(
        setDoc(doc(editorDb, 'presets', 'preset-editor-new'), {
          id: 'preset-editor-new',
          workspaceId: WS_MAIN,
          userId: UID_EDITOR_1,
          name: 'Editor 3.5 oz Cookie Case',
          finishedWeight: 3.5,
          weightUnit: 'oz',
          quantityPerUnit: 96,
          productionEnabled: false,
        })
      );

      // Mirrors `store.setPresetProductionEnabled` transactional read-modify-write
      await assertSucceeds(
        runTransaction(editorDb, async (tx) => {
          const ref = doc(editorDb, 'presets', 'preset-enabled-1');
          const snap = await tx.get(ref);
          assert.equal(snap.exists(), true);
          tx.set(ref, {
            ...snap.data(),
            productionEnabled: false,
            updatedAt: '2026-10-26T13:05:00.000Z',
          });
        })
      );
    });

    it('EM-C03: Legacy presets without productionEnabled remain valid for read, unrelated update, and omitted create', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();

      await assertSucceeds(getDoc(doc(viewerDb, 'presets', 'preset-legacy-no-flag')));
      await assertSucceeds(
        updateDoc(doc(editorDb, 'presets', 'preset-legacy-no-flag'), {
          quantityPerUnit: 144,
          updatedAt: '2026-10-26T13:10:00.000Z',
        })
      );
      await assertSucceeds(
        setDoc(doc(editorDb, 'presets', 'preset-created-without-flag'), {
          id: 'preset-created-without-flag',
          workspaceId: WS_MAIN,
          userId: UID_EDITOR_1,
          name: 'Legacy Compatible Preset',
          finishedWeight: 2,
          weightUnit: 'oz',
          quantityPerUnit: 140,
        })
      );
    });

    it('EM-C04: Viewer cannot toggle productionEnabled or create/update presets', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertFails(
        updateDoc(doc(viewerDb, 'presets', 'preset-enabled-1'), {
          productionEnabled: false,
        })
      );
      await assertFails(
        setDoc(doc(viewerDb, 'presets', 'preset-viewer-illegal'), {
          id: 'preset-viewer-illegal',
          workspaceId: WS_MAIN,
          name: 'Illegal Preset',
          finishedWeight: 2,
          weightUnit: 'oz',
          quantityPerUnit: 100,
          productionEnabled: true,
        })
      );
    });

    it('EM-C05: Inactive Editor cannot toggle productionEnabled', async () => {
      const inactiveDb = testEnv.authenticatedContext(UID_INACTIVE_EDITOR).firestore();
      await assertFails(
        updateDoc(doc(inactiveDb, 'presets', 'preset-enabled-1'), {
          productionEnabled: false,
        })
      );
    });

    it('EM-C06: Non-boolean productionEnabled values are rejected for both Owner and Editor on create & update', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();

      for (const badVal of ['true', 'false', 1, 0, null, { enabled: true }, []]) {
        await assertFails(
          setDoc(doc(ownerDb, 'presets', 'preset-bad-create'), {
            id: 'preset-bad-create',
            workspaceId: WS_MAIN,
            name: 'Bad Bool Preset',
            finishedWeight: 2,
            weightUnit: 'oz',
            quantityPerUnit: 144,
            productionEnabled: badVal,
          })
        );
        await assertFails(
          updateDoc(doc(editorDb, 'presets', 'preset-enabled-1'), {
            productionEnabled: badVal,
          })
        );
        await assertFails(
          updateDoc(doc(ownerDb, 'presets', 'preset-enabled-1'), {
            productionEnabled: badVal,
          })
        );
      }
    });

    it('EM-C07: Updating productionEnabled cannot change workspaceId', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();

      await assertFails(
        updateDoc(doc(editorDb, 'presets', 'preset-enabled-1'), {
          productionEnabled: false,
          workspaceId: WS_BAKERY_B,
        })
      );
      await assertFails(
        updateDoc(doc(ownerDb, 'presets', 'preset-enabled-1'), {
          productionEnabled: false,
          workspaceId: WS_BAKERY_B,
        })
      );
    });

    it('EM-C08: Cross-workspace preset create and productionEnabled modification are denied', async () => {
      for (const foreignUid of [UID_USER_B, UID_OWNER_2]) {
        const foreignDb = testEnv.authenticatedContext(foreignUid).firestore();
        await assertFails(
          updateDoc(doc(foreignDb, 'presets', 'preset-enabled-1'), {
            productionEnabled: false,
          })
        );
        await assertFails(
          setDoc(doc(foreignDb, 'presets', 'preset-cross-ws'), {
            id: 'preset-cross-ws',
            workspaceId: WS_MAIN,
            name: 'Injected Preset',
            finishedWeight: 2,
            weightUnit: 'oz',
            quantityPerUnit: 100,
            productionEnabled: true,
          })
        );
      }
    });
  });

  // ===========================================================================
  // GROUP D — PERMANENT RECIPE AND PRESET DELETION
  // ===========================================================================
  describe('D. Owner-Only Permanent Recipe and Preset Deletion', () => {
    it('EM-D01: Active Owner can permanently delete a preset in the owned workspace', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      await assertSucceeds(deleteDoc(doc(ownerDb, 'presets', 'preset-disabled-1')));

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDoc(doc(ctx.firestore(), 'presets', 'preset-disabled-1'));
        assert.equal(snap.exists(), false);
      });
    });

    it('EM-D02: Active Editor cannot permanently delete a preset', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertFails(deleteDoc(doc(editorDb, 'presets', 'preset-enabled-1')));

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDoc(doc(ctx.firestore(), 'presets', 'preset-enabled-1'));
        assert.equal(snap.exists(), true);
      });
    });

    it('EM-D03: Active Viewer cannot permanently delete a preset', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertFails(deleteDoc(doc(viewerDb, 'presets', 'preset-enabled-1')));
    });

    it('EM-D04: Inactive / revoked Owner cannot permanently delete a preset', async () => {
      const revokedOwnerDb = testEnv.authenticatedContext(UID_REVOKED_OWNER).firestore();
      await assertFails(deleteDoc(doc(revokedOwnerDb, 'presets', 'preset-revoked-ws')));
    });

    it('EM-D05: Active Owner can permanently delete a recipe in the owned workspace', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      await assertSucceeds(deleteDoc(doc(ownerDb, 'recipes', 'recipe-main-1')));

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDoc(doc(ctx.firestore(), 'recipes', 'recipe-main-1'));
        assert.equal(snap.exists(), false);
      });
    });

    it('EM-D06: Active Editor cannot permanently delete a recipe (while archiving via update remains allowed)', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertSucceeds(
        updateDoc(doc(editorDb, 'recipes', 'recipe-main-1'), {
          archived: true,
          updatedAt: '2026-10-26T14:00:00.000Z',
        })
      );
      await assertFails(deleteDoc(doc(editorDb, 'recipes', 'recipe-main-1')));
    });

    it('EM-D07: Active Viewer cannot permanently delete a recipe', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertFails(deleteDoc(doc(viewerDb, 'recipes', 'recipe-main-1')));
    });

    it('EM-D08: Cross-workspace recipe and preset deletion by another workspace Owner is denied', async () => {
      const otherOwnerDb = testEnv.authenticatedContext(UID_OWNER_2).firestore();
      await assertFails(deleteDoc(doc(otherOwnerDb, 'recipes', 'recipe-main-1')));
      await assertFails(deleteDoc(doc(otherOwnerDb, 'presets', 'preset-enabled-1')));
    });
  });

  // ===========================================================================
  // GROUP E — MANAGEMENT SECURITY & MEMBERSHIP GOVERNANCE
  // ===========================================================================
  describe('E. Management PIN, Workspace Administration & Live Revocation', () => {
    it('EM-E01: Active Editor cannot modify Management PIN configuration (managementLock)', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          managementLock: {
            enabled: false,
            salt: null,
            hash: null,
            updatedAt: '2026-10-26T15:00:00.000Z',
          },
        })
      );
    });

    it('EM-E02: Active Viewer cannot modify Management PIN configuration (managementLock)', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertFails(
        updateDoc(doc(viewerDb, 'workspaces', WS_MAIN), {
          managementLock: {
            enabled: false,
            salt: null,
            hash: null,
            updatedAt: '2026-10-26T15:01:00.000Z',
          },
        })
      );
    });

    it('EM-E03: Active Owner can perform authorized workspace & member operations, while anti-tamper guards hold', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();

      // Authorized Owner updates: Management PIN, Floor mode, workspace name, member administration
      await assertSucceeds(
        updateDoc(doc(ownerDb, 'workspaces', WS_MAIN), {
          managementLock: {
            enabled: true,
            salt: 'fedcba9876543210fedcba9876543210',
            hash: '1111111111111111111111111111111111111111111111111111111111111111',
            updatedAt: '2026-10-26T15:02:00.000Z',
          },
          productionFloorModeEnabled: true,
          updatedAt: '2026-10-26T15:02:00.000Z',
        })
      );
      await assertSucceeds(
        setDoc(doc(ownerDb, 'workspaces', WS_MAIN, 'members', 'uid-new-baker'), {
          uid: 'uid-new-baker',
          role: 'editor',
          email: 'newbaker@sunnysweets.test',
          active: true,
        })
      );

      // Owner anti-tamper boundaries remain enforced
      await assertFails(
        updateDoc(doc(ownerDb, 'workspaces', WS_MAIN), {
          ownerId: UID_EDITOR_1,
        })
      );
      await assertFails(
        updateDoc(doc(ownerDb, 'workspaces', WS_MAIN), {
          strategicPartner: true,
        })
      );
      await assertFails(
        updateDoc(doc(ownerDb, 'workspaces', WS_MAIN), {
          billingSource: 'tampered',
        })
      );
      await assertFails(
        setDoc(doc(ownerDb, 'workspaces', WS_MAIN, 'billing', 'current'), {
          entitlementStatus: 'active',
        })
      );
    });

    it('EM-E04: Active Editor cannot create, update, or delete workspace membership documents', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      await assertFails(
        setDoc(doc(editorDb, 'workspaces', WS_MAIN, 'members', 'uid-editor-invite'), {
          uid: 'uid-editor-invite',
          role: 'viewer',
          email: 'invite@sunnysweets.test',
          active: true,
        })
      );
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN, 'members', UID_VIEWER_1), {
          role: 'editor',
        })
      );
      await assertFails(deleteDoc(doc(editorDb, 'workspaces', WS_MAIN, 'members', UID_VIEWER_1)));
    });

    it('EM-E05: Active Viewer cannot create, update, or delete workspace membership documents', async () => {
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      await assertFails(
        setDoc(doc(viewerDb, 'workspaces', WS_MAIN, 'members', 'uid-viewer-invite'), {
          uid: 'uid-viewer-invite',
          role: 'viewer',
          email: 'invite@sunnysweets.test',
          active: true,
        })
      );
      await assertFails(
        updateDoc(doc(viewerDb, 'workspaces', WS_MAIN, 'members', UID_VIEWER_1), {
          role: 'editor',
        })
      );
      await assertFails(deleteDoc(doc(viewerDb, 'workspaces', WS_MAIN, 'members', UID_EDITOR_1)));
    });

    it('EM-E06: Self-elevation, self-enrollment, and spoofed private workspaceMemberships index are denied', async () => {
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();
      const viewerDb = testEnv.authenticatedContext(UID_VIEWER_1).firestore();
      const outsiderDb = testEnv.authenticatedContext(UID_OUTSIDER).firestore();

      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN, 'members', UID_EDITOR_1), {
          role: 'owner',
        })
      );
      await assertFails(
        updateDoc(doc(viewerDb, 'workspaces', WS_MAIN, 'members', UID_VIEWER_1), {
          role: 'owner',
        })
      );
      await assertFails(
        setDoc(doc(outsiderDb, 'workspaces', WS_MAIN, 'members', UID_OUTSIDER), {
          uid: UID_OUTSIDER,
          role: 'owner',
          email: 'outsider@external.test',
          active: true,
        })
      );

      // Even if outsider writes their own private index `users/{uid}/workspaceMemberships/ws-main`,
      // authoritative workspace/recipe/preset rules still deny access.
      await assertSucceeds(
        setDoc(doc(outsiderDb, 'users', UID_OUTSIDER, 'workspaceMemberships', WS_MAIN), {
          workspaceId: WS_MAIN,
          role: 'owner',
          active: true,
        })
      );
      await assertFails(getDoc(doc(outsiderDb, 'workspaces', WS_MAIN)));
      await assertFails(getDoc(doc(outsiderDb, 'recipes', 'recipe-main-1')));
      await assertFails(getDoc(doc(outsiderDb, 'presets', 'preset-enabled-1')));
    });

    it('EM-E07: Explicit Owner revocation (setting active: false) immediately blocks revoked member reads and writes', async () => {
      const ownerDb = testEnv.authenticatedContext(UID_OWNER_1).firestore();
      const editorDb = testEnv.authenticatedContext(UID_EDITOR_1).firestore();

      // Confirm active before revocation
      await assertSucceeds(getDoc(doc(editorDb, 'recipes', 'recipe-main-1')));

      // Owner revokes Editor membership (`active: false`)
      await assertSucceeds(
        updateDoc(doc(ownerDb, 'workspaces', WS_MAIN, 'members', UID_EDITOR_1), {
          active: false,
        })
      );

      // Immediately denied across workspace, recipes, and presets
      await assertFails(getDoc(doc(editorDb, 'workspaces', WS_MAIN)));
      await assertFails(getDoc(doc(editorDb, 'recipes', 'recipe-main-1')));
      await assertFails(
        updateDoc(doc(editorDb, 'workspaces', WS_MAIN), {
          productionOptionOrder: ['preset-1oz'],
          updatedAt: '2026-10-26T15:10:00.000Z',
        })
      );
      await assertFails(
        updateDoc(doc(editorDb, 'presets', 'preset-enabled-1'), {
          productionEnabled: false,
        })
      );
    });
  });
});
