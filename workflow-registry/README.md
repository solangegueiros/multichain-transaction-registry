# workflow-registry — workflow do Chainlink CRE

Workflow do Chainlink CRE que lê os fundos e as ordens na Observer API e grava o que falta nos contratos deste repositório. É a parte que alimenta o `MultiChainTxRegistry`, o `FundRegistry` e o `OrderRegistry` sem intervenção manual.

## Índice

- [O que o workflow faz](#o-que-o-workflow-faz)
- [Requisitos](#requisitos)
- [Arquivos](#arquivos)
- [Configuração](#configuração)
- [Simulação local](#simulação-local)
- [Gravar na Sepolia](#gravar-na-sepolia)
- [Limites de uma execução](#limites-de-uma-execução)
- [Como os dados da API viram registros](#como-os-dados-da-api-viram-registros)
- [Testes](#testes)
- [Status](#status)

## O que o workflow faz

O gatilho é um cron. A cada disparo, para cada fundo configurado, o workflow:

1. Lê o fundo e as ordens dele na Observer API, com a chave guardada como segredo.
2. Lê no `FundRegistry` e no `OrderRegistry` o que já está registrado.
3. Envia um relatório ao `MultiChainTxReceiver` para cada coisa que falta, pelo EVM Write.

Os relatórios seguem esta ordem, porque cada um depende do anterior:

| Ordem | Ação do receptor | Quando é enviada |
|---|---|---|
| 1 | `REGISTER_FUND` | O fundo ainda não está no `FundRegistry` |
| 2 | `RECORD_FUND_CREATION_TX` | O fundo foi registrado sem a transação de criação e a API agora traz o hash |
| 3 | `REGISTER_ORDER` | A ordem ainda não está no `OrderRegistry` |
| 4 | `RECORD_ORDER_TX` com papel `TRANSFER` | A origem está `VERIFIED` e a transferência ainda não foi gravada |
| 5 | `RECORD_ORDER_TX` com papel `LOCK` | A API traz o `lockTxHash` e o lock ainda não foi gravado |
| 6 | `RECORD_ORDER_TX` com papel `DELIVERY` | O destino está `VERIFIED` e a entrega ainda não foi gravada |
| 7 | `UPDATE_ORDER_PROGRESS` | O progresso ou a versão da API são diferentes dos gravados |

O workflow não guarda nada entre uma execução e outra. O estado é o que está nos contratos. Por isso ele pode ser interrompido e retomado, e uma execução repetida não envia nada de novo.

O formato dos relatórios e as proteções do receptor estão no [README dos smart contracts](../smart-contracts/README.md#registrando-transações-com-chainlink-cre).

## Requisitos

- [CRE CLI](https://docs.chain.link/cre) com sessão ativa. Rode `cre login` e confira com `cre whoami`.
- [Bun](https://bun.sh) 1.2.21 ou mais novo.
- No `.env` da raiz do repositório, as variáveis abaixo. O modelo está em [../.env.example](../.env.example).

| Variável | Para que serve |
|---|---|
| `API_OBSERVER_KEY` | Chave da Observer API, enviada no cabeçalho `X-Observer-Key` |
| `CRE_ETH_PRIVATE_KEY` | Conta que o CLI usa para enviar transações na simulação com `--broadcast` e para publicar o workflow |

Instale as dependências, da raiz do repositório:

```bash
bun install --cwd ./workflow-registry
```

## Arquivos

| Caminho | Conteúdo |
|---|---|
| [main.ts](main.ts) | Ponto de entrada: cria o `Runner` com a validação da configuração |
| [workflow.ts](workflow.ts) | O workflow: gatilho cron, chamadas à API, leituras e escritas nos contratos |
| [lib/api.ts](lib/api.ts) | Reduz as respostas da API aos campos que os contratos guardam |
| [lib/plan.ts](lib/plan.ts) | Compara a API com os contratos e decide quais relatórios enviar |
| [lib/encode.ts](lib/encode.ts) | Codifica os relatórios no formato que o `MultiChainTxReceiver` decodifica |
| [lib/abi.ts](lib/abi.ts) | Funções de leitura dos contratos |
| [config/](config/) | Uma configuração por target |
| [scripts/sync-config.js](scripts/sync-config.js) | Copia os endereços dos contratos do `project.config.json` para as configurações |
| [workflow.yaml](workflow.yaml) | Targets do workflow no CRE CLI |
| [../project.yaml](../project.yaml) | RPC de cada target. Fica na raiz, que é a raiz do projeto CRE |
| [../secrets.yaml](../secrets.yaml) | Liga o segredo `OBSERVER_API_KEY` à variável `API_OBSERVER_KEY`. Não guarda valores |

Os arquivos de `lib/` não dependem do SDK do CRE. Por isso os testes do Hardhat conseguem usá-los para montar relatórios e entregá-los aos contratos.

## Configuração

Há três targets, cada um com o seu arquivo em [config/](config/):

| Target | Arquivo | Modo | Uso |
|---|---|---|---|
| `local-simulation` | `config.local-simulation.json` | `local-simulation` | Lê a API e mostra os relatórios que enviaria. Nunca grava |
| `staging-settings` | `config.staging.json` | `production` | Simulação com `--broadcast` na Sepolia, pelo forwarder de simulação |
| `production-settings` | `config.production.json` | `production` | Workflow publicado, pelo forwarder de verdade |

Campos comuns aos dois modos:

| Campo | Significado |
|---|---|
| `mode` | `local-simulation` ou `production` |
| `schedule` | Expressão cron de seis campos, com segundos. `0 */5 * * * *` dispara a cada 5 minutos |
| `apiBaseUrl` | Endereço da Observer API, sem barra no final |
| `apiClientId` | Valor do cabeçalho `X-Observer-Id` |
| `fundIds` | Fundos acompanhados, de 1 a 5 |
| `maxOrdersPerRun` | Quantas ordens de cada fundo recebem relatórios em uma execução, de 1 a 10 |

Campos só do modo `production`:

| Campo | Significado |
|---|---|
| `chainSelectorName` | Rede dos contratos no CRE: `ethereum-testnet-sepolia` |
| `targetChainId` | Chain id EVM dessa rede: `11155111`. Vai em todo relatório, e o receptor recusa outro valor |
| `receiverAddress` | `MultiChainTxReceiver` |
| `txRegistryAddress` | `MultiChainTxRegistry` |
| `fundRegistryAddress` | `FundRegistry` |
| `orderRegistryAddress` | `OrderRegistry` |
| `gasLimit` | Limite de gás de cada transação de relatório |
| `maxWritesPerRun` | Quantos relatórios são enviados em uma execução, de 1 a 10 |

A configuração é validada na partida. Um campo a mais, um campo faltando ou um endereço vazio impedem o workflow de rodar. O modo `local-simulation` não aceita endereços de contrato: sem eles o código não tem como gravar.

Os quatro endereços vêm do [project.config.json](../project.config.json) da raiz, que os scripts de deploy preenchem. Depois de publicar os contratos, copie-os para as duas configurações de produção, com o comando abaixo.

Execute na raiz do projeto:

```powershell
npm run sync-config
```

As duas já estão com os endereços dos contratos publicados na Sepolia. Rode o comando de novo sempre que um contrato for publicado outra vez.

## Simulação local

Rode da raiz do repositório, onde está o [project.yaml](../project.yaml):

```powershell
cre workflow simulate workflow-registry --target local-simulation --non-interactive --trigger-index 0
```

A simulação compila o workflow, dispara o cron uma vez e chama a Observer API de verdade. Ela não lê nem grava em nenhuma rede: trata tudo como não registrado e lista os relatórios que enviaria.

```text
[USER LOG] [local-simulation] would send REGISTER_FUND fund be6f2e8a-5474-43c7-a692-7918c37e3f42 (report of 1600 bytes)
[USER LOG] fund be6f2e8a-5474-43c7-a692-7918c37e3f42: 13 order(s) in the API, 2 with reports due
[USER LOG] [local-simulation] would send REGISTER_ORDER order 8fdac770-7ca3-4a1f-a283-33efa75c96ef (report of 864 bytes)
[USER LOG] [local-simulation] would send RECORD_ORDER_TX order 8fdac770-7ca3-4a1f-a283-33efa75c96ef TRANSFER (report of 2016 bytes)
...
[USER LOG] done: 4 fund(s), 32 order(s), 41 report(s) due, 0 sent, 0 deferred, 0 error(s); 12 API call(s), 0 chain read(s)
```

O CLI lê o `.env` da raiz do repositório. Para usar outro arquivo, passe o caminho com `-e`:

```powershell
cre workflow simulate workflow-registry --target local-simulation --non-interactive --trigger-index 0 -e ..\folder2\.env
```

Este target é só para simulação. Não o use com `--broadcast`, `deploy` nem outro comando de ciclo de vida.

## Gravar na Sepolia

### 1. Preparar os contratos

O workflow só grava depois que os contratos estão publicados e preparados. A sequência está no [README dos smart contracts](../smart-contracts/README.md#setup-smart-contracts):

1. Publicar os três registries.
2. Registrar as redes e as chaves de schema.
3. Registrar os stablecoins.
4. Publicar o `MultiChainTxReceiver`, com o forwarder de simulação.
5. Copiar os endereços para o workflow, com `npm run sync-config`.

Sem os passos 2 e 3 o workflow não envia o relatório do fundo. Ele confere antes e registra o erro no log, para não gastar uma transação que reverteria.

### 2. Simular sem enviar

```powershell
cre workflow simulate workflow-registry --target staging-settings --non-interactive --trigger-index 0
```

Sem `--broadcast` a simulação lê a API e os contratos e monta os relatórios, mas não envia nada. Cada relatório aparece no log com a marca `[no --broadcast]`, e a execução segue como se ele tivesse sido entregue, para mostrar os relatórios seguintes:

```text
[USER LOG] [no --broadcast] would send REGISTER_FUND fund af5b7014-d16f-4494-ab99-130fdda864b6 (not sent)
[USER LOG] [no --broadcast] would send REGISTER_ORDER order 43cc4855-2a98-4c24-9b95-6e7da34374e7 (not sent)
[USER LOG] deferred REGISTER_ORDER order 9295af55-d71d-4551-a566-778d77dfd75a: write limit of the run reached
[USER LOG] done: 1 fund(s), 5 order(s), 26 report(s) due, 0 sent, 5 not sent (simulation without --broadcast), 21 deferred, 0 error(s); 3 API call(s), 4 chain read(s)
```

Isso não é erro. A linha final separa os relatórios enviados, os não enviados por falta de `--broadcast` e os adiados pelo limite de escritas. Como nada é gravado, a execução seguinte mostra os mesmos relatórios.

### 3. Simular enviando

```powershell
cre workflow simulate workflow-registry --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

Com `--broadcast` cada relatório vira uma transação de verdade na Sepolia, entregue pelo forwarder de simulação. A conta de `CRE_ETH_PRIVATE_KEY` paga o gás e precisa de ETH de teste. O receptor precisa estar com o forwarder de simulação, que é o padrão do script de deploy.

### 4. Publicar o workflow

Publicar exige acesso antecipado ao CRE, a conta ligada com `cre account link-key`, o segredo enviado ao Vault DON e uma simulação bem-sucedida. Antes, troque o forwarder do receptor para o de verdade. O README dos smart contracts explica [a diferença entre os dois forwarders](../smart-contracts/README.md#5-publicar-a-estrutura-de-integração-com-chainlink-cre).

```powershell
cre secrets create secrets.yaml --target production-settings
cre workflow deploy workflow-registry --target production-settings
cre workflow activate workflow-registry --target production-settings
```

Depois de publicado, restrinja o receptor ao workflow com `setExpectedWorkflowId`. Sem isso, qualquer workflow consegue entregar relatórios a ele.

## Limites de uma execução

O CRE limita o que uma execução pode fazer. O workflow respeita os limites e deixa o resto para as execuções seguintes.

| Limite | Valor | Origem |
|---|---|---|
| Chamadas HTTP | 15 | Cota do CRE |
| Leituras de contrato | 15 | Cota do CRE |
| Dado que passa pelo consenso | 25 KB por chamada | Cota do CRE |
| Relatórios enviados | `maxWritesPerRun`, 5 no padrão | Configuração |
| Ordens com relatórios, por fundo | `maxOrdersPerRun`, 5 no padrão | Configuração |

As cotas estão em [docs.chain.link/cre/service-quotas](https://docs.chain.link/cre/service-quotas).

**Chamadas à API.** Cada fundo usa até três: o fundo, um índice enxuto das ordens e os detalhes só das ordens que precisam de relatório. Os detalhes vêm em uma chamada separada para caber no limite do consenso, já que a lista completa de ordens passa de 25 KB.

**Leituras.** Uma leitura traz todos os fundos, com `listFunds`. Outra traz o estado de todas as ordens de um fundo, com `getOrderSyncStates`: se cada uma está registrada, o progresso, a versão e as transações já gravadas. Cada chamada leva até 30 ordens, por causa do limite de 5 KB de uma leitura. Um fundo com 13 ordens custa uma leitura, e todas as ordens são conferidas em toda execução.

Com os quatro fundos de exemplo, uma execução usa cerca de 6 das 15 leituras: uma para os fundos, uma por fundo para as ordens e uma por rede de destino conferida antes de registrar uma ordem nova.

**Rodízio.** Quando há mais ordens com relatórios a enviar do que `maxOrdersPerRun`, a escolha começa de uma posição que muda a cada execução. Assim uma ordem cujo relatório sempre falha não impede as outras de serem atendidas.

**Bloco das leituras.** O workflow lê o bloco mais recente, e não o finalizado. O bloco finalizado fica minutos atrás, e o workflow reenviaria o que a execução anterior acabou de gravar. Um relatório repetido é recusado pelos contratos de qualquer forma.

**Gás.** Um relatório de transação de ordem gastou cerca de 1,2 milhão de gás em uma rede local, e o de fundo cerca de 1,3 milhão. O `gasLimit` padrão é 2.500.000.

## Como os dados da API viram registros

O workflow chama dois endpoints da Observer API:

| Endpoint | Uso |
|---|---|
| `GET /funds/{fundId}` | Dados do fundo |
| `GET /funds/{fundId}/debenture-orders` | Ordens do fundo, com as transações de origem e de destino |

Exemplos de resposta estão em [../query-json/](../query-json/).

| Registro | Campos da API |
|---|---|
| Rede do fundo | `eip155:` mais o `chainId` do fundo |
| Transação de criação do fundo | `creationTxHash`. A API só traz o hash: remetente e bloco ficam vazios |
| Transferência, papel `TRANSFER` | `connectorResults.source`. O `assetCode` é o símbolo do stablecoin do fundo |
| Lock, papel `LOCK` | `connectorResults.source.lockTxHash`. O destino é o `intent.sourceController`, o escrow da ordem |
| Entrega, papel `DELIVERY` | `connectorResults.destination` e o bloco próprio da rede: `xrpl`, `stellar` ou `rayls` |
| Disposition | `sourceEvidence.disposition` e `destinationEvidence.disposition` |
| Progresso | `progress`, `version` e `updatedAt` da ordem |

Os argumentos extras de cada transação seguem as chaves registradas por [register-chains.ts](../smart-contracts/scripts/register-chains.ts):

| Rede | Argumentos extras |
|---|---|
| `eip155:*` | `blockHash`, `logIndex` e, na Rayls, `verificationScope` |
| `xrpl:*` | `ledgerHash` e `sequence` em 32 bits |
| `stellar:*` | `ledgerHash` e `sequence` em 64 bits |

Datas da API viram segundos Unix, sem a fração. Uma transação só é gravada quando o lado dela está `VERIFIED`. Um progresso que o contrato não conhece é ignorado, e as transações da ordem são gravadas mesmo assim.

A lista de ordens da API cobre uma janela de tempo, 30 dias nos exemplos. Uma ordem fora da janela não é vista pelo workflow.

## Testes

A lógica do workflow é testada junto com os contratos, em [../smart-contracts/test/Workflow.e2e.test.ts](../smart-contracts/test/Workflow.e2e.test.ts). O teste usa as respostas de exemplo de `query-json/`, monta os relatórios com o código de `lib/` e os entrega aos contratos de verdade na rede simulada do Hardhat. Ele confere os valores gravados, os quatro fundos de exemplo e que uma segunda passada não envia nada.

```powershell
cd smart-contracts
npx hardhat test test/Workflow.e2e.test.ts
```

O teste precisa das dependências do workflow instaladas, com `bun install --cwd ./workflow-registry`. Sem elas, é pulado.

## Status

| Verificação | Resultado |
|---|---|
| Simulação `local-simulation` com a Observer API de verdade | Executada, com os quatro fundos |
| Relatórios entregues aos contratos na rede simulada do Hardhat | Executado, 6 testes passando, lendo o estado com `getOrderSyncStates` |
| Modo `production` lendo contratos em um nó local, sem enviar | Executado: 3 leituras para conferir as 13 ordens de um fundo |
| Contratos publicados na Sepolia, com redes e stablecoins registrados | Feito. Os endereços estão no [project.config.json](../project.config.json) e nas configurações do workflow |
| Simulação `staging-settings` lendo os contratos da Sepolia, sem enviar | Executada: os quatro fundos passaram nas conferências de rede e de stablecoin, e os quatro relatórios `REGISTER_FUND` ficaram prontos para envio |
| Simulação com `--broadcast` na Sepolia | Não executada |
| Workflow publicado | Não publicado |

O envio de relatórios pelo forwarder ainda não foi exercitado de ponta a ponta. A primeira simulação com `--broadcast` é o teste que falta. Até ela, não há fundos, ordens nem transações registrados nos contratos.
