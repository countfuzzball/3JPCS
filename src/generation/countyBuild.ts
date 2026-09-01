import type { GenerationDiagnostic, GenerationMetric } from "./contracts";
import {
  buildPolylineMetrics,
  clipPolylineToPolygon,
  convexPolygonsOverlapStrict,
  GEOMETRY_EPSILON,
  pointInPolygon,
  pointSegmentDistance,
  projectPointToPolyline,
  segmentDistance,
} from "./geometry";
import {
  copyRoadRouteTerrain,
  routeRoad,
  type RoadRouteInput,
  type RoadRouteTerrainSnapshot,
} from "./roadRouting";
import { SeededRandom } from "./seededRandom";
import {
  buildSettlementFrontagePlan,
  detectRoadJunctions,
  type SettlementFrontageSettings,
} from "./settlementFrontage";
import {
  gradeToDegrees,
  runSettlementSurvey,
  settlementSurveyProfile,
  type SettlementSurveyProfileId,
} from "./settlementSurvey";
import { prefabFootprint, rotateLocalPoint } from "../interaction/prefabEditing";
import {
  DEFAULT_TERRAIN_PAD,
  type AuthoredEntity,
  type PlaceRegion,
  type PlaceType,
  type PointTuple,
  type PrefabInstance,
  type Road,
  type RoadClass,
  type RoadSurface,
  type WorldBounds,
} from "../model/entities";
import { ContractError } from "../model/errors";
import type { TerrainSurface } from "../terrain/TerrainSurface";

export const COUNTY_BUILD_POLICY_VERSION = 1;
export const COUNTY_BUILDING_ROLES = [
  "house",
  "shop",
  "civic",
  "farmhouse",
  "barn",
  "shed",
  "warehouse",
] as const;
export const COUNTY_STREET_STYLES = ["planned", "organic", "roadside", "agricultural"] as const;
export const COUNTY_ROAD_ROLES = [
  "backbone",
  "access",
  "plot",
  "terminal",
  "loop",
  "farm_yard",
  "property_access",
] as const;

export type CountyBuildingRole = typeof COUNTY_BUILDING_ROLES[number];
export type CountyStreetStyle = typeof COUNTY_STREET_STYLES[number];
export type CountyRoadRole = typeof COUNTY_ROAD_ROLES[number];
export type CountySourceMode = "survey" | "existing_places";
export type CountyOutputMode = "full" | "network_only";
export type CountySiteMix = "balanced" | "urban" | "rural";
export type CountyBackboneOrientation = "auto" | "west_east" | "north_south";

export interface CountyAssetChoice {
  readonly assetId: string;
  readonly category: string;
  readonly displayName: string;
  readonly widthM: number;
  readonly depthM: number;
}

export type CountyAssetProgram = Readonly<Record<CountyBuildingRole, readonly CountyAssetChoice[]>>;

export interface CountyRoadStyle {
  readonly roadClass: RoadClass;
  readonly surface: RoadSurface;
  readonly widthM: number;
}

export interface CountyRoadStyles {
  readonly backbone: CountyRoadStyle;
  readonly access: CountyRoadStyle;
  readonly local: CountyRoadStyle;
  readonly terminal: CountyRoadStyle;
  readonly farmYard: CountyRoadStyle;
  readonly driveway: CountyRoadStyle;
}

export interface CountySurveyPolicy {
  readonly minimumSeparationM: number;
  readonly edgeClearanceM: number;
  readonly preferredElevationM: number | null;
  readonly attemptBudgetPerSite: number;
  readonly radiusScale: number;
  readonly siteMix: CountySiteMix;
}

export interface CountyLocalStreetPolicy {
  readonly edgeClearanceM: number;
  readonly minimumRoadLengthM: number;
  readonly sampleStepM: number;
  readonly maximumGrade: number;
}

export interface CountyBuildBudgets {
  readonly maximumRoutes: number;
  readonly maximumVisitedNodes: number;
  readonly maximumPrefabs: number;
  readonly maximumDriveways: number;
}

export interface CountyFrontagePolicy extends SettlementFrontageSettings {
  readonly drivewaysEnabled: boolean;
}

export interface CountyBuildInput {
  readonly outputMode: CountyOutputMode;
  readonly sourceMode: CountySourceMode;
  readonly desiredSettlementCount: number;
  readonly selectedExistingPlaceIds: readonly string[];
  readonly mainPlaceIdOverride: string | null;
  readonly existingPlaces: readonly PlaceRegion[];
  readonly existingRoads: readonly Road[];
  readonly existingPrefabFootprints: readonly (readonly PointTuple[])[];
  readonly createBackbone: boolean;
  readonly backboneOrientation: CountyBackboneOrientation;
  readonly routing: Omit<RoadRouteInput, "start" | "end">;
  readonly roadStyles: CountyRoadStyles;
  readonly survey: CountySurveyPolicy;
  readonly localStreets: CountyLocalStreetPolicy;
  readonly styleByProfile: Readonly<Record<SettlementSurveyProfileId, CountyStreetStyle>>;
  readonly budgets: CountyBuildBudgets;
  readonly frontage: CountyFrontagePolicy;
  readonly assetProgram: CountyAssetProgram;
  readonly seed: number;
  readonly sourceRevision: number;
}

export interface CountyBuildTerrainSnapshot extends RoadRouteTerrainSnapshot {
  readonly minimumElevationM: number;
  readonly seaLevelM: number;
  readonly lowlandReferenceElevationM: number;
  readonly maximumElevationM: number;
}

export interface CountyPlannedPlace {
  readonly planId: string;
  readonly existingEntityId: string | null;
  readonly name: string;
  readonly placeType: PlaceType;
  readonly surveyProfile: SettlementSurveyProfileId;
  readonly style: CountyStreetStyle;
  readonly rank: number;
  readonly center: PointTuple;
  readonly anchor: PointTuple;
  readonly radiusM: number;
  readonly points: readonly PointTuple[];
  readonly score: number | null;
}

export interface CountyPlannedRoad {
  readonly planId: string;
  readonly name: string;
  readonly role: CountyRoadRole;
  readonly ownerPlacePlanId: string | null;
  readonly points: readonly PointTuple[];
  readonly widthM: number;
  readonly roadClass: RoadClass;
  readonly surface: RoadSurface;
  readonly plotEligible: boolean;
  readonly lengthM: number;
  readonly maximumGrade: number;
}

export interface CountyPlannedJunction {
  readonly point: PointTuple;
  readonly roadIds: readonly string[];
  readonly ownerPlacePlanId: string | null;
  readonly clearanceRadiusM: number;
}

export interface CountyPlannedPrefab {
  readonly planId: string;
  readonly ownerPlacePlanId: string;
  readonly role: CountyBuildingRole;
  readonly assetId: string;
  readonly category: string;
  readonly displayName: string;
  readonly xM: number;
  readonly zM: number;
  readonly rotationDeg: number;
  readonly frontageRoadId: string;
  readonly footprint: readonly PointTuple[];
  readonly drivewayRoadPlanId: string | null;
}

export interface CountySkippedCandidate {
  readonly ownerPlacePlanId: string;
  readonly point: PointTuple;
  readonly reason: string;
}

export interface CountyPlaceResult {
  readonly placePlanId: string;
  readonly connected: boolean;
  readonly accessRoadId: string | null;
  readonly localRoadCount: number;
  readonly buildingCount: number;
  readonly skippedBuildingCount: number;
}

export interface CountyBuildPlan {
  readonly policyVersion: typeof COUNTY_BUILD_POLICY_VERSION;
  readonly sourceRevision: number;
  readonly seed: number;
  readonly outputMode: CountyOutputMode;
  readonly mainPlacePlanId: string;
  readonly places: readonly CountyPlannedPlace[];
  readonly roads: readonly CountyPlannedRoad[];
  readonly junctions: readonly CountyPlannedJunction[];
  readonly prefabs: readonly CountyPlannedPrefab[];
  readonly skippedCandidates: readonly CountySkippedCandidate[];
  readonly placeResults: readonly CountyPlaceResult[];
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly metrics: readonly GenerationMetric[];
  readonly complete: boolean;
}

export interface CountyBuildRequest {
  readonly operationId: number;
  readonly kind: "county_build";
  readonly seed: number;
  readonly input: CountyBuildInput;
}

export type CountyBuildFailureReason = "invalid_request" | "no_valid_result" | "internal_error";

export type CountyBuildResult = {
  readonly operationId: number;
  readonly kind: "county_build";
  readonly status: "success";
  readonly output: CountyBuildPlan;
} | {
  readonly operationId: number;
  readonly kind: "county_build";
  readonly status: "failure";
  readonly reason: CountyBuildFailureReason;
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly metrics: readonly GenerationMetric[];
};

export interface CountyBuildProgress {
  readonly operationId: number;
  readonly phase: "survey" | "backbone" | "connections" | "streets" | "junctions" | "buildings" | "validation";
  readonly completed: number;
  readonly total: number;
  readonly message: string;
}

export type CountyBuildProgressReporter = (progress: Omit<CountyBuildProgress, "operationId">) => void;

interface RoadReference {
  readonly id: string;
  readonly points: readonly PointTuple[];
  readonly widthM: number;
  readonly roadClass: RoadClass;
  readonly surface: RoadSurface;
  readonly planned: CountyPlannedRoad | null;
}

export interface CountySettlementFrame {
  readonly anchor: PointTuple;
  readonly along: PointTuple;
  readonly normal: PointTuple;
  readonly negativeU: number;
  readonly positiveU: number;
  readonly negativeV: number;
  readonly positiveV: number;
}

interface MutablePlaceResult {
  placePlanId: string;
  connected: boolean;
  accessRoadId: string | null;
  localRoadCount: number;
  buildingCount: number;
  skippedBuildingCount: number;
}

const BUILDING_TARGETS: Readonly<Record<SettlementSurveyProfileId, readonly [number, number]>> = {
  town: [85, 105],
  village: [34, 50],
  hamlet: [13, 22],
  farm: [5, 9],
};

export const DEFAULT_COUNTY_ROAD_STYLES: CountyRoadStyles = Object.freeze({
  backbone: Object.freeze({ roadClass: "county_road", surface: "paved", widthM: 9 }),
  access: Object.freeze({ roadClass: "local_road", surface: "gravel", widthM: 6 }),
  local: Object.freeze({ roadClass: "local_road", surface: "gravel", widthM: 4.4 }),
  terminal: Object.freeze({ roadClass: "lane", surface: "gravel", widthM: 3.9 }),
  farmYard: Object.freeze({ roadClass: "farm_track", surface: "dirt", widthM: 3.5 }),
  driveway: Object.freeze({ roadClass: "lane", surface: "gravel", widthM: 2.8 }),
});

/** Copies every terrain value needed by survey, routing, local validation, and frontage. */
export function copyCountyBuildTerrain(surface: TerrainSurface): CountyBuildTerrainSnapshot {
  return {
    ...copyRoadRouteTerrain(surface),
    minimumElevationM: surface.minimumElevationM,
    seaLevelM: surface.seaLevelM,
    lowlandReferenceElevationM: surface.lowlandReferenceElevationM,
    maximumElevationM: surface.maximumElevationM,
  };
}

/** Stable keyed seed streams keep unrelated stages unchanged when optional policy changes. */
export function countyNamedSeed(seed: number, key: string): number {
  if (!Number.isSafeInteger(seed)) throw new ContractError("county seed must be a safe integer");
  let value = (seed ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** Deterministically derives a safe interior anchor for convex or concave polygons. */
export function settlementInteriorAnchor(points: readonly PointTuple[]): PointTuple {
  if (points.length < 3) throw new ContractError("settlement polygon requires at least three points");
  const centroid = polygonCentroid(points);
  if (pointInPolygon({ x: centroid[0], z: centroid[1] }, points)
    && pointPolygonBoundaryDistance(centroid, points) > GEOMETRY_EPSILON) return centroid;
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minZ = Math.min(...zs);
  let maxZ = Math.max(...zs);
  let best: PointTuple | null = null;
  let bestClearance = -1;
  for (let refinement = 0; refinement < 5; refinement += 1) {
    const steps = 16;
    for (let zIndex = 0; zIndex <= steps; zIndex += 1) {
      for (let xIndex = 0; xIndex <= steps; xIndex += 1) {
        const point: PointTuple = [
          minX + (maxX - minX) * xIndex / steps,
          minZ + (maxZ - minZ) * zIndex / steps,
        ];
        if (!pointInPolygon({ x: point[0], z: point[1] }, points)) continue;
        const clearance = pointPolygonBoundaryDistance(point, points);
        if (clearance > bestClearance + GEOMETRY_EPSILON
          || (Math.abs(clearance - bestClearance) <= GEOMETRY_EPSILON && best
            && (point[0] < best[0] || (point[0] === best[0] && point[1] < best[1])))) {
          best = point;
          bestClearance = clearance;
        }
      }
    }
    if (!best) break;
    const halfWidth = (maxX - minX) / steps;
    const halfDepth = (maxZ - minZ) / steps;
    minX = best[0] - halfWidth;
    maxX = best[0] + halfWidth;
    minZ = best[1] - halfDepth;
    maxZ = best[1] + halfDepth;
  }
  if (!best) throw new ContractError("settlement polygon contains no usable interior anchor");
  return best;
}

/** Creates a complete, non-mutating county plan against one immutable terrain snapshot. */
export function buildCountyPlan(
  request: CountyBuildRequest,
  snapshot: CountyBuildTerrainSnapshot,
  reportProgress: CountyBuildProgressReporter = () => undefined,
): CountyBuildResult {
  const started = performance.now();
  try {
    validateCountyBuildRequest(request, snapshot);
    const input = request.input;
    const terrain = new SnapshotTerrainSurface(snapshot);
    const world: WorldBounds = { widthM: terrain.worldWidthM, depthM: terrain.worldDepthM };
    const diagnostics: GenerationDiagnostic[] = [];
    const places = input.sourceMode === "survey"
      ? surveyCountyPlaces(input, terrain, diagnostics, reportProgress)
      : existingCountyPlaces(input, diagnostics, reportProgress);
    if (places.length === 0) {
      return countyFailure(request, "no_valid_result", "No settlement sites are available for the county build.", started);
    }

    const roads: CountyPlannedRoad[] = [];
    const growingNetwork: RoadReference[] = input.existingRoads
      .filter((road) => road.visible)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(roadReference);
    const placeResults = new Map<string, MutablePlaceResult>(places.map((place) => [place.planId, {
      placePlanId: place.planId,
      connected: false,
      accessRoadId: null,
      localRoadCount: 0,
      buildingCount: 0,
      skippedBuildingCount: 0,
    }]));
    const accessRoadIds = new Map<string, string>();
    let routeCount = 0;
    let visitedNodes = 0;
    let fatal = false;

    const main = resolveMainPlace(places, input.mainPlaceIdOverride);
    if (!main) throw new ContractError("county plan has no main settlement");
    if (input.createBackbone) {
      reportProgress({ phase: "backbone", completed: 0, total: 2, message: "Routing the county backbone" });
      const gates = backboneGates(main.anchor, input.backboneOrientation, world, input.routing.edgeClearanceM, input.roadStyles.backbone.widthM);
      const left = routeOne(request, snapshot, gates[0], main.anchor, "backbone:a");
      routeCount += 1;
      if (left.status === "success") visitedNodes += left.output.visitedNodes;
      reportProgress({ phase: "backbone", completed: 1, total: 2, message: "Routing the second backbone leg" });
      const right = routeOne(request, snapshot, main.anchor, gates[1], "backbone:b");
      routeCount += 1;
      if (right.status === "success") visitedNodes += right.output.visitedNodes;
      if (routeCount > input.budgets.maximumRoutes || visitedNodes > input.budgets.maximumVisitedNodes) {
        diagnostics.push({ severity: "error", code: "county_route_budget", message: "The county backbone exhausted the whole-build route or visited-node budget." });
        fatal = true;
      } else if (left.status === "success" && right.status === "success") {
        const points = dedupePolyline([...left.output.points, ...right.output.points.slice(1)]);
        const analysis = analyzeRoad(points, terrain);
        const backbone = plannedRoad(
          `county-road-backbone-1`,
          "County Backbone",
          "backbone",
          main.planId,
          points,
          input.roadStyles.backbone,
          true,
          analysis,
        );
        roads.push(backbone);
        growingNetwork.push(roadReferenceFromPlan(backbone));
        accessRoadIds.set(main.planId, backbone.planId);
        markConnected(placeResults, main.planId, backbone.planId);
      } else {
        diagnostics.push({ severity: "error", code: "backbone_route_failed", message: "The required two-leg county backbone could not be routed." });
        fatal = true;
      }
    }

    const connectionTotal = places.length;
    for (let index = 0; index < places.length; index += 1) {
      const place = places[index];
      if (!place) continue;
      reportProgress({
        phase: "connections",
        completed: index,
        total: connectionTotal,
        message: `Connecting ${place.name}`,
      });
      if (accessRoadIds.has(place.planId)) continue;
      const intersecting = growingNetwork
        .filter((road) => clipPolylineToPolygon(road.points, place.points, world).length > 0)
        .sort((left, right) => left.id.localeCompare(right.id));
      const direct = intersecting[0];
      if (direct) {
        accessRoadIds.set(place.planId, direct.id);
        markConnected(placeResults, place.planId, direct.id);
        continue;
      }
      const connection = nearestNetworkPoint(place.anchor, growingNetwork);
      if (!connection) {
        diagnostics.push({ severity: "error", code: "missing_network_seed", message: `${place.name} has no eligible county network to connect to.` });
        fatal = true;
        continue;
      }
      if (routeCount >= input.budgets.maximumRoutes || visitedNodes >= input.budgets.maximumVisitedNodes) {
        diagnostics.push({ severity: "error", code: "county_route_budget", message: `${place.name} could not be routed because the whole-build route or visited-node budget was exhausted.` });
        fatal = true;
        continue;
      }
      const routed = routeOne(request, snapshot, connection.point, place.anchor, `access:${place.planId}`);
      routeCount += 1;
      if (routed.status !== "success") {
        diagnostics.push({ severity: "error", code: "access_route_failed", message: `${place.name} could not connect to the growing county network.` });
        fatal = true;
        continue;
      }
      visitedNodes += routed.output.visitedNodes;
      if (visitedNodes > input.budgets.maximumVisitedNodes) {
        diagnostics.push({ severity: "error", code: "county_route_budget", message: `${place.name} exceeded the whole-build visited-node budget.` });
        fatal = true;
        continue;
      }
      const style = place.surveyProfile === "farm" ? input.roadStyles.terminal : input.roadStyles.access;
      const planId = `county-road-access-${String(index + 1)}`;
      const road = plannedRoad(
        planId,
        `${place.name} Access Road`,
        "access",
        place.planId,
        routed.output.points,
        style,
        true,
        analyzeRoad(routed.output.points, terrain),
      );
      roads.push(road);
      growingNetwork.push(roadReferenceFromPlan(road));
      accessRoadIds.set(place.planId, road.planId);
      markConnected(placeResults, place.planId, road.planId);
    }

    let localRoadCounter = 0;
    for (let index = 0; index < places.length; index += 1) {
      const place = places[index];
      if (!place || !placeResults.get(place.planId)?.connected) continue;
      reportProgress({ phase: "streets", completed: index, total: places.length, message: `Designing streets for ${place.name}` });
      const accessId = accessRoadIds.get(place.planId);
      const access = accessId ? growingNetwork.find(({ id }) => id === accessId) : undefined;
      if (!access) continue;
      const projection = projectPointToPolyline(buildPolylineMetrics(access.points, world), {
        x: place.anchor[0],
        z: place.anchor[1],
      });
      const frame = deriveCountySettlementFrame(place.points, place.anchor, [projection.tangent.x, projection.tangent.z]);
      const generated = generateLocalStreetPlans(
        place,
        frame,
        input,
        terrain,
        localRoadCounter,
        diagnostics,
      );
      localRoadCounter += generated.length;
      roads.push(...generated);
      generated.forEach((road) => growingNetwork.push(roadReferenceFromPlan(road)));
      const result = placeResults.get(place.planId);
      if (result) result.localRoadCount = generated.length;
    }

    reportProgress({ phase: "junctions", completed: 0, total: 1, message: "Resolving county junctions" });
    const allRoadEntities = [
      ...input.existingRoads.filter(({ visible }) => visible),
      ...roads.map(roadEntityFromPlan),
    ];
    const roadIndex = new RoadSpatialIndex(256, allRoadEntities);
    const junctions = detectRoadJunctions(allRoadEntities).map((junction): CountyPlannedJunction => {
      const owner = places.find((place) => pointInPolygon({ x: junction.point[0], z: junction.point[1] }, place.points));
      const widths = junction.roadIds.map((id) => {
        const existing = input.existingRoads.find((road) => road.id === id);
        return existing?.width_m ?? roads.find((road) => road.planId === id)?.widthM ?? 0;
      });
      return {
        point: junction.point,
        roadIds: junction.roadIds,
        ownerPlacePlanId: owner?.planId ?? null,
        clearanceRadiusM: Math.max(2, ...widths.map((width) => width * 0.72 + 2)),
      };
    });

    reportProgress({ phase: "buildings", completed: 0, total: places.length, message: "Populating county frontage" });
    const prefabs: CountyPlannedPrefab[] = [];
    const drivewayRoads: CountyPlannedRoad[] = [];
    const skippedCandidates: CountySkippedCandidate[] = [];
    const occupiedFootprints = new PolygonSpatialIndex(64, input.existingPrefabFootprints);
    for (let index = 0; input.outputMode === "full" && index < places.length; index += 1) {
      const place = places[index];
      if (!place || !placeResults.get(place.planId)?.connected) continue;
      reportProgress({ phase: "buildings", completed: index, total: places.length, message: `Populating ${place.name}` });
      const population = populateCountyPlace(
        place,
        roadIndex,
        roads,
        input,
        terrain,
        prefabs.length,
        drivewayRoads.length,
        Math.max(0, input.budgets.maximumPrefabs - prefabs.length),
        Math.max(0, input.budgets.maximumDriveways - drivewayRoads.length),
        occupiedFootprints,
        diagnostics,
      );
      prefabs.push(...population.prefabs);
      drivewayRoads.push(...population.driveways);
      skippedCandidates.push(...population.skippedCandidates);
      const result = placeResults.get(place.planId);
      if (result) {
        result.buildingCount = population.prefabs.length;
        result.skippedBuildingCount = population.skipped;
      }
    }
    roads.push(...drivewayRoads);

    const validationFailures = finalCountyValidation(places, roads, prefabs, input, terrain);
    diagnostics.push(...validationFailures);
    if (validationFailures.some(({ severity }) => severity === "error")) fatal = true;

    const requiredHouseAvailable = input.outputMode === "network_only" || input.assetProgram.house.length > 0;
    if (!requiredHouseAvailable) {
      diagnostics.push({ severity: "error", code: "missing_house_asset", message: "Build County requires at least one mapped house asset." });
      fatal = true;
    }
    if (input.outputMode === "full" && prefabs.length === 0) {
      diagnostics.push({ severity: "warning", code: "no_buildings", message: "No safe frontage buildings were generated." });
    }
    reportProgress({ phase: "validation", completed: 1, total: 1, message: "Validating the complete county plan" });
    const metrics: readonly GenerationMetric[] = [
      { name: "settlements", value: places.length, unit: "places" },
      { name: "planned_roads", value: roads.length, unit: "roads" },
      { name: "junctions", value: junctions.length, unit: "junctions" },
      { name: "planned_prefabs", value: prefabs.length, unit: "prefabs" },
      { name: "driveways", value: drivewayRoads.length, unit: "roads" },
      { name: "routes", value: routeCount, unit: "routes" },
      { name: "visited_nodes", value: visitedNodes, unit: "nodes" },
      { name: "elapsed", value: performance.now() - started, unit: "ms" },
    ];
    const complete = !fatal && places.length === input.desiredSettlementCount
      && [...placeResults.values()].every(({ connected }) => connected);
    diagnostics.push({
      severity: complete ? "info" : "warning",
      code: complete ? "county_plan_complete" : "county_plan_incomplete",
      message: complete
        ? `Complete county preview: ${String(places.length)} settlements, ${String(roads.length)} roads and ${String(prefabs.length)} buildings.`
        : "The county preview is incomplete and cannot be baked until its fatal diagnostics are resolved.",
    });
    return {
      operationId: request.operationId,
      kind: "county_build",
      status: "success",
      output: {
        policyVersion: COUNTY_BUILD_POLICY_VERSION,
        sourceRevision: input.sourceRevision,
        seed: input.seed,
        outputMode: input.outputMode,
        mainPlacePlanId: main.planId,
        places: Object.freeze(places),
        roads: Object.freeze(roads),
        junctions: Object.freeze(junctions),
        prefabs: Object.freeze(prefabs),
        skippedCandidates: Object.freeze(skippedCandidates),
        placeResults: Object.freeze([...placeResults.values()].map((entry) => Object.freeze({ ...entry }))),
        diagnostics: Object.freeze(diagnostics),
        metrics,
        complete,
      },
    };
  } catch (error) {
    return countyFailure(
      request,
      error instanceof ContractError ? "invalid_request" : "internal_error",
      error instanceof Error ? error.message : String(error),
      started,
    );
  }
}

/** Resolves plan-local IDs to final UUIDs and creates one mixed entity collection. */
export function materializeCountyPlan(
  plan: CountyBuildPlan,
  existingNames: readonly string[],
  createId: () => string,
): readonly AuthoredEntity[] {
  if (!plan.complete) throw new ContractError("an incomplete county plan cannot be baked");
  const usedNames = new Set(existingNames);
  const placeIds = new Map<string, string>();
  const roadIds = new Map<string, string>();
  for (const place of plan.places) {
    if (!place.existingEntityId) placeIds.set(place.planId, createId());
  }
  for (const road of plan.roads) roadIds.set(road.planId, createId());
  const places: PlaceRegion[] = plan.places
    .filter((place) => place.existingEntityId === null)
    .map((place) => ({
      kind: "place",
      id: requiredMapping(placeIds, place.planId, "place"),
      name: uniqueName(place.name, usedNames),
      visible: true,
      locked: false,
      place_type: place.placeType,
      points: place.points,
    }));
  const roads: Road[] = plan.roads.map((road) => ({
    kind: "road",
    id: requiredMapping(roadIds, road.planId, "road"),
    name: uniqueName(road.name, usedNames),
    visible: true,
    locked: false,
    points: road.points,
    width_m: road.widthM,
    road_class: road.roadClass,
    surface: road.surface,
  }));
  const prefabs: PrefabInstance[] = plan.prefabs.map((prefab) => ({
    kind: "prefab",
    id: createId(),
    name: uniqueName(prefab.displayName, usedNames),
    visible: true,
    locked: false,
    category: prefab.category,
    asset_id: prefab.assetId,
    x_m: prefab.xM,
    z_m: prefab.zM,
    rotation_deg: prefab.rotationDeg,
    scale: 1,
    frontage_road_id: roadIds.get(prefab.frontageRoadId) ?? prefab.frontageRoadId,
    terrain_pad: { ...DEFAULT_TERRAIN_PAD, enabled: false },
  }));
  return Object.freeze([...places, ...roads, ...prefabs]);
}

function surveyCountyPlaces(
  input: CountyBuildInput,
  terrain: TerrainSurface,
  diagnostics: GenerationDiagnostic[],
  reportProgress: CountyBuildProgressReporter,
): CountyPlannedPlace[] {
  const profiles = automaticProfileSequence(input.desiredSettlementCount, input.survey.siteMix);
  const workingPlaces: PlaceRegion[] = [...input.existingPlaces];
  const planned: CountyPlannedPlace[] = [];
  for (let index = 0; index < profiles.length; index += 1) {
    const profileId = profiles[index];
    if (!profileId) continue;
    reportProgress({ phase: "survey", completed: index, total: profiles.length, message: `Surveying ${profileId} site ${String(index + 1)} of ${String(profiles.length)}` });
    const profile = settlementSurveyProfile(profileId);
    const result = runSettlementSurvey(terrain, workingPlaces, {
      profile: profileId,
      desiredCount: 1,
      radiusM: profile.radiusM * input.survey.radiusScale,
      maximumSlopeDeg: gradeToDegrees(profile.maximumGrade),
      minimumSeparationM: input.survey.minimumSeparationM,
      edgeClearanceM: input.survey.edgeClearanceM,
      preferredElevationM: input.survey.preferredElevationM,
      seed: countyNamedSeed(input.seed, `survey:${profileId}:${String(index)}`),
      attemptBudget: input.survey.attemptBudgetPerSite,
    });
    if (result.status !== "success") {
      diagnostics.push({ severity: "error", code: "settlement_site_missing", message: `No valid ${profile.label.toLowerCase()} site was found for slot ${String(index + 1)}.` });
      continue;
    }
    const candidate = result.output.candidates[0];
    if (!candidate) continue;
    const planId = `county-place-${String(index + 1)}`;
    const name = profileId === "town" ? "County Town" : profileId === "farm" ? `Farm ${String(index + 1)}` : `Settlement ${String(index + 1)}`;
    const place: CountyPlannedPlace = {
      planId,
      existingEntityId: null,
      name,
      placeType: candidate.placeType,
      surveyProfile: profileId,
      style: input.styleByProfile[profileId],
      rank: index + 1,
      center: candidate.center,
      anchor: settlementInteriorAnchor(candidate.boundary),
      radiusM: candidate.radiusM,
      points: candidate.boundary,
      score: candidate.score,
    };
    planned.push(place);
    workingPlaces.push({
      kind: "place",
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name,
      visible: true,
      locked: false,
      place_type: candidate.placeType,
      points: candidate.boundary,
    });
  }
  return planned;
}

function existingCountyPlaces(
  input: CountyBuildInput,
  diagnostics: GenerationDiagnostic[],
  reportProgress: CountyBuildProgressReporter,
): CountyPlannedPlace[] {
  const selected = new Set(input.selectedExistingPlaceIds);
  const places = input.existingPlaces
    .filter((place) => place.visible && place.place_type !== "military_area" && selected.has(place.id))
    .sort((left, right) => input.selectedExistingPlaceIds.indexOf(left.id) - input.selectedExistingPlaceIds.indexOf(right.id)
      || left.id.localeCompare(right.id))
    .slice(0, input.desiredSettlementCount)
    .map((place, index): CountyPlannedPlace => {
      reportProgress({ phase: "survey", completed: index, total: input.desiredSettlementCount, message: `Preparing ${place.name}` });
      const profile = profileForPlace(place, index);
      const center = polygonCentroid(place.points);
      return {
        planId: `county-place-existing-${String(index + 1)}`,
        existingEntityId: place.id,
        name: place.name,
        placeType: place.place_type,
        surveyProfile: profile,
        style: input.styleByProfile[profile],
        rank: index + 1,
        center,
        anchor: settlementInteriorAnchor(place.points),
        radiusM: equivalentRadius(place.points),
        points: place.points,
        score: null,
      };
    });
  if (places.length < input.desiredSettlementCount) diagnostics.push({
    severity: "error",
    code: "existing_place_shortfall",
    message: `Only ${String(places.length)} of ${String(input.desiredSettlementCount)} requested visible existing places are available.`,
  });
  return places;
}

function automaticProfileSequence(count: number, mix: CountySiteMix): readonly SettlementSurveyProfileId[] {
  return Array.from({ length: count }, (_, index): SettlementSurveyProfileId => {
    if (index === 0) return "town";
    if (mix === "urban") return index % 4 === 0 ? "hamlet" : "village";
    if (mix === "rural") return index % 3 === 0 ? "village" : index % 2 === 0 ? "farm" : "hamlet";
    if (count >= 4 && index === count - 1) return "farm";
    return index % 3 === 0 ? "hamlet" : "village";
  });
}

function profileForPlace(place: PlaceRegion, index: number): SettlementSurveyProfileId {
  if (place.place_type === "town") return "town";
  if (place.place_type === "farm") return "farm";
  return index % 3 === 0 && equivalentRadius(place.points) < 230 ? "hamlet" : "village";
}

function resolveMainPlace(
  places: readonly CountyPlannedPlace[],
  override: string | null,
): CountyPlannedPlace | undefined {
  if (override) {
    const explicit = places.find((place) => place.planId === override || place.existingEntityId === override);
    if (explicit) return explicit;
  }
  return places.find(({ surveyProfile }) => surveyProfile === "town") ?? places[0];
}

function backboneGates(
  anchor: PointTuple,
  orientation: CountyBackboneOrientation,
  world: WorldBounds,
  edgeClearanceM: number,
  widthM: number,
): readonly [PointTuple, PointTuple] {
  const inset = Math.max(edgeClearanceM, widthM / 2 + 1);
  const resolved = orientation === "auto"
    ? world.widthM >= world.depthM ? "west_east" : "north_south"
    : orientation;
  if (resolved === "west_east") {
    return [[inset, anchor[1]], [world.widthM - inset, anchor[1]]];
  }
  return [[anchor[0], inset], [anchor[0], world.depthM - inset]];
}

function routeOne(
  request: CountyBuildRequest,
  snapshot: CountyBuildTerrainSnapshot,
  start: PointTuple,
  end: PointTuple,
  key: string,
) {
  return routeRoad({
    operationId: request.operationId,
    kind: "road_route",
    seed: countyNamedSeed(request.seed, key),
    input: { ...request.input.routing, start, end },
  }, snapshot);
}

function nearestNetworkPoint(anchor: PointTuple, network: readonly RoadReference[]): { readonly point: PointTuple; readonly road: RoadReference } | null {
  let best: { point: PointTuple; road: RoadReference; distance: number; fraction: number } | null = null;
  for (const road of network) {
    const projection = projectPointToPolyline(buildPolylineMetrics(road.points), { x: anchor[0], z: anchor[1] });
    if (!best || projection.distanceToPointM < best.distance - GEOMETRY_EPSILON
      || (Math.abs(projection.distanceToPointM - best.distance) <= GEOMETRY_EPSILON
        && (projection.segmentFraction > 0 && projection.segmentFraction < 1) && (best.fraction === 0 || best.fraction === 1))
      || (Math.abs(projection.distanceToPointM - best.distance) <= GEOMETRY_EPSILON && road.id < best.road.id)) {
      best = { point: projection.point, road, distance: projection.distanceToPointM, fraction: projection.segmentFraction };
    }
  }
  return best ? { point: best.point, road: best.road } : null;
}

export function deriveCountySettlementFrame(
  points: readonly PointTuple[],
  anchor: PointTuple,
  tangent: PointTuple,
): CountySettlementFrame {
  const length = Math.hypot(tangent[0], tangent[1]);
  if (length <= GEOMETRY_EPSILON) throw new ContractError("settlement access tangent is degenerate");
  const along: PointTuple = [tangent[0] / length, tangent[1] / length];
  const normal: PointTuple = [-along[1], along[0]];
  let negativeU = 0;
  let positiveU = 0;
  let negativeV = 0;
  let positiveV = 0;
  for (const point of points) {
    const dx = point[0] - anchor[0];
    const dz = point[1] - anchor[1];
    const u = dx * along[0] + dz * along[1];
    const v = dx * normal[0] + dz * normal[1];
    if (u < 0) negativeU = Math.max(negativeU, -u); else positiveU = Math.max(positiveU, u);
    if (v < 0) negativeV = Math.max(negativeV, -v); else positiveV = Math.max(positiveV, v);
  }
  return { anchor, along, normal, negativeU, positiveU, negativeV, positiveV };
}

function generateLocalStreetPlans(
  place: CountyPlannedPlace,
  frame: CountySettlementFrame,
  input: CountyBuildInput,
  terrain: TerrainSurface,
  counterStart: number,
  diagnostics: GenerationDiagnostic[],
): CountyPlannedRoad[] {
  const random = new SeededRandom(countyNamedSeed(input.seed, `streets:${place.planId}:${place.style}`));
  const templates = localTemplates(place, random);
  const roads: CountyPlannedRoad[] = [];
  for (const template of templates) {
    const raw = template.points.map(([u, v]) => framePoint(frame, u, v));
    const style = template.role === "farm_yard"
      ? input.roadStyles.farmYard
      : template.role === "terminal" ? input.roadStyles.terminal : input.roadStyles.local;
    const insetM = style.widthM / 2 + input.localStreets.edgeClearanceM;
    const points = clipCountyStreetToUsablePolygon(raw, place.points, insetM, input.localStreets.sampleStepM, place.anchor);
    if (points.length < 2) {
      diagnostics.push({ severity: "warning", code: "local_street_clipped", message: `${place.name}: ${template.name} was clipped away by its place boundary.` });
      continue;
    }
    const analysis = analyzeRoad(points, terrain);
    if (analysis.lengthM < input.localStreets.minimumRoadLengthM - GEOMETRY_EPSILON) {
      diagnostics.push({ severity: "warning", code: "local_street_short", message: `${place.name}: ${template.name} is below the minimum road length.` });
      continue;
    }
    if (analysis.maximumGrade > input.localStreets.maximumGrade + GEOMETRY_EPSILON) {
      diagnostics.push({ severity: "warning", code: "local_street_grade", message: `${place.name}: ${template.name} exceeds the local-street grade limit.` });
      continue;
    }
    const candidate = plannedRoad(
      `county-road-local-${String(counterStart + roads.length + 1)}`,
      `${place.name} ${template.name}`,
      template.role,
      place.planId,
      points,
      style,
      template.plotEligible,
      analysis,
    );
    if (roads.some((road) => parallelRoadCorridorsOverlap(candidate, road))) {
      diagnostics.push({ severity: "warning", code: "local_street_overlap", message: `${place.name}: ${template.name} overlaps an earlier local street corridor.` });
      continue;
    }
    roads.push(candidate);
  }
  return roads;
}

function localTemplates(
  place: CountyPlannedPlace,
  random: SeededRandom,
): readonly { readonly name: string; readonly role: "plot" | "terminal" | "loop" | "farm_yard"; readonly plotEligible: boolean; readonly points: readonly PointTuple[] }[] {
  const branch = (u: number, side: number): readonly PointTuple[] => [
    [u, 0],
    [u + random.floatBetween(-0.06, 0.08), side * 0.32],
    [u + random.floatBetween(-0.12, 0.12), side * 0.68],
  ];
  if (place.style === "planned" && place.surveyProfile === "town") return [
    { name: "Cross Street", role: "plot", plotEligible: true, points: [[0, -0.78], [0, 0], [0, 0.78]] },
    { name: "Market Loop", role: "loop", plotEligible: true, points: ellipse(0.62, 0.43, 40) },
    { name: "West Branch", role: "terminal", plotEligible: false, points: branch(-0.34, -1) },
    { name: "East Branch", role: "terminal", plotEligible: false, points: branch(0.34, 1) },
    { name: "Lower Cross Link", role: "plot", plotEligible: true, points: [[-0.48, 0.2], [0, 0.22], [0.48, 0.2]] },
  ];
  if (place.style === "planned") return [
    { name: "Main Street", role: "plot", plotEligible: true, points: [[0, 0], [0.44, random.floatBetween(-0.08, 0.08)], [0.88, random.floatBetween(-0.14, 0.14)]] },
    { name: "Cross Street", role: "plot", plotEligible: true, points: [[0, -0.7], [0, 0], [0, 0.7]] },
    { name: "Village Loop", role: "loop", plotEligible: true, points: ellipse(0.52, 0.37, 32) },
  ];
  if (place.style === "organic") return [
    { name: "Winding Street", role: "plot", plotEligible: true, points: [[0, 0], [0.35, random.floatBetween(-0.12, 0.12)], [0.85, random.floatBetween(-0.24, 0.24)]] },
    { name: "Organic Branch", role: "terminal", plotEligible: false, points: branch(0.18, random.nextFloat() < 0.5 ? -1 : 1) },
    ...(place.surveyProfile === "village" ? [{ name: "Upper Branch", role: "terminal" as const, plotEligible: false, points: branch(0.45, 1) }] : []),
  ];
  if (place.style === "agricultural") return [
    { name: "Farm Approach", role: "terminal", plotEligible: true, points: [[0, 0], [0.3, random.floatBetween(-0.08, 0.08)], [0.75, random.floatBetween(-0.18, 0.18)]] },
    { name: "Farm Yard", role: "farm_yard", plotEligible: false, points: ellipse(0.28, 0.22, 28, 0.42) },
  ];
  return [
    { name: "Roadside Street", role: "plot", plotEligible: true, points: [[0, 0], [0.43, random.floatBetween(-0.08, 0.08)], [0.88, random.floatBetween(-0.18, 0.18)]] },
    { name: "Roadside Branch", role: "terminal", plotEligible: false, points: branch(0.2, -1) },
    ...(place.surveyProfile === "village" ? [{ name: "Upper Branch", role: "terminal" as const, plotEligible: false, points: branch(0.46, 1) }] : []),
  ];
}

function populateCountyPlace(
  place: CountyPlannedPlace,
  roadIndex: RoadSpatialIndex,
  plannedRoads: readonly CountyPlannedRoad[],
  input: CountyBuildInput,
  terrain: TerrainSurface,
  prefabCounterStart: number,
  drivewayCounterStart: number,
  prefabBudget: number,
  drivewayBudget: number,
  occupiedFootprints: PolygonSpatialIndex,
  diagnostics: GenerationDiagnostic[],
): {
  readonly prefabs: readonly CountyPlannedPrefab[];
  readonly driveways: readonly CountyPlannedRoad[];
  readonly skippedCandidates: readonly CountySkippedCandidate[];
  readonly skipped: number;
} {
  const choices = COUNTY_BUILDING_ROLES.flatMap((role) => input.assetProgram[role]);
  const maximumProxy = {
    widthM: Math.max(...choices.map(({ widthM }) => widthM), 1),
    depthM: Math.max(...choices.map(({ depthM }) => depthM), 1),
  };
  const roadExpansionM = Math.max(maximumProxy.widthM, maximumProxy.depthM)
    + input.frontage.setbackM + input.frontage.junctionClearanceM
    + Math.max(...(Object.values(input.roadStyles) as CountyRoadStyle[]).map(({ widthM }) => widthM));
  const allRoads = roadIndex.query(place.points, roadExpansionM);
  const eligibleRoadIds = plannedRoads
    .filter((road) => road.ownerPlacePlanId === place.planId && road.plotEligible)
    .map(({ planId }) => planId);
  for (const road of input.existingRoads) {
    if (clipPolylineToPolygon(road.points, place.points).length > 0) eligibleRoadIds.push(road.id);
  }
  if (eligibleRoadIds.length === 0) {
    diagnostics.push({ severity: "warning", code: "no_plot_roads", message: `${place.name} has no plot-eligible road ranges.` });
    return { prefabs: [], driveways: [], skippedCandidates: [], skipped: 0 };
  }
  const plan = buildSettlementFrontagePlan({
    settlement: {
      kind: "place",
      id: place.existingEntityId ?? `00000000-0000-4000-8000-${place.rank.toString().padStart(12, "0")}`,
      name: place.name,
      visible: true,
      locked: false,
      place_type: place.placeType,
      points: place.points,
    },
    eligibleRoadIds,
    roads: allRoads,
    proxy: maximumProxy,
    settings: { ...input.frontage, side: "both", seed: countyNamedSeed(input.seed, `frontage:${place.planId}`) },
    world: { widthM: terrain.worldWidthM, depthM: terrain.worldDepthM },
    prefabs: [],
    catalog: null,
    terrain,
  });
  const random = new SeededRandom(countyNamedSeed(input.seed, `buildings:${place.planId}:${place.style}`));
  const targetRange = BUILDING_TARGETS[place.surveyProfile];
  const requestedTarget = random.integer(targetRange[0], targetRange[1] + 1);
  const target = Math.min(requestedTarget, prefabBudget);
  if (requestedTarget > prefabBudget) diagnostics.push({
    severity: "warning",
    code: "county_prefab_budget",
    message: `${place.name} frontage target was capped at ${String(prefabBudget)} by the whole-build prefab budget.`,
  });
  const candidates = random.shuffled(plan.candidates.filter(({ skipReason }) => skipReason === null));
  const prefabs: CountyPlannedPrefab[] = [];
  const driveways: CountyPlannedRoad[] = [];
  let skippedDriveways = 0;
  const skippedCandidates: CountySkippedCandidate[] = plan.candidates
    .filter(({ skipReason }) => skipReason !== null)
    .map((candidate) => ({
      ownerPlacePlanId: place.planId,
      point: [candidate.xM, candidate.zM],
      reason: candidate.skipReason ?? "rejected",
    }));
  let skipped = plan.candidates.length - candidates.length;
  for (const candidate of candidates) {
    if (prefabs.length >= target) break;
    const road = allRoads.find(({ id }) => id === candidate.roadId);
    if (!road) continue;
    const centerRatio = Math.hypot(candidate.xM - place.anchor[0], candidate.zM - place.anchor[1]) / Math.max(1, place.radiusM);
    const role = chooseBuildingRole(place, road, centerRatio, input.assetProgram, random);
    const roleChoices = input.assetProgram[role];
    const asset = roleChoices.length > 0 ? random.pick(roleChoices) : input.assetProgram.house[0];
    if (!asset) {
      skipped += 1;
      skippedCandidates.push({ ownerPlacePlanId: place.planId, point: [candidate.xM, candidate.zM], reason: "missing_asset_mapping" });
      continue;
    }
    const footprint = prefabFootprint(candidate.xM, candidate.zM, asset.widthM, asset.depthM, candidate.rotationDeg);
    if (occupiedFootprints.overlaps(footprint)) {
      skipped += 1;
      skippedCandidates.push({ ownerPlacePlanId: place.planId, point: [candidate.xM, candidate.zM], reason: "prefab_overlap" });
      continue;
    }
    const prefabPlanId = `county-prefab-${String(prefabCounterStart + prefabs.length + 1)}`;
    let drivewayRoadPlanId: string | null = null;
    if (input.frontage.drivewaysEnabled && driveways.length < drivewayBudget) {
      const driveway = createDriveway(
        `county-road-driveway-${String(drivewayCounterStart + driveways.length + 1)}`,
        place,
        candidate.xM,
        candidate.zM,
        candidate.rotationDeg,
        asset.depthM,
        road,
        input.roadStyles.driveway,
        terrain,
        allRoads,
        driveways,
        input.localStreets.maximumGrade,
      );
      if (driveway) {
        drivewayRoadPlanId = driveway.planId;
        driveways.push(driveway);
      } else {
        skippedDriveways += 1;
      }
    }
    prefabs.push({
      planId: prefabPlanId,
      ownerPlacePlanId: place.planId,
      role,
      assetId: asset.assetId,
      category: asset.category,
      displayName: asset.displayName,
      xM: candidate.xM,
      zM: candidate.zM,
      rotationDeg: candidate.rotationDeg,
      frontageRoadId: candidate.roadId,
      footprint,
      drivewayRoadPlanId,
    });
    occupiedFootprints.insert(footprint);
  }
  if (prefabs.length < Math.min(target, Math.max(3, Math.floor(target * 0.72)))) diagnostics.push({
    severity: "warning",
    code: "low_building_fill",
    message: `${place.name} filled ${String(prefabs.length)} of ${String(target)} target lots.`,
  });
  if (skippedDriveways > 0) diagnostics.push({
    severity: "warning",
    code: "driveway_skipped",
    message: `${place.name} skipped ${String(skippedDriveways)} driveway candidate${skippedDriveways === 1 ? "" : "s"} that could not satisfy corridor, grade, or clash safety.`,
  });
  return { prefabs, driveways, skippedCandidates, skipped };
}

function finalCountyValidation(
  places: readonly CountyPlannedPlace[],
  roads: readonly CountyPlannedRoad[],
  prefabs: readonly CountyPlannedPrefab[],
  input: CountyBuildInput,
  terrain: TerrainSurface,
): GenerationDiagnostic[] {
  const diagnostics: GenerationDiagnostic[] = [];
  const world = { widthM: terrain.worldWidthM, depthM: terrain.worldDepthM };
  for (const road of roads) {
    const finite = road.points.length >= 2 && road.points.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)
      && x >= 0 && z >= 0 && x <= world.widthM && z <= world.depthM);
    const gradeLimit = road.role === "backbone" || road.role === "access"
      ? input.routing.maximumGrade
      : input.localStreets.maximumGrade;
    if (!finite || road.lengthM <= GEOMETRY_EPSILON || road.maximumGrade > gradeLimit + GEOMETRY_EPSILON) {
      diagnostics.push({ severity: "error", code: "invalid_planned_road", message: `${road.name} failed final finite, world-bound, length, or grade validation.` });
    }
  }
  const roadIds = new Set([...input.existingRoads.map(({ id }) => id), ...roads.map(({ planId }) => planId)]);
  for (const prefab of prefabs) {
    const place = places.find(({ planId }) => planId === prefab.ownerPlacePlanId);
    const validFootprint = place && prefab.footprint.every(([x, z]) => x >= 0 && z >= 0 && x <= world.widthM && z <= world.depthM
      && pointInPolygon({ x, z }, place.points));
    if (!place || !validFootprint || !roadIds.has(prefab.frontageRoadId)
      || terrain.slopeAt(prefab.xM, prefab.zM) > input.frontage.maximumPlotSlopeDeg + GEOMETRY_EPSILON) {
      diagnostics.push({ severity: "error", code: "invalid_planned_prefab", message: `${prefab.displayName} failed final place, world, slope, or frontage relationship validation.` });
    }
  }
  return diagnostics;
}

function chooseBuildingRole(
  place: CountyPlannedPlace,
  road: Road,
  centerRatio: number,
  program: CountyAssetProgram,
  random: SeededRandom,
): CountyBuildingRole {
  const available = (roles: readonly CountyBuildingRole[]): CountyBuildingRole[] => roles.filter((role) => program[role].length > 0);
  let roles: CountyBuildingRole[];
  if (place.surveyProfile === "farm") roles = available(["farmhouse", "barn", "shed", "shed", "house"]);
  else if (place.surveyProfile === "hamlet") roles = available(["house", "house", "farmhouse", "shed", "shed"]);
  else if (place.surveyProfile === "town" && centerRatio < 0.34 && road.road_class !== "farm_track") {
    roles = available(["shop", "shop", "house", "civic", "house"]);
  } else if (place.surveyProfile === "town" && centerRatio > 0.68) {
    roles = available(["house", "house", "house", "shed", "warehouse"]);
  } else if (place.surveyProfile === "town") {
    roles = available(["house", "house", "shop", "house", "warehouse"]);
  } else if (centerRatio < 0.34 && road.road_class !== "farm_track") {
    roles = available(["shop", "house", "house", "civic"]);
  } else roles = available(["house", "house", "house", "shed", "shop"]);
  return roles.length > 0 ? random.pick(roles) : "house";
}

function createDriveway(
  planId: string,
  place: CountyPlannedPlace,
  xM: number,
  zM: number,
  rotationDeg: number,
  depthM: number,
  servingRoad: Road,
  style: CountyRoadStyle,
  terrain: TerrainSurface,
  otherRoads: readonly Road[],
  acceptedDriveways: readonly CountyPlannedRoad[],
  maximumGrade: number,
): CountyPlannedRoad | null {
  const metrics = buildPolylineMetrics(servingRoad.points);
  const projection = projectPointToPolyline(metrics, { x: xM, z: zM });
  const dx = xM - projection.point[0];
  const dz = zM - projection.point[1];
  const distanceM = Math.hypot(dx, dz);
  if (distanceM <= servingRoad.width_m / 2 + depthM / 2 + 0.25) return null;
  const direction: PointTuple = [dx / distanceM, dz / distanceM];
  const start: PointTuple = [
    projection.point[0] + direction[0] * (servingRoad.width_m / 2 + 0.25),
    projection.point[1] + direction[1] * (servingRoad.width_m / 2 + 0.25),
  ];
  const localFront = rotateLocalPoint(0, -depthM / 2, rotationDeg);
  const end: PointTuple = [xM + localFront[0], zM + localFront[1]];
  const points = [start, end] as const;
  const analysis = analyzeRoad(points, terrain);
  if (analysis.lengthM < 0.5 || analysis.maximumGrade > maximumGrade + GEOMETRY_EPSILON
    || !roadCorridorInsidePolygon(points, place.points, style.widthM / 2, Math.max(0.25, terrain.spacingM / 2))) return null;
  const candidate = plannedRoad(planId, `${place.name} Driveway`, "property_access", place.planId, points, style, false, analysis);
  const clashes = otherRoads.some((other) => other.id !== servingRoad.id && countyRoadCorridorsOverlap(
    candidate,
    { points: other.points, widthM: other.width_m },
  )) || acceptedDriveways.some((other) => countyRoadCorridorsOverlap(candidate, other));
  return clashes ? null : candidate;
}

function framePoint(frame: CountySettlementFrame, u: number, v: number): PointTuple {
  const distanceU = u < 0 ? u * frame.negativeU : u * frame.positiveU;
  const distanceV = v < 0 ? v * frame.negativeV : v * frame.positiveV;
  return [
    frame.anchor[0] + frame.along[0] * distanceU + frame.normal[0] * distanceV,
    frame.anchor[1] + frame.along[1] * distanceU + frame.normal[1] * distanceV,
  ];
}

function ellipse(radiusU: number, radiusV: number, segments: number, centerU = 0): readonly PointTuple[] {
  return Array.from({ length: segments + 1 }, (_, index): PointTuple => {
    const angle = index / segments * Math.PI * 2;
    return [centerU + Math.cos(angle) * radiusU, Math.sin(angle) * radiusV];
  });
}

export function clipCountyStreetToUsablePolygon(
  points: readonly PointTuple[],
  polygon: readonly PointTuple[],
  insetM: number,
  sampleStepM: number,
  preferred: PointTuple,
): readonly PointTuple[] {
  const sampled: PointTuple[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const count = Math.max(1, Math.ceil(length / Math.max(0.25, sampleStepM)));
    for (let step = index === 0 ? 0 : 1; step <= count; step += 1) {
      const t = step / count;
      sampled.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
    }
  }
  const runs: PointTuple[][] = [];
  let current: PointTuple[] = [];
  for (const point of sampled) {
    const inside = pointInPolygon({ x: point[0], z: point[1] }, polygon)
      && pointPolygonBoundaryDistance(point, polygon) + GEOMETRY_EPSILON >= insetM;
    if (inside) current.push(point);
    else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  runs.sort((left, right) => nearestPointDistance(left, preferred) - nearestPointDistance(right, preferred)
    || polylineLength(right) - polylineLength(left));
  return dedupePolyline(runs[0] ?? []);
}

function roadCorridorInsidePolygon(
  points: readonly PointTuple[],
  polygon: readonly PointTuple[],
  insetM: number,
  sampleStepM: number,
): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) return false;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const samples = Math.max(1, Math.ceil(length / sampleStepM));
    for (let sample = 0; sample <= samples; sample += 1) {
      const t = sample / samples;
      const point: PointTuple = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
      if (!pointInPolygon({ x: point[0], z: point[1] }, polygon)
        || pointPolygonBoundaryDistance(point, polygon) + GEOMETRY_EPSILON < insetM) return false;
    }
  }
  return true;
}

function plannedRoad(
  planId: string,
  name: string,
  role: CountyRoadRole,
  ownerPlacePlanId: string | null,
  points: readonly PointTuple[],
  style: CountyRoadStyle,
  plotEligible: boolean,
  analysis: { readonly lengthM: number; readonly maximumGrade: number },
): CountyPlannedRoad {
  return {
    planId,
    name,
    role,
    ownerPlacePlanId,
    points: Object.freeze([...points]),
    widthM: style.widthM,
    roadClass: style.roadClass,
    surface: style.surface,
    plotEligible,
    lengthM: analysis.lengthM,
    maximumGrade: analysis.maximumGrade,
  };
}

function analyzeRoad(points: readonly PointTuple[], terrain: TerrainSurface): { readonly lengthM: number; readonly maximumGrade: number } {
  let lengthM = 0;
  let maximumGrade = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (segmentLength <= GEOMETRY_EPSILON) continue;
    const sampleCount = Math.max(1, Math.ceil(segmentLength / Math.max(0.25, terrain.spacingM / 2)));
    let previousHeight = terrain.heightAt(start[0], start[1]);
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const t = sample / sampleCount;
      const height = terrain.heightAt(start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t);
      maximumGrade = Math.max(maximumGrade, Math.abs(height - previousHeight) / (segmentLength / sampleCount));
      previousHeight = height;
    }
    lengthM += segmentLength;
  }
  return { lengthM, maximumGrade };
}

function roadReference(road: Road): RoadReference {
  return { id: road.id, points: road.points, widthM: road.width_m, roadClass: road.road_class, surface: road.surface, planned: null };
}

function roadReferenceFromPlan(road: CountyPlannedRoad): RoadReference {
  return { id: road.planId, points: road.points, widthM: road.widthM, roadClass: road.roadClass, surface: road.surface, planned: road };
}

function roadEntityFromPlan(road: CountyPlannedRoad): Road {
  return {
    kind: "road",
    id: road.planId,
    name: road.name,
    visible: true,
    locked: false,
    points: road.points,
    width_m: road.widthM,
    road_class: road.roadClass,
    surface: road.surface,
  };
}

function markConnected(results: Map<string, MutablePlaceResult>, placeId: string, roadId: string): void {
  const result = results.get(placeId);
  if (!result) return;
  result.connected = true;
  result.accessRoadId = roadId;
}

function polygonCentroid(points: readonly PointTuple[]): PointTuple {
  let twiceArea = 0;
  let xSum = 0;
  let zSum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    xSum += (current[0] + next[0]) * cross;
    zSum += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) <= GEOMETRY_EPSILON) {
    return [
      points.reduce((sum, [x]) => sum + x, 0) / points.length,
      points.reduce((sum, [, z]) => sum + z, 0) / points.length,
    ];
  }
  return [xSum / (3 * twiceArea), zSum / (3 * twiceArea)];
}

function equivalentRadius(points: readonly PointTuple[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current && next) twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.sqrt(Math.abs(twiceArea) / 2 / Math.PI);
}

function validateCountyBuildRequest(request: CountyBuildRequest, terrain: CountyBuildTerrainSnapshot): void {
  const input = request.input;
  if (!Number.isSafeInteger(request.operationId) || request.operationId < 1) throw new ContractError("county operation ID is invalid");
  if ((request.kind as string) !== "county_build") throw new ContractError("county request kind is invalid");
  if (!Number.isSafeInteger(input.seed) || request.seed !== input.seed) throw new ContractError("county seed is invalid");
  if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0) throw new ContractError("county source revision is invalid");
  if (!Number.isSafeInteger(input.desiredSettlementCount) || input.desiredSettlementCount < 1 || input.desiredSettlementCount > 25) {
    throw new ContractError("county settlement count must be an integer from 1 to 25");
  }
  if (!["survey", "existing_places"].includes(input.sourceMode)) throw new ContractError("county source mode is invalid");
  if (!["full", "network_only"].includes(input.outputMode)) throw new ContractError("county output mode is invalid");
  if (input.outputMode === "network_only" && input.sourceMode !== "existing_places") {
    throw new ContractError("the network-only workflow requires existing place regions");
  }
  if (!input.createBackbone && input.existingRoads.filter(({ visible }) => visible).length === 0) {
    throw new ContractError("Build County requires an existing visible road network or Create county backbone");
  }
  if (input.outputMode === "full" && input.assetProgram.house.length === 0) throw new ContractError("Build County requires a mapped house asset");
  for (const role of COUNTY_BUILDING_ROLES) {
    for (const asset of input.assetProgram[role]) {
      if (!asset.assetId.trim() || !asset.category.trim() || !asset.displayName.trim()
        || !Number.isFinite(asset.widthM) || asset.widthM <= 0
        || !Number.isFinite(asset.depthM) || asset.depthM <= 0) throw new ContractError(`county ${role} asset mapping is invalid`);
    }
  }
  if (!Number.isFinite(input.survey.radiusScale) || input.survey.radiusScale <= 0) throw new ContractError("county survey radius scale must be positive");
  if (!["balanced", "urban", "rural"].includes(input.survey.siteMix)) {
    throw new ContractError("county site mix is invalid");
  }
  for (const profile of ["town", "village", "hamlet", "farm"] as const) {
    if (!COUNTY_STREET_STYLES.includes(input.styleByProfile[profile])) throw new ContractError(`county ${profile} style is invalid`);
  }
  for (const [name, value] of Object.entries(input.budgets)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new ContractError(`county ${name} budget must be a positive integer`);
  }
  if (!Number.isSafeInteger(input.survey.attemptBudgetPerSite) || input.survey.attemptBudgetPerSite < 1) throw new ContractError("county survey attempt budget is invalid");
  for (const style of Object.values(input.roadStyles) as CountyRoadStyle[]) {
    if (!Number.isFinite(style.widthM) || style.widthM <= 0) throw new ContractError("county road widths must be positive");
  }
  if (terrain.heights.length !== terrain.pointCountX * terrain.pointCountZ) throw new ContractError("county terrain snapshot length is invalid");
}

function countyFailure(
  request: CountyBuildRequest,
  reason: CountyBuildFailureReason,
  message: string,
  started: number,
): CountyBuildResult {
  return {
    operationId: request.operationId,
    kind: "county_build",
    status: "failure",
    reason,
    diagnostics: [{ severity: "error", code: reason, message }],
    metrics: [{ name: "elapsed", value: performance.now() - started, unit: "ms" }],
  };
}

function dedupePolyline(points: readonly PointTuple[]): readonly PointTuple[] {
  const output: PointTuple[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > GEOMETRY_EPSILON) output.push(point);
  }
  return output;
}

function polylineLength(points: readonly PointTuple[]): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start && end) length += Math.hypot(end[0] - start[0], end[1] - start[1]);
  }
  return length;
}

function nearestPointDistance(points: readonly PointTuple[], point: PointTuple): number {
  return Math.min(...points.map((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1])));
}

function pointPolygonBoundaryDistance(point: PointTuple, polygon: readonly PointTuple[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start && end) minimum = Math.min(minimum, pointSegmentDistance(point, start, end));
  }
  return minimum;
}

function uniqueName(stem: string, used: Set<string>): string {
  if (!used.has(stem)) {
    used.add(stem);
    return stem;
  }
  let suffix = 2;
  while (used.has(`${stem} ${String(suffix)}`)) suffix += 1;
  const value = `${stem} ${String(suffix)}`;
  used.add(value);
  return value;
}

function requiredMapping(map: ReadonlyMap<string, string>, planId: string, kind: string): string {
  const value = map.get(planId);
  if (!value) throw new ContractError(`${kind} plan ID could not be materialized`);
  return value;
}

class PolygonSpatialIndex {
  readonly #cells = new Map<string, (readonly PointTuple[])[]>();

  public constructor(
    readonly cellSizeM: number,
    initial: readonly (readonly PointTuple[])[] = [],
  ) {
    for (const polygon of initial) this.insert(polygon);
  }

  public insert(polygon: readonly PointTuple[]): void {
    for (const key of this.#keys(polygon)) {
      const cell = this.#cells.get(key) ?? [];
      cell.push(polygon);
      this.#cells.set(key, cell);
    }
  }

  public overlaps(polygon: readonly PointTuple[]): boolean {
    const candidates = new Set<readonly PointTuple[]>();
    for (const key of this.#keys(polygon)) {
      for (const candidate of this.#cells.get(key) ?? []) candidates.add(candidate);
    }
    return [...candidates].some((candidate) => convexPolygonsOverlapStrict(polygon, candidate));
  }

  #keys(polygon: readonly PointTuple[]): readonly string[] {
    const minX = Math.min(...polygon.map(([x]) => x));
    const maxX = Math.max(...polygon.map(([x]) => x));
    const minZ = Math.min(...polygon.map(([, z]) => z));
    const maxZ = Math.max(...polygon.map(([, z]) => z));
    const keys: string[] = [];
    for (let z = Math.floor(minZ / this.cellSizeM); z <= Math.floor(maxZ / this.cellSizeM); z += 1) {
      for (let x = Math.floor(minX / this.cellSizeM); x <= Math.floor(maxX / this.cellSizeM); x += 1) keys.push(`${String(x)}:${String(z)}`);
    }
    return keys;
  }
}

class RoadSpatialIndex {
  readonly #cells = new Map<string, Road[]>();

  public constructor(readonly cellSizeM: number, roads: readonly Road[]) {
    for (const road of roads) {
      const bounds = pointBounds(road.points, road.width_m / 2);
      for (const key of spatialKeys(bounds, cellSizeM)) {
        const cell = this.#cells.get(key) ?? [];
        cell.push(road);
        this.#cells.set(key, cell);
      }
    }
  }

  public query(polygon: readonly PointTuple[], expansionM: number): readonly Road[] {
    const roads = new Set<Road>();
    for (const key of spatialKeys(pointBounds(polygon, expansionM), this.cellSizeM)) {
      for (const road of this.#cells.get(key) ?? []) roads.add(road);
    }
    return [...roads].sort((left, right) => left.id.localeCompare(right.id));
  }
}

function pointBounds(points: readonly PointTuple[], expansionM: number): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } {
  return {
    minX: Math.min(...points.map(([x]) => x)) - expansionM,
    maxX: Math.max(...points.map(([x]) => x)) + expansionM,
    minZ: Math.min(...points.map(([, z]) => z)) - expansionM,
    maxZ: Math.max(...points.map(([, z]) => z)) + expansionM,
  };
}

function spatialKeys(
  bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number },
  cellSizeM: number,
): readonly string[] {
  const keys: string[] = [];
  for (let z = Math.floor(bounds.minZ / cellSizeM); z <= Math.floor(bounds.maxZ / cellSizeM); z += 1) {
    for (let x = Math.floor(bounds.minX / cellSizeM); x <= Math.floor(bounds.maxX / cellSizeM); x += 1) keys.push(`${String(x)}:${String(z)}`);
  }
  return keys;
}

class SnapshotTerrainSurface implements TerrainSurface {
  public readonly cellCountX: number;
  public readonly cellCountZ: number;

  public constructor(private readonly snapshot: CountyBuildTerrainSnapshot) {
    this.cellCountX = snapshot.pointCountX - 1;
    this.cellCountZ = snapshot.pointCountZ - 1;
  }

  public get worldWidthM(): number { return this.snapshot.worldWidthM; }
  public get worldDepthM(): number { return this.snapshot.worldDepthM; }
  public get spacingM(): number { return this.snapshot.spacingM; }
  public get pointCountX(): number { return this.snapshot.pointCountX; }
  public get pointCountZ(): number { return this.snapshot.pointCountZ; }
  public get minimumElevationM(): number { return this.snapshot.minimumElevationM; }
  public get seaLevelM(): number { return this.snapshot.seaLevelM; }
  public get lowlandReferenceElevationM(): number { return this.snapshot.lowlandReferenceElevationM; }
  public get maximumElevationM(): number { return this.snapshot.maximumElevationM; }

  public copyHeights(): Float32Array { return new Float32Array(this.snapshot.heights); }

  public heightAtGrid(xIndex: number, zIndex: number): number {
    if (!Number.isInteger(xIndex) || !Number.isInteger(zIndex) || xIndex < 0 || zIndex < 0
      || xIndex >= this.pointCountX || zIndex >= this.pointCountZ) throw new ContractError("county terrain grid query is outside the elevation array");
    const value = this.snapshot.heights[zIndex * this.pointCountX + xIndex];
    if (value === undefined) throw new ContractError("county terrain grid query is missing");
    return value;
  }

  public heightAt(xM: number, zM: number): number {
    const cell = this.cellAt(xM, zM);
    const nw = this.heightAtGrid(cell.x, cell.z);
    const ne = this.heightAtGrid(cell.x + 1, cell.z);
    const sw = this.heightAtGrid(cell.x, cell.z + 1);
    const se = this.heightAtGrid(cell.x + 1, cell.z + 1);
    return cell.localZ <= cell.localX
      ? nw + cell.localX * (ne - nw) + cell.localZ * (se - ne)
      : nw + cell.localZ * (sw - nw) + cell.localX * (se - sw);
  }

  public slopeAt(xM: number, zM: number): number {
    const cell = this.cellAt(xM, zM);
    const nw = this.heightAtGrid(cell.x, cell.z);
    const ne = this.heightAtGrid(cell.x + 1, cell.z);
    const sw = this.heightAtGrid(cell.x, cell.z + 1);
    const se = this.heightAtGrid(cell.x + 1, cell.z + 1);
    const [dx, dz] = cell.localZ <= cell.localX
      ? [(ne - nw) / this.spacingM, (se - ne) / this.spacingM]
      : [(se - sw) / this.spacingM, (sw - nw) / this.spacingM];
    return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  }

  private cellAt(xM: number, zM: number): { readonly x: number; readonly z: number; readonly localX: number; readonly localZ: number } {
    if (!Number.isFinite(xM) || !Number.isFinite(zM) || xM < 0 || zM < 0 || xM > this.worldWidthM || zM > this.worldDepthM) {
      throw new ContractError("county terrain query is outside the world");
    }
    const gridX = xM / this.spacingM;
    const gridZ = zM / this.spacingM;
    const x = Math.min(Math.floor(gridX), this.cellCountX - 1);
    const z = Math.min(Math.floor(gridZ), this.cellCountZ - 1);
    return { x, z, localX: gridX - x, localZ: gridZ - z };
  }
}

// Retained here because it is part of the SN-1 validation vocabulary and is useful to
// tests and future clash policy without exposing an unbounded county-wide scan.
export function countyRoadCorridorsOverlap(
  left: Pick<CountyPlannedRoad, "points" | "widthM">,
  right: Pick<CountyPlannedRoad, "points" | "widthM">,
  clearanceM = 0,
): boolean {
  for (let leftIndex = 0; leftIndex < left.points.length - 1; leftIndex += 1) {
    const a = left.points[leftIndex];
    const b = left.points[leftIndex + 1];
    if (!a || !b) continue;
    for (let rightIndex = 0; rightIndex < right.points.length - 1; rightIndex += 1) {
      const c = right.points[rightIndex];
      const d = right.points[rightIndex + 1];
      if (!c || !d) continue;
      if (segmentDistance(a, b, c, d) < (left.widthM + right.widthM) / 2 + clearanceM - GEOMETRY_EPSILON) return true;
    }
  }
  return false;
}

function parallelRoadCorridorsOverlap(left: CountyPlannedRoad, right: CountyPlannedRoad): boolean {
  for (let leftIndex = 0; leftIndex < left.points.length - 1; leftIndex += 1) {
    const a = left.points[leftIndex];
    const b = left.points[leftIndex + 1];
    if (!a || !b) continue;
    const leftLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (leftLength <= GEOMETRY_EPSILON) continue;
    for (let rightIndex = 0; rightIndex < right.points.length - 1; rightIndex += 1) {
      const c = right.points[rightIndex];
      const d = right.points[rightIndex + 1];
      if (!c || !d) continue;
      const rightLength = Math.hypot(d[0] - c[0], d[1] - c[1]);
      if (rightLength <= GEOMETRY_EPSILON) continue;
      const cross = Math.abs(((b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])) / (leftLength * rightLength));
      if (cross <= 0.2 && segmentDistance(a, b, c, d) < (left.widthM + right.widthM) / 2 - GEOMETRY_EPSILON) return true;
    }
  }
  return false;
}
