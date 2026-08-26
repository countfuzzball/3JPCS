import * as THREE from "three";
import type { GeometryEntity, PointTuple } from "../model/entities";
import type { GeometryLayerState } from "../interaction/geometryEditing";

interface ProjectionRecord {
  readonly entity: GeometryEntity;
  readonly selected: boolean;
  readonly selectedVertex: number | null;
  readonly object: THREE.Group;
}

export interface DraftProjection {
  readonly points: readonly PointTuple[];
  readonly hover: PointTuple | null;
}

const PLACE_COLORS = {
  town: 0xf5c04a,
  village: 0xf8d57d,
  farm: 0xd7a950,
  military_area: 0xe57b63,
} as const;

const LAND_COLORS = {
  pasture: 0x78be72,
  rough_grazing: 0x9cae68,
  woodland: 0x36764d,
} as const;

export class GeometryRenderAdapter {
  public readonly group = new THREE.Group();
  readonly #records = new Map<string, ProjectionRecord>();
  readonly #draftGroup = new THREE.Group();
  #layers: GeometryLayerState = { places: true, landUse: true, roads: true, hedgerows: true };
  #overlayY = 1;

  public constructor() {
    this.group.name = "authored-geometry-projection";
    this.#draftGroup.name = "draft-overlay";
    this.group.add(this.#draftGroup);
  }

  public sync(
    entities: readonly GeometryEntity[],
    selectedId: string | null,
    selectedVertex: number | null,
    layers: GeometryLayerState,
    draft: DraftProjection,
    overlayY: number,
  ): void {
    const overlayChanged = overlayY !== this.#overlayY;
    this.#layers = { ...layers };
    this.#overlayY = overlayY;
    const active = new Set(entities.map((entity) => entity.id));
    for (const [id, projection] of this.#records) {
      if (!active.has(id)) {
        this.group.remove(projection.object);
        disposeObject(projection.object);
        this.#records.delete(id);
      }
    }

    for (const entity of entities) {
      const selected = entity.id === selectedId;
      const vertex = selected ? selectedVertex : null;
      const current = this.#records.get(entity.id);
      if (
        !current
        || overlayChanged
        || current.entity !== entity
        || current.selected !== selected
        || current.selectedVertex !== vertex
      ) {
        if (current) {
          this.group.remove(current.object);
          disposeObject(current.object);
        }
        const object = this.#buildEntity(entity, selected, vertex);
        this.group.add(object);
        this.#records.set(entity.id, { entity, selected, selectedVertex: vertex, object });
      }
      const projection = this.#records.get(entity.id);
      if (projection) projection.object.visible = entity.visible && layerFor(entity, this.#layers);
    }
    this.#syncDraft(draft);
  }

  public dispose(): void {
    for (const projection of this.#records.values()) disposeObject(projection.object);
    this.#records.clear();
    disposeObject(this.#draftGroup);
    this.group.clear();
  }

  #buildEntity(entity: GeometryEntity, selected: boolean, selectedVertex: number | null): THREE.Group {
    const group = new THREE.Group();
    group.name = `geometry:${entity.id}`;
    group.userData.modelId = entity.id;
    switch (entity.kind) {
      case "place":
        this.#addRegion(group, entity.points, PLACE_COLORS[entity.place_type], selected, false);
        group.renderOrder = 22;
        break;
      case "land_use":
        this.#addRegion(group, entity.points, LAND_COLORS[entity.land_use_type], selected, entity.land_use_type === "woodland");
        group.renderOrder = 21;
        break;
      case "road":
        this.#addWideLine(group, entity.points, entity.width_m, selected ? 0xfff1ce : 0x9a7254, selected);
        group.renderOrder = 31;
        break;
      case "linear_feature":
        this.#addWideLine(group, entity.points, entity.nominal_width_m, selected ? 0xd9ff8a : 0x346b3b, selected, true);
        group.renderOrder = 32;
        break;
    }
    if (selected) this.#addHandles(group, entity.points, selectedVertex);
    setRenderOrder(group, group.renderOrder);
    return group;
  }

  #addRegion(
    group: THREE.Group,
    points: readonly PointTuple[],
    color: number,
    selected: boolean,
    woodland: boolean,
  ): void {
    const first = points[0];
    if (!first) return;
    const shape = new THREE.Shape();
    shape.moveTo(first[0], first[1]);
    for (const point of points.slice(1)) shape.lineTo(point[0], point[1]);
    shape.closePath();
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: woodland ? 0.42 : 0.28,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    fill.rotation.x = Math.PI / 2;
    fill.position.y = this.#overlayY;
    group.add(fill);

    const vertices = points.map(([x, z]) => new THREE.Vector3(x, this.#overlayY + 0.03, z));
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const outlineMaterial = woodland
      ? new THREE.LineDashedMaterial({ color: selected ? 0xffffff : color, dashSize: 3, gapSize: 2, depthTest: false })
      : new THREE.LineBasicMaterial({ color: selected ? 0xffffff : color, depthTest: false });
    const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
    if (outlineMaterial instanceof THREE.LineDashedMaterial) outline.computeLineDistances();
    group.add(outline);
  }

  #addWideLine(
    group: THREE.Group,
    points: readonly PointTuple[],
    widthM: number,
    color: number,
    selected: boolean,
    dashed = false,
  ): void {
    const mesh = new THREE.Mesh(
      buildWidePolylineGeometry(points, widthM, this.#overlayY),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.86, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    );
    group.add(mesh);
    const centreGeometry = new THREE.BufferGeometry().setFromPoints(
      points.map(([x, z]) => new THREE.Vector3(x, this.#overlayY + 0.04, z)),
    );
    const centreMaterial = dashed
      ? new THREE.LineDashedMaterial({ color: 0xb5db78, dashSize: 4, gapSize: 2.5, depthTest: false })
      : new THREE.LineBasicMaterial({ color: selected ? 0xffffff : 0x624b3b, depthTest: false });
    const centre = new THREE.Line(centreGeometry, centreMaterial);
    if (centreMaterial instanceof THREE.LineDashedMaterial) centre.computeLineDistances();
    group.add(centre);
  }

  #addHandles(group: THREE.Group, points: readonly PointTuple[], selectedVertex: number | null): void {
    const ordinary: THREE.Vector3[] = [];
    const active: THREE.Vector3[] = [];
    points.forEach(([x, z], index) => {
      (index === selectedVertex ? active : ordinary).push(new THREE.Vector3(x, this.#overlayY + 0.12, z));
    });
    if (ordinary.length > 0) group.add(buildHandlePoints(ordinary, 0xffffff, 7));
    if (active.length > 0) group.add(buildHandlePoints(active, 0xff6b5f, 10));
  }

  #syncDraft(draft: DraftProjection): void {
    disposeObject(this.#draftGroup);
    this.#draftGroup.clear();
    const points = [...draft.points];
    if (draft.hover && points.length > 0) points.push(draft.hover);
    if (points.length === 0) return;
    const vertices = points.map(([x, z]) => new THREE.Vector3(x, this.#overlayY + 0.2, z));
    if (vertices.length > 1) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(vertices),
        new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 1, depthTest: false }),
      );
      line.computeLineDistances();
      line.renderOrder = 60;
      this.#draftGroup.add(line);
    }
    const committed = draft.points.map(([x, z]) => new THREE.Vector3(x, this.#overlayY + 0.22, z));
    if (committed.length > 0) {
      const handles = buildHandlePoints(committed, 0xffffff, 7);
      handles.renderOrder = 61;
      this.#draftGroup.add(handles);
    }
  }
}

function buildWidePolylineGeometry(points: readonly PointTuple[], widthM: number, y: number): THREE.BufferGeometry {
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
    const offsetX = -dz / length * widthM / 2;
    const offsetZ = dx / length * widthM / 2;
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

function buildHandlePoints(points: readonly THREE.Vector3[], color: number, sizePx: number): THREE.Points {
  return new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([...points]),
    new THREE.PointsMaterial({ color, size: sizePx, sizeAttenuation: false, depthTest: false, depthWrite: false }),
  );
}

function layerFor(entity: GeometryEntity, layers: GeometryLayerState): boolean {
  switch (entity.kind) {
    case "place": return layers.places;
    case "land_use": return layers.landUse;
    case "road": return layers.roads;
    case "linear_feature": return layers.hedgerows;
  }
}

function setRenderOrder(object: THREE.Object3D, order: number): void {
  object.traverse((child) => { child.renderOrder = order; });
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) return;
    const renderable = child as THREE.Mesh;
    renderable.geometry.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    materials.forEach((material) => material.dispose());
  });
}
