import { describe, expect, it, vi } from "vitest";
import type {
  GenerationFailure,
  GenerationRequest,
  GenerationSuccess,
} from "../../src/generation/contracts";
import { GenerationOperationGate } from "../../src/generation/GenerationOperationGate";

describe("generation message contracts", () => {
  it("round-trips requests and diagnostic-rich results as plain JSON", () => {
    const request: GenerationRequest = {
      operationId: 17,
      kind: "settlement_survey",
      seed: 42,
      input: { attempts: 650, profile: "village", samples: [0, 0.5, 1] },
    };
    const success: GenerationSuccess = {
      operationId: request.operationId,
      kind: request.kind,
      status: "success",
      output: { candidates: [[100, 200]], acceptedCount: 1 },
      diagnostics: [{ severity: "info", code: "attempts", message: "650 candidates evaluated" }],
      metrics: [{ name: "elapsed", value: 12.5, unit: "ms" }],
      rejections: [{ reason: "slope", count: 14 }, { reason: "separation", count: 3 }],
    };
    const failure: GenerationFailure = {
      operationId: 18,
      kind: "road_route",
      status: "failure",
      reason: "budget_exhausted",
      diagnostics: [{ severity: "warning", code: "node_budget", message: "Search budget exhausted" }],
      metrics: [{ name: "visited_nodes", value: 50_000, unit: "nodes" }],
      rejections: [{ reason: "maximum_grade", count: 281 }],
    };

    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect(JSON.parse(JSON.stringify(success))).toEqual(success);
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
    expect(success.rejections.map(({ reason }) => reason)).toEqual(["slope", "separation"]);
  });
});

describe("GenerationOperationGate", () => {
  it("prevents stale, cancelled, and duplicate results from applying", () => {
    const gate = new GenerationOperationGate();
    const apply = vi.fn();
    const stale = gate.begin();
    const current = gate.begin();
    expect(gate.isCurrent(stale)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
    expect(gate.completeIfCurrent(stale, apply)).toBe(false);
    expect(gate.completeIfCurrent(current, apply)).toBe(true);
    expect(gate.completeIfCurrent(current, apply)).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);

    const cancelled = gate.begin();
    expect(gate.cancel(cancelled)).toBe(true);
    expect(gate.isCurrent(cancelled)).toBe(false);
    expect(gate.completeIfCurrent(cancelled, apply)).toBe(false);
    expect(gate.cancel()).toBe(false);
  });

  it("does not let an old token cancel the current operation", () => {
    const gate = new GenerationOperationGate();
    const old = gate.begin();
    const current = gate.begin();
    expect(gate.cancel(old)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
  });
});
