import { describe, expect, it } from "vitest";
import { rotateLocalPoint, threeYawRadians } from "../../src/model/coordinates";

describe("Polygon County yaw convention", () => {
  it.each([
    [0, 0, -1],
    [90, 1, 0],
    [180, 0, 1],
    [270, -1, 0],
  ])("maps %d degrees to the expected north/east/south/west front", (degrees, x, z) => {
    const result = rotateLocalPoint({ x: 0, z: -1 }, degrees);
    expect(result.x).toBeCloseTo(x, 10);
    expect(result.z).toBeCloseTo(z, 10);
  });

  it("maps clockwise authored yaw to negative Three.js Y radians", () => {
    expect(threeYawRadians(90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(threeYawRadians(450)).toBeCloseTo(-Math.PI * 2.5, 12);
  });
});
