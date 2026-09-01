import { describe, expect, it, vi } from "vitest";
import {
  CountyBuildWorkerClient,
  type CountyBuildWorkerLike,
  type CountyBuildWorkerRequestMessage,
  type CountyBuildWorkerResponseMessage,
} from "../../src/generation/CountyBuildWorkerClient";
import {
  DEFAULT_COUNTY_ROAD_STYLES,
  type CountyAssetProgram,
  type CountyBuildInput,
  type CountyBuildTerrainSnapshot,
} from "../../src/generation/countyBuild";

describe("CountyBuildWorkerClient", () => {
  it("forwards current progress and result, then terminates the worker", () => {
    const worker = new FakeWorker();
    const client = new CountyBuildWorkerClient(() => worker);
    const progress = vi.fn();
    const result = vi.fn();
    const terrain = snapshot();
    const token = client.start(input(), terrain, { onProgress: progress, onResult: result, onError: vi.fn() });
    worker.emit({ type: "progress", progress: { operationId: token.operationId, phase: "survey", completed: 1, total: 2, message: "Survey" } });
    expect(progress).toHaveBeenCalledTimes(1);
    worker.emit({ type: "result", result: {
      operationId: token.operationId,
      kind: "county_build",
      status: "failure",
      reason: "no_valid_result",
      diagnostics: [],
      metrics: [],
    } });
    expect(result).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(true);
    expect(worker.message?.request.kind).toBe("county_build");
    expect(worker.transfer).toEqual([terrain.heights.buffer]);
  });

  it("terminates superseded work and suppresses its stale progress and result", () => {
    const workers: FakeWorker[] = [];
    const client = new CountyBuildWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const progress = vi.fn();
    const result = vi.fn();
    const first = client.start(input(), snapshot(), { onProgress: progress, onResult: result, onError: vi.fn() });
    const second = client.start(input(), snapshot(), { onProgress: progress, onResult: result, onError: vi.fn() });
    expect(workers[0]?.terminated).toBe(true);
    workers[0]?.emit({ type: "progress", progress: { operationId: first.operationId, phase: "survey", completed: 1, total: 1, message: "stale" } });
    workers[0]?.emit({ type: "result", result: { operationId: first.operationId, kind: "county_build", status: "failure", reason: "no_valid_result", diagnostics: [], metrics: [] } });
    expect(progress).not.toHaveBeenCalled();
    expect(result).not.toHaveBeenCalled();
    workers[1]?.emit({ type: "result", result: { operationId: second.operationId, kind: "county_build", status: "failure", reason: "no_valid_result", diagnostics: [], metrics: [] } });
    expect(result).toHaveBeenCalledTimes(1);
  });
});

class FakeWorker implements CountyBuildWorkerLike {
  public onmessage: ((event: MessageEvent<CountyBuildWorkerResponseMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public message: CountyBuildWorkerRequestMessage | null = null;
  public transfer: readonly Transferable[] = [];
  public terminated = false;

  public postMessage(message: CountyBuildWorkerRequestMessage, transfer: Transferable[]): void {
    this.message = message;
    this.transfer = transfer;
  }

  public terminate(): void { this.terminated = true; }

  public emit(message: CountyBuildWorkerResponseMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<CountyBuildWorkerResponseMessage>);
  }
}

function input(): CountyBuildInput {
  const emptyProgram: CountyAssetProgram = {
    house: [{ assetId: "house", category: "house", displayName: "House", widthM: 1, depthM: 1 }],
    shop: [], civic: [], farmhouse: [], barn: [], shed: [], warehouse: [],
  };
  return {
    outputMode: "full",
    sourceMode: "existing_places",
    desiredSettlementCount: 1,
    selectedExistingPlaceIds: [],
    mainPlaceIdOverride: null,
    existingPlaces: [],
    existingRoads: [],
    existingPrefabFootprints: [],
    createBackbone: true,
    backboneOrientation: "auto",
    routing: { gridStepM: 10, slopeWeight: 1, maximumGrade: 0.3, turnPenaltyM: 1, edgeClearanceM: 0 },
    roadStyles: DEFAULT_COUNTY_ROAD_STYLES,
    survey: { minimumSeparationM: 0, edgeClearanceM: 0, preferredElevationM: null, attemptBudgetPerSite: 1, radiusScale: 1, siteMix: "balanced" },
    localStreets: { edgeClearanceM: 0, minimumRoadLengthM: 1, sampleStepM: 1, maximumGrade: 0.3 },
    styleByProfile: { town: "planned", village: "roadside", hamlet: "roadside", farm: "agricultural" },
    budgets: { maximumRoutes: 64, maximumVisitedNodes: 5_000_000, maximumPrefabs: 5_000, maximumDriveways: 5_000 },
    frontage: { side: "both", setbackM: 1, gapM: 1, endClearanceM: 1, maximumPlotSlopeDeg: 20, junctionClearanceM: 1, spacingJitterM: 0, yawJitterDeg: 0, seed: 1, drivewaysEnabled: false },
    assetProgram: emptyProgram,
    seed: 1,
    sourceRevision: 1,
  };
}

function snapshot(): CountyBuildTerrainSnapshot {
  return {
    worldWidthM: 10,
    worldDepthM: 10,
    spacingM: 10,
    pointCountX: 2,
    pointCountZ: 2,
    heights: new Float32Array(4),
    minimumElevationM: 0,
    seaLevelM: 0,
    lowlandReferenceElevationM: 0,
    maximumElevationM: 1,
  };
}
