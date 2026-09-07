/**
 * POST /api/payment/send — Submit signed payment to Horizon
 * Body: { signedXdr, destination, amount, assetCode, senderAddress }
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, attachRateLimitHeaders } from "@/lib/server/rateLimiter";
import { validateCsrf, setCsrfCookie } from "@/lib/server/csrf";
import { sendPaymentServer, buildPaymentTransaction } from "@/lib/server/horizonService";

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
