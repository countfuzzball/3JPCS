import { describe, expect, it } from "vitest";
import {
  LAND_USE_TYPES,
  PLACE_TYPES,
  ROAD_CLASSES,
  ROAD_SURFACES,
  validateEntity,
  type LandUseRegion,
  type PlaceRegion,
  type Road,
} from "../../src/model/entities";

const WORLD = { widthM: 20, depthM: 20 };

describe("authored entity contracts", () => {
  it.each(PLACE_TYPES)("accepts place type %s", (placeType) => {
    expect(() => validateEntity(place(placeType), WORLD)).not.toThrow();
  });

  it.each(LAND_USE_TYPES)("accepts land-use type %s", (landUseType) => {
    const entity: LandUseRegion = {
      kind: "land_use",
      id: "40000000-0000-4000-8000-000000000002",
      name: "Land",
      visible: true,
      locked: false,
      land_use_type: landUseType,
      points: [[0, 0], [20, 0], [20, 20]],
    };
    expect(() => validateEntity(entity, WORLD)).not.toThrow();
  });

  for (const roadClass of ROAD_CLASSES) {
    for (const surface of ROAD_SURFACES) {
      it(`accepts road ${roadClass}/${surface}`, () => {
        expect(() => validateEntity(road(roadClass, surface), WORLD)).not.toThrow();
      });
    }
  }

  it("rejects invalid common, numeric, enum, and point contracts", () => {
    expect(() => validateEntity({ ...place("town"), name: " " }, WORLD)).toThrow(/non-empty/i);
    expect(() => validateEntity({ ...place("town"), visible: "yes" as never }, WORLD)).toThrow(/boolean/i);
    expect(() => validateEntity({ ...road("lane", "dirt"), width_m: 0 }, WORLD)).toThrow(/greater than zero/i);
    expect(() => validateEntity({ ...road("lane", "dirt"), road_class: "motorway" as never }, WORLD)).toThrow(/unsupported/i);
    expect(() => validateEntity({ ...place("town"), points: [[0, 0], [1, 1]] }, WORLD)).toThrow(/at least 3/i);
  });
});

function place(placeType: PlaceRegion["place_type"]): PlaceRegion {
  return {
    kind: "place",
    id: "40000000-0000-4000-8000-000000000001",
    name: "Place",
    visible: true,
    locked: false,
    place_type: placeType,
    points: [[0, 0], [20, 0], [20, 20]],
  };
}

function road(roadClass: Road["road_class"], surface: Road["surface"]): Road {
  return {
    kind: "road",
    id: "40000000-0000-4000-8000-000000000003",
    name: "Road",
    visible: true,
    locked: false,
    points: [[0, 0], [20, 20]],
    width_m: 1,
    road_class: roadClass,
    surface,
  };
}
