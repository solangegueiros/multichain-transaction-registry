# frontend — painel de leitura

Painel web que mostra o que está atestado nos contratos deste repositório e compara com a Observer API. É somente leitura: não pede carteira e não envia transação.

A Sepolia é a camada de atestação: os fundos, as ordens e as transações que o workflow do Chainlink CRE registra ficam gravados nos contratos dela. No painel, "atestado" quer dizer que está nesses contratos, e "registrar" é o que o workflow faz para atestar.

## Índice

- [O que o painel mostra](#o-que-o-painel-mostra)
- [Requisitos](#requisitos)
- [Executar](#executar)
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
| Fundos | `#/funds` | Fundos atestados, do `FundRegistry` |
| Fundo | `#/funds/{fundId}` | Dados do fundo e as ordens dele, com progresso, versão e transações atestadas |
| Ordem | `#/orders/{orderId}` | A ordem, o intent e a linha do tempo das transações, com os argumentos extras de cada uma |
| Transações | `#/transactions` | Transações atestadas no `MultiChainTxRegistry`, das mais recentes para as mais antigas, com filtro e busca por hash. Cada uma traz a data da atestação e o link da transação atestada no Etherscan da Sepolia |
| Sincronização | `#/sync` | Comparação entre a Observer API e o que está atestado, em duas partes: a lista dos fundos que a chave vê na API, com o resumo de cada um, e os detalhes do fundo escolhido, com o que ainda falta registrar. Quando a rede ou o stablecoin de um fundo, ou a rede de destino de uma ordem, ainda não estão cadastrados nos contratos, a página avisa o que falta cadastrar e o que fica parado por isso. Os detalhes trazem também a lista "Registrado": cada relatório já entregue pelo workflow, com o link da transação no Etherscan da Sepolia |
| Estrutura | `#/setup` | Redes e chaves de schema, stablecoins, papéis e dispositions, permissões entre os contratos e o estado do receptor do Chainlink CRE |

Os hashes de transação levam ao explorador da rede de origem, quando ele é conhecido. Os endereços de contrato levam ao Etherscan da Sepolia.

## Requisitos

- Node.js 22 ou mais novo.
- Os contratos publicados, com os endereços no `project.config.<ambiente>.json` da raiz.

Instale as dependências, da raiz do repositório:

```bash
npm install --prefix ./frontend
```

## Executar

Da raiz do repositório:

```bash
npm run frontend:dev
```

Abrir [http://localhost:5173](http://localhost:5173)

O painel abre lendo os contratos de staging. 

### Ambiente

O painel lê um ambiente de cada vez: staging ou production. Um botão no rodapé do menu lateral troca entre os dois. O pacote leva os endereços dos dois ambientes.

- **Trocar recarrega a página.** Todos os endereços e todas as leituras em cache são de um ambiente só, então o painel abre de novo do zero no outro.
- **O endereço guarda o ambiente.** A troca acrescenta `?env=production` ou `?env=staging` ao endereço da página, e um link copiado abre no mesmo ambiente.
- **O navegador lembra a última escolha.** Sem `?env=` no endereço, vale a última escolha feita neste navegador. Na primeira visita, staging.
- **Em tela estreita, o botão sobe para o topo.** O menu vira uma barra no alto da página e o rodapé dele some; o botão aparece ao lado do logo.

### Publicar

O painel é um site estático. Gere os arquivos e confira o resultado na sua máquina antes de hospedar:

```bash
npm run frontend:build
npm run frontend:preview
```

O `build` confere os tipos e gera o site em `frontend/dist/`. O `preview` serve essa pasta em [http://localhost:4173](http://localhost:4173), do jeito que ela vai ficar publicada.

Para publicar, hospede o conteúdo de `frontend/dist/` em qualquer servidor de arquivos estáticos. As rotas do painel ficam depois do `#` no endereço, então o servidor só precisa entregar o `index.html` e os arquivos da pasta.

#### Repasse para a Observer API

A página de Sincronização precisa de mais uma regra no servidor. O navegador não pode chamar a Observer API direto (veja [Chave da Observer API](#chave-da-observer-api)), então o painel chama `/observer-api/staging/...` e `/observer-api/production/...` no próprio servidor, que repassa para a API do workflow de cada ambiente:

| Caminho no servidor do painel | Repassa para |
|---|---|
| `/observer-api/staging/<resto>` | `apiBaseUrl` do [config.staging.json](../workflow-registry/config/config.staging.json), seguido de `/<resto>` |
| `/observer-api/production/<resto>` | `apiBaseUrl` do [config.production.json](../workflow-registry/config/config.production.json), seguido de `/<resto>` |

Hoje os dois ambientes usam a mesma API, `https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer`. Os cabeçalhos `X-Observer-Id` e `X-Observer-Key` precisam ser repassados como chegam.

**Hospedagem compartilhada (cPanel, Plesk), já incluída no pacote.** Em hospedagem compartilhada não dá para configurar o servidor, então o repasse é feito por um script PHP que o `build` já coloca em `frontend/dist/`:

| Arquivo | Função |
|---|---|
| `observer-api.php` | Recebe a chamada do painel e a repassa à API do ambiente, só com os cabeçalhos `X-Observer-Id`, `X-Observer-Key` e `Accept`. Aceita só `GET` e só caminhos da API |
| `observer-api.config.json` | A API de cada ambiente, gerada no `build` a partir do `apiBaseUrl` das configurações do workflow |
| `.htaccess` | Regra do Apache (cPanel) que manda `/observer-api/<ambiente>/...` para o `observer-api.php` |
| `web.config` | A mesma regra para o IIS (Plesk em Windows). Precisa do módulo URL Rewrite |

Basta enviar a pasta `dist/` inteira para a pasta do site, como antes. A hospedagem precisa ter PHP com a extensão `curl`, o que é o padrão no cPanel e no Plesk.

O `.htaccess` começa com ponto, e o gerenciador de arquivos do cPanel esconde esses arquivos. Para conferir se ele foi enviado, ligue "Show Hidden Files (dotfiles)" nas configurações do gerenciador.

**Servidor próprio.** Com acesso à configuração do servidor, o repasse pode ser feito por ele mesmo, sem o PHP.

Nginx, dentro do bloco `server` do painel:

```nginx
location /observer-api/staging/ {
    proxy_pass https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer/;
    proxy_ssl_server_name on;
    proxy_set_header Host dev-api-mercado-bitcoin.web3up.mobi;
}

location /observer-api/production/ {
    proxy_pass https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer/;
    proxy_ssl_server_name on;
    proxy_set_header Host dev-api-mercado-bitcoin.web3up.mobi;
}
```

Apache, com os módulos `proxy`, `proxy_http` e `ssl` ativos, dentro do `VirtualHost` do painel:

```apache
SSLProxyEngine on
ProxyPass        /observer-api/staging/    https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer/
ProxyPassReverse /observer-api/staging/    https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer/
ProxyPass        /observer-api/production/ https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer/
ProxyPassReverse /observer-api/production/ https://dev-api-mercado-bitcoin.web3up.mobi/v1/external/observer/
```

Se o `apiBaseUrl` de um ambiente mudar, a regra do servidor muda junto. As barras no fim dos dois lados importam: sem elas, o caminho chega errado à API.

Para conferir, abra no navegador `https://<seu-painel>/observer-api/staging/funds`. Sem a chave, a resposta deve ser um JSON da API recusando a chamada, com HTTP 401. Se aparecer a página do painel ou um erro do servidor, a regra não está valendo. Sem a regra, a página de Sincronização mostra a mensagem "Sem acesso à Observer API". Com o PHP, um problema do próprio script volta como um JSON com o campo `error`, por exemplo quando falta o `observer-api.config.json` ou a extensão `curl`.

## De onde vêm os dados

O painel não tem configuração própria. Ele lê os arquivos que as outras partes do repositório já mantêm:

| Dado | Origem |
|---|---|
| RPC e endereços dos contratos | [project.config.staging.json](../project.config.staging.json) ou [project.config.production.json](../project.config.production.json), conforme o ambiente |
| Fundos da página de sincronização | Observer API, em `GET /funds`: todos os que a chave pode ver. É a mesma lista que o workflow registra |
| Identificação na Observer API | [config.staging.json](../workflow-registry/config/config.staging.json) ou [config.production.json](../workflow-registry/config/config.production.json) do workflow, conforme o ambiente |
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

Sem a chave, as outras páginas funcionam normalmente, e a de sincronização mostra só o que já está atestado.

**A Observer API precisa de um proxy.** A API não aceita os cabeçalhos `X-Observer-Id` e `X-Observer-Key` em chamadas feitas direto de um navegador. Por isso o painel chama o caminho `/observer-api/<ambiente>`, e o servidor repassa a chamada à API configurada no workflow do mesmo ambiente. O `npm run frontend:dev` e o `npm run frontend:preview` já fazem esse repasse, configurado em [vite.config.ts](vite.config.ts). Em outro servidor, a página de sincronização só funciona com uma regra equivalente, descrita em [Repasse para a Observer API](#repasse-para-a-observer-api). As outras páginas não dependem disso.

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
| [src/config.ts](src/config.ts) | Escolhe o ambiente e reúne RPC, endereços e dados da Observer API a partir dos arquivos do repositório |
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
| [vite.config.ts](vite.config.ts) | Empacotamento e o proxy da Observer API de cada ambiente |

## Atualizar as ABIs

As ABIs em `src/abi/` são cópias das geradas pelo Hardhat. Elas ficam versionadas, para o painel empacotar sem precisar compilar os contratos. Quando um contrato mudar, gere de novo:

```bash
cd smart-contracts
npx hardhat build
cd ..
npm run frontend:sync-abi
```

## Apontar para outra rede

Para desenvolver contra outra publicação dos contratos, como um nó local do Hardhat, copie [.env.example](.env.example) para `.env.local` e preencha o RPC e os endereços. Sem esse arquivo, valem os do `project.config.<ambiente>.json`.

Com um RPC próprio, o cabeçalho do painel mostra "rede personalizada", e as leituras deixam de ser agrupadas, porque o nó pode não ter o contrato usado para isso. Os links de endereço continuam apontando para o Etherscan da Sepolia.

Nenhum segredo vai nesse arquivo: tudo o que está em uma variável `VITE_` acaba no pacote gerado.

## Limitações

- **Valores na menor unidade.** O valor de cada transação aparece como está gravado, na menor unidade do ativo. Uma transferência de 100 unidades de um token de 18 casas aparece como 100 seguido de 18 zeros.
- **Filtro por página.** Na página de transações, o filtro de rede e de texto vale só para as 25 transações exibidas. A exceção é um hash completo, que é buscado no contrato inteiro.
- **Janela da lista de fundos.** A página de sincronização pede à API os fundos criados nos últimos 360 dias. É perto do máximo que a API aceita: uma janela muito maior é recusada. Um fundo mais antigo que isso deixa de aparecer na lista.
- **Transação da Sepolia só em Transações e na Sincronização.** Os contratos não guardam qual transação da Sepolia atestou cada coisa. A página de Transações acha a de cada transação pelo evento `TxRegistered` do `MultiChainTxRegistry`, no bloco da data da atestação: são 3 ou 4 consultas ao RPC por linha. A lista "Registrado" da Sincronização tira isso dos eventos do `MultiChainTxReceiver`. As páginas de fundo e de ordem mostram só o estado atual.
- **A leitura de eventos depende do RPC.** O RPC público devolve no máximo 50.000 blocos por consulta, e parte dos nós dele só guarda blocos recentes e recusa a consulta. O painel tenta de novo até dar certo e lê o histórico em faixas, de volta até o deploy do receptor. A primeira abertura da página fica mais lenta conforme o receptor envelhece: são cerca de 5 consultas por mês de histórico. Depois disso, só os blocos novos são lidos. Para um histórico longo, o caminho certo é um RPC com histórico completo ou um indexador.
- **"Registrado" mostra só o que passou pelo workflow.** Um registro feito direto por uma conta operadora, sem o receptor, não aparece na lista. E só entram as ordens que a Observer API ainda devolve.
- **Sem a Observer API, só o que está atestado.** Sem a chave, com a chave recusada ou com a API fora do ar, a Sincronização lista os fundos já atestados e mostra deles as ordens, as transações e a lista "Registrado". Uma mensagem avisa o motivo, as colunas que dependem da API ficam com "—", o que falta registrar fica indisponível, e um fundo que só a API conhece não aparece.
- **Rayls sem explorador.** A rede `eip155:7295799` não tem explorador configurado, então os hashes dela aparecem sem link.

## Status

| Verificação | Resultado |
|---|---|
| Conferência de tipos e empacotamento | Passando |
| Leituras nos contratos da Sepolia | Executadas: redes, stablecoins, papéis, permissões e receptor |
| Páginas de fundo, ordem, transações e estrutura | Conferidas em um navegador, contra um nó local com os dados de exemplo |
| Comparação da página de sincronização | Executada contra um nó local, com as respostas de exemplo no lugar da API |
| Página de sincronização com a chave e a API de verdade | Não conferida no navegador |

Os contratos de production estão publicados, mas o workflow de production ainda não. Até ele rodar, o painel de production mostra os contratos vazios, sem fundos, ordens nem transações.
