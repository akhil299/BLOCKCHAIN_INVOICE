// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestUSD (tUSD)
/// @notice Worthless ERC-20 used to SIMULATE financing on Sepolia. 6 decimals.
///         Anyone can claim a capped amount from the faucet once per cooldown.
contract TestUSD is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000 * 1e6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastFaucetClaim;

    error FaucetCooldown(uint256 availableAt);

    constructor(address initialOwner) ERC20("InvoChain Test USD", "tUSD") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Claim FAUCET_AMOUNT test tokens (testnet only, no real value).
    function faucet() external {
        uint256 last = lastFaucetClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner mint, for seeding demo accounts.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
