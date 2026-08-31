import * as THREE from "three";
import type { PointTuple } from "../model/entities";

export interface RoadRouteProjection {
  readonly start: PointTuple | null;
  readonly end: PointTuple | null;
  readonly points: readonly PointTuple[] | null;
  readonly widthM: number;
  readonly running: boolean;
}

/** A transient route overlay; only EditorStore acceptance can create an authored road. */
export class RoadRouteRenderAdapter {
  public readonly group = new THREE.Group();
  #key = "";

  public constructor() {
    this.group.name = "road-route-preview";
    this.group.renderOrder = 58;
  }

  public sync(projection: RoadRouteProjection | null, overlayY: number): void {
    const key = projection ? JSON.stringify({ ...projection, overlayY }) : "";
    if (key === this.#key) return;
    this.#key = key;
    this.#disposeChildren();
    if (!projection?.start) return;

    const markerPositions = [projection.start, projection.end]
      .filter((point): point is PointTuple => point !== null)
      .map(([x, z]) => new THREE.Vector3(x, overlayY + 0.34, z));
    const markers = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(markerPositions),
      new THREE.PointsMaterial({
        color: projection.points ? 0xd4ef62 : projection.running ? 0xffc55c : 0x62d8d2,
        size: 10,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    markers.name = "road-route-endpoints";
    markers.renderOrder = 61;
    this.group.add(markers);

    if (projection.points && projection.points.length >= 2) {
      const mesh = new THREE.Mesh(
        widePolylineGeometry(projection.points, projection.widthM, overlayY + 0.2),
        new THREE.MeshBasicMaterial({
          color: 0x8fbf6b,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      mesh.name = "road-route-width-preview";
      mesh.renderOrder = 58;
      this.group.add(mesh);
      const centre = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          projection.points.map(([x, z]) => new THREE.Vector3(x, overlayY + 0.25, z)),
        ),
        new THREE.LineDashedMaterial({ color: 0xf4ffd7, dashSize: 4, gapSize: 2, depthTest: false }),
      );
      centre.computeLineDistances();
      centre.name = "road-route-centre-preview";
      centre.renderOrder = 60;
      this.group.add(centre);
      return;
    }

    if (projection.end) {
      const guide = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(projection.start[0], overlayY + 0.22, projection.start[1]),
          new THREE.Vector3(projection.end[0], overlayY + 0.22, projection.end[1]),
        ]),
        new THREE.LineDashedMaterial({ color: 0x62d8d2, dashSize: 3, gapSize: 2, depthTest: false }),
      );
      guide.computeLineDistances();
      guide.name = "road-route-search-guide";
      guide.renderOrder = 59;
      this.group.add(guide);
    }
  }

  public dispose(): void {
    this.#disposeChildren();
    this.#key = "";
  }

  #disposeChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) continue;
      const renderable = child as THREE.Object3D & {
        readonly geometry: THREE.BufferGeometry;
        readonly material: THREE.Material | THREE.Material[];
      };
      renderable.geometry.dispose();
      const materials: readonly THREE.Material[] = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      materials.forEach((material) => material.dispose());
    }
  }
}

function widePolylineGeometry(points: readonly PointTuple[], widthM: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    if (length <= Number.EPSILON) continue;
    const offsetX = -dz / length * widthM * 0.5;
    const offsetZ = dx / length * widthM * 0.5;
    const base = positions.length / 3;
    positions.push(
      start[0] + offsetX, y, start[1] + offsetZ,
      start[0] - offsetX, y, start[1] - offsetZ,
      end[0] - offsetX, y, end[1] - offsetZ,
      end[0] + offsetX, y, end[1] + offsetZ,
    );
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}
