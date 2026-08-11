import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CLUB_SCHEMA, PLAYER_SCHEMA, headerRow, transformClub } from '../src/transform.js';

function clubeValido(extras = {}) {
  return {
    club_id: 'SCCP',
    name: 'Corinthians',
    championship: 'SERIE A',
    founding_date: '1910-09-01',
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
    stadium: 'Neo Química Arena',
    president: 'Augusto Melo',
    nickname: 'Timão',
    colors: ['preto', 'branco'],
    players: [],
    ...extras,
  };
}

function jogadorValido(extras = {}) {
  return {
    player_id: 'SCCP-10',
    name: 'Rodrigo Garro',
    age: 26,
    goals: 8,
    debut_date: '2024-01-18',
    position: 'Meia',
    shirt_number: 10,
    ...extras,
  };
}

describe('headerRow', () => {
  test('cabeçalhos de clubs.csv batem com D12, ordem e grafia literais', () => {
    assert.deepEqual(headerRow(CLUB_SCHEMA), [
      'Id do Clube',
      'Nome',
      'Campeonato',
      'Data de Fundação',
      'Cidade',
      'Estado',
      'País',
      'Estádio',
      'Presidente',
      'Apelido',
      'Cores',
    ]);
  });

  test('cabeçalhos de players.csv batem com D12', () => {
    assert.deepEqual(headerRow(PLAYER_SCHEMA), [
      'Id do Clube',
      'Id do Jogador',
      'Nome',
      'Idade',
      'Gols',
      'Data de Estreia',
      'Posição',
      'Número da Camisa',
    ]);
  });
});

describe('transformClub: registros inválidos', () => {
  test('raw null é invalido', () => {
    assert.equal(transformClub(null).status, 'invalido');
  });

  test('raw array é invalido', () => {
    assert.equal(transformClub([clubeValido()]).status, 'invalido');
  });

  test('raw string e número são invalidos', () => {
    assert.equal(transformClub('SCCP').status, 'invalido');
    assert.equal(transformClub(42).status, 'invalido');
  });

  test('clube sem club_id é invalido', () => {
    const { club_id, ...semId } = clubeValido();
    assert.equal(transformClub(semId).status, 'invalido');
  });

  test('club_id como número é invalido, não convertido', () => {
    assert.equal(transformClub(clubeValido({ club_id: 1910 })).status, 'invalido');
  });

  test('club_id só de espaços é invalido', () => {
    assert.equal(transformClub(clubeValido({ club_id: '   ' })).status, 'invalido');
  });

  test('invalido não carrega linhas: jogadores caem junto com o clube', () => {
    const resultado = transformClub(
      clubeValido({ club_id: '', players: [jogadorValido()] }),
    );
    assert.equal(resultado.status, 'invalido');
    assert.equal(resultado.clubRow, undefined);
    assert.equal(resultado.playerRows, undefined);
  });
});

describe('transformClub: filtro de campeonato', () => {
  test('fora da allowlist é filtrado, não invalido', () => {
    const resultado = transformClub(clubeValido({ championship: 'SEM CAMPEONATO' }));
    assert.equal(resultado.status, 'filtrado');
    assert.equal(resultado.clubRow, undefined);
  });

  test('SERIE C é filtrado', () => {
    assert.equal(transformClub(clubeValido({ championship: 'SERIE C' })).status, 'filtrado');
  });

  test('grafia alternativa da série passa o filtro', () => {
    assert.equal(transformClub(clubeValido({ championship: 'Série-B' })).status, 'ok');
  });
});

describe('transformClub: clube ok', () => {
  test('linha do clube bate com o cabeçalho derivado, índice a índice', () => {
    const clube = clubeValido();
    const { clubRow } = transformClub(clube);
    const esperadoPorCabecalho = {
      'Id do Clube': 'SCCP',
      'Nome': 'Corinthians',
      'Campeonato': 'SERIE A',
      'Data de Fundação': '1910-09-01',
      'Cidade': 'São Paulo',
      'Estado': 'SP',
      'País': 'Brasil',
      'Estádio': 'Neo Química Arena',
      'Presidente': 'Augusto Melo',
      'Apelido': 'Timão',
      'Cores': 'preto|branco',
    };
    headerRow(CLUB_SCHEMA).forEach((cabecalho, i) => {
      assert.equal(clubRow[i], esperadoPorCabecalho[cabecalho], `coluna "${cabecalho}"`);
    });
    assert.equal(clubRow.length, CLUB_SCHEMA.length);
  });

  test('players ausente vira clube ok com zero jogadores, sem descarte', () => {
    const { players, ...semPlayers } = clubeValido();
    const resultado = transformClub(semPlayers);
    assert.equal(resultado.status, 'ok');
    assert.deepEqual(resultado.playerRows, []);
    assert.equal(resultado.jogadoresDescartados, 0);
  });

  test('players como objeto é tratado como zero jogadores, não é erro', () => {
    const resultado = transformClub(clubeValido({ players: { player_id: 'X-1' } }));
    assert.equal(resultado.status, 'ok');
    assert.deepEqual(resultado.playerRows, []);
    assert.equal(resultado.jogadoresDescartados, 0);
  });

  test('campos com tipo inesperado degradam para vazio sem derrubar a linha', () => {
    const { clubRow } = transformClub(
      clubeValido({ nickname: null, colors: 'preto', founding_date: '2024-02-31' }),
    );
    const cabecalhos = headerRow(CLUB_SCHEMA);
    assert.equal(clubRow[cabecalhos.indexOf('Apelido')], '');
    assert.equal(clubRow[cabecalhos.indexOf('Cores')], '');
    assert.equal(clubRow[cabecalhos.indexOf('Data de Fundação')], '');
    assert.equal(clubRow[cabecalhos.indexOf('Id do Clube')], 'SCCP');
  });
});

describe('transformClub: jogadores', () => {
  test('jogador sem player_id no meio de três: irmãos sobrevivem, contador marca 1', () => {
    const resultado = transformClub(clubeValido({
      players: [
        jogadorValido({ player_id: 'SCCP-10' }),
        jogadorValido({ player_id: undefined }),
        jogadorValido({ player_id: 'SCCP-1' }),
      ],
    }));
    assert.equal(resultado.status, 'ok');
    assert.equal(resultado.playerRows.length, 2);
    assert.equal(resultado.jogadoresDescartados, 1);
    const idxJogador = headerRow(PLAYER_SCHEMA).indexOf('Id do Jogador');
    assert.deepEqual(
      resultado.playerRows.map((linha) => linha[idxJogador]),
      ['SCCP-10', 'SCCP-1'],
    );
  });

  test('jogador que não é objeto é descartado sozinho', () => {
    const resultado = transformClub(clubeValido({
      players: ['corda', null, jogadorValido()],
    }));
    assert.equal(resultado.playerRows.length, 1);
    assert.equal(resultado.jogadoresDescartados, 2);
  });

  test('linha do jogador bate com o cabeçalho derivado, índice a índice', () => {
    const resultado = transformClub(clubeValido({
      club_id: ' SCCP ',
      players: [jogadorValido()],
    }));
    const esperadoPorCabecalho = {
      // club_id do pai chega já limpo ao extrator.
      'Id do Clube': 'SCCP',
      'Id do Jogador': 'SCCP-10',
      'Nome': 'Rodrigo Garro',
      'Idade': '26',
      'Gols': '8',
      'Data de Estreia': '2024-01-18',
      'Posição': 'Meia',
      'Número da Camisa': '10',
    };
    const [linha] = resultado.playerRows;
    headerRow(PLAYER_SCHEMA).forEach((cabecalho, i) => {
      assert.equal(linha[i], esperadoPorCabecalho[cabecalho], `coluna "${cabecalho}"`);
    });
    assert.equal(linha.length, PLAYER_SCHEMA.length);
  });
});
