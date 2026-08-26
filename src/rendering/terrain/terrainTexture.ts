import * as THREE from "three";
import type { TerrainReference } from "../../terrain/TerrainReference";

export interface TerrainLayerState {
  readonly terrain: boolean;
  readonly hillshade: boolean;
  readonly contours: boolean;
}

export function buildTerrainTexture(
  terrain: TerrainReference,
  layers: TerrainLayerState,
): THREE.DataTexture {
  const pixels = buildTerrainPixels(terrain, layers);
  const texture = new THREE.DataTexture(
    pixels,
    terrain.pointCountX,
    terrain.pointCountZ,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function buildTerrainPixels(terrain: TerrainReference, layers: TerrainLayerState): Uint8Array {
  const pixels = new Uint8Array(terrain.pointCountX * terrain.pointCountZ * 4);
  const contourInterval = chooseContourInterval(terrain);
  for (let z = 0; z < terrain.pointCountZ; z += 1) {
    for (let x = 0; x < terrain.pointCountX; x += 1) {
      const height = terrain.heightAtGrid(x, z);
      let [red, green, blue] = layers.terrain ? elevationColor(terrain, height) : [38, 44, 46];
      if (layers.hillshade) {
        const shade = hillshadeAt(terrain, x, z);
        const light = 0.58 + 0.62 * shade;
        red *= light;
        green *= light;
        blue *= light;
      }
      if (layers.contours && isContourPoint(terrain, x, z, contourInterval)) {
        red *= 0.34;
        green *= 0.34;
        blue *= 0.34;
      }
      const offset = (z * terrain.pointCountX + x) * 4;
      pixels[offset] = clampByte(red);
      pixels[offset + 1] = clampByte(green);
      pixels[offset + 2] = clampByte(blue);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function elevationColor(terrain: TerrainReference, height: number): [number, number, number] {
  const span = Math.max(1e-9, terrain.maximumElevationM - terrain.minimumElevationM);
  const normalized = Math.max(0, Math.min(1, (height - terrain.minimumElevationM) / span));
  if (height < terrain.seaLevelM) {
    const waterSpan = Math.max(1e-9, terrain.seaLevelM - terrain.minimumElevationM);
    const water = Math.max(0, Math.min(1, (terrain.seaLevelM - height) / waterSpan));
    return [40 - 15 * water + 7 * normalized, 105 - 30 * water + 7 * normalized, 165 - 35 * water + 7 * normalized];
  }
  const landSpan = Math.max(1e-9, terrain.maximumElevationM - terrain.seaLevelM);
  const land = Math.max(0, Math.min(1, (height - terrain.seaLevelM) / landSpan));
  return [62 + 155 * land + 7 * normalized, 105 + 120 * land + 7 * normalized, 58 + 155 * land + 7 * normalized];
}

function hillshadeAt(terrain: TerrainReference, x: number, z: number): number {
  const left = terrain.heightAtGrid(Math.max(0, x - 1), z);
  const right = terrain.heightAtGrid(Math.min(terrain.pointCountX - 1, x + 1), z);
  const north = terrain.heightAtGrid(x, Math.max(0, z - 1));
  const south = terrain.heightAtGrid(x, Math.min(terrain.pointCountZ - 1, z + 1));
  const dxDivisor = (x === 0 || x === terrain.pointCountX - 1) ? terrain.spacingM : terrain.spacingM * 2;
  const dzDivisor = (z === 0 || z === terrain.pointCountZ - 1) ? terrain.spacingM : terrain.spacingM * 2;
  const dx = (right - left) / dxDivisor;
  const dz = (south - north) / dzDivisor;
  const slope = Math.PI / 2 - Math.atan(Math.hypot(dx, dz));
  const aspect = Math.atan2(-dx, dz);
  const altitude = 42 * Math.PI / 180;
  const azimuth = 315 * Math.PI / 180;
  const shade = Math.sin(altitude) * Math.sin(slope)
    + Math.cos(altitude) * Math.cos(slope) * Math.cos(azimuth - aspect);
  return Math.max(0, Math.min(1, (shade + 1) / 2));
}

function chooseContourInterval(terrain: TerrainReference): number {
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  const span = Math.max(1, terrain.maximumElevationM - terrain.minimumElevationM);
  const target = span / 18;
  return candidates.reduce((best, candidate) => (
    Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best
  ));
}

function isContourPoint(terrain: TerrainReference, x: number, z: number, interval: number): boolean {
  const band = Math.floor(terrain.heightAtGrid(x, z) / interval);
  if (x > 0 && Math.floor(terrain.heightAtGrid(x - 1, z) / interval) !== band) {
    return true;
  }
  return z > 0 && Math.floor(terrain.heightAtGrid(x, z - 1) / interval) !== band;
}

function clampByte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}
