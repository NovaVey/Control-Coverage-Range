import { describe, it, expect } from "vitest";
import { findRegressions } from "../src/report/baseline.js";
import type { MatrixSnapshot } from "../src/report/render-json.js";

function snapshot(rows: MatrixSnapshot["rows"]): MatrixSnapshot {
  return { generatedAt: "2026-01-01T00:00:00.000Z", rows };
}

describe("findRegressions", () => {
  it("flags a cell moving from blocked to missed", () => {
    const baseline = snapshot({
      "gaps/tttb#gap-01": {
        name: "x",
        cells: {
          broker: {
            outcome: "blocked",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    const current = snapshot({
      "gaps/tttb#gap-01": {
        name: "x",
        cells: {
          broker: {
            outcome: "missed",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    const regressions = findRegressions(baseline, current);
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      row: "gaps/tttb#gap-01",
      layer: "broker",
      from: "blocked",
      to: "missed",
    });
  });

  it("does not flag a cell newly marked assertsKnownGap even if it got worse", () => {
    const baseline = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "blocked",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    const current = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "missed",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: true,
          },
        },
      },
    });
    expect(findRegressions(baseline, current)).toEqual([]);
  });

  it("does not flag a cell that was already invalid at baseline time", () => {
    const baseline = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "blocked",
            scenarioIds: ["s1"],
            anyInvalid: true,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    const current = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "missed",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    expect(findRegressions(baseline, current)).toEqual([]);
  });

  it("flags a row disappearing entirely as a regression to missed", () => {
    const baseline = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "blocked",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    const current = snapshot({});
    const regressions = findRegressions(baseline, current);
    expect(regressions).toEqual([
      { row: "row1", layer: "broker", from: "blocked", to: "missed" },
    ]);
  });

  it("does not flag an improvement", () => {
    const baseline = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "missed",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    const current = snapshot({
      row1: {
        name: "x",
        cells: {
          broker: {
            outcome: "blocked",
            scenarioIds: ["s1"],
            anyInvalid: false,
            anyAssertsKnownGap: false,
          },
        },
      },
    });
    expect(findRegressions(baseline, current)).toEqual([]);
  });
});
