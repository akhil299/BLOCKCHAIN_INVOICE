// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title InvoiceTypes
/// @notice Shared enums and structs for the InvoChain contracts.
library InvoiceTypes {
    /// Lifecycle of an invoice. CREATED -> PENDING_VERIFICATION -> VERIFIED ->
    /// FINANCING_REQUESTED -> FINANCED -> REPAID -> CLOSED. REJECTED, FLAGGED and
    /// CANCELLED are side states.
    enum Status {
        NONE,
        CREATED,
        PENDING_VERIFICATION,
        VERIFIED,
        FINANCING_REQUESTED,
        FINANCED,
        REPAID,
        CLOSED,
        REJECTED,
        FLAGGED,
        CANCELLED
    }

    /// Advisory AI risk tier. NEVER overrides contract rules; the contract only
    /// uses it as an input to static eligibility rules.
    enum RiskTier {
        UNASSESSED,
        LOW,
        MEDIUM,
        HIGH
    }

    struct Invoice {
        uint256 id;
        address supplier;
        address buyer;
        uint256 amount;          // face value, in payment-token base units
        uint64 invoiceDate;
        uint64 dueDate;
        bytes32 docHash;         // sha256/keccak of the (plaintext) invoice document
        bytes32 refKey;          // keccak(supplier, buyer, numberHash)
        string cid;              // IPFS CID of the ENCRYPTED document
        Status status;
        Status statusBeforeFlag;
        RiskTier risk;
        bool extraVerified;      // medium-risk invoices need this before financing
        bytes32 riskReportHash;  // hash of the off-chain AI explanation report
        uint16 advanceBps;       // advance rate requested by the supplier
        address financier;
        uint256 financedAmount;  // advance actually paid to the supplier
        uint256 repayAmount;     // amount owed to the financier (= face value)
        uint256 repaidAmount;
        uint64 financedAt;
        uint64 repaidAt;
    }

    function statusName(Status s) internal pure returns (string memory) {
        if (s == Status.CREATED) return "CREATED";
        if (s == Status.PENDING_VERIFICATION) return "PENDING_VERIFICATION";
        if (s == Status.VERIFIED) return "VERIFIED";
        if (s == Status.FINANCING_REQUESTED) return "FINANCING_REQUESTED";
        if (s == Status.FINANCED) return "FINANCED";
        if (s == Status.REPAID) return "REPAID";
        if (s == Status.CLOSED) return "CLOSED";
        if (s == Status.REJECTED) return "REJECTED";
        if (s == Status.FLAGGED) return "FLAGGED";
        if (s == Status.CANCELLED) return "CANCELLED";
        return "NONE";
    }
}
