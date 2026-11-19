// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  Form N-O rejection wall
/// @author Form N-O
/// @notice One line per refusal, kept as a log and never written into storage.
/// @dev    A filing only becomes real after its author has signed in with X.
///         That check happens off chain, so the handle attached to a log is an
///         assertion made by whoever sent the transaction. Writing is therefore
///         limited to the relayer addresses that carry out the check. Leaving
///         it open would let anyone attach any handle to any sentence, and the
///         handle is the only thing that makes this record worth keeping.
///
///         Everything else is kept deliberately small. No message is stored,
///         no funds are held, there is no upgrade path and no way to remove a
///         log once it is written. The contract cannot be made to forget.
contract NoWall {
    /// @notice Longest handle X issues, in bytes.
    uint256 public constant MAX_HANDLE = 24;

    /// @notice Longest message the site accepts, in bytes. Kept in step with
    ///         the limit enforced in the browser and again at the API.
    uint256 public constant MAX_MESSAGE = 200;

    /// @notice Most filings one transaction may carry. A queue flush that grew
    ///         past a block gas limit would strand the whole batch, so the
    ///         ceiling is set here rather than discovered on a failed send.
    uint256 public constant MAX_BATCH = 100;

    /// @notice Left in the first version of this contract and kept since.
    string public constant SIGNED_BY = "byX";

    /// @notice Filings written so far, and the sequence number of the last one.
    /// @dev    The count lives here rather than being passed in, so the numbers
    ///         on the wall are a property of the chain and not a claim made by
    ///         the sender. They run from one, never repeat and never skip.
    uint256 public total;

    /// @notice Holds the writer list. Nothing else.
    address public owner;

    /// @notice Set by transferOwnership, cleared when the new owner accepts.
    address public pendingOwner;

    /// @notice Addresses allowed to write filings.
    mapping(address => bool) public isWriter;

    /// @param seq      Position on the wall, counting from one.
    /// @param writer   Relayer that sent the transaction.
    /// @param handle   X handle the author signed in with.
    /// @param message  What they refuse.
    /// @param filedAt  Unix seconds at which they filed it.
    event Rejected(
        uint256 indexed seq,
        address indexed writer,
        string handle,
        string message,
        uint64 filedAt
    );

    event WriterSet(address indexed writer, bool allowed);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error NotWriter();
    error ZeroAddress();
    error EmptyField();
    error TooLong();
    error EmptyBatch();
    error BatchTooLarge();
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param firstWriter Relayer the site signs its transactions with. The
    ///        deployer keeps ownership and is not made a writer, so the key
    ///        that controls the contract is never the key left on a server.
    constructor(address firstWriter) {
        if (firstWriter == address(0)) revert ZeroAddress();

        owner = msg.sender;
        isWriter[firstWriter] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit WriterSet(firstWriter, true);
    }

    /// @notice Write one filing.
    /// @param filedAt When the author filed, in seconds. Passed in rather than
    ///        read from the block, because a filing made while the queue was
    ///        closed is written later than it was made and the wall shows the
    ///        moment it was made. The block timestamp stays available on the
    ///        log itself for anyone who wants to compare the two.
    function reject(
        string calldata handle,
        string calldata message,
        uint64 filedAt
    ) external {
        if (!isWriter[msg.sender]) revert NotWriter();
        _write(handle, message, filedAt);
    }

    /// @notice Write a run of filings in one transaction, in the order given.
    /// @dev    Used once to empty the queue that built up before the contract
    ///         existed. The three arrays are parallel: index i of each belongs
    ///         to the same filing.
    function rejectMany(
        string[] calldata handles,
        string[] calldata messages,
        uint64[] calldata filedAt
    ) external {
        if (!isWriter[msg.sender]) revert NotWriter();

        uint256 count = handles.length;
        if (count == 0) revert EmptyBatch();
        if (count > MAX_BATCH) revert BatchTooLarge();
        if (messages.length != count || filedAt.length != count) revert LengthMismatch();

        for (uint256 i = 0; i < count; ) {
            _write(handles[i], messages[i], filedAt[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Add or remove a relayer.
    /// @dev    Removing one cannot touch anything it has already written.
    function setWriter(address writer, bool allowed) external onlyOwner {
        if (writer == address(0)) revert ZeroAddress();

        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    /// @notice Offer ownership to another address.
    /// @dev    Two steps on purpose. A mistyped address here would leave the
    ///         writer list frozen for good, so the new owner has to prove it
    ///         can send a transaction before it takes over.
    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    /// @notice Take ownership after it has been offered.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();

        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);

        emit OwnershipTransferred(previous, msg.sender);
    }

    /// @dev Length checks sit here so one filing in a batch cannot slip past
    ///      them. Reverting throws out the whole batch, which is what we want:
    ///      a partly written queue is harder to reason about than a failed one.
    function _write(
        string calldata handle,
        string calldata message,
        uint64 filedAt
    ) private {
        uint256 handleLength = bytes(handle).length;
        uint256 messageLength = bytes(message).length;

        if (handleLength == 0 || messageLength == 0) revert EmptyField();
        if (handleLength > MAX_HANDLE || messageLength > MAX_MESSAGE) revert TooLong();

        uint256 seq;
        unchecked {
            seq = ++total;
        }

        emit Rejected(seq, msg.sender, handle, message, filedAt);
    }
}
