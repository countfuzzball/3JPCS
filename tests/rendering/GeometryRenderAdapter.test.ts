import { describe, expect, it } from "vitest";
import type { LandUseRegion, Road } from "../../src/model/entities";
import { GeometryRenderAdapter } from "../../src/rendering/GeometryRenderAdapter";

const LAYERS = { places: true, landUse: true, roads: true, hedgerows: true };
const EMPTY_DRAFT = { points: [], hover: null } as const;

describe("geometry render projection", () => {
  it("retains unchanged projections and replaces only changed model records", () => {
    const adapter = new GeometryRenderAdapter();
    const road = roadRecord();
    const woodland = woodlandRecord();
    adapter.sync([road, woodland], null, null, LAYERS, EMPTY_DRAFT, 101);
    const roadProjection = adapter.group.getObjectByName(`geometry:${road.id}`);
    const woodlandProjection = adapter.group.getObjectByName(`geometry:${woodland.id}`);

    adapter.sync([road, woodland], null, null, LAYERS, EMPTY_DRAFT, 101);
    expect(adapter.group.getObjectByName(`geometry:${road.id}`)).toBe(roadProjection);
    expect(adapter.group.getObjectByName(`geometry:${woodland.id}`)).toBe(woodlandProjection);

    const changed = { ...road, width_m: 9 };
    adapter.sync([changed, woodland], null, null, LAYERS, EMPTY_DRAFT, 101);
    expect(adapter.group.getObjectByName(`geometry:${road.id}`)).not.toBe(roadProjection);
    expect(adapter.group.getObjectByName(`geometry:${woodland.id}`)).toBe(woodlandProjection);
    adapter.dispose();
  });

  it("makes authored and per-object visibility projection-only", () => {
    const adapter = new GeometryRenderAdapter();
    const road = roadRecord();
    const woodland = { ...woodlandRecord(), visible: false };
    adapter.sync([road, woodland], null, null, { ...LAYERS, roads: false }, EMPTY_DRAFT, 101);
    expect(adapter.group.getObjectByName(`geometry:${road.id}`)?.visible).toBe(false);
    expect(adapter.group.getObjectByName(`geometry:${woodland.id}`)?.visible).toBe(false);
    expect(road).not.toHaveProperty("object3D");
    adapter.dispose();
  });
});

function roadRecord(): Road {
  return {
    kind: "road",
    id: "30000000-0000-4000-8000-000000000001",
    name: "Road",
    visible: true,
    locked: false,
    points: [[1, 1], [19, 1]],
    width_m: 5,
    road_class: "local_road",
    surface: "gravel",
  };
}

function woodlandRecord(): LandUseRegion {
  return {
    kind: "land_use",
    id: "30000000-0000-4000-8000-000000000002",
    name: "Woodland",
    visible: true,
    locked: false,
    land_use_type: "woodland",
    points: [[3, 3], [17, 3], [17, 17], [3, 17]],
  };
}
