import * as THREE from "three";
import {
  countyBuildingFootprint,
  type CountyReference,
  type VegetationReference,
} from "../model/references";
import type { PointTuple } from "../model/entities";

export interface ReferenceLayerState {
  readonly vegetation: boolean;
  readonly countySettlements: boolean;
  readonly countyRoads: boolean;
  readonly countyBuildings: boolean;
}

export class ReferenceRenderAdapter {
  public readonly group = new THREE.Group();
  readonly #county = new THREE.Group();
  readonly #vegetation = new THREE.Group();
  #countyReference: CountyReference | null = null;
  #vegetationReference: VegetationReference | null = null;
  #overlayY = 1;

  public constructor() {
    this.group.name = "reference-projection";
    this.#county.name = "county-reference";
    this.#vegetation.name = "vegetation-reference";
    this.group.add(this.#county, this.#vegetation);
  }

  public sync(
    county: CountyReference | null,
    vegetation: VegetationReference | null,
    layers: ReferenceLayerState,
    overlayY: number,
  ): void {
    if (county !== this.#countyReference || overlayY !== this.#overlayY) {
      this.#countyReference = county;
      clearDisposable(this.#county);
      if (county) this.#buildCounty(county, overlayY);
    }
    if (vegetation !== this.#vegetationReference || overlayY !== this.#overlayY) {
      this.#vegetationReference = vegetation;
      clearDisposable(this.#vegetation);
      if (vegetation) this.#buildVegetation(vegetation, overlayY);
    }
    this.#overlayY = overlayY;
    setNamedVisibility(this.#county, "county-settlements", layers.countySettlements);
    setNamedVisibility(this.#county, "county-roads", layers.countyRoads);
    setNamedVisibility(this.#county, "county-buildings", layers.countyBuildings);
    this.#vegetation.visible = layers.vegetation;
  }

  public dispose(): void {
    clearDisposable(this.#county);
    clearDisposable(this.#vegetation);
    this.group.clear();
  }

  #buildCounty(county: CountyReference, overlayY: number): void {
    const settlements: PointTuple[] = [];
    for (const item of county.settlement_regions) {
      if (item.visible) appendClosedSegments(settlements, item.points);
    }
    this.#county.add(lineSegments("county-settlements", settlements, 0x8ac8d6, overlayY + 0.12, 0.55));

    const roads: PointTuple[] = [];
    for (const item of county.roads) {
      if (item.visible) appendOpenSegments(roads, item.points);
    }
    this.#county.add(lineSegments("county-roads", roads, 0xc0b38e, overlayY + 0.14, 0.62));

    const buildings: PointTuple[] = [];
    for (const item of county.buildings) {
      if (item.visible) appendClosedSegments(buildings, countyBuildingFootprint(item));
    }
    this.#county.add(lineSegments("county-buildings", buildings, 0xdf9bb2, overlayY + 0.16, 0.68));
    this.#county.traverse((object) => { object.renderOrder = 35; });
  }

  #buildVegetation(vegetation: VegetationReference, overlayY: number): void {
    const positions = new Float32Array(vegetation.objects.length * 3);
    const colors = new Float32Array(vegetation.objects.length * 3);
    const palette = {
      forest_tree: new THREE.Color(0x3e9363),
      scattered_tree: new THREE.Color(0x6eb177),
      shrub: new THREE.Color(0x95a65f),
    } as const;
    vegetation.objects.forEach((item, index) => {
      positions[index * 3] = item.x_m;
      positions[index * 3 + 1] = overlayY + 0.2;
      positions[index * 3 + 2] = item.z_m;
      const color = palette[item.type];
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.82, depthTest: false }),
    );
    points.name = "vegetation-points";
    points.renderOrder = 38;
    this.#vegetation.add(points);
  }
}

function lineSegments(name: string, points: readonly PointTuple[], color: number, y: number, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, y, z)));
  const material = new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity, depthTest: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = name;
  lines.computeLineDistances();
  return lines;
}

function appendOpenSegments(target: PointTuple[], points: readonly PointTuple[]): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start && end) target.push(start, end);
  }
}

function appendClosedSegments(target: PointTuple[], points: readonly PointTuple[]): void {
  appendOpenSegments(target, points);
  const first = points[0];
  const last = points.at(-1);
  if (first && last) target.push(last, first);
}

function setNamedVisibility(group: THREE.Group, name: string, visible: boolean): void {
  const object = group.getObjectByName(name);
  if (object) object.visible = visible;
}

function clearDisposable(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Points || child instanceof THREE.LineSegments)) return;
    const renderable = child instanceof THREE.Points
      ? child as THREE.Points
      : child as THREE.LineSegments;
    renderable.geometry.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    materials.forEach((material) => material.dispose());
  });
  group.clear();
}
