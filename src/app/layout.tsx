import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import Header from "@/components/Header";
import ToastContainer from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { STELLAR_NETWORK } from "@/lib/stellar/network";

const isTestnet = STELLAR_NETWORK.network === "TESTNET";
const networkLabel = isTestnet ? "Testnet" : "Mainnet";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute base for Open Graph URLs and metadata routes (robots.txt uses
  // it to emit canonical URLs). Deployment can override with NEXT_PUBLIC_SITE_URL.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://stellardripz.vercel.app"),
  title: isTestnet
    ? "StellarDripz — Testnet XLM Faucet"
    : "StellarDripz — Stellar Wallet Interface",
  description: isTestnet
    ? "A lightweight, developer-focused web interface for requesting testnet XLM with a single click. Built for Stellar developers, hackathon participants, and QA testers."
    : "A web interface for sending payments, checking balances, and interacting with Soroban contracts on the Stellar network.",
  keywords: ["Stellar", "XLM", "Faucet", "Freighter", "Blockchain", "Soroban", networkLabel],
  authors: [{ name: "StellarDripz" }],
  openGraph: {
    title: isTestnet
      ? "StellarDripz — Testnet XLM Faucet"
      : "StellarDripz — Stellar Wallet Interface",
    description: isTestnet
      ? "Request testnet XLM with a single click. Built for Stellar developers."
      : "Send payments, check balances, and interact with Soroban contracts on the Stellar network.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-surface-950 bg-grid font-sans">
        <AppProvider>
          <Header />
          <ErrorBoundary>
            <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
          </ErrorBoundary>
          <ToastContainer />
          <footer className="border-t border-white/5 py-6 text-center">
            <p className="text-xs text-white/20">
              {isTestnet
                ? "StellarDripz — Powered by Stellar Testnet & Friendbot. Not for production use."
                : `StellarDripz — Stellar ${networkLabel} interface.`}
            </p>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
