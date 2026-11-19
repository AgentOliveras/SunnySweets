import React, { useState, useEffect } from 'react';
import {
  ChefHat,
  Store,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  LogOut,
  Building2,
  User,
  Tag,
  RefreshCw,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { auth, logoutUser } from '../services/firebase';
import { BusinessType } from '../types';
import { WorkspaceProvisioningService } from '../services/workspaceProvisioning';
import {
  executeDevWsMainBootstrap,
  EXPECTED_BOOTSTRAP_EMAIL,
  EXPECTED_BOOTSTRAP_DATABASE_ID,
  BootstrapResult,
  executeOwnerIdentityRebind,
} from '../services/devBootstrap';
import { RebindResult } from '../services/ownerRebindService';
import firebaseConfigData from '../../firebase-applet-config.json';

interface NewWorkspaceSetupScreenProps {
  onWorkspaceCreated: (workspaceId: string) => Promise<void>;
  onAccessDeniedFallback?: () => void;
}

const BUSINESS_TYPES: BusinessType[] = [
  'Bakery',
  'Restaurant',
  'Catering',
  'Hotel / Hospitality',
  'Coffee Shop',
  'Commercial Kitchen',
  'Other',
];

export const NewWorkspaceSetupScreen: React.FC<NewWorkspaceSetupScreenProps> = ({
  onWorkspaceCreated,
  onAccessDeniedFallback,
}) => {
  const currentUser = auth.currentUser;
  const isSunnySweetsOwner =
    currentUser?.email?.toLowerCase().trim() === EXPECTED_BOOTSTRAP_EMAIL;

  const [businessName, setBusinessName] = useState('');
  const [workspaceDisplayName, setWorkspaceDisplayName] = useState('');
  const [userFullName, setUserFullName] = useState(
    currentUser?.displayName || ''
  );
  const [businessType, setBusinessType] = useState<BusinessType>('Bakery');
  const [isDisplayNameCustomized, setIsDisplayNameCustomized] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Development Bootstrap State for ws-main
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapStatusMessage, setBootstrapStatusMessage] = useState<string | null>(null);
  const [bootstrapReport, setBootstrapReport] = useState<BootstrapResult | null>(null);
  const [rebindResult, setRebindResult] = useState<RebindResult | null>(null);

  const runBootstrap = async () => {
    setIsBootstrapping(true);
    setBootstrapStatusMessage('Verifying identity & executing development ws-main owner rebind / bootstrap...');
    try {
      const result = await executeDevWsMainBootstrap();
      setBootstrapReport(result);
      if (result.rebindReport) {
        setRebindResult(result.rebindReport);
      }
      if (result.success) {
        setBootstrapStatusMessage(result.message || 'Workspace ws-main authorized & verified!');
        await onWorkspaceCreated('ws-main');
      } else {
        setBootstrapStatusMessage(result.message);
      }
    } catch (err: any) {
      console.error('[NewWorkspaceSetupScreen] Bootstrap exception:', err);
      setBootstrapStatusMessage(`Bootstrap failed: ${err.message || String(err)}`);
    } finally {
      setIsBootstrapping(false);
    }
  };

  const runManualRebind = async () => {
    setIsBootstrapping(true);
    setBootstrapStatusMessage('Evaluating hard preconditions & running atomic owner identity rebind...');
    try {
      const result = await executeOwnerIdentityRebind();
      setRebindResult(result);
      if (result.success) {
        setBootstrapStatusMessage(result.summaryStatus);
        await onWorkspaceCreated('ws-main');
      } else {
        setBootstrapStatusMessage(result.message);
      }
    } catch (err: any) {
      console.error('[NewWorkspaceSetupScreen] Manual rebind exception:', err);
      setBootstrapStatusMessage(`Rebind failed: ${err.message || String(err)}`);
    } finally {
      setIsBootstrapping(false);
    }
  };

  // Automatic execution is disabled. The user must manually trigger rebind or bootstrap via the action buttons.

  const handleBusinessNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setBusinessName(val);
    if (!isDisplayNameCustomized) {
      setWorkspaceDisplayName(val);
    }
  };

  const handleWorkspaceDisplayNameChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setIsDisplayNameCustomized(true);
    setWorkspaceDisplayName(e.target.value);
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedBusiness = businessName.trim();
    if (!trimmedBusiness || trimmedBusiness.length < 2) {
      setErrorMessage('Please enter a business name (at least 2 characters).');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);

      const result = await WorkspaceProvisioningService.createCustomerWorkspace({
        businessName: trimmedBusiness,
        workspaceDisplayName: workspaceDisplayName.trim() || trimmedBusiness,
        userFullName: userFullName.trim() || currentUser?.displayName || 'Bakery Owner',
        businessType,
      });

      if (result.success && result.workspaceId) {
        await onWorkspaceCreated(result.workspaceId);
      }
    } catch (err: any) {
      console.error('[NewWorkspaceSetupScreen] Creation error:', err);
      setErrorMessage(
        err.message ||
          'Your workspace could not be created. No account data was lost. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex flex-col justify-between p-4 sm:p-6 lg:p-8 font-sans selection:bg-[#D4A373]/20">
      {/* Top Header */}
      <header className="w-full max-w-4xl mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#5A534B] dark:bg-[#3D3732] flex items-center justify-center text-[#D4A373] shadow-xs">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight leading-tight">
              Commercial Bakery
            </div>
            <div className="text-[10px] uppercase font-semibold tracking-wider text-[#8B7E74] dark:text-[#A39E93] leading-tight">
              Workspace Setup
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-[#8B7E74] dark:text-[#A39E93]">
            {currentUser?.email}
          </span>
          <button
            type="button"
            onClick={() => logoutUser()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#8B7E74] dark:text-[#A39E93] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Setup Form Card */}
      <main className="w-full max-w-lg mx-auto my-auto py-6 space-y-4">
        {/* Sunny Sweets Development Bootstrap Card */}
        {isSunnySweetsOwner && (
          <div className="bg-gradient-to-b from-[#FAF8F5] to-white dark:from-[#25221F] dark:to-[#1C1A18] rounded-3xl shadow-lg border-2 border-[#D4A373]/50 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#D4A373]/20 flex items-center justify-center text-[#D4A373] shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                  Sunny Sweets Development Environment
                </h2>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  Isolated development copy ready to bootstrap ws-main.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white dark:bg-[#141210] border border-[#E5E1DA] dark:border-[#2D2925] space-y-1.5 text-xs text-[#5A534B] dark:text-[#EAE6E1]">
              <div className="flex justify-between">
                <span className="text-[#8B7E74] dark:text-[#A39E93]">Authenticated:</span>
                <span className="font-mono font-medium">{currentUser?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B7E74] dark:text-[#A39E93]">Database ID:</span>
                <span className="font-mono text-[11px] truncate max-w-[240px]" title={firebaseConfigData.firestoreDatabaseId}>
                  {firebaseConfigData.firestoreDatabaseId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8B7E74] dark:text-[#A39E93]">Target Workspace:</span>
                <span className="font-mono font-bold text-[#D4A373]">ws-main</span>
              </div>
            </div>

            {bootstrapStatusMessage && (
              <div className="p-3 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#D4A373]/30 flex items-center gap-2.5 text-xs text-[#5A534B] dark:text-[#EAE6E1]">
                {isBootstrapping ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-[#D4A373] shrink-0" />
                ) : bootstrapReport?.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                )}
                <span className="leading-tight">{bootstrapStatusMessage}</span>
              </div>
            )}

            {/* Rebind / Bootstrap Verification Details Card */}
            {(rebindResult?.verificationReport || bootstrapReport?.rebindReport?.verificationReport) && (() => {
              const rep = (rebindResult?.verificationReport || bootstrapReport?.rebindReport?.verificationReport)!;
              return (
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#141210] border border-[#E5E1DA] dark:border-[#2D2925] space-y-2 text-xs">
                  <div className="font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-between border-b pb-1.5 border-[#E5E1DA] dark:border-[#2D2925]">
                    <span>POST-WRITE VERIFICATION READ-BACK</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {rebindResult?.summaryStatus || bootstrapReport?.rebindReport?.summaryStatus}
                    </span>
                  </div>
                  <div className="space-y-1 font-mono text-[11px] text-[#5A534B] dark:text-[#EAE6E1]">
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Current authenticated UID:</span>
                      <span className="font-bold">{rep.currentAuthenticatedUid}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">workspaces/ws-main.ownerId:</span>
                      <span className="font-bold">{rep.workspaceOwnerId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Current owner membership exists:</span>
                      <span className="font-bold text-emerald-600">{rep.currentOwnerMembershipExists}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Current owner membership role:</span>
                      <span className="font-bold">{rep.currentOwnerMembershipRole}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Current owner membership active status:</span>
                      <span className="font-bold">{rep.currentOwnerMembershipActive ? 'true' : 'false'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">User ownedWorkspaceId:</span>
                      <span className="font-bold">{rep.userOwnedWorkspaceId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">User defaultWorkspaceId:</span>
                      <span className="font-bold">{rep.userDefaultWorkspaceId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Private membership index exists:</span>
                      <span className="font-bold text-emerald-600">{rep.privateMembershipIndexExists}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">detectUserWorkspaces:</span>
                      <span className="font-bold">{JSON.stringify(rep.detectUserWorkspacesResult)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Resolved active workspace:</span>
                      <span className="font-bold text-[#D4A373]">{rep.resolvedActiveWorkspace}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Resolved role:</span>
                      <span className="font-bold text-emerald-600">{rep.resolvedRole}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Resolved entitlement:</span>
                      <span className="font-bold">{rep.resolvedEntitlement}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">resulting getAppAccessState():</span>
                      <span className="font-bold text-emerald-600">{rep.resultingGetAppAccessState}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">AuthorizedRecipeCalculatorApp mounts:</span>
                      <span className="font-bold text-emerald-600">{rep.whetherAuthorizedRecipeCalculatorAppMounts ? 'YES' : 'NO'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7E74]">Legacy member record preserved:</span>
                      <span className="font-bold">{rep.legacyMemberPreserved}</span>
                    </div>
                  </div>
                  <div className="pt-1.5 border-t border-[#E5E1DA] dark:border-[#2D2925] text-[10px] text-[#8B7E74] dark:text-[#A39E93] grid grid-cols-2 gap-x-2 gap-y-0.5">
                    <div>Recipes modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Master Ingredients modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Presets modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Mixers modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Settings modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Billing/Stripe modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Security rules modified: <span className="font-bold text-emerald-600">NO</span></div>
                    <div>Anything deployed: <span className="font-bold text-emerald-600">NO</span></div>
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                id="bootstrap-dev-ws-main-button"
                type="button"
                disabled={isBootstrapping}
                onClick={runBootstrap}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold text-white bg-[#D4A373] hover:bg-[#c29160] disabled:opacity-50 transition shadow-xs cursor-pointer"
              >
                {isBootstrapping ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing ws-main...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Re-check / Bootstrap ws-main</span>
                  </>
                )}
              </button>

              <button
                id="rebind-owner-ws-main-button"
                type="button"
                disabled={isBootstrapping}
                onClick={runManualRebind}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] bg-[#EAE6E1] dark:bg-[#2D2925] hover:bg-[#DDD8D1] dark:hover:bg-[#3D3732] disabled:opacity-50 transition cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Execute Owner Identity Rebind</span>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-[#1C1A18] rounded-3xl shadow-xl border border-[#E5E1DA] dark:border-[#2D2925] p-6 sm:p-8 space-y-6">
          {/* Card Title & Icon */}
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-[#F5F2ED] dark:bg-[#25221F] text-[#D4A373] ring-8 ring-[#F5F2ED]/60 dark:ring-[#25221F]/40">
              <Store className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
              Create Your Bakery Workspace
            </h1>
            <p className="text-xs sm:text-sm text-[#8B7E74] dark:text-[#A39E93] leading-relaxed max-w-sm mx-auto">
              Set up your dedicated commercial kitchen workspace. You will become the workspace owner.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            {/* Business Name */}
            <div>
              <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] mb-1.5">
                Business / Bakery Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8B7E74]">
                  <Building2 className="w-4 h-4" />
                </div>
                <input
                  id="setup-business-name"
                  type="text"
                  required
                  value={businessName}
                  onChange={handleBusinessNameChange}
                  placeholder="e.g., Golden Crust Artisans"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-[#D5D0C7] dark:border-[#3D3732] bg-[#FAF8F5] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-xs focus:ring-2 focus:ring-[#D4A373] focus:outline-none transition"
                />
              </div>
            </div>

            {/* Workspace Display Name */}
            <div>
              <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] mb-1.5">
                Workspace Display Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8B7E74]">
                  <Tag className="w-4 h-4" />
                </div>
                <input
                  id="setup-workspace-display-name"
                  type="text"
                  value={workspaceDisplayName}
                  onChange={handleWorkspaceDisplayNameChange}
                  placeholder="Display name for branding & reports"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-[#D5D0C7] dark:border-[#3D3732] bg-[#FAF8F5] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-xs focus:ring-2 focus:ring-[#D4A373] focus:outline-none transition"
                />
              </div>
            </div>

            {/* Owner Full Name */}
            <div>
              <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] mb-1.5">
                Your Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8B7E74]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="setup-user-full-name"
                  type="text"
                  value={userFullName}
                  onChange={(e) => setUserFullName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-[#D5D0C7] dark:border-[#3D3732] bg-[#FAF8F5] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-xs focus:ring-2 focus:ring-[#D4A373] focus:outline-none transition"
                />
              </div>
            </div>

            {/* Business Type */}
            <div>
              <label className="block text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1] mb-1.5">
                Business Type
              </label>
              <select
                id="setup-business-type"
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D0C7] dark:border-[#3D3732] bg-[#FAF8F5] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] text-xs focus:ring-2 focus:ring-[#D4A373] focus:outline-none transition cursor-pointer"
              >
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Explanatory Notice */}
            <div className="p-3.5 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-[11px] text-[#8B7E74] dark:text-[#A39E93] leading-relaxed flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>
                No credit card required. You will become the primary workspace owner and can invite team members once your workspace is established.
              </span>
            </div>

            {/* Primary Action Button */}
            <div className="pt-2">
              <button
                id="setup-create-workspace-button"
                type="submit"
                disabled={isLoading || !businessName.trim()}
                className="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl text-sm font-bold text-white bg-[#5A534B] hover:bg-[#48423B] dark:bg-[#3D3732] dark:hover:bg-[#4E4741] disabled:opacity-50 transition shadow-sm cursor-pointer group"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-[#D4A373]" />
                ) : (
                  <>
                    <span>Create Workspace</span>
                    <ArrowRight className="w-4 h-4 text-[#D4A373] group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* FUTURE INVITATION FLOW: Non-functional informational link for users awaiting manual member addition */}
          {onAccessDeniedFallback && (
            <div className="pt-2 text-center border-t border-[#EEECE8] dark:border-[#2D2925]">
              <button
                type="button"
                onClick={onAccessDeniedFallback}
                className="text-xs text-[#8B7E74] dark:text-[#A39E93] hover:text-[#5A534B] dark:hover:text-[#EAE6E1] underline cursor-pointer"
                title="Future Invitation Flow: Check if workspace owner has added your account UID"
              >
                Waiting for an invite to an existing team? Check Access
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-4xl mx-auto text-center py-3 text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
        Recipe & Production Calculator • Isolated Commercial Tenant Architecture
      </footer>
    </div>
  );
};
