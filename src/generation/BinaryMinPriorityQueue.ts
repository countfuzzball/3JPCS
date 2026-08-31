import { ContractError } from "../model/errors";

export interface PriorityQueueItem<T> {
  readonly value: T;
  readonly priority: number;
}

interface HeapEntry<T> extends PriorityQueueItem<T> {
  readonly insertionOrder: number;
}

/** Stable binary min-heap. Equal priorities leave in insertion order. */
export class BinaryMinPriorityQueue<T> {
  readonly #entries: HeapEntry<T>[] = [];
  #nextInsertionOrder = 0;

  public get size(): number {
    return this.#entries.length;
  }

  public get empty(): boolean {
    return this.#entries.length === 0;
  }

  public clear(): void {
    this.#entries.length = 0;
    this.#nextInsertionOrder = 0;
  }

  public push(value: T, priority: number): void {
    if (!Number.isFinite(priority)) throw new ContractError("priority queue priority must be finite");
    if (!Number.isSafeInteger(this.#nextInsertionOrder)) {
      throw new ContractError("priority queue insertion order exhausted its safe integer range");
    }
    this.#entries.push({ value, priority, insertionOrder: this.#nextInsertionOrder });
    this.#nextInsertionOrder += 1;
    this.#siftUp(this.#entries.length - 1);
  }

  public peek(): PriorityQueueItem<T> | undefined {
    const entry = this.#entries[0];
    return entry ? { value: entry.value, priority: entry.priority } : undefined;
  }

  public pop(): PriorityQueueItem<T> | undefined {
    const first = this.#entries[0];
    if (!first) return undefined;
    const last = this.#entries.pop();
    if (last && this.#entries.length > 0) {
      this.#entries[0] = last;
      this.#siftDown(0);
    }
    return { value: first.value, priority: first.priority };
  }

  #siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.#less(index, parent)) return;
      this.#swap(index, parent);
      index = parent;
    }
  }

  #siftDown(startIndex: number): void {
    let index = startIndex;
    let settled = false;
    while (!settled) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.#entries.length && this.#less(left, smallest)) smallest = left;
      if (right < this.#entries.length && this.#less(right, smallest)) smallest = right;
      if (smallest === index) {
        settled = true;
      } else {
        this.#swap(index, smallest);
        index = smallest;
      }
    }
  }

  #less(leftIndex: number, rightIndex: number): boolean {
    const left = this.#entries[leftIndex];
    const right = this.#entries[rightIndex];
    if (!left || !right) throw new ContractError("priority queue heap is malformed");
    return left.priority < right.priority
      || (left.priority === right.priority && left.insertionOrder < right.insertionOrder);
  }

  #swap(leftIndex: number, rightIndex: number): void {
    const left = this.#entries[leftIndex];
    const right = this.#entries[rightIndex];
    if (!left || !right) throw new ContractError("priority queue heap is malformed");
    this.#entries[leftIndex] = right;
    this.#entries[rightIndex] = left;
  }
}
