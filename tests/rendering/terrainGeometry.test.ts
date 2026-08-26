import { describe, expect, it } from "vitest";
import { buildTerrainGeometry } from "../../src/rendering/terrain/terrainGeometry";
import { buildTerrainPixels } from "../../src/rendering/terrain/terrainTexture";
import { fixtureTerrain } from "../helpers/fixtures";

describe("terrain render projection", () => {
  it("uses NW-SE cells with +Y-facing winding", async () => {
    const geometry = buildTerrainGeometry(await fixtureTerrain());
    const index = geometry.getIndex();
    expect(index ? [...index.array.slice(0, 6)] : null).toEqual([0, 4, 1, 0, 3, 4]);
    const positions = geometry.getAttribute("position");
    const a = [positions.getX(0), positions.getY(0), positions.getZ(0)];
    const b = [positions.getX(4), positions.getY(4), positions.getZ(4)];
    const c = [positions.getX(1), positions.getY(1), positions.getZ(1)];
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const crossY = ab[2]! * ac[0]! - ab[0]! * ac[2]!;
    expect(crossY).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("builds independent terrain/hillshade/contour preview combinations", async () => {
    const terrain = await fixtureTerrain();
    const full = buildTerrainPixels(terrain, { terrain: true, hillshade: true, contours: true });
    const plain = buildTerrainPixels(terrain, { terrain: false, hillshade: false, contours: false });
    expect(full).toHaveLength(terrain.pointCountX * terrain.pointCountZ * 4);
    expect([...full]).not.toEqual([...plain]);
    expect([...plain.slice(0, 4)]).toEqual([38, 44, 46, 255]);
  });
});
