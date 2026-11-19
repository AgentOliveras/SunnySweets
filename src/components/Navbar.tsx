import React, { useState, useEffect, useRef } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, signInWithGoogle, logoutUser } from '../services/firebase';
import { store } from '../services/store';
import {
  LayoutDashboard,
  BookOpen,
  Calculator,
  History,
  Settings,
  ChefHat,
  Sliders,
  Scale,
  DollarSign,
  User as UserIcon,
  LogOut,
  LogIn,
  Package,
  ShieldCheck,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  Menu,
  X,
  ArrowLeft,
  TrendingUp,
} from 'lucide-react';

import { UserSettings, WorkspaceFeatures } from '../types';

export type TabType = 'dashboard' | 'recipes' | 'ingredients' | 'calculate' | 'history' | 'settings' | 'presets' | 'mixers' | 'costing' | 'quotes';

export interface TabItem {
  id: TabType;
  label: string;
  icon: any;
  desc: string;
  requiredFeature?: keyof WorkspaceFeatures;
}

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  theme: 'light' | 'dark';
  onSwitchToProductionMode?: () => void;
  onBackToMain?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onSwitchToProductionMode,
  onBackToMain,
}) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [branding, setBranding] = useState(() => store.getWorkspaceBranding());
  const [activeWs, setActiveWs] = useState(() => store.getActiveWorkspace());
  const [features, setFeatures] = useState<WorkspaceFeatures>(() => store.getWorkspaceFeatures());
  const [userRole, setUserRole] = useState(() => store.getUserRole());
  const [imgError, setImgError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // Subscribe to store updates for reactive branding, active workspace, role, and features
  useEffect(() => {
    const unsubStore = store.subscribe(() => {
      setBranding(store.getWorkspaceBranding());
      setActiveWs(store.getActiveWorkspace());
      setFeatures(store.getWorkspaceFeatures());
      setUserRole(store.getUserRole());
      setImgError(false);
    });
    return () => unsubStore();
  }, []);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const rawMainTabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Overview & quick batch status' },
    { id: 'recipes', label: 'Recipes', icon: BookOpen, desc: 'Manage recipes & formulas', requiredFeature: 'recipeManagement' },
    { id: 'calculate', label: 'Calculate', icon: Calculator, desc: 'Scale batches & equipment checks', requiredFeature: 'recipeManagement' },
    { id: 'ingredients', label: 'Ingredients', icon: Package, desc: 'Master pantry & costs', requiredFeature: 'costing' },
    { id: 'history', label: 'History', icon: History, desc: 'Production logs & checklists' },
    { id: 'settings', label: 'Settings', icon: Settings, desc: 'Units, precision & branding' },
  ];

  const rawSubTabs: TabItem[] = [
    { id: 'quotes', label: 'Product Development & Quotes', icon: TrendingUp, desc: 'Working formulas, multi-size scenarios & commercial pricing', requiredFeature: 'productQuoting' },
    { id: 'costing', label: 'Costing', icon: DollarSign, desc: 'Ingredient linking & cost coverage', requiredFeature: 'costing' },
    { id: 'presets', label: 'Presets', icon: Sliders, desc: 'Finished item unit weights', requiredFeature: 'recipeManagement' },
    { id: 'mixers', label: 'Mixers', icon: Scale, desc: 'Bakery mixing bowl limits', requiredFeature: 'recipeManagement' },
  ];

  const mainTabs = rawMainTabs.filter((t) => !t.requiredFeature || Boolean(features[t.requiredFeature]));
  const subTabs = rawSubTabs.filter((t) => !t.requiredFeature || Boolean(features[t.requiredFeature]));

  const allTabs = [...mainTabs, ...subTabs];
  const currentActiveTabObj = allTabs.find((t) => t.id === activeTab) || mainTabs[0];
  const ActiveIcon = currentActiveTabObj.icon;

  const handleSelectTab = (tabId: TabType) => {
    setActiveTab(tabId);
    setDropdownOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#E5E1DA] dark:border-[#2D2925] bg-white/95 dark:bg-[#1E1B18]/95 backdrop-blur-md px-3 sm:px-8 py-3 w-full max-w-full min-w-0">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 min-w-0 w-full">
        {/* Brand Logo & Title */}
        <div
          className="flex items-center gap-2 sm:gap-3 cursor-pointer group select-none min-w-0 shrink"
          onClick={() => handleSelectTab('dashboard')}
          id="navbar-brand-container"
        >
          {branding.logoUrl && !imgError ? (
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-white shadow-xs border border-[var(--color-border)] shrink-0">
              <img
                src={branding.logoUrl}
                alt={branding.displayName}
                className="w-full h-full object-contain p-0.5"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
              />
            </div>
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold shadow-xs transition shrink-0"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-contrast-text)',
              }}
            >
              {branding.displayName ? (
                <span className="text-xs font-bold uppercase tracking-wider">
                  {branding.displayName.slice(0, 2)}
                </span>
              ) : (
                <ChefHat className="w-5 h-5" />
              )}
            </div>
          )}
          <div className="flex items-center min-w-0">
            <h1 className="text-sm sm:text-base md:text-xl font-bold tracking-tight text-[var(--color-text)] truncate max-w-[130px] sm:max-w-[200px] md:max-w-none">
              {branding.displayName || 'Recipe Calculator'}
            </h1>
            {activeWs?.name && (
              <>
                <span className="text-[var(--color-muted)] font-normal mx-2 hidden sm:inline">|</span>
                <span className="text-xs sm:text-sm text-[var(--color-muted)] hidden md:inline max-w-[160px] truncate">
                  {activeWs.name}
                </span>
              </>
            )}
            {userRole && (
              <span className="ml-2 hidden sm:inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[var(--color-background)] text-[var(--color-primary)] border border-[var(--color-border)]">
                <ShieldCheck className="w-3 h-3 text-[var(--color-accent)]" />
                <span>{userRole}</span>
              </span>
            )}
            {store.getEntitlementEvaluation().accessState === 'TRIAL_ACTIVE' && (
              <span
                id="navbar-trial-indicator"
                onClick={() => handleSelectTab('settings')}
                className="ml-2 hidden md:inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/50 transition shrink-0"
                title="14-Day Free Trial Active. Click to view subscription details in Settings."
              >
                <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <span>
                  Free Trial —{' '}
                  {(() => {
                    const trialEndsAt = store.getEntitlementEvaluation().billing?.trialEndsAt;
                    const days = trialEndsAt
                      ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                      : 14;
                    return `${days} ${days === 1 ? 'day' : 'days'} remaining`;
                  })()}
                </span>
              </span>
            )}
            {store.getEntitlementEvaluation().accessState === 'COMPLIMENTARY_ACTIVE' && (
              <span
                id="navbar-strategic-partner-indicator"
                onClick={() => handleSelectTab('settings')}
                className="ml-2 hidden md:inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition shrink-0"
                title="Strategic Partner Complimentary Access. Click to view subscription details in Settings."
              >
                <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Strategic Partner</span>
              </span>
            )}
          </div>
        </div>

        {/* Navigation & Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Desktop Tab Bar (Hidden on Mobile & Tablet ratios < 1024px) */}
          <nav className="hidden lg:flex items-center gap-1 bg-[#F5F2ED] dark:bg-[#25221F] p-1 rounded-xl border border-[#EEECE8] dark:border-[#332F2B]">
            {mainTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`nav-desktop-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  style={
                    isActive
                      ? {
                          backgroundColor: 'var(--color-primary)',
                          color: 'var(--color-contrast-text)',
                        }
                      : undefined
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'shadow-sm'
                      : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] hover:bg-[#E5E1DA]/40 dark:hover:bg-[#332F2B]/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}

            <div className="h-4 w-[1px] bg-[#E5E1DA] dark:bg-[#332F2B] mx-0.5" />

            {subTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`nav-desktop-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#5A534B] text-white dark:bg-[#3D3732]'
                      : 'text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Mobile & Tablet Dropdown Trigger Menu (< 1024px) */}
          <div className="relative lg:hidden" ref={dropdownRef}>
            <button
              id="mobile-tablet-menu-btn"
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-xs ${
                dropdownOpen
                  ? 'bg-[#5A534B] text-white border-[#5A534B] dark:bg-[#3D3732]'
                  : 'bg-[#F5F2ED] dark:bg-[#25221F] border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:border-[#D4A373]'
              }`}
            >
              <ActiveIcon className={`w-4 h-4 ${dropdownOpen ? 'text-white' : 'text-[#D4A373]'}`} />
              <span className="font-semibold">{currentActiveTabObj.label}</span>
              {dropdownOpen ? (
                <ChevronUp className="w-4 h-4 opacity-75" />
              ) : (
                <ChevronDown className="w-4 h-4 opacity-75" />
              )}
            </button>

            {/* Dropdown Floating Panel */}
            {dropdownOpen && (
              <div
                id="mobile-tablet-dropdown-panel"
                className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#332F2B] rounded-2xl shadow-xl z-50 p-2 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
              >
                {/* Header info */}
                <div className="px-3 py-2 border-b border-[#EEECE8] dark:border-[#2D2925] flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B7E74] dark:text-[#A39E93]">
                    Navigation Menu
                  </span>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(false)}
                    className="p-1 rounded-lg text-[#8B7E74] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Primary Tabs */}
                <div className="py-1 space-y-0.5">
                  {mainTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        id={`nav-dropdown-${tab.id}`}
                        onClick={() => handleSelectTab(tab.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-[#D4A373] text-white shadow-xs font-bold'
                            : 'text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#D4A373]'}`} />
                          <div>
                            <div className="text-xs font-semibold leading-tight">{tab.label}</div>
                            <div className={`text-[10px] leading-tight ${isActive ? 'text-white/80' : 'text-[#8B7E74] dark:text-[#A39E93]'}`}>
                              {tab.desc}
                            </div>
                          </div>
                        </div>
                        {isActive && <Check className="w-4 h-4 shrink-0 text-white" />}
                      </button>
                    );
                  })}
                </div>

                {/* Sub Tabs / Equipment */}
                <div className="pt-2 pb-1 border-t border-[#EEECE8] dark:border-[#2D2925] mt-1 space-y-0.5">
                  <div className="px-3 py-1 text-[10px] uppercase font-bold tracking-wider text-[#8B7E74] dark:text-[#A39E93]">
                    Equipment & Setup
                  </div>
                  {subTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        id={`nav-dropdown-${tab.id}`}
                        onClick={() => handleSelectTab(tab.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-[#5A534B] text-white dark:bg-[#3D3732] font-bold shadow-xs'
                            : 'text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#8B7E74]'}`} />
                          <div>
                            <div className="text-xs font-semibold leading-tight">{tab.label}</div>
                            <div className={`text-[10px] leading-tight ${isActive ? 'text-white/80' : 'text-[#8B7E74] dark:text-[#A39E93]'}`}>
                              {tab.desc}
                            </div>
                          </div>
                        </div>
                        {isActive && <Check className="w-4 h-4 shrink-0 text-white" />}
                      </button>
                    );
                  })}
                </div>

                {/* Quick actions for Mobile in Dropdown */}
                {onBackToMain && (
                  <div className="pt-2 border-t border-[#EEECE8] dark:border-[#2D2925] mt-1">
                    <button
                      id="mobile-nav-back-to-main-btn"
                      type="button"
                      onClick={() => {
                        setDropdownOpen(false);
                        onBackToMain();
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <ArrowLeft className="w-4 h-4 text-stone-500" />
                        <span>← Back to Main (Launch Screen)</span>
                      </div>
                    </button>
                  </div>
                )}

                {onSwitchToProductionMode && (
                  <div className="pt-2 border-t border-[#EEECE8] dark:border-[#2D2925] mt-1">
                    <button
                      id="mobile-nav-production-mode-btn"
                      type="button"
                      onClick={() => {
                        setDropdownOpen(false);
                        onSwitchToProductionMode();
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <ChefHat className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span>Switch to Production Mode</span>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                        Floor
                      </span>
                    </button>
                  </div>
                )}

              </div>
            )}
          </div>

          {/* Back to Main Launcher (Desktop & Tablet) */}
          {onBackToMain && (
            <button
              id="btn-nav-back-to-main"
              onClick={onBackToMain}
              title="Return to Main Mode Launcher"
              className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-xl text-xs font-bold bg-stone-100 hover:bg-stone-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-stone-700 dark:text-zinc-200 border border-stone-200 dark:border-zinc-700 transition cursor-pointer shadow-xs shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Back to Main</span>
            </button>
          )}

          {/* Production Mode Direct Switcher (Desktop & Tablet) */}
          {onSwitchToProductionMode && (
            <button
              id="btn-nav-production-mode"
              onClick={onSwitchToProductionMode}
              title="Switch to tablet-optimized Production Floor Mode"
              className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white transition cursor-pointer shadow-xs shrink-0 active:scale-95"
            >
              <ChefHat className="w-4 h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">Production Mode</span>
            </button>
          )}

          {/* Auth / Cloud Sync Status Button */}
          {user ? (
            <button
              id="navbar-logout-btn"
              onClick={async () => {
                store.clearSession();
                await logoutUser();
              }}
              title={`Signed in as ${user.email || 'User'}. Click to sign out.`}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-2 sm:py-1.5 rounded-xl text-xs font-semibold bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] transition cursor-pointer shrink-0"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-3.5 h-3.5 text-[#D4A373]" />
              )}
              <span className="hidden xl:inline max-w-[100px] truncate">{user.displayName || user.email || 'Signed In'}</span>
              <LogOut className="w-3 h-3 text-[#8B7E74]" />
            </button>
          ) : (
            <button
              onClick={() => {
                signInWithGoogle().catch((err) => {
                  console.error('Navbar Google Sign-In Error:', err);
                });
              }}
              title="Sign in with Google to enable cloud sync"
              className="hidden sm:flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl text-xs font-semibold bg-[#D4A373] text-white hover:bg-[#C49363] transition shadow-sm cursor-pointer shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cloud Sync</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
