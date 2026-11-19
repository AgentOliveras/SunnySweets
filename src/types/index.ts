export type WeightUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'fl_oz' | 'pt' | 'qt' | 'gal';
export type DiscreteUnit = 'pcs' | 'units' | 'eggs' | 'cookies' | 'doz' | 'trays' | 'cases';
export type MeasurementUnit = WeightUnit | VolumeUnit | DiscreteUnit | string;

export type ProductionMeasurementDisplayMode = 'as_entered' | 'g' | 'kg' | 'oz' | 'lb';

export type CostingDimension = 'mass' | 'volume' | 'discrete';

export interface PurchasePackage {
  packQuantity: number;
  unitSize: number;
  unitMeasure: string;
  packageType?: string;
  packagePriceCents: number; // Integer cents ($24.50 = 2450)
  supplierName?: string;
  supplierItemCode?: string;
  effectiveDate?: string;
}

export interface MasterIngredient {
  id: string;
  workspaceId?: string;
  userId?: string;
  name: string;
  subIngredients?: string; // Ingredients/components of this ingredient
  category?: string;
  defaultUnit?: string;
  defaultWastePercent?: number;
  allergens?: string;
  brand?: string;
  netWeight?: number;
  netWeightUnit?: string;
  packageType?: string;
  supplier?: string;
  createdAt?: string;
  updatedAt?: string;

  // Phase 2.0B Costing Extensions (Non-destructive & Optional)
  preferredPurchasePackage?: PurchasePackage;
  dimension?: CostingDimension;
  densityGramsPerMl?: number;
  pieceWeightGrams?: number;
  costPerGram?: number; // Floating point numeric dollar representation (e.g. 0.00108026)
  costPerEach?: number; // Floating point numeric dollar representation (e.g. 0.25)
  costUpdatedAt?: string;
  schemaVersion?: number; // e.g. 2
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: MeasurementUnit;
  notes?: string;
  wastePercent?: number; // Ingredient-specific waste percentage
  densityGramsPerMl?: number; // Optional density for volume conversion
  pieceWeightGrams?: number; // Optional piece weight for discrete conversion
  masterIngredientId?: string; // Phase 2.0B persistent link to MasterIngredient
}

export interface Recipe {
  id: string;
  workspaceId?: string;
  userId: string;
  name: string;
  description: string;
  category?: string;
  orderIndex?: number;
  batchYieldQuantity: number;
  batchYieldUnit: string; // e.g., 'cookies', 'kg', 'loaves', 'batch'
  defaultWastePercent: number;
  ingredients: Ingredient[];
  mixingInstructions?: string; // Step-by-step operating procedure for mixing
  criticalProductionNotes?: string; // Alias/helper reference to description
  archived?: boolean;
  createdAt: string;
  updatedAt: string;

  // Phase 2B.6 Product Development -> Production Recipe Provenance
  sourceType?: 'product_development';
  sourceProductProjectId?: string;
  sourceProductProjectName?: string;
  sourceQuoteRevisionId?: string;
  sourceQuoteRevisionNumber?: number;
  sourceFormulaFingerprint?: string;
  formulaOwnership?: 'bakery_owned' | 'customer_owned' | 'joint_development';
  promotedAt?: string;
  promotedByUid?: string;
  promotedByName?: string;
}

export interface CriticalProductionNote {
  id: string;
  presetId: string; // Authoritative stable preset ID
  recipeId: string; // Authoritative stable recipe ID
  workspaceId?: string;
  note: string; // Note content (e.g. "Use 4000-count chocolate chips for the 1 oz cookies.")
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export const DEFAULT_PRESET_CATEGORIES = [
  'Cookies',
  'Pie Dough',
  'Base Dough',
  'Shortbread',
] as const;
export type DefaultPresetCategory = (typeof DEFAULT_PRESET_CATEGORIES)[number];

export interface ProductionPreset {
  id: string;
  workspaceId?: string;
  userId: string;
  name: string;
  category?: string; // e.g. 'Cookies', 'Pie Dough', 'Base Dough', 'Shortbread'
  recipeCategory?: string; // Optional alias for category
  finishedWeight: number;
  weightUnit: WeightUnit;
  quantityPerUnit: number; // e.g., 80 cookies per case
  unitName: string; // e.g., "case", "tray", "box"
  expectedYield?: string;
  productionEnabled?: boolean; // Shared workspace Production Floor visibility (undefined defaults to true)
  criticalNotes?: CriticalProductionNote[]; // Preset + Recipe specific critical operational notes
  createdAt: string;
  updatedAt: string;
}

export interface Mixer {
  id: string;
  workspaceId?: string;
  userId: string;
  name: string;
  maxWeight: number;
  weightUnit: WeightUnit;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionItemRequirement {
  id: string;
  presetId?: string;
  presetName: string;
  quantity: number; // e.g., 2 cases
  piecesPerUnit: number; // e.g., 80
  itemWeight: number; // e.g., 4
  itemWeightUnit: WeightUnit; // e.g., 'oz'
}

export interface PeanutButterJarsDetail {
  jars: number;
  fullJars: number;
  remainingGrams: number;
  text: string;
}

export interface CalculatedIngredient {
  id: string;
  name: string;
  baseQuantity: number;
  baseUnit: string;
  scaledQuantity: number;
  scaledUnit?: string; // Optional convenience alias for requiredUnit
  wastePercent: number;
  requiredQuantity: number;
  requiredUnit: string;
  displayQuantity?: number;
  displayUnit?: string;
  convertedQuantityInDefaultUnit?: number;
  defaultUnit?: WeightUnit;
  notes?: string;
  perBatchQuantity?: number;
  perBatchDisplayQuantity?: number;
  isPeanutButter?: boolean;
  jarsDetail?: PeanutButterJarsDetail;
  perBatchJarsDetail?: PeanutButterJarsDetail;
  ingredientWastePercent?: number; // Preserves ingredient-level purchasing/yield waste percentage
  pieceWeightGrams?: number;
  densityGramsPerMl?: number;
  isDiscrete?: boolean;
  isVolume?: boolean;
  isWeight?: boolean;
  densityWarning?: string;
}

export interface CalculationResult {
  recipe: Recipe;
  requirements: ProductionItemRequirement[];
  totalPieces: number;
  totalFinishedWeightGrams: number;
  baseRecipeTotalWeightGrams: number;
  scalingMultiplier: number;
  multiplier?: number; // Optional convenience alias for scalingMultiplier
  recipeWastePercent: number;
  overrideWastePercent?: number;
  productionWastePercent?: number; // Authoritative whole-batch production waste %
  mixer?: Mixer;
  totalBatchWeightGrams: number;
  displayBatchWeight: number;
  displayWeightUnit: WeightUnit;
  displayMode?: ProductionMeasurementDisplayMode;
  densityWarnings?: string[];
  discreteMixerWarning?: string;
  mixerMaxWeightGrams: number;
  isCapacityExceeded: boolean;
  capacityOverridden: boolean;
  suggestedBatches: number;
  calculatedIngredients: CalculatedIngredient[];
}

export interface ProductionHistoryEntry {
  id: string;
  workspaceId?: string;
  userId: string;
  recipeId: string;
  recipeName: string;
  calculatedAt: string;
  requirements: ProductionItemRequirement[];
  totalPieces: number;
  totalFinishedWeightGrams: number;
  displayBatchWeight: number;
  displayWeightUnit: WeightUnit;
  scalingMultiplier: number;
  wastePercent: number;
  mixerName?: string;
  mixerMaxWeight?: number;
  mixerWeightUnit?: WeightUnit;
  capacityExceeded: boolean;
  capacityOverridden: boolean;
  suggestedBatches: number;
  calculatedIngredients: CalculatedIngredient[];
  status: 'draft' | 'in_progress' | 'completed';
  completedAt?: string;
  notes?: string;
}

export interface WorkspaceMemberDoc {
  uid: string; // member uid (document ID)
  id?: string; // backwards compatibility
  email: string;
  name: string;
  role: AccessRole;
  active: boolean;
  addedAt: string;
  updatedAt: string;
}

export interface UserSettings {
  userId: string;
  defaultWeightUnit: WeightUnit;
  defaultProductionDisplayMode?: ProductionMeasurementDisplayMode;
  defaultWastePercent: number;
  decimalPlaces?: number; // 0 for no decimals (rounded whole numbers), 1, 2, 3, 4, etc.
  theme: 'light' | 'dark' | 'system';
  businessName?: string;
  categoryPresetMap?: Record<string, string | string[]>; // Recipe category -> Preset categories mapping (e.g. 'Cookies' -> ['Cookies', 'Shortbread'])
  recipeCategories?: string[]; // User-managed list of recipe categories
  activeWorkspaceId?: string;
  workspaceName?: string;
  productionFloorModeEnabled?: boolean;
  productionOptionOrder?: string[]; // Persisted ordering of production presets and options
  updatedAt?: string;
}

export type AccessRole = 'owner' | 'editor' | 'viewer';

export interface AccessMember {
  email: string;
  name?: string;
  role: AccessRole;
  addedAt: string;
}

export interface AccessGroup {
  id: string;
  name: string;
  memberEmails: string[];
  role: AccessRole;
}

export type PresetPaletteId =
  | 'warm-bakery'
  | 'modern-navy'
  | 'sage-kitchen'
  | 'charcoal-gold'
  | 'berry-cream';

export interface WorkspaceBranding {
  displayName: string;
  logoUrl?: string;
  logoStoragePath?: string;
  paletteId: PresetPaletteId | string;
}

export type BusinessType =
  | 'Bakery'
  | 'Restaurant'
  | 'Catering'
  | 'Hotel / Hospitality'
  | 'Coffee Shop'
  | 'Commercial Kitchen'
  | 'Other';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  defaultWorkspaceId: string | null;
  ownedWorkspaceId?: string | null;
  trialConsumedForOwnedWorkspace?: boolean;
  onboardingStatus: 'pending_workspace' | 'workspace_created';
}

export interface UserWorkspaceMembership {
  workspaceId: string;
  role: AccessRole;
  active: boolean;
  createdAt: string;
}

export interface WorkspaceFeatures {
  recipeManagement: boolean;
  productionFloor: boolean;
  costing: boolean;
  inventoryManagement: boolean;
  labelPrinting: boolean;
  productQuoting: boolean;
  [key: string]: boolean | undefined;
}

export interface WorkspaceManagementLockPolicy {
  enabled: boolean;
  salt: string;
  hash: string;
  updatedAt?: string;
  updatedByUid?: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  code: string;
  members: AccessMember[];
  groups: AccessGroup[];
  branding?: WorkspaceBranding;
  businessType?: BusinessType;
  productionFloorModeEnabled?: boolean;
  managementLock?: WorkspaceManagementLockPolicy;
  productionOptionOrder?: string[]; // Persisted ordering of production presets and options
  categoryPresetMap?: Record<string, string | string[]>; // Authoritative shared recipe-category -> preset-category routing map
  recipeCategories?: string[]; // Shared workspace-level list of recipe categories
  features?: Partial<WorkspaceFeatures>;
  createdAt: string;
  updatedAt: string;
}

export * from './billing';
export * from './quoting';
export type { TabType } from '../components/Navbar';
