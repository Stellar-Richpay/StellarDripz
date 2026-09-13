# StellarDripz — product pitch transcript

Voice-over narration for `public/video/stellardripz-pitch.mp4` (the same
text lives in [script.json](./script.json)).

## The Problem

_[00:00]_ Every developer building on Stellar hits the same wall. Funding a testnet account, juggling five wallets, deploying contracts, and no visibility into what those contracts are actually doing.

## The Solution

_[00:14]_ Meet StellarDripz: a production grade Stellar dApp that collapses all of that into one platform. Live today on Vercel, with five Soroban smart contracts already deployed to testnet.

## Multi-Wallet Faucet

_[00:28]_ Connect any supported wallet. Freighter, xBull, Albedo, LOBSTR or WalletConnect. One click of the faucet sends ten thousand testnet XLM through Friendbot, with per address rate limiting and a cooldown so the endpoint can't be drained.

## Payments + History

_[00:46]_ From there, send payments to any Stellar address. The app builds the transaction server side, signs it in your wallet, submits it, and streams the result into your history with a direct link to the block explorer.

## Soroban Smart Contracts

_[01:00]_ This is where StellarDripz goes beyond a faucet. A guided contract wizard walks you through real Soroban flows. Mint DripToken, stake in DripPool, vote on governance, claim achievement badges. Every write is signed and submitted, and events stream back live.

## Hybrid Architecture

_[01:18]_ Under the hood, it's a hybrid architecture. Reads, balances, simulation and events, go straight from the browser to Horizon and Soroban RPC. Writes are proxied through Next.js API routes, where they're rate limited, validated and logged.

## Built To Last

_[01:36]_ Quality is enforced end to end. One hundred and nine Rust contract tests covering reward accounting and lock periods, three hundred and four frontend tests, strict TypeScript and end to end checks, all wired into continuous integration.

## Live On Vercel

_[01:52]_ And it's all live right now on Vercel, with a health endpoint that verifies Horizon, Soroban RPC and every contract ID before you ship.

## Get Started

_[02:03]_ StellarDripz. Everything you need to build, test and demo on Stellar, in one place. Open source, MIT licensed, and ready to deploy.
