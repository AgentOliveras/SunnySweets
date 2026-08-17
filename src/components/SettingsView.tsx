import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { UserSettings, WeightUnit } from '../types';
import { WEIGHT_UNITS } from '../utils/units';
import { store } from '../services/store';
import { auth } from '../services/firebase';

interface SettingsViewProps {
  settings: UserSettings;
  recipesCount?: number;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  onStandardizeAllRecipes?: (targetUnit: WeightUnit) => Promise<number>;
  onOpenUnitTests: () => void;
  testPassedCount?: number;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  recipesCount = 0,
  onUpdateSettings,
  onStandardizeAllRecipes,
  onOpenUnitTests,
  testPassedCount,
}) => {
  const [businessName, setBusinessName] = useState(settings.businessName || 'Artisan Bakery Co.');
  const [defaultWastePercent, setDefaultWastePercent] = useState<string | number>(
    settings.defaultWastePercent !== undefined ? settings.defaultWastePercent : 6
  );
  const [standardizeStatus, setStandardizeStatus] = useState<string | null>(null);
  const [isStandardizing, setIsStandardizing] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState(store.getSyncStatus());
  const [isManualSyncing, setIsManualSyncing] = useState(false);

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
    setBusinessName(settings.businessName || 'Artisan Bakery Co.');
    setDefaultWastePercent(settings.defaultWastePercent !== undefined ? settings.defaultWastePercent : 6);
  }, [settings.businessName, settings.defaultWastePercent]);

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
                  Convert and align measuring unit inputs across all {recipesCount > 0 ? `${recipesCount} recipes` : 'bakery recipes'} to {settings.defaultWeightUnit.toUpperCase()}.
                </p>
              </div>

              <button
                type="button"
                id="standardize-all-recipes-btn"
                disabled={isStandardizing}
                onClick={() => handleStandardize(settings.defaultWeightUnit)}
                className="inline-flex items-center justify-center gap-2 bg-[#D4A373] hover:bg-[#C49363] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm shrink-0 cursor-pointer"
              >
                <Scale className="w-4 h-4" />
                <span>
                  {isStandardizing ? 'Standardizing...' : `Standardize All to ${settings.defaultWeightUnit.toUpperCase()}`}
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


