import { describe, expect, it } from "vitest";
import { countBy, matchesSearch, paymentBreakdown, pickParam } from "../app/lib/dashboard";

describe("paymentBreakdown", () => {
  it("splits by department and student/graduate", () => {
    const b = paymentBreakdown([
      { department: "cs", kind: "student", status: "approved" },
      { department: "cs", kind: "student", status: "unpaid" },
      { department: "cs", kind: "graduate", status: "pending" },
      { department: "ee", kind: "graduate", status: "approved" },
    ]);
    expect(b.table.cs.student).toEqual({ members: 2, paid: 1, pending: 0, unpaid: 1 });
    expect(b.table.cs.graduate).toEqual({ members: 1, paid: 0, pending: 1, unpaid: 0 });
    expect(b.table.it.student.members).toBe(0);
    expect(b.total).toEqual({ members: 4, paid: 2, pending: 1, unpaid: 1 });
  });
});

describe("filters", () => {
  it("counts rows per key for the filter buttons", () => {
    expect(countBy([{ d: "cs" }, { d: "cs" }, { d: "ee" }], ["cs", "it", "ee"] as const, (r) => r.d)).toEqual({ all: 3, cs: 2, it: 0, ee: 1 });
  });
  it("accepts only known filter values", () => {
    expect(pickParam("cs", ["cs", "it"] as const)).toBe("cs");
    expect(pickParam("law", ["cs", "it"] as const)).toBeNull();
    expect(pickParam(null, ["cs"] as const)).toBeNull();
  });
  it("searches names, phones and IDs typed any way", () => {
    expect(matchesSearch("abebe", ["Abebe Kebede", null])).toBe(true);
    expect(matchesSearch("ugr 1234", ["UGR/1234/12"])).toBe(true);
    expect(matchesSearch("0911", ["+251911223344"])).toBe(false);
    expect(matchesSearch("911223", ["+251911223344"])).toBe(true);
    expect(matchesSearch("", ["x"])).toBe(true);
  });
});

import { attendanceDiff } from "../app/lib/dashboard";

describe("attendanceDiff", () => {
  it("adds newly ticked and removes unticked members, ignoring unknown ids", () => {
    expect(attendanceDiff(["a", "b"], ["b", "c", "zzz"], new Set(["a", "b", "c"]))).toEqual({ add: ["c"], remove: ["a"] });
    expect(attendanceDiff([], [], new Set())).toEqual({ add: [], remove: [] });
  });
});
