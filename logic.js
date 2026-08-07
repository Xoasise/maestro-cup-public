// Logique de classement et de phase finale — partagée par le site public et le panel admin.
// (Ce fichier est volontairement dupliqué dans les deux dépôts pour rester deux sites indépendants.)

import { POULES } from "./tournament-config.js";
export { POULES };

// Génère automatiquement le bracket (huitièmes/quarts/demies/finale) à partir
// du nombre de poules en config (tournament-config.js).
//   8 poules -> 16 qualifiés -> huitièmes + quarts + demies + finale
//   4 poules -> 8 qualifiés  -> quarts + demies + finale (pas de huitièmes)
const ROUND_NAMES = {
  16: ["hf", "qf", "sf", "final"],
  8:  ["qf", "sf", "final"],
};

const ROUND_LABELS = {
  hf: "Huitième de finale", qf: "Quart de finale",
  sf: "Demi-finale", final: "Finale",
};

export function generateBracketDef(poules) {
  const nQualified = poules.length * 2;
  const rounds = ROUND_NAMES[nQualified];
  if (!rounds) throw new Error(`Nombre de poules non supporté: ${poules.length}`);

  const def = {};

  // ---- 1er tour : construit à partir des paires de poules ----
  const firstRound = rounds[0];
  let firstRoundKeys = [];
  for (let i = 0; i < poules.length; i += 2) {
    const [pA, pB] = [poules[i], poules[i + 1]];
    const key1 = `${firstRound}${firstRoundKeys.length + 1}`;
    def[key1] = { label: `${ROUND_LABELS[firstRound]} ${firstRoundKeys.length + 1}`, from: [[pA, 1], [pB, 2]] };
    firstRoundKeys.push(key1);

    const key2 = `${firstRound}${firstRoundKeys.length + 1}`;
    def[key2] = { label: `${ROUND_LABELS[firstRound]} ${firstRoundKeys.length + 1}`, from: [[pB, 1], [pA, 2]] };
    firstRoundKeys.push(key2);
  }

  // ---- Tours suivants : on regroupe les clés du tour précédent 2 par 2 ----
  let prevKeys = firstRoundKeys;
  for (let r = 1; r < rounds.length; r++) {
    const roundName = rounds[r];
    const newKeys = [];
    for (let i = 0; i < prevKeys.length; i += 2) {
      const key = roundName === "final" ? "final" : `${roundName}${newKeys.length + 1}`;
      def[key] = {
        label: roundName === "final" ? "Finale" : `${ROUND_LABELS[roundName]} ${newKeys.length + 1}`,
        from: [[prevKeys[i]], [prevKeys[i + 1]]],
      };
      newKeys.push(key);
    }
    prevKeys = newKeys;
  }

  return def;
}

export const BRACKET_DEF = generateBracketDef(POULES);

const ROUND_ORDER = [
  { prefix: "hf", title: "Huitièmes de finale" },
  { prefix: "qf", title: "Quarts de finale" },
  { prefix: "sf", title: "Demi-finales" },
  { prefix: "final", title: "Finale" },
];

// Déduit dynamiquement les tours réellement présents dans un BRACKET_DEF donné
// (utile pour l'affichage admin, qui n'a pas à savoir combien de tours il y a).
export function getBracketRounds(bracketDef) {
  const keys = Object.keys(bracketDef);
  return ROUND_ORDER
    .map(({ prefix, title }) => ({
      title,
      keys: keys.filter((k) => k.startsWith(prefix)).sort(),
    }))
    .filter((r) => r.keys.length > 0);
}

/**
 * Calcule le classement d'une poule à partir des matchs terminés.
 * teams: liste des équipes (objets Firestore) de la poule
 * matches: toutes les matchs de poule (phase de groupes)
 * Retourne un tableau trié [{...team, mj,g,n,p,bp,bc,diff,pts}]
 */
export function computeStandings(teams, matches) {
  const stats = {};
  teams.forEach((t) => {
    stats[t.id] = {
      ...t,
      mj: 0, g: 0, n: 0, p: 0, bp: 0, bc: 0, diff: 0,
      pts: -(Number(t.penalty) || 0),
    };
  });

  const poulesMatches = matches.filter(
    (m) => m.poule && stats[m.teamA] && stats[m.teamB] && m.status === "finished" &&
      m.scoreA !== null && m.scoreB !== null
  );

  poulesMatches.forEach((m) => {
    const a = stats[m.teamA];
    const b = stats[m.teamB];
    a.mj++; b.mj++;
    a.bp += m.scoreA; a.bc += m.scoreB;
    b.bp += m.scoreB; b.bc += m.scoreA;
    if (m.scoreA > m.scoreB) { a.g++; b.p++; a.pts += 3; }
    else if (m.scoreA < m.scoreB) { b.g++; a.p++; b.pts += 3; }
    else { a.n++; b.n++; a.pts += 1; b.pts += 1; }
  });

  Object.values(stats).forEach((s) => { s.diff = s.bp - s.bc; });

  const list = Object.values(stats);

  // Tri : points desc, diff buts desc, buts marqués desc, confrontation directe, sinon égalité
  list.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.diff !== x.diff) return y.diff - x.diff;
    if (y.bp !== x.bp) return y.bp - x.bp;
    const h2h = headToHead(x, y, poulesMatches);
    if (h2h !== 0) return h2h;
    return 0; // égalité totale -> tirage au sort (à départager manuellement)
  });

  return list;
}

function headToHead(x, y, matches) {
  const direct = matches.find(
    (m) => (m.teamA === x.id && m.teamB === y.id) || (m.teamA === y.id && m.teamB === x.id)
  );
  if (!direct) return 0;
  const xIsA = direct.teamA === x.id;
  const xScore = xIsA ? direct.scoreA : direct.scoreB;
  const yScore = xIsA ? direct.scoreB : direct.scoreA;
  return yScore - xScore;
}

/**
 * Calcule le nom d'affichage + id d'équipe pour une place dans l'arbre (bracket).
 * standingsByPoule: { A: [...], B: [...], ..., H: [...] }
 * bracketMatches: { hf1: {...}, qf1: {...}, ... } (scores + status)
 */
export function resolveSlot(slotDef, standingsByPoule, bracketMatches, teamsById) {
  if (slotDef.length === 2) {
    // ["A", 1] -> poule A, rang 1
    const [poule, rank] = slotDef;
    const arr = standingsByPoule[poule] || [];
    const team = arr[rank - 1];
    return team ? { id: team.id, name: team.name, flag: team.flag, resolved: true } : { name: `${rank === 1 ? "1er" : "2e"} Poule ${poule}`, resolved: false };
  }
  // ["hf1"] / ["qf1"] -> vainqueur du match référencé
  const key = slotDef[0];
  const m = bracketMatches[key];
  const label = BRACKET_DEF[key]?.label || key;
  if (!m || m.status !== "finished" || m.scoreA === null || m.scoreB === null || m.scoreA === m.scoreB) {
    return { name: `Vainqueur ${label}`, resolved: false };
  }
  const winnerId = m.scoreA > m.scoreB ? m.teamA : m.teamB;
  const team = teamsById[winnerId];
  return team ? { id: team.id, name: team.name, flag: team.flag, resolved: true } : { name: `Vainqueur ${label}`, resolved: false };
}

export function buildBracketView(teams, poulesMatches, bracketMatches) {
  const teamsById = {};
  teams.forEach((t) => { teamsById[t.id] = t; });

  const standingsByPoule = {};
  POULES.forEach((p) => {
    standingsByPoule[p] = computeStandings(teams.filter((t) => t.poule === p), poulesMatches);
  });

  const view = {};
  Object.entries(BRACKET_DEF).forEach(([key, def]) => {
    const [slotA, slotB] = def.from;
    view[key] = {
      key,
      label: def.label,
      teamA: resolveSlot(slotA, standingsByPoule, bracketMatches, teamsById),
      teamB: resolveSlot(slotB, standingsByPoule, bracketMatches, teamsById),
      scoreA: bracketMatches[key]?.scoreA ?? null,
      scoreB: bracketMatches[key]?.scoreB ?? null,
      status: bracketMatches[key]?.status || "upcoming",
    };
  });

  return { standingsByPoule, bracket: view };
}

export function poulesTerminees(poulesMatches) {
  return poulesMatches.length > 0 && poulesMatches.every((m) => m.status === "finished");
}
