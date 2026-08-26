import type { AssetCatalog } from "../model/assetCatalog";
import type { PointXZ } from "../model/coordinates";
import type { PointTuple, PrefabInstance, WorldBounds } from "../model/entities";

export interface PrefabProxySize {
  readonly widthM: number;
  readonly depthM: number;
  readonly wallHeightM: number;
  readonly resolved: boolean;
}

export function rotateLocalPoint(xM: number, zM: number, rotationDeg: number): PointTuple {
  const angle = rotationDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine * xM - sine * zM, sine * xM + cosine * zM];
}

export function prefabFootprint(
  xM: number,
  zM: number,
  widthM: number,
  depthM: number,
  rotationDeg: number,
): readonly PointTuple[] {
  return [
    [-widthM / 2, -depthM / 2],
    [widthM / 2, -depthM / 2],
    [widthM / 2, depthM / 2],
    [-widthM / 2, depthM / 2],
  ].map(([x, z]) => {
    const [dx, dz] = rotateLocalPoint(x ?? 0, z ?? 0, rotationDeg);
    return [xM + dx, zM + dz] as PointTuple;
  });
}

export function prefabFrontMarker(
  xM: number,
  zM: number,
  depthM: number,
  rotationDeg: number,
): readonly [PointTuple, PointTuple] {
  const [dx, dz] = rotateLocalPoint(0, -depthM / 2, rotationDeg);
  return [[xM, zM], [xM + dx, zM + dz]];
}

export function prefabProxySize(
  prefab: Pick<PrefabInstance, "category" | "scale">,
  catalog: AssetCatalog | null,
): PrefabProxySize {
  const proxy = catalog?.proxyForCategory(prefab.category);
  return {
    widthM: (proxy?.width_m ?? 12) * prefab.scale,
    depthM: (proxy?.depth_m ?? 12) * prefab.scale,
    wallHeightM: (proxy?.wall_height_m ?? 5) * prefab.scale,
    resolved: proxy !== undefined,
  };
}

export function hitTestPrefab(
  prefabs: readonly PrefabInstance[],
  point: PointXZ,
  catalog: AssetCatalog | null,
  visible: boolean,
): PrefabInstance | null {
  if (!visible) return null;
  for (const prefab of [...prefabs].reverse()) {
    if (!prefab.visible) continue;
    const size = prefabProxySize(prefab, catalog);
    if (pointInPolygon([point.x, point.z], prefabFootprint(
      prefab.x_m,
      prefab.z_m,
      size.widthM,
      size.depthM,
      prefab.rotation_deg,
    ))) return prefab;
  }
  return null;
}

export function movePrefab(prefab: PrefabInstance, delta: PointXZ, world: WorldBounds): PrefabInstance {
  return {
    ...prefab,
    x_m: Math.max(0, Math.min(world.widthM, prefab.x_m + delta.x)),
    z_m: Math.max(0, Math.min(world.depthM, prefab.z_m + delta.z)),
  };
}

function pointInPolygon(point: PointTuple, polygon: readonly PointTuple[]): boolean {
  const [x, z] = point;
  let inside = false;
  let previous = polygon.at(-1);
  if (!previous) return false;
  for (const current of polygon) {
    const [x1, z1] = previous;
    const [x2, z2] = current;
    if ((z1 > z) !== (z2 > z)) {
      const crossingX = (x2 - x1) * (z - z1) / (z2 - z1) + x1;
      if (x < crossingX) inside = !inside;
    }
    previous = current;
  }
  return inside;
}
