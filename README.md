# MultiChainTxRegistry

Registro on-chain de transações de fundos e ordens observadas em várias redes blockchain.

## Índice

Neste arquivo:

- [Por onde começar](#por-onde-começar)
- [Comandos da raiz](#comandos-da-raiz)
- [Observações](#observações)

Outros documentos:

- [Smart contracts - README](smart-contracts/README.md): contratos, deploy, registro de redes e stablecoins, permissões e a entrada do Chainlink CRE
- [CRE workflow - README](workflow-registry/README.md): workflow do Chainlink CRE que lê a Observer API e grava nos contratos
- [Frontend - README](frontend/README.md): painel web de leitura dos contratos, com a comparação entre a Observer API e o que está gravado
- [Exemplos de dados](smart-contracts/MultiChainTxRegistry.md): exemplos de preenchimento das structs dos contratos, como `ChainInfo`, `TxInput` e `ExtraArg`

O repositório é dividido por partes, uma pasta para cada:

| Pasta | Conteúdo |
|---|---|
| [smart-contracts/](smart-contracts/) | Contratos Solidity, testes e scripts de deploy, em um projeto Hardhat. Veja o [README dos smart contracts](smart-contracts/README.md) |
| [workflow-registry/](workflow-registry/) | Workflow do Chainlink CRE: lê fundos e ordens na Observer API e grava nos contratos. Veja o [README do workflow](workflow-registry/README.md) |
| [frontend/](frontend/) | Painel web de leitura: mostra o que está gravado nos contratos e compara com a Observer API. Veja o [README do frontend](frontend/README.md) |
| [project.yaml](project.yaml) e [secrets.yaml](secrets.yaml) | Configuração do CRE CLI: o RPC de cada target e o nome dos segredos do workflow. Nenhum dos dois guarda valores secretos |
| [project.config.json](project.config.json) | Configuração pública compartilhada: URL do RPC da Sepolia, endereço do forwarder do Chainlink CRE e endereços dos contratos publicados. A tarefa de deploy preenche os endereços dos contratos |
| `project.backup.config.json` | Histórico dos endereços de contratos substituídos em um novo deploy. Só existe depois da primeira substituição |
| `.env` | Segredos compartilhados: chave privada de deploy, chave do Etherscan, chave da Observer API e chave da conta do CRE. Crie a partir do [.env.example](.env.example). Não é commitado |
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
| `npm run contracts:deploy-and-setup-all` | Roda em sequência todos os passos de publicação: compilar, deploy, redes, stablecoins e receptor do CRE |
| `npm run contracts:install` | Instala só as dependências dos contratos |
| `npm run workflow:install` | Instala as dependências do workflow, com o Bun |
| `npm run workflow:simulate` | Simula o workflow no target `local-simulation`: lê a Observer API e mostra os relatórios que enviaria, sem gravar |
| `npm run workflow:sync-config` | Copia os endereços dos contratos do `project.config.json` para as configurações do workflow |
| `npm run frontend:install` | Instala as dependências do frontend |
| `npm run frontend:dev` | Abre o painel em `http://localhost:5173` |
| `npm run frontend:build` | Confere os tipos e empacota o painel em `frontend/dist/` |
| `npm run frontend:preview` | Serve o pacote gerado pelo `build` |
| `npm run frontend:sync-abi` | Atualiza as ABIs do frontend a partir dos contratos compilados |

Estes atalhos são para os comandos sem opções: instalar, compilar, testar e experimentar na rede simulada do Hardhat. Sem opções, `contracts:deploy`, `contracts:register-chains` e `contracts:register-stablecoins` rodam na rede simulada e não publicam nada de verdade.

### Para publicar em uma rede real, entre na pasta

Quando o comando recebe opções, como `--network sepolia`, rode de dentro de `smart-contracts/`, com `npx hardhat`. Este é o jeito recomendado:

```powershell
cd smart-contracts
```

```powershell
npx hardhat deploy --network sepolia
```

ou para apenas uma parte, exemplo order-registry:

```powershell
npx hardhat deploy --network sepolia --only order-registry --yes
```

Também execute:

```powershell
npx hardhat run scripts/register-chains.ts --network sepolia
npx hardhat run scripts/register-stablecoins.ts --network sepolia
```

Para registrar com Chailink CRE:

```powershell
npx hardhat run scripts/deploy-cre-receiver.ts --network sepolia
```

Ou todos os passos acima de uma vez, na ordem certa:

```powershell
npx hardhat run scripts/deploy-and-setup-all.ts --network sepolia
```

O script pula o que já está feito. Os detalhes estão em [Publicar tudo de uma vez](smart-contracts/README.md#6-publicar-tudo-de-uma-vez).

A ordem importa: primeiro o deploy, depois as redes, depois os stablecoins. O receptor do Chainlink CRE pode ser publicado a qualquer momento depois do deploy.

Funciona igual no PowerShell, no Prompt de Comando e no bash. As opções do deploy e mais exemplos estão no [README dos smart contracts](smart-contracts/README.md#como-digitar-os-comandos-com-exemplos).

## Observações

#### PowerShell - por que não usar os atalhos com opções

Os atalhos aceitam opções depois de um `--`, mas no PowerShell isso tem uma armadilha. O `--` precisa ir entre aspas simples:

```powershell
npm run contracts:deploy '--' --network sepolia
```

Sem as aspas, o PowerShell descarta o `--` e as opções não chegam ao comando. Não aparece erro: o deploy roda na rede simulada, sem as opções, e parece ter funcionado. No bash o `--` funciona sem aspas.

Se usar um atalho com opções, confira na saída a linha que começa com `> hardhat`. Ela deve trazer as opções que você digitou.

Os comandos do Hardhat sem atalho, como `npx hardhat verify`, também são executados dentro de `smart-contracts/`. Os detalhes de compilação, deploy e registro de redes estão no [README dos smart contracts](smart-contracts/README.md).


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

