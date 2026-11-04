// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {InvoiceTypes} from "./InvoiceTypes.sol";

interface IInvoiceRegistryView {
    function getInvoiceDetails(uint256 invoiceId) external view returns (InvoiceTypes.Invoice memory);
}

/// @title InvoiceToken
/// @notice ERC-721 receipt for a VERIFIED invoice. tokenId == invoiceId, so exactly one
///         token can ever represent one invoice/financing claim.
/// @dev    This token is a technical reference, NOT proof of legal title to the receivable.
///         While an invoice is in financing the token is locked (non-transferable).
///         Only the registry can mint, lock, unlock and burn.
contract InvoiceToken is ERC721, Ownable {
    using Strings for uint256;
    using Strings for address;

    address public registry;
    mapping(uint256 => bool) public locked;

    error NotRegistry();
    error RegistryAlreadySet();
    error TokenLocked(uint256 tokenId);

    modifier onlyRegistry() {
        if (msg.sender != registry) revert NotRegistry();
        _;
    }

    constructor(address initialOwner) ERC721("InvoChain Invoice", "INVO") Ownable(initialOwner) {}

    /// @notice One-time wiring performed at deployment.
    function setRegistry(address registry_) external onlyOwner {
        if (registry != address(0)) revert RegistryAlreadySet();
        require(registry_ != address(0), "ZERO_REGISTRY");
        registry = registry_;
    }

    function mint(address to, uint256 invoiceId) external onlyRegistry {
        _mint(to, invoiceId);
    }

    function setLocked(uint256 tokenId, bool isLocked) external onlyRegistry {
        locked[tokenId] = isLocked;
    }

    function burn(uint256 tokenId) external onlyRegistry {
        delete locked[tokenId];
        _burn(tokenId);
    }

    /// @dev Blocks wallet-to-wallet transfers while the invoice is locked for financing.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && locked[tokenId]) revert TokenLocked(tokenId);
        return super._update(to, tokenId, auth);
    }

    /// @notice Fully on-chain metadata read from the registry.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        InvoiceTypes.Invoice memory inv = IInvoiceRegistryView(registry).getInvoiceDetails(tokenId);
        bytes memory json = abi.encodePacked(
            '{"name":"InvoChain Invoice #', tokenId.toString(),
            '","description":"Testnet invoice receipt. Not proof of legal title to a receivable.",',
            '"attributes":[',
            '{"trait_type":"Invoice ID","value":"', inv.id.toString(), '"},',
            '{"trait_type":"Invoice Hash","value":"', uint256(inv.docHash).toHexString(32), '"},',
            '{"trait_type":"Supplier","value":"', inv.supplier.toHexString(), '"},',
            '{"trait_type":"Status","value":"', InvoiceTypes.statusName(inv.status), '"},',
            '{"trait_type":"Amount","value":"', inv.amount.toString(), '"},',
            '{"trait_type":"Due Date","value":"', uint256(inv.dueDate).toString(), '"},',
            '{"trait_type":"Locked","value":"', locked[tokenId] ? "true" : "false", '"}',
            "]}"
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }
}
