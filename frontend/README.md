# frontend — painel de leitura

Painel web que mostra o que está gravado nos contratos deste repositório e compara com a Observer API. É somente leitura: não pede carteira e não envia transação.

## Índice

- [O que o painel mostra](#o-que-o-painel-mostra)
- [Requisitos](#requisitos)
- [Rodar](#rodar)
- [De onde vêm os dados](#de-onde-vêm-os-dados)
- [Chave da Observer API](#chave-da-observer-api)
- [Identidade visual](#identidade-visual)
- [Arquivos](#arquivos)
- [Atualizar as ABIs](#atualizar-as-abis)
- [Apontar para outra rede](#apontar-para-outra-rede)
- [Limitações](#limitações)
- [Status](#status)

## O que o painel mostra

| Página | Endereço | Conteúdo |
|---|---|---|
| Visão geral | `#/` | Contadores de fundos, ordens, transações, redes e stablecoins, e os endereços dos quatro contratos |
| Fundos | `#/funds` | Fundos registrados no `FundRegistry` |
| Fundo | `#/funds/{fundId}` | Dados do fundo e as ordens dele, com progresso, versão e transações gravadas |
| Ordem | `#/orders/{orderId}` | A ordem, o intent e a linha do tempo das transações, com os argumentos extras de cada uma |
| Transações | `#/transactions` | Transações do `MultiChainTxRegistry`, das mais recentes para as mais antigas, com filtro e busca por hash |
| Sincronização | `#/sync` | Comparação entre a Observer API e os contratos, em duas partes: a lista dos fundos que a chave vê na API, com o resumo de cada um, e os detalhes do fundo escolhido, com o que ainda falta registrar. Quando a rede ou o stablecoin de um fundo, ou a rede de destino de uma ordem, ainda não estão cadastrados nos contratos, a página avisa o que falta cadastrar e o que fica parado por isso |
| Estrutura | `#/setup` | Redes e chaves de schema, stablecoins, papéis e dispositions, permissões entre os contratos e o estado do receptor do Chainlink CRE |

Os hashes de transação levam ao explorador da rede de origem, quando ele é conhecido. Os endereços de contrato levam ao Etherscan da Sepolia.

## Requisitos

- Node.js 22 ou mais novo.
- Os contratos publicados, com os endereços no [project.config.json](../project.config.json) da raiz.

Instale as dependências, da raiz do repositório:

```bash
npm install --prefix ./frontend
```

## Rodar

Da raiz do repositório:

```bash
npm run frontend:dev
```

O painel abre em `http://localhost:5173`. Para gerar e servir a versão de produção:

```bash
npm run frontend:build
npm run frontend:preview
```

O `build` confere os tipos antes de empacotar. O resultado fica em `frontend/dist/`.

## De onde vêm os dados

O painel não tem configuração própria. Ele lê os arquivos que as outras partes do repositório já mantêm:

| Dado | Origem |
|---|---|
| RPC e endereços dos contratos | [project.config.json](../project.config.json) |
| Fundos da página de sincronização | Observer API, em `GET /funds`: todos os que a chave pode ver. É a mesma lista que o workflow registra |
| Identificação na Observer API | [config.staging.json](../workflow-registry/config/config.staging.json) do workflow |
| ABIs dos contratos | [src/abi/](src/abi/), geradas dos artifacts do Hardhat |
| Regra de sincronização | [lib/plan.ts](../workflow-registry/lib/plan.ts) e [lib/api.ts](../workflow-registry/lib/api.ts) do workflow |

A página de sincronização usa o mesmo código do workflow do Chainlink CRE. Ela mostra exatamente os relatórios que o workflow enviaria, sem reimplementar a regra.

Esses arquivos são lidos na hora de empacotar. Depois de um novo deploy dos contratos, rode o `build` de novo, ou reinicie o `dev`.

As leituras feitas juntas são agrupadas em uma chamada só à rede, e os dados são atualizados a cada 30 segundos.

## Chave da Observer API

Só a página de sincronização usa a Observer API, e ela pede a chave na tela.

- A chave fica guardada no navegador de quem a colou, no armazenamento local do site.
- Ela é enviada somente à Observer API, no cabeçalho `X-Observer-Key`.
- O botão "Esquecer a chave" a apaga.
- Ela não entra no código, no `.env` nem no pacote gerado.

Sem a chave, as outras páginas funcionam normalmente.

**A Observer API precisa de um proxy.** A API não aceita os cabeçalhos `X-Observer-Id` e `X-Observer-Key` em chamadas feitas direto de um navegador. Por isso o painel chama o caminho `/observer-api`, e o servidor repassa a chamada. O `npm run frontend:dev` e o `npm run frontend:preview` já fazem esse repasse, configurado em [vite.config.ts](vite.config.ts). Em uma hospedagem de arquivos estáticos, a página de sincronização só funciona se o servidor tiver uma regra equivalente. As outras páginas não dependem disso.

## Identidade visual

O painel segue a identidade do observador do piloto ABToken / GTT, em [observer-dashboard-two.vercel.app](https://observer-dashboard-two.vercel.app/):

| Item | Valor |
|---|---|
| Fundo e superfícies | creme `#fffbf3` |
| Texto | `#1a3150` |
| Destaque, menu e botões | azul-marinho `#04395b` |
| Item ativo do menu | `#e5ddcf` |
| Linhas e bordas | `#d0d5d8` |
| Etiquetas de estado | verde `#166c48`, âmbar `#8a6a12` e vermelho `#b03024` |
| Números | `#0c6c84` |
| Fontes | As do sistema de quem abre a página. No Windows, Segoe UI no texto e Consolas nos números e hashes |

As cores e as fontes ficam no começo de [src/styles.css](src/styles.css), como variáveis. O tema é só claro, como no site de referência.

As fontes são a única diferença para a referência, que usa Sora e IBM Plex Mono. Com as fontes do sistema, o painel não carrega nada de fora.

O logo e o ícone são cópias dos arquivos do site de referência e ficam em [public/](public/): `brand/abtoken.png`, `brand/abtoken-white.png` e `icon.png`. A marca ABToken pertence aos seus titulares.

## Arquivos

| Caminho | Conteúdo |
|---|---|
| [src/config.ts](src/config.ts) | Reúne RPC, endereços e dados da Observer API a partir dos arquivos do repositório |
| [src/lib/registry.ts](src/lib/registry.ts) | Todas as leituras dos contratos |
| [src/lib/observer.ts](src/lib/observer.ts) | Chamadas à Observer API e a comparação com os contratos |
| [src/lib/explorers.ts](src/lib/explorers.ts) | Explorador de blocos de cada rede |
| [src/lib/queries.ts](src/lib/queries.ts) | Consultas usadas por mais de uma página |
| [src/lib/format.ts](src/lib/format.ts) | Formatação de datas, valores e hashes |
| [src/pages/](src/pages/) | Uma página por rota |
| [src/components/ui.tsx](src/components/ui.tsx) | Componentes comuns: hash com copiar, etiquetas, estados de carregamento |
| [src/abi/](src/abi/) | ABIs dos contratos. Arquivos gerados |
| [scripts/sync-abi.mjs](scripts/sync-abi.mjs) | Gera as ABIs a partir dos artifacts do Hardhat |
| [src/styles.css](src/styles.css) | Cores, fontes e layout |
| [public/](public/) | Logo e ícone |
| [vite.config.ts](vite.config.ts) | Empacotamento e o proxy da Observer API |

## Atualizar as ABIs

As ABIs em `src/abi/` são cópias das geradas pelo Hardhat. Elas ficam versionadas, para o painel empacotar sem precisar compilar os contratos. Quando um contrato mudar, gere de novo:

```bash
cd smart-contracts
npx hardhat build
cd ..
npm run frontend:sync-abi
```

## Apontar para outra rede

Para desenvolver contra outra publicação dos contratos, como um nó local do Hardhat, copie [.env.example](.env.example) para `.env.local` e preencha o RPC e os endereços. Sem esse arquivo, valem os do `project.config.json`.

Com um RPC próprio, o cabeçalho do painel mostra "rede personalizada", e as leituras deixam de ser agrupadas, porque o nó pode não ter o contrato usado para isso. Os links de endereço continuam apontando para o Etherscan da Sepolia.

Nenhum segredo vai nesse arquivo: tudo o que está em uma variável `VITE_` acaba no pacote gerado.

## Limitações

- **Valores na menor unidade.** O valor de cada transação aparece como está gravado, na menor unidade do ativo. Uma transferência de 100 unidades de um token de 18 casas aparece como 100 seguido de 18 zeros.
- **Filtro por página.** Na página de transações, o filtro de rede e de texto vale só para as 25 transações exibidas. A exceção é um hash completo, que é buscado no contrato inteiro.
- **Janela da lista de fundos.** A página de sincronização pede à API os fundos criados nos últimos 360 dias. É perto do máximo que a API aceita: uma janela muito maior é recusada. Um fundo mais antigo que isso deixa de aparecer na lista.
- **Sem histórico.** O painel mostra o estado atual. Os contratos não guardam quando cada mudança aconteceu, e o painel não lê os eventos.
- **Rayls sem explorador.** A rede `eip155:7295799` não tem explorador configurado, então os hashes dela aparecem sem link.

## Status

| Verificação | Resultado |
|---|---|
| Conferência de tipos e empacotamento | Passando |
| Leituras nos contratos da Sepolia | Executadas: redes, stablecoins, papéis, permissões e receptor |
| Páginas de fundo, ordem, transações e estrutura | Conferidas em um navegador, contra um nó local com os dados de exemplo |
| Comparação da página de sincronização | Executada contra um nó local, com as respostas de exemplo no lugar da API |
| Página de sincronização com a chave e a API de verdade | Não conferida no navegador |

Na Sepolia ainda não há fundos, ordens nem transações. Até a primeira carga do workflow, as páginas de fundos e de transações aparecem vazias.
