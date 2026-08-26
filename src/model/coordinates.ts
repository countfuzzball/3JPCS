export interface PointXZ {
  readonly x: number;
  readonly z: number;
}

export function rotateLocalPoint(point: PointXZ, rotationDeg: number): PointXZ {
  const angle = rotationDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * point.x - sine * point.z,
    z: sine * point.x + cosine * point.z,
  };
}

export function threeYawRadians(rotationDeg: number): number {
  return -rotationDeg * Math.PI / 180;
}
