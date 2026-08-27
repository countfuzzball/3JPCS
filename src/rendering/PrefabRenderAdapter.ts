import * as THREE from "three";
import type { AssetCatalog, AssetDefinition } from "../model/assetCatalog";
import type { PointTuple, PrefabInstance } from "../model/entities";
import type { FrontageCandidate, FrontagePlan } from "../interaction/frontageAssist";
import {
  prefabFootprint,
  prefabFrontMarker,
  prefabProxySize,
} from "../interaction/prefabEditing";

interface ProjectionRecord {
  readonly entity: PrefabInstance;
  readonly selected: boolean;
  readonly catalog: AssetCatalog | null;
  readonly object: THREE.Group;
}

export interface PrefabLayerState {
  readonly prefabs: boolean;
  readonly terrainPads: boolean;
}

export interface PrefabGhostProjection {
  readonly xM: number;
  readonly zM: number;
  readonly asset: AssetDefinition;
}

export class PrefabRenderAdapter {
  public readonly group = new THREE.Group();
  readonly #records = new Map<string, ProjectionRecord>();
  readonly #ghost = new THREE.Group();
  readonly #frontagePreview = new THREE.Group();
  #activeFrontagePreview: FrontagePlan | null = null;
  #overlayY = 1;

  public constructor() {
    this.group.name = "prefab-projection";
    this.#ghost.name = "prefab-placement-ghost";
    this.#frontagePreview.name = "frontage-preview";
    this.group.add(this.#ghost, this.#frontagePreview);
  }

  public sync(
    prefabs: readonly PrefabInstance[],
    catalog: AssetCatalog | null,
    selectedId: string | null,
    layers: PrefabLayerState,
    ghost: PrefabGhostProjection | null,
    overlayY: number,
    frontagePreview: FrontagePlan | null = null,
  ): void {
    const overlayChanged = overlayY !== this.#overlayY;
    this.#overlayY = overlayY;
    const active = new Set(prefabs.map((prefab) => prefab.id));
    for (const [id, projection] of this.#records) {
      if (!active.has(id)) {
        this.group.remove(projection.object);
        disposeObject(projection.object);
        this.#records.delete(id);
      }
    }

    for (const prefab of prefabs) {
      const selected = prefab.id === selectedId;
      const current = this.#records.get(prefab.id);
      if (!current || overlayChanged || current.entity !== prefab || current.selected !== selected || current.catalog !== catalog) {
        if (current) {
          this.group.remove(current.object);
          disposeObject(current.object);
        }
        const object = this.#buildPrefab(prefab, catalog, selected);
        this.group.add(object);
        this.#records.set(prefab.id, { entity: prefab, selected, catalog, object });
      }
      const projection = this.#records.get(prefab.id);
      if (projection) {
        const footprint = projection.object.getObjectByName("prefab-footprint");
        if (footprint) footprint.visible = prefab.visible && layers.prefabs;
        const pad = projection.object.getObjectByName("terrain-pad-overlay");
        if (pad) pad.visible = prefab.visible && prefab.terrain_pad.enabled && (layers.terrainPads || selected);
      }
    }
    this.#syncGhost(ghost, catalog);
    this.#syncFrontagePreview(frontagePreview, overlayChanged);
  }

  public dispose(): void {
    for (const projection of this.#records.values()) disposeObject(projection.object);
    this.#records.clear();
    disposeObject(this.#ghost);
    disposeObject(this.#frontagePreview);
    this.group.clear();
  }

  #buildPrefab(prefab: PrefabInstance, catalog: AssetCatalog | null, selected: boolean): THREE.Group {
    const root = new THREE.Group();
    root.name = `prefab:${prefab.id}`;
    root.userData.modelId = prefab.id;
    const footprint = new THREE.Group();
    footprint.name = "prefab-footprint";
    const size = prefabProxySize(prefab, catalog);
    const resolvedAsset = catalog?.definition(prefab.asset_id) !== undefined;
    const color = selected ? 0xfff2a6 : resolvedAsset ? 0xe79962 : 0xff385d;
    addFootprint(
      footprint,
      prefabFootprint(prefab.x_m, prefab.z_m, size.widthM, size.depthM, prefab.rotation_deg),
      prefabFrontMarker(prefab.x_m, prefab.z_m, size.depthM, prefab.rotation_deg),
      color,
      this.#overlayY + 0.15,
      false,
      selected ? 0.22 : 0.12,
    );
    root.add(footprint);

    const pad = new THREE.Group();
    pad.name = "terrain-pad-overlay";
    const terrainPad = prefab.terrain_pad;
    if (terrainPad.blend_m > 0) {
      addOutline(
        pad,
        prefabFootprint(
          prefab.x_m,
          prefab.z_m,
          terrainPad.width_m + 2 * terrainPad.blend_m,
          terrainPad.depth_m + 2 * terrainPad.blend_m,
          prefab.rotation_deg,
        ),
        selected ? 0x7ff3ff : 0x3aa9bd,
        this.#overlayY + 0.07,
        true,
      );
    }
    addOutline(
      pad,
      prefabFootprint(prefab.x_m, prefab.z_m, terrainPad.width_m, terrainPad.depth_m, prefab.rotation_deg),
      selected ? 0x7ff3ff : 0x3aa9bd,
      this.#overlayY + 0.09,
      true,
    );
    root.add(pad);
    setRenderOrder(root, 50);
    return root;
  }

  #syncGhost(ghost: PrefabGhostProjection | null, catalog: AssetCatalog | null): void {
    disposeObject(this.#ghost);
    this.#ghost.clear();
    if (!ghost) return;
    const proxy = catalog?.proxyForCategory(ghost.asset.category);
    const width = proxy?.width_m ?? 12;
    const depth = proxy?.depth_m ?? 12;
    addFootprint(
      this.#ghost,
      prefabFootprint(ghost.xM, ghost.zM, width, depth, 0),
      prefabFrontMarker(ghost.xM, ghost.zM, depth, 0),
      0xd6ff55,
      this.#overlayY + 0.25,
      true,
      0.08,
    );
    setRenderOrder(this.#ghost, 70);
  }

  #syncFrontagePreview(preview: FrontagePlan | null, overlayChanged: boolean): void {
    if (!overlayChanged && preview === this.#activeFrontagePreview) return;
    this.#activeFrontagePreview = preview;
    disposeObject(this.#frontagePreview);
    this.#frontagePreview.clear();
    if (!preview) return;
    const accepted = preview.candidates.filter((candidate) => candidate.skipReason === null);
    const skipped = preview.candidates.filter((candidate) => candidate.skipReason !== null);
    addCandidateBatch(this.#frontagePreview, accepted, 0xd6ff55, this.#overlayY + 0.31);
    addCandidateBatch(this.#frontagePreview, skipped, 0xff6d5e, this.#overlayY + 0.32);
    if (preview.rangePoints.length >= 2) {
      const path = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          preview.rangePoints.map(([x, z]) => new THREE.Vector3(x, this.#overlayY + 0.34, z)),
        ),
        new THREE.LineBasicMaterial({ color: 0x62d8d2, depthTest: false }),
      );
      path.name = "frontage-road-range";
      this.#frontagePreview.add(path);
      const endpoints = [preview.rangePoints[0], preview.rangePoints.at(-1)].filter(
        (point): point is PointTuple => point !== undefined,
      );
      const anchors = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(endpoints.map(([x, z]) => new THREE.Vector3(x, this.#overlayY + 0.36, z))),
        new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false, depthTest: false }),
      );
      anchors.name = "frontage-range-anchors";
      this.#frontagePreview.add(anchors);
    }
    setRenderOrder(this.#frontagePreview, 80);
  }
}

function addCandidateBatch(group: THREE.Group, candidates: readonly FrontageCandidate[], color: number, y: number): void {
  if (candidates.length === 0) return;
  const vertices: THREE.Vector3[] = [];
  for (const candidate of candidates) {
    for (let index = 0; index < candidate.footprint.length; index += 1) {
      const start = candidate.footprint[index];
      const end = candidate.footprint[(index + 1) % candidate.footprint.length];
      if (start && end) vertices.push(
        new THREE.Vector3(start[0], y, start[1]),
        new THREE.Vector3(end[0], y, end[1]),
      );
    }
    const frontLeft = candidate.footprint[0];
    const frontRight = candidate.footprint[1];
    if (frontLeft && frontRight) {
      vertices.push(
        new THREE.Vector3(candidate.xM, y, candidate.zM),
        new THREE.Vector3((frontLeft[0] + frontRight[0]) / 2, y, (frontLeft[1] + frontRight[1]) / 2),
      );
    }
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(vertices),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }),
  );
  lines.name = candidates[0]?.skipReason === null ? "frontage-valid-candidates" : "frontage-skipped-candidates";
  group.add(lines);
}

function addFootprint(
  group: THREE.Group,
  points: readonly PointTuple[],
  marker: readonly [PointTuple, PointTuple],
  color: number,
  y: number,
  dashed: boolean,
  opacity: number,
): void {
  const first = points[0];
  if (!first) return;
  const shape = new THREE.Shape();
  shape.moveTo(first[0], first[1]);
  for (const point of points.slice(1)) shape.lineTo(point[0], point[1]);
  shape.closePath();
  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
  );
  fill.rotation.x = Math.PI / 2;
  fill.position.y = y;
  group.add(fill);
  addOutline(group, points, color, y + 0.02, dashed);
  const [start, end] = marker;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start[0], y + 0.04, start[1]),
      new THREE.Vector3(end[0], y + 0.04, end[1]),
    ]),
    new THREE.LineBasicMaterial({ color, depthTest: false }),
  );
  group.add(line);
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.max(1e-9, Math.hypot(dx, dz));
  const nx = dx / length;
  const nz = dz / length;
  const arrowSize = Math.min(2.5, Math.max(0.75, length * 0.32));
  const sideX = -nz * arrowSize * 0.55;
  const sideZ = nx * arrowSize * 0.55;
  const baseX = end[0] - nx * arrowSize;
  const baseZ = end[1] - nz * arrowSize;
  const arrow = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(baseX + sideX, y + 0.05, baseZ + sideZ),
      new THREE.Vector3(end[0], y + 0.05, end[1]),
      new THREE.Vector3(baseX - sideX, y + 0.05, baseZ - sideZ),
    ]),
    new THREE.LineBasicMaterial({ color, depthTest: false }),
  );
  group.add(arrow);
}

function addOutline(group: THREE.Group, points: readonly PointTuple[], color: number, y: number, dashed: boolean): void {
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 2.5, gapSize: 1.5, depthTest: false })
    : new THREE.LineBasicMaterial({ color, depthTest: false });
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, y, z))),
    material,
  );
  if (material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
  group.add(line);
}

function setRenderOrder(object: THREE.Object3D, order: number): void {
  object.traverse((child) => { child.renderOrder = order; });
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) return;
    const renderable = child as THREE.Mesh | THREE.Line | THREE.Points;
    renderable.geometry.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    materials.forEach((material) => material.dispose());
  });
}
