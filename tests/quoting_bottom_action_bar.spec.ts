import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  calculateFormulaTotals,
  calculateProductPricing,
  createQuoteRevisionSnapshot,
} from '../src/utils/quotingCalculator';
import {
  QuoteFormula,
  QuoteFormulaLine,
  ProductProject,
  QuoteProductConfig,
  QuoteRevision,
} from '../src/types/quoting';
import { MasterIngredient, Workspace, Recipe } from '../src/types';

describe('Phase 2B.5.3 — Product Development & Quoting Bottom Action Bar Suite', () => {
  // ---------------------------------------------------------------------------
  // 1. Architecture Verification: Shared Component & Identical Handlers
  // ---------------------------------------------------------------------------
  it('BAR1 — ProjectEditor renders ProjectManagementActions at both top and bottom with shared handlers', () => {
    const editorFilePath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
    assert.ok(fs.existsSync(editorFilePath), 'ProjectEditor.tsx must exist');
    const editorContent = fs.readFileSync(editorFilePath, 'utf-8');

    // Verify ProjectManagementActions import
    assert.match(
      editorContent,
      /import\s*\{\s*ProjectManagementActions\s*\}\s*from\s*['"]\.\/ProjectManagementActions['"]/,
      'ProjectEditor must import ProjectManagementActions'
    );

    // Verify top instance exists with variant="header"
    assert.match(
      editorContent,
      /<ProjectManagementActions[\s\S]*?variant="header"[\s\S]*?\/>/,
      'ProjectEditor must render top ProjectManagementActions with variant="header"'
    );

    // Verify bottom instance exists with variant="footer"
    assert.match(
      editorContent,
      /<ProjectManagementActions[\s\S]*?variant="footer"[\s\S]*?\/>/,
      'ProjectEditor must render bottom ProjectManagementActions with variant="footer"'
    );

    // Verify bottom bar container exists after tab panels
    assert.match(
      editorContent,
      /data-testid="project-editor-bottom-bar"/,
      'ProjectEditor must contain bottom action bar container'
    );

    // Verify supporting copy
    assert.match(
      editorContent,
      /Finished reviewing this project\?/,
      'Bottom bar must display subtle supporting copy "Finished reviewing this project?"'
    );

    // Verify top and bottom instances bind to EXACT same handlers
    const topMatches = editorContent.match(/<ProjectManagementActions[\s\S]*?variant="header"[\s\S]*?\/>/);
    const bottomMatches = editorContent.match(/<ProjectManagementActions[\s\S]*?variant="footer"[\s\S]*?\/>/);
    assert.ok(topMatches && bottomMatches, 'Both action bars must be present');

    const topSnippet = topMatches[0];
    const bottomSnippet = bottomMatches[0];

    // Check duplicate handler
    assert.ok(
      topSnippet.includes('onDuplicate={onDuplicate}') && bottomSnippet.includes('onDuplicate={onDuplicate}'),
      'Both top and bottom must bind to the same onDuplicate handler'
    );

    // Check archive handler
    assert.ok(
      topSnippet.includes('onArchive={onArchive}') && bottomSnippet.includes('onArchive={onArchive}'),
      'Both top and bottom must bind to the same onArchive handler'
    );

    // Check save draft handler
    assert.ok(
      topSnippet.includes('onSaveDraft={handleSaveDraft}') && bottomSnippet.includes('onSaveDraft={handleSaveDraft}'),
      'Both top and bottom must bind to the same handleSaveDraft handler'
    );

    // Check issue quote / new revision trigger
    assert.ok(
      topSnippet.includes('setIsRevisionModalOpen(true)') && bottomSnippet.includes('setIsRevisionModalOpen(true)'),
      'Both top and bottom must bind to the same revision modal trigger'
    );

    // Check saving state propagation
    assert.ok(
      topSnippet.includes('isSaving={isSaving}') && bottomSnippet.includes('isSaving={isSaving}'),
      'Both top and bottom must reflect identical isSaving state'
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Component Verification: ProjectManagementActions contract & styling
  // ---------------------------------------------------------------------------
  it('BAR2 — ProjectManagementActions component maintains visual hierarchy and action attributes', () => {
    const actionsFilePath = path.join(process.cwd(), 'src/components/quoting/ProjectManagementActions.tsx');
    assert.ok(fs.existsSync(actionsFilePath), 'ProjectManagementActions.tsx must exist');
    const actionsContent = fs.readFileSync(actionsFilePath, 'utf-8');

    // Duplicate button
    assert.match(actionsContent, /Duplicate/, 'Must contain Duplicate action');
    assert.match(actionsContent, /Copy/, 'Must include Copy icon');

    // Archive / Unarchive button
    assert.match(actionsContent, /Archive/, 'Must contain Archive action');
    assert.match(actionsContent, /Unarchive/, 'Must support Unarchive state');

    // Save Draft button
    assert.match(actionsContent, /Save Draft/, 'Must contain Save Draft action');
    assert.match(actionsContent, /Save/, 'Must include Save icon');

    // Issue Quote / New Revision button (Orange primary styling)
    assert.match(actionsContent, /Issue Quote \/ New Revision/, 'Must contain Issue Quote action');
    assert.match(actionsContent, /bg-amber-600/, 'Primary action must use prominent amber/orange styling');

    // Both disabled when isSaving is true
    assert.match(
      actionsContent,
      /disabled=\{isSaving\}/,
      'Save Draft and Issue Quote must disable when isSaving is true'
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Tab Availability: Bottom Action Bar is rendered after tab panels
  // ---------------------------------------------------------------------------
  it('BAR3 — Bottom action bar is placed at bottom of workspace after all tab views', () => {
    const editorFilePath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
    const editorContent = fs.readFileSync(editorFilePath, 'utf-8');

    const formulaTabIdx = editorContent.indexOf("activeTab === 'formula'");
    const productsTabIdx = editorContent.indexOf("activeTab === 'products'");
    const historyTabIdx = editorContent.indexOf("activeTab === 'history'");
    const bottomBarIdx = editorContent.indexOf('data-testid="project-editor-bottom-bar"');

    assert.ok(formulaTabIdx > 0, 'Formula tab check must exist');
    assert.ok(productsTabIdx > formulaTabIdx, 'Products tab check must follow formula');
    assert.ok(historyTabIdx > productsTabIdx, 'History tab check must follow products');
    assert.ok(bottomBarIdx > historyTabIdx, 'Bottom action bar must be placed after all tab render blocks');
  });

  // ---------------------------------------------------------------------------
  // 4. Invariant Protection: Management Gate on Convert to Production Recipe (Phase 2B.6)
  // ---------------------------------------------------------------------------
  it('BAR4 — Invariant: Convert to Production Recipe is gated by management authorization (Phase 2B.6)', () => {
    const editorFilePath = path.join(process.cwd(), 'src/components/quoting/ProjectEditor.tsx');
    const editorContent = fs.readFileSync(editorFilePath, 'utf-8');

    // Promotion is enabled and managed through canUserPromoteProject
    assert.match(
      editorContent,
      /canUserPromoteProject/,
      'Promotion action must be gated by canUserPromoteProject'
    );
    assert.match(
      editorContent,
      /Convert to Production Recipe/,
      'Promotion entry point must exist in ProjectEditor'
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Invariant Protection: Quoting calculations, costing, and revisions untouched
  // ---------------------------------------------------------------------------
  it('BAR5 — Invariant: Quoting economics and snapshot creation remain completely accurate and unchanged', () => {
    const masterMap = new Map<string, MasterIngredient>([
      ['mi-flour', { id: 'mi-flour', name: 'Flour', costPerGram: 0.003, category: 'Flour', dimension: 'mass', defaultUnit: 'g' }],
      ['mi-butter', { id: 'mi-butter', name: 'Butter', costPerGram: 0.008, category: 'Fat', dimension: 'mass', defaultUnit: 'g' }],
    ]);

    const testFormulaLines: QuoteFormulaLine[] = [
      {
        id: 'l1',
        masterIngredientId: 'mi-flour',
        name: 'Flour',
        quantity: 3000,
        unit: 'g',
        unitCostUsed: 0,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
      {
        id: 'l2',
        masterIngredientId: 'mi-butter',
        name: 'Butter',
        quantity: 2000,
        unit: 'g',
        unitCostUsed: 0,
        unitCostType: 'per_gram',
        lineCost: 0,
      },
    ];

    const testFormula = calculateFormulaTotals(testFormulaLines, masterMap);
    assert.strictEqual(testFormula.totalWeightGrams, 5000);
    assert.strictEqual(testFormula.totalCost, 25.0);
    assert.strictEqual(testFormula.costPerGram, 0.005);

    const productConfig = calculateProductPricing({
      id: 'prod-1',
      name: 'Croissant Box (12 pack)',
      pieceWeight: 60,
      weightUnit: 'g',
      piecesPerCase: 12,
      formula: testFormula,
      packagingCost: 1.5,
      laborCost: 2.0,
      otherCost: 0.5,
      ingredientMultiplier: 2.5,
      pricingBasis: 'case',
      quotedPrice: 18.0,
    });

    assert.strictEqual(productConfig.doughWeightGrams, 720); // 60g * 12
    assert.strictEqual(productConfig.rawIngredientCost, 3.6); // 720 * $0.005
    assert.strictEqual(productConfig.totalProductionCost, 7.6); // 3.6 + 1.5 + 2.0 + 0.5

    const testProject: ProductProject = {
      id: 'proj-snap-test',
      workspaceId: 'ws-test',
      productName: 'Butter Croissants',
      status: 'ready_to_quote',
      formulaOwnership: 'bakery_owned',
      formula: testFormula,
      products: [productConfig],
      currentRevisionNumber: 1,
      revisions: [],
      createdBy: 'manager@bakery.com',
      updatedBy: 'manager@bakery.com',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const snapshot = createQuoteRevisionSnapshot(testProject, 'manager@bakery.com', 'Approved wholesale pricing');
    assert.strictEqual(snapshot.revisionNumber, 2);
    assert.strictEqual(snapshot.formulaSnapshot.totalWeightGrams, 5000);
    assert.strictEqual(snapshot.productsSnapshot.length, 1);
    assert.strictEqual(snapshot.productsSnapshot[0].quotedPrice, 18.0);
    assert.strictEqual(snapshot.productsSnapshot[0].totalProductionCost, 7.6);
  });
});
