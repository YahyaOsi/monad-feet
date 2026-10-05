/*
 * TEST ONLY. Inject before navigation with page.addInitScript({ path: ... }).
 * Fixture identity has NO private key. All signatures are deliberately invalid
 * fixtures and must only be used with browser-mocked auth endpoints.
 * Never use this script with a real API or real funds.
 */
(() => {
  const ADDRESS = "0x1111111111111111111111111111111111111111";
  const SIGNATURE = `0x${"00".repeat(64)}1b`;
  const rpcError = (method) => Object.assign(new Error(`Isolated test wallet: ${method} is not allowed`), { code: 4001 });
  const listeners = new Map();
  let connected = false;
  let chainId = "0x8f";
  const emit = (event, value) => {
    for (const fn of listeners.get(event) || []) fn(value);
  };
  const provider = {
    isMetaMask: true,
    isConnected: () => connected,
    selectedAddress: null,
    get chainId() { return chainId; },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return this;
    },
    addListener(event, fn) { return this.on(event, fn); },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); return this; },
    off(event, fn) { return this.removeListener(event, fn); },
    once(event, fn) {
      const wrap = (...args) => { this.removeListener(event, wrap); fn(...args); };
      return this.on(event, wrap);
    },
    async request({ method, params = [] }) {
      switch (method) {
        case "eth_chainId": return chainId;
        case "net_version": return "143";
        case "eth_accounts": return connected ? [ADDRESS] : [];
        case "eth_requestAccounts":
        case "wallet_requestPermissions":
          if (!connected) {
            connected = true;
            this.selectedAddress = ADDRESS;
            emit("connect", { chainId });
            emit("accountsChanged", [ADDRESS]);
          }
          return method === "wallet_requestPermissions"
            ? [{ parentCapability: "eth_accounts", caveats: [] }] : [ADDRESS];
        case "wallet_getPermissions":
          return connected ? [{ parentCapability: "eth_accounts", caveats: [] }] : [];
        case "wallet_revokePermissions":
          connected = false;
          this.selectedAddress = null;
          emit("accountsChanged", []);
          emit("disconnect", { code: 4900, message: "Test wallet disconnected" });
          return null;
        case "wallet_switchEthereumChain":
          if (params[0]?.chainId !== "0x8f") throw rpcError(method);
          chainId = "0x8f";
          emit("chainChanged", chainId);
          return null;
        case "wallet_addEthereumChain":
          if (params[0]?.chainId !== "0x8f") throw rpcError(method);
          return null;
        case "personal_sign":
        case "eth_sign":
          if (!connected || !params.some(p => String(p).toLowerCase() === ADDRESS.toLowerCase()))
            throw rpcError(method);
          return SIGNATURE;
        case "eth_signTypedData_v4":
          if (!connected || String(params[0]).toLowerCase() !== ADDRESS.toLowerCase())
            throw rpcError(method);
          return SIGNATURE;
        case "eth_sendTransaction":
        case "eth_sendRawTransaction":
        case "wallet_sendCalls":
          throw rpcError(method); // Never sign/broadcast any transaction.
        default:
          throw rpcError(method);
      }
    },
    send(method, params) {
      if (typeof method === "string") return this.request({ method, params });
      return this.request(method);
    },
    sendAsync(payload, callback) {
      this.request(payload).then(
        result => callback(null, { jsonrpc: "2.0", id: payload.id, result }),
        error => callback(error)
      );
    },
    enable() { return this.request({ method: "eth_requestAccounts" }); },
  };
  Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
  // RainbowKit/wagmi discovers injected wallets through EIP-6963, not just window.ethereum.
  const info = Object.freeze({
    uuid: "b8a6a108-aec4-4b0e-83c7-74822b314106",
    name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    rdns: "io.metamask",
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: Object.freeze({ info, provider }),
  }));
  window.addEventListener("eip6963:requestProvider", announce);
  queueMicrotask(announce);

  // viem's HTTP transport points directly to rpc.monad.xyz. Reject it in-page
  // even if a tester forgets to register Playwright network blocking.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, location.href).hostname === "rpc.monad.xyz") {
      const payload = JSON.parse(args[1]?.body || (input instanceof Request ? await input.clone().text() : "{}"));
      const reply = item => ({
        jsonrpc: "2.0", id: item.id,
        ...(item.method === "eth_chainId" ? { result: "0x8f" }
          : item.method === "eth_blockNumber" ? { result: "0x1" }
          : { error: { code: -32000, message: `Isolated test RPC refuses ${item.method}; no real chain reads or writes` } }),
      });
      return new Response(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return realFetch(...args);
  };
  // Presence reconnects forever if closed. Keep a harmless open /api/ws stub.
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class TestWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      super();
      const target = new URL(url, location.href);
      if (target.pathname !== "/api/ws") throw new Error(`Isolated test blocks WebSocket ${target.href}`);
      this.url = target.href;
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send() {}
    close() {
      this.readyState = 3;
      this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
    }
  };
  // Deliberately expose only non-sensitive fixture metadata to test assertions.
  Object.defineProperty(window, "__MF_TEST_WALLET__", { value: Object.freeze({ address: ADDRESS, provider }) });
})();