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
  private membersDb: Map<string, { role: 'owner' | 'editor' | 'viewer'; email: string }> = new Map();
  private workspacesDb: Map<string, { ownerId: string; name: string }> = new Map();

  constructor() {
    // Seed initial test state
    this.workspacesDb.set('ws-main', { ownerId: 'uid-owner-1', name: 'Sunny Sweets Main' });
    this.workspacesDb.set('ws-bakery-b', { ownerId: 'uid-owner-2', name: 'Other Bakery' });

    this.membersDb.set('ws-main/members/uid-owner-1', { role: 'owner', email: 'owner@sunnysweets.com' });
    this.membersDb.set('ws-main/members/uid-editor-1', { role: 'editor', email: 'baker@sunnysweets.com' });
    this.membersDb.set('ws-main/members/uid-viewer-1', { role: 'viewer', email: 'viewer@sunnysweets.com' });

    this.membersDb.set('ws-bakery-b/members/uid-user-b', { role: 'editor', email: 'user@otherbakery.com' });
  }

  public evaluateRequest(
    context: SecurityContext,
    operation: 'read' | 'create' | 'update' | 'delete',
    collection: string,
    docData?: any,
    existingDocData?: any
  ): 'ALLOW' | 'DENY' {
    // Catch-all deny for unknown collections
    const allowedCollections = ['recipes', 'presets', 'mixers', 'history', 'master_ingredients', 'settings', 'workspaces', 'members'];
    if (!allowedCollections.includes(collection)) {
      return 'DENY';
    }

    // Invariant 1: Authentication required
    if (!context.auth) {
      return 'DENY';
    }

    const uid = context.auth.uid;

    // Collection: Settings
    if (collection === 'settings') {
      const targetUserId = docData?.userId || existingDocData?.userId;
      if (targetUserId === uid) {
        return 'ALLOW';
      }
      return 'DENY';
    }

    // Collection: Workspaces
    if (collection === 'workspaces') {
      const wsId = docData?.id || existingDocData?.id;
      const isMember = this.membersDb.has(`${wsId}/members/${uid}`);
      const isOwner = this.workspacesDb.get(wsId)?.ownerId === uid;

      if (operation === 'read') {
        return isMember || isOwner ? 'ALLOW' : 'DENY';
      }
      // Create/Update/Delete workspace requires owner
      return isOwner ? 'ALLOW' : 'DENY';
    }

    // Subcollection: Members
    if (collection === 'members') {
      const wsId = docData?.workspaceId || existingDocData?.workspaceId;
      const callerRole = this.membersDb.get(`${wsId}/members/${uid}`)?.role;
      const isOwner = callerRole === 'owner' || this.workspacesDb.get(wsId)?.ownerId === uid;

      if (operation === 'read') {
        return callerRole ? 'ALLOW' : 'DENY';
      }
      // Member administration requires Owner role
      return isOwner ? 'ALLOW' : 'DENY';
    }

    // Operational Collections: recipes, presets, mixers, history, master_ingredients
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

    // Invariant 3: Tenant membership verification
    const memberRecord = this.membersDb.get(`${targetWsId}/members/${uid}`);
    if (!memberRecord) {
      return 'DENY';
    }

    // Invariant 4: RBAC permissions
    if (operation === 'read') {
      return 'ALLOW'; // Any valid member (owner, editor, viewer) can read
    }

    // Write operations require editor or owner
    if (['create', 'update', 'delete'].includes(operation)) {
      if (memberRecord.role === 'editor' || memberRecord.role === 'owner') {
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

  return results;
}

// Backward compatibility alias
export const runSecurityTests = runPolicySimulationTests;
export const FirestoreSecurityEngine = PolicySimulationEngine;
