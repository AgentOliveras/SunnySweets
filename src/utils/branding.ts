import { PresetPaletteId, WorkspaceBranding } from '../types';

export interface PaletteColors {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  contrastText: string;
}

export interface ColorPalette {
  id: PresetPaletteId;
  name: string;
  tagline: string;
  light: PaletteColors;
  dark: PaletteColors;
}

/**
 * Five professionally crafted commercial preset palettes.
 * Specified in Phase 0.5 with accessible WCAG AA contrast ratios.
 */
export const PRESET_PALETTES: ColorPalette[] = [
  {
    id: 'warm-bakery',
    name: 'Warm Bakery',
    tagline: 'Artisan sourdough, roasted grains & warm butter',
    light: {
      primary: '#6B4423',
      accent: '#D6A15D',
      background: '#FAF7F2',
      surface: '#FFFFFF',
      text: '#33261D',
      muted: '#8B7E74',
      border: '#E5E1DA',
      contrastText: '#FFFFFF',
    },
    dark: {
      primary: '#D6A15D',
      accent: '#E5B880',
      background: '#141210',
      surface: '#1E1B18',
      text: '#FAF7F2',
      muted: '#A39E93',
      border: '#2E2925',
      contrastText: '#1E1B18',
    },
  },
  {
    id: 'modern-navy',
    name: 'Modern Navy',
    tagline: 'Architectural precision & wholesale commercial logistics',
    light: {
      primary: '#173B57',
      accent: '#6FA3C8',
      background: '#F6F8FA',
      surface: '#FFFFFF',
      text: '#24323D',
      muted: '#6C7D8C',
      border: '#D8E2EA',
      contrastText: '#FFFFFF',
    },
    dark: {
      primary: '#6FA3C8',
      accent: '#8FBCDC',
      background: '#0E171F',
      surface: '#17232D',
      text: '#F0F5F9',
      muted: '#8E9FA9',
      border: '#283B4A',
      contrastText: '#101921',
    },
  },
  {
    id: 'sage-kitchen',
    name: 'Sage Kitchen',
    tagline: 'Farm-to-table botanical herbs & limestone hearths',
    light: {
      primary: '#526A57',
      accent: '#A8B89A',
      background: '#F7F8F3',
      surface: '#FFFFFF',
      text: '#303A32',
      muted: '#758277',
      border: '#DEE3D8',
      contrastText: '#FFFFFF',
    },
    dark: {
      primary: '#A8B89A',
      accent: '#C2CFC6',
      background: '#111612',
      surface: '#1A221C',
      text: '#F1F5F2',
      muted: '#8F9B91',
      border: '#2B382E',
      contrastText: '#111612',
    },
  },
  {
    id: 'charcoal-gold',
    name: 'Charcoal Gold',
    tagline: 'Upscale patisserie, dark cocoa & champagne metallics',
    light: {
      primary: '#33302D',
      accent: '#C9A86A',
      background: '#F8F6F2',
      surface: '#FFFFFF',
      text: '#282624',
      muted: '#7E7B78',
      border: '#E2DED8',
      contrastText: '#FFFFFF',
    },
    dark: {
      primary: '#C9A86A',
      accent: '#DCBE83',
      background: '#121211',
      surface: '#1D1C1B',
      text: '#F6F4F0',
      muted: '#9B968F',
      border: '#33312E',
      contrastText: '#121211',
    },
  },
  {
    id: 'berry-cream',
    name: 'Berry Cream',
    tagline: 'Rich currant compote, sweet glaze & French confectionery',
    light: {
      primary: '#70445A',
      accent: '#C98BA3',
      background: '#FCF7F8',
      surface: '#FFFFFF',
      text: '#3F3037',
      muted: '#8C7781',
      border: '#EADDE2',
      contrastText: '#FFFFFF',
    },
    dark: {
      primary: '#C98BA3',
      accent: '#DFADC0',
      background: '#161114',
      surface: '#221A1E',
      text: '#FAF2F5',
      muted: '#9E8893',
      border: '#3A2C34',
      contrastText: '#161114',
    },
  },
];

export const DEFAULT_PALETTE_ID: PresetPaletteId = 'warm-bakery';
export const DEFAULT_DISPLAY_NAME = 'Sunny Sweets Production Hub';

export function getPaletteById(id?: string): ColorPalette {
  const matched = PRESET_PALETTES.find((p) => p.id === id);
  return matched || PRESET_PALETTES[0];
}

export function getDefaultWorkspaceBranding(workspaceName?: string): WorkspaceBranding {
  return {
    displayName: workspaceName?.trim() || DEFAULT_DISPLAY_NAME,
    paletteId: DEFAULT_PALETTE_ID,
  };
}

/**
 * Validate and sanitize Application / Workspace Display Name.
 * Plain-text only, 2-60 characters, no HTML or script tags.
 */
export function sanitizeDisplayName(input: string): { valid: boolean; value: string; error?: string } {
  if (typeof input !== 'string') {
    return { valid: false, value: '', error: 'Display name must be text.' };
  }

  // Strip script tags and general HTML tags
  const sanitized = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

  if (sanitized.length < 2) {
    return {
      valid: false,
      value: sanitized,
      error: 'Application display name must be at least 2 characters long.',
    };
  }

  if (sanitized.length > 60) {
    return {
      valid: false,
      value: sanitized.slice(0, 60),
      error: 'Application display name cannot exceed 60 characters.',
    };
  }

  return { valid: true, value: sanitized };
}

/**
 * Validate logo file format and size.
 * Supported: PNG, JPG/JPEG, WEBP.
 * Maximum file size: 2MB.
 */
export function validateLogoFile(file: File): { valid: boolean; error?: string } {
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedMimeTypes.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error: 'Unsupported image format. Please select a PNG, JPG/JPEG, or WEBP file.',
    };
  }

  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: 'Image file exceeds the 2MB size limit. Please choose an optimized logo image.',
    };
  }

  return { valid: true };
}

/**
 * Apply semantic theme tokens to the document root element using CSS variables.
 */
export function applyThemeTokensToDOM(paletteId: string, isDark: boolean): void {
  if (typeof document === 'undefined') return;

  const palette = getPaletteById(paletteId);
  const colors = isDark ? palette.dark : palette.light;
  const root = document.documentElement;

  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-background', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-muted', colors.muted);
  root.style.setProperty('--color-border', colors.border);
  root.style.setProperty('--color-contrast-text', colors.contrastText);
  root.style.setProperty('--color-danger', '#DC2626');
  root.style.setProperty('--color-success', '#16A34A');
  root.setAttribute('data-palette', palette.id);
}

/**
 * Reset DOM theme tokens to generic clean fallback.
 */
export function resetThemeTokensOnDOM(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.removeAttribute('data-palette');
  const defaultColors = PRESET_PALETTES[0].light;
  root.style.setProperty('--color-primary', defaultColors.primary);
  root.style.setProperty('--color-accent', defaultColors.accent);
  root.style.setProperty('--color-background', defaultColors.background);
  root.style.setProperty('--color-surface', defaultColors.surface);
  root.style.setProperty('--color-text', defaultColors.text);
  root.style.setProperty('--color-muted', defaultColors.muted);
  root.style.setProperty('--color-border', defaultColors.border);
  root.style.setProperty('--color-contrast-text', defaultColors.contrastText);
}

/**
 * Hex to RGB converter for PDF generation and color mathematics.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}
