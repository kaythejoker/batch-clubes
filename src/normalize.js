// Normalização de campos: funções puras, sem I/O, sem estado (D1, D5, D13, D14).
// Contrato de todas: nunca lançam e sempre devolvem string escrevível.

// Regra de negócio sobre o dado — não confundir com escapeField, que é regra
// de formato do arquivo. Os dois existem por razões diferentes.
export function clean(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

// yyyy-MM-dd, com hora opcional descartada (só a parte da data interessa).
const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

// Validação de calendário na mão, sem construir Date. Dois motivos:
// em milhões de registros o custo de alocar Date importa, e o construtor
// tem armadilha silenciosa — new Date("2024-02-31") não lança, rola para
// 2 de março, e gravaríamos uma data que não existia na fonte (D14).
export function parseDate(v) {
  if (typeof v !== 'string') return '';
  const m = FORMATO_DATA.exec(v.trim());
  if (m === null) return '';

  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);

  if (ano === 0) return '';
  if (mes < 1 || mes > 12) return '';

  // Bissexto completo: divisível por 4, exceto século não divisível por 400.
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const diasNoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dia < 1 || dia > diasNoMes[mes - 1]) return '';

  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Array vira "a|b|c"; elemento que não é string é descartado do join (D13).
export function joinColors(v) {
  if (!Array.isArray(v)) return '';
  return v
    .filter((cor) => typeof cor === 'string')
    .map((cor) => cor.trim())
    .filter((cor) => cor !== '')
    .join('|');
}

// Combinantes U+0300–U+036F, que o normalize('NFD') separa das letras base.
const DIACRITICOS = /[̀-ͯ]/g;

// Só para o predicado do filtro: a saída escreve o valor original (D1, D12).
export function normalizeChampionship(v) {
  if (typeof v !== 'string') return '';
  return v
    .trim()
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toUpperCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CAMPEONATOS_ALVO = new Set(['SERIE A', 'SERIE B']);

// Allowlist, não denylist: SERIE C fica de fora por decisão, não por acaso (D1).
export function isTargetChampionship(v) {
  return CAMPEONATOS_ALVO.has(normalizeChampionship(v));
}
