import React, { useState } from 'react';
import { Lock, X, ArrowRight, ShieldCheck, AlertCircle, RotateCw } from 'lucide-react';
import {
  verifyManagementPin,
  loadManagementLockConfig,
  ManagementLockConfig,
} from '../utils/managementLock';

interface ManagementLockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlockSuccess: () => void;
  lockConfig?: ManagementLockConfig;
  verificationBlockedReason?: string | null;
  onRetryPolicySync?: () => Promise<boolean | void> | void;
}

export const ManagementLockModal: React.FC<ManagementLockModalProps> = ({
  isOpen,
  onClose,
  onUnlockSuccess,
  lockConfig,
  verificationBlockedReason,
  onRetryPolicySync,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRetryingSync, setIsRetryingSync] = useState(false);

  if (!isOpen) return null;

  const isBlocked = Boolean(verificationBlockedReason);

  const handleRetrySync = async () => {
    if (!onRetryPolicySync || isRetryingSync) return;
    setIsRetryingSync(true);
    setError(null);
    try {
      await onRetryPolicySync();
    } finally {
      setIsRetryingSync(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isBlocked) {
      setError(
        verificationBlockedReason ||
          'Workspace Management PIN policy cannot be verified right now. Please retry sync.'
      );
      return;
    }

    if (!pin.trim()) {
      setError('Please enter the management PIN.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const effectiveConfig = lockConfig ?? loadManagementLockConfig();
      const isValid = await verifyManagementPin(pin, effectiveConfig);

      if (isValid) {
        setPin('');
        setError(null);
        onUnlockSuccess();
      } else {
        setError('Incorrect PIN. Please try again.');
        setPin('');
      }
    } catch {
      setError('Verification error. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      id="management-lock-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs select-none"
    >
      <div
        id="management-lock-modal"
        className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl border border-stone-200 dark:border-zinc-800 shadow-2xl p-6 sm:p-8 relative animate-in fade-in zoom-in duration-150"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={() => {
            setPin('');
            setError(null);
            onClose();
          }}
          className="absolute top-5 right-5 p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-3">
          {/* Lock Icon */}
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-700 dark:text-amber-400">
            <Lock className="w-7 h-7" />
          </div>

          <h3 className="text-xl font-serif font-bold text-stone-900 dark:text-zinc-100">
            Management Mode
          </h3>
          <p className="text-xs text-stone-600 dark:text-zinc-400 leading-relaxed max-w-xs mx-auto">
            Enter the bakery management PIN to access recipes, equipment, costing, and administrative tools.
          </p>
        </div>

        {isBlocked && (
          <div
            id="management-pin-hydration-blocked"
            className="mt-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 text-xs space-y-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span className="leading-relaxed">{verificationBlockedReason}</span>
            </div>
            {onRetryPolicySync && (
              <button
                id="management-pin-retry-sync-btn"
                type="button"
                disabled={isRetryingSync}
                onClick={handleRetrySync}
                className="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isRetryingSync ? 'animate-spin' : ''}`} />
                <span>{isRetryingSync ? 'Verifying Policy...' : 'Retry Policy Sync'}</span>
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            id="management-pin-error"
            className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          data-form-type="other"
          className="mt-6 space-y-4"
        >
          <div>
            <label
              htmlFor="management-pin-input"
              className="block text-xs font-bold uppercase tracking-wider text-stone-600 dark:text-zinc-400 mb-2 text-center"
            >
              Enter Management PIN
            </label>
            <input
              id="management-pin-input"
              name="sunny-sweets-ephemeral-mgmt-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              disabled={isBlocked}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              placeholder="• • • •"
              className="w-full text-center text-2xl tracking-[0.4em] font-mono py-3 px-4 rounded-xl border-2 border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:border-amber-500 disabled:opacity-50 transition"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setPin('');
                setError(null);
                onClose();
              }}
              className="flex-1 py-3 px-4 rounded-xl text-xs font-bold text-stone-700 dark:text-zinc-300 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="management-pin-unlock-btn"
              type="submit"
              disabled={isVerifying || !pin || isBlocked}
              className="flex-1 py-3 px-4 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              <span>{isVerifying ? 'Checking...' : 'Unlock'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        <div className="mt-5 pt-4 border-t border-stone-100 dark:border-zinc-800 text-center">
          <p className="text-[11px] text-stone-500 dark:text-zinc-500 flex items-center justify-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-stone-400 dark:text-zinc-500" />
            <span>Workspace roles & Firestore security remain authoritative</span>
          </p>
        </div>
      </div>
    </div>
  );
};
