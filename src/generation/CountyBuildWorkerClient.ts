import { GenerationOperationGate, type GenerationOperationToken } from "./GenerationOperationGate";
import type {
  CountyBuildInput,
  CountyBuildProgress,
  CountyBuildRequest,
  CountyBuildResult,
  CountyBuildTerrainSnapshot,
} from "./countyBuild";

export interface CountyBuildWorkerRequestMessage {
  readonly request: CountyBuildRequest;
  readonly terrain: CountyBuildTerrainSnapshot;
}

export type CountyBuildWorkerResponseMessage = {
  readonly type: "progress";
  readonly progress: CountyBuildProgress;
} | {
  readonly type: "result";
  readonly result: CountyBuildResult;
};

export interface CountyBuildWorkerLike {
  onmessage: ((event: MessageEvent<CountyBuildWorkerResponseMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: CountyBuildWorkerRequestMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export interface CountyBuildHandlers {
  readonly onProgress: (progress: CountyBuildProgress) => void;
  readonly onResult: (result: CountyBuildResult) => void;
  readonly onError: (message: string) => void;
}

export type CountyBuildWorkerFactory = () => CountyBuildWorkerLike;

/** Owns one county-build worker and suppresses all cancelled or stale progress/results. */
export class CountyBuildWorkerClient {
  readonly #gate = new GenerationOperationGate();
  readonly #workerFactory: CountyBuildWorkerFactory;
  #worker: CountyBuildWorkerLike | null = null;

  public constructor(workerFactory: CountyBuildWorkerFactory = createCountyBuildWorker) {
    this.#workerFactory = workerFactory;
  }

  public start(
    input: CountyBuildInput,
    terrain: CountyBuildTerrainSnapshot,
    handlers: CountyBuildHandlers,
  ): GenerationOperationToken {
    this.cancel();
    const worker = this.#workerFactory();
    const token = this.#gate.begin();
    this.#worker = worker;
    const request: CountyBuildRequest = {
      operationId: token.operationId,
      kind: "county_build",
      seed: input.seed,
      input,
    };
    worker.onmessage = (event): void => {
      if (event.data.type === "progress") {
        if (this.#gate.isCurrent(token)) handlers.onProgress(event.data.progress);
        return;
      }
      const result = event.data.result;
      const accepted = this.#gate.completeIfCurrent(token, () => {
        if (this.#worker === worker) this.#worker = null;
        worker.terminate();
        handlers.onResult(result);
      });
      if (!accepted) worker.terminate();
    };
    worker.onerror = (event): void => {
      const accepted = this.#gate.completeIfCurrent(token, () => {
        if (this.#worker === worker) this.#worker = null;
        worker.terminate();
        handlers.onError(event.message || "The county build worker failed.");
      });
      if (!accepted) worker.terminate();
    };
    try {
      worker.postMessage({ request, terrain }, [terrain.heights.buffer]);
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

function createCountyBuildWorker(): CountyBuildWorkerLike {
  return new Worker(new URL("../workers/countyBuildWorker.ts", import.meta.url), { type: "module" });
}
