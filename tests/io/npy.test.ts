import { describe, expect, it } from "vitest";
import { parseFloat32Npy } from "../../src/io/npy";
import { fixtureBytes, fixtureJson } from "../helpers/fixtures";

interface TerrainGolden {
  readonly row_major_heights: readonly number[];
  readonly source_sha256: Record<string, string>;
}

describe("float32 NPY parser", () => {
  it.each([
    ["terrain-v1-c.npy", 1, false],
    ["terrain-v2-fortran.npy", 2, true],
    ["terrain-v3-c.npy", 3, false],
  ] as const)("normalizes %s into row-major float32", async (name, major, fortran) => {
    const golden = await fixtureJson<TerrainGolden>("terrain-golden.json");
    const result = parseFloat32Npy(await fixtureBytes(name));
    expect(result.version).toEqual([major, 0]);
    expect(result.fortranOrder).toBe(fortran);
    expect(result.shape).toEqual([3, 3]);
    expect([...result.data]).toEqual(golden.row_major_heights);
  });

  it("rejects malformed magic and truncated payloads", async () => {
    const valid = new Uint8Array(await fixtureBytes("terrain-v1-c.npy"));
    const wrongMagic = valid.slice();
    wrongMagic[0] = 0;
    expect(() => parseFloat32Npy(wrongMagic.buffer)).toThrow(/magic/i);
    expect(() => parseFloat32Npy(valid.slice(0, -1).buffer)).toThrow(/truncated/i);
  });

  it("rejects non-float32, object, and big-endian descriptors explicitly", async () => {
    const source = new Uint8Array(await fixtureBytes("terrain-v1-c.npy"));
    expect(() => parseFloat32Npy(asArrayBuffer(replaceAscii(source, "<f4", "<f8")))).toThrow(/float32/i);
    expect(() => parseFloat32Npy(asArrayBuffer(replaceAscii(source, "<f4", "|O4")))).toThrow(/object/i);
    expect(() => parseFloat32Npy(asArrayBuffer(replaceAscii(source, "<f4", ">f4")))).toThrow(/big-endian/i);
  });

  it("rejects non-finite elevations", async () => {
    const source = new Uint8Array(await fixtureBytes("terrain-v1-c.npy"));
    new DataView(source.buffer).setFloat32(source.byteLength - 4, Number.NaN, true);
    expect(() => parseFloat32Npy(source.buffer)).toThrow(/non-finite/i);
  });
});

function replaceAscii(source: Uint8Array, from: string, to: string): Uint8Array {
  const result = source.slice();
  const haystack = new TextDecoder("windows-1252").decode(result);
  const index = haystack.indexOf(from);
  if (index < 0 || from.length !== to.length) throw new Error("test replacement must preserve length");
  result.set(new TextEncoder().encode(to), index);
  return result;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
