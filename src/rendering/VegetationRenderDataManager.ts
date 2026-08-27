import * as THREE from "three";
import type { PointXZ } from "../model/coordinates";
import type { VegetationInstance, VegetationType } from "../model/entities";
import type { TerrainSurface } from "../terrain/TerrainSurface";

export const VEGETATION_CHUNK_SIZE_M = 512;

export interface VegetationBatchLocation {
  readonly batchKey: string;
  readonly slot: number;
}

export interface VegetationSyncMetrics {
  readonly modelCount: number;
  readonly batchCount: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly rebatched: number;
  readonly slotWrites: number;
  readonly terrainYUpdates: number;
  readonly fullRebuilds: number;
}

interface MutableLocation {
  batchKey: string;
  slot: number;
  entity: VegetationInstance;
  chunkX: number;
  chunkZ: number;
}

interface VegetationBatch {
  readonly key: string;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly vegetationType: VegetationType;
  readonly assetId: string;
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly slotToModelId: string[];
  capacity: number;
  count: number;
  positions: Float32Array;
  rotations: Float32Array;
  scales: Float32Array;
  visibility: Float32Array;
}

const EMPTY_METRICS: VegetationSyncMetrics = Object.freeze({
  modelCount: 0,
  batchCount: 0,
  added: 0,
  updated: 0,
  removed: 0,
  rebatched: 0,
  slotWrites: 0,
  terrainYUpdates: 0,
  fullRebuilds: 0,
});

export class VegetationRenderDataManager {
  public readonly group = new THREE.Group();
  readonly #batches = new Map<string, VegetationBatch>();
  readonly #modelToLocation = new Map<string, MutableLocation>();
  readonly #chunkToModelIds = new Map<string, Set<string>>();
  readonly #selection = new THREE.Group();
  readonly #materials = new Map<VegetationType, THREE.ShaderMaterial>();
  readonly #chunkSizeM: number;
  #terrain: TerrainSurface | null = null;
  #selectedId: string | null = null;
  #layerVisible = true;
  #metrics: VegetationSyncMetrics = EMPTY_METRICS;

  public constructor(chunkSizeM = VEGETATION_CHUNK_SIZE_M) {
    if (!Number.isFinite(chunkSizeM) || chunkSizeM <= 0) throw new Error("vegetation chunk size must be positive");
    this.#chunkSizeM = chunkSizeM;
    this.group.name = "native-vegetation-projection";
    this.#selection.name = "native-vegetation-selection-overlay";
    this.group.add(this.#selection);
  }

  public get metrics(): VegetationSyncMetrics { return this.#metrics; }
  public get chunkSizeM(): number { return this.#chunkSizeM; }
  public get modelCount(): number { return this.#modelToLocation.size; }
  public get batchCount(): number { return this.#batches.size; }

  public locationFor(modelId: string): VegetationBatchLocation | undefined {
    const location = this.#modelToLocation.get(modelId);
    return location ? { batchKey: location.batchKey, slot: location.slot } : undefined;
  }

  public modelIdForBatchSlot(batchKey: string, slot: number): string | undefined {
    return this.#batches.get(batchKey)?.slotToModelId[slot];
  }

  public modelIdForPoint(object: THREE.Object3D, pointIndex: number): string | undefined {
    const key = typeof object.userData.batchKey === "string" ? object.userData.batchKey : null;
    return key ? this.modelIdForBatchSlot(key, pointIndex) : undefined;
  }

  public sync(
    entities: readonly VegetationInstance[],
    terrain: TerrainSurface | null,
    selectedId: string | null,
    layerVisible: boolean,
  ): VegetationSyncMetrics {
    const terrainChanged = terrain !== this.#terrain;
    this.#terrain = terrain;
    this.#selectedId = selectedId;
    this.#layerVisible = layerVisible;
    this.group.visible = layerVisible;

    let added = 0;
    let updated = 0;
    let removed = 0;
    let rebatched = 0;
    let slotWrites = 0;
    const addedIds = new Set<string>();
    const active = new Set(entities.map((entity) => entity.id));
    for (const id of [...this.#modelToLocation.keys()]) {
      if (!active.has(id)) {
        slotWrites += this.#remove(id);
        removed += 1;
      }
    }
    for (const entity of entities) {
      const current = this.#modelToLocation.get(entity.id);
      if (!current) {
        slotWrites += this.#add(entity);
        addedIds.add(entity.id);
        added += 1;
        continue;
      }
      if (current.entity === entity) continue;
      const nextKey = batchKeyFor(entity, this.#chunkSizeM);
      if (nextKey !== current.batchKey) {
        slotWrites += this.#remove(entity.id);
        slotWrites += this.#add(entity);
        rebatched += 1;
      } else {
        current.entity = entity;
        this.#writeSlot(this.#requireBatch(current.batchKey), current.slot, entity);
        slotWrites += 1;
        updated += 1;
      }
    }

    let terrainYUpdates = 0;
    if (terrainChanged && terrain) {
      for (const batch of this.#batches.values()) {
        for (let slot = 0; slot < batch.count; slot += 1) {
          const id = batch.slotToModelId[slot];
          const entity = id ? this.#modelToLocation.get(id)?.entity : undefined;
          if (!entity || addedIds.has(entity.id)) continue;
          batch.positions[slot * 3 + 1] = terrain.heightAt(entity.x_m, entity.z_m) + 0.25;
          markAttributeRange(batch.points.geometry.getAttribute("position"), slot * 3, 3);
          terrainYUpdates += 1;
        }
      }
    }
    this.#syncSelection();
    this.#metrics = Object.freeze({
      modelCount: this.#modelToLocation.size,
      batchCount: this.#batches.size,
      added,
      updated,
      removed,
      rebatched,
      slotWrites,
      terrainYUpdates,
      fullRebuilds: 0,
    });
    return this.#metrics;
  }

  public pick(point: PointXZ, toleranceM: number): string | null {
    if (!this.#layerVisible || !Number.isFinite(toleranceM) || toleranceM < 0) return null;
    const minChunkX = Math.floor((point.x - toleranceM) / this.#chunkSizeM);
    const maxChunkX = Math.floor((point.x + toleranceM) / this.#chunkSizeM);
    const minChunkZ = Math.floor((point.z - toleranceM) / this.#chunkSizeM);
    const maxChunkZ = Math.floor((point.z + toleranceM) / this.#chunkSizeM);
    let bestId: string | null = null;
    let bestDistanceSquared = toleranceM * toleranceM;
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const ids = this.#chunkToModelIds.get(chunkCoordinateKey(chunkX, chunkZ));
        if (!ids) continue;
        for (const id of ids) {
          const entity = this.#modelToLocation.get(id)?.entity;
          if (!entity?.visible) continue;
          const dx = entity.x_m - point.x;
          const dz = entity.z_m - point.z;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared <= bestDistanceSquared) {
            bestDistanceSquared = distanceSquared;
            bestId = id;
          }
        }
      }
    }
    return bestId;
  }

  public dispose(): void {
    for (const batch of this.#batches.values()) batch.points.geometry.dispose();
    for (const material of this.#materials.values()) material.dispose();
    this.#batches.clear();
    this.#materials.clear();
    this.#modelToLocation.clear();
    this.#chunkToModelIds.clear();
    clearDisposable(this.#selection);
    this.group.clear();
  }

  #add(entity: VegetationInstance): number {
    const chunkX = Math.floor(entity.x_m / this.#chunkSizeM);
    const chunkZ = Math.floor(entity.z_m / this.#chunkSizeM);
    const key = batchKeyFor(entity, this.#chunkSizeM);
    const batch = this.#batches.get(key) ?? this.#createBatch(key, entity, chunkX, chunkZ);
    this.#ensureCapacity(batch, batch.count + 1);
    const slot = batch.count;
    batch.count += 1;
    batch.slotToModelId[slot] = entity.id;
    batch.points.geometry.setDrawRange(0, batch.count);
    this.#modelToLocation.set(entity.id, { batchKey: key, slot, entity, chunkX, chunkZ });
    const coordinateKey = chunkCoordinateKey(chunkX, chunkZ);
    const ids = this.#chunkToModelIds.get(coordinateKey) ?? new Set<string>();
    ids.add(entity.id);
    this.#chunkToModelIds.set(coordinateKey, ids);
    this.#writeSlot(batch, slot, entity);
    return 1;
  }

  #remove(modelId: string): number {
    const location = this.#modelToLocation.get(modelId);
    if (!location) return 0;
    const batch = this.#requireBatch(location.batchKey);
    const lastSlot = batch.count - 1;
    if (location.slot !== lastSlot) {
      const movedId = batch.slotToModelId[lastSlot];
      if (!movedId) throw new Error("vegetation batch slot map is inconsistent");
      copySlot(batch, lastSlot, location.slot);
      batch.slotToModelId[location.slot] = movedId;
      const movedLocation = this.#modelToLocation.get(movedId);
      if (!movedLocation) throw new Error("vegetation model map is inconsistent");
      movedLocation.slot = location.slot;
      markAllSlotAttributes(batch, location.slot);
    }
    batch.slotToModelId.pop();
    batch.count -= 1;
    batch.points.geometry.setDrawRange(0, batch.count);
    this.#modelToLocation.delete(modelId);
    const coordinateKey = chunkCoordinateKey(location.chunkX, location.chunkZ);
    const ids = this.#chunkToModelIds.get(coordinateKey);
    ids?.delete(modelId);
    if (ids?.size === 0) this.#chunkToModelIds.delete(coordinateKey);
    if (batch.count === 0) {
      this.group.remove(batch.points);
      batch.points.geometry.dispose();
      this.#batches.delete(batch.key);
    }
    return location.slot === lastSlot ? 0 : 1;
  }

  #createBatch(
    key: string,
    entity: VegetationInstance,
    chunkX: number,
    chunkZ: number,
  ): VegetationBatch {
    const geometry = new THREE.BufferGeometry();
    const material = this.#material(entity.vegetation_type);
    const points = new THREE.Points(geometry, material);
    points.name = `native-vegetation-batch:${key}`;
    points.userData.batchKey = key;
    points.renderOrder = 42;
    const centerX = (chunkX + 0.5) * this.#chunkSizeM;
    const centerZ = (chunkZ + 0.5) * this.#chunkSizeM;
    const minimumY = this.#terrain?.minimumElevationM ?? 0;
    const maximumY = this.#terrain?.maximumElevationM ?? 0;
    const centerY = (minimumY + maximumY) / 2;
    const horizontalRadius = this.#chunkSizeM * Math.SQRT2 / 2;
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(centerX, centerY, centerZ),
      Math.hypot(horizontalRadius, (maximumY - minimumY) / 2 + 2),
    );
    const batch: VegetationBatch = {
      key, chunkX, chunkZ, vegetationType: entity.vegetation_type, assetId: entity.asset_id,
      points, slotToModelId: [], capacity: 0, count: 0,
      positions: new Float32Array(), rotations: new Float32Array(),
      scales: new Float32Array(), visibility: new Float32Array(),
    };
    this.#ensureCapacity(batch, 16);
    geometry.setDrawRange(0, 0);
    this.#batches.set(key, batch);
    this.group.add(points);
    return batch;
  }

  #ensureCapacity(batch: VegetationBatch, required: number): void {
    if (required <= batch.capacity) return;
    let capacity = Math.max(16, batch.capacity);
    while (capacity < required) capacity *= 2;
    batch.positions = grow(batch.positions, capacity * 3);
    batch.rotations = grow(batch.rotations, capacity);
    batch.scales = grow(batch.scales, capacity);
    batch.visibility = grow(batch.visibility, capacity);
    batch.capacity = capacity;
    batch.points.geometry.setAttribute("position", new THREE.BufferAttribute(batch.positions, 3).setUsage(THREE.DynamicDrawUsage));
    batch.points.geometry.setAttribute("instanceRotation", new THREE.BufferAttribute(batch.rotations, 1).setUsage(THREE.DynamicDrawUsage));
    batch.points.geometry.setAttribute("instanceScale", new THREE.BufferAttribute(batch.scales, 1).setUsage(THREE.DynamicDrawUsage));
    batch.points.geometry.setAttribute("instanceVisible", new THREE.BufferAttribute(batch.visibility, 1).setUsage(THREE.DynamicDrawUsage));
  }

  #writeSlot(batch: VegetationBatch, slot: number, entity: VegetationInstance): void {
    batch.positions[slot * 3] = entity.x_m;
    batch.positions[slot * 3 + 1] = (this.#terrain?.heightAt(entity.x_m, entity.z_m) ?? 0) + 0.25;
    batch.positions[slot * 3 + 2] = entity.z_m;
    batch.rotations[slot] = entity.rotation_deg * Math.PI / 180;
    batch.scales[slot] = entity.scale;
    batch.visibility[slot] = entity.visible ? 1 : 0;
    markAllSlotAttributes(batch, slot);
  }

  #syncSelection(): void {
    clearDisposable(this.#selection);
    this.#selection.clear();
    if (!this.#layerVisible || !this.#selectedId) return;
    const entity = this.#modelToLocation.get(this.#selectedId)?.entity;
    if (!entity?.visible) return;
    const y = (this.#terrain?.heightAt(entity.x_m, entity.z_m) ?? 0) + 0.8;
    const radius = Math.max(2.5, 4 * entity.scale);
    const ringPoints = Array.from({ length: 25 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2;
      return new THREE.Vector3(entity.x_m + Math.cos(angle) * radius, y, entity.z_m + Math.sin(angle) * radius);
    });
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({ color: 0xfff2a6, depthTest: false }),
    );
    ring.name = "native-vegetation-selection-ring";
    ring.renderOrder = 70;
    this.#selection.add(ring);
    const angle = entity.rotation_deg * Math.PI / 180;
    const direction = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(entity.x_m, y + 0.02, entity.z_m),
        new THREE.Vector3(entity.x_m + Math.sin(angle) * radius, y + 0.02, entity.z_m - Math.cos(angle) * radius),
      ]),
      new THREE.LineBasicMaterial({ color: 0xfff2a6, depthTest: false }),
    );
    direction.renderOrder = 71;
    this.#selection.add(direction);
  }

  #material(type: VegetationType): THREE.ShaderMaterial {
    const current = this.#materials.get(type);
    if (current) return current;
    const colors: Record<VegetationType, THREE.Color> = {
      forest_tree: new THREE.Color(0x2f8c57),
      scattered_tree: new THREE.Color(0x65b46e),
      shrub: new THREE.Color(0xa1b858),
    };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        symbolColor: { value: colors[type] },
        shrubSymbol: { value: type === "shrub" ? 1 : 0 },
      },
      vertexShader: `
        attribute float instanceRotation;
        attribute float instanceScale;
        attribute float instanceVisible;
        varying float vRotation;
        varying float vVisible;
        void main() {
          vRotation = instanceRotation;
          vVisible = instanceVisible;
          gl_PointSize = max(3.0, 7.0 * instanceScale);
          gl_Position = instanceVisible > 0.5
            ? projectionMatrix * modelViewMatrix * vec4(position, 1.0)
            : vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 symbolColor;
        uniform int shrubSymbol;
        varying float vRotation;
        varying float vVisible;
        void main() {
          if (vVisible < 0.5) discard;
          vec2 p = gl_PointCoord - vec2(0.5);
          float c = cos(vRotation);
          float s = sin(vRotation);
          p = mat2(c, -s, s, c) * p;
          if (shrubSymbol == 1) {
            if (max(abs(p.x), abs(p.y)) > 0.43 || (abs(p.x) < 0.08 && abs(p.y) < 0.08)) discard;
          } else if (length(p) > 0.47) discard;
          gl_FragColor = vec4(symbolColor, 0.92);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.#materials.set(type, material);
    return material;
  }

  #requireBatch(key: string): VegetationBatch {
    const batch = this.#batches.get(key);
    if (!batch) throw new Error("vegetation batch map is inconsistent");
    return batch;
  }
}

export function batchKeyFor(entity: VegetationInstance, chunkSizeM = VEGETATION_CHUNK_SIZE_M): string {
  return JSON.stringify([
    entity.vegetation_type,
    entity.asset_id,
    Math.floor(entity.x_m / chunkSizeM),
    Math.floor(entity.z_m / chunkSizeM),
  ]);
}

function chunkCoordinateKey(chunkX: number, chunkZ: number): string {
  return `${String(chunkX)},${String(chunkZ)}`;
}

function grow(source: Float32Array, length: number): Float32Array {
  const result = new Float32Array(length);
  result.set(source.subarray(0, Math.min(source.length, length)));
  return result;
}

function copySlot(batch: VegetationBatch, source: number, target: number): void {
  batch.positions.copyWithin(target * 3, source * 3, source * 3 + 3);
  batch.rotations[target] = batch.rotations[source] ?? 0;
  batch.scales[target] = batch.scales[source] ?? 1;
  batch.visibility[target] = batch.visibility[source] ?? 0;
}

function markAllSlotAttributes(batch: VegetationBatch, slot: number): void {
  markAttributeRange(batch.points.geometry.getAttribute("position"), slot * 3, 3);
  markAttributeRange(batch.points.geometry.getAttribute("instanceRotation"), slot, 1);
  markAttributeRange(batch.points.geometry.getAttribute("instanceScale"), slot, 1);
  markAttributeRange(batch.points.geometry.getAttribute("instanceVisible"), slot, 1);
}

function markAttributeRange(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, start: number, count: number): void {
  if (!(attribute instanceof THREE.BufferAttribute)) return;
  attribute.addUpdateRange(start, count);
  attribute.needsUpdate = true;
}

function clearDisposable(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Line)) return;
    const line = child as unknown as {
      readonly geometry: THREE.BufferGeometry;
      readonly material: THREE.Material | THREE.Material[];
    };
    line.geometry.dispose();
    const materials = Array.isArray(line.material) ? line.material : [line.material];
    materials.forEach((material) => material.dispose());
  });
}
