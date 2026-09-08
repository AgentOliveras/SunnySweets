import React, { useState } from 'react';
import {
  ChefHat,
  Scale,
  Sparkles,
  AlertCircle,
  ShieldCheck,
  Calculator,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { signInWithGoogle } from '../services/firebase';

interface SignInScreenProps {
  onSignInSuccess?: () => void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ onSignInSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const user = await signInWithGoogle();
      if (user && onSignInSuccess) {
        onSignInSuccess();
      }
    } catch (err: any) {
      console.error('Sign-in failure:', err);
      // Suppress standard popup-closed error or display friendly message
      if (err.code === 'auth/popup-closed-by-user') {
        setErrorMessage('Sign-in window was closed. Please try again.');
      } else {
        setErrorMessage(err.message || 'Authentication failed. Please verify your connection.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex flex-col justify-between p-4 sm:p-6 lg:p-8 font-sans selection:bg-[#D4A373]/20">
      {/* Top Brand Bar */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#5A534B] dark:bg-[#3D3732] flex items-center justify-center text-[#D4A373] shadow-xs">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight leading-tight">
              Sunny Sweets
            </div>
            <div className="text-[10px] uppercase font-semibold tracking-wider text-[#8B7E74] dark:text-[#A39E93] leading-tight">
              Commercial Bakery
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden sm:inline">Enterprise Access Control</span>
        </div>
      </header>

      {/* Main Authentication Card */}
      <main className="w-full max-w-md mx-auto my-auto py-8">
        <div className="bg-white dark:bg-[#1C1A18] rounded-3xl shadow-xl border border-[#E5E1DA] dark:border-[#2D2925] p-6 sm:p-8 space-y-6">
          {/* Card Header */}
          <div className="text-center space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-[#F5F2ED] dark:bg-[#25221F] text-[#D4A373] ring-8 ring-[#F5F2ED]/60 dark:ring-[#25221F]/40">
              <Scale className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
                Recipe & Production Platform
              </h1>
              <p className="text-xs sm:text-sm text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
                Proprietary commercial batch formulation, unit scaling, and guided mixing controls.
              </p>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Sign In Action */}
          <div className="space-y-3 pt-2">
            <button
              id="google-signin-button"
              type="button"
              onClick={handleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl text-sm font-bold text-white bg-[#5A534B] hover:bg-[#48423B] dark:bg-[#3D3732] dark:hover:bg-[#4E4741] disabled:opacity-50 transition shadow-sm cursor-pointer group"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>{isLoading ? 'Verifying with Google...' : 'Sign in with Google'}</span>
              <ArrowRight className="w-4 h-4 text-[#D4A373] group-hover:translate-x-0.5 transition-transform" />
            </button>

            <p className="text-center text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
              Authorized bakery personnel only. Use your registered Google account.
            </p>
          </div>

          {/* Feature Pillars */}
          <div className="pt-4 border-t border-[#EEECE8] dark:border-[#2D2925] space-y-2.5">
            <div className="text-[11px] uppercase font-bold tracking-wider text-[#8B7E74] dark:text-[#A39E93]">
              Platform Capabilities
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-[#5A534B] dark:text-[#EAE6E1]">
              <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#F5F2ED]/60 dark:bg-[#25221F]/60">
                <Calculator className="w-3.5 h-3.5 text-[#D4A373] shrink-0" />
                <span>Commercial batch scaling with ingredient waste factors</span>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#F5F2ED]/60 dark:bg-[#25221F]/60">
                <Layers className="w-3.5 h-3.5 text-[#D4A373] shrink-0" />
                <span>Equipment capacity validation & multi-bowl splitting</span>
              </div>
              <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#F5F2ED]/60 dark:bg-[#25221F]/60">
                <Sparkles className="w-3.5 h-3.5 text-[#D4A373] shrink-0" />
                <span>Step-by-step guided bakery floor production checklist</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto text-center py-4 text-xs text-[#8B7E74] dark:text-[#A39E93] space-y-1">
        <div>Sunny Sweets Commercial Platform • Proprietary & Confidential</div>
        <div className="text-[10px] text-[#8B7E74]/70 dark:text-[#A39E93]/70">
          Commercial subscriptions and team workspace management powered by Google Cloud & Firebase.
        </div>
      </footer>
    </div>
  );
};
