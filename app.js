import { firebaseConfig } from "./firebase-config.js";
import { computeStandings, buildBracketView, poulesTerminees } from "./logic.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const POULE_COLOR = { A: "#e8b84b", B: "#4caf7d", C: "#e15554", D: "#4a90d9" };

let TEAMS = [];
let MATCHES = [];       // matchs de poule
let BRACKET = {};        // { qf1: {...}, qf2:...} scores/status
let currentJournee = "j1";

/* ---------------- Firestore listeners ---------------- */
onSnapshot(collection(db, "teams"), (snap) => {
  TEAMS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  markOnline();
  renderAll();
}, () => markOffline());

onSnapshot(collection(db, "matches"), (snap) => {
  MATCHES = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  markOnline();
  renderAll();
}, () => markOffline());

onSnapshot(collection(db, "bracket"), (snap) => {
  BRACKET = {};
  snap.docs.forEach((d) => { BRACKET[d.id] = d.data(); });
  markOnline();
  renderAll();
}, () => markOffline());

function markOnline() { document.getElementById("connection-dot").classList.add("online"); }
function markOffline() { document.getElementById("connection-dot").classList.remove("online"); }

/* ---------------- Tabs ---------------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

/* ---------------- Render orchestrator ---------------- */
function renderAll() {
  if (!TEAMS.length) return;
  renderTicker();
  renderJourneeSwitch();
  renderCalendrier();
  renderPoules();
  renderBracket();
}

/* ---------------- Ticker ---------------- */
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
    const a = teamsById[m.teamA], b = teamsById[m.teamB];
    if (!a || !b) return "";
    const pill = m.status === "live"
      ? `<span class="live-pill">LIVE</span>`
      : `<span style="color:var(--text-muted)">${m.time}</span>`;
    return `<span class="ticker-item">${pill} ${a.flag} ${a.name} vs ${b.name} ${b.flag}</span>`;
  }).join("");
}

/* ---------------- Calendrier ---------------- */
function renderJourneeSwitch() {
  const journees = [...new Set(MATCHES.map((m) => m.journee))].sort();
  const el = document.getElementById("journee-switch");
  el.innerHTML = journees.map((j) => `
    <button class="journee-btn ${j === currentJournee ? "active" : ""}" data-j="${j}">
      Journée ${j.replace("j", "")}
    </button>`).join("");
  el.querySelectorAll(".journee-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentJournee = btn.dataset.j;
      renderJourneeSwitch();
      renderCalendrier();
    });
  });
}

function renderCalendrier() {
  const teamsById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
  const list = MATCHES.filter((m) => m.journee === currentJournee).sort((a, b) => a.order - b.order);
  const el = document.getElementById("calendrier-content");

  el.innerHTML = list.map((m) => {
    const a = teamsById[m.teamA], b = teamsById[m.teamB];
    if (!a || !b) return "";
    const statusLabel = { upcoming: "À venir", live: "En direct", finished: "Terminé" }[m.status];
    const score = m.status === "finished" || m.status === "live"
      ? `${m.scoreA ?? 0} <span class="vs">-</span> ${m.scoreB ?? 0}`
      : `<span class="vs">vs</span>`;
    return `
      <div class="match-card" style="--poule-color:${POULE_COLOR[m.poule]}">
        <div class="match-card-head">
          <span class="match-time">Poule ${m.poule} · ${m.time}</span>
          <span class="status-badge status-${m.status}">${statusLabel}</span>
        </div>
        <div class="match-teams">
          <div class="match-team">${a.flag} ${a.name}</div>
          <div class="match-score">${score}</div>
          <div class="match-team right">${b.flag} ${b.name}</div>
        </div>
      </div>`;
  }).join("") || `<p style="color:var(--text-muted)">Aucun match pour cette journée.</p>`;
}

/* ---------------- Poules ---------------- */
function renderPoules() {
  const el = document.getElementById("poules-grid");
  const poules = ["A", "B", "C", "D"];
  el.innerHTML = poules.map((p) => {
    const teams = TEAMS.filter((t) => t.poule === p);
    const standings = computeStandings(teams, MATCHES);
    const rows = standings.map((s, i) => `
      <tr class="${i < 2 ? "qualified" : ""}">
        <td>${i + 1}</td>
        <td class="team-name">${s.flag} ${s.name}${s.penalty ? `<span class="pen-tag">−${s.penalty}pt</span>` : ""}</td>
        <td>${s.mj}</td><td>${s.g}</td><td>${s.n}</td><td>${s.p}</td>
        <td>${s.bp}</td><td>${s.bc}</td><td>${s.diff > 0 ? "+" : ""}${s.diff}</td>
        <td class="pts">${s.pts}</td>
      </tr>`).join("");
    return `
      <div class="poule-card" style="--poule-color:${POULE_COLOR[p]}">
        <div class="poule-head">
          <span class="badge">${p}</span>
          <h3>Poule ${p}</h3>
        </div>
        <table class="standings">
          <thead><tr><th>#</th><th style="text-align:left">Équipe</th><th>MJ</th><th>G</th><th>N</th><th>P</th><th>BP</th><th>BC</th><th>Diff</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");
}

/* ---------------- Bracket / Phase finale ---------------- */
function renderBracket() {
  const poulesMatches = MATCHES;
  const { bracket } = buildBracketView(TEAMS, poulesMatches, BRACKET);
  const done = poulesTerminees(poulesMatches);

  document.getElementById("finale-note").textContent = done
    ? "Phase de poules terminée — l'arbre est calculé automatiquement à partir des classements."
    : "L'arbre se remplira automatiquement au fur et à mesure que les matchs de poule se terminent.";

  const rounds = [
    { title: "Quarts de finale", keys: ["qf1", "qf2", "qf3", "qf4"] },
    { title: "Demi-finales", keys: ["sf1", "sf2"] },
    { title: "Finale", keys: ["final"] },
  ];

  document.getElementById("bracket").innerHTML = rounds.map((round) => `
    <div class="bracket-round">
      <h4>${round.title}</h4>
      <div class="bracket-matches">
        ${round.keys.map((k) => renderBracketMatch(bracket[k])).join("")}
      </div>
    </div>`).join("");
}

function renderBracketMatch(m) {
  const winnerId = (m.status === "finished" && m.scoreA !== null && m.scoreA !== m.scoreB)
    ? (m.scoreA > m.scoreB ? m.teamA.id : m.teamB.id) : null;
  const rowClass = (team) => team.resolved
    ? (winnerId && team.id === winnerId ? "winner" : "")
    : "unresolved";
  const scoreTxt = (val) => (val === null || val === undefined) ? "" : `<span class="score">${val}</span>`;
  return `
    <div class="bracket-match">
      <div class="b-label">${m.label}</div>
      <div class="bracket-row ${rowClass(m.teamA)}"><span>${m.teamA.flag ? m.teamA.flag + " " : ""}${m.teamA.name}</span>${scoreTxt(m.scoreA)}</div>
      <div class="bracket-row ${rowClass(m.teamB)}"><span>${m.teamB.flag ? m.teamB.flag + " " : ""}${m.teamB.name}</span>${scoreTxt(m.scoreB)}</div>
    </div>`;
}

/* ---------------- Règlement (statique) ---------------- */
document.getElementById("reglement-content").innerHTML = `
  <h2>Phase de poules</h2>
  <ul>
    <li><strong>Structure :</strong> le tournoi commence par une phase de groupes composée de 4 poules de 4 équipes.</li>
    <li><strong>Qualification :</strong> les 2 premières équipes de chaque poule sont qualifiées pour la phase finale.</li>
    <li><strong>Abandon :</strong> tout abandon volontaire entraîne une pénalité de −1 point au classement de la poule.</li>
  </ul>

  <h2>Phase finale (arbre en quarts de finale)</h2>
  <ul>
    <li>Quart de finale 1 : 1er Poule A vs 2e Poule B</li>
    <li>Quart de finale 2 : 1er Poule C vs 2e Poule D</li>
    <li>Quart de finale 3 : 1er Poule B vs 2e Poule A</li>
    <li>Quart de finale 4 : 1er Poule D vs 2e Poule C</li>
    <li>Demi-finale 1 : vainqueur QF1 vs vainqueur QF2</li>
    <li>Demi-finale 2 : vainqueur QF3 vs vainqueur QF4</li>
    <li>Finale : vainqueur demi-finale 1 vs vainqueur demi-finale 2</li>
  </ul>

  <h2>Règles de jeu &amp; logistique</h2>
  <ul>
    <li><strong>Fair-play &amp; respect :</strong> tout comportement toxique ou manque de respect entraîne l'exclusion immédiate de l'ensemble de l'équipe.</li>
    <li><strong>Ponctualité :</strong> les matchs doivent débuter dans les 5 minutes suivant l'heure prévue. En cas de retard, l'équipe adverse l'emporte par forfait (victoire sur tapis vert 3-0).</li>
    <li><strong>Bugs / déconnexions :</strong> en cas de problème technique, le match est relancé en conservant le score exact au moment du bug, et se joue jusqu'à la 25e minute (matchs de xxh00) ou la 55e minute (matchs de xxh30).</li>
    <li><strong>Streaming :</strong> pour les demi-finales et la finale, au moins un joueur par équipe doit diffuser sa partie (Discord par exemple).</li>
    <li><strong>Connexion :</strong> merci de vous assurer d'avoir une connexion stable.</li>
    <li><strong>Points :</strong> victoire = 3 pts · match nul = 1 pt · défaite = 0 pt.</li>
  </ul>

  <h2>Départage en cas d'égalité</h2>
  <ul>
    <li>Différence de buts générale (buts marqués − buts encaissés sur tous les matchs)</li>
    <li>Meilleure attaque (total de buts marqués)</li>
    <li>Confrontation directe</li>
    <li>Tirage au sort</li>
  </ul>
`;
