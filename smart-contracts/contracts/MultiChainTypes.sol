// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title MultiChainTypes
/// @notice Structs and enums of MultiChainTxRegistry, shared with FundRegistry and OrderRegistry.
/// @dev File-level definitions: import the names you need, e.g.
///      import {ChainInfo, TxInput} from "./MultiChainTypes.sol";

// ============================================================
// CHAIN INFO
// ============================================================

struct ChainInfo {
    bytes32 chainId;         // keccak256(bytes(network)) - key of all mappings
    string  network;         // normalized identifier: "eip155:51", "xrpl:testnet", "stellar:testnet"
    string  networkChainId;  // textual id on the source network: "51" (empty if none)
    string  name;            // friendly name: "XDC", "XRPL", "STELLAR"
    string  profileId;       // optional: "xdc-apothem"
    bytes32 genesisHash;     // optional outside EVM
}

// ============================================================
// STATUS
// ============================================================

enum TxStatus {
    PENDING,
    CONFIRMED,
    FAILED
}

// ============================================================
// BASE TRANSACTION (fields common to all networks)
// ============================================================

struct BaseTx {
    uint256   id;             // Sequential internal ID
    bytes32   chainId;        // Reference to ChainInfo (keccak256 of normalized network)
    TxStatus  status;
    string    txHash;
    string    from;
    string    to;
    uint256   amount;         // Smallest unit (wei / drops / stroops)
    string    assetCode;      // "BRL-CVM", "CVD"...
    string    assetIssuer;    // Token contract (EVM) or issuer (XRPL/Stellar). Empty if native
    string    txType;         // "transfer", "contractCall", "Payment", "payment"...
    bytes     data;           // EVM: calldata | XRPL: MemoData | Stellar: memo
    string    dataType;       // "calldata", "memo", "text", "id", "hash", "return"
    uint256   blockNumber;    // Block (EVM) or ledger (XRPL / Stellar)
    uint256   timestamp;      // Timestamp on the source network
    uint256   registeredAt;   // Timestamp of registration in this contract
    address   registeredBy;   // Relayer/oracle that registered the transaction
}

/// @dev Input of registerTx: BaseTx without the fields filled by the contract
///      (id, chainId, registeredAt, registeredBy).
struct TxInput {
    TxStatus  status;
    string    txHash;
    string    from;
    string    to;
    uint256   amount;
    string    assetCode;
    string    assetIssuer;
    string    txType;
    bytes     data;
    string    dataType;
    uint256   blockNumber;
    uint256   timestamp;
}

// ============================================================
// EXTRA ARGS (generic, network-specific data)
// ============================================================

struct ExtraArg {
    bytes32 key;    // e.g. bytes32("sequence"), bytes32("destinationTag")
    bytes   value;  // abi.encode(...) of the value
}

/// @dev Declares an extra arg key accepted by a network. Used only by
///      MultiChainTxRegistry (registerSchemaKey / getSchema).
struct ExtraArgSchema {
    bytes32 key;            // e.g. bytes32("destinationTag")
    string  valueType;      // e.g. "uint32"
    string  description;    // e.g. "Destination tag (0 if none)"
    bool    required;       // must be present when registering a transaction
    bool    active;         // allows deprecating a key without deleting it
}
