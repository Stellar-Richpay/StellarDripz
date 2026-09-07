/**
 * POST /api/contract/invoke — Build or submit Soroban contract invocation
 * Body: { contractId, functionName, args, signerAddress, signedXdr? }
 *
 * Supports these ScVal arg types:
 *   - string    → scvString
 *   - number    → scvU32 (if integer) / scvI128 (if large)
 *   - { address: "G..." } → scvAddress
 *   - { i128: 123 } → scvI128
 *   - { u64: 123 }  → scvU64
 *   - { symbol: "X" } → scvSymbol
 *   - { vec: [...] } → scvVec
 *   - { map: [...] } → scvMap
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { isValidContractId } from "@/lib/stellar/contractId";
import {
  simulateContractCallServer,
  buildContractInvocation,
  submitContractInvocation,
} from "@/lib/server/sorobanService";
import * as StellarSdk from "@stellar/stellar-sdk";
import { parseJsonBody, toHttpError } from "@/lib/server/http";

/** Upper bounds that keep request bodies within Soroban's practical limits. */
const MAX_ARGS = 32;
const MAX_FUNCTION_NAME_LENGTH = 64;
const FUNCTION_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Convert a JSON argument to Soroban ScVal */
function argToScVal(arg: unknown): StellarSdk.xdr.ScVal {
  // null / undefined
  if (arg === null || arg === undefined) {
    return StellarSdk.xdr.ScVal.scvVoid();
  }

  // string
  if (typeof arg === "string") {
    // Detect Stellar address format
    if (/^G[A-Z2-7]{55}$/.test(arg)) {
      const addr = new StellarSdk.Address(arg);
      return StellarSdk.xdr.ScVal.scvAddress(addr.toScAddress());
    }
    // Short symbol-like strings → Symbol, longer → String
    if (arg.length <= 10 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(arg)) {
      return StellarSdk.xdr.ScVal.scvSymbol(arg);
    }
    // Numeric strings → i128
    if (/^-?\d+$/.test(arg)) {
      const num = BigInt(arg);
      const lo = Number(num & BigInt("0xFFFFFFFFFFFFFFFF"));
      const hi = Number(num >> BigInt(64));
      return StellarSdk.xdr.ScVal.scvI128(
        new StellarSdk.xdr.Int128Parts({
          lo: new StellarSdk.xdr.Uint64(lo),
          hi: new StellarSdk.xdr.Int64(hi),
        }),
      );
    }
    return StellarSdk.xdr.ScVal.scvString(arg);
  }

  // number — map to the narrowest integer type that fits; no silent
  // string fallback for integers anymore.
  if (typeof arg === "number") {
    if (!Number.isInteger(arg)) {
      throw new Error(`Unsupported numeric argument: ${arg}`);
    }
    if (arg >= 0 && arg <= 4294967295) {
      return StellarSdk.xdr.ScVal.scvU32(arg);
    }
    if (arg >= -2147483648 && arg <= 2147483647) {
      return StellarSdk.xdr.ScVal.scvI32(arg);
    }
    if (arg >= -9223372036854775808 && arg <= 9223372036854775807) {
      return StellarSdk.xdr.ScVal.scvI64(
        StellarSdk.xdr.Int64.fromString(String(arg)),
      );
    }
    throw new Error(`Numeric argument out of range: ${arg}`);
  }

  // boolean
  if (typeof arg === "boolean") {
    return StellarSdk.xdr.ScVal.scvBool(arg);
  }

  // object with type hints
  if (typeof arg === "object" && arg !== null) {
    const obj = arg as Record<string, unknown>;

    if (obj.address && typeof obj.address === "string") {
      const addr = new StellarSdk.Address(obj.address);
      return StellarSdk.xdr.ScVal.scvAddress(addr.toScAddress());
    }
    if (obj.i128 !== undefined) {
      const num = BigInt(String(obj.i128));
      const lo = Number(num & BigInt("0xFFFFFFFFFFFFFFFF"));
      const hi = Number(num >> BigInt(64));
      return StellarSdk.xdr.ScVal.scvI128(
        new StellarSdk.xdr.Int128Parts({
          lo: new StellarSdk.xdr.Uint64(lo),
          hi: new StellarSdk.xdr.Int64(hi),
        }),
      );
    }
    if (obj.u64 !== undefined) {
      return StellarSdk.xdr.ScVal.scvU64(
        StellarSdk.xdr.Uint64.fromString(String(obj.u64)),
      );
    }
    if (obj.u128 !== undefined) {
      const num = BigInt(String(obj.u128));
      const lo = Number(num & BigInt("0xFFFFFFFFFFFFFFFF"));
      const hi = Number(num >> BigInt(64));
      return StellarSdk.xdr.ScVal.scvU128(
        new StellarSdk.xdr.UInt128Parts({
          lo: new StellarSdk.xdr.Uint64(lo),
          hi: new StellarSdk.xdr.Uint64(hi),
        }),
      );
    }
    if (obj.i64 !== undefined) {
      return StellarSdk.xdr.ScVal.scvI64(
        StellarSdk.xdr.Int64.fromString(String(obj.i64)),
      );
    }
    if (obj.i32 !== undefined) {
      return StellarSdk.xdr.ScVal.scvI32(Number(obj.i32));
    }
    if (obj.u32 !== undefined) {
      return StellarSdk.xdr.ScVal.scvU32(Number(obj.u32));
    }
    if (obj.symbol && typeof obj.symbol === "string") {
      return StellarSdk.xdr.ScVal.scvSymbol(obj.symbol);
    }
    if (obj.string && typeof obj.string === "string") {
      return StellarSdk.xdr.ScVal.scvString(obj.string);
    }
    if (obj.bytes && typeof obj.bytes === "string") {
      return StellarSdk.xdr.ScVal.scvBytes(Buffer.from(obj.bytes, "hex"));
    }
    if (obj.vec && Array.isArray(obj.vec)) {
      const items = obj.vec.map((item: unknown) => argToScVal(item));
      return StellarSdk.xdr.ScVal.scvVec(items);
    }
    if (obj.map && Array.isArray(obj.map)) {
      const entries = obj.map.map(([key, val]: [unknown, unknown]) => {
        const scvKey = argToScVal(key);
        const scvVal = argToScVal(val);
        return new StellarSdk.xdr.ScMapEntry({
          key: scvKey,
          val: scvVal,
        });
      });
      return StellarSdk.xdr.ScVal.scvMap(entries);
    }
    if (obj.bool !== undefined) {
      return StellarSdk.xdr.ScVal.scvBool(Boolean(obj.bool));
    }
  }

  // Unknown object shapes: fail loudly instead of silently coercing to a
  // string, which hid mismatched arguments until a confusing RPC error.
  throw new Error(`Unsupported argument type: ${JSON.stringify(arg)}`);
}

export async function POST(request: NextRequest) {
  try {
    const parsedBody = await parseJsonBody(request);
    const body = {
      contractId: typeof parsedBody.contractId === "string" ? parsedBody.contractId : undefined,
      functionName:
        typeof parsedBody.functionName === "string" ? parsedBody.functionName : undefined,
      args: Array.isArray(parsedBody.args) ? parsedBody.args : undefined,
      signerAddress:
        typeof parsedBody.signerAddress === "string" ? parsedBody.signerAddress : undefined,
      signedXdr: typeof parsedBody.signedXdr === "string" ? parsedBody.signedXdr : undefined,
      simulate: typeof parsedBody.simulate === "boolean" ? parsedBody.simulate : undefined,
    };

    if (!body.contractId || !body.functionName || !body.signerAddress) {
      return NextResponse.json(
        { error: "contractId, functionName, signerAddress required" },
        { status: 400 },
      );
    }

    // Checksum-validate the contract ID (not just the C-prefix regex) so
    // malformed IDs fail fast instead of confusing RPC errors, and keep the
    // function name within identifier bounds so it cannot be used as a
    // smuggling vector.
    if (!isValidContractId(body.contractId)) {
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
    }
    if (
      body.functionName.length > MAX_FUNCTION_NAME_LENGTH ||
      !FUNCTION_NAME_RE.test(body.functionName)
    ) {
      return NextResponse.json({ error: "Invalid function name" }, { status: 400 });
    }
    if ((body.args || []).length > MAX_ARGS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ARGS} arguments per invocation` },
        { status: 400 },
      );
    }

    // Convert args to ScVal with comprehensive type support
    const scValArgs: StellarSdk.xdr.ScVal[] = (body.args || []).map(argToScVal);

    // Read-only simulation
    if (body.simulate) {
      const result = await simulateContractCallServer(
        body.contractId,
        body.functionName,
        scValArgs,
        body.signerAddress,
      );
      return NextResponse.json({ resultValue: result.resultValue });
    }

    // Submit signed invocation (state-changing — requires CSRF)
    if (body.signedXdr) {
      const csrfError = validateCsrf(request);
      if (csrfError) return csrfError;

      const rateLimitResponse = checkRateLimit(request, "contract", body.signerAddress);
      if (rateLimitResponse) return rateLimitResponse;

      const ip = request.headers.get("x-forwarded-for") || undefined;
      const ua = request.headers.get("user-agent") || undefined;

      const result = await submitContractInvocation(
        body.signedXdr,
        body.contractId,
        body.functionName,
        body.signerAddress,
        { ip, userAgent: ua },
      );
      const response = attachRateLimitHeaders(
        request,
        NextResponse.json({
          success: true,
          hash: result.hash,
          resultValue: result.resultValue,
        }),
        "contract",
        body.signerAddress,
      );
      setCsrfCookie(response);
      return response;
    }

    // Build transaction for signing
    const { xdr } = await buildContractInvocation(
      body.contractId,
      body.functionName,
      scValArgs,
      body.signerAddress,
    );
    return NextResponse.json({ xdr });
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
