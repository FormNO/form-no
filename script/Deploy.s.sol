// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NoWall} from "../contracts/NoWall.sol";

/// @dev The two cheatcodes this script needs, declared here for the same
///      reason as in the test suite: no submodule, nothing to install.
interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title Deploy NoWall to Robinhood Chain
/// @notice Run once. The address it prints goes into the CONTRACT variable on
///         Cloudflare, and from that moment every filing is written as it is
///         made. The queue that built up before deployment is sent afterwards
///         through rejectMany, oldest first, so the numbering on the wall is
///         the numbering on the chain.
///
/// Robinhood Chain mainnet
///   chain id  4663
///   rpc       https://rpc.mainnet.chain.robinhood.com
///   explorer  https://robinhoodchain.blockscout.com
///   gas token ETH
///
/// Two addresses are involved and they are deliberately different. The key
/// that signs this deployment owns the contract and should not be kept on a
/// server. RELAYER_ADDRESS is the wallet the site writes with; it is the only
/// one the contract lets near a filing, and it can do nothing else.
///
///   export RELAYER_ADDRESS=0x...
///   forge script script/Deploy.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --private-key $DEPLOYER_KEY \
///     --broadcast
///
/// Leave off --broadcast to simulate the deployment without sending anything.
contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (NoWall wall) {
        address relayer = vm.envAddress("RELAYER_ADDRESS");

        vm.startBroadcast();
        wall = new NoWall(relayer);
        vm.stopBroadcast();
    }
}
