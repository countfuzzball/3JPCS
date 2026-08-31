import type {
  GenerationDiagnostic,
  GenerationMetric,
  GenerationRejectionCount,
} from "./contracts";
import { segmentPolygonDistance } from "./geometry";
import { SeededRandom } from "./seededRandom";
import type { PlaceRegion, PlaceType, PointTuple } from "../model/entities";
import { ContractError } from "../model/errors";
import type { TerrainSurface } from "../terrain/TerrainSurface";

export const SETTLEMENT_SURVEY_PROFILES = {
  town: {
    id: "town",
    label: "Town",
    radiusM: 470,
    maximumGrade: 0.11,
    placeType: "town",
  },
  village: {
    id: "village",
    label: "Village",
    radiusM: 300,
    maximumGrade: 0.14,
    placeType: "village",
  },
  hamlet: {
    id: "hamlet",
    label: "Hamlet-sized",
    radiusM: 190,
    maximumGrade: 0.18,
    placeType: "village",
  },
  farm: {
    id: "farm",
    label: "Farm",
    radiusM: 125,
    maximumGrade: 0.22,
    placeType: "farm",
  },
} as const satisfies Record<string, SettlementSurveyProfile>;

export type SettlementSurveyProfileId = keyof typeof SETTLEMENT_SURVEY_PROFILES;

export interface SettlementSurveyProfile {
  readonly id: string;
  readonly label: string;
  readonly radiusM: number;
  readonly maximumGrade: number;
  readonly placeType: PlaceType;
}

export interface SettlementSurveySettings {
  readonly profile: SettlementSurveyProfileId;
  readonly desiredCount: number;
  readonly radiusM: number;
  readonly maximumSlopeDeg: number;
  readonly minimumSeparationM: number;
  readonly edgeClearanceM: number;
  readonly preferredElevationM: number | null;
  readonly seed: number;
  readonly attemptBudget: number;
}

export type SettlementSurveyRejectionReason =
  | "outside_world"
  | "edge_clearance"
  | "slope"
  | "existing_place_separation"
  | "candidate_separation";

export interface SettlementSiteMeasurements {
  readonly elevationM: number;
  readonly minimumElevationM: number;
  readonly maximumElevationM: number;
  readonly elevationRangeM: number;
  readonly maximumSlopeDeg: number;
  readonly averageSlopeDeg: number;
  readonly edgeClearanceM: number;
}

export type SettlementSiteEvaluation = {
  readonly status: "accepted";
  readonly measurements: SettlementSiteMeasurements;
} | {
  readonly status: "rejected";
  readonly reason: Exclude<SettlementSurveyRejectionReason, "candidate_separation">;
};

export interface SettlementSurveyCandidate extends SettlementSiteMeasurements {
  readonly id: string;
  readonly rank: number;
  readonly attemptIndex: number;
  readonly center: PointTuple;
  readonly radiusM: number;
  readonly boundary: readonly PointTuple[];
  readonly placeType: PlaceType;
  readonly score: number;
  readonly roughnessPenalty: number;
  readonly edgePenalty: number;
  readonly elevationPenalty: number;
  readonly tieBreaker: number;
}

export interface SettlementSurveyOutput {
  readonly candidates: readonly SettlementSurveyCandidate[];
  readonly desiredCount: number;
  readonly attemptsEvaluated: number;
  readonly attemptBudgetExhausted: boolean;
}

interface SettlementSurveyResultBase {
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly metrics: readonly GenerationMetric[];
  readonly rejections: readonly GenerationRejectionCount[];
}

export type SettlementSurveyResult = (SettlementSurveyResultBase & {
  readonly status: "success";
  readonly output: SettlementSurveyOutput;
}) | (SettlementSurveyResultBase & {
  readonly status: "failure";
  readonly reason: "no_valid_result";
});

interface RankedSite extends SettlementSiteMeasurements {
  readonly id: string;
  readonly attemptIndex: number;
  readonly center: PointTuple;
  readonly score: number;
  readonly roughnessPenalty: number;
  readonly edgePenalty: number;
  readonly elevationPenalty: number;
  readonly tieBreaker: number;
}

const SITE_SAMPLE_RINGS: readonly (readonly [radiusFraction: number, sampleCount: number])[] = [
  [0, 1],
  [0.45, 8],
  [0.9, 16],
];
const BOUNDARY_VERTEX_COUNT = 32;

export function gradeToDegrees(grade: number): number {
  if (!Number.isFinite(grade) || grade < 0) throw new ContractError("slope grade must be finite and non-negative");
  return Math.atan(grade) * 180 / Math.PI;
}

export function degreesToGrade(degrees: number): number {
  if (!Number.isFinite(degrees) || degrees < 0 || degrees >= 90) {
    throw new ContractError("slope degrees must be finite and between zero and 90");
  }
  return Math.tan(degrees * Math.PI / 180);
}

export function settlementSurveyProfile(id: SettlementSurveyProfileId): SettlementSurveyProfile {
  return SETTLEMENT_SURVEY_PROFILES[id];
}

export function settlementBoundary(
  center: PointTuple,
  radiusM: number,
  vertexCount = BOUNDARY_VERTEX_COUNT,
): readonly PointTuple[] {
  assertFinitePoint(center, "settlement centre");
  assertPositive(radiusM, "settlement radius");
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 3) {
    throw new ContractError("settlement boundary vertex count must be an integer of at least three");
  }
  return Object.freeze(Array.from({ length: vertexCount }, (_, index): PointTuple => {
    const angle = -Math.PI / 2 + index / vertexCount * Math.PI * 2;
    return Object.freeze([
      center[0] + Math.cos(angle) * radiusM,
      center[1] + Math.sin(angle) * radiusM,
    ] as const);
  }));
}

export function evaluateSettlementSite(
  terrain: TerrainSurface,
  center: PointTuple,
  radiusM: number,
  maximumSlopeDeg: number,
  edgeClearanceM: number,
  minimumSeparationM: number,
  existingPlaces: readonly PlaceRegion[],
): SettlementSiteEvaluation {
  validateTerrain(terrain);
  assertFinitePoint(center, "settlement centre");
  assertPositive(radiusM, "settlement radius");
  assertFiniteInRange(maximumSlopeDeg, 0, 90, "maximum settlement slope", false);
  assertNonNegative(edgeClearanceM, "settlement edge clearance");
  assertNonNegative(minimumSeparationM, "settlement separation");

  if (center[0] < 0 || center[0] > terrain.worldWidthM || center[1] < 0 || center[1] > terrain.worldDepthM) {
    return { status: "rejected", reason: "outside_world" };
  }
  const clearanceM = Math.min(
    center[0],
    center[1],
    terrain.worldWidthM - center[0],
    terrain.worldDepthM - center[1],
  ) - radiusM;
  if (clearanceM + 1e-7 < edgeClearanceM) {
    return { status: "rejected", reason: "edge_clearance" };
  }

  const requiredExistingDistanceM = radiusM + minimumSeparationM;
  for (const place of existingPlaces) {
    const distanceM = segmentPolygonDistance(center, center, place.points);
    if (distanceM + 1e-7 < requiredExistingDistanceM) {
      return { status: "rejected", reason: "existing_place_separation" };
    }
  }

  const samples = settlementSiteSamplePoints(center, radiusM);
  if (samples.some(([x, z]) => x < 0 || x > terrain.worldWidthM || z < 0 || z > terrain.worldDepthM)) {
    return { status: "rejected", reason: "outside_world" };
  }
  const elevations = samples.map(([x, z]) => terrain.heightAt(x, z));
  const slopes = samples.map(([x, z]) => terrain.slopeAt(x, z));
  const maximumMeasuredSlopeDeg = Math.max(...slopes);
  if (maximumMeasuredSlopeDeg > maximumSlopeDeg + 1e-7) {
    return { status: "rejected", reason: "slope" };
  }
  const minimumElevationM = Math.min(...elevations);
  const maximumElevationM = Math.max(...elevations);
  return {
    status: "accepted",
    measurements: {
      elevationM: elevations[0] ?? terrain.heightAt(center[0], center[1]),
      minimumElevationM,
      maximumElevationM,
      elevationRangeM: maximumElevationM - minimumElevationM,
      maximumSlopeDeg: maximumMeasuredSlopeDeg,
      averageSlopeDeg: slopes.reduce((sum, slope) => sum + slope, 0) / slopes.length,
      edgeClearanceM: clearanceM,
    },
  };
}

export function runSettlementSurvey(
  terrain: TerrainSurface,
  existingPlaces: readonly PlaceRegion[],
  settings: SettlementSurveySettings,
): SettlementSurveyResult {
  validateSurveySettings(terrain, settings);
  const profile = settlementSurveyProfile(settings.profile);
  const random = new SeededRandom(settings.seed);
  const marginM = settings.radiusM + settings.edgeClearanceM;
  const minimumX = marginM;
  const maximumX = terrain.worldWidthM - marginM;
  const minimumZ = marginM;
  const maximumZ = terrain.worldDepthM - marginM;
  const rejectionCounts = new Map<SettlementSurveyRejectionReason, number>();
  const rankedSites: RankedSite[] = [];

  for (let attemptIndex = 0; attemptIndex < settings.attemptBudget; attemptIndex += 1) {
    const center: PointTuple = [
      random.floatBetween(minimumX, maximumX),
      random.floatBetween(minimumZ, maximumZ),
    ];
    const tieBreaker = random.nextUint32();
    const evaluation = evaluateSettlementSite(
      terrain,
      center,
      settings.radiusM,
      settings.maximumSlopeDeg,
      settings.edgeClearanceM,
      settings.minimumSeparationM,
      existingPlaces,
    );
    if (evaluation.status === "rejected") {
      incrementCount(rejectionCounts, evaluation.reason);
      continue;
    }
    const penalties = scoreSite(terrain, evaluation.measurements, settings);
    rankedSites.push({
      id: `survey-${String(attemptIndex + 1)}`,
      attemptIndex,
      center,
      tieBreaker,
      ...evaluation.measurements,
      ...penalties,
    });
  }

  rankedSites.sort((left, right) => left.score - right.score
    || left.tieBreaker - right.tieBreaker
    || left.attemptIndex - right.attemptIndex);

  const chosen: RankedSite[] = [];
  const requiredCandidateDistanceM = settings.radiusM * 2 + settings.minimumSeparationM;
  for (const candidate of rankedSites) {
    if (chosen.some((accepted) => distance(candidate.center, accepted.center) + 1e-7 < requiredCandidateDistanceM)) {
      incrementCount(rejectionCounts, "candidate_separation");
      continue;
    }
    chosen.push(candidate);
    if (chosen.length >= settings.desiredCount) break;
  }

  const rejections = rejectionSummary(rejectionCounts);
  const metrics: readonly GenerationMetric[] = [
    { name: "attempts_evaluated", value: settings.attemptBudget, unit: "attempts" },
    { name: "valid_before_candidate_separation", value: rankedSites.length, unit: "sites" },
    { name: "ranked_candidates", value: chosen.length, unit: "sites" },
  ];
  if (chosen.length === 0) {
    return {
      status: "failure",
      reason: "no_valid_result",
      diagnostics: [{
        severity: "warning",
        code: "no_valid_site",
        message: `No valid settlement site was found in ${String(settings.attemptBudget)} attempts.`,
      }],
      metrics,
      rejections,
    };
  }

  const candidates = chosen.map((site, index): SettlementSurveyCandidate => Object.freeze({
    ...site,
    rank: index + 1,
    radiusM: settings.radiusM,
    boundary: settlementBoundary(site.center, settings.radiusM),
    placeType: profile.placeType,
  }));
  const attemptBudgetExhausted = candidates.length < settings.desiredCount;
  const diagnostics: GenerationDiagnostic[] = [{
    severity: "info",
    code: "survey_complete",
    message: `${String(candidates.length)} ranked settlement candidate${candidates.length === 1 ? "" : "s"} found.`,
  }];
  if (attemptBudgetExhausted) {
    diagnostics.push({
      severity: "warning",
      code: "attempt_budget_exhausted",
      message: `The ${String(settings.attemptBudget)}-attempt budget produced ${String(candidates.length)} of ${String(settings.desiredCount)} requested candidates.`,
    });
  }
  return {
    status: "success",
    output: {
      candidates: Object.freeze(candidates),
      desiredCount: settings.desiredCount,
      attemptsEvaluated: settings.attemptBudget,
      attemptBudgetExhausted,
    },
    diagnostics: Object.freeze(diagnostics),
    metrics,
    rejections,
  };
}

function settlementSiteSamplePoints(center: PointTuple, radiusM: number): readonly PointTuple[] {
  const samples: PointTuple[] = [];
  for (const [radiusFraction, sampleCount] of SITE_SAMPLE_RINGS) {
    if (radiusFraction === 0) {
      samples.push(center);
      continue;
    }
    for (let index = 0; index < sampleCount; index += 1) {
      const angle = index / sampleCount * Math.PI * 2;
      samples.push([
        center[0] + Math.cos(angle) * radiusM * radiusFraction,
        center[1] + Math.sin(angle) * radiusM * radiusFraction,
      ]);
    }
  }
  return samples;
}

function scoreSite(
  terrain: TerrainSurface,
  measurements: SettlementSiteMeasurements,
  settings: SettlementSurveySettings,
): Pick<SettlementSurveyCandidate, "score" | "roughnessPenalty" | "edgePenalty" | "elevationPenalty"> {
  const slopePenalty = clamp(measurements.averageSlopeDeg / settings.maximumSlopeDeg, 0, 1);
  const expectedRiseM = Math.max(1, settings.radiusM * 2 * degreesToGrade(settings.maximumSlopeDeg));
  const reliefPenalty = clamp(measurements.elevationRangeM / expectedRiseM, 0, 1);
  const roughnessPenalty = (slopePenalty + reliefPenalty) / 2;
  const maximumClearanceM = Math.min(terrain.worldWidthM, terrain.worldDepthM) / 2 - settings.radiusM;
  const edgeRangeM = Math.max(1e-7, maximumClearanceM - settings.edgeClearanceM);
  const edgePenalty = 1 - clamp(
    (measurements.edgeClearanceM - settings.edgeClearanceM) / edgeRangeM,
    0,
    1,
  );
  const elevationPenalty = settings.preferredElevationM === null
    ? 0
    : clamp(
      Math.abs(measurements.elevationM - settings.preferredElevationM)
        / Math.max(1, terrain.maximumElevationM - terrain.minimumElevationM),
      0,
      1,
    );
  return {
    roughnessPenalty,
    edgePenalty,
    elevationPenalty,
    score: roughnessPenalty * 0.65 + edgePenalty * 0.2 + elevationPenalty * 0.15,
  };
}

function validateSurveySettings(terrain: TerrainSurface, settings: SettlementSurveySettings): void {
  validateTerrain(terrain);
  settlementSurveyProfile(settings.profile);
  if (!Number.isSafeInteger(settings.desiredCount) || settings.desiredCount < 1 || settings.desiredCount > 100) {
    throw new ContractError("desired settlement candidate count must be an integer from 1 to 100");
  }
  assertPositive(settings.radiusM, "settlement radius");
  assertFiniteInRange(settings.maximumSlopeDeg, 0, 90, "maximum settlement slope", false);
  assertNonNegative(settings.minimumSeparationM, "settlement separation");
  assertNonNegative(settings.edgeClearanceM, "settlement edge clearance");
  if (settings.preferredElevationM !== null && !Number.isFinite(settings.preferredElevationM)) {
    throw new ContractError("preferred settlement elevation must be finite when enabled");
  }
  if (!Number.isSafeInteger(settings.seed)) throw new ContractError("settlement survey seed must be a safe integer");
  if (!Number.isSafeInteger(settings.attemptBudget) || settings.attemptBudget < 1 || settings.attemptBudget > 100_000) {
    throw new ContractError("settlement survey attempt budget must be an integer from 1 to 100000");
  }
  const requiredSpanM = 2 * (settings.radiusM + settings.edgeClearanceM);
  if (requiredSpanM > terrain.worldWidthM + 1e-7 || requiredSpanM > terrain.worldDepthM + 1e-7) {
    throw new ContractError("settlement radius and edge clearance do not fit inside the terrain world");
  }
}

function validateTerrain(terrain: TerrainSurface): void {
  for (const [label, value] of [
    ["world width", terrain.worldWidthM],
    ["world depth", terrain.worldDepthM],
    ["terrain spacing", terrain.spacingM],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new ContractError(`${label} must be finite and positive`);
  }
}

function rejectionSummary(counts: ReadonlyMap<SettlementSurveyRejectionReason, number>): readonly GenerationRejectionCount[] {
  return ([
    "outside_world",
    "edge_clearance",
    "slope",
    "existing_place_separation",
    "candidate_separation",
  ] as const).map((reason) => ({ reason, count: counts.get(reason) ?? 0 }));
}

function incrementCount(counts: Map<SettlementSurveyRejectionReason, number>, reason: SettlementSurveyRejectionReason): void {
  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

function assertFinitePoint(point: PointTuple, context: string): void {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new ContractError(`${context} coordinates must be finite`);
  }
}

function assertPositive(value: number, context: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new ContractError(`${context} must be finite and positive`);
}

function assertNonNegative(value: number, context: string): void {
  if (!Number.isFinite(value) || value < 0) throw new ContractError(`${context} must be finite and non-negative`);
}

function assertFiniteInRange(
  value: number,
  minimum: number,
  maximum: number,
  context: string,
  maximumInclusive: boolean,
): void {
  if (!Number.isFinite(value) || value < minimum || (maximumInclusive ? value > maximum : value >= maximum)) {
    throw new ContractError(`${context} must be between ${String(minimum)} and ${String(maximum)}`);
  }
}

function distance(left: PointTuple, right: PointTuple): number {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
