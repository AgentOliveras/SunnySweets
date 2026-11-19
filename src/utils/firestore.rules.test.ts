/**
 * Policy Simulation Unit Tests: Zero-Trust & Invariant Policy Checks
 *
 * NOTE: This is an in-memory JavaScript simulation test harness used for
 * browser-side policy logic regression testing. It evaluates invariants in memory.
 * It does NOT execute against the live Firebase Firestore Emulator.
 * For official Firestore Emulator testing, see `tests/firestore.rules.spec.ts`.
 */

export interface SecurityTestCaseResult {
  id: string;
  name: string;
  category: 'dirty_dozen' | 'valid_access';
  expectedResult: 'DENY' | 'ALLOW';
  actualResult: 'DENY' | 'ALLOW';
  passed: boolean;
  threatMitigation: string;
  details: string;
}

export interface SecurityContext {
  auth: {
    uid: string;
    email: string;
  } | null;
  workspaceId?: string;
  role?: 'owner' | 'editor' | 'viewer';
}

/**
 * Pure policy evaluation engine simulating Firestore Zero-Trust Rules in memory
 */
export class PolicySimulationEngine {
  private membersDb: Map<
    string,
    { role: 'owner' | 'editor' | 'viewer'; email: string; active?: boolean }
  > = new Map();
  private workspacesDb: Map<string, { ownerId: string; name: string }> = new Map();
  private usersDb: Map<string, { uid: string; email: string; ownedWorkspaceId?: string | null; trialConsumedForOwnedWorkspace?: boolean }> = new Map();

  constructor() {
    // Seed initial test state (all seeded members have active: true)
    this.workspacesDb.set('ws-main', { ownerId: 'uid-owner-1', name: 'Sunny Sweets Main' });
    this.workspacesDb.set('ws-bakery-b', { ownerId: 'uid-owner-2', name: 'Other Bakery' });

    this.membersDb.set('ws-main/members/uid-owner-1', {
      role: 'owner',
      email: 'owner@sunnysweets.com',
      active: true,
    });
    this.membersDb.set('ws-main/members/uid-editor-1', {
      role: 'editor',
      email: 'baker@sunnysweets.com',
      active: true,
    });
    this.membersDb.set('ws-main/members/uid-viewer-1', {
      role: 'viewer',
      email: 'viewer@sunnysweets.com',
      active: true,
    });

    this.membersDb.set('ws-bakery-b/members/uid-user-b', {
      role: 'editor',
      email: 'user@otherbakery.com',
      active: true,
    });

    this.usersDb.set('uid-owner-1', { uid: 'uid-owner-1', email: 'owner@sunnysweets.com', ownedWorkspaceId: 'ws-main' });
    this.usersDb.set('uid-owner-2', { uid: 'uid-owner-2', email: 'user@otherbakery.com', ownedWorkspaceId: 'ws-bakery-b' });
  }

  public setMember(
    wsId: string,
    uid: string,
    role: 'owner' | 'editor' | 'viewer',
    email: string,
    active: boolean = true
  ) {
    this.membersDb.set(`${wsId}/members/${uid}`, { role, email, active });
  }

  public setRawMemberForTesting(
    wsId: string,
    uid: string,
    record: { role?: any; email?: string; active?: any } | null
  ) {
    const key = `${wsId}/members/${uid}`;
    if (record === null) {
      this.membersDb.delete(key);
    } else {
      this.membersDb.set(key, record as any);
    }
  }

  public setWorkspace(wsId: string, ownerId: string, name: string) {
    this.workspacesDb.set(wsId, { ownerId, name });
  }

  public setUser(uid: string, profile: { uid: string; email: string; ownedWorkspaceId?: string | null; trialConsumedForOwnedWorkspace?: boolean }) {
    this.usersDb.set(uid, profile);
  }

  private getActiveMemberRole(wsId: string | undefined, uid: string): 'owner' | 'editor' | 'viewer' | null {
    if (!wsId) return null;
    const rec = this.membersDb.get(`${wsId}/members/${uid}`);
    if (!rec) return null;
    if (rec.active !== true) return null;
    if (rec.role !== 'owner' && rec.role !== 'editor' && rec.role !== 'viewer') return null;
    return rec.role;
  }

  private hasUnrevokedWorkspaceOwnerFallback(wsId: string | undefined, uid: string): boolean {
    if (!wsId) return false;
    const ws = this.workspacesDb.get(wsId);
    if (!ws || ws.ownerId !== uid) return false;
    const memberRec = this.membersDb.get(`${wsId}/members/${uid}`);
    if (!memberRec) return true;
    return memberRec.active === true;
  }

  private isWorkspaceMember(wsId: string | undefined, uid: string): boolean {
    return (
      this.getActiveMemberRole(wsId, uid) !== null ||
      this.hasUnrevokedWorkspaceOwnerFallback(wsId, uid)
    );
  }

  private isWorkspaceOwner(wsId: string | undefined, uid: string): boolean {
    return (
      this.getActiveMemberRole(wsId, uid) === 'owner' ||
      this.hasUnrevokedWorkspaceOwnerFallback(wsId, uid)
    );
  }

  private isWorkspaceEditor(wsId: string | undefined, uid: string): boolean {
    const role = this.getActiveMemberRole(wsId, uid);
    return role === 'editor' || this.isWorkspaceOwner(wsId, uid);
  }

  public evaluateRequest(
    context: SecurityContext,
    operation: 'read' | 'create' | 'update' | 'delete',
    collection: string,
    docData?: any,
    existingDocData?: any
  ): 'ALLOW' | 'DENY' {
    // Catch-all deny for unknown collections
    const allowedCollections = [
      'recipes',
      'presets',
      'mixers',
      'history',
      'master_ingredients',
      'product_projects',
      'settings',
      'workspaces',
      'members',
      'billing',
      'users',
      'workspaceMemberships',
    ];
    if (!allowedCollections.includes(collection)) {
      return 'DENY';
    }

    // Invariant 1: Authentication required
    if (!context.auth) {
      return 'DENY';
    }

    const uid = context.auth.uid;

    // Subcollection: Billing (Phase 1.0)
    // Client write is STRICTLY prohibited (allow write: if false)
    // Only authorized active workspace members may read
    if (collection === 'billing') {
      if (operation !== 'read') {
        return 'DENY';
      }
      const wsId = docData?.workspaceId || existingDocData?.workspaceId;
      return this.isWorkspaceMember(wsId, uid) ? 'ALLOW' : 'DENY';
    }

    // Collection: Settings
    if (collection === 'settings') {
      const targetUserId = docData?.userId || existingDocData?.userId;
      if (targetUserId === uid) {
        return 'ALLOW';
      }
      return 'DENY';
    }

    // Collection: Users (Private to authenticated UID)
    if (collection === 'users') {
      const targetUserId = docData?.userId || docData?.uid || existingDocData?.userId || existingDocData?.uid;
      if (targetUserId !== uid) {
        return 'DENY';
      }
      if (operation === 'delete') {
        return 'DENY'; // Rule: allow delete: if false
      }
      if (operation === 'update') {
        // Authoritative anti-duplication: cannot alter or clear ownedWorkspaceId once set
        if (existingDocData?.ownedWorkspaceId && docData?.ownedWorkspaceId !== existingDocData.ownedWorkspaceId) {
          return 'DENY';
        }
        // Anti-tamper: cannot reset trialConsumedForOwnedWorkspace once set
        if (existingDocData?.trialConsumedForOwnedWorkspace === true && docData?.trialConsumedForOwnedWorkspace !== true) {
          return 'DENY';
        }
      }
      return 'ALLOW';
    }

    // Subcollection: User Workspace Memberships Index (Private to authenticated UID)
    if (collection === 'workspaceMemberships') {
      const targetUserId = docData?.userId || existingDocData?.userId;
      if (targetUserId !== uid) {
        return 'DENY';
      }
      return 'ALLOW';
    }

    // Collection: Workspaces
    if (collection === 'workspaces') {
      const wsId =
        docData?._pathWorkspaceId ||
        existingDocData?._pathWorkspaceId ||
        docData?.workspaceId ||
        existingDocData?.workspaceId ||
        docData?.id ||
        existingDocData?.id;
      const isMember = this.isWorkspaceMember(wsId, uid);
      const isOwner = this.isWorkspaceOwner(wsId, uid);
      const isEditor = this.isWorkspaceEditor(wsId, uid);

      if (operation === 'read') {
        const isTemporaryRecoveryRead =
          wsId === 'ws-main' &&
          context.auth?.email === 'jaoliveras@gmail.com' &&
          (existingDocData?.ownerEmail === 'jaoliveras@gmail.com' || docData?.ownerEmail === 'jaoliveras@gmail.com');
        return isMember || isTemporaryRecoveryRead ? 'ALLOW' : 'DENY';
      }

      if (operation === 'create') {
        // Rule: allow create: if isSignedIn() && request.resource.data.ownerId == request.auth.uid
        if (docData?.ownerId !== uid) {
          return 'DENY';
        }
        // Authoritative duplicate workspace prevention:
        // Must NOT already own a workspace in usersDb
        const userRec = this.usersDb.get(uid);
        if (userRec?.ownedWorkspaceId) {
          return 'DENY';
        }
        // Anti-tamper: cannot self-grant strategic partner metadata or billing fields on creation
        if (docData?.strategicPartner === true || docData?.billingSource) {
          return 'DENY';
        }
        return 'ALLOW';
      }

      if (operation === 'update') {
        // Calculate diff affectedKeys matching Firestore CEL rules behavior
        const cleanDocData = { ...docData };
        delete cleanDocData._pathWorkspaceId;
        const cleanExistingDocData = { ...existingDocData };
        delete cleanExistingDocData._pathWorkspaceId;

        const existingKeys = Object.keys(cleanExistingDocData);
        const requestKeys = Object.keys(cleanDocData);
        const allKeys = Array.from(new Set([...existingKeys, ...requestKeys]));
        const affectedKeys = allKeys.filter((k) => {
          if (!cleanExistingDocData || !(k in cleanExistingDocData)) return true;
          if (!cleanDocData || !(k in cleanDocData)) return true;
          return JSON.stringify(cleanExistingDocData[k]) !== JSON.stringify(cleanDocData[k]);
        });
        const hasOnlyOwnerIdAndUpdatedAt =
          affectedKeys.length > 0 &&
          affectedKeys.every((k) => k === 'ownerId' || k === 'updatedAt');

        // Temporary surgical ws-main owner rebind exception
        const isTemporaryRebind =
          wsId === 'ws-main' &&
          context.auth?.email === 'jaoliveras@gmail.com' &&
          existingDocData?.ownerId === '42JFWv9G4eb4AvUql3VrvufLeGd2' &&
          existingDocData?.ownerEmail === 'jaoliveras@gmail.com' &&
          docData?.ownerId === uid &&
          docData?.ownerEmail === 'jaoliveras@gmail.com' &&
          hasOnlyOwnerIdAndUpdatedAt &&
          (!('id' in (existingDocData || {})) || docData?.id === existingDocData.id) &&
          (!('name' in (existingDocData || {})) || docData?.name === existingDocData.name) &&
          (!('code' in (existingDocData || {})) || docData?.code === existingDocData.code) &&
          (!('businessType' in (existingDocData || {})) || docData?.businessType === existingDocData.businessType) &&
          (!('branding' in (existingDocData || {})) || JSON.stringify(docData?.branding) === JSON.stringify(existingDocData.branding)) &&
          (!('createdAt' in (existingDocData || {})) || docData?.createdAt === existingDocData.createdAt);

        if (isOwner || isTemporaryRebind) {
          // Normal owner update cannot alter ownerId
          if (isOwner && !isTemporaryRebind && docData?.ownerId !== existingDocData?.ownerId) {
            return 'DENY';
          }

          // Anti-tamper: cannot manipulate strategicPartner or billingSource
          if (docData?.strategicPartner !== undefined && docData?.strategicPartner !== existingDocData?.strategicPartner) {
            return 'DENY';
          }
          if (docData?.billingSource !== undefined && docData?.billingSource !== existingDocData?.billingSource) {
            return 'DENY';
          }
          return 'ALLOW';
        }

        // Narrowly scoped Editor update ONLY for productionOptionOrder (+ optional updatedAt)
        if (isEditor) {
          if (docData?.ownerId !== existingDocData?.ownerId) {
            return 'DENY';
          }
          if (
            affectedKeys.length === 0 ||
            !affectedKeys.every((k) => k === 'productionOptionOrder' || k === 'updatedAt')
          ) {
            return 'DENY';
          }
          if (!Array.isArray(docData?.productionOptionOrder) || docData.productionOptionOrder.length > 500) {
            return 'DENY';
          }
          if ('updatedAt' in cleanDocData) {
            if (typeof cleanDocData.updatedAt !== 'string' || cleanDocData.updatedAt.length > 64) {
              return 'DENY';
            }
          }
          return 'ALLOW';
        }

        return 'DENY';
      }

      // Delete workspace requires owner
      return isOwner ? 'ALLOW' : 'DENY';
    }

    // Subcollection: Members
    if (collection === 'members') {
      const wsId = docData?.workspaceId || existingDocData?.workspaceId;
      const isExistingWorkspaceOwner = this.isWorkspaceOwner(wsId, uid);

      if (operation === 'read') {
        const isTemporaryRecoveryMemberRead =
          wsId === 'ws-main' && context.auth?.email === 'jaoliveras@gmail.com';
        return this.isWorkspaceMember(wsId, uid) || isTemporaryRecoveryMemberRead ? 'ALLOW' : 'DENY';
      }

      if (operation === 'create' || operation === 'update') {
        // Temporary surgical ws-main member rebind exception
        const isTemporaryMemberRebind =
          wsId === 'ws-main' &&
          context.auth?.email === 'jaoliveras@gmail.com' &&
          (docData?.memberId === uid || docData?.uid === uid) &&
          docData?.uid === uid &&
          docData?.email === 'jaoliveras@gmail.com' &&
          docData?.role === 'owner' &&
          docData?.active === true;

        if (isTemporaryMemberRebind) {
          return 'ALLOW';
        }

        if (operation === 'create') {
          // Branch 1: Existing workspace owner adding/inviting member
          if (isExistingWorkspaceOwner) {
            return 'ALLOW';
          }
          // Branch 2: Initial owner bootstrap ONLY for a newly created workspace in the current atomic batch
          // If the workspace ALREADY exists, initial bootstrap is strictly DENIED
          const workspaceAlreadyExists = this.workspacesDb.has(wsId);
          if (!workspaceAlreadyExists) {
            const isOwnerRole = docData?.role === 'owner';
            const isActive = docData?.active === true;
            const isSelfUid = docData?.uid === uid && (docData?.memberId === uid || !docData?.memberId);
            if (isOwnerRole && isActive && isSelfUid) {
              return 'ALLOW';
            }
          }
          return 'DENY';
        }

        // Member update requires Owner role
        return isExistingWorkspaceOwner ? 'ALLOW' : 'DENY';
      }

      if (operation === 'delete') {
        return isExistingWorkspaceOwner ? 'ALLOW' : 'DENY';
      }
    }

    // Operational Collections: recipes, presets, mixers, history, master_ingredients, product_projects
    const targetWsId = operation === 'create' ? docData?.workspaceId : (existingDocData?.workspaceId || docData?.workspaceId);

    // Invariant 2: Must have workspaceId
    if (!targetWsId || typeof targetWsId !== 'string' || targetWsId.trim() === '') {
      return 'DENY';
    }

    // Invariant 6: WorkspaceId immutability on update
    if (operation === 'update' && existingDocData?.workspaceId && docData?.workspaceId) {
      if (existingDocData.workspaceId !== docData.workspaceId) {
        return 'DENY';
      }
    }

    // Invariant 3: Active tenant membership verification
    if (!this.isWorkspaceMember(targetWsId, uid)) {
      return 'DENY';
    }

    // Invariant 4: RBAC permissions
    if (operation === 'read') {
      return 'ALLOW'; // Any active member (owner, editor, viewer) can read
    }

    // Permanent recipe & preset deletion are strictly Owner-only
    if (operation === 'delete' && (collection === 'recipes' || collection === 'presets')) {
      return this.isWorkspaceOwner(targetWsId, uid) ? 'ALLOW' : 'DENY';
    }

    // Optional boolean field validation on presets.productionEnabled
    if (
      collection === 'presets' &&
      (operation === 'create' || operation === 'update') &&
      docData &&
      'productionEnabled' in docData &&
      docData.productionEnabled !== undefined &&
      typeof docData.productionEnabled !== 'boolean'
    ) {
      return 'DENY';
    }

    // Operational create/update (and non-recipe/non-preset delete) require active editor or owner
    if (['create', 'update', 'delete'].includes(operation)) {
      if (this.isWorkspaceEditor(targetWsId, uid)) {
        return 'ALLOW';
      }
      return 'DENY'; // Viewer denied
    }

    return 'DENY';
  }
}

/**
 * Runs the full "Dirty Dozen" policy simulation unit tests (In-Memory JavaScript Model)
 */
export function runPolicySimulationTests(): SecurityTestCaseResult[] {
  const engine = new PolicySimulationEngine();
  const results: SecurityTestCaseResult[] = [];

  // P01: Anonymous Public Read
  const p01 = engine.evaluateRequest({ auth: null }, 'read', 'recipes', { id: 'rec-1', workspaceId: 'ws-main' });
  results.push({
    id: 'P01',
    name: 'Anonymous Public Read Attempt',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p01,
    passed: p01 === 'DENY',
    threatMitigation: 'Prevents scraping and theft of proprietary Sunny Sweets recipes by unauthenticated users.',
    details: 'Unauthenticated GET request to /recipes/rec-1 was denied.',
  });

  // P02: Anonymous Recipe Injection
  const p02 = engine.evaluateRequest({ auth: null }, 'create', 'recipes', { id: 'rec-malicious', name: 'Corrupted Batch', workspaceId: 'ws-main' });
  results.push({
    id: 'P02',
    name: 'Anonymous Recipe Creation Attempt',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p02,
    passed: p02 === 'DENY',
    threatMitigation: 'Prevents malicious tampering and database pollution from unauthenticated actors.',
    details: 'Unauthenticated POST request to /recipes was denied.',
  });

  // P03: Cross-Workspace Snoop
  const p03 = engine.evaluateRequest(
    { auth: { uid: 'uid-user-b', email: 'user@otherbakery.com' } },
    'read',
    'recipes',
    undefined,
    { id: 'rec-proprietary', workspaceId: 'ws-main' }
  );
  results.push({
    id: 'P03',
    name: 'Cross-Workspace Read Attempt',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p03,
    passed: p03 === 'DENY',
    threatMitigation: 'Enforces strict tenant boundaries between separate bakery workspaces.',
    details: 'User belonging to ws-bakery-b denied read access to ws-main recipes.',
  });

  // P04: Cross-Workspace Injection
  const p04 = engine.evaluateRequest(
    { auth: { uid: 'uid-user-b', email: 'user@otherbakery.com' } },
    'create',
    'recipes',
    { id: 'rec-spoofed', workspaceId: 'ws-main', name: 'Spoofed Recipe' }
  );
  results.push({
    id: 'P04',
    name: 'Cross-Workspace Write Injection Attempt',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p04,
    passed: p04 === 'DENY',
    threatMitigation: 'Stops external users from writing or injecting records into another workspace.',
    details: 'User belonging to ws-bakery-b denied write access to ws-main recipes.',
  });

  // P05: Viewer Privilege Escalation (Create)
  const p05 = engine.evaluateRequest(
    { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.com' } },
    'create',
    'recipes',
    { id: 'rec-unauthorized', workspaceId: 'ws-main', name: 'Unauthorized Cake' }
  );
  results.push({
    id: 'P05',
    name: 'Viewer Privilege Escalation (Write Recipe)',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p05,
    passed: p05 === 'DENY',
    threatMitigation: 'Ensures viewer accounts remain strictly read-only for operational recipes.',
    details: 'Viewer denied creation of new recipes.',
  });

  // P06: Viewer Unauthorized Deletion
  const p06 = engine.evaluateRequest(
    { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.com' } },
    'delete',
    'recipes',
    undefined,
    { id: 'rec-original', workspaceId: 'ws-main' }
  );
  results.push({
    id: 'P06',
    name: 'Viewer Unauthorized Recipe Deletion',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p06,
    passed: p06 === 'DENY',
    threatMitigation: 'Protects proprietary recipes against accidental or malicious deletion by viewers.',
    details: 'Viewer denied deletion of existing recipes.',
  });

  // P07: Workspace Hijack / Role Elevation
  const p07 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'update',
    'members',
    { workspaceId: 'ws-main', role: 'owner' },
    { workspaceId: 'ws-main', role: 'editor' }
  );
  results.push({
    id: 'P07',
    name: 'Member Role Privilege Escalation to Owner',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p07,
    passed: p07 === 'DENY',
    threatMitigation: 'Prevents non-owners from elevating their permissions or overtaking workspace ownership.',
    details: 'Editor denied updating membership role to owner.',
  });

  // P08: Non-Member Member Injection
  const p08 = engine.evaluateRequest(
    { auth: { uid: 'uid-stranger', email: 'stranger@external.com' } },
    'create',
    'members',
    { workspaceId: 'ws-main', role: 'owner', email: 'stranger@external.com' }
  );
  results.push({
    id: 'P08',
    name: 'External Actor Self-Registration to Workspace',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p08,
    passed: p08 === 'DENY',
    threatMitigation: 'Ensures only current workspace owners can invite or add members.',
    details: 'Uninvited external user denied adding themselves to ws-main.',
  });

  // P09: Missing Workspace ID Injection
  const p09 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'create',
    'recipes',
    { id: 'rec-broken', name: 'Unassigned Recipe' }
  );
  results.push({
    id: 'P09',
    name: 'Missing Workspace ID Validation',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p09,
    passed: p09 === 'DENY',
    threatMitigation: 'Guarantees that no floating or unassigned records can be created in the database.',
    details: 'Recipe creation denied due to missing workspaceId property.',
  });

  // P10: Workspace Reparenting / Hijack
  const p10 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'update',
    'recipes',
    { id: 'rec-1', workspaceId: 'ws-bakery-b', name: 'Stolen Formula' },
    { id: 'rec-1', workspaceId: 'ws-main', name: 'Original Formula' }
  );
  results.push({
    id: 'P10',
    name: 'Workspace Reparenting Immutability',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p10,
    passed: p10 === 'DENY',
    threatMitigation: 'Prevents moving recipes between workspaces to exfiltrate proprietary formulas.',
    details: 'Mutating workspaceId on an existing recipe document was denied.',
  });

  // P11: Cross-User Settings Tampering
  const p11 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'update',
    'settings',
    { userId: 'uid-owner-1', theme: 'dark' },
    { userId: 'uid-owner-1', theme: 'light' }
  );
  results.push({
    id: 'P11',
    name: 'Cross-User Settings Tampering Attempt',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p11,
    passed: p11 === 'DENY',
    threatMitigation: 'Enforces strict personal data privacy on individual user settings.',
    details: 'User denied modifying settings document of another user.',
  });

  // P12: Arbitrary Collection Breach
  const p12 = engine.evaluateRequest(
    { auth: { uid: 'uid-owner-1', email: 'owner@sunnysweets.com' } },
    'read',
    'system_credentials'
  );
  results.push({
    id: 'P12',
    name: 'Catch-All Denial on Unrecognized Collections',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p12,
    passed: p12 === 'DENY',
    threatMitigation: 'Prevents access to undeclared collections via default-deny firewall posture.',
    details: 'Access to system_credentials collection was strictly denied.',
  });

  // P13: Browser Direct Client Mutation of Billing Document (Phase 1.0 Invariant)
  const p13 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'update',
    'billing',
    { workspaceId: 'ws-main', entitlementStatus: 'active', planId: 'team' },
    { workspaceId: 'ws-main', entitlementStatus: 'inactive', planId: 'solo' }
  );
  results.push({
    id: 'P13',
    name: 'Browser Direct Write to Billing / Entitlements (DENY)',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p13,
    passed: p13 === 'DENY',
    threatMitigation: 'Authoritative billing records can only be mutated by server-side infrastructure.',
    details: 'Browser client attempt to write to billing document was strictly denied.',
  });

  // P14: Browser Direct Self-Grant of Active Entitlement (Phase 1.0 Invariant)
  const p14 = engine.evaluateRequest(
    { auth: { uid: 'uid-owner-1', email: 'owner@sunnysweets.com' } },
    'create',
    'billing',
    { workspaceId: 'ws-main', entitlementStatus: 'active', planId: 'team', subscriptionStatus: 'active' }
  );
  results.push({
    id: 'P14',
    name: 'Owner Self-Grant of Active Subscription via Browser (DENY)',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p14,
    passed: p14 === 'DENY',
    threatMitigation: 'Prevents even workspace owners from forging active billing state from client code.',
    details: 'Owner client attempt to create active billing record was denied.',
  });

  // P15: Non-Member Read Access to Workspace Billing (Phase 1.0 Invariant)
  const p15 = engine.evaluateRequest(
    { auth: { uid: 'uid-stranger', email: 'stranger@external.com' } },
    'read',
    'billing',
    undefined,
    { workspaceId: 'ws-main', planId: 'team' }
  );
  results.push({
    id: 'P15',
    name: 'Non-Member Read of Workspace Billing Data (DENY)',
    category: 'dirty_dozen',
    expectedResult: 'DENY',
    actualResult: p15,
    passed: p15 === 'DENY',
    threatMitigation: 'Ensures private workspace subscription and seat limits are shielded from external users.',
    details: 'Non-member read of ws-main billing document was denied.',
  });

  // Valid Access Test Cases (Sanity Checks)
  const v01 = engine.evaluateRequest(
    { auth: { uid: 'uid-owner-1', email: 'owner@sunnysweets.com' } },
    'create',
    'members',
    { workspaceId: 'ws-main', role: 'editor', email: 'newbaker@sunnysweets.com' }
  );
  results.push({
    id: 'V01',
    name: 'Owner Member Administration Authorization',
    category: 'valid_access',
    expectedResult: 'ALLOW',
    actualResult: v01,
    passed: v01 === 'ALLOW',
    threatMitigation: 'Verified legitimate workspace owners retain full member administration authority.',
    details: 'Workspace owner successfully authorized to add an editor member.',
  });

  const v02 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'create',
    'recipes',
    { id: 'rec-new', workspaceId: 'ws-main', name: 'Fresh Croissant' }
  );
  results.push({
    id: 'V02',
    name: 'Editor Recipe Creation Authorization',
    category: 'valid_access',
    expectedResult: 'ALLOW',
    actualResult: v02,
    passed: v02 === 'ALLOW',
    threatMitigation: 'Verified legitimate bakery editors can manage recipes in their workspace.',
    details: 'Editor successfully authorized to create a workspace recipe.',
  });

  const v03 = engine.evaluateRequest(
    { auth: { uid: 'uid-viewer-1', email: 'viewer@sunnysweets.com' } },
    'read',
    'recipes',
    undefined,
    { id: 'rec-1', workspaceId: 'ws-main' }
  );
  results.push({
    id: 'V03',
    name: 'Viewer Read Access Authorization',
    category: 'valid_access',
    expectedResult: 'ALLOW',
    actualResult: v03,
    passed: v03 === 'ALLOW',
    threatMitigation: 'Verified viewers can access recipe viewing and production scaling without write risks.',
    details: 'Viewer successfully authorized to read workspace recipes.',
  });

  const v04 = engine.evaluateRequest(
    { auth: { uid: 'uid-editor-1', email: 'baker@sunnysweets.com' } },
    'read',
    'billing',
    undefined,
    { workspaceId: 'ws-main', planId: 'team' }
  );
  results.push({
    id: 'V04',
    name: 'Workspace Member Billing Read Authorization',
    category: 'valid_access',
    expectedResult: 'ALLOW',
    actualResult: v04,
    passed: v04 === 'ALLOW',
    threatMitigation: 'Verified authorized workspace members can read their workspace subscription state.',
    details: 'Editor authorized to read ws-main billing document.',
  });

  return results;
}

// Backward compatibility alias
export const runSecurityTests = runPolicySimulationTests;
export const FirestoreSecurityEngine = PolicySimulationEngine;
