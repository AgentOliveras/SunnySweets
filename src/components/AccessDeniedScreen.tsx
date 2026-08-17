import React, { useState } from 'react';
import {
  ShieldAlert,
  KeyRound,
  Mail,
  LogIn,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ChevronRight,
  Lock,
  Sparkles,
} from 'lucide-react';
import { auth, signInWithGoogle } from '../services/firebase';
import { store } from '../services/store';

interface AccessDeniedScreenProps {
  onAccessGranted: () => void;
}

export const AccessDeniedScreen: React.FC<AccessDeniedScreenProps> = ({ onAccessGranted }) => {
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedOwnerEmail, setCopiedOwnerEmail] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const activeWorkspace = store.getActiveWorkspace();
  const currentUser = auth.currentUser;

  const handleGoogleSignIn = async () => {
    try {
      setIsVerifying(true);
      setFeedback(null);
      await signInWithGoogle();
      if (store.isAuthorized()) {
        setFeedback({ type: 'success', text: 'Google Authentication successful! Access granted.' });
        setTimeout(() => onAccessGranted(), 600);
      } else {
        const email = auth.currentUser?.email || 'Your account';
        setFeedback({
          type: 'error',
          text: `Access Denied: ${email} is not listed as an authorized member (Owner, Editor, or Viewer) of this workspace.`,
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Failed to sign in with Google.' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    const cleanEmail = emailInput.trim().toLowerCase();

    setIsVerifying(true);
    setFeedback(null);

    store.setSessionUserEmail(cleanEmail);

    if (store.isAuthorized()) {
      const role = store.getUserRole();
      setFeedback({
        type: 'success',
        text: `Authorized as ${role?.toUpperCase()}! Access granted. Loading workspace...`,
      });
      setTimeout(() => onAccessGranted(), 600);
    } else {
      setFeedback({
        type: 'error',
        text: `Access Denied: "${cleanEmail}" is not authorized. Please check your spelling or contact the workspace owner.`,
      });
    }
    setIsVerifying(false);
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim()) return;

    setIsVerifying(true);
    setFeedback(null);

    const emailToUse = currentUser?.email || emailInput.trim() || 'authorized-guest@bakery.com';
    const success = await store.joinWorkspaceByCode(codeInput.trim(), emailToUse);

    if (success && store.isAuthorized()) {
      setFeedback({
        type: 'success',
        text: 'Valid Access Code! You have been granted Editor access to this workspace.',
      });
      setTimeout(() => onAccessGranted(), 600);
    } else {
      setFeedback({
        type: 'error',
        text: 'Invalid Workspace Code. Please verify the code with the workspace owner.',
      });
    }
    setIsVerifying(false);
  };

  const ownerEmailDisplay = activeWorkspace?.ownerEmail || 'owner@bakery.com';

  const handleCopyOwnerEmail = () => {
    navigator.clipboard.writeText(ownerEmailDisplay);
    setCopiedOwnerEmail(true);
    setTimeout(() => setCopiedOwnerEmail(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 transition-colors duration-200">
      <div className="w-full max-w-xl bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-3xl shadow-2xl p-6 sm:p-10 relative overflow-hidden">
        {/* Accent top banner */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#D4A373] via-[#C49363] to-[#8B7E74]" />

        {/* Lock Shield Icon Header */}
        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#FAF3E0] dark:bg-[#2C2416] border border-[#E6C875] dark:border-[#8A6D24] text-[#C49363] dark:text-[#EED285] shadow-xs">
            <Lock className="w-8 h-8 text-[#D4A373]" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs font-bold uppercase tracking-wider mb-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Restricted Workspace</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[#5A534B] dark:text-[#EAE6E1]">
              Authorized Access Required
            </h1>
            <p className="text-xs sm:text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto mt-2 leading-relaxed">
              This application is restricted to authorized team members (<strong>Owners</strong>, <strong>Editors</strong>, and <strong>Viewers</strong>). Unauthenticated or unauthorized users cannot open or use this workspace.
            </p>
          </div>
        </div>

        {/* Feedback Alert Banner */}
        {feedback && (
          <div
            className={`p-4 rounded-2xl border text-xs sm:text-sm font-medium flex items-start gap-3 mb-6 animate-in fade-in slide-in-from-top-2 duration-200 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Interactive Option 1: Google Sign In */}
        <div className="space-y-6">
          <button
            onClick={handleGoogleSignIn}
            disabled={isVerifying}
            className="w-full py-3.5 px-4 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] dark:hover:bg-[#4D4640] text-white font-bold rounded-2xl text-sm transition-all duration-150 flex items-center justify-center gap-3 cursor-pointer shadow-md hover:shadow-lg disabled:opacity-60"
          >
            <LogIn className="w-4 h-4 text-[#D4A373]" />
            <span>Sign In with Google Account</span>
          </button>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-[#EEECE8] dark:border-[#332F2B] w-full" />
            <span className="bg-white dark:bg-[#1E1B18] px-3 text-[11px] font-bold text-[#A39E93] uppercase tracking-wider">
              Or Verify Authorized Email
            </span>
          </div>

          {/* Interactive Option 2: Verify Authorized Email */}
          <form onSubmit={handleVerifyEmail} className="space-y-2">
            <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
              Authorized Email Address
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="w-4 h-4 absolute left-3.5 top-3 text-[#A39E93]" />
                <input
                  type="email"
                  required
                  placeholder="e.g. jaoliveras@gmail.com, baker@mainstreet.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 text-xs sm:text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>
              <button
                type="submit"
                disabled={isVerifying || !emailInput.trim()}
                className="bg-[#D4A373] hover:bg-[#C49363] text-white font-bold px-4 py-2.5 rounded-xl text-xs transition cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
              >
                Verify
              </button>
            </div>
            <p className="text-[11px] text-[#A39E93]">
              If the owner added your email to the workspace, enter it above to unlock access.
            </p>
          </form>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-[#EEECE8] dark:border-[#332F2B] w-full" />
            <span className="bg-white dark:bg-[#1E1B18] px-3 text-[11px] font-bold text-[#A39E93] uppercase tracking-wider">
              Or Enter Workspace Join Code
            </span>
          </div>

          {/* Interactive Option 3: Enter Workspace Code */}
          <form onSubmit={handleCodeSubmit} className="space-y-2">
            <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
              Workspace Access Code
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="w-4 h-4 absolute left-3.5 top-3 text-[#A39E93]" />
                <input
                  type="text"
                  required
                  placeholder="e.g. BAKERY-MAIN"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 text-xs sm:text-sm font-mono tracking-wider uppercase bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>
              <button
                type="submit"
                disabled={isVerifying || !codeInput.trim()}
                className="bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-4 py-2.5 rounded-xl text-xs transition cursor-pointer shadow-xs disabled:opacity-50 shrink-0"
              >
                Unlock
              </button>
            </div>
          </form>
        </div>

        {/* Workspace Owner Contact Info */}
        <div className="mt-8 pt-6 border-t border-[#EEECE8] dark:border-[#332F2B] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#8B7E74] dark:text-[#A39E93]">
          <div>
            <span>Workspace: <strong>{activeWorkspace?.name || 'Main Bakery Workspace'}</strong></span>
          </div>
          <button
            onClick={handleCopyOwnerEmail}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F9F8F6] dark:bg-[#25221F] hover:bg-[#E5E1DA]/50 dark:hover:bg-[#332F2B] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl transition cursor-pointer text-[11px] font-medium"
          >
            {copiedOwnerEmail ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Owner email copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[#D4A373]" />
                <span>Contact Owner ({ownerEmailDisplay})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
