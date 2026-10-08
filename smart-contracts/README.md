# MultiChainTxRegistry — smart contracts

Smart contracts do projeto, um projeto Hardhat.

## Índice

- [Introdução](#introdução)
- [Requisitos](#requisitos)
- [Configuração](#configuração)
- [Setup Smart Contracts](#setup-smart-contracts)
- [Testes locais](#testes-locais)
- [Perfis e Permissões](#perfis-e-permissões)
- [Registrando transações com Chainlink CRE](#registrando-transações-com-chainlink-cre)
- [Fundos e ordens](#fundos-e-ordens)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Status](#status)
- [Observações](#observações)

## Introdução

Registro on-chain de transações observadas redes blockchain. 

Relayers confiáveis gravam cada transação (hash, partes, valor, ativo, bloco) em um formato comum, junto com campos específicos de cada rede, validados contra um schema por rede.

Todos os comandos deste documento são executados dentro de `smart-contracts/`, com `npx hardhat`:

```sh
cd smart-contracts
```

Este é o jeito recomendado de rodar os comandos que recebem opções, como o deploy. Caso esteja utilizando PowerShell, veja a observação [Comandos no Powershell](#comandos-no-powershell).

O contrato está publicado na rede blockchain **Ethereum Sepolia**. 

As redes rastreadas hoje são:
- XDC Apothem (`eip155:51`)
- XDC mainnet (`eip155:50`)
- Polygon Amoy (`eip155:80002`)
- Rayls (`eip155:7295799`)
- XRPL testnet (`xrpl:testnet`)
- Stellar testnet (`stellar:testnet`)


## Requisitos

- Node.js 22 (desenvolvido com a 22.14)
- Uma conta na rede Ethereum Sepolia com ETH para o gas
- Uma [chave de API do Etherscan](https://etherscan.io/apidashboard), para a verificação do contrato

## Configuração

```sh
npm install
cp ../.env.example ../.env
```

O `.env` e o `project.config.json` ficam na raiz do repositório, fora desta pasta, porque são compartilhados com as outras partes do projeto. O Hardhat os encontra a partir da localização do `hardhat.config.ts`, então os comandos funcionam de qualquer pasta.

Preencha o `.env`:

| Variável | Para que serve |
|---|---|
| `ETH_PRIVATE_KEY` | Conta que publica os contratos e se torna admin deles |
| `ETHERSCAN_API_KEY` | Verifica o contrato no Etherscan |

> `.env` guarda apenas segredos e está no `.gitignore`. 

Os valores públicos ficam em [project.config.json](../project.config.json):

| Campo | Para que serve |
|---|---|
| `rpcUrl` | URL do RPC da Sepolia. O padrão é um endpoint público; não coloque aqui uma URL com chave de API embutida |
| `multiChainTxRegistryAddress` | Endereço do `MultiChainTxRegistry` publicado. Fica vazio até o deploy |
| `fundRegistryAddress` | Endereço do `FundRegistry` publicado. Fica vazio até o deploy |
| `orderRegistryAddress` | Endereço do `OrderRegistry` publicado. Fica vazio até o deploy |
| `creForwarderAddress` | Endereço do forwarder do Chainlink CRE, que entrega os relatórios ao `MultiChainTxReceiver`. Você preenche. Vazio, vale o forwarder de simulação |
| `multiChainTxReceiverAddress` | Endereço do `MultiChainTxReceiver` publicado. Fica vazio até o passo 5 |

Os endereços dos contratos são preenchidos pela tarefa de deploy e pelo script do receptor. Só o `creForwarderAddress` é preenchido à mão; os valores estão em [5. Publicar a estrutura de integração com Chainlink CRE](#5-publicar-a-estrutura-de-integração-com-chainlink-cre).

## Setup Smart Contracts

### 1. Compilar

```sh
npx hardhat compile
```

### 2. Publicar

```sh
npx hardhat deploy --network sepolia
```

A tarefa `deploy` publica três contratos, nesta ordem: `MultiChainTxRegistry`, `FundRegistry` e `OrderRegistry`. Depois de cada um, espera 5 confirmações e o verifica no Etherscan. Se a verificação falhar, o deploy continua valendo e a tarefa mostra o comando para tentar de novo. O receptor do Chainlink CRE é publicado à parte, no [passo 5](#5-publicar-a-estrutura-de-integração-com-chainlink-cre).

Antes de publicar, ela mostra o plano: o que será publicado, o que será reaproveitado e o que será substituído.

| Opção | O que faz |
|---|---|
| nenhuma | Publica só os contratos com endereço vazio no [project.config.json](../project.config.json) e reaproveita os outros |
| `--only <contrato>` | Publica de novo esse contrato e, automaticamente, os que dependem dele |
| `--force` | Publica os três de novo, ignorando os endereços preenchidos |
| `--yes` | Confirma a substituição de contratos já publicados. Obrigatória fora da rede simulada |

Os valores de `--only` são `multichain-tx-registry`, `fund-registry` e `order-registry`.

```sh
npx hardhat deploy --network sepolia --only order-registry --yes
npx hardhat deploy --network sepolia --force --yes
```

#### Como digitar os comandos, com exemplos

**Rode o deploy de dentro de `smart-contracts/`, com `npx hardhat`.** Este é o jeito recomendado. As opções vão direto depois de `deploy` e o comando funciona igual no PowerShell, no Prompt de Comando e no bash, sem nenhum cuidado especial.

```powershell
cd smart-contracts

# Primeiro deploy, ou continuar um deploy que parou no meio
npx hardhat deploy --network sepolia

# Publicar de novo só o OrderRegistry
npx hardhat deploy --network sepolia --only order-registry --yes

# Publicar de novo o FundRegistry (o OrderRegistry vai junto)
npx hardhat deploy --network sepolia --only fund-registry --yes

# Publicar os três de novo
npx hardhat deploy --network sepolia --force --yes

# Só ver o plano, sem publicar nada: deixe o --yes de fora
npx hardhat deploy --network sepolia --only order-registry
```

Confira na saída a linha `Network:`, que deve mostrar a rede que você pediu, antes de o deploy começar a publicar.

**Alternativa: da raiz do repositório, com `npm run`.** Os atalhos da raiz também aceitam as opções, depois de um `--`. No PowerShell esse jeito tem uma armadilha, explicada na observação [Comandos no Powershell](#comandos-no-powershell).

**Sem opção, contratos já publicados são reaproveitados.** Cada endereço novo é gravado no `project.config.json` assim que o contrato é publicado. Por isso a tarefa pode ser executada de novo sem risco, e uma execução que parar no meio continua de onde parou.

**Publicar de novo não atualiza o contrato.** Os contratos não são atualizáveis: o novo começa vazio, em outro endereço. O antigo continua na rede com os dados dele, só deixa de ser referenciado. Os dados precisam ser carregados de novo no contrato novo.

**Dependências.** Cada contrato fica ligado para sempre aos contratos com que foi publicado, então substituir um obriga a substituir os que dependem dele:

| `--only` | Também publica de novo |
|---|---|
| `multichain-tx-registry` | `FundRegistry` e `OrderRegistry` |
| `fund-registry` | `OrderRegistry` |
| `order-registry` | nada |

**Confirmação.** Quando o plano substitui algum contrato já publicado, a tarefa para depois de mostrar o plano e não publica nada. Para seguir, repita o comando com `--yes`. Na rede simulada a confirmação não é pedida.

**Backup dos endereços.** Antes de substituir, a tarefa acrescenta uma entrada ao `project.backup.config.json`, na raiz do repositório, com o `project.config.json` como estava, a data, a rede, a opção usada e os contratos substituídos. O arquivo é uma lista e nunca é sobrescrito, então os endereços antigos não se perdem.

**Relayers.** No fim, a tarefa concede o papel `RELAYER_ROLE` no `MultiChainTxRegistry` ao `FundRegistry` e ao `OrderRegistry` novos, se ainda não tiverem. Isso só é possível quando a conta que roda a tarefa é admin do `MultiChainTxRegistry`. Se não for, a tarefa mostra as chamadas de `grantRole` que um admin precisa fazer.

Um contrato substituído continua com o `RELAYER_ROLE` enquanto o `MultiChainTxRegistry` for o mesmo. A tarefa avisa e mostra a chamada `revokeRole` para um admin revogar. Ela não revoga sozinha.

**Coerência.** A tarefa para com erro se um endereço preenchido estiver abaixo de um vazio, se um endereço preenchido não tiver contrato na rede ou se os contratos reaproveitados não apontarem uns para os outros.

**Receptor do CRE.** O `MultiChainTxReceiver` fica ligado para sempre ao `MultiChainTxRegistry` com que foi publicado. Se a tarefa substituir o `MultiChainTxRegistry` e já houver um receptor, ela avisa que ele ficou ligado ao contrato antigo e mostra como publicá-lo de novo.

**O que a tarefa não faz.** Ela não define operadores. Um admin do `FundRegistry` e um do `OrderRegistry` precisam conceder o `OPERATOR_ROLE`, com `grantRole`, a cada conta que vai carregar dados.

### 3. Registrar as redes

Em `.\smart-contracts`:

```powershell
npx hardhat run scripts/register-chains.ts --network sepolia
```

Como no deploy, rode de dentro de `smart-contracts/`, com `npx hardhat`.

Registra as seis redes listadas acima no contrato em `multiChainTxRegistryAddress`. Precisa ser executado com uma conta admin do contrato. Redes já registradas são puladas, então o script pode ser executado de novo sem risco.

O mesmo script registra as chaves de argumentos extras de cada rede, todas opcionais. Chaves já registradas também são puladas.

| Rede | Chave | Tipo | Conteúdo |
|---|---|---|---|
| `eip155:51`, `eip155:50`, `eip155:80002` e `eip155:7295799` | `blockHash` | `bytes32` | Hash do bloco da transação |
| `eip155:51`, `eip155:50`, `eip155:80002` e `eip155:7295799` | `logIndex` | `uint256` | Índice do log de transferência no bloco |
| `eip155:7295799` | `verificationScope` | `string` | Como a transação foi verificada |
| `xrpl:testnet` | `ledgerHash` | `bytes32` | Hash do ledger da transação |
| `xrpl:testnet` | `sequence` | `uint32` | Sequence da conta na transação |
| `stellar:testnet` | `ledgerHash` | `bytes32` | Hash do ledger da transação |
| `stellar:testnet` | `sequence` | `uint64` | Sequence da conta na transação |

Só entram no schema os dados que não têm campo fixo na transação. Tipo da transação, número do bloco ou ledger, emissor e código do ativo vão em `txType`, `blockNumber`, `assetIssuer` e `assetCode`. Por isso a Rayls não tem chaves para o contrato do token nem para o símbolo.

A Rayls é registrada com o genesis hash zerado, porque ele não vem nos dados de origem.

### 4. Registrar stablecoins

Em `.\smart-contracts`:

```powershell
npx hardhat run scripts/register-stablecoins.ts --network sepolia
```

Registra no `FundRegistry`, no endereço `fundRegistryAddress`, os stablecoins usados pelos fundos. Um stablecoin precisa estar registrado antes dos fundos que o usam.

| Símbolo | Rede | Endereço do token | Decimais |
|---|---|---|---|
| `BRL-CVM` | `eip155:51` | `0x243e98638D619eB6f10eaBbaCfC071f318D5e9d0` | 18 |
| `BRL1` | `eip155:80002` | `0x25fC15B20F67049249FF70BB8A846e66BE07693C` | 18 |
| `BRL-CVM-DEV` | `eip155:50` | `0x490590Eab907C4aF8aF845049FC7ac2F97e535F6` | 18 |

Para acrescentar um stablecoin, inclua-o na lista `STABLECOINS` do script e rode de novo. Os já registrados são pulados, então o script pode ser executado quantas vezes for preciso.

O que o script exige:

- **Os contratos publicados.** Com `fundRegistryAddress` vazio, ele para e pede o deploy.
- **As redes registradas.** A rede de cada stablecoin precisa existir no `MultiChainTxRegistry`. Se faltar alguma, o script para antes de enviar qualquer transação e pede o registro de redes do passo 3.
- **Uma conta operadora.** Só contas com `OPERATOR_ROLE` no `FundRegistry` registram stablecoins. Se a conta que roda o script for admin do `FundRegistry` e ainda não for operadora, o script concede o papel a ela e avisa. Qualquer outra conta precisa receber o papel antes, de um admin, com `grantRole`.

Um stablecoin registrado não pode ser alterado. Se o símbolo ou os decimais de um já registrado forem diferentes dos da lista, o script avisa, mas não consegue corrigir.

### 5. Publicar a estrutura de integração com Chainlink CRE

```powershell
cd smart-contracts
npx hardhat run scripts/deploy-cre-receiver.ts --network sepolia
```

Publica o `MultiChainTxReceiver`, o contrato por onde um workflow do Chainlink CRE grava no `MultiChainTxRegistry`. O funcionamento dele está em [Registrando transações com Chainlink CRE](#registrando-transações-com-chainlink-cre). Rode depois do passo 2: o script usa o `MultiChainTxRegistry` do `project.config.json` e para se ele ainda não foi publicado.

Dados do Chainlink CRE na Ethereum Sepolia:

| | |
|---|---|
| Chain name | `ethereum-testnet-sepolia` |
| Ethereum Sepolia Mock Forwarder Address | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| Ethereum Sepolia Forwarder Address | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |

Os endereços vêm da documentação do Chainlink CRE, conferida em 07/10/2026. Para confirmar antes de publicar um workflow:

- [Forwarder Directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts): lista o chain name e os dois forwarders de cada rede. O Mock Forwarder está em "Simulation Forwarders", na tabela "Simulation Testnets". O Forwarder está em "Production Forwarders", na tabela "Testnets". Nas duas, procure a linha "Ethereum Sepolia".
- [Building Consumer Contracts](https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts): explica o contrato receptor e a diferença entre simulação e produção.
- Forwarder no Etherscan: [0xF8344CFd5c43616a4366C34E3EEE75af79a74482](https://sepolia.etherscan.io/address/0xF8344CFd5c43616a4366C34E3EEE75af79a74482).

**O que é o forwarder.** É o contrato da Chainlink que entrega os relatórios do workflow ao receptor. O receptor só aceita chamadas dele. Por isso, a escolha do forwarder define de quem o receptor aceita dados.

**A diferença entre o mock e o forwarder de verdade**

| | Mock Forwarder | Forwarder |
|---|---|---|
| Nome do contrato | `MockKeystoneForwarder` | `KeystoneForwarder` |
| Quem usa | o comando `cre workflow simulate --broadcast`, na sua máquina | workflows publicados, rodando na rede de oráculos |
| De onde vem o relatório | da simulação local | da rede de oráculos, com as assinaturas conferidas pelo forwarder antes da entrega |
| Identidade do workflow | não envia | envia o id, o nome e o dono do workflow |
| Para que serve | testar o caminho completo até o contrato, com transações reais na testnet | operação |

Um receptor que confia no mock serve só para testes. O que chega por ele não passou pela rede de oráculos, então não deve ser tratado como dado verificado. E, como o mock não envia a identidade do workflow, as restrições `setExpectedWorkflowId`, `setExpectedAuthor` e `setExpectedWorkflowName` precisam ficar desligadas enquanto ele for o forwarder: com elas ligadas, todo relatório da simulação é recusado.

**Qual forwarder o script usa.** Depende do campo `creForwarderAddress` do [project.config.json](../project.config.json):

| `creForwarderAddress` | Receptor novo | Receptor já publicado |
|---|---|---|
| vazio | publicado com o Mock Forwarder | o forwarder dele não é alterado |
| preenchido | publicado com esse endereço | atualizado para esse endereço, com `setForwarderAddress` |

Com o campo vazio, o script nunca mexe no forwarder de um receptor que já existe. Isso evita que um receptor de produção volte para o mock só porque o campo ficou em branco.

**Quando trocar para o Ethereum Sepolia Forwarder Address.** Troque quando for publicar o workflow com `cre workflow deploy`, isto é, quando ele deixar de rodar em simulação na sua máquina e passar a rodar na rede de oráculos. Enquanto você só simula, fique no mock.

O caminho recomendado:

1. Publique o receptor com `creForwarderAddress` vazio. Ele nasce com o Mock Forwarder.
2. Simule o workflow com `cre workflow simulate --broadcast` até os relatórios chegarem e as transações serem registradas.

#### Deploy em Chainlink CRE
3. Preencha `creForwarderAddress` com `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` no `project.config.json`.
4. Rode o script de novo. Ele troca o forwarder do receptor já publicado, sem publicar outro.
5. Publique o workflow e restrinja o receptor a ele, com `setExpectedWorkflowId` ou `setExpectedAuthor`.

> Depois do passo 4, o receptor deixa de aceitar a simulação. Para voltar a simular, preencha `creForwarderAddress` com o endereço do mock e rode o script, ou publique um segundo receptor só para testes.

O que mais o script faz:

- **Reaproveita o receptor.** Com `multiChainTxReceiverAddress` preenchido, ele não publica outro. Com o campo vazio, publica, grava o endereço no arquivo e verifica no Etherscan. Para publicar de novo, apague o campo.
- **Aponta o receptor para o `OrderRegistry` e o `FundRegistry`** do `project.config.json`, com `setOrderRegistry` e `setFundRegistry`. Se um deles for publicado de novo, basta rodar o script outra vez para o receptor passar a usar o novo.
- **Concede os papéis**: `RELAYER_ROLE` no `MultiChainTxRegistry` e `OPERATOR_ROLE` no `OrderRegistry` e no `FundRegistry`. Cada concessão só é feita se a conta for admin do contrato em questão. Se não for, o script mostra a chamada que um admin precisa fazer.
- **Confere a ligação.** Se o receptor do arquivo estiver ligado a outro `MultiChainTxRegistry`, o script para e pede para apagar o campo.
- **Mostra o estado final**: o forwarder em uso, se é o mock ou o de verdade, e se há restrição de workflow. Com o forwarder de verdade e sem restrição, ele avisa que qualquer workflow consegue gravar.

O script pode ser executado quantas vezes for preciso: ele só envia as transações que ainda faltam.

### 6. Publicar tudo de uma vez

Se você já conhece o projeto e quer agilizar a publicação, o script [scripts/deploy-and-setup-all.ts](scripts/deploy-and-setup-all.ts) roda os cinco passos anteriores em sequência, com um comando só:

```powershell
npx hardhat run scripts/deploy-and-setup-all.ts --network sepolia
```

Rode de dentro de `smart-contracts/`, com o `.env` e o `project.config.json` da raiz preenchidos como descrito em [Configuração](#configuração).

| Passo | O que o script executa |
|---|---|
| 1 | `npx hardhat build` |
| 2 | `npx hardhat deploy --network sepolia` |
| 3 | `npx hardhat run scripts/register-chains.ts --network sepolia` |
| 4 | `npx hardhat run scripts/register-stablecoins.ts --network sepolia` |
| 5 | `npx hardhat run scripts/deploy-cre-receiver.ts --network sepolia` |

A saída de cada um aparece no terminal, depois de uma linha `=== Step N of 5 ===`.

Sem `--network`, os passos rodam na rede simulada do Hardhat. Lá cada passo começa de uma rede vazia e nada é gravado no arquivo. Serve só para conferir que os cinco rodam.

Depois do script, copie os endereços para o workflow do Chainlink CRE. Rode da raiz do repositório:

```powershell
npm run workflow:sync-config
```

## Testes locais

Os testes automatizados rodam na rede simulada do Hardhat, sem precisar do `.env`:

```sh
npm test
```

Há uma suíte por contrato:

- [test/MultiChainTxRegistry.test.ts](test/MultiChainTxRegistry.test.ts) cobre controle de acesso, registro de redes, schema de argumentos extras, registro e atualização de transações, funções de leitura e um cenário completo com as três redes de [MultiChainTxRegistry.md](MultiChainTxRegistry.md).
- [test/FundRegistry.test.ts](test/FundRegistry.test.ts) cobre operadores, cadastro de stablecoins, registro de fundos e da transação de criação, e as consultas de fundo.
- [test/OrderRegistry.test.ts](test/OrderRegistry.test.ts) cobre o deploy ligado ao `FundRegistry`, os papéis de transação, registro de ordens, validação do intent contra o fundo, a lista de transações de cada ordem, atualizações de evidência, status e progresso, e um cenário com dois fundos e ordens em XRPL e Stellar.
- [test/MultiChainTxReceiver.test.ts](test/MultiChainTxReceiver.test.ts) cobre a entrada pelo Chainlink CRE: quem pode entregar relatórios, registro e atualização de status por relatório, proteção contra repetição, checagens de identidade do workflow e configuração. Nos testes, uma conta comum faz o papel do forwarder.
- [test/MultiChainTxReceiver.links.test.ts](test/MultiChainTxReceiver.links.test.ts) cobre os relatórios que gravam no `OrderRegistry` e no `FundRegistry`: registro de fundo e de ordem, progresso da ordem, transações ligadas a ordens e a fundos, os papéis exigidos em cada contrato, a configuração dos dois registries no receptor e um cenário em que um fundo e uma ordem são mantidos só por relatórios.
- [test/Workflow.e2e.test.ts](test/Workflow.e2e.test.ts) cobre o workflow do Chainlink CRE de ponta a ponta: monta os relatórios com o código de [../workflow-registry/lib/](../workflow-registry/lib/) a partir das respostas de [query-json/](../query-json/) e os entrega aos contratos. É pulado quando as dependências do workflow não estão instaladas. Para instalar, rode `bun install --cwd ./workflow-registry` da raiz do repositório.
- [test/helpers/fundOrder.ts](test/helpers/fundOrder.ts) guarda os dados de exemplo e as fixtures usados pelas duas suítes acima, montados a partir de [query-json/](../query-json/).

O deploy e os scripts de registro rodam sem `--network` na rede simulada do próprio Hardhat, sem precisar do `.env`:

```sh
npx hardhat deploy
npx hardhat run scripts/register-chains.ts
npx hardhat run scripts/register-stablecoins.ts
npx hardhat run scripts/deploy-cre-receiver.ts
```

Localmente, todos ignoram os endereços do `project.config.json` e publicam contratos novos a cada execução. Cada execução é independente: a rede simulada não guarda nada entre um comando e outro. A verificação é pulada, nada é gravado no arquivo e nenhuma confirmação é pedida.

## Perfis e Permissões

Há dois papéis:

- **Admin** (`DEFAULT_ADMIN_ROLE`) — quem fez o deploy. Registra redes, define o schema de argumentos extras de cada rede e gerencia os relayers.
- **Relayers** (`RELAYER_ROLE`) — endereços autorizados por um admin. Registram transações e atualizam o status delas.

O controle de acesso é o `AccessControl` do [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/5.x/access-control#role-based-access-control), com uma proteção a mais para o admin, descrita em [Controle de acesso](#controle-de-acesso).

| Função | Quem | O que faz |
|---|---|---|
| `grantRole` / `revokeRole` com `RELAYER_ROLE` | admin | Autoriza ou revoga um relayer |
| `registerChain` | admin | Adiciona uma rede. O id dela é o `keccak256` da string de rede normalizada |
| `registerSchemaKey` | admin | Declara uma chave de argumento extra aceita pela rede, opcionalmente obrigatória |
| `setSchemaKeyActive` | admin | Desativa ou reativa uma chave do schema |
| `registerTx` | relayer | Grava uma transação e seus argumentos extras |
| `updateTxStatus` | relayer | Altera o status de uma transação (`PENDING`, `CONFIRMED`, `FAILED`) |

O que saber antes de integrar:

- **Sempre existe pelo menos um admin.** Um admin não consegue renunciar ao papel nem revogá-lo de si mesmo. Os detalhes estão em [Controle de acesso](#controle-de-acesso).
- **Chamadas sem permissão revertem com o erro `AccessControlUnauthorizedAccount(conta, papel)`.** Os textos `Not owner`, `Not relayer` e `Not operator` não existem mais.

- **As strings de rede são normalizadas** (minúsculas, sem espaços em branco) antes do hash. Use `computeChainId` para obter o id de uma rede.
- **Duplicatas são rejeitadas.** Um hash de transação só pode ser registrado uma vez por rede; a comparação ignora maiúsculas e minúsculas.
- **Os argumentos extras são validados.** O `registerTx` reverte com chave desconhecida, desativada ou repetida, ou quando falta uma chave obrigatória. Registre as chaves da rede com `registerSchemaKey` antes de enviar transações que as usem.
- **Os valores vão na menor unidade** da rede de origem (wei, stroops etc.).

Funções de leitura: `getTx`, `getExtraArgs`, `getSchema`, `getChainCount` e os mappings públicos `chains`, `txIndex`, `txIdsByChain` e `txIdsByAddress`.

Exemplos de preenchimento de todas as structs, montados com dados reais, estão em [MultiChainTxRegistry.md](MultiChainTxRegistry.md).

### Controle de acesso

Os três contratos usam o `AccessControl` do OpenZeppelin, por meio de [contracts/AdminProtected.sol](contracts/AdminProtected.sol). Não há mais owner.

| Papel | Onde existe | O que pode fazer |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | nos três | Conceder e revogar papéis. No `MultiChainTxRegistry`, registrar redes e schemas. No `OrderRegistry`, cadastrar papéis de transação |
| `RELAYER_ROLE` | `MultiChainTxRegistry` | Registrar transações e atualizar o status delas |
| `OPERATOR_ROLE` | `FundRegistry` e `OrderRegistry` | Carregar e atualizar stablecoins, fundos e ordens |

Quem publica um contrato recebe o `DEFAULT_ADMIN_ROLE` dele. O admin não recebe os outros papéis automaticamente: para carregar dados, ele precisa conceder o `OPERATOR_ROLE` a alguma conta, que pode ser ele mesmo.

Os papéis são geridos com as funções padrão do `AccessControl`:

| Função | Quem chama | O que faz |
|---|---|---|
| `grantRole(papel, conta)` | admin | Concede um papel |
| `revokeRole(papel, conta)` | admin | Revoga um papel |
| `renounceRole(papel, conta)` | a própria conta | Abre mão de um papel que ela tem |
| `hasRole(papel, conta)` | qualquer um | Consulta |

O identificador de cada papel vem do próprio contrato: `DEFAULT_ADMIN_ROLE()`, `RELAYER_ROLE()` e `OPERATOR_ROLE()`. Pode haver vários admins ao mesmo tempo.

**O admin nunca fica vazio.** O `AdminProtected` acrescenta duas travas ao `AccessControl`:

- `renounceRole` reverte com `Admin cannot renounce` quando o papel é o `DEFAULT_ADMIN_ROLE`.
- `revokeRole` reverte com `Admin cannot revoke itself` quando um admin tenta revogar o próprio `DEFAULT_ADMIN_ROLE`. Sem essa trava, revogar a si mesmo seria um jeito de contornar a primeira.

Um admin só pode ser removido por outro admin, então sempre sobra pelo menos um. As duas travas valem só para o papel de admin: relayers e operadores podem renunciar normalmente.

**Para passar o controle a outra conta**, são duas transações:

1. O admin atual concede o papel ao novo: `grantRole(DEFAULT_ADMIN_ROLE, novo)`.
2. O novo admin revoga o antigo: `revokeRole(DEFAULT_ADMIN_ROLE, antigo)`.

Entre os dois passos, as duas contas são admins. Se o endereço do passo 1 estiver errado, o admin atual continua com o controle e pode revogar o endereço errado.

## Registrando transações com Chainlink CRE

O [contracts/MultiChainTxReceiver.sol](contracts/MultiChainTxReceiver.sol) é o contrato que um workflow do Chainlink CRE usa para registrar transações, com a capacidade EVM Write. A transação pode ficar avulsa no `MultiChainTxRegistry`, ou ligada a uma ordem ou a um fundo.

```
workflow CRE ──relatório assinado──> forwarder ──onReport──> MultiChainTxReceiver
                                                                   │
                     transação avulsa ──────────────────────────────┼──> MultiChainTxRegistry
                     transação de uma ordem ──> OrderRegistry ──────┤
                     transação de criação de fundo ──> FundRegistry ─┘
```

1. O workflow monta o relatório e o envia com `writeReport`, tendo o `MultiChainTxReceiver` como destino.
2. O forwarder da Chainlink confere as assinaturas da rede de oráculos e chama `onReport` no receptor.
3. O receptor confere quem chamou e de qual workflow veio, decodifica o relatório e chama o contrato da ação pedida.

O receptor precisa de um papel em cada contrato que usa. O script de deploy do receptor concede os três:

| Papel | Onde | Para quais ações |
|---|---|---|
| `RELAYER_ROLE` | `MultiChainTxRegistry` | `REGISTER_TX` e `UPDATE_TX_STATUS` |
| `OPERATOR_ROLE` | `OrderRegistry` | `RECORD_ORDER_TX`, `REGISTER_ORDER` e `UPDATE_ORDER_PROGRESS` |
| `OPERATOR_ROLE` | `FundRegistry` | `RECORD_FUND_CREATION_TX` e `REGISTER_FUND` |

O receptor também precisa saber onde estão o `OrderRegistry` e o `FundRegistry`. Um admin informa com `setOrderRegistry` e `setFundRegistry`; o script de deploy faz isso com os endereços do `project.config.json`. Enquanto um deles não estiver definido, a ação correspondente reverte com `OrderRegistryNotSet` ou `FundRegistryNotSet`. Os dois precisam usar o mesmo `MultiChainTxRegistry` do receptor.

**Formato do relatório.** Todo relatório é a struct `Report` codificada com `abi.encode`:

| Campo | Tipo | Conteúdo |
|---|---|---|
| `targetChainId` | `uint256` | Chain id EVM da rede onde o receptor está. Sepolia: `11155111` |
| `timestamp` | `uint64` | Horário da execução do workflow, em segundos, pelo relógio da rede de oráculos |
| `action` | `uint8` | Número da ação, de `0` a `6`. Veja a tabela abaixo |
| `payload` | `bytes` | Argumentos da ação, também com `abi.encode` |

| Ação | `payload` | Chama |
|---|---|---|
| `0`, `REGISTER_TX` | `abi.encode(bytes32 chainId, TxInput t, ExtraArg[] extraArgs)` | `registerTx` no `MultiChainTxRegistry` |
| `1`, `UPDATE_TX_STATUS` | `abi.encode(uint256 txId, TxStatus status)` | `updateTxStatus` no `MultiChainTxRegistry` |
| `2`, `RECORD_ORDER_TX` | `abi.encode(string orderId, bytes32 role, OrderTxInput input, TxInput t, ExtraArg[] extraArgs)` | `recordOrderTx` no `OrderRegistry` |
| `3`, `RECORD_FUND_CREATION_TX` | `abi.encode(string fundId, TxInput t, ExtraArg[] extraArgs)` | `recordFundCreationTx` no `FundRegistry` |
| `4`, `REGISTER_FUND` | `abi.encode(FundInput f, TxInput creationTx, ExtraArg[] creationExtraArgs)` | `registerFund` no `FundRegistry` |
| `5`, `REGISTER_ORDER` | `abi.encode(string orderId, string fundId, bytes32 intentHash, OrderIntent intent, uint256 createdAt)` | `registerOrder` no `OrderRegistry` |
| `6`, `UPDATE_ORDER_PROGRESS` | `abi.encode(string orderId, OrderProgress progress, uint32 version, uint256 updatedAt)` | `updateOrderProgress` no `OrderRegistry` |

`TxInput` e `ExtraArg` são as structs de [contracts/MultiChainTypes.sol](contracts/MultiChainTypes.sol), com os campos na mesma ordem. O `chainId` do payload é o id da rede de origem da transação no registry, o `keccak256` do nome normalizado, como `eip155:51`. Não confundir com o `targetChainId`, que é a rede onde o receptor está.

**Fundos e ordens.** O workflow também registra o fundo e a ordem, e mantém o progresso da ordem:

| Para | Ação | Observações |
|---|---|---|
| registrar um fundo | `REGISTER_FUND` | O stablecoin do fundo precisa estar cadastrado. Com o hash de criação no `creationTx`, a transação de criação já é registrada e ligada; com o hash vazio, fica para depois |
| registrar uma ordem | `REGISTER_ORDER` | O fundo precisa estar registrado. Valem as mesmas checagens do intent contra o fundo |
| atualizar o progresso de uma ordem | `UPDATE_ORDER_PROGRESS` | A versão não pode diminuir e o `updatedAt` precisa ser maior que o anterior |

`FundInput` é a struct do `FundRegistry`, e `OrderIntent` e `OrderProgress` são do `OrderRegistry`. Os campos vão na mesma ordem das structs.

A ordem natural de uma carga feita só por relatórios é: `REGISTER_FUND`, `REGISTER_ORDER`, um `RECORD_ORDER_TX` para cada transação da ordem e `UPDATE_ORDER_PROGRESS` a cada mudança de etapa.

**Qual ação usar para uma transação.** Depende de a transação pertencer a uma ordem, a um fundo ou a nenhum dos dois:

| A transação é | Ação | O que fica ligado |
|---|---|---|
| a transferência, o lock ou a entrega de uma ordem | `RECORD_ORDER_TX` | a transação entra na lista da ordem, com o papel |
| a criação de um fundo já registrado | `RECORD_FUND_CREATION_TX` | a transação vira a transação de criação do fundo |
| nenhuma das duas | `REGISTER_TX` | nada: fica avulsa no registry |

Em `RECORD_ORDER_TX`, o `role` é o papel da transação em `bytes32`, como `TRANSFER`, `LOCK` ou `DELIVERY`, e o `input` é a struct `OrderTxInput` do `OrderRegistry`, com `connectorId`, `standard` e `disposition`. O `disposition` também vai em `bytes32`, como `LOCKED` ou `DELIVERED`, ou zerado para nenhum. O relatório não informa a rede: o `OrderRegistry` a tira do papel e do intent da ordem. A ordem precisa já estar registrada, senão o relatório reverte com `Unknown order`. Em `RECORD_FUND_CREATION_TX` vale o mesmo para o fundo, e a rede é a do fundo.

**A escolha é definitiva.** Uma transação gravada com `REGISTER_TX` não pode ser ligada depois a uma ordem ou a um fundo: a segunda tentativa reverte com `Tx already registered`. Para uma transação de ordem, use `RECORD_ORDER_TX` desde o início.

Por esses dois caminhos, o `registeredBy` da transação no registry é o `OrderRegistry` ou o `FundRegistry`, e não o receptor. O receptor aparece como operador no evento `OrderTxLinked`. Os eventos `OrderTxRecordedByWorkflow` e `FundCreationTxRecordedByWorkflow`, do próprio receptor, registram qual workflow enviou o relatório.

O workflow deste repositório fica em [../workflow-registry/](../workflow-registry/README.md). Ele lê a Observer API e envia os relatórios de fundos e ordens neste formato, com a codificação em [lib/encode.ts](../workflow-registry/lib/encode.ts). O trecho abaixo mostra a montagem de um relatório `REGISTER_TX` em TypeScript, com `viem`:

```typescript
import { encodeAbiParameters, parseAbiParameters } from "viem";

const TX_INPUT =
  "(uint8 status, string txHash, string from, string to, uint256 amount, string assetCode, " +
  "string assetIssuer, string txType, bytes data, string dataType, uint256 blockNumber, uint256 timestamp)";

// payload da ação REGISTER_TX
const payload = encodeAbiParameters(
  parseAbiParameters(`bytes32 chainId, ${TX_INPUT} t, (bytes32 key, bytes value)[] extraArgs`),
  [chainId, txInput, extraArgs],
);

// relatório completo
const encoded = encodeAbiParameters(
  parseAbiParameters("(uint256 targetChainId, uint64 timestamp, uint8 action, bytes payload)"),
  [{ targetChainId: 11155111n, timestamp: BigInt(runtime.now().getTime()) / 1000n, action: 0, payload }],
);

const report = runtime.report(prepareReportRequest(encoded)).result();
evmClient.writeReport(runtime, { receiver: multiChainTxReceiverAddress, report, gasConfig: { gasLimit } }).result();
```

**Proteção contra repetição.** Um relatório assinado pode ser entregue de novo por qualquer pessoa: em outra rede, ou na mesma rede depois de uma entrega que falhou. O receptor trata os três casos:

- **Outra rede**: `targetChainId` diferente da rede atual reverte com `WrongTargetChain`.
- **Registro repetido**: o `MultiChainTxRegistry` recusa um hash já registrado na mesma rede, com `Tx already registered`. Isso vale para as três ações que registram. Além disso, um fundo aceita uma só transação de criação, e a segunda tentativa reverte com `Creation tx already linked`.
- **Fundo ou ordem repetidos**: `REGISTER_FUND` e `REGISTER_ORDER` revertem com `Fund already registered` e `Order already registered`.
- **Progresso antigo**: o `OrderRegistry` só aceita versão que não diminui e `updatedAt` maior que o anterior. Um relatório de progresso repetido ou mais antigo reverte com `Stale version` ou `updatedAt not after previous`.
- **Status antigo**: uma atualização de status só é aceita se o `timestamp` for maior que o da última aceita para a mesma transação. Caso contrário reverte com `StaleStatusUpdate`. Sem isso, um relatório antigo poderia trazer de volta um status anterior.

Um `timestamp` à frente do bloco além da tolerância reverte com `TimestampInFuture`. A tolerância cobre a diferença entre o relógio dos oráculos e o da rede. Ela fica em `maxFutureSkew`, em segundos, e começa em 5 minutos no deploy. Um admin a altera com `setMaxFutureSkew`. Zero recusa qualquer horário à frente do bloco. Não há limite máximo, mas um valor alto enfraquece a proteção: um relatório com horário muito no futuro travaria as atualizações de status seguintes daquela transação até esse horário chegar.

**Quem pode entregar relatórios.** Só o forwarder configurado chama `onReport`. Qualquer outra conta, inclusive o admin, recebe `InvalidSender`. O forwarder nunca pode ser o endereço zero.

Há dois forwarders na Ethereum Sepolia: o de simulação e o de verdade. Os endereços, a diferença entre eles e o momento de trocar estão em [5. Publicar a estrutura de integração com Chainlink CRE](#5-publicar-a-estrutura-de-integração-com-chainlink-cre).

**Restringir a um workflow.** Só com o forwarder, qualquer workflow de qualquer conta consegue entregar relatórios ao receptor. Com o `OPERATOR_ROLE` nos dois registries, isso significa criar fundos e ordens, alterar o progresso de qualquer ordem e gravar transações em qualquer uma. Para produção, um admin deve restringir:

| Função | Efeito |
|---|---|
| `setExpectedWorkflowId(id)` | Aceita só esse workflow. É a checagem mais estrita |
| `setExpectedAuthor(conta)` | Aceita só workflows dessa conta |
| `setExpectedWorkflowName(nome)` | Aceita só workflows com esse nome. Exige `setExpectedAuthor` junto |

Passar zero, ou nome vazio, desliga a checagem. Durante a simulação essas três precisam ficar desligadas: o forwarder de simulação não envia a identidade do workflow, e o relatório seria recusado.

**O que este caminho não cobre.** O receptor não registra redes, chaves de schema nem stablecoins, não cadastra papéis nem dispositions de transação e não atualiza o `disposition` de uma transação já gravada. Essas cargas continuam sendo feitas pelos scripts, por contas com `OPERATOR_ROLE` ou pelo admin. Em particular, o stablecoin de um fundo precisa estar cadastrado antes do `REGISTER_FUND`.

## Fundos e ordens

Dois contratos complementam o registro de transações:

- **`FundRegistry`** guarda stablecoins e fundos.
- **`OrderRegistry`** guarda as ordens de cada fundo e a lista de transações de cada ordem. Ele lê os fundos do `FundRegistry`.

A ordem de deploy é `MultiChainTxRegistry`, depois `FundRegistry`, depois `OrderRegistry`. O `OrderRegistry` recebe os endereços dos outros dois e recusa um `FundRegistry` que use outro `MultiChainTxRegistry`.

Depois do deploy, um admin do `MultiChainTxRegistry` precisa conceder o `RELAYER_ROLE` aos dois. Sem isso, o registro de transações reverte com `AccessControlUnauthorizedAccount`. A tarefa de deploy já faz essa concessão quando roda com uma conta admin. Cada um dos dois contratos tem os seus próprios admins e operadores: o papel `OPERATOR_ROLE` de um não vale no outro.

### Papéis e dispositions das transações de ordem

Cada transação de uma ordem (`OrderTx`) tem dois rótulos, e os dois vêm de listas mantidas pelo admin do `OrderRegistry`. Novos valores entram sem publicar o contrato de novo.

| | Papel (`role`) | Disposition |
|---|---|---|
| O que diz | o que a transação é dentro da ordem | o que a transação fez pela ordem |
| Cadastrados no deploy | `TRANSFER`, `LOCK`, `DELIVERY` | `LOCKED`, `DELIVERED` |
| Efeito no contrato | decide a rede em que a transação é registrada | nenhum, é só um rótulo conferido contra a lista |
| Pode ficar vazio | não | sim: `bytes32(0)` significa "sem disposition" |
| Muda depois de gravado | não | sim, com `updateOrderTxEvidence` |

Os valores são nomes curtos em `bytes32`, como `bytes32("LOCKED")`.

| Função | Quem chama | O que faz |
|---|---|---|
| `registerOrderTxRole(papel, descrição, naRedeDeDestino)` | admin | Cria um papel |
| `setOrderTxRoleActive(papel, ativo)` | admin | Desativa ou reativa um papel |
| `listOrderTxRoles()` | qualquer um | Lista os papéis, inclusive os desativados |
| `registerOrderTxDisposition(disposition, descrição)` | admin | Cria um disposition |
| `setOrderTxDispositionActive(disposition, ativo)` | admin | Desativa ou reativa um disposition |
| `listOrderTxDispositions()` | qualquer um | Lista os dispositions, inclusive os desativados |

Ao gravar ou atualizar uma transação, o contrato confere os dois:

- Papel desconhecido reverte com `Unknown role`, e desativado com `Role deprecated`.
- Disposition desconhecido reverte com `Unknown disposition`, e desativado com `Disposition deprecated`. O valor vazio é sempre aceito e não faz parte da lista. É o caso da confirmação de lock, que não tem evidência própria.

Desativar não apaga nada: as transações que já têm o papel ou o disposition continuam com ele. Um valor cadastrado não pode ser alterado nem removido, só desativado.

O contrato não confere coerência entre os dois rótulos. Nada impede gravar uma transação com papel `DELIVERY` e disposition `LOCKED`. A explicação completa está em [Observações](#observações).

### Order, OrderIntent e OrderTx

No `OrderRegistry`, cada ordem é descrita por três structs, guardadas sob a mesma chave, o `orderKey` (o `keccak256` do `orderId` normalizado). Uma ordem tem exatamente um `Order`, exatamente um `OrderIntent` e uma lista de zero ou mais `OrderTx`.

```
orderKey ──┬── Order          1      identidade e estado atual
           ├── OrderIntent    1      o que foi pedido
           └── OrderTx[]      0..n   o que aconteceu on-chain
```

| | `Order` | `OrderIntent` | `OrderTx` |
|---|---|---|---|
| O que é | identidade e estado | o pedido | uma transação da ordem |
| Quantas por ordem | 1 | 1 | 0 ou mais |
| Criada em | `registerOrder` | `registerOrder` | `recordOrderTx` |
| Muda depois? | sim: `progress`, `version` e `updatedAt` | nunca | só o `disposition`, para outro valor cadastrado |
| Campos | 8 | 7 | 7 |

Como elas se ligam:

- **`Order` e `OrderIntent` nascem juntos**, na mesma chamada de `registerOrder`. Os dois têm `orderId`, e o contrato exige que correspondam.
- **`OrderTx` é acrescentada depois**, uma por transação observada. Cada entrada recebe do contrato o `orderId`, copiado de `Order`, e a posição na lista serve de identificador.
- **Nenhuma struct aponta para outra por campo de chave.** O vínculo é o mapping: as três são guardadas com o mesmo `orderKey`.

O que cada uma fornece às outras:

- **`OrderIntent` decide a rede de cada `OrderTx`.** O papel informado em `recordOrderTx` escolhe entre `sourceChainId` e `destinationChainId` do intent.
- **`Order` prova que a ordem existe.** Toda função de `OrderTx` começa localizando o `Order`.
- **`OrderTx` aponta para o `MultiChainTxRegistry`** pelo `txId`. Além dela, só `Order.fundKey` liga a ordem a outro contrato, o `FundRegistry`.

O ciclo de vida de uma ordem:

1. `registerOrder` cria `Order` e `OrderIntent`. A lista de `OrderTx` começa vazia.
2. Cada `recordOrderTx` acrescenta uma entrada, com um papel e um disposition cadastrados. Veja [Papéis e dispositions das transações de ordem](#papéis-e-dispositions-das-transações-de-ordem).
3. `updateOrderProgress` altera o `Order`. `updateOrderTxEvidence` altera uma `OrderTx`.

O que o contrato não amarra:

- **`progress` não depende das transações.** Nada impede marcar uma ordem como `ACQUIRED_WITH_LOCK` com a lista vazia, nem deixá-la em `AWAITING_ORIGIN` com três transações. O `progress` é o que o operador informa.
- **`OrderTx` não é conferida contra o intent.** O valor, o destinatário e o ativo de uma transação não são comparados com nada. Esses dados ficam só na transação, no `MultiChainTxRegistry`.
- **`validUntil` não é aplicado.** Uma transação pode ser registrada depois do prazo do intent.
- **`intentHash` não é verificado.** O contrato só garante que o mesmo valor não seja usado em duas ordens; ele não calcula o hash a partir do `OrderIntent`.

Em resumo: o intent é o pedido fixo, a ordem é o estado declarado e as transações são os fatos. O contrato guarda os três lado a lado e garante que pertencem à mesma ordem, mas a coerência entre eles depende de quem faz a carga.

### Consultar várias ordens de uma vez

`getOrderSyncStates(orderIds)` devolve, em uma só chamada, o resumo de várias ordens, na mesma sequência dos ids recebidos:

| Campo | Significado |
|---|---|
| `registered` | Se a ordem está registrada. Quando é `false`, os outros campos vêm vazios |
| `progress`, `version` | Progresso e versão gravados |
| `createdAt`, `updatedAt` | Datas gravadas |
| `roles` | Papel de cada transação já gravada, na sequência em que foram gravadas |

Um id desconhecido não reverte: a entrada dele vem com `registered` falso. Só um id vazio reverte, com `Empty id`.

A função existe para quem tem poucas chamadas disponíveis, como o [workflow do Chainlink CRE](../workflow-registry/README.md#limites-de-uma-execução), que pode fazer 15 leituras por execução. Com ela, o workflow descobre o que falta gravar em todas as ordens de um fundo com uma leitura, em vez de duas por ordem.

## Estrutura do projeto

| Caminho | Conteúdo |
|---|---|
| [contracts/MultiChainTxRegistry.sol](contracts/MultiChainTxRegistry.sol) | O contrato |
| [contracts/MultiChainTypes.sol](contracts/MultiChainTypes.sol) | Structs e enums comuns aos dois contratos: `ChainInfo`, `TxStatus`, `BaseTx`, `TxInput`, `ExtraArg` e `ExtraArgSchema` |
| [contracts/AdminProtected.sol](contracts/AdminProtected.sol) | `AccessControl` do OpenZeppelin com um admin que nunca fica vazio. Base dos três contratos |
| [contracts/RegistryBase.sol](contracts/RegistryBase.sol) | Base comum de `FundRegistry` e `OrderRegistry`: papel de operador, chave por id e ligação com o `MultiChainTxRegistry` |
| [contracts/FundRegistry.sol](contracts/FundRegistry.sol) | Stablecoins e fundos; a transação de criação do fundo vai para o `MultiChainTxRegistry` |
| [contracts/MultiChainTxReceiver.sol](contracts/MultiChainTxReceiver.sol) | Entrada do Chainlink CRE: recebe relatórios do forwarder e grava no `MultiChainTxRegistry` |
| [contracts/CreReceiver.sol](contracts/CreReceiver.sol) | Base de um receptor do CRE: confere o forwarder e a identidade do workflow |
| [contracts/interfaces/IReceiver.sol](contracts/interfaces/IReceiver.sol) | Interface que o forwarder do CRE chama |
| [contracts/OrderRegistry.sol](contracts/OrderRegistry.sol) | Ordens dos fundos do `FundRegistry`; cada transação de ordem vai para o `MultiChainTxRegistry` |
| [test/](test/) | Testes automatizados, um arquivo por contrato |
| [tasks/deploy.ts](tasks/deploy.ts) | Tarefa `deploy`: publicação, verificação e relayers dos três contratos |
| [scripts/deploy-cre-receiver.ts](scripts/deploy-cre-receiver.ts) | Publica o `MultiChainTxReceiver` e mantém o forwarder dele igual ao do `project.config.json` |
| [scripts/deploy-and-setup-all.ts](scripts/deploy-and-setup-all.ts) | Roda todos os passos de publicação em sequência: compilar, deploy, redes, stablecoins e receptor do CRE |
| [scripts/register-chains.ts](scripts/register-chains.ts) | Registro das redes rastreadas e das chaves de schema de cada rede |
| [scripts/register-stablecoins.ts](scripts/register-stablecoins.ts) | Registro dos stablecoins no `FundRegistry` |
| [scripts/lib/chains.ts](scripts/lib/chains.ts) | Lista das redes rastreadas e das chaves de schema de cada rede, usada pelos scripts e pelos testes |
| [scripts/lib/check-env.ts](scripts/lib/check-env.ts) | Checagem da chave privada, usada pelos scripts |
| [scripts/lib/send-tx.ts](scripts/lib/send-tx.ts) | Envio de transação com nova tentativa quando o nó acusa uma transação pendente da conta |
| [project-config.ts](project-config.ts) | Lê o `project.config.json` da raiz e expõe a configuração tipada para o Hardhat e os scripts |
| [../project.config.json](../project.config.json) | Configuração pública, na raiz do repositório |
| `../.env` | Segredos, na raiz do repositório. Não é commitado |
| `../project.backup.config.json` | Histórico dos endereços substituídos por `--only` ou `--force`. Criado pela tarefa `deploy` na primeira substituição |
| [hardhat.config.ts](hardhat.config.ts) | Compilador, rede e verificação |
| [MultiChainTxRegistry.md](MultiChainTxRegistry.md) | Exemplos de dados |
| [../query-json/](../query-json/) | Respostas de API de exemplo, de onde os exemplos foram tirados. Fica na raiz do repositório, fora desta pasta |
| [../workflow-registry/](../workflow-registry/README.md) | Workflow do Chainlink CRE que envia os relatórios ao `MultiChainTxReceiver`. Fica na raiz do repositório, fora desta pasta |

## Status

Os quatro contratos têm testes automatizados (`npm test`): `MultiChainTxRegistry`, `FundRegistry`, `OrderRegistry` e `MultiChainTxReceiver`.

Os quatro estão publicados na Ethereum Sepolia, nos endereços do [project.config.json](../project.config.json). As redes, as chaves de schema e os stablecoins estão registrados. O receptor usa o forwarder de simulação do Chainlink CRE.

Ainda não há fundos, ordens nem transações registrados: essa carga é feita pelo [workflow do Chainlink CRE](../workflow-registry/README.md), que ainda não foi executado com `--broadcast`.

## Observações

### Comandos no Powershell

A raiz do repositório tem atalhos com `npm run`, mas no PowerShell eles perdem as opções sem avisar se o `--` não for digitado entre aspas. O jeito recomendado, sem essa armadilha, está em [Como digitar os comandos, com exemplos](#como-digitar-os-comandos-com-exemplos).

**Alternativa: da raiz do repositório, com `npm run`.** Evite este jeito no PowerShell quando houver opções. Ele existe por conveniência, mas tem uma armadilha: há um `--` entre o nome do atalho e as opções, que avisa ao `npm` que o que vem depois é para o deploy, e não para o próprio `npm`.

No **bash** (Git Bash, Linux, macOS), o `--` vai sem aspas:

```sh
npm run contracts:deploy -- --network sepolia
npm run contracts:deploy -- --network sepolia --only order-registry --yes
npm run contracts:deploy -- --network sepolia --force --yes
```

No **PowerShell**, o `--` precisa ir entre aspas simples, assim: `'--'`.

```powershell
npm run contracts:deploy '--' --network sepolia
npm run contracts:deploy '--' --network sepolia --only order-registry --yes
npm run contracts:deploy '--' --network sepolia --force --yes
```

**O que acontece no PowerShell sem as aspas.** O PowerShell descarta o `--`, o `npm` fica com as opções para si e o deploy roda sem nenhuma delas. O comando não dá erro: ele roda na rede simulada, como se você não tivesse passado nada. Dá para reconhecer pela saída:

```text
PS> npm run contracts:deploy -- --only order-registry --yes
npm warn invalid config only="order-registry" set in command line options

> hardhat deploy                              <- as opções sumiram
Network: default | deployer: 0xf39F...        <- rede simulada, não a sepolia
```

Com as aspas, a mesma linha mostra as opções chegando ao deploy:

```text
PS> npm run contracts:deploy '--' --only order-registry --yes

> hardhat deploy --only order-registry --yes  <- as opções chegaram
```

Antes de confiar em um deploy feito com `npm run`, confira essas duas linhas: a que começa com `> hardhat deploy` deve trazer as suas opções, e a linha `Network:` deve mostrar a rede que você pediu. Por causa dessa falha silenciosa, prefira o jeito recomendado, que não tem o `--`.

O mesmo vale para qualquer atalho da raiz que receba opções, como `npm run contracts:register-chains '--' --network sepolia`.

### Erro com conta delegada: in-flight transaction limit

Ao rodar o deploy ou um script de registro em uma rede real, o comando pode parar no meio com este erro:

```text
ProviderError: in-flight transaction limit reached for delegated accounts
```

O erro não vem dos contratos nem dos dados. Ele vem do nó da rede, e depende da conta usada em `ETH_PRIVATE_KEY`.

**O que é uma conta delegada.** Uma conta comum, controlada só por chave privada, não tem código. A EIP-7702 permite que ela aponte para um contrato e passe a se comportar como ele. É o que as carteiras chamam de "smart account". A conta e o endereço continuam os mesmos.

**Por que o erro acontece.** Os nós aceitam só uma transação pendente por vez de uma conta delegada. Os scripts enviam várias transações em sequência, esperando cada uma ser minerada. Mas um RPC público distribui as chamadas entre vários nós, e o nó que recebe a transação seguinte pode ainda não ter visto a anterior minerada. Para ele há uma pendente, e a nova é recusada.

**O que os scripts fazem.** Quando esse erro aparece, a transação é enviada de novo depois de uma pausa de 6 segundos, até 10 vezes, com um aviso na saída. A lógica está em [scripts/lib/send-tx.ts](scripts/lib/send-tx.ts). Se mesmo assim o comando parar, rode-o de novo: o deploy e os scripts de registro pulam o que já foi feito e continuam de onde pararam.

**Como saber se a conta está delegada.** Consulte o código da conta com `eth_getCode`. Uma conta comum responde `0x`. Uma conta delegada responde `0xef0100` seguido do endereço do contrato para o qual ela delega.

**Como evitar o erro de vez.** Há duas saídas:

| | Usar uma conta sem delegação | Remover a delegação da conta |
|---|---|---|
| O que fazer | Trocar a chave em `ETH_PRIVATE_KEY` pela de uma conta comum | Voltar a conta para conta comum, pela carteira |
| Contratos já publicados | A conta nova não é admin deles. Um admin atual precisa conceder o papel de admin a ela, com `grantRole`, em cada contrato | Nada muda: o endereço e os papéis continuam os mesmos |
| Pode voltar a acontecer | Não | Sim, se a delegação for ativada de novo na carteira |

Remover a delegação é uma transação da própria conta que aponta a delegação para o endereço zero. Quem monta essa transação é a carteira, na opção de voltar para conta comum. A delegação vale por rede: removê-la na Sepolia não altera as outras redes.

Usar uma conta só para deploy tem uma vantagem a mais: a chave que fica no `.env` não é a da carteira do dia a dia.

### Papel e disposition não são conferidos um contra o outro

Papel e disposition são dois rótulos independentes de cada transação de ordem. O `OrderRegistry` confere cada um contra a sua própria lista, mas não confere se os dois combinam entre si. As listas e as funções de cadastro estão em [Papéis e dispositions das transações de ordem](#papéis-e-dispositions-das-transações-de-ordem).

| Rótulo | Pergunta que responde | Valores cadastrados no deploy |
|---|---|---|
| Papel | O que esta transação é na ordem? | `TRANSFER`, `LOCK`, `DELIVERY` |
| Disposition | O que ela fez pela ordem? | `LOCKED`, `DELIVERED` |

**As combinações que fazem sentido.** Nos dados de exemplo, os dois andam sempre juntos:

| Papel | Disposition esperado |
|---|---|
| `TRANSFER`, o envio do dinheiro ao escrow | `LOCKED` |
| `DELIVERY`, a entrega do ativo | `DELIVERED` |
| `LOCK`, a confirmação do lock | vazio |

**O que o contrato confere ao gravar uma transação:**

- O papel existe e está ativo.
- O disposition existe e está ativo, ou é vazio.

E só isso. Não há nenhuma regra do tipo "papel `DELIVERY` exige `DELIVERED`".

**O que isso permite.** Uma conta operadora, ou um workflow com erro, pode gravar:

- uma entrega com disposition `LOCKED`;
- uma transferência com `DELIVERED`;
- uma confirmação de lock com `DELIVERED`.

As três são aceitas sem erro e ficam gravadas como qualquer outra.

**Por que isso importa.** Quem lê os dados precisa escolher em qual rótulo confiar. Se um sistema perguntar "esta ordem já foi entregue?" olhando o disposition, e outro olhando o papel, os dois podem chegar a respostas diferentes para a mesma transação incoerente.

A rede não é afetada. Ela é decidida só pelo papel: uma transação com papel `DELIVERY` vai sempre para a rede de destino da ordem, seja qual for o disposition.

**Por que o contrato não confere.** É consequência de as duas listas serem abertas. O admin pode criar um papel `REFUND` e um disposition `REFUNDED` a qualquer momento, e o contrato não tem como saber sozinho quais pares são válidos. Para conferir, alguém teria de declarar essa relação.

**Como poderia ser conferido.** Nenhuma destas opções está implementada:

1. **Disposition esperado por papel.** Cada papel ganha um campo com o disposition que o acompanha, e `recordOrderTx` rejeita outro valor. É simples, mas cada papel fica com um só disposition possível, além do vazio.
2. **Lista de pares permitidos.** O admin cadastra quais combinações valem, como `DELIVERY` com `DELIVERED`. É mais flexível e custa uma estrutura e mais uma função de cadastro.
3. **Derivar o disposition do papel.** O disposition deixa de ser informado e passa a ser calculado. Elimina a incoerência de vez, mas `updateOrderTxEvidence` perde o sentido, já que não haveria o que atualizar.

Hoje a coerência depende de quem faz a carga, seja uma conta operadora ou o workflow do Chainlink CRE. Se os dois rótulos forem usados por sistemas diferentes para decidir algo, a opção 1 é a mais indicada. Se o disposition for só um registro informativo copiado dos dados de origem, deixar como está é aceitável.
