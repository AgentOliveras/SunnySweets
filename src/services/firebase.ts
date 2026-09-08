import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  User,
  Auth,
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

const firebaseConfig = {
  apiKey: firebaseConfigData.apiKey,
  authDomain: firebaseConfigData.authDomain,
  projectId: firebaseConfigData.projectId,
  storageBucket: firebaseConfigData.storageBucket,
  messagingSenderId: firebaseConfigData.messagingSenderId,
  appId: firebaseConfigData.appId,
};

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(
  app,
  firebaseConfigData.firestoreDatabaseId || '(default)'
);
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

export async function signInWithGoogle(): Promise<User | null> {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    console.error('Google Sign-In Error:', err);
    return null;
  }
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

