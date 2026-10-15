# MultiChainTxRegistry

Registro on-chain de transações de fundos e ordens observadas em várias redes blockchain.

> **[Índice](#índice)**

## Visão geral

No piloto ABToken / GTT, fundos de investimento (FIDCs) operam em várias redes blockchain. Cada fundo tem um stablecoin na sua rede, e cada ordem envolve duas redes: o pagamento em stablecoin vai para um escrow na rede de origem, e o ativo é entregue na rede de destino. A Observer API acompanha os fundos, as ordens e as transações de cada etapa.

Neste projeto multichain, os fundos e as ordens estão espalhados por várias redes blockchain: XDC, XRPL, Stellar e outras. Cada rede tem o seu formato e o seu explorador, e uma ordem começa numa rede e termina em outra. Para acompanhar uma operação de ponta a ponta, é preciso confiar na Observer API ou consultar cada rede separadamente.

O MultiChainTxRegistry atesta esses dados em Blockchain, na rede Ethereum Sepolia, a camada de atestação. É um registro público, onde fundos, ordens e transações de todas as redes ficam em um só lugar, com um formato único, e que qualquer pessoa pode consultar e conferir contra a transação original na rede de origem.

Um workflow do Chainlink CRE lê a Observer API a cada 5 minutos e registra nos contratos o que ainda falta. Os relatórios passam pela rede de oráculos da Chainlink antes de chegar aos contratos, e ninguém grava dados à mão. Um painel web mostra o que está atestado e o que ainda falta registrar.

## Índice

Neste arquivo:

- [Visão técnica](#visão-técnica)
  - [Ambientes](#ambientes)
  - [Como os dados chegam aos contratos](#como-os-dados-chegam-aos-contratos)
  - [O que fica atestado](#o-que-fica-atestado)
  - [Características](#características)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Por onde começar](#por-onde-começar)
- [Configuração dos ambientes](#configuração-dos-ambientes)
- [Publicando em produção](#publicando-em-produção)
  - [1. Antes de começar](#1-antes-de-começar)
  - [2. Publicar os contratos](#2-publicar-os-contratos)
  - [3. Sincronizar os endereços no workflow](#3-sincronizar-os-endereços-no-workflow)
  - [4. Publicar o workflow](#4-publicar-o-workflow)
  - [5. Restringir o receptor ao workflow](#5-restringir-o-receptor-ao-workflow)
  - [6. Conferir](#6-conferir)
- [Comandos do diretório principal](#comandos-do-diretório-principal)
  - [Para publicar em uma rede real, entre na pasta](#para-publicar-em-uma-rede-real-entre-na-pasta)
- [Observações](#observações)
  - [Lista de fundos](#lista-de-fundos)
  - [PowerShell - por que não usar os atalhos com opções](#powershell---por-que-não-usar-os-atalhos-com-opções)

Outros documentos:

- [Smart contracts - README](smart-contracts/README.md): contratos, deploy, registro de redes e stablecoins, permissões e a entrada do Chainlink CRE
- [CRE workflow - README](workflow-registry/README.md): workflow do Chainlink CRE que lê a Observer API e grava nos contratos
- [Frontend - README](frontend/README.md): painel web de leitura dos contratos, com a comparação entre a Observer API e o que está atestado na Sepolia
- [Exemplos de dados](smart-contracts/MultiChainTxRegistry.md): exemplos de preenchimento das structs dos contratos, como `ChainInfo`, `TxInput` e `ExtraArg`

## Visão técnica

Este projeto atesta esses dados na **Ethereum Sepolia**, a camada de atestação: um registro público, num formato único para todas as redes, que qualquer pessoa pode consultar e conferir contra a transação original na rede de origem.

### Ambientes

| Ambiente | Contratos | Workflow |
|---|---|---|
| Staging | Publicados na rede Sepolia, com fundos, ordens e transações já atestados | Executado em simulação manual (`cre workflow simulate --broadcast`) |
| Production | Publicados na rede Sepolia, com redes e stablecoins cadastrados | Publicado no Private Registry do Chainlink CRE |

### Como os dados chegam aos contratos

```
Observer API ──> workflow do Chainlink CRE ──relatório assinado──> forwarder da Chainlink
                                                                          │
                                                                          ▼
                                                          MultiChainTxReceiver (Sepolia)
                                                                          │
                                       ┌──────────────────────────────────┼──────────────────────────────┐
                                       ▼                                  ▼                              ▼
                                 FundRegistry                       OrderRegistry              MultiChainTxRegistry
                                   fundos                              ordens                     transações

Painel web ──lê──> contratos da Sepolia e Observer API
```

1. A cada 5 minutos, o workflow do Chainlink CRE lê os fundos e as ordens na Observer API e compara com o que já está atestado nos contratos.
2. Para cada coisa que falta, ele envia um relatório. A rede de oráculos da Chainlink assina o relatório, e o forwarder da Chainlink o entrega ao `MultiChainTxReceiver`.
3. O receptor confere que o relatório veio do workflow autorizado e grava no contrato certo.
4. O painel web mostra o que está atestado e compara com a Observer API, apontando o que o workflow ainda vai registrar.

### O que fica atestado

| Contrato | Guarda |
|---|---|
| `FundRegistry` | Os fundos, com a rede, o stablecoin e a transação de criação de cada um, e a lista de stablecoins aceitos |
| `OrderRegistry` | As ordens de cada fundo, com o intent, o progresso e a lista de transações da ordem: transferência, lock e entrega |
| `MultiChainTxRegistry` | Cada transação, com hash, partes, valor, ativo e bloco, mais os campos próprios da rede de origem, conferidos contra um schema por rede |
| `MultiChainTxReceiver` | Não guarda dados: é a porta de entrada dos relatórios do workflow |

As redes acompanhadas hoje são XDC Apothem, XDC mainnet, Polygon Amoy, Rayls, XRPL testnet e Stellar testnet. Os detalhes de cada contrato estão no [README dos smart contracts](smart-contracts/README.md).

### Características

- **Só o workflow grava.** O receptor aceita apenas relatórios entregues pelo forwarder da Chainlink. Em produção, ele também pode ser restrito ao workflow publicado, como no passo 5 de [Publicando em produção](#publicando-em-produção).
- **O workflow não guarda estado.** O que já foi feito é lido dos próprios contratos. Uma execução que para no meio é retomada na seguinte, e uma execução repetida não envia nada de novo.
- **Os contratos não são atualizáveis.** Um contrato publicado de novo começa vazio, em outro endereço. O anterior continua na rede com os dados dele.
- **Dois ambientes.** Staging e production têm contratos separados, os dois na Sepolia. Veja [Configuração dos ambientes](#configuração-dos-ambientes).


## Estrutura do projeto

O repositório é dividido por partes, uma pasta para cada:

| Pasta | Conteúdo |
|---|---|
| [smart-contracts/](smart-contracts/) | Contratos Solidity, testes e scripts de deploy, em um projeto Hardhat. Veja o [README dos smart contracts](smart-contracts/README.md) |
| [workflow-registry/](workflow-registry/) | Workflow do Chainlink CRE: lê fundos e ordens na Observer API e grava nos contratos. Veja o [README do workflow](workflow-registry/README.md) |
| [frontend/](frontend/) | Painel web de leitura: mostra o que está atestado nos contratos da Sepolia, a camada de atestação, e compara com a Observer API. Veja o [README do frontend](frontend/README.md) |
| [project.yaml](project.yaml) e [secrets.yaml](secrets.yaml) | Configuração do CRE CLI: o RPC de cada target e o nome dos segredos do workflow. Nenhum dos dois guarda valores secretos |
| [project.config.staging.json](project.config.staging.json) e [project.config.production.json](project.config.production.json) | Configuração pública compartilhada, uma por ambiente: URL do RPC da Sepolia, endereço do forwarder do Chainlink CRE e endereços dos contratos publicados. A tarefa de deploy preenche os endereços dos contratos. Veja [Configuração dos ambientes](#configuração-dos-ambientes) |
| `project.backup.config.json` | Histórico dos endereços de contratos substituídos em um novo deploy. Só existe depois da primeira substituição |
| `.env` | Segredos compartilhados: chave privada de deploy, chave do Etherscan, chave da Observer API e chave da conta do CRE. Crie a partir do [.env.example](.env.example). Fica fora do controle de versão, no `.gitignore` |
| [package.json](package.json) | Atalhos para rodar da raiz os comandos de cada parte |
| [query-json/](query-json/) | Respostas de API de exemplo, com fundos e ordens reais. São a referência de dados para todas as partes |

## Por onde começar

```sh
cp .env.example .env
npm install
npm test
```

O `npm install` da raiz instala as dependências de `smart-contracts/`. Os testes rodam sem o `.env` preenchido; ele só é necessário para publicar na Sepolia.

O workflow do Chainlink CRE tem instalação própria, com o Bun:

```bash
bun install --cwd ./workflow-registry
```

Os demais passos estão no [README do workflow](workflow-registry/README.md).

O frontend também tem instalação própria, com o npm:

```bash
npm install --prefix ./frontend
npm run frontend:dev
```

Os detalhes estão no [README do frontend](frontend/README.md).

## Configuração dos ambientes

O projeto tem dois ambientes, cada um com os seus contratos, os dois na Ethereum Sepolia:

| | staging | production |
|---|---|---|
| Configuração dos contratos | [project.config.staging.json](project.config.staging.json) | [project.config.production.json](project.config.production.json) |
| Rede nos comandos do Hardhat | `--network staging` | `--network production` |
| Configuração do workflow | [config.staging.json](workflow-registry/config/config.staging.json), target `staging-settings` | [config.production.json](workflow-registry/config/config.production.json), target `production-settings` |
| Forwarder do Chainlink CRE | o de simulação, para `cre workflow simulate --broadcast` | o de verdade, para o workflow publicado |
| Frontend | `npm run frontend:dev`, com staging escolhido no rodapé do menu | o mesmo painel, com produção escolhida no rodapé do menu |
| Situação | contratos publicados e em uso | contratos publicados; falta publicar o workflow: veja [Publicando em produção](#publicando-em-produção) |

Depois de publicar os contratos de um ambiente, rode `npm run workflow:sync-config`. Ele copia os endereços de cada `project.config.<ambiente>.json` para a configuração do workflow do mesmo ambiente.

## Publicando em produção

O ambiente production tem contratos próprios, separados dos de staging, também na Ethereum Sepolia. Os passos abaixo publicam os contratos, ligam o workflow do Chainlink CRE a eles e restringem o receptor a esse workflow. Faça na ordem.

**Situação atual.** Os passos 1 a 3 estão feitos: os contratos de production estão publicados, com as redes e os stablecoins registrados, e os endereços já estão no `project.config.production.json` e no `config.production.json`. O receptor usa o forwarder de verdade. O workflow está publicado no Private Registry, com o id no `creWorkflowId`. Falta o passo 5: rodar o script do receptor para restringi-lo a esse workflow.

### 1. Antes de começar

- **`.env` preenchido**, como descrito no [.env.example](.env.example). A conta de `ETH_PRIVATE_KEY` publica os contratos, vira admin deles e precisa de ETH da Sepolia para o gás. O `ETHERSCAN_API_KEY` é usado para verificar os contratos. O `API_OBSERVER_KEY` e o `CRE_ETH_PRIVATE_KEY` são do workflow.
- **CRE CLI com sessão ativa**: `cre login`, conferido com `cre whoami`. Publicar um workflow exige acesso antecipado ao CRE. O workflow vai para o Private Registry, o registro do Chainlink fora da blockchain, definido em `deployment-registry: "private"` no [workflow.yaml](workflow-registry/workflow.yaml). Nele, a sessão do `cre login` autoriza tudo: não há registro na Ethereum mainnet, nem carteira ligada com `cre account link-key`. Para conferir que a sua organização tem esse registro, rode `cre registry list` e procure a linha com `ID: private`.
- **Workflow testado em staging**, com `cre workflow simulate --broadcast`. Em production não há simulação com envio: o receptor de production só aceita relatórios do forwarder de verdade.
- **[project.config.production.json](project.config.production.json) com os endereços vazios** e com o `creForwarderAddress` preenchido com o forwarder de verdade, `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`. Endereços já preenchidos são reaproveitados: o script só publica o que falta.

### 2. Publicar os contratos

Rode de dentro de `smart-contracts/`:

```powershell
cd smart-contracts
npx hardhat run scripts/deploy-and-setup-all.ts --network production
cd ..
```

Antes de cada passo, confira na saída as linhas `Network: production` e `Addresses: project.config.production.json`.

O script roda os cinco passos: compila, publica e verifica no Etherscan `MultiChainTxRegistry`, `FundRegistry` e `OrderRegistry`, registra as redes e os stablecoins e publica o `MultiChainTxReceiver`. Cada endereço é gravado no `project.config.production.json` assim que o contrato é publicado. Se o script parar no meio, rode de novo: ele continua de onde parou. Os detalhes estão em [Publicar tudo de uma vez](smart-contracts/README.md#6-publicar-tudo-de-uma-vez).

No fim, o script avisa que nenhuma restrição de workflow está definida. É esperado: a restrição é o passo 5.

### 3. Sincronizar os endereços no workflow

```powershell
npm run workflow:sync-config
```

Os quatro endereços vão do `project.config.production.json` para o [config.production.json](workflow-registry/config/config.production.json) do workflow. Até este passo, o target `production-settings` se recusa a rodar, porque os endereços estão vazios.

Faça um commit do `project.config.production.json` e do `config.production.json`. Os dois só têm valores públicos.

### 4. Publicar o workflow

Rode da raiz do repositório.

Primeiro, envie ao Vault DON a chave da Observer API, que o [secrets.yaml](secrets.yaml) lê da variável `API_OBSERVER_KEY` do `.env`:

```powershell
cre secrets create secrets.yaml --target production-settings --secrets-auth=browser
```

O `--secrets-auth=browser` autoriza o envio pela sessão do `cre login`, como pede o Private Registry. Sem ele, o CLI tenta o caminho do registro na blockchain e falha pedindo um RPC da Ethereum mainnet.

Publique o workflow:
```powershell
cre workflow deploy workflow-registry --target production-settings
```

O `deploy` mostra o id do workflow: guarde-o para o passo seguinte. O workflow é publicado pausado; depois do `activate`, ele roda sozinho a cada 5 minutos.

Ative o workflow:

```powershell
cre workflow activate workflow-registry --target production-settings
```


### 5. Restringir o receptor ao workflow

Sem restrição, qualquer workflow de qualquer dono consegue entregar relatórios ao receptor de production.

Preencha `creWorkflowId` no `project.config.production.json` com o id do passo 4, com ou sem o `0x`, e rode o script do receptor de novo, de dentro de `smart-contracts/`:

```powershell
cd smart-contracts
npx hardhat run scripts/deploy-cre-receiver.ts --network production
cd ..
```

O script chama `setExpectedWorkflowId` no receptor, que passa a aceitar só os relatórios desse workflow. A conta de `ETH_PRIVATE_KEY` precisa ser admin do receptor; se não for, o script mostra a chamada que um admin precisa fazer. No resumo do fim, a linha `Workflow restriction` deve mostrar o id.

Um novo `cre workflow deploy` do mesmo workflow, depois de uma mudança no código ou na configuração, gera outro id. Atualize o `creWorkflowId` e rode o script de novo, ou os relatórios do workflow novo são recusados. As outras restrições possíveis estão em [Registrando transações com Chainlink CRE](smart-contracts/README.md#registrando-transações-com-chainlink-cre).

### 6. Conferir

```powershell
npm run frontend:dev
```

No rodapé do menu do painel, escolha "produção". Na página Estrutura, confira se o receptor usa o forwarder de produção e se a restrição de workflow está definida. Na página Sincronização, com a chave da Observer API, acompanhe os relatórios sendo registrados a cada execução.

## Comandos do diretório principal

O [package.json](package.json) da raiz não tem dependências próprias. Ele só guarda atalhos que entram na pasta de cada parte e rodam o comando lá.

| Comando | O que faz |
|---|---|
| `npm install` | Instala as dependências dos smart contracts |
| `npm test` | Roda os testes dos smart contracts |
| `npm run contracts:compile` | Compila os contratos |
| `npm run contracts:test` | Roda os testes dos contratos; é o mesmo que `npm test` |
| `npm run contracts:deploy` | Publica `MultiChainTxRegistry`, `FundRegistry` e `OrderRegistry`, reaproveitando os que já têm endereço no `project.config.<ambiente>.json` |
| `npm run contracts:deploy-cre-receiver` | Publica o `MultiChainTxReceiver`, a entrada do Chainlink CRE |
| `npm run contracts:register-chains` | Registra as redes e as chaves de schema |
| `npm run contracts:register-stablecoins` | Registra os stablecoins no `FundRegistry` |
| `npm run contracts:deploy-and-setup-all` | Roda em sequência todos os passos de publicação: compilar, deploy, redes, stablecoins e receptor do CRE |
| `npm run contracts:install` | Instala só as dependências dos contratos |
| `npm run workflow:install` | Instala as dependências do workflow, com o Bun |
| `npm run workflow:simulate` | Simula o workflow no target `local-simulation`: lê a Observer API e mostra os relatórios que enviaria, sem gravar |
| `npm run workflow:sync-config` | Copia os endereços dos contratos de cada `project.config.<ambiente>.json` para a configuração do workflow do mesmo ambiente |
| `npm run frontend:install` | Instala as dependências do frontend |
| `npm run frontend:dev` | Abre o painel em `http://localhost:5173`. O ambiente é escolhido no rodapé do menu |
| `npm run frontend:build` | Confere os tipos e empacota o painel em `frontend/dist/`, com os dois ambientes |
| `npm run frontend:preview` | Serve o pacote gerado pelo `build` |
| `npm run frontend:sync-abi` | Atualiza as ABIs do frontend a partir dos contratos compilados |

Estes atalhos são para os comandos sem opções: instalar, compilar, testar e experimentar na rede simulada do Hardhat. Sem opções, `contracts:deploy`, `contracts:register-chains` e `contracts:register-stablecoins` rodam na rede simulada e não publicam nada de verdade.

### Para publicar em uma rede real, entre na pasta

Quando o comando recebe opções, como `--network staging`, rode de dentro de `smart-contracts/`, com `npx hardhat`. Este é o jeito recomendado:

```powershell
cd smart-contracts
```

```powershell
npx hardhat deploy --network staging
```

ou para apenas uma parte, exemplo order-registry:

```powershell
npx hardhat deploy --network staging --only order-registry --yes
```

Também execute:

```powershell
npx hardhat run scripts/register-chains.ts --network staging
npx hardhat run scripts/register-stablecoins.ts --network staging
```

Para registrar com Chailink CRE:

```powershell
npx hardhat run scripts/deploy-cre-receiver.ts --network staging
```

Ou todos os passos acima de uma vez, na ordem certa:

```powershell
npx hardhat run scripts/deploy-and-setup-all.ts --network staging
```

Para o ambiente production, troque `--network staging` por `--network production` em todos os comandos acima.

O script pula o que já está feito. Os detalhes estão em [Publicar tudo de uma vez](smart-contracts/README.md#6-publicar-tudo-de-uma-vez).

A ordem importa: primeiro o deploy, depois as redes, depois os stablecoins. O receptor do Chainlink CRE pode ser publicado a qualquer momento depois do deploy.

Funciona igual no PowerShell, no Prompt de Comando e no bash. As opções do deploy e mais exemplos estão no [README dos smart contracts](smart-contracts/README.md#como-digitar-os-comandos-com-exemplos).

## Observações

### Lista de fundos

O workflow do Chainlink CRE e a página de Sincronização do frontend não têm uma lista de fundos na configuração. Os dois pedem a lista à Observer API, em `GET /funds`, e usam todos os fundos que a chave pode ver.

**O que isso traz de bom.** Um fundo novo na API entra sozinho, sem editar arquivo nem publicar o workflow de novo. O painel e o workflow olham sempre a mesma lista.

**O que exige atenção.** Não há aprovação: o workflow registra onchain qualquer fundo que a chave enxergue. Se a chave passar a ver um fundo que não deveria ser registrado, ele será registrado. O controle de quais fundos entram fica, na prática, em quem administra a chave na Observer API.

**Limites da lista.**

| Limite | Valor | Consequência |
|---|---|---|
| Janela de tempo | 360 dias, pela data de criação do fundo | Um fundo criado há mais tempo deixa de ser visto. A API devolve só 30 dias por padrão e recusa janelas muito maiores que um ano |
| Quantidade no workflow | 40 fundos, em duas páginas de 20 | Os fundos além disso não são vistos, e o log do workflow avisa |
| Chamadas à API por execução do workflow | 15, pela cota do CRE | Uma chamada traz a lista e cada fundo usa até duas. Cabem cerca de sete fundos por execução. Os demais ficam para as seguintes, em rodízio |

**A lista de ordens tem a mesma janela, ainda no padrão.** As ordens de cada fundo vêm de `GET /funds/{fundId}/debenture-orders`, que devolve só as atualizadas nos últimos 30 dias. Nem o workflow nem o painel ampliam essa janela hoje. Uma ordem sem atualização há mais de 30 dias deixa de ser vista: se já estava registrada, continua no contrato; se faltava registrar algo dela, não será mais registrado.

**Se for preciso restringir os fundos.** Uma saída é recolocar na configuração do workflow uma lista opcional de `fundId`, usada como filtro: vazia, vale a lista da API; preenchida, só os fundos listados são registrados. Isso não está implementado.

Os detalhes de cada parte estão no [README do workflow](workflow-registry/README.md#limites-de-uma-execução) e no [README do frontend](frontend/README.md#de-onde-vêm-os-dados).

### PowerShell - por que não usar os atalhos com opções

Os atalhos aceitam opções depois de um `--`, mas no PowerShell isso tem uma armadilha. O `--` precisa ir entre aspas simples:

```powershell
npm run contracts:deploy '--' --network staging
```

Sem as aspas, o PowerShell descarta o `--` e as opções não chegam ao comando. Não aparece erro: o deploy roda na rede simulada, sem as opções, e parece ter funcionado. No bash o `--` funciona sem aspas.

Se usar um atalho com opções, confira na saída a linha que começa com `> hardhat`. Ela deve trazer as opções que você digitou.

Os comandos do Hardhat sem atalho, como `npx hardhat verify`, também são executados dentro de `smart-contracts/`. Os detalhes de compilação, deploy e registro de redes estão no [README dos smart contracts](smart-contracts/README.md).
