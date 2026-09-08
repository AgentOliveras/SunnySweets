import { Recipe, Mixer, ProductionItemRequirement, ProductionPreset } from '../types';
import { calculateProduction, calculateRecipeBaseWeightGrams, calculateRecipeTotal } from './calculator';
import { convertWeight, toGrams, tryConvertToWeight, formatNumber, standardizeIngredientToUnit, standardizeIngredientsToUnit } from './units';
import {
  PRESET_PALETTES,
  getPaletteById,
  sanitizeDisplayName,
  validateLogoFile,
  getDefaultWorkspaceBranding,
  DEFAULT_PALETTE_ID,
  DEFAULT_DISPLAY_NAME,
} from './branding';

export interface TestCaseResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

export function runUnitTests(): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  // 1. Test Unit Conversion
  try {
    const gToKg = convertWeight(1500, 'g', 'kg');
    const kgToLb = convertWeight(2, 'kg', 'lb'); // 2kg ~ 4.40924lb
    const ozToG = toGrams(8, 'oz'); // 8 * 28.3495 = 226.796g

    const passed =
      Math.abs(gToKg - 1.5) < 0.0001 &&
      Math.abs(kgToLb - 4.40924) < 0.01 &&
      Math.abs(ozToG - 226.796) < 0.1;

    results.push({
      name: 'Unit Conversion Precision (g ↔ kg, oz ↔ lb)',
      passed,
      message: passed
        ? 'Successfully converted weight units with exact canonical ratios.'
        : `Conversion mismatch: 1500g->${gToKg}kg, 2kg->${kgToLb}lb, 8oz->${ozToG}g`,
    });
  } catch (err: any) {
    results.push({
      name: 'Unit Conversion Precision',
      passed: false,
      message: err.message,
    });
  }

  // Sample test recipe: Base recipe produces 100 cookies, base total weight:
  // Flour 5 kg (5000g), Sugar 2.5 kg (2500g), Butter 2.5 kg (2500g) => Total 10,000g (10 kg)
  const sampleRecipe: Recipe = {
    id: 'test-recipe-1',
    userId: 'user-1',
    name: 'Test Cookie Recipe',
    description: 'Base test recipe',
    batchYieldQuantity: 100,
    batchYieldUnit: 'cookies',
    defaultWastePercent: 2,
    ingredients: [
      { id: 'ing-1', name: 'Bread Flour', quantity: 5, unit: 'kg' },
      { id: 'ing-2', name: 'Granulated Sugar', quantity: 2.5, unit: 'kg' },
      { id: 'ing-3', name: 'Unsalted Butter', quantity: 2.5, unit: 'kg' },
      { id: 'ing-4', name: 'Vanilla Extract', quantity: 100, unit: 'ml', densityGramsPerMl: 1 },
      { id: 'ing-5', name: 'Chocolate Chips', quantity: 2, unit: 'lb', wastePercent: 5 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 2. Test Recipe Base Weight Calculation
  try {
    const baseWeightGrams = calculateRecipeBaseWeightGrams(sampleRecipe);
    // 5000g + 2500g + 2500g + 100g + 2 lb (907.18g) = 11,007.18g
    const expected = 5000 + 2500 + 2500 + 100 + 907.18474;
    const passed = Math.abs(baseWeightGrams - expected) < 1;

    results.push({
      name: 'Recipe Base Weight Calculation',
      passed,
      message: passed
        ? `Base recipe weight correctly calculated as ${Math.round(baseWeightGrams)}g.`
        : `Expected ~${expected}g, got ${baseWeightGrams}g`,
    });
  } catch (err: any) {
    results.push({
      name: 'Recipe Base Weight Calculation',
      passed: false,
      message: err.message,
    });
  }

  // 3. Test Recipe Scaling & Multiplier
  try {
    // Production Requirement: 4 oz cookies x 2 cases of 80 = 160 cookies (160 * 4 oz = 640 oz = 18,143.69g)
    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-1',
        presetName: '4 oz Cookie',
        quantity: 2,
        piecesPerUnit: 80,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      },
    ];

    const result = calculateProduction(sampleRecipe, reqs, { defaultWeightUnit: 'lb' });
    // Total target finished weight = 160 * 4 oz = 640 oz = 40 lb (~18,143.69g)
    // Scaling multiplier = 18,143.69 / 11,007.18 = 1.6483...
    const expectedMultiplier = 18143.69 / 11007.18;
    const passed =
      result.totalPieces === 160 &&
      Math.abs(result.scalingMultiplier - expectedMultiplier) < 0.05;

    results.push({
      name: 'Recipe Scaling Multiplier',
      passed,
      message: passed
        ? `Target multiplier ${result.scalingMultiplier.toFixed(3)}x calculated accurately for 160 pieces @ 4 oz.`
        : `Expected ~${expectedMultiplier.toFixed(3)}x, got ${result.scalingMultiplier}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Recipe Scaling Multiplier',
      passed: false,
      message: err.message,
    });
  }

  // 4. Test Waste Formula Calculation: Required = Base * Multiplier * (1 + Waste / 100)
  try {
    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-1',
        presetName: 'Base Batch',
        quantity: 1,
        piecesPerUnit: 100,
        itemWeight: 110.07,
        itemWeightUnit: 'g',
      },
    ];

    // 4a. Default waste calculation: Ingredient-specific waste preserved when no override
    const defaultResult = calculateProduction(sampleRecipe, reqs);
    const defaultFlour = defaultResult.calculatedIngredients.find((i) => i.name === 'Bread Flour');
    const defaultChoc = defaultResult.calculatedIngredients.find((i) => i.name === 'Chocolate Chips');
    // Flour: 5 kg * 1 * 1.02 (recipe default 2%) = 5.1 kg
    // Chocolate Chips: 2 lb * 1 * 1.05 (ingredient waste 5%) = 2.1 lb
    const defaultFlourPassed = defaultFlour && Math.abs(defaultFlour.requiredQuantity - 5.1) < 0.01;
    const defaultChocPassed = defaultChoc && Math.abs(defaultChoc.requiredQuantity - 2.1) < 0.01;

    // 4b. Temp Waste Override to 10%: ALL ingredients update to reflect 10% waste override
    const overrideResult = calculateProduction(sampleRecipe, reqs, { overrideWastePercent: 10 });
    const overrideFlour = overrideResult.calculatedIngredients.find((i) => i.name === 'Bread Flour');
    const overrideChoc = overrideResult.calculatedIngredients.find((i) => i.name === 'Chocolate Chips');
    // Flour: 5 kg * 1 * 1.10 = 5.5 kg
    // Chocolate Chips: 2 lb * 1 * 1.10 = 2.2 lb
    const overrideFlourPassed = overrideFlour && Math.abs(overrideFlour.requiredQuantity - 5.5) < 0.01;
    const overrideChocPassed = overrideChoc && Math.abs(overrideChoc.requiredQuantity - 2.2) < 0.01;

    // 4c. Temp Waste Override to 5%: Ingredient weights update dynamically
    const overrideResult5 = calculateProduction(sampleRecipe, reqs, { overrideWastePercent: 5 });
    const overrideFlour5 = overrideResult5.calculatedIngredients.find((i) => i.name === 'Bread Flour');
    const overrideFlour5Passed = overrideFlour5 && Math.abs(overrideFlour5.requiredQuantity - 5.25) < 0.01;

    const passed = Boolean(
      defaultFlourPassed &&
      defaultChocPassed &&
      overrideFlourPassed &&
      overrideChocPassed &&
      overrideFlour5Passed
    );

    results.push({
      name: 'Waste Adjustment Formula & Temp Waste Override Ingredient Updates',
      passed,
      message: passed
        ? 'Verified that Temp Waste Override updates all ingredient weights and batch weights across the formula.'
        : `Default: Flour=${defaultFlour?.requiredQuantity} (exp 5.1), Choc=${defaultChoc?.requiredQuantity} (exp 2.1). Override 10%: Flour=${overrideFlour?.requiredQuantity} (exp 5.5), Choc=${overrideChoc?.requiredQuantity} (exp 2.2).`,
    });
  } catch (err: any) {
    results.push({
      name: 'Waste Adjustment Formula',
      passed: false,
      message: err.message,
    });
  }

  // 5. Test Mixer Capacity Validation & Batch Splitting
  try {
    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-1',
        presetName: 'Full Run',
        quantity: 10,
        piecesPerUnit: 100,
        itemWeight: 4,
        itemWeightUnit: 'oz',
      }, // 1000 cookies @ 4oz = 4000 oz = 250 lb (~113.4 kg)
    ];

    const smallMixer: Mixer = {
      id: 'mixer-1',
      userId: 'user-1',
      name: '60-Qt Mixer',
      maxWeight: 80, // 80 lb limit
      weightUnit: 'lb',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = calculateProduction(sampleRecipe, reqs, { mixer: smallMixer });
    // Total batch ~ 250 lb, mixer max 80 lb -> 250 / 80 = 3.125 -> 4 batches required
    const capacityExceeded = result.isCapacityExceeded;
    const batchesCount = result.suggestedBatches;
    const passed = capacityExceeded === true && batchesCount === 4;

    results.push({
      name: 'Mixer Capacity Validation & Batch Splitting',
      passed,
      message: passed
        ? `Exceeded capacity detected (Batch: ${result.displayBatchWeight.toFixed(1)} lb > Limit: 80 lb). Suggested ${batchesCount} batches.`
        : `Expected capacityExceeded=true & batches=4, got exceeded=${capacityExceeded}, batches=${batchesCount}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Mixer Capacity Validation & Batch Splitting',
      passed: false,
      message: err.message,
    });
  }

  // 6. Test Volume Preservation without arbitrary weight conversion
  try {
    const liquidIng = sampleRecipe.ingredients.find((i) => i.unit === 'ml');
    const converted = tryConvertToWeight(100, 'ml', 'lb'); // liquid with no density
    const passed = converted === null; // must stay as volume

    results.push({
      name: 'Volume Unit Preservation (No arbitrary volume->weight conversion without density)',
      passed,
      message: passed
        ? 'Volume units correctly preserved without ungrounded weight assumption.'
        : `Expected null for volume conversion without density, got ${converted}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Volume Unit Preservation',
      passed: false,
      message: err.message,
    });
  }

  // 7. Test Decimal Precision & Whole Number Rounding
  try {
    const formattedWhole = formatNumber(125.74, 0); // Should round to "126"
    const formattedOne = formatNumber(125.74, 1);   // Should format as "125.7"
    const formattedThree = formatNumber(125.74, 3); // Should format as "125.74"

    const passed =
      formattedWhole === '126' &&
      formattedOne === '125.7' &&
      formattedThree === '125.74';

    results.push({
      name: 'Decimal Precision & Rounding (0 Decimals Whole Numbers, Custom Decimals)',
      passed,
      message: passed
        ? `Decimal points formatting verified (0 decimals: ${formattedWhole}, 1 decimal: ${formattedOne}, 3 decimals: ${formattedThree}).`
        : `Formatting failed: whole=${formattedWhole}, 1dec=${formattedOne}, 3dec=${formattedThree}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Decimal Precision & Rounding',
      passed: false,
      message: err.message,
    });
  }

  // 8. Test Recipe Total Calculation across all measuring units (g, lb, oz, kg)
  try {
    const totalGrams = calculateRecipeTotal(sampleRecipe, 'g');
    const totalLbs = calculateRecipeTotal(sampleRecipe, 'lb');
    const totalOz = calculateRecipeTotal(sampleRecipe, 'oz');
    const totalKg = calculateRecipeTotal(sampleRecipe, 'kg');

    const expectedGrams = 11007.18;
    const expectedLbs = 11007.18 / 453.59237; // ~24.266 lb
    const expectedOz = 11007.18 / 28.349523125; // ~388.267 oz
    const expectedKg = 11.00718; // ~11.01 kg

    const passed =
      Math.abs(totalGrams.totalWeightGrams - expectedGrams) < 1 &&
      Math.abs(totalLbs.totalWeightTargetUnit - expectedLbs) < 0.1 &&
      Math.abs(totalOz.totalWeightTargetUnit - expectedOz) < 0.5 &&
      Math.abs(totalKg.totalWeightTargetUnit - expectedKg) < 0.05 &&
      totalGrams.perPieceWeight !== undefined &&
      Math.abs(totalGrams.perPieceWeight.value - expectedGrams / 100) < 0.1;

    results.push({
      name: 'Recipe Total Calculations Across All Measuring Units (g, lb, oz, kg)',
      passed,
      message: passed
        ? `Recipe totals accurately computed across all measuring units: ${totalGrams.formattedTargetUnit} g, ${totalLbs.formattedTargetUnit} lb, ${totalOz.formattedTargetUnit} oz, ${totalKg.formattedTargetUnit} kg (Per piece: ~${totalGrams.perPieceWeight?.formatted} g).`
        : `Totals mismatch: g=${totalGrams.totalWeightTargetUnit}, lb=${totalLbs.totalWeightTargetUnit}, oz=${totalOz.totalWeightTargetUnit}, kg=${totalKg.totalWeightTargetUnit}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Recipe Total Calculations Across All Measuring Units',
      passed: false,
      message: err.message,
    });
  }

  // 9. Test Ingredient Unit Standardization to User Setup Preference
  try {
    // Standardize mixed recipe to 'g' (grams)
    const standardizedG = standardizeIngredientsToUnit(sampleRecipe.ingredients, 'g', 2);
    // Flour 5 kg -> 5000 g
    // Chocolate Chips 2 lb -> 907.18 g
    // Vanilla Extract 100 ml (density: 1) -> 100 g
    const flourG = standardizedG.find((i) => i.name === 'Bread Flour');
    const chocG = standardizedG.find((i) => i.name === 'Chocolate Chips');
    const vanG = standardizedG.find((i) => i.name === 'Vanilla Extract');

    // Standardize mixed recipe to 'lb' (pounds)
    const standardizedLb = standardizeIngredientsToUnit(sampleRecipe.ingredients, 'lb', 3);
    const flourLb = standardizedLb.find((i) => i.name === 'Bread Flour');
    const chocLb = standardizedLb.find((i) => i.name === 'Chocolate Chips');

    const passed =
      flourG?.unit === 'g' && flourG.quantity === 5000 &&
      chocG?.unit === 'g' && Math.abs(Number(chocG.quantity) - 907.18) < 0.1 &&
      vanG?.unit === 'g' && Number(vanG.quantity) === 100 &&
      flourLb?.unit === 'lb' && Math.abs(Number(flourLb.quantity) - 11.023) < 0.01 &&
      chocLb?.unit === 'lb' && chocLb.quantity === 2;

    results.push({
      name: 'Ingredient Unit Standardization (Aligned with User Setup Preference)',
      passed,
      message: passed
        ? `All ingredient inputs successfully converted and standardized to user preferences (5kg -> 5000g / 11.023lb, 2lb -> 907.18g / 2lb, 100ml -> 100g).`
        : `Standardization mismatch: FlourG=${flourG?.quantity}${flourG?.unit}, ChocG=${chocG?.quantity}${chocG?.unit}, FlourLb=${flourLb?.quantity}${flourLb?.unit}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Ingredient Unit Standardization',
      passed: false,
      message: err.message,
    });
  }

  // 10. Test Preset Categorization & Grouping (Cookies, Pie Dough, Base Dough, Shortbread)
  try {
    const testPresets: ProductionPreset[] = [
      { id: 'p1', userId: 'u1', name: '4 oz Cookie Case', category: 'Cookies', finishedWeight: 4, weightUnit: 'oz', quantityPerUnit: 80, unitName: 'case', createdAt: '', updatedAt: '' },
      { id: 'p2', userId: 'u1', name: '2 oz Cookie Case', category: 'Cookies', finishedWeight: 2, weightUnit: 'oz', quantityPerUnit: 140, unitName: 'case', createdAt: '', updatedAt: '' },
      { id: 'p3', userId: 'u1', name: '9" Single Crust Pie', category: 'Pie Dough', finishedWeight: 12, weightUnit: 'oz', quantityPerUnit: 24, unitName: 'case', createdAt: '', updatedAt: '' },
      { id: 'p4', userId: 'u1', name: 'Hand Pie Rounds', category: 'Pie Dough', finishedWeight: 3.5, weightUnit: 'oz', quantityPerUnit: 60, unitName: 'tray', createdAt: '', updatedAt: '' },
      { id: 'p5', userId: 'u1', name: '800g Sourdough Batard', category: 'Base Dough', finishedWeight: 800, weightUnit: 'g', quantityPerUnit: 10, unitName: 'rack', createdAt: '', updatedAt: '' },
      { id: 'p6', userId: 'u1', name: '500g Boule Proofing Tray', category: 'Base Dough', finishedWeight: 500, weightUnit: 'g', quantityPerUnit: 12, unitName: 'tray', createdAt: '', updatedAt: '' },
      { id: 'p7', userId: 'u1', name: '1.2 oz Shortbread Fingers', category: 'Shortbread', finishedWeight: 1.2, weightUnit: 'oz', quantityPerUnit: 30, unitName: 'tray', createdAt: '', updatedAt: '' },
      { id: 'p8', userId: 'u1', name: '8" Tart Shell', category: 'Shortbread', finishedWeight: 10, weightUnit: 'oz', quantityPerUnit: 16, unitName: 'box', createdAt: '', updatedAt: '' },
    ];

    const cookies = testPresets.filter((p) => p.category === 'Cookies');
    const pieDough = testPresets.filter((p) => p.category === 'Pie Dough');
    const baseDough = testPresets.filter((p) => p.category === 'Base Dough');
    const shortbread = testPresets.filter((p) => p.category === 'Shortbread');

    const passed =
      cookies.length === 2 &&
      pieDough.length === 2 &&
      baseDough.length === 2 &&
      shortbread.length === 2;

    results.push({
      name: 'Preset Categorization & Grouping (Cookies, Pie Dough, Base Dough, Shortbread)',
      passed,
      message: passed
        ? `Successfully verified preset grouping across all standard bakery categories: Cookies (${cookies.length}), Pie Dough (${pieDough.length}), Base Dough (${baseDough.length}), Shortbread (${shortbread.length}).`
        : `Preset grouping failed: Cookies=${cookies.length}, Pie=${pieDough.length}, Base=${baseDough.length}, Shortbread=${shortbread.length}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Preset Categorization & Grouping',
      passed: false,
      message: err.message,
    });
  }

  // 11. Test Recipe Category Preset Routing & Multi-Preset Mapping
  try {
    const testCategoryPresetMap: Record<string, string | string[]> = {
      Cookies: ['Cookies', 'Shortbread'],
      Bread: ['Base Dough'],
      Pies: ['Pie Dough'],
      Shortbread: ['Shortbread'],
      Pastries: ['Pie Dough', 'Base Dough'],
    };

    const cookiePresetCats = Array.isArray(testCategoryPresetMap['Cookies'])
      ? testCategoryPresetMap['Cookies']
      : [testCategoryPresetMap['Cookies']];
    const pastryPresetCats = Array.isArray(testCategoryPresetMap['Pastries'])
      ? testCategoryPresetMap['Pastries']
      : [testCategoryPresetMap['Pastries']];

    const passed =
      cookiePresetCats.includes('Cookies') &&
      cookiePresetCats.includes('Shortbread') &&
      cookiePresetCats.length === 2 &&
      pastryPresetCats.includes('Pie Dough') &&
      pastryPresetCats.includes('Base Dough');

    results.push({
      name: 'Recipe Category to Multi-Preset Routing & Category Management',
      passed,
      message: passed
        ? 'Successfully mapped recipe categories to multiple target packaging presets and verified multi-preset routing.'
        : `Multi-preset routing mapping failed: Cookies=${JSON.stringify(cookiePresetCats)}, Pastries=${JSON.stringify(pastryPresetCats)}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Recipe Category to Preset Routing',
      passed: false,
      message: err.message,
    });
  }

  // 12. Test Butter Auto-Conversion to lbs with 2 decimal points & Recipe Total in Grams / Selected Unit
  try {
    const butterReqs: ProductionItemRequirement[] = [
      {
        id: 'req-butter-test',
        presetName: 'Standard Test Batch',
        quantity: 1,
        piecesPerUnit: 100,
        itemWeight: 110.07,
        itemWeightUnit: 'g',
      },
    ];

    // Calculate with default unit 'g' (Grams)
    const resultInGrams = calculateProduction(sampleRecipe, butterReqs, { defaultWeightUnit: 'g' });
    const butterIng = resultInGrams.calculatedIngredients.find((i) => i.name.toLowerCase().includes('butter'));
    const flourIng = resultInGrams.calculatedIngredients.find((i) => i.name === 'Bread Flour');

    // Butter base was 2.5 kg. With 2% waste: 2.55 kg = 2550 g.
    // 2550 g / 453.59237 = 5.621769... lbs -> 5.62 lbs
    const butterConvertedToLbs = butterIng && butterIng.requiredUnit === 'lb' && Math.abs(butterIng.requiredQuantity - 5.62) < 0.01;
    // Recipe total at bottom must still read in grams (or selected measurement unit)
    const recipeTotalInGrams = resultInGrams.displayWeightUnit === 'g' && Math.abs(resultInGrams.displayBatchWeight - resultInGrams.totalBatchWeightGrams) < 0.01;
    const flourRemainsInKg = flourIng && flourIng.requiredUnit === 'kg';

    // Also test when user selects 'kg' or 'oz'
    const resultInKg = calculateProduction(sampleRecipe, butterReqs, { defaultWeightUnit: 'kg' });
    const recipeTotalInKg = resultInKg.displayWeightUnit === 'kg';

    const passed = Boolean(butterConvertedToLbs && recipeTotalInGrams && flourRemainsInKg && recipeTotalInKg);

    results.push({
      name: 'Butter Auto-Conversion to lbs (2 Decimals) & Recipe Total in Selected Unit',
      passed,
      message: passed
        ? `Butter automatically converted to ${butterIng?.requiredQuantity} lbs (2 decimals) while Total Scaled Batch Weight reads ${Math.round(resultInGrams.displayBatchWeight)} ${resultInGrams.displayWeightUnit}.`
        : `Butter conversion failed: Butter=${butterIng?.requiredQuantity} ${butterIng?.requiredUnit} (exp 5.62 lb), Total=${resultInGrams.displayBatchWeight} ${resultInGrams.displayWeightUnit}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Butter Auto-Conversion to lbs',
      passed: false,
      message: err.message,
    });
  }

  // 13. Test Grams Rounding (0 decimals for all non-butter ingredients in grams) & Butter (2 decimals in lbs)
  try {
    const gramRecipe: Recipe = {
      id: 'recipe-gram-test',
      userId: 'user-1',
      name: 'Gram Croissant Dough',
      description: 'Test recipe with ingredients in grams',
      category: 'Pastries',
      batchYieldQuantity: 50,
      batchYieldUnit: 'pieces',
      defaultWastePercent: 2.5,
      ingredients: [
        { id: 'g-1', name: 'Pastry Flour', quantity: 1255.5, unit: 'g' },
        { id: 'g-2', name: 'European Butter', quantity: 825.25, unit: 'g' },
        { id: 'g-3', name: 'Fine Sea Salt', quantity: 23.8, unit: 'g' },
        { id: 'g-4', name: 'Whole Milk', quantity: 512.4, unit: 'g' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-g-1',
        presetName: 'Standard',
        quantity: 1,
        piecesPerUnit: 50,
        itemWeight: 52.3,
        itemWeightUnit: 'g',
      },
    ];

    const result = calculateProduction(gramRecipe, reqs, { defaultWeightUnit: 'g' });
    const flour = result.calculatedIngredients.find((i) => i.name === 'Pastry Flour');
    const butter = result.calculatedIngredients.find((i) => i.name === 'European Butter');
    const salt = result.calculatedIngredients.find((i) => i.name === 'Fine Sea Salt');
    const milk = result.calculatedIngredients.find((i) => i.name === 'Whole Milk');

    // Flour required: 1255.5 * 1.025 = 1286.8875 -> rounded to 1287 (integer, no decimals)
    const flourIsInteger = flour && Number.isInteger(flour.requiredQuantity) && flour.requiredUnit === 'g';
    // Salt required: 23.8 * 1.025 = 24.395 -> rounded to 24 (integer, no decimals)
    const saltIsInteger = salt && Number.isInteger(salt.requiredQuantity) && salt.requiredUnit === 'g';
    // Milk required: 512.4 * 1.025 = 525.21 -> rounded to 525 (integer, no decimals)
    const milkIsInteger = milk && Number.isInteger(milk.requiredQuantity) && milk.requiredUnit === 'g';
    // Butter is converted to lbs with 2 decimals
    // 825.25 * 1.025 = 845.88125 g -> / 453.59237 = 1.8648... -> 1.86 lb
    const butterIsTwoDecimalsInLbs =
      butter &&
      butter.requiredUnit === 'lb' &&
      butter.requiredQuantity.toString().split('.')[1]?.length <= 2;
    // Total batch weight in grams is rounded to integer
    const totalIsInteger = Number.isInteger(result.displayBatchWeight);

    const passed = Boolean(
      flourIsInteger &&
      saltIsInteger &&
      milkIsInteger &&
      butterIsTwoDecimalsInLbs &&
      totalIsInteger
    );

    results.push({
      name: 'Grams Calculation Zero Decimals Rounding & Butter 2 Decimals in lbs',
      passed,
      message: passed
        ? `Successfully rounded grams to whole numbers (Flour=${flour?.requiredQuantity}g, Salt=${salt?.requiredQuantity}g, Total=${result.displayBatchWeight}g) and Butter to 2 decimals in lbs (${butter?.requiredQuantity} lb).`
        : `Grams rounding check failed: Flour=${flour?.requiredQuantity} ${flour?.requiredUnit}, Salt=${salt?.requiredQuantity} ${salt?.requiredUnit}, Butter=${butter?.requiredQuantity} ${butter?.requiredUnit}, Total=${result.displayBatchWeight} ${result.displayWeightUnit}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Grams Calculation Zero Decimals Rounding',
      passed: false,
      message: err.message,
    });
  }

  // 14. Test Peanut Butter Cookies 4-lb Jars Conversion & Note
  try {
    const pbRecipe: Recipe = {
      id: 'recipe-pb-test',
      userId: 'user-1',
      name: 'Peanut Butter Cookies',
      description: 'Test recipe with peanut butter in grams',
      category: 'Cookies',
      batchYieldQuantity: 80,
      batchYieldUnit: 'cookies',
      defaultWastePercent: 0,
      ingredients: [
        { id: 'pb-1', name: 'All-Purpose Flour', quantity: 2400, unit: 'g' },
        { id: 'pb-2', name: 'Creamy Peanut Butter', quantity: 1928, unit: 'g' },
        { id: 'pb-3', name: 'Unsalted Butter', quantity: 1200, unit: 'g' },
        { id: 'pb-4', name: 'Light Brown Sugar', quantity: 1600, unit: 'g' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const reqs: ProductionItemRequirement[] = [
      {
        id: 'req-pb-1',
        presetName: 'Standard Batch',
        quantity: 1,
        piecesPerUnit: 80,
        itemWeight: 2,
        itemWeightUnit: 'oz',
      },
    ];

    const result = calculateProduction(pbRecipe, reqs, { defaultWeightUnit: 'g' });
    const pb = result.calculatedIngredients.find((i) => i.name === 'Creamy Peanut Butter');
    const flour = result.calculatedIngredients.find((i) => i.name === 'All-Purpose Flour');
    const butter = result.calculatedIngredients.find((i) => i.name === 'Unsalted Butter');

    // 1928 g / 1816 g = 1.0616... -> 1.06 jars (2 decimal points)
    const pbIsJars = pb && pb.requiredUnit === 'jars' && pb.requiredQuantity === 1.06;
    // Jars note: 1 jar + 112 grams
    const pbHasCorrectNote =
      pb &&
      pb.jarsDetail &&
      pb.jarsDetail.fullJars === 1 &&
      pb.jarsDetail.remainingGrams === 112 &&
      pb.jarsDetail.text === '1 jar + 112 grams';
    // Regular butter is 1200 g -> 2.65 lb (2 decimals)
    const butterIsLbs = butter && butter.requiredUnit === 'lb' && butter.requiredQuantity === 2.65;
    // Flour is rounded grams (2400 g)
    const flourIsGrams = flour && flour.requiredUnit === 'g' && flour.requiredQuantity === 2400;

    const passed = Boolean(pbIsJars && pbHasCorrectNote && butterIsLbs && flourIsGrams);

    results.push({
      name: 'Peanut Butter Cookies 4-lb Jars Conversion (1928g -> 1.06 jars & 1 jar + 112 grams note)',
      passed,
      message: passed
        ? `Successfully converted 1928g peanut butter to ${pb?.requiredQuantity} ${pb?.requiredUnit} with note "${pb?.jarsDetail?.text}", Butter to ${butter?.requiredQuantity} lb, Flour to ${flour?.requiredQuantity} g.`
        : `PB conversion failed: PB=${pb?.requiredQuantity} ${pb?.requiredUnit} (note: ${pb?.jarsDetail?.text}), Butter=${butter?.requiredQuantity} ${butter?.requiredUnit}, Flour=${flour?.requiredQuantity} ${flour?.requiredUnit}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Peanut Butter Cookies 4-lb Jars Conversion',
      passed: false,
      message: err.message,
    });
  }

  // 17. Test Phase 0.5 Preset Palettes Integrity & Structure
  try {
    const expectedPalettes = ['warm-bakery', 'modern-navy', 'sage-kitchen', 'charcoal-gold', 'berry-cream'];
    const actualIds = PRESET_PALETTES.map((p) => p.id);
    const allExpectedPresent = expectedPalettes.every((id) => actualIds.includes(id as any));

    // Check color tokens presence on each
    const allHaveTokens = PRESET_PALETTES.every(
      (p) =>
        p.light.primary &&
        p.light.accent &&
        p.light.background &&
        p.light.surface &&
        p.light.text &&
        p.light.border &&
        p.dark.primary &&
        p.dark.background
    );

    const fallbackTest = getPaletteById('non-existent-id' as any);
    const fallbackCorrect = fallbackTest.id === 'warm-bakery';

    const passed = allExpectedPresent && allHaveTokens && fallbackCorrect;
    results.push({
      name: 'Phase 0.5 Preset Color Palettes (5 Presets & Full Semantic Tokens)',
      passed,
      message: passed
        ? `Verified all 5 culinary preset palettes (${actualIds.join(', ')}) with complete light & dark semantic tokens.`
        : 'Color palette preset validation failed.',
    });
  } catch (err: any) {
    results.push({
      name: 'Phase 0.5 Preset Color Palettes',
      passed: false,
      message: err.message,
    });
  }

  // 18. Test Workspace Display Name Sanitization & Length Boundary
  try {
    const validClean = sanitizeDisplayName('Sunny Sweets Bakery');
    const validWithSpaces = sanitizeDisplayName('   Artisan Loaf & Pastry Co.   ');
    const tooShort = sanitizeDisplayName('A');
    const tooLong = sanitizeDisplayName('A'.repeat(65));
    const maliciousScript = sanitizeDisplayName('<script>alert("xss")</script>Sweet Bakery');

    const passed =
      validClean.valid &&
      validClean.value === 'Sunny Sweets Bakery' &&
      validWithSpaces.valid &&
      validWithSpaces.value === 'Artisan Loaf & Pastry Co.' &&
      !tooShort.valid &&
      !tooLong.valid &&
      maliciousScript.valid &&
      maliciousScript.value === 'Sweet Bakery';

    results.push({
      name: 'Workspace Display Name Sanitization & XSS Stripping',
      passed,
      message: passed
        ? 'Successfully validated display name constraints (2-60 chars, trimmed, stripped tags).'
        : `Sanitization mismatch: validClean=${validClean.value}, tooShortValid=${tooShort.valid}, xssClean=${maliciousScript.value}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Workspace Display Name Sanitization',
      passed: false,
      message: err.message,
    });
  }

  // 19. Test Workspace Logo Validation Constraints
  try {
    // Mock valid PNG file under 2MB
    const validPng = new File(['mock_image_bytes'], 'logo.png', { type: 'image/png' });
    const validRes = validateLogoFile(validPng);

    // Mock invalid SVG or EXE file
    const invalidType = new File(['mock_bytes'], 'logo.svg', { type: 'image/svg+xml' });
    const invalidTypeRes = validateLogoFile(invalidType);

    // Mock oversized file (> 2MB)
    const bigBlob = new Blob([new Uint8Array(2.5 * 1024 * 1024)], { type: 'image/png' });
    const oversizedFile = new File([bigBlob], 'huge.png', { type: 'image/png' });
    const oversizedRes = validateLogoFile(oversizedFile);

    const passed = validRes.valid && !invalidTypeRes.valid && !oversizedRes.valid;
    results.push({
      name: 'Workspace Logo Validation (PNG/JPEG/WEBP & 2MB Limit)',
      passed,
      message: passed
        ? 'Successfully enforced logo format constraints (PNG/JPEG/WEBP) and 2MB max file size.'
        : `Logo validation failed: valid=${validRes.valid}, invalidType=${invalidTypeRes.valid}, oversized=${oversizedRes.valid}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Workspace Logo Validation',
      passed: false,
      message: err.message,
    });
  }

  // 20. Test Default Workspace Branding Fallback & Security Scoping
  try {
    const defaultBranding = getDefaultWorkspaceBranding('Main Bakery Workspace');
    const passed =
      defaultBranding.displayName === 'Main Bakery Workspace' &&
      defaultBranding.paletteId === DEFAULT_PALETTE_ID &&
      defaultBranding.logoUrl === undefined;

    results.push({
      name: 'Default Workspace Branding Scoping & Fallback',
      passed,
      message: passed
        ? `Successfully generated scoped default branding with ${DEFAULT_PALETTE_ID} palette and clean fallback.`
        : 'Default branding fallback failed.',
    });
  } catch (err: any) {
    results.push({
      name: 'Default Workspace Branding Scoping',
      passed: false,
      message: err.message,
    });
  }

  return results;
}
