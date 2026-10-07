# MultiChainTxRegistry — exemplos de dados

Exemplos de preenchimento das structs de [MultiChainTypes.sol](contracts/MultiChainTypes.sol), usadas por [MultiChainTxRegistry.sol](contracts/MultiChainTxRegistry.sol), [FundRegistry.sol](contracts/FundRegistry.sol) e [OrderRegistry.sol](contracts/OrderRegistry.sol), montados a partir das respostas em [query-json/](../query-json/).

As redes encontradas são `eip155:51` (XDC Apothem), `xrpl:testnet` e `stellar:testnet`.

## ChainInfo

`chainId` é sempre `keccak256(bytes(network))`, com `network` normalizado (minúsculas, sem espaços).

```solidity
ChainInfo({
    chainId:        keccak256(bytes("eip155:51")),
    network:        "eip155:51",
    networkChainId: "51",
    name:           "XDC",
    profileId:      "xdc-apothem",
    genesisHash:    0xbdea512b4f12ff1135ec92c00dc047ffb93890c2ea1aa0eefe9b013d80640075
})

ChainInfo({
    chainId:        keccak256(bytes("xrpl:testnet")),
    network:        "xrpl:testnet",
    networkChainId: "",             // nao informado na rede de origem
    name:           "XRPL",
    profileId:      "",             // opcional
    genesisHash:    bytes32(0)      // opcional fora do EVM
})

ChainInfo({
    chainId:        keccak256(bytes("stellar:testnet")),
    network:        "stellar:testnet",
    networkChainId: "",             // nao informado na rede de origem
    name:           "STELLAR",
    profileId:      "",             // opcional
    genesisHash:    bytes32(0)      // opcional fora do EVM
})
```

## TxInput

`amount` vai sempre na menor unidade da rede:

| Rede | Ativo | Decimais | Valor na origem | `amount` |
|---|---|---|---|---|
| `eip155:51` | BRL-CVM | 18 | `6000` | `6000000000000000000000` |
| `xrpl:testnet` | CVD (IOU) | 6 | `5500` | `5500000000` |
| `stellar:testnet` | CVD | 7 | `6000` | `60000000000` |

IOUs da XRPL não têm menor unidade oficial (drops só existem para XRP). Os 6 decimais são uma convenção deste registro, por analogia com drops.

`timestamp` está zerado nos exemplos porque as respostas em `query-json/` não trazem o horário do bloco ou ledger; preencha com o timestamp do bloco (EVM) ou o close time do ledger (XRPL / Stellar).

```solidity
// eip155:51 - 6000 BRL-CVM, 18 decimais => 6000 * 10^18
TxInput({
    status:      TxStatus.CONFIRMED,
    txHash:      "0x5cf581d7bf2c25cc22aa20edfbb63e78bdb82798425c3a59875b3d5207372c0d",
    from:        "0x8d9ac9f2fc551276805a30ab2b387c1bf1cf7f80",
    to:          "0x16d53e6c7016ff8d706a3202a7a49491d18d58d5",
    amount:      6000000000000000000000,
    assetCode:   "BRL-CVM",
    assetIssuer: "0x243e98638d619eb6f10eabbacfc071f318d5e9d0",
    txType:      "transfer",
    data:        "",
    dataType:    "",
    blockNumber: 87056956,
    timestamp:   0
})

// xrpl:testnet - 5500 CVD (IOU), 6 decimais => 5500 * 10^6
TxInput({
    status:      TxStatus.CONFIRMED,
    txHash:      "107EDFF0CA0CE5CE4BFC98F422C1D0D3DAA6B4612D81F065EA198703EE77F46A",
    from:        "r4zbotBezN7gGuanHUiwsXJrBGE91m1MDH",
    to:          "rffW8Pf5yNp9xXPMo47LARGEkzSTxrYAsL",
    amount:      5500000000,
    assetCode:   "CVD",
    assetIssuer: "r9aceEB7Qy5JrHtYt2KGhF4KVMgEGjoY2U",
    txType:      "Payment",
    data:        "",
    dataType:    "",
    blockNumber: 20935718,
    timestamp:   0
})

// stellar:testnet - 6000 CVD, 7 decimais (stroops) => 6000 * 10^7
TxInput({
    status:      TxStatus.CONFIRMED,
    txHash:      "03ccf55d6ddc471b7bcd77d5c2cb95137fb48765a975d3cf5996c54d4bc194a3",
    from:        "GDAHUE7RJ3RZ4PRTS7ZVJ2G6H4OLCSW3BLPEFAJ7XSLBQAMGQV4OXMFL",
    to:          "GCPN5BJYXPRHGB3YIUOHSC4S6OYZKLHNIK7LYTVXRBCAPTHDYC7F7RFW",
    amount:      60000000000,
    assetCode:   "CVD",
    assetIssuer: "GDRR62CPM7TD4OHVZC6ZIBUUD3O4M7TWWOXZ4VHCWK3QTJ34PC3SZX54",
    txType:      "payment",
    data:        "",
    dataType:    "",
    blockNumber: 4793929,
    timestamp:   0
})
```

## ExtraArg

Dados específicos de cada rede, para as mesmas transações dos exemplos de `TxInput`. Cada chave precisa ser registrada antes com `registerSchemaKey`; caso contrário `registerTx` reverte com `Unknown extra arg key`. As chaves abaixo são as que o script [register-chains.ts](scripts/register-chains.ts) cadastra.

O `lockTxHash` não é um argumento extra: a confirmação do lock é registrada como uma transação própria da ordem, com o papel `LOCK`.

```solidity
// eip155:51
ExtraArg(bytes32("blockHash"),  abi.encode(bytes32(0x02cb557532fec9d86cab0fe1f39d23a14e086743d5afff4bb9216c0d8586777b)))
ExtraArg(bytes32("logIndex"),   abi.encode(uint256(61)))

// xrpl:testnet
ExtraArg(bytes32("ledgerHash"), abi.encode(bytes32(0x9DB069EA281640551D7BF62C1698AEA2C62A4AB7423B0E4E18662BEB208B3AE5)))
ExtraArg(bytes32("sequence"),   abi.encode(uint32(20914264)))

// stellar:testnet
ExtraArg(bytes32("ledgerHash"), abi.encode(bytes32(0x638c89c3121601d292abc61204c23f019f9bab86659967cc98fdb8dee1458d4b)))
ExtraArg(bytes32("sequence"),   abi.encode(uint64(20442893277724677)))
```
