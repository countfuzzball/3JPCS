import * as THREE from "three";
import type {
  SettlementFrontageCandidate,
  SettlementFrontagePlan,
} from "../generation/settlementFrontage";

/** Batches settlement-wide frontage candidates, eligible ranges, and transient junctions. */
export class SettlementFrontageRenderAdapter {
  public readonly group = new THREE.Group();
  #plan: SettlementFrontagePlan | null = null;
  #overlayY = 1;

  public constructor() {
    this.group.name = "settlement-frontage-preview";
    this.group.renderOrder = 82;
  }

  public sync(plan: SettlementFrontagePlan | null, overlayY: number): void {
    if (plan === this.#plan && overlayY === this.#overlayY) return;
    this.#plan = plan;
    this.#overlayY = overlayY;
    this.#disposeChildren();
    if (!plan) return;

    const accepted = plan.candidates.filter(({ skipReason }) => skipReason === null);
    const skipped = plan.candidates.filter(({ skipReason }) => skipReason !== null);
    this.#addCandidateBatch(accepted, 0xd6ff55, "settlement-frontage-accepted", overlayY + 0.39);
    this.#addCandidateBatch(skipped, 0xff6d5e, "settlement-frontage-skipped", overlayY + 0.4);

    const rangeVertices: THREE.Vector3[] = [];
    for (const range of plan.ranges) {
      for (let index = 0; index < range.points.length - 1; index += 1) {
        const start = range.points[index];
        const end = range.points[index + 1];
        if (start && end) rangeVertices.push(
          new THREE.Vector3(start[0], overlayY + 0.37, start[1]),
          new THREE.Vector3(end[0], overlayY + 0.37, end[1]),
        );
      }
    }
    if (rangeVertices.length > 0) {
      const ranges = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(rangeVertices),
        new THREE.LineBasicMaterial({ color: 0x62d8d2, depthTest: false, depthWrite: false }),
      );
      ranges.name = "settlement-frontage-road-ranges";
      ranges.renderOrder = 82;
      this.group.add(ranges);
    }

    if (plan.junctions.length > 0) {
      const junctions = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(
          plan.junctions.map(({ point }) => new THREE.Vector3(point[0], overlayY + 0.43, point[1])),
        ),
        new THREE.PointsMaterial({
          color: 0xffc55c,
          size: 8,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      junctions.name = "settlement-frontage-junctions";
      junctions.renderOrder = 84;
      this.group.add(junctions);
    }
  }

  public dispose(): void {
    this.#disposeChildren();
    this.#plan = null;
  }

  #addCandidateBatch(
    candidates: readonly SettlementFrontageCandidate[],
    color: number,
    name: string,
    y: number,
  ): void {
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
      if (frontLeft && frontRight) vertices.push(
        new THREE.Vector3(candidate.xM, y, candidate.zM),
        new THREE.Vector3((frontLeft[0] + frontRight[0]) / 2, y, (frontLeft[1] + frontRight[1]) / 2),
      );
    }
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
    );
    lines.name = name;
    lines.renderOrder = 83;
    this.group.add(lines);
  }

  #disposeChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (!(child instanceof THREE.LineSegments || child instanceof THREE.Points)) continue;
      const renderable = child as THREE.LineSegments | THREE.Points;
      renderable.geometry.dispose();
      const materials: readonly THREE.Material[] = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      materials.forEach((material) => material.dispose());
    }
  }
}
