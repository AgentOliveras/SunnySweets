import { WeightUnit } from './index';

export type FormulaOwnership = 'bakery_owned' | 'customer_owned' | 'joint_development';

export type ProjectStatus =
  | 'draft'
  | 'testing'
  | 'ready_to_quote'
  | 'quoted'
  | 'approved'
  | 'declined'
  | 'archived';

export interface TemporaryIngredientData {
  name: string;
  packagePriceCents: number; // e.g. 2500 for $25.00
  packQuantity: number;      // e.g. 1
  unitSize: number;          // e.g. 5
  unitMeasure: string;       // e.g. 'lb', 'kg', 'g', 'oz', 'each'
  densityGramsPerMl?: number;
  pieceWeightGrams?: number;
  notes?: string;
}

export interface QuoteFormulaLine {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  masterIngredientId?: string;
  isTemporary?: boolean;
  temporaryData?: TemporaryIngredientData;
  unitCostUsed: number;
  unitCostType: 'per_gram' | 'per_each';
  lineCost: number;
  densityGramsPerMl?: number;
  notes?: string;
}

export interface QuoteFormula {
  totalWeightGrams: number;
  totalCost: number;
  costPerGram?: number;
  costPerLb?: number;
  costPerKg?: number;
  lines: QuoteFormulaLine[];
}

export interface PackagingLineItem {
  id: string;
  name: string;
  cost: number;
}

export interface OtherCostLineItem {
  id: string;
  name: string;
  cost: number;
}

export type QuotedPricingMethod =
  | 'price_per_case'
  | 'price_per_unit'
  | 'desired_profit'
  | 'ingredients_multiplier';

export type QuotePricingBasis =
  | 'case'
  | 'unit'
  | 'profit_case'
  | 'multiplier'
  | 'price_per_case'
  | 'price_per_unit'
  | 'desired_profit'
  | 'ingredients_multiplier';

export interface QuoteProductConfig {
  id: string;
  productType: string; // e.g. 'Cookie', 'Pie Dough', 'Bread', 'Muffin', 'Brownie', 'Bar', 'Scone', 'Other'
  name: string;        // e.g. '4 oz (80/cs)'
  pieceWeight: number;
  weightUnit: WeightUnit;
  piecesPerCase: number;
  unitName: string;    // e.g. 'case', 'box', 'tray'
  doughWeightGrams: number;
  rawIngredientCost: number;
  ingredientMultiplier: number;
  packagingCost: number;
  packagingLines?: PackagingLineItem[];
  laborCost: number;
  otherCost: number;
  otherLines?: OtherCostLineItem[];
  totalProductionCost: number; // COGS / Case
  costPerUnit?: number;       // COGS / Units per Case (prominent first-class financial metric)
  
  // Section A: Target Pricing Model
  calculatedTargetPrice: number; // Target Price / Case
  targetPricePerUnit?: number;   // Target Price / Unit
  targetDollarProfit?: number;   // Profit at Target Price
  targetGrossMarginPercent?: number; // Margin % at Target Price
  targetMarkupPercent?: number;      // Markup % at Target Price
  isTargetPriceComplete?: boolean;   // Whether required target inputs are valid

  // Section B: Actual Quoted Price Model (Interactive Quoted Pricing)
  pricingBasis?: QuotePricingBasis;  // 'case' | 'unit' | etc.
  quotedMethod?: QuotedPricingMethod;// 'price_per_case' | 'price_per_unit' | 'desired_profit' | 'ingredients_multiplier'
  quotedMethodValue?: number | null; // Entered raw value for the active method
  desiredProfitPerCase?: number | null; // Desired profit when Mode C is used
  quotedMultiplier?: number | null;  // Multiplier when Mode D is used
  quotedPrice: number | null;        // Actual Quoted Price / Case (null for new unquoted configs)
  quotedPricePerUnit?: number | null;// Actual Quoted Price / Unit (null for new unquoted configs)
  unitPrice: number;                 // Compatibility alias: quoted unit price or target unit price
  dollarProfit: number;              // Actual Dollar Profit
  grossMarginPercent: number;        // Actual Gross Margin %
  markupPercent: number;             // Actual Markup %
  targetVarianceDollars: number;     // Case variance: quotedPrice - calculatedTargetPrice
  targetVarianceUnitDollars?: number;// Unit variance: quotedPricePerUnit - targetPricePerUnit
  targetVariancePercent?: number;    // % variance vs target
  isQuotedPriceSet?: boolean;        // Whether an actual quoted price was set by management
}

export interface QuoteRevision {
  id: string;
  revisionNumber: number;
  quoteCode: string;
  createdAt: string;
  createdBy: string;
  createdByName?: string;
  formulaSnapshot: QuoteFormula;
  productsSnapshot: QuoteProductConfig[];
  notes?: string;
  sourceRecipeId?: string;
  sourceRecipeName?: string;
  importedAt?: string;
  sourceVersion?: string | number;
}

export interface ProjectProductionPromotion {
  id: string;
  productionRecipeId: string;
  productionRecipeName: string;
  sourceType: 'working_formula' | 'quote_revision';
  sourceRevisionId?: string;
  sourceRevisionNumber?: number;
  sourceFormulaFingerprint: string;
  promotedAt: string;
  promotedByUid: string;
  promotedByName?: string;
}

export interface ProductProject {
  id: string;
  workspaceId: string;
  projectCode?: string;
  productName: string;
  customerName?: string;
  description?: string;
  productCategory?: string;
  formulaOwnership: FormulaOwnership;
  isConfidential?: boolean;
  hasNda?: boolean;
  status: ProjectStatus;
  formula: QuoteFormula;
  products: QuoteProductConfig[];
  revisions: QuoteRevision[];
  currentRevisionNumber: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived?: boolean;
  sourceRecipeId?: string;
  sourceRecipeName?: string;
  importedAt?: string;
  sourceVersion?: string | number;
  convertedRecipeId?: string;
  convertedAt?: string;
  productionPromotions?: ProjectProductionPromotion[];
  documentVersion?: number;
  hasUnsyncedLocalChanges?: boolean;
  allowEmptyFormula?: boolean;
  cloudConflict?: {
    conflictAt: string;
    serverVersion?: number;
    serverUpdatedAt?: string;
    serverFormulaLineCount: number;
    serverProductName?: string;
  };
}

export interface CandidateRecoveryRecord {
  projectId: string;
  projectCode?: string;
  productName: string;
  customerName?: string;
  source: 'local_storage_recovery' | 'project_cache' | 'quote_revision' | 'cloud_conflict';
  storageKey?: string;
  timestamp: string;
  ingredientCount: number;
  totalWeightGrams: number;
  productCount: number;
  revisionNumber?: number;
  isPopulated: boolean;
  rawRecord: any;
}

export const DEFAULT_PRODUCT_TYPES = [
  'Cookie',
  'Dough',
  'Pie Dough',
  'Bread',
  'Muffin',
  'Brownie',
  'Bar',
  'Scone',
  'Pastry',
  'Other',
] as const;

export interface ProjectDeletionPreview {
  projectId: string;
  projectCode?: string;
  productName: string;
  customerName?: string;
  workspaceId: string;
  status: ProjectStatus;
  isArchived?: boolean;
  productConfigurationsCount: number;
  draftQuotesCount: number;
  issuedRevisionsCount: number;
  hasPromotedRecipes: boolean;
  promotionsCount: number;
  sourceRecipeId?: string;
  sourceRecipeName?: string;
  whatWillBeDeleted: string[];
  whatWillBePreserved: string[];
  blockers: string[];
  isEligible: boolean;
  baseDocumentVersion?: number;
}

export interface ProjectDeletionEligibilityResult {
  isEligible: boolean;
  reasons: string[];
  preview: ProjectDeletionPreview;
}

export interface ProjectDeletionAuditRecord {
  operationId: string;
  workspaceId: string;
  deletedRecordId: string;
  recordType: 'product_project' | 'quote_product_config';
  actorUid: string;
  actorRole: string;
  timestamp: string;
  recordSummary: {
    productName: string;
    projectCode?: string;
    documentVersion?: number;
    configsCount: number;
    linesCount?: number;
  };
}

