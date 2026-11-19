import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp, FirebaseApp } from 'firebase/app';
import * as browserFirebaseAuth from '../node_modules/@firebase/auth/dist/esm/index.js';
import { _getInstance as getBrowserAuthInternalInstance } from '../node_modules/@firebase/auth/dist/esm/internal.js';
import * as nodeAuthInternal from '@firebase/auth/internal';
import {
  auth,
  BROWSER_AUTH_PERSISTENCE_HIERARCHY,
  isBrowserAuthRuntime,
  initializeFirebaseAuthSingleton,
  signInWithGoogle,
  setGooglePopupExecutorForTesting,
} from '../src/services/firebase';
import { formatGoogleSignInError } from '../src/utils/authDiagnostics';
import { store } from '../src/services/store';
import { WorkspaceProvisioningService } from '../src/services/workspaceProvisioning';
import {
  DURABLE_CRITICAL_NOTES_BACKUP_KEY,
  LEGACY_LOCAL_CRITICAL_NOTES_KEY,
} from '../src/utils/criticalNotesReconciliation';
import {
  MGMT_LOCK_STORAGE_KEY,
  generateSalt,
  hashPin,
  resolveEffectiveManagementLock,
  verifyManagementPin,
} from '../src/utils/managementLock';
import { Workspace } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MockWebStorage extends Storage {
  readonly data: Record<string, string>;
}

function createMockWebStorage(
  seed: Record<string, string> = {},
  options?: { throwOnAccess?: boolean }
): MockWebStorage {
  const map: Record<string, string> = { ...seed };
  const guard = () => {
    if (options?.throwOnAccess) {
      const err = new Error('The operation is insecure / storage disabled.');
      err.name = 'SecurityError';
      throw err;
    }
  };
  return {
    data: map,
    get length(): number {
      guard();
      return Object.keys(map).length;
    },
    clear(): void {
      guard();
      Object.keys(map).forEach((k) => delete map[k]);
    },
    getItem(key: string): string | null {
      guard();
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    key(index: number): string | null {
      guard();
      return Object.keys(map)[index] ?? null;
    },
    removeItem(key: string): void {
      guard();
      delete map[key];
    },
    setItem(key: string, value: string): void {
      guard();
      map[key] = String(value);
    },
  };
}

interface MockIDBEnvironment {
  indexedDB: IDBFactory;
  stores: Map<string, Map<string, any>>;
  getDeleteDatabaseCalls: () => number;
}

class MockIDBRequest {}
class MockIDBDatabase {}
class MockIDBTransaction {}
class MockIDBObjectStore {}
class MockIDBIndex {}
class MockIDBCursor {}

/**
 * Minimal spec-accurate in-memory IndexedDB mock supporting @firebase/auth's
 * `firebaseLocalStorageDb` -> `firebaseLocalStorage` (`keyPath: 'fbase_key'`) operations
 * as well as @firebase/app's `idb` wrapper (`instanceof IDBRequest` checks).
 */
function createMockIndexedDB(options?: { failOpen?: boolean }): MockIDBEnvironment {
  const databases = new Map<string, Map<string, Map<string, any>>>();
  let authDeleteDatabaseCalls = 0;

  function makeRequest<T>(executor: (req: any) => void): any {
    const listeners: Record<string, Array<(ev?: any) => void>> = {
      success: [],
      error: [],
      upgradeneeded: [],
      blocked: [],
    };
    const req: any = Object.assign(new MockIDBRequest(), {
      result: undefined as T | undefined,
      error: null as Error | null,
      readyState: 'pending',
      onsuccess: null as ((ev?: any) => void) | null,
      onerror: null as ((ev?: any) => void) | null,
      onupgradeneeded: null as ((ev?: any) => void) | null,
      onblocked: null as ((ev?: any) => void) | null,
      addEventListener(type: string, cb: (ev?: any) => void) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(cb);
      },
      removeEventListener(type: string, cb: (ev?: any) => void) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((fn) => fn !== cb);
      },
      _emit(type: 'success' | 'error' | 'upgradeneeded') {
        if (type === 'success' || type === 'error') {
          req.readyState = 'done';
        }
        const handler =
          type === 'success'
            ? req.onsuccess
            : type === 'error'
            ? req.onerror
            : req.onupgradeneeded;
        if (typeof handler === 'function') handler({ target: req });
        (listeners[type] || []).forEach((cb) => cb({ target: req }));
      },
    });
    queueMicrotask(() => executor(req));
    return req;
  }

  const indexedDBMock: any = {
    open(dbName: string, _version?: number) {
      return makeRequest((req) => {
        if (options?.failOpen) {
          req.error = new Error('IndexedDB is disabled or unavailable in this browser context.');
          req._emit('error');
          return;
        }

        const isNewDb = !databases.has(dbName);
        if (isNewDb) {
          databases.set(dbName, new Map());
        }
        const dbStores = databases.get(dbName)!;

        const makeObjectStoreApi = (storeName: string) => {
          if (!dbStores.has(storeName)) {
            dbStores.set(storeName, new Map());
          }
          const storeMap = dbStores.get(storeName)!;
          return Object.assign(new MockIDBObjectStore(), {
            put(record: any, explicitKey?: string) {
              return makeRequest((putReq) => {
                const k =
                  explicitKey !== undefined
                    ? String(explicitKey)
                    : record && typeof record === 'object' && 'fbase_key' in record
                    ? String(record.fbase_key)
                    : String(storeMap.size);
                storeMap.set(
                  k,
                  record && typeof record === 'object' ? { ...record } : record
                );
                putReq.result = k;
                putReq._emit('success');
              });
            },
            get(key: string) {
              return makeRequest((getReq) => {
                getReq.result = storeMap.get(String(key));
                getReq._emit('success');
              });
            },
            getAll() {
              return makeRequest((allReq) => {
                allReq.result = Array.from(storeMap.values());
                allReq._emit('success');
              });
            },
            delete(key: string) {
              return makeRequest((delReq) => {
                storeMap.delete(String(key));
                delReq.result = undefined;
                delReq._emit('success');
              });
            },
            clear() {
              return makeRequest((clrReq) => {
                storeMap.clear();
                clrReq.result = undefined;
                clrReq._emit('success');
              });
            },
          });
        };

        const dbHandle: any = Object.assign(new MockIDBDatabase(), {
          name: dbName,
          objectStoreNames: {
            contains(storeName: string) {
              return dbStores.has(storeName);
            },
          },
          createObjectStore(storeName: string, _opts?: { keyPath?: string }) {
            return makeObjectStoreApi(storeName);
          },
          close() {},
          addEventListener() {},
          removeEventListener() {},
          transaction(storeNames: string | string[], _mode: 'readonly' | 'readwrite' = 'readonly') {
            const targetName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
            const txDoneListeners: Array<() => void> = [];
            const tx: any = Object.assign(new MockIDBTransaction(), {
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              error: null,
              addEventListener(type: string, cb: () => void) {
                if (type === 'complete') txDoneListeners.push(cb);
              },
              removeEventListener() {},
              objectStore(name = targetName) {
                return makeObjectStoreApi(name);
              },
            });
            queueMicrotask(() => {
              if (typeof tx.oncomplete === 'function') tx.oncomplete();
              txDoneListeners.forEach((cb) => cb());
            });
            return tx;
          },
        });

        req.result = dbHandle;
        if (isNewDb) {
          req._emit('upgradeneeded');
        }
        req._emit('success');
      });
    },
    deleteDatabase(dbName: string) {
      if (dbName === 'firebaseLocalStorageDb') {
        authDeleteDatabaseCalls += 1;
      }
      return makeRequest((req) => {
        databases.delete(dbName);
        req.result = undefined;
        req._emit('success');
      });
    },
  };

  if (!databases.has('firebaseLocalStorageDb')) {
    const initialDb = new Map<string, Map<string, any>>();
    initialDb.set('firebaseLocalStorage', new Map());
    databases.set('firebaseLocalStorageDb', initialDb);
  }

  return {
    indexedDB: indexedDBMock as IDBFactory,
    stores: databases.get('firebaseLocalStorageDb')!,
    getDeleteDatabaseCalls: () => authDeleteDatabaseCalls,
  };
}

interface SimulatedBrowserGlobals {
  localStorage: MockWebStorage;
  sessionStorage: MockWebStorage;
  idb: MockIDBEnvironment;
  setVisibilityState: (state: 'visible' | 'hidden') => void;
  restore: () => void;
}

function installSimulatedBrowserEnvironment(opts?: {
  localStorageSeed?: Record<string, string>;
  localStorageThrows?: boolean;
  sessionStorageThrows?: boolean;
  indexedDBUnavailable?: boolean;
  indexedDBFailsOpen?: boolean;
}): SimulatedBrowserGlobals {
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevLocalStorage = (globalThis as any).localStorage;
  const prevSessionStorage = (globalThis as any).sessionStorage;
  const prevIndexedDB = (globalThis as any).indexedDB;
  const prevSelf = (globalThis as any).self;
  const prevFetch = (globalThis as any).fetch;
  const prevIDBClasses = {
    IDBRequest: (globalThis as any).IDBRequest,
    IDBDatabase: (globalThis as any).IDBDatabase,
    IDBTransaction: (globalThis as any).IDBTransaction,
    IDBObjectStore: (globalThis as any).IDBObjectStore,
    IDBIndex: (globalThis as any).IDBIndex,
    IDBCursor: (globalThis as any).IDBCursor,
  };

  const localStore = createMockWebStorage(opts?.localStorageSeed || {}, {
    throwOnAccess: opts?.localStorageThrows,
  });
  const sessionStore = createMockWebStorage({}, {
    throwOnAccess: opts?.sessionStorageThrows,
  });
  const idb = createMockIndexedDB({ failOpen: opts?.indexedDBFailsOpen });

  let visibilityState: 'visible' | 'hidden' = 'visible';
  const docListeners: Record<string, Set<() => void>> = {};
  const winListeners: Record<string, Set<(ev?: any) => void>> = {};

  // Offline deterministic mock for Identity Toolkit accounts:lookup so zero external HTTP requests occur
  const offlineMockFetch = async (input: any, _init?: any): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : String(input?.url || '');
    if (urlStr.includes('accounts:lookup')) {
      const nowMs = Date.now();
      return new Response(
        JSON.stringify({
          kind: 'identitytoolkit#GetAccountInfoResponse',
          users: [
            {
              localId: 'uid-owner-sunny',
              email: 'owner@sunnysweets.example',
              emailVerified: true,
              displayName: 'Sunny Sweets Owner',
              providerUserInfo: [
                {
                  providerId: 'google.com',
                  rawId: 'google-uid-owner-sunny',
                  email: 'owner@sunnysweets.example',
                  displayName: 'Sunny Sweets Owner',
                },
              ],
              validSince: String(Math.floor((nowMs - 86400 * 1000) / 1000)),
              lastLoginAt: String(nowMs),
              createdAt: String(nowMs - 86400 * 1000),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const mockDocument: any = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: () => void) {
      if (!docListeners[type]) docListeners[type] = new Set();
      docListeners[type].add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      docListeners[type]?.delete(cb);
    },
  };

  const mockWindow: any = {
    localStorage: localStore,
    sessionStorage: sessionStore,
    document: mockDocument,
    fetch: offlineMockFetch,
    IDBRequest: MockIDBRequest,
    IDBDatabase: MockIDBDatabase,
    IDBTransaction: MockIDBTransaction,
    IDBObjectStore: MockIDBObjectStore,
    IDBIndex: MockIDBIndex,
    IDBCursor: MockIDBCursor,
    location: { href: 'https://recipe-calculator-943264608314.us-west1.run.app/' },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 Chrome/130.0' },
    addEventListener(type: string, cb: (ev?: any) => void) {
      if (!winListeners[type]) winListeners[type] = new Set();
      winListeners[type].add(cb);
    },
    removeEventListener(type: string, cb: (ev?: any) => void) {
      winListeners[type]?.delete(cb);
    },
  };

  (globalThis as any).IDBRequest = MockIDBRequest;
  (globalThis as any).IDBDatabase = MockIDBDatabase;
  (globalThis as any).IDBTransaction = MockIDBTransaction;
  (globalThis as any).IDBObjectStore = MockIDBObjectStore;
  (globalThis as any).IDBIndex = MockIDBIndex;
  (globalThis as any).IDBCursor = MockIDBCursor;
  (globalThis as any).fetch = offlineMockFetch;

  const nodeFetchProvider = (nodeAuthInternal as any).FetchProvider;
  if (nodeFetchProvider && typeof nodeFetchProvider.initialize === 'function') {
    nodeFetchProvider.initialize(offlineMockFetch, Headers, Response);
  }

  if (!opts?.indexedDBUnavailable) {
    mockWindow.indexedDB = idb.indexedDB;
    (globalThis as any).indexedDB = idb.indexedDB;
  } else {
    delete (globalThis as any).indexedDB;
  }

  (globalThis as any).window = mockWindow;
  (globalThis as any).self = mockWindow;
  (globalThis as any).document = mockDocument;
  (globalThis as any).localStorage = localStore;
  (globalThis as any).sessionStorage = sessionStore;

  const resetSingletonIdbPersistenceCache = () => {
    const getters = [
      getBrowserAuthInternalInstance,
      (nodeAuthInternal as any)._getInstance,
    ];
    for (const getter of getters) {
      if (typeof getter === 'function') {
        const idbSingleton: any = getter(browserFirebaseAuth.indexedDBLocalPersistence as any);
        if (idbSingleton) {
          if (idbSingleton.pollTimer) {
            clearInterval(idbSingleton.pollTimer);
            idbSingleton.pollTimer = null;
          }
          idbSingleton.dbPromise = null;
          idbSingleton.isHiding = false;
          idbSingleton.localCache = {};
        }
      }
    }
  };

  // Ensure singleton IndexedDBLocalPersistence starts cleanly bound to THIS test's mock IndexedDB
  resetSingletonIdbPersistenceCache();

  return {
    localStorage: localStore,
    sessionStorage: sessionStore,
    idb,
    setVisibilityState(next: 'visible' | 'hidden') {
      visibilityState = next;
      (docListeners['visibilitychange'] || new Set()).forEach((cb) => cb());
    },
    restore() {
      resetSingletonIdbPersistenceCache();

      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;

      if (prevSelf === undefined) delete (globalThis as any).self;
      else (globalThis as any).self = prevSelf;

      if (prevDocument === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = prevDocument;

      if (prevLocalStorage === undefined) delete (globalThis as any).localStorage;
      else (globalThis as any).localStorage = prevLocalStorage;

      if (prevSessionStorage === undefined) delete (globalThis as any).sessionStorage;
      else (globalThis as any).sessionStorage = prevSessionStorage;

      if (prevIndexedDB === undefined) delete (globalThis as any).indexedDB;
      else (globalThis as any).indexedDB = prevIndexedDB;

      if (prevFetch === undefined) {
        delete (globalThis as any).fetch;
      } else {
        (globalThis as any).fetch = prevFetch;
        if (nodeFetchProvider && typeof nodeFetchProvider.initialize === 'function') {
          nodeFetchProvider.initialize(prevFetch, Headers, Response);
        }
      }

      for (const [k, v] of Object.entries(prevIDBClasses)) {
        if (v === undefined) delete (globalThis as any)[k];
        else (globalThis as any)[k] = v;
      }
    },
  };
}

function createPersistedFirebaseUserBlob(apiKey: string, appName: string, uid = 'uid-owner-sunny') {
  const nowMs = Date.now();
  return {
    uid,
    email: 'owner@sunnysweets.example',
    emailVerified: true,
    displayName: 'Sunny Sweets Owner',
    isAnonymous: false,
    providerData: [
      {
        providerId: 'google.com',
        uid: `google-${uid}`,
        displayName: 'Sunny Sweets Owner',
        email: 'owner@sunnysweets.example',
        phoneNumber: null,
        photoURL: null,
      },
    ],
    stsTokenManager: {
      refreshToken: 'mock-refresh-token-valid',
      accessToken: 'mock-access-token-valid',
      expirationTime: nowMs + 3600 * 1000,
    },
    createdAt: String(nowMs - 86400 * 1000),
    lastLoginAt: String(nowMs),
    apiKey,
    appName,
  };
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

describe('Samsung Tablet Firebase Auth Persistence & Observer Lifecycle Repair Suite', () => {
  const createdApps: FirebaseApp[] = [];
  const createdAuths: any[] = [];

  function registerAuthForCleanup<T>(authObj: T): T {
    if (authObj && !createdAuths.includes(authObj)) {
      createdAuths.push(authObj);
    }
    return authObj;
  }

  async function flushCreatedAuths(): Promise<void> {
    while (createdAuths.length > 0) {
      const authObj = createdAuths.pop();
      if (authObj) {
        const pm = authObj.persistenceManager;
        if (pm?.persistence?.pollTimer) {
          clearInterval(pm.persistence.pollTimer);
          pm.persistence.pollTimer = null;
        }
        if (typeof authObj._delete === 'function') {
          await authObj._delete().catch(() => {});
        }
      }
    }
  }

  function makeTestApp(label: string, apiKey = 'AIzaSyTestKeyForIsolatedPersistenceSpec123'): FirebaseApp {
    const appInstance = initializeApp(
      {
        apiKey,
        authDomain: 'sunny-sweets-test.firebaseapp.com',
        projectId: 'sunny-sweets-test',
        appId: '1:1234567890:web:abcdef123456',
      },
      `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    createdApps.push(appInstance);
    return appInstance;
  }

  beforeEach(() => {
    setGooglePopupExecutorForTesting(null);
    WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(null);
    store.clearSession();
  });

  afterEach(async () => {
    setGooglePopupExecutorForTesting(null);
    WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(null);
    store.clearSession();
    await flushCreatedAuths();
    while (createdApps.length > 0) {
      const a = createdApps.pop();
      if (a) {
        await deleteApp(a).catch(() => {});
      }
    }
  });

  it('1. Auth initialization order, persistence hierarchy, Node compatibility, and singleton behavior', async () => {
    const firebaseSource = fs.readFileSync(
      path.join(__dirname, '../src/services/firebase.ts'),
      'utf-8'
    );

    // Confirm literal initializeAuth configuration in src/services/firebase.ts
    assert.ok(firebaseSource.includes('initializeAuth(app, {'));
    assert.ok(firebaseSource.includes('popupRedirectResolver: browserPopupRedirectResolver,'));
    assert.ok(
      /persistence:\s*\[\s*browserLocalPersistence,\s*indexedDBLocalPersistence,\s*browserSessionPersistence,?\s*\]/m.test(
        firebaseSource
      ),
      'Browser persistence array must strictly prioritize browserLocalPersistence -> indexedDBLocalPersistence -> browserSessionPersistence'
    );

    // Confirm no setPersistence before popup and no automatic signInWithPopup retry loop
    assert.strictEqual(
      firebaseSource.includes('setPersistence'),
      false,
      'Must NOT call setPersistence immediately before opening Google popup'
    );
    assert.strictEqual(
      firebaseSource.includes('updateCurrentUser'),
      false,
      'Must NOT include updateCurrentUser recovery in this initial persistence repair'
    );
    const signInPopupMatches = firebaseSource.match(/signInWithPopup\(/g) || [];
    assert.strictEqual(
      signInPopupMatches.length,
      1,
      'signInWithGoogle must invoke signInWithPopup once with zero automatic retry loops'
    );

    // Confirm exported hierarchy length & exact reference order
    assert.strictEqual(BROWSER_AUTH_PERSISTENCE_HIERARCHY.length, 3);

    // Confirm Node runtime detection safely returns false when window is absent
    assert.strictEqual(isBrowserAuthRuntime(), false);
    assert.ok(auth, 'Default Node test singleton auth instance must initialize cleanly');

    // Confirm browser singleton helper calls initializeAuth once with exact options & falls back cleanly on auth/already-initialized
    const env = installSimulatedBrowserEnvironment();
    try {
      const testApp = makeTestApp('singleton-order');
      let initCalls = 0;
      let fallbackGetAuthCalls = 0;
      let capturedOptions: any = null;

      const firstAuth = initializeFirebaseAuthSingleton(testApp, {
        isBrowserRuntime: true,
        popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver as any,
        persistence: [
          browserFirebaseAuth.browserLocalPersistence as any,
          browserFirebaseAuth.indexedDBLocalPersistence as any,
          browserFirebaseAuth.browserSessionPersistence as any,
        ],
        initializeAuthFn: (targetApp, deps) => {
          initCalls += 1;
          capturedOptions = deps;
          return registerAuthForCleanup(browserFirebaseAuth.initializeAuth(targetApp, deps as any)) as any;
        },
        getAuthFn: (targetApp) => {
          fallbackGetAuthCalls += 1;
          return browserFirebaseAuth.getAuth(targetApp) as any;
        },
      });

      assert.strictEqual(initCalls, 1);
      assert.strictEqual(fallbackGetAuthCalls, 0);
      assert.strictEqual(
        capturedOptions.popupRedirectResolver,
        browserFirebaseAuth.browserPopupRedirectResolver
      );
      assert.deepStrictEqual(capturedOptions.persistence, [
        browserFirebaseAuth.browserLocalPersistence,
        browserFirebaseAuth.indexedDBLocalPersistence,
        browserFirebaseAuth.browserSessionPersistence,
      ]);

      // Second call with identical options returns exact same Auth singleton without throwing
      const secondAuth = initializeFirebaseAuthSingleton(testApp, {
        isBrowserRuntime: true,
        popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver as any,
        persistence: [
          browserFirebaseAuth.browserLocalPersistence as any,
          browserFirebaseAuth.indexedDBLocalPersistence as any,
          browserFirebaseAuth.browserSessionPersistence as any,
        ],
        initializeAuthFn: (targetApp, deps) =>
          browserFirebaseAuth.initializeAuth(targetApp, deps as any) as any,
        getAuthFn: (targetApp) => {
          fallbackGetAuthCalls += 1;
          return browserFirebaseAuth.getAuth(targetApp) as any;
        },
      });
      assert.strictEqual(secondAuth, firstAuth, 'Must preserve single Auth instance per FirebaseApp');

      // Simulate auth/already-initialized error path -> returns existing singleton via getAuth
      const thirdAuth = initializeFirebaseAuthSingleton(testApp, {
        isBrowserRuntime: true,
        initializeAuthFn: () => {
          const alreadyErr = new Error('Already initialized') as Error & { code: string };
          alreadyErr.code = 'auth/already-initialized';
          throw alreadyErr;
        },
        getAuthFn: (targetApp) => {
          fallbackGetAuthCalls += 1;
          return browserFirebaseAuth.getAuth(targetApp) as any;
        },
      });
      assert.strictEqual(fallbackGetAuthCalls, 1);
      assert.strictEqual(thirdAuth, firstAuth);
    } finally {
      await flushCreatedAuths();
      env.restore();
    }
  });

  it('2. Existing IndexedDB desktop/phone session is discovered and migrated cleanly into browserLocalPersistence', async () => {
    const env = installSimulatedBrowserEnvironment({
      localStorageSeed: {
        [LEGACY_LOCAL_CRITICAL_NOTES_KEY]: '[{"id":"note-1","note":"Keep chilled"}]',
        [DURABLE_CRITICAL_NOTES_BACKUP_KEY]: '{"version":1,"notes":[]}',
        [MGMT_LOCK_STORAGE_KEY]: '{"enabled":true,"salt":"abcdefghijklmnop","hash":"' + 'a'.repeat(64) + '"}',
      },
    });

    try {
      const apiKey = 'AIzaSyDesktopExistingSessionMigrationKey';
      const testApp = makeTestApp('idb-session-migration', apiKey);
      const authStorageKey = `firebase:authUser:${apiKey}:${testApp.name}`;
      const existingUserBlob = createPersistedFirebaseUserBlob(apiKey, testApp.name, 'uid-owner-sunny');

      // Pre-populate IndexedDB ONLY (matching existing desktop/phone sessions before this repair)
      const idbStore = env.idb.stores.get('firebaseLocalStorage')!;
      idbStore.set(authStorageKey, {
        fbase_key: authStorageKey,
        value: existingUserBlob,
      });
      assert.strictEqual(env.localStorage.getItem(authStorageKey), null);

      const browserAuth = registerAuthForCleanup(
        browserFirebaseAuth.initializeAuth(testApp, {
          popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver,
          persistence: [
            browserFirebaseAuth.browserLocalPersistence,
            browserFirebaseAuth.indexedDBLocalPersistence,
            browserFirebaseAuth.browserSessionPersistence,
          ],
        })
      );

      await browserAuth.authStateReady();

      // Existing user is restored without sign-out
      assert.ok(browserAuth.currentUser, 'Existing IndexedDB session must be discovered and restored');
      assert.strictEqual(browserAuth.currentUser?.uid, 'uid-owner-sunny');
      assert.strictEqual(browserAuth.currentUser?.email, 'owner@sunnysweets.example');

      // Session is migrated into browserLocalPersistence (window.localStorage)
      const migratedJson = env.localStorage.getItem(authStorageKey);
      assert.ok(migratedJson, 'Existing IndexedDB session must migrate to localStorage');
      const parsedMigrated = JSON.parse(migratedJson!);
      assert.strictEqual(parsedMigrated.uid, 'uid-owner-sunny');

      // IndexedDB database itself is NEVER deleted, and all Sunny Sweets localStorage keys are untouched
      assert.strictEqual(env.idb.getDeleteDatabaseCalls(), 0);
      assert.strictEqual(
        env.localStorage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY),
        '[{"id":"note-1","note":"Keep chilled"}]'
      );
      assert.ok(env.localStorage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY));
      assert.ok(env.localStorage.getItem(MGMT_LOCK_STORAGE_KEY));
    } finally {
      await flushCreatedAuths();
      env.restore();
    }
  });

  it('3. Simulated Samsung tablet popup flow with hidden parent tab avoids IndexedDB "Database is closing/hidden" failure', async () => {
    const env = installSimulatedBrowserEnvironment();
    try {
      // A. Confirm the exact failure mechanism in IndexedDBLocalPersistence when parent tab is hidden:
      const idbPersistenceClass = browserFirebaseAuth.indexedDBLocalPersistence as any;
      const rawIdbPersistence = new idbPersistenceClass();
      const noopListener = () => {};
      rawIdbPersistence._addListener('firebase:authUser:test', noopListener);

      try {
        // Parent tab becomes hidden when Android Chrome / Samsung Internet switches focus to Google popup window
        env.setVisibilityState('hidden');

        await assert.rejects(
          () => rawIdbPersistence._get('firebase:authUser:test'),
          /Database is closing\/hidden/,
          'Confirms IndexedDBLocalPersistence throws literal "Database is closing/hidden" while parent tab is hidden'
        );
      } finally {
        rawIdbPersistence._removeListener('firebase:authUser:test', noopListener);
        if (rawIdbPersistence.pollTimer) {
          clearInterval(rawIdbPersistence.pollTimer);
          rawIdbPersistence.pollTimer = null;
        }
      }

      // B. Now verify that with [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
      // Auth selects browserLocalPersistence and persists the popup user even while parent tab is hidden!
      env.setVisibilityState('visible');
      const apiKey = 'AIzaSySamsungTabletPopupHiddenTabKey';
      const tabletApp = makeTestApp('samsung-tablet-hidden-tab', apiKey);
      const tabletAuth: any = registerAuthForCleanup(
        browserFirebaseAuth.initializeAuth(tabletApp, {
          popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver,
          persistence: [
            browserFirebaseAuth.browserLocalPersistence,
            browserFirebaseAuth.indexedDBLocalPersistence,
            browserFirebaseAuth.browserSessionPersistence,
          ],
        })
      );
      await tabletAuth.authStateReady();

      // Simulate Android hiding parent tab while popup is open and returning authenticated Google user
      env.setVisibilityState('hidden');
      const authStorageKey = `firebase:authUser:${apiKey}:${tabletApp.name}`;
      const signedInBlob = createPersistedFirebaseUserBlob(apiKey, tabletApp.name, 'uid-owner-tablet');

      await tabletAuth.persistenceManager.persistence._set(authStorageKey, signedInBlob);
      const readBackWhileHidden = await tabletAuth.persistenceManager.persistence._get(authStorageKey);

      assert.ok(readBackWhileHidden, 'browserLocalPersistence must read/write cleanly even while parent tab is hidden');
      assert.strictEqual(readBackWhileHidden.uid, 'uid-owner-tablet');
      assert.ok(env.localStorage.getItem(authStorageKey)?.includes('uid-owner-tablet'));
    } finally {
      await flushCreatedAuths();
      env.restore();
    }
  });

  it('4. Storage-unavailable fallback cascades cleanly: localStorage -> IndexedDB -> sessionStorage -> inMemory', async () => {
    // Case A: localStorage throws SecurityError -> falls back to indexedDBLocalPersistence
    const envNoLocal = installSimulatedBrowserEnvironment({ localStorageThrows: true });
    try {
      const apiKey = 'AIzaSyFallbackToIndexedDBKey';
      const appA = makeTestApp('fallback-idb', apiKey);
      const authA: any = registerAuthForCleanup(
        browserFirebaseAuth.initializeAuth(appA, {
          popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver,
          persistence: [
            browserFirebaseAuth.browserLocalPersistence,
            browserFirebaseAuth.indexedDBLocalPersistence,
            browserFirebaseAuth.browserSessionPersistence,
          ],
        })
      );
      await authA.authStateReady();
      assert.strictEqual(authA.persistenceManager.persistence.type, 'LOCAL');
      const keyA = `firebase:authUser:${apiKey}:${appA.name}`;
      const blobA = createPersistedFirebaseUserBlob(apiKey, appA.name, 'uid-fallback-idb');
      await authA.persistenceManager.persistence._set(keyA, blobA);
      assert.ok(envNoLocal.idb.stores.get('firebaseLocalStorage')?.has(keyA));
    } finally {
      await flushCreatedAuths();
      envNoLocal.restore();
    }

    // Case B: Both localStorage and IndexedDB unavailable -> falls back to browserSessionPersistence
    const envSessionOnly = installSimulatedBrowserEnvironment({
      localStorageThrows: true,
      indexedDBUnavailable: true,
    });
    try {
      const apiKey = 'AIzaSyFallbackToSessionStorageKey';
      const appB = makeTestApp('fallback-session', apiKey);
      const authB: any = registerAuthForCleanup(
        browserFirebaseAuth.initializeAuth(appB, {
          popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver,
          persistence: [
            browserFirebaseAuth.browserLocalPersistence,
            browserFirebaseAuth.indexedDBLocalPersistence,
            browserFirebaseAuth.browserSessionPersistence,
          ],
        })
      );
      await authB.authStateReady();
      assert.strictEqual(authB.persistenceManager.persistence.type, 'SESSION');
      const keyB = `firebase:authUser:${apiKey}:${appB.name}`;
      const blobB = createPersistedFirebaseUserBlob(apiKey, appB.name, 'uid-fallback-session');
      await authB.persistenceManager.persistence._set(keyB, blobB);
      assert.ok(envSessionOnly.sessionStorage.getItem(keyB)?.includes('uid-fallback-session'));
    } finally {
      await flushCreatedAuths();
      envSessionOnly.restore();
    }

    // Case C: All browser storages unavailable -> falls back safely to in-memory persistence (`NONE`)
    const envAllBlocked = installSimulatedBrowserEnvironment({
      localStorageThrows: true,
      sessionStorageThrows: true,
      indexedDBUnavailable: true,
    });
    try {
      const appC = makeTestApp('fallback-memory', 'AIzaSyFallbackToMemoryKey');
      const authC: any = registerAuthForCleanup(
        browserFirebaseAuth.initializeAuth(appC, {
          popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver,
          persistence: [
            browserFirebaseAuth.browserLocalPersistence,
            browserFirebaseAuth.indexedDBLocalPersistence,
            browserFirebaseAuth.browserSessionPersistence,
          ],
        })
      );
      await authC.authStateReady();
      assert.strictEqual(authC.persistenceManager.persistence.type, 'NONE');
    } finally {
      await flushCreatedAuths();
      envAllBlocked.restore();
    }
  });

  it('5. Error diagnostics produce specific actionable guidance for "Database is closing/hidden" without destructive advice', () => {
    // Plain Error thrown directly by IndexedDBLocalPersistence._openDb() (no .code property)
    const rawDbClosingErr = new Error('Database is closing/hidden');
    const diag1 = formatGoogleSignInError(rawDbClosingErr);

    assert.strictEqual(diag1.code, 'auth/indexeddb-closing-hidden');
    assert.notStrictEqual(diag1.title, 'Google sign-in failed');
    assert.strictEqual(diag1.title, 'Browser storage interrupted during sign-in');
    assert.ok(diag1.message.includes('Database is closing/hidden'));
    assert.ok(diag1.message.toLowerCase().includes('foreground'));
    assert.ok(diag1.tabletHint && diag1.tabletHint.includes('Samsung'));
    assert.strictEqual(
      diag1.tabletHint?.toLowerCase().includes('clear'),
      false,
      'Must NOT instruct users to clear site storage or wipe localStorage'
    );

    // Wrapped error carrying explicit non-generic Firebase code preserves that explicit code
    const explicitCodedErr = new Error('Firebase: Database is closing/hidden') as Error & { code: string };
    explicitCodedErr.code = 'auth/internal-error';
    const diag2 = formatGoogleSignInError(explicitCodedErr);
    assert.strictEqual(diag2.code, 'auth/internal-error');
    assert.strictEqual(diag2.title, 'Browser storage interrupted during sign-in');
    assert.ok(diag2.tabletHint?.includes('Samsung Internet'));
  });

  it('6. store.ts retains onAuthStateChanged unsubscribe handle, prevents duplicate observers across recheckAccess/reinit, and preserves Sign-Out -> Sign-In continuity', async () => {
    let totalSubscriptionsCreated = 0;
    let totalUnsubscribesCalled = 0;
    const activeCallbacks = new Set<{
      onNext: (u: { uid: string; email?: string | null } | null) => void | Promise<void>;
      onError?: (e: unknown) => void;
    }>();

    WorkspaceProvisioningService.setWorkspaceDiscoveryOverrideForTesting(async () => [
      {
        workspaceId: 'ws-main',
        role: 'owner',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const isolatedStorage = createMockWebStorage();
    let membershipValidationCalls = 0;

    store.configureAuthAndLockTestHarness({
      storage: isolatedStorage,
      membershipLookup: async (uid, wsId) => {
        membershipValidationCalls += 1;
        return {
          exists: uid === 'uid-owner-sunny' && wsId === 'ws-main',
          role: 'owner',
          active: true,
        };
      },
      workspaceDocLoader: async () => createWsMain(),
      authStateSubscriber: (onNext, onError) => {
        totalSubscriptionsCreated += 1;
        const entry = { onNext, onError };
        activeCallbacks.add(entry);
        return () => {
          if (activeCallbacks.delete(entry)) {
            totalUnsubscribesCalled += 1;
          }
        };
      },
    });

    // A. Repeated initFirebaseSync() calls are strictly idempotent (1 observer total)
    store.initFirebaseSync();
    store.initFirebaseSync();
    store.initFirebaseSync();
    assert.strictEqual(store.getActiveAuthObserverCountForTesting(), 1);
    assert.strictEqual(activeCallbacks.size, 1);
    assert.strictEqual(totalSubscriptionsCreated, 1);
    assert.strictEqual(totalUnsubscribesCalled, 0);

    // Capture the first (soon-to-be-detached) observer to ensure stale callbacks are ignored
    const staleEntry = Array.from(activeCallbacks)[0];

    // B. Repeated recheckAccess() while unauthenticated detaches previous observer BEFORE attaching replacement
    await store.recheckAccess();
    await store.recheckAccess();
    await store.recheckAccess();

    assert.strictEqual(store.getActiveAuthObserverCountForTesting(), 1);
    assert.strictEqual(
      activeCallbacks.size,
      1,
      'Must never accumulate duplicate onAuthStateChanged observers across recheckAccess()'
    );
    assert.strictEqual(totalSubscriptionsCreated, 4);
    assert.strictEqual(totalUnsubscribesCalled, 3);

    // Verify stale unsubscribed callback is ignored if invoked late
    await staleEntry.onNext({ uid: 'uid-owner-sunny', email: 'owner@sunnysweets.example' });
    assert.strictEqual(membershipValidationCalls, 0, 'Detached observer callback must be a strict no-op');

    // C. Active observer signs in -> resolves session exactly ONCE
    const currentEntry = Array.from(activeCallbacks)[0];
    await currentEntry.onNext({ uid: 'uid-owner-sunny', email: 'owner@sunnysweets.example' });

    assert.strictEqual(membershipValidationCalls, 1);
    assert.strictEqual(store.isAuthorized(), true);
    assert.strictEqual(store.getActiveWorkspaceId(), 'ws-main');
    assert.strictEqual(store.getAppAccessState(), 'AUTHORIZED_INTERNAL');

    // D. recheckAccess() while authenticated validates membership without detaching or duplicating auth observer
    await store.recheckAccess();
    assert.strictEqual(store.getActiveAuthObserverCountForTesting(), 1);
    assert.strictEqual(activeCallbacks.size, 1);
    assert.strictEqual(totalSubscriptionsCreated, 4);
    assert.strictEqual(store.isAuthorized(), true);

    // E. Sign-out followed by Sign-in in the same tab reuses the single observer seamlessly
    await currentEntry.onNext(null);
    assert.strictEqual(store.isAuthorized(), false);
    assert.strictEqual(store.getAppAccessState(), 'SIGNED_OUT');
    assert.strictEqual(store.getActiveAuthObserverCountForTesting(), 1);

    await currentEntry.onNext({ uid: 'uid-owner-sunny', email: 'owner@sunnysweets.example' });
    assert.strictEqual(store.isAuthorized(), true);
    assert.strictEqual(store.getAppAccessState(), 'AUTHORIZED_INTERNAL');
  });

  it('7. Preserves all application localStorage keys, Management PIN, Critical Production Notes, and ws-main access without regression', async () => {
    const salt = generateSalt();
    const pinHash = await hashPin('8426', salt);

    const protectedStorageSeed: Record<string, string> = {
      recipe_calc_critical_notes: JSON.stringify([
        {
          id: 'cpn-sunny-sweets-chocolate-chip-1oz',
          recipeId: 'rec-choc-chip',
          presetId: 'preset-1oz',
          workspaceId: 'ws-main',
          note: 'CRITICAL: 1 oz Chocolate Chip scoop specification.',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'cpn-sunny-sweets-chocolate-chip-2.5oz',
          recipeId: 'rec-choc-chip',
          presetId: 'preset-2.5oz',
          workspaceId: 'ws-main',
          note: 'CRITICAL: 2.5 oz Chocolate Chip chill specification.',
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ]),
      sunny_sweets_critical_notes_backup_v1: JSON.stringify({
        version: 1,
        updatedAt: '2026-10-20T00:00:00.000Z',
        records: { 'preset-1oz::rec-choc-chip': { note: 'Backed up note' } },
        decisions: {},
      }),
      SS_MGMT_LOCK_CONFIG: JSON.stringify({
        enabled: true,
        salt,
        hash: pinHash,
        updatedAt: '2026-10-20T00:00:00.000Z',
      }),
      recipe_calc_history: JSON.stringify([{ id: 'hist-keep-1', recipeName: 'Sugar Cookie' }]),
      recipe_calc_active_checklist: JSON.stringify({ recipeId: 'rec-choc-chip', checkedIds: ['ing-1'] }),
      recipe_calc_workspaces: JSON.stringify([createWsMain()]),
      recipe_calc_settings: JSON.stringify({ defaultWeightUnit: 'lb', activeWorkspaceId: 'ws-main' }),
    };

    const env = installSimulatedBrowserEnvironment({ localStorageSeed: protectedStorageSeed });
    try {
      const testApp = makeTestApp('preserve-all-keys');
      const authInstance = registerAuthForCleanup(
        browserFirebaseAuth.initializeAuth(testApp, {
          popupRedirectResolver: browserFirebaseAuth.browserPopupRedirectResolver,
          persistence: [
            browserFirebaseAuth.browserLocalPersistence,
            browserFirebaseAuth.indexedDBLocalPersistence,
            browserFirebaseAuth.browserSessionPersistence,
          ],
        })
      );
      await authInstance.authStateReady();

      // Verify every single seeded application key is byte-for-byte identical after Auth initialization
      for (const [key, expectedValue] of Object.entries(protectedStorageSeed)) {
        assert.strictEqual(
          env.localStorage.getItem(key),
          expectedValue,
          `Application localStorage key "${key}" must remain completely untouched`
        );
      }

      // Verify shared/local Management PIN policy continues to resolve and verify accurately
      const lockRes = resolveEffectiveManagementLock({
        workspace: createWsMain({ managementLock: { enabled: true, salt, hash: pinHash } }),
        workspaceDocHydrationState: 'READY',
        storageOverride: env.localStorage,
      });
      assert.strictEqual(lockRes.status, 'PROTECTED_WORKSPACE');
      assert.strictEqual(lockRes.isLockActive, true);
      assert.strictEqual(await verifyManagementPin('8426', lockRes.effectiveConfig), true);
      assert.strictEqual(await verifyManagementPin('0000', lockRes.effectiveConfig), false);

      // Verify desktop/mobile signInWithGoogle() popup path continues to resolve cleanly
      setGooglePopupExecutorForTesting(async () => ({
        uid: 'uid-owner-sunny',
        email: 'owner@sunnysweets.example',
      } as any));
      const signedInUser = await signInWithGoogle();
      assert.strictEqual(signedInUser.uid, 'uid-owner-sunny');
      assert.strictEqual(env.idb.getDeleteDatabaseCalls(), 0);
    } finally {
      await flushCreatedAuths();
      env.restore();
    }
  });
});
