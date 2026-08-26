import { ContractError } from "./errors";

export interface GridDimensions {
  readonly x: number;
  readonly z: number;
  readonly total: number;
}

export interface TerrainDescriptor {
  readonly world_width_m: number;
  readonly world_depth_m: number;
  readonly terrain_spacing_m: number;
  readonly terrain_cells: GridDimensions;
  readonly elevation_points: GridDimensions;
  readonly minimum_elevation_m: number;
  readonly sea_level_m: number;
  readonly lowland_reference_elevation_m: number;
  readonly maximum_elevation_m: number;
  readonly uint16_reference_values: {
    readonly sea_level: number;
    readonly lowland_reference: number;
  };
  readonly vertical_encoding: string;
  readonly grid_layout: string;
  readonly cell_diagonal: string;
}

const REQUIRED_FIELDS = [
  "world_width_m",
  "world_depth_m",
  "terrain_spacing_m",
  "terrain_cells",
  "elevation_points",
  "minimum_elevation_m",
  "sea_level_m",
  "lowland_reference_elevation_m",
  "maximum_elevation_m",
  "uint16_reference_values",
  "vertical_encoding",
  "grid_layout",
  "cell_diagonal",
] as const;

export function parseTerrainDescriptor(value: unknown): TerrainDescriptor {
  const document = requireRecord(value, "terrain descriptor");
  const missing = REQUIRED_FIELDS.filter((field) => !(field in document));
  if (missing.length > 0) {
    throw new ContractError(`terrain descriptor is missing required fields: ${missing.join(", ")}`);
  }

  const width = requirePositiveNumber(document.world_width_m, "world_width_m");
  const depth = requirePositiveNumber(document.world_depth_m, "world_depth_m");
  const spacing = requirePositiveNumber(document.terrain_spacing_m, "terrain_spacing_m");
  const cells = parseGridDimensions(document.terrain_cells, "terrain_cells");
  const points = parseGridDimensions(document.elevation_points, "elevation_points");

  if (points.x !== cells.x + 1 || points.z !== cells.z + 1) {
    throw new ContractError("elevation point dimensions must be cell dimensions plus one");
  }
  if (!isClose(width, cells.x * spacing, 1e-9, 1e-6)) {
    throw new ContractError("world_width_m does not equal terrain_cells.x * spacing");
  }
  if (!isClose(depth, cells.z * spacing, 1e-9, 1e-6)) {
    throw new ContractError("world_depth_m does not equal terrain_cells.z * spacing");
  }

  const minimum = requireFiniteNumber(document.minimum_elevation_m, "minimum_elevation_m");
  const sea = requireFiniteNumber(document.sea_level_m, "sea_level_m");
  const lowland = requireFiniteNumber(
    document.lowland_reference_elevation_m,
    "lowland_reference_elevation_m",
  );
  const maximum = requireFiniteNumber(document.maximum_elevation_m, "maximum_elevation_m");
  if (!(minimum <= sea && sea <= lowland && lowland <= maximum && maximum > minimum)) {
    throw new ContractError("terrain elevation references are inconsistent");
  }

  const references = requireRecord(document.uint16_reference_values, "uint16_reference_values");
  requireExactKeys(references, ["sea_level", "lowland_reference"], "uint16_reference_values");
  const seaCode = requireInteger(references.sea_level, "uint16_reference_values.sea_level");
  const lowlandCode = requireInteger(
    references.lowland_reference,
    "uint16_reference_values.lowland_reference",
  );
  if (seaCode !== encodeUint16Reference(sea, minimum, maximum)) {
    throw new ContractError("uint16_reference_values.sea_level is inconsistent");
  }
  if (lowlandCode !== encodeUint16Reference(lowland, minimum, maximum)) {
    throw new ContractError("uint16_reference_values.lowland_reference is inconsistent");
  }

  const verticalEncoding = requireNonEmptyString(document.vertical_encoding, "vertical_encoding");
  const gridLayout = requireNonEmptyString(document.grid_layout, "grid_layout");
  if (!gridLayout.includes("Rows increase along +Z") || !gridLayout.includes("columns increase along +X")) {
    throw new ContractError("descriptor grid_layout must declare rows increasing along +Z and columns along +X");
  }
  const cellDiagonal = requireNonEmptyString(document.cell_diagonal, "cell_diagonal");
  if (!cellDiagonal.toLowerCase().includes("northwest to southeast")) {
    throw new ContractError("descriptor cell_diagonal must be northwest to southeast");
  }

  return {
    world_width_m: width,
    world_depth_m: depth,
    terrain_spacing_m: spacing,
    terrain_cells: cells,
    elevation_points: points,
    minimum_elevation_m: minimum,
    sea_level_m: sea,
    lowland_reference_elevation_m: lowland,
    maximum_elevation_m: maximum,
    uint16_reference_values: { sea_level: seaCode, lowland_reference: lowlandCode },
    vertical_encoding: verticalEncoding,
    grid_layout: gridLayout,
    cell_diagonal: cellDiagonal,
  };
}

function parseGridDimensions(value: unknown, context: string): GridDimensions {
  const dimensions = requireRecord(value, context);
  requireExactKeys(dimensions, ["x", "z", "total"], context);
  const x = requirePositiveInteger(dimensions.x, `${context}.x`);
  const z = requirePositiveInteger(dimensions.z, `${context}.z`);
  const total = requirePositiveInteger(dimensions.total, `${context}.total`);
  if (total !== x * z) {
    throw new ContractError(`${context}.total is inconsistent`);
  }
  return { x, z, total };
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ContractError(`${context} must contain exactly ${wanted.join(", ")}`);
  }
}

function requireFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractError(`${context} must be a finite number`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, context: string): number {
  const result = requireFiniteNumber(value, context);
  if (result <= 0) {
    throw new ContractError(`${context} must be greater than zero`);
  }
  return result;
}

function requireInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ContractError(`${context} must be an integer`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, context: string): number {
  const result = requireInteger(value, context);
  if (result <= 0) {
    throw new ContractError(`${context} must be a positive integer`);
  }
  return result;
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${context} must be a non-empty string`);
  }
  return value;
}

function encodeUint16Reference(value: number, minimum: number, maximum: number): number {
  const normalized = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return roundHalfToEven(normalized * 65_535);
}

function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) <= Number.EPSILON * Math.max(1, value)) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(value);
}

function isClose(left: number, right: number, relativeTolerance: number, absoluteTolerance: number): boolean {
  return Math.abs(left - right) <= Math.max(
    relativeTolerance * Math.max(Math.abs(left), Math.abs(right)),
    absoluteTolerance,
  );
}
