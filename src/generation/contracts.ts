export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type GenerationKind = "settlement_survey" | "road_route" | "settlement_frontage" | "county_build";

export interface GenerationRequest<TInput extends JsonValue = JsonValue> {
  readonly operationId: number;
  readonly kind: GenerationKind;
  readonly seed: number;
  readonly input: TInput;
}

export type GenerationDiagnosticSeverity = "info" | "warning" | "error";

export interface GenerationDiagnostic {
  readonly severity: GenerationDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
}

export interface GenerationMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: string | null;
}

export interface GenerationRejectionCount {
  readonly reason: string;
  readonly count: number;
}

interface GenerationResultBase {
  readonly operationId: number;
  readonly kind: GenerationKind;
  readonly diagnostics: readonly GenerationDiagnostic[];
  readonly metrics: readonly GenerationMetric[];
  readonly rejections: readonly GenerationRejectionCount[];
}

export interface GenerationSuccess<TOutput extends JsonValue = JsonValue> extends GenerationResultBase {
  readonly status: "success";
  readonly output: TOutput;
}

export type GenerationFailureReason =
  | "cancelled"
  | "invalid_request"
  | "budget_exhausted"
  | "no_valid_result"
  | "internal_error";

export interface GenerationFailure extends GenerationResultBase {
  readonly status: "failure";
  readonly reason: GenerationFailureReason;
}

export type GenerationResult<TOutput extends JsonValue = JsonValue> = GenerationSuccess<TOutput> | GenerationFailure;
