// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {InvoiceTypes} from "./InvoiceTypes.sol";
import {InvoiceToken} from "./InvoiceToken.sol";

/// @title InvoiceRegistry
/// @notice Core InvoChain contract: invoice registration, buyer verification, duplicate and
///         double-financing prevention, simulated financing with an ERC-20 test token,
///         repayment and settlement.
///
/// Design rules
///  * AI risk output is ADVISORY. The OPERATOR (backend) may only record a risk tier/report hash
///    or flag an invoice; it can never verify, finance or repay. Contract rules decide what a tier means.
///  * Only the invoice's buyer can verify/reject it. Only the supplier can request financing.
///    Only a FINANCIER_ROLE holder can fund. Double financing is impossible: funding is a single
///    atomic FINANCING_REQUESTED -> FINANCED transition guarded by nonReentrant.
///  * Duplicate prevention: one live invoice per document hash and per (supplier, buyer, numberHash).
contract InvoiceRegistry is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using InvoiceTypes for InvoiceTypes.Status;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SUPPLIER_ROLE = keccak256("SUPPLIER_ROLE");
    bytes32 public constant FINANCIER_ROLE = keccak256("FINANCIER_ROLE");

    uint16 public constant MIN_ADVANCE_BPS = 1_000; // 10%
    uint16 public constant MAX_ADVANCE_BPS = 9_500; // 95%
    uint256 public constant MAX_AMOUNT = 1e18;

    IERC20 public immutable paymentToken;
    InvoiceToken public immutable invoiceToken;

    uint256 public invoiceCount;
    mapping(uint256 => InvoiceTypes.Invoice) private _invoices;
    /// docHash / refKey -> invoiceId of the LIVE invoice holding that key (0 = free)
    mapping(bytes32 => uint256) public docHashToId;
    mapping(bytes32 => uint256) public refKeyToId;

    // ---------------------------------------------------------------- events
    event InvoiceRegistered(uint256 indexed invoiceId, address indexed supplier, address indexed buyer, uint256 amount, bytes32 docHash, string cid);
    event InvoiceSubmitted(uint256 indexed invoiceId);
    event RiskAssessmentRecorded(uint256 indexed invoiceId, InvoiceTypes.RiskTier tier, bytes32 reportHash);
    event ExtraVerificationConfirmed(uint256 indexed invoiceId, address indexed by);
    event InvoiceFlagged(uint256 indexed invoiceId, address indexed by, bytes32 reasonHash);
    event FlagCleared(uint256 indexed invoiceId, address indexed by, InvoiceTypes.RiskTier newTier);
    event InvoiceVerified(uint256 indexed invoiceId, address indexed buyer, uint256 tokenId);
    event InvoiceRejected(uint256 indexed invoiceId, address indexed buyer, bytes32 reasonHash);
    event InvoiceCancelled(uint256 indexed invoiceId, address indexed supplier);
    event FinancingRequested(uint256 indexed invoiceId, address indexed supplier, uint16 advanceBps, uint256 advanceAmount);
    event FinancingCancelled(uint256 indexed invoiceId, address indexed supplier);
    event FinancingApproved(uint256 indexed invoiceId, address indexed financier, uint256 advanceAmount, uint256 repayAmount);
    event RepaymentRecorded(uint256 indexed invoiceId, address indexed payer, uint256 amount, uint256 totalRepaid);
    event InvoiceRepaid(uint256 indexed invoiceId);
    event InvoiceSettled(uint256 indexed invoiceId, address indexed by);

    // ---------------------------------------------------------------- errors
    error InvalidInput(string reason);
    error DuplicateInvoice(uint256 existingInvoiceId);
    error InvoiceNotFound();
    error WrongStatus(InvoiceTypes.Status current);
    error NotBuyer();
    error NotSupplier();
    error NotFinancier();
    error NotEligible(string reason);

    constructor(address admin, IERC20 paymentToken_, InvoiceToken invoiceToken_) {
        if (admin == address(0) || address(paymentToken_) == address(0) || address(invoiceToken_) == address(0)) {
            revert InvalidInput("ZERO_ADDRESS");
        }
        paymentToken = paymentToken_;
        invoiceToken = invoiceToken_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        // The operator (backend wallet) can sync supplier/financier roles after off-chain approval.
        _setRoleAdmin(SUPPLIER_ROLE, OPERATOR_ROLE);
        _setRoleAdmin(FINANCIER_ROLE, OPERATOR_ROLE);
    }

    // ---------------------------------------------------------------- helpers
    modifier exists(uint256 id) {
        if (id == 0 || id > invoiceCount) revert InvoiceNotFound();
        _;
    }

    function _inv(uint256 id) private view returns (InvoiceTypes.Invoice storage inv) {
        inv = _invoices[id];
    }

    function _requireStatus(InvoiceTypes.Invoice storage inv, InvoiceTypes.Status expected) private view {
        if (inv.status != expected) revert WrongStatus(inv.status);
    }

    function _releaseKeys(InvoiceTypes.Invoice storage inv) private {
        if (docHashToId[inv.docHash] == inv.id) delete docHashToId[inv.docHash];
        if (refKeyToId[inv.refKey] == inv.id) delete refKeyToId[inv.refKey];
    }

    function computeRefKey(address supplier, address buyer, bytes32 numberHash) public pure returns (bytes32) {
        return keccak256(abi.encode(supplier, buyer, numberHash));
    }

    // ---------------------------------------------------------------- views
    /// @notice Returns whether a document hash or (supplier,buyer,number) pair is already registered.
    function checkDuplicate(bytes32 docHash, address supplier, address buyer, bytes32 numberHash)
        public
        view
        returns (bool isDuplicate, uint256 existingInvoiceId)
    {
        uint256 a = docHashToId[docHash];
        if (a != 0) return (true, a);
        uint256 b = refKeyToId[computeRefKey(supplier, buyer, numberHash)];
        if (b != 0) return (true, b);
        return (false, 0);
    }

    function getInvoiceDetails(uint256 invoiceId) external view exists(invoiceId) returns (InvoiceTypes.Invoice memory) {
        return _invoices[invoiceId];
    }

    function getInvoiceStatus(uint256 invoiceId) external view exists(invoiceId) returns (InvoiceTypes.Status) {
        return _invoices[invoiceId].status;
    }

    function isOverdue(uint256 invoiceId) external view exists(invoiceId) returns (bool) {
        InvoiceTypes.Invoice storage inv = _invoices[invoiceId];
        return inv.status == InvoiceTypes.Status.FINANCED && block.timestamp > inv.dueDate;
    }

    function advanceFor(uint256 amount, uint16 advanceBps) public pure returns (uint256) {
        return (amount * advanceBps) / 10_000;
    }

    // ---------------------------------------------------------------- supplier flow
    /// @notice Register an invoice. Stores only hashes and the CID of the ENCRYPTED document.
    /// @param numberHash keccak256 of the normalised invoice number (computed off-chain).
    function registerInvoice(
        address buyer,
        uint256 amount,
        uint64 invoiceDate,
        uint64 dueDate,
        bytes32 docHash,
        bytes32 numberHash,
        string calldata cid
    ) external whenNotPaused onlyRole(SUPPLIER_ROLE) returns (uint256 invoiceId) {
        if (buyer == address(0) || buyer == msg.sender) revert InvalidInput("BAD_BUYER");
        if (amount == 0 || amount > MAX_AMOUNT) revert InvalidInput("BAD_AMOUNT");
        if (docHash == bytes32(0) || numberHash == bytes32(0)) revert InvalidInput("EMPTY_HASH");
        if (bytes(cid).length == 0 || bytes(cid).length > 128) revert InvalidInput("BAD_CID");
        if (dueDate <= invoiceDate) revert InvalidInput("DUE_BEFORE_INVOICE");
        if (dueDate <= block.timestamp) revert InvalidInput("DUE_IN_PAST");
        if (invoiceDate > block.timestamp + 1 days) revert InvalidInput("INVOICE_DATE_IN_FUTURE");

        bytes32 refKey = computeRefKey(msg.sender, buyer, numberHash);
        (bool dup, uint256 existing) = checkDuplicate(docHash, msg.sender, buyer, numberHash);
        if (dup) revert DuplicateInvoice(existing);

        invoiceId = ++invoiceCount;
        InvoiceTypes.Invoice storage inv = _invoices[invoiceId];
        inv.id = invoiceId;
        inv.supplier = msg.sender;
        inv.buyer = buyer;
        inv.amount = amount;
        inv.invoiceDate = invoiceDate;
        inv.dueDate = dueDate;
        inv.docHash = docHash;
        inv.refKey = refKey;
        inv.cid = cid;
        inv.status = InvoiceTypes.Status.CREATED;

        docHashToId[docHash] = invoiceId;
        refKeyToId[refKey] = invoiceId;

        emit InvoiceRegistered(invoiceId, msg.sender, buyer, amount, docHash, cid);
    }

    /// @notice Supplier submits a CREATED invoice for buyer verification.
    function submitForVerification(uint256 invoiceId) external whenNotPaused exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.supplier) revert NotSupplier();
        _requireStatus(inv, InvoiceTypes.Status.CREATED);
        // Workflow guarantee: the AI risk assessment must be anchored before a buyer is asked to verify.
        if (inv.risk == InvoiceTypes.RiskTier.UNASSESSED) revert NotEligible("RISK_NOT_ASSESSED");
        inv.status = InvoiceTypes.Status.PENDING_VERIFICATION;
        emit InvoiceSubmitted(invoiceId);
    }

    /// @notice Supplier abandons an invoice that has not been financed. Frees its duplicate keys.
    function cancelInvoice(uint256 invoiceId) external exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.supplier) revert NotSupplier();
        InvoiceTypes.Status s = inv.status;
        if (
            s != InvoiceTypes.Status.CREATED && s != InvoiceTypes.Status.PENDING_VERIFICATION
                && s != InvoiceTypes.Status.VERIFIED
        ) revert WrongStatus(s);
        inv.status = InvoiceTypes.Status.CANCELLED;
        _releaseKeys(inv);
        if (s == InvoiceTypes.Status.VERIFIED) invoiceToken.burn(invoiceId);
        emit InvoiceCancelled(invoiceId, msg.sender);
    }

    // ---------------------------------------------------------------- AI risk (advisory, operator only)
    /// @notice Record the AI risk tier and a hash of the explainable report.
    ///         HIGH tier holds the invoice in FLAGGED for manual admin review.
    function setRiskAssessment(uint256 invoiceId, InvoiceTypes.RiskTier tier, bytes32 reportHash)
        external
        onlyRole(OPERATOR_ROLE)
        exists(invoiceId)
    {
        if (tier == InvoiceTypes.RiskTier.UNASSESSED) revert InvalidInput("BAD_TIER");
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (inv.status != InvoiceTypes.Status.CREATED && inv.status != InvoiceTypes.Status.PENDING_VERIFICATION) {
            revert WrongStatus(inv.status);
        }
        inv.risk = tier;
        inv.riskReportHash = reportHash;
        inv.extraVerified = false;
        emit RiskAssessmentRecorded(invoiceId, tier, reportHash);
        if (tier == InvoiceTypes.RiskTier.HIGH) {
            inv.statusBeforeFlag = inv.status;
            inv.status = InvoiceTypes.Status.FLAGGED;
            emit InvoiceFlagged(invoiceId, msg.sender, reportHash);
        }
    }

    /// @notice Operator confirms the additional (manual) verification demanded for MEDIUM risk.
    function confirmExtraVerification(uint256 invoiceId) external onlyRole(OPERATOR_ROLE) exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (inv.risk != InvoiceTypes.RiskTier.MEDIUM) revert InvalidInput("NOT_MEDIUM_RISK");
        inv.extraVerified = true;
        emit ExtraVerificationConfirmed(invoiceId, msg.sender);
    }

    /// @notice Operator flags an invoice for manual review (before it is financed).
    function flagInvoice(uint256 invoiceId, bytes32 reasonHash) external onlyRole(OPERATOR_ROLE) exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        InvoiceTypes.Status s = inv.status;
        if (
            s != InvoiceTypes.Status.CREATED && s != InvoiceTypes.Status.PENDING_VERIFICATION
                && s != InvoiceTypes.Status.VERIFIED
        ) revert WrongStatus(s);
        inv.statusBeforeFlag = s;
        inv.status = InvoiceTypes.Status.FLAGGED;
        if (s == InvoiceTypes.Status.VERIFIED) invoiceToken.setLocked(invoiceId, true);
        emit InvoiceFlagged(invoiceId, msg.sender, reasonHash);
    }

    /// @notice ADMIN only: clear a flag after manual review. The tier must be lowered below HIGH.
    function clearFlag(uint256 invoiceId, InvoiceTypes.RiskTier newTier)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        exists(invoiceId)
    {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        _requireStatus(inv, InvoiceTypes.Status.FLAGGED);
        if (newTier == InvoiceTypes.RiskTier.HIGH || newTier == InvoiceTypes.RiskTier.UNASSESSED) {
            revert InvalidInput("TIER_MUST_BE_LOW_OR_MEDIUM");
        }
        InvoiceTypes.Status prev = inv.statusBeforeFlag;
        inv.status = prev;
        inv.risk = newTier;
        inv.extraVerified = false;
        if (prev == InvoiceTypes.Status.VERIFIED) invoiceToken.setLocked(invoiceId, false);
        emit FlagCleared(invoiceId, msg.sender, newTier);
    }

    // ---------------------------------------------------------------- buyer flow
    /// @notice The named buyer confirms the invoice is genuine. Mints the ERC-721 receipt to the supplier.
    function verifyInvoice(uint256 invoiceId) external whenNotPaused exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.buyer) revert NotBuyer();
        _requireStatus(inv, InvoiceTypes.Status.PENDING_VERIFICATION);
        inv.status = InvoiceTypes.Status.VERIFIED;
        invoiceToken.mint(inv.supplier, invoiceId);
        emit InvoiceVerified(invoiceId, msg.sender, invoiceId);
    }

    /// @notice The named buyer rejects the invoice. Frees its duplicate keys so a corrected invoice can be re-registered.
    function rejectInvoice(uint256 invoiceId, bytes32 reasonHash) external whenNotPaused exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.buyer) revert NotBuyer();
        _requireStatus(inv, InvoiceTypes.Status.PENDING_VERIFICATION);
        inv.status = InvoiceTypes.Status.REJECTED;
        _releaseKeys(inv);
        emit InvoiceRejected(invoiceId, msg.sender, reasonHash);
    }

    // ---------------------------------------------------------------- financing
    /// @notice Supplier asks to be financed. Enforces the AI-tier rules that the contract (not the AI) owns:
    ///         HIGH never reaches VERIFIED (it is FLAGGED); MEDIUM needs extraVerified.
    function requestFinancing(uint256 invoiceId, uint16 advanceBps) external whenNotPaused exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.supplier) revert NotSupplier();
        _requireStatus(inv, InvoiceTypes.Status.VERIFIED);
        if (advanceBps < MIN_ADVANCE_BPS || advanceBps > MAX_ADVANCE_BPS) revert InvalidInput("BAD_ADVANCE_BPS");
        if (inv.risk == InvoiceTypes.RiskTier.HIGH) revert NotEligible("HIGH_RISK");
        if (inv.risk == InvoiceTypes.RiskTier.MEDIUM && !inv.extraVerified) revert NotEligible("MEDIUM_RISK_NEEDS_EXTRA_VERIFICATION");
        if (inv.dueDate <= block.timestamp) revert NotEligible("INVOICE_PAST_DUE");
        if (invoiceToken.ownerOf(invoiceId) != msg.sender) revert NotEligible("TOKEN_NOT_HELD_BY_SUPPLIER");

        inv.advanceBps = advanceBps;
        inv.status = InvoiceTypes.Status.FINANCING_REQUESTED;
        invoiceToken.setLocked(invoiceId, true);
        emit FinancingRequested(invoiceId, msg.sender, advanceBps, advanceFor(inv.amount, advanceBps));
    }

    function cancelFinancingRequest(uint256 invoiceId) external exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.supplier) revert NotSupplier();
        _requireStatus(inv, InvoiceTypes.Status.FINANCING_REQUESTED);
        inv.status = InvoiceTypes.Status.VERIFIED;
        inv.advanceBps = 0;
        invoiceToken.setLocked(invoiceId, false);
        emit FinancingCancelled(invoiceId, msg.sender);
    }

    /// @notice A financier funds the request. The financier must first approve this contract
    ///         to spend `advance` tUSD. State is updated BEFORE the transfer (checks-effects-interactions)
    ///         and the function is nonReentrant, so the same invoice can never be financed twice.
    function approveFinancing(uint256 invoiceId) external whenNotPaused nonReentrant onlyRole(FINANCIER_ROLE) exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        _requireStatus(inv, InvoiceTypes.Status.FINANCING_REQUESTED);
        if (msg.sender == inv.supplier || msg.sender == inv.buyer) revert InvalidInput("CONFLICT_OF_INTEREST");
        if (inv.dueDate <= block.timestamp) revert NotEligible("INVOICE_PAST_DUE");

        uint256 advance = advanceFor(inv.amount, inv.advanceBps);
        inv.status = InvoiceTypes.Status.FINANCED;
        inv.financier = msg.sender;
        inv.financedAmount = advance;
        inv.repayAmount = inv.amount;
        inv.financedAt = uint64(block.timestamp);

        paymentToken.safeTransferFrom(msg.sender, inv.supplier, advance);
        emit FinancingApproved(invoiceId, msg.sender, advance, inv.amount);
    }

    // ---------------------------------------------------------------- repayment & settlement
    /// @notice Buyer (or supplier, as recourse) repays the financier. Partial repayments accumulate.
    ///         Reaching the full amount moves the invoice to REPAID.
    function recordRepayment(uint256 invoiceId, uint256 amount) external whenNotPaused nonReentrant exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.buyer && msg.sender != inv.supplier) revert InvalidInput("NOT_PARTY_TO_INVOICE");
        _requireStatus(inv, InvoiceTypes.Status.FINANCED);
        if (amount == 0) revert InvalidInput("ZERO_AMOUNT");
        uint256 outstanding = inv.repayAmount - inv.repaidAmount;
        if (amount > outstanding) revert InvalidInput("EXCEEDS_OUTSTANDING");

        inv.repaidAmount += amount;
        bool full = inv.repaidAmount == inv.repayAmount;
        if (full) {
            inv.status = InvoiceTypes.Status.REPAID;
            inv.repaidAt = uint64(block.timestamp);
        }

        paymentToken.safeTransferFrom(msg.sender, inv.financier, amount);
        emit RepaymentRecorded(invoiceId, msg.sender, amount, inv.repaidAmount);
        if (full) emit InvoiceRepaid(invoiceId);
    }

    /// @notice The financier (or an operator) confirms settlement. Closes the invoice and burns its token.
    function markAsPaid(uint256 invoiceId) external whenNotPaused exists(invoiceId) {
        InvoiceTypes.Invoice storage inv = _inv(invoiceId);
        if (msg.sender != inv.financier && !hasRole(OPERATOR_ROLE, msg.sender)) revert NotFinancier();
        _requireStatus(inv, InvoiceTypes.Status.REPAID);
        inv.status = InvoiceTypes.Status.CLOSED;
        invoiceToken.burn(invoiceId);
        emit InvoiceSettled(invoiceId, msg.sender);
    }

    // ---------------------------------------------------------------- admin
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
