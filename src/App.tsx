import React, { useState, useEffect } from 'react';
import { AlertTriangle, RotateCw, LogOut } from 'lucide-react';
import { store } from './services/store';
import { auth, logoutUser } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { LoadingAuthenticationScreen } from './components/LoadingAuthenticationScreen';
import { SignInScreen } from './components/SignInScreen';
import { AccessDeniedScreen } from './components/AccessDeniedScreen';
import { NewWorkspaceSetupScreen } from './components/NewWorkspaceSetupScreen';
import { EntitlementScreen } from './components/EntitlementScreens';
import { AuthorizedRecipeCalculatorApp } from './components/AuthorizedRecipeCalculatorApp';
import { BillingSuccessScreen } from './components/BillingSuccessScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppAccessState, EntitlementEvaluation } from './types/billing';

export default function App() {
  const [accessState, setAccessState] = useState<AppAccessState>(store.getAppAccessState());
  const [evaluation, setEvaluation] = useState<EntitlementEvaluation>(store.getEntitlementEvaluation());
  const [canAccess, setCanAccess] = useState<boolean>(store.canAccessApp());
  const [showAccessDeniedScreen, setShowAccessDeniedScreen] = useState<boolean>(false);

  const syncStateFromStore = () => {
    setAccessState(store.getAppAccessState());
    setEvaluation(store.getEntitlementEvaluation());
    setCanAccess(store.canAccessApp());
  };

  const handleRetry = async () => {
    await store.recheckAccess();
    syncStateFromStore();
  };

  useEffect(() => {
    store.initFirebaseSync();

    const unsubAuth = onAuthStateChanged(auth, () => {
      syncStateFromStore();
    });

    const unsubStore = store.subscribe(() => {
      syncStateFromStore();
    });

    return () => {
      unsubAuth();
      unsubStore();
    };
  }, []);

  // Section 9: Explicit Initialization/Infrastructure Error Screen with Retry
  if (accessState === 'INITIALIZATION_ERROR') {
    return (
      <div
        id="app-initialization-error"
        className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-6 font-sans select-none"
      >
        <div className="max-w-md w-full bg-white dark:bg-[#1C1A18] rounded-2xl p-6 sm:p-8 border border-red-200 dark:border-red-900/40 shadow-lg text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 flex items-center justify-center text-red-600 dark:text-red-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-[#5A534B] dark:text-[#EAE6E1]">
              Unable to initialize the application.
            </h2>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
              {store.getInitializationError() ||
                'An infrastructure or network service failure prevented application bootstrap.'}
            </p>
          </div>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
            <button
              id="initialization-retry-button"
              onClick={handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#5A534B] hover:bg-[#48423C] dark:bg-[#D4A373] dark:text-[#1E1B18] transition-colors shadow-xs cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
              <span>Retry Connection</span>
            </button>
            {auth.currentUser && (
              <button
                id="initialization-signout-button"
                type="button"
                onClick={async () => {
                  store.clearSession();
                  await logoutUser();
                  syncStateFromStore();
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-[#5A534B] dark:text-[#EAE6E1] bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] hover:bg-[#EAE6E1] transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Section 16: Safe Internal Billing Success Route (Phase 1.4)
  // CRITICAL: Does NOT grant entitlement or mark subscription active; webhook reconciles in Phase 1.5.
  const isBillingSuccessRoute =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/billing/success') ||
      (window.location.pathname === '/' && new URLSearchParams(window.location.search).has('session_id')));

  if (isBillingSuccessRoute) {
    const searchParams = new URLSearchParams(window.location.search);
    const sessionId = searchParams.get('session_id');
    const workspaceId = searchParams.get('workspace_id') || store.getActiveWorkspaceId();

    return (
      <BillingSuccessScreen
        sessionId={sessionId}
        workspaceId={workspaceId}
        onReturnToApp={() => {
          if (typeof window !== 'undefined' && window.history) {
            window.history.pushState({}, '', '/');
          }
          syncStateFromStore();
        }}
      />
    );
  }

  // 1. Loading States (Auth -> Workspace -> Billing)
  if (accessState === 'AUTH_LOADING') {
    return (
      <LoadingAuthenticationScreen
        title="Sunny Sweets Platform"
        message="Verifying identity & authentication..."
        onRetry={handleRetry}
      />
    );
  }

  if (accessState === 'WORKSPACE_LOADING') {
    return (
      <LoadingAuthenticationScreen
        title="Sunny Sweets Platform"
        message="Discovering authorized workspace memberships..."
        onRetry={handleRetry}
      />
    );
  }

  if (accessState === 'BILLING_LOADING') {
    return (
      <LoadingAuthenticationScreen
        title="Sunny Sweets Platform"
        message="Evaluating subscription & workspace entitlements..."
        onRetry={handleRetry}
      />
    );
  }

  // 2. Signed-Out State
  if (accessState === 'SIGNED_OUT' || !auth.currentUser) {
    return <SignInScreen />;
  }

  // 3. Authenticated but No Workspace Membership -> Route to New Workspace Setup
  if (accessState === 'NO_WORKSPACE' || !store.isAuthorized()) {
    if (showAccessDeniedScreen) {
      return (
        <AccessDeniedScreen
          onAccessGranted={() => {
            setShowAccessDeniedScreen(false);
            syncStateFromStore();
          }}
          onBackToSetup={() => {
            setShowAccessDeniedScreen(false);
          }}
        />
      );
    }

    return (
      <NewWorkspaceSetupScreen
        onWorkspaceCreated={async (workspaceId: string) => {
          await store.setWorkspaceAfterCreation(workspaceId);
          syncStateFromStore();
        }}
        onAccessDeniedFallback={() => {
          setShowAccessDeniedScreen(true);
        }}
      />
    );
  }

  // 4. Inactive / Restricted Entitlement (Calculator does NOT mount)
  if (
    !canAccess ||
    accessState === 'NO_ENTITLEMENT' ||
    accessState === 'SUBSCRIPTION_PAST_DUE' ||
    accessState === 'SUBSCRIPTION_EXPIRED'
  ) {
    return (
      <EntitlementScreen
        accessState={accessState}
        evaluation={evaluation}
        onRefresh={handleRetry}
      />
    );
  }

  // 5. Authorized State: (AUTHORIZED_INTERNAL | TRIAL_ACTIVE | SUBSCRIPTION_ACTIVE | COMPLIMENTARY_ACTIVE)
  // Mount full Recipe & Production Calculator
  return (
    <ErrorBoundary>
      <AuthorizedRecipeCalculatorApp />
    </ErrorBoundary>
  );
}
