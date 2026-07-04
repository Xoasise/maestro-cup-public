// Logique de classement et de phase finale — partagée par le site public et le panel admin.
// (Ce fichier est volontairement dupliqué dans les deux dépôts pour rester deux sites indépendants.)

export const BRACKET_DEF = {
  qf1: { label: "Quart de finale 1", from: [["A", 1], ["B", 2]] },
  qf2: { label: "Quart de finale 2", from: [["C", 1], ["D", 2]] },
  qf3: { label: "Quart de finale 3", from: [["B", 1], ["A", 2]] },
  qf4: { label: "Quart de finale 4", from: [["D", 1], ["C", 2]] },
  sf1: { label: "Demi-finale 1", from: [["qf1"], ["qf2"]] },
  sf2: { label: "Demi-finale 2", from: [["qf3"], ["qf4"]] },
  final: { label: "Finale", from: [["sf1"], ["sf2"]] },
};

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
 * standingsByPoule: { A: [...], B: [...], C: [...], D: [...] }
 * bracketMatches: { qf1: {...}, qf2: {...}, ... } (scores + status)
 */
export function resolveSlot(slotDef, standingsByPoule, bracketMatches, teamsById) {
  if (slotDef.length === 2) {
    // ["A", 1] -> poule A, rang 1
    const [poule, rank] = slotDef;
    const arr = standingsByPoule[poule] || [];
    const team = arr[rank - 1];
    return team ? { id: team.id, name: team.name, flag: team.flag, resolved: true } : { name: `${rank === 1 ? "1er" : "2e"} Poule ${poule}`, resolved: false };
  }
  // ["qf1"] -> vainqueur du match qf1
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

  const standingsByPoule = { A: [], B: [], C: [], D: [] };
  ["A", "B", "C", "D"].forEach((p) => {
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
