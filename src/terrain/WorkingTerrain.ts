import type { PointTuple, PrefabInstance } from "../model/entities";
import { ContractError } from "../model/errors";
import { TerrainReference } from "./TerrainReference";
import type { TerrainSurface } from "./TerrainSurface";

export interface FootprintSiteInfo {
  readonly originElevationM: number;
  readonly minimumElevationM: number;
  readonly maximumElevationM: number;
  readonly elevationRangeM: number;
  readonly maximumSlopeDeg: number;
  readonly averageSlopeDeg: number;
  readonly footprintOutsideWorld: boolean;
}

export class WorkingTerrain implements TerrainSurface {
  readonly #heights: Float32Array;

  private constructor(
    public readonly base: TerrainReference,
    heights: Float32Array,
  ) {
    this.#heights = heights;
  }

  public static compose(base: TerrainReference, prefabs: readonly PrefabInstance[]): WorkingTerrain {
    const heights = base.copyHeights();
    for (const prefab of prefabs) {
      if (prefab.visible && prefab.terrain_pad.enabled) applyPad(heights, base, prefab);
    }
    for (let index = 0; index < heights.length; index += 1) {
      const height = heights[index];
      if (height === undefined) throw new ContractError("working terrain contains a missing elevation");
      heights[index] = Math.fround(Math.max(base.minimumElevationM, Math.min(base.maximumElevationM, height)));
    }
    return new WorkingTerrain(base, heights);
  }

  public get worldWidthM(): number { return this.base.worldWidthM; }
  public get worldDepthM(): number { return this.base.worldDepthM; }
  public get spacingM(): number { return this.base.spacingM; }
  public get cellCountX(): number { return this.base.cellCountX; }
  public get cellCountZ(): number { return this.base.cellCountZ; }
  public get pointCountX(): number { return this.base.pointCountX; }
  public get pointCountZ(): number { return this.base.pointCountZ; }
  public get minimumElevationM(): number { return this.base.minimumElevationM; }
  public get seaLevelM(): number { return this.base.seaLevelM; }
  public get lowlandReferenceElevationM(): number { return this.base.lowlandReferenceElevationM; }
  public get maximumElevationM(): number { return this.base.maximumElevationM; }

  public copyHeights(): Float32Array {
    return new Float32Array(this.#heights);
  }

  public heightAtGrid(xIndex: number, zIndex: number): number {
    if (
      !Number.isInteger(xIndex)
      || !Number.isInteger(zIndex)
      || xIndex < 0
      || zIndex < 0
      || xIndex >= this.pointCountX
      || zIndex >= this.pointCountZ
    ) {
      throw new ContractError("terrain grid query is outside the elevation array");
    }
    const value = this.#heights[zIndex * this.pointCountX + xIndex];
    if (value === undefined) throw new ContractError("terrain grid query could not resolve a value");
    return value;
  }

  public heightAt(xM: number, zM: number): number {
    const cell = this.#cellAt(xM, zM);
    const nw = this.heightAtGrid(cell.x, cell.z);
    const ne = this.heightAtGrid(cell.x + 1, cell.z);
    const sw = this.heightAtGrid(cell.x, cell.z + 1);
    const se = this.heightAtGrid(cell.x + 1, cell.z + 1);
    return cell.localZ <= cell.localX
      ? nw + cell.localX * (ne - nw) + cell.localZ * (se - ne)
      : nw + cell.localZ * (sw - nw) + cell.localX * (se - sw);
  }

  public slopeAt(xM: number, zM: number): number {
    const cell = this.#cellAt(xM, zM);
    const nw = this.heightAtGrid(cell.x, cell.z);
    const ne = this.heightAtGrid(cell.x + 1, cell.z);
    const sw = this.heightAtGrid(cell.x, cell.z + 1);
    const se = this.heightAtGrid(cell.x + 1, cell.z + 1);
    const [dhDx, dhDz] = cell.localZ <= cell.localX
      ? [(ne - nw) / this.spacingM, (se - ne) / this.spacingM]
      : [(se - sw) / this.spacingM, (sw - nw) / this.spacingM];
    return Math.atan(Math.hypot(dhDx, dhDz)) * 180 / Math.PI;
  }

  public footprintSiteInfo(points: readonly PointTuple[], origin: PointTuple): FootprintSiteInfo {
    if (points.length < 3) throw new ContractError("prefab footprint must contain at least three points");
    const samples: PointTuple[] = [...points];
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (!current || !next) throw new ContractError("prefab footprint is malformed");
      samples.push([(current[0] + next[0]) / 2, (current[1] + next[1]) / 2]);
    }
    samples.push(origin);
    const outside = points.some(([x, z]) => x < 0 || x > this.worldWidthM || z < 0 || z > this.worldDepthM);
    const inside = samples.map(([x, z]) => [
      Math.max(0, Math.min(this.worldWidthM, x)),
      Math.max(0, Math.min(this.worldDepthM, z)),
    ] as PointTuple);
    const elevations = inside.map(([x, z]) => this.heightAt(x, z));
    const slopes = inside.map(([x, z]) => this.slopeAt(x, z));
    const minimum = Math.min(...elevations);
    const maximum = Math.max(...elevations);
    return {
      originElevationM: this.heightAt(origin[0], origin[1]),
      minimumElevationM: minimum,
      maximumElevationM: maximum,
      elevationRangeM: maximum - minimum,
      maximumSlopeDeg: Math.max(...slopes),
      averageSlopeDeg: slopes.reduce((sum, slope) => sum + slope, 0) / slopes.length,
      footprintOutsideWorld: outside,
    };
  }

  #cellAt(xM: number, zM: number): { readonly x: number; readonly z: number; readonly localX: number; readonly localZ: number } {
    if (!Number.isFinite(xM) || !Number.isFinite(zM)) throw new ContractError("terrain query coordinates must be finite");
    if (xM < 0 || xM > this.worldWidthM || zM < 0 || zM > this.worldDepthM) {
      throw new ContractError("terrain query is outside the world");
    }
    const gridX = xM / this.spacingM;
    const gridZ = zM / this.spacingM;
    const x = Math.min(Math.floor(gridX), this.cellCountX - 1);
    const z = Math.min(Math.floor(gridZ), this.cellCountZ - 1);
    return { x, z, localX: gridX - x, localZ: gridZ - z };
  }
}

function applyPad(heights: Float32Array, base: TerrainReference, prefab: PrefabInstance): void {
  const pad = prefab.terrain_pad;
  const angle = prefab.rotation_deg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cellProjection = base.spacingM * 0.5 * (Math.abs(cosine) + Math.abs(sine));
  const halfWidth = pad.width_m * 0.5 + cellProjection;
  const halfDepth = pad.depth_m * 0.5 + cellProjection;
  const boundX = Math.abs(cosine) * halfWidth + Math.abs(sine) * halfDepth + pad.blend_m;
  const boundZ = Math.abs(sine) * halfWidth + Math.abs(cosine) * halfDepth + pad.blend_m;
  const x0 = Math.max(0, Math.floor((prefab.x_m - boundX) / base.spacingM));
  const x1 = Math.min(base.pointCountX - 1, Math.ceil((prefab.x_m + boundX) / base.spacingM));
  const z0 = Math.max(0, Math.floor((prefab.z_m - boundZ) / base.spacingM));
  const z1 = Math.min(base.pointCountZ - 1, Math.ceil((prefab.z_m + boundZ) / base.spacingM));
  if (x0 > x1 || z0 > z1) return;

  const target = Math.fround(base.heightAt(prefab.x_m, prefab.z_m));
  for (let zIndex = z0; zIndex <= z1; zIndex += 1) {
    for (let xIndex = x0; xIndex <= x1; xIndex += 1) {
      const dx = xIndex * base.spacingM - prefab.x_m;
      const dz = zIndex * base.spacingM - prefab.z_m;
      const localX = cosine * dx + sine * dz;
      const localZ = -sine * dx + cosine * dz;
      const outsideX = Math.max(Math.abs(localX) - halfWidth, 0);
      const outsideZ = Math.max(Math.abs(localZ) - halfDepth, 0);
      const distance = Math.hypot(outsideX, outsideZ);
      let weight: number;
      if (pad.blend_m === 0) {
        weight = distance === 0 ? 1 : 0;
      } else {
        const t = Math.max(0, Math.min(1, 1 - distance / pad.blend_m));
        weight = Math.fround(t * t * (3 - 2 * t));
      }
      const index = zIndex * base.pointCountX + xIndex;
      const current = heights[index];
      if (current === undefined) throw new ContractError("working terrain pad addressed a missing elevation");
      const delta = Math.fround(target - current);
      const weightedDelta = Math.fround(weight * delta);
      heights[index] = Math.fround(current + weightedDelta);
    }
  }
}
