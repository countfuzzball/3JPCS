import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const destination = join(process.cwd(), "tests", "fixtures", "terrain");
await mkdir(destination, { recursive: true });

const heights = [0, 10, 20, 20, 40, 60, 50, 70, 90];
const files = [
  ["terrain-v1-c.npy", makeNpy(1, false, heights)],
  ["terrain-v2-fortran.npy", makeNpy(2, true, heights)],
  ["terrain-v3-c.npy", makeNpy(3, false, heights)],
];

for (const [name, bytes] of files) {
  await writeFile(join(destination, name), bytes);
}

const descriptor = {
  world_width_m: 20,
  world_depth_m: 20,
  terrain_spacing_m: 10,
  terrain_cells: { x: 2, z: 2, total: 4 },
  elevation_points: { x: 3, z: 3, total: 9 },
  minimum_elevation_m: -100,
  sea_level_m: 0,
  lowland_reference_elevation_m: 5,
  maximum_elevation_m: 100,
  uint16_reference_values: { sea_level: 32768, lowland_reference: 34406 },
  vertical_encoding: "Unsigned 16-bit greyscale: 0 maps to minimum_elevation_m and 65535 maps to maximum_elevation_m; values outside that range are clipped.",
  grid_layout: "Rows increase along +Z; columns increase along +X.",
  cell_diagonal: "Each cell is divided from northwest to southeast.",
};

const golden = {
  shape: [3, 3],
  row_major_heights: heights,
  source_sha256: Object.fromEntries(files.map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")])),
  samples: [
    { x_m: 8, z_m: 2, height_m: 14 },
    { x_m: 2, z_m: 8, height_m: 20 },
    { x_m: 0, z_m: 0, height_m: 0 },
    { x_m: 20, z_m: 20, height_m: 90 },
  ],
  slopes_deg: {
    upper_triangle: Math.atan(Math.hypot(1, 3)) * 180 / Math.PI,
    lower_triangle: Math.atan(Math.hypot(2, 2)) * 180 / Math.PI,
  },
};

await writeFile(join(destination, "terrain-descriptor.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
await writeFile(join(destination, "terrain-golden.json"), `${JSON.stringify(golden, null, 2)}\n`);

function makeNpy(major, fortranOrder, rowMajorValues) {
  const minor = 0;
  const headerBase = `{'descr': '<f4', 'fortran_order': ${fortranOrder ? "True" : "False"}, 'shape': (3, 3), }`;
  const lengthBytes = major === 1 ? 2 : 4;
  const preambleLength = 8 + lengthBytes;
  const headerEncoding = major === 3 ? "utf8" : "latin1";
  const unpaddedLength = Buffer.byteLength(headerBase, headerEncoding) + 1;
  const padding = (64 - ((preambleLength + unpaddedLength) % 64)) % 64;
  const header = Buffer.from(`${headerBase}${" ".repeat(padding)}\n`, headerEncoding);
  const preamble = Buffer.alloc(preambleLength);
  Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, major, minor]).copy(preamble);
  if (major === 1) preamble.writeUInt16LE(header.length, 8);
  else preamble.writeUInt32LE(header.length, 8);

  const orderedValues = fortranOrder
    ? [0, 20, 50, 10, 40, 70, 20, 60, 90]
    : rowMajorValues;
  const payload = Buffer.alloc(orderedValues.length * 4);
  orderedValues.forEach((value, index) => payload.writeFloatLE(value, index * 4));
  return Buffer.concat([preamble, header, payload]);
}
