import { ContractError } from "../model/errors";
import type { TerrainDescriptor } from "../model/terrainDescriptor";
import type { TerrainSurface } from "./TerrainSurface";

export interface TerrainFingerprint {
  readonly sha256: string;
  readonly world_width_m: number;
  readonly world_depth_m: number;
  readonly spacing_m: number;
  readonly cell_count_x: number;
  readonly cell_count_z: number;
  readonly point_count_x: number;
  readonly point_count_z: number;
}

export class TerrainReference implements TerrainSurface {
  readonly #heights: Float32Array;
  public readonly descriptor: TerrainDescriptor;
  public readonly sourceSha256: string;

  public constructor(descriptor: TerrainDescriptor, sourceHeights: Float32Array, sourceSha256: string) {
    const expected = descriptor.elevation_points.total;
    if (sourceHeights.length !== expected) {
      throw new ContractError(
        `terrain NPY shape does not match descriptor (expected ${String(descriptor.elevation_points.z)} rows × ${String(descriptor.elevation_points.x)} columns)`,
      );
    }
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const height of sourceHeights) {
      if (!Number.isFinite(height)) {
        throw new ContractError("terrain NPY contains non-finite elevations");
      }
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
    if (
      minimum < descriptor.minimum_elevation_m - 1e-4
      || maximum > descriptor.maximum_elevation_m + 1e-4
    ) {
      throw new ContractError("terrain NPY elevations exceed descriptor endpoints");
    }
    if (!/^[0-9a-f]{64}$/.test(sourceSha256)) {
      throw new ContractError("terrain source SHA-256 is malformed");
    }
    this.descriptor = descriptor;
    this.sourceSha256 = sourceSha256;
    this.#heights = new Float32Array(sourceHeights);
  }

  public get worldWidthM(): number { return this.descriptor.world_width_m; }
  public get worldDepthM(): number { return this.descriptor.world_depth_m; }
  public get spacingM(): number { return this.descriptor.terrain_spacing_m; }
  public get cellCountX(): number { return this.descriptor.terrain_cells.x; }
  public get cellCountZ(): number { return this.descriptor.terrain_cells.z; }
  public get pointCountX(): number { return this.descriptor.elevation_points.x; }
  public get pointCountZ(): number { return this.descriptor.elevation_points.z; }
  public get minimumElevationM(): number { return this.descriptor.minimum_elevation_m; }
  public get seaLevelM(): number { return this.descriptor.sea_level_m; }
  public get lowlandReferenceElevationM(): number { return this.descriptor.lowland_reference_elevation_m; }
  public get maximumElevationM(): number { return this.descriptor.maximum_elevation_m; }

  public get fingerprint(): TerrainFingerprint {
    return {
      sha256: this.sourceSha256,
      world_width_m: this.worldWidthM,
      world_depth_m: this.worldDepthM,
      spacing_m: this.spacingM,
      cell_count_x: this.cellCountX,
      cell_count_z: this.cellCountZ,
      point_count_x: this.pointCountX,
      point_count_z: this.pointCountZ,
    };
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
    if (value === undefined) {
      throw new ContractError("terrain grid query could not resolve a value");
    }
    return value;
  }

  public copyHeights(): Float32Array {
    return new Float32Array(this.#heights);
  }

  public heightAt(xM: number, zM: number): number {
    const cell = this.#cellAt(xM, zM);
    const nw = this.heightAtGrid(cell.x, cell.z);
    const ne = this.heightAtGrid(cell.x + 1, cell.z);
    const sw = this.heightAtGrid(cell.x, cell.z + 1);
    const se = this.heightAtGrid(cell.x + 1, cell.z + 1);
    if (cell.localZ <= cell.localX) {
      return nw + cell.localX * (ne - nw) + cell.localZ * (se - ne);
    }
    return nw + cell.localZ * (sw - nw) + cell.localX * (se - sw);
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

  #cellAt(xM: number, zM: number): { readonly x: number; readonly z: number; readonly localX: number; readonly localZ: number } {
    if (!Number.isFinite(xM) || !Number.isFinite(zM)) {
      throw new ContractError("terrain query coordinates must be finite");
    }
    if (xM < 0 || xM > this.worldWidthM || zM < 0 || zM > this.worldDepthM) {
      throw new ContractError("terrain query is outside the world");
    }
    const gridX = xM / this.spacingM;
    const gridZ = zM / this.spacingM;
    const cellX = Math.min(Math.floor(gridX), this.cellCountX - 1);
    const cellZ = Math.min(Math.floor(gridZ), this.cellCountZ - 1);
    return { x: cellX, z: cellZ, localX: gridX - cellX, localZ: gridZ - cellZ };
  }
}
