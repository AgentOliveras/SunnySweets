import React, { useState } from 'react';
import {
  ShieldAlert,
  LogOut,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { auth, logoutUser } from '../services/firebase';
import { store } from '../services/store';

interface AccessDeniedScreenProps {
  onAccessGranted?: () => void;
}

export const AccessDeniedScreen: React.FC<AccessDeniedScreenProps> = ({ onAccessGranted }) => {
  const [isChecking, setIsChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState(false);

  const currentUser = auth.currentUser;
  const activeWorkspace = store.getActiveWorkspace();

  const handleSignOut = async () => {
    try {
      setIsChecking(true);
      await logoutUser();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to sign out.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleRecheckAccess = async () => {
    if (!currentUser || !currentUser.uid) return;
    try {
      setIsChecking(true);
      setErrorMessage(null);
      const authorized = await store.validateMembershipForUser(currentUser.uid);
      if (authorized && store.isAuthorized()) {
        if (onAccessGranted) {
          onAccessGranted();
        }
      } else {
        setErrorMessage('Access still pending: Your account has not yet been assigned an authorized role in this workspace.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Verification check failed.');
    } finally {
      setIsChecking(false);
    }
  };

  const copyUidToClipboard = () => {
    if (currentUser?.uid) {
      navigator.clipboard.writeText(currentUser.uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-4 sm:p-6 select-none font-sans">
      <div className="w-full max-w-lg bg-white dark:bg-[#1C1A18] rounded-2xl shadow-xl border border-[#E5E1DA] dark:border-[#2D2925] overflow-hidden">
        {/* Top Accent Strip */}
        <div className="h-1.5 bg-[#D4A373] w-full" />

        <div className="p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="inline-flex p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 ring-8 ring-amber-50/50 dark:ring-amber-950/20">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
                Account Not Authorized
              </h1>
              <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] max-w-md mx-auto leading-relaxed">
                Your Google account is authenticated, but has not been granted workspace membership.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Account Details Box */}
          <div className="rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#EEECE8] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93] font-medium">Authenticated Account</span>
              <span className="font-semibold text-[#5A534B] dark:text-[#EAE6E1] truncate max-w-[220px]">
                {currentUser?.email || 'Unknown User'}
              </span>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-[#EEECE8] dark:border-[#332F2B]">
              <span className="text-[#8B7E74] dark:text-[#A39E93] font-medium">Firebase UID</span>
              <div className="flex items-center gap-1.5">
                <code className="font-mono text-[11px] text-[#5A534B] dark:text-[#EAE6E1] bg-white dark:bg-[#1C1A18] px-2 py-0.5 rounded border border-[#EEECE8] dark:border-[#332F2B]">
                  {currentUser?.uid ? `${currentUser.uid.substring(0, 10)}...${currentUser.uid.substring(currentUser.uid.length - 6)}` : 'N/A'}
                </code>
                <button
                  type="button"
                  onClick={copyUidToClipboard}
                  title="Copy full UID"
                  className="p-1 rounded hover:bg-white dark:hover:bg-[#1C1A18] text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] transition cursor-pointer"
                >
                  {copiedUid ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#8B7E74] dark:text-[#A39E93] font-medium">Target Workspace</span>
              <span className="font-mono text-[11px] font-semibold text-[#5A534B] dark:text-[#EAE6E1]">
                {activeWorkspace?.id || 'ws-main'}
              </span>
            </div>
          </div>

          {/* Access Instructions */}
          <div className="text-xs text-[#8B7E74] dark:text-[#A39E93] leading-relaxed space-y-1">
            <p>
              To use the Recipe & Production Calculator, contact the bakery owner or workspace administrator to add your email and UID to the authorized member roster.
            </p>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={handleRecheckAccess}
              disabled={isChecking}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-[#D4A373] text-white hover:bg-[#C49363] disabled:opacity-50 transition shadow-sm cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Checking...' : 'Check Access Again'}</span>
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={isChecking}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] hover:bg-[#E5E1DA] dark:hover:bg-[#332F2B] disabled:opacity-50 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#F5F2ED]/60 dark:bg-[#141210]/60 border-t border-[#EEECE8] dark:border-[#2D2925] text-center">
          <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
            Sunny Sweets Commercial Platform • Zero-Trust UID Access Control
          </p>
        </div>
      </div>
    </div>
  );
};
