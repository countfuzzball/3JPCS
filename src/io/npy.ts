import { ContractError } from "../model/errors";

export interface ParsedNpy {
  readonly data: Float32Array;
  readonly shape: readonly [number, number];
  readonly fortranOrder: boolean;
  readonly version: readonly [number, number];
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59] as const;

export function parseFloat32Npy(source: ArrayBuffer): ParsedNpy {
  const bytes = new Uint8Array(source);
  if (bytes.byteLength < 10 || MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new ContractError("terrain NPY has invalid magic bytes");
  }

  const major = bytes[6];
  const minor = bytes[7];
  if (major === undefined || minor === undefined || ![1, 2, 3].includes(major)) {
    throw new ContractError(`terrain NPY uses unsupported version ${String(major)}.${String(minor)}`);
  }

  const view = new DataView(source);
  const lengthFieldBytes = major === 1 ? 2 : 4;
  const preambleBytes = 8 + lengthFieldBytes;
  if (bytes.byteLength < preambleBytes) {
    throw new ContractError("terrain NPY is truncated before its header length");
  }
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const payloadOffset = preambleBytes + headerLength;
  if (headerLength === 0 || payloadOffset > bytes.byteLength) {
    throw new ContractError("terrain NPY has a malformed or truncated header");
  }

  const headerBytes = bytes.subarray(preambleBytes, payloadOffset);
  const decoder = new TextDecoder(major === 3 ? "utf-8" : "windows-1252", { fatal: true });
  let header: string;
  try {
    header = decoder.decode(headerBytes);
  } catch {
    throw new ContractError("terrain NPY header encoding is invalid");
  }
  if (!header.endsWith("\n")) {
    throw new ContractError("terrain NPY header must end with a newline");
  }

  const descriptor = extractStringField(header, "descr");
  if (descriptor.includes("O")) {
    throw new ContractError("terrain NPY object data is not supported");
  }
  if (descriptor.startsWith(">")) {
    throw new ContractError("terrain NPY big-endian float32 data is not supported");
  }
  if (descriptor !== "<f4" && descriptor !== "=f4") {
    throw new ContractError(`terrain NPY must use little-endian float32, got ${descriptor}`);
  }

  const fortranOrder = extractBooleanField(header, "fortran_order");
  const shape = extractShape(header);
  const valueCount = shape[0] * shape[1];
  if (!Number.isSafeInteger(valueCount)) {
    throw new ContractError("terrain NPY shape is too large");
  }
  const expectedBytes = valueCount * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength - payloadOffset !== expectedBytes) {
    throw new ContractError(
      bytes.byteLength - payloadOffset < expectedBytes
        ? "terrain NPY float32 payload is truncated"
        : "terrain NPY contains unexpected trailing payload bytes",
    );
  }

  const data = new Float32Array(valueCount);
  for (let targetIndex = 0; targetIndex < valueCount; targetIndex += 1) {
    const z = Math.floor(targetIndex / shape[1]);
    const x = targetIndex % shape[1];
    const sourceIndex = fortranOrder ? x * shape[0] + z : targetIndex;
    const value = view.getFloat32(payloadOffset + sourceIndex * 4, true);
    if (!Number.isFinite(value)) {
      throw new ContractError("terrain NPY contains non-finite elevations");
    }
    data[targetIndex] = value;
  }

  return { data, shape, fortranOrder, version: [major, minor] };
}

function extractStringField(header: string, field: string): string {
  const expression = new RegExp(`[\\'"]${field}[\\'"]\\s*:\\s*(?:'([^']*)'|"([^"]*)")`, "g");
  const matches = [...header.matchAll(expression)];
  if (matches.length !== 1) {
    throw new ContractError(`terrain NPY header must contain one ${field} field`);
  }
  const value = matches[0]?.[1] ?? matches[0]?.[2];
  if (value === undefined) {
    throw new ContractError(`terrain NPY header ${field} field is malformed`);
  }
  return value;
}

function extractBooleanField(header: string, field: string): boolean {
  const expression = new RegExp(`[\\'"]${field}[\\'"]\\s*:\\s*(True|False)`, "g");
  const matches = [...header.matchAll(expression)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new ContractError(`terrain NPY header must contain one boolean ${field} field`);
  }
  return matches[0][1] === "True";
}

function extractShape(header: string): readonly [number, number] {
  const expression = /['"]shape['"]\s*:\s*\(([^()]*)\)/g;
  const matches = [...header.matchAll(expression)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new ContractError("terrain NPY header must contain one two-dimensional shape field");
  }
  const rawParts = matches[0][1].split(",").map((part) => part.trim()).filter(Boolean);
  if (rawParts.length !== 2 || rawParts.some((part) => !/^\d+$/.test(part))) {
    throw new ContractError("terrain NPY shape must contain exactly two positive integer dimensions");
  }
  const rows = Number(rawParts[0]);
  const columns = Number(rawParts[1]);
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows <= 0 || columns <= 0) {
    throw new ContractError("terrain NPY shape must contain exactly two positive integer dimensions");
  }
  return [rows, columns];
}
