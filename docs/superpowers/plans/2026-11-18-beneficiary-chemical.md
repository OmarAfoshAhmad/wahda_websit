# Beneficiary Chemical Eligibility Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let administration independently enable or disable chemical medicines for a beneficiary.

**Architecture:** Add a default-false Beneficiary boolean, an audited and company-scoped administrative server action, and a one-click control in the pharmacy beneficiary list. Enforce eligibility during prescription creation and final dispensing under the beneficiary lock. Usage summaries and pharmacy tabs reflect eligibility.

**Tech Stack:** Next.js 16, React 19, Prisma 6, PostgreSQL, Vitest.

**Spec:** ../specs/2026-11-18-beneficiary-chemical-design.md

## Global Constraints
- Administration only, with edit_beneficiary permission and company scope.
- Default off; policy ceilings and company enablement remain mandatory.
- Preserve existing dispensing history and portal category exclusions.

## Review Focus
- Changing one member must leave family members untouched.
- Read-only staff and pharmacies cannot change eligibility.
- An open prescription cannot bypass a later disable.
- An enabled member cannot bypass company policy.
- Failed requests must show an error without displaying a saved state.

### Task 1: Eligibility storage and administration
- [x] Add failing action tests for authorization, scope, independent update and audit.
- [x] Add boolean and additive SQL migration; generate Prisma client.
- [x] Implement setBeneficiaryChemicalEnabled(beneficiaryId: string, enabled: boolean) with fresh permissions, company scope, beneficiary locking and audit.
- [x] Expose list state and add per-member control with pending/error states.
- [x] Run action tests.

### Task 2: Dispensing enforcement
- [x] Add failing prescription tests for disabled and enabled beneficiaries.
- [x] Enforce eligibility under lock during creation and final dispensing; reflect it in summary and workspace.
- [x] Reject chemical portal requests consistent with existing portal UI.
- [x] Run focused pharmacy tests, typecheck, lint, Prisma validation, and review the diff.

## Execution ledger
Approved execution continued inline in the supplied workspace. No merge, deployment, or database reset is part of this work.

Verification: 35 tests passed across 7 files (including 10 real-database integration tests and 2 UI tests). Prisma validation, targeted ESLint and diff checks passed. Independent review found no critical or important issues. Additive migration applied to local test database. No deployment performed.

