/**
 * Who may do what. Every protected loader/action calls requirePermission()
 * (session.server.ts), which uses can(). Covered by tests/permissions.test.ts.
 *
 * Service departments and their leader roles:
 *   members (members_coordinator) · finance · songs · property · preparation (ዝግጅት) · education (አለማዊ ትምህርት)
 * leader coordinates all departments; admin is the technical owner.
 */
export const ROLES = [
  "member",
  "members_coordinator",
  "finance",
  "songs",
  "property",
  "preparation",
  "education",
  "leader",
  "admin",
] as const;
export type Role = (typeof ROLES)[number];

export const SERVICE_DEPARTMENTS = ["members", "finance", "songs", "property", "preparation", "education"] as const;
export type ServiceDepartment = (typeof SERVICE_DEPARTMENTS)[number];

/** Which service department a role leads (null for member, leader, admin). */
export function departmentOf(role: Role): ServiceDepartment | null {
  switch (role) {
    case "members_coordinator":
      return "members";
    case "finance":
    case "songs":
    case "property":
    case "preparation":
    case "education":
      return role;
    default:
      return null;
  }
}

export const PERMISSIONS = {
  "registration:review": ["admin", "leader", "members_coordinator"],
  "member:list": ["admin", "leader", "members_coordinator", "finance"],
  "role:assign": ["admin", "leader"],
  "contribution:review": ["admin", "finance"],
  "finance:view": ["admin", "leader", "finance"],
  "dues:set": ["admin", "finance"],
  "receipt:view_any": ["admin", "finance"],
  "event:manage": ["admin", "leader", "preparation"],
  "program:manage": ["admin", "leader", "preparation"],
  "task:assign": ["admin", "leader"],
  "task:view": ["admin", "leader", "members_coordinator", "finance", "songs", "property", "preparation", "education"],
  "feedback:read": ["admin", "leader"],
  "song:manage": ["admin", "leader", "songs"],
  "property:manage": ["admin", "leader", "property"],
  "education:manage": ["admin", "leader", "education"],
  "photo:manage": ["admin", "leader", "preparation"],
  "ledger:write": ["admin", "finance"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: unknown, permission: Permission): boolean {
  if (!isRole(role)) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/**
 * Leaders hand out department roles but can't create leaders/admins or change
 * a leader's/admin's role. Only admins can.
 */
export function canAssignRole(actor: Role, targetCurrent: Role, next: Role): boolean {
  if (actor === "admin") return true;
  if (actor !== "leader") return false;
  const protectedRoles: Role[] = ["leader", "admin"];
  return !protectedRoles.includes(targetCurrent) && !protectedRoles.includes(next);
}

/** May this role mark a task for that department as done? */
export function canWorkTask(role: Role, department: ServiceDepartment): boolean {
  return role === "admin" || role === "leader" || departmentOf(role) === department;
}

/**
 * Forgotten password: the member coordinator (or leader/admin) clears it, and the member sets a
 * new one after signing in through Telegram. Only an admin can reset a leader's or admin's.
 */
export function canResetPassword(actor: Role, target: Role): boolean {
  if (!can(actor, "registration:review")) return false;
  if (actor === "admin") return true;
  return target !== "leader" && target !== "admin";
}
