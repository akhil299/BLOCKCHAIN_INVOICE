import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, setToken } from "../lib/api";
import { contractsFor, friendlyError, fromUnits, hasWallet, provider, switchNetwork } from "../lib/chain";
import { chainName } from "../lib/constants";
import { ToastProvider, useToast } from "./Toasts";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const explorer = config && config.requiredChainId === 11155111 ? config.explorerTxUrl : null;
  return (
    <ToastProvider explorerTxUrl={explorer}>
      <Inner config={config} setConfig={setConfig} configError={configError} setConfigError={setConfigError}>{children}</Inner>
    </ToastProvider>
  );
}

function Inner({ children, config, setConfig, configError, setConfigError }) {
  const toast = useToast();
  const [wallet, setWallet] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState("boot"); // boot | idle | connecting | signing | ready | needs-role
  const [balances, setBalances] = useState({ eth: null, tusd: null });
  const walletRef = useRef(null);
  walletRef.current = wallet;

  const loadConfig = useCallback(async () => {
    try { setConfig(await api("/chain/config")); setConfigError(null); }
    catch (e) { setConfigError(e.message); }
  }, [setConfig, setConfigError]);

  const refreshBalances = useCallback(async () => {
    if (!config?.chain?.connected || !walletRef.current || !hasWallet()) return;
    try {
      const p = provider();
      const c = contractsFor(p, config.chain.contracts);
      const [eth, usd] = await Promise.all([p.getBalance(walletRef.current), c.usd.balanceOf(walletRef.current)]);
      setBalances({ eth: Number(eth) / 1e18, tusd: fromUnits(usd) });
    } catch { /* wrong network etc. */ }
  }, [config]);

  const refreshUser = useCallback(async () => {
    const me = await api("/auth/me");
    setUser(me.user);
    setPhase(me.user ? "ready" : "needs-role");
    return me.user;
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); setPhase(walletRef.current ? "idle" : "idle"); }, []);

  const signIn = useCallback(async (address) => {
    setPhase("signing");
    const { message } = await api("/auth/nonce", { method: "POST", body: { address } });
    const signer = await provider().getSigner();
    const signature = await signer.signMessage(message);
    const res = await api("/auth/login", { method: "POST", body: { address, signature } });
    setToken(res.token);
    setUser(res.user);
    setPhase(res.user ? "ready" : "needs-role");
    return res.user;
  }, []);

  const connect = useCallback(async () => {
    if (!hasWallet()) { toast.push({ tone: "error", title: "MetaMask not found", body: "Install the MetaMask browser extension, then reload this page." }); return; }
    try {
      setPhase("connecting");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const addr = accounts[0].toLowerCase();
      setWallet(addr);
      walletRef.current = addr;
      setChainId(Number(await window.ethereum.request({ method: "eth_chainId" })));
      const tok = getToken();
      if (tok) {
        try {
          const me = await api("/auth/me");
          if (me.wallet === addr) { setUser(me.user); setPhase(me.user ? "ready" : "needs-role"); return; }
        } catch { /* expired -> sign again */ }
      }
      await signIn(addr);
    } catch (e) {
      setPhase("idle");
      toast.push({ tone: "error", title: "Could not sign in", body: friendlyError(e) });
    }
  }, [signIn, toast]);

  // boot: config + silent session restore
  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => {
    (async () => {
      if (!hasWallet()) { setPhase("idle"); return; }
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        setChainId(Number(await window.ethereum.request({ method: "eth_chainId" })));
        if (accounts[0] && getToken()) {
          const addr = accounts[0].toLowerCase();
          setWallet(addr);
          const me = await api("/auth/me");
          if (me.wallet === addr) { setUser(me.user); setPhase(me.user ? "ready" : "needs-role"); return; }
        }
      } catch { setToken(null); }
      setPhase("idle");
    })();
  }, []);

  useEffect(() => {
    if (!hasWallet()) return;
    const onAccounts = (accs) => { setToken(null); setUser(null); setBalances({ eth: null, tusd: null }); setWallet(accs[0]?.toLowerCase() || null); setPhase("idle"); };
    const onChain = (hex) => setChainId(Number(hex));
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => { window.ethereum.removeListener?.("accountsChanged", onAccounts); window.ethereum.removeListener?.("chainChanged", onChain); };
  }, []);

  useEffect(() => { refreshBalances(); }, [refreshBalances, wallet, chainId, phase]);

  const requiredChain = config?.requiredChainId;
  const wrongNetwork = Boolean(wallet && requiredChain && chainId && chainId !== requiredChain);

  const fixNetwork = useCallback(async () => {
    try { await switchNetwork(requiredChain); } catch (e) { toast.push({ tone: "error", title: "Could not switch network", body: friendlyError(e) }); }
  }, [requiredChain, toast]);

  /** Sends one on-chain action through the user's wallet, then asks the backend to re-read the chain. */
  const runTx = useCallback(async ({ title, send, sync = true, success }) => {
    if (!config?.chain?.connected) { toast.push({ tone: "error", title: "Blockchain unavailable", body: config?.chain?.error || "The backend cannot reach the blockchain." }); return null; }
    const id = toast.push({ tone: "info", title, body: "Confirm the transaction in your wallet…", sticky: true });
    try {
      const p = provider();
      const net = Number((await p.getNetwork()).chainId);
      if (net !== requiredChain) {
        toast.update(id, { body: `Switching your wallet to ${chainName(requiredChain)}…`, sticky: true });
        await switchNetwork(requiredChain);
      }
      const signer = await provider().getSigner();
      const tx = await send(contractsFor(signer, config.chain.contracts), signer, (msg) => toast.update(id, { body: msg, sticky: true }));
      toast.update(id, { body: "Transaction sent. Waiting for confirmation…", hash: tx.hash, sticky: true });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("The transaction failed on-chain.");
      if (sync) {
        toast.update(id, { body: "Confirmed. Updating InvoChain records…", sticky: true });
        let res = null;
        for (let i = 0; i < 6; i++) {
          try { res = await api("/chain/confirm", { method: "POST", body: { tx_hash: tx.hash } }); if (!res.pending) break; } catch (e) { if (i === 5) throw e; }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      toast.update(id, { tone: "success", title: `${title}: done`, body: success || "Confirmed on the blockchain.", hash: tx.hash, sticky: false });
      refreshBalances();
      return tx.hash;
    } catch (e) {
      toast.update(id, { tone: "error", title: `${title}: not completed`, body: friendlyError(e), hash: undefined, sticky: false });
      return null;
    }
  }, [config, requiredChain, toast, refreshBalances]);

  const value = useMemo(() => ({
    config, configError, reloadConfig: loadConfig, wallet, chainId, user, phase, balances, wrongNetwork, requiredChain,
    connect, logout, refreshUser, refreshBalances, fixNetwork, runTx, setUser, signIn,
  }), [config, configError, loadConfig, wallet, chainId, user, phase, balances, wrongNetwork, requiredChain, connect, logout, refreshUser, refreshBalances, fixNetwork, runTx, signIn]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
