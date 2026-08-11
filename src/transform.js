// Transformação de registro cru em linhas de CSV (D2, D6, D12).
// Regra de negócio pura; política de fluxo é problema do orquestrador.

import { clean, parseDate, joinColors, isTargetChampionship } from './normalize.js';

// Fonte única por arquivo: cabeçalho e linha derivam do MESMO array (D6).
// A ordem e a grafia dos cabeçalhos são contrato literal (D12).
export const CLUB_SCHEMA = [
  { cabecalho: 'Id do Clube', extrai: (clube) => clean(clube.club_id) },
  { cabecalho: 'Nome', extrai: (clube) => clean(clube.name) },
  // Valor original da fonte; a normalização existe só no predicado (D1, D12).
  { cabecalho: 'Campeonato', extrai: (clube) => clean(clube.championship) },
  { cabecalho: 'Data de Fundação', extrai: (clube) => parseDate(clube.founding_date) },
  { cabecalho: 'Cidade', extrai: (clube) => clean(clube.city) },
  { cabecalho: 'Estado', extrai: (clube) => clean(clube.state) },
  { cabecalho: 'País', extrai: (clube) => clean(clube.country) },
  { cabecalho: 'Estádio', extrai: (clube) => clean(clube.stadium) },
  { cabecalho: 'Presidente', extrai: (clube) => clean(clube.president) },
  { cabecalho: 'Apelido', extrai: (clube) => clean(clube.nickname) },
  { cabecalho: 'Cores', extrai: (clube) => joinColors(clube.colors) },
];

// O extrator recebe o club_id do pai já limpo, não o registro cru do clube.
export const PLAYER_SCHEMA = [
  { cabecalho: 'Id do Clube', extrai: (jogador, clubId) => clubId },
  { cabecalho: 'Id do Jogador', extrai: (jogador) => clean(jogador.player_id) },
  { cabecalho: 'Nome', extrai: (jogador) => clean(jogador.name) },
  { cabecalho: 'Idade', extrai: (jogador) => clean(jogador.age) },
  { cabecalho: 'Gols', extrai: (jogador) => clean(jogador.goals) },
  { cabecalho: 'Data de Estreia', extrai: (jogador) => parseDate(jogador.debut_date) },
  { cabecalho: 'Posição', extrai: (jogador) => clean(jogador.position) },
  { cabecalho: 'Número da Camisa', extrai: (jogador) => clean(jogador.shirt_number) },
];

export function headerRow(schema) {
  return schema.map((coluna) => coluna.cabecalho);
}

function ehObjetoPlano(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Resultado discriminado, não null: o orquestrador precisa distinguir
// "descartado por inválido" de "descartado pelo filtro" — são contadores
// diferentes e só o primeiro é sintoma de dado sujo.
export function transformClub(raw) {
  if (!ehObjetoPlano(raw)) {
    return { status: 'invalido', motivo: 'registro não é um objeto' };
  }

  // Sem club_id a chave de ligação some: descarta o clube E os jogadores (D2).
  const clubId = typeof raw.club_id === 'string' ? raw.club_id.trim() : '';
  if (clubId === '') {
    return { status: 'invalido', motivo: 'club_id ausente, não-string ou vazio' };
  }

  if (!isTargetChampionship(raw.championship)) {
    return { status: 'filtrado', motivo: 'campeonato fora da allowlist' };
  }

  const clubRow = CLUB_SCHEMA.map((coluna) => coluna.extrai(raw));

  // players ausente ou não-array é clube válido com zero jogadores (D2).
  const players = Array.isArray(raw.players) ? raw.players : [];
  const playerRows = [];
  let jogadoresDescartados = 0;
  for (const jogador of players) {
    const playerId = ehObjetoPlano(jogador) && typeof jogador.player_id === 'string'
      ? jogador.player_id.trim()
      : '';
    if (playerId === '') {
      // Descarta só ele: perder os irmãos bons por 1 ruim é o pior erro (D2).
      jogadoresDescartados += 1;
      continue;
    }
    playerRows.push(PLAYER_SCHEMA.map((coluna) => coluna.extrai(jogador, clubId)));
  }

  return { status: 'ok', clubRow, playerRows, jogadoresDescartados };
}
