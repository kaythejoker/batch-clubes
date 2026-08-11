// Escrita de CSV com escape RFC 4180 (docs/decisoes.md, D4, D6, D7, D8, D9).
// Sem dependência externa: o escaping são poucas linhas e o controle vale mais.

import { once } from 'node:events';
import { finished } from 'node:stream/promises';

// Fim de linha da saída. LF é desvio consciente do RFC 4180 (D4).
export const EOL = '\n';

const PRECISA_ASPAS = /[",\r\n]/;

// Contrato: nunca lança e sempre devolve algo escrevível (D5).
export function escapeField(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') {
    if (!PRECISA_ASPAS.test(valor)) return valor;
    return `"${valor.replaceAll('"', '""')}"`;
  }
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? String(valor) : '';
  }
  // Objeto, array, boolean etc. não têm representação tabular óbvia:
  // campo vazio, a linha continua.
  return '';
}

export function formatRow(campos) {
  return campos.map(escapeField).join(',');
}

// Escreve linhas num Writable e reporta saturação; NÃO decide quando pausar.
// A política de fluxo fica com o orquestrador, em um lugar só.
export class CsvWriter {
  #stream;
  #eol;

  constructor(stream, cabecalhos, { eol = EOL } = {}) {
    this.#stream = stream;
    this.#eol = eol;
    this.#stream.write(formatRow(cabecalhos) + this.#eol);
  }

  // Devolve o boolean do write() subjacente: false = buffer cheio.
  writeRow(campos) {
    return this.#stream.write(formatRow(campos) + this.#eol);
  }

  get precisaDrenar() {
    return this.#stream.writableNeedDrain;
  }

  // once() de node:events, não Promise artesanal: se o sink falhar com o
  // buffer cheio, o 'error' rejeita em vez de pendurar para sempre (D9).
  async waitForDrain() {
    await once(this.#stream, 'drain');
  }

  // end() não é flush: só reporta sucesso depois do finished() (D8).
  async close() {
    this.#stream.end();
    await finished(this.#stream);
  }
}
