import * as THREE from "three";
import type { SettlementSurveyCandidate } from "../generation/settlementSurvey";

export interface SettlementSurveyProjection {
  readonly candidates: readonly SettlementSurveyCandidate[];
  readonly selectedIds: ReadonlySet<string>;
}

const SELECTED_COLOR = new THREE.Color(0xd4ef62);
const CANDIDATE_COLOR = new THREE.Color(0x62d8d2);

/** Batched transient settlement regions. Survey previews never become model objects here. */
export class SettlementSurveyRenderAdapter {
  public readonly group = new THREE.Group();
  #candidates: readonly SettlementSurveyCandidate[] | null = null;
  #selectionKey = "";
  #overlayY = 1;

  public constructor() {
    this.group.name = "settlement-survey-preview";
    this.group.renderOrder = 55;
  }

  public sync(projection: SettlementSurveyProjection | null, overlayY: number): void {
    const selectionKey = projection
      ? [...projection.selectedIds].sort().join("\u0000")
      : "";
    const candidates = projection?.candidates ?? null;
    if (candidates === this.#candidates && selectionKey === this.#selectionKey && overlayY === this.#overlayY) return;
    this.#candidates = candidates;
    this.#selectionKey = selectionKey;
    this.#overlayY = overlayY;
    this.#disposeChildren();
    if (!projection || projection.candidates.length === 0) return;
    this.#build(projection);
  }

  public dispose(): void {
    this.#disposeChildren();
    this.#candidates = null;
    this.#selectionKey = "";
  }

  #build(projection: SettlementSurveyProjection): void {
    const fillPositions: number[] = [];
    const fillColors: number[] = [];
    const outlinePositions: number[] = [];
    const outlineColors: number[] = [];
    const centrePositions: number[] = [];
    const centreColors: number[] = [];

    for (const candidate of projection.candidates) {
      const selected = projection.selectedIds.has(candidate.id);
      const color = selected ? SELECTED_COLOR : CANDIDATE_COLOR;
      const y = this.#overlayY + (selected ? 0.22 : 0.16);
      const points = candidate.boundary;
      for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        if (!current || !next) continue;
        fillPositions.push(
          candidate.center[0], y, candidate.center[1],
          current[0], y, current[1],
          next[0], y, next[1],
        );
        for (let vertex = 0; vertex < 3; vertex += 1) fillColors.push(color.r, color.g, color.b);
        outlinePositions.push(current[0], y + 0.03, current[1], next[0], y + 0.03, next[1]);
        outlineColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      centrePositions.push(candidate.center[0], y + 0.08, candidate.center[1]);
      centreColors.push(color.r, color.g, color.b);
    }

    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    fillGeometry.setAttribute("color", new THREE.Float32BufferAttribute(fillColors, 3));
    const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }));
    fill.name = "settlement-survey-fills";
    fill.renderOrder = 55;
    this.group.add(fill);

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(outlinePositions, 3));
    outlineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(outlineColors, 3));
    const outlines = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    }));
    outlines.name = "settlement-survey-outlines";
    outlines.renderOrder = 56;
    this.group.add(outlines);

    const centreGeometry = new THREE.BufferGeometry();
    centreGeometry.setAttribute("position", new THREE.Float32BufferAttribute(centrePositions, 3));
    centreGeometry.setAttribute("color", new THREE.Float32BufferAttribute(centreColors, 3));
    const centres = new THREE.Points(centreGeometry, new THREE.PointsMaterial({
      vertexColors: true,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    }));
    centres.name = "settlement-survey-centres";
    centres.renderOrder = 57;
    this.group.add(centres);
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
      const materials: readonly THREE.Material[] = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      materials.forEach((material) => material.dispose());
    }
  }
}
