/**
 * In-page wallet test double used by the capture harness.
 *
 * The demo runs in headless Chromium, which has no browser-extension wallet
 * installed. This script installs a faithful stand-in for the Freighter
 * content script: it answers the exact `FREIGHTER_EXTERNAL_MSG_REQUEST` /
 * `FREIGHTER_EXTERNAL_MSG_RESPONSE` message protocol that
 * `@stellar/freighter-api` speaks, and forwards transactions to the Node
 * side for signing (so the demo keypair never enters the page).
 *
 * Only wallet plumbing is simulated. Every read, faucet request, payment and
 * contract call the app makes is real, and every transaction lands on the
 * Stellar testnet.
 */

/**
 * Build the init script source. Playwright serialises this function into the
 * page before any app code runs, with the address and passphrase baked in.
 */
export function walletStubSource({ publicKey, networkPassphrase, network = "TESTNET" }) {
  return `(() => {
  const ADDRESS = ${JSON.stringify(publicKey)};
  const PASSPHRASE = ${JSON.stringify(networkPassphrase)};
  const NETWORK = ${JSON.stringify(network)};

  // isConnected() short-circuits on window.freighter (see freighter-api/src/isConnected.ts)
  window.freighter = true;

  const respond = (messageId, payload) => {
    window.postMessage(
      { source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId: messageId, ...payload },
      window.location.origin,
    );
  };

  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (!msg || msg.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;
    const id = msg.messageId;

    switch (msg.type) {
      case "REQUEST_ACCESS":
      case "REQUEST_PUBLIC_KEY":
        return respond(id, { publicKey: ADDRESS });
      case "REQUEST_NETWORK":
        return respond(id, { network: NETWORK, networkPassphrase: PASSPHRASE });
      case "REQUEST_CONNECTION_STATUS":
        return respond(id, { isConnected: true });
      case "REQUEST_ALLOWED_STATUS":
      case "SET_ALLOWED_STATUS":
        return respond(id, { isAllowed: true, allowList: [window.location.origin] });
      case "SUBMIT_TRANSACTION": {
        try {
          const signed = await window.__signXdr(msg.transactionXdr);
          return respond(id, { signedTransaction: signed, signerAddress: ADDRESS });
        } catch (err) {
          return respond(id, {
            error: { code: -1, message: String((err && err.message) || err) },
          });
        }
      }
      default:
        return respond(id, { error: { code: -1, message: "unsupported: " + msg.type } });
    }
  });

  // The app also guards on "freighterApi" in window for its installed check.
  window.freighterApi = { __captureStub: true, publicKey: ADDRESS };
})();`;
}
