import { firebaseConfig } from "./firebase-config.js";
import { computeStandings, buildBracketView, poulesTerminees, POULES } from "./logic.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, getDoc, doc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const POLL_INTERVAL_MS = 60_000;      // même cadence que le site public
const ROTATE_MS = 10_000;             // vitesse de rotation de TOUS les panneaux qui tournent
const PANEL_PAGE_SIZE = 4;            // nb de lignes affichées à la fois dans les panneaux qui tournent

// Ajoute ?clean=1 à l'URL de la Browser Source dans OBS une fois la caméra
// bien calée, pour masquer le repère en pointillés.
if (new URLSearchParams(location.search).get("clean") === "1") {
  document.body.classList.add("clean");
}

const POULE_COLOR = {
  A: "#e8b84b", B: "#4caf7d", C: "#e15554", D: "#4a90d9",
  E: "#9c6ade", F: "#e07b39", G: "#39a7e0", H: "#c9e034",
};

let TEAMS = [];
let MATCHES = [];
let BRACKET = {};

// Les poules défilent par paire (une en haut, une en bas). 8 poules -> 4 paires.
const POULE_PAIRS = [];
for (let i = 0; i < POULES.length; i += 2) {
  POULE_PAIRS.push([POULES[i], POULES[i + 1]]);
}
let pairIndex = 0;

// Compteur global incrémenté à chaque rotation (toutes les ROTATE_MS).
// Sert à paginer les listes trop longues (prochains matchs, phase finale,
// résultats) exactement comme pairIndex le fait déjà pour les poules.
let rotateTick = 0;

checkAndLoad();
setInterval(checkAndLoad, POLL_INTERVAL_MS);
setInterval(rotatePanels, ROTATE_MS);

async function checkAndLoad() {
  try {
    const metaSnap = await getDoc(doc(db, "meta", "state"));
    const active = metaSnap.exists() && !!metaSnap.data().tournamentActive;
    if (!active) return; // en scène, on n'affiche rien de spécial si inactif : les panneaux restent vides

    const [teamsSnap, matchesSnap, bracketSnap] = await Promise.all([
      getDocs(collection(db, "teams")),
      getDocs(collection(db, "matches")),
      getDocs(collection(db, "bracket")),
    ]);
    TEAMS = teamsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    MATCHES = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    BRACKET = {};
    bracketSnap.docs.forEach((d) => { BRACKET[d.id] = d.data(); });

    renderAll();
    setLastSync();
  } catch (err) {
    console.error(err);
  }
}

function setLastSync() {
  const el = document.getElementById("scene-sync");
  el.textContent = new Date().toLocaleTimeString("fr-FR");
}

/* ---------------- Helper : résolution d'équipe défensive ----------------
   Voir app.js pour l'explication : au lieu de faire disparaître un match
   quand une équipe référencée est introuvable, on affiche un nom de
   secours + un avertissement en console. */
function getTeamSafe(teamId, teamsById, matchId) {
  const team = teamsById[teamId];
  if (team) return team;
  console.warn(
    `[Maestro Cup - Scène] Équipe introuvable pour l'ID "${teamId}" ` +
    (matchId ? `(match ${matchId})` : "") +
    " — vérifie la collection 'teams' et les références du match."
  );
  return { id: teamId, name: `Équipe inconnue (${teamId})`, flag: "❓" };
}

/* ---------------- Helper : pagination des panneaux qui tournent ----------------
   Découpe un tableau en pages de PANEL_PAGE_SIZE éléments et renvoie la page
   courante selon rotateTick. S'il y a moins d'éléments qu'une page, on
   renvoie simplement tout (pas besoin de faire tourner). */
function paginate(list, pageSize = PANEL_PAGE_SIZE) {
  if (list.length <= pageSize) return list;
  const pageCount = Math.ceil(list.length / pageSize);
  const idx = rotateTick % pageCount;
  return list.slice(idx * pageSize, idx * pageSize + pageSize);
}

/* ---------------- Helper : animation de rotation ----------------
   On retire puis ré-ajoute la classe pour forcer le navigateur à rejouer
   l'animation CSS à chaque changement de contenu (sinon, ré-ajouter une
   classe déjà présente ne relance pas l'animation). */
function playRotateAnim(el) {
  if (!el) return;
  el.classList.remove("panel-rotate-anim");
  void el.offsetWidth; // force le reflow
  el.classList.add("panel-rotate-anim");
}

/* ---------------- Helper : ligne "équipe — score — équipe" du bracket ----------------
   Utilisé à la fois pour les matchs en cours/à venir (renderRightPanel) et
   pour les résultats (renderBracketResults), pour garantir la même mise en
   page partout : le nom de chaque équipe reste collé à son bord, et le
   score (ou "vs" si le match n'a pas encore de score) reste centré entre
   les deux — au lieu d'être accolé au nom, ce qui écartait tout vers les
   bords et laissait un grand vide au milieu. */
function bracketTeamsHtml(m) {
  const winnerId = (m.status === "finished" && m.scoreA !== null && m.scoreA !== m.scoreB)
    ? (m.scoreA > m.scoreB ? m.teamA.id : m.teamB.id) : null;
  const winCls = (t) => (winnerId && t.id === winnerId ? "winner" : "");
  const hasScore = m.scoreA !== null && m.scoreA !== undefined && m.scoreB !== null && m.scoreB !== undefined;
  const center = hasScore
    ? `<span class="scene-bracket-score-center">${m.scoreA}<span class="scene-bracket-dash">-</span>${m.scoreB}</span>`
    : `<span class="scene-bracket-vs">vs</span>`;
  return `
    <span class="scene-bracket-name ${winCls(m.teamA)}">${m.teamA.flag ? m.teamA.flag + " " : ""}${m.teamA.name}</span>
    ${center}
    <span class="scene-bracket-name right ${winCls(m.teamB)}">${m.teamB.name}${m.teamB.flag ? " " + m.teamB.flag : ""}</span>`;
}

function renderAll() {
  if (!TEAMS.length) return;
  renderTicker();
  renderPoulePanel();
  renderRightPanel();
}

/* ---------------- Ticker (identique au site public) ---------------- */
function renderTicker() {
  const el = document.getElementById("ticker-inner");
  const teamsById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
  const relevant = MATCHES
    .filter((m) => m.status === "live" || m.status === "upcoming")
    .sort((a, b) => (a.journee + a.order).localeCompare(b.journee + b.order));

  if (!relevant.length) {
    el.innerHTML = `<span class="ticker-empty">Aucun match en direct pour le moment</span>`;
    return;
  }

  el.innerHTML = relevant.slice(0, 12).map((m) => {
    const a = getTeamSafe(m.teamA, teamsById, m.id);
    const b = getTeamSafe(m.teamB, teamsById, m.id);
    const pill = m.status === "live"
      ? `<span class="live-pill">LIVE</span>`
      : `<span style="color:var(--text-muted)">${m.time}</span>`;
    return `<span class="ticker-item">${pill} ${a.flag} ${a.name} vs ${b.name} ${b.flag}</span>`;
  }).join("");
}

/* ---------------- Rotation globale : poules + panneau droit ----------------
   Un seul intervalle de 10s fait tourner à la fois la paire de poules
   affichées à gauche et les pages des listes à droite (prochains matchs /
   phase finale, résultats), pour rester synchronisé. */
function rotatePanels() {
  pairIndex = (pairIndex + 1) % POULE_PAIRS.length;
  rotateTick += 1;
  renderPoulePanel();
  if (TEAMS.length) renderRightPanel();
}

function renderPoulePanel() {
  if (!TEAMS.length) return;
  const [pTop, pBottom] = POULE_PAIRS[pairIndex];
  renderOnePoule(pTop, 1);
  renderOnePoule(pBottom, 2);
}

function renderOnePoule(p, slot) {
  const teams = TEAMS.filter((t) => t.poule === p);
  const standings = computeStandings(teams, MATCHES);

  document.getElementById(`poule-badge-${slot}`).textContent = p;
  document.getElementById(`poule-badge-${slot}`).style.background = POULE_COLOR[p];
  document.getElementById(`poule-title-${slot}`).textContent = `Poule ${p}`;
  document.getElementById(`poule-panel-${slot}`).style.setProperty("--poule-color", POULE_COLOR[p]);

  document.getElementById(`poule-rows-${slot}`).innerHTML = standings.map((s, i) => `
    <tr class="${i < 2 ? "qualified" : ""}">
      <td>${i + 1}</td>
      <td class="team-name">${s.flag} ${s.name}</td>
      <td class="pts">${s.pts}</td>
      <td>${s.diff > 0 ? "+" : ""}${s.diff}</td>
    </tr>`).join("");

  playRotateAnim(document.getElementById(`poule-panel-${slot}`));
}

/* ---------------- Panneau droit : prochains matchs / phase finale + résultats ---------------- */
function renderRightPanel() {
  const title = document.getElementById("right-panel-title");
  const content = document.getElementById("right-panel-content");
  const resultsContent = document.getElementById("results-panel-content");
  const teamsById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

  if (!poulesTerminees(MATCHES)) {
    title.textContent = "Prochains matchs";
    const upcomingAll = MATCHES
      .filter((m) => m.status === "live" || m.status === "upcoming")
      .sort((a, b) => (a.journee + a.order).localeCompare(b.journee + b.order));
    // Avec 8 poules il peut y avoir jusqu'à 8 matchs simultanés : on n'en
    // montre que PANEL_PAGE_SIZE à la fois et on fait tourner le reste.
    const upcoming = paginate(upcomingAll);

    content.innerHTML = upcoming.length
      ? upcoming.map((m) => {
          const a = getTeamSafe(m.teamA, teamsById, m.id);
          const b = getTeamSafe(m.teamB, teamsById, m.id);
          const live = m.status === "live";
          const score = live ? `${m.scoreA ?? 0} - ${m.scoreB ?? 0}` : null;
          return `
            <div class="scene-match-row ${live ? "is-live" : ""}">
              <div class="scene-match-teams">
                <span>${a.flag} ${a.name}</span>
                ${score ? `<span class="scene-live-score">${score}</span>` : `<span class="vs">vs</span>`}
                <span>${b.name} ${b.flag}</span>
              </div>
              <div class="scene-match-meta">${live ? "LIVE" : m.time}</div>
            </div>`;
        }).join("")
      : `<div class="scene-empty">Aucun match à venir pour le moment.</div>`;
    playRotateAnim(content);

    renderPouleResults(resultsContent, teamsById);
    return;
  }

  // Phase de poules terminée -> on montre la phase finale
  title.textContent = "Phase finale";
  const { bracket } = buildBracketView(TEAMS, MATCHES, BRACKET);
  const order = ["hf1","hf2","hf3","hf4","hf5","hf6","hf7","hf8","qf1","qf2","qf3","qf4","sf1","sf2","final"];
  const relevantAll = order
    .map((k) => bracket[k])
    .filter((m) => m.status !== "finished");
  // Jusqu'à 8 huitièmes en même temps : on en montre PANEL_PAGE_SIZE à la
  // fois et on fait tourner les pages au lieu de tronquer la liste.
  const relevant = paginate(relevantAll);

  content.innerHTML = relevant.length
    ? relevant.map((m) => {
        const isLive = m.status === "live";
        return `
          <div class="scene-bracket-row ${isLive ? "is-live" : ""}">
            <div class="scene-bracket-label">
              ${m.label}
              ${isLive ? `<span class="scene-live-pill">LIVE</span>` : ""}
            </div>
            <div class="scene-bracket-teams">${bracketTeamsHtml(m)}</div>
          </div>`;
      }).join("")
    : `<div class="scene-empty">Tournoi terminé 🏆</div>`;
  playRotateAnim(content);

  renderBracketResults(resultsContent, bracket, order);
}

/* Clé de tri "journée + ordre" en forçant l'ordre à 3 chiffres pour éviter
   un tri alphabétique fautif (ex: "10" avant "2"). */
function matchSortKey(m) {
  return `${m.journee}-${String(m.order).padStart(3, "0")}`;
}

/* Résultats des matchs de poule déjà marqués "terminé" par l'admin,
   les plus récents (journée/ordre le plus élevé) en premier. La liste
   tourne par pages de PANEL_PAGE_SIZE si elle est plus longue. */
function renderPouleResults(el, teamsById) {
  const finishedAll = MATCHES
    .filter((m) => m.status === "finished")
    .sort((a, b) => matchSortKey(b).localeCompare(matchSortKey(a)));
  const finished = paginate(finishedAll);

  el.innerHTML = finished.length
    ? finished.map((m) => {
        const a = getTeamSafe(m.teamA, teamsById, m.id);
        const b = getTeamSafe(m.teamB, teamsById, m.id);
        return `
          <div class="scene-match-row">
            <div class="scene-match-teams">
              <span>${a.flag} ${a.name}</span>
              <span class="scene-final-score">${m.scoreA ?? 0} - ${m.scoreB ?? 0}</span>
              <span>${b.name} ${b.flag}</span>
            </div>
          </div>`;
      }).join("")
    : `<div class="scene-empty">Aucun résultat pour le moment.</div>`;
  playRotateAnim(el);
}

/* Idem, mais pour les matchs de phase finale (huitièmes, quarts, etc.)
   une fois que la phase de poules est terminée. Pagine également. */
function renderBracketResults(el, bracket, order) {
  const finishedAll = order
    .map((k) => bracket[k])
    .filter((m) => m.status === "finished")
    .reverse();
  const finished = paginate(finishedAll);

  el.innerHTML = finished.length
    ? finished.map((m) => `
          <div class="scene-bracket-row">
            <div class="scene-bracket-label">${m.label}</div>
            <div class="scene-bracket-teams">${bracketTeamsHtml(m)}</div>
          </div>`).join("")
    : `<div class="scene-empty">Aucun résultat pour le moment.</div>`;
  playRotateAnim(el);
}
