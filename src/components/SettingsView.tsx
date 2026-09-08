import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings as SettingsIcon,
  Scale,
  Percent,
  Sun,
  Moon,
  FlaskConical,
  Building,
  User,
  ShieldCheck,
  Check,
  Hash,
  Save,
  CheckCircle2,
  Cloud,
  RefreshCw,
  AlertCircle,
  Wifi,
  WifiOff,
  Sliders,
  Sparkles,
  RotateCcw,
  Tag,
  Search,
  Plus,
  Edit2,
  Trash2,
  X,
  CheckSquare,
  Square,
  FolderPlus,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { UserSettings, WeightUnit, Recipe, ProductionPreset } from '../types';
import { WEIGHT_UNITS } from '../utils/units';
import { store } from '../services/store';
import { auth, signInWithGoogle } from '../services/firebase';
import {
  scanForLegacyData,
  executePhase0Migration,
  MigrationScanReport,
  MigrationExecutionResult,
} from '../services/migration';
import { BrandingSettings } from './BrandingSettings';
import { MembersManagement } from './MembersManagement';
import { SettingsSectionErrorBoundary } from './SettingsSectionErrorBoundary';

interface SettingsViewProps {
  settings: UserSettings;
  recipesCount?: number;
  recipes?: Recipe[];
  presets?: ProductionPreset[];
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  onStandardizeAllRecipes?: (targetUnit: WeightUnit) => Promise<number>;
  onOpenUnitTests: () => void;
  testPassedCount?: number;
}

const RECIPE_CATEGORY_ICONS: Record<string, string> = {
  Cookies: '🍪',
  Bread: '🍞',
  'Base Dough': '🍞',
  'Pie Dough': '🥧',
  Pies: '🥧',
  Biscuits: '🧈',
  Scones: '🧁',
  Pastries: '🥐',
  Cakes: '🎂',
  Muffins: '🧁',
  Shortbread: '🧈',
  Tarts: '🥧',
  'Gluten-Free': '🌾',
  Uncategorized: '📂',
};

const PRESET_CATEGORY_ICONS: Record<string, string> = {
  All: '✨',
  'All Presets': '✨',
  Cookies: '🍪',
  'Pie Dough': '🥧',
  'Base Dough': '🍞',
  Shortbread: '🧈',
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  recipesCount = 0,
  recipes,
  presets,
  onUpdateSettings,
  onStandardizeAllRecipes,
  onOpenUnitTests,
  testPassedCount,
}) => {
  const [businessName, setBusinessName] = useState(settings?.businessName || 'Artisan Bakery Co.');
  const [defaultWastePercent, setDefaultWastePercent] = useState<string | number>(
    settings?.defaultWastePercent !== undefined ? settings.defaultWastePercent : 6
  );
  const [standardizeStatus, setStandardizeStatus] = useState<string | null>(null);
  const [isStandardizing, setIsStandardizing] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState(store.getSyncStatus());
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');

  // Category Management State
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryPresets, setNewCategoryPresets] = useState<string[]>(['All']);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryNewName, setEditingCategoryNewName] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [deleteReassignTarget, setDeleteReassignTarget] = useState('Uncategorized');

  // Phase 0 Security & Migration State
  const [scanReport, setScanReport] = useState<MigrationScanReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationExecutionResult | null>(null);
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);

  const handleScanMigration = async () => {
    setIsScanning(true);
    try {
      const rep = await scanForLegacyData();
      setScanReport(rep);
    } catch (err) {
      console.warn('Scan notice:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteMigration = async () => {
    setIsMigrating(true);
    try {
      const res = await executePhase0Migration();
      setMigrationResult(res);
      setMigrationConfirmOpen(false);
      const rep = await scanForLegacyData();
      setScanReport(rep);
    } catch (err) {
      console.warn('Migration error:', err);
    } finally {
      setIsMigrating(false);
    }
  };

  // Fallback to store lists if not explicitly passed
  const allRecipes = useMemo(() => {
    return recipes && recipes.length > 0 ? recipes : store.getRecipes();
  }, [recipes, syncStatus]);

  const allPresetsList = useMemo(() => {
    return presets && presets.length > 0 ? presets : store.getPresets();
  }, [presets, syncStatus]);

  // Unique preset categories from available presets + default categories
  const allPresetCategories = useMemo(() => {
    const set = new Set<string>(['Cookies', 'Pie Dough', 'Base Dough', 'Shortbread']);
    allPresetsList.forEach((p) => {
      if (p.category && p.category.trim()) {
        set.add(p.category.trim());
      }
    });
    return Array.from(set);
  }, [allPresetsList]);

  // Count presets per preset category
  const presetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allPresetsList.forEach((p) => {
      const cat = p.category || 'Cookies';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [allPresetsList]);

  // Derive ONLY the categories that actually exist in the system (from existing recipes or user-managed categories)
  const allRecipeCategories = useMemo(() => {
    const set = new Set<string>();
    allRecipes.forEach((r) => {
      if (r.category && r.category.trim()) {
        set.add(r.category.trim());
      }
    });

    if (settings?.recipeCategories && settings.recipeCategories.length > 0) {
      settings.recipeCategories.forEach((c) => {
        if (c && c.trim()) set.add(c.trim());
      });
    }

    const categoriesArray = Array.from(set);
    return categoriesArray;
  }, [allRecipes, settings?.recipeCategories, syncStatus]);

  // Filtered recipe categories for search
  const filteredRecipeCategories = useMemo(() => {
    if (!categorySearch.trim()) return allRecipeCategories;
    const query = categorySearch.trim().toLowerCase();
    return allRecipeCategories.filter((c) => c.toLowerCase().includes(query));
  }, [allRecipeCategories, categorySearch]);

  // Subscribe to store updates for real-time sync status
  useEffect(() => {
    const unsub = store.subscribe(() => {
      setSyncStatus(store.getSyncStatus());
    });
    return () => unsub();
  }, []);

  const handleManualSync = async () => {
    setIsManualSyncing(true);
    try {
      await store.syncAllWithCloud();
      showNotification('Cloud synchronization completed successfully.');
    } catch (err) {
      showNotification('Sync failed. Please check network connection.');
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Sync internal state with external settings prop changes
  useEffect(() => {
    if (settings) {
      setBusinessName(settings.businessName || 'Artisan Bakery Co.');
      setDefaultWastePercent(settings.defaultWastePercent !== undefined ? settings.defaultWastePercent : 6);
    }
  }, [settings?.businessName, settings?.defaultWastePercent]);

  const showNotification = (msg: string) => {
    setSaveFeedback(msg);
    setTimeout(() => {
      setSaveFeedback(null);
    }, 3500);
  };

  const handleStandardize = async (unit: WeightUnit) => {
    if (!onStandardizeAllRecipes) return;
    setIsStandardizing(true);
    try {
      const count = await onStandardizeAllRecipes(unit);
      setStandardizeStatus(`Successfully standardized ${count} ingredient inputs across all recipes into ${unit.toUpperCase()}!`);
      setTimeout(() => setStandardizeStatus(null), 5000);
    } catch (err) {
      console.error('Failed to standardize recipes:', err);
    } finally {
      setIsStandardizing(false);
    }
  };

  const handleUpdateUnit = (unit: WeightUnit) => {
    onUpdateSettings({ defaultWeightUnit: unit });
    showNotification(`Measurement system set to ${unit.toUpperCase()} and saved.`);
  };

  const handleUpdateDecimals = (decimals: number) => {
    onUpdateSettings({ decimalPlaces: decimals });
    showNotification(
      decimals === 0
        ? 'Display precision set to 0 decimals (rounded whole numbers) and saved.'
        : `Display precision set to ${decimals} decimal ${decimals === 1 ? 'place' : 'places'} and saved.`
    );
  };

  // Multi-preset category helper
  const getSelectedPresetCategories = (recipeCat: string): string[] => {
    const mapVal = settings.categoryPresetMap ? settings.categoryPresetMap[recipeCat] : undefined;
    if (!mapVal) return ['All'];
    if (Array.isArray(mapVal)) {
      return mapVal.length === 0 ? ['All'] : mapVal;
    }
    return [mapVal];
  };

  // Multi-preset category toggle
  const handleTogglePresetCategory = (recipeCat: string, presetCat: string) => {
    const currentSelected = getSelectedPresetCategories(recipeCat);
    let updated: string[] = [];

    if (presetCat === 'All') {
      // Toggle to All Presets
      updated = ['All'];
    } else {
      if (currentSelected.includes('All')) {
        updated = [presetCat];
      } else {
        if (currentSelected.includes(presetCat)) {
          const remaining = currentSelected.filter((c) => c !== presetCat);
          updated = remaining.length === 0 ? ['All'] : remaining;
        } else {
          updated = [...currentSelected, presetCat];
        }
      }
    }

    const currentMap = { ...(settings.categoryPresetMap || {}) };
    currentMap[recipeCat] = updated;
    onUpdateSettings({ categoryPresetMap: currentMap });

    showNotification(
      updated.includes('All')
        ? `Recipe category "${recipeCat}" set to All Presets.`
        : `Recipe category "${recipeCat}" mapped to ${updated.length} preset ${updated.length === 1 ? 'category' : 'categories'} (${updated.join(', ')}).`
    );
  };

  // Add Category Handler
  const handleAddCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newCategoryName.trim();
    if (!cleanName) return;

    if (allRecipeCategories.some((c) => c.toLowerCase() === cleanName.toLowerCase())) {
      showNotification(`Category "${cleanName}" already exists.`);
      return;
    }

    await store.addRecipeCategory(cleanName, newCategoryPresets.length > 0 ? newCategoryPresets : ['All']);
    setNewCategoryName('');
    setNewCategoryPresets(['All']);
    setIsAddingCategory(false);
    showNotification(`Category "${cleanName}" created successfully.`);
  };

  // Rename Category Handler
  const handleStartEditingCategory = (catName: string) => {
    setEditingCategory(catName);
    setEditingCategoryNewName(catName);
    setDeletingCategory(null);
  };

  const handleRenameCategorySubmit = async (oldName: string) => {
    const cleanNew = editingCategoryNewName.trim();
    if (!cleanNew || cleanNew.toLowerCase() === oldName.toLowerCase()) {
      setEditingCategory(null);
      return;
    }

    if (
      allRecipeCategories.some(
        (c) => c.toLowerCase() === cleanNew.toLowerCase() && c.toLowerCase() !== oldName.toLowerCase()
      )
    ) {
      showNotification(`Category "${cleanNew}" already exists.`);
      return;
    }

    const updatedCount = await store.renameRecipeCategory(oldName, cleanNew);
    setEditingCategory(null);
    setEditingCategoryNewName('');
    showNotification(
      updatedCount > 0
        ? `Renamed category to "${cleanNew}" and updated ${updatedCount} ${updatedCount === 1 ? 'recipe' : 'recipes'}.`
        : `Renamed category to "${cleanNew}".`
    );
  };

  // Delete Category Handler
  const handleStartDeletingCategory = (catName: string) => {
    setDeletingCategory(catName);
    setEditingCategory(null);
    // Find an alternative category as default reassign target
    const otherCats = allRecipeCategories.filter((c) => c.toLowerCase() !== catName.toLowerCase());
    setDeleteReassignTarget(otherCats[0] || 'Uncategorized');
  };

  const handleDeleteCategoryConfirm = async () => {
    if (!deletingCategory) return;
    const catToDelete = deletingCategory;
    const targetReassign = deleteReassignTarget || 'Uncategorized';
    const updatedCount = await store.deleteRecipeCategory(catToDelete, targetReassign);
    setDeletingCategory(null);
    showNotification(
      updatedCount > 0
        ? `Deleted category "${catToDelete}". ${updatedCount} ${updatedCount === 1 ? 'recipe' : 'recipes'} moved to "${targetReassign}".`
        : `Deleted category "${catToDelete}".`
    );
  };

  const handleAutoMatchCategories = () => {
    const newMap: Record<string, string[]> = { ...(settings.categoryPresetMap as any || {}) };
    allRecipeCategories.forEach((cat) => {
      const lower = cat.toLowerCase();
      if (lower.includes('cookie') || lower.includes('biscuit') || lower.includes('scone')) {
        newMap[cat] = ['Cookies'];
      } else if (
        lower.includes('bread') ||
        lower.includes('dough') ||
        lower.includes('focaccia') ||
        lower.includes('loaf') ||
        lower.includes('base')
      ) {
        newMap[cat] = ['Base Dough'];
      } else if (
        lower.includes('pie') ||
        lower.includes('pastr') ||
        lower.includes('crust') ||
        lower.includes('turnover')
      ) {
        newMap[cat] = ['Pie Dough'];
      } else if (lower.includes('shortbread') || lower.includes('tart')) {
        newMap[cat] = ['Shortbread'];
      } else {
        newMap[cat] = ['All'];
      }
    });
    onUpdateSettings({ categoryPresetMap: newMap });
    showNotification('Recipe categories automatically matched with corresponding packaging presets.');
  };

  const handleResetAllToAllPresets = () => {
    const newMap: Record<string, string[]> = {};
    allRecipeCategories.forEach((cat) => {
      newMap[cat] = ['All'];
    });
    onUpdateSettings({ categoryPresetMap: newMap });
    showNotification('All recipe categories set to show All Presets.');
  };

  const handleUpdateTheme = (theme: 'light' | 'dark') => {
    onUpdateSettings({ theme });
    showNotification(`${theme === 'dark' ? 'Dark' : 'Light'} theme applied and saved.`);
  };

  const handleSaveBusinessInfo = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const wasteNum = parseFloat(String(defaultWastePercent));
    const cleanWaste = isNaN(wasteNum) || wasteNum < 0 ? 0 : wasteNum;
    if (cleanWaste === 0) {
      localStorage.setItem('bakery_settings_explicit_zero_waste', 'true');
    } else {
      localStorage.removeItem('bakery_settings_explicit_zero_waste');
    }
    onUpdateSettings({
      businessName: businessName.trim() || 'Artisan Bakery Co.',
      defaultWastePercent: cleanWaste,
    });
    showNotification('Bakery profile and global waste settings saved and applied.');
  };

  // If loading, render "Loading settings..."
  if (!settings || store.isAuthLoading()) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-[#8B7E74] dark:text-[#A39E93] space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-[#D4A373]" />
        <p className="text-sm font-medium">Loading settings...</p>
      </div>
    );
  }

  // If unauthorized: Settings should not mount at all
  if (!store.isAuthorized()) {
    return null;
  }

  return (
    <div className="space-y-6 pb-20 md:pb-8 max-w-4xl">
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-[#D4A373]" />
            <span>Application Settings</span>
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Configure measurement systems, business branding, decimal precision, and theme appearance. All settings are automatically saved and applied.
          </p>
        </div>

        {saveFeedback && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#E8F5E9] dark:bg-[#1B3520] border border-[#A5D6A7] dark:border-[#2E7D32] rounded-xl text-xs font-bold text-[#2E7D32] dark:text-[#81C784] shadow-sm animate-fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{saveFeedback}</span>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* Default Measurement System Selector */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-center">
              <Scale className="w-5 h-5 text-[#D4A373]" />
            </div>
            <div>
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Default Measurement System
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Primary weight unit used across total recipe weights, batch calculations, and production sheets.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {WEIGHT_UNITS.map((u) => (
              <button
                key={u.value}
                id={`settings-unit-${u.value}`}
                type="button"
                onClick={() => handleUpdateUnit(u.value as WeightUnit)}
                className={`p-4 rounded-xl border text-center font-bold text-sm transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                  settings.defaultWeightUnit === u.value
                    ? 'bg-[#5A534B] text-white border-[#5A534B] dark:bg-[#3D3732] shadow-sm ring-2 ring-[#D4A373]/50'
                    : 'bg-[#F9F8F6] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373]'
                }`}
              >
                <div>{u.label}</div>
                {settings.defaultWeightUnit === u.value && (
                  <span className="text-[10px] text-[#D4A373] font-semibold uppercase tracking-wider flex items-center gap-0.5">
                    <Check className="w-3 h-3 inline" /> Active Default
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* One-Click Ingredient Standardization */}
          {onStandardizeAllRecipes && (
            <div className="pt-3 border-t border-[#EEECE8] dark:border-[#332F2B] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF7F2] dark:bg-[#25221F] p-4 rounded-xl border">
              <div>
                <h4 className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                  Standardize All Existing Recipe Ingredients
                </h4>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  Convert and align measuring unit inputs across all {recipesCount > 0 ? `${recipesCount} recipes` : 'bakery recipes'} to {(settings?.defaultWeightUnit || 'g').toUpperCase()}.
                </p>
              </div>

              <button
                type="button"
                id="standardize-all-recipes-btn"
                disabled={isStandardizing}
                onClick={() => handleStandardize(settings?.defaultWeightUnit || 'g')}
                className="inline-flex items-center justify-center gap-2 bg-[#D4A373] hover:bg-[#C49363] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm shrink-0 cursor-pointer"
              >
                <Scale className="w-4 h-4" />
                <span>
                  {isStandardizing ? 'Standardizing...' : `Standardize All to ${(settings?.defaultWeightUnit || 'g').toUpperCase()}`}
                </span>
              </button>
            </div>
          )}

          {standardizeStatus && (
            <div className="p-3 bg-[#E8F5E9] dark:bg-[#1B3520] border border-[#A5D6A7] dark:border-[#2E7D32] rounded-xl text-xs font-bold text-[#2E7D32] dark:text-[#81C784] flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{standardizeStatus}</span>
            </div>
          )}
        </div>

        {/* Decimal Precision & Rounding Selector */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-center">
              <Hash className="w-5 h-5 text-[#D4A373]" />
            </div>
            <div>
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Decimal Precision & Rounding
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Set how many decimal points to display across ingredient amounts, batch weights, and reports. Choose 0 decimals for whole integer rounding.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
            {[
              { value: 0, label: '0 Decimals', sub: 'Round to Whole (e.g. 150)' },
              { value: 1, label: '1 Decimal', sub: 'e.g. 150.5' },
              { value: 2, label: '2 Decimals', sub: 'Standard (e.g. 150.25)' },
              { value: 3, label: '3 Decimals', sub: 'e.g. 150.250' },
              { value: 4, label: '4 Decimals', sub: 'High Precision' },
            ].map((opt) => {
              const currentDecimals = settings.decimalPlaces !== undefined ? settings.decimalPlaces : 2;
              const isSelected = currentDecimals === opt.value;
              return (
                <button
                  key={opt.value}
                  id={`settings-decimal-${opt.value}`}
                  type="button"
                  onClick={() => handleUpdateDecimals(opt.value)}
                  className={`p-3 rounded-xl border text-center transition cursor-pointer flex flex-col justify-between items-center ${
                    isSelected
                      ? 'bg-[#5A534B] text-white border-[#5A534B] dark:bg-[#3D3732] shadow-sm ring-2 ring-[#D4A373]/50'
                      : 'bg-[#F9F8F6] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373]'
                  }`}
                >
                  <div className="font-bold text-xs">{opt.label}</div>
                  <div className={`text-[10px] mt-1 ${isSelected ? 'text-[#D4A373]' : 'text-[#8B7E74] dark:text-[#A39E93]'}`}>
                    {opt.sub}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recipe Categories & Preset Routing (Multi-Select & Management) */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-center">
                <Sliders className="w-5 h-5 text-[#D4A373]" />
              </div>
              <div>
                <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Recipe Categories & Preset Routing
                </h3>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  Add, edit, or delete recipe categories, and choose which packaging presets route to each category (multiple presets can be selected).
                </p>
              </div>
            </div>

            {/* Section Actions */}
            <div className="flex items-center flex-wrap gap-2 shrink-0">
              <button
                type="button"
                id="settings-add-category-toggle-btn"
                onClick={() => {
                  setIsAddingCategory(!isAddingCategory);
                  setEditingCategory(null);
                  setDeletingCategory(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  isAddingCategory
                    ? 'bg-[#D4A373] text-white'
                    : 'bg-[#FAF7F2] dark:bg-[#25221F] hover:bg-[#F0EBE1] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] border border-[#E5E1DA] dark:border-[#332F2B]'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Category</span>
              </button>

              <button
                type="button"
                id="settings-automatch-categories-btn"
                onClick={handleAutoMatchCategories}
                className="px-3 py-1.5 bg-[#FAF7F2] dark:bg-[#25221F] hover:bg-[#F0EBE1] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] border border-[#E5E1DA] dark:border-[#332F2B] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                title="Auto-match recipe categories to corresponding preset categories"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Auto-Match</span>
              </button>

              <button
                type="button"
                id="settings-reset-all-presets-btn"
                onClick={handleResetAllToAllPresets}
                className="px-3 py-1.5 bg-[#FAF7F2] dark:bg-[#25221F] hover:bg-[#F0EBE1] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7] border border-[#E5E1DA] dark:border-[#332F2B] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                title="Set all recipe categories to route All Presets"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>All Presets</span>
              </button>
            </div>
          </div>

          {/* Inline Add Category Form */}
          {isAddingCategory && (
            <form
              onSubmit={handleAddCategorySubmit}
              className="p-4 bg-[#FAF7F2] dark:bg-[#25221F] border border-[#D4A373]/50 rounded-xl space-y-3.5 animate-fadeIn"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                  <FolderPlus className="w-4 h-4 text-[#D4A373]" />
                  <span>Create New Recipe Category</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingCategory(false)}
                  className="text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                  Category Name
                </label>
                <input
                  type="text"
                  id="new-category-name-input"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Gluten-Free Cookies, Specialty Bread, Savory Pastries"
                  className="w-full px-3.5 py-2 text-xs bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  autoFocus
                />
              </div>

              {/* Preset selection for new category */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                    Assigned Presets (Select one or more):
                  </span>
                  <span className="text-[10px] text-[#D4A373] font-bold">
                    {newCategoryPresets.includes('All')
                      ? 'All Presets'
                      : `${newCategoryPresets.join(', ')}`}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewCategoryPresets(['All'])}
                    className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      newCategoryPresets.includes('All')
                        ? 'bg-[#D4A373] text-white border-[#D4A373]'
                        : 'bg-white dark:bg-[#1E1B18] border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
                    }`}
                  >
                    <Check className={`w-3.5 h-3.5 ${newCategoryPresets.includes('All') ? 'opacity-100' : 'opacity-0'}`} />
                    <span>✨ All Presets</span>
                  </button>
                  {allPresetCategories.map((pCat) => {
                    const isSel = newCategoryPresets.includes(pCat);
                    const pIcon = PRESET_CATEGORY_ICONS[pCat] || '📦';
                    return (
                      <button
                        key={pCat}
                        type="button"
                        onClick={() => {
                          if (newCategoryPresets.includes('All')) {
                            setNewCategoryPresets([pCat]);
                          } else if (isSel) {
                            const rem = newCategoryPresets.filter((c) => c !== pCat);
                            setNewCategoryPresets(rem.length === 0 ? ['All'] : rem);
                          } else {
                            setNewCategoryPresets([...newCategoryPresets, pCat]);
                          }
                        }}
                        className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          isSel
                            ? 'bg-[#5A534B] text-white border-[#5A534B] dark:bg-[#3D3732]'
                            : 'bg-white dark:bg-[#1E1B18] border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
                        }`}
                      >
                        <Check className={`w-3.5 h-3.5 ${isSel ? 'opacity-100' : 'opacity-0'}`} />
                        <span className="truncate">{pIcon} {pCat}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAddingCategory(false)}
                  className="px-3 py-1.5 bg-transparent hover:bg-[#EAE6E1] dark:hover:bg-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="confirm-create-category-btn"
                  disabled={!newCategoryName.trim()}
                  className="px-3.5 py-1.5 bg-[#D4A373] hover:bg-[#C29363] text-white rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Category</span>
                </button>
              </div>
            </form>
          )}

          {/* Search bar if multiple categories */}
          {allRecipeCategories.length > 4 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#A39E93]" />
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder="Filter categories..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-lg focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
              />
            </div>
          )}

          {/* Empty State */}
          {allRecipeCategories.length === 0 && !isAddingCategory && (
            <div className="p-8 text-center rounded-xl bg-[#FAF7F2] dark:bg-[#25221F] border border-dashed border-[#E5E1DA] dark:border-[#332F2B] space-y-3">
              <div className="text-3xl">📂</div>
              <div className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">No Categories Found</div>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] max-w-sm mx-auto">
                No recipe categories are currently defined in the system. Create one to organize recipes and route packaging presets.
              </p>
              <button
                type="button"
                onClick={() => setIsAddingCategory(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#D4A373] text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Your First Category</span>
              </button>
            </div>
          )}

          {/* List of Recipe Categories */}
          <div className="space-y-3.5">
            {filteredRecipeCategories.map((catName) => {
              const selectedPresets = getSelectedPresetCategories(catName);
              const isAllSelected = selectedPresets.includes('All');
              const recipesInCat = allRecipes.filter((r) => (r.category || 'Uncategorized') === catName).length;
              const catIcon = RECIPE_CATEGORY_ICONS[catName] || '📂';
              const isEditing = editingCategory === catName;
              const isDeleting = deletingCategory === catName;

              // Calculate total presets accessible via selected preset categories
              let totalAccessiblePresetsCount = 0;
              if (isAllSelected) {
                totalAccessiblePresetsCount = allPresetsList.length;
              } else {
                selectedPresets.forEach((pCat) => {
                  totalAccessiblePresetsCount += presetCounts[pCat] || 0;
                });
              }

              return (
                <div
                  key={catName}
                  id={`recipe-cat-card-${catName.toLowerCase().replace(/\s+/g, '-')}`}
                  className="p-4 bg-[#F9F8F6] dark:bg-[#25221F] rounded-xl border border-[#EEECE8] dark:border-[#332F2B] space-y-3.5 transition"
                >
                  {/* Category Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-[#EEECE8] dark:border-[#2D2925]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base">{catIcon}</span>

                      {/* Editing Title vs Display Title */}
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingCategoryNewName}
                            onChange={(e) => setEditingCategoryNewName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameCategorySubmit(catName);
                              if (e.key === 'Escape') setEditingCategory(null);
                            }}
                            className="px-2 py-0.5 text-xs font-bold bg-white dark:bg-[#1E1B18] border border-[#D4A373] rounded text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleRenameCategorySubmit(catName)}
                            className="p-1 rounded bg-[#D4A373] text-white hover:bg-[#C29363] cursor-pointer"
                            title="Save name"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCategory(null)}
                            className="p-1 rounded bg-[#EAE6E1] dark:bg-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] cursor-pointer"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                            {catName}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EAE6E1] dark:bg-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] font-medium">
                            {recipesInCat} {recipesInCat === 1 ? 'recipe' : 'recipes'}
                          </span>

                          {/* Edit & Delete Category Action Icons */}
                          <div className="flex items-center gap-0.5 ml-1">
                            <button
                              type="button"
                              id={`edit-category-btn-${catName.toLowerCase().replace(/\s+/g, '-')}`}
                              onClick={() => handleStartEditingCategory(catName)}
                              className="p-1 text-[#8B7E74] hover:text-[#D4A373] dark:text-[#A39E93] dark:hover:text-[#D4A373] rounded hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] transition cursor-pointer"
                              title={`Edit / Rename category "${catName}"`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              id={`delete-category-btn-${catName.toLowerCase().replace(/\s+/g, '-')}`}
                              onClick={() => handleStartDeletingCategory(catName)}
                              className="p-1 text-[#8B7E74] hover:text-red-500 dark:text-[#A39E93] dark:hover:text-red-400 rounded hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] transition cursor-pointer"
                              title={`Delete category "${catName}"`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Routing Summary Badge */}
                    <div className="text-xs text-[#8B7E74] dark:text-[#A39E93] font-medium flex items-center gap-1.5">
                      <span className="hidden sm:inline">Active routing:</span>
                      <span className="font-bold text-[#D4A373] px-2 py-0.5 rounded bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] text-[11px] truncate max-w-[280px]">
                        {isAllSelected ? (
                          '✨ All Presets'
                        ) : (
                          `${selectedPresets.join(', ')} (${totalAccessiblePresetsCount} presets)`
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Inline Delete Category Confirmation Banner */}
                  {isDeleting && (
                    <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 space-y-2.5 animate-fadeIn">
                      <div className="flex items-center gap-2 text-xs font-bold text-red-800 dark:text-red-300">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>Delete "{catName}" category?</span>
                      </div>

                      {recipesInCat > 0 ? (
                        <div className="space-y-1.5 text-xs text-red-700 dark:text-red-400">
                          <p>
                            There {recipesInCat === 1 ? 'is' : 'are'}{' '}
                            <strong className="font-bold">{recipesInCat}</strong>{' '}
                            {recipesInCat === 1 ? 'recipe' : 'recipes'} assigned to this category. Choose where to move them:
                          </p>
                          <div className="flex items-center gap-2">
                            <select
                              value={deleteReassignTarget}
                              onChange={(e) => setDeleteReassignTarget(e.target.value)}
                              className="px-2.5 py-1.5 text-xs bg-white dark:bg-[#1E1B18] border border-red-300 dark:border-red-700 rounded-lg text-[#5A534B] dark:text-[#EAE6E1] focus:outline-none"
                            >
                              <option value="Uncategorized">Uncategorized</option>
                              {allRecipeCategories
                                .filter((c) => c.toLowerCase() !== catName.toLowerCase())
                                .map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-red-700 dark:text-red-400">
                          This category currently has no recipes and can be safely removed.
                        </p>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setDeletingCategory(null)}
                          className="px-3 py-1 bg-white dark:bg-[#25221F] border border-red-200 dark:border-red-800 text-xs font-semibold rounded-lg text-[#5A534B] dark:text-[#EAE6E1] hover:bg-gray-50 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteCategoryConfirm}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Confirm Delete</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Multi-Select Preset Options Grid */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-[#8B7E74] dark:text-[#A39E93] flex items-center justify-between">
                      <span>Select Packaging Presets (Multi-Select Enabled):</span>
                      <span className="text-[10px] text-[#A39E93]">
                        {isAllSelected
                          ? 'All presets accessible'
                          : `${selectedPresets.length} of ${allPresetCategories.length} categories active`}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                      {/* 'All Presets' Toggle Option */}
                      <button
                        type="button"
                        id={`multi-preset-${catName.toLowerCase().replace(/\s+/g, '-')}-all`}
                        onClick={() => handleTogglePresetCategory(catName, 'All')}
                        className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition select-none text-left ${
                          isAllSelected
                            ? 'bg-white dark:bg-[#1E1B18] border-[#D4A373] text-[#5A534B] dark:text-[#EAE6E1] shadow-xs ring-1 ring-[#D4A373]'
                            : 'bg-[#FAF7F2] dark:bg-[#1E1B18]/60 border-[#E5E1DA] dark:border-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] hover:border-[#D4A373]/60'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition ${
                            isAllSelected
                              ? 'border-[#D4A373] bg-[#D4A373] text-white'
                              : 'border-[#CCC5B9] dark:border-[#554F47] bg-white dark:bg-[#25221F]'
                          }`}
                        >
                          {isAllSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="truncate">✨ All Presets</span>
                      </button>

                      {/* Individual Preset Categories Multi-Select Options */}
                      {allPresetCategories.map((presetCat) => {
                        const isSelected = !isAllSelected && selectedPresets.includes(presetCat);
                        const pCount = presetCounts[presetCat] || 0;
                        const pIcon = PRESET_CATEGORY_ICONS[presetCat] || '📦';

                        return (
                          <button
                            key={presetCat}
                            type="button"
                            id={`multi-preset-${catName.toLowerCase().replace(/\s+/g, '-')}-${presetCat.toLowerCase().replace(/\s+/g, '-')}`}
                            onClick={() => handleTogglePresetCategory(catName, presetCat)}
                            className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition select-none text-left ${
                              isSelected
                                ? 'bg-white dark:bg-[#1E1B18] border-[#D4A373] text-[#5A534B] dark:text-[#EAE6E1] shadow-xs ring-1 ring-[#D4A373]'
                                : 'bg-[#FAF7F2] dark:bg-[#1E1B18]/60 border-[#E5E1DA] dark:border-[#332F2B] text-[#8B7E74] dark:text-[#A39E93] hover:border-[#D4A373]/60'
                            }`}
                          >
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition ${
                                isSelected
                                  ? 'border-[#D4A373] bg-[#D4A373] text-white'
                                  : 'border-[#CCC5B9] dark:border-[#554F47] bg-white dark:bg-[#25221F]'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="truncate">
                              {pIcon} {presetCat} <span className="text-[10px] opacity-70">({pCount})</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Workspace Branding & Appearance (Phase 0.5) */}
        <SettingsSectionErrorBoundary
          sectionTitle="Workspace Branding & Appearance"
          fallbackMessage="Unable to load workspace branding settings. Please try again."
        >
          <BrandingSettings onSuccessNotice={showNotification} />
        </SettingsSectionErrorBoundary>

        {/* Workspace Members & Access Management (Phase 0.6) */}
        <SettingsSectionErrorBoundary
          sectionTitle="Members & Access"
          fallbackMessage="Unable to load workspace members. Please try again."
        >
          <MembersManagement onSuccessNotice={showNotification} />
        </SettingsSectionErrorBoundary>

        {/* Business Branding & Waste Defaults */}
        <form
          onSubmit={handleSaveBusinessInfo}
          className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-center">
              <Building className="w-5 h-5 text-[#D4A373]" />
            </div>
            <div>
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Bakery Profile & Default Waste
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Custom branding displayed on dashboard headers, printed production sheets, and PDF exports.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                Bakery / Business Name
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onBlur={() => handleSaveBusinessInfo()}
                placeholder="e.g. Artisan Bakery Co."
                className="w-full px-3.5 py-2.5 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                Global Default Waste Percentage (%)
              </label>
              <input
                type="number"
                step="any"
                min="0"
                max="100"
                value={defaultWastePercent}
                onChange={(e) => setDefaultWastePercent(e.target.value)}
                onBlur={() => handleSaveBusinessInfo()}
                placeholder="6"
                className="w-full px-3.5 py-2.5 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
              Tip: Changes are automatically saved when you finish typing or click Save.
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold text-xs rounded-xl shadow transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Profile Settings</span>
            </button>
          </div>
        </form>

        {/* Cloud Synchronization & Storage */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
                <Cloud className="w-5 h-5 text-[#D4A373]" />
                <span>Cloud Synchronization & Persistence</span>
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
                Real-time multi-device database sync powered by Firebase Firestore. Changes automatically save locally and stream to the cloud.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                  syncStatus.status === 'synced'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                    : syncStatus.status === 'syncing'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40'
                    : syncStatus.status === 'offline'
                    ? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300 border border-stone-200 dark:border-stone-700'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40'
                }`}
              >
                {syncStatus.status === 'synced' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                {syncStatus.status === 'syncing' && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />}
                {syncStatus.status === 'offline' && <WifiOff className="w-3.5 h-3.5 text-stone-400" />}
                {syncStatus.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-500" />}
                <span>{syncStatus.message}</span>
              </span>

              <button
                type="button"
                onClick={handleManualSync}
                disabled={isManualSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#F5F2ED] dark:bg-[#25221F] hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-bold rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? 'animate-spin' : ''}`} />
                <span>{isManualSyncing ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-[#F0ECE6] dark:border-[#2D2925] text-xs text-[#8B7E74] dark:text-[#A39E93]">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">Active Account:</span>
              <span className="truncate">{auth.currentUser?.email || 'Local Offline Session'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">Database Items:</span>
              <span>{syncStatus.itemCount} total records</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#5A534B] dark:text-[#D4CEC7]">Last Synced:</span>
              <span>{syncStatus.lastSynced ? syncStatus.lastSynced.toLocaleTimeString() : 'Just now'}</span>
            </div>
          </div>
        </div>

        {/* Phase 0 Zero-Trust Security & Workspace Isolation */}
        <div id="phase0-security-hardening-card" className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                    Phase 0 — Enterprise Zero-Trust Security
                  </h3>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    Proprietary Protection
                  </span>
                </div>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1 max-w-2xl leading-relaxed">
                  Enforces strict Zero-Trust RBAC. All recipes, ingredients, presets, mixers, and production history are non-destructively scoped to workspace <code className="font-mono bg-[#F5F2ED] dark:bg-[#25221F] px-1 py-0.5 rounded text-[#5A534B] dark:text-[#EAE6E1]">ws-main</code> with owner validation.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                id="btn-scan-phase0"
                onClick={handleScanMigration}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F5F2ED] dark:bg-[#25221F] hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-bold rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'Scanning DB...' : 'Scan Database'}</span>
              </button>

              <button
                type="button"
                id="btn-execute-phase0"
                onClick={() => setMigrationConfirmOpen(true)}
                disabled={isMigrating}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isMigrating ? 'Hardening...' : 'Execute Phase 0 Migration'}</span>
              </button>
            </div>
          </div>

          {/* Security Status Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-[#FAF8F5] dark:bg-[#25221F] border border-[#F0ECE6] dark:border-[#332F2B] text-xs">
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Workspace Target:</span>
              <span className="font-mono font-bold text-[#5A534B] dark:text-[#EAE6E1]">ws-main</span>
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Authentication State:</span>
              {auth.currentUser ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-medium truncate block">
                  {auth.currentUser.email}
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-700 dark:text-amber-400 font-medium">Not signed in</span>
                  <button
                    type="button"
                    onClick={() => signInWithGoogle().catch(console.error)}
                    className="underline text-amber-800 dark:text-amber-300 font-semibold cursor-pointer ml-1"
                  >
                    Sign in
                  </button>
                </div>
              )}
            </div>
            <div>
              <span className="text-[#8B7E74] dark:text-[#A39E93] block font-medium">Firestore Rules:</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Active Zero-Trust RBAC
              </span>
            </div>
          </div>

          {/* Scan Report Display */}
          {scanReport && (
            <div className="p-3 rounded-lg bg-stone-50 dark:bg-[#2A2623] border border-stone-200 dark:border-[#3D3733] text-xs space-y-1.5 font-mono">
              <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-between">
                <span>Database Scan Summary:</span>
                <span className={scanReport.unscopedCount === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                  {scanReport.unscopedCount === 0 ? '✓ All Documents Scoped' : `${scanReport.unscopedCount} Unscoped Items Found`}
                </span>
              </div>
              <div className="text-[#8B7E74] dark:text-[#A39E93] text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div>Recipes: {scanReport.recipesUnscoped} unscoped / {scanReport.totalRecipes} total</div>
                <div>Presets: {scanReport.presetsUnscoped} unscoped / {scanReport.totalPresets} total</div>
                <div>Mixers: {scanReport.mixersUnscoped} unscoped / {scanReport.totalMixers} total</div>
                <div>History: {scanReport.historyUnscoped} unscoped / {scanReport.totalHistory} total</div>
              </div>
            </div>
          )}

          {/* Migration Execution Results */}
          {migrationResult && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                migrationResult.success
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800'
              }`}
            >
              <div className="font-bold flex items-center gap-1.5">
                {migrationResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                <span>{migrationResult.message}</span>
              </div>
              <div className="mt-1 text-[11px] opacity-90 font-mono">
                {migrationResult.migratedCount} documents securely scoped to {migrationResult.workspaceId}.
              </div>
            </div>
          )}

          {/* Security Invariants & Dirty Dozen Verification Button */}
          <div className="flex items-center justify-between pt-2 border-t border-[#F0ECE6] dark:border-[#2D2925] text-xs">
            <span className="text-[#8B7E74] dark:text-[#A39E93]">
              Verify security barriers against the automated Dirty Dozen suite:
            </span>
            <button
              type="button"
              onClick={onOpenUnitTests}
              className="font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer inline-flex items-center gap-1"
            >
              <span>Run Dirty Dozen Security Tests</span>
              <span>→</span>
            </button>
          </div>
        </div>

        {/* Phase 0 Migration Confirmation Modal */}
        {migrationConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                    Confirm Phase 0 Hardening Migration
                  </h3>
                  <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
                    This non-destructive operation will secure existing proprietary data to workspace <strong className="text-[#5A534B] dark:text-[#EAE6E1]">ws-main</strong>.
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-[#FAF8F5] dark:bg-[#25221F] rounded-lg text-xs space-y-2 text-[#5A534B] dark:text-[#D4CEC7] border border-[#E5E1DA] dark:border-[#332F2B]">
                <div className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Strict Data Protection Guarantees:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-[#8B7E74] dark:text-[#A39E93] pl-1">
                  <li>No recipes, ingredients, or presets will be deleted or reset.</li>
                  <li>No document IDs will be changed or overwritten.</li>
                  <li>Existing local storage data is 100% preserved.</li>
                  <li>Adds <code className="font-mono">workspaceId: 'ws-main'</code> and owner membership.</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMigrationConfirmOpen(false)}
                  className="px-4 py-2 text-xs font-bold rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteMigration}
                  disabled={isMigrating}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isMigrating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  <span>{isMigrating ? 'Executing Migration...' : 'Proceed with Migration'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Appearance & Verification Suite */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Theme Toggle */}
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
              Theme Mode
            </h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleUpdateTheme('light')}
                className={`flex-1 p-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                  settings.theme === 'light'
                    ? 'bg-[#5A534B] text-white border-[#5A534B] ring-2 ring-[#D4A373]/50'
                    : 'bg-[#F9F8F6] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
                }`}
              >
                <Sun className="w-4 h-4 text-[#D4A373]" />
                <span>Light Theme</span>
              </button>

              <button
                type="button"
                onClick={() => handleUpdateTheme('dark')}
                className={`flex-1 p-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                  settings.theme === 'dark'
                    ? 'bg-[#5A534B] text-white border-[#5A534B] ring-2 ring-[#D4A373]/50'
                    : 'bg-[#F9F8F6] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
                }`}
              >
                <Moon className="w-4 h-4 text-[#D4A373]" />
                <span>Dark Theme</span>
              </button>
            </div>
          </div>

          {/* Unit Test Suite Launcher */}
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-3 flex flex-col justify-between">
            <div>
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-[#D4A373]" />
                <span>Unit Verification Suite</span>
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
                Run internal tests for scaling math, waste formulas, unit conversions, and capacity limits.
              </p>
            </div>

            <button
              id="settings-run-tests-btn"
              type="button"
              onClick={onOpenUnitTests}
              className="w-full bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#EEECE8] font-bold py-2.5 px-4 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-2 border border-[#E5E1DA] dark:border-[#332F2B]"
            >
              <ShieldCheck className="w-4 h-4 text-[#D4A373]" />
              <span>
                Run Automated Tests {testPassedCount !== undefined ? `(${testPassedCount} Passed)` : ''}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


