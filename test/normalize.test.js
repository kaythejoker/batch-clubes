import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  clean,
  parseDate,
  joinColors,
  normalizeChampionship,
  isTargetChampionship,
} from '../src/normalize.js';

describe('clean', () => {
  test('string passa com trim', () => {
    assert.equal(clean('  Timão  '), 'Timão');
  });

  test('número finito vira String()', () => {
    assert.equal(clean(10), '10');
    assert.equal(clean(0), '0');
  });

  test('nickname null vira vazio, nunca a string "null"', () => {
    assert.equal(clean(null), '');
  });

  test('undefined vira vazio', () => {
    assert.equal(clean(undefined), '');
  });

  test('NaN e Infinity viram vazio', () => {
    assert.equal(clean(NaN), '');
    assert.equal(clean(Infinity), '');
  });

  test('objeto, array e boolean viram vazio', () => {
    assert.equal(clean({}), '');
    assert.equal(clean(['a']), '');
    assert.equal(clean(true), '');
  });
});

describe('parseDate', () => {
  test('data válida passa como veio', () => {
    assert.equal(parseDate('2024-01-18'), '2024-01-18');
  });

  test('ISO com componente de hora extrai só a data', () => {
    assert.equal(parseDate('2024-01-18T10:30:00Z'), '2024-01-18');
    assert.equal(parseDate('2024-01-18 10:30:00'), '2024-01-18');
  });

  test('29 de fevereiro: 2024 é bissexto real, 2023 não', () => {
    assert.equal(parseDate('2024-02-29'), '2024-02-29');
    assert.equal(parseDate('2023-02-29'), '');
  });

  test('regra de século: 1900 não é bissexto, 2000 é', () => {
    // O caso que separa a regra completa de "divisível por 4".
    assert.equal(parseDate('1900-02-29'), '');
    assert.equal(parseDate('2000-02-29'), '2000-02-29');
  });

  test('dia 31 em mês de 30 e 2024-02-31 são rejeitados', () => {
    assert.equal(parseDate('2024-04-31'), '');
    assert.equal(parseDate('2024-02-31'), '');
  });

  test('formato brasileiro é rejeitado', () => {
    assert.equal(parseDate('18/01/2024'), '');
  });

  test('sem zero à esquerda é rejeitado', () => {
    assert.equal(parseDate('2024-2-1'), '');
  });

  test('ano 0000 é rejeitado', () => {
    assert.equal(parseDate('0000-01-01'), '');
  });

  test('mês 00 e mês 13 são rejeitados', () => {
    assert.equal(parseDate('2024-00-10'), '');
    assert.equal(parseDate('2024-13-10'), '');
  });

  test('dia 00 é rejeitado', () => {
    assert.equal(parseDate('2024-01-00'), '');
  });

  test('entrada que não é data vira vazio sem lançar', () => {
    assert.equal(parseDate(''), '');
    assert.equal(parseDate(20240118), '');
    assert.equal(parseDate(null), '');
    assert.equal(parseDate(undefined), '');
    assert.equal(parseDate({}), '');
  });
});

describe('joinColors', () => {
  test('array de strings junta com pipe sem espaço', () => {
    assert.equal(joinColors(['preto', 'branco']), 'preto|branco');
  });

  test('elementos com espaço nas pontas passam por trim', () => {
    assert.equal(joinColors([' azul ', 'branco']), 'azul|branco');
  });

  test('números no meio do array são descartados do join', () => {
    assert.equal(joinColors(['preto', 7, 'branco']), 'preto|branco');
  });

  test('null no meio do array é descartado', () => {
    assert.equal(joinColors(['verde', null, 'branco']), 'verde|branco');
  });

  test('array de arrays é descartado, nunca vira [object Object] nem vírgula', () => {
    assert.equal(joinColors([['preto'], 'branco']), 'branco');
  });

  test('string vazia e só-espaços somem depois do trim', () => {
    assert.equal(joinColors(['', '  ', 'azul']), 'azul');
  });

  test('array vazio, não-array e ausente viram vazio', () => {
    assert.equal(joinColors([]), '');
    assert.equal(joinColors('preto'), '');
    assert.equal(joinColors(undefined), '');
    assert.equal(joinColors(null), '');
  });
});

describe('normalizeChampionship', () => {
  test('os quatro formatos caem no mesmo bucket', () => {
    assert.equal(normalizeChampionship('Série A'), 'SERIE A');
    assert.equal(normalizeChampionship('serie_a'), 'SERIE A');
    assert.equal(normalizeChampionship('SERIE A '), 'SERIE A');
    assert.equal(normalizeChampionship('SÉRIE-B'), 'SERIE B');
  });

  test('espaços internos colapsam', () => {
    assert.equal(normalizeChampionship('SERIE   A'), 'SERIE A');
  });

  test('não-string vira vazio sem lançar', () => {
    assert.equal(normalizeChampionship(null), '');
    assert.equal(normalizeChampionship(42), '');
  });
});

describe('isTargetChampionship', () => {
  test('as duas séries passam em qualquer grafia', () => {
    assert.equal(isTargetChampionship('Série A'), true);
    assert.equal(isTargetChampionship('serie_b'), true);
  });

  test('SERIE C fica de fora: allowlist, não denylist', () => {
    assert.equal(isTargetChampionship('SERIE C'), false);
  });

  test('vazio, SEM CAMPEONATO e não-string ficam de fora', () => {
    assert.equal(isTargetChampionship(''), false);
    assert.equal(isTargetChampionship('SEM CAMPEONATO'), false);
    assert.equal(isTargetChampionship(null), false);
  });
});
