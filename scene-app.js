import { firebaseConfig } from "./firebase-config.js";
import { computeStandings, buildBracketView, poulesTerminees, POULES } from "./logic.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, getDoc, doc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const POLL_INTERVAL_MS = 60_000;      // même cadence que le site public
const POULE_ROTATE_MS = 10_000;       // vitesse de rotation du panneau "Poule"

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
let pouleIndex = 0;

checkAndLoad();
setInterval(checkAndLoad, POLL_INTERVAL_MS);
setInterval(rotatePoulePanel, POULE_ROTATE_MS);

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

/* ---------------- Panneau gauche : poule en rotation ---------------- */
function rotatePoulePanel() {
  pouleIndex = (pouleIndex + 1) % POULES.length;
  renderPoulePanel();
}

function renderPoulePanel() {
  if (!TEAMS.length) return;
  const p = POULES[pouleIndex];
  const teams = TEAMS.filter((t) => t.poule === p);
  const standings = computeStandings(teams, MATCHES);

  document.getElementById("poule-badge").textContent = p;
  document.getElementById("poule-badge").style.background = POULE_COLOR[p];
  document.getElementById("poule-title").textContent = `Poule ${p}`;
  document.getElementById("poule-panel").style.setProperty("--poule-color", POULE_COLOR[p]);

  document.getElementById("poule-rows").innerHTML = standings.map((s, i) => `
    <tr class="${i < 2 ? "qualified" : ""}">
      <td>${i + 1}</td>
      <td class="team-name">${s.flag} ${s.name}</td>
      <td class="pts">${s.pts}</td>
      <td>${s.diff > 0 ? "+" : ""}${s.diff}</td>
    </tr>`).join("");
}

/* ---------------- Panneau droit : prochains matchs / phase finale ---------------- */
function renderRightPanel() {
  const title = document.getElementById("right-panel-title");
  const content = document.getElementById("right-panel-content");
  const teamsById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

  if (!poulesTerminees(MATCHES)) {
    title.textContent = "Prochains matchs";
    const upcoming = MATCHES
      .filter((m) => m.status === "live" || m.status === "upcoming")
      .sort((a, b) => (a.journee + a.order).localeCompare(b.journee + b.order))
      .slice(0, 8); // 8 poules -> jusqu'à 8 matchs simultanés à afficher (avant : limité à 7)

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
    return;
  }

  // Phase de poules terminée -> on montre la phase finale
  title.textContent = "Phase finale";
  const { bracket } = buildBracketView(TEAMS, MATCHES, BRACKET);
  const order = ["hf1","hf2","hf3","hf4","hf5","hf6","hf7","hf8","qf1","qf2","qf3","qf4","sf1","sf2","final"];
  const relevant = order
    .map((k) => bracket[k])
    .filter((m) => m.status !== "finished")
    .slice(0, 8); // jusqu'à 8 huitièmes en même temps (avant : limité à 6, ce qui en cachait 2)

  content.innerHTML = relevant.length
    ? relevant.map((m) => {
        const winnerId = (m.status === "finished" && m.scoreA !== null && m.scoreA !== m.scoreB)
          ? (m.scoreA > m.scoreB ? m.teamA.id : m.teamB.id) : null;
        const cls = (t) => (winnerId && t.id === winnerId ? "winner" : "");
        const isLive = m.status === "live";
        // BUG CORRIGÉ : les scores et le statut "live" n'étaient jamais
        // affichés ici, même quand ils étaient bien reçus depuis Firestore.
        const scoreTxt = (val) => (val === null || val === undefined) ? "" : `<span class="scene-bracket-score">${val}</span>`;
        return `
          <div class="scene-bracket-row ${isLive ? "is-live" : ""}">
            <div class="scene-bracket-label">
              ${m.label}
              ${isLive ? `<span class="scene-live-pill">LIVE</span>` : ""}
            </div>
            <div class="scene-bracket-teams">
              <span class="${cls(m.teamA)}">${m.teamA.flag ? m.teamA.flag + " " : ""}${m.teamA.name} ${scoreTxt(m.scoreA)}</span>
              <span class="${cls(m.teamB)}">${scoreTxt(m.scoreB)} ${m.teamB.flag ? m.teamB.flag + " " : ""}${m.teamB.name}</span>
            </div>
          </div>`;
      }).join("")
    : `<div class="scene-empty">Tournoi terminé 🏆</div>`;
}
