import React, { useState, useEffect } from 'react';
import { Navbar, TabType } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { RecipeManager } from './components/RecipeManager';
import { IngredientPantry } from './components/IngredientPantry';
import { PresetManager } from './components/PresetManager';
import { MixerManager } from './components/MixerManager';
import { ProductionCalculator } from './components/ProductionCalculator';
import { GuidedMixingMode } from './components/GuidedMixingMode';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { UnitTestModal } from './components/UnitTestModal';
import { AccessManagementModal } from './components/AccessManagementModal';
import { AccessDeniedScreen } from './components/AccessDeniedScreen';
import { store } from './services/store';
import { auth } from './services/firebase';
import {
  Recipe,
  ProductionPreset,
  Mixer,
  ProductionHistoryEntry,
  UserSettings,
  CalculationResult,
  MasterIngredient,
  Workspace,
  AccessRole,
  WeightUnit,
} from './types';
import { runUnitTests } from './utils/calculator.test';
import { calculateProduction } from './utils/calculator';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

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

  // Navigation / Modal triggers
  const [selectedRecipeForCalcId, setSelectedRecipeForCalcId] = useState<string | undefined>(undefined);
  const [activeGuidedMixingCalc, setActiveGuidedMixingCalc] = useState<CalculationResult | null>(null);
  const [showUnitTestModal, setShowUnitTestModal] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [testPassedCount, setTestPassedCount] = useState<number | undefined>(undefined);
  const [openRecipeModalDirectly, setOpenRecipeModalDirectly] = useState(false);

  // Initialize Firebase sync and store listeners
  useEffect(() => {
    store.initFirebaseSync();

    const unsubscribe = store.subscribe(() => {
      setRecipes(store.getRecipes());
      setMasterIngredients(store.getMasterIngredients());
      setPresets(store.getPresets());
      setMixers(store.getMixers());
      setHistory(store.getHistory());
      setSettings(store.getSettings());
      setActiveChecklist(store.getActiveChecklist());
      setWorkspaces(store.getWorkspaces());
      setActiveWorkspace(store.getActiveWorkspace());
    });

    // Initial unit test quick check for dashboard metric
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

  // Handlers
  const handleSelectRecipeForCalc = (recipeId: string) => {
    setSelectedRecipeForCalcId(recipeId);
    setActiveTab('calculate');
  };

  const handleStartGuidedMixing = (calc: CalculationResult) => {
    setActiveGuidedMixingCalc(calc);
  };

  const handleResumeChecklist = (checklist: any) => {
    const current = checklist || store.getActiveChecklist() || activeChecklist;
    if (!current) return;

    if (current.calculation?.calculatedIngredients && current.calculation.calculatedIngredients.length > 0) {
      setActiveGuidedMixingCalc(current.calculation);
    } else {
      const matchedRecipe =
        (current.recipeId && recipes.find((r) => r.id === current.recipeId)) ||
        (current.recipeName && recipes.find((r) => r.name.toLowerCase().trim() === current.recipeName.toLowerCase().trim())) ||
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

  const isAuthorized = store.isAuthorized();

  if (!isAuthorized) {
    return (
      <AccessDeniedScreen
        onAccessGranted={() => {
          setRecipes(store.getRecipes());
          setMasterIngredients(store.getMasterIngredients());
          setWorkspaces(store.getWorkspaces());
          setActiveWorkspace(store.getActiveWorkspace());
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-amber-50/40 dark:bg-zinc-950 text-amber-950 dark:text-zinc-100 font-sans selection:bg-amber-500 selection:text-white transition-colors duration-150">
      {/* Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        theme={settings.theme}
        onOpenAccessModal={() => setShowAccessModal(true)}
      />

      {/* Main Content Stage */}
      <main className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        {activeTab === 'dashboard' && (
          <Dashboard
            recipes={recipes}
            presets={presets}
            mixers={mixers}
            history={history}
            settings={settings}
            activeChecklist={activeChecklist}
            setActiveTab={setActiveTab}
            onOpenRecipeModal={handleOpenNewRecipeModal}
            onOpenCalculatorWithRecipe={handleSelectRecipeForCalc}
            onResumeChecklist={handleResumeChecklist}
            onResetChecklist={handleResetChecklist}
            onDeleteChecklist={handleDeleteChecklist}
            onRunUnitTests={() => setShowUnitTestModal(true)}
            testPassedCount={testPassedCount}
          />
        )}

        {activeTab === 'recipes' && (
          <RecipeManager
            recipes={recipes}
            masterIngredients={masterIngredients}
            history={history}
            settings={settings}
            userRole={store.getUserRole()}
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
            masterIngredients={masterIngredients}
            settings={settings}
            userRole={store.getUserRole()}
            onSaveIngredient={(ing) => store.saveMasterIngredient(ing)}
            onDeleteIngredient={(id) => store.deleteMasterIngredient(id)}
            onBulkImport={(items) => store.bulkImportMasterIngredients(items)}
          />
        )}

        {activeTab === 'presets' && (
          <PresetManager
            presets={presets}
            userRole={store.getUserRole()}
            onSavePreset={(p) => store.savePreset(p)}
            onDeletePreset={(id) => store.deletePreset(id)}
          />
        )}

        {activeTab === 'mixers' && (
          <MixerManager
            mixers={mixers}
            onSaveMixer={(m) => store.saveMixer(m)}
            onDeleteMixer={(id) => store.deleteMixer(id)}
          />
        )}

        {activeTab === 'calculate' && (
          <ProductionCalculator
            recipes={recipes}
            presets={presets}
            mixers={mixers}
            settings={settings}
            initialRecipeId={selectedRecipeForCalcId}
            onStartGuidedMixing={handleStartGuidedMixing}
            onSaveToHistory={handleSaveToHistory}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            history={history}
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
            recipesCount={recipes.length}
            onUpdateSettings={(u) => store.updateSettings(u)}
            onStandardizeAllRecipes={(unit) => store.standardizeAllRecipeIngredients(unit)}
            onOpenUnitTests={() => setShowUnitTestModal(true)}
            testPassedCount={testPassedCount}
          />
        )}
      </main>

      {/* Full-Screen Guided Mixing Mode View */}
      {activeGuidedMixingCalc && (
        <GuidedMixingMode
          calculation={activeGuidedMixingCalc}
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

      {/* People & Groups Access Sync Modal */}
      <AccessManagementModal
        isOpen={showAccessModal}
        onClose={() => setShowAccessModal(false)}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        currentUserEmail={auth.currentUser?.email || null}
        onSaveWorkspace={(ws) => store.saveWorkspace(ws)}
        onAddMember={(email, role, name) => store.addMemberToWorkspace(email, role, name)}
        onRemoveMember={(email) => store.removeMemberFromWorkspace(email)}
        onUpdateMemberRole={(email, role) => store.updateMemberRole(email, role)}
        onAddGroup={(name, emails, role) => store.addGroupToWorkspace(name, emails, role)}
        onRemoveGroup={(groupId) => store.removeGroupFromWorkspace(groupId)}
        onJoinByCode={(code) => store.joinWorkspaceByCode(code)}
        onCreateWorkspace={(name) => store.createWorkspace(name)}
        onSwitchWorkspace={(wsId) => store.setActiveWorkspace(wsId)}
      />
    </div>
  );
}
