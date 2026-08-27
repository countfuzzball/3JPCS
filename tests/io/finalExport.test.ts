import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  encodeGrayscale16Png,
  finalTerrainArtifacts,
  resampledVegetationDocument,
} from "../../src/io/finalExport";
import { parseVegetationReference } from "../../src/model/references";
import { WorkingTerrain } from "../../src/terrain/WorkingTerrain";
import { fixtureTerrain } from "../helpers/fixtures";
import { vegetationDocument } from "../helpers/referenceFixtures";

describe("legacy-compatible final exports", () => {
  it("writes an actual grayscale 16-bit PNG with big-endian decoded codes", async () => {
    const png = await encodeGrayscale16Png(2, 2, new Uint16Array([0, 1, 32768, 65535]));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = readChunks(png);
    expect(chunks.IHDR?.[8]).toBe(16);
    expect(chunks.IHDR?.[9]).toBe(0);
    const rows = inflateSync(chunks.IDAT!);
    expect([...rows]).toEqual([0, 0, 0, 0, 1, 0, 128, 0, 255, 255]);
  });

  it("exports complete metadata and resamples only vegetation Y", async () => {
    const base = await fixtureTerrain();
    const working = WorkingTerrain.compose(base, []);
    const artifacts = await finalTerrainArtifacts(working);
    expect(artifacts.metadata).not.toHaveProperty("schema_version");
    expect(artifacts.metadata.elevation_points).toEqual({ x: 3, z: 3, total: 9 });
    const vegetation = parseVegetationReference(vegetationDocument(), { widthM: 20, depthM: 20 });
    const output = resampledVegetationDocument(vegetation, working) as { objects: Record<string, unknown>[]; generated_object_count: number };
    expect(output.generated_object_count).toBe(1);
    expect(output.objects[0]).toEqual({ ...vegetation.objects[0], terrain_y_m: working.heightAt(4, 5) });
  });
});

function readChunks(png: Uint8Array): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
    result[type] = png.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  return result;
}
