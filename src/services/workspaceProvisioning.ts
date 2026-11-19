import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  BusinessType,
  UserProfile,
  UserWorkspaceMembership,
  Workspace,
  WorkspaceMemberDoc,
} from '../types';

export interface CreateWorkspaceParams {
  businessName: string;
  workspaceDisplayName?: string;
  userFullName?: string;
  businessType?: BusinessType;
}

export interface CreateWorkspaceResult {
  success: boolean;
  workspaceId: string;
  isExisting?: boolean;
}

/**
 * Service managing user onboarding, membership index discovery,
 * and atomic zero-trust customer workspace provisioning.
 */
export class WorkspaceProvisioningService {
  private static discoveryOverrideForTesting:
    | ((uid: string) => Promise<UserWorkspaceMembership[]>)
    | null = null;

  private static isDevOrTestRuntime(): boolean {
    return Boolean(
      (typeof process !== 'undefined' &&
        (process.env?.NODE_ENV === 'test' || Boolean(process.env?.NODE_TEST_CONTEXT))) ||
        (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.DEV)
    );
  }

  public static setWorkspaceDiscoveryOverrideForTesting(
    override: ((uid: string) => Promise<UserWorkspaceMembership[]>) | null
  ): void {
    if (!this.isDevOrTestRuntime()) return;
    this.discoveryOverrideForTesting = override;
  }

  /**
   * Discovers existing workspace memberships for an authenticated UID.
   * Uses the index at `users/{uid}/workspaceMemberships` to prevent global scans.
   * Includes backward-compatible fallback lookup for existing Sunny Sweets members.
   *
   * IMPORTANT RELIABILITY INVARIANT:
   * Genuine empty snapshots return `[]`, whereas Firestore connectivity / service
   * errors are rethrown so callers never mistake a transient read failure for `NO_WORKSPACE`.
   */
  public static async detectUserWorkspaces(uid: string): Promise<UserWorkspaceMembership[]> {
    if (!uid) return [];

    if (this.discoveryOverrideForTesting && this.isDevOrTestRuntime()) {
      return this.discoveryOverrideForTesting(uid);
    }

    // 1. Direct index lookup under users/{uid}/workspaceMemberships
    const membershipsRef = collection(db, 'users', uid, 'workspaceMemberships');
    const membershipsSnap = await getDocs(membershipsRef);
    const memberships: UserWorkspaceMembership[] = [];

    membershipsSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.workspaceId && data.active === true) {
        memberships.push({
          workspaceId: data.workspaceId,
          role: data.role || 'viewer',
          active: true,
          createdAt: data.createdAt || new Date().toISOString(),
        });
      }
    });

    if (memberships.length > 0) {
      return memberships;
    }

    // 2. Sunny Sweets (ws-main) compatibility check for existing founding members
    const wsMainMemberRef = doc(db, 'workspaces', 'ws-main', 'members', uid);
    const wsMainMemberSnap = await getDoc(wsMainMemberRef);

    if (wsMainMemberSnap.exists()) {
      const data = wsMainMemberSnap.data();
      if (data && data.active === true) {
        const role = (data.role as any) || 'viewer';
        const membership: UserWorkspaceMembership = {
          workspaceId: 'ws-main',
          role,
          active: true,
          createdAt: data.addedAt || new Date().toISOString(),
        };

        // Self-heal index in background (non-fatal if write fails)
        try {
          await setDoc(doc(db, 'users', uid, 'workspaceMemberships', 'ws-main'), membership, { merge: true });
          await setDoc(
            doc(db, 'users', uid),
            {
              uid,
              email: auth.currentUser?.email || '',
              displayName: auth.currentUser?.displayName || '',
              defaultWorkspaceId: 'ws-main',
              onboardingStatus: 'workspace_created',
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (healErr) {
          console.warn('[WorkspaceProvisioningService] Index self-heal note:', healErr);
        }

        return [membership];
      }
    }

    return [];
  }

  /**
   * Retrieves or builds baseline user profile
   */
  public static async getUserProfile(uid: string): Promise<UserProfile | null> {
    if (!uid) return null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        return snap.data() as UserProfile;
      }
      return null;
    } catch (err) {
      console.warn('[WorkspaceProvisioningService] getUserProfile note:', err);
      return null;
    }
  }

  /**
   * Generates a stable, unique, non-predictable workspace ID.
   * Never uses ws-main, email address, business name, or Firebase UID.
   */
  public static generateWorkspaceId(): string {
    const autoId = doc(collection(db, 'workspaces')).id;
    return `ws_${autoId}`;
  }

  /**
   * Atomically provisions a new customer workspace with owner membership and user index.
   * Strictly enforces:
   * 1. Authenticated user required
   * 2. Duplicate workspace prevention
   * 3. Atomic batch commit (no partial / orphan records)
   * 4. Initial pre-entitlement state (NO billing/trial activated here)
   */
  public static async createCustomerWorkspace(
    params: CreateWorkspaceParams
  ): Promise<CreateWorkspaceResult> {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.uid) {
      throw new Error('Authentication required to create a workspace.');
    }

    const uid = currentUser.uid;
    const normalizedEmail = (currentUser.email || '').toLowerCase().trim();

    const businessName = params.businessName?.trim();
    if (!businessName || businessName.length < 2) {
      throw new Error('Please enter a valid business name (minimum 2 characters).');
    }

    const workspaceDisplayName =
      params.workspaceDisplayName?.trim() || businessName;
    const userFullName =
      params.userFullName?.trim() || currentUser.displayName || 'Bakery Owner';

    // Authoritative duplicate workspace prevention: Check existing profile ownership
    const userProfile = await this.getUserProfile(uid);
    if (userProfile?.ownedWorkspaceId) {
      console.warn(`[WorkspaceProvisioning] User ${uid} already owns workspace ${userProfile.ownedWorkspaceId}`);
      return {
        success: true,
        workspaceId: userProfile.ownedWorkspaceId,
        isExisting: true,
      };
    }

    // Duplicate workspace prevention check: User index discovery
    const existingWorkspaces = await this.detectUserWorkspaces(uid);
    if (existingWorkspaces.length > 0) {
      const primaryWsId = existingWorkspaces[0].workspaceId;
      console.warn(`[WorkspaceProvisioning] User ${uid} already has workspace ${primaryWsId}`);
      return {
        success: true,
        workspaceId: primaryWsId,
        isExisting: true,
      };
    }

    // Generate unique workspace ID
    const workspaceId = this.generateWorkspaceId();
    const now = new Date().toISOString();

    // 1. Root Workspace Document
    const workspaceDoc: Workspace = {
      id: workspaceId,
      name: businessName,
      ownerId: uid,
      ownerEmail: normalizedEmail,
      code: workspaceId.toUpperCase(),
      members: [],
      groups: [],
      branding: {
        displayName: workspaceDisplayName,
        paletteId: 'warm-bakery',
        logoUrl: undefined,
        logoStoragePath: undefined,
      },
      businessType: params.businessType || 'Bakery',
      createdAt: now,
      updatedAt: now,
    };

    // 2. Owner Member Document in workspaces/{workspaceId}/members/{uid}
    const memberDoc: WorkspaceMemberDoc = {
      uid,
      email: normalizedEmail,
      name: userFullName,
      role: 'owner',
      active: true,
      addedAt: now,
      updatedAt: now,
    };

    // 3. User Membership Index in users/{uid}/workspaceMemberships/{workspaceId}
    const membershipIndexDoc: UserWorkspaceMembership = {
      workspaceId,
      role: 'owner',
      active: true,
      createdAt: now,
    };

    // 4. User Profile Document in users/{uid} (atomically binds ownedWorkspaceId)
    const userProfileDoc: UserProfile = {
      uid,
      email: normalizedEmail,
      displayName: userFullName,
      defaultWorkspaceId: workspaceId,
      ownedWorkspaceId: workspaceId,
      onboardingStatus: 'workspace_created',
      createdAt: now,
      updatedAt: now,
    };

    // Execute atomic batch commit
    try {
      const batch = writeBatch(db);

      // Write workspace document
      batch.set(doc(db, 'workspaces', workspaceId), workspaceDoc);

      // Write owner member document
      batch.set(doc(db, 'workspaces', workspaceId, 'members', uid), memberDoc);

      // Write user membership index
      batch.set(
        doc(db, 'users', uid, 'workspaceMemberships', workspaceId),
        membershipIndexDoc
      );

      // Write / update user profile
      batch.set(doc(db, 'users', uid), userProfileDoc, { merge: true });

      // Atomic commit
      await batch.commit();

      return {
        success: true,
        workspaceId,
      };
    } catch (batchErr) {
      console.error('[WorkspaceProvisioning] Atomic batch creation failed:', batchErr);
      throw new Error(
        'Your workspace could not be created. No account data was lost. Please try again.'
      );
    }
  }
}
