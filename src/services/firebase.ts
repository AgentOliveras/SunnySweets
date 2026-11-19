import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  browserPopupRedirectResolver,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  User,
  Auth,
  Persistence,
  PopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import {
  getStorage,
  FirebaseStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import firebaseConfigData from '../../firebase-applet-config.json';

// Section 8: Verify required VITE_* or config JSON Firebase environment parameters
const envMeta = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
const effectiveApiKey = envMeta.VITE_FIREBASE_API_KEY || firebaseConfigData.apiKey;
const effectiveAuthDomain = envMeta.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigData.authDomain;
const effectiveProjectId = envMeta.VITE_FIREBASE_PROJECT_ID || firebaseConfigData.projectId;
const effectiveAppId = envMeta.VITE_FIREBASE_APP_ID || firebaseConfigData.appId;

const firebaseConfig = {
  apiKey: effectiveApiKey,
  authDomain: effectiveAuthDomain,
  projectId: effectiveProjectId,
  storageBucket: envMeta.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigData.storageBucket,
  messagingSenderId: envMeta.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigData.messagingSenderId,
  appId: effectiveAppId,
};

let app: FirebaseApp;
try {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
} catch (initErr) {
  console.error('[Firebase] initializeApp error:', initErr);
  throw initErr;
}

export const BROWSER_AUTH_PERSISTENCE_HIERARCHY: Persistence[] = [
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserSessionPersistence,
];

export interface FirebaseAuthInitDependencies {
  isBrowserRuntime?: boolean;
  initializeAuthFn?: typeof initializeAuth;
  getAuthFn?: typeof getAuth;
  popupRedirectResolver?: PopupRedirectResolver;
  persistence?: Persistence[];
}

/**
 * Detects whether the current runtime supports browser Auth initialization.
 * In Node test environments (`@firebase/auth` node-esm entry), `window` is undefined
 * and `browserPopupRedirectResolver` is a non-callable sentinel error object.
 */
export function isBrowserAuthRuntime(
  resolverCandidate: unknown = browserPopupRedirectResolver
): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof resolverCandidate === 'function'
  );
}

/**
 * Resolves the singleton Firebase Auth instance for a FirebaseApp:
 * - Browser: single `initializeAuth` call prioritizing `browserLocalPersistence`,
 *   followed by `indexedDBLocalPersistence` (for existing session discovery/migration)
 *   and `browserSessionPersistence`, with `browserPopupRedirectResolver`.
 * - Node / already-initialized fallback: `getAuth(targetApp)` with zero duplicate instances.
 */
export function initializeFirebaseAuthSingleton(
  targetApp: FirebaseApp,
  deps?: FirebaseAuthInitDependencies
): Auth {
  const resolver = deps?.popupRedirectResolver ?? browserPopupRedirectResolver;
  const useBrowserInit =
    deps?.isBrowserRuntime !== undefined ? deps.isBrowserRuntime : isBrowserAuthRuntime(resolver);
  const initAuthFn = deps?.initializeAuthFn ?? initializeAuth;
  const getAuthFn = deps?.getAuthFn ?? getAuth;
  const persistence = deps?.persistence ?? BROWSER_AUTH_PERSISTENCE_HIERARCHY;

  if (useBrowserInit) {
    try {
      return initAuthFn(targetApp, {
        popupRedirectResolver: resolver,
        persistence,
      });
    } catch (browserAuthErr: unknown) {
      const errCode =
        browserAuthErr && typeof browserAuthErr === 'object' && 'code' in browserAuthErr
          ? String((browserAuthErr as { code?: unknown }).code)
          : '';
      if (errCode === 'auth/already-initialized') {
        return getAuthFn(targetApp);
      }
      throw browserAuthErr;
    }
  }

  return getAuthFn(targetApp);
}

let authInstance: Auth;
try {
  if (isBrowserAuthRuntime()) {
    try {
      authInstance = initializeAuth(app, {
        popupRedirectResolver: browserPopupRedirectResolver,
        persistence: [
          browserLocalPersistence,
          indexedDBLocalPersistence,
          browserSessionPersistence,
        ],
      });
    } catch (browserInitErr: unknown) {
      const code =
        browserInitErr && typeof browserInitErr === 'object' && 'code' in browserInitErr
          ? String((browserInitErr as { code?: unknown }).code)
          : '';
      if (code === 'auth/already-initialized') {
        authInstance = getAuth(app);
      } else {
        throw browserInitErr;
      }
    }
  } else {
    authInstance = getAuth(app);
  }
} catch (authErr) {
  console.error('[Firebase] getAuth error:', authErr);
  throw authErr;
}
export const auth: Auth = authInstance;

let firestoreInstance: Firestore;
try {
  firestoreInstance = getFirestore(
    app,
    firebaseConfigData.firestoreDatabaseId || '(default)'
  );
} catch (fsErr) {
  console.error('[Firebase] getFirestore error:', fsErr);
  throw fsErr;
}
export const db: Firestore = firestoreInstance;

export const storage: FirebaseStorage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as unknown as T;
  }
  return data;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  return errInfo;
}

type GooglePopupExecutor = () => Promise<User>;

let signInInFlightPromise: Promise<User> | null = null;
let customPopupExecutorForTesting: GooglePopupExecutor | null = null;

function isDevOrTestRuntime(): boolean {
  return Boolean(
    (typeof process !== 'undefined' &&
      (process.env?.NODE_ENV === 'test' || Boolean(process.env?.NODE_TEST_CONTEXT))) ||
      (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV)
  );
}

/**
 * Automated testing hook (strictly disabled in production builds) to simulate
 * Google popup resolution, rejection with specific FirebaseError codes, and
 * concurrent double-tap calls without opening real browser windows.
 */
export function setGooglePopupExecutorForTesting(executor: GooglePopupExecutor | null): void {
  if (!isDevOrTestRuntime()) {
    return;
  }
  customPopupExecutorForTesting = executor;
  signInInFlightPromise = null;
}

export function isGoogleSignInInFlight(): boolean {
  return signInInFlightPromise !== null;
}

export async function signInWithGoogle(): Promise<User> {
  if (signInInFlightPromise) {
    return signInInFlightPromise;
  }

  signInInFlightPromise = (async () => {
    try {
      if (customPopupExecutorForTesting && isDevOrTestRuntime()) {
        const mockedUser = await customPopupExecutorForTesting();
        if (!mockedUser) {
          const emptyErr = new Error('Google sign-in completed without returning an authenticated user.');
          (emptyErr as Error & { code: string }).code = 'auth/null-user-credential';
          throw emptyErr;
        }
        return mockedUser;
      }

      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (!result || !result.user) {
        const emptyErr = new Error('Google sign-in completed without returning an authenticated user.');
        (emptyErr as Error & { code: string }).code = 'auth/null-user-credential';
        throw emptyErr;
      }
      return result.user;
    } catch (err) {
      console.error('Google Sign-In Error:', err);
      throw err;
    } finally {
      signInInFlightPromise = null;
    }
  })();

  return signInInFlightPromise;
}

export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Sign Out Error:', err);
  }
}

/**
 * Upload workspace logo to workspace-specific storage path:
 * workspace-logos/{workspaceId}/logo_{timestamp}.{ext}
 */
export async function uploadWorkspaceLogoToStorage(
  workspaceId: string,
  file: File
): Promise<{ downloadUrl: string; storagePath: string }> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to upload workspace logos.');
  }

  const rawExt = file.name.split('.').pop()?.toLowerCase() || 'png';
  const cleanExt = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const storagePath = `workspace-logos/${workspaceId}/logo_${Date.now()}.${cleanExt}`;
  const fileRef = storageRef(storage, storagePath);

  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type,
    customMetadata: {
      workspaceId,
      uploadedBy: auth.currentUser.uid,
      uploadedAt: new Date().toISOString(),
    },
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);
  return { downloadUrl, storagePath };
}

/**
 * Delete workspace logo from storage if it exists.
 */
export async function deleteWorkspaceLogoFromStorage(storagePath: string): Promise<void> {
  if (!storagePath) return;
  try {
    const fileRef = storageRef(storage, storagePath);
    await deleteObject(fileRef);
  } catch (err) {
    console.warn('Workspace logo deletion note (file may already be removed):', err);
  }
}

