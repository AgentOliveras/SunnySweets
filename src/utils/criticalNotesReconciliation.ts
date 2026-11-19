import { AccessRole, CriticalProductionNote, ProductionPreset, Recipe } from '../types';
import { extractCanonicalCriticalNotesFromPresets } from './productionNotes';

/**
 * Critical Production Notes Data Preservation & Owner-Guided Reconciliation Engine
 *
 * Enforces:
 * 1. Non-destructive durable local backup (`sunny_sweets_critical_notes_backup_v1`)
 *    preserved across sign-out, workspace switching, and post-migration.
 * 2. Strict workspace isolation (notes from another workspace are never exposed).
 * 3. Owner-only three-way reconciliation comparing:
 *    - Desktop localStorage (`recipe_calc_critical_notes` + durable backup)
 *    - Canonical Cloud Firestore (`presets/{presetId}.criticalNotes`)
 *    - Recipe-Wide safety field (`Recipe.description`)
 * 4. Zero automatic conflict resolution by timestamp — text differences always
 *    require explicit Owner selection.
 */

export const LEGACY_LOCAL_CRITICAL_NOTES_KEY = 'recipe_calc_critical_notes';
export const DURABLE_CRITICAL_NOTES_BACKUP_KEY = 'sunny_sweets_critical_notes_backup_v1';
export const PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID = 'cpn-sunny-sweets-chocolate-chip-1oz';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export type OwnerReconciliationAction =
  | 'promote_local'
  | 'keep_cloud'
  | 'manual_review'
  | 'leave_unchanged';

export type ReconciliationItemStatus =
  | 'LOCAL_ONLY'
  | 'CONFLICT_TEXT_MISMATCH'
  | 'ALREADY_IN_SYNC'
  | 'CLOUD_ONLY';

export interface DurableCriticalNoteBackupRecord {
  key: string;
  note: CriticalProductionNote;
  firstCapturedAt: string;
  lastCapturedAt: string;
  origin: 'recipe_calc_critical_notes' | 'backup';
}

export interface DurableReconciliationDecisionRecord {
  itemKey: string;
  action: OwnerReconciliationAction;
  resolvedAt: string;
  resolvedByUid?: string;
  localNoteSnapshot?: string;
  cloudNoteSnapshot?: string;
  cloudUpdatedAt?: string;
}

export interface CriticalNotesBackupEnvelope {
  version: 1;
  lastCapturedAt: string;
  records: Record<string, DurableCriticalNoteBackupRecord>;
  resolvedItems: Record<string, DurableReconciliationDecisionRecord>;
}

export interface CriticalNoteReconciliationItem {
  itemKey: string;
  status: ReconciliationItemStatus;
  presetId: string;
  presetName: string;
  presetExistsInWorkspace: boolean;
  recipeId: string;
  recipeName: string;
  recipeExistsInWorkspace: boolean;
  workspaceId: string;
  sourceLabel: string;
  localNote: CriticalProductionNote | null;
  cloudNote: CriticalProductionNote | null;
  recipeWideNoteText: string | null;
  lastModifiedTimestamp: string;
  proposedAction: OwnerReconciliationAction;
  canPromoteToCloud: boolean;
  cannotPromoteReason?: string;
  isProtected1ozBaselineNote: boolean;
  hasAuthoritativeCloudCopy: boolean;
  previouslyReconciled?: DurableReconciliationDecisionRecord;
}

export interface RecipeWideSafetySummaryItem {
  recipeId: string;
  recipeName: string;
  category: string;
  description: string;
  updatedAt: string;
}

export interface CriticalNotesReconciliationReport {
  isOwnerAuthorized: boolean;
  workspaceId: string;
  inspectedAt: string;
  items: CriticalNoteReconciliationItem[];
  actionableItems: CriticalNoteReconciliationItem[];
  localOnlyCount: number;
  conflictCount: number;
  inSyncCount: number;
  cloudOnlyCount: number;
  durableBackupRecordCount: number;
  recipeWideNotes: RecipeWideSafetySummaryItem[];
  hasActionableDifferences: boolean;
}

export function assertOwnerCanReconcileCriticalNotes(role: AccessRole | null | undefined): void {
  if (role !== 'owner') {
    throw new Error(
      'Permission denied: Only the Workspace Owner can review and approve Critical Production Note reconciliation.'
    );
  }
}

function makeBackupRecordKey(note: CriticalProductionNote): string {
  const ws = (note.workspaceId || 'ws-main').trim();
  const id = (note.id || '').trim();
  const presetId = (note.presetId || '').trim();
  const recipeId = (note.recipeId || '').trim();
  return `${ws}::${presetId}::${recipeId}::${id}`;
}

export function makeReconciliationItemKey(
  workspaceId: string,
  presetId: string,
  recipeId: string
): string {
  return `${workspaceId.trim()}::${presetId.trim()}::${recipeId.trim()}`;
}

function safeParseArray(raw: string | null): CriticalProductionNote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n) =>
        Boolean(
          n &&
            typeof n === 'object' &&
            typeof n.presetId === 'string' &&
            n.presetId.trim() &&
            typeof n.recipeId === 'string' &&
            n.recipeId.trim() &&
            typeof n.note === 'string' &&
            n.note.trim()
        )
    );
  } catch {
    return [];
  }
}

export function readDurableCriticalNotesBackup(
  storage: StorageLike | null | undefined
): CriticalNotesBackupEnvelope {
  const empty: CriticalNotesBackupEnvelope = {
    version: 1,
    lastCapturedAt: '',
    records: {},
    resolvedItems: {},
  };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    return {
      version: 1,
      lastCapturedAt: typeof parsed.lastCapturedAt === 'string' ? parsed.lastCapturedAt : '',
      records: parsed.records && typeof parsed.records === 'object' ? { ...parsed.records } : {},
      resolvedItems:
        parsed.resolvedItems && typeof parsed.resolvedItems === 'object'
          ? { ...parsed.resolvedItems }
          : {},
    };
  } catch {
    return empty;
  }
}

/**
 * Non-destructively captures all notes from `recipe_calc_critical_notes` into
 * `sunny_sweets_critical_notes_backup_v1` without clearing or deleting the source key.
 * Preserves original note IDs, text, recipe IDs, preset IDs, timestamps, and workspace IDs.
 */
export function captureNonDestructiveCriticalNotesBackup(
  storage: StorageLike | null | undefined
): CriticalNotesBackupEnvelope {
  const existing = readDurableCriticalNotesBackup(storage);
  if (!storage) return existing;

  const legacyNotes = safeParseArray(storage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY));
  if (legacyNotes.length === 0) {
    return existing;
  }

  const nowIso = new Date().toISOString();
  const nextRecords: Record<string, DurableCriticalNoteBackupRecord> = {
    ...existing.records,
  };
  let changed = false;

  for (const rawNote of legacyNotes) {
    const preservedNote: CriticalProductionNote = {
      id: rawNote.id,
      presetId: rawNote.presetId,
      recipeId: rawNote.recipeId,
      ...(rawNote.workspaceId ? { workspaceId: rawNote.workspaceId } : {}),
      note: rawNote.note,
      createdAt: rawNote.createdAt || '',
      updatedAt: rawNote.updatedAt || rawNote.createdAt || '',
      ...(rawNote.createdBy ? { createdBy: rawNote.createdBy } : {}),
    };

    const recordKey = makeBackupRecordKey(preservedNote);
    const prev = nextRecords[recordKey];
    if (!prev) {
      nextRecords[recordKey] = {
        key: recordKey,
        note: preservedNote,
        firstCapturedAt: nowIso,
        lastCapturedAt: nowIso,
        origin: 'recipe_calc_critical_notes',
      };
      changed = true;
    } else if (
      prev.note.note !== preservedNote.note ||
      prev.note.updatedAt !== preservedNote.updatedAt
    ) {
      // If local note changed, keep previous version under an archive key and store latest
      const archiveKey = `${recordKey}::archived::${prev.note.updatedAt || prev.lastCapturedAt}`;
      if (!nextRecords[archiveKey]) {
        nextRecords[archiveKey] = {
          ...prev,
          key: archiveKey,
          origin: 'backup',
        };
      }
      nextRecords[recordKey] = {
        key: recordKey,
        note: preservedNote,
        firstCapturedAt: prev.firstCapturedAt,
        lastCapturedAt: nowIso,
        origin: 'recipe_calc_critical_notes',
      };
      changed = true;
    }
  }

  const nextEnvelope: CriticalNotesBackupEnvelope = {
    version: 1,
    lastCapturedAt: changed ? nowIso : existing.lastCapturedAt || nowIso,
    records: nextRecords,
    resolvedItems: { ...existing.resolvedItems },
  };

  if (changed || !existing.lastCapturedAt) {
    try {
      storage.setItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY, JSON.stringify(nextEnvelope));
    } catch {
      // Ignore quota errors in constrained environments
    }
  }

  return nextEnvelope;
}

/**
 * Records an Owner's verified reconciliation decision inside the durable backup envelope
 * WITHOUT deleting the backed-up local notes.
 */
export function recordVerifiedReconciliationDecision(
  storage: StorageLike | null | undefined,
  decision: DurableReconciliationDecisionRecord
): CriticalNotesBackupEnvelope {
  const envelope = captureNonDestructiveCriticalNotesBackup(storage);
  const nextEnvelope: CriticalNotesBackupEnvelope = {
    ...envelope,
    lastCapturedAt: new Date().toISOString(),
    resolvedItems: {
      ...envelope.resolvedItems,
      [decision.itemKey]: decision,
    },
  };
  if (storage) {
    try {
      storage.setItem(DURABLE_CRITICAL_NOTES_BACKUP_KEY, JSON.stringify(nextEnvelope));
    } catch {
      // Ignore storage write errors
    }
  }
  return nextEnvelope;
}

/**
 * Reads preserved local Critical Production Notes strictly scoped to `activeWorkspaceId`.
 * Never exposes notes belonging to another workspace.
 */
export function readPreservedLocalNotesForWorkspace(
  storage: StorageLike | null | undefined,
  activeWorkspaceId: string
): {
  notes: CriticalProductionNote[];
  envelope: CriticalNotesBackupEnvelope;
} {
  const wsId = (activeWorkspaceId || '').trim();
  const envelope = captureNonDestructiveCriticalNotesBackup(storage);
  if (!wsId || !storage) {
    return { notes: [], envelope };
  }

  const directLegacy = safeParseArray(storage.getItem(LEGACY_LOCAL_CRITICAL_NOTES_KEY));
  const combinedByPair = new Map<string, CriticalProductionNote>();

  const considerNote = (candidate: CriticalProductionNote) => {
    const noteWs = (candidate.workspaceId || 'ws-main').trim();
    // Strict workspace isolation: legacy notes without workspaceId belong only to ws-main
    if (noteWs !== wsId) return;

    const pairKey = `${candidate.presetId.trim()}::${candidate.recipeId.trim()}`;
    const existing = combinedByPair.get(pairKey);
    if (!existing) {
      combinedByPair.set(pairKey, {
        ...candidate,
        workspaceId: noteWs,
      });
      return;
    }
    // If both backup and direct legacy exist for same pair, prefer direct legacy unless identical
    const existingTs = existing.updatedAt || existing.createdAt || '';
    const candidateTs = candidate.updatedAt || candidate.createdAt || '';
    if (candidateTs >= existingTs) {
      combinedByPair.set(pairKey, {
        ...candidate,
        workspaceId: noteWs,
      });
    }
  };

  Object.values(envelope.records).forEach((rec) => {
    if (rec.key.includes('::archived::')) return;
    considerNote(rec.note);
  });

  directLegacy.forEach((n) => considerNote(n));

  return {
    notes: Array.from(combinedByPair.values()),
    envelope,
  };
}

/**
 * Performs a non-destructive three-way inspection between:
 * 1. Local desktop browser storage (`recipe_calc_critical_notes` + durable backup)
 * 2. Authoritative Cloud Firestore (`presets/{presetId}.criticalNotes`)
 * 3. Recipe-Wide safety notes (`Recipe.description`)
 *
 * Never resolves text conflicts automatically by timestamp.
 */
export function inspectCriticalNotesReconciliation(params: {
  userRole: AccessRole | null | undefined;
  activeWorkspaceId: string;
  storage: StorageLike | null | undefined;
  cloudPresets: ProductionPreset[];
  recipes: Recipe[];
}): CriticalNotesReconciliationReport {
  const { userRole, activeWorkspaceId, storage, cloudPresets, recipes } = params;
  const wsId = (activeWorkspaceId || '').trim();
  const nowIso = new Date().toISOString();

  if (userRole !== 'owner' || !wsId) {
    return {
      isOwnerAuthorized: false,
      workspaceId: wsId,
      inspectedAt: nowIso,
      items: [],
      actionableItems: [],
      localOnlyCount: 0,
      conflictCount: 0,
      inSyncCount: 0,
      cloudOnlyCount: 0,
      durableBackupRecordCount: 0,
      recipeWideNotes: [],
      hasActionableDifferences: false,
    };
  }

  const { notes: localNotes, envelope } = readPreservedLocalNotesForWorkspace(storage, wsId);

  const wsPresets = (cloudPresets || []).filter(
    (p) => p && p.id && (!p.workspaceId || p.workspaceId === wsId)
  );
  const wsRecipes = (recipes || []).filter(
    (r) => r && r.id && (!r.workspaceId || r.workspaceId === wsId)
  );

  const presetById = new Map<string, ProductionPreset>(wsPresets.map((p) => [p.id, p]));
  const recipeById = new Map<string, Recipe>(wsRecipes.map((r) => [r.id, r]));

  const canonicalCloudNotes = extractCanonicalCriticalNotesFromPresets(wsPresets, wsId);

  const localByPair = new Map<string, CriticalProductionNote>();
  for (const ln of localNotes) {
    localByPair.set(`${ln.presetId.trim()}::${ln.recipeId.trim()}`, ln);
  }

  const cloudByPair = new Map<string, CriticalProductionNote>();
  for (const cn of canonicalCloudNotes) {
    cloudByPair.set(`${cn.presetId.trim()}::${cn.recipeId.trim()}`, cn);
  }

  const allPairKeys = Array.from(
    new Set<string>([...localByPair.keys(), ...cloudByPair.keys()])
  ).sort();

  const items: CriticalNoteReconciliationItem[] = [];
  let localOnlyCount = 0;
  let conflictCount = 0;
  let inSyncCount = 0;
  let cloudOnlyCount = 0;

  for (const pairKey of allPairKeys) {
    const [presetId, recipeId] = pairKey.split('::');
    const localNote = localByPair.get(pairKey) || null;
    const cloudNote = cloudByPair.get(pairKey) || null;
    const preset = presetById.get(presetId) || null;
    const recipe = recipeById.get(recipeId) || null;
    const itemKey = makeReconciliationItemKey(wsId, presetId, recipeId);
    const prevDecision = envelope.resolvedItems[itemKey];

    const recipeWideNoteText =
      recipe && typeof recipe.description === 'string' && recipe.description.trim().length > 0
        ? recipe.description.trim()
        : null;

    const isProtected1ozBaselineNote = Boolean(
      localNote &&
        (localNote.id === PROTECTED_1OZ_CHOCOLATE_CHIP_NOTE_ID ||
          (preset?.name?.toLowerCase().includes('1 oz') &&
            recipe?.name?.toLowerCase().includes('chocolate chip')))
    );

    const hasAuthoritativeCloudCopy = Boolean(
      cloudNote && cloudNote.note.trim().length > 0
    );

    const canPromoteToCloud = Boolean(preset && recipe);
    const cannotPromoteReason = !preset
      ? `Target preset (${presetId}) does not exist in workspace "${wsId}".`
      : !recipe
      ? `Target recipe (${recipeId}) does not exist in workspace "${wsId}".`
      : undefined;

    if (localNote && !cloudNote) {
      // Check if Owner previously chose keep_cloud / leave_unchanged on an unchanged local snapshot
      localOnlyCount++;
      const proposedAction: OwnerReconciliationAction = canPromoteToCloud
        ? 'promote_local'
        : 'manual_review';

      items.push({
        itemKey,
        status: 'LOCAL_ONLY',
        presetId,
        presetName: preset ? preset.name : `Unresolved Preset (${presetId})`,
        presetExistsInWorkspace: Boolean(preset),
        recipeId,
        recipeName: recipe ? recipe.name : `Unresolved Recipe (${recipeId})`,
        recipeExistsInWorkspace: Boolean(recipe),
        workspaceId: wsId,
        sourceLabel: 'Desktop Local Storage (Unmigrated)',
        localNote,
        cloudNote: null,
        recipeWideNoteText,
        lastModifiedTimestamp: localNote.updatedAt || localNote.createdAt || '',
        proposedAction,
        canPromoteToCloud,
        ...(cannotPromoteReason ? { cannotPromoteReason } : {}),
        isProtected1ozBaselineNote,
        hasAuthoritativeCloudCopy: false,
        ...(prevDecision ? { previouslyReconciled: prevDecision } : {}),
      });
    } else if (localNote && cloudNote) {
      const localTrimmed = localNote.note.trim();
      const cloudTrimmed = cloudNote.note.trim();

      if (localTrimmed === cloudTrimmed) {
        inSyncCount++;
        items.push({
          itemKey,
          status: 'ALREADY_IN_SYNC',
          presetId,
          presetName: preset ? preset.name : presetId,
          presetExistsInWorkspace: Boolean(preset),
          recipeId,
          recipeName: recipe ? recipe.name : recipeId,
          recipeExistsInWorkspace: Boolean(recipe),
          workspaceId: wsId,
          sourceLabel: 'Local + Cloud Firestore (Identical)',
          localNote,
          cloudNote,
          recipeWideNoteText,
          lastModifiedTimestamp:
            cloudNote.updatedAt || localNote.updatedAt || cloudNote.createdAt || '',
          proposedAction: 'keep_cloud',
          canPromoteToCloud,
          ...(cannotPromoteReason ? { cannotPromoteReason } : {}),
          isProtected1ozBaselineNote,
          hasAuthoritativeCloudCopy: true,
          ...(prevDecision ? { previouslyReconciled: prevDecision } : {}),
        });
      } else {
        // Text differs! Never auto-resolve by timestamp — require explicit Owner decision.
        conflictCount++;
        items.push({
          itemKey,
          status: 'CONFLICT_TEXT_MISMATCH',
          presetId,
          presetName: preset ? preset.name : presetId,
          presetExistsInWorkspace: Boolean(preset),
          recipeId,
          recipeName: recipe ? recipe.name : recipeId,
          recipeExistsInWorkspace: Boolean(recipe),
          workspaceId: wsId,
          sourceLabel: 'Conflict: Desktop Local vs Cloud Firestore',
          localNote,
          cloudNote,
          recipeWideNoteText,
          lastModifiedTimestamp:
            localNote.updatedAt || cloudNote.updatedAt || '',
          proposedAction: 'manual_review',
          canPromoteToCloud,
          ...(cannotPromoteReason ? { cannotPromoteReason } : {}),
          isProtected1ozBaselineNote,
          hasAuthoritativeCloudCopy: true,
          ...(prevDecision ? { previouslyReconciled: prevDecision } : {}),
        });
      }
    } else if (!localNote && cloudNote) {
      cloudOnlyCount++;
      items.push({
        itemKey,
        status: 'CLOUD_ONLY',
        presetId,
        presetName: preset ? preset.name : presetId,
        presetExistsInWorkspace: Boolean(preset),
        recipeId,
        recipeName: recipe ? recipe.name : recipeId,
        recipeExistsInWorkspace: Boolean(recipe),
        workspaceId: wsId,
        sourceLabel: 'Cloud Firestore (Shared Workspace)',
        localNote: null,
        cloudNote,
        recipeWideNoteText,
        lastModifiedTimestamp: cloudNote.updatedAt || cloudNote.createdAt || '',
        proposedAction: 'leave_unchanged',
        canPromoteToCloud: false,
        isProtected1ozBaselineNote: false,
        hasAuthoritativeCloudCopy: true,
        ...(prevDecision ? { previouslyReconciled: prevDecision } : {}),
      });
    }
  }

  const actionableItems = items.filter((item) => {
    if (item.status === 'LOCAL_ONLY') {
      // Still actionable unless Owner explicitly chose keep_cloud/leave_unchanged on this exact local snapshot
      if (
        item.previouslyReconciled &&
        (item.previouslyReconciled.action === 'keep_cloud' ||
          item.previouslyReconciled.action === 'leave_unchanged') &&
        item.previouslyReconciled.localNoteSnapshot === item.localNote?.note.trim()
      ) {
        return false;
      }
      return true;
    }
    if (item.status === 'CONFLICT_TEXT_MISMATCH') {
      if (
        item.previouslyReconciled &&
        item.previouslyReconciled.action === 'keep_cloud' &&
        item.previouslyReconciled.localNoteSnapshot === item.localNote?.note.trim() &&
        item.previouslyReconciled.cloudNoteSnapshot === item.cloudNote?.note.trim()
      ) {
        return false;
      }
      return true;
    }
    return false;
  });

  const recipeWideNotes: RecipeWideSafetySummaryItem[] = wsRecipes
    .filter((r) => !r.archived && typeof r.description === 'string' && r.description.trim().length > 0)
    .map((r) => ({
      recipeId: r.id,
      recipeName: r.name,
      category: r.category || 'Uncategorized',
      description: r.description.trim(),
      updatedAt: r.updatedAt || r.createdAt || '',
    }));

  const workspaceBackupCount = Object.values(envelope.records).filter((rec) => {
    if (rec.key.includes('::archived::')) return false;
    const recWs = (rec.note.workspaceId || 'ws-main').trim();
    return recWs === wsId;
  }).length;

  return {
    isOwnerAuthorized: true,
    workspaceId: wsId,
    inspectedAt: nowIso,
    items,
    actionableItems,
    localOnlyCount,
    conflictCount,
    inSyncCount,
    cloudOnlyCount,
    durableBackupRecordCount: workspaceBackupCount,
    recipeWideNotes,
    hasActionableDifferences: actionableItems.length > 0,
  };
}
