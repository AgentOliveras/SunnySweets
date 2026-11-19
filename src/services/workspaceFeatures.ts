import { Workspace, WorkspaceFeatures, AccessRole } from '../types';

/**
 * Authoritative default capability matrix for workspaces.
 * Existing and newly provisioned workspaces inherit these defaults safely.
 *
 * Core capabilities:
 * - recipeManagement: true (formula drafting, scaling, ingredients, archive)
 * - productionFloor: true (tablet floor mode, mixer batch limits, guided mixing)
 * - costing: true (ingredient linking, cost coverage, financial completion)
 *
 * Private / Operational modules (Sunny Sweets & future enterprise tiers):
 * - inventoryManagement: false (stock tracking, lot consumption)
 * - labelPrinting: false (commercial compliance, FDA/lot labels)
 */
export const DEFAULT_WORKSPACE_FEATURES: Readonly<WorkspaceFeatures> = Object.freeze({
  recipeManagement: true,
  productionFloor: true,
  costing: true,
  inventoryManagement: false,
  labelPrinting: false,
  productQuoting: true,
});

export interface WorkspaceFeatureDescriptor {
  key: keyof WorkspaceFeatures;
  name: string;
  category: 'core' | 'operational' | 'enterprise';
  description: string;
  isCore: boolean;
  isInternalPreview?: boolean;
}

export const WORKSPACE_FEATURE_REGISTRY: Record<string, WorkspaceFeatureDescriptor> = {
  recipeManagement: {
    key: 'recipeManagement',
    name: 'Recipe Management & Formulations',
    category: 'core',
    description: 'Full recipe drafting, ingredient scaling, baker percentages, and formula archiving.',
    isCore: true,
  },
  productionFloor: {
    key: 'productionFloor',
    name: 'Production Floor & Tablet Mode',
    category: 'core',
    description: 'Touch-optimized tablet interface for bakery production staff, batch splitting, and mixer safety.',
    isCore: true,
  },
  costing: {
    key: 'costing',
    name: 'Costing & Ingredient Intelligence',
    category: 'core',
    description: 'Master ingredient linking, purchasing packages, margin calculations, and batch costing completion.',
    isCore: true,
  },
  inventoryManagement: {
    key: 'inventoryManagement',
    name: 'Inventory & Stock Control',
    category: 'operational',
    description: 'Real-time bakery inventory, automatic batch deductions from production runs, and low-stock alerts.',
    isCore: false,
    isInternalPreview: true,
  },
  labelPrinting: {
    key: 'labelPrinting',
    name: 'Commercial Label Printing',
    category: 'operational',
    description: 'Compliant case labels, product labels, lot/date coding, and allergen warnings for bakery wholesale.',
    isCore: false,
    isInternalPreview: true,
  },
  productQuoting: {
    key: 'productQuoting',
    name: 'Product Development & Quoting',
    category: 'operational',
    description: 'R&D working formulas, contract manufacturing costing, multi-scenario pricing, and quote history.',
    isCore: false,
    isInternalPreview: true,
  },
};

/**
 * Resolves the effective feature set for a workspace, safely merging
 * stored overrides with authoritative default capabilities.
 *
 * Guaranteed to never return undefined for any core or operational key.
 */
export function resolveWorkspaceFeatures(workspace?: Workspace | null): WorkspaceFeatures {
  if (!workspace || !workspace.features) {
    return { ...DEFAULT_WORKSPACE_FEATURES };
  }

  return {
    ...DEFAULT_WORKSPACE_FEATURES,
    ...workspace.features,
  };
}

/**
 * Checks whether a specific workspace has a given feature enabled.
 */
export function hasWorkspaceFeature(
  workspace: Workspace | null | undefined,
  featureKey: keyof WorkspaceFeatures
): boolean {
  const features = resolveWorkspaceFeatures(workspace);
  return Boolean(features[featureKey]);
}

export interface FeatureAccessDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Evaluates whether a user with a given role can perform an action on a feature in a workspace.
 *
 * Enforces clean separation of concerns:
 * 1. Subscription Entitlement: Determines if workspace has access to the SaaS product.
 * 2. Workspace Capabilities: Determines which modules the workspace is equipped with.
 * 3. User Role Permissions: Determines what this specific user can do with that module.
 *
 * CRITICAL INVARIANT:
 * Feature enablement on a workspace NEVER elevates viewer permissions!
 */
export function canUserAccessFeature(
  workspace: Workspace | null | undefined,
  role: AccessRole | null | undefined,
  featureKey: keyof WorkspaceFeatures,
  action: 'view' | 'use' | 'configure' = 'view'
): FeatureAccessDecision {
  // 1. Workspace-level capability check
  if (!hasWorkspaceFeature(workspace, featureKey)) {
    return {
      allowed: false,
      reason: `Feature '${String(featureKey)}' is not enabled for this workspace.`,
    };
  }

  // 2. User membership & role check
  if (!role) {
    return {
      allowed: false,
      reason: 'No active role found for this workspace.',
    };
  }

  // 3. Action-specific role check
  if (action === 'configure') {
    // Only workspace owners can configure workspace settings/features
    if (role !== 'owner') {
      return {
        allowed: false,
        reason: 'Permission denied: Only workspace owners can configure workspace capabilities.',
      };
    }
    return { allowed: true };
  }

  if (action === 'use') {
    // Viewers are strictly read-only and cannot mutate data or execute mutating actions
    if (role === 'viewer') {
      return {
        allowed: false,
        reason: 'Permission denied: Viewers have read-only access and cannot modify module data.',
      };
    }
    return { allowed: true };
  }

  // action === 'view' (Owners, Editors, and Viewers can view enabled modules)
  return { allowed: true };
}
