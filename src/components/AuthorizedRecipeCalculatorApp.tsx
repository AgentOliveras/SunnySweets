import React, { useState, useEffect, useRef } from 'react';
import { Navbar, TabType } from './Navbar';
import { Dashboard } from './Dashboard';
import { RecipeManager } from './RecipeManager';
import { IngredientPantry } from './IngredientPantry';
import { PresetManager } from './PresetManager';
import { MixerManager } from './MixerManager';
import { ProductionCalculator } from './ProductionCalculator';
import { GuidedMixingMode } from './GuidedMixingMode';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';
import { CostingCompletionView } from './CostingCompletionView';
import { UnitTestModal } from './UnitTestModal';
import { ProductionModeView } from './ProductionModeView';
import { ManagementLockModal } from './ManagementLockModal';
import {
  APP_MODE_STORAGE_KEY,
  EffectiveManagementLockResolution,
  ManagementAutoLockController,
  ManagementLockConfig,
  PendingManagementNavigationTarget,
  buildManagementUnlockSessionKey,
  sanitizeRestoredAppMode,
} from '../utils/managementLock';
import { ProductQuotingView } from './quoting/ProductQuotingView';
import { store } from '../services/store';
import { auth, logoutUser } from '../services/firebase';
import { Sun, Moon, LogOut, Lock, ArrowLeft, ChefHat } from 'lucide-react';
import {
  AccessRole,
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionHistoryEntry,
  UserSettings,
  CalculationResult,
  MasterIngredient,
  Workspace,
  WeightUnit,
} from '../types';
import { runUnitTests } from '../utils/calculator.test';
import { calculateProduction } from '../utils/calculator';
import { parseRoute, navigateToRoute } from '../utils/navigation';

export const AuthorizedRecipeCalculatorApp: React.FC = () => {
  const [activeTab, setActiveTabState] = useState<TabType>(() => {
    if (typeof window !== 'undefined') {
      const isSettings =
        window.location.pathname.startsWith('/settings') ||
        new URLSearchParams(window.location.search).get('checkout') === 'cancelled';
      if (isSettings) return 'settings';
      const parsed = parseRoute();
      if (parsed.tab) return parsed.tab;
    }
    return 'dashboard';
  });

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    navigateToRoute(tab);
  };

  // Store States
  const [recipes, setRecipes] = useState<Recipe[]>(store.getRecipes());
  const [masterIngredients, setMasterIngredients] = useState<MasterIngredient[]>(store.getMasterIngredients());
  const [presets, setPresets] = useState<ProductionPreset[]>(store.getPresets());
  const [mixers, setMixers] = useState<Mixer[]>(store.getMixers());
  const [history, setHistory] = useState<ProductionHistoryEntry[]>(store.getHistory());
  const [settings, setSettings] = useState<UserSettings>(store.getSettings());
  const [activeChecklist, setActiveChecklist] = useState<any>(store.getActiveChecklist());
  const [workspaces, setWorkspaces] = useState<Workspace[]>(store.getWorkspaces());
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(store.getActiveWorkspace());
  const [categoryPresetMap, setCategoryPresetMap] = useState<Record<string, string | string[]>>(() =>
    store.getCategoryPresetMap()
  );
  const [productionOptionOrder, setProductionOptionOrder] = useState<string[] | null>(() =>
    store.getProductionOptionOrder()
  );
  const [features, setFeatures] = useState(() => store.getWorkspaceFeatures());
  const [recipesHydrationState, setRecipesHydrationState] = useState(() =>
    store.getRecipesHydrationState()
  );
  const [presetsHydrationState, setPresetsHydrationState] = useState(() =>
    store.getPresetsHydrationState()
  );
  const [criticalNotesSyncError, setCriticalNotesSyncError] = useState(() =>
    store.getCriticalNotesSyncError()
  );
  const [connectionVerified, setConnectionVerified] = useState(() =>
    store.isSafetyConnectionVerified()
  );
  const [isReconnecting, setIsReconnecting] = useState(() =>
    store.isSafetyReconnectingState()
  );
  const [lockResolution, setLockResolution] = useState<EffectiveManagementLockResolution>(() =>
    store.getEffectiveManagementLockResolution()
  );
  const [userRole, setUserRole] = useState<AccessRole | null>(() => store.getUserRole());
  const [securityEpoch, setSecurityEpoch] = useState<number>(() =>
    store.getMembershipSecurityEpoch()
  );

  // Authoritative Production Floor Mode status
  const isProductionFloorEnabled = store.isProductionFloorModeEnabled();
  const activeWorkspaceId = store.getActiveWorkspaceId();

  // App Mode: 'main' (default launcher) vs 'production' (minimalist tablet floor mode) vs 'management' (full admin tools)
  // Sanitized on mount so persisted SS_APP_MODE='management' NEVER bypasses an active PIN guard.
  const [appMode, setAppMode] = useState<'main' | 'production' | 'management'>(() => {
    const initialFloorEnabled = store.isProductionFloorModeEnabled();
    const initialLock = store.getEffectiveManagementLockResolution();
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(APP_MODE_STORAGE_KEY);
      const sanitized = sanitizeRestoredAppMode(saved, {
        isProductionFloorEnabled: initialFloorEnabled,
        isLockActive: initialLock.isLockActive,
      });
      if (initialFloorEnabled && initialLock.isLockActive && (saved === 'management' || saved === 'full')) {
        localStorage.setItem(APP_MODE_STORAGE_KEY, 'main');
      }
      return sanitized;
    }
    return initialFloorEnabled ? 'main' : 'management';
  });

  // Navigation / Modal triggers
  const [selectedRecipeForCalcId, setSelectedRecipeForCalcId] = useState<string | undefined>(undefined);
  const [activeGuidedMixingCalc, setActiveGuidedMixingCalc] = useState<CalculationResult | null>(null);
  const [showUnitTestModal, setShowUnitTestModal] = useState(false);
  const [testPassedCount, setTestPassedCount] = useState<number | undefined>(undefined);
  const [openRecipeModalDirectly, setOpenRecipeModalDirectly] = useState(false);

  // Centralized Ephemeral Management PIN Session State (in-memory only; never persisted to storage)
  const [unlockedSessionKey, setUnlockedSessionKey] = useState<string | null>(null);
  const [pendingManagementTarget, setPendingManagementTarget] =
    useState<PendingManagementNavigationTarget | null>(null);
  const [showManagementPinModal, setShowManagementPinModal] = useState<boolean>(() => {
    const initialFloorEnabled = store.isProductionFloorModeEnabled();
    const initialLock = store.getEffectiveManagementLockResolution();
    return !initialFloorEnabled && initialLock.isLockActive;
  });
  const [hasMountedManagementSession, setHasMountedManagementSession] = useState<boolean>(false);
  const [autoLockNotice, setAutoLockNotice] = useState<string | null>(null);

  const expectedUnlockKey = buildManagementUnlockSessionKey(activeWorkspaceId, lockResolution);
  const isManagementUnlocked =
    !lockResolution.isLockActive ||
    Boolean(!lockResolution.isVerificationBlocked && expectedUnlockKey && unlockedSessionKey === expectedUnlockKey);

  // Browser back/forward route sync (never bypasses Management guard)
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseRoute();
      setActiveTabState(parsed.tab);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Ensure SS_APP_MODE never retains 'management' in localStorage while PIN lock is active,
  // and handle Production Floor Mode disabled redirect safely through the PIN challenge.
  useEffect(() => {
    if (!isProductionFloorEnabled) {
      if (appMode !== 'management') {
        setAppMode('management');
      }
      if (!lockResolution.isLockActive) {
        if (typeof window !== 'undefined' && localStorage.getItem(APP_MODE_STORAGE_KEY) !== 'management') {
          localStorage.setItem(APP_MODE_STORAGE_KEY, 'management');
        }
      } else {
        if (typeof window !== 'undefined') {
          const raw = localStorage.getItem(APP_MODE_STORAGE_KEY);
          if (raw === 'management' || raw === 'full') {
            localStorage.removeItem(APP_MODE_STORAGE_KEY);
          }
        }
        if (!isManagementUnlocked) {
          setShowManagementPinModal(true);
        }
      }
    } else if (lockResolution.isLockActive && typeof window !== 'undefined') {
      const raw = localStorage.getItem(APP_MODE_STORAGE_KEY);
      if (raw === 'management' || raw === 'full') {
        localStorage.setItem(APP_MODE_STORAGE_KEY, appMode === 'production' ? 'production' : 'main');
      }
    }
  }, [isProductionFloorEnabled, appMode, lockResolution.isLockActive, isManagementUnlocked]);

  // Immediately re-lock Management Mode whenever active workspace changes
  useEffect(() => {
    setUnlockedSessionKey(null);
    setPendingManagementTarget(null);
    setShowManagementPinModal(false);
    setHasMountedManagementSession(false);
    setAutoLockNotice(null);
    if (store.isProductionFloorModeEnabled()) {
      setAppMode((prev) => (prev === 'management' ? 'main' : prev));
    }
  }, [activeWorkspaceId]);

  // Immediate re-lock / exit when live Firestore membership role downgrades or deactivates
  const prevSecurityEpochRef = useRef<number>(securityEpoch);
  useEffect(() => {
    if (securityEpoch === prevSecurityEpochRef.current) return;
    prevSecurityEpochRef.current = securityEpoch;
    const evt = store.getLastMembershipSecurityEvent();
    setUnlockedSessionKey(null);
    setPendingManagementTarget(null);
    setShowManagementPinModal(false);
    setHasMountedManagementSession(false);
    setActiveGuidedMixingCalc(null);
    if (evt?.reason === 'role_downgrade') {
      setAutoLockNotice('Your workspace role changed. Management Mode has been locked for security.');
      if (store.isProductionFloorModeEnabled()) {
        setAppMode('main');
        if (typeof window !== 'undefined') {
          localStorage.setItem(APP_MODE_STORAGE_KEY, 'main');
        }
      }
    }
  }, [securityEpoch]);

  // Tab capability fallback guard
  useEffect(() => {
    if (activeTab === 'costing' && !features.costing) {
      setActiveTab('dashboard');
    } else if (
      (activeTab === 'recipes' || activeTab === 'calculate' || activeTab === 'presets' || activeTab === 'mixers') &&
      !features.recipeManagement
    ) {
      setActiveTab('dashboard');
    }
  }, [activeTab, features]);

  // Subscribe to store updates while authorized
  useEffect(() => {
    const syncAllFromStore = () => {
      setRecipes(store.getRecipes());
      setMasterIngredients(store.getMasterIngredients());
      setPresets(store.getPresets());
      setMixers(store.getMixers());
      setHistory(store.getHistory());
      setSettings(store.getSettings());
      setActiveChecklist(store.getActiveChecklist());
      setWorkspaces(store.getWorkspaces());
      setActiveWorkspace(store.getActiveWorkspace());
      setCategoryPresetMap(store.getCategoryPresetMap());
      setProductionOptionOrder(store.getProductionOptionOrder());
      setFeatures(store.getWorkspaceFeatures());
      setRecipesHydrationState(store.getRecipesHydrationState());
      setPresetsHydrationState(store.getPresetsHydrationState());
      setCriticalNotesSyncError(store.getCriticalNotesSyncError());
      setConnectionVerified(store.isSafetyConnectionVerified());
      setIsReconnecting(store.isSafetyReconnectingState());
      setLockResolution(store.getEffectiveManagementLockResolution());
      setUserRole(store.getUserRole());
      setSecurityEpoch(store.getMembershipSecurityEpoch());
    };

    syncAllFromStore();

    const unsubscribe = store.subscribe(() => {
      syncAllFromStore();
    });

    const initialTestResults = runUnitTests();
    setTestPassedCount(initialTestResults.filter((r) => r.passed).length);

    return () => unsubscribe();
  }, []);

  // Sync theme with HTML root class
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  const applyManagementTarget = (target?: PendingManagementNavigationTarget | null) => {
    if (!target) return;
    if (target.recipeIdForCalc !== undefined) {
      setSelectedRecipeForCalcId(target.recipeIdForCalc);
    }
    if (target.openNewRecipeModal !== undefined) {
      setOpenRecipeModalDirectly(target.openNewRecipeModal);
    }
    if (target.tab) {
      setActiveTab(target.tab);
    }
  };

  // Single Centralized Gate for ALL transitions into Management Mode
  const requestManagementAccess = (target?: PendingManagementNavigationTarget) => {
    const latestResolution = store.getEffectiveManagementLockResolution();
    const latestKey = buildManagementUnlockSessionKey(store.getActiveWorkspaceId(), latestResolution);
    const currentlyUnlocked =
      !latestResolution.isLockActive ||
      Boolean(
        !latestResolution.isVerificationBlocked &&
          latestKey &&
          unlockedSessionKey === latestKey
      );

    if (currentlyUnlocked) {
      applyManagementTarget(target);
      setAppMode('management');
      if (!latestResolution.isLockActive && typeof window !== 'undefined') {
        localStorage.setItem(APP_MODE_STORAGE_KEY, 'management');
      }
      return;
    }

    setPendingManagementTarget(target || {});
    setShowManagementPinModal(true);
  };

  const handlePinUnlockSuccess = () => {
    const latestResolution = store.getEffectiveManagementLockResolution();
    const latestKey = buildManagementUnlockSessionKey(store.getActiveWorkspaceId(), latestResolution);
    if (!latestKey || latestResolution.isVerificationBlocked) {
      return;
    }
    setAutoLockNotice(null);
    setUnlockedSessionKey(latestKey);
    setShowManagementPinModal(false);
    applyManagementTarget(pendingManagementTarget);
    setPendingManagementTarget(null);
    setAppMode('management');
  };

  const handleSignOutCleanly = async () => {
    setUnlockedSessionKey(null);
    setPendingManagementTarget(null);
    setShowManagementPinModal(false);
    setHasMountedManagementSession(false);
    setAutoLockNotice(null);
    store.clearSession();
    await logoutUser();
  };

  // Handlers
  const handleSelectRecipeForCalc = (recipeId: string) => {
    setSelectedRecipeForCalcId(recipeId);
    setActiveTab('calculate');
  };

  const handleStartGuidedMixing = (calc: CalculationResult) => {
    if (store.getSafetyOperationalGateState() !== 'READY') return;
    setActiveGuidedMixingCalc(calc);
  };

  const handleResumeChecklist = (checklist: any) => {
    if (store.getSafetyOperationalGateState() !== 'READY') return;
    const current = checklist || store.getActiveChecklist() || activeChecklist;
    if (!current) return;

    if (current.calculation?.calculatedIngredients && current.calculation.calculatedIngredients.length > 0) {
      setActiveGuidedMixingCalc(current.calculation);
    } else {
      const matchedRecipe =
        (current.recipeId && recipes.find((r) => r.id === current.recipeId)) ||
        (current.recipeName &&
          recipes.find((r) => r.name.toLowerCase().trim() === current.recipeName.toLowerCase().trim())) ||
        recipes[0];

      if (matchedRecipe) {
        const targetMixer = mixers[0];
        const calcResult = calculateProduction(
          matchedRecipe,
          [
            {
              id: 'req-resume',
              presetName: matchedRecipe.batchYieldUnit || 'Batch',
              quantity: 1,
              piecesPerUnit: matchedRecipe.batchYieldQuantity || 1,
              itemWeight: 1,
              itemWeightUnit: (matchedRecipe.batchYieldUnit as WeightUnit) || 'oz',
            },
          ],
          {
            mixer: targetMixer,
            defaultWeightUnit: settings.defaultWeightUnit,
            defaultWastePercent: settings.defaultWastePercent,
          }
        );
        setActiveGuidedMixingCalc(calcResult);
      }
    }
  };

  const handleResetChecklist = () => {
    const current = store.getActiveChecklist() || activeChecklist;
    if (current) {
      const updated = {
        ...current,
        currentBatch: 1,
        completedIngredientIds: [],
      };
      store.setActiveChecklist(updated);
      setActiveChecklist(updated);
    }
  };

  const handleDeleteChecklist = () => {
    store.clearActiveChecklist();
    setActiveChecklist(null);
  };

  const handleSaveToHistory = async (entry: ProductionHistoryEntry) => {
    await store.saveHistoryEntry(entry);
  };

  const handleOpenNewRecipeModal = () => {
    setOpenRecipeModalDirectly(true);
    setActiveTab('recipes');
  };

  // Immediate re-lock on exit to Production Floor
  const handleSwitchToProductionMode = () => {
    setUnlockedSessionKey(null);
    setPendingManagementTarget(null);
    setShowManagementPinModal(false);
    setHasMountedManagementSession(false);
    setAutoLockNotice(null);
    if (!store.isProductionFloorModeEnabled()) {
      setAppMode('management');
      if (store.getEffectiveManagementLockResolution().isLockActive) {
        setShowManagementPinModal(true);
      }
      return;
    }
    setAppMode('production');
    if (typeof window !== 'undefined') {
      localStorage.setItem(APP_MODE_STORAGE_KEY, 'production');
    }
  };

  const handleSwitchToManagementMode = () => {
    requestManagementAccess();
  };

  // Immediate re-lock on exit back to Main Launcher
  const handleBackToMain = () => {
    setUnlockedSessionKey(null);
    setPendingManagementTarget(null);
    setShowManagementPinModal(false);
    setHasMountedManagementSession(false);
    setAutoLockNotice(null);
    if (!store.isProductionFloorModeEnabled()) {
      setAppMode('management');
      if (store.getEffectiveManagementLockResolution().isLockActive) {
        setShowManagementPinModal(true);
      }
      return;
    }
    setAppMode('main');
    if (typeof window !== 'undefined') {
      localStorage.setItem(APP_MODE_STORAGE_KEY, 'main');
    }
  };

  const handleOwnerConfiguredLockInSession = (newConfig: ManagementLockConfig) => {
    if (newConfig.enabled && newConfig.hash) {
      setUnlockedSessionKey(`${store.getActiveWorkspaceId()}:${newConfig.hash}`);
    } else {
      setUnlockedSessionKey(null);
    }
  };

  // Universal Centralized Guard:
  // Blocks Management Mode rendering whenever ANY Management view is active (regardless of
  // whether Production Floor Mode is enabled or disabled) and an effective lock is not unlocked.
  const isInManagementView = (appMode === 'management' || !isProductionFloorEnabled);
  const requiresManagementPinChallenge =
    isInManagementView && lockResolution.isLockActive && !isManagementUnlocked;

  // Record whether Management Mode has been unlocked in this session so unsaved form state can survive auto-lock
  useEffect(() => {
    if (isInManagementView && !requiresManagementPinChallenge) {
      setHasMountedManagementSession(true);
    }
  }, [isInManagementView, requiresManagementPinChallenge]);

  // Shared-tablet Management PIN auto-lock controller (15m inactivity / >60s hidden or screen-off)
  useEffect(() => {
    const shouldMonitorAutoLock =
      isInManagementView && lockResolution.isLockActive && isManagementUnlocked;
    if (!shouldMonitorAutoLock || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const controller = new ManagementAutoLockController({
      onAutoLock: (reason) => {
        setUnlockedSessionKey(null);
        setShowManagementPinModal(false);
        setAutoLockNotice(
          reason === 'hidden_timeout'
            ? 'Management Mode auto-locked while the screen or tab was inactive. Re-enter PIN to resume.'
            : 'Management Mode auto-locked after 15 minutes of inactivity. Re-enter PIN to resume.'
        );
      },
    });

    controller.start(document.visibilityState === 'hidden');

    let lastActivityAt = 0;
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityAt < 1000) return;
      lastActivityAt = now;
      controller.recordActivity();
    };

    const handleVisibilityChange = () => {
      controller.handleVisibilityChange(document.visibilityState === 'hidden');
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'input',
      'scroll',
    ];
    activityEvents.forEach((evtName) => {
      window.addEventListener(evtName, handleActivity, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.stop();
      activityEvents.forEach((evtName) => {
        window.removeEventListener(evtName, handleActivity, { capture: true });
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInManagementView, lockResolution.isLockActive, isManagementUnlocked]);

  const renderLockedChallengeScreen = () => (
    <div className="min-h-screen bg-[#FAF8F5] dark:bg-[#151311] text-[#5A534B] dark:text-[#EAE6E1] font-sans selection:bg-amber-500 selection:text-white transition-colors duration-150 flex flex-col">
      {/* Minimal Clean Header */}
      <header className="border-b border-[#E5E1DA] dark:border-[#2D2925] bg-white/80 dark:bg-[#1E1B18]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-serif font-bold text-base shadow-xs">
              S
            </div>
            <span className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
              {store.getWorkspaceBranding().displayName || 'Sunny Sweets'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isProductionFloorEnabled && (
              <button
                type="button"
                id="locked-mode-back-to-main-btn"
                onClick={handleBackToMain}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-stone-700 dark:text-zinc-200 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Production Launcher</span>
              </button>
            )}

            <button
              type="button"
              id="locked-mode-theme-toggle"
              onClick={() => {
                const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
                store.updateSettings({ theme: newTheme });
              }}
              className="p-2 rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Toggle light/dark theme"
            >
              {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {auth.currentUser && (
              <button
                id="locked-mode-logout-btn"
                onClick={() => handleSignOutCleanly().catch(console.error)}
                className="p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                title={`Sign out (${auth.currentUser.email})`}
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Locked Challenge Card */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-3xl p-8 text-center shadow-lg space-y-5">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-700 dark:text-amber-400 shadow-xs">
            <Lock className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-serif font-bold text-[#2D2926] dark:text-[#EAE6E1]">
              Management Mode Locked
            </h2>
            {autoLockNotice && (
              <p
                id="management-auto-lock-notice"
                className="text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2 leading-relaxed"
              >
                {autoLockNotice}
              </p>
            )}
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed max-w-xs mx-auto">
              {lockResolution.isVerificationBlocked
                ? lockResolution.blockReason
                : hasMountedManagementSession
                ? 'Your open Management workspace and unsaved edits are paused safely. Enter the Management PIN to continue.'
                : 'A management PIN is required to access bakery recipes, equipment, costing, and administrative tools.'}
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              id="management-locked-unlock-btn"
              type="button"
              onClick={() => setShowManagementPinModal(true)}
              className="w-full py-3 px-5 rounded-xl font-bold text-sm text-white bg-amber-600 hover:bg-amber-700 transition cursor-pointer shadow-sm flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>
                {lockResolution.isVerificationBlocked
                  ? 'Verify Workspace Policy'
                  : 'Enter Management PIN'}
              </span>
            </button>

            {isProductionFloorEnabled && (
              <button
                id="management-locked-return-production-btn"
                type="button"
                onClick={handleSwitchToProductionMode}
                className="w-full py-3 px-5 rounded-xl font-bold text-xs text-stone-700 dark:text-zinc-200 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 transition cursor-pointer flex items-center justify-center gap-2"
              >
                <ChefHat className="w-4 h-4 text-amber-600" />
                <span>Go to Production Floor Mode</span>
              </button>
            )}
          </div>
        </div>
      </main>

      <ManagementLockModal
        isOpen={showManagementPinModal}
        lockConfig={lockResolution.effectiveConfig}
        verificationBlockedReason={
          lockResolution.isVerificationBlocked ? lockResolution.blockReason : null
        }
        onRetryPolicySync={() => store.retryWorkspaceLockHydration()}
        onClose={() => {
          setShowManagementPinModal(false);
          setPendingManagementTarget(null);
          if (isProductionFloorEnabled && !hasMountedManagementSession) {
            setAppMode('main');
            if (typeof window !== 'undefined') {
              localStorage.setItem(APP_MODE_STORAGE_KEY, 'main');
            }
          }
        }}
        onUnlockSuccess={handlePinUnlockSuccess}
      />
    </div>
  );

  if (requiresManagementPinChallenge && !hasMountedManagementSession) {
    return renderLockedChallengeScreen();
  }

  // If in Production Floor Mode, render the minimalist tablet view (ONLY when enabled)
  if (appMode === 'production' && isProductionFloorEnabled) {
    return (
      <ProductionModeView
        recipes={recipes}
        presets={presets}
        mixers={mixers}
        settings={settings}
        categoryPresetMap={categoryPresetMap}
        productionOptionOrder={productionOptionOrder}
        recipesHydrationState={recipesHydrationState}
        presetsHydrationState={presetsHydrationState}
        criticalNotesSyncError={criticalNotesSyncError}
        connectionVerified={connectionVerified}
        isReconnecting={isReconnecting}
        activeWorkspaceId={activeWorkspaceId}
        onExit={handleBackToMain}
        initialRecipeId={selectedRecipeForCalcId}
      />
    );
  }

  // If in Main Landing Mode, render the simplified Mode Launcher (ONLY when enabled)
  if (appMode === 'main' && isProductionFloorEnabled) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] dark:bg-[#151311] text-[#5A534B] dark:text-[#EAE6E1] font-sans selection:bg-amber-500 selection:text-white transition-colors duration-150 w-full max-w-full min-w-0">
        {/* Minimal Clean Header for Main Mode */}
        <header className="border-b border-[#E5E1DA] dark:border-[#2D2925] bg-white/80 dark:bg-[#1E1B18]/80 backdrop-blur-md sticky top-0 z-30 w-full max-w-full min-w-0">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2 sm:gap-4 min-w-0 w-full">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-serif font-bold text-base shadow-xs shrink-0">
                S
              </div>
              <span className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100 truncate">
                {store.getWorkspaceBranding().displayName || 'Sunny Sweets'}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                id="main-mode-theme-toggle"
                onClick={() => {
                  const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
                  store.updateSettings({ theme: newTheme });
                }}
                className="p-2 rounded-xl text-stone-500 hover:text-stone-800 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                title="Toggle light/dark theme"
              >
                {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {auth.currentUser && (
                <button
                  id="main-mode-logout-btn"
                  onClick={() => handleSignOutCleanly().catch(console.error)}
                  className="p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  title={`Sign out (${auth.currentUser.email})`}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Mode Launcher Main Stage */}
        <main className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8 min-w-0">
          <Dashboard
            mode="main"
            userRole={userRole}
            recipes={recipes}
            presets={presets}
            mixers={mixers}
            history={history}
            masterIngredients={masterIngredients}
            settings={settings}
            activeChecklist={activeChecklist}
            setActiveTab={(tab) => requestManagementAccess({ tab })}
            onOpenCalculatorWithRecipe={(recipeId) =>
              requestManagementAccess({ tab: 'calculate', recipeIdForCalc: recipeId })
            }
            onOpenRecipeModal={() =>
              requestManagementAccess({ tab: 'recipes', openNewRecipeModal: true })
            }
            onResumeChecklist={handleResumeChecklist}
            onResetChecklist={handleResetChecklist}
            onDeleteChecklist={handleDeleteChecklist}
            onRunUnitTests={() => setShowUnitTestModal(true)}
            testPassedCount={testPassedCount}
            onSwitchToProductionMode={handleSwitchToProductionMode}
            onSwitchToManagementMode={handleSwitchToManagementMode}
            onRequestManagementAccess={(targetTab) => requestManagementAccess({ tab: targetTab })}
            onBackToMain={handleBackToMain}
          />
        </main>

        <ManagementLockModal
          isOpen={showManagementPinModal}
          lockConfig={lockResolution.effectiveConfig}
          verificationBlockedReason={
            lockResolution.isVerificationBlocked ? lockResolution.blockReason : null
          }
          onRetryPolicySync={() => store.retryWorkspaceLockHydration()}
          onClose={() => {
            setShowManagementPinModal(false);
            setPendingManagementTarget(null);
          }}
          onUnlockSuccess={handlePinUnlockSuccess}
        />
      </div>
    );
  }

  // Management Mode View (Full application workspace — strictly gated by PIN when enabled;
  // kept hidden rather than unmounted across inactivity/hidden auto-lock to preserve unsaved form state)
  return (
    <>
      {requiresManagementPinChallenge ? renderLockedChallengeScreen() : null}
      <div
        className={
          requiresManagementPinChallenge
            ? 'hidden'
            : 'min-h-screen bg-amber-50/40 dark:bg-zinc-950 text-amber-950 dark:text-zinc-100 font-sans selection:bg-amber-500 selection:text-white transition-colors duration-150 w-full max-w-full min-w-0'
        }
        aria-hidden={requiresManagementPinChallenge ? 'true' : undefined}
      >
        {/* Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          theme={settings.theme === 'dark' ? 'dark' : 'light'}
          onSwitchToProductionMode={isProductionFloorEnabled ? handleSwitchToProductionMode : undefined}
          onBackToMain={isProductionFloorEnabled ? handleBackToMain : undefined}
        />

        {/* Main Content Stage */}
        <main className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8 min-w-0">
          {activeTab === 'dashboard' && (
            <Dashboard
              mode="management"
              userRole={userRole}
              recipes={recipes}
              presets={presets}
              mixers={mixers}
              history={history}
              masterIngredients={masterIngredients}
              settings={settings}
              activeChecklist={activeChecklist}
              setActiveTab={setActiveTab}
              onOpenCalculatorWithRecipe={handleSelectRecipeForCalc}
              onOpenRecipeModal={handleOpenNewRecipeModal}
              onResumeChecklist={handleResumeChecklist}
              onResetChecklist={handleResetChecklist}
              onDeleteChecklist={handleDeleteChecklist}
              onRunUnitTests={() => setShowUnitTestModal(true)}
              testPassedCount={testPassedCount}
              onSwitchToProductionMode={isProductionFloorEnabled ? handleSwitchToProductionMode : undefined}
              onBackToMain={isProductionFloorEnabled ? handleBackToMain : undefined}
            />
          )}

          {activeTab === 'recipes' && (
            <RecipeManager
              recipes={recipes}
              masterIngredients={masterIngredients}
              history={history}
              settings={settings}
              userRole={userRole || undefined}
              onSaveRecipe={(r) => store.saveRecipe(r)}
              onSaveMasterIngredient={(mi) => store.saveMasterIngredient(mi)}
              onDuplicateRecipe={(id) => store.duplicateRecipe(id)}
              onArchiveRecipe={(id, arch) => store.archiveRecipe(id, arch)}
              onDeleteRecipe={(id) => store.deleteRecipe(id)}
              onReorderRecipes={(ordered) => store.reorderRecipes(ordered)}
              onSelectRecipeForCalc={handleSelectRecipeForCalc}
              openModalDirectly={openRecipeModalDirectly}
            />
          )}

          {activeTab === 'ingredients' && (
            <IngredientPantry
              recipes={recipes}
              masterIngredients={masterIngredients}
              settings={settings}
              userRole={userRole || undefined}
              onSaveIngredient={(ing) => store.saveMasterIngredient(ing)}
              onDeleteIngredient={(id, force) => store.deleteMasterIngredient(id, force)}
              onBulkImport={(items) => store.bulkImportMasterIngredients(items)}
              onLinkIngredient={(rId, ingId, mId) => store.linkRecipeIngredient(rId, ingId, mId).then(() => {})}
              onUnlinkIngredient={(rId, ingId) => store.unlinkRecipeIngredient(rId, ingId).then(() => {})}
              onBulkLinkGroup={(name, mId) => store.bulkLinkIngredientGroup(name, mId)}
            />
          )}

          {activeTab === 'presets' && (
            <PresetManager
              presets={presets}
              recipes={recipes}
              userRole={userRole || undefined}
              onSavePreset={(p, opts) => store.savePreset(p, opts)}
              onTogglePresetProductionEnabled={(id, enabled) =>
                store.setPresetProductionEnabled(id, enabled)
              }
              onDeletePreset={(id) => store.deletePreset(id)}
            />
          )}

          {activeTab === 'mixers' && (
            <MixerManager
              mixers={mixers}
              userRole={userRole}
              onSaveMixer={(m) => store.saveMixer(m)}
              onDeleteMixer={(id) => store.deleteMixer(id)}
            />
          )}

          {activeTab === 'costing' && (
            <CostingCompletionView
              recipes={recipes}
              masterIngredients={masterIngredients}
              settings={settings}
              userRole={userRole || undefined}
              onSaveRecipe={(r) => store.saveRecipe(r)}
              onSaveMasterIngredient={(mi) => store.saveMasterIngredient(mi)}
              onNavigateToPantry={() => setActiveTab('ingredients')}
              onNavigateToCalculator={(recipeId) => {
                setSelectedRecipeForCalcId(recipeId);
                setActiveTab('calculate');
              }}
            />
          )}

          {activeTab === 'quotes' && (
            <ProductQuotingView
              onOpenRecipe={() => {
                setActiveTab('recipes');
              }}
            />
          )}

          {activeTab === 'calculate' && (
            <ProductionCalculator
              recipes={recipes}
              presets={presets}
              mixers={mixers}
              settings={settings}
              userRole={userRole}
              categoryPresetMap={categoryPresetMap}
              initialRecipeId={selectedRecipeForCalcId}
              recipesHydrationState={recipesHydrationState}
              presetsHydrationState={presetsHydrationState}
              criticalNotesSyncError={criticalNotesSyncError}
              connectionVerified={connectionVerified}
              isReconnecting={isReconnecting}
              activeWorkspaceId={activeWorkspaceId}
              onStartGuidedMixing={handleStartGuidedMixing}
              onSaveToHistory={handleSaveToHistory}
              masterIngredients={masterIngredients}
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              history={history}
              userRole={userRole}
              onDeleteHistoryEntry={(id) => store.deleteHistoryEntry(id)}
              onReopenInCalculator={(entry) => {
                setSelectedRecipeForCalcId(entry.recipeId);
                setActiveTab('calculate');
              }}
              businessName={settings.businessName}
              decimalPlaces={settings.decimalPlaces}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              categoryPresetMap={categoryPresetMap}
              productionOptionOrder={productionOptionOrder}
              userRole={userRole || undefined}
              recipesCount={recipes.length}
              recipes={recipes}
              presets={presets}
              onUpdateSettings={(u) => store.updateSettings(u)}
              onOpenUnitTests={() => setShowUnitTestModal(true)}
              testPassedCount={testPassedCount}
              onManagementLockConfigured={handleOwnerConfiguredLockInSession}
            />
          )}
        </main>

        {/* Full-Screen Guided Mixing Mode View */}
        {activeGuidedMixingCalc && (
          <GuidedMixingMode
            calculation={activeGuidedMixingCalc}
            presets={presets}
            recipes={recipes}
            recipesHydrationState={recipesHydrationState}
            presetsHydrationState={presetsHydrationState}
            criticalNotesSyncError={criticalNotesSyncError}
            connectionVerified={connectionVerified}
            isReconnecting={isReconnecting}
            activeWorkspaceId={activeWorkspaceId}
            onExit={() => setActiveGuidedMixingCalc(null)}
            decimalPlaces={settings.decimalPlaces}
          />
        )}

        {/* Interactive Unit Tests Modal */}
        {showUnitTestModal && (
          <UnitTestModal
            onClose={() => setShowUnitTestModal(false)}
            onUpdatePassCount={(count) => setTestPassedCount(count)}
          />
        )}
      </div>
    </>
  );
};
