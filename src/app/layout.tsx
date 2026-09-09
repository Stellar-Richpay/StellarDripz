import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import Header from "@/components/Header";
import ToastContainer from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://stellardripz.vercel.app";
const pageTitle = isTestnet
  ? "StellarDripz — Testnet XLM Faucet"
  : "StellarDripz — Stellar Wallet Interface";
const pageDescription = isTestnet
  ? "A lightweight, developer-focused web interface for requesting testnet XLM with a single click. Built for Stellar developers, hackathon participants, and QA testers."
  : "A web interface for sending payments, checking balances, and interacting with Soroban contracts on the Stellar network.";

export const metadata: Metadata = {
  // Absolute base for Open Graph URLs and metadata routes (robots.txt uses
  // it to emit canonical URLs). Deployment can override with NEXT_PUBLIC_SITE_URL.
  metadataBase: new URL(siteUrl),
  title: pageTitle,
  description: pageDescription,
  keywords: ["Stellar", "XLM", "Faucet", "Freighter", "Blockchain", "Soroban", networkLabel],
  authors: [{ name: "StellarDripz" }],
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    type: "website",
    url: siteUrl,
    siteName: "StellarDripz",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: pageTitle,
    description: pageDescription,
  },
};

// Mobile browser chrome: the app is a dark themed dApp, so the address bar
// should match the surface-950 background instead of flashing white.
export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      {/* Apply the stored/system theme before first paint so a light-mode
          visitor never sees a dark flash (see src/lib/theme.ts). */}
      <Script
        id="theme-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
      />
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
