import { describe, expect, it } from "vitest";
import { can, canAssignRole, canWorkTask, departmentOf, PERMISSIONS, ROLES, type Permission } from "../app/lib/permissions";

const who = (p: Permission) => ROLES.filter((r) => can(r, p));

describe("can", () => {
  it("only Finance and admins approve contributions, set dues and see any receipt", () => {
    expect(who("contribution:review")).toEqual(["finance", "admin"]);
    expect(who("dues:set")).toEqual(["finance", "admin"]);
    expect(who("receipt:view_any")).toEqual(["finance", "admin"]);
  });
  it("the leader sees finance but cannot approve payments", () => {
    expect(can("leader", "finance:view")).toBe(true);
    expect(can("leader", "contribution:review")).toBe(false);
  });
  it("only leader and admin read feedback and assign tasks", () => {
    expect(who("feedback:read")).toEqual(["leader", "admin"]);
    expect(who("task:assign")).toEqual(["leader", "admin"]);
  });
  it("preparation manages events and programs", () => {
    expect(can("preparation", "event:manage")).toBe(true);
    expect(can("preparation", "program:manage")).toBe(true);
    expect(can("songs", "event:manage")).toBe(false);
  });
  it("only leader, preparation and admin manage event photos", () => {
    expect(who("photo:manage")).toEqual(["preparation", "leader", "admin"]);
  });
  it("gives plain members no protected permission", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(can("member", p)).toBe(false);
  });
  it("denies unknown roles", () => {
    expect(can("superuser", "finance:view")).toBe(false);
    expect(can(undefined, "finance:view")).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("a leader assigns department roles", () => {
    expect(canAssignRole("leader", "member", "finance")).toBe(true);
    expect(canAssignRole("leader", "songs", "member")).toBe(true);
  });
  it("a leader cannot create or demote leaders/admins", () => {
    expect(canAssignRole("leader", "member", "leader")).toBe(false);
    expect(canAssignRole("leader", "member", "admin")).toBe(false);
    expect(canAssignRole("leader", "leader", "member")).toBe(false);
    expect(canAssignRole("leader", "admin", "member")).toBe(false);
  });
  it("only admins can do everything; others nothing", () => {
    expect(canAssignRole("admin", "member", "leader")).toBe(true);
    expect(canAssignRole("finance", "member", "songs")).toBe(false);
  });
});

describe("tasks", () => {
  it("a department works only its own tasks", () => {
    expect(departmentOf("members_coordinator")).toBe("members");
    expect(canWorkTask("songs", "songs")).toBe(true);
    expect(canWorkTask("songs", "finance")).toBe(false);
    expect(canWorkTask("leader", "finance")).toBe(true);
    expect(canWorkTask("member", "songs")).toBe(false);
  });
});
