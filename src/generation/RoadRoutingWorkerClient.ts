import { GenerationOperationGate, type GenerationOperationToken } from "./GenerationOperationGate";
import type {
  RoadRouteInput,
  RoadRouteRequest,
  RoadRouteResult,
  RoadRouteTerrainSnapshot,
} from "./roadRouting";

export interface RoadRoutingWorkerMessage {
  readonly request: RoadRouteRequest;
  readonly terrain: RoadRouteTerrainSnapshot;
}

export interface RoadRoutingWorkerLike {
  onmessage: ((event: MessageEvent<RoadRouteResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: RoadRoutingWorkerMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export interface RoadRoutingHandlers {
  readonly onResult: (result: RoadRouteResult) => void;
  readonly onError: (message: string) => void;
}

export type RoadRoutingWorkerFactory = () => RoadRoutingWorkerLike;

/** Owns a single Vite module worker and suppresses every cancelled or stale response. */
export class RoadRoutingWorkerClient {
  readonly #gate = new GenerationOperationGate();
  readonly #workerFactory: RoadRoutingWorkerFactory;
  #worker: RoadRoutingWorkerLike | null = null;

  public constructor(workerFactory: RoadRoutingWorkerFactory = createRoadRoutingWorker) {
    this.#workerFactory = workerFactory;
  }

  public start(
    input: RoadRouteInput,
    seed: number,
    terrain: RoadRouteTerrainSnapshot,
    handlers: RoadRoutingHandlers,
  ): GenerationOperationToken {
    this.cancel();
    const worker = this.#workerFactory();
    const token = this.#gate.begin();
    this.#worker = worker;
    const request: RoadRouteRequest = {
      operationId: token.operationId,
      kind: "road_route",
      seed,
      input,
    };
    worker.onmessage = (event): void => {
      const accepted = this.#gate.completeIfCurrent(token, () => {
        if (this.#worker === worker) this.#worker = null;
        worker.terminate();
        handlers.onResult(event.data);
      });
      if (!accepted) worker.terminate();
    };
    worker.onerror = (event): void => {
      const accepted = this.#gate.completeIfCurrent(token, () => {
        if (this.#worker === worker) this.#worker = null;
        worker.terminate();
        handlers.onError(event.message || "The road routing worker failed.");
      });
      if (!accepted) worker.terminate();
    };
    const message: RoadRoutingWorkerMessage = { request, terrain };
    try {
      worker.postMessage(message, [terrain.heights.buffer]);
    } catch (error) {
      worker.terminate();
      if (this.#worker === worker) this.#worker = null;
      this.#gate.cancel(token);
      throw error;
    }
    return token;
  }

  public cancel(): boolean {
    const worker = this.#worker;
    this.#worker = null;
    worker?.terminate();
    return this.#gate.cancel();
  }

  public dispose(): void {
    this.cancel();
  }
}

function createRoadRoutingWorker(): RoadRoutingWorkerLike {
  return new Worker(new URL("../workers/roadRoutingWorker.ts", import.meta.url), { type: "module" });
}
