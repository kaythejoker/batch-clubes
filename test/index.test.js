// Teste de integração: roda o processo real contra um JSONL temporário e
// valida o texto bruto dos arquivos gerados, não chamadas de writer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rodaProcesso = promisify(execFile);
const INDEX = fileURLToPath(new URL('../src/index.js', import.meta.url));

// Roda o CLI num diretório temporário e devolve stderr, exit code e o
// conteúdo bruto dos dois CSVs.
async function roda(conteudoJsonl) {
  const dir = await mkdtemp(path.join(tmpdir(), 'desafio-batch-'));
  try {
    const entrada = path.join(dir, 'entrada.jsonl');
    await writeFile(entrada, conteudoJsonl);

    let stderr;
    let code = 0;
    try {
      ({ stderr } = await rodaProcesso(process.execPath, [INDEX, entrada, '--out-dir', dir]));
    } catch (erro) {
      ({ stderr, code } = erro);
    }

    const leOuNull = (nome) => readFile(path.join(dir, nome), 'utf8').catch(() => null);
    return { stderr, code, clubs: await leOuNull('clubs.csv'), players: await leOuNull('players.csv') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CLUBE_AAA = JSON.stringify({
  club_id: 'AAA',
  name: 'Alfa',
  championship: 'SERIE A',
  founding_date: '1910-09-01',
  city: 'Cidade A',
  state: 'SP',
  country: 'Brasil',
  stadium: 'Estádio A',
  president: 'Silva, Junior',
  nickname: null,
  colors: ['preto', 'branco'],
  players: [{
    player_id: 'AAA-1',
    name: 'Jog Um',
    age: 20,
    goals: 3,
    debut_date: '2024-01-18',
    position: 'Meia',
    shirt_number: 10,
  }],
});

const CLUBE_CCC = JSON.stringify({
  club_id: 'CCC',
  name: 'Gama',
  championship: 'serie_b',
  founding_date: '2000-02-29',
  city: 'Cidade C',
  state: 'SC',
  country: 'Brasil',
  stadium: 'Estádio C',
  president: 'Presidente C',
  nickname: 'Leão',
  colors: ['azul'],
});

const CLUBE_FILTRADO = JSON.stringify({
  club_id: 'NAC',
  name: 'Nacional',
  championship: 'SEM CAMPEONATO',
  players: [{ player_id: 'NAC-1', name: 'Invisível' }],
});

const CABECALHO_CLUBS =
  'Id do Clube,Nome,Campeonato,Data de Fundação,Cidade,Estado,País,Estádio,Presidente,Apelido,Cores';
const CABECALHO_PLAYERS =
  'Id do Clube,Id do Jogador,Nome,Idade,Gols,Data de Estreia,Posição,Número da Camisa';

describe('integração do cli', () => {
  test('caminho feliz: texto bruto dos dois csvs, byte a byte', async () => {
    const { stderr, code, clubs, players } = await roda(
      `${CLUBE_AAA}\n${CLUBE_FILTRADO}\n${CLUBE_CCC}\n`,
    );

    assert.equal(code, 0, stderr);
    assert.equal(clubs, [
      CABECALHO_CLUBS,
      'AAA,Alfa,SERIE A,1910-09-01,Cidade A,SP,Brasil,Estádio A,"Silva, Junior",,preto|branco',
      // campeonato sai com a grafia original da fonte; players ausente é ok
      'CCC,Gama,serie_b,2000-02-29,Cidade C,SC,Brasil,Estádio C,Presidente C,Leão,azul',
      '',
    ].join('\n'));
    assert.equal(players, [
      CABECALHO_PLAYERS,
      'AAA,AAA-1,Jog Um,20,3,2024-01-18,Meia,10',
      '',
    ].join('\n'));

    assert.match(stderr, /clubes gravados: 2/);
    assert.match(stderr, /jogadores gravados: 1/);
    assert.match(stderr, /clubes filtrados: 1/);
    assert.match(stderr, /linhas inválidas: 0/);
  });

  test('json quebrado no meio: as linhas seguintes são processadas', async () => {
    const { stderr, code, clubs } = await roda(
      `${CLUBE_AAA}\n{"club_id": "QUEBRADO"\n${CLUBE_CCC}\n`,
    );

    assert.equal(code, 0, stderr);
    const linhas = clubs.trimEnd().split('\n');
    assert.equal(linhas.length, 3); // cabeçalho + AAA + CCC
    assert.match(linhas[2], /^CCC,/);
    assert.match(stderr, /rejeito na linha 2: json inválido/);
    assert.match(stderr, /linhas inválidas: 1/);
  });

  test('bom no início: o primeiro clube sobrevive', async () => {
    const { stderr, code, clubs } = await roda(`﻿${CLUBE_AAA}\n${CLUBE_CCC}\n`);

    assert.equal(code, 0, stderr);
    assert.match(clubs, /^Id do Clube/); // cabeçalho, não BOM
    assert.match(clubs, /\nAAA,/);
    assert.match(stderr, /clubes gravados: 2/);
    assert.match(stderr, /linhas inválidas: 0/);
  });

  test('linha em branco no fim não vira rejeito', async () => {
    const { stderr, code } = await roda(`${CLUBE_AAA}\n\n`);

    assert.equal(code, 0, stderr);
    assert.match(stderr, /linhas inválidas: 0/);
    assert.doesNotMatch(stderr, /rejeito na linha/);
  });

  test('cabeçalho conferido byte a byte mesmo com zero jogadores', async () => {
    const { players } = await roda(`${CLUBE_CCC}\n`);
    assert.equal(players, `${CABECALHO_PLAYERS}\n`);
  });

  test('sem posicional: uso e exit 1', async () => {
    let falha = null;
    try {
      await rodaProcesso(process.execPath, [INDEX]);
    } catch (erro) {
      falha = erro;
    }
    assert.equal(falha?.code, 1);
    assert.match(falha.stderr, /uso:/);
  });

  test('arquivo inexistente: erro claro citando o caminho, exit 1', async () => {
    let falha = null;
    try {
      await rodaProcesso(process.execPath, [INDEX, 'nao-existe.jsonl']);
    } catch (erro) {
      falha = erro;
    }
    assert.equal(falha?.code, 1);
    assert.match(falha.stderr, /nao-existe\.jsonl/);
    assert.doesNotMatch(falha.stderr, /ENOENT/); // erro tratado, não stack cru
  });

  test('diretório passado como entrada: erro claro citando o caminho, exit 1', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'desafio-dir-'));
    let falha = null;
    try {
      await rodaProcesso(process.execPath, [INDEX, dir]);
    } catch (erro) {
      falha = erro;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    assert.equal(falha?.code, 1);
    assert.match(falha.stderr, /não é um arquivo/);
    assert.ok(falha.stderr.includes(dir), 'stderr cita o caminho recebido');
    assert.doesNotMatch(falha.stderr, /EISDIR/); // erro tratado, não stack cru
  });

  test('zero clubes válidos: exit 1', async () => {
    const { stderr, code } = await roda(`${CLUBE_FILTRADO}\n`);
    assert.equal(code, 1);
    assert.match(stderr, /nenhum clube válido/);
  });
});
