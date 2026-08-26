import { describe, expect, it, vi } from "vitest";
import { EditorStore } from "../../src/app/EditorStore";
import { fixtureTerrain } from "../helpers/fixtures";

describe("project seed and dirty state", () => {
  it("keeps portable source hints separate from terrain data and starts dirty", async () => {
    const store = new EditorStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.createProject("Golden County", await fixtureTerrain(), {
      npy: "terrain-v1-c.npy",
      descriptor: "terrain-descriptor.json",
    });
    expect(store.state.dirty).toBe(true);
    expect(store.state.model?.sources.terrain_npy).toBe("terrain-v1-c.npy");
    expect(store.state.model?.terrainFingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.toDocument().schema_version).toBe(4);
    expect(store.toDocument().vegetation_instances).toEqual([]);
    expect(JSON.stringify(store.toDocument())).not.toContain("heights");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
