import { ContractError } from "../model/errors";

export interface GenerationOperationToken {
  readonly operationId: number;
}

/** Owns the single preview-producing generation operation active in an editor. */
export class GenerationOperationGate {
  #revision = 0;
  #activeOperationId: number | null = null;

  public begin(): GenerationOperationToken {
    this.#revision = nextRevision(this.#revision);
    this.#activeOperationId = this.#revision;
    return Object.freeze({ operationId: this.#revision });
  }

  public cancel(token?: GenerationOperationToken): boolean {
    if (this.#activeOperationId === null) return false;
    if (token && token.operationId !== this.#activeOperationId) return false;
    this.#revision = nextRevision(this.#revision);
    this.#activeOperationId = null;
    return true;
  }

  public isCurrent(token: GenerationOperationToken): boolean {
    return Number.isSafeInteger(token.operationId)
      && this.#activeOperationId !== null
      && token.operationId === this.#activeOperationId;
  }

  public completeIfCurrent(token: GenerationOperationToken, apply: () => void): boolean {
    if (!this.isCurrent(token)) return false;
    this.#activeOperationId = null;
    apply();
    return true;
  }
}

function nextRevision(current: number): number {
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new ContractError("generation operation counter exhausted its safe integer range");
  }
  return current + 1;
}
