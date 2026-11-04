// Visual + wording for every invoice status. Tones map to Tailwind classes in <StatusBadge>.
export const STATUS = {
  DRAFT: { label: "Draft", tone: "slate", hint: "Not on the blockchain yet" },
  CREATED: { label: "Registered", tone: "blue", hint: "Registered on-chain, waiting to be submitted" },
  PENDING_VERIFICATION: { label: "Awaiting buyer", tone: "amber", hint: "The buyer must confirm this invoice" },
  VERIFIED: { label: "Verified", tone: "teal", hint: "Confirmed by the buyer; token minted" },
  FINANCING_REQUESTED: { label: "Seeking funding", tone: "indigo", hint: "Listed in the financing marketplace" },
  FINANCED: { label: "Financed", tone: "green", hint: "A financier has funded this invoice" },
  REPAID: { label: "Repaid", tone: "green", hint: "Fully repaid, awaiting settlement" },
  CLOSED: { label: "Settled", tone: "slate", hint: "Settled and closed" },
  REJECTED: { label: "Rejected", tone: "red", hint: "Rejected by the buyer" },
  FLAGGED: { label: "Held for review", tone: "red", hint: "Held for manual review" },
  CANCELLED: { label: "Cancelled", tone: "slate", hint: "Cancelled by the supplier" },
};

// The happy path, in order. Used by the lifecycle rail.
export const LIFECYCLE = ["CREATED", "PENDING_VERIFICATION", "VERIFIED", "FINANCING_REQUESTED", "FINANCED", "REPAID", "CLOSED"];

export const TIER = {
  LOW: { label: "Low risk", color: "#12A150", soft: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  MEDIUM: { label: "Medium risk", color: "#D98E04", soft: "bg-amber-50 text-amber-700 ring-amber-200" },
  HIGH: { label: "High risk", color: "#D6455D", soft: "bg-rose-50 text-rose-700 ring-rose-200" },
};

export const ROLE_LABEL = { supplier: "Supplier", buyer: "Buyer", financier: "Financier", admin: "Administrator" };

export const EVENT_LABEL = {
  InvoiceRegistered: "Invoice registered", InvoiceSubmitted: "Submitted to buyer", RiskAssessmentRecorded: "AI risk anchored",
  InvoiceVerified: "Buyer verified", InvoiceRejected: "Buyer rejected", InvoiceFlagged: "Flagged for review", FlagCleared: "Flag cleared",
  ExtraVerificationConfirmed: "Extra verification", FinancingRequested: "Financing requested", FinancingCancelled: "Request cancelled",
  FinancingApproved: "Financing approved", RepaymentRecorded: "Repayment", InvoiceRepaid: "Repaid", InvoiceSettled: "Settled",
  InvoiceCancelled: "Cancelled", ERC20_APPROVE: "tUSD approval", TRANSACTION: "Transaction", GrantSUPPLIER_ROLE: "Supplier role granted", GrantFINANCIER_ROLE: "Financier role granted",
};

export const CHAINS = {
  11155111: { chainId: "0xaa36a7", chainName: "Sepolia", rpcUrls: ["https://rpc.sepolia.org"], nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://sepolia.etherscan.io"] },
  31337: { chainId: "0x7a69", chainName: "Hardhat Local", rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 } },
};
export const chainName = (id) => CHAINS[id]?.chainName || `Chain ${id}`;
