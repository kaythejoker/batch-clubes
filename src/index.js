// Orquestrador: CLI, leitura em streaming e política de fluxo (D3, D8–D11).
// Só este arquivo decide quando escrever e quando esperar; o que vira linha
// é decisão do transform.

import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import path from 'node:path';

import { CsvWriter } from './csv.js';
import { CLUB_SCHEMA, PLAYER_SCHEMA, headerRow, transformClub } from './transform.js';

const USO = `uso: node src/index.js <entrada.jsonl> [opções]

converte um jsonl de clubes em clubs.csv e players.csv.

opções:
  --out-dir <dir>  diretório de saída (default: ".")
  --help           mostra esta mensagem`;

// Teto de rejeitos detalhados no stderr; do 21º em diante só conta (D3).
const TETO_DETALHES = 20;

function parseCli(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        'out-dir': { type: 'string', default: '.' },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
    }));
  } catch (erro) {
    console.error(erro.message);
    console.error(USO);
    process.exit(1);
  }

  if (values.help) {
    console.log(USO);
    process.exit(0);
  }
  if (positionals.length !== 1) {
    console.error(USO);
    process.exit(1);
  }
  return { entrada: positionals[0], outDir: values['out-dir'] };
}

async function main() {
  const { entrada, outDir } = parseCli(process.argv.slice(2));

  if (!existsSync(entrada)) {
    console.error(`erro: arquivo de entrada não encontrado: ${entrada}`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  const escritorClubes = new CsvWriter(
    createWriteStream(path.join(outDir, 'clubs.csv'), { encoding: 'utf8' }),
    headerRow(CLUB_SCHEMA),
  );
  const escritorJogadores = new CsvWriter(
    createWriteStream(path.join(outDir, 'players.csv'), { encoding: 'utf8' }),
    headerRow(PLAYER_SCHEMA),
  );

  const contadores = {
    linhasLidas: 0,
    clubesGravados: 0,
    jogadoresGravados: 0,
    jogadoresDescartados: 0,
    clubesFiltrados: 0,
    invalidasPorMotivo: new Map(),
  };
  let rejeitosDetalhados = 0;
  let rejeitosOmitidos = 0;

  // A categoria é chave de contagem e precisa ser um conjunto FECHADO de
  // strings: mensagem de erro com posição embutida viraria uma entrada nova
  // no Map por linha ruim — sumário ilegível e memória crescendo com o
  // arquivo. O detalhe variável só aparece nas 20 primeiras (D3).
  function registraRejeito(numeroLinha, categoria, detalhe = '') {
    const total = contadores.invalidasPorMotivo.get(categoria) ?? 0;
    contadores.invalidasPorMotivo.set(categoria, total + 1);
    if (rejeitosDetalhados < TETO_DETALHES) {
      rejeitosDetalhados += 1;
      const sufixo = detalhe === '' ? '' : ` (${detalhe})`;
      console.error(`rejeito na linha ${numeroLinha}: ${categoria}${sufixo}`);
    } else {
      rejeitosOmitidos += 1;
    }
  }

  const rl = readline.createInterface({
    input: createReadStream(entrada, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let erroDeFlush = null;
  try {
    for await (const linhaCrua of rl) {
      contadores.linhasLidas += 1;
      let linha = linhaCrua;

      // O readline não remove BOM; sem isso o primeiro clube vira
      // "registro malformado" e o gabarito dá 4 em vez de 5 (D10).
      if (contadores.linhasLidas === 1 && linha.charCodeAt(0) === 0xfeff) {
        linha = linha.slice(1);
      }

      // Skip silencioso, nunca rejeito: arquivo terminado em \n\n não
      // pode reportar erro que não existe (D11).
      if (linha.trim() === '') continue;

      let registro;
      try {
        registro = JSON.parse(linha);
      } catch (erro) {
        // Só SyntaxError é dado sujo. Qualquer outra coisa é bug nosso
        // e tem que estourar com stack, não virar "registro ruim".
        if (!(erro instanceof SyntaxError)) throw erro;
        registraRejeito(contadores.linhasLidas, 'json inválido', erro.message);
        continue;
      }

      const resultado = transformClub(registro);
      if (resultado.status === 'invalido') {
        registraRejeito(contadores.linhasLidas, resultado.motivo);
        continue;
      }
      if (resultado.status === 'filtrado') {
        contadores.clubesFiltrados += 1;
        continue;
      }

      escritorClubes.writeRow(resultado.clubRow);
      for (const linhaJogador of resultado.playerRows) {
        escritorJogadores.writeRow(linhaJogador);
      }
      contadores.clubesGravados += 1;
      contadores.jogadoresGravados += resultado.playerRows.length;
      contadores.jogadoresDescartados += resultado.jogadoresDescartados;

      // Backpressure da escrita: espera sequencial só de quem saturou.
      // Sinks independentes — um não bloqueia o outro (D9).
      if (escritorClubes.precisaDrenar) await escritorClubes.waitForDrain();
      if (escritorJogadores.precisaDrenar) await escritorJogadores.waitForDrain();
    }
  } finally {
    // Os streams fecham mesmo se o loop lançar. end() não é flush:
    // sucesso só é reportado depois do finished() dos dois (D8).
    for (const escritor of [escritorClubes, escritorJogadores]) {
      try {
        await escritor.close();
      } catch (erro) {
        erroDeFlush ??= erro;
      }
    }
  }
  if (erroDeFlush !== null) throw erroDeFlush;

  // Sumário em stderr para não contaminar o pipe do stdout (D3).
  const linhasInvalidas = [...contadores.invalidasPorMotivo.values()]
    .reduce((soma, n) => soma + n, 0);
  console.error('--- resumo ---');
  console.error(`linhas lidas: ${contadores.linhasLidas}`);
  console.error(`clubes gravados: ${contadores.clubesGravados}`);
  console.error(`jogadores gravados: ${contadores.jogadoresGravados}`);
  console.error(`jogadores descartados: ${contadores.jogadoresDescartados}`);
  console.error(`clubes filtrados: ${contadores.clubesFiltrados}`);
  console.error(`linhas inválidas: ${linhasInvalidas}`);
  for (const [motivo, total] of contadores.invalidasPorMotivo) {
    console.error(`  ${motivo}: ${total}`);
  }
  if (rejeitosOmitidos > 0) {
    console.error(`(${rejeitosOmitidos} rejeitos omitidos do detalhe; teto de ${TETO_DETALHES})`);
  }

  // Zero clubes válidos quase sempre é arquivo errado, não base vazia.
  if (contadores.clubesGravados === 0) {
    console.error('erro: nenhum clube válido encontrado na entrada');
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
