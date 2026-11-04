import { BrowserProvider, Contract, Interface } from "ethers";
import registryAbi from "../contracts/abi/InvoiceRegistry.json";
import tokenAbi from "../contracts/abi/InvoiceToken.json";
import usdAbi from "../contracts/abi/TestUSD.json";
import { CHAINS } from "./constants";

export const hasWallet = () => typeof window !== "undefined" && !!window.ethereum;
export const toUnits = (n) => BigInt(Math.round(Number(n) * 1e6));
export const fromUnits = (u) => Number(u) / 1e6;

export function provider() {
  if (!hasWallet()) throw new Error("No wallet found. Install MetaMask to continue.");
  return new BrowserProvider(window.ethereum, "any");
}

export function contractsFor(runner, addresses) {
  return {
    registry: new Contract(addresses.InvoiceRegistry, registryAbi, runner),
    token: new Contract(addresses.InvoiceToken, tokenAbi, runner),
    usd: new Contract(addresses.TestUSD, usdAbi, runner),
  };
}

export async function switchNetwork(chainId) {
  const hex = "0x" + Number(chainId).toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if ((e.code === 4902 || e?.data?.originalError?.code === 4902) && CHAINS[chainId]) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CHAINS[chainId]] });
    } else throw e;
  }
}

const ifaces = [new Interface(registryAbi), new Interface(tokenAbi), new Interface(usdAbi)];
const STATUS_NAMES = ["NONE", "CREATED", "PENDING_VERIFICATION", "VERIFIED", "FINANCING_REQUESTED", "FINANCED", "REPAID", "CLOSED", "REJECTED", "FLAGGED", "CANCELLED"];
const ELIGIBILITY = {
  HIGH_RISK: "This invoice is high risk and held for manual review.",
  MEDIUM_RISK_NEEDS_EXTRA_VERIFICATION: "Medium-risk invoices need additional verification by an administrator first.",
  INVOICE_PAST_DUE: "The invoice is past its due date.",
  TOKEN_NOT_HELD_BY_SUPPLIER: "The invoice token must be in the supplier's wallet.",
  RISK_NOT_ASSESSED: "The AI risk assessment has not been recorded on-chain yet. Wait a few seconds and retry.",
};
const INPUT = {
  BAD_BUYER: "The buyer wallet is invalid.", BAD_AMOUNT: "The amount is invalid.", DUE_IN_PAST: "The due date is in the past.",
  DUE_BEFORE_INVOICE: "The due date must be after the invoice date.", BAD_ADVANCE_BPS: "Advance rate must be between 10% and 95%.",
  CONFLICT_OF_INTEREST: "A financier cannot fund an invoice they are a party to.", EXCEEDS_OUTSTANDING: "That is more than the outstanding balance.",
  NOT_PARTY_TO_INVOICE: "Only the buyer or the supplier can repay this invoice.", INVOICE_DATE_IN_FUTURE: "The invoice date is in the future.",
};

/** Turns wallet / contract errors into sentences a person can act on. */
export function friendlyError(err) {
  if (!err) return "Something went wrong.";
  if (err.code === "ACTION_REJECTED" || err.code === 4001 || /user rejected|user denied/i.test(err.message || "")) return "You cancelled the request in your wallet.";
  const data = err.data || err.error?.data || err.info?.error?.data;
  for (const i of ifaces) {
    try {
      const p = data && i.parseError(data);
      if (!p) continue;
      const a = p.args;
      switch (p.name) {
        case "DuplicateInvoice": return `Duplicate invoice: blockchain invoice #${a[0]} already uses this document or invoice number.`;
        case "WrongStatus": return `That action isn't allowed while the invoice is "${STATUS_NAMES[Number(a[0])]}".`;
        case "NotBuyer": return "Only the buyer named on this invoice can do this.";
        case "NotSupplier": return "Only the supplier of this invoice can do this.";
        case "NotFinancier": return "Only the financier of this invoice (or an operator) can do this.";
        case "NotEligible": return ELIGIBILITY[a[0]] || `Not eligible: ${a[0]}`;
        case "InvalidInput": return INPUT[a[0]] || `Invalid input: ${a[0]}`;
        case "AccessControlUnauthorizedAccount": return "Your wallet doesn't have the required role on the contract yet. If you just registered, wait a few seconds for it to sync.";
        case "EnforcedPause": return "The platform is paused by an administrator.";
        case "ERC20InsufficientBalance": return "Insufficient tUSD balance. Use the faucet in your profile to get test tokens.";
        case "ERC20InsufficientAllowance": return "tUSD allowance is too low. Approve the amount first.";
        case "FaucetCooldown": return "You already claimed test tokens recently. Try again in 24 hours.";
        case "TokenLocked": return "This invoice token is locked while financing is active.";
        default: return `Contract rejected the transaction (${p.name}).`;
      }
    } catch { /* try next interface */ }
  }
  if (/insufficient funds/i.test(err.message || "")) return "Not enough ETH for gas. Get free Sepolia ETH from a faucet.";
  return err.shortMessage || err.reason || (err.message || "Something went wrong.").slice(0, 200);
}
