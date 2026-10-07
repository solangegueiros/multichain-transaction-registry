# MultiChainTxRegistry

Registro on-chain de transações de fundos e ordens observadas em várias redes blockchain.

O repositório é dividido por partes, uma pasta para cada:

| Pasta | Conteúdo |
|---|---|
| [smart-contracts/](smart-contracts/) | Contratos Solidity, testes e scripts de deploy, em um projeto Hardhat. Veja o [README dos smart contracts](smart-contracts/README.md) |
| [project.config.json](project.config.json) | Configuração pública compartilhada: URL do RPC da Sepolia, endereço do forwarder do Chainlink CRE e endereços dos contratos publicados. A tarefa de deploy preenche os endereços dos contratos |
| `project.backup.config.json` | Histórico dos endereços de contratos substituídos em um novo deploy. Só existe depois da primeira substituição |
| `.env` | Segredos compartilhados: chave privada de deploy e chave do Etherscan. Crie a partir do [.env.example](.env.example). Não é commitado |
| [package.json](package.json) | Atalhos para rodar da raiz os comandos de cada parte |
| [query-json/](query-json/) | Respostas de API de exemplo, com fundos e ordens reais. São a referência de dados para todas as partes |

## Por onde começar

```sh
cp .env.example .env
npm install
npm test
```

O `npm install` da raiz instala as dependências de `smart-contracts/`. Os testes rodam sem o `.env` preenchido; ele só é necessário para publicar na Sepolia.

## Comandos da raiz

O [package.json](package.json) da raiz não tem dependências próprias. Ele só guarda atalhos que entram na pasta de cada parte e rodam o comando lá.

| Comando | O que faz |
|---|---|
| `npm install` | Instala as dependências dos smart contracts |
| `npm test` | Roda os testes dos smart contracts |
| `npm run contracts:compile` | Compila os contratos |
| `npm run contracts:test` | Roda os testes dos contratos; é o mesmo que `npm test` |
| `npm run contracts:deploy` | Publica `MultiChainTxRegistry`, `FundRegistry` e `OrderRegistry`, reaproveitando os que já têm endereço no `project.config.json` |
| `npm run contracts:deploy-cre-receiver` | Publica o `MultiChainTxReceiver`, a entrada do Chainlink CRE |
| `npm run contracts:register-chains` | Registra as redes e as chaves de schema |
| `npm run contracts:register-stablecoins` | Registra os stablecoins no `FundRegistry` |
| `npm run contracts:install` | Instala só as dependências dos contratos |

Estes atalhos são para os comandos sem opções: instalar, compilar, testar e experimentar na rede simulada do Hardhat. Sem opções, `contracts:deploy`, `contracts:register-chains` e `contracts:register-stablecoins` rodam na rede simulada e não publicam nada de verdade.

### Para publicar em uma rede real, entre na pasta

Quando o comando recebe opções, como `--network sepolia`, rode de dentro de `smart-contracts/`, com `npx hardhat`. Este é o jeito recomendado:

```powershell
cd smart-contracts

npx hardhat deploy --network sepolia
npx hardhat deploy --network sepolia --only order-registry --yes
npx hardhat run scripts/register-chains.ts --network sepolia
npx hardhat run scripts/register-stablecoins.ts --network sepolia
npx hardhat run scripts/deploy-cre-receiver.ts --network sepolia
```

A ordem importa: primeiro o deploy, depois as redes, depois os stablecoins. O receptor do Chainlink CRE pode ser publicado a qualquer momento depois do deploy.

Funciona igual no PowerShell, no Prompt de Comando e no bash. As opções do deploy e mais exemplos estão no [README dos smart contracts](smart-contracts/README.md#como-digitar-os-comandos-com-exemplos).

### Por que não usar os atalhos com opções

Os atalhos aceitam opções depois de um `--`, mas no PowerShell isso tem uma armadilha. O `--` precisa ir entre aspas simples:

```powershell
npm run contracts:deploy '--' --network sepolia
```

Sem as aspas, o PowerShell descarta o `--` e as opções não chegam ao comando. Não aparece erro: o deploy roda na rede simulada, sem as opções, e parece ter funcionado. No bash o `--` funciona sem aspas.

Se usar um atalho com opções, confira na saída a linha que começa com `> hardhat`. Ela deve trazer as opções que você digitou.

Os comandos do Hardhat sem atalho, como `npx hardhat verify`, também são executados dentro de `smart-contracts/`. Os detalhes de compilação, deploy e registro de redes estão no [README dos smart contracts](smart-contracts/README.md).
