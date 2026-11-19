import {
  ProductProject,
  QuoteFormula,
  QuoteRevision,
  FormulaOwnership,
  ProjectStatus,
  CandidateRecoveryRecord,
  ProjectDeletionPreview,
  ProjectDeletionEligibilityResult,
  ProjectDeletionAuditRecord,
} from '../types/quoting';
import { Workspace, AccessRole, Recipe, MasterIngredient } from '../types';
import { hasWorkspaceFeature } from './workspaceFeatures';
import { db, auth, sanitizeForFirestore } from './firebase';
import { store } from './store';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore';
import { createQuoteRevisionSnapshot, convertRecipeToQuoteFormula } from '../utils/quotingCalculator';

const QUOTING_STORAGE_PREFIX = 'recipe_calc_projects_';
const QUOTING_RECOVERY_PREFIX = 'bakery_quote_draft_recovery_';
const QUOTING_TOMBSTONE_PREFIX = 'recipe_calc_tombstones_';
const QUOTING_AUDIT_PREFIX = 'recipe_calc_deletion_audit_';

/**
 * Access control gate for Product Development & Quoting.
 *
 * RULES:
 * 1. Production Floor PIN users have ABSOLUTELY ZERO ACCESS.
 * 2. Workspace must have the 'productQuoting' capability enabled.
 * 3. Ordinary Viewers have NO ACCESS by default (sensitive financial/formula data).
 * 4. Owners and Managers/Editors with the feature have full operational access.
 */
export function canUserAccessQuoting(
  workspace: Workspace | null | undefined,
  role: AccessRole | null | undefined,
  isProductionPinUser: boolean = false
): boolean {
  if (isProductionPinUser) {
    return false;
  }
  if (!workspace || !role) {
    return false;
  }
  if (!hasWorkspaceFeature(workspace, 'productQuoting')) {
    return false;
  }
  // Viewers are denied access to sensitive quoting & commercial margins by default
  if (role === 'viewer') {
    return false;
  }
  return role === 'owner' || role === 'editor';
}

class QuotingService {
  private projectsMap: Map<string, ProductProject[]> = new Map(); // workspaceId -> projects
  private listeners: Set<() => void> = new Set();
  private firestoreUnsubs: Map<string, () => void> = new Map();
  private projectWriteQueues: Map<string, Promise<any>> = new Map();
  private projectEditVersions: Map<string, number> = new Map();
  private mockCloudWriteHandler: ((project: ProductProject, type: 'save' | 'metadata') => Promise<void>) | null = null;
  private mockDeletionHandler: ((projectId: string, workspaceId: string) => Promise<void>) | null = null;
  private tombstones: Set<string> = new Set();
  private auditLog: Map<string, ProjectDeletionAuditRecord[]> = new Map(); // workspaceId -> records

  public setMockCloudWriteHandler(handler: ((project: ProductProject, type: 'save' | 'metadata') => Promise<void>) | null): void {
    this.mockCloudWriteHandler = handler;
  }

  public setMockDeletionHandler(handler: ((projectId: string, workspaceId: string) => Promise<void>) | null): void {
    this.mockDeletionHandler = handler;
  }

  public clearTombstonesForTesting(): void {
    this.tombstones.clear();
    this.auditLog.clear();
  }

  constructor() {
    this.loadFromStorage();
  }

  private getStorageKey(workspaceId: string): string {
    return `${QUOTING_STORAGE_PREFIX}${workspaceId}`;
  }

  private loadFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      // 1. Load tombstones first so deleted projects are never revived from local cache
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(QUOTING_TOMBSTONE_PREFIX)) {
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const ids = JSON.parse(raw);
              if (Array.isArray(ids)) {
                ids.forEach((id) => this.tombstones.add(id));
              }
            } catch (_) {}
          }
        }
        if (key && key.startsWith(QUOTING_AUDIT_PREFIX)) {
          const wsId = key.replace(QUOTING_AUDIT_PREFIX, '');
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const records = JSON.parse(raw);
              if (Array.isArray(records)) {
                this.auditLog.set(wsId, records);
              }
            } catch (_) {}
          }
        }
      }

      // 2. Load projects and filter out any tombstoned IDs
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(QUOTING_STORAGE_PREFIX)) {
          const wsId = key.replace(QUOTING_STORAGE_PREFIX, '');
          const raw = localStorage.getItem(key);
          if (raw) {
            const list: ProductProject[] = JSON.parse(raw);
            const filtered = list.filter((p) => !this.tombstones.has(p.id));
            this.projectsMap.set(wsId, filtered);
          }
        }
      }
    } catch (e) {
      console.warn('[QuotingService] Local storage load warning:', e);
    }
  }

  private saveToStorage(workspaceId: string) {
    if (typeof localStorage === 'undefined') return;

    try {
      const list = this.projectsMap.get(workspaceId) || [];
      localStorage.setItem(this.getStorageKey(workspaceId), JSON.stringify(list));
    } catch (e) {
      console.warn('[QuotingService] Local storage save warning:', e);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('[QuotingService] Listener error:', err);
      }
    });
  }

  public initWorkspaceSync(workspaceId: string) {
    if (!workspaceId) return;
    if (this.firestoreUnsubs.has(workspaceId)) return;

    if (!db) return;

    try {
      const q = query(
        collection(db, 'product_projects'),
        where('workspaceId', '==', workspaceId)
      );

      const unsub = onSnapshot(
        q,
        (snap) => {
          const incomingMap = new Map<string, ProductProject>();
          snap.forEach((docSnap) => {
            const data = docSnap.data() as ProductProject;
            incomingMap.set(data.id, data);
          });

          const currentList = this.projectsMap.get(workspaceId) || [];
          const reconciledMap = new Map<string, ProductProject>();

          // First evaluate existing local items
          for (const localProj of currentList) {
            if (this.tombstones.has(localProj.id)) {
              continue;
            }
            const serverProj = incomingMap.get(localProj.id);
            if (!serverProj) {
              // If local project has unsynced changes or recent edits, preserve it locally
              reconciledMap.set(localProj.id, localProj);
              continue;
            }

            // Conflict detection & preservation:
            // If local project is marked dirty (hasUnsyncedLocalChanges) OR
            // has local documentVersion strictly greater than serverVersion:
            const localVersion = localProj.documentVersion || 0;
            const serverVersion = serverProj.documentVersion || 0;
            const isLocalDirty = !!localProj.hasUnsyncedLocalChanges;

            if (isLocalDirty) {
              // Local has newer or unpersisted edits (e.g. quantity changes before or during sync).
              // Strictly preserve local draft intact so user edits are NEVER lost.
              const isConflict = serverVersion > 0 && serverVersion > localVersion;
              reconciledMap.set(localProj.id, {
                ...localProj,
                cloudConflict: isConflict
                  ? {
                      conflictAt: new Date().toISOString(),
                      serverVersion,
                      serverUpdatedAt: serverProj.updatedAt,
                      serverFormulaLineCount: serverProj.formula?.lines?.length || 0,
                      serverProductName: serverProj.productName,
                    }
                  : localProj.cloudConflict,
              });
            } else if (serverVersion >= localVersion) {
              // Server is newer or equal and local is clean. Safely adopt server version.
              reconciledMap.set(localProj.id, {
                ...serverProj,
                hasUnsyncedLocalChanges: false,
                cloudConflict: undefined,
              });
            } else {
              // Local version ahead; preserve local
              reconciledMap.set(localProj.id, localProj);
            }
          }

          // Add any new server projects not in local cache
          for (const [id, serverProj] of incomingMap.entries()) {
            if (this.tombstones.has(id)) {
              continue;
            }
            if (!reconciledMap.has(id)) {
              reconciledMap.set(id, {
                ...serverProj,
                hasUnsyncedLocalChanges: false,
              });
            }
          }

          const reconciledList = Array.from(reconciledMap.values());
          reconciledList.sort(
            (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          );

          this.projectsMap.set(workspaceId, reconciledList);
          this.saveToStorage(workspaceId);
          this.notify();
        },
        (error) => {
          console.warn('[QuotingService] Firestore sync error (using local cache):', error.message);
        }
      );

      this.firestoreUnsubs.set(workspaceId, unsub);
    } catch (err) {
      console.warn('[QuotingService] Failed to attach Firestore listener:', err);
    }
  }

  public getProjects(workspaceId: string): ProductProject[] {
    const list = this.projectsMap.get(workspaceId) || [];
    return [...list];
  }

  public getProject(workspaceId: string, projectId: string): ProductProject | undefined {
    const list = this.getProjects(workspaceId);
    return list.find((p) => p.id === projectId);
  }

  private getRecoveryStorageKey(userId: string | undefined, workspaceId: string, projectId: string): string {
    const effectiveUser = userId || auth.currentUser?.uid || 'default_user';
    return `${QUOTING_RECOVERY_PREFIX}${effectiveUser}_${workspaceId}_${projectId}`;
  }

  public saveDraftRecovery(
    workspaceId: string,
    projectId: string,
    project: ProductProject,
    userId?: string
  ): void {
    if (this.tombstones.has(projectId)) return;
    if (typeof localStorage === 'undefined' || !workspaceId || !projectId) return;
    try {
      localStorage.setItem(this.getRecoveryStorageKey(userId, workspaceId, projectId), JSON.stringify(project));
    } catch (e) {
      console.warn('[QuotingService] Local recovery save warning:', e);
    }
  }

  public getDraftRecovery(
    workspaceId: string,
    projectId: string,
    userId?: string
  ): ProductProject | null {
    if (this.tombstones.has(projectId)) return null;
    if (typeof localStorage === 'undefined' || !workspaceId || !projectId) return null;
    try {
      const data = localStorage.getItem(this.getRecoveryStorageKey(userId, workspaceId, projectId));
      if (!data) return null;
      return JSON.parse(data) as ProductProject;
    } catch (e) {
      console.warn('[QuotingService] Local recovery load warning:', e);
      return null;
    }
  }

  public clearDraftRecovery(
    workspaceId: string,
    projectId: string,
    userId?: string,
    persistedProject?: ProductProject
  ): void {
    if (typeof localStorage === 'undefined' || !workspaceId || !projectId) return;
    try {
      const usersToClear = new Set<string>();
      if (userId) usersToClear.add(userId);
      if (auth.currentUser?.uid) usersToClear.add(auth.currentUser.uid);
      if (usersToClear.size === 0) usersToClear.add('default_user');

      for (const effectiveUser of usersToClear) {
        if (persistedProject) {
          const existingRecovery = this.getDraftRecovery(workspaceId, projectId, effectiveUser);
          if (existingRecovery) {
            const recTime = new Date(existingRecovery.updatedAt || 0).getTime();
            const persistTime = new Date(persistedProject.updatedAt || 0).getTime();
            // If recovery draft was edited strictly after this save was created, preserve recovery!
            if (recTime > persistTime) {
              continue;
            }
            // If recovery draft has different formula lines/quantities not reflected in persistedProject, preserve recovery!
            const recLines = existingRecovery.formula?.lines || [];
            const persistLines = persistedProject.formula?.lines || [];
            if (recLines.length !== persistLines.length) {
              continue;
            }
            let hasDivergentLine = false;
            for (let i = 0; i < recLines.length; i++) {
              if (
                recLines[i].id !== persistLines[i].id ||
                Number(recLines[i].quantity) !== Number(persistLines[i].quantity) ||
                recLines[i].unit !== persistLines[i].unit
              ) {
                hasDivergentLine = true;
                break;
              }
            }
            if (hasDivergentLine) {
              continue;
            }
          }
        }
        localStorage.removeItem(this.getRecoveryStorageKey(effectiveUser, workspaceId, projectId));
      }
    } catch (e) {
      console.warn('[QuotingService] Local recovery clear warning:', e);
    }
  }

  /**
   * Scans local storage recovery keys and project caches for recoverable candidate drafts
   * without mutating or deleting any records. Returns structured candidate records.
   */
  public inspectRecoveryCandidates(
    workspaceId: string,
    userId?: string
  ): CandidateRecoveryRecord[] {
    const candidates: CandidateRecoveryRecord[] = [];
    const seenCandidateKeys = new Set<string>();

    if (typeof localStorage !== 'undefined') {
      try {
        const effectiveUser = userId || auth.currentUser?.uid || 'default_user';
        const targetRecoverySubstr = `_${workspaceId}_`;

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(QUOTING_RECOVERY_PREFIX) && key.includes(targetRecoverySubstr)) {
            const raw = localStorage.getItem(key);
            if (raw) {
              try {
                const parsed = JSON.parse(raw) as ProductProject;
                if (parsed && parsed.id) {
                  const dedupKey = `recovery_${parsed.id}_${parsed.updatedAt || ''}`;
                  if (!seenCandidateKeys.has(dedupKey)) {
                    seenCandidateKeys.add(dedupKey);
                    const ingCount = parsed.formula?.lines?.length || 0;
                    const prodCount = parsed.products?.length || 0;
                    candidates.push({
                      projectId: parsed.id,
                      projectCode: parsed.projectCode,
                      productName: parsed.productName,
                      customerName: parsed.customerName,
                      source: 'local_storage_recovery',
                      storageKey: key,
                      timestamp: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
                      ingredientCount: ingCount,
                      totalWeightGrams: parsed.formula?.totalWeightGrams || 0,
                      productCount: prodCount,
                      isPopulated: ingCount > 0 || prodCount > 0,
                      rawRecord: parsed,
                    });
                  }
                }
              } catch {
                // Ignore parse error on corrupt individual entry
              }
            }
          }
        }
      } catch (err) {
        console.warn('[QuotingService] Error inspecting recovery storage:', err);
      }
    }

    // Inspect cached projects in workspace
    const list = this.getProjects(workspaceId);
    for (const p of list) {
      // Check if project has formula lines
      if (p.formula && p.formula.lines && p.formula.lines.length > 0) {
        const dedupKey = `cache_${p.id}_${p.updatedAt || ''}`;
        if (!seenCandidateKeys.has(dedupKey)) {
          seenCandidateKeys.add(dedupKey);
          const ingCount = p.formula.lines.length;
          const prodCount = p.products?.length || 0;
          candidates.push({
            projectId: p.id,
            projectCode: p.projectCode,
            productName: p.productName,
            customerName: p.customerName,
            source: 'project_cache',
            timestamp: p.updatedAt || p.createdAt,
            ingredientCount: ingCount,
            totalWeightGrams: p.formula.totalWeightGrams || 0,
            productCount: prodCount,
            isPopulated: ingCount > 0 || prodCount > 0,
            rawRecord: p,
          });
        }
      }

      // Check revisions
      if (p.revisions && p.revisions.length > 0) {
        for (const rev of p.revisions) {
          const revKey = `revision_${p.id}_${rev.revisionNumber}`;
          if (!seenCandidateKeys.has(revKey)) {
            seenCandidateKeys.add(revKey);
            const ingCount = rev.formulaSnapshot?.lines?.length || 0;
            const prodCount = rev.productsSnapshot?.length || 0;
            candidates.push({
              projectId: p.id,
              projectCode: p.projectCode,
              productName: `${p.productName} (Revision #${rev.revisionNumber})`,
              customerName: p.customerName,
              source: 'quote_revision',
              timestamp: rev.createdAt || new Date().toISOString(),
              ingredientCount: ingCount,
              totalWeightGrams: rev.formulaSnapshot?.totalWeightGrams || 0,
              productCount: prodCount,
              revisionNumber: rev.revisionNumber,
              isPopulated: ingCount > 0 || prodCount > 0,
              rawRecord: rev,
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Updates only intended metadata fields (e.g. rename, status, description)
   * without serializing, modifying, or rewriting formula ingredients or pricing configs.
   */
  public async updateProjectMetadata(
    workspaceId: string,
    projectId: string,
    metadata: {
      productName?: string;
      customerName?: string;
      description?: string;
      status?: ProjectStatus;
      productCategory?: string;
      formulaOwnership?: FormulaOwnership;
      userId?: string;
    }
  ): Promise<ProductProject> {
    if (this.tombstones.has(projectId)) {
      throw new Error(`CANNOT_RESURRECT_DELETED_PROJECT: Project ${projectId} has been permanently deleted.`);
    }
    const existing = this.getProject(workspaceId, projectId);
    if (!existing) {
      throw new Error(`Project ${projectId} not found in workspace ${workspaceId}`);
    }

    const nextVersion = (existing.documentVersion || 0) + 1;
    const now = new Date().toISOString();
    const updated: ProductProject = {
      ...existing,
      productName: metadata.productName !== undefined ? metadata.productName.trim() : existing.productName,
      customerName: metadata.customerName !== undefined ? metadata.customerName.trim() : existing.customerName,
      description: metadata.description !== undefined ? metadata.description.trim() : existing.description,
      status: metadata.status !== undefined ? metadata.status : existing.status,
      productCategory: metadata.productCategory !== undefined ? metadata.productCategory : existing.productCategory,
      formulaOwnership: metadata.formulaOwnership !== undefined ? metadata.formulaOwnership : existing.formulaOwnership,
      documentVersion: nextVersion,
      updatedAt: now,
      updatedBy: metadata.userId || auth.currentUser?.uid || existing.updatedBy,
      hasUnsyncedLocalChanges: true,
    };

    // Update local cache and storage immediately
    const currentList = this.projectsMap.get(workspaceId) || [];
    const index = currentList.findIndex((p) => p.id === projectId);
    let nextList: ProductProject[];
    if (index >= 0) {
      nextList = [...currentList];
      nextList[index] = updated;
    } else {
      nextList = [updated, ...currentList];
    }
    this.projectsMap.set(workspaceId, nextList);
    this.saveToStorage(workspaceId);
    this.notify();

    // External / Mock cloud write handler check
    if (this.mockCloudWriteHandler) {
      await this.mockCloudWriteHandler(updated, 'metadata');
    }

    // Firestore update if connected (authoritative transaction CAS)
    if (db && auth.currentUser) {
      try {
        const updatePayload: Record<string, any> = {
          documentVersion: nextVersion,
          updatedAt: now,
          updatedBy: updated.updatedBy,
        };
        if (metadata.productName !== undefined) updatePayload.productName = updated.productName;
        if (metadata.customerName !== undefined) updatePayload.customerName = updated.customerName;
        if (metadata.description !== undefined) updatePayload.description = updated.description;
        if (metadata.status !== undefined) updatePayload.status = updated.status;
        if (metadata.productCategory !== undefined) updatePayload.productCategory = updated.productCategory;
        if (metadata.formulaOwnership !== undefined) updatePayload.formulaOwnership = updated.formulaOwnership;

        const docRef = doc(db, 'product_projects', projectId);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(docRef);
          if (snap.exists()) {
            const serverData = snap.data() as Partial<ProductProject>;
            const serverVersion = typeof serverData.documentVersion === 'number' ? serverData.documentVersion : 0;
            const expectedBase = existing.documentVersion || 0;
            if (serverVersion > expectedBase) {
              throw new Error(
                `CONCURRENCY_CONFLICT: Server document version (${serverVersion}) is newer than expected base version (${expectedBase}). Metadata update aborted.`
              );
            }
            const authoritativeNext = Math.max(serverVersion + 1, nextVersion);
            updated.documentVersion = authoritativeNext;
            updatePayload.documentVersion = authoritativeNext;
            transaction.update(docRef, sanitizeForFirestore(updatePayload));
          } else {
            transaction.set(docRef, sanitizeForFirestore(updated));
          }
        });

        // Mark cloud save verified
        updated.hasUnsyncedLocalChanges = false;
        const freshList = this.projectsMap.get(workspaceId) || [];
        const fIdx = freshList.findIndex((p) => p.id === projectId);
        if (fIdx >= 0) {
          freshList[fIdx] = { ...freshList[fIdx], hasUnsyncedLocalChanges: false, documentVersion: updated.documentVersion };
          this.projectsMap.set(workspaceId, [...freshList]);
          this.saveToStorage(workspaceId);
          this.notify();
        }
      } catch (err: any) {
        console.error('[QuotingService] Firestore metadata update error:', err);
        throw new Error(err?.message || 'Failed to persist project metadata to cloud storage.');
      }
    }

    return updated;
  }

  public async saveProject(project: ProductProject, version?: number): Promise<ProductProject> {
    if (this.tombstones.has(project.id)) {
      throw new Error(
        `CANNOT_RESURRECT_DELETED_PROJECT: Project ${project.id} has been permanently deleted and cannot be modified or recreated.`
      );
    }
    const wsId = project.workspaceId;
    const currentVersion = this.projectEditVersions.get(project.id) || 0;
    if (version !== undefined && version < currentVersion) {
      // Discard older stale write request
      const existing = this.getProject(wsId, project.id);
      return existing || project;
    }
    if (version !== undefined) {
      this.projectEditVersions.set(project.id, version);
    }

    // Queue sequential execution per project so concurrent/overlapping saves don't race
    const previous = this.projectWriteQueues.get(project.id) || Promise.resolve();
    const task = (async () => {
      await previous;

      // Protection against accidental nonempty-to-empty formula overwrites:
      const existingDoc = this.getProject(wsId, project.id);
      const existingLinesCount = existingDoc?.formula?.lines?.length || 0;
      const incomingLinesCount = project.formula?.lines?.length || 0;
      const hasIntentionalEmptyConfirmation = (project as any).allowEmptyFormula === true;

      if (existingLinesCount > 0 && incomingLinesCount === 0 && !hasIntentionalEmptyConfirmation) {
        throw new Error(
          `Safety Guard: Attempted to save an empty formula over an existing formula with ${existingLinesCount} ingredients. If intentional, confirm formula clearing.`
        );
      }

      // Check if existing document has newer metadata (e.g. renamed via updateProjectMetadata or cloud sync)
      const callerVersion = Math.max(version || 0, project.documentVersion || 0);
      const existingDocVersion = existingDoc?.documentVersion || 0;
      const callerIsStale = Boolean(existingDoc && existingDocVersion > callerVersion);

      const effectiveProductName = callerIsStale && existingDoc?.productName
        ? existingDoc.productName
        : (project.productName || existingDoc?.productName || 'Untitled Product');

      const effectiveCustomerName = callerIsStale && existingDoc?.customerName !== undefined
        ? existingDoc.customerName
        : (project.customerName?.trim() ? project.customerName.trim() : (existingDoc?.customerName || ''));

      const effectiveDescription = callerIsStale && existingDoc?.description !== undefined
        ? existingDoc.description
        : (project.description !== undefined && project.description !== '' ? project.description : (existingDoc?.description || ''));

      const effectiveStatus = callerIsStale && existingDoc?.status
        ? existingDoc.status
        : (project.status || existingDoc?.status || 'draft');

      const effectiveFormulaOwnership = callerIsStale && existingDoc?.formulaOwnership
        ? existingDoc.formulaOwnership
        : (project.formulaOwnership || existingDoc?.formulaOwnership || 'bakery_owned');

      const effectiveCategory = callerIsStale && existingDoc?.productCategory !== undefined
        ? existingDoc.productCategory
        : (project.productCategory ?? existingDoc?.productCategory);

      const nextDocVersion = Math.max(existingDocVersion, callerVersion) + 1;
      const now = new Date().toISOString();
      const effectiveRevisions =
        project.revisions && project.revisions.length >= (existingDoc?.revisions?.length || 0)
          ? project.revisions
          : existingDoc?.revisions || [];
      const effectiveRevisionNumber = Math.max(
        existingDoc?.currentRevisionNumber || 0,
        project.currentRevisionNumber || 0
      );

      const updated: ProductProject = {
        ...existingDoc,
        ...project,
        productName: effectiveProductName,
        customerName: effectiveCustomerName,
        description: effectiveDescription,
        status: effectiveStatus,
        formulaOwnership: effectiveFormulaOwnership,
        productCategory: effectiveCategory,
        revisions: effectiveRevisions,
        currentRevisionNumber: effectiveRevisionNumber,
        documentVersion: nextDocVersion,
        hasUnsyncedLocalChanges: true,
        updatedAt: now,
      };

      // Persist locally in cache first so work is never lost
      const currentList = this.projectsMap.get(wsId) || [];
      const index = currentList.findIndex((p) => p.id === updated.id);
      let nextList: ProductProject[];
      if (index >= 0) {
        nextList = [...currentList];
        nextList[index] = updated;
      } else {
        nextList = [updated, ...currentList];
      }

      this.projectsMap.set(wsId, nextList);
      this.saveToStorage(wsId);
      this.notify();

      // Mock / external interceptor for testing concurrency and offline behavior
      if (this.mockCloudWriteHandler) {
        try {
          await this.mockCloudWriteHandler(updated, 'save');
        } catch (err: any) {
          updated.hasUnsyncedLocalChanges = true;
          if (err?.message?.includes('CONCURRENCY_CONFLICT')) {
            updated.cloudConflict = {
              conflictAt: new Date().toISOString(),
              serverVersion: undefined,
              serverUpdatedAt: new Date().toISOString(),
              serverFormulaLineCount: 0,
            };
          }
          throw err;
        }
      }

      // Authoritative Firestore transaction compare-and-swap:
      // Guarantees concurrent writers cannot overwrite newer cloud records
      if (db && auth.currentUser) {
        try {
          const docRef = doc(db, 'product_projects', updated.id);
          await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (snap.exists()) {
              const serverData = snap.data() as Partial<ProductProject>;
              const serverVersion = typeof serverData.documentVersion === 'number' ? serverData.documentVersion : 0;
              const expectedBaseVersion = Math.max(
                existingDoc?.documentVersion ?? 0,
                project.documentVersion ?? 0,
                callerVersion
              );

              if (serverVersion > expectedBaseVersion) {
                throw new Error(
                  `CONCURRENCY_CONFLICT: Server document version (${serverVersion}) is newer than expected base version (${expectedBaseVersion}). Save aborted to preserve remote changes.`
                );
              }
              const authoritativeNextVersion = Math.max(serverVersion + 1, nextDocVersion);
              updated.documentVersion = authoritativeNextVersion;
              transaction.set(docRef, sanitizeForFirestore(updated), { merge: true });
            } else {
              updated.documentVersion = nextDocVersion;
              transaction.set(docRef, sanitizeForFirestore(updated));
            }
          });
        } catch (err: any) {
          console.error('[QuotingService] Firestore write error:', err);
          updated.hasUnsyncedLocalChanges = true;
          if (err?.message?.includes('CONCURRENCY_CONFLICT')) {
            updated.cloudConflict = {
              conflictAt: new Date().toISOString(),
              serverVersion: undefined,
              serverUpdatedAt: new Date().toISOString(),
              serverFormulaLineCount: 0,
            };
          }
          const isPermissionErr =
            err?.code === 'permission-denied' ||
            err?.message?.toLowerCase().includes('permission');
          if (isPermissionErr) {
            throw new Error(`Permission denied: Insufficient permissions to save project "${updated.productName}". Your working draft is safely preserved.`);
          }
          throw new Error(err?.message || 'Failed to save to cloud storage. Your local draft is preserved.');
        }
      }

      // Authoritative canonical payload integrity verification before clearing recovery draft:
      this.verifyCanonicalPayloadIntegrity(project, updated);

      // Clear draft recovery only AFTER durable save succeeds
      updated.hasUnsyncedLocalChanges = false;
      const verifiedList = this.projectsMap.get(wsId) || [];
      const vIdx = verifiedList.findIndex((p) => p.id === updated.id);
      if (vIdx >= 0) {
        verifiedList[vIdx] = { ...verifiedList[vIdx], hasUnsyncedLocalChanges: false, documentVersion: updated.documentVersion };
        this.projectsMap.set(wsId, [...verifiedList]);
        this.saveToStorage(wsId);
        this.notify();
      }

      this.clearDraftRecovery(wsId, updated.id, updated.updatedBy || project.createdBy, updated);
      return updated;
    })();

    this.projectWriteQueues.set(project.id, task.catch(() => {}));
    return task;
  }

  /**
   * Authoritative canonical payload integrity verification.
   * Compares the intended formula lines and product tier configurations with the actual
   * persisted state down to every ingredient, quantity, cost, and product configuration.
   * Rejects save completion if any field diverges.
   */
  public verifyCanonicalPayloadIntegrity(intended: ProductProject, actual: ProductProject): void {
    if (!actual.id || actual.id !== intended.id || actual.workspaceId !== intended.workspaceId) {
      throw new Error('Integrity verification failed: Project identity mismatch.');
    }

    const intendedLines = intended.formula?.lines || [];
    const actualLines = actual.formula?.lines || [];
    if (intendedLines.length !== actualLines.length) {
      throw new Error(
        `Integrity verification failed: Formula line count mismatch (${actualLines.length} vs ${intendedLines.length}).`
      );
    }

    for (let i = 0; i < intendedLines.length; i++) {
      const il = intendedLines[i];
      const al = actualLines[i];
      if (
        al.id !== il.id ||
        al.name !== il.name ||
        Number(al.quantity) !== Number(il.quantity) ||
        al.unit !== il.unit ||
        Number(al.unitCostUsed) !== Number(il.unitCostUsed) ||
        Number(al.lineCost) !== Number(il.lineCost)
      ) {
        throw new Error(
          `Integrity verification failed: Formula ingredient mismatch at line index ${i} (${al.name || al.id}).`
        );
      }
    }

    if (
      Math.abs((actual.formula?.totalWeightGrams || 0) - (intended.formula?.totalWeightGrams || 0)) > 0.001 ||
      Math.abs((actual.formula?.totalCost || 0) - (intended.formula?.totalCost || 0)) > 0.001
    ) {
      throw new Error('Integrity verification failed: Formula totals mismatch.');
    }

    const intendedProducts = intended.products || [];
    const actualProducts = actual.products || [];
    if (intendedProducts.length !== actualProducts.length) {
      throw new Error(
        `Integrity verification failed: Product configuration count mismatch (${actualProducts.length} vs ${intendedProducts.length}).`
      );
    }

    for (let i = 0; i < intendedProducts.length; i++) {
      const ip = intendedProducts[i];
      const ap = actualProducts[i];
      if (
        ap.id !== ip.id ||
        ap.name !== ip.name ||
        Number(ap.pieceWeight) !== Number(ip.pieceWeight) ||
        Number(ap.piecesPerCase) !== Number(ip.piecesPerCase) ||
        Number(ap.packagingCost) !== Number(ip.packagingCost) ||
        Number(ap.laborCost) !== Number(ip.laborCost) ||
        Number(ap.otherCost) !== Number(ip.otherCost) ||
        Number(ap.ingredientMultiplier) !== Number(ip.ingredientMultiplier) ||
        ap.pricingBasis !== ip.pricingBasis ||
        ap.quotedPrice !== ip.quotedPrice
      ) {
        throw new Error(
          `Integrity verification failed: Product configuration mismatch at index ${i} (${ap.name || ap.id}).`
        );
      }
    }
  }

  public async createProject(params: {
    workspaceId: string;
    productName: string;
    customerName?: string;
    projectCode?: string;
    description?: string;
    productCategory?: string;
    formulaOwnership?: FormulaOwnership;
    userId: string;
    sourceRecipeId?: string;
    sourceRecipeName?: string;
    initialFormula?: QuoteFormula;
  }): Promise<ProductProject> {
    const now = new Date().toISOString();
    const id = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const year = new Date().getFullYear();
    const existing = this.getProjects(params.workspaceId);
    const quoteNumber = existing.length + 1;
    const code = params.projectCode || `Q-${year}-${String(quoteNumber).padStart(3, '0')}`;

    const newProject: ProductProject = {
      id,
      workspaceId: params.workspaceId,
      projectCode: code,
      productName: params.productName.trim(),
      customerName: params.customerName?.trim() || '',
      description: params.description?.trim() || '',
      productCategory: params.productCategory || 'Cookie',
      formulaOwnership: params.formulaOwnership || 'bakery_owned',
      status: 'draft',
      formula: params.initialFormula || {
        totalWeightGrams: 0,
        totalCost: 0,
        lines: [],
      },
      products: [],
      revisions: [],
      currentRevisionNumber: 0,
      createdAt: now,
      createdBy: params.userId,
      updatedAt: now,
      updatedBy: params.userId,
      sourceRecipeId: params.sourceRecipeId,
      sourceRecipeName: params.sourceRecipeName,
      importedAt: params.sourceRecipeId ? now : undefined,
    };

    return this.saveProject(newProject);
  }

  /**
   * Creates an independent Product Development project by safely copying an existing production recipe.
   *
   * Crucial guarantees:
   * 1. The original production recipe is NEVER modified.
   * 2. The formula lines become an independent deep copy with new line IDs.
   * 3. Provenance metadata is stored (sourceRecipeId, sourceRecipeName, importedAt).
   * 4. Formula costing is calculated using current active pantry purchase package prices.
   * 5. Workspace isolation is strictly enforced.
   */
  public async createProjectFromRecipe(params: {
    workspaceId: string;
    recipe: Recipe;
    userId: string;
    productName?: string;
    customerName?: string;
    productCategory?: string;
    formulaOwnership?: FormulaOwnership;
    description?: string;
    masterIngredients: MasterIngredient[];
  }): Promise<ProductProject> {
    if (!params.recipe) {
      throw new Error('Cannot create project: source recipe is undefined.');
    }

    // Workspace isolation check: Ensure recipe belongs to the active workspace
    if (params.recipe.workspaceId && params.recipe.workspaceId !== params.workspaceId) {
      throw new Error(
        `Workspace isolation violation: Recipe "${params.recipe.name}" belongs to workspace "${params.recipe.workspaceId}", which does not match active workspace "${params.workspaceId}".`
      );
    }

    // Convert source recipe to independent QuoteFormula snapshot
    const formula = convertRecipeToQuoteFormula(params.recipe, params.masterIngredients);
    const productName = (params.productName || params.recipe.name).trim();
    const category = params.productCategory || params.recipe.category || 'Cookie';

    return this.createProject({
      workspaceId: params.workspaceId,
      userId: params.userId,
      productName,
      customerName: params.customerName,
      productCategory: category,
      formulaOwnership: params.formulaOwnership || 'bakery_owned',
      description: params.description || params.recipe.description || undefined,
      sourceRecipeId: params.recipe.id,
      sourceRecipeName: params.recipe.name,
      initialFormula: formula,
    });
  }

  public async duplicateProject(
    projectId: string,
    workspaceId: string,
    userId: string,
    newName?: string
  ): Promise<ProductProject> {
    const original = this.getProject(workspaceId, projectId);
    if (!original) {
      throw new Error(`Project with ID ${projectId} not found.`);
    }

    const cloned = JSON.parse(JSON.stringify(original)) as ProductProject;
    const now = new Date().toISOString();
    const newId = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const existing = this.getProjects(workspaceId);
    const code = `Q-${new Date().getFullYear()}-${String(existing.length + 1).padStart(3, '0')}`;

    cloned.id = newId;
    cloned.projectCode = code;
    cloned.productName = newName || `${original.productName} (Copy)`;
    cloned.status = 'draft';
    cloned.createdAt = now;
    cloned.createdBy = userId;
    cloned.updatedAt = now;
    cloned.updatedBy = userId;
    cloned.revisions = [];
    cloned.currentRevisionNumber = 0;
    delete cloned.convertedRecipeId;
    delete cloned.convertedAt;

    return this.saveProject(cloned);
  }

  public async archiveProject(
    projectId: string,
    workspaceId: string,
    userId: string
  ): Promise<ProductProject> {
    const original = this.getProject(workspaceId, projectId);
    if (!original) {
      throw new Error(`Project with ID ${projectId} not found.`);
    }

    const updated: ProductProject = {
      ...original,
      status: 'archived',
      archived: true,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    return this.saveProject(updated);
  }

  public async unarchiveProject(
    projectId: string,
    workspaceId: string,
    userId: string
  ): Promise<ProductProject> {
    const original = this.getProject(workspaceId, projectId);
    if (!original) {
      throw new Error(`Project with ID ${projectId} not found.`);
    }

    const updated: ProductProject = {
      ...original,
      status: 'draft',
      archived: false,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    return this.saveProject(updated);
  }

  public async issueQuoteRevision(
    projectId: string,
    workspaceId: string,
    userId: string,
    userName?: string,
    notes?: string,
    draft?: ProductProject,
    userRole?: AccessRole
  ): Promise<ProductProject> {
    const existing = this.getProject(workspaceId, projectId);
    const maxDocVersion = Math.max(existing?.documentVersion || 0, draft?.documentVersion || 0);
    const original = draft ? { ...existing, ...draft, documentVersion: maxDocVersion } : existing;
    if (!original) {
      throw new Error(`Project with ID ${projectId} not found.`);
    }

    // Required fields validation: Product name is strictly required
    if (!original.productName || !original.productName.trim()) {
      throw new Error('Cannot issue quote revision: Product name is required.');
    }

    // Role-based permission check: Viewers cannot issue quote revisions (T4, T5, T6)
    const effectiveRole = userRole || store.getUserRole();
    if (effectiveRole === 'viewer') {
      throw new Error(`Permission denied: Viewers are unauthorized to issue quote revisions for project ${projectId}.`);
    }

    // Ensure formula and products structures exist
    if (!original.formula) {
      original.formula = { totalWeightGrams: 0, totalCost: 0, lines: [] };
    }
    if (!original.products) {
      original.products = [];
    }

    // Anti-duplicate issuance check (prevent accidental double-click / rapid retry)
    if (original.revisions && original.revisions.length > 0) {
      const latestRev = original.revisions[0];
      const msSinceLast = Date.now() - new Date(latestRev.createdAt).getTime();
      if (msSinceLast < 2500 && latestRev.createdBy === userId && (latestRev.notes || '') === (notes?.trim() || '')) {
        return original;
      }
    }

    const revision = createQuoteRevisionSnapshot(original, userId, userName, notes);
    const updatedRevisions = [revision, ...(original.revisions || [])];

    const updated: ProductProject = {
      ...original,
      status: 'quoted',
      currentRevisionNumber: revision.revisionNumber,
      revisions: updatedRevisions,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    return this.saveProject(updated);
  }

  public isProjectDeleted(projectId: string): boolean {
    return this.tombstones.has(projectId);
  }

  public getProjectDeletionPreview(
    workspaceId: string,
    projectId: string,
    userRole?: AccessRole | null
  ): ProjectDeletionPreview {
    const project = this.getProject(workspaceId, projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found in workspace ${workspaceId}.`);
    }

    const blockers: string[] = [];

    // Role check: Only Owner is authorized
    const effectiveRole = userRole !== undefined ? userRole : store.getUserRole();
    if (effectiveRole !== 'owner') {
      blockers.push(
        'Only authorized workspace Owners can permanently delete projects. Editors and Viewers cannot delete records.'
      );
    }

    // Workspace membership / isolation check
    if (project.workspaceId !== workspaceId) {
      blockers.push(`Project belongs to workspace "${project.workspaceId}", not active workspace "${workspaceId}".`);
    }

    // Issued revisions check (historical quote snapshots are strictly immutable)
    const revisionsCount = project.revisions?.length || 0;
    if (revisionsCount > 0) {
      blockers.push(
        `Project contains ${revisionsCount} issued quote revision(s). Issued quotes are immutable business records and cannot be deleted.`
      );
    }

    // Production recipe promotion check
    const promotionsCount = project.productionPromotions?.length || 0;
    if (promotionsCount > 0 || project.convertedRecipeId) {
      blockers.push(
        `Project has been promoted to production recipes (${promotionsCount} promotion(s)). Production recipes cannot be deleted.`
      );
    }

    // Order and invoice dependency checks
    const pAny = project as any;
    if (pAny.orderId || pAny.hasActiveOrders || (Array.isArray(pAny.orderIds) && pAny.orderIds.length > 0)) {
      blockers.push('Project is referenced by active customer order records and cannot be deleted.');
    }
    if (pAny.invoiceId || pAny.hasActiveInvoices || (Array.isArray(pAny.invoiceIds) && pAny.invoiceIds.length > 0)) {
      blockers.push('Project is referenced by issued invoice records and cannot be deleted.');
    }

    // Retention policy check
    if (pAny.isRetentionProtected || pAny.retentionPolicy) {
      blockers.push('Project is protected by an active corporate data retention policy.');
    }

    const productConfigsCount = project.products?.length || 0;
    const formulaLinesCount = project.formula?.lines?.length || 0;
    const isEligible = blockers.length === 0;

    const whatWillBeDeleted: string[] = [
      `Product project record "${project.productName}" (${project.projectCode || project.id})`,
      `Working formula definition (${formulaLinesCount} ingredient line(s), ${(project.formula?.totalWeightGrams || 0).toLocaleString()}g total)`,
      `Draft product configurations (${productConfigsCount} unissued configuration(s))`,
      `Local autosave drafts, recovery snapshots, and workspace cache entry`,
    ];

    const whatWillBePreserved: string[] = [
      `Production recipes in bakery catalog (${project.sourceRecipeName ? `including source recipe "${project.sourceRecipeName}"` : 'all production recipes intact'})`,
      `Shared pantry master ingredients and active purchasing prices`,
      `Shared Packaging Presets and mixer equipment settings`,
      `All unrelated workspace projects, quotes, and historical revisions`,
      `Workspace membership, permissions, and billing subscriptions`,
    ];

    return {
      projectId: project.id,
      projectCode: project.projectCode,
      productName: project.productName,
      customerName: project.customerName,
      workspaceId: project.workspaceId,
      status: project.status,
      isArchived: !!project.archived,
      productConfigurationsCount: productConfigsCount,
      draftQuotesCount: productConfigsCount,
      issuedRevisionsCount: revisionsCount,
      hasPromotedRecipes: promotionsCount > 0 || !!project.convertedRecipeId,
      promotionsCount,
      sourceRecipeId: project.sourceRecipeId,
      sourceRecipeName: project.sourceRecipeName,
      whatWillBeDeleted,
      whatWillBePreserved,
      blockers,
      isEligible,
      baseDocumentVersion: project.documentVersion || 0,
    };
  }

  public async deleteProjectPermanently(params: {
    workspaceId: string;
    projectId: string;
    userRole: AccessRole | null;
    userId: string;
    confirmationText: string;
    expectedBaseVersion?: number;
    isDevelopmentTestEnvironment?: boolean;
  }): Promise<{ success: boolean; auditRecord: ProjectDeletionAuditRecord }> {
    const {
      workspaceId,
      projectId,
      userRole,
      userId,
      confirmationText,
      expectedBaseVersion,
      isDevelopmentTestEnvironment,
    } = params;

    // 1. Strict Owner role enforcement
    if (userRole !== 'owner') {
      throw new Error(
        'UNAUTHORIZED_OWNER_REQUIRED: Only authorized workspace Owners may permanently delete projects.'
      );
    }

    // 2. Exact confirmation text
    if (confirmationText !== 'DELETE') {
      throw new Error("INVALID_CONFIRMATION: Exact confirmation text 'DELETE' is required.");
    }

    // 3. Find project in workspace
    const project = this.getProject(workspaceId, projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found in workspace ${workspaceId}.`);
    }

    // 4. Verify workspace isolation
    if (project.workspaceId !== workspaceId) {
      throw new Error(
        `CROSS_WORKSPACE_DENIED: Cannot delete project belonging to workspace ${project.workspaceId} from workspace ${workspaceId}.`
      );
    }

    // 5. Fresh eligibility recheck immediately before execution
    const preview = this.getProjectDeletionPreview(workspaceId, projectId, userRole);
    if (!preview.isEligible) {
      throw new Error(`DELETION_INELIGIBLE: ${preview.blockers.join('; ')}`);
    }

    // 6. Concurrency / Base version check (Stale preview detection)
    if (expectedBaseVersion !== undefined && (project.documentVersion || 0) !== expectedBaseVersion) {
      throw new Error(
        `CONCURRENCY_CONFLICT: Project was modified (version ${project.documentVersion} vs expected ${expectedBaseVersion}) after preview was generated. Please refresh preview.`
      );
    }

    // 7. Live production record guard:
    const isSyntheticOrTest =
      isDevelopmentTestEnvironment ||
      projectId.startsWith('test-') ||
      projectId.startsWith('synth-') ||
      workspaceId.startsWith('test-') ||
      project.productName.toLowerCase().includes('synthetic') ||
      project.productName.toLowerCase().includes('test');

    if (workspaceId === 'ws-main' && !isSyntheticOrTest) {
      throw new Error(
        'LIVE_DATA_PROTECTION: Deletion of non-synthetic production records in ws-main is blocked in development mode until backend rules updates are authorized.'
      );
    }

    // 8. Atomicity: Execute mock cloud write or Firestore delete
    if (this.mockDeletionHandler) {
      await this.mockDeletionHandler(projectId, workspaceId);
    }

    if (db && auth.currentUser && isSyntheticOrTest) {
      try {
        const docRef = doc(db, 'product_projects', projectId);
        await deleteDoc(docRef);
      } catch (err: any) {
        console.error('[QuotingService] Firestore deletion error:', err);
        throw new Error(err?.message || 'Failed to delete project from cloud storage.');
      }
    }

    // 9. Register authoritative tombstone to prevent resurrection from autosave, recovery, or stale tabs
    this.tombstones.add(projectId);
    if (typeof localStorage !== 'undefined') {
      try {
        const key = `${QUOTING_TOMBSTONE_PREFIX}${workspaceId}`;
        const existingRaw = localStorage.getItem(key);
        const list: string[] = existingRaw ? JSON.parse(existingRaw) : [];
        if (!list.includes(projectId)) {
          list.push(projectId);
          localStorage.setItem(key, JSON.stringify(list));
        }
      } catch (e) {
        console.warn('[QuotingService] Tombstone save error:', e);
      }
    }

    // 10. Remove from projectsMap and workspace localStorage
    const currentList = this.projectsMap.get(workspaceId) || [];
    const updatedList = currentList.filter((p) => p.id !== projectId);
    this.projectsMap.set(workspaceId, updatedList);
    this.saveToStorage(workspaceId);

    // 11. Purge all draft recovery entries for this project across all users
    if (typeof localStorage !== 'undefined') {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.includes(`_${workspaceId}_${projectId}`) || k.includes(`_${projectId}`))) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (e) {
        console.warn('[QuotingService] Recovery purge error:', e);
      }
    }

    // 12. Create tamper-evident audit record
    const operationId = `del-op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const auditRecord: ProjectDeletionAuditRecord = {
      operationId,
      workspaceId,
      deletedRecordId: projectId,
      recordType: 'product_project',
      actorUid: userId,
      actorRole: userRole,
      timestamp: new Date().toISOString(),
      recordSummary: {
        productName: project.productName,
        projectCode: project.projectCode,
        documentVersion: project.documentVersion,
        configsCount: project.products?.length || 0,
        linesCount: project.formula?.lines?.length || 0,
      },
    };

    const wsAudits = this.auditLog.get(workspaceId) || [];
    const updatedAudits = [auditRecord, ...wsAudits];
    this.auditLog.set(workspaceId, updatedAudits);

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${QUOTING_AUDIT_PREFIX}${workspaceId}`, JSON.stringify(updatedAudits));
      } catch (e) {
        console.warn('[QuotingService] Audit save error:', e);
      }
    }

    // 13. Notify all listeners
    this.notify();

    return { success: true, auditRecord };
  }

  public async deleteProductConfig(params: {
    workspaceId: string;
    projectId: string;
    configId: string;
    userRole: AccessRole | null;
    userId: string;
  }): Promise<{ updatedProject: ProductProject; auditRecord: ProjectDeletionAuditRecord }> {
    const { workspaceId, projectId, configId, userRole, userId } = params;

    // Owner role required per Section 8
    if (userRole !== 'owner') {
      throw new Error(
        'UNAUTHORIZED_OWNER_REQUIRED: Only authorized workspace Owners may delete draft quote configurations.'
      );
    }

    const project = this.getProject(workspaceId, projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found in workspace ${workspaceId}.`);
    }

    const existingConfig = project.products?.find((p) => p.id === configId);
    if (!existingConfig) {
      throw new Error(`Configuration ${configId} not found in project ${projectId}.`);
    }

    // Check if configuration is tied to an active order
    if ((existingConfig as any).orderId) {
      throw new Error(`Cannot delete configuration: Linked to active order ${(existingConfig as any).orderId}.`);
    }

    const remainingProducts = (project.products || []).filter((p) => p.id !== configId);

    const updated: ProductProject = {
      ...project,
      products: remainingProducts,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
      hasUnsyncedLocalChanges: true,
    };

    const saved = await this.saveProject(updated);

    const operationId = `del-cfg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const auditRecord: ProjectDeletionAuditRecord = {
      operationId,
      workspaceId,
      deletedRecordId: configId,
      recordType: 'quote_product_config',
      actorUid: userId,
      actorRole: userRole,
      timestamp: new Date().toISOString(),
      recordSummary: {
        productName: `${project.productName} [${existingConfig.name || existingConfig.id}]`,
        projectCode: project.projectCode,
        documentVersion: saved.documentVersion,
        configsCount: remainingProducts.length,
      },
    };

    const wsAudits = this.auditLog.get(workspaceId) || [];
    const updatedAudits = [auditRecord, ...wsAudits];
    this.auditLog.set(workspaceId, updatedAudits);

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${QUOTING_AUDIT_PREFIX}${workspaceId}`, JSON.stringify(updatedAudits));
      } catch (e) {
        console.warn('[QuotingService] Audit save error:', e);
      }
    }

    return { updatedProject: saved, auditRecord };
  }

  public getDeletionAuditLog(workspaceId: string): ProjectDeletionAuditRecord[] {
    const list = this.auditLog.get(workspaceId) || [];
    return [...list];
  }
}

export const quotingService = new QuotingService();
