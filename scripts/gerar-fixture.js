// Gera fixture sintética em JSONL: N linhas, 5% defeituosas distribuídas
// pelas categorias de D2, para exercitar cada branch de rejeito sob volume.
//
// Determinístico por construção: LCG com seed fixa, nunca Math.random —
// sem reprodutibilidade a medição não é comparável entre execuções.
//
// uso: node scripts/gerar-fixture.js [N] [--out-dir <dir>]   (default 1000000)
// saída: fixture-{N}.jsonl na raiz do projeto (ignorada pelo git), ou em
// --out-dir — use um diretório fora de árvore sincronizada (OneDrive etc.)
// quando a fixture alimentar medição, senão o sync contamina o I/O.

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 1910;
const FRACAO_DEFEITUOSA = 0.05;
const TAMANHO_BLOCO = 1 << 16; // acumula ~64 KiB antes de cada write()

// LCG de Numerical Recipes: estado de 32 bits, período suficiente e barato.
let estado = SEED >>> 0;
function rand() {
  estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
  return estado / 4294967296;
}
function inteiro(min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}
function escolhe(lista) {
  return lista[Math.floor(rand() * lista.length)];
}

const NOMES = ['João', 'José', 'André', 'Antônio', 'Estêvão', 'Vinícius', 'Luís', 'Sebastião', 'Cauã', 'Válber'];
const SOBRENOMES = ['Silva', 'Gonçalves', 'Araújo', 'Conceição', 'Assunção', 'Brandão', 'Simões', 'Peçanha'];
const CIDADES = [
  ['São Paulo', 'SP'], ['Florianópolis', 'SC'], ['Belo Horizonte', 'MG'],
  ['João Pessoa', 'PB'], ['Maceió', 'AL'], ['Cuiabá', 'MT'],
  ['Brasília', 'DF'], ['Niterói', 'RJ'],
];
const POSICOES = ['Goleiro', 'Zagueiro', 'Lateral', 'Volante', 'Meia', 'Atacante'];
const TIPOS_DE_CLUBE = ['Sport Club', 'Associação Atlética', 'Sociedade Esportiva', 'Grêmio Recreativo'];
const CORES = ['preto', 'branco', 'azul', 'verde', 'vermelho', 'grená', 'anil'];
// Grafias variadas que caem todas na allowlist depois da normalização (D1).
const CAMPEONATOS_OK = ['SERIE A', 'SERIE B', 'Série A', 'Série B', 'serie_a', 'serie_b', 'SERIE A ', 'Série-B'];
const CAMPEONATOS_FORA = ['SERIE C', 'SEM CAMPEONATO', 'Série D', ''];
const DATAS_RUINS = ['2024-02-31', '18/01/2024', '2024-2-1', '0000-01-01', '2023-02-29', 'amanhã'];

function nomePessoa() {
  return `${escolhe(NOMES)} ${escolhe(SOBRENOMES)}`;
}

// Sempre dia 1–28: gera data de calendário válida sem revalidar aqui.
function dataValida() {
  const ano = inteiro(1900, 2025);
  const mes = String(inteiro(1, 12)).padStart(2, '0');
  const dia = String(inteiro(1, 28)).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function jogador(clubId, indice) {
  return {
    player_id: `${clubId}-${indice}`,
    name: nomePessoa(),
    age: inteiro(16, 40),
    goals: inteiro(0, 30),
    debut_date: dataValida(),
    position: escolhe(POSICOES),
    shirt_number: inteiro(1, 99),
  };
}

function clubeValido(i) {
  const clubId = `C${String(i).padStart(7, '0')}`;
  const [cidade, estadoUf] = escolhe(CIDADES);
  const sobrenome = escolhe(SOBRENOMES);

  // Uma fração leva vírgula e aspas nos campos de texto, para o caminho
  // do escape ficar sob carga e não só no teste unitário.
  const presidente = rand() < 0.15 ? `${nomePessoa()}, Filho` : nomePessoa();
  const estadio = rand() < 0.1 ? `Estádio "${sobrenome}", Portão Sul` : `Estádio ${sobrenome}`;
  const apelido = rand() < 0.1 ? `o "${escolhe(CORES)}" da ${cidade}` : escolhe(CORES);

  // 0–5: exercita listas vazias e variadas sem inflar o arquivo — com 0–30
  // a média de 15 jogadores/clube faz 5M de linhas passarem de 10 GB e a
  // medição vira medição de disco, não de streaming.
  const totalJogadores = inteiro(0, 5);
  const players = [];
  for (let j = 1; j <= totalJogadores; j++) players.push(jogador(clubId, j));

  return {
    club_id: clubId,
    name: `${escolhe(TIPOS_DE_CLUBE)} ${sobrenome} de ${cidade}`,
    championship: escolhe(CAMPEONATOS_OK),
    founding_date: dataValida(),
    city: cidade,
    state: estadoUf,
    country: 'Brasil',
    stadium: estadio,
    president: presidente,
    nickname: apelido,
    colors: [escolhe(CORES), escolhe(CORES)],
    titles: inteiro(0, 30),
    players,
  };
}

// Uma categoria de D2 por linha defeituosa, em vez de concentrar num tipo só.
function linhaDefeituosa(i) {
  const clube = clubeValido(i);
  switch (inteiro(0, 9)) {
    case 0: // JSON sintaticamente quebrado
      return JSON.stringify(clube).slice(0, -inteiro(1, 10));
    case 1: // JSON válido que não é objeto
      return escolhe(['42', '"texto solto"', '[1,2,3]', 'null', 'true']);
    case 2: // clube sem club_id
      delete clube.club_id;
      return JSON.stringify(clube);
    case 3: // club_id só de espaços
      clube.club_id = '   ';
      return JSON.stringify(clube);
    case 4: // campeonato fora da allowlist
      clube.championship = escolhe(CAMPEONATOS_FORA);
      return JSON.stringify(clube);
    case 5: // players como objeto em vez de array
      clube.players = { player_id: `${clube.club_id}-1` };
      return JSON.stringify(clube);
    case 6: { // jogador sem player_id no meio de uma lista válida
      clube.players = [jogador(clube.club_id, 1), jogador(clube.club_id, 2), jogador(clube.club_id, 3)];
      delete clube.players[1].player_id;
      return JSON.stringify(clube);
    }
    case 7: // datas inválidas nos dois campos de data
      clube.founding_date = escolhe(DATAS_RUINS);
      if (clube.players.length > 0) clube.players[0].debut_date = escolhe(DATAS_RUINS);
      return JSON.stringify(clube);
    case 8: // colors como string
      clube.colors = 'preto e branco';
      return JSON.stringify(clube);
    default: // nickname null
      clube.nickname = null;
      return JSON.stringify(clube);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { 'out-dir': { type: 'string' } },
    allowPositionals: true,
  });

  const n = Number(positionals[0] ?? 1_000_000);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`erro: quantidade de linhas inválida: ${positionals[0]}`);
    process.exit(1);
  }

  const dirSaida = values['out-dir'] ?? fileURLToPath(new URL('..', import.meta.url));
  const destino = path.join(dirSaida, `fixture-${n}.jsonl`);
  const ws = createWriteStream(destino, { encoding: 'utf8' });

  // Acumula um bloco e respeita o write() falso: o gerador não pode estourar
  // memória, senão o pico de RSS medido no conversor fica indistinguível dele.
  let bloco = '';
  for (let i = 0; i < n; i++) {
    const linha = rand() < FRACAO_DEFEITUOSA ? linhaDefeituosa(i) : JSON.stringify(clubeValido(i));
    bloco += linha + '\n';
    if (bloco.length >= TAMANHO_BLOCO) {
      if (!ws.write(bloco)) await once(ws, 'drain');
      bloco = '';
    }
    if ((i + 1) % 500_000 === 0) console.error(`geradas ${i + 1} de ${n} linhas`);
  }
  if (bloco !== '') ws.write(bloco);

  ws.end();
  await finished(ws);
  console.error(`fixture pronta: ${destino}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
