import { describe, expect, it } from "vitest";
import {
  getAllowedPermissionKeysForRole,
  getDefaultPermissionsForRole,
  getLockedPermissionKeysForRole,
  getPermissionPreset,
  normalizeManagerPermissions,
  normalizeManagerPermissionsForRole,
  PERMISSION_KEYS,
} from "@/lib/permission-catalog";
import { hasPermission, type Session } from "@/lib/permissions";

describe("permission-catalog", () => {
  it("returns stable defaults for manager, employee, and facility", () => {
    const managerDefaults = getDefaultPermissionsForRole("MANAGER");
    const employeeDefaults = getDefaultPermissionsForRole("EMPLOYEE");
    const facilityDefaults = getDefaultPermissionsForRole("FACILITY");

    expect(managerDefaults.view_beneficiaries).toBe(true);
    expect(managerDefaults.deduct_balance).toBe(true);
    expect(managerDefaults.view_dashboard).toBe(true);
    expect(managerDefaults.view_transactions).toBe(true);
    expect(managerDefaults.view_dental_beneficiaries).toBe(true);
    expect(managerDefaults.cash_claim).toBe(false);

    expect(employeeDefaults.view_beneficiaries).toBe(true);
    expect(employeeDefaults.view_facilities).toBe(true);
    expect(employeeDefaults.cash_claim).toBe(true);
    expect(employeeDefaults.view_dashboard).toBe(true);
    expect(employeeDefaults.view_transactions).toBe(true);
    expect(employeeDefaults.view_dental_beneficiaries).toBe(true);
    expect(employeeDefaults.deduct_balance).toBe(false);

    expect(facilityDefaults.view_dashboard).toBe(true);
    expect(facilityDefaults.view_transactions).toBe(true);
    expect(facilityDefaults.view_beneficiaries).toBe(false);
    expect(facilityDefaults.deduct_balance).toBe(true);
    expect(facilityDefaults.dental_services).toBe(true);
    expect(facilityDefaults.view_dental_beneficiaries).toBe(false);
  });

  it("normalizes string/number permission values and applies fallback", () => {
    const fallback = getDefaultPermissionsForRole("MANAGER");
    const normalized = normalizeManagerPermissions(
      {
        view_transactions: "true",
        export_data: "true",
        manage_users: 1,
        deduct_balance: 0,
      },
      fallback,
    );

    expect(normalized.view_transactions).toBe(true);
    expect(normalized.export_data).toBe(true);
    expect(normalized.manage_users).toBe(true);
    expect(normalized.deduct_balance).toBe(false);
    expect(normalized.view_beneficiaries).toBe(true);
  });

  it("ensures presets produce full key coverage", () => {
    const preset = getPermissionPreset("employee_cash");
    for (const key of PERMISSION_KEYS) {
      expect(typeof preset[key]).toBe("boolean");
    }
  });

  it("enforces role policy by locking disallowed keys", () => {
    const employeeAllowed = getAllowedPermissionKeysForRole("EMPLOYEE");
    const employeeLocked = getLockedPermissionKeysForRole("EMPLOYEE");
    expect(employeeAllowed).toContain("cash_claim");
    expect(employeeLocked).toContain("manage_users");

    const normalized = normalizeManagerPermissionsForRole(
      "EMPLOYEE",
      {
        cash_claim: "true",
        manage_users: "true",
      },
      getDefaultPermissionsForRole("EMPLOYEE"),
    );

    expect(normalized.cash_claim).toBe(true);
    expect(normalized.manage_users).toBe(false);
    expect(normalized.view_transactions).toBe(true);
  });

  it("applies role policy to full-access presets", () => {
    const employeeFull = getPermissionPreset("full_access", "EMPLOYEE");
    expect(employeeFull.manage_users).toBe(false);
    expect(employeeFull.manage_companies).toBe(false);
    expect(employeeFull.cash_claim).toBe(true);
    expect(employeeFull.view_transactions).toBe(true);
  });
});

describe("hasPermission", () => {
  function makeSession(partial: Partial<Session>): Session {
    return {
      id: "s1",
      name: "test",
      username: "test",
      role: "FACILITY",
      is_admin: false,
      is_manager: false,
      is_employee: false,
      manager_permissions: null,
      must_change_password: false,
      ...partial,
    };
  }

  it("always grants ADMIN", () => {
    const session = makeSession({ role: "ADMIN" });
    expect(hasPermission(session, "manage_users")).toBe(true);
    expect(hasPermission(session, "manage_companies")).toBe(true);
  });

  it("grants manager permission from serialized JSON safely", () => {
    const session = makeSession({
      role: "MANAGER",
      manager_permissions: "{\"export_data\":\"true\"}" as unknown as Session["manager_permissions"],
    });
    expect(hasPermission(session, "export_data")).toBe(true);
    expect(hasPermission(session, "manage_users")).toBe(false);
  });

  it("applies facility role policy in permission checks", () => {
    const session = makeSession({
      role: "FACILITY",
      manager_permissions: {
        dental_services: true,
        manage_users: true,
      } as unknown as Session["manager_permissions"],
    });
    expect(hasPermission(session, "dental_services")).toBe(true);
    expect(hasPermission(session, "manage_users")).toBe(false);
  });
});
