import React, { useEffect, useState } from 'react';
import {
  Lock,
  Unlock,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  CloudUpload,
  RotateCw,
} from 'lucide-react';
import { AccessRole } from '../types';
import { store } from '../services/store';
import {
  verifyManagementPin,
  generateSalt,
  hashPin,
  ManagementLockConfig,
  EffectiveManagementLockResolution,
} from '../utils/managementLock';

interface ManagementLockSettingsProps {
  userRole?: AccessRole | null;
  onNotification?: (msg: string) => void;
  onLockConfigured?: (config: ManagementLockConfig) => void;
}

export const ManagementLockSettings: React.FC<ManagementLockSettingsProps> = ({
  userRole,
  onNotification,
  onLockConfigured,
}) => {
  const [resolution, setResolution] = useState<EffectiveManagementLockResolution>(() =>
    store.getEffectiveManagementLockResolution()
  );
  const [mode, setMode] = useState<'view' | 'set' | 'change' | 'disable' | 'promote'>('view');

  // Form states
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setResolution(store.getEffectiveManagementLockResolution());
    const unsub = store.subscribe(() => {
      setResolution(store.getEffectiveManagementLockResolution());
    });
    return () => unsub();
  }, []);

  const effectiveRole = userRole !== undefined ? userRole : store.getUserRole();
  const isOwner = effectiveRole === 'owner';
  const activeConfig = resolution.effectiveConfig;

  const resetForm = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setMode('view');
  };

  const handleRetrySync = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const ok = await store.retryWorkspaceLockHydration();
      if (!ok) {
        setError('Unable to reach Cloud Firestore to verify workspace lock policy. Please check Wi-Fi.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEnableNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isOwner) {
      setError('Permission denied: Only the workspace owner can configure the Management Mode PIN.');
      return;
    }

    if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
      setError('PIN must be 4 to 8 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PIN and Confirm PIN do not match.');
      return;
    }

    setIsProcessing(true);
    try {
      const salt = generateSalt();
      const hash = await hashPin(newPin, salt);
      const savedPolicy = await store.saveWorkspaceManagementLock(
        {
          enabled: true,
          hash,
          salt,
        },
        effectiveRole
      );

      onLockConfigured?.(savedPolicy);
      setSuccess('Shared workspace Management Mode PIN has been enabled across all devices.');
      onNotification?.('Shared Management Mode PIN enabled.');
      resetForm();
    } catch (err: any) {
      setError(err?.message || 'Failed to save workspace PIN. Please check your connection and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePromoteLocalPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isOwner) {
      setError('Permission denied: Only the workspace owner can promote the Management Mode PIN.');
      return;
    }

    setIsProcessing(true);
    try {
      const savedPolicy = await store.promoteLocalManagementLockToWorkspace(
        currentPin,
        effectiveRole
      );
      onLockConfigured?.(savedPolicy);
      setSuccess(
        'Existing device PIN has been promoted to the shared workspace policy. All tablets and devices in this workspace will now enforce this PIN.'
      );
      onNotification?.('Device PIN promoted to shared workspace policy.');
      resetForm();
    } catch (err: any) {
      setError(err?.message || 'Failed to promote local PIN to workspace.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isOwner) {
      setError('Permission denied: Only the workspace owner can modify the Management Mode PIN.');
      return;
    }

    setIsProcessing(true);
    try {
      const isCurrentValid = await verifyManagementPin(currentPin, activeConfig);
      if (!isCurrentValid) {
        setError('Current PIN is incorrect.');
        setIsProcessing(false);
        return;
      }

      if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
        setError('New PIN must be 4 to 8 digits.');
        setIsProcessing(false);
        return;
      }
      if (newPin !== confirmPin) {
        setError('New PIN and Confirm PIN do not match.');
        setIsProcessing(false);
        return;
      }

      const salt = generateSalt();
      const hash = await hashPin(newPin, salt);
      const savedPolicy = await store.saveWorkspaceManagementLock(
        {
          enabled: true,
          hash,
          salt,
        },
        effectiveRole
      );

      onLockConfigured?.(savedPolicy);
      setSuccess('Shared workspace Management PIN updated successfully.');
      onNotification?.('Management PIN updated.');
      resetForm();
    } catch (err: any) {
      setError(err?.message || 'Failed to update PIN. Please verify connection and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisableLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isOwner) {
      setError('Permission denied: Only the workspace owner can disable the Management Mode PIN.');
      return;
    }

    setIsProcessing(true);
    try {
      const isCurrentValid = await verifyManagementPin(currentPin, activeConfig);
      if (!isCurrentValid) {
        setError('Incorrect PIN. Cannot disable lock without valid PIN.');
        setIsProcessing(false);
        return;
      }

      const savedPolicy = await store.saveWorkspaceManagementLock(
        {
          enabled: false,
          hash: '',
          salt: '',
        },
        effectiveRole
      );

      onLockConfigured?.(savedPolicy);
      setSuccess('Management Mode lock has been disabled for this workspace.');
      onNotification?.('Management Mode lock disabled.');
      resetForm();
    } catch (err: any) {
      setError(err?.message || 'Failed to disable lock.');
    } finally {
      setIsProcessing(false);
    }
  };

  const statusBadgeLabel = resolution.isVerificationBlocked
    ? 'Unverified (Fail-Closed)'
    : resolution.status === 'PROTECTED_WORKSPACE'
    ? 'Protected • Shared Workspace'
    : resolution.status === 'PROTECTED_LOCAL_LEGACY'
    ? 'Protected • This Device Only'
    : 'Disabled';

  return (
    <div
      id="settings-management-lock-card"
      className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
              resolution.isLockActive
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                : 'bg-stone-50 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 text-stone-500 dark:text-zinc-400'
            }`}
          >
            {resolution.isLockActive ? (
              <Lock className="w-5 h-5" />
            ) : (
              <Unlock className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Management Mode Lock
              </h3>
              <span
                id="settings-management-lock-status-badge"
                className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  resolution.isVerificationBlocked
                    ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                    : resolution.isLockActive
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                    : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400'
                }`}
              >
                {statusBadgeLabel}
              </span>
            </div>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
              Shared workspace security guard requiring PIN entry on every transition into Management Mode on production floor tablets and shared devices.
            </p>
          </div>
        </div>
      </div>

      {resolution.status === 'PROTECTED_LOCAL_LEGACY' && isOwner && (
        <div
          id="settings-local-pin-promotion-banner"
          className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1.5"
        >
          <div className="font-bold">Local Device PIN Detected (Not Yet Shared to Workspace)</div>
          <p className="leading-relaxed text-amber-800 dark:text-amber-300/90">
            This browser currently enforces a local PIN that is not yet synced to your other bakery tablets or phones. Promote this PIN below to enforce it across every device in this workspace.
          </p>
        </div>
      )}

      {resolution.isVerificationBlocked && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              {resolution.blockReason ||
                'Workspace Management PIN policy is still syncing from Cloud Firestore.'}
            </span>
          </div>
          <button
            id="settings-retry-lock-sync-btn"
            type="button"
            disabled={isProcessing}
            onClick={handleRetrySync}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 cursor-pointer transition"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
            <span>Retry Sync</span>
          </button>
        </div>
      )}

      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Non-Owner Read-Only Notice */}
      {!isOwner ? (
        <div
          id="settings-management-lock-readonly-notice"
          className="p-3.5 rounded-xl bg-stone-50 dark:bg-zinc-800/70 border border-stone-200 dark:border-zinc-700 text-xs text-stone-700 dark:text-zinc-300"
        >
          Only the workspace owner can enable, promote, change, or disable the Management Mode PIN policy.
        </div>
      ) : (
        <>
          {/* Owner Main View Buttons */}
          {mode === 'view' && !resolution.isVerificationBlocked && (
            <div className="pt-1 flex flex-wrap gap-2.5">
              {!resolution.isLockActive ? (
                <button
                  id="settings-enable-lock-btn"
                  type="button"
                  onClick={() => {
                    resetForm();
                    setMode('set');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition cursor-pointer shadow-xs"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Enable Workspace PIN Lock</span>
                </button>
              ) : (
                <>
                  {resolution.status === 'PROTECTED_LOCAL_LEGACY' && (
                    <button
                      id="settings-promote-local-pin-btn"
                      type="button"
                      onClick={() => {
                        resetForm();
                        setMode('promote');
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition cursor-pointer shadow-xs"
                    >
                      <CloudUpload className="w-3.5 h-3.5" />
                      <span>Promote Device PIN to Workspace</span>
                    </button>
                  )}
                  <button
                    id="settings-change-pin-btn"
                    type="button"
                    onClick={() => {
                      resetForm();
                      setMode('change');
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-stone-800 dark:text-zinc-200 text-xs font-bold transition cursor-pointer border border-stone-200 dark:border-zinc-700"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Change PIN</span>
                  </button>
                  <button
                    id="settings-disable-lock-btn"
                    type="button"
                    onClick={() => {
                      resetForm();
                      setMode('disable');
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-bold transition cursor-pointer border border-red-200 dark:border-red-900"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Disable Lock</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Set Initial PIN Form */}
          {mode === 'set' && (
            <form
              onSubmit={handleEnableNewPin}
              autoComplete="off"
              data-form-type="other"
              className="space-y-3 pt-2 border-t border-stone-100 dark:border-zinc-800"
            >
              <h4 className="text-xs font-bold text-stone-800 dark:text-zinc-200">
                Set Shared Workspace Management Mode PIN (4-8 digits)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                    New PIN
                  </label>
                  <input
                    id="set-pin-input"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="4-8 digits"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                    Confirm New PIN
                  </label>
                  <input
                    id="confirm-pin-input"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    placeholder="Re-enter PIN"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  id="save-new-pin-btn"
                  type="submit"
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-xs"
                >
                  {isProcessing ? 'Saving...' : 'Save & Enable Lock'}
                </button>
              </div>
            </form>
          )}

          {/* Promote Existing Device PIN Form */}
          {mode === 'promote' && (
            <form
              onSubmit={handlePromoteLocalPin}
              autoComplete="off"
              data-form-type="other"
              className="space-y-3 pt-2 border-t border-stone-100 dark:border-zinc-800"
            >
              <h4 className="text-xs font-bold text-stone-800 dark:text-zinc-200">
                Confirm Current Device PIN to Sync Across All Workspace Devices
              </h4>
              <div>
                <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                  Enter Current Device PIN
                </label>
                <input
                  id="promote-current-pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="Current PIN"
                  className="w-full max-w-xs px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  id="confirm-promote-local-pin-btn"
                  type="submit"
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-xs"
                >
                  {isProcessing ? 'Syncing to Workspace...' : 'Promote PIN to Workspace'}
                </button>
              </div>
            </form>
          )}

          {/* Change PIN Form */}
          {mode === 'change' && (
            <form
              onSubmit={handleChangePin}
              autoComplete="off"
              data-form-type="other"
              className="space-y-3 pt-2 border-t border-stone-100 dark:border-zinc-800"
            >
              <h4 className="text-xs font-bold text-stone-800 dark:text-zinc-200">
                Change Shared Workspace Management Mode PIN
              </h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                    Current PIN
                  </label>
                  <input
                    id="change-current-pin-input"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value)}
                    placeholder="Current PIN"
                    className="w-full max-w-xs px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                      New PIN
                    </label>
                    <input
                      id="change-new-pin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value)}
                      placeholder="New 4-8 digits"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                      Confirm New PIN
                    </label>
                    <input
                      id="change-confirm-pin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value)}
                      placeholder="Re-enter new PIN"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  id="update-pin-btn"
                  type="submit"
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-xs"
                >
                  {isProcessing ? 'Updating...' : 'Update PIN'}
                </button>
              </div>
            </form>
          )}

          {/* Disable Lock Form */}
          {mode === 'disable' && (
            <form
              onSubmit={handleDisableLock}
              autoComplete="off"
              data-form-type="other"
              className="space-y-3 pt-2 border-t border-stone-100 dark:border-zinc-800"
            >
              <h4 className="text-xs font-bold text-stone-800 dark:text-zinc-200">
                Confirm PIN to Disable Shared Workspace Management Mode Lock
              </h4>
              <div>
                <label className="block text-[11px] font-bold text-stone-600 dark:text-zinc-400 mb-1">
                  Enter Current PIN
                </label>
                <input
                  id="disable-pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="Current PIN"
                  className="w-full max-w-xs px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 font-mono tracking-widest text-stone-900 dark:text-zinc-100"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  id="confirm-disable-lock-btn"
                  type="submit"
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition shadow-xs"
                >
                  {isProcessing ? 'Verifying...' : 'Disable Lock'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* Cryptographic Security Details */}
      <div className="pt-3 border-t border-stone-100 dark:border-zinc-800 text-[11px] text-[#8B7E74] dark:text-[#A39E93] flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>
          Shared workspace policy using Web Crypto SHA-256 and unique 128-bit cryptographic salt. Plaintext PIN is never stored or transmitted, and unlock state resets on exit, reload, workspace change, or sign-out. Workspace roles and Firestore security rules remain authoritative.
        </span>
      </div>
    </div>
  );
};
