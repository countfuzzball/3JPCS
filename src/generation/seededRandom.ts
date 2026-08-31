import { ContractError } from "../model/errors";

const UINT32_RANGE = 0x1_0000_0000;

/** Deterministic Mulberry32 stream for baked generation tools. */
export class SeededRandom {
  #state: number;

  public constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new ContractError("generation seed must be a safe integer");
    this.#state = seed >>> 0;
  }

  public nextUint32(): number {
    let value = this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return (value ^ value >>> 14) >>> 0;
  }

  public nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  public floatBetween(minimum: number, maximum: number): number {
    assertFiniteRange(minimum, maximum);
    return minimum + (maximum - minimum) * this.nextFloat();
  }

  public integer(minimumInclusive: number, maximumExclusive: number): number {
    if (!Number.isSafeInteger(minimumInclusive) || !Number.isSafeInteger(maximumExclusive)) {
      throw new ContractError("random integer bounds must be safe integers");
    }
    if (maximumExclusive <= minimumInclusive) {
      throw new ContractError("random integer maximum must be greater than its minimum");
    }
    return minimumInclusive + Math.floor(this.nextFloat() * (maximumExclusive - minimumInclusive));
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new ContractError("cannot choose from an empty collection");
    const value = values[this.integer(0, values.length)];
    if (value === undefined) throw new ContractError("random choice could not resolve a value");
    return value;
  }

  public shuffled<T>(values: readonly T[]): T[] {
    const output = [...values];
    for (let index = output.length - 1; index > 0; index -= 1) {
      const other = this.integer(0, index + 1);
      const value = output[index];
      const replacement = output[other];
      if (value === undefined || replacement === undefined) {
        throw new ContractError("random shuffle addressed a missing value");
      }
      output[index] = replacement;
      output[other] = value;
    }
    return output;
  }
}

function assertFiniteRange(minimum: number, maximum: number): void {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new ContractError("random floating-point bounds must be finite");
  }
  if (maximum < minimum) throw new ContractError("random floating-point maximum must not be below its minimum");
}
