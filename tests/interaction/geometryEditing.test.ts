import { describe, expect, it } from "vitest";
import type { LandUseRegion, LinearFeature, PlaceRegion, Road } from "../../src/model/entities";
import { ProjectModel } from "../../src/model/ProjectModel";
import {
  countDistinctPoints,
  dedupeDraft,
  deleteControlPoint,
  hitTestGeometry,
  insertControlPoint,
  moveGeometryEntity,
  nearestSegment,
  pointInPolygon,
} from "../../src/interaction/geometryEditing";
import { fixtureTerrain } from "../helpers/fixtures";

const ALL_LAYERS = { places: true, landUse: true, roads: true, hedgerows: true };

describe("geometry authoring math and picking", () => {
  it("clamps whole-object extents and individual vertices to inclusive world bounds", () => {
    const place = placeRecord();
    const moved = moveGeometryEntity(place, { x: 50, z: -50 }, { widthM: 20, depthM: 20 }, null);
    expect(moved.points).toEqual([[14, 0], [20, 0], [20, 6], [14, 6]]);

    const vertex = moveGeometryEntity(place, { x: -50, z: 50 }, { widthM: 20, depthM: 20 }, 1);
    expect(vertex.points[1]).toEqual([0, 20]);
    expect(vertex.points[0]).toEqual(place.points[0]);
  });

  it("inserts on a selected polyline segment and enforces minimum delete counts", () => {
    const road = roadRecord();
    const nearest = nearestSegment({ x: 9, z: 2 }, road.points);
    expect(nearest.segmentIndex).toBe(0);
    expect(nearest.distance).toBeCloseTo(1);
    const inserted = insertControlPoint(road, nearest.segmentIndex, { x: 9, z: 2 });
    expect(inserted.points).toEqual([[1, 1], [9, 2], [19, 1]]);
    expect(deleteControlPoint(inserted, 1)?.points).toEqual(road.points);
    expect(deleteControlPoint(road, 0)).toBeNull();
    expect(deleteControlPoint(placeRecord(), 0)?.points).toHaveLength(3);
  });

  it("deduplicates the browser double-click tail and requires globally distinct polygon points", () => {
    const points = dedupeDraft([{ x: 1, z: 1 }, { x: 5, z: 1 }, { x: 5, z: 1 }, { x: 1, z: 1 }]);
    expect(points).toEqual([[1, 1], [5, 1], [1, 1]]);
    expect(countDistinctPoints(points)).toBe(2);
  });

  it("uses selected handles, foreground lines, reverse order, visibility, and layers for picking", async () => {
    const model = await emptyModel();
    const place = placeRecord();
    const woodland: LandUseRegion = {
      kind: "land_use",
      id: "20000000-0000-4000-8000-000000000002",
      name: "Woodland",
      visible: true,
      locked: false,
      land_use_type: "woodland",
      points: [[3, 3], [17, 3], [17, 17], [3, 17]],
    };
    const road = roadRecord();
    const hedge: LinearFeature = {
      kind: "linear_feature",
      id: "20000000-0000-4000-8000-000000000004",
      name: "Hedgerow",
      visible: true,
      locked: true,
      feature_type: "hedgerow",
      points: [[1, 1], [19, 1]],
      nominal_width_m: 2,
      nominal_height_m: 2,
    };
    model.insert(place);
    model.insert(woodland);
    model.insert(road);
    model.insert(hedge);

    expect(hitTestGeometry(model, { x: 1, z: 1 }, 0.5, ALL_LAYERS, road.id)).toEqual({ id: road.id, vertexIndex: 0 });
    expect(hitTestGeometry(model, { x: 10, z: 1 }, 0.5, ALL_LAYERS, null)?.id).toBe(hedge.id);
    expect(hitTestGeometry(model, { x: 10, z: 10 }, 0.5, ALL_LAYERS, null)?.id).toBe(woodland.id);
    expect(hitTestGeometry(model, { x: 10, z: 10 }, 0.5, { ...ALL_LAYERS, landUse: false }, null)?.id).toBe(place.id);

    model.replace({ ...hedge, visible: false });
    expect(hitTestGeometry(model, { x: 10, z: 1 }, 0.5, ALL_LAYERS, null)?.id).toBe(road.id);
    expect(hitTestGeometry(model, { x: 10, z: 1 }, 0.5, { ...ALL_LAYERS, roads: false }, null)?.id).not.toBe(road.id);
  });

  it("classifies polygon interiors for filled-region picking", () => {
    const place = placeRecord();
    expect(pointInPolygon({ x: 7, z: 7 }, place.points)).toBe(true);
    expect(pointInPolygon({ x: 19, z: 19 }, place.points)).toBe(false);
  });
});

async function emptyModel(): Promise<ProjectModel> {
  const terrain = await fixtureTerrain();
  return ProjectModel.create({
    name: "Geometry Golden",
    world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
    sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
    terrain_fingerprint: terrain.fingerprint,
  });
}

function placeRecord(): PlaceRegion {
  return {
    kind: "place",
    id: "20000000-0000-4000-8000-000000000001",
    name: "Town",
    visible: true,
    locked: false,
    place_type: "town",
    points: [[4, 4], [10, 4], [10, 10], [4, 10]],
  };
}

function roadRecord(): Road {
  return {
    kind: "road",
    id: "20000000-0000-4000-8000-000000000003",
    name: "Road",
    visible: true,
    locked: false,
    points: [[1, 1], [19, 1]],
    width_m: 5,
    road_class: "local_road",
    surface: "gravel",
  };
}
