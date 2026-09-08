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
import { isValidStellarAddress } from "@/lib/stellar/address";
import {
  simulateContractCallServer,
  buildContractInvocation,
  submitContractInvocation,
} from "@/lib/server/sorobanService";
import * as StellarSdk from "@stellar/stellar-sdk";
import { parseJsonBody, toHttpError, getRequestMetadata, HttpError } from "@/lib/server/http";

/** Upper bounds that keep request bodies within Soroban's practical limits. */
const MAX_ARGS = 32;
const MAX_FUNCTION_NAME_LENGTH = 64;
const FUNCTION_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 64-bit mask used to split i128/u128 values into low/high 64-bit limbs.
 */
const MASK64 = BigInt("0xFFFFFFFFFFFFFFFF");

/** i128 / u128 value bounds, checked before limb splitting. */
const I128_MIN = -(BigInt(1) << BigInt(127));
const I128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1);
const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;

/**
 * Coerce a JSON number/string to BigInt. BigInt() on a non-numeric string
 * throws a SyntaxError that would otherwise surface as a 500.
 */
function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new HttpError(400, `${label} must be an integer string or integer number`);
}

/**
 * Convert a JSON argument to a Soroban ScVal with exact, bounds-checked
 * integer handling.
 *
 * The naive Number-based i128/u128 encoding rounded every value above
 * 2^53 (the first limb crossed Number.MAX_SAFE_INTEGER) and silently
 * wrapped out-of-range values into garbage, so both limbs are now split
 * from BigInts via decimal strings and every value is range-checked first.
 */
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
    // Plain integer strings → i128 when they fit; longer digit strings are
    // almost certainly data (IDs, hashes), so keep them as strings instead of
    // truncating them into an out-of-range i128.
    if (/^-?\d+$/.test(arg)) {
      const num = BigInt(arg);
      if (num >= I128_MIN && num <= I128_MAX) {
        return toScvI128(num);
      }
    }
    return StellarSdk.xdr.ScVal.scvString(arg);
  }

  // number — map to the narrowest integer type that fits; no silent
  // string fallback for integers anymore.
  if (typeof arg === "number") {
    if (!Number.isInteger(arg)) {
      throw new HttpError(400, `Unsupported numeric argument: ${arg}`);
    }
    if (arg >= 0 && arg <= U32_MAX) {
      return StellarSdk.xdr.ScVal.scvU32(arg);
    }
    if (arg >= I32_MIN && arg <= I32_MAX) {
      return StellarSdk.xdr.ScVal.scvI32(arg);
    }
    if (arg >= Number(I64_MIN) && arg <= Number(I64_MAX)) {
      return StellarSdk.xdr.ScVal.scvI64(StellarSdk.xdr.Int64.fromString(String(arg)));
    }
    throw new HttpError(
      400,
      `Numeric argument out of i64 range: ${arg} (use a string, e.g. { i128: "${arg}" })`,
    );
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
      return toScvI128(asBigInt(obj.i128, "i128"));
    }
    if (obj.u128 !== undefined) {
      const num = asBigInt(obj.u128, "u128");
      if (num < 0 || num > U128_MAX) {
        throw new HttpError(400, `u128 argument out of range: ${num}`);
      }
      return toScvU128(num);
    }
    if (obj.i64 !== undefined) {
      const num = asBigInt(obj.i64, "i64");
      if (num < I64_MIN || num > I64_MAX) {
        throw new HttpError(400, `i64 argument out of range: ${num}`);
      }
      return StellarSdk.xdr.ScVal.scvI64(StellarSdk.xdr.Int64.fromString(num.toString()));
    }
    if (obj.u64 !== undefined) {
      const num = asBigInt(obj.u64, "u64");
      if (num < 0 || num > U64_MAX) {
        throw new HttpError(400, `u64 argument out of range: ${num}`);
      }
      return StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(num.toString()));
    }
    if (obj.i32 !== undefined) {
      const num = asBigInt(obj.i32, "i32");
      if (num < BigInt(I32_MIN) || num > BigInt(I32_MAX)) {
        throw new HttpError(400, `i32 argument out of range: ${num}`);
      }
      return StellarSdk.xdr.ScVal.scvI32(Number(num));
    }
    if (obj.u32 !== undefined) {
      const num = asBigInt(obj.u32, "u32");
      if (num < 0 || num > BigInt(U32_MAX)) {
        throw new HttpError(400, `u32 argument out of range: ${num}`);
      }
      return StellarSdk.xdr.ScVal.scvU32(Number(num));
    }
    if (obj.symbol && typeof obj.symbol === "string") {
      return StellarSdk.xdr.ScVal.scvSymbol(obj.symbol);
    }
    if (obj.string && typeof obj.string === "string") {
      return StellarSdk.xdr.ScVal.scvString(obj.string);
    }
    if (obj.bytes && typeof obj.bytes === "string") {
      if (!/^[0-9a-fA-F]*$/.test(obj.bytes) || obj.bytes.length % 2 !== 0) {
        throw new HttpError(400, "bytes must be an even-length hex string");
      }
      return StellarSdk.xdr.ScVal.scvBytes(Buffer.from(obj.bytes, "hex"));
    }
    if (obj.vec && Array.isArray(obj.vec)) {
      const items = obj.vec.map((item: unknown) => argToScVal(item));
      return StellarSdk.xdr.ScVal.scvVec(items);
    }
    if (obj.map && Array.isArray(obj.map)) {
      const entries = obj.map.map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2) {
          throw new HttpError(400, "map entries must be [key, value] pairs");
        }
        const [key, val] = entry as [unknown, unknown];
        return new StellarSdk.xdr.ScMapEntry({
          key: argToScVal(key),
          val: argToScVal(val),
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
  throw new HttpError(400, `Unsupported argument type: ${JSON.stringify(arg)}`);
}

/** Encode a BigInt as an i128 ScVal via exact decimal string limbs. */
function toScvI128(num: bigint): StellarSdk.xdr.ScVal {
  if (num < I128_MIN || num > I128_MAX) {
    throw new HttpError(400, `i128 argument out of range: ${num}`);
  }
  const lo = num & MASK64;
  const hi = num >> BigInt(64);
  return StellarSdk.xdr.ScVal.scvI128(
    new StellarSdk.xdr.Int128Parts({
      lo: StellarSdk.xdr.Uint64.fromString(lo.toString()),
      hi: StellarSdk.xdr.Int64.fromString(hi.toString()),
    }),
  );
}

/** Encode a BigInt as a u128 ScVal via exact decimal string limbs. */
function toScvU128(num: bigint): StellarSdk.xdr.ScVal {
  if (num < 0 || num > U128_MAX) {
    throw new HttpError(400, `u128 argument out of range: ${num}`);
  }
  const lo = num & MASK64;
  const hi = num >> BigInt(64);
  return StellarSdk.xdr.ScVal.scvU128(
    new StellarSdk.xdr.UInt128Parts({
      lo: StellarSdk.xdr.Uint64.fromString(lo.toString()),
      hi: StellarSdk.xdr.Uint64.fromString(hi.toString()),
    }),
  );
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
    // Checksum-validate the signer too (StrKey, not just a G-prefix): an
    // invalid signer otherwise reaches Horizon loadAccount and comes back as
    // a confusing 500 instead of a clean 400.
    if (!isValidStellarAddress(body.signerAddress)) {
      return NextResponse.json({ error: "Invalid signer address" }, { status: 400 });
    }
    if ((body.args || []).length > MAX_ARGS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_ARGS} arguments per invocation` },
        { status: 400 },
      );
    }

    // Convert args to ScVal with comprehensive type support. Conversion
    // failures are the caller's fault (bad types, out-of-range numbers,
    // malformed wrappers) so they must surface as 400s with a helpful
    // message — not the generic 500 that an unclassified Error produced in
    // production, where toHttpError() hides the text.
    let scValArgs: StellarSdk.xdr.ScVal[];
    try {
      scValArgs = (body.args || []).map(argToScVal);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err instanceof Error ? err.message : "Invalid contract arguments");
    }

    // Read-only simulation. Both this and the build branch below drive a
    // Soroban RPC simulateContractCall — real compute on the RPC provider's
    // dime — so they get a per-IP general-bucket limit instead of being free
    // (the per-address contract bucket is reserved for actual submissions).
    if (body.simulate) {
      const rateLimitResponse = checkRateLimit(request, "general");
      if (rateLimitResponse) return rateLimitResponse;
      const result = await simulateContractCallServer(
        body.contractId,
        body.functionName,
        scValArgs,
        body.signerAddress,
      );
      return attachRateLimitHeaders(
        request,
        NextResponse.json({ resultValue: result.resultValue }),
        "general",
      );
    }

    // Submit signed invocation (state-changing — requires CSRF)
    if (body.signedXdr) {
      const csrfError = validateCsrf(request);
      if (csrfError) return csrfError;

      const rateLimitResponse = checkRateLimit(request, "contract", body.signerAddress);
      if (rateLimitResponse) return rateLimitResponse;

      const { ip, userAgent } = getRequestMetadata(request);

      const result = await submitContractInvocation(
        body.signedXdr,
        body.contractId,
        body.functionName,
        body.signerAddress,
        { ip, userAgent },
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

    // Build transaction for signing — also triggers an RPC simulation for
    // the footprint, so rate-limit it per IP like the simulate branch.
    const rateLimitResponse = checkRateLimit(request, "general");
    if (rateLimitResponse) return rateLimitResponse;
    const { xdr } = await buildContractInvocation(
      body.contractId,
      body.functionName,
      scValArgs,
      body.signerAddress,
    );
    return attachRateLimitHeaders(request, NextResponse.json({ xdr }), "general");
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
