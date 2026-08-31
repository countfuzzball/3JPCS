import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVegetationReference } from "../../src/model/references";

const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/settlement-automation/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(FIXTURE_ROOT, name), "utf8")) as T;
}

interface CandidateFixture {
  readonly terrain: { readonly world_size_m: number };
  readonly profile: {
    readonly sampling_margin_m: number;
    readonly maximum_slope_grade: number;
    readonly required_separation_m: number;
    readonly slope_weight: number;
    readonly edge_weight: number;
    readonly random_weight: number;
  };
  readonly candidates: readonly {
    readonly id: string;
    readonly point: readonly [number, number];
    readonly random_unit?: number;
    readonly measured?: {
      readonly slope_grade: number;
      readonly edge_penalty?: number;
      readonly height_penalty?: number;
      readonly nearest_settlement_distance_m?: number;
    };
    readonly expected: { readonly status: string; readonly reason?: string; readonly score?: number; readonly rank?: number };
  }[];
  readonly expected_ranked_ids: readonly string[];
  readonly terrain_sampling_comparison: {
    readonly legacy_slope_grade: number;
    readonly legacy_slope_as_degrees: number;
  };
}

interface RouteFixture {
  readonly world: { readonly grid_step_m: number };
  readonly height_grid_m_row_major_z: readonly (readonly number[])[];
  readonly noise_control: { readonly terrain_wiggle: number };
  readonly cost: { readonly slope_weight: number };
  readonly expected: {
    readonly raw_grid_path: readonly (readonly [number, number])[];
    readonly raw_world_path: readonly (readonly [number, number])[];
    readonly raw_cost: number;
    readonly barrier_grid_point_avoided: readonly [number, number];
    readonly chaikin_iterations: number;
    readonly smoothed_world_path: readonly (readonly [number, number])[];
  };
}

interface FrontageFixture {
  readonly random: { readonly initial_random_unit: number };
  readonly spacing: { readonly nominal_m: number; readonly initial_offset_base_m: number };
  readonly junction: { readonly point: readonly [number, number]; readonly radius_m: number; readonly candidate_margin_m: number };
  readonly sampled_anchors_before_final_shuffle: readonly {
    readonly distance_m: number;
    readonly point: readonly [number, number];
    readonly junction_rejected: boolean;
    readonly side_order: readonly number[];
    readonly next_spacing_multiplier: number;
  }[];
  readonly candidates_before_final_shuffle: readonly { readonly distance_m: number; readonly side: number }[];
  readonly placement_stage_slope_checks: {
    readonly maximum_grade: number;
    readonly sites: readonly { readonly measured_slope_grade: number; readonly expected: string }[];
  };
}

interface ContractFixture {
  readonly contracts: Readonly<Record<string, {
    readonly schema_path?: string;
    readonly schema_sha256?: string;
    readonly valid_document?: unknown;
    readonly root_keys?: readonly string[];
    readonly object_keys?: readonly string[];
  }>>;
}

describe("SA-0 settlement automation reference baseline", () => {
  it("freezes candidate scoring, rejection ordering, and slope-unit differences", async () => {
    const golden = await fixture<CandidateFixture>("candidate-site-scoring-v1.json");
    const scored = golden.candidates.filter((candidate) => candidate.expected.status === "scored");
    for (const candidate of scored) {
      const measured = candidate.measured!;
      const score = measured.slope_grade * golden.profile.slope_weight
        + measured.edge_penalty! * golden.profile.edge_weight
        + measured.height_penalty!
        + candidate.random_unit! * golden.profile.random_weight;
      expect(score).toBeCloseTo(candidate.expected.score!, 12);
    }
    expect([...scored].sort((left, right) => left.expected.score! - right.expected.score!).map(({ id }) => id))
      .toEqual(golden.expected_ranked_ids);

    const outside = golden.candidates.find(({ id }) => id === "outside-sampling-margin")!;
    const [outsideX, outsideZ] = outside.point;
    const maximum = golden.terrain.world_size_m - golden.profile.sampling_margin_m;
    expect(outsideX < golden.profile.sampling_margin_m || outsideX > maximum
      || outsideZ < golden.profile.sampling_margin_m || outsideZ > maximum).toBe(true);
    expect(outside.expected.reason).toBe("outside_sampling_domain");

    const steep = golden.candidates.find(({ id }) => id === "slope-rejected")!;
    expect(steep.measured!.slope_grade).toBeGreaterThan(golden.profile.maximum_slope_grade);
    expect(steep.expected.reason).toBe("slope");
    const close = golden.candidates.find(({ id }) => id === "separation-rejected")!;
    expect(close.measured!.nearest_settlement_distance_m).toBeLessThan(golden.profile.required_separation_m);
    expect(close.expected.reason).toBe("separation");

    const comparison = golden.terrain_sampling_comparison;
    expect(Math.atan(comparison.legacy_slope_grade) * 180 / Math.PI)
      .toBeCloseTo(comparison.legacy_slope_as_degrees, 12);
  });

  it("freezes the known-grid A* path and two-pass legacy smoothing", async () => {
    const golden = await fixture<RouteFixture>("astar-route-v1.json");
    const barrier = golden.expected.barrier_grid_point_avoided;
    expect(golden.expected.raw_grid_path).not.toContainEqual(barrier);

    let cost = 0;
    for (let index = 1; index < golden.expected.raw_grid_path.length; index += 1) {
      const previous = golden.expected.raw_grid_path[index - 1]!;
      const current = golden.expected.raw_grid_path[index]!;
      const dx = current[0] - previous[0];
      const dz = current[1] - previous[1];
      expect(Math.max(Math.abs(dx), Math.abs(dz))).toBe(1);
      const distanceM = Math.hypot(dx, dz) * golden.world.grid_step_m;
      const previousHeight = golden.height_grid_m_row_major_z[previous[1]]![previous[0]]!;
      const currentHeight = golden.height_grid_m_row_major_z[current[1]]![current[0]]!;
      const grade = Math.abs(currentHeight - previousHeight) / distanceM;
      cost += distanceM * (1 + golden.cost.slope_weight * grade ** 2 + golden.noise_control.terrain_wiggle);
    }
    expect(cost).toBeCloseTo(golden.expected.raw_cost, 12);
    expect(chaikin(golden.expected.raw_world_path, golden.expected.chaikin_iterations))
      .toEqual(golden.expected.smoothed_world_path);
  });

  it("freezes legacy frontage spacing, side emission, and staged rejection", async () => {
    const golden = await fixture<FrontageFixture>("frontage-policy-v1.json");
    const anchors = golden.sampled_anchors_before_final_shuffle;
    expect(anchors[0]!.distance_m).toBeCloseTo(
      golden.spacing.initial_offset_base_m + golden.random.initial_random_unit * golden.spacing.nominal_m,
      12,
    );
    for (let index = 1; index < anchors.length; index += 1) {
      expect(anchors[index]!.distance_m).toBeCloseTo(
        anchors[index - 1]!.distance_m
          + golden.spacing.nominal_m * anchors[index - 1]!.next_spacing_multiplier,
        12,
      );
    }
    for (const anchor of anchors) {
      const distanceToJunction = Math.hypot(
        anchor.point[0] - golden.junction.point[0],
        anchor.point[1] - golden.junction.point[1],
      );
      expect(anchor.junction_rejected)
        .toBe(distanceToJunction < golden.junction.radius_m + golden.junction.candidate_margin_m);
    }
    expect(golden.candidates_before_final_shuffle).toEqual(
      anchors.flatMap((anchor) => anchor.junction_rejected
        ? []
        : anchor.side_order.map((side) => ({ distance_m: anchor.distance_m, side }))),
    );
    for (const site of golden.placement_stage_slope_checks.sites) {
      expect(site.expected).toBe(site.measured_slope_grade <= golden.placement_stage_slope_checks.maximum_grade
        ? "accepted_by_slope_check"
        : "rejected_by_slope_check");
    }
  });

  it("freezes current schema files and the schema-less vegetation-v1 shape", async () => {
    const golden = await fixture<ContractFixture>("contract-freeze-v1.json");
    for (const contract of Object.values(golden.contracts)) {
      if (!contract.schema_path || !contract.schema_sha256) continue;
      const bytes = await readFile(resolve(REPOSITORY_ROOT, contract.schema_path));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(contract.schema_sha256);
    }

    const vegetation = golden.contracts.resampled_vegetation!;
    const document = vegetation.valid_document as Record<string, unknown>;
    expect(Object.keys(document)).toEqual(vegetation.root_keys);
    expect(Object.keys((document.objects as Record<string, unknown>[])[0]!)).toEqual(vegetation.object_keys);
    expect(parseVegetationReference(document, { widthM: 100, depthM: 100 }).objects).toHaveLength(1);
    expect(() => parseVegetationReference({ ...document, settlement_generator: {} }, { widthM: 100, depthM: 100 }))
      .toThrow(/invalid fields/);
  });
});

function chaikin(
  points: readonly (readonly [number, number])[],
  iterations: number,
): readonly (readonly [number, number])[] {
  let current = points.map(([x, z]) => [x, z] as [number, number]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const output: [number, number][] = [current[0]!];
    for (let index = 0; index < current.length - 1; index += 1) {
      const a = current[index]!;
      const b = current[index + 1]!;
      output.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
    }
    output.push(current.at(-1)!);
    current = output;
  }
  return current.map(([x, z]) => [roundLegacy(x), roundLegacy(z)] as const);
}

function roundLegacy(value: number): number {
  const scaled = value * 100;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  if (Math.abs(fraction - 0.5) <= Number.EPSILON * Math.max(1, Math.abs(scaled))) {
    return (lower % 2 === 0 ? lower : lower + 1) / 100;
  }
  return Math.round(scaled) / 100;
}
