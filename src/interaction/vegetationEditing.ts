import type { PointXZ } from "../model/coordinates";
import type { VegetationInstance, WorldBounds } from "../model/entities";

export function moveVegetation(
  entity: VegetationInstance,
  delta: PointXZ,
  world: WorldBounds,
): VegetationInstance {
  return {
    ...entity,
    x_m: clamp(entity.x_m + delta.x, 0, world.widthM),
    z_m: clamp(entity.z_m + delta.z, 0, world.depthM),
  };
}

export function rotateVegetation(entity: VegetationInstance, deltaDeg: number): VegetationInstance {
  return { ...entity, rotation_deg: normalizeDegrees(entity.rotation_deg + deltaDeg) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
