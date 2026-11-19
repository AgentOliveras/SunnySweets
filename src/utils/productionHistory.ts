import { Recipe } from '../types';

export type ProductionSortOption = 'recent' | 'most_used' | 'alphabetical' | 'category';

export interface RecipeUsageRecord {
  recipeId: string;
  lastUsedAt: number; // epoch ms
  useCount: number;
}

export type RecipeUsageMap = Record<string, RecipeUsageRecord>;

export const PROD_RECIPE_USAGE_KEY = 'sunny_sweets_prod_recipe_usage';
export const PROD_SORT_PREFERENCE_KEY = 'sunny_sweets_prod_sort_preference';

export interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, val: string): void;
  removeItem?(key: string): void;
}

function getEffectiveStorage(customStorage?: SimpleStorage): SimpleStorage | null {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

/**
 * Safely load local recipe usage history from localStorage
 */
export function loadRecipeUsageMap(storage?: SimpleStorage): RecipeUsageMap {
  const store = getEffectiveStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(PROD_RECIPE_USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Safely persist local recipe usage history to localStorage (Zero Firestore writes)
 */
export function saveRecipeUsageMap(usageMap: RecipeUsageMap, storage?: SimpleStorage): void {
  const store = getEffectiveStorage(storage);
  if (!store) return;
  try {
    store.setItem(PROD_RECIPE_USAGE_KEY, JSON.stringify(usageMap));
  } catch {
    // Ignore quota/disabled localStorage errors
  }
}

/**
 * Record a calculated production run for a recipe locally
 */
export function recordProductionRun(recipeId: string, storage?: SimpleStorage): RecipeUsageMap {
  if (!recipeId) return loadRecipeUsageMap(storage);
  const current = loadRecipeUsageMap(storage);
  const existing = current[recipeId];
  const now = Date.now();
  const updated: RecipeUsageRecord = {
    recipeId,
    lastUsedAt: now,
    useCount: (existing?.useCount || 0) + 1,
  };
  const nextMap: RecipeUsageMap = {
    ...current,
    [recipeId]: updated,
  };
  saveRecipeUsageMap(nextMap, storage);
  return nextMap;
}

/**
 * Load operator's persisted sort preference
 */
export function loadSortPreference(storage?: SimpleStorage): ProductionSortOption {
  const store = getEffectiveStorage(storage);
  if (!store) return 'recent';
  try {
    const raw = store.getItem(PROD_SORT_PREFERENCE_KEY);
    if (raw === 'recent' || raw === 'most_used' || raw === 'alphabetical' || raw === 'category') {
      return raw;
    }
  } catch {
    // fallback
  }
  return 'recent';
}

/**
 * Persist operator's sort preference
 */
export function saveSortPreference(pref: ProductionSortOption, storage?: SimpleStorage): void {
  const store = getEffectiveStorage(storage);
  if (!store) return;
  try {
    store.setItem(PROD_SORT_PREFERENCE_KEY, pref);
  } catch {
    // Ignore
  }
}

/**
 * Pure function to sort recipes according to chosen ProductionSortOption:
 * - alphabetical: A–Z ascending by recipe name
 * - category: Group/sort by Recipe.category, then A–Z by recipe name within category
 * - recent: Most recently calculated production run first, fallback to A–Z
 * - most_used: Highest usage count in Production Mode first, fallback to A–Z
 */
export function sortRecipes(
  recipes: Recipe[],
  sortOption: ProductionSortOption,
  usageMap: RecipeUsageMap = {}
): Recipe[] {
  return [...recipes].sort((a, b) => {
    const nameA = (a.name || '').trim();
    const nameB = (b.name || '').trim();

    if (sortOption === 'alphabetical') {
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }

    if (sortOption === 'category') {
      const catA = (a.category || '').trim();
      const catB = (b.category || '').trim();
      const catCompare = catA.localeCompare(catB, undefined, { sensitivity: 'base' });
      if (catCompare !== 0) return catCompare;
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }

    if (sortOption === 'recent') {
      const timeA = usageMap[a.id]?.lastUsedAt || 0;
      const timeB = usageMap[b.id]?.lastUsedAt || 0;
      if (timeA !== timeB) {
        return timeB - timeA; // Descending by timestamp
      }
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }

    if (sortOption === 'most_used') {
      const countA = usageMap[a.id]?.useCount || 0;
      const countB = usageMap[b.id]?.useCount || 0;
      if (countA !== countB) {
        return countB - countA; // Descending by use count
      }
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }

    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  });
}
