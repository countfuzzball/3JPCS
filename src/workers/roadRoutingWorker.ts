/// <reference lib="webworker" />

import type { RoadRoutingWorkerMessage } from "../generation/RoadRoutingWorkerClient";
import type { RoadRouteResult } from "../generation/roadRouting";
import { routeRoad } from "../generation/roadRouting";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<RoadRoutingWorkerMessage>): void => {
  const { request, terrain } = event.data;
  let result: RoadRouteResult;
  try {
    result = routeRoad(request, terrain);
  } catch (error) {
    result = {
      operationId: request.operationId,
      kind: "road_route",
      status: "failure",
      reason: "internal_error",
      diagnostics: [{
        severity: "error",
        code: "internal_error",
        message: error instanceof Error ? error.message : "The road routing worker failed unexpectedly.",
      }],
      metrics: [],
      rejections: [],
    };
  }
  workerScope.postMessage(result);
};

export {};
