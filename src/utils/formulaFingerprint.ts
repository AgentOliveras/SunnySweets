import { QuoteFormula, QuoteFormulaLine } from '../types/quoting';
import { Ingredient } from '../types';

export interface FingerprintLineInput {
  name: string;
  quantity: number | string;
  unit: string;
  masterIngredientId?: string;
}

/**
 * Generates a deterministic, canonical formulation fingerprint.
 *
 * Requirements (Phase 2B.6):
 * - Represents formulation identity (ingredient identity, quantity, unit, master ingredient link).
 * - Deterministic sort order independent of input sequence.
 * - Does NOT include volatile timestamps, UUIDs, or presentation-only attributes.
 * - Used for duplicate promotion detection, provenance tracking, and formulation divergence checks.
 */
export function generateFormulaFingerprint(
  linesOrFormula: QuoteFormula | QuoteFormulaLine[] | Ingredient[] | FingerprintLineInput[]
): string {
  let lines: FingerprintLineInput[] = [];

  if (Array.isArray(linesOrFormula)) {
    lines = linesOrFormula;
  } else if (linesOrFormula && Array.isArray((linesOrFormula as QuoteFormula).lines)) {
    lines = (linesOrFormula as QuoteFormula).lines;
  }

  if (lines.length === 0) {
    return 'fp:v1:empty';
  }

  // Canonicalize each line
  const canonicalLines = lines.map((line) => {
    const rawQty = typeof line.quantity === 'number' ? line.quantity : parseFloat(String(line.quantity) || '0');
    // Normalize to 4 decimal places to prevent float summation or precision drift
    const qtyNorm = isNaN(rawQty) ? '0' : String(parseFloat(rawQty.toFixed(4)));
    const unitNorm = (line.unit || '').trim().toLowerCase();
    const nameNorm = (line.name || '').trim().toLowerCase();
    const midNorm = (line.masterIngredientId || '').trim();

    return {
      key: `${midNorm || nameNorm}:::${unitNorm}:::${qtyNorm}`,
      name: nameNorm,
      qty: qtyNorm,
      unit: unitNorm,
      mid: midNorm,
    };
  });

  // Deterministically sort lines
  canonicalLines.sort((a, b) => a.key.localeCompare(b.key));

  const serialized = canonicalLines
    .map((c) => `m=${c.mid || '-'};n=${c.name};q=${c.qty};u=${c.unit}`)
    .join('|');

  return `fp:v1:${serialized}`;
}
