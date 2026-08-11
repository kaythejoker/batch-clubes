# desafio-batch-clubes

Conversor batch de JSONL de clubes de futebol para CSV, em Node puro.

## O problema

A entrada é um arquivo JSONL onde cada linha é um clube com uma lista aninhada
de jogadores. A base real pode ter milhões de linhas e contém registros
malformados — JSON quebrado, campos ausentes, tipos errados. Um registro ruim
não pode abortar o processo, e o arquivo inteiro nunca pode ser carregado em
memória.

A saída são dois CSVs relacionados: `clubs.csv`, com uma linha por clube (1:1),
e `players.csv`, com uma linha por jogador carregando o `club_id` do clube pai
(1:N). Só entram clubes das séries A e B; o restante é filtrado junto com seus
jogadores. Cabeçalhos em português, saída UTF-8 separada por vírgula com escape
RFC 4180.

## Requisitos

- Node.js >= 18.17
- Nenhuma dependência de runtime — **não há `npm install` a fazer**. Todo o
  código usa apenas módulos nativos (`node:fs`, `node:readline`, `node:stream`,
  `node:util`, `node:events`).

## Uso

```
node src/index.js <entrada.jsonl> [--out-dir <dir>]
```

O caminho do JSONL é parâmetro posicional obrigatório; `--out-dir` define onde
escrever os dois CSVs (default: diretório atual, criado se não existir). O
sumário de processamento sai em stderr, para não contaminar redirecionamentos
de stdout. Exit code 1 se a entrada não existe ou se nenhum clube válido foi
encontrado — quase sempre sinal de arquivo errado, não de base vazia.

Exemplo real, contra a amostra versionada:

```bash
node src/index.js data/sample_clubes.jsonl --out-dir data
```

Esse comando reproduz exatamente os arquivos versionados `data/clubs.csv` e
`data/players.csv` — depois de rodar, `git diff` deve sair limpo. É a
verificação de reprodutibilidade da entrega.

## Saídas

`clubs.csv`, nesta ordem:

| Coluna | Origem no JSON |
| --- | --- |
| Id do Clube | `club_id` |
| Nome | `name` |
| Campeonato | `championship` (valor original, sem normalizar) |
| Data de Fundação | `founding_date` em `yyyy-MM-dd` |
| Cidade | `city` |
| Estado | `state` |
| País | `country` |
| Estádio | `stadium` |
| Presidente | `president` |
| Apelido | `nickname` |
| Cores | `colors` unido por `\|` |

`players.csv`, nesta ordem:

| Coluna | Origem no JSON |
| --- | --- |
| Id do Clube | `club_id` do clube pai |
| Id do Jogador | `player_id` |
| Nome | `name` |
| Idade | `age` |
| Gols | `goals` |
| Data de Estreia | `debut_date` em `yyyy-MM-dd` |
| Posição | `position` |
| Número da Camisa | `shirt_number` |

Campos do JSON que não aparecem em nenhuma tabela (`titles`, `nationality`,
`market_value`) ficam de fora por contrato — seleção de colunas faz parte do
problema, não é omissão.

## Decisões de projeto

O registro completo, com as medições que sustentam cada uma, está em
[docs/decisoes.md](docs/decisoes.md). As principais, com o porquê:

- **Streaming linha a linha** (`createReadStream` + `node:readline` +
  `createWriteStream` com backpressure): o teto de memória precisa ser
  constante e independente do tamanho do arquivo. Carregar o JSONL, ou
  acumular as saídas, faria o pico de RSS crescer com a base.
- **Nenhuma dependência**: o escaping RFC 4180 são poucas linhas; o controle
  sobre elas vale mais que uma biblioteca, e a superfície de supply chain fica
  em zero.
- **Granularidade do descarte**: linha não parseável descarta a linha; clube
  sem `club_id` descarta clube e jogadores, porque a chave de ligação some e
  jogador órfão é pior que jogador ausente; jogador ruim descarta só ele,
  porque perder 30 jogadores bons por causa de 1 malformado é o pior dos dois
  erros; campo de tipo errado degrada para vazio e a linha continua.
- **Filtro por allowlist** (`{SERIE A, SERIE B}` sobre valor normalizado), não
  denylist: o critério é participar da série A ou B. Se surgir `SERIE C` na
  base real, fica de fora por decisão, não por acaso. A normalização
  (maiúsculas, trim, remoção de diacríticos, `_`/`-` viram espaço) existe só
  no predicado — a coluna Campeonato escreve o valor original da fonte.
- **LF em vez de CRLF**: desvio consciente do RFC 4180, que pede CRLF. Motivo:
  diff limpo e qualquer parser moderno aceita LF.
- **Sem BOM na saída**: é o correto para UTF-8. Consequência conhecida: o
  Excel pt-BR abre o CSV numa coluna só, porque espera `;` como separador —
  comportamento esperado, não defeito.
- **Teto de 20 rejeitos detalhados**: em 5 milhões de linhas com 5% de sujeira
  seriam 250 mil linhas de log; o stderr viraria o gargalo de I/O do próprio
  job. Os 20 primeiros saem com número da linha e motivo, o resto vira
  contador, e o sumário informa quantos foram omitidos.
- **Categorias de rejeito como conjunto fechado**: a mensagem do `JSON.parse`
  embute o offset do erro; usada como chave de contagem, criaria uma entrada
  nova por linha ruim e o contador vazaria memória proporcional ao número de
  erros (ver D15 em docs/decisoes.md).

## Robustez

| Entrada suja | Comportamento |
| --- | --- |
| linha com JSON quebrado | descarta a linha, segue o arquivo, conta como `json inválido` |
| JSON válido que não é objeto (`null`, número, string, array) | descarta, conta como `registro não é um objeto` |
| clube sem `club_id`, não-string ou vazio | descarta clube e jogadores |
| campeonato fora da allowlist | filtrado sem linha em nenhum arquivo; contador próprio, não é erro |
| `players` ausente ou não-array | clube válido com zero jogadores, não é erro |
| jogador que não é objeto ou sem `player_id` | descarta só o jogador; irmãos continuam, contador próprio |
| data inválida (`2024-02-31`, `18/01/2024`, `2023-02-29`) | campo vazio, linha continua |
| `colors` como string, `nickname` null, campo de tipo errado | campo vazio, linha continua |
| BOM no início do arquivo | removido; o primeiro registro não é perdido |
| linha em branco | ignorada em silêncio, nunca contada como rejeito |
| arquivo em CRLF | tratado normalmente (`crlfDelay: Infinity`) |

A validação de data é feita à mão, com regra de bissexto completa, sem
construir `Date` — `new Date("2024-02-31")` não lança, rola para 2 de março, e
gravaria uma data que não existia na fonte.

## Testes

```bash
npm test
```

77 testes em 4 arquivos, usando o runner nativo (`node --test`), sem framework:

- `test/csv.test.js` — escape RFC 4180 (vírgula, aspas, quebras de linha,
  tipos não-tabulares) e `CsvWriter`, incluindo o branch de saturação com um
  sink de `highWaterMark: 1` que força `write()` a devolver `false`, e a
  rejeição de `waitForDrain` quando o sink falha com o buffer cheio.
- `test/normalize.test.js` — datas (bissexto completo: `2000-02-29` válido,
  `1900-02-29` inválido), cores, campeonato (quatro grafias no mesmo bucket).
- `test/transform.test.js` — granularidade do descarte e schema único, com os
  cabeçalhos conferidos literalmente e linhas validadas índice a índice.
- `test/index.test.js` — integração: roda o processo real contra JSONL
  temporário e valida o texto bruto dos CSVs, incluindo JSON quebrado no meio,
  BOM, linha em branco final e códigos de saída.

## Desempenho

Fixtures sintéticas determinísticas (LCG com seed fixa, 5% de linhas
defeituosas distribuídas pelas categorias da tabela acima):

```bash
node scripts/gerar-fixture.js 500000 --out-dir <dir-fora-de-pasta-sincronizada>
```

Medição em Windows 11, Node v22.17.1, pico de RSS via `PeakWorkingSet64`
(máximo cumulativo mantido pelo SO), entrada e saídas em disco local fora de
diretório sincronizado:

| Linhas | Entrada | Tempo | Pico de RSS | Throughput |
| --- | --- | --- | --- | --- |
| 500 mil | 314 MB | 14,1 s | 90,2 MB | ~35,5 mil linhas/s |
| 5 milhões | 3,1 GB | 97,8 s | 95,3 MB | ~51,1 mil linhas/s |

Stress adicional: entrada de 1,1 GB com 500 mil clubes e 7,2 milhões de
jogadores (formato antigo da fixture, 0–30 jogadores por clube) — pico de
105,4 MB.

O dado relevante é a **razão de memória entre as escalas, não o tempo
absoluto**: tempo depende do disco da máquina, mas entrada 10x maior com pico
de RSS praticamente igual (90,2 → 95,3 MB, +5,7%) é o que prova que o
streaming está correto e nada é acumulado proporcionalmente à base.

## Nota sobre o console do Windows

Os arquivos gerados e o stderr são UTF-8 corretos (verificado por hexdump). O
console do PowerShell, porém, usa cp1252 por padrão e renderiza acentos como
`nÃ£o`. É só renderização — `chcp 65001` no terminal corrige a exibição. Os
bytes gravados não têm defeito.
