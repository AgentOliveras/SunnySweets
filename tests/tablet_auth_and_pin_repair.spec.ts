import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signInWithGoogle,
  setGooglePopupExecutorForTesting,
  isGoogleSignInInFlight,
} from '../src/services/firebase';
import {
  formatGoogleSignInError,
  formatWorkspaceBootstrapError,
} from '../src/utils/authDiagnostics';
import { WorkspaceProvisioningService } from '../src/services/workspaceProvisioning';
import { store } from '../src/services/store';
import {
  APP_MODE_STORAGE_KEY,
  MGMT_LOCK_STORAGE_KEY,
  ManagementLockConfig,
  ManagementSessionGateController,
  assertValidLockConfigForPersistence,
  generateSalt,
  hashPin,
  loadManagementLockConfig,
  resolveEffectiveManagementLock,
  sanitizeRestoredAppMode,
  saveManagementLockConfig,
  verifyManagementPin,
} from '../src/utils/managementLock';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  LEGACY_LOCAL_CRITICAL_NOTES_KEY,
} from '../src/utils/criticalNotesReconciliation';
import { ProductionHistoryEntry, ProductionPreset, Recipe, Workspace } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createIsolatedStorage(seed: Record<string, string> = {}) {
  const map: Record<string, string> = { ...seed };
  return {
    data: map,
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    setItem(key: string, value: string): void {
      map[key] = String(value);
    },
    removeItem(key: string): void {
      delete map[key];
    },
    clear(): void {
      Object.keys(map).forEach((k) => delete map[k]);
    },
  };
}

function makeFirebaseError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

function createWsMain(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-main',
    name: 'Sunny Sweets',
    ownerId: 'uid-owner-sunny',
    ownerEmail: 'owner@sunnysweets.example',
    code: 'WS-MAIN',
    members: [],
    groups: [],
    productionFloorModeEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Urgent Tablet Authentication & Management PIN Repair — Isolated Verification Suite', () => {
  let activeMockStorage = createIsolatedStorage();

  beforeEach(() => {
    activeMockStorage = createIsolatedStorage();
    (globalThis as any).localStorage = activeMockStorage;
    setGooglePopupExecutorForTesting(null);
    WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(null);
    store.clearSession();
  });

  afterEach(() => {
    setGooglePopupExecutorForTesting(null);
    WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(null);
    store.clearSession();
  });

  // =========================================================================
  // PART A — AUTHENTICATION, DIAGNOSTICS & CONNECTIVITY RESILIENCE
  // =========================================================================
  describe('Part A: Google Popup Error Preservation, Double-Submit Prevention & Bootstrap Recovery', () => {
    it('A1: signInWithGoogle() preserves and rethrows exact FirebaseError codes and never returns null on failure', async () => {
      const errorCodes = [
        'auth/popup-closed-by-user',
        'auth/popup-blocked',
        'auth/cancelled-popup-request',
        'auth/web-storage-unsupported',
        'auth/operation-not-supported-in-this-environment',
        'auth/network-request-failed',
        'auth/unauthorized-domain',
        'auth/internal-error',
      ];

      for (const code of errorCodes) {
        setGooglePopupExecutorForTesting(async () => {
          throw makeFirebaseError(code, `Firebase: Error (${code}).`);
        });

        let caught: any = null;
        try {
          await signInWithGoogle();
        } catch (err) {
          caught = err;
        }

        assert.ok(caught, `signInWithGoogle must throw rather than return null for ${code}`);
        assert.strictEqual(caught.code, code, `Exact Firebase error code ${code} must be preserved`);
      }
    });

    it('A2: formatGoogleSignInError() surfaces exact Firebase error code and actionable tablet diagnostics on SignInScreen', () => {
      const popupClosed = formatGoogleSignInError(
        makeFirebaseError('auth/popup-closed-by-user', 'Firebase: Error (auth/popup-closed-by-user).')
      );
      assert.strictEqual(popupClosed.code, 'auth/popup-closed-by-user');
      assert.ok(popupClosed.message.length > 15);
      assert.ok(popupClosed.tabletHint && popupClosed.tabletHint.includes('cookies'));

      const popupBlocked = formatGoogleSignInError(
        makeFirebaseError('auth/popup-blocked', 'Firebase: Error (auth/popup-blocked).')
      );
      assert.strictEqual(popupBlocked.code, 'auth/popup-blocked');
      assert.ok(popupBlocked.tabletHint?.includes('Samsung Internet'));

      const storageBlocked = formatGoogleSignInError(
        makeFirebaseError('auth/web-storage-unsupported', 'Web storage unsupported')
      );
      assert.strictEqual(storageBlocked.code, 'auth/web-storage-unsupported');
      assert.ok(storageBlocked.tabletHint?.includes('Samsung Internet'));

      const signInSource = fs.readFileSync(
        path.join(__dirname, '../src/components/SignInScreen.tsx'),
        'utf-8'
      );
      assert.ok(signInSource.includes('id="google-auth-error-banner"'));
      assert.ok(signInSource.includes('id="google-auth-error-code"'));
      assert.ok(signInSource.includes('Diagnostic code: {authError.code}'));
      assert.ok(signInSource.includes('authInFlightRef.current'));
    });

    it('A3: Rapid double-tap / concurrent signInWithGoogle() calls deduplicate to a single popup request', async () => {
      let popupInvocations = 0;
      let resolvePopup!: (u: any) => void;

      setGooglePopupExecutorForTesting(
        () =>
          new Promise((resolve) => {
            popupInvocations += 1;
            resolvePopup = resolve;
          })
      );

      const p1 = signInWithGoogle();
      assert.strictEqual(isGoogleSignInInFlight(), true);
      const p2 = signInWithGoogle();

      assert.strictEqual(popupInvocations, 1, 'Underlying popup must only open once during rapid double-tap');

      resolvePopup({ uid: 'uid-owner-sunny', email: 'owner@sunnysweets.example' });
      const [u1, u2] = await Promise.all([p1, p2]);
      assert.strictEqual(u1.uid, 'uid-owner-sunny');
      assert.strictEqual(u2.uid, 'uid-owner-sunny');
      assert.strictEqual(isGoogleSignInInFlight(), false);
    });

    it('A4: Firebase Auth singleton initialization remains minimal without duplicate instances or forced account prompt assumptions', () => {
      const firebaseSource = fs.readFileSync(
        path.join(__dirname, '../src/services/firebase.ts'),
        'utf-8'
      );
      assert.ok(firebaseSource.includes('if (!getApps().length)'));
      assert.ok(firebaseSource.includes('authInstance = getAuth(app)'));
      assert.strictEqual(
        firebaseSource.includes("prompt: 'select_account'"),
        false,
        'Must not assume prompt=select_account cures popup closure without live evidence'
      );
    });

    it('A5: Firestore connectivity failure during workspace discovery routes to INITIALIZATION_ERROR (NEVER NO_WORKSPACE) and recheckAccess() recovers even when activeWorkspaceId is empty', async () => {
      let shouldFailDiscovery = true;

      WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(async () => {
        if (shouldFailDiscovery) {
          throw makeFirebaseError('unavailable', 'Cloud Firestore service is currently unavailable.');
        }
        return [
          {
            workspaceId: 'ws-main',
            role: 'owner',
            active: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ];
      });

      store.configureAuthAndLockTestHarness({
        authUidOnly: 'uid-owner-sunny',
        storage: activeMockStorage,
        activeWorkspaceId: '',
        membershipLookup: async (uid, wsId) => ({
          exists: uid === 'uid-owner-sunny' && wsId === 'ws-main',
          role: 'owner',
          active: true,
        }),
        workspaceDocLoader: async () => createWsMain(),
      });

      await store.resolveAuthenticatedSession('uid-owner-sunny');

      assert.strictEqual(
        store.getAppAccessState(),
        'INITIALIZATION_ERROR',
        'Transient workspace discovery error must route to retryable INITIALIZATION_ERROR, NEVER NO_WORKSPACE'
      );
      assert.notStrictEqual(store.getAppAccessState(), 'NO_WORKSPACE');
      assert.ok(store.getInitializationError()?.includes('unavailable'));

      // Now network recovers on the tablet and Owner taps "Retry Connection" while activeWorkspaceId === ''
      shouldFailDiscovery = false;
      await store.recheckAccess();

      assert.strictEqual(store.getInitializationError(), null);
      assert.strictEqual(store.isAuthorized(), true);
      assert.strictEqual(store.getUserRole(), 'owner');
      assert.strictEqual(store.getActiveWorkspaceId(), 'ws-main');
      assert.strictEqual(store.getAppAccessState(), 'AUTHORIZED_INTERNAL');
    });

    it('A6: Firestore error during membership validation routes to INITIALIZATION_ERROR (not NO_WORKSPACE) and recovers via recheckAccess()', async () => {
      let failMembershipRead = true;

      WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(async () => [
        {
          workspaceId: 'ws-main',
          role: 'owner',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      store.configureAuthAndLockTestHarness({
        authUidOnly: 'uid-owner-sunny',
        storage: activeMockStorage,
        activeWorkspaceId: '',
        membershipLookup: async () => {
          if (failMembershipRead) {
            throw makeFirebaseError('deadline-exceeded', 'Firestore membership read timed out.');
          }
          return { exists: true, role: 'owner', active: true };
        },
        workspaceDocLoader: async () => createWsMain(),
      });

      await store.resolveAuthenticatedSession('uid-owner-sunny');

      assert.strictEqual(store.getAppAccessState(), 'INITIALIZATION_ERROR');
      assert.ok(store.getInitializationError()?.includes('deadline-exceeded'));

      failMembershipRead = false;
      await store.recheckAccess();

      assert.strictEqual(store.getAppAccessState(), 'AUTHORIZED_INTERNAL');
      assert.strictEqual(store.getUserRole(), 'owner');
    });

    it('A7: Genuine authenticated user with zero memberships still routes cleanly to NO_WORKSPACE', async () => {
      WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(async () => []);

      store.configureAuthAndLockTestHarness({
        authUidOnly: 'uid-brand-new-customer',
        storage: activeMockStorage,
        activeWorkspaceId: '',
      });

      await store.resolveAuthenticatedSession('uid-brand-new-customer');

      assert.strictEqual(store.getInitializationError(), null);
      assert.strictEqual(store.getAppAccessState(), 'NO_WORKSPACE');
    });
  });

  // =========================================================================
  // PART B — SHARED MANAGEMENT PIN, FAIL-CLOSED HYDRATION & EPHEMERAL GATE
  // =========================================================================
  describe('Part B: Shared Workspace PIN, Fail-Closed Hydration, Role Gating & Ephemeral Unlock', () => {
    it('B1: Plaintext PINs are strictly rejected; salted SHA-256 hashes verify deterministically and fail closed on corrupt configs', async () => {
      const salt = generateSalt();
      const hash = await hashPin('5829', salt);

      assert.throws(() => {
        assertValidLockConfigForPersistence({
          enabled: true,
          salt,
          hash,
          pin: '5829',
        } as any);
      }, /Plaintext field "pin" is strictly prohibited/);

      assert.throws(() => {
        assertValidLockConfigForPersistence({
          enabled: true,
          salt: 'short',
          hash,
        });
      }, /Cryptographic salt must be at least 16 characters/);

      assert.throws(() => {
        assertValidLockConfigForPersistence({
          enabled: true,
          salt,
          hash: 'not-a-sha256-digest',
        });
      }, /64-character SHA-256 hex digest/);

      assert.strictEqual(
        await verifyManagementPin('5829', { enabled: true, salt: '', hash: '' }),
        false,
        'Enabled lock with empty hash/salt must fail closed'
      );
    });

    it('B2: Workspace lock hydration FAILS CLOSED during LOADING, ERROR, or corrupt cloud policy and NEVER downgrades to stale local config', async () => {
      const tabletEmptyStorage = createIsolatedStorage();
      const staleUnlockedLocal: ManagementLockConfig = { enabled: false, salt: '', hash: '' };
      saveManagementLockConfig(staleUnlockedLocal, tabletEmptyStorage);

      const salt = generateSalt();
      const cloudHash = await hashPin('7410', salt);
      const wsWithCloudLock = createWsMain({
        managementLock: {
          enabled: true,
          salt,
          hash: cloudHash,
          updatedAt: '2026-10-24T00:00:00.000Z',
        },
      });

      // 1. LOADING -> locked & verification blocked
      const loadingRes = resolveEffectiveManagementLock({
        workspace: null,
        workspaceDocHydrationState: 'LOADING',
        storageOverride: tabletEmptyStorage,
      });
      assert.strictEqual(loadingRes.status, 'HYDRATION_LOADING');
      assert.strictEqual(loadingRes.isLockActive, true);
      assert.strictEqual(loadingRes.isVerificationBlocked, true);

      // 2. ERROR -> fails closed even though local storage says enabled: false!
      const errorRes = resolveEffectiveManagementLock({
        workspace: wsWithCloudLock,
        workspaceDocHydrationState: 'ERROR',
        storageOverride: tabletEmptyStorage,
      });
      assert.strictEqual(errorRes.status, 'FAIL_CLOSED_UNVERIFIED');
      assert.strictEqual(errorRes.isLockActive, true);
      assert.strictEqual(errorRes.isVerificationBlocked, true);

      const gateDuringError = new ManagementSessionGateController({
        workspaceId: 'ws-main',
        isProductionFloorEnabled: true,
        resolution: errorRes,
        storage: tabletEmptyStorage,
      });
      assert.strictEqual(await gateDuringError.submitPin('7410', 'ws-main', errorRes), false);
      assert.strictEqual(
        gateDuringError.canRenderManagementWorkspace('ws-main', true, errorRes),
        false
      );

      // 3. Corrupt cloud lock -> fails closed
      const corruptRes = resolveEffectiveManagementLock({
        workspace: createWsMain({
          managementLock: { enabled: true, salt: '', hash: '' },
        }),
        workspaceDocHydrationState: 'READY',
        storageOverride: tabletEmptyStorage,
      });
      assert.strictEqual(corruptRes.status, 'FAIL_CLOSED_CORRUPT');
      assert.strictEqual(corruptRes.isLockActive, true);
      assert.strictEqual(corruptRes.isVerificationBlocked, true);

      // 4. Hydrated READY cloud lock -> unlocks ONLY with cloud PIN on Samsung tablet
      const readyRes = resolveEffectiveManagementLock({
        workspace: wsWithCloudLock,
        workspaceDocHydrationState: 'READY',
        storageOverride: tabletEmptyStorage,
      });
      assert.strictEqual(readyRes.status, 'PROTECTED_WORKSPACE');
      assert.strictEqual(readyRes.isLockActive, true);
      assert.strictEqual(readyRes.isVerificationBlocked, false);
      assert.strictEqual(await verifyManagementPin('7410', readyRes.effectiveConfig), true);
      assert.strictEqual(await verifyManagementPin('0000', readyRes.effectiveConfig), false);
    });

    it('B3: Preserves existing device-local PIN without auto-migration, keeps ws-main Owner unblocked, and supports Owner-controlled promotion across Phone -> Samsung Tablet -> Desktop', async () => {
      const phoneStorage = createIsolatedStorage();
      const tabletStorage = createIsolatedStorage();
      const desktopStorage = createIsolatedStorage();

      // Owner previously configured PIN '2580' on Phone (local-only SS_MGMT_LOCK_CONFIG)
      const phoneSalt = generateSalt();
      const phoneHash = await hashPin('2580', phoneSalt);
      saveManagementLockConfig(
        { enabled: true, salt: phoneSalt, hash: phoneHash, updatedAt: '2026-09-01T00:00:00.000Z' },
        phoneStorage
      );

      let cloudWsDoc = createWsMain({ managementLock: undefined });
      let cloudWrites = 0;

      // Before Owner promotion:
      // - Desktop (no local PIN) in ws-main is NOT locked out and triggers ZERO cloud writes
      const desktopBefore = resolveEffectiveManagementLock({
        workspace: cloudWsDoc,
        workspaceDocHydrationState: 'READY',
        storageOverride: desktopStorage,
      });
      assert.strictEqual(desktopBefore.status, 'DISABLED');
      assert.strictEqual(desktopBefore.isLockActive, false);

      // - Phone (with local PIN) preserves and enforces its local PIN
      const phoneBefore = resolveEffectiveManagementLock({
        workspace: cloudWsDoc,
        workspaceDocHydrationState: 'READY',
        storageOverride: phoneStorage,
      });
      assert.strictEqual(phoneBefore.status, 'PROTECTED_LOCAL_LEGACY');
      assert.strictEqual(phoneBefore.isLockActive, true);
      assert.strictEqual(cloudWrites, 0, 'Zero automatic migration writes may occur on load');

      // Now Owner explicitly promotes Phone PIN to shared workspace policy
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-owner-sunny', role: 'owner', workspaceId: 'ws-main' },
        storage: phoneStorage,
        workspaces: [cloudWsDoc],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        workspaceLockSaveAdapter: async (wsId, policy) => {
          cloudWrites += 1;
          assert.strictEqual(wsId, 'ws-main');
          assert.strictEqual(JSON.stringify(policy).includes('2580'), false, 'Plaintext PIN never transmitted');
          cloudWsDoc = { ...cloudWsDoc, managementLock: policy };
        },
      });

      // Wrong current PIN is rejected
      await assert.rejects(
        () => store.promoteLocalManagementLockToWorkspace('9999', 'owner'),
        /Current PIN is incorrect/
      );
      assert.strictEqual(cloudWrites, 0);

      // Correct current PIN promotes cleanly to shared workspace policy
      const promoted = await store.promoteLocalManagementLockToWorkspace('2580', 'owner');
      assert.strictEqual(cloudWrites, 1);
      assert.strictEqual(promoted.enabled, true);
      assert.strictEqual(promoted.hash, phoneHash);

      // Local backup on Phone remains intact
      assert.strictEqual(loadManagementLockConfig(phoneStorage).hash, phoneHash);

      // Samsung Tablet (with completely empty localStorage) now enforces the shared workspace PIN!
      const tabletAfter = resolveEffectiveManagementLock({
        workspace: cloudWsDoc,
        workspaceDocHydrationState: 'READY',
        storageOverride: tabletStorage,
      });
      assert.strictEqual(tabletAfter.status, 'PROTECTED_WORKSPACE');
      assert.strictEqual(tabletAfter.isLockActive, true);
      assert.strictEqual(await verifyManagementPin('2580', tabletAfter.effectiveConfig), true);

      // Desktop also enforces the shared workspace PIN!
      const desktopAfter = resolveEffectiveManagementLock({
        workspace: cloudWsDoc,
        workspaceDocHydrationState: 'READY',
        storageOverride: desktopStorage,
      });
      assert.strictEqual(desktopAfter.status, 'PROTECTED_WORKSPACE');
      assert.strictEqual(desktopAfter.isLockActive, true);
    });

    it('B4: Role enforcement blocks Editors and Viewers from modifying workspace PIN and server write errors do not falsely mutate state', async () => {
      const salt = generateSalt();
      const hash = await hashPin('6142', salt);
      const wsDoc = createWsMain();

      // Editor blocked
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-editor-1', role: 'editor', workspaceId: 'ws-main' },
        storage: activeMockStorage,
        workspaces: [wsDoc],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
      });
      await assert.rejects(
        () => store.saveWorkspaceManagementLock({ enabled: true, salt, hash }),
        /Only the workspace owner/
      );

      // Viewer blocked
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-viewer-1', role: 'viewer', workspaceId: 'ws-main' },
        storage: activeMockStorage,
        workspaces: [wsDoc],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
      });
      await assert.rejects(
        () => store.saveWorkspaceManagementLock({ enabled: true, salt, hash }),
        /Only the workspace owner/
      );

      // Owner save failure does NOT optimistically mutate workspace state
      store.configureAuthAndLockTestHarness({
        session: { uid: 'uid-owner-sunny', role: 'owner', workspaceId: 'ws-main' },
        storage: activeMockStorage,
        workspaces: [wsDoc],
        activeWorkspaceId: 'ws-main',
        workspaceDocHydrationState: 'READY',
        workspaceLockSaveAdapter: async () => {
          throw makeFirebaseError('unavailable', 'Firestore write failed');
        },
      });
      await assert.rejects(
        () => store.saveWorkspaceManagementLock({ enabled: true, salt, hash }),
        /Firestore write failed/
      );
      assert.strictEqual(
        store.getActiveWorkspace()?.managementLock,
        undefined,
        'Failed server write must never leave optimistic managementLock in memory'
      );

      // Verify UI read-only notice exists in ManagementLockSettings.tsx
      const settingsLockSource = fs.readFileSync(
        path.join(__dirname, '../src/components/ManagementLockSettings.tsx'),
        'utf-8'
      );
      assert.ok(settingsLockSource.includes('id="settings-management-lock-readonly-notice"'));
      assert.ok(settingsLockSource.includes("effectiveRole === 'owner'"));
    });

    it('B5: Every Management entry path requires PIN when Production Floor Mode is ENABLED (Samsung Tablet scenario) AND when DISABLED', async () => {
      const tabletStorage = createIsolatedStorage();
      const salt = generateSalt();
      const hash = await hashPin('3691', salt);
      const resolution = resolveEffectiveManagementLock({
        workspace: createWsMain({
          productionFloorModeEnabled: true,
          managementLock: { enabled: true, salt, hash },
        }),
        workspaceDocHydrationState: 'READY',
        storageOverride: tabletStorage,
      });

      const entryTargets: Array<{ label: string; target?: any }> = [
        { label: 'Main Launcher Management Mode button', target: undefined },
        { label: 'Recipes summary card', target: { tab: 'recipes' } },
        { label: 'Costing summary card', target: { tab: 'costing' } },
        { label: 'Presets summary card', target: { tab: 'presets' } },
        { label: 'Mixers summary card', target: { tab: 'mixers' } },
        { label: 'History summary card', target: { tab: 'history' } },
        { label: 'Settings deep link', target: { tab: 'settings' } },
        { label: 'Quotes deep link', target: { tab: 'quotes' } },
        { label: 'Open Calculator with Recipe', target: { tab: 'calculate', recipeIdForCalc: 'rec-1' } },
        { label: 'Open New Recipe Modal', target: { tab: 'recipes', openNewRecipeModal: true } },
      ];

      for (const entry of entryTargets) {
        const controller = new ManagementSessionGateController({
          workspaceId: 'ws-main',
          isProductionFloorEnabled: true,
          resolution,
          storage: tabletStorage,
        });

        const attempt = controller.requestManagementAccess('ws-main', resolution, entry.target, tabletStorage);
        assert.strictEqual(attempt.grantedImmediately, false, `${entry.label} must NOT bypass PIN`);
        assert.strictEqual(attempt.openedPinModal, true, `${entry.label} must open PIN modal`);
        assert.strictEqual(
          controller.canRenderManagementWorkspace('ws-main', true, resolution),
          false,
          `${entry.label} must block Management rendering before PIN`
        );

        // Wrong PIN rejected
        assert.strictEqual(await controller.submitPin('0000', 'ws-main', resolution), false);
        assert.strictEqual(controller.canRenderManagementWorkspace('ws-main', true, resolution), false);

        // Correct PIN unlocks and navigates to requested target
        assert.strictEqual(await controller.submitPin('3691', 'ws-main', resolution), true);
        assert.strictEqual(controller.canRenderManagementWorkspace('ws-main', true, resolution), true);
        if (entry.target?.tab) {
          assert.strictEqual(controller.getState('ws-main', true, resolution).activeTab, entry.target.tab);
        }
      }

      // Also verify when Production Floor Mode is DISABLED
      const floorDisabledController = new ManagementSessionGateController({
        workspaceId: 'ws-main',
        isProductionFloorEnabled: false,
        resolution,
        storage: tabletStorage,
        initialTab: 'settings',
      });
      const initialFloorDisabledState = floorDisabledController.getState('ws-main', false, resolution);
      assert.strictEqual(initialFloorDisabledState.canRenderManagementWorkspace, false);
      assert.strictEqual(initialFloorDisabledState.requiresPinChallengeScreen, true);
      assert.strictEqual(initialFloorDisabledState.pinModalOpen, true);
    });

    it('B6: Immediate re-lock on Production Floor exit, Main exit, refresh/reopen (persisted SS_APP_MODE=management), remote PIN rotation, workspace switch, and sign-out', async () => {
      const tabletStorage = createIsolatedStorage({
        [APP_MODE_STORAGE_KEY]: 'management', // Stale persisted management flag from prior session!
      });

      const salt1 = generateSalt();
      const hash1 = await hashPin('4815', salt1);
      const res1 = resolveEffectiveManagementLock({
        workspace: createWsMain({
          productionFloorModeEnabled: true,
          managementLock: { enabled: true, salt: salt1, hash: hash1 },
        }),
        workspaceDocHydrationState: 'READY',
        storageOverride: tabletStorage,
      });

      // 1. Browser reopen / page reload with SS_APP_MODE='management' sanitizes to 'main' and stays locked!
      assert.strictEqual(
        sanitizeRestoredAppMode('management', { isProductionFloorEnabled: true, isLockActive: true }),
        'main'
      );
      assert.strictEqual(
        sanitizeRestoredAppMode('full', { isProductionFloorEnabled: true, isLockActive: true }),
        'main'
      );

      const session1 = new ManagementSessionGateController({
        workspaceId: 'ws-main',
        isProductionFloorEnabled: true,
        resolution: res1,
        storage: tabletStorage,
      });
      assert.strictEqual(session1.getState('ws-main', true, res1).appMode, 'main');
      assert.strictEqual(tabletStorage.getItem(APP_MODE_STORAGE_KEY), 'main');
      assert.strictEqual(session1.canRenderManagementWorkspace('ws-main', true, res1), false);

      // 2. Unlock Management Mode
      session1.requestManagementAccess('ws-main', res1, { tab: 'recipes' }, tabletStorage);
      assert.strictEqual(await session1.submitPin('4815', 'ws-main', res1), true);
      assert.strictEqual(session1.canRenderManagementWorkspace('ws-main', true, res1), true);

      // 3. Exit to Production Floor -> immediately re-locks; returning to Management requires PIN again!
      session1.exitToProductionFloor(true, 'ws-main', res1, tabletStorage);
      assert.strictEqual(session1.getState('ws-main', true, res1).appMode, 'production');
      assert.strictEqual(session1.isManagementUnlocked('ws-main', res1), false);
      const reenterAfterProd = session1.requestManagementAccess('ws-main', res1, undefined, tabletStorage);
      assert.strictEqual(reenterAfterProd.grantedImmediately, false);
      assert.strictEqual(reenterAfterProd.openedPinModal, true);

      // 4. Unlock again, then exit via Back to Main -> immediately re-locks!
      assert.strictEqual(await session1.submitPin('4815', 'ws-main', res1), true);
      session1.exitToMainLauncher(true, 'ws-main', res1, tabletStorage);
      assert.strictEqual(session1.isManagementUnlocked('ws-main', res1), false);

      // 5. Unlock again, then Owner rotates PIN on phone -> remote snapshot immediately invalidates tablet unlock!
      assert.strictEqual(await session1.submitPin('4815', 'ws-main', res1), true);
      assert.strictEqual(session1.isManagementUnlocked('ws-main', res1), true);
      const salt2 = generateSalt();
      const hash2 = await hashPin('9021', salt2);
      const resRotated = resolveEffectiveManagementLock({
        workspace: createWsMain({
          productionFloorModeEnabled: true,
          managementLock: { enabled: true, salt: salt2, hash: hash2 },
        }),
        workspaceDocHydrationState: 'READY',
        storageOverride: tabletStorage,
      });
      assert.strictEqual(
        session1.isManagementUnlocked('ws-main', resRotated),
        false,
        'Remote PIN rotation must immediately re-lock previously unlocked sessions'
      );

      // 6. Unlock with new PIN, then switch workspace -> immediately re-locks for ws-other!
      assert.strictEqual(await session1.submitPin('9021', 'ws-main', resRotated), true);
      assert.strictEqual(session1.isManagementUnlocked('ws-second', resRotated), false);

      // 7. Sign-out clears persisted SS_APP_MODE='management'
      tabletStorage.setItem(APP_MODE_STORAGE_KEY, 'management');
      store.configureAuthAndLockTestHarness({ storage: tabletStorage });
      store.clearSession();
      assert.strictEqual(tabletStorage.getItem(APP_MODE_STORAGE_KEY), null);
    });

    it('B7: Responsive Desktop / Samsung Tablet / Mobile viewport matrix & password-manager autofill mitigation attributes are present', async () => {
      const deviceProfiles = [
        { name: 'Desktop Browser (Chrome/Edge)', viewport: { width: 1440, height: 900 }, role: 'owner' as const },
        { name: 'Samsung Production Tablet (Chrome / Samsung Internet)', viewport: { width: 800, height: 1280 }, role: 'editor' as const },
        { name: 'Mobile Phone', viewport: { width: 390, height: 844 }, role: 'owner' as const },
      ];

      const salt = generateSalt();
      const hash = await hashPin('6420', salt);
      const sharedWs = createWsMain({
        productionFloorModeEnabled: true,
        managementLock: { enabled: true, salt, hash },
      });

      for (const device of deviceProfiles) {
        const deviceStorage = createIsolatedStorage({ [APP_MODE_STORAGE_KEY]: 'management' });
        const resolution = resolveEffectiveManagementLock({
          workspace: sharedWs,
          workspaceDocHydrationState: 'READY',
          storageOverride: deviceStorage,
        });
        const gate = new ManagementSessionGateController({
          workspaceId: 'ws-main',
          isProductionFloorEnabled: true,
          resolution,
          storage: deviceStorage,
        });

        assert.strictEqual(
          gate.canRenderManagementWorkspace('ws-main', true, resolution),
          false,
          `${device.name} (${device.viewport.width}x${device.viewport.height}) must start locked`
        );
        gate.requestManagementAccess('ws-main', resolution, { tab: 'settings' }, deviceStorage);
        assert.strictEqual(await gate.submitPin('6420', 'ws-main', resolution), true);
        assert.strictEqual(gate.canRenderManagementWorkspace('ws-main', true, resolution), true);
        gate.exitToProductionFloor(true, 'ws-main', resolution, deviceStorage);
        assert.strictEqual(gate.canRenderManagementWorkspace('ws-main', true, resolution), false);
      }

      const modalSource = fs.readFileSync(
        path.join(__dirname, '../src/components/ManagementLockModal.tsx'),
        'utf-8'
      );
      assert.ok(modalSource.includes('autoComplete="off"'));
      assert.ok(modalSource.includes('data-lpignore="true"'));
      assert.ok(modalSource.includes('data-1p-ignore="true"'));
      assert.ok(modalSource.includes('data-form-type="other"'));

      const appSource = fs.readFileSync(
        path.join(__dirname, '../src/components/AuthorizedRecipeCalculatorApp.tsx'),
        'utf-8'
      );
      assert.ok(
        appSource.includes("(appMode === 'management' || !isProductionFloorEnabled)"),
        'AuthorizedRecipeCalculatorApp must enforce universal Management Mode render guard regardless of Production Floor Mode'
      );
    });
  });

  // =========================================================================
  // PART C — PRODUCTION DATA & CRITICAL PRODUCTION NOTES PRESERVATION
  // =========================================================================
  describe('Part C: Zero Regression on ws-main, Recipes, Presets, 2.5 oz Chocolate Chip Note & History', () => {
    it('C1: Preserves 2.5 oz Chocolate Chip Critical Production Note, durable backup, recipes, presets, and history across sign-in, PIN lock/unlock, and sign-out', async () => {
      const chocChip25ozLocalNotes = JSON.stringify([
        {
          id: 'note-choc-chip-2.5oz-desktop',
          recipeId: 'rec-choc-chip',
          presetId: 'preset-choc-chip-2.5oz',
          workspaceId: 'ws-main',
          note: 'CRITICAL: Scoop at exact 2.5 oz portion weight; chill dough 24h before baking.',
          createdAt: '2026-08-15T12:00:00.000Z',
          updatedAt: '2026-08-15T12:00:00.000Z',
        },
      ]);

      const desktopStorage = createIsolatedStorage({
        [LEGACY_LOCAL_CRITICAL_NOTES_KEY]: chocChip25ozLocalNotes,
        [APP_MODE_STORAGE_KEY]: 'management',
      });

      const sampleRecipe: Recipe = {
        id: 'rec-choc-chip',
        workspaceId: 'ws-main',
        name: 'Signature Chocolate Chip Cookie',
        description: 'Signature Chocolate Chip Cookie base dough',
        category: 'Cookies',
        batchYieldQuantity: 120,
        batchYieldUnit: 'piece',
        defaultWastePercent: 6,
        ingredients: [{ id: 'ing-1', name: 'Pastry Flour', quantity: 2000, unit: 'g' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        userId: 'uid-owner-sunny',
      };

      const samplePreset25oz: ProductionPreset = {
        id: 'preset-choc-chip-2.5oz',
        workspaceId: 'ws-main',
        name: 'Case of 96 (2.5 oz)',
        category: 'Cookies',
        finishedWeight: 2.5,
        weightUnit: 'oz',
        quantityPerUnit: 96,
        unitName: 'case',
        criticalNotes: [
          {
            id: 'note-choc-chip-2.5oz-cloud',
            recipeId: 'rec-choc-chip',
            presetId: 'preset-choc-chip-2.5oz',
            workspaceId: 'ws-main',
            note: 'CRITICAL: Scoop at exact 2.5 oz portion weight; chill dough 24h before baking.',
            createdAt: '2026-08-15T12:00:00.000Z',
            updatedAt: '2026-08-15T12:00:00.000Z',
          },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        userId: 'uid-owner-sunny',
      };

      const sampleHistory: ProductionHistoryEntry = {
        id: 'hist-1',
        workspaceId: 'ws-main',
        userId: 'uid-owner-sunny',
        recipeId: 'rec-choc-chip',
        recipeName: 'Signature Chocolate Chip Cookie',
        calculatedAt: '2026-10-20T09:00:00.000Z',
        requirements: [
          {
            id: 'req-1',
            presetId: 'preset-choc-chip-2.5oz',
            presetName: 'Case of 96 (2.5 oz)',
            quantity: 1,
            piecesPerUnit: 96,
            itemWeight: 2.5,
            itemWeightUnit: 'oz',
          },
        ],
        totalPieces: 96,
        totalFinishedWeightGrams: 6803.89,
        displayBatchWeight: 254.4,
        displayWeightUnit: 'oz',
        scalingMultiplier: 1,
        wastePercent: 6,
        capacityExceeded: false,
        capacityOverridden: false,
        suggestedBatches: 1,
        calculatedIngredients: [],
        status: 'completed',
      };

      store.configureCriticalNotesTestHarness({
        session: { uid: 'uid-owner-sunny', role: 'owner', workspaceId: 'ws-main' },
        storage: desktopStorage,
        recipes: [sampleRecipe],
        presets: [samplePreset25oz],
        history: [sampleHistory],
        recipesHydrationState: 'READY',
        presetsHydrationState: 'READY',
        recipesConnectionVerified: true,
        presetsConnectionVerified: true,
      });

      const salt = generateSalt();
      const hash = await hashPin('1357', salt);
      store.configureAuthAndLockTestHarness({
        workspaces: [createWsMain({ managementLock: { enabled: true, salt, hash } })],
        workspaceDocHydrationState: 'READY',
      });

      // Stage 1.2 safety gate & data remain 100% intact
      assert.strictEqual(store.getSafetyOperationalGateState(), 'READY');
      assert.strictEqual(store.getRecipes().length, 1);
      assert.strictEqual(store.getPresets()[0].finishedWeight, 2.5);
      assert.strictEqual(store.getHistory().length, 1);
      assert.strictEqual(
        store.getCriticalNotesForPresetAndRecipe('preset-choc-chip-2.5oz', 'rec-choc-chip').length,
        1
      );

      // Sign out and clear session -> SS_APP_MODE cleared, but 2.5 oz legacy note & durable backup preserved!
      store.clearSession();

      assert.strictEqual(desktopStorage.getItem(APP_MODE_STORAGE_KEY), null);
      assert.strictEqual(desktopStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY), chocChip25ozLocalNotes);
      const durableBackupRaw = desktopStorage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY);
      assert.ok(durableBackupRaw, 'Durable Critical Notes backup must be preserved across sign-out');
      assert.ok(
        durableBackupRaw.includes('2.5 oz'),
        '2.5 oz Chocolate Chip note must remain intact in durable backup'
      );
    });
  });
});
