import type { PointTuple } from "../model/entities";
import type { TerrainSurface } from "../terrain/TerrainSurface";
import { BinaryMinPriorityQueue } from "./BinaryMinPriorityQueue";
import type {
  GenerationDiagnostic,
  GenerationFailureReason,
  GenerationMetric,
  GenerationRejectionCount,
  GenerationResult,
  JsonObject,
} from "./contracts";
import { SeededRandom } from "./seededRandom";

export const MAX_ROUTE_GRID_NODES = 250_000;
export const MAX_ROUTE_VISITED_NODES = 200_000;

const DIRECTION_COUNT = 8;
const STATE_SLOTS_PER_NODE = DIRECTION_COUNT + 1;
const EPSILON = 1e-8;

const DIRECTIONS = [
  { dx: 1, dz: 0 },
  { dx: 1, dz: 1 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 1 },
  { dx: -1, dz: 0 },
  { dx: -1, dz: -1 },
  { dx: 0, dz: -1 },
  { dx: 1, dz: -1 },
] as const;

export interface RoadRouteInput {
  readonly start: PointTuple;
  readonly end: PointTuple;
  readonly gridStepM: number;
  readonly slopeWeight: number;
  readonly maximumGrade: number;
  readonly turnPenaltyM: number;
  readonly edgeClearanceM: number;
}

export interface RoadRouteRequest {
  readonly operationId: number;
  readonly kind: "road_route";
  readonly seed: number;
  readonly input: RoadRouteInput;
}

export interface RoadRouteOutput extends JsonObject {
  readonly points: readonly PointTuple[];
  readonly rawPoints: readonly PointTuple[];
  readonly visitedNodes: number;
  readonly pathLengthM: number;
  readonly maximumGrade: number;
  readonly meanGrade: number;
  readonly cost: number;
  readonly elapsedMs: number;
  readonly smoothed: boolean;
}

export type RoadRouteResult = GenerationResult<RoadRouteOutput>;

export interface RoadRouteTerrainSnapshot {
  readonly worldWidthM: number;
  readonly worldDepthM: number;
  readonly spacingM: number;
  readonly pointCountX: number;
  readonly pointCountZ: number;
  readonly heights: Float32Array;
}

interface SegmentAnalysis {
  readonly traversable: boolean;
  readonly lengthM: number;
  readonly maximumGrade: number;
  readonly weightedGrade: number;
  readonly cost: number;
}

interface PolylineAnalysis {
  readonly valid: boolean;
  readonly lengthM: number;
  readonly maximumGrade: number;
  readonly meanGrade: number;
}

interface GoalConnector {
  readonly analysis: SegmentAnalysis;
  readonly direction: PointTuple | null;
}

export function copyRoadRouteTerrain(surface: TerrainSurface): RoadRouteTerrainSnapshot {
  return {
    worldWidthM: surface.worldWidthM,
    worldDepthM: surface.worldDepthM,
    spacingM: surface.spacingM,
    pointCountX: surface.pointCountX,
    pointCountZ: surface.pointCountZ,
    heights: surface.copyHeights(),
  };
}

/** Runs the deterministic SA-3 terrain-cost route search against an immutable terrain snapshot. */
export function routeRoad(
  request: RoadRouteRequest,
  terrain: RoadRouteTerrainSnapshot,
): RoadRouteResult {
  const startedAt = performance.now();
  const rejectionCounts = new Map<string, number>();
  const inputError = validateRequest(request, terrain);
  if (inputError) {
    return failure(request, "invalid_request", inputError, startedAt, 0, rejectionCounts);
  }

  const { input } = request;
  const minimumX = input.edgeClearanceM;
  const maximumX = terrain.worldWidthM - input.edgeClearanceM;
  const minimumZ = input.edgeClearanceM;
  const maximumZ = terrain.worldDepthM - input.edgeClearanceM;
  const xValues = anchoredAxis(request.input.start[0], minimumX, maximumX, input.gridStepM);
  const zValues = anchoredAxis(request.input.start[1], minimumZ, maximumZ, input.gridStepM);
  const nodeCount = xValues.length * zValues.length;
  if (nodeCount > MAX_ROUTE_GRID_NODES) {
    rejectionCounts.set("grid_node_budget", nodeCount - MAX_ROUTE_GRID_NODES);
    return failure(
      request,
      "budget_exhausted",
      `The ${nodeCount.toLocaleString()}-node routing grid exceeds the ${MAX_ROUTE_GRID_NODES.toLocaleString()}-node budget. Increase the grid step.`,
      startedAt,
      0,
      rejectionCounts,
    );
  }

  const startXIndex = nearestAxisIndex(xValues, input.start[0]);
  const startZIndex = nearestAxisIndex(zValues, input.start[1]);
  const startNode = startZIndex * xValues.length + startXIndex;
  const goalConnectors = buildGoalConnectors(
    input.end,
    xValues,
    zValues,
    input,
    terrain,
    rejectionCounts,
  );
  if (goalConnectors.size === 0) {
    return failure(
      request,
      "no_valid_result",
      "The destination cannot connect to the routing grid without exceeding the maximum grade.",
      startedAt,
      0,
      rejectionCounts,
    );
  }

  const stateCount = nodeCount * STATE_SLOTS_PER_NODE;
  const gScore = new Float64Array(stateCount);
  gScore.fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(stateCount);
  cameFrom.fill(-1);
  const closed = new Uint8Array(stateCount);
  const visitedNodeFlags = new Uint8Array(nodeCount);
  const queue = new BinaryMinPriorityQueue<number>();
  const startState = stateIndex(startNode, -1);
  gScore[startState] = 0;
  queue.push(startState, distance(input.start, input.end));

  const directionOrder = new SeededRandom(request.seed).shuffled(
    DIRECTIONS.map((_, index) => index),
  );
  const edgeCache = new Map<string, SegmentAnalysis>();
  let visitedNodes = 0;
  let bestGoalState = -1;
  let bestGoalCost = Number.POSITIVE_INFINITY;
  let budgetExhausted = false;

  while (!queue.empty) {
    const pending = queue.peek();
    if (pending && bestGoalState >= 0 && pending.priority >= bestGoalCost - EPSILON) break;
    const queued = queue.pop();
    if (!queued) break;
    const currentState = queued.value;
    if (closed[currentState] === 1) continue;
    closed[currentState] = 1;
    const currentNode = nodeFromState(currentState);
    if (visitedNodeFlags[currentNode] === 0) {
      visitedNodeFlags[currentNode] = 1;
      visitedNodes += 1;
      if (visitedNodes > MAX_ROUTE_VISITED_NODES) {
        budgetExhausted = true;
        break;
      }
    }

    const currentPoint = pointForNode(currentNode, xValues, zValues);
    const previousDirection = directionFromState(currentState);
    const currentScore = gScore[currentState];
    if (currentScore === undefined) throw new Error("route search addressed a missing score");
    const connector = goalConnectors.get(currentNode);
    if (connector) {
      const connectorTurn = connector.direction === null
        ? 0
        : vectorTurnPenalty(previousDirectionVector(previousDirection), connector.direction, input.turnPenaltyM);
      const candidateCost = currentScore + connector.analysis.cost + connectorTurn;
      if (candidateCost < bestGoalCost - EPSILON) {
        bestGoalCost = candidateCost;
        bestGoalState = currentState;
      }
    }

    const currentXIndex = currentNode % xValues.length;
    const currentZIndex = Math.floor(currentNode / xValues.length);
    for (const directionIndex of directionOrder) {
      const direction = DIRECTIONS[directionIndex];
      if (!direction) continue;
      const nextXIndex = currentXIndex + direction.dx;
      const nextZIndex = currentZIndex + direction.dz;
      if (
        nextXIndex < 0
        || nextZIndex < 0
        || nextXIndex >= xValues.length
        || nextZIndex >= zValues.length
      ) continue;
      const nextNode = nextZIndex * xValues.length + nextXIndex;
      const nextState = stateIndex(nextNode, directionIndex);
      if (closed[nextState] === 1) continue;
      const cacheKey = currentNode < nextNode
        ? `${String(currentNode)}:${String(nextNode)}`
        : `${String(nextNode)}:${String(currentNode)}`;
      let segment = edgeCache.get(cacheKey);
      if (!segment) {
        segment = analyzeSegment(currentPoint, pointForNode(nextNode, xValues, zValues), input, terrain);
        edgeCache.set(cacheKey, segment);
        if (!segment.traversable) incrementRejection(rejectionCounts, "maximum_grade");
      }
      if (!segment.traversable) continue;
      const turn = discreteTurnPenalty(previousDirection, directionIndex, input.turnPenaltyM);
      const existingScore = gScore[nextState];
      if (existingScore === undefined) throw new Error("route search addressed a missing neighbour score");
      const candidateScore = currentScore + segment.cost + turn;
      if (candidateScore >= existingScore - EPSILON) continue;
      cameFrom[nextState] = currentState;
      gScore[nextState] = candidateScore;
      const nextPoint = pointForNode(nextNode, xValues, zValues);
      queue.push(nextState, candidateScore + distance(nextPoint, input.end));
    }
  }

  if (budgetExhausted) {
    incrementRejection(rejectionCounts, "visited_node_budget");
    return failure(
      request,
      "budget_exhausted",
      `The route search visited more than ${MAX_ROUTE_VISITED_NODES.toLocaleString()} nodes. Increase the grid step or tighten the search area.`,
      startedAt,
      visitedNodes,
      rejectionCounts,
    );
  }
  if (bestGoalState < 0) {
    return failure(
      request,
      "no_valid_result",
      "No traversable route reaches the destination at the selected maximum grade.",
      startedAt,
      visitedNodes,
      rejectionCounts,
    );
  }

  const rawPoints = reconstructPoints(bestGoalState, cameFrom, xValues, zValues, input.start, input.end);
  const simplified = simplifyCollinear(rawPoints);
  const smoothed = chaikin(simplified, 2);
  const smoothedAnalysis = analyzePolyline(smoothed, input, terrain);
  const simplifiedAnalysis = analyzePolyline(simplified, input, terrain);
  let finalPoints: readonly PointTuple[];
  let finalAnalysis: PolylineAnalysis;
  let smoothingAccepted: boolean;
  const diagnostics: GenerationDiagnostic[] = [];
  if (smoothedAnalysis.valid) {
    finalPoints = smoothed;
    finalAnalysis = smoothedAnalysis;
    smoothingAccepted = true;
  } else if (simplifiedAnalysis.valid) {
    finalPoints = simplified;
    finalAnalysis = simplifiedAnalysis;
    smoothingAccepted = false;
    diagnostics.push({
      severity: "warning",
      code: "smoothing_rejected",
      message: "Corner smoothing would violate the grade or world-edge constraint, so the valid simplified A* path is shown.",
    });
  } else {
    return failure(
      request,
      "no_valid_result",
      "The routed path failed final bounds or grade validation.",
      startedAt,
      visitedNodes,
      rejectionCounts,
    );
  }

  const elapsedMs = performance.now() - startedAt;
  diagnostics.unshift({
    severity: "info",
    code: "route_ready",
    message: `A terrain-aware route was found after visiting ${visitedNodes.toLocaleString()} nodes.`,
  });
  const output: RoadRouteOutput = {
    points: finalPoints,
    rawPoints,
    visitedNodes,
    pathLengthM: finalAnalysis.lengthM,
    maximumGrade: finalAnalysis.maximumGrade,
    meanGrade: finalAnalysis.meanGrade,
    cost: bestGoalCost,
    elapsedMs,
    smoothed: smoothingAccepted,
  };
  return {
    operationId: request.operationId,
    kind: "road_route",
    status: "success",
    output,
    diagnostics,
    metrics: routeMetrics(output),
    rejections: rejectionEntries(rejectionCounts),
  };
}

function validateRequest(request: RoadRouteRequest, terrain: RoadRouteTerrainSnapshot): string | null {
  if (!Number.isSafeInteger(request.operationId) || request.operationId < 1) return "The route operation id must be a positive safe integer.";
  if (!Number.isSafeInteger(request.seed)) return "The route seed must be a safe integer.";
  const { input } = request;
  if (!finitePoint(input.start) || !finitePoint(input.end)) return "Route endpoints must contain finite coordinates.";
  if (distance(input.start, input.end) <= EPSILON) return "Route endpoints must be different.";
  if (!positiveFinite(input.gridStepM)) return "The routing grid step must be greater than zero.";
  if (!Number.isFinite(input.slopeWeight) || input.slopeWeight < 0) return "The slope weight must be zero or greater.";
  if (!positiveFinite(input.maximumGrade)) return "The maximum traversable grade must be greater than zero.";
  if (!Number.isFinite(input.turnPenaltyM) || input.turnPenaltyM < 0) return "The turn penalty must be zero or greater.";
  if (!Number.isFinite(input.edgeClearanceM) || input.edgeClearanceM < 0) return "The world-edge clearance must be zero or greater.";
  if (!positiveFinite(terrain.worldWidthM) || !positiveFinite(terrain.worldDepthM) || !positiveFinite(terrain.spacingM)) {
    return "The terrain snapshot dimensions and spacing must be positive.";
  }
  if (!Number.isInteger(terrain.pointCountX) || !Number.isInteger(terrain.pointCountZ) || terrain.pointCountX < 2 || terrain.pointCountZ < 2) {
    return "The terrain snapshot grid dimensions are invalid.";
  }
  if (terrain.heights.length !== terrain.pointCountX * terrain.pointCountZ) return "The terrain snapshot elevation array has the wrong length.";
  if (Math.abs((terrain.pointCountX - 1) * terrain.spacingM - terrain.worldWidthM) > 1e-4
    || Math.abs((terrain.pointCountZ - 1) * terrain.spacingM - terrain.worldDepthM) > 1e-4) {
    return "The terrain snapshot dimensions do not match its spacing and point counts.";
  }
  if (input.edgeClearanceM * 2 >= terrain.worldWidthM || input.edgeClearanceM * 2 >= terrain.worldDepthM) {
    return "The world-edge clearance leaves no routable terrain.";
  }
  if (!insideClearance(input.start, input.edgeClearanceM, terrain)
    || !insideClearance(input.end, input.edgeClearanceM, terrain)) {
    return "Both route endpoints must be inside the world-edge clearance.";
  }
  return null;
}

function anchoredAxis(anchor: number, minimum: number, maximum: number, step: number): number[] {
  const lowerCount = Math.floor((anchor - minimum) / step + EPSILON);
  const upperCount = Math.floor((maximum - anchor) / step + EPSILON);
  const values: number[] = [];
  for (let offset = lowerCount; offset >= 1; offset -= 1) values.push(anchor - offset * step);
  values.push(anchor);
  for (let offset = 1; offset <= upperCount; offset += 1) values.push(anchor + offset * step);
  return values;
}

function buildGoalConnectors(
  end: PointTuple,
  xValues: readonly number[],
  zValues: readonly number[],
  input: RoadRouteInput,
  terrain: RoadRouteTerrainSnapshot,
  rejectionCounts: Map<string, number>,
): Map<number, GoalConnector> {
  const nearestX = nearestAxisIndex(xValues, end[0]);
  const nearestZ = nearestAxisIndex(zValues, end[1]);
  const connectors = new Map<number, GoalConnector>();
  for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      const xIndex = nearestX + xOffset;
      const zIndex = nearestZ + zOffset;
      if (xIndex < 0 || zIndex < 0 || xIndex >= xValues.length || zIndex >= zValues.length) continue;
      const node = zIndex * xValues.length + xIndex;
      const point = pointForNode(node, xValues, zValues);
      const analysis = analyzeSegment(point, end, input, terrain);
      if (!analysis.traversable) {
        incrementRejection(rejectionCounts, "maximum_grade");
        continue;
      }
      const length = analysis.lengthM;
      connectors.set(node, {
        analysis,
        direction: length <= EPSILON ? null : [(end[0] - point[0]) / length, (end[1] - point[1]) / length],
      });
    }
  }
  return connectors;
}

function analyzeSegment(
  start: PointTuple,
  end: PointTuple,
  input: RoadRouteInput,
  terrain: RoadRouteTerrainSnapshot,
): SegmentAnalysis {
  const lengthM = distance(start, end);
  if (lengthM <= EPSILON) return { traversable: true, lengthM: 0, maximumGrade: 0, weightedGrade: 0, cost: 0 };
  const sampleSpacing = Math.max(0.01, Math.min(terrain.spacingM, input.gridStepM) * 0.5);
  const sampleCount = Math.max(1, Math.ceil(lengthM / sampleSpacing));
  const movementDistance = lengthM / sampleCount;
  let previousHeight = heightAt(terrain, start[0], start[1]);
  let maximumGrade = 0;
  let weightedGrade = 0;
  let cost = 0;
  for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
    const t = sampleIndex / sampleCount;
    const height = heightAt(
      terrain,
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    );
    const grade = Math.abs(height - previousHeight) / movementDistance;
    maximumGrade = Math.max(maximumGrade, grade);
    weightedGrade += grade * movementDistance;
    cost += movementDistance * (1 + input.slopeWeight * grade * grade);
    previousHeight = height;
  }
  return {
    traversable: maximumGrade <= input.maximumGrade + EPSILON,
    lengthM,
    maximumGrade,
    weightedGrade,
    cost,
  };
}

function analyzePolyline(
  points: readonly PointTuple[],
  input: RoadRouteInput,
  terrain: RoadRouteTerrainSnapshot,
): PolylineAnalysis {
  if (points.length < 2 || !points.every((point) => insideClearance(point, input.edgeClearanceM, terrain))) {
    return { valid: false, lengthM: 0, maximumGrade: 0, meanGrade: 0 };
  }
  let lengthM = 0;
  let maximumGrade = 0;
  let weightedGrade = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) return { valid: false, lengthM: 0, maximumGrade: 0, meanGrade: 0 };
    const segment = analyzeSegment(previous, current, input, terrain);
    if (!segment.traversable) return { valid: false, lengthM: 0, maximumGrade: segment.maximumGrade, meanGrade: 0 };
    lengthM += segment.lengthM;
    maximumGrade = Math.max(maximumGrade, segment.maximumGrade);
    weightedGrade += segment.weightedGrade;
  }
  return { valid: true, lengthM, maximumGrade, meanGrade: lengthM <= EPSILON ? 0 : weightedGrade / lengthM };
}

function heightAt(terrain: RoadRouteTerrainSnapshot, xM: number, zM: number): number {
  const gridX = xM / terrain.spacingM;
  const gridZ = zM / terrain.spacingM;
  const cellCountX = terrain.pointCountX - 1;
  const cellCountZ = terrain.pointCountZ - 1;
  const x = Math.min(Math.max(0, Math.floor(gridX)), cellCountX - 1);
  const z = Math.min(Math.max(0, Math.floor(gridZ)), cellCountZ - 1);
  const localX = gridX - x;
  const localZ = gridZ - z;
  const nw = terrain.heights[z * terrain.pointCountX + x];
  const ne = terrain.heights[z * terrain.pointCountX + x + 1];
  const sw = terrain.heights[(z + 1) * terrain.pointCountX + x];
  const se = terrain.heights[(z + 1) * terrain.pointCountX + x + 1];
  if (nw === undefined || ne === undefined || sw === undefined || se === undefined) {
    throw new Error("terrain snapshot lookup addressed a missing elevation");
  }
  return localZ <= localX
    ? nw + localX * (ne - nw) + localZ * (se - ne)
    : nw + localZ * (sw - nw) + localX * (se - sw);
}

function reconstructPoints(
  goalState: number,
  cameFrom: Int32Array,
  xValues: readonly number[],
  zValues: readonly number[],
  start: PointTuple,
  end: PointTuple,
): PointTuple[] {
  const reversed: PointTuple[] = [];
  let state = goalState;
  while (state >= 0) {
    reversed.push(pointForNode(nodeFromState(state), xValues, zValues));
    state = cameFrom[state] ?? -1;
  }
  reversed.reverse();
  const points: PointTuple[] = [start];
  for (const point of reversed) pushUnique(points, point);
  pushUnique(points, end);
  return points;
}

function simplifyCollinear(points: readonly PointTuple[]): PointTuple[] {
  if (points.length <= 2) return [...points];
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return [];
  const output: PointTuple[] = [firstPoint];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = output[output.length - 1];
    const current = points[index];
    const next = points[index + 1];
    if (!previous || !current || !next) continue;
    const ax = current[0] - previous[0];
    const az = current[1] - previous[1];
    const bx = next[0] - current[0];
    const bz = next[1] - current[1];
    const cross = ax * bz - az * bx;
    const scale = Math.max(1, Math.hypot(ax, az) * Math.hypot(bx, bz));
    if (Math.abs(cross) <= EPSILON * scale && ax * bx + az * bz >= 0) continue;
    output.push(current);
  }
  output.push(lastPoint);
  return output;
}

function chaikin(points: readonly PointTuple[], iterations: number): PointTuple[] {
  if (points.length <= 2) return [...points];
  let output = [...points];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const firstPoint = output[0];
    const lastPoint = output[output.length - 1];
    if (!firstPoint || !lastPoint) return [];
    const next: PointTuple[] = [firstPoint];
    for (let index = 0; index < output.length - 1; index += 1) {
      const first = output[index];
      const second = output[index + 1];
      if (!first || !second) continue;
      next.push(
        [first[0] * 0.75 + second[0] * 0.25, first[1] * 0.75 + second[1] * 0.25],
        [first[0] * 0.25 + second[0] * 0.75, first[1] * 0.25 + second[1] * 0.75],
      );
    }
    next.push(lastPoint);
    output = next;
  }
  return output;
}

function routeMetrics(output: RoadRouteOutput): readonly GenerationMetric[] {
  return [
    { name: "visited_nodes", value: output.visitedNodes, unit: "nodes" },
    { name: "path_length", value: output.pathLengthM, unit: "m" },
    { name: "maximum_grade", value: output.maximumGrade, unit: "ratio" },
    { name: "mean_grade", value: output.meanGrade, unit: "ratio" },
    { name: "route_cost", value: output.cost, unit: null },
    { name: "elapsed", value: output.elapsedMs, unit: "ms" },
  ];
}

function failure(
  request: RoadRouteRequest,
  reason: GenerationFailureReason,
  message: string,
  startedAt: number,
  visitedNodes: number,
  rejectionCounts: ReadonlyMap<string, number>,
): RoadRouteResult {
  const elapsedMs = performance.now() - startedAt;
  return {
    operationId: request.operationId,
    kind: "road_route",
    status: "failure",
    reason,
    diagnostics: [{ severity: "error", code: reason, message }],
    metrics: [
      { name: "visited_nodes", value: visitedNodes, unit: "nodes" },
      { name: "elapsed", value: elapsedMs, unit: "ms" },
    ],
    rejections: rejectionEntries(rejectionCounts),
  };
}

function rejectionEntries(counts: ReadonlyMap<string, number>): readonly GenerationRejectionCount[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ reason, count }));
}

function incrementRejection(counts: Map<string, number>, reason: string): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

function pointForNode(node: number, xValues: readonly number[], zValues: readonly number[]): PointTuple {
  const x = xValues[node % xValues.length];
  const z = zValues[Math.floor(node / xValues.length)];
  if (x === undefined || z === undefined) throw new Error("routing grid addressed a missing node");
  return [x, z];
}

function nearestAxisIndex(values: readonly number[], coordinate: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  values.forEach((value, index) => {
    const candidateDistance = Math.abs(value - coordinate);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function stateIndex(node: number, previousDirection: number): number {
  return node * STATE_SLOTS_PER_NODE + previousDirection + 1;
}

function nodeFromState(state: number): number {
  return Math.floor(state / STATE_SLOTS_PER_NODE);
}

function directionFromState(state: number): number {
  return state % STATE_SLOTS_PER_NODE - 1;
}

function discreteTurnPenalty(previousDirection: number, nextDirection: number, penaltyM: number): number {
  if (previousDirection < 0 || penaltyM === 0) return 0;
  const difference = Math.abs(previousDirection - nextDirection);
  const steps = Math.min(difference, DIRECTION_COUNT - difference);
  return penaltyM * (1 - Math.cos(steps * Math.PI / 4));
}

function previousDirectionVector(directionIndex: number): PointTuple | null {
  if (directionIndex < 0) return null;
  const direction = DIRECTIONS[directionIndex];
  if (!direction) return null;
  const length = Math.hypot(direction.dx, direction.dz);
  return [direction.dx / length, direction.dz / length];
}

function vectorTurnPenalty(previous: PointTuple | null, next: PointTuple, penaltyM: number): number {
  if (!previous || penaltyM === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, previous[0] * next[0] + previous[1] * next[1]));
  return penaltyM * (1 - cosine);
}

function insideClearance(
  point: PointTuple,
  clearance: number,
  terrain: Pick<RoadRouteTerrainSnapshot, "worldWidthM" | "worldDepthM">,
): boolean {
  return point[0] >= clearance - EPSILON
    && point[0] <= terrain.worldWidthM - clearance + EPSILON
    && point[1] >= clearance - EPSILON
    && point[1] <= terrain.worldDepthM - clearance + EPSILON;
}

function pushUnique(points: PointTuple[], point: PointTuple): void {
  const previous = points[points.length - 1];
  if (previous && distance(previous, point) <= EPSILON) return;
  points.push(point);
}

function finitePoint(point: PointTuple): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function distance(first: PointTuple, second: PointTuple): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}
