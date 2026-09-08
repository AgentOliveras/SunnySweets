# Security Hardening Specification (Phase 0)
## Zero-Trust Workspace Access & Proprietary Recipe Data Protection

**Project:** Recipe Calculator / Sunny Sweets Production Suite  
**Application ID:** `a07b62a4-391e-4c68-9b98-bf241a874e92`  
**Firebase Project:** `imposing-router-d3bk6`  
**Database ID:** `ai-studio-a07b62a4-391e-4c68-9b98-bf241a874e92`  
**Security Posture:** Zero-Trust (Strict RBAC, Tenant Isolation, No Anonymous Access)

---

## 1. Executive Summary & Threat Model

Sunny Sweets proprietary baking recipes, scaling formulas, mixer configurations, ingredient master lists, and production history represent confidential intellectual property. 

The previous configuration permitted global read/write operations (`allow read, write: if true;`) and relied on anonymous client-side sessions (`ensureAnonymousAuth`). This exposed the database to:
1. **Unauthenticated Public Scraping & Intellectual Property Theft:** Any anonymous visitor or external script could read proprietary recipe formulas and bakery secrets.
2. **Data Tampering & Malicious Injection:** Any unauthenticated client could overwrite, delete, or poison recipes, ingredient quantities, and batch records.
3. **Cross-Tenant Leakage:** Absence of workspace scoping allowed arbitrary document queries across organizations.
4. **Client-Side Impersonation:** Client-side email matching allowed any user to claim administrative roles simply by entering an email in the browser.

### Objectives of Phase 0 Hardening
- **Deprecate Anonymous Access:** Remove all anonymous auth mechanisms (`ensureAnonymousAuth`, `signInAnonymously`). Google Sign-In with verified accounts is the sole authentication mechanism.
- **Hierarchical Zero-Trust Membership Model:** Enforce access control via Firestore subcollections: `/workspaces/{workspaceId}/members/{uid}`, checked server-side via `exists()` and `get()` security rule functions.
- **Workspace-Scoped Data Partitioning:** Bind all recipes, presets, mixers, master ingredients, and production history to `workspaceId`.
- **Non-Destructive Migration:** Protect existing production data in `ws-main` without deleting, overwriting, reseeding, or altering calculation formulas or ingredient quantities.
- **Zero-Trust Rule Deployment:** Deploy immutable rules locking down all document reads and writes.

---

## 2. Data Invariants

1. **Authentication Mandatory (Invariant A1):**
   No unauthenticated request (`request.auth == null`) shall ever read or write any collection in the database.
2. **Tenant Scoping (Invariant A2):**
   Every operational entity (`recipes`, `presets`, `mixers`, `history`, `master_ingredients`) must contain an immutable `workspaceId` string referencing an existing workspace.
3. **Membership Authorization (Invariant A3):**
   A user can only read an operational document if they exist as a confirmed member document in `/workspaces/{workspaceId}/members/{request.auth.uid}`.
4. **Role Enforcement (Invariant A4):**
   - **Viewer:** `role == 'viewer'` grants read-only access to operational documents within their workspace. All writes, updates, and deletes are denied.
   - **Editor:** `role in ['editor', 'owner']` grants read, create, update, and delete access to operational documents within their workspace.
   - **Owner:** `role == 'owner'` grants exclusive control over workspace settings, join codes, and member management in `/workspaces/{workspaceId}/members/{memberUid}`.
5. **User Settings Isolation (Invariant A5):**
   Documents in `/settings/{userId}` can only be read and written by the authenticated user whose `request.auth.uid == userId`.
6. **Workspace ID Immutability (Invariant A6):**
   Once a document is created with a `workspaceId`, that `workspaceId` cannot be modified or transferred to another workspace (`request.resource.data.workspaceId == resource.data.workspaceId`).
7. **Document Integrity (Invariant A7):**
   Existing recipe document IDs, batch calculations, ingredients, and quantities must remain unaltered during migration.

---

## 3. The "Dirty Dozen" Security Attack Payloads & Test Scenarios

These 12 test payloads represent malicious or unauthorized operations that must be strictly rejected (`PERMISSION_DENIED`) by the security layer:

| # | Attack Vector / Payload | Actor / Context | Target Resource & Operation | Expected Result |
|---|---|---|---|---|
| **P01** | Anonymous Public Read | Unauthenticated (`request.auth = null`) | `GET /recipes/sunny-butter-cookies` | **DENY (403)** |
| **P02** | Anonymous Recipe Injection | Unauthenticated (`request.auth = null`) | `CREATE /recipes/malicious-recipe` | **DENY (403)** |
| **P03** | Cross-Workspace Snoop | User in `ws-bakery-b` (`uid: "user-b"`) | `GET /recipes/{id}` with `workspaceId: "ws-main"` | **DENY (403)** |
| **P04** | Cross-Workspace Injection | User in `ws-bakery-b` (`uid: "user-b"`) | `CREATE /recipes/{id}` with `workspaceId: "ws-main"` | **DENY (403)** |
| **P05** | Viewer Privilege Escalation | User with `role: "viewer"` in `ws-main` | `CREATE /recipes/new-cookie` | **DENY (403)** |
| **P06** | Unauthorized Deletion | User with `role: "viewer"` in `ws-main` | `DELETE /recipes/proprietary-recipe-1` | **DENY (403)** |
| **P07** | Workspace Hijack / Owner Promotion | User with `role: "editor"` in `ws-main` | `UPDATE /workspaces/ws-main/members/{uid}` setting `role: "owner"` | **DENY (403)** |
| **P08** | Non-Member Member Injection | Non-member user (`uid: "stranger"`) | `CREATE /workspaces/ws-main/members/stranger` with `role: "owner"` | **DENY (403)** |
| **P09** | Missing Workspace ID Injection | Authenticated editor in `ws-main` | `CREATE /recipes/no-ws` with omitted or empty `workspaceId` | **DENY (403)** |
| **P10** | Workspace Reparenting / Hijack | Authenticated editor in `ws-main` | `UPDATE /recipes/rec-1` mutating `workspaceId` to `"ws-hacked"` | **DENY (403)** |
| **P11** | Cross-User Settings Tampering | User A (`uid: "user-a"`) | `WRITE /settings/user-b` (tampering with another user's preferences) | **DENY (403)** |
| **P12** | Arbitrary Collection Breach | Authenticated user | `GET /admin_credentials/keys` or `GET /random_collection/doc` | **DENY (403)** |

---

## 4. Test Runner Structure (`src/utils/firestore.rules.test.ts`)

A dedicated security test suite executes and validates each of the Dirty Dozen scenarios against security invariants and access policies, providing automated verification of Zero-Trust enforcement.
