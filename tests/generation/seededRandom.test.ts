import { describe, expect, it } from "vitest";
import { SeededRandom } from "../../src/generation/seededRandom";

describe("SeededRandom", () => {
  it("matches the fixed Mulberry32 vector and repeats exactly for the same integer seed", () => {
    const expectedUint32 = [3381219976, 766838775, 2127363934, 993692063, 1614012641, 3579227506];
    const first = new SeededRandom(123);
    const second = new SeededRandom(123);
    expect(expectedUint32.map(() => first.nextUint32())).toEqual(expectedUint32);
    expect(expectedUint32.map(() => second.nextUint32())).toEqual(expectedUint32);

    const floats = new SeededRandom(123);
    expect(floats.nextFloat()).toBe(0.7872516233474016);
    expect(floats.nextFloat()).toBe(0.1785435655619949);
  });

  it("uses array order only for deterministic choices and non-mutating shuffles", () => {
    const source = ["a", "b", "c", "d", "e"];
    const shuffled = new SeededRandom(123).shuffled(source);
    expect(shuffled).toEqual(["c", "e", "b", "a", "d"]);
    expect(source).toEqual(["a", "b", "c", "d", "e"]);

    const random = new SeededRandom(7);
    for (let index = 0; index < 50; index += 1) {
      expect(random.integer(-3, 4)).toBeGreaterThanOrEqual(-3);
      expect(random.integer(-3, 4)).toBeLessThan(4);
    }
    expect(new SeededRandom(123).pick(source)).toBe("d");
  });

  it("rejects invalid seeds, ranges, and empty choices", () => {
    expect(() => new SeededRandom(Number.NaN)).toThrow(/seed/);
    expect(() => new SeededRandom(1.5)).toThrow(/seed/);
    const random = new SeededRandom(1);
    expect(() => random.floatBetween(3, 2)).toThrow(/maximum/);
    expect(() => random.floatBetween(0, Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => random.integer(2, 2)).toThrow(/maximum/);
    expect(() => random.integer(0.5, 2)).toThrow(/safe integers/);
    expect(() => random.pick([])).toThrow(/empty/);
  });
});
