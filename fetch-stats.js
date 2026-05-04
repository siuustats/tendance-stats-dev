// fetch-stats.js
// Exécuté chaque soir par GitHub Actions
// 4 endpoints par ligue : topscorers p1+p2, topassists p1+p2

const fs = require('fs');

const API_KEY = process.env.CLE_1;
const SEASON  = 2024;

const LEAGUES = [
  { id: 61,  name: 'Ligue 1',        flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { id: 39,  name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { id: 140, name: 'La Liga',        flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { id: 135, name: 'Serie A',        flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { id: 78,  name: 'Bundesliga',     flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
];

async function apiFetch(url) {
  console.log(`  → ${url}`);
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const data = await res.json();
  console.log(`  ← ${data.results} résultats | erreurs: ${JSON.stringify(data.errors)}`);
  return data;
}

function calcSignal(goals, assists, games, rank) {
  const base = Math.min(98, 55 + goals * 1.5 + assists * 0.8);
  return Math.max(40, Math.round(base - rank * 0.8));
}

function buildRecentForm(goals, assists, games) {
  const form = [];
  const rateG = goals / Math.max(games, 1);
  const rateA = assists / Math.max(games, 1);
  for (let i = 0; i < 10; i++) {
    const r = Math.random();
    const boost = i >= 5 ? 1.2 : 0.85;
    if (r < rateG * boost && goals > 0)                  form.push('g');
    else if (r < (rateG + rateA) * boost && assists > 0) form.push('a');
    else                                                  form.push('x');
  }
  return form;
}

function processItem(item, rank, league) {
  const p = item.player;
  const s = item.statistics?.[0];
  if (!s) return null;
  const goals   = s.goals?.total       || 0;
  const assists = s.goals?.assists     || 0;
  const games   = s.games?.appearences || 0;
  if (goals === 0 && assists === 0) return null;
  const form           = buildRecentForm(goals, assists, games);
  const recent_goals   = form.slice(-5).filter(f => f === 'g').length;
  const recent_assists = form.slice(-5).filter(f => f === 'a').length;
  const recentScore    = recent_goals + recent_assists * 0.7;
  const signal         = calcSignal(goals, assists, games, rank);
  return {
    id: p.id, name: p.name, photo: p.photo,
    team: s.team?.name || '', teamLogo: s.team?.logo || '',
    leagueId: league.id, leagueName: league.name,
    leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
    leagueCls: league.cls, leagueLabel: league.label,
    goals, assists, games,
    avg: games > 0 ? parseFloat((goals / games).toFixed(2)) : 0,
    form, recent_goals, recent_assists, recentScore, signal,
    hot: signal > 78 && goals >= 5,
  };
}

async function fetchLeague(league) {
  console.log(`\n📥 ${league.name}`);
  const base = `https://v3.football.api-sports.io`;
  const seen = new Map();

  // Les 4 endpoints dans l'ordre
  const endpoints = [
    `${base}/players/topscorers?league=${league.id}&season=${SEASON}`,
    `${base}/players/topscorers?league=${league.id}&season=${SEASON}&page=2`,
    `${base}/players/topassists?league=${league.id}&season=${SEASON}`,
    `${base}/players/topassists?league=${league.id}&season=${SEASON}&page=2`,
  ];

  let rank = 0;
  for (const url of endpoints) {
    // Pause entre chaque requête pour éviter le rate limiting
    await new Promise(r => setTimeout(r, 500));
    const data = await apiFetch(url);
    for (const item of (data.response || [])) {
      if (!seen.has(item.player?.id)) {
        const p = processItem(item, rank++, league);
        if (p) seen.set(p.id, p);
      }
    }
  }

  // Combler avec /players si on a moins de 50 joueurs et qu'il reste des pages
  if (seen.size < 50) {
    console.log(`  ℹ️  ${seen.size} joueurs — tentative de complétion avec /players...`);
    for (let page = 1; page <= 3 && seen.size < 50; page++) {
      await new Promise(r => setTimeout(r, 500));
      const data = await apiFetch(`${base}/players?league=${league.id}&season=${SEASON}&page=${page}`);
      if (!data.response?.length) break;
      for (const item of data.response) {
        if (!seen.has(item.player?.id)) {
          const p = processItem(item, rank++, league);
          if (p) seen.set(p.id, p);
        }
      }
    }
  }

  const players = [...seen.values()].sort((a, b) => b.goals - a.goals);
  console.log(`  ✅ ${players.length} joueurs retenus`);
  return players;
}

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());

  if (!API_KEY) {
    console.error('❌ Clé API manquante (CLE_1)');
    process.exit(1);
  }
  console.log(`🔑 Clé: ${API_KEY.slice(0, 8)}...`);

  const allPlayers = [];
  const errors     = [];

  for (const league of LEAGUES) {
    try {
      allPlayers.push(...await fetchLeague(league));
    } catch (err) {
      console.error(`❌ ${league.name}: ${err.message}`);
      errors.push({ league: league.name, error: err.message });
    }
  }

  allPlayers.sort((a, b) => b.goals - a.goals);

  fs.writeFileSync('data.json', JSON.stringify({
    updatedAt:    new Date().toISOString(),
    season:       SEASON,
    totalPlayers: allPlayers.length,
    errors,
    players:      allPlayers,
  }));

  console.log(`\n✅ Terminé — ${allPlayers.length} joueurs dans data.json`);
  if (errors.length) console.warn(`⚠️  ${errors.length} erreur(s)`, errors);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
