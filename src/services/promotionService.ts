import {
  ProductProject,
  QuoteRevision,
  QuoteFormula,
  QuoteFormulaLine,
  FormulaOwnership,
  ProjectProductionPromotion,
} from '../types/quoting';
import {
  Recipe,
  Ingredient,
  MasterIngredient,
  Workspace,
  AccessRole,
} from '../types';
import { isVolumeUnit } from '../utils/units';
import { hasWorkspaceFeature } from './workspaceFeatures';
import { store } from './store';
import { quotingService } from './quotingService';
import { generateFormulaFingerprint } from '../utils/formulaFingerprint';

export interface PromotionStagedIngredient {
  id: string; // original line id
  name: string;
  quantity: number;
  unit: string;
  masterIngredientId: string;
  masterIngredientName?: string;
  pieceWeightGrams?: number;
  densityGramsPerMl?: number;
  notes?: string;
}

export interface PromotionPayload {
  workspaceId: string;
  projectId: string;
  projectName: string;
  sourceType: 'working_formula' | 'quote_revision';
  sourceRevisionId?: string;
  sourceRevisionNumber?: number;
  recipeName: string;
  recipeCategory: string;
  description?: string;
  batchYieldQuantity: number;
  batchYieldUnit: string;
  defaultWastePercent: number;
  mixingInstructions?: string;
  generalNotes?: string;
  formulaOwnership?: FormulaOwnership;
  ingredients: PromotionStagedIngredient[];
  selectedPresetIds?: string[];
  stagedCriticalNotes?: { presetId: string; note: string }[];
  userId: string;
  userName?: string;
  forceDuplicateOverride?: boolean;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingRecipeId?: string;
  existingRecipeName?: string;
  warning?: string;
}

export interface PromotionValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  duplicateResult?: DuplicateCheckResult;
}

/**
 * Access control check for promoting a Product Development project to a Production Recipe.
 *
 * RULES (Phase 2B.6):
 * - Production Floor PIN users: DENIED.
 * - Viewers: DENIED.
 * - Unauthorized workspace members: DENIED.
 * - Workspace must have productQuoting capability.
 * - User role must be owner or editor.
 */
export function canUserPromoteProject(
  workspace: Workspace | null | undefined,
  role: AccessRole | null | undefined,
  isProductionPinUser: boolean = false
): boolean {
  if (isProductionPinUser) {
    return false;
  }
  if (!workspace || !role) {
    return false;
  }
  if (!hasWorkspaceFeature(workspace, 'productQuoting')) {
    return false;
  }
  if (role === 'viewer') {
    return false;
  }
  return role === 'owner' || role === 'editor';
}

/**
 * Checks for likely accidental duplicate promotions.
 * Triggers when the same ProductProject, same source formula fingerprint, and same
 * target recipe name has already been promoted.
 */
export function checkDuplicatePromotion(
  project: ProductProject,
  candidateRecipeName: string,
  candidateFingerprint: string,
  existingRecipes: Recipe[] = []
): DuplicateCheckResult {
  const cleanCandidateName = candidateRecipeName.trim().toLowerCase();

  // 1. Check project's recorded promotions history
  if (project.productionPromotions && project.productionPromotions.length > 0) {
    const matchedHistory = project.productionPromotions.find(
      (promo) =>
        promo.sourceFormulaFingerprint === candidateFingerprint &&
        promo.productionRecipeName.trim().toLowerCase() === cleanCandidateName
    );
    if (matchedHistory) {
      return {
        isDuplicate: true,
        existingRecipeId: matchedHistory.productionRecipeId,
        existingRecipeName: matchedHistory.productionRecipeName,
        warning: `This project already promoted "${matchedHistory.productionRecipeName}" with the identical formula.`,
      };
    }
  }

  // 2. Check active recipes in workspace with matching provenance and fingerprint
  const matchedRecipe = existingRecipes.find(
    (r) =>
      r.sourceProductProjectId === project.id &&
      r.name.trim().toLowerCase() === cleanCandidateName &&
      r.sourceFormulaFingerprint === candidateFingerprint
  );

  if (matchedRecipe) {
    return {
      isDuplicate: true,
      existingRecipeId: matchedRecipe.id,
      existingRecipeName: matchedRecipe.name,
      warning: `Production Recipe "${matchedRecipe.name}" already exists for this project with the identical formulation.`,
    };
  }

  return { isDuplicate: false };
}

/**
 * Validates a promotion payload prior to writing.
 */
export function validatePromotionPayload(
  payload: PromotionPayload,
  workspace: Workspace | null | undefined,
  role: AccessRole | null | undefined,
  project: ProductProject | null | undefined,
  masterIngredients: MasterIngredient[] = [],
  existingRecipes: Recipe[] = []
): PromotionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Authorization
  if (!canUserPromoteProject(workspace, role)) {
    errors.push('Permission denied: You do not have authorization to promote recipes to Production.');
    return { isValid: false, errors, warnings };
  }

  // 2. Project & Workspace Integrity
  if (!project) {
    errors.push('Source Product Development project not found.');
    return { isValid: false, errors, warnings };
  }

  if (project.workspaceId !== payload.workspaceId) {
    errors.push('Cross-workspace promotion is strictly prohibited.');
    return { isValid: false, errors, warnings };
  }

  if (workspace && project.workspaceId !== workspace.id) {
    errors.push('Project does not belong to active workspace.');
    return { isValid: false, errors, warnings };
  }

  // 3. Source Revision check if applicable
  if (payload.sourceType === 'quote_revision') {
    if (!payload.sourceRevisionId) {
      errors.push('Source Quote Revision ID is required when promoting from revision.');
    } else {
      const revisionExists = project.revisions?.some((r) => r.id === payload.sourceRevisionId);
      if (!revisionExists) {
        errors.push(`Specified Quote Revision ${payload.sourceRevisionId} does not exist in this project.`);
      }
    }
  }

  // 4. Recipe Identity
  if (!payload.recipeName || !payload.recipeName.trim()) {
    errors.push('Production Recipe Name is required.');
  }

  if (!payload.recipeCategory || !payload.recipeCategory.trim()) {
    errors.push('Recipe Category is required.');
  }

  if (typeof payload.batchYieldQuantity !== 'number' || payload.batchYieldQuantity <= 0) {
    errors.push('Base Recipe Yield quantity must be a positive number.');
  }

  if (!payload.batchYieldUnit || !payload.batchYieldUnit.trim()) {
    errors.push('Base Recipe Yield unit is required.');
  }

  // 5. Ingredient Validation
  if (!payload.ingredients || payload.ingredients.length === 0) {
    errors.push('Recipe must have at least one ingredient.');
  } else {
    const masterMap = new Map(masterIngredients.map((m) => [m.id, m]));

    payload.ingredients.forEach((ing, index) => {
      const lineNum = index + 1;
      if (!ing.name || !ing.name.trim()) {
        errors.push(`Ingredient #${lineNum} is missing a name.`);
      }

      if (typeof ing.quantity !== 'number' || ing.quantity <= 0) {
        errors.push(`Ingredient "${ing.name || `#${lineNum}`}" must have a quantity greater than zero.`);
      }

      if (!ing.unit || !ing.unit.trim()) {
        errors.push(`Ingredient "${ing.name || `#${lineNum}`}" is missing a measurement unit.`);
      }

      // Master Ingredient Resolution Gate
      if (!ing.masterIngredientId || !ing.masterIngredientId.trim()) {
        errors.push(`Ingredient "${ing.name}" is not linked to a Master Ingredient. Resolution is required.`);
      } else {
        const master = masterMap.get(ing.masterIngredientId);
        if (!master) {
          errors.push(`Ingredient "${ing.name}" references a missing Master Ingredient (${ing.masterIngredientId}).`);
        } else if (master.workspaceId && master.workspaceId !== payload.workspaceId) {
          errors.push(`Ingredient "${ing.name}" references a Master Ingredient from another workspace.`);
        }
      }

      // Volume / Density Check
      if (isVolumeUnit(ing.unit)) {
        const master = masterMap.get(ing.masterIngredientId);
        const density = ing.densityGramsPerMl ?? master?.densityGramsPerMl;
        if (!density || density <= 0) {
          warnings.push(`Ingredient "${ing.name}" uses a volume unit (${ing.unit}) without density. Physical batch weight calculations on the floor will require density.`);
        }
      }
    });
  }

  // 6. Duplicate check
  const fingerprint = generateFormulaFingerprint(payload.ingredients || []);
  const duplicateResult = checkDuplicatePromotion(project, payload.recipeName, fingerprint, existingRecipes);
  if (duplicateResult.isDuplicate && !payload.forceDuplicateOverride) {
    errors.push(duplicateResult.warning || 'A production recipe with this exact name and formulation already exists.');
  } else if (duplicateResult.isDuplicate && payload.forceDuplicateOverride) {
    warnings.push(duplicateResult.warning || 'Creating recipe despite possible duplicate warning.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    duplicateResult,
  };
}

/**
 * Service orchestrator that safely and non-destructively promotes a Product Development
 * project formula into a live Production Recipe.
 */
export class PromotionService {
  /**
   * Performs the authoritative promotion.
   */
  public async promoteProject(payload: PromotionPayload): Promise<{
    recipe: Recipe;
    promotion: ProjectProductionPromotion;
  }> {
    const activeWs = store.getActiveWorkspace();
    const userRole = store.getUserRole();
    const isPin = false;

    // 1. Fresh state validation
    if (!canUserPromoteProject(activeWs, userRole, isPin)) {
      throw new Error('Permission denied: You do not have authorization to promote recipes to Production.');
    }

    const project = quotingService.getProject(payload.workspaceId, payload.projectId);
    if (!project) {
      throw new Error(`Product Development project ${payload.projectId} not found.`);
    }

    const masterIngredients = store.getMasterIngredients();
    const existingRecipes = store.getRecipes();

    const validation = validatePromotionPayload(
      payload,
      activeWs,
      userRole,
      project,
      masterIngredients,
      existingRecipes
    );

    if (!validation.isValid) {
      throw new Error(`Promotion validation failed:\n• ${validation.errors.join('\n• ')}`);
    }

    const now = new Date().toISOString();
    const fingerprint = generateFormulaFingerprint(payload.ingredients);
    const newRecipeId = `rec-promo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 2. Build Recipe entity (Preserving original quantities and units!)
    const productionIngredients: Ingredient[] = payload.ingredients.map((ing) => ({
      id: `ing-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: ing.name.trim(),
      quantity: ing.quantity,
      unit: ing.unit,
      masterIngredientId: ing.masterIngredientId,
      densityGramsPerMl: ing.densityGramsPerMl,
      pieceWeightGrams: ing.pieceWeightGrams,
      notes: ing.notes?.trim() || undefined,
    }));

    const newRecipe: Recipe = {
      id: newRecipeId,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      name: payload.recipeName.trim(),
      description: payload.description?.trim() || '',
      category: payload.recipeCategory.trim(),
      batchYieldQuantity: payload.batchYieldQuantity,
      batchYieldUnit: payload.batchYieldUnit.trim(),
      defaultWastePercent: payload.defaultWastePercent,
      ingredients: productionIngredients,
      mixingInstructions: payload.mixingInstructions?.trim() || undefined,
      criticalProductionNotes: payload.generalNotes?.trim() || undefined,
      archived: false,
      createdAt: now,
      updatedAt: now,

      // Provenance metadata (Phase 2B.6)
      sourceType: 'product_development',
      sourceProductProjectId: payload.projectId,
      sourceProductProjectName: payload.projectName,
      sourceQuoteRevisionId: payload.sourceRevisionId,
      sourceQuoteRevisionNumber: payload.sourceRevisionNumber,
      sourceFormulaFingerprint: fingerprint,
      formulaOwnership: payload.formulaOwnership || project.formulaOwnership || 'bakery_owned',
      promotedAt: now,
      promotedByUid: payload.userId,
      promotedByName: payload.userName,
    };

    // 3. Save new Production Recipe
    await store.saveRecipe(newRecipe);

    // 4. Save staged Critical Production Notes if configured for specific presets
    if (payload.stagedCriticalNotes && payload.stagedCriticalNotes.length > 0) {
      for (const stagedNote of payload.stagedCriticalNotes) {
        if (stagedNote.presetId && stagedNote.note.trim()) {
          try {
            await store.saveCriticalProductionNote({
              presetId: stagedNote.presetId,
              recipeId: newRecipe.id,
              note: stagedNote.note.trim(),
            });
          } catch (err: any) {
            console.warn('[PromotionService] Warning saving critical note:', err.message);
          }
        }
      }
    }

    // 5. Append promotion record to ProductProject without rewriting quote history
    const promotionRecord: ProjectProductionPromotion = {
      id: `promo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      productionRecipeId: newRecipe.id,
      productionRecipeName: newRecipe.name,
      sourceType: payload.sourceType,
      sourceRevisionId: payload.sourceRevisionId,
      sourceRevisionNumber: payload.sourceRevisionNumber,
      sourceFormulaFingerprint: fingerprint,
      promotedAt: now,
      promotedByUid: payload.userId,
      promotedByName: payload.userName,
    };

    const existingPromotions = project.productionPromotions || [];
    const updatedProject: ProductProject = {
      ...project,
      productionPromotions: [promotionRecord, ...existingPromotions],
      convertedRecipeId: newRecipe.id,
      convertedAt: now,
      updatedAt: now,
      updatedBy: payload.userId,
    };

    await quotingService.saveProject(updatedProject);

    return {
      recipe: newRecipe,
      promotion: promotionRecord,
    };
  }
}

export const promotionService = new PromotionService();
