import { parseFloat32Npy } from "./npy";
import { ContractError } from "../model/errors";
import { parseTerrainDescriptor } from "../model/terrainDescriptor";
import { TerrainReference } from "../terrain/TerrainReference";

export interface TerrainSourceSelection {
  readonly npy: File;
  readonly descriptor: File;
}

export async function importTerrainSources(selection: TerrainSourceSelection): Promise<TerrainReference> {
  const [npyBytes, descriptorText] = await Promise.all([
    selection.npy.arrayBuffer(),
    selection.descriptor.text(),
  ]);
  let descriptorDocument: unknown;
  try {
    descriptorDocument = JSON.parse(descriptorText) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContractError(`cannot read terrain descriptor JSON: ${reason}`);
  }
  const descriptor = parseTerrainDescriptor(descriptorDocument);
  const parsed = parseFloat32Npy(npyBytes);
  if (
    parsed.shape[0] !== descriptor.elevation_points.z
    || parsed.shape[1] !== descriptor.elevation_points.x
  ) {
    throw new ContractError(
      `terrain NPY shape (${String(parsed.shape[0])}, ${String(parsed.shape[1])}) does not match descriptor (z=${String(descriptor.elevation_points.z)}, x=${String(descriptor.elevation_points.x)})`,
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", npyBytes);
  return new TerrainReference(descriptor, parsed.data, bytesToHex(new Uint8Array(digest)));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
