# Sunny Sweets — Phase 2: Workspace Feature Architecture & Future Module Integration

## 1. Executive Summary & Design Principles

The Sunny Sweets Recipe Calculator is evolving from a single-tenant internal production tool into a multi-tenant commercial SaaS platform while continuing to serve as the core operating system for Sunny Sweets' commercial bakery operations (`ws-main`).

To support advanced bakery operations (such as Inventory Control and Commercial Label Printing) without introducing fragile, hard-coded checks or fragmenting the codebase, Phase 2 establishes a clean, decoupled **Workspace Capability Architecture**.

### Core Invariants
1. **Zero Hardcoded Workspace Checks in UI**: The application must never rely on constructs such as `if (workspaceId === 'ws-main') showInventory()`. Features are evaluated exclusively against authoritative workspace capability configurations.
2. **Tripartite Separation of Concerns**:
   - **Subscription Access Entitlement**: Does this workspace have valid access to the SaaS product? (Evaluated by `EntitlementService` and `billing/current`).
   - **Workspace Feature Capabilities**: What functional modules is this workspace equipped with? (Evaluated by `WorkspaceFeatures` and `workspaceFeatures.ts`).
   - **User Role Permissions**: What actions can the current user execute within an enabled module? (Evaluated by `AccessRole`: Owner, Editor, Viewer).
3. **Strict Non-Elevation of Permissions**: Enabling an advanced module (e.g. Inventory) on a workspace **never** elevates a Viewer's permissions. Viewers remain strictly read-only; Editors can execute operational tasks; Owners can configure settings and permissions.
4. **Authoritative Backward Compatibility**: Workspaces created prior to Phase 2 (or documents without a `features` map) safely inherit the authoritative default matrix (`DEFAULT_WORKSPACE_FEATURES`). No existing data or feature access is lost.
5. **Operational Layering of Production Floor Mode**: Production Floor Mode is modeled as an operational setting (`productionFloorModeEnabled`) layered on top of the `productionFloor` capability. If the capability is disabled, Floor Mode is deactivated; if enabled, the operator's toggle takes effect.

---

## 2. Workspace Feature Capability Model

### 2.1 Interface Definition (`src/types/index.ts`)

```typescript
export interface WorkspaceFeatures {
  // Core Modules (Included by default for all workspaces)
  recipeManagement: boolean;
  productionFloor: boolean;
  costing: boolean;

  // Private / Operational Modules (Internal to Sunny Sweets & future enterprise tiers)
  inventoryManagement: boolean;
  labelPrinting: boolean;

  // Future extensibility index
  [key: string]: boolean | undefined;
}
```

### 2.2 Authoritative Defaults & Resolution (`src/services/workspaceFeatures.ts`)

```typescript
export const DEFAULT_WORKSPACE_FEATURES: Readonly<WorkspaceFeatures> = Object.freeze({
  recipeManagement: true,
  productionFloor: true,
  costing: true,
  inventoryManagement: false,
  labelPrinting: false,
});
```

When evaluating a workspace document:
- If `workspace.features` is undefined, `resolveWorkspaceFeatures` returns `DEFAULT_WORKSPACE_FEATURES`.
- If `workspace.features` contains overrides (e.g. `{ inventoryManagement: true }`), stored values are merged over the defaults.
- This ensures new feature flags can be added to the registry in future versions without requiring database migration scripts across historical customer documents.

### 2.3 Role Enforcement Layer

| Action | Owner | Editor | Viewer |
| :--- | :---: | :---: | :---: |
| **View Enabled Module** | Allowed | Allowed | Allowed |
| **Execute Operations (Create/Edit/Log)** | Allowed | Allowed | **Denied** (Read-Only) |
| **Configure Module Settings / Toggle Capabilities** | Allowed | **Denied** | **Denied** |

Evaluated authoritatively via `canUserAccessFeature(workspace, role, featureKey, action)`.

---

## 3. Future Inventory Integration Design (Design Specification)

### 3.1 Business Objective
Connect bakery production calculations directly to pantry stock levels to automate deduction of raw ingredients upon batch completion, track lot usage, and alert managers when reorder points are reached.

### 3.2 Authoritative Integration Boundary

```
[Master Ingredients / Pantry]
        │
        ▼ (masterIngredientId linking)
[Recipe Ingredients / Formulation]
        │
        ▼ (ProductionCalculator scaling + waste factor)
[Calculated Batch Production Requirement]
        │
        ▼ (Staff marks batch "Completed" / Saves Production Run)
[Production History Entry]
        │
        ▼ (Atomic Transaction / Batch Write)
[Inventory Consumption Event] ──► Deduct from [Inventory Stock Items / Lots]
```

### 3.3 Key Architectural Rules
1. **Never Duplicate the Calculation Engine**:
   - The Inventory module must **not** re-implement batch scaling, unit conversion, or waste multipliers.
   - It consumes the exact outputs already computed by `calculateProduction()` in `src/utils/calculator.ts`.
2. **Link via `masterIngredientId`**:
   - Only recipe ingredient lines that are linked to a `masterIngredientId` can deduct from inventory.
   - Unlinked lines are logged in the batch deduction audit trail as "Unlinked / Manual Deduction Required" without blocking the rest of the batch deduction.
3. **Standardized Units of Measurement**:
   - Master Ingredients define an authoritative base unit (e.g., `kg`, `g`, `lb`, `oz`).
   - Recipe ingredients in differing units are converted to the Master Ingredient base unit using the authoritative conversion routines in `src/utils/units.ts`.
4. **Idempotent Inventory Deductions**:
   - Every production run generates a unique `productionHistoryId`.
   - Inventory consumption records store `productionRunId`.
   - Before applying deductions, the system verifies whether an inventory transaction already exists for that run ID to prevent accidental double-deductions if a network retry occurs.
5. **Zero-Trust Role Check**:
   - Only `owner` and `editor` roles can record production consumption.
   - Viewers can inspect inventory stock levels and history logs but cannot adjust counts or record consumption.

---

## 4. Future Commercial Label Printing Design (Design Specification)

### 4.1 Business Objective
Generate and print commercial FDA-compliant product labels, outer carton case labels, and batch date/lot code stickers directly from recipe batch scaling and master ingredient allergen data.

### 4.2 Architectural Flow

```
[Master Ingredients] (Allergen declarations: Milk, Eggs, Wheat, Nuts, Soy)
        │
        ▼
[Recipe Formulation] (Finished product weight, unit yield, ingredient list descending by weight)
        │
        ▼
[Production Run / Preset] (Finished item preset, packaging type, shelf-life days)
        │
        ▼
[Label Template Engine] (Client-side vector/HTML-Canvas/ZPL rendering)
        │
        ├─► PDF / Browser Print (Standard Sheet Labels e.g., Avery 5160/5163)
        └─► Direct Thermal Print (Zebra/Brother 4x6" and 2x1" continuous rolls)
```

### 4.3 Key Architectural Rules
1. **Authoritative Allergen Aggregation**:
   - Allergen statements ("Contains: Wheat, Milk, Eggs") are computed deterministically from the linked `MasterIngredient` records of all recipe ingredients.
2. **Descending Weight Ingredient Declaration**:
   - In accordance with food labeling standards, the ingredient statement lists ingredients ordered by scaled batch weight in descending order.
   - Sub-recipes or compounded ingredients are expanded cleanly into sub-declarations.
3. **Lot & Expiration Calculation**:
   - Lot codes are deterministically generated from `YYYYMMDD-RecipeId-BatchNum`.
   - Expiration / Best-By dates are calculated by adding `shelfLifeDays` (stored on the `ProductionPreset` or `Recipe`) to the production batch date.
4. **Extensible Template Architecture**:
   - Templates are registered as declarative JSON schema layouts (specifying label dimensions, barcode/QR placements, typography, and ingredient box bounding boxes).
   - Templates operate identically whether printed to an industrial thermal label printer (ZPL stream) or exported to standard PDF label sheets.

---

## 5. Backward Compatibility & Non-Regression Invariants

1. **Existing Workspaces**: Any existing workspace in Firestore without the `features` property evaluates to the default feature set (`recipeManagement: true`, `productionFloor: true`, `costing: true`, `inventoryManagement: false`, `labelPrinting: false`).
2. **Sunny Sweets Operational Workspace (`ws-main`)**:
   - Maintains full access to all existing features without interruption.
   - Can have `inventoryManagement: true` and `labelPrinting: true` toggled via the Owner Capabilities settings card or programmatically without modifying code.
3. **Calculation Invariance**: No changes were made to calculation formulas, rounding logic, tare weights, mixer limits, or unit conversions.
4. **Subscription Entitlement Separation**: Entitlement evaluation continues to verify subscription health via `EntitlementService`. Workspace capability configuration only determines which modules are active within an entitled workspace.
