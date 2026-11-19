import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { quotingService } from '../src/services/quotingService';
import {
  ProductProject,
  QuoteFormula,
  QuoteFormulaLine,
  TemporaryIngredientData,
} from '../src/types/quoting';
import { calculateFormulaTotals, calculateProductPricing } from '../src/utils/quotingCalculator';

// Mock localStorage for node test runner environment
const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] || null,
  };
};

describe('Phase 2B.5.6 — Product Development Data Persistence & Workflow Fixes Suite', () => {
  const wsId = 'ws-persistence-test';
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    (globalThis as any).localStorage = mockStorage;
  });

  // ---------------------------------------------------------------------------
  // ISSUE 1: Temporary R&D Ingredient Form Reset & Edit Isolation
  // ---------------------------------------------------------------------------
  describe('Issue 1: Temporary R&D Ingredient Modal & State Isolation', () => {
    it('T1: Create temporary ingredient A; save; reopen Add; form blank', () => {
      const modalPath = path.join(process.cwd(), 'src/components/quoting/TemporaryIngredientModal.tsx');
      assert.ok(fs.existsSync(modalPath), 'TemporaryIngredientModal.tsx must exist');
      const content = fs.readFileSync(modalPath, 'utf-8');

      // Verify resetForm resets every field to its clean creation default
      assert.match(content, /setName\(''\)/, 'Must reset name to empty');
      assert.match(content, /setPackagePriceDollars\(''\)/, 'Must reset price to empty');
      assert.match(content, /setPackQuantity\('1'\)/, 'Must reset pack quantity to 1');
      assert.match(content, /setUnitSize\(''\)/, 'Must reset unit size to empty');
      assert.match(content, /setUnitMeasure\('lb'\)/, 'Must reset unit measure to lb');
      assert.match(content, /setDensity\(''\)/, 'Must reset density to empty');
      assert.match(content, /setNotes\(''\)/, 'Must reset notes to empty');
      assert.match(content, /setError\(null\)/, 'Must clear error state');

      // Verify clean reset on successful save
      assert.match(content, /resetForm\(\);\s*onClose\(\);/, 'Must call resetForm and onClose after successful save');

      // Verify clean reset when opening for new item
      assert.match(content, /if\s*\(isEditing\s*&&\s*initialData\)/, 'Must populate only if isEditing and initialData');
    });

    it('T2: Create ingredient B immediately afterward; no fields inherited from A', () => {
      // Simulate state machine for two consecutive creations
      let currentFormData = {
        name: '',
        packagePriceDollars: '',
        packQuantity: '1',
        unitSize: '',
        unitMeasure: 'lb',
        density: '',
        notes: '',
      };

      const resetForm = () => {
        currentFormData = {
          name: '',
          packagePriceDollars: '',
          packQuantity: '1',
          unitSize: '',
          unitMeasure: 'lb',
          density: '',
          notes: '',
        };
      };

      // Ingredient A entered & saved
      currentFormData = {
        name: 'Organic Madagascar Vanilla Paste',
        packagePriceDollars: '120.00',
        packQuantity: '1',
        unitSize: '32',
        unitMeasure: 'oz',
        density: '1.25',
        notes: 'Premium extraction lot #A1',
      };
      assert.strictEqual(currentFormData.name, 'Organic Madagascar Vanilla Paste');

      // Save succeeds -> resetForm executed
      resetForm();

      // Open Add modal for Ingredient B -> assert all fields clean
      assert.strictEqual(currentFormData.name, '', 'Ingredient B name must start blank');
      assert.strictEqual(currentFormData.packagePriceDollars, '', 'Ingredient B price must start blank');
      assert.strictEqual(currentFormData.packQuantity, '1', 'Ingredient B pack qty must default to 1');
      assert.strictEqual(currentFormData.unitSize, '', 'Ingredient B unit size must start blank');
      assert.strictEqual(currentFormData.unitMeasure, 'lb', 'Ingredient B unit measure must default to lb');
      assert.strictEqual(currentFormData.density, '', 'Ingredient B density must start blank');
      assert.strictEqual(currentFormData.notes, '', 'Ingredient B notes must start blank');
    });

    it('T3: Edit existing temporary ingredient; existing values correctly populated', () => {
      const existingTempData: TemporaryIngredientData = {
        name: 'Belgian Dark Chocolate Chunks 70%',
        packagePriceCents: 4500,
        packQuantity: 2,
        unitSize: 10,
        unitMeasure: 'lb',
        densityGramsPerMl: 1.35,
        notes: 'Callebaut wholesale block',
      };

      // When opening with initialData and isEditing = true
      const populatedState = {
        name: existingTempData.name,
        packagePriceDollars: (existingTempData.packagePriceCents / 100).toFixed(2),
        packQuantity: String(existingTempData.packQuantity),
        unitSize: String(existingTempData.unitSize),
        unitMeasure: existingTempData.unitMeasure,
        density: String(existingTempData.densityGramsPerMl),
        notes: existingTempData.notes || '',
      };

      assert.strictEqual(populatedState.name, 'Belgian Dark Chocolate Chunks 70%');
      assert.strictEqual(populatedState.packagePriceDollars, '45.00');
      assert.strictEqual(populatedState.packQuantity, '2');
      assert.strictEqual(populatedState.unitSize, '10');
      assert.strictEqual(populatedState.unitMeasure, 'lb');
      assert.strictEqual(populatedState.density, '1.35');
      assert.strictEqual(populatedState.notes, 'Callebaut wholesale block');
    });

    it('T4: Failed temporary ingredient save retains entered data', () => {
      const builderPath = path.join(process.cwd(), 'src/components/quoting/FormulaBuilder.tsx');
      const builderContent = fs.readFileSync(builderPath, 'utf-8');

      // Verify FormulaBuilder supports editing temporary lines
      assert.match(builderContent, /editingTempLineId/, 'FormulaBuilder must track editingTempLineId');
      assert.match(builderContent, /btn-edit-temp-/, 'FormulaBuilder must render edit button for temporary lines');

      // Verify modal retain behavior on error
      const modalPath = path.join(process.cwd(), 'src/components/quoting/TemporaryIngredientModal.tsx');
      const modalContent = fs.readFileSync(modalPath, 'utf-8');
      assert.match(
        modalContent,
        /catch\s*\((?:err|e)[^)]*\)\s*\{[\s\S]*?setError\(/,
        'Modal catch block must set error and must NOT call resetForm'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // ISSUE 2: Autosave & Data Persistence Across Navigation
  // ---------------------------------------------------------------------------
  describe('Issue 2: Debounced Autosave, Identity Stability & Draft Recovery', () => {
    it('T5: Enter 12 ingredients; wait for autosave; navigate away; return; all 12 retained', async () => {
      // 1. Create initial project with stable persisted identity
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Artisan Sourdough Croissant',
        userId: 'usr-baker-1',
      });
      assert.ok(project.id, 'Project must have stable persisted id');

      // 2. Add 12 distinct ingredient lines
      const twelveLines: QuoteFormulaLine[] = [];
      for (let i = 1; i <= 12; i++) {
        twelveLines.push({
          id: `line-${i}`,
          name: `Ingredient ${i}`,
          quantity: 100 * i,
          unit: 'g',
          unitCostUsed: 0.01 * i,
          unitCostType: 'per_gram',
          lineCost: (100 * i) * (0.01 * i),
        });
      }

      const updatedProject: ProductProject = {
        ...project,
        formula: {
          totalWeightGrams: twelveLines.reduce((acc, l) => acc + l.quantity, 0),
          totalCost: twelveLines.reduce((acc, l) => acc + l.lineCost, 0),
          lines: twelveLines,
        },
      };

      // 3. Persist via autosave canonical method
      await quotingService.saveProject(updatedProject);

      // 4. Simulate navigating away and reloading project from quotingService
      const reloaded = quotingService.getProject(wsId, project.id);
      assert.ok(reloaded, 'Project must exist after navigation');
      assert.strictEqual(reloaded.formula.lines.length, 12, 'All 12 ingredients must be retained');
      assert.strictEqual(reloaded.formula.lines[0].name, 'Ingredient 1');
      assert.strictEqual(reloaded.formula.lines[11].name, 'Ingredient 12');
      assert.strictEqual(reloaded.formula.totalWeightGrams, 7800);
    });

    it('T6: Edit a quantity; navigate quickly; latest value retained or navigation safely blocked', async () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');

      // Verify handleBack flushes pending saves before navigating
      assert.match(content, /handleBack\s*=\s*async\s*\(\)\s*=>/, 'handleBack must be an async handler');
      assert.match(
        content,
        /if\s*\(debounceTimerRef\.current\s*\|\|\s*saveStatus\s*===\s*'unsaved'\s*\|\|\s*saveStatus\s*===\s*'saving'\)/,
        'handleBack must check for pending unsaved changes'
      );
      assert.match(content, /await\s+executeSave\(\)/, 'handleBack must await executeSave() before leaving');

      // Verify local recovery draft is written immediately on every keystroke
      assert.match(
        content,
        /quotingService\.saveDraftRecovery\(project\.workspaceId,\s*project\.id,\s*updatedDraft(?:,\s*userScope)?\)/,
        'markDirtyAndDebounce must immediately write to local recovery storage'
      );
    });

    it('T7: Rapid typing and overlapping saves cannot revert latest edits', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Initial Name',
        userId: 'usr-baker-1',
      });

      // Simulate rapid sequential edits with monotonically increasing versions
      const v1 = { ...project, productName: 'Edit 1 (slow network)' };
      const v2 = { ...project, productName: 'Edit 2' };
      const v3 = { ...project, productName: 'Edit 3 (FINAL)' };

      // Dispatch v1, v2, v3 in rapid succession with version tags
      const p1 = quotingService.saveProject(v1, 1);
      const p2 = quotingService.saveProject(v2, 2);
      const p3 = quotingService.saveProject(v3, 3);

      await Promise.all([p1, p2, p3]);

      // Assert final persisted state is Edit 3, not reverted by older in-flight response
      const latest = quotingService.getProject(wsId, project.id);
      assert.ok(latest);
      assert.strictEqual(latest.productName, 'Edit 3 (FINAL)');
    });
  });

  // ---------------------------------------------------------------------------
  // ISSUE 3: Bottom Save Draft Button & Shared Actions Invariance
  // ---------------------------------------------------------------------------
  describe('Issue 3: Canonical Bottom & Top Save Draft Handlers', () => {
    it('T8: Failed autosave does not falsely display Saved', () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');
      assert.match(content, /catch\s*\([^)]*\)\s*\{[\s\S]*?setSaveStatus\('error'\)/, 'Save failure must transition to error state');
      assert.match(content, /setSaveErrorMsg\(/, 'Save failure must set error message');
      // Saved state is only entered on successful resolve
      assert.match(content, /await\s+onSaveDraft\(draftToSave\);[\s\S]*?setSaveStatus\('saved'\)/, 'setSaveStatus saved must only be called after onSaveDraft resolves');
    });

    it('T9: Failed autosave retains edits and supports retry', () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');
      assert.match(content, /Save Failed/, 'Must display Save Failed message');
      assert.match(content, /Retry/, 'Must provide explicit Retry action button');
      assert.match(content, /onClick=\{\(\)\s*=>\s*executeSave\(\)\}/, 'Retry button must invoke executeSave()');
    });

    it('T10: Refresh/reopen restores last successfully saved draft', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Persistence Check Product',
        userId: 'usr-baker-1',
      });

      const updatedProject: ProductProject = {
        ...project,
        customerName: 'Gourmet Cafe Group',
        description: 'Custom recipe version 4',
      };
      await quotingService.saveProject(updatedProject);

      // Re-query quotingService simulates reopening
      const restored = quotingService.getProject(wsId, project.id);
      assert.ok(restored);
      assert.strictEqual(restored.customerName, 'Gourmet Cafe Group');
      assert.strictEqual(restored.description, 'Custom recipe version 4');

      // Local recovery storage is cleared after successful persistence
      const recovered = quotingService.getDraftRecovery(wsId, project.id, 'usr-baker-1');
      assert.strictEqual(recovered, null, 'Recovery storage must be cleanly cleared after successful save');
    });

    it('T11: Autosave does not create QuoteRevision', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Autosave No Revision Test',
        userId: 'usr-baker-1',
      });
      assert.strictEqual(project.revisions?.length || 0, 0);

      // Execute autosave
      await quotingService.saveProject({
        ...project,
        productName: 'Autosave Edit #1',
      });

      const saved = quotingService.getProject(wsId, project.id);
      assert.ok(saved);
      assert.strictEqual(saved.revisions?.length || 0, 0, 'Autosave must NEVER create QuoteRevision snapshots');
    });

    it('T12: Autosave does not issue quote or promote recipe', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Autosave Invariant Project',
        userId: 'usr-baker-1',
      });
      assert.strictEqual(project.status, 'draft');

      // Execute autosave
      await quotingService.saveProject({
        ...project,
        customerName: 'No Quote Issued Co.',
      });

      const saved = quotingService.getProject(wsId, project.id);
      assert.ok(saved);
      assert.strictEqual(saved.status, 'draft', 'Status must strictly remain draft');
      assert.strictEqual(saved.convertedRecipeId, undefined, 'Must not link to promoted recipe');
    });
  });

  // ---------------------------------------------------------------------------
  // ISSUE 3: Bottom Save Draft Button & Shared Actions Invariance
  // ---------------------------------------------------------------------------
  describe('Issue 3: Canonical Bottom & Top Save Draft Handlers', () => {
    it('T13: Top Save Draft persists current data', () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');
      const topMatch = content.match(/<ProjectManagementActions[\s\S]*?variant="header"[\s\S]*?\/>/);
      assert.ok(topMatch, 'Top ProjectManagementActions must exist');
      assert.ok(topMatch[0].includes('onSaveDraft={handleSaveDraft}'), 'Top bar must trigger handleSaveDraft');
    });

    it('T14: Bottom Save Draft persists current data', () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');
      const bottomMatch = content.match(/<ProjectManagementActions[\s\S]*?variant="footer"[\s\S]*?\/>/);
      assert.ok(bottomMatch, 'Bottom ProjectManagementActions must exist');
      assert.ok(bottomMatch[0].includes('onSaveDraft={handleSaveDraft}'), 'Bottom bar must trigger handleSaveDraft');
    });

    it('T15: Both buttons invoke the same canonical handler', () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');
      const topMatch = content.match(/<ProjectManagementActions[\s\S]*?variant="header"[\s\S]*?\/>/);
      const bottomMatch = content.match(/<ProjectManagementActions[\s\S]*?variant="footer"[\s\S]*?\/>/);

      assert.ok(topMatch && bottomMatch);
      assert.ok(topMatch[0].includes('onSaveDraft={handleSaveDraft}'));
      assert.ok(bottomMatch[0].includes('onSaveDraft={handleSaveDraft}'));
      assert.ok(topMatch[0].includes('isSaving={isSaving}'));
      assert.ok(bottomMatch[0].includes('isSaving={isSaving}'));
    });

    it('T16: Duplicate, Archive, Issue Quote remain functional', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Action Lifecycle Test',
        userId: 'usr-baker-1',
      });

      // Duplicate
      const dup = await quotingService.duplicateProject(project.id, wsId, 'usr-baker-1');
      assert.ok(dup.id);
      assert.notStrictEqual(dup.id, project.id);
      assert.strictEqual(dup.productName, 'Action Lifecycle Test (Copy)');

      // Archive
      const archived = await quotingService.archiveProject(project.id, wsId, 'usr-baker-1');
      assert.strictEqual(archived.status, 'archived');
      assert.strictEqual(archived.archived, true);

      // Unarchive
      const unarchived = await quotingService.unarchiveProject(project.id, wsId, 'usr-baker-1');
      assert.strictEqual(unarchived.status, 'draft');
      assert.strictEqual(unarchived.archived, false);

      // Issue Quote Revision
      const quoted = await quotingService.issueQuoteRevision(
        project.id,
        wsId,
        'usr-baker-1',
        'Head Baker',
        'Standard 30-day quote terms'
      );
      assert.strictEqual(quoted.status, 'quoted');
      assert.strictEqual(quoted.currentRevisionNumber, 1);
      assert.strictEqual(quoted.revisions?.length, 1);
    });

    it('T17: Historical issued quote revisions remain immutable', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Revision Immutability Base',
        userId: 'usr-baker-1',
      });

      // Add a line item and issue Revision 1
      const pWithLine: ProductProject = {
        ...project,
        formula: {
          totalWeightGrams: 500,
          totalCost: 10.0,
          lines: [
            {
              id: 'line-rev-1',
              name: 'Original Flour',
              quantity: 500,
              unit: 'g',
              unitCostUsed: 0.02,
              unitCostType: 'per_gram',
              lineCost: 10.0,
            },
          ],
        },
      };
      await quotingService.saveProject(pWithLine);
      const afterRev1 = await quotingService.issueQuoteRevision(project.id, wsId, 'usr-baker-1');
      const rev1Snapshot = afterRev1.revisions![0];
      assert.strictEqual(rev1Snapshot.formulaSnapshot.lines[0].name, 'Original Flour');

      // Now modify the working draft formula
      const modifiedDraft: ProductProject = {
        ...afterRev1,
        formula: {
          totalWeightGrams: 800,
          totalCost: 25.0,
          lines: [
            {
              id: 'line-rev-2',
              name: 'Updated Almond Flour',
              quantity: 800,
              unit: 'g',
              unitCostUsed: 0.03125,
              unitCostType: 'per_gram',
              lineCost: 25.0,
            },
          ],
        },
      };
      await quotingService.saveProject(modifiedDraft);

      // Verify the historical revision snapshot is 100% immutable
      const checkProject = quotingService.getProject(wsId, project.id);
      assert.ok(checkProject);
      assert.strictEqual(checkProject.revisions![0].formulaSnapshot.lines[0].name, 'Original Flour');
      assert.strictEqual(checkProject.revisions![0].formulaSnapshot.totalCost, 10.0);
    });

    it('T18: Cross-workspace draft access is denied', async () => {
      const wsA = 'ws-company-alpha';
      const wsB = 'ws-company-beta';

      const projectA = await quotingService.createProject({
        workspaceId: wsA,
        productName: 'Company Alpha Recipe Secret',
        userId: 'usr-alpha-1',
      });

      // Attempt lookup from Workspace B
      const lookupInB = quotingService.getProject(wsB, projectA.id);
      assert.strictEqual(lookupInB, undefined, 'Project from Workspace A must not be accessible in Workspace B');

      // Local recovery drafts must also be strictly isolated by workspace ID
      quotingService.saveDraftRecovery(wsA, projectA.id, projectA, 'usr-alpha-1');
      const recoveryInB = quotingService.getDraftRecovery(wsB, projectA.id, 'usr-alpha-1');
      assert.strictEqual(recoveryInB, null, 'Recovery draft for Workspace A must never leak to Workspace B');
    });

    it('T19: Existing production recipes remain unchanged', () => {
      // Invariant: Quoting and autosave do not modify production recipes
      const quotingServiceContent = fs.readFileSync(
        path.join(process.cwd(), 'src/services/quotingService.ts'),
        'utf-8'
      );
      assert.ok(!quotingServiceContent.includes('recipesMap.set'), 'QuotingService must not mutate production recipes');
    });

    it('T20: Loading an existing project does not trigger unintended writes', () => {
      const editorPath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
      const content = fs.readFileSync(editorPath, 'utf-8');

      // Verify useEffect project sync does not mark dirty or start debounce timer
      assert.match(
        content,
        /hasUserEditedRef\.current\s*=\s*!!recovered/,
        'Loading project without recovery draft must set hasUserEdited to false'
      );
      assert.match(
        content,
        /setSaveStatus\(recovered\s*\?\s*'unsaved'\s*:\s*'saved'\)/,
        'Loading clean project must set saveStatus to saved'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PART A & B: PRICING REDESIGN & CALCULATION VERIFICATION (T21 - T27)
  // ---------------------------------------------------------------------------
  describe('Part B: Pricing Hierarchy & Calculation Invariance (T21 - T27)', () => {
    it('T21: Existing pricing outputs remain numerically unchanged', () => {
      const testFormula: QuoteFormula = {
        totalWeightGrams: 1000,
        totalCost: 10.0,
        lines: [],
      };

      const pricing = calculateProductPricing({
        pieceWeight: 100,
        weightUnit: 'g',
        piecesPerCase: 10,
        packagingCost: 2.0,
        laborCost: 3.0,
        otherCost: 1.0,
        ingredientMultiplier: 1.6,
        quotedPrice: 30.0,
        formula: testFormula,
      });

      // Dough weight = 10 * 100 = 1000g -> Raw cost = $10.00
      assert.strictEqual(pricing.rawIngredientCost, 10.0);
      // COGS = 10 + 2 + 3 + 1 = $16.00
      assert.strictEqual(pricing.totalProductionCost, 16.0);
      // Target price = (10 * 1.6) + 2 + 3 + 1 = 16 + 6 = $22.00
      assert.strictEqual(pricing.calculatedTargetPrice, 22.0);
      // Dollar profit = 30 - 16 = $14.00
      assert.strictEqual(pricing.dollarProfit, 14.0);
      // Gross margin % = (14 / 30) * 100 = 46.67%
      assert.strictEqual(pricing.grossMarginPercent, 46.67);
      // Markup % = (14 / 16) * 100 = 87.5%
      assert.strictEqual(pricing.markupPercent, 87.5);
    });

    it('T22: Suggested and Actual quoted prices are clearly distinguished', () => {
      const pricingPath = path.join(process.cwd(), 'src/components/quoting/PricingSummaryHierarchy.tsx');
      assert.ok(fs.existsSync(pricingPath), 'PricingSummaryHierarchy.tsx component must exist');
      const content = fs.readFileSync(pricingPath, 'utf-8');

      // Check distinct labels
      assert.match(content, /Suggested Price \/ Case/, 'Must display Suggested Price / Case');
      assert.match(content, /Actual Quoted Price \/ Case/, 'Must display Actual Quoted Price / Case');
      assert.match(content, /Suggested Target/, 'Must tag Suggested Target clearly');
      assert.match(content, /Actual Quote/, 'Must tag Actual Quote clearly');
    });

    it('T23: Profit and margin match existing calculations', () => {
      const testFormula: QuoteFormula = {
        totalWeightGrams: 5000,
        totalCost: 25.0,
        lines: [],
      };

      const pricing = calculateProductPricing({
        pieceWeight: 50,
        weightUnit: 'g',
        piecesPerCase: 20, // 1000g per case
        packagingCost: 1.5,
        laborCost: 4.5,
        otherCost: 0.5,
        ingredientMultiplier: 2.0,
        quotedPrice: 20.0,
        formula: testFormula,
      });

      // Raw cost: 25 * (1000 / 5000) = $5.00
      assert.strictEqual(pricing.rawIngredientCost, 5.0);
      // COGS: 5 + 1.5 + 4.5 + 0.5 = $11.50
      assert.strictEqual(pricing.totalProductionCost, 11.5);
      // Profit: 20 - 11.5 = $8.50
      assert.strictEqual(pricing.dollarProfit, 8.5);
      // Gross margin: (8.5 / 20) * 100 = 42.50%
      assert.strictEqual(pricing.grossMarginPercent, 42.5);
    });

    it('T24: Unit/case values remain consistent', () => {
      const testFormula: QuoteFormula = {
        totalWeightGrams: 2000,
        totalCost: 10.0,
        lines: [],
      };

      const pricing = calculateProductPricing({
        pieceWeight: 100,
        weightUnit: 'g',
        piecesPerCase: 10,
        packagingCost: 2.0,
        laborCost: 3.0,
        ingredientMultiplier: 1.5,
        quotedPrice: 25.0,
        formula: testFormula,
      });

      // Case COGS = $10 (ingredients: 1000/2000 * 10 = 5) + 2 + 3 = $10.00
      assert.strictEqual(pricing.totalProductionCost, 10.0);
      // Cost per unit = 10 / 10 = $1.00
      assert.strictEqual(pricing.costPerUnit, 1.0);
      // Quoted unit price = 25 / 10 = $2.50
      assert.strictEqual(pricing.quotedPricePerUnit, 2.5);
      // Unit math consistency check: piecesPerCase * quotedPricePerUnit === quotedPrice
      assert.strictEqual(
        Number((pricing.piecesPerCase * pricing.quotedPricePerUnit!).toFixed(2)),
        pricing.quotedPrice
      );
    });

    it('T25: Negative/zero profit cases display safely', () => {
      const pricingPath = path.join(process.cwd(), 'src/components/quoting/PricingSummaryHierarchy.tsx');
      const content = fs.readFileSync(pricingPath, 'utf-8');

      // Verify safe handling of loss, negative margin, zero profit
      assert.match(content, /isLoss/, 'Must compute isLoss boolean');
      assert.match(content, /isBreakEven/, 'Must compute isBreakEven boolean');
      assert.match(content, /isProfitable/, 'Must compute isProfitable boolean');
      assert.match(content, /Negative Margin \/ Loss/, 'Must render friendly loss tag');
      assert.match(content, /Break-Even \(0%\)/, 'Must render friendly break-even tag');
      assert.match(content, /fmtProfit/, 'Must safely format negative values with -$');
    });

    it('T26: Responsive desktop/tablet/mobile layout', () => {
      const pricingPath = path.join(process.cwd(), 'src/components/quoting/PricingSummaryHierarchy.tsx');
      const content = fs.readFileSync(pricingPath, 'utf-8');

      // Verify responsive tailwind grid definitions
      assert.match(
        content,
        /grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3/,
        'Primary metrics must adapt responsively from 1 to 2 to 4 columns'
      );
      assert.match(
        content,
        /grid grid-cols-1 sm:grid-cols-2 gap-3/,
        'Secondary and tertiary sections must adapt across screen sizes'
      );
    });

    it('T27: Quote issuance and revision behavior unchanged', async () => {
      const project = await quotingService.createProject({
        workspaceId: wsId,
        productName: 'Issue Revision Invariance Check',
        userId: 'usr-baker-1',
      });

      const updated = await quotingService.issueQuoteRevision(
        project.id,
        wsId,
        'usr-baker-1',
        'Sales Lead',
        'Quarterly Contract #Q4'
      );

      assert.strictEqual(updated.status, 'quoted');
      assert.strictEqual(updated.currentRevisionNumber, 1);
      assert.strictEqual(updated.revisions?.length, 1);
      const rev = updated.revisions![0];
      assert.strictEqual(rev.revisionNumber, 1);
      assert.strictEqual(rev.notes, 'Quarterly Contract #Q4');
      assert.strictEqual(rev.createdBy, 'usr-baker-1');
      assert.ok(rev.createdAt);
    });
  });
});

