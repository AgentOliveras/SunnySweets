import React, { useState, useEffect } from 'react';
import { Layers, ShieldCheck, Check, AlertCircle, Info, Lock } from 'lucide-react';
import { store } from '../services/store';
import {
  WORKSPACE_FEATURE_REGISTRY,
  WorkspaceFeatureDescriptor,
} from '../services/workspaceFeatures';
import { WorkspaceFeatures, AccessRole } from '../types';

interface WorkspaceCapabilitiesSettingsProps {
  onNotification?: (msg: string) => void;
}

export const WorkspaceCapabilitiesSettings: React.FC<WorkspaceCapabilitiesSettingsProps> = ({
  onNotification,
}) => {
  const [features, setFeatures] = useState<WorkspaceFeatures>(() => store.getWorkspaceFeatures());
  const [userRole, setUserRole] = useState<AccessRole>(() => store.getUserRole());
  const [activeWorkspace, setActiveWorkspace] = useState(() => store.getActiveWorkspace());
  const [isUpdating, setIsUpdating] = useState(false);

  const isOwner = userRole === 'owner';

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setFeatures(store.getWorkspaceFeatures());
      setUserRole(store.getUserRole());
      setActiveWorkspace(store.getActiveWorkspace());
    });
    return () => unsub();
  }, []);

  const handleToggleFeature = async (featureKey: keyof WorkspaceFeatures, enabled: boolean) => {
    if (!isOwner) {
      onNotification?.('Permission denied: Only workspace owners can modify capabilities.');
      return;
    }

    setIsUpdating(true);
    try {
      await store.setWorkspaceFeatures({ [featureKey]: enabled });
      const descriptor = WORKSPACE_FEATURE_REGISTRY[featureKey];
      const label = descriptor?.name || featureKey;
      onNotification?.(`${label} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      onNotification?.(err?.message || 'Failed to update workspace feature');
    } finally {
      setIsUpdating(false);
    }
  };

  const featureList: WorkspaceFeatureDescriptor[] = Object.values(WORKSPACE_FEATURE_REGISTRY);

  return (
    <div
      id="workspace-capabilities-settings-card"
      className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E5E1DA] dark:border-[#2D2925]">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
            <Layers className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Workspace Capabilities & Modules
              </h3>
              <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                Phase 2 Architecture
              </span>
            </div>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-1 max-w-xl leading-relaxed">
              Configure operational capabilities for{' '}
              <span className="font-semibold text-stone-900 dark:text-zinc-200">
                {activeWorkspace?.name || 'Current Workspace'}
              </span>
              . Core formulation and production tools are standard; advanced modules can be tailored per kitchen.
            </p>
          </div>
        </div>

        {!isOwner && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-zinc-800/60 border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-400 text-xs shrink-0 self-start sm:self-center">
            <Lock className="w-3.5 h-3.5" />
            <span>Owner permissions required to change</span>
          </div>
        )}
      </div>

      {/* Capabilities List */}
      <div className="divide-y divide-[#F0ECE1] dark:divide-[#282420]">
        {featureList.map((feature) => {
          const isEnabled = Boolean(features[feature.key]);
          const toggleId = `toggle-feature-${feature.key}`;

          return (
            <div
              key={feature.key}
              className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-sm text-[#2D2926] dark:text-[#EAE6E1]">
                    {feature.name}
                  </h4>
                  {feature.isCore ? (
                    <span className="px-2 py-0.5 text-[9px] font-bold rounded-md uppercase tracking-wider bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 border border-stone-200 dark:border-zinc-700">
                      Core
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[9px] font-bold rounded-md uppercase tracking-wider bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                      Private Module
                    </span>
                  )}
                  {feature.isInternalPreview && (
                    <span className="px-2 py-0.5 text-[9px] font-medium rounded-md text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                      Foundation Ready
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] max-w-lg leading-relaxed">
                  {feature.description}
                </p>
              </div>

              {/* Toggle Switch */}
              <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-zinc-400 w-12 text-right">
                  {isEnabled ? 'Active' : 'Off'}
                </span>

                <button
                  type="button"
                  id={toggleId}
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`Toggle ${feature.name}`}
                  disabled={!isOwner || isUpdating}
                  onClick={() => handleToggleFeature(feature.key, !isEnabled)}
                  className={`w-12 h-7 flex items-center rounded-full p-1 transition-colors duration-200 cursor-pointer ${
                    isEnabled
                      ? 'bg-amber-500 ring-2 ring-amber-500/20'
                      : 'bg-stone-300 dark:bg-zinc-700'
                  } ${!isOwner || isUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div
                    className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                      isEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info Footnote */}
      <div className="pt-2 flex items-start gap-2 text-[11px] text-[#8B7E74] dark:text-[#A39E93] bg-[#FAF8F5] dark:bg-[#151311] p-3 rounded-lg border border-[#E5E1DA] dark:border-[#2D2925]">
        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Workspace capabilities determine module availability for this workspace independently of other workspaces. User roles (Owner, Editor, Viewer) determine what actions users are permitted to take within enabled modules.
        </p>
      </div>
    </div>
  );
};
