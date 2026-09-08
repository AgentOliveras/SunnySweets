import React, { useState, useEffect, useRef } from 'react';
import {
  Palette,
  Upload,
  Trash2,
  Check,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  Shield,
  Eye,
  Building2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { store } from '../services/store';
import { WorkspaceBranding, PresetPaletteId } from '../types';
import {
  PRESET_PALETTES,
  ColorPalette,
  getPaletteById,
  validateLogoFile,
  sanitizeDisplayName,
  DEFAULT_PALETTE_ID,
  DEFAULT_DISPLAY_NAME,
} from '../utils/branding';
import { uploadWorkspaceLogoToStorage } from '../services/firebase';

interface BrandingSettingsProps {
  onSuccessNotice?: (msg: string) => void;
}

export const BrandingSettings: React.FC<BrandingSettingsProps> = ({ onSuccessNotice }) => {
  const activeWorkspace = store.getActiveWorkspace();
  const userRole = store.getUserRole();
  const isOwner = userRole === 'owner';

  const [savedBranding, setSavedBranding] = useState<WorkspaceBranding>(() =>
    store.getWorkspaceBranding()
  );

  // Form edit states (for live interactive preview)
  const [displayName, setDisplayName] = useState(savedBranding.displayName || DEFAULT_DISPLAY_NAME);
  const [paletteId, setPaletteId] = useState<string>(savedBranding.paletteId || DEFAULT_PALETTE_ID);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(savedBranding.logoUrl);
  const [logoStoragePath, setLogoStoragePath] = useState<string | undefined>(
    savedBranding.logoStoragePath
  );

  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if form differs from persisted state
  const isDirty =
    displayName !== savedBranding.displayName ||
    paletteId !== savedBranding.paletteId ||
    logoUrl !== savedBranding.logoUrl ||
    pendingLogoFile !== null;

  // Keep savedBranding in sync if store updates externally
  useEffect(() => {
    const unsub = store.subscribe(() => {
      const current = store.getWorkspaceBranding();
      setSavedBranding(current);
    });
    return () => unsub();
  }, []);

  // Update live preview in DOM when local preview states change
  useEffect(() => {
    const currentPreviewLogo = localPreviewUrl || logoUrl;
    store.applyActiveWorkspaceTheme({
      displayName,
      paletteId: paletteId as PresetPaletteId,
      logoUrl: currentPreviewLogo,
      logoStoragePath,
    });
  }, [displayName, paletteId, logoUrl, localPreviewUrl, logoStoragePath]);

  // When unmounting, restore saved branding if uncommitted
  useEffect(() => {
    return () => {
      store.applyActiveWorkspaceTheme();
    };
  }, []);

  const handlePaletteSelect = (newPaletteId: string) => {
    if (!isOwner) return;
    setPaletteId(newPaletteId);
    setFeedback(null);
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isOwner) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateLogoFile(file);
    if (!validation.valid) {
      setFeedback({ type: 'error', message: validation.error || 'Invalid logo file.' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setFeedback(null);
    setPendingLogoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objectUrl);
  };

  const handleRemoveLogo = () => {
    if (!isOwner) return;
    setPendingLogoFile(null);
    setLocalPreviewUrl(null);
    setLogoUrl(undefined);
    setLogoStoragePath(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFeedback(null);
  };

  const handleDiscardChanges = () => {
    setDisplayName(savedBranding.displayName || DEFAULT_DISPLAY_NAME);
    setPaletteId(savedBranding.paletteId || DEFAULT_PALETTE_ID);
    setLogoUrl(savedBranding.logoUrl);
    setLogoStoragePath(savedBranding.logoStoragePath);
    setPendingLogoFile(null);
    setLocalPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFeedback(null);
    store.applyActiveWorkspaceTheme(savedBranding);
  };

  const handleSaveBranding = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isOwner) return;

    const nameValidation = sanitizeDisplayName(displayName);
    if (!nameValidation.valid) {
      setFeedback({
        type: 'error',
        message: nameValidation.error || 'Please enter a valid display name (2-60 characters).',
      });
      return;
    }

    if (!activeWorkspace) {
      setFeedback({ type: 'error', message: 'No active workspace selected.' });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      let finalLogoUrl = logoUrl;
      let finalLogoPath = logoStoragePath;

      // If owner uploaded a new logo file, store in workspace-logos/{workspaceId}
      if (pendingLogoFile) {
        try {
          const uploadResult = await uploadWorkspaceLogoToStorage(activeWorkspace.id, pendingLogoFile);
          finalLogoUrl = uploadResult.downloadUrl;
          finalLogoPath = uploadResult.storagePath;
        } catch (uploadErr) {
          console.warn('Firebase storage upload note:', uploadErr);
          // Fallback: If cloud storage rules or network restricts upload in this sandbox,
          // inform user with clear diagnostic
          throw new Error(
            uploadErr instanceof Error
              ? `Logo Upload Failed: ${uploadErr.message}`
              : 'Failed to upload logo to Firebase Storage.'
          );
        }
      }

      const updatedBranding: WorkspaceBranding = {
        displayName: nameValidation.value,
        paletteId: paletteId as PresetPaletteId,
        logoUrl: finalLogoUrl,
        logoStoragePath: finalLogoPath,
      };

      await store.saveWorkspaceBranding(updatedBranding);

      setSavedBranding(updatedBranding);
      setDisplayName(updatedBranding.displayName);
      setLogoUrl(updatedBranding.logoUrl);
      setLogoStoragePath(updatedBranding.logoStoragePath);
      setPendingLogoFile(null);
      setLocalPreviewUrl(null);

      setFeedback({
        type: 'success',
        message: 'Workspace branding & theme saved successfully.',
      });
      if (onSuccessNotice) {
        onSuccessNotice('Workspace branding saved');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save branding.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreDefault = async () => {
    if (!isOwner) return;
    const confirmReset = window.confirm(
      'Restore workspace defaults? This will reset the color palette to Warm Bakery, use the workspace default name, and remove any custom logo.'
    );
    if (!confirmReset) return;

    setIsRestoring(true);
    setFeedback(null);

    try {
      await store.restoreWorkspaceDefaultBranding();
      const resetBranding = store.getWorkspaceBranding();
      setSavedBranding(resetBranding);
      setDisplayName(resetBranding.displayName);
      setPaletteId(resetBranding.paletteId);
      setLogoUrl(undefined);
      setLogoStoragePath(undefined);
      setPendingLogoFile(null);
      setLocalPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      setFeedback({
        type: 'success',
        message: 'Workspace default branding restored.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to restore default branding.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const currentPreviewLogoUrl = localPreviewUrl || logoUrl;
  const activePaletteObj = getPaletteById(paletteId);

  return (
    <div className="space-y-6" id="workspace-branding-section">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E1DA] dark:border-[#2D2925] pb-4">
        <div>
          <h3 className="text-lg font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <Palette className="w-5 h-5 text-[var(--color-primary)]" />
            <span>Branding & Appearance</span>
          </h3>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Customize the application display name, workspace logo, and color palette. Scoped exclusively to{' '}
            <strong className="text-[#5A534B] dark:text-[#EAE6E1]">{activeWorkspace?.name || 'this workspace'}</strong>.
          </p>
        </div>

        {/* Live Preview Indicator Badge */}
        {isDirty && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-full text-xs font-semibold text-amber-800 dark:text-amber-300 animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Live Preview Active (Unsaved Changes)</span>
          </div>
        )}
      </div>

      {/* Role Notice if Editor / Viewer */}
      {!isOwner && (
        <div className="p-4 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] flex items-start gap-3">
          <Shield className="w-5 h-5 text-[#8B7E74] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-[#5A534B] dark:text-[#EAE6E1]">
              Read-Only Branding Settings
            </h4>
            <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
              Only the workspace Owner can modify workspace branding and appearance. As a {userRole || 'team member'},
              you can view the active theme configuration.
            </p>
          </div>
        </div>
      )}

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2.5 transition animate-fade-in ${
            feedback.type === 'success'
              ? 'bg-[#E8F5E9] dark:bg-[#1B3520] border-[#A5D6A7] dark:border-[#2E7D32] text-[#2E7D32] dark:text-[#81C784]'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Form Container */}
      <form onSubmit={handleSaveBranding} className="space-y-6">
        {/* 1. APPLICATION DISPLAY NAME */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] flex items-center justify-center">
              <Building2 className="w-5 h-5 text-[var(--color-primary)]" />
            </div>
            <div>
              <h4 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Application Display Name
              </h4>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Appears in the header bar, dashboard titles, and generated production reports (2–60 characters).
              </p>
            </div>
          </div>

          <div className="max-w-md">
            <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
              Display Name
            </label>
            <input
              id="workspace-branding-display-name-input"
              type="text"
              disabled={!isOwner || isSaving}
              value={displayName}
              maxLength={60}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setFeedback(null);
              }}
              placeholder="e.g. Sunny Sweets Production Hub"
              className="w-full px-3.5 py-2.5 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[var(--color-primary)] focus:outline-none dark:text-[#EAE6E1] disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <div className="flex justify-between items-center text-[11px] text-[#8B7E74] dark:text-[#A39E93] mt-1">
              <span>Plain text only • HTML and script tags stripped</span>
              <span>{displayName.length} / 60</span>
            </div>
          </div>
        </div>

        {/* 2. WORKSPACE LOGO */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] flex items-center justify-center">
              <Upload className="w-5 h-5 text-[var(--color-primary)]" />
            </div>
            <div>
              <h4 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Workspace Logo
              </h4>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Upload your bakery logo (PNG, JPG, WEBP • Max 2MB). If no logo is set, a clean monogram will be displayed.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-6 pt-2">
            {/* Logo Preview Box */}
            <div className="flex flex-col items-center sm:items-start gap-2">
              <span className="text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93]">
                Current Preview
              </span>
              <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-[#E5E1DA] dark:border-[#332F2B] bg-[#F9F8F6] dark:bg-[#25221F] flex items-center justify-center overflow-hidden p-2 relative shadow-xs">
                {currentPreviewLogoUrl ? (
                  <img
                    src={currentPreviewLogoUrl}
                    alt="Workspace Logo"
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-lg shadow-xs"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-contrast-text)',
                    }}
                  >
                    {displayName ? displayName.slice(0, 2).toUpperCase() : 'SS'}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-[#8B7E74] dark:text-[#A39E93]">
                {currentPreviewLogoUrl ? (pendingLogoFile ? 'Unsaved New Logo' : 'Saved Logo') : 'Default Monogram'}
              </span>
            </div>

            {/* Upload Controls */}
            {isOwner && (
              <div className="space-y-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleLogoFileChange}
                  accept="image/png, image/jpeg, image/jpg, image/webp"
                  className="hidden"
                  id="workspace-logo-file-input"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    id="upload-replace-logo-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] dark:hover:bg-[#4A433D] transition shadow-xs cursor-pointer disabled:opacity-60"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{currentPreviewLogoUrl ? 'Replace Logo' : 'Upload Logo'}</span>
                  </button>

                  {currentPreviewLogoUrl && (
                    <button
                      type="button"
                      id="remove-logo-btn"
                      onClick={handleRemoveLogo}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 border border-red-200 dark:border-red-900/50 transition cursor-pointer disabled:opacity-60"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove Logo</span>
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93]">
                  Stored safely in isolated workspace cloud storage bucket. Never stored as raw base64.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 3. FIVE PRESET COLOR PALETTES */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] flex items-center justify-center">
                <Sliders className="w-5 h-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <h4 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                  Preset Color Palettes
                </h4>
                <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                  Select a theme tailored for culinary operations. Clicking a card updates the live application preview immediately.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {PRESET_PALETTES.map((pal: ColorPalette) => {
              const isSelected = paletteId === pal.id;
              return (
                <div
                  key={pal.id}
                  id={`palette-card-${pal.id}`}
                  onClick={() => handlePaletteSelect(pal.id)}
                  className={`p-4 rounded-xl border text-left transition relative flex flex-col justify-between gap-3 cursor-pointer ${
                    isSelected
                      ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/40 bg-[#FAF8F5] dark:bg-[#25211D] shadow-sm'
                      : 'border-[#EEECE8] dark:border-[#332F2B] bg-[#FDFCFB] dark:bg-[#1F1C19] hover:border-[#D4A373]'
                  }`}
                >
                  {/* Card Header & Selected Check */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1]">
                        {pal.name}
                      </h5>
                      <p className="text-[11px] text-[#8B7E74] dark:text-[#A39E93] line-clamp-1">
                        {pal.tagline}
                      </p>
                    </div>

                    {isSelected && (
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] shrink-0"
                            style={{ backgroundColor: pal.light.primary }}>
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>

                  {/* Swatches Bar */}
                  <div className="flex items-center gap-1.5 py-1">
                    <span
                      title={`Primary: ${pal.light.primary}`}
                      className="w-6 h-6 rounded-full border border-black/10 shadow-xs"
                      style={{ backgroundColor: pal.light.primary }}
                    />
                    <span
                      title={`Accent: ${pal.light.accent}`}
                      className="w-6 h-6 rounded-full border border-black/10 shadow-xs"
                      style={{ backgroundColor: pal.light.accent }}
                    />
                    <span
                      title={`Background: ${pal.light.background}`}
                      className="w-6 h-6 rounded-full border border-black/10 shadow-xs"
                      style={{ backgroundColor: pal.light.background }}
                    />
                    <span
                      title={`Text: ${pal.light.text}`}
                      className="w-6 h-6 rounded-full border border-black/10 shadow-xs"
                      style={{ backgroundColor: pal.light.text }}
                    />
                  </div>

                  {/* Mini UI Preview Box */}
                  <div
                    className="p-2.5 rounded-lg border text-[11px] space-y-1.5 select-none"
                    style={{
                      backgroundColor: pal.light.background,
                      borderColor: pal.light.border,
                      color: pal.light.text,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: pal.light.primary }}
                        />
                        <span className="font-bold text-[10px]" style={{ color: pal.light.primary }}>
                          Header & Brand
                        </span>
                      </div>
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                        style={{ backgroundColor: pal.light.accent, color: '#FFFFFF' }}
                      >
                        Action
                      </span>
                    </div>

                    <div
                      className="p-1.5 rounded text-[10px] flex items-center justify-between font-medium"
                      style={{
                        backgroundColor: pal.light.surface,
                        borderColor: pal.light.border,
                        borderWidth: 1,
                      }}
                    >
                      <span>Flour & Batch Scaling</span>
                      <span style={{ color: pal.light.muted }}>100%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 4. LIVE INTERACTIVE COMPONENT PREVIEW */}
        <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-[var(--color-primary)]" />
              <h4 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                Live Interactive Component Preview
              </h4>
            </div>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              WCAG AA Compliant
            </span>
          </div>

          <div
            className="p-5 rounded-xl border space-y-4"
            style={{
              backgroundColor: 'var(--color-background)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            {/* Mock Header */}
            <div
              className="flex items-center justify-between p-3 rounded-lg border shadow-xs"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="flex items-center gap-2.5">
                {currentPreviewLogoUrl ? (
                  <img
                    src={currentPreviewLogoUrl}
                    alt="Logo preview"
                    className="w-7 h-7 object-contain rounded"
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded flex items-center justify-center font-bold text-xs"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-contrast-text)',
                    }}
                  >
                    {displayName.slice(0, 2).toUpperCase() || 'SS'}
                  </div>
                )}
                <div>
                  <div className="font-bold text-xs" style={{ color: 'var(--color-text)' }}>
                    {displayName || 'Recipe Calculator'}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    {activeWorkspace?.name || 'Sunny Sweets Workspace'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className="px-2 py-1 rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-contrast-text)',
                  }}
                >
                  Active Tab
                </span>
                <span
                  className="px-2 py-1 rounded text-[10px] font-medium"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Recipes
                </span>
              </div>
            </div>

            {/* Mock Card & Buttons */}
            <div
              className="p-4 rounded-lg border space-y-3"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="flex items-center justify-between">
                <h5 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
                  Sample Production Batch Card
                </h5>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: 'var(--color-accent)',
                    color: '#FFFFFF',
                  }}
                >
                  {activePaletteObj.name}
                </span>
              </div>

              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Checking readability and color balance between primary brand elements, secondary accents, and text.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs font-bold shadow-xs cursor-default"
                  style={{
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-contrast-text)',
                  }}
                >
                  Primary Action
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs font-bold shadow-xs cursor-default"
                  style={{
                    backgroundColor: 'var(--color-accent)',
                    color: '#FFFFFF',
                  }}
                >
                  Accent Action
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-default"
                  style={{
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  Outlined
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 5. ACTION BUTTONS (Save / Discard / Restore Default) */}
        {isOwner && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#E5E1DA] dark:border-[#2D2925]">
            <button
              type="button"
              id="restore-workspace-default-branding-btn"
              disabled={isSaving || isRestoring}
              onClick={handleRestoreDefault}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] bg-[#F5F2ED] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isRestoring ? 'Restoring...' : 'Restore Workspace Default'}</span>
            </button>

            <div className="flex items-center gap-2">
              {isDirty && (
                <button
                  type="button"
                  id="discard-branding-changes-btn"
                  disabled={isSaving}
                  onClick={handleDiscardChanges}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-[#8B7E74] hover:text-[#5A534B] dark:text-[#A39E93] dark:hover:text-[#EAE6E1] border border-[#EEECE8] dark:border-[#332F2B] transition cursor-pointer"
                >
                  Discard Changes
                </button>
              )}

              <button
                type="submit"
                id="save-workspace-branding-btn"
                disabled={isSaving || !isDirty}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm transition cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving Branding...' : 'Save Workspace Branding'}</span>
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
