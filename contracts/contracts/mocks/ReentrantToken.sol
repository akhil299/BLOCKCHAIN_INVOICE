// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IRegistryLike {
    function approveFinancing(uint256 id) external;
    function recordRepayment(uint256 id, uint256 amount) external;
}

/// @dev TEST ONLY. An ERC-20 that tries to re-enter the registry from inside transferFrom.
///      It is also used as the acting financier so the role check passes and ONLY the
///      reentrancy guard can stop the second call.
contract ReentrantToken is ERC20 {
    IRegistryLike public registry;
    uint256 public targetId;
    bool public armed;
    bool public reentryBlocked;
    bool public reentryAttempted;
    bytes4 public reentryErrorSelector;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address registry_, uint256 id) external {
        registry = IRegistryLike(registry_);
        targetId = id;
        armed = true;
        _approve(address(this), registry_, type(uint256).max);
    }

    function fund(address registry_, uint256 id) external {
        registry = IRegistryLike(registry_);
        registry.approveFinancing(id);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            reentryAttempted = true;
            try registry.approveFinancing(targetId) {
                reentryBlocked = false;
            } catch (bytes memory data) {
                reentryBlocked = true;
                if (data.length >= 4) reentryErrorSelector = bytes4(data);
            }
        }
        _transfer(from, to, amount);
        return true;
    }
}
