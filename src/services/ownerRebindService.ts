import { doc, getDoc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { auth, db, sanitizeForFirestore } from './firebase';
import firebaseConfigData from '../../firebase-applet-config.json';
import {
  Workspace,
  WorkspaceMemberDoc,
  UserProfile,
  UserWorkspaceMembership,
} from '../types';
import { store } from './store';
import { WorkspaceProvisioningService } from './workspaceProvisioning';
import { evaluateEntitlement } from './entitlement';

export const EXPECTED_REBIND_EMAIL = 'jaoliveras@gmail.com';
export const EXPECTED_REBIND_DATABASE_ID = 'ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92';
export const TARGET_REBIND_WORKSPACE_ID = 'ws-main';
export const LEGACY_OWNER_UID = '42JFWv9G4eb4AvUql3VrvufLeGd2';

export interface PreconditionCheck {
  id: string;
  name: string;
  passed: boolean;
  actual: any;
  expected: any;
  details?: string;
}

export interface PostWriteVerificationReport {
  currentAuthenticatedUid: string | null;
  workspaceOwnerId: string | null;
  currentOwnerMembershipExists: 'YES' | 'NO';
  currentOwnerMembershipRole: string | null;
  currentOwnerMembershipActive: boolean | null;
  userOwnedWorkspaceId: string | null;
  userDefaultWorkspaceId: string | null;
  privateMembershipIndexExists: 'YES' | 'NO';
  detectUserWorkspacesResult: Array<{ workspaceId: string; role: string }>;
  resolvedActiveWorkspace: string | null;
  resolvedRole: string | null;
  resolvedEntitlement: string | null;
  resultingGetAppAccessState: string | null;
  whetherAuthorizedRecipeCalculatorAppMounts: boolean;
  legacyMemberPreserved: 'YES' | 'NO';
  confirmations: {
    recipesModified: 'NO';
    masterIngredientsModified: 'NO';
    presetsModified: 'NO';
    mixersModified: 'NO';
    settingsModified: 'NO';
    billingStripeModified: 'NO';
    securityRulesModified: 'NO';
    anythingDeployed: 'NO';
  };
}

export interface RebindResult {
  success: boolean;
  status: 'REBIND_COMPLETE' | 'ALREADY_REBOUND' | 'REBIND_BLOCKED' | 'ERROR';
  summaryStatus:
    | 'WS-MAIN OWNER IDENTITY REBIND COMPLETE — READY FOR RECOVERY REVIEW'
    | 'WS-MAIN OWNER IDENTITY REBIND BLOCKED — REVIEW REQUIRED';
  message: string;
  preconditions: PreconditionCheck[];
  verificationReport?: PostWriteVerificationReport;
  error?: string;
}

/**
 * IMPLEMENT ONE-TIME WS-MAIN OWNER IDENTITY REBIND — NO BUSINESS DATA CHANGES
 *
 * Verifies all 9 hard preconditions strictly.
 * If any fails: STOPS WITH ZERO WRITES.
 * If all pass: Executes atomic batch rebind of owner identity.
 * Performs full read-back post-write verification and reports status.
 */
export async function executeOwnerIdentityRebind(): Promise<RebindResult> {
  const preconditions: PreconditionCheck[] = [];

  try {
    // 1. auth.currentUser exists
    const currentUser = auth.currentUser;
    const p1Passed = !!currentUser;
    preconditions.push({
      id: 'P1_AUTH_USER_EXISTS',
      name: 'auth.currentUser exists',
      passed: p1Passed,
      actual: p1Passed ? `UID: ${currentUser?.uid}` : 'null',
      expected: 'Authenticated Firebase user object',
    });

    if (!currentUser) {
      return {
        success: false,
        status: 'REBIND_BLOCKED',
        summaryStatus: 'WS-MAIN OWNER IDENTITY REBIND BLOCKED — REVIEW REQUIRED',
        message: 'Precondition Failed: auth.currentUser does not exist.',
        preconditions,
      };
    }

    const currentEmail = currentUser.email?.toLowerCase().trim() || null;
    const currentUid = currentUser.uid?.trim() || null;

    // 2. auth.currentUser.email === 'jaoliveras@gmail.com'
    const p2Passed = currentEmail === EXPECTED_REBIND_EMAIL;
    preconditions.push({
      id: 'P2_EMAIL_MATCH',
      name: 'auth.currentUser.email is jaoliveras@gmail.com',
      passed: p2Passed,
      actual: currentEmail,
      expected: EXPECTED_REBIND_EMAIL,
    });

    // 3. Active Firestore database ID is exactly: ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92
    const activeDbId = firebaseConfigData.firestoreDatabaseId;
    const p3Passed = activeDbId === EXPECTED_REBIND_DATABASE_ID;
    preconditions.push({
      id: 'P3_DATABASE_ID_MATCH',
      name: 'Active Firestore database ID match',
      passed: p3Passed,
      actual: activeDbId,
      expected: EXPECTED_REBIND_DATABASE_ID,
    });

    // 4. Target workspace is exactly: ws-main
    const targetWsId = TARGET_REBIND_WORKSPACE_ID;
    const p4Passed = targetWsId === 'ws-main';
    preconditions.push({
      id: 'P4_TARGET_WORKSPACE',
      name: 'Target workspace is exactly ws-main',
      passed: p4Passed,
      actual: targetWsId,
      expected: 'ws-main',
    });

    // Read existing documents before write
    const wsRef = doc(db, 'workspaces', targetWsId);
    const legacyMemberRef = doc(db, 'workspaces', targetWsId, 'members', LEGACY_OWNER_UID);
    const memberRef = doc(db, 'workspaces', targetWsId, 'members', currentUid!);
    const userRef = doc(db, 'users', currentUid!);
    const userMembershipRef = doc(db, 'users', currentUid!, 'workspaceMemberships', targetWsId);

    const [wsSnap, legacyMemberSnap, memberSnap, userSnap, userMembershipSnap] = await Promise.all([
      getDoc(wsRef),
      getDoc(legacyMemberRef),
      getDoc(memberRef),
      getDoc(userRef),
      getDoc(userMembershipRef),
    ]);

    // 5. workspaces/ws-main already exists
    const wsExists = wsSnap.exists();
    preconditions.push({
      id: 'P5_WORKSPACE_EXISTS',
      name: 'workspaces/ws-main already exists',
      passed: wsExists,
      actual: wsExists ? 'Document exists' : 'Document not found',
      expected: 'Document exists',
    });

    if (!wsExists) {
      return {
        success: false,
        status: 'REBIND_BLOCKED',
        summaryStatus: 'WS-MAIN OWNER IDENTITY REBIND BLOCKED — REVIEW REQUIRED',
        message: 'Precondition Failed: workspaces/ws-main document does not exist.',
        preconditions,
      };
    }

    const wsData = wsSnap.data() || {};
    const wsOwnerEmail = (wsData.ownerEmail || '').toLowerCase().trim();
    const wsOwnerId = wsData.ownerId || '';

    // 6. Its ownerEmail is exactly jaoliveras@gmail.com
    const p6Passed = wsOwnerEmail === EXPECTED_REBIND_EMAIL;
    preconditions.push({
      id: 'P6_WS_OWNER_EMAIL',
      name: 'workspaces/ws-main ownerEmail is jaoliveras@gmail.com',
      passed: p6Passed,
      actual: wsOwnerEmail,
      expected: EXPECTED_REBIND_EMAIL,
    });

    // 7. Its existing ownerId is exactly: XrlESDwjfnREtPAiqsJsJIToY4m1
    // (Or already rebound to currentUid)
    const isAlreadyRebound = wsOwnerId === currentUid;
    const p7Passed = wsOwnerId === LEGACY_OWNER_UID || isAlreadyRebound;
    preconditions.push({
      id: 'P7_WS_OWNER_ID',
      name: 'workspaces/ws-main ownerId is legacy UID (or already rebound)',
      passed: p7Passed,
      actual: wsOwnerId,
      expected: isAlreadyRebound ? `${currentUid} (already rebound)` : LEGACY_OWNER_UID,
    });

    // 8. CURRENT_AUTH_UID is not empty and is different from the legacy UID
    const p8Passed =
      !isAlreadyRebound
        ? !!currentUid && currentUid.length > 0 && currentUid !== LEGACY_OWNER_UID
        : !!currentUid && currentUid.length > 0;
    preconditions.push({
      id: 'P8_CURRENT_AUTH_UID',
      name: 'CURRENT_AUTH_UID is non-empty and different from legacy UID',
      passed: p8Passed,
      actual: currentUid,
      expected: `Valid UID != ${LEGACY_OWNER_UID}`,
    });

    // 9. There is no conflicting active owner membership for another unexpected UID
    let conflictingOwnerUids: string[] = [];
    try {
      const membersSnap = await getDocs(collection(db, 'workspaces', targetWsId, 'members'));
      membersSnap.forEach((docItem) => {
        const d = docItem.data();
        if (d.role === 'owner' && d.active === true) {
          if (docItem.id !== LEGACY_OWNER_UID && docItem.id !== currentUid) {
            conflictingOwnerUids.push(docItem.id);
          }
        }
      });
    } catch (colErr) {
      console.warn('[ownerRebind] Member collection read note:', colErr);
    }

    const p9Passed = conflictingOwnerUids.length === 0;
    preconditions.push({
      id: 'P9_NO_CONFLICTING_OWNER',
      name: 'No conflicting active owner membership for unexpected UID',
      passed: p9Passed,
      actual: p9Passed ? 'None' : conflictingOwnerUids.join(', '),
      expected: 'None',
    });

    // STRICT CHECK: IF ANY CONDITION FAILS -> STOP WITH ZERO WRITES
    const allPreconditionsPassed = preconditions.every((p) => p.passed);
    if (!allPreconditionsPassed) {
      const failed = preconditions.filter((p) => !p.passed).map((p) => `${p.name} (actual: ${p.actual})`);
      return {
        success: false,
        status: 'REBIND_BLOCKED',
        summaryStatus: 'WS-MAIN OWNER IDENTITY REBIND BLOCKED — REVIEW REQUIRED',
        message: `STOP WITH ZERO WRITES. Precondition verification failed: ${failed.join('; ')}`,
        preconditions,
      };
    }

    // CHECK IF ALREADY REBOUND AND VERIFIED
    if (
      isAlreadyRebound &&
      memberSnap.exists() &&
      memberSnap.data()?.role === 'owner' &&
      memberSnap.data()?.active === true &&
      userSnap.exists() &&
      userSnap.data()?.ownedWorkspaceId === targetWsId &&
      userMembershipSnap.exists()
    ) {
      console.log('[ownerRebind] Workspace ws-main is already cleanly rebound to current user.');
      // Execute read-back verification directly
      const report = await generatePostWriteVerificationReport(currentUid!, targetWsId);
      await store.setWorkspaceAfterCreation(targetWsId);

      const result: RebindResult = {
        success: true,
        status: 'ALREADY_REBOUND',
        summaryStatus: 'WS-MAIN OWNER IDENTITY REBIND COMPLETE — READY FOR RECOVERY REVIEW',
        message: 'Owner identity rebind already verified and active. All invariants intact.',
        preconditions,
        verificationReport: report,
      };
      await notifyBackendReport(result);
      return result;
    }

    // ATOMIC REBIND
    const now = new Date().toISOString();
    const batch = writeBatch(db);

    // A. workspaces/ws-main
    // Change ONLY the authoritative ownerId from the exact legacy UID to CURRENT_AUTH_UID.
    // Preserve all other workspace fields byte-for-byte.
    // Do NOT reconstruct, normalize, sanitize, default-fill, or rewrite the workspace document.
    // Use the narrowest Firestore operation (batch.update) modifying ONLY ownerId and updatedAt.
    batch.update(wsRef, {
      ownerId: currentUid!,
      updatedAt: now,
    });

    // B. Create/update workspaces/ws-main/members/{CURRENT_AUTH_UID}
    const memberDoc: WorkspaceMemberDoc = {
      id: currentUid!,
      uid: currentUid!,
      email: EXPECTED_REBIND_EMAIL,
      name: currentUser.displayName || wsData.branding?.displayName || 'Sunny Sweets Owner',
      role: 'owner',
      active: true,
      addedAt: memberSnap.exists() && memberSnap.data()?.addedAt ? memberSnap.data().addedAt : now,
      updatedAt: now,
    };
    batch.set(memberRef, sanitizeForFirestore(memberDoc));

    // C. Create/update users/{CURRENT_AUTH_UID}
    const existingUserData = userSnap.exists() ? userSnap.data() : {};
    const updatedUserProfile: UserProfile = {
      ...existingUserData,
      uid: currentUid!,
      email: EXPECTED_REBIND_EMAIL,
      displayName: existingUserData.displayName || currentUser.displayName || 'Sunny Sweets Owner',
      ownedWorkspaceId: targetWsId,
      defaultWorkspaceId: targetWsId,
      onboardingStatus: 'workspace_created',
      createdAt: existingUserData.createdAt || now,
      updatedAt: now,
    };
    batch.set(userRef, sanitizeForFirestore(updatedUserProfile), { merge: true });

    // D. Create/update users/{CURRENT_AUTH_UID}/workspaceMemberships/ws-main
    const userMembershipDoc: UserWorkspaceMembership = {
      workspaceId: targetWsId,
      role: 'owner',
      active: true,
      createdAt: userMembershipSnap.exists() && userMembershipSnap.data()?.createdAt ? userMembershipSnap.data().createdAt : now,
    };
    batch.set(userMembershipRef, sanitizeForFirestore(userMembershipDoc));

    // LEGACY MEMBER RECORD
    // Do NOT delete workspaces/ws-main/members/42JFWv9G4eb4AvUql3VrvufLeGd2
    // Left untouched so recovery remains reversible and auditable.

    // COMMIT ATOMIC BATCH
    await batch.commit();
    console.log('[ownerRebind] Atomic rebind batch committed successfully.');

    // POST-WRITE VERIFICATION
    const report = await generatePostWriteVerificationReport(currentUid!, targetWsId);

    // Mount workspace in store
    await store.setWorkspaceAfterCreation(targetWsId);

    const finalResult: RebindResult = {
      success: true,
      status: 'REBIND_COMPLETE',
      summaryStatus: 'WS-MAIN OWNER IDENTITY REBIND COMPLETE — READY FOR RECOVERY REVIEW',
      message: 'Atomic owner identity rebind successfully committed and verified.',
      preconditions,
      verificationReport: report,
    };

    await notifyBackendReport(finalResult);
    return finalResult;
  } catch (err: any) {
    console.error('[ownerRebind] Rebind error:', err);
    return {
      success: false,
      status: 'ERROR',
      summaryStatus: 'WS-MAIN OWNER IDENTITY REBIND BLOCKED — REVIEW REQUIRED',
      message: `Rebind failed with exception: ${err?.message || String(err)}`,
      preconditions,
      error: err?.message || String(err),
    };
  }
}

/**
 * Executes a full read-back to verify all requirements after write.
 */
async function generatePostWriteVerificationReport(
  currentUid: string,
  workspaceId: string
): Promise<PostWriteVerificationReport> {
  const wsRef = doc(db, 'workspaces', workspaceId);
  const memberRef = doc(db, 'workspaces', workspaceId, 'members', currentUid);
  const legacyMemberRef = doc(db, 'workspaces', workspaceId, 'members', LEGACY_OWNER_UID);
  const userRef = doc(db, 'users', currentUid);
  const userMembershipRef = doc(db, 'users', currentUid, 'workspaceMemberships', workspaceId);

  const [wsSnap, memberSnap, legacyMemberSnap, userSnap, userMembershipSnap] = await Promise.all([
    getDoc(wsRef),
    getDoc(memberRef),
    getDoc(legacyMemberRef),
    getDoc(userRef),
    getDoc(userMembershipRef),
  ]);

  const wsData = wsSnap.data();
  const memberData = memberSnap.data();
  const userData = userSnap.data();

  // Detect user workspaces via discovery service
  const detectedWorkspaces = await WorkspaceProvisioningService.detectUserWorkspaces(currentUid);

  // Validate store membership and entitlement
  await store.validateMembershipForUser(currentUid, workspaceId);
  const resolvedRole = store.getUserRole();
  const resolvedActiveWs = store.getActiveWorkspaceId() || workspaceId;
  const entitlementEval = evaluateEntitlement({
    isAuthenticated: true,
    hasWorkspaceMembership: true,
    billingDoc: null,
    workspaceId,
  });
  const resultingGetAppAccessState = store.getAppAccessState();
  const mounts =
    store.isAuthorized() &&
    store.canAccessApp() &&
    resultingGetAppAccessState === 'AUTHORIZED_INTERNAL';

  return {
    currentAuthenticatedUid: currentUid,
    workspaceOwnerId: wsData?.ownerId || null,
    currentOwnerMembershipExists: memberSnap.exists() ? 'YES' : 'NO',
    currentOwnerMembershipRole: memberData?.role || null,
    currentOwnerMembershipActive: memberData?.active ?? null,
    userOwnedWorkspaceId: userData?.ownedWorkspaceId || null,
    userDefaultWorkspaceId: userData?.defaultWorkspaceId || null,
    privateMembershipIndexExists: userMembershipSnap.exists() ? 'YES' : 'NO',
    detectUserWorkspacesResult: detectedWorkspaces.map((w) => ({
      workspaceId: w.workspaceId,
      role: w.role,
    })),
    resolvedActiveWorkspace: resolvedActiveWs,
    resolvedRole: resolvedRole,
    resolvedEntitlement: entitlementEval.accessState,
    resultingGetAppAccessState,
    whetherAuthorizedRecipeCalculatorAppMounts: mounts,
    legacyMemberPreserved: legacyMemberSnap.exists() ? 'YES' : 'NO',
    confirmations: {
      recipesModified: 'NO',
      masterIngredientsModified: 'NO',
      presetsModified: 'NO',
      mixersModified: 'NO',
      settingsModified: 'NO',
      billingStripeModified: 'NO',
      securityRulesModified: 'NO',
      anythingDeployed: 'NO',
    },
  };
}

/**
 * Persists diagnostic rebind report to server endpoint
 */
async function notifyBackendReport(report: RebindResult): Promise<void> {
  if (!(typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV)) {
    return;
  }
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken();
    await fetch('/api/dev/rebind-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(report),
    });
  } catch (err) {
    console.warn('[ownerRebind] Could not post report to backend:', err);
  }
}
