import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { auth, db, sanitizeForFirestore } from './firebase';
import firebaseConfigData from '../../firebase-applet-config.json';
import { Workspace, WorkspaceMemberDoc, UserProfile, UserWorkspaceMembership } from '../types';
import { store } from './store';
import {
  executeOwnerIdentityRebind,
  LEGACY_OWNER_UID,
  RebindResult,
} from './ownerRebindService';

export interface BootstrapResult {
  success: boolean;
  status:
    | 'BOOTSTRAP_COMPLETE'
    | 'ALREADY_BOOTSTRAPPED'
    | 'BLOCKED_WRONG_USER'
    | 'BLOCKED_WRONG_DATABASE'
    | 'BLOCKED_EXISTING_DATA'
    | 'BLOCKED_ERROR';
  message: string;
  authenticatedEmail: string | null;
  authenticatedUid: string | null;
  databaseId: string;
  documentsCreated: Array<{
    path: string;
    purpose: string;
    fields: Record<string, any>;
  }>;
  existingState?: Record<string, any>;
  rebindReport?: RebindResult;
}

export const EXPECTED_BOOTSTRAP_EMAIL = 'jaoliveras@gmail.com';
export const EXPECTED_BOOTSTRAP_DATABASE_ID = 'ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92';
export const TARGET_BOOTSTRAP_WORKSPACE_ID = 'ws-main';
export const LEGACY_SUNNY_SWEETS_OWNER_UID = LEGACY_OWNER_UID;
export { executeOwnerIdentityRebind };

/**
 * DEVELOPMENT WS-MAIN BOOTSTRAP SERVICE
 *
 * Implements strict, read-before-write, atomic initialization of the Sunny Sweets
 * development workspace (ws-main) in the isolated development Firestore database.
 */
export async function executeDevWsMainBootstrap(): Promise<BootstrapResult> {
  // 1. FIRST VERIFY CURRENT USER
  const currentUser = auth.currentUser;
  const currentEmail = currentUser?.email?.toLowerCase().trim() || null;
  const currentUid = currentUser?.uid || null;

  if (!currentUser || !currentEmail || !currentUid) {
    return {
      success: false,
      status: 'BLOCKED_WRONG_USER',
      message: 'BOOTSTRAP BLOCKED — NO AUTHENTICATED USER DETECTED',
      authenticatedEmail: currentEmail,
      authenticatedUid: currentUid,
      databaseId: firebaseConfigData.firestoreDatabaseId,
      documentsCreated: [],
    };
  }

  if (currentEmail !== EXPECTED_BOOTSTRAP_EMAIL) {
    return {
      success: false,
      status: 'BLOCKED_WRONG_USER',
      message: 'BOOTSTRAP BLOCKED — WRONG AUTHENTICATED USER',
      authenticatedEmail: currentEmail,
      authenticatedUid: currentUid,
      databaseId: firebaseConfigData.firestoreDatabaseId,
      documentsCreated: [],
    };
  }

  // 2. TARGET DATABASE SAFETY CHECK
  const activeDatabaseId = firebaseConfigData.firestoreDatabaseId;
  if (activeDatabaseId !== EXPECTED_BOOTSTRAP_DATABASE_ID) {
    return {
      success: false,
      status: 'BLOCKED_WRONG_DATABASE',
      message: `BOOTSTRAP BLOCKED — UNEXPECTED DATABASE ID: "${activeDatabaseId}". Expected: "${EXPECTED_BOOTSTRAP_DATABASE_ID}". Aborting to prevent modifying production database.`,
      authenticatedEmail: currentEmail,
      authenticatedUid: currentUid,
      databaseId: activeDatabaseId,
      documentsCreated: [],
    };
  }

  // 3. CHECK FOR EXISTING STATE (Read-Before-Write)
  const wsRef = doc(db, 'workspaces', TARGET_BOOTSTRAP_WORKSPACE_ID);
  const memberRef = doc(db, 'workspaces', TARGET_BOOTSTRAP_WORKSPACE_ID, 'members', currentUid);
  const userRef = doc(db, 'users', currentUid);
  const userMembershipRef = doc(db, 'users', currentUid, 'workspaceMemberships', TARGET_BOOTSTRAP_WORKSPACE_ID);

  const [wsSnap, memberSnap, userSnap, membershipSnap] = await Promise.all([
    getDoc(wsRef),
    getDoc(memberRef),
    getDoc(userRef),
    getDoc(userMembershipRef),
  ]);

  const existingStateReport = {
    workspaceExists: wsSnap.exists(),
    workspaceData: wsSnap.exists() ? wsSnap.data() : null,
    memberExists: memberSnap.exists(),
    memberData: memberSnap.exists() ? memberSnap.data() : null,
    userProfileExists: userSnap.exists(),
    userProfileData: userSnap.exists() ? userSnap.data() : null,
    userMembershipExists: membershipSnap.exists(),
    userMembershipData: membershipSnap.exists() ? membershipSnap.data() : null,
  };

  // If already properly bootstrapped for this exact user
  if (
    wsSnap.exists() &&
    wsSnap.data()?.ownerId === currentUid &&
    memberSnap.exists() &&
    memberSnap.data()?.role === 'owner' &&
    memberSnap.data()?.active === true &&
    userSnap.exists() &&
    userSnap.data()?.ownedWorkspaceId === TARGET_BOOTSTRAP_WORKSPACE_ID &&
    membershipSnap.exists()
  ) {
    // Already bootstrapped! Restart workspace discovery
    await store.setWorkspaceAfterCreation(TARGET_BOOTSTRAP_WORKSPACE_ID);
    return {
      success: true,
      status: 'ALREADY_BOOTSTRAPPED',
      message: 'Workspace ws-main already cleanly initialized for jaoliveras@gmail.com.',
      authenticatedEmail: currentEmail,
      authenticatedUid: currentUid,
      databaseId: activeDatabaseId,
      documentsCreated: [],
      existingState: existingStateReport,
    };
  }

  // If historical legacy owner UID is detected on ws-main, do NOT automatically rebind or overwrite
  if (wsSnap.exists() && wsSnap.data()?.ownerId === LEGACY_OWNER_UID) {
    return {
      success: false,
      status: 'BLOCKED_EXISTING_DATA',
      message:
        'Historical ws-main owner UID detected (42JFWv9G4eb4AvUql3VrvufLeGd2). Automatic rebind/bootstrap is disabled. Please click "Execute Owner Identity Rebind" to manually rebind ownership.',
      authenticatedEmail: currentEmail,
      authenticatedUid: currentUid,
      databaseId: activeDatabaseId,
      documentsCreated: [],
      existingState: existingStateReport,
    };
  }

  // If other unexpected existing documents with conflicting owners are found, STOP before overwriting
  if (
    (wsSnap.exists() && wsSnap.data()?.ownerId && wsSnap.data()?.ownerId !== currentUid) ||
    (userSnap.exists() && userSnap.data()?.ownedWorkspaceId && userSnap.data()?.ownedWorkspaceId !== TARGET_BOOTSTRAP_WORKSPACE_ID)
  ) {
    return {
      success: false,
      status: 'BLOCKED_EXISTING_DATA',
      message: 'BOOTSTRAP BLOCKED — UNEXPECTED EXISTING DOCUMENTS DETECTED. Review required before overwriting.',
      authenticatedEmail: currentEmail,
      authenticatedUid: currentUid,
      databaseId: activeDatabaseId,
      documentsCreated: [],
      existingState: existingStateReport,
    };
  }

  // 4, 5, 6, 7. ATOMIC BATCH WRITE
  const now = new Date().toISOString();
  const displayName = currentUser.displayName || 'Sunny Sweets Owner';

  // 4. workspaces/ws-main
  const wsDoc: Workspace = {
    id: TARGET_BOOTSTRAP_WORKSPACE_ID,
    name: 'Sunny Sweets',
    ownerId: currentUid,
    ownerEmail: currentEmail,
    code: 'SUNNY-SWEETS-DEV',
    members: [],
    groups: [],
    branding: {
      displayName: 'Sunny Sweets',
      paletteId: 'warm-bakery',
      logoUrl: undefined,
      logoStoragePath: undefined,
    },
    businessType: 'Bakery',
    createdAt: now,
    updatedAt: now,
  };

  // 5. workspaces/ws-main/members/{currentUid}
  const memberDoc: WorkspaceMemberDoc = {
    id: currentUid,
    uid: currentUid,
    email: currentEmail,
    name: displayName,
    role: 'owner',
    active: true,
    addedAt: now,
    updatedAt: now,
  };

  // 6. users/{currentUid}/workspaceMemberships/ws-main
  const membershipDoc: UserWorkspaceMembership = {
    workspaceId: TARGET_BOOTSTRAP_WORKSPACE_ID,
    role: 'owner',
    active: true,
    createdAt: now,
  };

  // 7. users/{currentUid}
  const userProfileDoc: UserProfile = {
    uid: currentUid,
    email: currentEmail,
    displayName: displayName,
    defaultWorkspaceId: TARGET_BOOTSTRAP_WORKSPACE_ID,
    ownedWorkspaceId: TARGET_BOOTSTRAP_WORKSPACE_ID,
    onboardingStatus: 'workspace_created',
    createdAt: userSnap.exists() && userSnap.data()?.createdAt ? userSnap.data().createdAt : now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(wsRef, sanitizeForFirestore(wsDoc));
  batch.set(memberRef, sanitizeForFirestore(memberDoc));
  batch.set(userMembershipRef, sanitizeForFirestore(membershipDoc));
  batch.set(userRef, sanitizeForFirestore(userProfileDoc), { merge: true });

  await batch.commit();

  const documentsCreated = [
    {
      path: `workspaces/${TARGET_BOOTSTRAP_WORKSPACE_ID}`,
      purpose: 'Root workspace document for Sunny Sweets development instance',
      fields: {
        id: TARGET_BOOTSTRAP_WORKSPACE_ID,
        name: 'Sunny Sweets',
        ownerId: currentUid,
        ownerEmail: currentEmail,
        code: 'SUNNY-SWEETS-DEV',
        businessType: 'Bakery',
        'branding.displayName': 'Sunny Sweets',
        'branding.paletteId': 'warm-bakery',
      },
    },
    {
      path: `workspaces/${TARGET_BOOTSTRAP_WORKSPACE_ID}/members/${currentUid}`,
      purpose: 'Owner membership record granting full access to jaoliveras@gmail.com',
      fields: {
        uid: currentUid,
        email: currentEmail,
        name: displayName,
        role: 'owner',
        active: true,
      },
    },
    {
      path: `users/${currentUid}/workspaceMemberships/${TARGET_BOOTSTRAP_WORKSPACE_ID}`,
      purpose: 'User workspace membership discovery index',
      fields: {
        workspaceId: TARGET_BOOTSTRAP_WORKSPACE_ID,
        role: 'owner',
        active: true,
      },
    },
    {
      path: `users/${currentUid}`,
      purpose: 'User profile with defaultWorkspaceId and ownedWorkspaceId binding',
      fields: {
        uid: currentUid,
        email: currentEmail,
        displayName: displayName,
        defaultWorkspaceId: TARGET_BOOTSTRAP_WORKSPACE_ID,
        ownedWorkspaceId: TARGET_BOOTSTRAP_WORKSPACE_ID,
        onboardingStatus: 'workspace_created',
      },
    },
  ];

  // 10. RESTART WORKSPACE DISCOVERY
  await store.setWorkspaceAfterCreation(TARGET_BOOTSTRAP_WORKSPACE_ID);

  const report: BootstrapResult = {
    success: true,
    status: 'BOOTSTRAP_COMPLETE',
    message: 'DEVELOPMENT WS-MAIN BOOTSTRAP COMPLETE — READY FOR DATA CLONE REVIEW',
    authenticatedEmail: currentEmail,
    authenticatedUid: currentUid,
    databaseId: activeDatabaseId,
    documentsCreated,
    existingState: existingStateReport,
  };

  // Inform backend dev endpoint for diagnostic persistence (dev mode only, authenticated)
  if (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV) {
    try {
      const idToken = await currentUser.getIdToken();
      await fetch('/api/dev/bootstrap-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(report),
      });
    } catch (logErr) {
      console.warn('[devBootstrap] Could not notify backend:', logErr);
    }
  }

  return report;
}
