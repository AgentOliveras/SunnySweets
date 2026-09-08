export type WeightUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'fl_oz';
export type DiscreteUnit = 'pcs' | 'units' | 'eggs' | 'cookies' | 'doz' | 'trays' | 'cases';
export type MeasurementUnit = WeightUnit | VolumeUnit | DiscreteUnit | string;

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
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: MeasurementUnit;
  notes?: string;
  wastePercent?: number; // Ingredient-specific waste percentage
  densityGramsPerMl?: number; // Optional density for volume conversion
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
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
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
  finishedWeight: number;
  weightUnit: WeightUnit;
  quantityPerUnit: number; // e.g., 80 cookies per case
  unitName: string; // e.g., "case", "tray", "box"
  expectedYield?: string;
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
  wastePercent: number;
  requiredQuantity: number;
  requiredUnit: string;
  convertedQuantityInDefaultUnit?: number;
  defaultUnit?: WeightUnit;
  notes?: string;
  perBatchQuantity?: number;
  isPeanutButter?: boolean;
  jarsDetail?: PeanutButterJarsDetail;
  perBatchJarsDetail?: PeanutButterJarsDetail;
}

export interface CalculationResult {
  recipe: Recipe;
  requirements: ProductionItemRequirement[];
  totalPieces: number;
  totalFinishedWeightGrams: number;
  baseRecipeTotalWeightGrams: number;
  scalingMultiplier: number;
  recipeWastePercent: number;
  overrideWastePercent?: number;
  mixer?: Mixer;
  totalBatchWeightGrams: number;
  displayBatchWeight: number;
  displayWeightUnit: WeightUnit;
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
  defaultWastePercent: number;
  decimalPlaces?: number; // 0 for no decimals (rounded whole numbers), 1, 2, 3, 4, etc.
  theme: 'light' | 'dark' | 'system';
  businessName?: string;
  categoryPresetMap?: Record<string, string | string[]>; // Recipe category -> Preset categories mapping (e.g. 'Cookies' -> ['Cookies', 'Shortbread'])
  recipeCategories?: string[]; // User-managed list of recipe categories
  activeWorkspaceId?: string;
  workspaceName?: string;
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

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  code: string;
  members: AccessMember[];
  groups: AccessGroup[];
  branding?: WorkspaceBranding;
  createdAt: string;
  updatedAt: string;
}
