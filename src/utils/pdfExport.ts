import jsPDF from 'jspdf';
import { CalculationResult, ProductionHistoryEntry } from '../types';
import { formatNumber, getUnitLabel } from './units';

export function exportProductionSheetPDF(
  calc: CalculationResult | ProductionHistoryEntry,
  businessName = 'Artisan Bakery Co.',
  decimalPlaces = 2
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const recipeName = 'recipe' in calc ? calc.recipe.name : calc.recipeName;
  const dateStr = 'calculatedAt' in calc && calc.calculatedAt
    ? new Date(calc.calculatedAt).toLocaleString()
    : new Date().toLocaleString();

  let y = 15;

  // Header Banner
  doc.setFillColor(180, 83, 9); // Amber 700 tone
  doc.rect(0, 0, 210, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PRODUCTION SHEET & INGREDIENT SCALING', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(businessName, 14, 18);
  doc.text(`Generated: ${dateStr}`, 145, 18);

  y = 32;

  // Recipe & Target Summary Box
  doc.setFillColor(250, 248, 245);
  doc.setDrawColor(226, 218, 206);
  doc.roundedRect(14, y, 182, 34, 3, 3, 'FD');

  doc.setTextColor(24, 24, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(recipeName, 18, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Total Finished Pieces: ${calc.totalPieces.toLocaleString()} items`, 18, y + 16);
  doc.text(
    `Total Batch Weight: ${formatNumber(calc.displayBatchWeight, decimalPlaces)} ${calc.displayWeightUnit.toUpperCase()}`,
    18,
    y + 23
  );

  const wastePercent = 'overrideWastePercent' in calc 
    ? (calc.overrideWastePercent ?? calc.recipeWastePercent) 
    : (calc as any).wastePercent;

  doc.text(`Scaling Multiplier: ${formatNumber(calc.scalingMultiplier, 3)}x`, 110, y + 16);
  doc.text(`Waste Allowance: ${wastePercent ?? 0}%`, 110, y + 23);

  const mixerName = 'mixer' in calc ? calc.mixer?.name : (calc as any).mixerName;
  if (mixerName) {
    doc.text(`Mixer: ${mixerName}`, 110, y + 29);
  }

  y += 40;

  // Capacity Exceeded Safety Warning Banner if applicable
  const isExceeded = 'isCapacityExceeded' in calc ? calc.isCapacityExceeded : calc.capacityExceeded;
  if (isExceeded) {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(248, 113, 113);
    doc.roundedRect(14, y, 182, 14, 2, 2, 'FD');

    doc.setTextColor(185, 28, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(
      `⚠️ WARNING: MIXER CAPACITY EXCEEDED! (Split into ${calc.suggestedBatches} batches required)`,
      18,
      y + 8.5
    );
    y += 18;
  }

  // Production Requirements Table
  doc.setTextColor(24, 24, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Production Items Required', 14, y);
  y += 5;

  doc.setFillColor(243, 238, 230);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 50, 40);
  doc.text('Item / Preset', 18, y + 5);
  doc.text('Quantity / Unit', 90, y + 5);
  doc.text('Item Weight', 140, y + 5);
  doc.text('Subtotal Pieces', 170, y + 5);

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);

  const reqList = 'requirements' in calc ? calc.requirements : [];
  reqList.forEach((req) => {
    doc.text(req.presetName || 'Custom Item', 18, y + 5);
    doc.text(`${req.quantity} (${req.piecesPerUnit} pcs/unit)`, 90, y + 5);
    doc.text(`${req.itemWeight} ${req.itemWeightUnit}`, 140, y + 5);
    doc.text(`${(req.quantity * req.piecesPerUnit).toLocaleString()}`, 170, y + 5);
    y += 6;
  });

  y += 6;

  // Ingredients Scaling Table Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(24, 24, 27);
  doc.text('Scaled Ingredient Formula Checklist', 14, y);
  y += 5;

  doc.setFillColor(180, 83, 9);
  doc.rect(14, y, 182, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.text('Check', 16, y + 5.5);
  doc.text('Ingredient', 30, y + 5.5);
  doc.text('Base Qty', 85, y + 5.5);
  doc.text('Waste %', 115, y + 5.5);
  doc.text('Total Required', 140, y + 5.5);
  if (calc.suggestedBatches > 1) {
    doc.text(`Per Batch (1/${calc.suggestedBatches})`, 172, y + 5.5);
  } else {
    doc.text('Converted (Default)', 172, y + 5.5);
  }

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);

  const ingredients = calc.calculatedIngredients;
  let isEven = false;

  ingredients.forEach((ing) => {
    if (y > 270) {
      doc.addPage();
      y = 15;
    }

    if (isEven) {
      doc.setFillColor(249, 246, 240);
      doc.rect(14, y, 182, 8, 'F');
    }
    isEven = !isEven;

    // Checkbox box
    doc.setDrawColor(160, 160, 160);
    doc.rect(17, y + 2, 4, 4);

    doc.setFont('helvetica', 'bold');
    doc.text(ing.name, 30, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.text(`${formatNumber(ing.baseQuantity, decimalPlaces)} ${ing.baseUnit}`, 85, y + 5.5);
    doc.text(`${ing.wastePercent}%`, 115, y + 5.5);
    doc.text(`${formatNumber(ing.requiredQuantity, decimalPlaces)} ${ing.requiredUnit}`, 140, y + 5.5);

    if (calc.suggestedBatches > 1 && ing.perBatchQuantity) {
      doc.text(`${formatNumber(ing.perBatchQuantity, decimalPlaces)} ${ing.requiredUnit}`, 172, y + 5.5);
    } else if (ing.convertedQuantityInDefaultUnit && ing.defaultUnit) {
      doc.text(
        `${formatNumber(ing.convertedQuantityInDefaultUnit, decimalPlaces)} ${ing.defaultUnit.toUpperCase()}`,
        172,
        y + 5.5
      );
    } else {
      doc.text('-', 172, y + 5.5);
    }

    if (ing.notes) {
      y += 5;
      doc.setFontSize(7.5);
      doc.setTextColor(120, 110, 100);
      doc.text(`Note: ${ing.notes}`, 30, y + 3.5);
      doc.setFontSize(8.5);
      doc.setTextColor(30, 30, 30);
    }

    y += 7.5;
  });

  // Footer Sign-off section
  y = Math.max(y + 10, 260);
  if (y > 275) {
    doc.addPage();
    y = 240;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(14, y, 90, y);
  doc.line(110, y, 196, y);

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text('Head Baker / Scale Operator Signature', 14, y + 4);
  doc.text('Quality Control / Batch Completion Date', 110, y + 4);

  doc.save(`${recipeName.replace(/[^a-zA-Z0-9]/g, '_')}_ProductionSheet.pdf`);
}
