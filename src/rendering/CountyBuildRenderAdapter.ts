import * as THREE from "three";
import type { CountyBuildPlan, CountyRoadRole } from "../generation/countyBuild";

const ROAD_COLORS: Readonly<Record<CountyRoadRole, number>> = {
  backbone: 0xf0cc65,
  access: 0x76d6df,
  plot: 0xb7db73,
  terminal: 0x86a6ae,
  loop: 0xc3e78a,
  farm_yard: 0xb99b69,
  property_access: 0xdfd2b2,
};

export interface CountyBuildPreviewFilter {
  readonly placePlanId: string | null;
  readonly places: boolean;
  readonly roads: boolean;
  readonly prefabs: boolean;
  readonly junctions: boolean;
  readonly skipped: boolean;
}

export const DEFAULT_COUNTY_BUILD_PREVIEW_FILTER: CountyBuildPreviewFilter = Object.freeze({
  placePlanId: null,
  places: true,
  roads: true,
  prefabs: true,
  junctions: true,
  skipped: true,
});

/** Bounded, role-batched preview for the complete transient Build County plan. */
export class CountyBuildRenderAdapter {
  public readonly group = new THREE.Group();
  #plan: CountyBuildPlan | null = null;
  #overlayY = 1;
  #filterKey = "";

  public constructor() {
    this.group.name = "county-build-preview";
    this.group.renderOrder = 90;
  }

  public sync(
    plan: CountyBuildPlan | null,
    overlayY: number,
    filter: CountyBuildPreviewFilter = DEFAULT_COUNTY_BUILD_PREVIEW_FILTER,
  ): void {
    const filterKey = JSON.stringify(filter);
    if (plan === this.#plan && overlayY === this.#overlayY && filterKey === this.#filterKey) return;
    this.#plan = plan;
    this.#overlayY = overlayY;
    this.#filterKey = filterKey;
    this.#disposeChildren();
    if (!plan) return;
    if (filter.places) this.#addPlaces(plan, filter.placePlanId, overlayY + 0.46);
    if (filter.roads) for (const role of Object.keys(ROAD_COLORS) as CountyRoadRole[]) this.#addRoadRole(plan, role, filter.placePlanId, overlayY + 0.54);
    if (filter.prefabs) this.#addPrefabs(plan, filter.placePlanId, overlayY + 0.62);
    if (filter.junctions) this.#addJunctions(plan, filter.placePlanId, overlayY + 0.68);
    if (filter.skipped) this.#addSkipped(plan, filter.placePlanId, overlayY + 0.72);
  }

  public dispose(): void {
    this.#disposeChildren();
    this.#plan = null;
  }

  #addPlaces(plan: CountyBuildPlan, placePlanId: string | null, y: number): void {
    const fillPositions: number[] = [];
    const outlinePositions: number[] = [];
    for (const place of plan.places) {
      if (placePlanId && place.planId !== placePlanId) continue;
      for (let index = 0; index < place.points.length; index += 1) {
        const current = place.points[index];
        const next = place.points[(index + 1) % place.points.length];
        if (!current || !next) continue;
        fillPositions.push(
          place.anchor[0], y, place.anchor[1],
          current[0], y, current[1],
          next[0], y, next[1],
        );
        outlinePositions.push(current[0], y + 0.02, current[1], next[0], y + 0.02, next[1]);
      }
    }
    if (fillPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0x6fd1bd,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }));
      mesh.name = "county-build-place-fills";
      mesh.renderOrder = 90;
      this.group.add(mesh);
    }
    if (outlinePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(outlinePositions, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: 0x8de5d1,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }));
      lines.name = "county-build-place-outlines";
      lines.renderOrder = 91;
      this.group.add(lines);
    }
  }

  #addRoadRole(plan: CountyBuildPlan, role: CountyRoadRole, placePlanId: string | null, y: number): void {
    const positions: number[] = [];
    for (const road of plan.roads) {
      if (road.role !== role) continue;
      if (placePlanId && road.ownerPlacePlanId !== placePlanId) continue;
      for (let index = 0; index < road.points.length - 1; index += 1) {
        const start = road.points[index];
        const end = road.points[index + 1];
        if (start && end) positions.push(start[0], y, start[1], end[0], y, end[1]);
      }
    }
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: ROAD_COLORS[role],
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    }));
    lines.name = `county-build-roads-${role}`;
    lines.renderOrder = 92;
    this.group.add(lines);
  }

  #addPrefabs(plan: CountyBuildPlan, placePlanId: string | null, y: number): void {
    const positions: number[] = [];
    for (const prefab of plan.prefabs) {
      if (placePlanId && prefab.ownerPlacePlanId !== placePlanId) continue;
      for (let index = 0; index < prefab.footprint.length; index += 1) {
        const start = prefab.footprint[index];
        const end = prefab.footprint[(index + 1) % prefab.footprint.length];
        if (start && end) positions.push(start[0], y, start[1], end[0], y, end[1]);
      }
      const frontLeft = prefab.footprint[0];
      const frontRight = prefab.footprint[1];
      if (frontLeft && frontRight) positions.push(
        prefab.xM, y, prefab.zM,
        (frontLeft[0] + frontRight[0]) / 2, y, (frontLeft[1] + frontRight[1]) / 2,
      );
    }
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: 0xe9f37b,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    }));
    lines.name = "county-build-prefabs";
    lines.renderOrder = 93;
    this.group.add(lines);
  }

  #addJunctions(plan: CountyBuildPlan, placePlanId: string | null, y: number): void {
    const junctions = plan.junctions.filter((junction) => !placePlanId || junction.ownerPlacePlanId === placePlanId);
    if (junctions.length === 0) return;
    const points = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(
        junctions.map(({ point }) => new THREE.Vector3(point[0], y, point[1])),
      ),
      new THREE.PointsMaterial({
        color: 0xff8a61,
        size: 7,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    points.name = "county-build-junctions";
    points.renderOrder = 94;
    this.group.add(points);
  }

  #addSkipped(plan: CountyBuildPlan, placePlanId: string | null, y: number): void {
    const skipped = plan.skippedCandidates.filter((candidate) => !placePlanId || candidate.ownerPlacePlanId === placePlanId);
    if (skipped.length === 0) return;
    const points = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(skipped.map(({ point }) => new THREE.Vector3(point[0], y, point[1]))),
      new THREE.PointsMaterial({
        color: 0xff5e57,
        size: 4,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    points.name = "county-build-skipped-candidates";
    points.renderOrder = 95;
    this.group.add(points);
  }

  #disposeChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Points)) continue;
      const renderable = child as THREE.Object3D & {
        readonly geometry: THREE.BufferGeometry;
        readonly material: THREE.Material | THREE.Material[];
      };
      renderable.geometry.dispose();
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      materials.forEach((material) => material.dispose());
    }
  }
}
