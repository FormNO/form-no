// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Form N-O - Rejection Wall
/// @notice Writes the handle and message to the chain as an event.
///         Nothing is stored, which keeps the gas cost minimal.
contract NoWall {
    event Rejected(
        address indexed sender,
        string username,
        string message,
        uint256 timestamp
    );

    uint256 public total;

    string public constant SIGNED_BY = "byX";

    error EmptyField();
    error TooLong();

    function reject(string calldata username, string calldata message) external {
        uint256 u = bytes(username).length;
        uint256 m = bytes(message).length;
        if (u == 0 || m == 0) revert EmptyField();
        if (u > 24 || m > 200) revert TooLong();

        unchecked { total += 1; }

        emit Rejected(msg.sender, username, message, block.timestamp);
    }
}
