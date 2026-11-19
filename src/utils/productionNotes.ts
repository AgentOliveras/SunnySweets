import { CriticalProductionNote, ProductionPreset, Recipe } from '../types';

/**
 * Production Notes Acknowledgment Helpers, Canonical Cloud Extraction & Safety Gate Logic
 *
 * Supports two distinct, non-conflated safety instruction scopes:
 * 1. Recipe-Wide Critical Note (`Recipe.description` / `Recipe.criticalProductionNotes`)
 * 2. Preset-Specific Critical Note (`presets/{presetId}.criticalNotes` matching presetId + recipeId)
 */

export type ProductionNotesStatus = 'NONE' | 'REVIEW_REQUIRED' | 'REVIEWED';

export type SafetyNoteScope = 'recipe_wide' | 'preset_specific';

export interface ResolvedSafetyInstruction {
  id: string;
  scope: SafetyNoteScope;
  scopeLabel: string;
  presetId?: string;
  presetName?: string;
  recipeId: string;
  note: string;
  updatedAt?: string;
}

export interface ApplicableSafetyResolution {
  recipeWideNotes: ResolvedSafetyInstruction[];
  presetSpecificNotes: ResolvedSafetyInstruction[];
  allInstructions: ResolvedSafetyInstruction[];
  hasSafetyNotes: boolean;
  signature: string;
}

export class CriticalNoteConflictError extends Error {
  public readonly code = 'CRITICAL_NOTE_CONFLICT';
  public readonly presetId: string;
  public readonly recipeId: string;
  public readonly remoteNote: CriticalProductionNote | null;

  constructor(
    message: string,
    params: {
      presetId: string;
      recipeId: string;
      remoteNote: CriticalProductionNote | null;
    }
  ) {
    super(message);
    this.name = 'CriticalNoteConflictError';
    this.presetId = params.presetId;
    this.recipeId = params.recipeId;
    this.remoteNote = params.remoteNote;
  }
}

/**
 * Resolves critical production notes for a given preset and recipe selection.
 * Returns an empty array if either presetId or recipeId is null/undefined.
 */
export function getCriticalNotesForSelection(
  presetId: string | null | undefined,
  recipeId: string | null | undefined,
  allNotes: CriticalProductionNote[] = []
): CriticalProductionNote[] {
  if (!presetId || !recipeId) return [];
  return allNotes.filter(
    (n) => n.presetId === presetId && n.recipeId === recipeId && n.note && n.note.trim().length > 0
  );
}

/**
 * Extracts canonical preset-and-recipe-specific CriticalProductionNote records
 * strictly from workspace-scoped `presets/{presetId}.criticalNotes`.
 *
 * Enforces strict workspace isolation and presetId ownership integrity.
 */
export function extractCanonicalCriticalNotesFromPresets(
  presets: ProductionPreset[] = [],
  activeWorkspaceId?: string | null
): CriticalProductionNote[] {
  const wsId = (activeWorkspaceId || '').trim();
  if (!wsId) return [];

  const extracted: CriticalProductionNote[] = [];
  const seenIds = new Set<string>();

  for (const preset of presets) {
    if (!preset || !preset.id) continue;
    // Strict workspace isolation: never expose presets from another workspace
    if (preset.workspaceId && preset.workspaceId !== wsId) continue;
    if (!Array.isArray(preset.criticalNotes) || preset.criticalNotes.length === 0) continue;

    for (const rawNote of preset.criticalNotes) {
      if (!rawNote || typeof rawNote.note !== 'string') continue;
      const trimmedText = rawNote.note.trim();
      const recipeId = (rawNote.recipeId || '').trim();
      if (!trimmedText || !recipeId) continue;

      // Reject notes explicitly stamped for a different workspace
      if (rawNote.workspaceId && rawNote.workspaceId !== wsId) continue;
      // Reject notes stamped for a different presetId than their host preset document
      if (rawNote.presetId && rawNote.presetId !== preset.id) continue;

      const noteId = (rawNote.id || '').trim() || `cpn-${preset.id}-${recipeId}`;
      const dedupeKey = `${preset.id}::${noteId}`;
      if (seenIds.has(dedupeKey)) continue;
      seenIds.add(dedupeKey);

      extracted.push({
        id: noteId,
        presetId: preset.id,
        recipeId,
        workspaceId: rawNote.workspaceId || preset.workspaceId || wsId,
        note: trimmedText,
        createdAt: rawNote.createdAt || preset.createdAt || '',
        updatedAt: rawNote.updatedAt || rawNote.createdAt || preset.updatedAt || '',
        ...(rawNote.createdBy ? { createdBy: rawNote.createdBy } : {}),
      });
    }
  }

  return extracted;
}

export function getCanonicalNotesForPreset(
  presets: ProductionPreset[] = [],
  presetId: string | null | undefined,
  activeWorkspaceId?: string | null
): CriticalProductionNote[] {
  if (!presetId) return [];
  const all = extractCanonicalCriticalNotesFromPresets(presets, activeWorkspaceId);
  return all.filter((n) => n.presetId === presetId);
}

export function getCanonicalNotesForPresetAndRecipe(
  presets: ProductionPreset[] = [],
  presetId: string | null | undefined,
  recipeId: string | null | undefined,
  activeWorkspaceId?: string | null
): CriticalProductionNote[] {
  if (!presetId || !recipeId) return [];
  const all = extractCanonicalCriticalNotesFromPresets(presets, activeWorkspaceId);
  return all.filter((n) => n.presetId === presetId && n.recipeId === recipeId);
}

export function getCanonicalNotesForRecipe(
  presets: ProductionPreset[] = [],
  recipeId: string | null | undefined,
  activeWorkspaceId?: string | null
): CriticalProductionNote[] {
  if (!recipeId) return [];
  const all = extractCanonicalCriticalNotesFromPresets(presets, activeWorkspaceId);
  return all.filter((n) => n.recipeId === recipeId);
}

/**
 * Computes a deterministic signature representing the exact active safety instructions.
 *
 * - Invariant across quantity and mixer adjustments (so operators do not re-acknowledge on case count changes).
 * - Changes immediately if:
 *   1. Recipe changes
 *   2. Selected preset introduces/removes a preset-specific note
 *   3. Any applicable note's text or updatedAt changes via live Firestore snapshot
 */
export function computeSafetyInstructionsSignature(
  recipeId: string | null | undefined,
  instructions: ResolvedSafetyInstruction[]
): string {
  if (!recipeId || !instructions || instructions.length === 0) return '';
  const canonicalTokens = [...instructions]
    .map(
      (item) =>
        `${item.scope}|${item.id}|${item.presetId || ''}|${item.recipeId}|${item.note.trim()}|${item.updatedAt || ''}`
    )
    .sort();
  return `${recipeId}::${canonicalTokens.join('||')}`;
}

export function isSafetySignatureAcknowledged(
  activeSignature: string,
  acknowledgedSignature: string | null | undefined
): boolean {
  if (!activeSignature) return false;
  return Boolean(acknowledgedSignature && acknowledgedSignature === activeSignature);
}

/**
 * Resolves all applicable safety instructions for a production run while keeping
 * Recipe-Wide Critical Notes (`Recipe.description`) and Preset-Specific Critical Notes
 * (`presets/{presetId}.criticalNotes`) clearly separated and labeled.
 */
export function resolveApplicableSafetyInstructions(params: {
  recipe: Recipe | null | undefined;
  presets: ProductionPreset[];
  selectedPresetIds: string[];
  activeWorkspaceId?: string | null;
}): ApplicableSafetyResolution {
  const { recipe, presets, selectedPresetIds, activeWorkspaceId } = params;
  const empty: ApplicableSafetyResolution = {
    recipeWideNotes: [],
    presetSpecificNotes: [],
    allInstructions: [],
    hasSafetyNotes: false,
    signature: '',
  };

  if (!recipe || !recipe.id) return empty;

  const wsId = (activeWorkspaceId || recipe.workspaceId || 'ws-main').trim();
  if (recipe.workspaceId && wsId && recipe.workspaceId !== wsId) {
    return empty;
  }

  const recipeWideNotes: ResolvedSafetyInstruction[] = [];
  const descTrimmed = typeof recipe.description === 'string' ? recipe.description.trim() : '';
  if (descTrimmed.length > 0) {
    recipeWideNotes.push({
      id: `recipe-wide-desc-${recipe.id}`,
      scope: 'recipe_wide',
      scopeLabel: 'Recipe-Wide Critical Note',
      recipeId: recipe.id,
      note: descTrimmed,
      updatedAt: recipe.updatedAt || '',
    });
  }

  const extraGeneralTrimmed =
    typeof recipe.criticalProductionNotes === 'string'
      ? recipe.criticalProductionNotes.trim()
      : '';
  if (extraGeneralTrimmed.length > 0 && extraGeneralTrimmed !== descTrimmed) {
    recipeWideNotes.push({
      id: `recipe-wide-cpn-${recipe.id}`,
      scope: 'recipe_wide',
      scopeLabel: 'Recipe-Wide Critical Note',
      recipeId: recipe.id,
      note: extraGeneralTrimmed,
      updatedAt: recipe.updatedAt || '',
    });
  }

  const uniquePresetIds = Array.from(
    new Set((selectedPresetIds || []).map((id) => (id || '').trim()).filter(Boolean))
  );

  const presetMap = new Map<string, ProductionPreset>();
  for (const p of presets || []) {
    if (!p || !p.id) continue;
    if (p.workspaceId && p.workspaceId !== wsId) continue;
    presetMap.set(p.id, p);
  }

  const presetSpecificNotes: ResolvedSafetyInstruction[] = [];
  const seenPresetNoteIds = new Set<string>();

  for (const presetId of uniquePresetIds) {
    const preset = presetMap.get(presetId);
    if (!preset) continue;
    const matching = getCanonicalNotesForPresetAndRecipe([preset], presetId, recipe.id, wsId);
    for (const cn of matching) {
      if (seenPresetNoteIds.has(cn.id)) continue;
      seenPresetNoteIds.add(cn.id);
      presetSpecificNotes.push({
        id: cn.id,
        scope: 'preset_specific',
        scopeLabel: 'Preset-Specific Critical Note',
        presetId: preset.id,
        presetName: preset.name,
        recipeId: recipe.id,
        note: cn.note,
        updatedAt: cn.updatedAt || '',
      });
    }
  }

  const allInstructions = [...recipeWideNotes, ...presetSpecificNotes];
  const signature = computeSafetyInstructionsSignature(recipe.id, allInstructions);

  return {
    recipeWideNotes,
    presetSpecificNotes,
    allInstructions,
    hasSafetyNotes: allInstructions.length > 0,
    signature,
  };
}

/**
 * Checks if production notes are present.
 * Accepts either:
 * - A list of CriticalProductionNote or ResolvedSafetyInstruction objects
 * - A raw string note / description
 */
export function hasProductionNotes(
  notesOrDescription?: string | null | Array<{ note: string }>
): boolean {
  if (Array.isArray(notesOrDescription)) {
    return notesOrDescription.some((n) => Boolean(n && typeof n.note === 'string' && n.note.trim().length > 0));
  }
  if (!notesOrDescription || typeof notesOrDescription !== 'string') return false;
  return notesOrDescription.trim().length > 0;
}

/**
 * Derives the operational status of the Production Notes for the current run.
 */
export function getProductionNotesStatus(
  hasNotes: boolean,
  isAcknowledged: boolean
): ProductionNotesStatus {
  if (!hasNotes) return 'NONE';
  return isAcknowledged ? 'REVIEWED' : 'REVIEW_REQUIRED';
}

/**
 * Determines whether the operator may proceed to the calculated mix and checklist.
 * If no note exists, the workflow is non-blocking.
 * If a note exists, explicit acknowledgment is required.
 */
export function canProceedToMix(hasNotes: boolean, isAcknowledged: boolean): boolean {
  if (!hasNotes) return true;
  return isAcknowledged;
}

export type FirestoreHydrationState = 'LOADING' | 'READY' | 'ERROR';

export type SafetyConnectionStatus = 'VERIFYING' | 'VERIFIED' | 'UNVERIFIED' | 'ERROR';

export type SafetyOperationalGateState =
  | 'INITIAL_LOADING'
  | 'READY'
  | 'CONNECTION_UNVERIFIED'
  | 'ERROR';

export type SafetySyncStatusLabel =
  | 'Connecting'
  | 'Reconnecting'
  | 'Safety Sync Ready'
  | 'Safety Sync Failed';

export const SAFETY_HYDRATION_LOADING_MESSAGE =
  'Loading production safety instructions...';

export const SAFETY_HYDRATION_ERROR_MESSAGE =
  'Production safety instructions unavailable. Mixing is temporarily blocked.';

export const SAFETY_CONNECTION_UNVERIFIED_MESSAGE =
  'Live Cloud Firestore connection interrupted. Existing checklist progress is preserved, but new ingredient check-offs, PDF export, and batch completion are paused until safety sync is re-verified.';

export const SAFETY_NOTES_UNACKNOWLEDGED_EXPORT_MESSAGE =
  'Critical Production Notes must be reviewed and acknowledged before exporting a production sheet PDF.';

export class PresetCreationConflictError extends Error {
  public readonly code = 'PRESET_CREATION_CONFLICT';
  public readonly presetId: string;

  constructor(message: string, presetId: string) {
    super(message);
    this.name = 'PresetCreationConflictError';
    this.presetId = presetId;
  }
}

export class InsecureUuidUnavailableError extends Error {
  public readonly code = 'INSECURE_UUID_UNAVAILABLE';

  constructor(
    message = 'Cryptographically secure UUID generation is unavailable on this browser/runtime. Refusing to create a packaging preset with a predictable ID.'
  ) {
    super(message);
    this.name = 'InsecureUuidUnavailableError';
  }
}

export interface CryptoProviderLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates an RFC 4122 version 4 UUID strictly from a cryptographically secure source
 * (`crypto.randomUUID()` or `crypto.getRandomValues()`).
 *
 * NEVER falls back to `Math.random()` or timestamps. Throws `InsecureUuidUnavailableError`
 * if no Web Crypto CSPRNG API is available.
 */
export function generateCryptographicallySecureUuidV4(
  cryptoOverride?: CryptoProviderLike | null
): string {
  const cryptoObj: CryptoProviderLike | undefined | null =
    cryptoOverride !== undefined
      ? cryptoOverride
      : typeof globalThis !== 'undefined'
      ? (globalThis.crypto as CryptoProviderLike | undefined)
      : undefined;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    const generated = cryptoObj.randomUUID();
    if (typeof generated === 'string' && UUID_V4_PATTERN.test(generated.trim())) {
      return generated.trim().toLowerCase();
    }
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // RFC 4122 section 4.4: version 4 (0100) and variant 10xx
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
  }

  throw new InsecureUuidUnavailableError();
}

/**
 * Generates a cryptographically secure preset document ID (`preset-<uuidv4>`) that does not
 * collide with any known preset IDs in the active workspace.
 *
 * SECURITY & ARCHITECTURE NOTE:
 * - Strictly requires Web Crypto CSPRNG (`crypto.randomUUID` or `crypto.getRandomValues`).
 * - Never falls back to `Math.random()` or timestamp-based IDs; throws `InsecureUuidUnavailableError`
 *   visibly if secure UUID generation is unavailable.
 * - Because client-side `setDoc()` under current `firestore.rules` is not a server-enforced
 *   create-only operation (`tx.get()` on nonexistent preset docs is rejected by `allow read`),
 *   a theoretical same-ID overwrite risk remains at ~2^-122 UUIDv4 collision probability.
 */
export function generateCollisionResistantPresetId(
  existingIds?: Iterable<string>,
  optionsOrCrypto?:
    | { cryptoOverride?: CryptoProviderLike | null }
    | CryptoProviderLike
    | null
): string {
  const taken = new Set<string>();
  if (existingIds) {
    for (const id of existingIds) {
      if (id) taken.add(id);
    }
  }

  const resolvedCryptoOverride: CryptoProviderLike | null | undefined =
    optionsOrCrypto === null
      ? null
      : optionsOrCrypto !== undefined &&
        typeof optionsOrCrypto === 'object' &&
        'cryptoOverride' in optionsOrCrypto
      ? optionsOrCrypto.cryptoOverride
      : (optionsOrCrypto as CryptoProviderLike | undefined);

  for (let attempt = 0; attempt < 16; attempt++) {
    const uuid = generateCryptographicallySecureUuidV4(resolvedCryptoOverride);
    const candidate = `preset-${uuid}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new PresetCreationConflictError(
    'Unable to generate an unused cryptographically secure preset ID after 16 attempts.',
    ''
  );
}

/**
 * Resolves the combined safety hydration state across BOTH `recipes` and `presets`.
 *
 * - Returns `'ERROR'` if `syncError` is present OR either collection is `'ERROR'`.
 * - Returns `'LOADING'` if either collection is `'LOADING'`.
 * - Returns `'READY'` ONLY when both collections have reached `'READY'` with no sync error.
 */
export function resolveSafetyHydrationGateState(params: {
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  syncError?: string | null;
}): FirestoreHydrationState {
  const recipesState: FirestoreHydrationState = params.recipesHydrationState ?? 'READY';
  const presetsState: FirestoreHydrationState = params.presetsHydrationState ?? 'READY';

  if (params.syncError && params.syncError.trim().length > 0) {
    return 'ERROR';
  }
  if (recipesState === 'ERROR' || presetsState === 'ERROR') {
    return 'ERROR';
  }
  if (recipesState === 'LOADING' || presetsState === 'LOADING') {
    return 'LOADING';
  }
  return 'READY';
}

/**
 * Resolves the four-state operational safety gate:
 * - `'ERROR'`: Listener failure or explicit sync error.
 * - `'INITIAL_LOADING'`: Cold start, workspace switch, auth change, or active listener reconnect
 *   before server-confirmed snapshots have arrived for BOTH `recipes` and `presets`.
 * - `'CONNECTION_UNVERIFIED'`: Initial `READY` was previously achieved in this workspace,
 *   but a subsequent cache-only/offline metadata event occurred and live server re-verification
 *   for BOTH `recipes` and `presets` is pending.
 * - `'READY'`: Both collections are server-confirmed with live verified connection and zero errors.
 */
export function resolveSafetyOperationalGateState(params: {
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  connectionVerified?: boolean;
  syncError?: string | null;
}): SafetyOperationalGateState {
  const hydrationState = resolveSafetyHydrationGateState({
    recipesHydrationState: params.recipesHydrationState,
    presetsHydrationState: params.presetsHydrationState,
    syncError: params.syncError,
  });

  if (hydrationState === 'ERROR') {
    return 'ERROR';
  }
  if (hydrationState === 'LOADING') {
    return 'INITIAL_LOADING';
  }
  if (params.connectionVerified === false) {
    return 'CONNECTION_UNVERIFIED';
  }
  return 'READY';
}

/**
 * Derives truthful user-visible safety synchronization status labels:
 * - `'Connecting'`: Cold initial connection in progress.
 * - `'Reconnecting'`: Active retry / listener restart in progress, retry timer scheduled,
 *   or waiting for live server re-confirmation after a Wi-Fi interruption (`CONNECTION_UNVERIFIED`).
 * - `'Safety Sync Ready'`: Both collections confirmed from server with live verified connection.
 * - `'Safety Sync Failed'`: Listener error with no active reconnect running.
 */
export function resolveSafetySyncStatusLabel(params: {
  operationalGateState?: SafetyOperationalGateState;
  operationalState?: SafetyOperationalGateState;
  isReconnecting?: boolean;
  isRetryScheduled?: boolean;
}): SafetySyncStatusLabel {
  const state = params.operationalGateState ?? params.operationalState ?? 'INITIAL_LOADING';
  const { isReconnecting, isRetryScheduled } = params;
  if (state === 'READY') {
    return 'Safety Sync Ready';
  }
  if (state === 'CONNECTION_UNVERIFIED') {
    return 'Reconnecting';
  }
  if (state === 'INITIAL_LOADING') {
    return isReconnecting ? 'Reconnecting' : 'Connecting';
  }
  // state === 'ERROR'
  if (isReconnecting || isRetryScheduled) {
    return 'Reconnecting';
  }
  return 'Safety Sync Failed';
}

/**
 * Fail-closed Production Safety Gate that blocks mixing whenever:
 * 1. Either `recipes` or `presets` Firestore collection is still `LOADING` (`INITIAL_LOADING`),
 * 2. Live server connection is temporarily unverified (`CONNECTION_UNVERIFIED`),
 * 3. Either collection or `syncError` is in `ERROR` state, OR
 * 4. Applicable Critical Production Notes exist and have not been acknowledged for the current signature.
 */
export function canProceedToMixWithSyncSafety(params: {
  hasNotes: boolean;
  isAcknowledged: boolean;
  syncError?: string | null;
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  connectionVerified?: boolean;
}): boolean {
  const operationalState = resolveSafetyOperationalGateState({
    recipesHydrationState: params.recipesHydrationState,
    presetsHydrationState: params.presetsHydrationState,
    connectionVerified: params.connectionVerified,
    syncError: params.syncError,
  });
  if (operationalState !== 'READY') {
    return false;
  }
  return canProceedToMix(params.hasNotes, params.isAcknowledged);
}


