import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import {
  Recipe,
  MasterIngredient,
  ProductionPreset,
  Mixer,
  UserSettings,
  Ingredient,
} from '../types';

export interface RecoveryCounts {
  recipes: number;
  masterIngredients: number;
  presets: number;
  mixers: number;
  history: number;
  settings: number;
  workspaces: number;
  totalIngredientLines: number;
  linkedIngredientLines: number;
}

export interface ValidatedBackupPayload {
  recipes: Recipe[];
  masterIngredients: MasterIngredient[];
  presets: ProductionPreset[];
  mixers: Mixer[];
  rawSettings: any;
  sanitizedSettings: UserSettings;
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  counts: RecoveryCounts;
  data?: ValidatedBackupPayload;
}

export interface PreflightResult {
  ready: boolean;
  collisionDetected: boolean;
  errors: string[];
  existingCounts: {
    recipes: number;
    masterIngredients: number;
    presets: number;
    mixers: number;
  };
  settingsDocExists: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export const TARGET_WORKSPACE_ID = 'ws-main';
export const AUTHORIZED_RECOVERY_EMAIL = 'jaoliveras@gmail.com';
export const REQUIRED_ROLE = 'owner';
export const EXPECTED_COUNTS: RecoveryCounts = {
  recipes: 72,
  masterIngredients: 130,
  presets: 19,
  mixers: 1,
  history: 0,
  settings: 1,
  workspaces: 1,
  totalIngredientLines: 702,
  linkedIngredientLines: 0,
};

export const EXCLUDED_COLLECTIONS = [
  'workspaces (document & ownership)',
  'workspaces/ws-main/members',
  'users',
  'billing / Stripe data',
  'invitations',
  'history (production logs)',
  'legacy authorization UIDs',
];

/**
 * Checks if the current runtime environment is a development environment.
 */
export function isDevEnvironment(): boolean {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
      if ((import.meta as any).env.DEV) return true;
      if ((import.meta as any).env.MODE === 'development') return true;
    }
  } catch (_) {}

  try {
    if (typeof window !== 'undefined' && window.location) {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host.includes('ais-dev')) {
        return true;
      }
    }
  } catch (_) {}

  return false;
}

/**
 * Checks whether the current user context is authorized to view or run the recovery tool.
 */
export function checkRecoveryEligibility(
  user: { email?: string | null; uid?: string | null } | null,
  activeWorkspaceId: string | null,
  userRole: string | null,
  isDev: boolean = isDevEnvironment()
): EligibilityResult {
  const reasons: string[] = [];

  if (!isDev) {
    reasons.push('Recovery tool is restricted strictly to the development environment.');
  }

  if (!user || !user.email) {
    reasons.push('Authentication required. No authenticated Firebase user session found.');
  } else if (user.email.toLowerCase() !== AUTHORIZED_RECOVERY_EMAIL.toLowerCase()) {
    reasons.push(
      `Access denied: Authenticated email (${user.email}) does not match authorized owner (${AUTHORIZED_RECOVERY_EMAIL}).`
    );
  }

  if (activeWorkspaceId !== TARGET_WORKSPACE_ID) {
    reasons.push(
      `Target mismatch: Active workspace (${activeWorkspaceId || 'none'}) is not '${TARGET_WORKSPACE_ID}'.`
    );
  }

  if (userRole !== REQUIRED_ROLE) {
    reasons.push(
      `Role mismatch: User role (${userRole || 'none'}) is not '${REQUIRED_ROLE}'.`
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

/**
 * Sanitizes the backup settings record according to the application's current UserSettings schema.
 * Replaces legacy UID with the current authenticated user's UID and strips internal object IDs.
 */
export function sanitizeSettings(rawSettings: any, currentUid: string): UserSettings {
  if (!rawSettings || typeof rawSettings !== 'object') {
    return {
      userId: currentUid,
      defaultWeightUnit: 'g',
      defaultWastePercent: 6,
      decimalPlaces: 0,
      theme: 'light',
      businessName: 'Sunny Sweets, LLC',
      activeWorkspaceId: TARGET_WORKSPACE_ID,
      workspaceName: 'Main Bakery Workspace',
      categoryPresetMap: {},
      updatedAt: new Date().toISOString(),
    };
  }

  const sanitized: UserSettings = {
    userId: currentUid,
    defaultWeightUnit: rawSettings.defaultWeightUnit || 'g',
    defaultWastePercent:
      typeof rawSettings.defaultWastePercent === 'number' ? rawSettings.defaultWastePercent : 6,
    decimalPlaces:
      typeof rawSettings.decimalPlaces === 'number' ? rawSettings.decimalPlaces : 0,
    theme:
      rawSettings.theme === 'dark' || rawSettings.theme === 'light' || rawSettings.theme === 'system'
        ? rawSettings.theme
        : 'light',
    businessName: rawSettings.businessName || 'Sunny Sweets, LLC',
    activeWorkspaceId: TARGET_WORKSPACE_ID,
    workspaceName: rawSettings.workspaceName || 'Main Bakery Workspace',
    categoryPresetMap:
      rawSettings.categoryPresetMap && typeof rawSettings.categoryPresetMap === 'object'
        ? rawSettings.categoryPresetMap
        : {},
    updatedAt: new Date().toISOString(),
  };

  if (Array.isArray(rawSettings.recipeCategories)) {
    sanitized.recipeCategories = rawSettings.recipeCategories;
  }

  return sanitized;
}

/**
 * Parses and validates the complete backup file client-side.
 * Enforces exact counts, ingredient linking invariants, and workspace targets.
 */
export function parseAndValidateBackup(
  fileContent: string,
  currentUid: string = 'preflight-uid'
): BackupValidationResult {
  const errors: string[] = [];

  let parsed: any;
  try {
    parsed = JSON.parse(fileContent);
  } catch (err: any) {
    return {
      valid: false,
      errors: [`JSON parse failure: ${err.message || 'File is not valid JSON'}`],
      counts: {
        recipes: 0,
        masterIngredients: 0,
        presets: 0,
        mixers: 0,
        history: 0,
        settings: 0,
        workspaces: 0,
        totalIngredientLines: 0,
        linkedIngredientLines: 0,
      },
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      errors: ['Root JSON element must be an object'],
      counts: {
        recipes: 0,
        masterIngredients: 0,
        presets: 0,
        mixers: 0,
        history: 0,
        settings: 0,
        workspaces: 0,
        totalIngredientLines: 0,
        linkedIngredientLines: 0,
      },
    };
  }

  const recipes = Array.isArray(parsed.recipes) ? parsed.recipes : [];
  const masterIngredients = Array.isArray(parsed.master_ingredients)
    ? parsed.master_ingredients
    : [];
  const presets = Array.isArray(parsed.presets) ? parsed.presets : [];
  const mixers = Array.isArray(parsed.mixers) ? parsed.mixers : [];
  const history = Array.isArray(parsed.history) ? parsed.history : [];
  const rawSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : null;
  const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];

  // Count total ingredient lines and check for masterIngredientId links
  let totalIngredientLines = 0;
  let linkedIngredientLines = 0;

  for (const recipe of recipes) {
    if (Array.isArray(recipe.ingredients)) {
      totalIngredientLines += recipe.ingredients.length;
      for (const ing of recipe.ingredients) {
        if (ing.masterIngredientId) {
          linkedIngredientLines++;
        }
      }
    }
  }

  const counts: RecoveryCounts = {
    recipes: recipes.length,
    masterIngredients: masterIngredients.length,
    presets: presets.length,
    mixers: mixers.length,
    history: history.length,
    settings: rawSettings ? 1 : 0,
    workspaces: workspaces.length,
    totalIngredientLines,
    linkedIngredientLines,
  };

  // Exact count verifications
  if (counts.recipes !== EXPECTED_COUNTS.recipes) {
    errors.push(
      `Recipe count mismatch: found ${counts.recipes}, expected ${EXPECTED_COUNTS.recipes}`
    );
  }

  if (counts.masterIngredients !== EXPECTED_COUNTS.masterIngredients) {
    errors.push(
      `Master ingredients count mismatch: found ${counts.masterIngredients}, expected ${EXPECTED_COUNTS.masterIngredients}`
    );
  }

  if (counts.presets !== EXPECTED_COUNTS.presets) {
    errors.push(
      `Presets count mismatch: found ${counts.presets}, expected ${EXPECTED_COUNTS.presets}`
    );
  }

  if (counts.mixers !== EXPECTED_COUNTS.mixers) {
    errors.push(
      `Mixers count mismatch: found ${counts.mixers}, expected ${EXPECTED_COUNTS.mixers}`
    );
  }

  if (counts.history !== EXPECTED_COUNTS.history) {
    errors.push(
      `History count mismatch: found ${counts.history}, expected ${EXPECTED_COUNTS.history}`
    );
  }

  if (counts.settings !== EXPECTED_COUNTS.settings) {
    errors.push(
      `Settings count mismatch: found ${counts.settings}, expected ${EXPECTED_COUNTS.settings}`
    );
  }

  if (counts.workspaces !== EXPECTED_COUNTS.workspaces) {
    errors.push(
      `Workspaces count mismatch: found ${counts.workspaces}, expected ${EXPECTED_COUNTS.workspaces}`
    );
  }

  if (counts.totalIngredientLines !== EXPECTED_COUNTS.totalIngredientLines) {
    errors.push(
      `Total ingredient lines mismatch: found ${counts.totalIngredientLines}, expected ${EXPECTED_COUNTS.totalIngredientLines}`
    );
  }

  if (counts.linkedIngredientLines !== 0) {
    errors.push(
      `Ingredient linking safety violation: found ${counts.linkedIngredientLines} ingredients with masterIngredientId. All 702 lines must be unlinked.`
    );
  }

  // Workspace target validations
  for (let i = 0; i < recipes.length; i++) {
    if (recipes[i].workspaceId !== TARGET_WORKSPACE_ID) {
      errors.push(`Recipe at index ${i} ('${recipes[i].name}') does not target '${TARGET_WORKSPACE_ID}'`);
    }
  }

  for (let i = 0; i < masterIngredients.length; i++) {
    if (masterIngredients[i].workspaceId !== TARGET_WORKSPACE_ID) {
      errors.push(`Master ingredient at index ${i} ('${masterIngredients[i].name}') does not target '${TARGET_WORKSPACE_ID}'`);
    }
  }

  for (let i = 0; i < presets.length; i++) {
    if (presets[i].workspaceId !== TARGET_WORKSPACE_ID) {
      errors.push(`Preset at index ${i} ('${presets[i].name}') does not target '${TARGET_WORKSPACE_ID}'`);
    }
  }

  for (let i = 0; i < mixers.length; i++) {
    if (mixers[i].workspaceId !== TARGET_WORKSPACE_ID) {
      errors.push(`Mixer at index ${i} ('${mixers[i].name}') does not target '${TARGET_WORKSPACE_ID}'`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      counts,
    };
  }

  const sanitizedSettings = sanitizeSettings(rawSettings, currentUid);

  return {
    valid: true,
    errors: [],
    counts,
    data: {
      recipes,
      masterIngredients,
      presets,
      mixers,
      rawSettings,
      sanitizedSettings,
    },
  };
}

export function assertOwnerForRecovery(callerRole: string | null | undefined): void {
  if (callerRole !== 'owner') {
    throw new Error('Permission denied: Legacy Data Recovery utilities are restricted to workspace Owners.');
  }
}

/**
 * Performs a read-only destination preflight check against Firestore.
 * Verifies active Owner authorization when callerRole is supplied (or checks membership doc),
 * and verifies that zero records exist in ws-main for the 4 business collections.
 * Inspects /settings/{currentUid} separately.
 */
export async function runDestinationPreflight(
  firestoreDb: Firestore,
  workspaceId: string = TARGET_WORKSPACE_ID,
  currentUid: string,
  callerRole?: string | null
): Promise<PreflightResult> {
  if (!currentUid || typeof currentUid !== 'string' || currentUid.trim() === '') {
    return {
      ready: false,
      collisionDetected: false,
      errors: ['Authentication required: Valid Owner UID is required for recovery preflight.'],
      existingCounts: { recipes: -1, masterIngredients: -1, presets: -1, mixers: -1 },
      settingsDocExists: false,
    };
  }

  if (callerRole !== undefined && callerRole !== 'owner') {
    return {
      ready: false,
      collisionDetected: false,
      errors: ['Permission denied: Legacy Data Recovery preflight requires active workspace Owner role.'],
      existingCounts: { recipes: -1, masterIngredients: -1, presets: -1, mixers: -1 },
      settingsDocExists: false,
    };
  }

  const errors: string[] = [];

  try {
    // When callerRole is omitted in live runtime, verify active Owner membership in Firestore
    if (callerRole === undefined) {
      const memberSnap = await getDoc(doc(firestoreDb, 'workspaces', workspaceId, 'members', currentUid));
      if (memberSnap.exists()) {
        const mData = memberSnap.data();
        if (mData?.active !== true || mData?.role !== 'owner') {
          return {
            ready: false,
            collisionDetected: false,
            errors: ['Permission denied: Active workspace Owner membership is required for recovery preflight.'],
            existingCounts: { recipes: -1, masterIngredients: -1, presets: -1, mixers: -1 },
            settingsDocExists: false,
          };
        }
      }
    }

    const [recipesSnap, miSnap, presetsSnap, mixersSnap, settingsSnap] = await Promise.all([
      getDocs(query(collection(firestoreDb, 'recipes'), where('workspaceId', '==', workspaceId))),
      getDocs(query(collection(firestoreDb, 'master_ingredients'), where('workspaceId', '==', workspaceId))),
      getDocs(query(collection(firestoreDb, 'presets'), where('workspaceId', '==', workspaceId))),
      getDocs(query(collection(firestoreDb, 'mixers'), where('workspaceId', '==', workspaceId))),
      getDoc(doc(firestoreDb, 'settings', currentUid)),
    ]);

    const existingCounts = {
      recipes: recipesSnap.size,
      masterIngredients: miSnap.size,
      presets: presetsSnap.size,
      mixers: mixersSnap.size,
    };

    let collisionDetected = false;

    if (existingCounts.recipes > 0) {
      collisionDetected = true;
      errors.push(`Collision: found ${existingCounts.recipes} existing recipes in ${workspaceId}.`);
    }

    if (existingCounts.masterIngredients > 0) {
      collisionDetected = true;
      errors.push(`Collision: found ${existingCounts.masterIngredients} existing master ingredients in ${workspaceId}.`);
    }

    if (existingCounts.presets > 0) {
      collisionDetected = true;
      errors.push(`Collision: found ${existingCounts.presets} existing presets in ${workspaceId}.`);
    }

    if (existingCounts.mixers > 0) {
      collisionDetected = true;
      errors.push(`Collision: found ${existingCounts.mixers} existing mixers in ${workspaceId}.`);
    }

    return {
      ready: !collisionDetected,
      collisionDetected,
      errors,
      existingCounts,
      settingsDocExists: settingsSnap.exists(),
    };
  } catch (err: any) {
    return {
      ready: false,
      collisionDetected: false,
      errors: [`Preflight query failed: ${err.message || String(err)}`],
      existingCounts: {
        recipes: -1,
        masterIngredients: -1,
        presets: -1,
        mixers: -1,
      },
      settingsDocExists: false,
    };
  }
}

/**
 * DECOMMISSIONED: Disaster recovery phase is closed.
 * The 223-document recovery write batch execution pathway has been permanently disabled.
 * The Sunny Sweets production dataset already exists complete and verified in Cloud Firestore.
 */
export function prepareRecoveryBatch(): never {
  throw new Error(
    'Disaster recovery is closed. Recovery import execution pathway has been permanently decommissioned.'
  );
}
