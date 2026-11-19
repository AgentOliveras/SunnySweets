import { ProductionPreset, Workspace } from '../types';

export const SYSTEM_OPTION_KEYS = {
  FULL_RECIPE: 'SYS:FULL_RECIPE',
  FULL_MIXER: 'SYS:FULL_MIXER',
  CUSTOM_QUANTITY: 'SYS:CUSTOM_QUANTITY',
} as const;

export const SUNNY_SWEETS_DEFAULT_ORDER_NAMES = ['1 oz', '2 oz', '3 oz', '4 oz'] as const;

export type SystemOptionKey = (typeof SYSTEM_OPTION_KEYS)[keyof typeof SYSTEM_OPTION_KEYS];

export interface WorkspaceOptionDescriptor {
  key: string;
  name: string;
  description: string;
  type: 'preset' | 'system';
  category?: string;
  preset?: ProductionPreset;
}

export function isSystemOptionKey(key: string): key is SystemOptionKey {
  return (
    key === SYSTEM_OPTION_KEYS.FULL_RECIPE ||
    key === SYSTEM_OPTION_KEYS.FULL_MIXER ||
    key === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY
  );
}

/**
 * Returns true if the preset is enabled on the Production Floor.
 * Backward-compatible: existing presets without `productionEnabled` default to `true`.
 */
export function isPresetEnabledForProduction(
  preset: Pick<ProductionPreset, 'productionEnabled'> | null | undefined
): boolean {
  if (!preset) return false;
  return preset.productionEnabled !== false;
}

/**
 * Extracts a standalone ounce token (e.g. "1", "2", "2.5", "12", "21") when present,
 * enforcing numeric boundaries so "2 oz" never collides with "12 oz", "21 oz", or "2.5 oz".
 */
function extractStrictOunceWeightToken(text: string): string | null {
  const match = text.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)\s*oz(?:\b|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(parsed);
}

/**
 * Normalizes legacy string keys to canonical system keys where applicable.
 */
export function normalizeLegacyOptionKey(key: string): string {
  const clean = key.trim();
  const lower = clean.toLowerCase();

  if (clean === SYSTEM_OPTION_KEYS.FULL_RECIPE || lower === 'full_recipe' || lower === 'full recipe') {
    return SYSTEM_OPTION_KEYS.FULL_RECIPE;
  }
  if (
    clean === SYSTEM_OPTION_KEYS.FULL_MIXER ||
    lower === 'full_mixer' ||
    lower === 'full mixer' ||
    lower === 'full mixer capacity'
  ) {
    return SYSTEM_OPTION_KEYS.FULL_MIXER;
  }
  if (
    clean === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY ||
    lower === 'custom_quantity' ||
    lower === 'custom' ||
    lower === 'custom quantity'
  ) {
    return SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY;
  }

  return clean;
}

/**
 * Checks if a preset matches a given option key (by canonical ID first, exact name second,
 * or strict numeric-boundary legacy weight key such as "2 oz" / "2.5 oz" when the key is not a preset ID).
 * Prevents substring collisions among "2 oz", "2.5 oz", "12 oz", and "21 oz".
 */
export function matchesPresetKey(preset: ProductionPreset, key: string): boolean {
  const trimmedKey = key.trim();
  if (!trimmedKey) return false;

  // 1. Canonical preset ID match (always preferred and exact)
  if (preset.id === trimmedKey) return true;

  // Never fuzzy-match another preset's canonical ID against preset names
  if (trimmedKey.startsWith('preset-')) return false;

  const pName = preset.name.toLowerCase().trim();
  const targetKey = trimmedKey.toLowerCase();
  if (pName === targetKey) return true;

  // 2. Strict numeric-boundary legacy ounce token match (e.g. legacy key "2.5 oz" -> preset "2.5 oz Cookies")
  const keyOzToken = extractStrictOunceWeightToken(targetKey);
  if (keyOzToken !== null) {
    const presetNameOzToken = extractStrictOunceWeightToken(pName);
    if (presetNameOzToken !== null) {
      return presetNameOzToken === keyOzToken;
    }
    if ((preset.weightUnit || '').toLowerCase() === 'oz' && Number.isFinite(preset.finishedWeight)) {
      return String(Number(preset.finishedWeight)) === keyOzToken;
    }
  }

  return false;
}

/**
 * Default fallback order for Cookie recipes when no custom saved order exists:
 * 1) 1 oz, 2 oz, 3 oz, 4 oz presets (if present), followed by any other applicable presets sorted by weight ascending
 * 2) Custom Quantity
 * 3) Full Recipe
 * 4) Full Mixer Capacity
 */
export function getDefaultProductionOptionKeys(applicablePresets: ProductionPreset[]): string[] {
  const sortedPresets = [...applicablePresets].sort((a, b) => {
    if (a.finishedWeight !== b.finishedWeight) {
      return a.finishedWeight - b.finishedWeight;
    }
    return a.name.localeCompare(b.name);
  });

  const keys: string[] = sortedPresets.map((p) => p.id);

  keys.push(SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY);
  keys.push(SYSTEM_OPTION_KEYS.FULL_RECIPE);
  keys.push(SYSTEM_OPTION_KEYS.FULL_MIXER);

  return keys;
}

/**
 * Resolves the authoritative ordered list of option keys (preset IDs and system keys)
 * to render in Production Mode for a given set of applicable presets and saved order.
 *
 * Guarantees:
 * - Saved order is respected for all matching applicable presets and system options.
 * - Presets not applicable to the current recipe are excluded from the returned list.
 * - Any newly created or missing applicable presets not yet in savedOrder are appended
 *   gracefully right before the trailing system options (or at the end if system options were moved),
 *   sorted by finishedWeight ascending so nothing ever disappears!
 * - System options (Full Recipe, Full Mixer Capacity, Custom Quantity) are always included
 *   exactly once even if missing from legacy savedOrder arrays.
 */
export function getOrderedProductionOptionKeys(
  applicablePresets: ProductionPreset[],
  savedOrder?: string[] | null
): string[] {
  if (!savedOrder || !Array.isArray(savedOrder) || savedOrder.length === 0) {
    return getDefaultProductionOptionKeys(applicablePresets);
  }

  const result: string[] = [];
  const usedPresetIds = new Set<string>();
  const usedSystemKeys = new Set<SystemOptionKey>();

  // 1. Walk through savedOrder and pick applicable items in exact user-specified order
  for (const rawKey of savedOrder) {
    if (typeof rawKey !== 'string' || !rawKey.trim()) continue;
    const normKey = normalizeLegacyOptionKey(rawKey);

    if (isSystemOptionKey(normKey)) {
      if (!usedSystemKeys.has(normKey)) {
        usedSystemKeys.add(normKey);
        result.push(normKey);
      }
      continue;
    }

    // Check if normKey matches any applicable preset
    const matchedPreset = applicablePresets.find(
      (p) => !usedPresetIds.has(p.id) && matchesPresetKey(p, normKey)
    );
    if (matchedPreset) {
      usedPresetIds.add(matchedPreset.id);
      result.push(matchedPreset.id);
    }
  }

  // 2. Collect any remaining applicable presets that weren't in savedOrder
  const remainingPresets = applicablePresets
    .filter((p) => !usedPresetIds.has(p.id))
    .sort((a, b) => {
      if (a.finishedWeight !== b.finishedWeight) {
        return a.finishedWeight - b.finishedWeight;
      }
      return a.name.localeCompare(b.name);
    });

  if (remainingPresets.length > 0) {
    // Insert remaining presets right before the first trailing system option if system options are at the end,
    // or append before Custom Quantity if found, otherwise append to end
    const firstSysIdx = result.findIndex((k) => isSystemOptionKey(k));
    if (firstSysIdx >= 0) {
      result.splice(firstSysIdx, 0, ...remainingPresets.map((p) => p.id));
    } else {
      result.push(...remainingPresets.map((p) => p.id));
    }
  }

  // 3. Ensure all 3 system options are always present
  const requiredSystemOrder: SystemOptionKey[] = [
    SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
    SYSTEM_OPTION_KEYS.FULL_RECIPE,
    SYSTEM_OPTION_KEYS.FULL_MIXER,
  ];
  for (const sysKey of requiredSystemOrder) {
    if (!usedSystemKeys.has(sysKey)) {
      usedSystemKeys.add(sysKey);
      result.push(sysKey);
    }
  }

  return result;
}

/**
 *Canonicalizes a raw ordering array by normalizing legacy keys, resolving known preset keys
 * to stable preset IDs where unambiguous, deduplicating entries, and ensuring all 3 system keys exist.
 */
export function canonicalizeProductionOptionOrder(
  rawOrder: string[] | null | undefined,
  allPresets: ProductionPreset[]
): string[] {
  if (!Array.isArray(rawOrder) || rawOrder.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const canonical: string[] = [];

  for (const entry of rawOrder) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const norm = normalizeLegacyOptionKey(entry);
    if (isSystemOptionKey(norm)) {
      if (!seen.has(norm)) {
        seen.add(norm);
        canonical.push(norm);
      }
      continue;
    }

    const exactById = allPresets.find((p) => p.id === norm);
    if (exactById) {
      if (!seen.has(exactById.id)) {
        seen.add(exactById.id);
        canonical.push(exactById.id);
      }
      continue;
    }

    const legacyMatches = allPresets.filter((p) => matchesPresetKey(p, norm));
    if (legacyMatches.length === 1) {
      const resolvedId = legacyMatches[0].id;
      if (!seen.has(resolvedId)) {
        seen.add(resolvedId);
        canonical.push(resolvedId);
      }
      continue;
    }

    if (!seen.has(norm)) {
      seen.add(norm);
      canonical.push(norm);
    }
  }

  const requiredSystemOrder: SystemOptionKey[] = [
    SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
    SYSTEM_OPTION_KEYS.FULL_RECIPE,
    SYSTEM_OPTION_KEYS.FULL_MIXER,
  ];
  for (const sysKey of requiredSystemOrder) {
    if (!seen.has(sysKey)) {
      seen.add(sysKey);
      canonical.push(sysKey);
    }
  }

  return canonical;
}

export function describeOptionKeyLabel(key: string, allPresets: ProductionPreset[]): string {
  const norm = normalizeLegacyOptionKey(key);
  if (norm === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY) return 'Custom Quantity';
  if (norm === SYSTEM_OPTION_KEYS.FULL_RECIPE) return 'Full Recipe';
  if (norm === SYSTEM_OPTION_KEYS.FULL_MIXER) return 'Full Mixer Capacity';

  const preset =
    allPresets.find((p) => p.id === norm) ||
    allPresets.find((p) => matchesPresetKey(p, norm));
  if (preset) {
    return `${preset.name} (${preset.finishedWeight} ${preset.weightUnit})`;
  }
  return norm;
}

export interface ProductionOptionOrderMigrationInspection {
  hasLegacyCandidate: boolean;
  hasDifferences: boolean;
  candidateSource: 'per_user_settings' | 'local_workspace_cache' | null;
  candidateSignature: string;
  candidateOrder: string[];
  workspaceOrder: string[];
  candidateLabels: string[];
  workspaceLabels: string[];
}

/**
 * Pure non-destructive inspection helper for Owner-side reconciliation of a legacy
 * per-user (`settings/{uid}.productionOptionOrder`) or device-cached ordering candidate
 * against the authoritative shared `workspaces/{workspaceId}.productionOptionOrder`.
 *
 * Never mutates inputs, never invents order values, and preserves exact placement
 * (such as 2.5 oz between 2 oz and 3 oz) and all system option keys.
 */
export function inspectProductionOptionOrderMigration(params: {
  workspace: Pick<Workspace, 'productionOptionOrder'> | null | undefined;
  perUserCandidateOrder?: string[] | null;
  localWorkspaceCandidateOrder?: string[] | null;
  allPresets: ProductionPreset[];
  dismissedSignature?: string | null;
}): ProductionOptionOrderMigrationInspection {
  const {
    workspace,
    perUserCandidateOrder,
    localWorkspaceCandidateOrder,
    allPresets,
    dismissedSignature,
  } = params;

  const hasPerUser =
    Array.isArray(perUserCandidateOrder) && perUserCandidateOrder.some((k) => typeof k === 'string' && k.trim());
  const hasLocalWs =
    Array.isArray(localWorkspaceCandidateOrder) &&
    localWorkspaceCandidateOrder.some((k) => typeof k === 'string' && k.trim());

  const rawCandidate = hasPerUser
    ? perUserCandidateOrder!
    : hasLocalWs
    ? localWorkspaceCandidateOrder!
    : null;
  const candidateSource: 'per_user_settings' | 'local_workspace_cache' | null = hasPerUser
    ? 'per_user_settings'
    : hasLocalWs
    ? 'local_workspace_cache'
    : null;

  if (!rawCandidate || rawCandidate.length === 0) {
    return {
      hasLegacyCandidate: false,
      hasDifferences: false,
      candidateSource: null,
      candidateSignature: '',
      candidateOrder: [],
      workspaceOrder: Array.isArray(workspace?.productionOptionOrder)
        ? [...workspace!.productionOptionOrder!]
        : [],
      candidateLabels: [],
      workspaceLabels: [],
    };
  }

  const candidateOrder = canonicalizeProductionOptionOrder(rawCandidate, allPresets);
  const rawWsOrder = Array.isArray(workspace?.productionOptionOrder)
    ? workspace!.productionOptionOrder!
    : [];
  const workspaceOrder =
    rawWsOrder.length > 0
      ? canonicalizeProductionOptionOrder(rawWsOrder, allPresets)
      : getDefaultProductionOptionKeys(allPresets);

  const candidateSignature = JSON.stringify(candidateOrder);
  if (dismissedSignature && dismissedSignature === candidateSignature) {
    return {
      hasLegacyCandidate: true,
      hasDifferences: false,
      candidateSource,
      candidateSignature,
      candidateOrder,
      workspaceOrder,
      candidateLabels: candidateOrder.map((k) => describeOptionKeyLabel(k, allPresets)),
      workspaceLabels: workspaceOrder.map((k) => describeOptionKeyLabel(k, allPresets)),
    };
  }

  const isIdentical =
    rawWsOrder.length > 0 &&
    candidateOrder.length === workspaceOrder.length &&
    candidateOrder.every((key, idx) => key === workspaceOrder[idx]);

  return {
    hasLegacyCandidate: true,
    hasDifferences: !isIdentical,
    candidateSource,
    candidateSignature,
    candidateOrder,
    workspaceOrder,
    candidateLabels: candidateOrder.map((k) => describeOptionKeyLabel(k, allPresets)),
    workspaceLabels: workspaceOrder.map((k) => describeOptionKeyLabel(k, allPresets)),
  };
}

/**
 * Returns ordered workspace option descriptors (system options + presets) for Management UI and tests.
 */
export function getWorkspaceOptionDescriptors(
  allPresets: ProductionPreset[],
  customOrder?: string[] | null
): WorkspaceOptionDescriptor[] {
  const orderedKeys = getOrderedProductionOptionKeys(allPresets, customOrder);
  const descriptors: WorkspaceOptionDescriptor[] = [];

  for (const key of orderedKeys) {
    if (key === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY) {
      descriptors.push({
        key: SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
        name: 'Custom Quantity',
        description: 'Manual piece count and unit weight entry for custom runs',
        type: 'system',
      });
    } else if (key === SYSTEM_OPTION_KEYS.FULL_RECIPE) {
      descriptors.push({
        key: SYSTEM_OPTION_KEYS.FULL_RECIPE,
        name: 'Full Recipe',
        description: 'Authoritative base recipe formula (1x, 2x, etc.) with 0% added waste',
        type: 'system',
      });
    } else if (key === SYSTEM_OPTION_KEYS.FULL_MIXER) {
      descriptors.push({
        key: SYSTEM_OPTION_KEYS.FULL_MIXER,
        name: 'Full Mixer Capacity',
        description: 'Scales recipe to maximum safe mixer capacity',
        type: 'system',
      });
    } else {
      const preset = allPresets.find((p) => p.id === key);
      if (preset) {
        descriptors.push({
          key: preset.id,
          name: preset.name,
          description: `${preset.quantityPerUnit} / ${preset.unitName} · ${preset.finishedWeight} ${preset.weightUnit}`,
          type: 'preset',
          category: preset.category || 'Cookies',
          preset,
        });
      }
    }
  }

  return descriptors;
}

