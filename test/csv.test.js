import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import { escapeField, formatRow, CsvWriter, EOL } from '../src/csv.js';

describe('escapeField', () => {
  test('string simples passa sem aspas', () => {
    assert.equal(escapeField('Neo Química Arena'), 'Neo Química Arena');
  });

  test('vírgula no valor envolve em aspas', () => {
    assert.equal(escapeField('Pedro Lourenço, Filho'), '"Pedro Lourenço, Filho"');
  });

  test('aspas internas são duplicadas e o campo envolvido', () => {
    assert.equal(escapeField('apelido "Timão"'), '"apelido ""Timão"""');
  });

  test('aspas no início da string', () => {
    assert.equal(escapeField('"Verdão'), '"""Verdão"');
  });

  test('quebra de linha \\n envolve em aspas', () => {
    assert.equal(escapeField('linha1\nlinha2'), '"linha1\nlinha2"');
  });

  test('\\r sozinho também envolve em aspas', () => {
    assert.equal(escapeField('linha1\rlinha2'), '"linha1\rlinha2"');
  });

  test('vírgula, aspas e quebra de linha juntos', () => {
    assert.equal(escapeField('a,"b"\nc'), '"a,""b""\nc"');
  });

  test('null vira campo vazio, nunca a string "null"', () => {
    assert.equal(escapeField(null), '');
  });

  test('undefined vira campo vazio', () => {
    assert.equal(escapeField(undefined), '');
  });

  test('número finito vira String()', () => {
    assert.equal(escapeField(30), '30');
    assert.equal(escapeField(0), '0');
    assert.equal(escapeField(-1.5), '-1.5');
  });

  test('NaN e Infinity viram campo vazio', () => {
    assert.equal(escapeField(NaN), '');
    assert.equal(escapeField(Infinity), '');
    assert.equal(escapeField(-Infinity), '');
  });

  test('objeto vira campo vazio, nunca [object Object]', () => {
    assert.equal(escapeField({ a: 1 }), '');
  });

  test('array vira campo vazio', () => {
    assert.equal(escapeField(['preto', 'branco']), '');
  });

  test('boolean vira campo vazio', () => {
    assert.equal(escapeField(true), '');
    assert.equal(escapeField(false), '');
  });
});

describe('formatRow', () => {
  test('junta campos escapados com vírgula', () => {
    assert.equal(
      formatRow(['SCCP', 'Pedro Lourenço, Filho', null, 30]),
      'SCCP,"Pedro Lourenço, Filho",,30',
    );
  });
});

// Sink que coleta tudo em memória, com callback imediato.
function sinkColetor() {
  const pedacos = [];
  const sink = new Writable({
    write(chunk, encoding, callback) {
      pedacos.push(chunk);
      callback();
    },
  });
  return { sink, conteudo: () => Buffer.concat(pedacos).toString('utf8') };
}

describe('CsvWriter', () => {
  test('escreve cabeçalho no construtor e linhas com EOL default LF', async () => {
    const { sink, conteudo } = sinkColetor();
    const writer = new CsvWriter(sink, ['Id do Clube', 'Nome']);
    writer.writeRow(['SCCP', 'Corinthians']);
    await writer.close();

    assert.equal(EOL, '\n');
    assert.equal(conteudo(), 'Id do Clube,Nome\nSCCP,Corinthians\n');
  });

  test('cabeçalho também passa pelo escape', async () => {
    const { sink, conteudo } = sinkColetor();
    const writer = new CsvWriter(sink, ['Nome, Completo']);
    await writer.close();

    assert.equal(conteudo(), '"Nome, Completo"\n');
  });

  test('close() só resolve depois do flush do sink', async () => {
    let flushado = false;
    const sink = new Writable({
      write(chunk, encoding, callback) {
        // Segura o flush por um tick para provar que close() espera.
        setImmediate(() => {
          flushado = true;
          callback();
        });
      },
    });
    const writer = new CsvWriter(sink, ['a']);
    await writer.close();
    assert.equal(flushado, true);
  });

  test('saturação: writeRow devolve false e waitForDrain espera o drain real', async () => {
    // highWaterMark 1 e callback segurado: qualquer write satura o buffer.
    const callbacks = [];
    const sink = new Writable({
      highWaterMark: 1,
      write(chunk, encoding, callback) {
        callbacks.push(callback);
      },
    });

    const writer = new CsvWriter(sink, ['a']);
    const aceitou = writer.writeRow(['1']);
    assert.equal(aceitou, false);
    assert.equal(writer.precisaDrenar, true);

    let drenado = false;
    const espera = writer.waitForDrain().then(() => {
      drenado = true;
    });

    // Com o callback ainda preso, o drain não pode ter disparado.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(drenado, false);

    // Libera os callbacks presos (cada um pode enfileirar o próximo write).
    while (callbacks.length) {
      callbacks.shift()();
    }

    await espera;
    assert.equal(drenado, true);
    assert.equal(writer.precisaDrenar, false);
  });

  test('waitForDrain rejeita se o sink falhar durante a espera', async () => {
    const callbacks = [];
    const sink = new Writable({
      highWaterMark: 1,
      write(chunk, encoding, callback) {
        callbacks.push(callback);
      },
    });

    const writer = new CsvWriter(sink, ['a']);
    assert.equal(writer.writeRow(['1']), false);

    const espera = writer.waitForDrain();
    // Sink morre com o buffer cheio: a espera tem que rejeitar, não pendurar.
    callbacks.shift()(new Error('disco falhou'));

    await assert.rejects(espera, { message: 'disco falhou' });
  });
});
