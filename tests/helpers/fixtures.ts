import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTerrainDescriptor, type TerrainDescriptor } from "../../src/model/terrainDescriptor";
import { parseFloat32Npy } from "../../src/io/npy";
import { TerrainReference } from "../../src/terrain/TerrainReference";

const ROOT = fileURLToPath(new URL("../fixtures/terrain/", import.meta.url));

export async function fixtureBytes(name: string): Promise<ArrayBuffer> {
  const contents = await readFile(join(ROOT, name));
  return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength);
}

export async function fixtureJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, name), "utf8")) as T;
}

export async function fixtureDescriptor(): Promise<TerrainDescriptor> {
  return parseTerrainDescriptor(await fixtureJson("terrain-descriptor.json"));
}

export async function fixtureTerrain(): Promise<TerrainReference> {
  const parsed = parseFloat32Npy(await fixtureBytes("terrain-v1-c.npy"));
  return new TerrainReference(
    await fixtureDescriptor(),
    parsed.data,
    "c2013f1b8a7ea1a0bb6f325484795d231e98d9dd8505cb9b5fa94f056f4ef27f",
  );
}
