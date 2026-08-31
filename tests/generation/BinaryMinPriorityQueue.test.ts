import { describe, expect, it } from "vitest";
import { BinaryMinPriorityQueue } from "../../src/generation/BinaryMinPriorityQueue";

describe("BinaryMinPriorityQueue", () => {
  it("pops minimum priorities and preserves insertion order for exact ties", () => {
    const queue = new BinaryMinPriorityQueue<string>();
    queue.push("later", 9);
    queue.push("first tie", 2);
    queue.push("middle", 4);
    queue.push("second tie", 2);
    queue.push("negative", -1);

    expect(queue.size).toBe(5);
    expect(queue.peek()).toEqual({ value: "negative", priority: -1 });
    expect([queue.pop(), queue.pop(), queue.pop(), queue.pop(), queue.pop()]).toEqual([
      { value: "negative", priority: -1 },
      { value: "first tie", priority: 2 },
      { value: "second tie", priority: 2 },
      { value: "middle", priority: 4 },
      { value: "later", priority: 9 },
    ]);
    expect(queue.empty).toBe(true);
    expect(queue.pop()).toBeUndefined();
  });

  it("clears reusable queues and rejects non-finite priorities", () => {
    const queue = new BinaryMinPriorityQueue<{ readonly id: number }>();
    queue.push({ id: 1 }, 1);
    queue.clear();
    expect(queue.size).toBe(0);
    queue.push({ id: 2 }, 0);
    expect(queue.pop()?.value.id).toBe(2);
    expect(() => queue.push({ id: 3 }, Number.NaN)).toThrow(/finite/);
    expect(() => queue.push({ id: 4 }, Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});
