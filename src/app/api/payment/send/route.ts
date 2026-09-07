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

export async function POST(request: NextRequest) {
  try {
    // CSRF validation for state-changing operations
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;

    const body = (await request.json()) as {
      signedXdr?: string;
      destination?: string;
      amount?: string;
      assetCode?: string;
      assetIssuer?: string;
      senderAddress?: string;
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

    // If no signed XDR, just build the transaction for the frontend
    if (!body.signedXdr) {
      if (!body.senderAddress || !body.destination || !body.amount) {
        return NextResponse.json(
          { error: "senderAddress, destination, and amount required" },
          { status: 400 },
        );
      }
      const { xdr } = await buildPaymentTransaction(
        body.senderAddress,
        body.destination,
        body.amount,
        body.assetCode,
        body.assetIssuer,
      );
      return NextResponse.json({ xdr });
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

    const ip = request.headers.get("x-forwarded-for") || undefined;
    const ua = request.headers.get("user-agent") || undefined;

    const result = await sendPaymentServer(
      senderAddress,
      signedXdr,
      destination,
      amount,
      assetCode || "XLM",
      { ip, userAgent: ua },
      assetIssuer,
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Payment failed" },
      { status: 500 },
    );
  }
}
