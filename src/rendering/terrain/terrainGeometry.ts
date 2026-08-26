import * as THREE from "three";
import type { TerrainSurface } from "../../terrain/TerrainSurface";

export function buildTerrainGeometry(terrain: TerrainSurface): THREE.BufferGeometry {
  const positions = new Float32Array(terrain.pointCountX * terrain.pointCountZ * 3);
  const uvs = new Float32Array(terrain.pointCountX * terrain.pointCountZ * 2);
  let vertexOffset = 0;
  let uvOffset = 0;
  for (let z = 0; z < terrain.pointCountZ; z += 1) {
    for (let x = 0; x < terrain.pointCountX; x += 1) {
      positions[vertexOffset] = x * terrain.spacingM;
      positions[vertexOffset + 1] = terrain.heightAtGrid(x, z);
      positions[vertexOffset + 2] = z * terrain.spacingM;
      vertexOffset += 3;
      uvs[uvOffset] = x / terrain.cellCountX;
      uvs[uvOffset + 1] = z / terrain.cellCountZ;
      uvOffset += 2;
    }
  }

  const indices = new Uint32Array(terrain.cellCountX * terrain.cellCountZ * 6);
  let indexOffset = 0;
  for (let z = 0; z < terrain.cellCountZ; z += 1) {
    for (let x = 0; x < terrain.cellCountX; x += 1) {
      const nw = z * terrain.pointCountX + x;
      const ne = nw + 1;
      const sw = nw + terrain.pointCountX;
      const se = sw + 1;
      indices[indexOffset] = nw;
      indices[indexOffset + 1] = se;
      indices[indexOffset + 2] = ne;
      indices[indexOffset + 3] = nw;
      indices[indexOffset + 4] = sw;
      indices[indexOffset + 5] = se;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function updateTerrainGeometryHeights(geometry: THREE.BufferGeometry, terrain: TerrainSurface): void {
  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute) || position.count !== terrain.pointCountX * terrain.pointCountZ) {
    throw new Error("terrain geometry topology does not match the derived surface");
  }
  for (let z = 0; z < terrain.pointCountZ; z += 1) {
    for (let x = 0; x < terrain.pointCountX; x += 1) {
      position.setY(z * terrain.pointCountX + x, terrain.heightAtGrid(x, z));
    }
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
