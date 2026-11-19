import { PlanId } from '../types/billing';

export type { PlanId };

/**
 * ============================================================================
 * PHASE 1.3: CENTRAL AUTHORITATIVE PLAN CATALOG & FEATURE DEFINITION
 * ============================================================================
 *
 * Public Plans: SOLO, TEAM
 * Non-Public Classifications: STRATEGIC PARTNER (uses Team capabilities), INTERNAL
 *
 * Invariants:
 * 1. Strategic Partner is NOT a distinct public or purchasable plan. It inherits
 *    all Team feature capabilities and seat rules (5 seats max) through entitlement
 *    metadata (subscriptionStatus: 'complimentary', billingSource: 'strategic_partner').
 * 2. Internal is reserved exclusively for Sunny Sweets core bakery operations.
 *    It is non-purchasable, not publicly visible, and has unlimited practical seats.
 * 3. Browser writes to billing/current and membership tampering remain strictly denied.
 * 4. Plan represents CAPABILITIES. Entitlement represents ACCESS PERMISSION.
 */

export type FeatureKey =
  | 'coreCalculator'
  | 'recipeEditing'
  | 'recipeScaling'
  | 'unitConversion'
  | 'pdfExport'
  | 'teamMembers'
  | 'roles'
  | 'workspaceBranding'
  | 'customLogo'
  | 'paletteSelection'
  | 'sharedWorkspace';

export type BillingInterval = 'monthly' | 'annual';

export interface PlanFeatureDefinition {
  key: FeatureKey;
  label: string;
  description: string;
  includedInSolo: boolean;
  includedInTeam: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  displayName: string;
  description: string;
  tier: 'internal' | 'solo' | 'team';
  seatLimit: number | null; // null represents unlimited (Internal only)
  maxSeats: number | null;
  publiclyVisible: boolean;
  purchasable: boolean;
  features: FeatureKey[];
  featureBulletList: string[];
  // Display pricing placeholders for UI preview (NOT billing authority)
  displayMonthlyPrice?: string;
  displayAnnualPrice?: string;
}

/**
 * Authoritative Plan Catalog
 */
export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  solo: {
    id: 'solo',
    name: 'Solo',
    displayName: 'Solo',
    description: 'Designed for independent artisan bakers, cottage kitchens, and solo pastry chefs.',
    tier: 'solo',
    seatLimit: 1,
    maxSeats: 1,
    publiclyVisible: true,
    purchasable: true,
    features: [
      'coreCalculator',
      'recipeEditing',
      'recipeScaling',
      'unitConversion',
      'pdfExport',
    ],
    featureBulletList: [
      '1 active user seat (private workspace)',
      'Full recipe calculator & formulation engine',
      'Ingredient scaling & baker’s percentage tools',
      'Equipment & mixer batch capacity scaling',
      'PDF batch sheet export & printing',
      'Offline-capable local data persistence',
    ],
    displayMonthlyPrice: 'Pricing coming soon',
    displayAnnualPrice: 'Pricing coming soon',
  },
  team: {
    id: 'team',
    name: 'Team',
    displayName: 'Team',
    description: 'Built for commercial production bakeries, pastry teams, and multi-staff bakery operations.',
    tier: 'team',
    seatLimit: 5,
    maxSeats: 5,
    publiclyVisible: true,
    purchasable: true,
    features: [
      'coreCalculator',
      'recipeEditing',
      'recipeScaling',
      'unitConversion',
      'pdfExport',
      'teamMembers',
      'roles',
      'workspaceBranding',
      'customLogo',
      'paletteSelection',
      'sharedWorkspace',
    ],
    featureBulletList: [
      '5 active user seats total (owner + 4 members)',
      'Team-member management with Owner, Editor & Viewer roles',
      'Shared multi-user workspace & collaborative editing',
      'Custom workspace branding (custom display name & logo)',
      'Curated bakery color palette themes',
      'All Solo core formulation & scaling tools included',
    ],
    displayMonthlyPrice: 'Pricing coming soon',
    displayAnnualPrice: 'Pricing coming soon',
  },
  internal: {
    id: 'internal',
    name: 'Internal',
    displayName: 'Internal',
    description: 'Internal operational access with full system capabilities for Sunny Sweets core bakery operations.',
    tier: 'internal',
    seatLimit: null, // Unlimited practical seats
    maxSeats: null,
    publiclyVisible: false,
    purchasable: false,
    features: [
      'coreCalculator',
      'recipeEditing',
      'recipeScaling',
      'unitConversion',
      'pdfExport',
      'teamMembers',
      'roles',
      'workspaceBranding',
      'customLogo',
      'paletteSelection',
      'sharedWorkspace',
    ],
    featureBulletList: [
      'Sunny Sweets operational workspace only',
      'Unlimited workspace member seats',
      'All core and enterprise features enabled',
      'Protected internal system configuration',
    ],
  },
};

/**
 * Publicly visible and purchasable pricing plans only.
 * Guaranteed to exclude 'internal' and 'strategic_partner'.
 */
export const PUBLIC_PLANS: PlanDefinition[] = [
  PLAN_CATALOG.solo,
  PLAN_CATALOG.team,
];

/**
 * Stripe Price Key mapping structure for Phase 1.4 readiness.
 * Note: These are environment variable / config keys, NOT live Stripe secret keys or live IDs.
 */
export const STRIPE_PRICE_KEYS = {
  solo: {
    monthly: 'STRIPE_PRICE_ID_SOLO_MONTHLY',
    annual: 'STRIPE_PRICE_ID_SOLO_ANNUAL',
  },
  team: {
    monthly: 'STRIPE_PRICE_ID_TEAM_MONTHLY',
    annual: 'STRIPE_PRICE_ID_TEAM_ANNUAL',
  },
} as const;

/**
 * Display-only placeholders for Phase 1.0 UI preview.
 * Authorization, seat enforcement, and entitlement services NEVER read these values.
 */
export const DISPLAY_PRICING_PLACEHOLDERS: Record<PlanId, string> = {
  internal: 'Internal / Non-Billed',
  solo: 'Pricing coming soon',
  team: 'Pricing coming soon',
};

// ============================================================================
// CENTRALIZED PLAN & ENTITLEMENT CAPABILITY HELPERS
// ============================================================================

/**
 * Resolves a plan definition by ID with a safe fallback to 'solo'.
 */
export function getPlanDefinition(planId: PlanId | string | null | undefined): PlanDefinition {
  if (planId === 'internal') return PLAN_CATALOG.internal;
  if (planId === 'team') return PLAN_CATALOG.team;
  return PLAN_CATALOG.solo;
}

/**
 * Checks whether a plan ID is unlimited seats (Internal only).
 */
export function isUnlimitedSeats(planId: PlanId | string | null | undefined): boolean {
  return planId === 'internal';
}

/**
 * Returns the authoritative seat limit for a plan.
 * Returns null for unlimited (internal).
 */
export function getSeatLimit(planId: PlanId | string | null | undefined): number | null {
  const plan = getPlanDefinition(planId);
  return plan.seatLimit;
}

/**
 * Checks if a given plan includes a specific feature key.
 */
export function hasPlanFeature(
  planId: PlanId | string | null | undefined,
  feature: FeatureKey
): boolean {
  const plan = getPlanDefinition(planId);
  return plan.features.includes(feature);
}

/**
 * Checks if team-member management is supported on this plan (Team and Internal only).
 * Solo plans do NOT support team members.
 */
export function canManageTeam(planId: PlanId | string | null | undefined): boolean {
  return hasPlanFeature(planId, 'teamMembers');
}

/**
 * Checks if workspace branding customization (display name, logo, palette selection)
 * is supported on this plan. Team and Internal only.
 */
export function supportsBranding(planId: PlanId | string | null | undefined): boolean {
  return hasPlanFeature(planId, 'workspaceBranding');
}

/**
 * Active Seat Definition:
 * An active seat is a workspace member document where:
 * 1. active === true (strictly boolean true; missing, null, undefined, or malformed values fail closed)
 * 2. role is a recognized active workspace role ('owner' | 'editor' | 'viewer')
 *
 * Inactive members (active === false) do NOT count against seat limits.
 * The owner DOES count toward the seat limit (occupies 1 seat) when active === true.
 */
export const VALID_ACTIVE_ROLES = ['owner', 'editor', 'viewer'] as const;
export type ValidActiveRole = (typeof VALID_ACTIVE_ROLES)[number];

export function isValidActiveRole(role: unknown): role is ValidActiveRole {
  return typeof role === 'string' && (role === 'owner' || role === 'editor' || role === 'viewer');
}

/**
 * Strict fail-closed active seat member check.
 * Evaluates true ONLY when:
 * - active === true
 * - role is one of: 'owner' | 'editor' | 'viewer'
 *
 * Missing, undefined, null, or false active flags are NOT counted as active seats.
 */
export function isActiveSeatMember(member: { role?: unknown; active?: unknown } | null | undefined): boolean {
  if (!member || typeof member !== 'object') return false;
  if (member.active !== true) return false;
  if (!isValidActiveRole(member.role)) return false;
  return true;
}

/**
 * Counts active seats in a members list strictly failing closed.
 */
export function countActiveSeats(members: Array<{ role?: unknown; active?: unknown }> | null | undefined): number {
  if (!Array.isArray(members)) return 0;
  return members.filter(isActiveSeatMember).length;
}

/**
 * Diagnostic check for workspace owner membership integrity.
 * Authoritative owner membership must exist with role === 'owner' and active === true.
 * Does not silently rewrite or force Math.max(1, count).
 */
export interface OwnerIntegrityResult {
  isValid: boolean;
  ownerFound: boolean;
  isOwnerActive: boolean;
  isOwnerRoleValid: boolean;
  ownerUid: string | null;
  issue?: string;
}

export function checkOwnerMembershipIntegrity(
  members: Array<{ uid?: string; role?: unknown; active?: unknown }> | null | undefined,
  expectedOwnerUid?: string | null
): OwnerIntegrityResult {
  if (!Array.isArray(members) || members.length === 0) {
    return {
      isValid: false,
      ownerFound: false,
      isOwnerActive: false,
      isOwnerRoleValid: false,
      ownerUid: expectedOwnerUid || null,
      issue: 'No member documents present in workspace roster.',
    };
  }

  const ownerMember = expectedOwnerUid
    ? members.find((m) => m.uid === expectedOwnerUid)
    : members.find((m) => m.role === 'owner');

  if (!ownerMember) {
    return {
      isValid: false,
      ownerFound: false,
      isOwnerActive: false,
      isOwnerRoleValid: false,
      ownerUid: expectedOwnerUid || null,
      issue: 'Authoritative workspace owner document not found in members roster.',
    };
  }

  const isOwnerRoleValid = ownerMember.role === 'owner';
  const isOwnerActive = ownerMember.active === true;
  const ownerUid = ownerMember.uid || expectedOwnerUid || null;

  if (!isOwnerRoleValid || !isOwnerActive) {
    return {
      isValid: false,
      ownerFound: true,
      isOwnerActive,
      isOwnerRoleValid,
      ownerUid,
      issue: !isOwnerActive
        ? 'Owner membership is inactive or has missing/malformed active flag.'
        : `Owner membership has invalid role "${String(ownerMember.role)}".`,
    };
  }

  return {
    isValid: true,
    ownerFound: true,
    isOwnerActive: true,
    isOwnerRoleValid: true,
    ownerUid,
  };
}

export interface SeatUsageSummary {
  planId: PlanId;
  planDisplayName: string;
  activeSeats: number;
  seatLimit: number | null; // null for unlimited
  isUnlimited: boolean;
  isAtLimit: boolean;
  isOverLimit: boolean;
  canAddMember: boolean;
  availableSeats: number | null; // null if unlimited
}

export function computeSeatUsage(
  planId: PlanId | string | null | undefined,
  activeSeatsCount: number
): SeatUsageSummary {
  const plan = getPlanDefinition(planId);
  const unlimited = isUnlimitedSeats(plan.id);
  const limit = plan.seatLimit;

  if (unlimited || limit === null) {
    return {
      planId: plan.id,
      planDisplayName: plan.displayName,
      activeSeats: activeSeatsCount,
      seatLimit: null,
      isUnlimited: true,
      isAtLimit: false,
      isOverLimit: false,
      canAddMember: true,
      availableSeats: null,
    };
  }

  const isAtLimit = activeSeatsCount >= limit;
  const isOverLimit = activeSeatsCount > limit;
  const canAddMember = activeSeatsCount < limit;
  const availableSeats = Math.max(0, limit - activeSeatsCount);

  return {
    planId: plan.id,
    planDisplayName: plan.displayName,
    activeSeats: activeSeatsCount,
    seatLimit: limit,
    isUnlimited: false,
    isAtLimit,
    isOverLimit,
    canAddMember,
    availableSeats,
  };
}
