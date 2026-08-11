# Decisões de arquitetura

Registro das decisões que definem o comportamento do conversor JSONL → CSV.
Cada uma vale para todo o projeto; mudança aqui exige mudança nos testes.

## Contexto

Entrada: um JSONL onde cada linha é um clube com uma lista aninhada de jogadores.
Saída: `clubs.csv` (1:1 com o clube) e `players.csv` (1:N, cada linha carregando o
`club_id` do pai).

Três restrições determinam o desenho:

- a base real pode ter milhões de linhas — nada é carregado inteiro em memória;
- a base real tem registros malformados — um registro ruim não aborta o processo;
- saída UTF-8, separada por vírgula, com escape RFC 4180.

Daí o pipeline: `createReadStream` → `node:readline` (`crlfDelay: Infinity`) →
`JSON.parse` em `try/catch` por linha → dois `createWriteStream` escritos
incrementalmente. A normalização fica em funções puras, isolada do I/O, para ser
testável sem tocar em disco.

## Medições

Feitas em **Node v22.17.1** (Windows), com scripts descartáveis. Os scripts foram
apagados; o que importa são as conclusões abaixo, que sustentam as decisões.

### Backpressure do `for await` sobre o `readline`

**Pergunta:** o `for await...of` no `readline` já segura a leitura enquanto o corpo
do loop aguarda, ou é preciso chamar `rl.pause()` explicitamente?

**Medição:** fonte sintética de 200.000 linhas, corpo do loop parado 300 ms na
primeira linha. Resultado: a fonte empurrou **4.000 linhas e parou**; heap em
**4,5 MB**.

**Conclusão:** o backpressure é automático e `rl.pause()` explícito é desnecessário
— seria só mais um `resume()` para esquecer. O `rl[Symbol.asyncIterator]` faz ponte
por um `Readable` em objectMode; quando o `push()` interno retorna `false`, o
listener de `line` pausa o `input`. É o próprio `await` no corpo do loop que segura
a leitura.

O número 4.000 é específico do chunk sintético usado no teste (~12 KB), **não** é
uma constante do Node: o teto real é "as linhas contidas nos poucos chunks já em
voo", que com `fs` (HWM padrão de 64 KiB) é outro número. O que generaliza é o
formato do teto — **constante e pequeno, independente do tamanho do arquivo**.

Consequência prática: o risco de memória não está na leitura, está na escrita. Daí
as decisões D8 e D9.

### Comportamento de borda do `readline`

| Entrada | Resultado |
| --- | --- |
| arquivo terminado em `\n` | **não** gera linha vazia extra |
| arquivo terminado em `\n\n` | gera uma linha vazia |
| `\r\n` com `crlfDelay: Infinity` | tratado como uma quebra só |
| arquivo com BOM | BOM **não** é removido |

Sobre o BOM: a primeira linha volta como `﻿{...}` e o `JSON.parse` falha com
`Unexpected token`. O modo de falha é traiçoeiro — o **primeiro** registro do
arquivo vira "malformado" em silêncio, e a investigação começa pelo lugar errado
(o filtro). Daí D10.

## Decisões

### D1 — Filtro por allowlist

Passa o clube cujo campeonato normalizado está em `{SERIE A, SERIE B}`.

É allowlist, não denylist: o critério é *participar da série A ou B*, não *não estar
sem campeonato*. Se surgir `SERIE C` na base real, fica de fora — comportamento
desejado, e a diferença entre as duas formulações só aparece nesse caso.

Normalização aplicada antes de comparar, nesta ordem:

1. `trim()`
2. `normalize('NFD')` e remoção dos diacríticos (`/[̀-ͯ]/g`)
3. `toUpperCase()`
4. `_` e `-` viram espaço
5. espaços colapsados, `trim()` de novo

Assim `"Série A"`, `"serie_a"` e `"SERIE A "` caem no mesmo bucket.

### D2 — Granularidade do descarte

| Situação | Ação |
| --- | --- |
| linha não parseável | descarta a linha, segue o arquivo |
| JSON válido que não é objeto (`null`, número, string, array) | descarta |
| clube sem `club_id`, ou com `club_id` vazio | descarta o clube **e** seus jogadores |
| jogador que não é objeto, ou sem `player_id` | descarta só ele; clube e irmãos continuam |
| campo com tipo inesperado (`colors` string, `age` objeto) | campo vazio, linha continua |
| `players` ausente ou não-array | clube válido com zero jogadores — **não** é erro |

O clube sem `club_id` derruba os jogadores junto porque a chave de ligação some:
jogador órfão em `players.csv` é pior que jogador ausente.

O jogador ruim não derruba o clube porque perder 30 jogadores bons por causa de 1
malformado é o pior dos dois erros.

### D3 — Relatório de rejeitos com teto

Contadores por categoria, impressos no fim em **stderr** (para não contaminar o
pipe do stdout).

Os **primeiros 20 rejeitos** saem detalhados, com número da linha e motivo. Do 21º
em diante, só incrementa contador. O sumário final informa quantos rejeitos foram
omitidos.

Motivo do teto: em 5 milhões de linhas com 5% de sujeira seriam 250 mil linhas de
stderr. O log viraria o gargalo de I/O do próprio job, e ninguém lê 250 mil linhas.
Detalhe completo é problema de uma flag `--verbose` futura, não do default.

### D4 — Saída LF, sem BOM

Desvio consciente do RFC 4180, que especifica CRLF. Motivo: diff limpo e todo
parser moderno aceita LF. Documentado no README.

Sem BOM na saída. Consequência: o Excel pt-BR abre o arquivo numa coluna só, porque
espera `;` como separador. É o comportamento correto pela especificação — o aviso
vai no README para não parecer defeito.

### D5 — Toda normalização é total

`null`, `undefined` e número viram campo escrevível; `null` vira **campo vazio**,
nunca a string `"null"`. O caso real na amostra é o `nickname` do Santos.

Contrato de toda função de normalização: **nunca lança e sempre devolve algo
escrevível**. É o que permite tratar registro ruim sem abortar — se a normalização
pudesse lançar, cada campo viraria um `try/catch`.

### D6 — Tabela única por arquivo

Cada CSV declara uma estrutura `[{chave, cabecalho}]`, e **tanto** a linha de
cabeçalho **quanto** cada linha de dados são derivadas dela.

Motivo: cabeçalho em português e chave em inglês são duas listas paralelas que
divergem em silêncio. Inserir uma coluna no cabeçalho e esquecer na serialização
desloca o CSV inteiro sem erro nenhum. Derivar das duas da mesma estrutura torna a
dessincronização impossível.

### D7 — Escape RFC 4180

O campo é envolvido em aspas duplas se contiver `,`, `"`, `\r` ou `\n`; aspas
internas são duplicadas. Caso real na amostra: `"Pedro Lourenço, Filho"`, na linha
4, tem vírgula no valor.

### D8 — Encerramento explícito dos streams

`end()` não é flush. Depois do loop: `end()` nos dois streams e `await
finished(stream)` (de `node:stream/promises`) nos dois, **antes** de reportar
sucesso.

Sem isso, o sucesso é relatado antes de os bytes chegarem ao disco, e um `ENOSPC`
no flush final vira `error` sem listener — que derruba o processo *depois* do log de
sucesso. Em arquivo de milhões de linhas, ENOSPC é cenário realista.

### D9 — Espera de `drain` via `events.once`

Ao escrever: se `write()` retornar `false`, aguarda `drain` antes de continuar.
A espera usa `once` de `node:events`, **não** um `new Promise(r => ws.once('drain',
r))` artesanal.

Motivo: `events.once()` trata `error` como caso especial e rejeita a promise se o
stream falhar durante a espera. A versão artesanal não — se o disco falhar com o
buffer cheio, o `drain` nunca chega, a promise nunca resolve e o processo pendura em
silêncio.

Aguardar `drain` de um stream enquanto o outro está saturado não trava: são sinks
independentes. Espera sequencial basta.

### D10 — BOM removido na entrada

O `﻿` inicial é removido da primeira linha antes do `JSON.parse`. Ver a medição
acima: sem isso, um arquivo salvo pelo Bloco de Notas perde silenciosamente o
primeiro registro.

### D11 — Linha em branco é ignorada em silêncio

Linha vazia ou só com espaços é pulada **sem** contar como rejeito. Contá-la faria
todo arquivo terminado em `\n\n` reportar erro que não existe.

## Verificação

A amostra em `data/sample_clubes.jsonl` tem 6 clubes: 3 SERIE A, 2 SERIE B, 1 SEM
CAMPEONATO. Sob D1, o gabarito é **5 linhas em `clubs.csv` e 8 em `players.csv`**
(3+2+2+1+0 jogadores).

O caminho do `drain` precisa de teste dedicado: um `Writable` com
`highWaterMark: 1` que segura o callback força o `write()` a devolver `false` e
exercita o branch. Sem isso, justamente o trecho que motivou toda a análise de
backpressure fica sem cobertura.

### D12 — Contrato de colunas

Seleção explícita: o JSON traz campos que **não entram em lugar nenhum**
(`titles`, `nationality`, `market_value`). Selecionar as colunas pedidas faz parte
do contrato, não é omissão.

`clubs.csv`, nesta ordem exata:

| Cabeçalho | Chave no JSON |
| --- | --- |
| Id do Clube | `club_id` |
| Nome | `name` |
| Campeonato | `championship` |
| Data de Fundação | `founding_date` |
| Cidade | `city` |
| Estado | `state` |
| País | `country` |
| Estádio | `stadium` |
| Presidente | `president` |
| Apelido | `nickname` |
| Cores | `colors` |

`players.csv`, nesta ordem exata:

| Cabeçalho | Origem |
| --- | --- |
| Id do Clube | `club_id` do clube pai |
| Id do Jogador | `player_id` |
| Nome | `name` |
| Idade | `age` |
| Gols | `goals` |
| Data de Estreia | `debut_date` |
| Posição | `position` |
| Número da Camisa | `shirt_number` |

A coluna Campeonato escreve o valor **original** do JSON; a forma normalizada de D1
existe só para a comparação do filtro.

### D13 — `colors`: array unido por pipe

Array unido por `|`, sem espaço: `["preto","branco"]` vira `preto|branco`.

- Array vazio, ausente ou que não é array → campo vazio.
- Elemento que não é string é **descartado do join** — nunca vira
  `[object Object]`.

O pipe evita colisão com o separador do CSV; nenhuma cor da base usa `|`.

### D14 — Datas em `yyyy-MM-dd`

Toda data de saída — `founding_date` e `debut_date` — sai em `yyyy-MM-dd`.

Origem inválida vira **campo vazio e a linha continua** no arquivo: data ruim não
descarta registro. É o mesmo princípio de D5 (normalização total) aplicado a datas
— o campo degrada, o registro sobrevive.
