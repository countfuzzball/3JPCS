export class ContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}
