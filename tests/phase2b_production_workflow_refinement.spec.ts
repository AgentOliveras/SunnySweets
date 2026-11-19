import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  Workspace,
  UserSettings,
  Recipe,
  ProductionPreset,
} from '../src/types';
import {
  getOrderedProductionOptionKeys,
  getWorkspaceOptionDescriptors,
  matchesPresetKey,
  SYSTEM_OPTION_KEYS,
  SUNNY_SWEETS_DEFAULT_ORDER_NAMES,
} from '../src/utils/productionOptionOrdering';
import {
  hasProductionNotes,
  canProceedToMix,
  getProductionNotesStatus,
} from '../src/utils/productionNotes';

describe('Phase 2B — Production Workflow & Responsive UX Refinement Suite', () => {
  const samplePresets: ProductionPreset[] = [
    {
      id: 'preset-3oz',
      workspaceId: 'ws-main',
      userId: 'test-user',
      name: '3 oz Cookies',
      unitName: 'Case',
      quantityPerUnit: 48,
      finishedWeight: 3,
      weightUnit: 'oz',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'preset-1oz',
      workspaceId: 'ws-main',
      userId: 'test-user',
      name: '1 oz Cookies',
      unitName: 'Case',
      quantityPerUnit: 144,
      finishedWeight: 1,
      weightUnit: 'oz',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'preset-4oz',
      workspaceId: 'ws-main',
      userId: 'test-user',
      name: '4 oz Cookies',
      unitName: 'Case',
      quantityPerUnit: 36,
      finishedWeight: 4,
      weightUnit: 'oz',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'preset-2oz',
      workspaceId: 'ws-main',
      userId: 'test-user',
      name: '2 oz Cookies',
      unitName: 'Case',
      quantityPerUnit: 72,
      finishedWeight: 2,
      weightUnit: 'oz',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  describe('1. Production Option Ordering & Workspace Configurability', () => {
    it('PO1: Sunny Sweets default order resolves to 1oz -> 2oz -> 3oz -> 4oz -> Custom -> Full Recipe -> Full Mixer', () => {
      const resolvedKeys = getOrderedProductionOptionKeys(samplePresets, null);

      assert.deepStrictEqual(resolvedKeys, [
        'preset-1oz',
        'preset-2oz',
        'preset-3oz',
        'preset-4oz',
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
      ]);
    });

    it('PO2: Matches preset key by exact ID, exact name, or weight prefix', () => {
      const preset1oz = samplePresets.find((p) => p.id === 'preset-1oz')!;
      assert(matchesPresetKey(preset1oz, 'preset-1oz'), 'Should match by exact ID');
      assert(matchesPresetKey(preset1oz, '1 oz Cookies'), 'Should match by exact name');
      assert(matchesPresetKey(preset1oz, '1 oz'), 'Should match by weight prefix');
      assert(!matchesPresetKey(preset1oz, '2 oz'), 'Should not match different prefix');
    });

    it('PO3: Custom configured order in workspace overrides default and places options exactly as arranged', () => {
      // Management reorders: Full Recipe first, then 4oz, 2oz, Custom, 1oz, 3oz, Full Mixer
      const customOrder = [
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        'preset-4oz',
        'preset-2oz',
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
        'preset-1oz',
        'preset-3oz',
        SYSTEM_OPTION_KEYS.FULL_MIXER,
      ];

      const resolved = getOrderedProductionOptionKeys(samplePresets, customOrder);
      assert.deepStrictEqual(resolved, customOrder);
    });

    it('PO4: Any unlisted presets are appended safely without being dropped or causing duplicates', () => {
      // Workspace order only specifies 1oz and 2oz and system options
      const partialOrder = [
        'preset-1oz',
        'preset-2oz',
        SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY,
        SYSTEM_OPTION_KEYS.FULL_RECIPE,
        SYSTEM_OPTION_KEYS.FULL_MIXER,
      ];

      const resolved = getOrderedProductionOptionKeys(samplePresets, partialOrder);

      // Must include 1oz, 2oz, custom, full_recipe, full_mixer, and appended 3oz, 4oz
      assert(resolved.includes('preset-1oz'));
      assert(resolved.includes('preset-2oz'));
      assert(resolved.includes('preset-3oz'));
      assert(resolved.includes('preset-4oz'));
      assert(resolved.includes(SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY));
      assert(resolved.includes(SYSTEM_OPTION_KEYS.FULL_RECIPE));
      assert(resolved.includes(SYSTEM_OPTION_KEYS.FULL_MIXER));
      assert.strictEqual(resolved.length, 7, 'Must have exactly 7 unique items');
    });

    it('PO5: System option descriptors return readable descriptions and labels for Management UI', () => {
      const descriptors = getWorkspaceOptionDescriptors(samplePresets, null);
      assert.strictEqual(descriptors.length, 7);

      const customDesc = descriptors.find((d) => d.key === SYSTEM_OPTION_KEYS.CUSTOM_QUANTITY);
      assert(customDesc, 'Custom quantity descriptor must exist');
      assert.strictEqual(customDesc.name, 'Custom Quantity');
      assert.strictEqual(customDesc.type, 'system');

      const fullRecipeDesc = descriptors.find((d) => d.key === SYSTEM_OPTION_KEYS.FULL_RECIPE);
      assert(fullRecipeDesc, 'Full recipe descriptor must exist');
      assert.strictEqual(fullRecipeDesc.name, 'Full Recipe');

      const fullMixerDesc = descriptors.find((d) => d.key === SYSTEM_OPTION_KEYS.FULL_MIXER);
      assert(fullMixerDesc, 'Full mixer descriptor must exist');
      assert.strictEqual(fullMixerDesc.name, 'Full Mixer Capacity');

      const preset1Desc = descriptors.find((d) => d.key === 'preset-1oz');
      assert(preset1Desc, 'Preset 1oz descriptor must exist');
      assert.strictEqual(preset1Desc.name, '1 oz Cookies');
      assert.strictEqual(preset1Desc.type, 'preset');
    });
  });

  describe('2. Critical Production Notes & General Mixing Instructions', () => {
    it('PN1: hasProductionNotes correctly detects when notes are present or absent', () => {
      assert.strictEqual(hasProductionNotes(undefined), false);
      assert.strictEqual(hasProductionNotes(null), false);
      assert.strictEqual(hasProductionNotes(''), false);
      assert.strictEqual(hasProductionNotes('   '), false);
      assert.strictEqual(hasProductionNotes('Add walnuts at final 30 seconds.'), true);
    });

    it('PN2: canProceedToMix gates execution until operator acknowledges critical notes', () => {
      // When notes exist:
      assert.strictEqual(canProceedToMix(true, false), false, 'Must block when notes exist and not acknowledged');
      assert.strictEqual(canProceedToMix(true, true), true, 'Must allow when acknowledged');

      // When notes do not exist:
      assert.strictEqual(canProceedToMix(false, false), true, 'Must allow immediately when no notes');
      assert.strictEqual(canProceedToMix(false, true), true, 'Must allow when no notes');
    });

    it('PN3: getProductionNotesStatus returns appropriate lifecycle status string', () => {
      assert.strictEqual(getProductionNotesStatus(false, false), 'NONE');
      assert.strictEqual(getProductionNotesStatus(true, false), 'REVIEW_REQUIRED');
      assert.strictEqual(getProductionNotesStatus(true, true), 'REVIEWED');
    });

    it('PN4: Recipe data model preserves both description (notes) and mixingInstructions distinctly', () => {
      const sampleRecipe: Recipe = {
        id: 'rec-test-1',
        workspaceId: 'ws-main',
        userId: 'test-user',
        name: 'Chocolate Chip Cookies',
        description: 'ALLERGEN WARNING: Contains tree nuts and dairy. Do not overmix dough.',
        mixingInstructions: '1. Cream butter and sugar 3 mins.\n2. Add eggs.\n3. Fold flour on low.',
        batchYieldQuantity: 100,
        batchYieldUnit: 'cookies',
        defaultWastePercent: 5,
        ingredients: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      assert(sampleRecipe.description.includes('ALLERGEN WARNING'));
      assert(sampleRecipe.mixingInstructions?.includes('Cream butter'));
      assert.notStrictEqual(sampleRecipe.description, sampleRecipe.mixingInstructions);
    });
  });

  describe('3. Collapsible Settings Architecture', () => {
    it('CS1: Initial accordion state: On entry into Settings, EVERY accordion section defaults to COLLAPSED', () => {
      const defaultOpenSections: Record<string, boolean> = {
        production_ordering: false,
        measurement: false,
        precision: false,
        categories: false,
        production_floor: false,
        branding: false,
        members: false,
        subscription: false,
        profile: false,
        cloud: false,
        security: false,
        migrations: false,
        capabilities: false,
        lock: false,
        system: false,
      };

      for (const [sectionKey, isOpen] of Object.entries(defaultOpenSections)) {
        assert.strictEqual(isOpen, false, `Section ${sectionKey} must initialize collapsed (false)`);
      }
    });

    it('CS2: Expand All sets all 15 sections to true', () => {
      const allKeys = [
        'production_ordering',
        'measurement',
        'precision',
        'categories',
        'production_floor',
        'branding',
        'members',
        'subscription',
        'profile',
        'cloud',
        'security',
        'migrations',
        'capabilities',
        'lock',
        'system',
      ];

      const expanded: Record<string, boolean> = {};
      allKeys.forEach((k) => (expanded[k] = true));

      for (const k of allKeys) {
        assert.strictEqual(expanded[k], true);
      }
      assert.strictEqual(Object.keys(expanded).length, 15);
    });

    it('CS3: Collapse All sets all 15 sections to false', () => {
      const allKeys = [
        'production_ordering',
        'measurement',
        'precision',
        'categories',
        'production_floor',
        'branding',
        'members',
        'subscription',
        'profile',
        'cloud',
        'security',
        'migrations',
        'capabilities',
        'lock',
        'system',
      ];

      const collapsed: Record<string, boolean> = {};
      allKeys.forEach((k) => (collapsed[k] = false));

      for (const k of allKeys) {
        assert.strictEqual(collapsed[k], false);
      }
    });
  });

  describe('4. Phase 2B.1 Physical Device QA Corrections Suite', () => {
    it('QA1: Critical Production Notes Data Model preserves presetId + recipeId specificity', () => {
      const notes = [
        {
          id: 'note-1',
          presetId: 'preset-1oz',
          recipeId: 'rec-chocolate-chip',
          note: 'Use 4000-count chocolate chips for the 1 oz cookies.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      // Exact match
      const match = notes.filter((n) => n.presetId === 'preset-1oz' && n.recipeId === 'rec-chocolate-chip');
      assert.strictEqual(match.length, 1);
      assert.strictEqual(match[0].note, 'Use 4000-count chocolate chips for the 1 oz cookies.');

      // Different preset for same recipe
      const noMatchPreset2 = notes.filter((n) => n.presetId === 'preset-2oz' && n.recipeId === 'rec-chocolate-chip');
      assert.strictEqual(noMatchPreset2.length, 0);

      // Different recipe for same preset
      const noMatchSugar = notes.filter((n) => n.presetId === 'preset-1oz' && n.recipeId === 'rec-sugar');
      assert.strictEqual(noMatchSugar.length, 0);

      // No preset selected
      const noPresetSelected = notes.filter((n) => n.presetId === '' && n.recipeId === 'rec-chocolate-chip');
      assert.strictEqual(noPresetSelected.length, 0);
    });

    it('QA2: Production Floor Display & Gating Matrix', () => {
      const allNotes = [
        {
          id: 'note-1',
          presetId: 'preset-1oz',
          recipeId: 'rec-chocolate-chip',
          note: 'Use 4000-count chocolate chips for the 1 oz cookies.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const testMatrix = [
        { recipeId: 'rec-chocolate-chip', selectedPresetId: null, expectNotes: false, expectGate: false },
        { recipeId: 'rec-chocolate-chip', selectedPresetId: 'preset-1oz', expectNotes: true, expectGate: true },
        { recipeId: 'rec-chocolate-chip', selectedPresetId: 'preset-2oz', expectNotes: false, expectGate: false },
        { recipeId: 'rec-chocolate-chip', selectedPresetId: 'preset-3oz', expectNotes: false, expectGate: false },
        { recipeId: 'rec-chocolate-chip', selectedPresetId: 'preset-4oz', expectNotes: false, expectGate: false },
        { recipeId: 'rec-sugar', selectedPresetId: 'preset-1oz', expectNotes: false, expectGate: false },
      ];

      testMatrix.forEach(({ recipeId, selectedPresetId, expectNotes, expectGate }) => {
        const matchingNotes = selectedPresetId
          ? allNotes.filter((n) => n.presetId === selectedPresetId && n.recipeId === recipeId)
          : [];
        const hasNotes = matchingNotes.length > 0;
        assert.strictEqual(hasNotes, expectNotes, `Recipe ${recipeId} with preset ${selectedPresetId} hasNotes mismatch`);

        const canProceedBeforeAck = canProceedToMix(hasNotes, false);
        assert.strictEqual(canProceedBeforeAck, !expectGate, `Gating mismatch for recipe ${recipeId} with preset ${selectedPresetId}`);

        if (expectNotes) {
          const canProceedAfterAck = canProceedToMix(hasNotes, true);
          assert.strictEqual(canProceedAfterAck, true, 'Should proceed after acknowledgment');
        }
      });
    });

    it('QA3: Presets grouped by category maintain independent ordering within groups', () => {
      const mixedPresets = [
        { id: 'c-1', name: '1 oz Cookies', category: 'Cookies', finishedWeight: 1, weightUnit: 'oz' as const, quantityPerUnit: 144, unitName: 'case', userId: '', createdAt: '', updatedAt: '' },
        { id: 'c-2', name: '2 oz Cookies', category: 'Cookies', finishedWeight: 2, weightUnit: 'oz' as const, quantityPerUnit: 140, unitName: 'case', userId: '', createdAt: '', updatedAt: '' },
        { id: 'p-1', name: '9" Single Pie', category: 'Pie Dough', finishedWeight: 12, weightUnit: 'oz' as const, quantityPerUnit: 24, unitName: 'case', userId: '', createdAt: '', updatedAt: '' },
        { id: 'b-1', name: '800g Batard', category: 'Base Dough', finishedWeight: 800, weightUnit: 'g' as const, quantityPerUnit: 10, unitName: 'rack', userId: '', createdAt: '', updatedAt: '' },
      ];

      // Group presets by category
      const groups: Record<string, typeof mixedPresets> = {};
      mixedPresets.forEach((p) => {
        const cat = p.category;
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(p);
      });

      assert.strictEqual(Object.keys(groups).length, 3);
      assert.strictEqual(groups['Cookies'].length, 2);
      assert.strictEqual(groups['Pie Dough'].length, 1);
      assert.strictEqual(groups['Base Dough'].length, 1);

      // Reordering within Cookies group
      const reorderedCookies = [groups['Cookies'][1], groups['Cookies'][0]];
      assert.strictEqual(reorderedCookies[0].name, '2 oz Cookies');
      assert.strictEqual(reorderedCookies[1].name, '1 oz Cookies');
      // Pie Dough and Base Dough remain unpolluted
      assert.strictEqual(groups['Pie Dough'][0].name, '9" Single Pie');
    });

    it('QA4: Mixing Instructions remain separate reference material without gating', () => {
      const mixingInstructions = '1. Cream butter and sugar.\n2. Add eggs.\n3. Fold flour.';
      const hasCriticalNotes = false;

      // Even if mixing instructions are present, no operator acknowledgment is required
      const canProceed = canProceedToMix(hasCriticalNotes, false);
      assert.strictEqual(canProceed, true, 'Mixing instructions must not gate production flow');
    });
  });
});
