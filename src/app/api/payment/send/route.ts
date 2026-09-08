/**
 * POST /api/payment/send — Submit signed payment to Horizon
 * Body: { signedXdr, destination, amount, assetCode, senderAddress }
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import {
  sendPaymentServer,
  buildPaymentTransaction,
  validateAmount,
  validateAssetCode,
} from "@/lib/server/horizonService";
import { parseJsonBody, toHttpError, getRequestMetadata } from "@/lib/server/http";
import { isValidStellarAddress } from "@/lib/stellar/address";

export async function POST(request: NextRequest) {
  try {
    // CSRF validation for state-changing operations
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;

    const parsedBody = await parseJsonBody(request);
    const body = {
      signedXdr: typeof parsedBody.signedXdr === "string" ? parsedBody.signedXdr : undefined,
      destination: typeof parsedBody.destination === "string" ? parsedBody.destination : undefined,
      amount: typeof parsedBody.amount === "string" ? parsedBody.amount : undefined,
      assetCode: typeof parsedBody.assetCode === "string" ? parsedBody.assetCode : undefined,
      assetIssuer: typeof parsedBody.assetIssuer === "string" ? parsedBody.assetIssuer : undefined,
      memo: typeof parsedBody.memo === "string" ? parsedBody.memo : undefined,
      senderAddress:
        typeof parsedBody.senderAddress === "string" ? parsedBody.senderAddress : undefined,
    };

    // Self-payments are almost always a mistake (and can never be recovered
    // from on-chain); reject them consistently on both the build and submit
    // paths before any wallet interaction.
    if (
      body.senderAddress &&
      body.destination &&
      body.senderAddress.trim() === body.destination.trim()
    ) {
      return NextResponse.json({ error: "Sender and destination must differ" }, { status: 400 });
    }

    // Checksum-validate both accounts up front (StrKey, not just a G-prefix):
    // a malformed sender otherwise comes back as a confusing Horizon 500 in
    // production, and a malformed destination would only be caught deep in the
    // service layer as a generic server error.
    if (body.senderAddress && !isValidStellarAddress(body.senderAddress)) {
      return NextResponse.json({ error: "Invalid sender address" }, { status: 400 });
    }
    if (body.destination && !isValidStellarAddress(body.destination)) {
      return NextResponse.json({ error: "Invalid destination address" }, { status: 400 });
    }

    // Validate amount/asset format up front (the build path also validates,
    // but the submit path must not depend on a prior build call).
    if (body.amount) {
      const amountError = validateAmount(body.amount, body.assetCode);
      if (amountError) {
        return NextResponse.json({ error: amountError }, { status: 400 });
      }
    }
    if (body.assetCode && body.assetCode !== "XLM") {
      const codeError = validateAssetCode(body.assetCode);
      if (codeError) {
        return NextResponse.json({ error: codeError }, { status: 400 });
      }
    }

    // An issuer is meaningless for the native asset: XLM has no issuer, and
    // a payload naming both XLM and an issuer would have the issuer silently
    // dropped later. Reject the contradictory combination up front.
    if (body.assetIssuer && (!body.assetCode || body.assetCode === "XLM")) {
      return NextResponse.json(
        { error: "assetIssuer requires a non-native assetCode" },
        { status: 400 },
      );
    }

    // If no signed XDR, just build the transaction for the frontend.
    // Building loads the account + sequence from Horizon, so it gets a
    // per-IP general-bucket cap (the per-address payment bucket is reserved
    // for actual submissions).
    if (!body.signedXdr) {
      if (!body.senderAddress || !body.destination || !body.amount) {
        return NextResponse.json(
          { error: "senderAddress, destination, and amount required" },
          { status: 400 },
        );
      }
      const rateLimitResponse = checkRateLimit(request, "general");
      if (rateLimitResponse) return rateLimitResponse;
      const { xdr, feeStroops } = await buildPaymentTransaction(
        body.senderAddress,
        body.destination,
        body.amount,
        body.assetCode,
        body.assetIssuer,
        typeof body.memo === "string" ? body.memo : undefined,
      );
      return attachRateLimitHeaders(request, NextResponse.json({ xdr, feeStroops }), "general");
    }

    // Submit signed payment
    const { signedXdr, destination, amount, assetCode, assetIssuer, senderAddress } = body;
    if (!senderAddress || !destination || !amount) {
      return NextResponse.json(
        { error: "senderAddress, destination, amount required" },
        { status: 400 },
      );
    }

    const rateLimitResponse = checkRateLimit(request, "payment", senderAddress);
    if (rateLimitResponse) return rateLimitResponse;

    const { ip, userAgent } = getRequestMetadata(request);

    const result = await sendPaymentServer(
      senderAddress,
      signedXdr,
      destination,
      amount,
      assetCode || "XLM",
      { ip, userAgent },
      assetIssuer,
      typeof body.memo === "string" ? body.memo : undefined,
    );

    const response = attachRateLimitHeaders(
      request,
      NextResponse.json({ success: true, hash: result.hash }),
      "payment",
      senderAddress,
    );
    setCsrfCookie(response);
    return response;
  } catch (err) {
    const httpError = toHttpError(err);
    return NextResponse.json({ error: httpError.message }, { status: httpError.status });
  }
}
