import type { VegetationReference } from "../model/references";
import { COORDINATE_SYSTEM } from "../model/references";
import type { WorkingTerrain } from "../terrain/WorkingTerrain";

export interface FinalTerrainArtifacts {
  readonly png: Uint8Array;
  readonly metadata: Record<string, unknown>;
}

export async function finalTerrainArtifacts(terrain: WorkingTerrain): Promise<FinalTerrainArtifacts> {
  const codes = quantizeTerrain(terrain);
  return {
    png: await encodeGrayscale16Png(terrain.pointCountX, terrain.pointCountZ, codes),
    metadata: heightmapMetadataDocument(terrain),
  };
}

export function heightmapMetadataDocument(terrain: WorkingTerrain): Record<string, unknown> {
  const encode = (height: number): number => quantizeHeight(height, terrain.minimumElevationM, terrain.maximumElevationM);
  return {
    world_width_m: terrain.worldWidthM,
    world_depth_m: terrain.worldDepthM,
    terrain_spacing_m: terrain.spacingM,
    terrain_cells: { x: terrain.cellCountX, z: terrain.cellCountZ, total: terrain.cellCountX * terrain.cellCountZ },
    elevation_points: { x: terrain.pointCountX, z: terrain.pointCountZ, total: terrain.pointCountX * terrain.pointCountZ },
    minimum_elevation_m: terrain.minimumElevationM,
    sea_level_m: terrain.seaLevelM,
    lowland_reference_elevation_m: terrain.lowlandReferenceElevationM,
    maximum_elevation_m: terrain.maximumElevationM,
    uint16_reference_values: {
      sea_level: encode(terrain.seaLevelM),
      lowland_reference: encode(terrain.lowlandReferenceElevationM),
    },
    vertical_encoding: "Unsigned 16-bit greyscale: 0 maps to minimum_elevation_m and 65535 maps to maximum_elevation_m; values outside that range are clipped.",
    grid_layout: "Rows increase along +Z; columns increase along +X.",
    cell_diagonal: "Each cell is divided from northwest to southeast.",
  };
}

export function resampledVegetationDocument(
  vegetation: VegetationReference,
  terrain: WorkingTerrain,
): Record<string, unknown> {
  const objects = vegetation.objects.map((source) => ({
    ...source,
    terrain_y_m: terrain.heightAt(source.x_m, source.z_m),
  }));
  return {
    schema_version: 1,
    project_id: vegetation.project_id,
    project_name: vegetation.project_name,
    coordinate_system: COORDINATE_SYSTEM,
    generated_object_count: objects.length,
    objects,
  };
}

export function quantizeTerrain(terrain: WorkingTerrain): Uint16Array {
  const heights = terrain.copyHeights();
  return Uint16Array.from(heights, (height) => quantizeHeight(height, terrain.minimumElevationM, terrain.maximumElevationM));
}

export async function encodeGrayscale16Png(width: number, height: number, samples: Uint16Array): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || samples.length !== width * height) {
    throw new Error("PNG dimensions do not match the sample array");
  }
  const scanlines = new Uint8Array(height * (1 + width * 2));
  for (let z = 0; z < height; z += 1) {
    const row = z * (1 + width * 2);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const sample = samples[z * width + x];
      if (sample === undefined) throw new Error("PNG sample array is incomplete");
      scanlines[row + 1 + x * 2] = sample >>> 8;
      scanlines[row + 2 + x * 2] = sample & 0xff;
    }
  }
  const compressed = await deflate(scanlines);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([16, 0, 0, 0, 0], 8);
  return concatenate([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function quantizeHeight(height: number, minimum: number, maximum: number): number {
  const normalized = Math.max(0, Math.min(1, (height - minimum) / (maximum - minimum)));
  return roundHalfToEven(normalized * 65_535);
}

function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) <= Number.EPSILON * Math.max(1, Math.abs(value))) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(value);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length, false);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(concatenate([typeBytes, data])), false);
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
