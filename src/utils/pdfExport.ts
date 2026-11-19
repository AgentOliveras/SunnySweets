import { jsPDF } from 'jspdf';
import {
  CalculationResult,
  ProductionHistoryEntry,
  ProductionPreset,
  Recipe,
} from '../types';
import {
  formatNumber,
  isButterIngredient,
  isPeanutButterIngredient,
  getDisplayDecimals,
} from './units';
import { getPaletteById, hexToRgb } from './branding';
import { store } from '../services/store';
import {
  FirestoreHydrationState,
  ResolvedSafetyInstruction,
  SAFETY_CONNECTION_UNVERIFIED_MESSAGE,
  SAFETY_HYDRATION_ERROR_MESSAGE,
  SAFETY_HYDRATION_LOADING_MESSAGE,
  SAFETY_NOTES_UNACKNOWLEDGED_EXPORT_MESSAGE,
  isSafetySignatureAcknowledged,
  resolveApplicableSafetyInstructions,
  resolveSafetyOperationalGateState,
} from './productionNotes';

export interface PDFExportBranding {
  displayName?: string;
  paletteId?: string;
  primaryColor?: string;
}

export interface PDFExportSafetyContext {
  recipesHydrationState?: FirestoreHydrationState;
  presetsHydrationState?: FirestoreHydrationState;
  connectionVerified?: boolean;
  syncError?: string | null;
  activeWorkspaceId?: string;
  recipes?: Recipe[];
  presets?: ProductionPreset[];
  acknowledgedSafetySignature?: string | null;
  /**
   * Optional test-only override to inspect the generated PDF layout/pages in Node
   * without triggering a browser file download.
   */
  skipDownload?: boolean;
}

export interface ProductionSheetPDFBlock {
  page: number;
  y: number;
  section:
    | 'header'
    | 'summary'
    | 'capacity_warning'
    | 'critical_notes'
    | 'requirements'
    | 'ingredient_checklist'
    | 'footer';
  text: string;
}

export interface ProductionSheetPDFResult {
  fileName: string;
  pageCount: number;
  recipeName: string;
  selectedPresetLabels: string[];
  hasCriticalNotes: boolean;
  renderedSafetyInstructions: ResolvedSafetyInstruction[];
  blocks: ProductionSheetPDFBlock[];
}

const PAGE_BOTTOM_LIMIT_MM = 274;
const PAGE_TOP_START_MM = 18;
const CONTENT_LEFT_MM = 14;
const CONTENT_WIDTH_MM = 182;

export function exportProductionSheetPDF(
  calc: CalculationResult | ProductionHistoryEntry,
  businessOrBranding: string | PDFExportBranding = 'Artisan Bakery Co.',
  decimalPlaces = 2,
  safetyContext?: PDFExportSafetyContext
): ProductionSheetPDFResult {
  // 1. Enforce fail-closed safety validation inside exportProductionSheetPDF itself so NO
  //    direct or alternate export call path can bypass hydration, connection, or note approval.
  const recipesHydrationState =
    safetyContext?.recipesHydrationState ?? store.getRecipesHydrationState();
  const presetsHydrationState =
    safetyContext?.presetsHydrationState ?? store.getPresetsHydrationState();
  const connectionVerified =
    safetyContext?.connectionVerified ?? store.isSafetyConnectionVerified();
  const syncError =
    safetyContext?.syncError !== undefined
      ? safetyContext.syncError
      : store.getCriticalNotesSyncError();

  const operationalGate = resolveSafetyOperationalGateState({
    recipesHydrationState,
    presetsHydrationState,
    connectionVerified,
    syncError,
  });

  if (operationalGate !== 'READY') {
    if (operationalGate === 'INITIAL_LOADING') {
      throw new Error(SAFETY_HYDRATION_LOADING_MESSAGE);
    }
    if (operationalGate === 'CONNECTION_UNVERIFIED') {
      throw new Error(SAFETY_CONNECTION_UNVERIFIED_MESSAGE);
    }
    throw new Error(SAFETY_HYDRATION_ERROR_MESSAGE);
  }

  const activeWorkspaceId =
    safetyContext?.activeWorkspaceId || store.getActiveWorkspaceId() || 'ws-main';
  const allRecipes = safetyContext?.recipes ?? store.getRecipes(true);
  const allPresets = safetyContext?.presets ?? store.getPresets();

  const recipeId = 'recipe' in calc ? calc.recipe.id : calc.recipeId;
  const authoritativeRecipe: Recipe | null =
    allRecipes.find((r) => r.id === recipeId) || ('recipe' in calc ? calc.recipe : null);

  const reqList = 'requirements' in calc && Array.isArray(calc.requirements) ? calc.requirements : [];
  const selectedPresetIds = Array.from(
    new Set(
      reqList
        .map((req) => (req.presetId || '').trim())
        .filter((id) => id.length > 0)
    )
  );

  const presetNameMap = new Map<string, string>();
  for (const p of allPresets) {
    if (p && p.id) {
      presetNameMap.set(p.id, p.name);
    }
  }

  const selectedPresetLabels: string[] = [];
  const seenPresetLabels = new Set<string>();
  for (const req of reqList) {
    const label =
      (req.presetId && presetNameMap.get(req.presetId)) ||
      (req.presetName && req.presetName.trim()) ||
      'Custom Item';
    if (!seenPresetLabels.has(label)) {
      seenPresetLabels.add(label);
      selectedPresetLabels.push(label);
    }
  }
  if (selectedPresetLabels.length === 0) {
    selectedPresetLabels.push('Standard Batch');
  }

  const safetyResolution = resolveApplicableSafetyInstructions({
    recipe: authoritativeRecipe,
    presets: allPresets,
    selectedPresetIds,
    activeWorkspaceId,
  });

  if (safetyResolution.hasSafetyNotes) {
    const isAcknowledged = isSafetySignatureAcknowledged(
      safetyResolution.signature,
      safetyContext?.acknowledgedSafetySignature
    );
    if (!isAcknowledged) {
      throw new Error(SAFETY_NOTES_UNACKNOWLEDGED_EXPORT_MESSAGE);
    }
  }

  // 2. Construct multi-page-aware jsPDF document
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const blocks: ProductionSheetPDFBlock[] = [];
  const recordText = (
    section: ProductionSheetPDFBlock['section'],
    text: string,
    x: number,
    yCoord: number
  ) => {
    doc.text(text, x, yCoord);
    blocks.push({
      page: doc.getNumberOfPages(),
      y: yCoord,
      section,
      text,
    });
  };

  let y = 15;
  const ensureVerticalSpace = (requiredHeightMm: number) => {
    if (y + requiredHeightMm > PAGE_BOTTOM_LIMIT_MM) {
      doc.addPage();
      y = PAGE_TOP_START_MM;
    }
  };

  const branding: PDFExportBranding =
    typeof businessOrBranding === 'string'
      ? { displayName: businessOrBranding }
      : businessOrBranding;

  const businessName = branding.displayName || 'Artisan Bakery Co.';
  const recipeName =
    authoritativeRecipe?.name || ('recipe' in calc ? calc.recipe.name : calc.recipeName);
  const dateStr =
    'calculatedAt' in calc && calc.calculatedAt
      ? new Date(calc.calculatedAt).toLocaleString()
      : new Date().toLocaleString();

  // Header Banner tinted with workspace branding palette
  let bannerRgb = { r: 107, g: 68, b: 35 };
  if (branding.primaryColor) {
    bannerRgb = hexToRgb(branding.primaryColor);
  } else if (branding.paletteId) {
    const pal = getPaletteById(branding.paletteId);
    bannerRgb = hexToRgb(pal.light.primary);
  }
  doc.setFillColor(bannerRgb.r, bannerRgb.g, bannerRgb.b);
  doc.rect(0, 0, 210, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  recordText('header', 'PRODUCTION SHEET & INGREDIENT SCALING', CONTENT_LEFT_MM, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  recordText('header', businessName, CONTENT_LEFT_MM, 18);
  recordText('header', `Generated: ${dateStr}`, 140, 18);

  y = 30;

  // Recipe & Selected Packaging Presets Summary Box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const wrappedRecipeLines: string[] = doc.splitTextToSize(
    `Recipe: ${recipeName}`,
    CONTENT_WIDTH_MM - 8
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const presetsSummaryText = `Selected Packaging Preset(s): ${selectedPresetLabels.join(', ')}`;
  const wrappedPresetLines: string[] = doc.splitTextToSize(
    presetsSummaryText,
    CONTENT_WIDTH_MM - 8
  );

  const summaryBoxHeight =
    10 + wrappedRecipeLines.length * 5.5 + wrappedPresetLines.length * 4.8 + 16;
  ensureVerticalSpace(summaryBoxHeight);

  doc.setFillColor(250, 248, 245);
  doc.setDrawColor(226, 218, 206);
  doc.roundedRect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, summaryBoxHeight, 3, 3, 'FD');

  let innerY = y + 7;
  doc.setTextColor(24, 24, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  for (const rLine of wrappedRecipeLines) {
    recordText('summary', rLine, CONTENT_LEFT_MM + 4, innerY);
    innerY += 5.5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(60, 50, 40);
  for (const pLine of wrappedPresetLines) {
    recordText('summary', pLine, CONTENT_LEFT_MM + 4, innerY);
    innerY += 4.8;
  }

  innerY += 1.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(24, 24, 27);
  recordText(
    'summary',
    `Total Finished Pieces: ${calc.totalPieces.toLocaleString()} items`,
    CONTENT_LEFT_MM + 4,
    innerY
  );
  const totalDecimals = calc.displayWeightUnit === 'g' ? 0 : decimalPlaces;
  recordText(
    'summary',
    `Total Batch Weight: ${formatNumber(calc.displayBatchWeight, totalDecimals)} ${calc.displayWeightUnit.toUpperCase()}`,
    CONTENT_LEFT_MM + 4,
    innerY + 6
  );

  const wastePercent =
    'overrideWastePercent' in calc
      ? calc.overrideWastePercent ?? calc.recipeWastePercent
      : (calc as ProductionHistoryEntry).wastePercent;

  recordText(
    'summary',
    `Scaling Multiplier: ${formatNumber(calc.scalingMultiplier, 3)}x`,
    110,
    innerY
  );
  recordText('summary', `Waste Allowance: ${wastePercent ?? 0}%`, 110, innerY + 6);

  const mixerName =
    'mixer' in calc ? calc.mixer?.name : (calc as ProductionHistoryEntry).mixerName;
  if (mixerName) {
    recordText('summary', `Mixer: ${mixerName}`, 110, innerY + 11.5);
  }

  y += summaryBoxHeight + 6;

  // Capacity Exceeded Safety Warning Banner if applicable
  const isExceeded =
    'isCapacityExceeded' in calc ? calc.isCapacityExceeded : calc.capacityExceeded;
  if (isExceeded) {
    ensureVerticalSpace(16);
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(248, 113, 113);
    doc.roundedRect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, 12, 2, 2, 'FD');

    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    recordText(
      'capacity_warning',
      `WARNING: MIXER CAPACITY EXCEEDED! (Split into ${calc.suggestedBatches} batches required)`,
      CONTENT_LEFT_MM + 4,
      y + 7.5
    );
    y += 16;
  }

  // ===========================================================================
  // PROMINENT CRITICAL PRODUCTION NOTES SECTION (Strictly BEFORE Checklist)
  // ===========================================================================
  ensureVerticalSpace(20);
  if (safetyResolution.hasSafetyNotes) {
    doc.setFillColor(180, 83, 9);
    doc.rect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    recordText(
      'critical_notes',
      'CRITICAL PRODUCTION NOTES — MANDATORY FLOOR SAFETY INSTRUCTIONS',
      CONTENT_LEFT_MM + 4,
      y + 5.5
    );
    y += 10;

    const renderSafetyInstructionGroup = (
      groupHeading: string,
      instructions: ResolvedSafetyInstruction[]
    ) => {
      if (instructions.length === 0) return;
      ensureVerticalSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(120, 53, 15);
      recordText('critical_notes', groupHeading, CONTENT_LEFT_MM + 2, y + 4);
      y += 6;

      for (const item of instructions) {
        const explicitScopeLabel =
          item.scope === 'preset_specific'
            ? `Preset-Specific Critical Production Note — ${item.presetName || item.presetId || 'Selected Preset'}`
            : `Recipe-Wide Critical Production Note — ${recipeName}`;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        const wrappedScopeLines: string[] = doc.splitTextToSize(
          `[${explicitScopeLabel}]`,
          CONTENT_WIDTH_MM - 8
        );

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        // Preserve explicit paragraphs and wrap long text with ZERO truncation
        const rawParagraphs = item.note.replace(/\r\n/g, '\n').split('\n');
        const wrappedNoteLines: string[] = [];
        for (const para of rawParagraphs) {
          if (para.trim().length === 0) {
            wrappedNoteLines.push('');
          } else {
            const splitLines: string[] = doc.splitTextToSize(para, CONTENT_WIDTH_MM - 8);
            wrappedNoteLines.push(...splitLines);
          }
        }

        // Render scope label (paginating cleanly if near page bottom)
        ensureVerticalSpace(wrappedScopeLines.length * 4.5 + 7);
        doc.setFillColor(255, 251, 235);
        doc.setDrawColor(245, 158, 11);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(146, 64, 14);
        for (const sLine of wrappedScopeLines) {
          ensureVerticalSpace(5.5);
          recordText('critical_notes', sLine, CONTENT_LEFT_MM + 4, y + 4);
          y += 4.5;
        }

        // Render every wrapped note line across pages with zero truncation
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(28, 25, 23);
        for (const nLine of wrappedNoteLines) {
          ensureVerticalSpace(5.5);
          if (nLine.length > 0) {
            recordText('critical_notes', nLine, CONTENT_LEFT_MM + 4, y + 4);
          }
          y += 4.8;
        }

        y += 3;
      }
    };

    renderSafetyInstructionGroup(
      'Recipe-Wide Critical Production Notes',
      safetyResolution.recipeWideNotes
    );
    renderSafetyInstructionGroup(
      'Preset-Specific Critical Production Notes',
      safetyResolution.presetSpecificNotes
    );

    y += 3;
  } else {
    // Authoritative READY state confirmed & zero notes apply -> print explicit confirmation
    ensureVerticalSpace(16);
    doc.setFillColor(245, 245, 244);
    doc.setDrawColor(214, 211, 209);
    doc.roundedRect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, 11, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(68, 64, 60);
    recordText('critical_notes', 'No Critical Production Notes', CONTENT_LEFT_MM + 4, y + 7);
    y += 15;
  }

  // Production Requirements Table
  ensureVerticalSpace(18);
  doc.setTextColor(24, 24, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  recordText('requirements', 'Production Items Required', CONTENT_LEFT_MM, y);
  y += 5;

  doc.setFillColor(243, 238, 230);
  doc.rect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, 7, 'F');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 50, 40);
  recordText('requirements', 'Item / Preset', 18, y + 5);
  recordText('requirements', 'Quantity / Unit', 90, y + 5);
  recordText('requirements', 'Item Weight', 140, y + 5);
  recordText('requirements', 'Subtotal Pieces', 170, y + 5);

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);

  reqList.forEach((req) => {
    ensureVerticalSpace(7);
    const resolvedPresetLabel =
      (req.presetId && presetNameMap.get(req.presetId)) || req.presetName || 'Custom Item';
    recordText('requirements', resolvedPresetLabel, 18, y + 5);
    recordText('requirements', `${req.quantity} (${req.piecesPerUnit} pcs/unit)`, 90, y + 5);
    recordText('requirements', `${req.itemWeight} ${req.itemWeightUnit}`, 140, y + 5);
    recordText(
      'requirements',
      `${(req.quantity * req.piecesPerUnit).toLocaleString()}`,
      170,
      y + 5
    );
    y += 6;
  });

  y += 6;

  // Ingredients Scaling Table Header
  const renderChecklistHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(24, 24, 27);
    recordText('ingredient_checklist', 'Scaled Ingredient Formula Checklist', CONTENT_LEFT_MM, y);
    y += 5;

    doc.setFillColor(180, 83, 9);
    doc.rect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    recordText('ingredient_checklist', 'Check', 16, y + 5.5);
    recordText('ingredient_checklist', 'Ingredient', 30, y + 5.5);
    recordText('ingredient_checklist', 'Base Qty', 85, y + 5.5);
    recordText('ingredient_checklist', 'Waste %', 115, y + 5.5);
    recordText('ingredient_checklist', 'Total Required', 140, y + 5.5);
    if (calc.suggestedBatches > 1) {
      recordText(
        'ingredient_checklist',
        `Per Batch (1/${calc.suggestedBatches})`,
        172,
        y + 5.5
      );
    } else {
      recordText('ingredient_checklist', 'Converted (Default)', 172, y + 5.5);
    }
    y += 8;
  };

  ensureVerticalSpace(22);
  renderChecklistHeader();

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);

  const ingredients = calc.calculatedIngredients;
  let isEven = false;

  ingredients.forEach((ing) => {
    const rowHeight = ing.jarsDetail?.text || ing.notes ? 12.5 : 8;
    if (y + rowHeight > PAGE_BOTTOM_LIMIT_MM) {
      doc.addPage();
      y = PAGE_TOP_START_MM;
      renderChecklistHeader();
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 30, 30);
    }

    if (isEven) {
      doc.setFillColor(249, 246, 240);
      doc.rect(CONTENT_LEFT_MM, y, CONTENT_WIDTH_MM, 8, 'F');
    }
    isEven = !isEven;

    // Checkbox box
    doc.setDrawColor(160, 160, 160);
    doc.rect(17, y + 2, 4, 4);

    doc.setFont('helvetica', 'bold');
    recordText('ingredient_checklist', ing.name, 30, y + 5.5);

    const isPB = ing.isPeanutButter || isPeanutButterIngredient(ing.name, recipeName);
    const isButter = !isPB && isButterIngredient(ing.name);
    const { maxDecimals, minDecimals } = getDisplayDecimals(
      ing.requiredUnit,
      isButter,
      decimalPlaces,
      isPB
    );
    const baseUnitIsGrams = ing.baseUnit.trim().toLowerCase() === 'g';

    doc.setFont('helvetica', 'normal');
    recordText(
      'ingredient_checklist',
      `${formatNumber(ing.baseQuantity, baseUnitIsGrams ? 0 : decimalPlaces)} ${ing.baseUnit}`,
      85,
      y + 5.5
    );
    recordText('ingredient_checklist', `${ing.wastePercent}%`, 115, y + 5.5);

    const reqText = `${formatNumber(ing.requiredQuantity, maxDecimals, minDecimals)} ${ing.requiredUnit}`;
    recordText('ingredient_checklist', reqText, 140, y + 5.5);

    if (calc.suggestedBatches > 1 && ing.perBatchQuantity) {
      recordText(
        'ingredient_checklist',
        `${formatNumber(ing.perBatchQuantity, maxDecimals, minDecimals)} ${ing.requiredUnit}`,
        172,
        y + 5.5
      );
    } else if (ing.convertedQuantityInDefaultUnit && ing.defaultUnit) {
      const defaultUnitIsGrams = ing.defaultUnit.trim().toLowerCase() === 'g';
      recordText(
        'ingredient_checklist',
        `${formatNumber(ing.convertedQuantityInDefaultUnit, defaultUnitIsGrams ? 0 : decimalPlaces)} ${ing.defaultUnit.toUpperCase()}`,
        172,
        y + 5.5
      );
    } else {
      recordText('ingredient_checklist', '-', 172, y + 5.5);
    }

    if (ing.jarsDetail?.text || ing.notes) {
      y += 4.5;
      doc.setFontSize(7.5);
      doc.setTextColor(120, 110, 100);
      const subTexts: string[] = [];
      if (ing.jarsDetail?.text) subTexts.push(`Jars Breakdown: ${ing.jarsDetail.text}`);
      if (ing.notes) subTexts.push(`Note: ${ing.notes}`);
      const wrappedSub: string[] = doc.splitTextToSize(subTexts.join('  |  '), 160);
      for (const sLine of wrappedSub) {
        ensureVerticalSpace(4.5);
        recordText('ingredient_checklist', sLine, 30, y + 3.5);
        y += 3.8;
      }
      doc.setFontSize(8.5);
      doc.setTextColor(30, 30, 30);
      y += 3.7;
    } else {
      y += 7.5;
    }
  });

  // Footer Sign-off section
  y = Math.max(y + 10, 260);
  if (y > 275) {
    doc.addPage();
    y = 240;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(CONTENT_LEFT_MM, y, 90, y);
  doc.line(110, y, 196, y);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  recordText('footer', 'Head Baker / Scale Operator Signature', CONTENT_LEFT_MM, y + 4);
  recordText('footer', 'Quality Control / Batch Completion Date', 110, y + 4);

  const safeSlug = recipeName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const fileName = `production_${safeSlug}_${Date.now()}.pdf`;

  const shouldDownload =
    safetyContext?.skipDownload === true
      ? false
      : typeof window !== 'undefined' && typeof document !== 'undefined';

  if (shouldDownload) {
    doc.save(fileName);
  }

  return {
    fileName,
    pageCount: doc.getNumberOfPages(),
    recipeName,
    selectedPresetLabels,
    hasCriticalNotes: safetyResolution.hasSafetyNotes,
    renderedSafetyInstructions: safetyResolution.allInstructions,
    blocks,
  };
}
