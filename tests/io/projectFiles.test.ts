import { File } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  MissingProjectSourcesError,
  openBrowserProject,
  projectJson,
  resolveSourceHint,
} from "../../src/io/projectFiles";
import { ProjectModel } from "../../src/model/ProjectModel";
import { fixtureBytes, fixtureJson, fixtureTerrain } from "../helpers/fixtures";

describe("browser project persistence and relinking", () => {
  it("round-trips v4 without serializing terrain or browser file state", async () => {
    const model = await projectModel();
    const text = projectJson(model);
    expect(JSON.parse(text)).toEqual(model.toDocument());
    expect(text).not.toContain("heights");
    expect(text).not.toContain("FileSystem");
  });

  it("resolves simple relative hints but never binds an absolute legacy path by basename", () => {
    const candidate = file(["terrain"], "terrain.npy", "application/octet-stream");
    expect(resolveSourceHint("terrain.npy", [candidate])).toBe(candidate);
    expect(resolveSourceHint("C:\\old\\terrain.npy", [candidate])).toBeUndefined();
    expect(resolveSourceHint("/old/terrain.npy", [candidate])).toBeUndefined();
  });

  it("opens with explicit relinks, migrates legacy v3 to v4, and warns on changed compatible terrain", async () => {
    const model = await projectModel();
    const legacy = structuredClone(model.toDocument()) as unknown as Record<string, unknown>;
    legacy.schema_version = 3;
    delete legacy.vegetation_instances;
    const opened = await openBrowserProject({
      project: file([JSON.stringify(legacy)], "project.scenery.json", "application/json"),
      relink: {
        terrain_npy: file([new Uint8Array(await fixtureBytes("terrain-v3-c.npy"))], "moved.npy", "application/octet-stream"),
        terrain_descriptor: file([JSON.stringify(await fixtureJson("terrain-descriptor.json"))], "moved.json", "application/json"),
      },
    });
    expect(opened.sourceSchemaVersion).toBe(3);
    expect(opened.model.toDocument().schema_version).toBe(4);
    expect(opened.model.sources.terrain_npy).toBe("moved.npy");
    expect(opened.warnings.join(" ")).toMatch(/contents changed/);
    expect(opened.model.terrainFingerprint.sha256).toBe(opened.terrain.fingerprint.sha256);
    expect(opened.requiresSave).toBe(true);
  });

  it("reports required sources that need browser relinking", async () => {
    const model = await projectModel();
    await expect(openBrowserProject({ project: file([projectJson(model)], "project.json", "application/json") }))
      .rejects.toBeInstanceOf(MissingProjectSourcesError);
  });
});

async function projectModel(): Promise<ProjectModel> {
  const terrain = await fixtureTerrain();
  return ProjectModel.create({
    name: "Browser Project",
    world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
    sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
    terrain_fingerprint: terrain.fingerprint,
  });
}

function file(parts: ConstructorParameters<typeof File>[0], name: string, type: string): globalThis.File {
  return new File(parts, name, { type }) as unknown as globalThis.File;
}
