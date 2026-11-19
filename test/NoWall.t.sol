// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NoWall} from "../contracts/NoWall.sol";

/// @dev The handful of Foundry cheatcodes these tests use, declared here so
///      the suite needs no submodule and no package manager. `forge test` runs
///      on a fresh clone with nothing installed.
interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool t1, bool t2, bool t3, bool data) external;
    function label(address addr, string calldata name) external;
}

/// @notice Covers what the wall promises: only a relayer can write, the
///         numbering cannot be skipped or repeated, length limits hold on
///         single writes and inside batches, and the writer list can be
///         handed over without ever being left unowned.
contract NoWallTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    NoWall private wall;

    address private constant RELAYER = 0x1111111111111111111111111111111111111111;
    address private constant STRANGER = 0x2222222222222222222222222222222222222222;
    address private constant NEXT_OWNER = 0x3333333333333333333333333333333333333333;

    event Rejected(
        uint256 indexed seq,
        address indexed writer,
        string handle,
        string message,
        uint64 filedAt
    );
    event WriterSet(address indexed writer, bool allowed);

    function setUp() public {
        wall = new NoWall(RELAYER);
        vm.label(RELAYER, "relayer");
        vm.label(STRANGER, "stranger");
    }

    // ---------------------------------------------------------------- access

    function test_DeployerOwnsButCannotWrite() public view {
        require(wall.owner() == address(this), "deployer should own");
        require(!wall.isWriter(address(this)), "deployer should not write");
        require(wall.isWriter(RELAYER), "relayer should write");
    }

    function test_ConstructorRejectsZeroWriter() public {
        vm.expectRevert(NoWall.ZeroAddress.selector);
        new NoWall(address(0));
    }

    function test_StrangerCannotWrite() public {
        vm.prank(STRANGER);
        vm.expectRevert(NoWall.NotWriter.selector);
        wall.reject("stranger", "no", 1700000000);
    }

    function test_StrangerCannotWriteBatch() public {
        string[] memory handles = new string[](1);
        string[] memory messages = new string[](1);
        uint64[] memory times = new uint64[](1);
        handles[0] = "stranger";
        messages[0] = "no";
        times[0] = 1700000000;

        vm.prank(STRANGER);
        vm.expectRevert(NoWall.NotWriter.selector);
        wall.rejectMany(handles, messages, times);
    }

    function test_OwnerCanAddAndRemoveWriter() public {
        wall.setWriter(STRANGER, true);
        require(wall.isWriter(STRANGER), "should have been added");

        vm.prank(STRANGER);
        wall.reject("someone", "no", 1700000000);
        require(wall.total() == 1, "added writer should have written");

        wall.setWriter(STRANGER, false);

        vm.prank(STRANGER);
        vm.expectRevert(NoWall.NotWriter.selector);
        wall.reject("someone", "no", 1700000000);
    }

    function test_StrangerCannotChangeWriterList() public {
        vm.prank(STRANGER);
        vm.expectRevert(NoWall.NotOwner.selector);
        wall.setWriter(STRANGER, true);
    }

    // ---------------------------------------------------------------- writes

    function test_SingleWriteNumbersFromOne() public {
        vm.expectEmit(true, true, false, true);
        emit Rejected(1, RELAYER, "mara_vance", "I will not round it up.", 1700000000);

        vm.prank(RELAYER);
        wall.reject("mara_vance", "I will not round it up.", 1700000000);

        require(wall.total() == 1, "total should be one");
    }

    function test_SequenceRunsWithoutGaps() public {
        for (uint64 i = 0; i < 5; i++) {
            vm.prank(RELAYER);
            wall.reject("someone", "no", 1700000000 + i);
        }
        require(wall.total() == 5, "five filings should count five");
    }

    function test_FiledAtIsTheValuePassedIn() public {
        uint64 lastMonth = 1696118400;

        vm.expectEmit(true, true, false, true);
        emit Rejected(1, RELAYER, "someone", "filed before the wall opened", lastMonth);

        vm.prank(RELAYER);
        wall.reject("someone", "filed before the wall opened", lastMonth);
    }

    // ---------------------------------------------------------------- limits

    function test_EmptyHandleReverts() public {
        vm.prank(RELAYER);
        vm.expectRevert(NoWall.EmptyField.selector);
        wall.reject("", "no", 1700000000);
    }

    function test_EmptyMessageReverts() public {
        vm.prank(RELAYER);
        vm.expectRevert(NoWall.EmptyField.selector);
        wall.reject("someone", "", 1700000000);
    }

    function test_HandleAtTheLimitIsAccepted() public {
        vm.prank(RELAYER);
        wall.reject(_repeat("a", 24), "no", 1700000000);
        require(wall.total() == 1, "24 bytes should be allowed");
    }

    function test_HandleOverTheLimitReverts() public {
        vm.prank(RELAYER);
        vm.expectRevert(NoWall.TooLong.selector);
        wall.reject(_repeat("a", 25), "no", 1700000000);
    }

    function test_MessageAtTheLimitIsAccepted() public {
        vm.prank(RELAYER);
        wall.reject("someone", _repeat("a", 200), 1700000000);
        require(wall.total() == 1, "200 bytes should be allowed");
    }

    function test_MessageOverTheLimitReverts() public {
        vm.prank(RELAYER);
        vm.expectRevert(NoWall.TooLong.selector);
        wall.reject("someone", _repeat("a", 201), 1700000000);
    }

    // ----------------------------------------------------------------- batch

    function test_BatchWritesInOrder() public {
        uint64 size = 3;
        (string[] memory handles, string[] memory messages, uint64[] memory times) =
            _batch(size);

        vm.prank(RELAYER);
        wall.rejectMany(handles, messages, times);

        require(wall.total() == size, "batch should count every filing");
    }

    function test_BatchAtTheCapIsAccepted() public {
        (string[] memory handles, string[] memory messages, uint64[] memory times) =
            _batch(100);

        vm.prank(RELAYER);
        wall.rejectMany(handles, messages, times);

        require(wall.total() == 100, "a full batch should go through");
    }

    function test_BatchOverTheCapReverts() public {
        (string[] memory handles, string[] memory messages, uint64[] memory times) =
            _batch(101);

        vm.prank(RELAYER);
        vm.expectRevert(NoWall.BatchTooLarge.selector);
        wall.rejectMany(handles, messages, times);
    }

    function test_EmptyBatchReverts() public {
        string[] memory handles = new string[](0);
        string[] memory messages = new string[](0);
        uint64[] memory times = new uint64[](0);

        vm.prank(RELAYER);
        vm.expectRevert(NoWall.EmptyBatch.selector);
        wall.rejectMany(handles, messages, times);
    }

    function test_MismatchedArraysRevert() public {
        string[] memory handles = new string[](2);
        string[] memory messages = new string[](1);
        uint64[] memory times = new uint64[](2);
        handles[0] = "a";
        handles[1] = "b";
        messages[0] = "no";
        times[0] = 1;
        times[1] = 2;

        vm.prank(RELAYER);
        vm.expectRevert(NoWall.LengthMismatch.selector);
        wall.rejectMany(handles, messages, times);
    }

    /// @dev One bad entry has to throw out the whole batch. A partly written
    ///      queue would leave the wall out of step with the site.
    function test_OneBadEntryRejectsTheWholeBatch() public {
        string[] memory handles = new string[](3);
        string[] memory messages = new string[](3);
        uint64[] memory times = new uint64[](3);

        handles[0] = "first";
        handles[1] = "";
        handles[2] = "third";
        messages[0] = "no";
        messages[1] = "no";
        messages[2] = "no";
        times[0] = 1;
        times[1] = 2;
        times[2] = 3;

        vm.prank(RELAYER);
        vm.expectRevert(NoWall.EmptyField.selector);
        wall.rejectMany(handles, messages, times);

        require(wall.total() == 0, "nothing should have been written");
    }

    // ------------------------------------------------------------- ownership

    function test_OwnershipNeedsTwoSteps() public {
        wall.transferOwnership(NEXT_OWNER);
        require(wall.owner() == address(this), "owner should not change yet");
        require(wall.pendingOwner() == NEXT_OWNER, "offer should be recorded");

        vm.prank(NEXT_OWNER);
        wall.acceptOwnership();

        require(wall.owner() == NEXT_OWNER, "owner should have changed");
        require(wall.pendingOwner() == address(0), "offer should be cleared");
    }

    function test_OnlyTheOfferedAddressCanAccept() public {
        wall.transferOwnership(NEXT_OWNER);

        vm.prank(STRANGER);
        vm.expectRevert(NoWall.NotPendingOwner.selector);
        wall.acceptOwnership();
    }

    function test_OwnershipCannotGoToZero() public {
        vm.expectRevert(NoWall.ZeroAddress.selector);
        wall.transferOwnership(address(0));
    }

    function test_StrangerCannotTransferOwnership() public {
        vm.prank(STRANGER);
        vm.expectRevert(NoWall.NotOwner.selector);
        wall.transferOwnership(STRANGER);
    }

    // ---------------------------------------------------------------- helpers

    function _repeat(string memory unit, uint256 times) private pure returns (string memory) {
        bytes memory out = new bytes(times);
        bytes1 ch = bytes(unit)[0];
        for (uint256 i = 0; i < times; i++) {
            out[i] = ch;
        }
        return string(out);
    }

    function _batch(uint64 size)
        private
        pure
        returns (string[] memory handles, string[] memory messages, uint64[] memory times)
    {
        handles = new string[](size);
        messages = new string[](size);
        times = new uint64[](size);

        for (uint64 i = 0; i < size; i++) {
            handles[i] = "someone";
            messages[i] = "no";
            times[i] = 1700000000 + i;
        }
    }
}
