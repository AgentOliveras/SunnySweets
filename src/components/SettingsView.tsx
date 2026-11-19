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
  Lock,
  ChefHat,
} from 'lucide-react';
import { UserSettings, WeightUnit, Recipe, ProductionPreset, AccessRole } from '../types';
import { WEIGHT_UNITS, PRODUCTION_DISPLAY_MODES } from '../utils/units';
import { getTargetPresetCategoriesForRecipeCategory } from '../utils/categoryPresetMapping';
import { normalizePresetCategory } from '../utils/calculator';
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
import { SubscriptionSettings } from './SubscriptionSettings';
import { SettingsSectionErrorBoundary } from './SettingsSectionErrorBoundary';
import { ManagementLockSettings } from './ManagementLockSettings';
import { WorkspaceCapabilitiesSettings } from './WorkspaceCapabilitiesSettings';
import { Stage1MigrationCard } from './Stage1MigrationCard';
import { Stage2MigrationCard } from './Stage2MigrationCard';
import { CollapsibleSettingsSection } from './CollapsibleSettingsSection';
import { ProductionOptionOrderingSettings } from './ProductionOptionOrderingSettings';
import { CriticalNotesSyncReview } from './CriticalNotesSyncReview';

import { ManagementLockConfig } from '../utils/managementLock';

interface SettingsViewProps {
  settings: UserSettings;
  categoryPresetMap?: Record<string, string | string[]>;
  productionOptionOrder?: string[] | null;
  userRole?: AccessRole | null;
  recipesCount?: number;
  recipes?: Recipe[];
  presets?: ProductionPreset[];
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  onOpenUnitTests: () => void;
  testPassedCount?: number;
  onManagementLockConfigured?: (config: ManagementLockConfig) => void;
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
  categoryPresetMap,
  productionOptionOrder,
  userRole: userRoleProp,
  recipesCount = 0,
  recipes,
  presets,
  onUpdateSettings,
  onOpenUnitTests,
  testPassedCount,
  onManagementLockConfigured,
}) => {
  const [businessName, setBusinessName] = useState(settings?.businessName || 'Artisan Bakery Co.');
  const [defaultWastePercent, setDefaultWastePercent] = useState<string | number>(
    settings?.defaultWastePercent !== undefined ? settings.defaultWastePercent : 6
  );
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
    if (store.getUserRole() !== 'owner') {
      showNotification('Permission denied: Only workspace owners can scan or run Phase 0 migrations.');
      return;
    }
    setIsScanning(true);
    try {
      const rep = await scanForLegacyData();
      setScanReport(rep);
    } catch (err: any) {
      showNotification(err?.message || 'Database scan failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteMigration = async () => {
    if (store.getUserRole() !== 'owner') {
      setMigrationConfirmOpen(false);
      showNotification('Permission denied: Only workspace owners can execute Phase 0 migrations.');
      return;
    }
    setIsMigrating(true);
    try {
      const res = await executePhase0Migration();
      setMigrationResult(res);
      setMigrationConfirmOpen(false);
      const rep = await scanForLegacyData();
      setScanReport(rep);
    } catch (err: any) {
      showNotification(err?.message || 'Phase 0 migration failed.');
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
      set.add(normalizePresetCategory(p));
    });
    return Array.from(set);
  }, [allPresetsList]);

  // Count presets per preset category (normalized)
  const presetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allPresetsList.forEach((p) => {
      const cat = normalizePresetCategory(p);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [allPresetsList]);

  // Derive ONLY the categories that exist in the active workspace (from workspace recipes or workspace-managed categories)
  const allRecipeCategories = useMemo(() => {
    const set = new Set<string>();
    allRecipes.forEach((r) => {
      if (r.category && r.category.trim()) {
        set.add(r.category.trim());
      }
    });

    store.getRecipeCategories().forEach((c) => {
      if (c && c.trim()) set.add(c.trim());
    });

    return Array.from(set);
  }, [allRecipes, categoryPresetMap, syncStatus]);

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

  const isProductionFloorEnabled =
    settings?.productionFloorModeEnabled !== undefined
      ? settings.productionFloorModeEnabled !== false
      : store.isProductionFloorModeEnabled();

  const userRole = userRoleProp ?? store.getUserRole();
  const isOwnerRole = userRole === 'owner';
  const isViewerRole = userRole === 'viewer';

  const authoritativeCategoryPresetMap = useMemo(() => {
    return categoryPresetMap ?? store.getCategoryPresetMap();
  }, [categoryPresetMap, syncStatus]);

  const pendingCategoryMigration = useMemo(() => {
    if (!isOwnerRole) return null;
    return store.inspectPendingCategoryMappingMigration();
  }, [isOwnerRole, authoritativeCategoryPresetMap, settings?.categoryPresetMap, syncStatus]);

  const pendingProdOrderMigration = useMemo(() => {
    if (!isOwnerRole) return null;
    return store.inspectPendingProductionOrderMigration();
  }, [isOwnerRole, productionOptionOrder, settings?.productionOptionOrder, allPresetsList, syncStatus]);

  const [isApplyingCategoryMigration, setIsApplyingCategoryMigration] = useState(false);

  const handleToggleProductionFloor = async (enabled: boolean) => {
    if (!isOwnerRole) {
      showNotification('Permission denied: Only workspace owners can enable or disable Production Floor Mode.');
      return;
    }
    try {
      await store.setProductionFloorModeEnabled(enabled);
      showNotification(
        enabled ? 'Production Floor Mode enabled' : 'Production Floor Mode disabled'
      );
    } catch (err: any) {
      showNotification(err?.message || 'Failed to update Production Floor setting');
    }
  };

  // Collapsible Settings Accordion State (Phase 2B.1: ALL sections default to collapsed)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    production_ordering: false,
    measurement: false,
    precision: false,
    categories: false,
    production_floor: false,
    branding: false,
    members: false,
    subscription: false,
    profile: false,
    cloud: false,
    security: false,
    migrations: false,
    capabilities: false,
    lock: false,
    system: false,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleExpandAll = () => {
    setOpenSections({
      production_ordering: true,
      measurement: true,
      precision: true,
      categories: true,
      production_floor: true,
      branding: true,
      members: true,
      subscription: true,
      profile: true,
      cloud: true,
      security: true,
      migrations: true,
      capabilities: true,
      lock: true,
      system: true,
    });
  };

  const handleCollapseAll = () => {
    setOpenSections({
      production_ordering: false,
      measurement: false,
      precision: false,
      categories: false,
      production_floor: false,
      branding: false,
      members: false,
      subscription: false,
      profile: false,
      cloud: false,
      security: false,
      migrations: false,
      capabilities: false,
      lock: false,
      system: false,
    });
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

  // Multi-preset category helper (unified with Production Floor Mode — never auto-falls back to 'All' for unmapped categories)
  const getSelectedPresetCategories = (recipeCat: string): string[] => {
    return getTargetPresetCategoriesForRecipeCategory(recipeCat, authoritativeCategoryPresetMap);
  };

  // Explicit Owner-approved migration handlers (never automatic)
  const handleApproveCategoryMigration = async () => {
    if (!isOwnerRole) {
      showNotification('Permission denied: Only workspace owners can approve shared category preset mappings.');
      return;
    }
    setIsApplyingCategoryMigration(true);
    try {
      await store.approveCategoryMappingMigration();
      showNotification('Approved category preset mappings saved to shared workspace.');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to save workspace category preset mappings.');
    } finally {
      setIsApplyingCategoryMigration(false);
    }
  };

  const handleDiscardLocalCategoryDifferences = () => {
    store.discardLocalCategoryMappingDifferences();
    showNotification('Local mapping differences discarded; keeping current shared workspace mapping.');
  };

  // Multi-preset category toggle (Owner-authorized workspace operation)
  const handleTogglePresetCategory = async (recipeCat: string, presetCat: string) => {
    if (!isOwnerRole) {
      showNotification('Permission denied: Only workspace owners can modify shared workspace category mappings.');
      return;
    }
    const currentSelected = getSelectedPresetCategories(recipeCat).filter((c) =>
      c === 'All' || allPresetCategories.some((pc) => pc.toLowerCase() === c.toLowerCase())
    );
    let updated: string[] = [];

    if (presetCat === 'All') {
      updated = ['All'];
    } else {
      if (currentSelected.includes('All')) {
        updated = [presetCat];
      } else {
        if (currentSelected.some((c) => c.toLowerCase() === presetCat.toLowerCase())) {
          const remaining = currentSelected.filter((c) => c.toLowerCase() !== presetCat.toLowerCase());
          updated = remaining.length === 0 ? [recipeCat] : remaining;
        } else {
          updated = [...currentSelected, presetCat];
        }
      }
    }

    const currentMap = { ...authoritativeCategoryPresetMap };
    currentMap[recipeCat] = updated;
    try {
      await store.saveWorkspaceCategoryPresetMap(currentMap);
      showNotification(
        updated.includes('All')
          ? `Workspace category "${recipeCat}" set to All Presets.`
          : `Workspace category "${recipeCat}" mapped to ${updated.join(', ')}.`
      );
    } catch (err: any) {
      showNotification(err?.message || 'Failed to update shared workspace category mapping.');
    }
  };

  // Add Category Handler
  const handleAddCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerRole) {
      showNotification('Permission denied: Only workspace owners can add workspace categories.');
      return;
    }
    const cleanName = newCategoryName.trim();
    if (!cleanName) return;

    if (allRecipeCategories.some((c) => c.toLowerCase() === cleanName.toLowerCase())) {
      showNotification(`Category "${cleanName}" already exists.`);
      return;
    }

    try {
      await store.addRecipeCategory(cleanName, newCategoryPresets.length > 0 ? newCategoryPresets : ['All']);
      setNewCategoryName('');
      setNewCategoryPresets(['All']);
      setIsAddingCategory(false);
      showNotification(`Category "${cleanName}" created in shared workspace.`);
    } catch (err: any) {
      showNotification(err?.message || 'Failed to add category.');
    }
  };

  // Rename Category Handler
  const handleStartEditingCategory = (catName: string) => {
    if (!isOwnerRole) return;
    setEditingCategory(catName);
    setEditingCategoryNewName(catName);
    setDeletingCategory(null);
  };

  const handleRenameCategorySubmit = async (oldName: string) => {
    if (!isOwnerRole) return;
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

    try {
      const updatedCount = await store.renameRecipeCategory(oldName, cleanNew);
      setEditingCategory(null);
      setEditingCategoryNewName('');
      showNotification(
        updatedCount > 0
          ? `Renamed category to "${cleanNew}" and updated ${updatedCount} ${updatedCount === 1 ? 'recipe' : 'recipes'}.`
          : `Renamed category to "${cleanNew}".`
      );
    } catch (err: any) {
      showNotification(err?.message || 'Failed to rename category.');
    }
  };

  // Delete Category Handler
  const handleStartDeletingCategory = (catName: string) => {
    if (!isOwnerRole) return;
    setDeletingCategory(catName);
    setEditingCategory(null);
    const otherCats = allRecipeCategories.filter((c) => c.toLowerCase() !== catName.toLowerCase());
    setDeleteReassignTarget(otherCats[0] || 'Uncategorized');
  };

  const handleDeleteCategoryConfirm = async () => {
    if (!deletingCategory || !isOwnerRole) return;
    const catToDelete = deletingCategory;
    const targetReassign = deleteReassignTarget || 'Uncategorized';
    try {
      const updatedCount = await store.deleteRecipeCategory(catToDelete, targetReassign);
      setDeletingCategory(null);
      showNotification(
        updatedCount > 0
          ? `Deleted category "${catToDelete}". ${updatedCount} ${updatedCount === 1 ? 'recipe' : 'recipes'} moved to "${targetReassign}".`
          : `Deleted category "${catToDelete}".`
      );
    } catch (err: any) {
      showNotification(err?.message || 'Failed to delete category.');
    }
  };

  const handleAutoMatchCategories = async () => {
    if (!isOwnerRole) {
      showNotification('Permission denied: Only workspace owners can modify shared workspace category mappings.');
      return;
    }
    const newMap: Record<string, string | string[]> = { ...authoritativeCategoryPresetMap };
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
      }
    });
    try {
      await store.saveWorkspaceCategoryPresetMap(newMap);
      showNotification('Recipe categories matched with corresponding packaging presets in shared workspace.');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to update shared workspace category mappings.');
    }
  };

  const handleResetAllToAllPresets = async () => {
    if (!isOwnerRole) {
      showNotification('Permission denied: Only workspace owners can modify shared workspace category mappings.');
      return;
    }
    const newMap: Record<string, string[]> = {};
    allRecipeCategories.forEach((cat) => {
      newMap[cat] = ['All'];
    });
    try {
      await store.saveWorkspaceCategoryPresetMap(newMap);
      showNotification('All recipe categories set to show All Presets in shared workspace.');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to update shared workspace category mappings.');
    }
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
            Configure production workflows, measurement systems, categories, cloud sync, and security. Tap any section to expand or collapse.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            id="btn-settings-expand-all"
            onClick={handleExpandAll}
            className="px-3 py-1.5 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-bold hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] transition cursor-pointer"
          >
            Expand All
          </button>
          <button
            type="button"
            id="btn-settings-collapse-all"
            onClick={handleCollapseAll}
            className="px-3 py-1.5 rounded-lg border border-[#E5E1DA] dark:border-[#332F2B] bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-bold hover:bg-[#EEECE8] dark:hover:bg-[#332F2B] transition cursor-pointer"
          >
            Collapse All
          </button>

          {saveFeedback && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#E8F5E9] dark:bg-[#1B3520] border border-[#A5D6A7] dark:border-[#2E7D32] rounded-xl text-xs font-bold text-[#2E7D32] dark:text-[#81C784] shadow-sm animate-fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{saveFeedback}</span>
            </div>
          )}
        </div>
      </div>

      {/* Owner-Only Critical Production Notes Synchronization Review */}
      <CriticalNotesSyncReview
        userRole={userRole}
        presets={presets}
        recipes={recipes}
      />

      {/* Owner-Only Saved Device Production Order Notice (when section is collapsed) */}
      {isOwnerRole && pendingProdOrderMigration?.hasDifferences && !openSections.production_ordering && (
        <div
          id="settings-legacy-prod-order-alert"
          className="p-4 rounded-2xl border-2 border-[#D4A373] bg-[#FAF6F0] dark:bg-[#26211C] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="space-y-0.5">
            <h3 className="text-xs sm:text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1]">
              Saved Device Production Option Order Detected
            </h3>
            <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
              Your Owner account/device has a saved production option order that differs from the shared workspace order. Review and promote it so all tablets match.
            </p>
          </div>
          <button
            id="btn-open-legacy-prod-order-review"
            type="button"
            onClick={() =>
              setOpenSections((prev) => ({ ...prev, production_ordering: true }))
            }
            className="px-3.5 py-2 rounded-xl bg-[#D4A373] hover:bg-[#C29363] text-white text-xs font-bold shrink-0 cursor-pointer transition"
          >
            Review &amp; Promote Order
          </button>
        </div>
      )}

      <div className="space-y-4">
        {/* Section 1: Production Option Ordering Settings */}
        <CollapsibleSettingsSection
          sectionKey="production_ordering"
          title="Production Option Display Order"
          description="Configure the exact sequence of quantity cards shown on the production floor screen."
          icon={<SlidersHorizontal className="w-5 h-5 text-[#D4A373]" />}
          badge={
            isOwnerRole && pendingProdOrderMigration?.hasDifferences ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                Action Available
              </span>
            ) : undefined
          }
          isOpen={!!openSections.production_ordering}
          onToggle={() => toggleSection('production_ordering')}
        >
          <ProductionOptionOrderingSettings
            presets={presets || []}
            productionOptionOrder={productionOptionOrder}
            userRole={userRole}
            onNotification={showNotification}
          />
        </CollapsibleSettingsSection>

        {/* Section 2: Default Measurement System Selector */}
        <CollapsibleSettingsSection
          sectionKey="measurement"
          title="Default Measurement System"
          description="Primary weight unit used across total recipe weights, batch calculations, and production sheets."
          icon={<Scale className="w-5 h-5 text-[#D4A373]" />}
          badge={
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]">
              {(settings?.defaultWeightUnit || 'g').toUpperCase()}
            </span>
          }
          isOpen={!!openSections.measurement}
          onToggle={() => toggleSection('measurement')}
        >
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
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

            {/* Default Production Display Mode (Phase 2B.5.5) */}
            <div className="pt-3 border-t border-[#EEECE8] dark:border-[#332F2B] space-y-2">
              <div>
                <h4 className="font-bold text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                  Default Production Display Mode
                </h4>
                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  Authoritative presentation mode for scaling on the production floor. &quot;As Entered&quot; preserves each recipe line&apos;s original entry unit.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                {PRODUCTION_DISPLAY_MODES.map((mode) => {
                  const isActive = (settings.defaultProductionDisplayMode || 'as_entered') === mode.value;
                  return (
                    <button
                      key={mode.value}
                      id={`settings-display-mode-${mode.value}`}
                      type="button"
                      onClick={() => onUpdateSettings({ defaultProductionDisplayMode: mode.value })}
                      className={`p-3 rounded-xl border text-center font-bold text-xs transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                        isActive
                          ? 'bg-[#5A534B] text-white border-[#5A534B] dark:bg-[#3D3732] shadow-sm ring-2 ring-[#D4A373]/50'
                          : 'bg-[#F9F8F6] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373]'
                      }`}
                    >
                      <div>{mode.label}</div>
                      {isActive && (
                        <span className="text-[9px] text-[#D4A373] font-semibold uppercase tracking-wider flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5 inline" /> Active Default
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CollapsibleSettingsSection>

        {/* Section 3: Decimal Precision & Rounding Selector */}
        <CollapsibleSettingsSection
          sectionKey="precision"
          title="Decimal Precision & Rounding"
          description="Set how many decimal points to display across ingredient amounts, batch weights, and reports."
          icon={<Hash className="w-5 h-5 text-[#D4A373]" />}
          badge={
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]">
              {settings.decimalPlaces !== undefined ? `${settings.decimalPlaces} Decimals` : '2 Decimals'}
            </span>
          }
          isOpen={!!openSections.precision}
          onToggle={() => toggleSection('precision')}
        >
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
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
        </CollapsibleSettingsSection>

        {/* Section 4: Recipe Categories & Preset Routing (Multi-Select & Management) */}
        <CollapsibleSettingsSection
          sectionKey="categories"
          title="Recipe Categories & Preset Routing"
          description="Add, edit, or delete recipe categories, and choose which packaging presets route to each category."
          icon={<Sliders className="w-5 h-5 text-[#D4A373]" />}
          badge={
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]">
              {allRecipeCategories.length} Categories
            </span>
          }
          isOpen={!!openSections.categories}
          onToggle={() => toggleSection('categories')}
        >
          <div className="space-y-5 pt-1">
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

            {/* Section Actions (Owner-only for shared workspace configuration) */}
            {isOwnerRole ? (
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
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF7F2] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[11px] font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                <Lock className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Shared Workspace Routing (Owner Managed)</span>
              </div>
            )}
          </div>

          {/* Explicit Owner Approval Banner when local device mappings differ from shared workspace mappings */}
          {isOwnerRole && pendingCategoryMigration?.hasDifferences && (
            <div
              id="category-mapping-migration-review-card"
              className="p-4 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/70 space-y-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-xs font-bold text-amber-950 dark:text-amber-200">
                    Local Device Category Mapping Differences Detected — Explicit Owner Approval Required
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
                    This device has locally saved category-to-preset mappings that differ from the shared workspace configuration. Review the exact changes below before deciding whether to apply them across all workspace devices.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-white dark:bg-[#1E1B18] divide-y divide-[#EEECE8] dark:divide-[#2D2925]">
                {pendingCategoryMigration.diffs.map((diff) => (
                  <div
                    key={diff.category}
                    className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs"
                  >
                    <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                      {diff.category}
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-300">
                        Workspace: {diff.workspaceExplicitValue ? diff.workspaceEffectiveTargets.join(', ') : `Unmapped (${diff.workspaceEffectiveTargets.join(', ')})`}
                      </span>
                      <span className="text-[#8B7E74]">→</span>
                      <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 font-bold">
                        Proposed: {diff.localProposedTargets.join(', ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  id="approve-category-mapping-migration-btn"
                  disabled={isApplyingCategoryMigration}
                  onClick={handleApproveCategoryMigration}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {isApplyingCategoryMigration
                      ? 'Saving to Workspace...'
                      : 'Approve & Save Exact Changes to Shared Workspace'}
                  </span>
                </button>
                <button
                  type="button"
                  id="discard-local-category-mapping-btn"
                  disabled={isApplyingCategoryMigration}
                  onClick={handleDiscardLocalCategoryDifferences}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#25221F] border border-amber-300 dark:border-amber-800 text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] hover:bg-stone-50 cursor-pointer disabled:opacity-50"
                >
                  Keep Shared Workspace Mapping (Discard Local)
                </button>
              </div>
            </div>
          )}

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
              {isOwnerRole && (
                <button
                  type="button"
                  onClick={() => setIsAddingCategory(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#D4A373] text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Your First Category</span>
                </button>
              )}
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

                          {/* Edit & Delete Category Action Icons (Owner-only) */}
                          {isOwnerRole && (
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
                          )}
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
                        disabled={!isOwnerRole}
                        onClick={() => handleTogglePresetCategory(catName, 'All')}
                        className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition select-none text-left ${
                          !isOwnerRole ? 'opacity-70 cursor-not-allowed ' : 'cursor-pointer '
                        }${
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
                        const isSelected =
                          !isAllSelected &&
                          selectedPresets.some((sp) => sp.toLowerCase() === presetCat.toLowerCase());
                        const pCount = presetCounts[presetCat] || 0;
                        const pIcon = PRESET_CATEGORY_ICONS[presetCat] || '📦';

                        return (
                          <button
                            key={presetCat}
                            type="button"
                            id={`multi-preset-${catName.toLowerCase().replace(/\s+/g, '-')}-${presetCat.toLowerCase().replace(/\s+/g, '-')}`}
                            disabled={!isOwnerRole}
                            onClick={() => handleTogglePresetCategory(catName, presetCat)}
                            className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition select-none text-left ${
                              !isOwnerRole ? 'opacity-70 cursor-not-allowed ' : 'cursor-pointer '
                            }${
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
        </CollapsibleSettingsSection>

        {/* Section 6: Workspace Branding & Appearance (Phase 0.5) */}
        <CollapsibleSettingsSection
          sectionKey="branding"
          title="Workspace Branding & Appearance"
          description="Manage bakery theme palette, display name, and visual workspace identity."
          icon={<Sparkles className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.branding}
          onToggle={() => toggleSection('branding')}
        >
          <SettingsSectionErrorBoundary
            sectionTitle="Workspace Branding & Appearance"
            fallbackMessage="Unable to load workspace branding settings. Please try again."
          >
            <BrandingSettings onSuccessNotice={showNotification} />
          </SettingsSectionErrorBoundary>
        </CollapsibleSettingsSection>

        {/* Section 7: Workspace Members & Access Management (Phase 0.6) */}
        <CollapsibleSettingsSection
          sectionKey="members"
          title="Members & Access Management"
          description="Control team access, roles (Owner, Editor, Viewer), and invite collaborators."
          icon={<User className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.members}
          onToggle={() => toggleSection('members')}
        >
          <SettingsSectionErrorBoundary
            sectionTitle="Members & Access"
            fallbackMessage="Unable to load workspace members. Please try again."
          >
            <MembersManagement onSuccessNotice={showNotification} />
          </SettingsSectionErrorBoundary>
        </CollapsibleSettingsSection>

        {/* Section 8: Workspace Subscription & Plan Entitlements (Phase 1.0) */}
        <CollapsibleSettingsSection
          sectionKey="subscription"
          title="Subscription & Entitlements"
          description="Current workspace subscription tier, recipe limits, and plan features."
          icon={<Tag className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.subscription}
          onToggle={() => toggleSection('subscription')}
        >
          <SettingsSectionErrorBoundary
            sectionTitle="Subscription & Entitlements"
            fallbackMessage="Unable to load subscription details. Please try again."
          >
            <SubscriptionSettings onSuccessNotice={showNotification} />
          </SettingsSectionErrorBoundary>
        </CollapsibleSettingsSection>

        {/* Section 9: Business Branding & Waste Defaults */}
        <CollapsibleSettingsSection
          sectionKey="profile"
          title="Bakery Profile & Default Waste"
          description="Custom branding displayed on dashboard headers, printed production sheets, and PDF exports."
          icon={<Building className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.profile}
          onToggle={() => toggleSection('profile')}
        >
        <form
          onSubmit={handleSaveBusinessInfo}
          className="space-y-4 pt-1"
        >

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
        </CollapsibleSettingsSection>

        {/* Section 10: Cloud Synchronization & Storage */}
        <CollapsibleSettingsSection
          sectionKey="cloud"
          title="Cloud Synchronization & Persistence"
          description="Real-time multi-device database sync powered by Firebase Firestore."
          icon={<Cloud className="w-5 h-5 text-[#D4A373]" />}
          badge={
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
              {syncStatus.status.toUpperCase()}
            </span>
          }
          isOpen={!!openSections.cloud}
          onToggle={() => toggleSection('cloud')}
        >
          <div className="space-y-4 pt-1">
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
        </CollapsibleSettingsSection>

        {/* Section 11: Phase 0 Zero-Trust Security & Workspace Isolation */}
        <CollapsibleSettingsSection
          id="phase0-security-hardening-card"
          sectionKey="security"
          title="Phase 0 — Enterprise Zero-Trust Security"
          description="Enforces strict Zero-Trust RBAC. All recipes, ingredients, presets, and mixers are non-destructively scoped to workspace ws-main with owner validation."
          icon={<ShieldCheck className="w-5 h-5 text-amber-600" />}
          badge={
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              Proprietary Protection
            </span>
          }
          isOpen={!!openSections.security}
          onToggle={() => toggleSection('security')}
        >
          <div className="space-y-4 pt-1">
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

            {isOwnerRole ? (
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
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-400 text-xs font-bold shrink-0">
                <Lock className="w-3.5 h-3.5" />
                <span>Owner-Only Security Utility</span>
              </span>
            )}
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
                <span className={scanReport.totalUnscopedCount === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                  {scanReport.totalUnscopedCount === 0 ? '✓ All Documents Scoped' : `${scanReport.totalUnscopedCount} Unscoped Items Found`}
                </span>
              </div>
              <div className="text-[#8B7E74] dark:text-[#A39E93] text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div>Recipes: {scanReport.unscopedRecipesCount} unscoped</div>
                <div>Presets: {scanReport.unscopedPresetsCount} unscoped</div>
                <div>Mixers: {scanReport.unscopedMixersCount} unscoped</div>
                <div>History: {scanReport.unscopedHistoryCount} unscoped</div>
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
                {Object.values(migrationResult.migratedCounts || {}).reduce((a, b) => a + b, 0)} documents securely scoped to workspace.
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
        </CollapsibleSettingsSection>

        {/* Phase 0 Migration Confirmation Modal */}
        {isOwnerRole && migrationConfirmOpen && (
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

        {/* Section 12: Master Ingredient Linking Migrations (Stages 1 & 2) */}
        <CollapsibleSettingsSection
          sectionKey="migrations"
          title="Master Ingredient Linking Migrations (Closed & Locked)"
          description="Phase 2A Stage 1 (Deterministic) and Stage 2 (Ambiguity) Master Ingredient Linking utilities."
          icon={<Lock className="w-5 h-5 text-emerald-600" />}
          badge={
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              Closed & Locked
            </span>
          }
          isOpen={!!openSections.migrations}
          onToggle={() => toggleSection('migrations')}
        >
          <div className="space-y-4 pt-1">
            <Stage1MigrationCard onNotification={showNotification} />
            <Stage2MigrationCard onNotification={showNotification} />
          </div>
        </CollapsibleSettingsSection>

        {/* Section 13: Workspace Capabilities & Modular Features (Phase 2 Foundation) */}
        <CollapsibleSettingsSection
          sectionKey="capabilities"
          title="Workspace Capabilities & Modular Features"
          description="Enable or disable modular features (Production Floor, Costing & Margins, Inventory, Label Printing)."
          icon={<Sparkles className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.capabilities}
          onToggle={() => toggleSection('capabilities')}
        >
          <SettingsSectionErrorBoundary
            sectionTitle="Workspace Capabilities"
            fallbackMessage="Unable to load workspace capabilities."
          >
            <WorkspaceCapabilitiesSettings onNotification={showNotification} />
          </SettingsSectionErrorBoundary>
        </CollapsibleSettingsSection>

        {/* Section 5: Production Floor Mode Operational Workspace Setting */}
        <CollapsibleSettingsSection
          id="settings-production-floor-section"
          sectionKey="production_floor"
          title="Production Floor Mode"
          description="When enabled, operators can use the simplified Production Floor interface for recipe scaling and mixing."
          icon={<ChefHat className="w-5 h-5 stroke-[2.5]" />}
          badge={
            <span
              id="production-floor-status-badge"
              className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                isProductionFloorEnabled
                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 border border-stone-200 dark:border-zinc-700'
              }`}
            >
              {isProductionFloorEnabled ? 'Enabled' : 'Disabled'}
            </span>
          }
          isOpen={!!openSections.production_floor}
          onToggle={() => toggleSection('production_floor')}
        >
          <div className="pt-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                  <ChefHat className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                      Production Floor Mode
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                        isProductionFloorEnabled
                          ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                          : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 border border-stone-200 dark:border-zinc-700'
                      }`}
                    >
                      {isProductionFloorEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1 max-w-xl leading-relaxed">
                    When enabled, operators can use the simplified Production Floor interface for recipe scaling and mixing. When disabled, the application opens directly into Management Mode.
                  </p>
                </div>
              </div>

              {/* Toggle Switch and [ ON / OFF ] controls (Owner Only) */}
              <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                {!isOwnerRole && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider">
                    <Lock className="w-3 h-3" />
                    <span>Owner Only</span>
                  </span>
                )}
                <div className="flex items-center bg-[#F9F8F6] dark:bg-[#25221F] p-1 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
                  <button
                    type="button"
                    id="production-floor-mode-on-btn"
                    disabled={!isOwnerRole}
                    onClick={() => handleToggleProductionFloor(true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      isProductionFloorEnabled
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1]'
                    } ${!isOwnerRole ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span>ON</span>
                  </button>
                  <button
                    type="button"
                    id="production-floor-mode-off-btn"
                    disabled={!isOwnerRole}
                    onClick={() => handleToggleProductionFloor(false)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      !isProductionFloorEnabled
                        ? 'bg-[#5A534B] dark:bg-[#3D3732] text-white shadow-xs'
                        : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1]'
                    } ${!isOwnerRole ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span>OFF</span>
                  </button>
                </div>

                <button
                  type="button"
                  id="production-floor-mode-toggle"
                  role="switch"
                  aria-checked={isProductionFloorEnabled}
                  aria-label="Toggle Production Floor Mode"
                  disabled={!isOwnerRole}
                  onClick={() => handleToggleProductionFloor(!isProductionFloorEnabled)}
                  className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 cursor-pointer ${
                    isProductionFloorEnabled
                      ? 'bg-amber-500 ring-2 ring-amber-500/20'
                      : 'bg-stone-300 dark:bg-zinc-700'
                  } ${!isOwnerRole ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div
                    className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                      isProductionFloorEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </CollapsibleSettingsSection>

        {/* Section 14: Optional Management Mode PIN Lock */}
        <CollapsibleSettingsSection
          sectionKey="lock"
          title="Management Mode Lock"
          description="Require a secure PIN to access recipe formulas, costing, ingredients, and settings."
          icon={<Lock className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.lock}
          onToggle={() => toggleSection('lock')}
        >
          <SettingsSectionErrorBoundary
            sectionTitle="Management Mode Lock"
            fallbackMessage="Unable to load management lock settings."
          >
            <ManagementLockSettings
              userRole={userRole}
              onNotification={showNotification}
              onLockConfigured={onManagementLockConfigured}
            />
          </SettingsSectionErrorBoundary>
        </CollapsibleSettingsSection>

        {/* Section 15: Appearance & Verification Suite */}
        <CollapsibleSettingsSection
          sectionKey="system"
          title="Appearance & Unit Verification Suite"
          description="Theme mode selector and internal unit verification testing suite."
          icon={<Sun className="w-5 h-5 text-[#D4A373]" />}
          isOpen={!!openSections.system}
          onToggle={() => toggleSection('system')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Theme Toggle */}
            <div className="bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl p-4 sm:p-5 space-y-3">
              <h4 className="font-serif font-semibold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                Theme Mode
              </h4>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleUpdateTheme('light')}
                  className={`flex-1 p-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                    settings.theme === 'light'
                      ? 'bg-[#5A534B] text-white border-[#5A534B] ring-2 ring-[#D4A373]/50'
                      : 'bg-[#F9F8F6] dark:bg-[#1E1B18] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
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
                      : 'bg-[#F9F8F6] dark:bg-[#1E1B18] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1]'
                  }`}
                >
                  <Moon className="w-4 h-4 text-[#D4A373]" />
                  <span>Dark Theme</span>
                </button>
              </div>
            </div>

            {/* Unit Test Suite Launcher */}
            <div className="bg-[#FAF8F5] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl p-4 sm:p-5 space-y-3 flex flex-col justify-between">
              <div>
                <h4 className="font-serif font-semibold text-sm text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[#D4A373]" />
                  <span>Unit Verification Suite</span>
                </h4>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1">
                  Run internal tests for scaling math, waste formulas, unit conversions, and capacity limits.
                </p>
              </div>

              <button
                id="settings-run-tests-btn"
                type="button"
                onClick={onOpenUnitTests}
                className="w-full bg-[#F5F2ED] dark:bg-[#1E1B18] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#EEECE8] font-bold py-2.5 px-4 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-2 border border-[#E5E1DA] dark:border-[#332F2B]"
              >
                <ShieldCheck className="w-4 h-4 text-[#D4A373]" />
                <span>
                  Run Automated Tests {testPassedCount !== undefined ? `(${testPassedCount} Passed)` : ''}
                </span>
              </button>
            </div>
          </div>
        </CollapsibleSettingsSection>
      </div>
    </div>
  );
};


