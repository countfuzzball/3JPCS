export interface TerrainSurface {
  readonly worldWidthM: number;
  readonly worldDepthM: number;
  readonly spacingM: number;
  readonly cellCountX: number;
  readonly cellCountZ: number;
  readonly pointCountX: number;
  readonly pointCountZ: number;
  readonly minimumElevationM: number;
  readonly seaLevelM: number;
  readonly lowlandReferenceElevationM: number;
  readonly maximumElevationM: number;
  heightAtGrid(xIndex: number, zIndex: number): number;
  heightAt(xM: number, zM: number): number;
  slopeAt(xM: number, zM: number): number;
  copyHeights(): Float32Array;
}
