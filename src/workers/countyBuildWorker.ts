/// <reference lib="webworker" />

import { buildCountyPlan, type CountyBuildResult } from "../generation/countyBuild";
import type {
  CountyBuildWorkerRequestMessage,
  CountyBuildWorkerResponseMessage,
} from "../generation/CountyBuildWorkerClient";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<CountyBuildWorkerRequestMessage>): void => {
  const { request, terrain } = event.data;
  let result: CountyBuildResult;
  try {
    result = buildCountyPlan(request, terrain, (progress) => {
      const message: CountyBuildWorkerResponseMessage = {
        type: "progress",
        progress: { ...progress, operationId: request.operationId },
      };
      workerScope.postMessage(message);
    });
  } catch (error) {
    result = {
      operationId: request.operationId,
      kind: "county_build",
      status: "failure",
      reason: "internal_error",
      diagnostics: [{
        severity: "error",
        code: "internal_error",
        message: error instanceof Error ? error.message : "The county build worker failed unexpectedly.",
      }],
      metrics: [],
    };
  }
  const message: CountyBuildWorkerResponseMessage = { type: "result", result };
  workerScope.postMessage(message);
};

export {};
