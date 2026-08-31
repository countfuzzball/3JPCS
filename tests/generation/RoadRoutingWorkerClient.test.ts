import { describe, expect, it, vi } from "vitest";
import {
  RoadRoutingWorkerClient,
  type RoadRoutingWorkerLike,
  type RoadRoutingWorkerMessage,
} from "../../src/generation/RoadRoutingWorkerClient";
import type { RoadRouteInput, RoadRouteResult, RoadRouteTerrainSnapshot } from "../../src/generation/roadRouting";

describe("RoadRoutingWorkerClient", () => {
  it("terminates superseded work and ignores its stale result", () => {
    const workers: FakeWorker[] = [];
    const client = new RoadRoutingWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const applied = vi.fn();
    const first = client.start(INPUT, 1, terrain(), { onResult: applied, onError: vi.fn() });
    const second = client.start(INPUT, 2, terrain(), { onResult: applied, onError: vi.fn() });
    expect(first.operationId).not.toBe(second.operationId);
    expect(workers[0]?.terminated).toBe(true);
    workers[0]?.emit(success(first.operationId));
    expect(applied).not.toHaveBeenCalled();
    workers[1]?.emit(success(second.operationId));
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledWith(success(second.operationId));
    expect(workers[1]?.terminated).toBe(true);
  });

  it("terminates cancelled work and suppresses its later response", () => {
    const worker = new FakeWorker();
    const client = new RoadRoutingWorkerClient(() => worker);
    const applied = vi.fn();
    const token = client.start(INPUT, 1, terrain(), { onResult: applied, onError: vi.fn() });
    expect(client.cancel()).toBe(true);
    expect(worker.terminated).toBe(true);
    worker.emit(success(token.operationId));
    expect(applied).not.toHaveBeenCalled();
    expect(client.cancel()).toBe(false);
  });

  it("transfers the copied height buffer in a module-worker message envelope", () => {
    const worker = new FakeWorker();
    const snapshot = terrain();
    const client = new RoadRoutingWorkerClient(() => worker);
    const token = client.start(INPUT, 99, snapshot, { onResult: vi.fn(), onError: vi.fn() });
    expect(worker.message?.request).toEqual({ operationId: token.operationId, kind: "road_route", seed: 99, input: INPUT });
    expect(worker.message?.terrain).toBe(snapshot);
    expect(worker.transfer).toEqual([snapshot.heights.buffer]);
  });
});

const INPUT: RoadRouteInput = {
  start: [0, 0],
  end: [10, 10],
  gridStepM: 10,
  slopeWeight: 42,
  maximumGrade: 0.2,
  turnPenaltyM: 4,
  edgeClearanceM: 0,
};

class FakeWorker implements RoadRoutingWorkerLike {
  public onmessage: ((event: MessageEvent<RoadRouteResult>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public message: RoadRoutingWorkerMessage | null = null;
  public transfer: readonly Transferable[] = [];
  public terminated = false;

  public postMessage(message: RoadRoutingWorkerMessage, transfer: Transferable[]): void {
    this.message = message;
    this.transfer = transfer;
  }

  public terminate(): void {
    this.terminated = true;
  }

  public emit(result: RoadRouteResult): void {
    this.onmessage?.({ data: result } as MessageEvent<RoadRouteResult>);
  }
}

function terrain(): RoadRouteTerrainSnapshot {
  return {
    worldWidthM: 10,
    worldDepthM: 10,
    spacingM: 10,
    pointCountX: 2,
    pointCountZ: 2,
    heights: new Float32Array(4),
  };
}

function success(operationId: number): RoadRouteResult {
  return {
    operationId,
    kind: "road_route",
    status: "success",
    output: {
      points: [[0, 0], [10, 10]],
      rawPoints: [[0, 0], [10, 10]],
      visitedNodes: 2,
      pathLengthM: Math.sqrt(200),
      maximumGrade: 0,
      meanGrade: 0,
      cost: Math.sqrt(200),
      elapsedMs: 1,
      smoothed: false,
    },
    diagnostics: [],
    metrics: [],
    rejections: [],
  };
}
