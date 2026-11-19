import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PLAN_CATALOG,
  getPlanDefinition,
  isUnlimitedSeats,
  getSeatLimit,
  hasPlanFeature,
  canManageTeam,
  supportsBranding,
  computeSeatUsage,
  isActiveSeatMember,
  countActiveSeats,
  checkOwnerMembershipIntegrity,
  PlanId,
} from '../src/config/plans';
import { EntitlementService } from '../src/services/entitlement';
import { WorkspaceMemberDoc } from '../src/types';

describe('Phase 1.3 — Pricing Plans, Feature Entitlements & Seat Limits Suite', () => {
  describe('1. Plan Catalog & Seat Limits', () => {
    it('contains exactly the three designated plans: internal, solo, and team (no scale)', () => {
      const planKeys = Object.keys(PLAN_CATALOG);
      assert.deepStrictEqual(planKeys.sort(), ['internal', 'solo', 'team'].sort());
      assert.strictEqual((PLAN_CATALOG as any).scale, undefined);
      assert.strictEqual((PLAN_CATALOG as any).enterprise, undefined);
    });

    it('defines correct seat limits: solo = 1, team = 5, internal = null (unlimited)', () => {
      assert.strictEqual(getSeatLimit('solo'), 1);
      assert.strictEqual(getSeatLimit('team'), 5);
      assert.strictEqual(getSeatLimit('internal'), null);

      assert.strictEqual(isUnlimitedSeats('internal'), true);
      assert.strictEqual(isUnlimitedSeats('solo'), false);
      assert.strictEqual(isUnlimitedSeats('team'), false);
    });

    it('falls back safely to solo plan definition for unknown plan IDs', () => {
      const def = getPlanDefinition('unrecognized_plan' as PlanId);
      assert.strictEqual(def.id, 'solo');
      assert.strictEqual(def.seatLimit, 1);
    });
  });

  describe('2. Feature Entitlements Matrix', () => {
    it('solo plan includes core recipe features but excludes team management and branding', () => {
      assert.strictEqual(hasPlanFeature('solo', 'coreCalculator'), true);
      assert.strictEqual(hasPlanFeature('solo', 'recipeEditing'), true);
      assert.strictEqual(hasPlanFeature('solo', 'recipeScaling'), true);
      assert.strictEqual(hasPlanFeature('solo', 'pdfExport'), true);

      // Excluded from solo
      assert.strictEqual(hasPlanFeature('solo', 'teamMembers'), false);
      assert.strictEqual(hasPlanFeature('solo', 'workspaceBranding'), false);
      assert.strictEqual(canManageTeam('solo'), false);
      assert.strictEqual(supportsBranding('solo'), false);
    });

    it('team plan includes team management, custom branding, and 5 seats', () => {
      assert.strictEqual(hasPlanFeature('team', 'coreCalculator'), true);
      assert.strictEqual(hasPlanFeature('team', 'teamMembers'), true);
      assert.strictEqual(hasPlanFeature('team', 'workspaceBranding'), true);
      assert.strictEqual(canManageTeam('team'), true);
      assert.strictEqual(supportsBranding('team'), true);
      assert.strictEqual(getSeatLimit('team'), 5);
    });

    it('internal plan includes full team management, custom branding, and unlimited seats', () => {
      assert.strictEqual(hasPlanFeature('internal', 'teamMembers'), true);
      assert.strictEqual(hasPlanFeature('internal', 'workspaceBranding'), true);
      assert.strictEqual(canManageTeam('internal'), true);
      assert.strictEqual(supportsBranding('internal'), true);
      assert.strictEqual(isUnlimitedSeats('internal'), true);
    });
  });

  describe('3. Seat Usage Computation & Capacity Guard', () => {
    it('solo plan: 1 active seat is at limit and cannot add members', () => {
      const usage = computeSeatUsage('solo', 1);
      assert.strictEqual(usage.activeSeats, 1);
      assert.strictEqual(usage.seatLimit, 1);
      assert.strictEqual(usage.isAtLimit, true);
      assert.strictEqual(usage.canAddMember, false);
      assert.strictEqual(usage.availableSeats, 0);
      assert.strictEqual(usage.isUnlimited, false);
    });

    it('solo plan: 0 active seats allows up to 1 seat', () => {
      const usage = computeSeatUsage('solo', 0);
      assert.strictEqual(usage.activeSeats, 0);
      assert.strictEqual(usage.isAtLimit, false);
      assert.strictEqual(usage.canAddMember, true);
      assert.strictEqual(usage.availableSeats, 1);
    });

    it('team plan: 1 to 4 active seats allows adding members', () => {
      const usage1 = computeSeatUsage('team', 1);
      assert.strictEqual(usage1.activeSeats, 1);
      assert.strictEqual(usage1.seatLimit, 5);
      assert.strictEqual(usage1.isAtLimit, false);
      assert.strictEqual(usage1.canAddMember, true);
      assert.strictEqual(usage1.availableSeats, 4);

      const usage4 = computeSeatUsage('team', 4);
      assert.strictEqual(usage4.activeSeats, 4);
      assert.strictEqual(usage4.isAtLimit, false);
      assert.strictEqual(usage4.canAddMember, true);
      assert.strictEqual(usage4.availableSeats, 1);
    });

    it('team plan: 5 active seats reaches capacity and prevents adding members', () => {
      const usage5 = computeSeatUsage('team', 5);
      assert.strictEqual(usage5.activeSeats, 5);
      assert.strictEqual(usage5.seatLimit, 5);
      assert.strictEqual(usage5.isAtLimit, true);
      assert.strictEqual(usage5.canAddMember, false);
      assert.strictEqual(usage5.availableSeats, 0);
    });

    it('team plan: over-capacity seats (> 5) flags isAtLimit and prevents adding members', () => {
      const usageOver = computeSeatUsage('team', 6);
      assert.strictEqual(usageOver.activeSeats, 6);
      assert.strictEqual(usageOver.isAtLimit, true);
      assert.strictEqual(usageOver.canAddMember, false);
      assert.strictEqual(usageOver.availableSeats, 0);
    });

    it('internal plan: unlimited seats always allows adding members', () => {
      const usage = computeSeatUsage('internal', 42);
      assert.strictEqual(usage.activeSeats, 42);
      assert.strictEqual(usage.seatLimit, null);
      assert.strictEqual(usage.isUnlimited, true);
      assert.strictEqual(usage.isAtLimit, false);
      assert.strictEqual(usage.canAddMember, true);
      assert.strictEqual(usage.availableSeats, null);
    });
  });

  describe('4. Active Seat Definition (Owner + Active Members)', () => {
    it('correctly counts active seats excluding deactivated/inactive members', () => {
      const members: Partial<WorkspaceMemberDoc>[] = [
        { uid: 'owner_1', role: 'owner', active: true },
        { uid: 'editor_1', role: 'editor', active: true },
        { uid: 'viewer_1', role: 'viewer', active: false }, // Inactive does NOT occupy seat
        { uid: 'editor_2', role: 'editor', active: true },
      ];

      const activeCount = countActiveSeats(members);
      assert.strictEqual(activeCount, 3);

      const usage = computeSeatUsage('team', activeCount);
      assert.strictEqual(usage.activeSeats, 3);
      assert.strictEqual(usage.canAddMember, true);
      assert.strictEqual(usage.availableSeats, 2);
    });
  });

  describe('5. Entitlement Service Plan Integration & hasFullEntitlement', () => {
    it('evaluates active solo subscription as hasFullEntitlement: true', () => {
      const evalResult = EntitlementService.evaluate({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        workspaceId: 'ws-solo-user',
        billingDoc: {
          planId: 'solo',
          subscriptionStatus: 'active',
          entitlementStatus: 'active',
          trialStartedAt: null,
          trialEndsAt: null,
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          stripePriceId: 'price_solo',
          seatLimit: 1,
          activeSeatCount: 1,
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          billingUpdatedAt: new Date().toISOString(),
          billingSource: 'stripe',
        },
      });

      assert.strictEqual(evalResult.canAccessApp, true);
      assert.strictEqual(evalResult.hasFullEntitlement, true);
      assert.strictEqual(evalResult.planId, 'solo');
      assert.strictEqual(evalResult.seatLimit, 1);
    });

    it('evaluates active team subscription as hasFullEntitlement: true with seatLimit 5', () => {
      const evalResult = EntitlementService.evaluate({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        workspaceId: 'ws-team-user',
        billingDoc: {
          planId: 'team',
          subscriptionStatus: 'active',
          entitlementStatus: 'active',
          trialStartedAt: null,
          trialEndsAt: null,
          stripeCustomerId: 'cus_2',
          stripeSubscriptionId: 'sub_2',
          stripePriceId: 'price_team',
          seatLimit: 5,
          activeSeatCount: 3,
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          billingUpdatedAt: new Date().toISOString(),
          billingSource: 'stripe',
        },
      });

      assert.strictEqual(evalResult.canAccessApp, true);
      assert.strictEqual(evalResult.hasFullEntitlement, true);
      assert.strictEqual(evalResult.planId, 'team');
      assert.strictEqual(evalResult.seatLimit, 5);
    });

    it('strategic partner complimentary access receives team plan with 5 seats and hasFullEntitlement: true', () => {
      const evalResult = EntitlementService.evaluate({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        workspaceId: 'ws-partner-bakery',
        billingDoc: {
          planId: 'team',
          subscriptionStatus: 'complimentary',
          entitlementStatus: 'active',
          trialStartedAt: null,
          trialEndsAt: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          seatLimit: 5,
          activeSeatCount: 2,
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: null,
          billingUpdatedAt: new Date().toISOString(),
          billingSource: 'strategic_partner',
          complimentaryAccess: true,
          complimentaryStartedAt: new Date().toISOString(),
          complimentaryExpiresAt: null,
          complimentaryReason: 'Strategic Chef Partnership',
          strategicPartnerType: 'chef',
          grantedBy: 'admin-system',
          strategicPartner: true,
        },
      });

      assert.strictEqual(evalResult.accessState, 'COMPLIMENTARY_ACTIVE');
      assert.strictEqual(evalResult.canAccessApp, true);
      assert.strictEqual(evalResult.hasFullEntitlement, true);
      assert.strictEqual(evalResult.planId, 'team');
      assert.strictEqual(evalResult.seatLimit, 5);
    });
  });

  describe('6. Fail-Closed Active Seat Calculations', () => {
    it('treats missing, null, undefined, or string active states as inactive', () => {
      const malformedMembers: Partial<WorkspaceMemberDoc>[] = [
        { uid: 'm1', role: 'owner', active: true }, // valid
        { uid: 'm2', role: 'editor' }, // missing active -> false
        { uid: 'm3', role: 'viewer', active: undefined }, // undefined -> false
        { uid: 'm4', role: 'editor', active: null as any }, // null -> false
        { uid: 'm5', role: 'viewer', active: 'true' as any }, // string -> false
        { uid: 'm6', role: 'viewer', active: 1 as any }, // number -> false
        { uid: 'm7', role: 'guest' as any, active: true }, // invalid role -> false
      ];

      assert.strictEqual(isActiveSeatMember(malformedMembers[0]), true);
      assert.strictEqual(isActiveSeatMember(malformedMembers[1]), false);
      assert.strictEqual(isActiveSeatMember(malformedMembers[2]), false);
      assert.strictEqual(isActiveSeatMember(malformedMembers[3]), false);
      assert.strictEqual(isActiveSeatMember(malformedMembers[4]), false);
      assert.strictEqual(isActiveSeatMember(malformedMembers[5]), false);
      assert.strictEqual(isActiveSeatMember(malformedMembers[6]), false);

      const count = countActiveSeats(malformedMembers);
      assert.strictEqual(count, 1, 'Only strictly active member with recognized role counts as 1 seat');
    });

    it('returns 0 when member array is empty without defaulting or masking', () => {
      assert.strictEqual(countActiveSeats([]), 0);
      assert.strictEqual(countActiveSeats(null as any), 0);
      assert.strictEqual(countActiveSeats(undefined as any), 0);
    });
  });

  describe('7. Authoritative Owner Membership Integrity', () => {
    it('passes integrity when owner document exists with role owner and active true', () => {
      const members: Partial<WorkspaceMemberDoc>[] = [
        { uid: 'owner_abc', role: 'owner', active: true },
        { uid: 'editor_1', role: 'editor', active: true },
      ];

      const result = checkOwnerMembershipIntegrity(members, 'owner_abc');
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.ownerUid, 'owner_abc');
      assert.strictEqual(result.isOwnerActive, true);
      assert.strictEqual(result.isOwnerRoleValid, true);
      assert.strictEqual(result.issue, undefined);
    });

    it('detects missing owner document as integrity violation', () => {
      const members: Partial<WorkspaceMemberDoc>[] = [
        { uid: 'editor_1', role: 'editor', active: true },
      ];

      const result = checkOwnerMembershipIntegrity(members, 'owner_abc');
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.ownerFound, false);
      assert.ok(result.issue?.includes('not found'));
    });

    it('detects inactive owner document as integrity violation', () => {
      const members: Partial<WorkspaceMemberDoc>[] = [
        { uid: 'owner_abc', role: 'owner', active: false },
      ];

      const result = checkOwnerMembershipIntegrity(members, 'owner_abc');
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.ownerFound, true);
      assert.strictEqual(result.isOwnerActive, false);
      assert.ok(result.issue?.includes('inactive'));
    });

    it('detects mismatched owner role as integrity violation', () => {
      const members: Partial<WorkspaceMemberDoc>[] = [
        { uid: 'owner_abc', role: 'viewer', active: true },
      ];

      const result = checkOwnerMembershipIntegrity(members, 'owner_abc');
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.ownerFound, true);
      assert.strictEqual(result.isOwnerRoleValid, false);
      assert.ok(result.issue?.includes('invalid role'));
    });
  });

  describe('8. Canonical Billing State Encodings', () => {
    it('validates Paid Solo state representation', () => {
      const evalResult = EntitlementService.evaluate({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        workspaceId: 'ws-solo',
        billingDoc: {
          planId: 'solo',
          subscriptionStatus: 'active',
          entitlementStatus: 'active',
          billingSource: 'stripe',
          seatLimit: 1,
          activeSeatCount: 1,
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          stripePriceId: 'price_1',
          trialStartedAt: null,
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          billingUpdatedAt: new Date().toISOString(),
        },
      });

      assert.strictEqual(evalResult.accessState, 'SUBSCRIPTION_ACTIVE');
      assert.strictEqual(evalResult.planId, 'solo');
      assert.strictEqual(evalResult.hasFullEntitlement, true);
    });

    it('validates Strategic Partner state representation', () => {
      const evalResult = EntitlementService.evaluate({
        isAuthenticated: true,
        hasWorkspaceMembership: true,
        workspaceId: 'ws-partner',
        billingDoc: {
          planId: 'team',
          subscriptionStatus: 'complimentary',
          entitlementStatus: 'active',
          billingSource: 'strategic_partner',
          strategicPartner: true,
          strategicPartnerType: 'chef',
          complimentaryAccess: true,
          seatLimit: 5,
          activeSeatCount: 2,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
          trialStartedAt: null,
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: null,
          billingUpdatedAt: new Date().toISOString(),
        },
      });

      assert.strictEqual(evalResult.accessState, 'COMPLIMENTARY_ACTIVE');
      assert.strictEqual(evalResult.planId, 'team');
      assert.strictEqual(evalResult.hasFullEntitlement, true);
      assert.strictEqual(evalResult.seatLimit, 5);
    });
  });
});
