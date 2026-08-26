import { describe, expect, it } from "vitest";
import {
  fitOrthographicView,
  panViewByPixels,
  screenToWorld,
  zoomViewAtScreenPoint,
} from "../../src/interaction/orthographicMath";

const size = { widthPx: 1000, heightPx: 600 };

describe("orthographic navigation math", () => {
  it("fits a metre-based world with north at the screen top", () => {
    const view = fitOrthographicView(10_000, 10_000, size);
    expect(view.centerX).toBe(5_000);
    expect(view.centerZ).toBe(5_000);
    const top = screenToWorld({ x: 500, y: 0 }, view, size);
    const bottom = screenToWorld({ x: 500, y: 600 }, view, size);
    expect(top.z).toBeLessThan(bottom.z);
    expect(screenToWorld({ x: 0, y: 300 }, view, size).x).toBeLessThan(
      screenToWorld({ x: 1000, y: 300 }, view, size).x,
    );
  });

  it("holds the world point under the cursor while zooming", () => {
    const view = fitOrthographicView(10_000, 8_000, size);
    const cursor = { x: 813, y: 137 };
    const before = screenToWorld(cursor, view, size);
    const zoomed = zoomViewAtScreenPoint(view, cursor, 1.8, size, view.heightM / 40, view.heightM * 4);
    const after = screenToWorld(cursor, zoomed, size);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.z).toBeCloseTo(before.z, 10);
  });

  it("pans content with middle/right drag semantics", () => {
    const view = fitOrthographicView(10_000, 8_000, size);
    const panned = panViewByPixels(view, { x: 100, y: 60 }, size);
    expect(panned.centerX).toBeLessThan(view.centerX);
    expect(panned.centerZ).toBeLessThan(view.centerZ);
  });
});
