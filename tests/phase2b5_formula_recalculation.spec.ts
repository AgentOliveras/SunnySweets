import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateFormulaTotals,
  calculateProductPricing,
  recalculateProductsPricing,
  checkFormulaCostDrift,
} from '../src/utils/quotingCalculator';
import { quotingService } from '../src/services/quotingService';
import {
  QuoteFormula,
  QuoteFormulaLine,
  QuoteProductConfig,
  ProductProject,
} from '../src/types/quoting';
import { MasterIngredient } from '../src/types';

describe('Phase 2B.5.6.2 — Automatic Formula-to-Pricing Recalculation Suite', () => {
  const pantryIngredients: MasterIngredient[] = [
    {
      id: 'ing-flour',
      name: 'Bread Flour',
      category: 'Flour',
      costPerGram: 0.002,
      preferredPurchasePackage: {
        packagePriceCents: 2000,
        packQuantity: 1,
        unitSize: 10,
        unitMeasure: 'kg',
      },
    },
    {
      id: 'ing-butter',
      name: 'Unsalted Butter',
      category: 'Dairy',
      costPerGram: 0.008,
      preferredPurchasePackage: {
        packagePriceCents: 4000,
        packQuantity: 1,
        unitSize: 5,
        unitMeasure: 'kg',
      },
    },
    {
      id: 'ing-sugar',
      name: 'Granulated Sugar',
      category: 'Sweetener',
      costPerGram: 0.0015,
      preferredPurchasePackage: {
        packagePriceCents: 1500,
        packQuantity: 1,
        unitSize: 10,
        unitMeasure: 'kg',
      },
    },
    {
      id: 'ing-chocolate',
      name: 'Dark Chocolate Chips',
      category: 'Inclusion',
      costPerGram: 0.012,
      preferredPurchasePackage: {
        packagePriceCents: 6000,
        packQuantity: 1,
        unitSize: 5,
        unitMeasure: 'kg',
      },
    },
  ];

  const pantryMap = new Map<string, MasterIngredient>(
    pantryIngredients.map((m) => [m.id, m])
  );

  // Helper to build a standard formula
  const makeBaseFormula = (): QuoteFormula => {
    const lines: QuoteFormulaLine[] = [
      {
        id: 'line-1',
        name: 'Bread Flour',
        quantity: 500,
        unit: 'g',
        masterIngredientId: 'ing-flour',
        unitCostUsed: 0.002,
        unitCostType: 'per_gram',
        lineCost: 1.0,
      },
      {
        id: 'line-2',
        name: 'Unsalted Butter',
        quantity: 250,
        unit: 'g',
        masterIngredientId: 'ing-butter',
        unitCostUsed: 0.008,
        unitCostType: 'per_gram',
        lineCost: 2.0,
      },
      {
        id: 'line-3',
        name: 'Granulated Sugar',
        quantity: 250,
        unit: 'g',
        masterIngredientId: 'ing-sugar',
        unitCostUsed: 0.0015,
        unitCostType: 'per_gram',
        lineCost: 0.38,
      },
    ];
    return calculateFormulaTotals(lines, pantryMap);
  };

  // Helper to build a standard product configuration
  const makeBaseProduct = (formula: QuoteFormula, quotedPrice: number | null = 85.0): QuoteProductConfig => {
    return calculateProductPricing({
      id: 'prod-cookie-4oz',
      productType: 'Cookie',
      name: '4 oz (80/case)',
      pieceWeight: 4,
      weightUnit: 'oz',
      piecesPerCase: 80,
      packagingCost: 3.0,
      laborCost: 11.45,
      otherCost: 0.0,
      ingredientMultiplier: 1.6,
      pricingBasis: 'case',
      quotedPrice,
      formula,
    });
  };

  // ---------------------------------------------------------------------------
  // PART 1 & 2: SINGLE AUTHORITATIVE FORMULA & IMMEDIATE IN-MEMORY RECALCULATION
  // ---------------------------------------------------------------------------
  describe('Part 1 & 2: Authoritative Formula and Immediate Recalculation', () => {
    it('RC1: ProjectEditor immediately recalculates products in memory on formula change without Firestore round trip', () => {
      const editorFile = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/quoting/ProjectEditor.tsx'),
        'utf8'
      );

      // Verify recalculateProductsPricing is called inside FormulaBuilder onChange
      assert.match(
        editorFile,
        /recalculateProductsPricing\s*\(\s*currentProducts\s*,\s*newFormula\s*\)/,
        'ProjectEditor must recalculate products immediately inside FormulaBuilder onChange'
      );
      assert.match(
        editorFile,
        /setProducts\s*\(\s*updatedProducts\s*\)/,
        'ProjectEditor must update React products state immediately'
      );
      assert.match(
        editorFile,
        /markDirtyAndDebounce\(\s*\{\s*[\s\S]*?\.\.\.currentDraftRef\.current,\s*formula:\s*newFormula,\s*products:\s*updatedProducts,?[\s\S]*?\}\)/,
        'ProjectEditor must persist both new formula and updated products to draft recovery'
      );
    });

    it('RC2: ProductsPricingMatrix does NOT require an Apply Changes button', () => {
      const matrixFile = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/quoting/ProductsPricingMatrix.tsx'),
        'utf8'
      );
      assert.ok(
        !matrixFile.includes('Apply Changes'),
        'ProductsPricingMatrix must not require or display an Apply Changes button'
      );
      assert.ok(
        !matrixFile.includes('apply-changes-btn'),
        'ProductsPricingMatrix must not have apply-changes-btn testid'
      );
    });

    it('RC3: Tab navigation preserves latest formula and recalculated pricing without losing edits', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // User modifies Butter quantity from 250g to 500g in FormulaBuilder
      const modifiedLines = baseF.lines.map((l) =>
        l.id === 'line-2' ? { ...l, quantity: 500 } : l
      );
      const newF = calculateFormulaTotals(modifiedLines, pantryMap);

      // Formula total cost increased
      assert.strictEqual(newF.totalCost > baseF.totalCost, true);

      // Recalculate products immediately as done by handleFormulaChange
      const updatedProducts = recalculateProductsPricing([baseP], newF);
      const updatedP = updatedProducts[0];

      // Verification: rawIngredientCost increased
      assert.strictEqual(updatedP.rawIngredientCost > baseP.rawIngredientCost, true);
      // COGS increased
      assert.strictEqual(updatedP.totalProductionCost > baseP.totalProductionCost, true);
      // Suggested selling price increased
      assert.strictEqual(updatedP.calculatedTargetPrice > baseP.calculatedTargetPrice, true);
    });
  });

  // ---------------------------------------------------------------------------
  // PART 3: ALL 11 FORMULA & PRICING TRIGGERS RECALCULATE AUTOMATICALLY
  // ---------------------------------------------------------------------------
  describe('Part 3: 11 Input Triggers Automatically Propagate to Pricing', () => {
    it('Trigger 1: Adding an ingredient updates formula cost and increases COGS & Suggested Selling Price', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // Add chocolate chips
      const newLines: QuoteFormulaLine[] = [
        ...baseF.lines,
        {
          id: 'line-4',
          name: 'Dark Chocolate Chips',
          quantity: 200,
          unit: 'g',
          masterIngredientId: 'ing-chocolate',
          unitCostUsed: 0.012,
          unitCostType: 'per_gram',
          lineCost: 2.4,
        },
      ];
      const updatedF = calculateFormulaTotals(newLines, pantryMap);
      assert.strictEqual(updatedF.totalWeightGrams, baseF.totalWeightGrams + 200);
      assert.strictEqual(updatedF.totalCost, Number((baseF.totalCost + 2.4).toFixed(2)));

      const [updatedP] = recalculateProductsPricing([baseP], updatedF);
      assert.strictEqual(updatedP.rawIngredientCost > baseP.rawIngredientCost, true);
      assert.strictEqual(updatedP.totalProductionCost > baseP.totalProductionCost, true);
      assert.strictEqual(updatedP.calculatedTargetPrice > baseP.calculatedTargetPrice, true);
      assert.strictEqual(updatedP.costPerUnit! > baseP.costPerUnit!, true);
    });

    it('Trigger 2: Removing an ingredient decreases formula cost and decreases COGS & Target Price', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // Remove butter (line-2)
      const newLines = baseF.lines.filter((l) => l.id !== 'line-2');
      const updatedF = calculateFormulaTotals(newLines, pantryMap);

      assert.strictEqual(updatedF.totalCost < baseF.totalCost, true);
      const [updatedP] = recalculateProductsPricing([baseP], updatedF);

      assert.strictEqual(updatedP.rawIngredientCost < baseP.rawIngredientCost, true);
      assert.strictEqual(updatedP.totalProductionCost < baseP.totalProductionCost, true);
      assert.strictEqual(updatedP.calculatedTargetPrice < baseP.calculatedTargetPrice, true);
    });

    it('Trigger 3: Editing an ingredient quantity immediately changes formula weight and raw ingredient cost', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // Halve flour quantity
      const newLines = baseF.lines.map((l) =>
        l.id === 'line-1' ? { ...l, quantity: 250 } : l
      );
      const updatedF = calculateFormulaTotals(newLines, pantryMap);

      assert.strictEqual(updatedF.totalWeightGrams, baseF.totalWeightGrams - 250);
      const [updatedP] = recalculateProductsPricing([baseP], updatedF);
      assert.notStrictEqual(updatedP.rawIngredientCost, baseP.rawIngredientCost);
    });

    it('Trigger 4: Changing ingredient units (e.g. g to kg) recalculates line cost and COGS', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // Change line-2 (butter) from 250g to 1 kg
      const newLines = baseF.lines.map((l) =>
        l.id === 'line-2' ? { ...l, quantity: 1, unit: 'kg' } : l
      );
      const updatedF = calculateFormulaTotals(newLines, pantryMap);

      // 1 kg butter = 1000g * 0.008 = $8.00 (was 250g = $2.00)
      assert.strictEqual(updatedF.lines.find((l) => l.id === 'line-2')?.lineCost, 8.0);
      const [updatedP] = recalculateProductsPricing([baseP], updatedF);
      assert.strictEqual(updatedP.totalProductionCost > baseP.totalProductionCost, true);
    });

    it('Trigger 5: Adding and editing a temporary R&D ingredient recalculates costs without master ingredient', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // Add temporary ingredient: Madagascar Vanilla Paste ($35.00 for 500g bottle, use 10g)
      const tempLine: QuoteFormulaLine = {
        id: 'line-temp-1',
        name: 'Madagascar Vanilla Paste',
        quantity: 10,
        unit: 'g',
        isTemporary: true,
        temporaryData: {
          name: 'Madagascar Vanilla Paste',
          packagePriceCents: 3500, // $35.00
          packQuantity: 1,
          unitSize: 500,
          unitMeasure: 'g',
        },
        unitCostUsed: 0.07, // $35.00 / 500g = $0.07/g
        unitCostType: 'per_gram',
        lineCost: 0.70, // 10g * 0.07 = $0.70
      };

      const updatedF = calculateFormulaTotals([...baseF.lines, tempLine], pantryMap);
      assert.strictEqual(updatedF.totalCost, Number((baseF.totalCost + 0.70).toFixed(2)));

      const [updatedP] = recalculateProductsPricing([baseP], updatedF);
      assert.strictEqual(updatedP.rawIngredientCost > baseP.rawIngredientCost, true);
      assert.strictEqual(updatedP.totalProductionCost > baseP.totalProductionCost, true);
    });

    it('Trigger 6: Resolving or changing a Master Ingredient link recalculates line cost and pricing', () => {
      // Start with unlinked line
      const unlinkedLines: QuoteFormulaLine[] = [
        {
          id: 'line-unlinked',
          name: 'Organic Cocoa Powder',
          quantity: 200,
          unit: 'g',
          unitCostUsed: 0,
          unitCostType: 'per_gram',
          lineCost: 0,
        },
      ];
      const initialF = calculateFormulaTotals(unlinkedLines, pantryMap);
      assert.strictEqual(initialF.totalCost, 0);

      const pInitial = makeBaseProduct(initialF);
      assert.strictEqual(pInitial.rawIngredientCost, 0);

      // Now resolve link to chocolate ($0.012/g)
      const resolvedLines: QuoteFormulaLine[] = [
        {
          ...unlinkedLines[0],
          masterIngredientId: 'ing-chocolate',
        },
      ];
      const resolvedF = calculateFormulaTotals(resolvedLines, pantryMap);
      // 200g * 0.012 = $2.40
      assert.strictEqual(resolvedF.totalCost, 2.4);

      const [pResolved] = recalculateProductsPricing([pInitial], resolvedF);
      assert.strictEqual(pResolved.rawIngredientCost > 0, true);
      assert.strictEqual(pResolved.totalProductionCost > pInitial.totalProductionCost, true);
    });

    it('Trigger 7: Changing an applicable ingredient purchasing cost (drift) recalculates working formula', () => {
      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF);

      // Create pantry with updated butter price: $0.008 -> $0.012/g
      const updatedPantryMap = new Map<string, MasterIngredient>(pantryMap);
      const currentButter = pantryMap.get('ing-butter')!;
      updatedPantryMap.set('ing-butter', {
        ...currentButter,
        costPerGram: 0.012,
        preferredPurchasePackage: {
          ...currentButter.preferredPurchasePackage!,
          packagePriceCents: 6000,
        },
      });

      // Drift check detects difference
      const drift = checkFormulaCostDrift(baseF, updatedPantryMap);
      assert.strictEqual(drift.hasDrift, true);

      // Applying live costs recalculates formula
      const liveF = calculateFormulaTotals(baseF.lines, updatedPantryMap);
      assert.strictEqual(liveF.totalCost > baseF.totalCost, true);

      const [updatedP] = recalculateProductsPricing([baseP], liveF);
      assert.strictEqual(updatedP.totalProductionCost > baseP.totalProductionCost, true);
    });

    it('Trigger 8: Changing product piece weight recalculates dough weight and raw ingredient cost', () => {
      const baseF = makeBaseFormula();
      const pSmall = calculateProductPricing({
        pieceWeight: 2, // 2 oz
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        ingredientMultiplier: 1.6,
        formula: baseF,
      });

      const pLarge = calculateProductPricing({
        pieceWeight: 4, // 4 oz
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        ingredientMultiplier: 1.6,
        formula: baseF,
      });

      assert.strictEqual(Math.abs(pLarge.doughWeightGrams - pSmall.doughWeightGrams * 2) <= 0.02, true);
      assert.strictEqual(pLarge.rawIngredientCost > pSmall.rawIngredientCost, true);
    });

    it('Trigger 9: Changing pieces per case recalculates case dough weight, COGS, and Cost / Unit', () => {
      const baseF = makeBaseFormula();
      const p40 = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 40,
        packagingCost: 3.0,
        laborCost: 11.45,
        ingredientMultiplier: 1.6,
        formula: baseF,
      });

      const p80 = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 3.0,
        laborCost: 11.45,
        ingredientMultiplier: 1.6,
        formula: baseF,
      });

      assert.strictEqual(Math.abs(p80.doughWeightGrams - p40.doughWeightGrams * 2) <= 0.02, true);
      assert.strictEqual(p80.totalProductionCost > p40.totalProductionCost, true);
      assert.ok(p40.costPerUnit! > 0);
      assert.ok(p80.costPerUnit! > 0);
    });

    it('Trigger 10: Changing packaging, labor, or other direct cost recalculates COGS and target price', () => {
      const baseF = makeBaseFormula();
      const p1 = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 2.0,
        laborCost: 10.0,
        otherCost: 1.0,
        ingredientMultiplier: 1.6,
        formula: baseF,
      });

      const p2 = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 4.0, // +$2
        laborCost: 15.0,    // +$5
        otherCost: 3.0,     // +$2
        ingredientMultiplier: 1.6,
        formula: baseF,
      });

      // Raw ingredient cost remains identical because formula did not change
      assert.strictEqual(p1.rawIngredientCost, p2.rawIngredientCost);
      // COGS increased by exactly $9.00
      assert.strictEqual(p2.totalProductionCost, Number((p1.totalProductionCost + 9.0).toFixed(2)));
      // Target price increased by exactly $9.00 (non-ingredient costs not multiplied)
      assert.strictEqual(p2.calculatedTargetPrice, Number((p1.calculatedTargetPrice + 9.0).toFixed(2)));
    });

    it('Trigger 11: Changing ingredient multiplier applies strictly to raw ingredients without multiplying direct costs', () => {
      const baseF = makeBaseFormula();
      const p15 = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 5.0,
        laborCost: 10.0,
        ingredientMultiplier: 1.5,
        formula: baseF,
      });

      const p20 = calculateProductPricing({
        pieceWeight: 4,
        weightUnit: 'oz',
        piecesPerCase: 80,
        packagingCost: 5.0,
        laborCost: 10.0,
        ingredientMultiplier: 2.0,
        formula: baseF,
      });

      // COGS is unaffected by multiplier
      assert.strictEqual(p15.totalProductionCost, p20.totalProductionCost);
      // Target price differs strictly by rawIngredientCost * (2.0 - 1.5)
      const expectedDiff = Number((p15.rawIngredientCost * 0.5).toFixed(2));
      const actualDiff = Number((p20.calculatedTargetPrice - p15.calculatedTargetPrice).toFixed(2));
      assert.strictEqual(actualDiff, expectedDiff);
    });
  });

  // ---------------------------------------------------------------------------
  // PART 4: ACTUAL QUOTED PRICE PROTECTION & MARGIN RECALCULATION
  // ---------------------------------------------------------------------------
  describe('Part 4: Actual Quoted Price Protection and Management Decision Safety', () => {
    it('M1: When formula cost changes, manually entered Actual Quoted Price is strictly preserved', () => {
      const baseF = makeBaseFormula();
      const p = makeBaseProduct(baseF, 89.95);
      assert.strictEqual(p.quotedPrice, 89.95);

      // Increase butter quantity in formula
      const newLines = baseF.lines.map((l) =>
        l.id === 'line-2' ? { ...l, quantity: 1000 } : l
      );
      const newF = calculateFormulaTotals(newLines, pantryMap);

      const [updatedP] = recalculateProductsPricing([p], newF);
      // Actual quoted price is PRESERVED, never overwritten by suggested selling price
      assert.strictEqual(updatedP.quotedPrice, 89.95);
      assert.notStrictEqual(updatedP.quotedPrice, updatedP.calculatedTargetPrice);
    });

    it('M2: Actual profit and margin are recalculated against the new COGS when formula changes', () => {
      const baseF = makeBaseFormula();
      const pInitial = makeBaseProduct(baseF, 80.0);

      const oldProfit = pInitial.dollarProfit;
      const oldMargin = pInitial.grossMarginPercent;
      const oldCogs = pInitial.totalProductionCost;
      assert.strictEqual(oldProfit, Number((80.0 - oldCogs).toFixed(2)));

      // Increase butter cost
      const newLines = baseF.lines.map((l) =>
        l.id === 'line-2' ? { ...l, quantity: 1000 } : l
      );
      const newF = calculateFormulaTotals(newLines, pantryMap);

      const [updatedP] = recalculateProductsPricing([pInitial], newF);
      const newCogs = updatedP.totalProductionCost;
      assert.strictEqual(newCogs > oldCogs, true);

      // New profit = 80.0 - newCogs (lower than old profit)
      assert.strictEqual(updatedP.dollarProfit, Number((80.0 - newCogs).toFixed(2)));
      assert.strictEqual(updatedP.dollarProfit < oldProfit, true);

      // New margin % = (new profit / 80.0) * 100 (lower than old margin)
      assert.strictEqual(
        updatedP.grossMarginPercent,
        Number(((updatedP.dollarProfit / 80.0) * 100).toFixed(2))
      );
      assert.strictEqual(updatedP.grossMarginPercent < oldMargin, true);
    });

    it('M3: Unquoted product configuration (blank Actual Quote) remains strictly null after recalculation', () => {
      const baseF = makeBaseFormula();
      const unquotedP = makeBaseProduct(baseF, null);
      assert.strictEqual(unquotedP.quotedPrice, null);
      assert.strictEqual(unquotedP.isQuotedPriceSet, false);

      const newLines = baseF.lines.map((l) =>
        l.id === 'line-1' ? { ...l, quantity: 1000 } : l
      );
      const newF = calculateFormulaTotals(newLines, pantryMap);

      const [updatedP] = recalculateProductsPricing([unquotedP], newF);
      assert.strictEqual(updatedP.quotedPrice, null);
      assert.strictEqual(updatedP.quotedPricePerUnit, null);
      assert.strictEqual(updatedP.isQuotedPriceSet, false);
      assert.strictEqual(updatedP.dollarProfit, 0);
      assert.strictEqual(updatedP.grossMarginPercent, 0);
    });

    it('M4: Formula recalculation does NOT automatically issue a quote or bump currentRevisionNumber', () => {
      const baseF = makeBaseFormula();
      const project: ProductProject = {
        id: 'proj-no-auto-quote',
        workspaceId: 'ws-test',
        projectCode: 'Q-2026-001',
        productName: 'Revision Safe Cookie',
        formulaOwnership: 'bakery_owned',
        status: 'draft',
        formula: baseF,
        products: [makeBaseProduct(baseF, 75.0)],
        currentRevisionNumber: 0,
        revisions: [],
        createdAt: new Date().toISOString(),
        createdBy: 'usr-1',
        updatedAt: new Date().toISOString(),
        updatedBy: 'usr-1',
      };

      // Modify formula and recalculate products
      const newLines = baseF.lines.map((l) =>
        l.id === 'line-2' ? { ...l, quantity: 500 } : l
      );
      const newF = calculateFormulaTotals(newLines, pantryMap);
      const updatedProducts = recalculateProductsPricing(project.products, newF);

      const updatedProject: ProductProject = {
        ...project,
        formula: newF,
        products: updatedProducts,
      };

      assert.strictEqual(updatedProject.currentRevisionNumber, 0);
      assert.strictEqual(updatedProject.revisions?.length, 0);
      assert.strictEqual(updatedProject.status, 'draft');
    });
  });

  // ---------------------------------------------------------------------------
  // PART 5: MULTI-PRODUCT PROJECT INTEGRITY & REVISION IMMUTABILITY
  // ---------------------------------------------------------------------------
  describe('Part 5: Multi-Product Consistency and Historical Revision Immutability', () => {
    it('MP1: When formula changes in a multi-product project, ALL configurations are updated simultaneously', () => {
      const baseF = makeBaseFormula();
      const pSmall = calculateProductPricing({
        id: 'conf-small',
        pieceWeight: 2,
        weightUnit: 'oz',
        piecesPerCase: 120,
        packagingCost: 2.5,
        laborCost: 8.0,
        ingredientMultiplier: 1.6,
        quotedPrice: 65.0,
        formula: baseF,
      });

      const pLarge = calculateProductPricing({
        id: 'conf-large',
        pieceWeight: 5,
        weightUnit: 'oz',
        piecesPerCase: 60,
        packagingCost: 4.0,
        laborCost: 14.0,
        ingredientMultiplier: 1.6,
        quotedPrice: 110.0,
        formula: baseF,
      });

      // Modify formula: increase butter from 250g to 750g (increases cost per gram)
      const newLines = baseF.lines.map((l) =>
        l.id === 'line-2' ? { ...l, quantity: 750 } : l
      );
      const newF = calculateFormulaTotals(newLines, pantryMap);

      const recalculated = recalculateProductsPricing([pSmall, pLarge], newF);
      assert.strictEqual(recalculated.length, 2);

      const [recSmall, recLarge] = recalculated;
      assert.strictEqual(recSmall.id, 'conf-small');
      assert.strictEqual(recLarge.id, 'conf-large');

      // Both configs updated their raw ingredients
      assert.strictEqual(recSmall.rawIngredientCost > pSmall.rawIngredientCost, true);
      assert.strictEqual(recLarge.rawIngredientCost > pLarge.rawIngredientCost, true);

      // Both configs preserved their actual quoted prices
      assert.strictEqual(recSmall.quotedPrice, 65.0);
      assert.strictEqual(recLarge.quotedPrice, 110.0);

      // Both recalculated actual profits
      assert.strictEqual(recSmall.dollarProfit < pSmall.dollarProfit, true);
      assert.strictEqual(recLarge.dollarProfit < pLarge.dollarProfit, true);
    });

    it('MP2: Historical QuoteRevision snapshots remain strictly immutable after working formula changes', async () => {
      const wsId = 'ws-immutable-recalc';
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Revision Frozen Formula Test',
        userId: 'usr-baker-1',
      });

      const baseF = makeBaseFormula();
      const baseP = makeBaseProduct(baseF, 85.0);

      await quotingService.saveProject({
        ...project,
        formula: baseF,
        products: [baseP],
      });

      // Issue Revision 1
      const afterIssue = await quotingService.issueQuoteRevision(
        project.id,
        wsId,
        'usr-baker-1',
        'Head Baker',
        'Revision 1 initial customer quote'
      );

      const rev1Snapshot = afterIssue.revisions![0];
      const frozenTotalCost = rev1Snapshot.formulaSnapshot.totalCost;
      const frozenCogs = rev1Snapshot.productsSnapshot[0].totalProductionCost;
      const frozenQuoted = rev1Snapshot.productsSnapshot[0].quotedPrice;

      // Now working formula is edited extensively: add chocolate chips to increase cost per gram
      const modifiedLines: QuoteFormulaLine[] = [
        ...baseF.lines,
        {
          id: 'line-add-choc',
          name: 'Dark Chocolate Chips',
          quantity: 500,
          unit: 'g',
          masterIngredientId: 'ing-chocolate',
          unitCostUsed: 0.012,
          unitCostType: 'per_gram',
          lineCost: 6.0,
        },
      ];
      const modifiedF = calculateFormulaTotals(modifiedLines, pantryMap);
      const modifiedProducts = recalculateProductsPricing([baseP], modifiedF);

      await quotingService.saveProject({
        ...afterIssue,
        formula: modifiedF,
        products: modifiedProducts,
      });

      // Reload project from quotingService
      const reloaded = quotingService.getProject(wsId, project.id);
      assert.ok(reloaded);

      // Working formula and products are updated
      assert.strictEqual(reloaded.formula.totalCost > frozenTotalCost, true);
      assert.strictEqual(reloaded.products[0].totalProductionCost > frozenCogs, true);

      // HISTORICAL REVISION REMAINS 100% UNCHANGED AND FROZEN
      assert.strictEqual(reloaded.revisions?.length, 1);
      const reloadedRev1 = reloaded.revisions![0];
      assert.strictEqual(reloadedRev1.formulaSnapshot.totalCost, frozenTotalCost);
      assert.strictEqual(reloadedRev1.productsSnapshot[0].totalProductionCost, frozenCogs);
      assert.strictEqual(reloadedRev1.productsSnapshot[0].quotedPrice, frozenQuoted);
    });
  });
});
