import type { PointXZ } from "../model/coordinates";

export interface ViewportSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface OrthographicView {
  readonly centerX: number;
  readonly centerZ: number;
  readonly heightM: number;
}

export function viewportAspect(size: ViewportSize): number {
  return Math.max(1, size.widthPx) / Math.max(1, size.heightPx);
}

export function viewWidthM(view: OrthographicView, size: ViewportSize): number {
  return view.heightM * viewportAspect(size);
}

export function fitOrthographicView(
  worldWidthM: number,
  worldDepthM: number,
  size: ViewportSize,
  fillFraction = 0.9,
): OrthographicView {
  const safeFill = Math.max(0.1, Math.min(1, fillFraction));
  const heightM = Math.max(worldDepthM, worldWidthM / viewportAspect(size)) / safeFill;
  return { centerX: worldWidthM / 2, centerZ: worldDepthM / 2, heightM };
}

export function screenToWorld(
  pointPx: { readonly x: number; readonly y: number },
  view: OrthographicView,
  size: ViewportSize,
): PointXZ {
  const widthM = viewWidthM(view, size);
  return {
    x: view.centerX + (pointPx.x / Math.max(1, size.widthPx) - 0.5) * widthM,
    z: view.centerZ + (pointPx.y / Math.max(1, size.heightPx) - 0.5) * view.heightM,
  };
}

export function zoomViewAtScreenPoint(
  view: OrthographicView,
  pointPx: { readonly x: number; readonly y: number },
  factor: number,
  size: ViewportSize,
  minimumHeightM: number,
  maximumHeightM: number,
): OrthographicView {
  const before = screenToWorld(pointPx, view, size);
  const heightM = Math.max(minimumHeightM, Math.min(maximumHeightM, view.heightM / factor));
  const provisional = { ...view, heightM };
  const after = screenToWorld(pointPx, provisional, size);
  return {
    centerX: provisional.centerX + before.x - after.x,
    centerZ: provisional.centerZ + before.z - after.z,
    heightM,
  };
}

export function panViewByPixels(
  view: OrthographicView,
  deltaPx: { readonly x: number; readonly y: number },
  size: ViewportSize,
): OrthographicView {
  return {
    centerX: view.centerX - deltaPx.x / Math.max(1, size.widthPx) * viewWidthM(view, size),
    centerZ: view.centerZ - deltaPx.y / Math.max(1, size.heightPx) * view.heightM,
    heightM: view.heightM,
  };
}
