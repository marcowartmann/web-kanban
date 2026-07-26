import { describe, expect, it } from "vitest";
import { assignRows, axisRange, barGeometry } from "./roadmap";

const TODAY = new Date(Date.UTC(2026, 6, 26)); // 2026-07-26

describe("axisRange", () => {
  it("pads to whole months and includes today", () => {
    const r = axisRange(
      [{ start_date: "2026-01-15", end_date: "2026-03-10" }],
      TODAY,
    );
    expect(new Date(r.startMs).toISOString().slice(0, 10)).toBe("2026-01-01");
    // latest month is July (today) -> exclusive end = Aug 1
    expect(new Date(r.endMs).toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(r.months).toHaveLength(7);
    expect(r.months[0].label).toBe("Jan 26");
    expect(r.months[0].leftPct).toBe(0);
    expect(r.todayPct).toBeGreaterThan(85);
  });

  it("with no items spans today's month alone", () => {
    const r = axisRange([], TODAY);
    expect(r.months).toHaveLength(1);
    expect(r.months[0].label).toBe("Jul 26");
  });
});

describe("barGeometry", () => {
  const range = axisRange(
    [{ start_date: "2026-01-01", end_date: "2026-06-30" }],
    TODAY,
  ); // axis Jan 1 .. Aug 1 (212 days)

  it("computes left and width percentages", () => {
    const g = barGeometry({ start_date: "2026-01-01", end_date: "2026-06-30" }, range);
    expect(g.leftPct).toBe(0);
    expect(g.widthPct).toBeCloseTo((181 / 212) * 100, 1);
  });

  it("floors tiny bars at 1.5% and clamps into the axis", () => {
    const g = barGeometry({ start_date: "2026-02-01", end_date: "2026-02-01" }, range);
    expect(g.widthPct).toBe(1.5);
    expect(g.leftPct).toBeGreaterThan(0);
    expect(g.leftPct + g.widthPct).toBeLessThanOrEqual(100);
  });
});

describe("assignRows", () => {
  it("keeps non-overlapping items on one row", () => {
    const { rows, rowCount } = assignRows([
      { id: 1, start_date: "2026-01-01", end_date: "2026-02-01" },
      { id: 2, start_date: "2026-03-01", end_date: "2026-04-01" },
    ]);
    expect(rowCount).toBe(1);
    expect(rows.get(1)).toBe(0);
    expect(rows.get(2)).toBe(0);
  });

  it("stacks overlapping items onto separate rows", () => {
    const { rows, rowCount } = assignRows([
      { id: 1, start_date: "2026-01-01", end_date: "2026-06-30" },
      { id: 2, start_date: "2026-03-01", end_date: "2026-04-01" },
      { id: 3, start_date: "2026-03-15", end_date: "2026-09-01" },
    ]);
    expect(rowCount).toBe(3);
    expect(new Set([rows.get(1), rows.get(2), rows.get(3)]).size).toBe(3);
  });

  it("treats same-day touch as overlap but reuses freed rows", () => {
    const { rows, rowCount } = assignRows([
      { id: 1, start_date: "2026-01-01", end_date: "2026-02-01" },
      { id: 2, start_date: "2026-02-01", end_date: "2026-03-01" }, // touches item 1
      { id: 3, start_date: "2026-02-02", end_date: "2026-05-01" }, // row 0 free again
    ]);
    expect(rowCount).toBe(2);
    expect(rows.get(2)).toBe(1);
    expect(rows.get(3)).toBe(0);
  });

  it("assigns independently of input order (sorts by start then id)", () => {
    const { rowCount } = assignRows([
      { id: 2, start_date: "2026-03-01", end_date: "2026-04-01" },
      { id: 1, start_date: "2026-01-01", end_date: "2026-02-01" },
    ]);
    expect(rowCount).toBe(1);
  });

  it("empty input yields one visual row", () => {
    expect(assignRows([]).rowCount).toBe(1);
  });
});
