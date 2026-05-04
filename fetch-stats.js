// fetch-stats.js
// Exécuté chaque soir par GitHub Actions
// Génère data.json avec les joueurs des 5 championnats

const fs = require('fs');

const LEAGUES = [
  { id: 61,  name: 'Ligue 1',        flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1',   key: 'CLE_1' },
  { id: 39,  name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL',   key: 'CLE_2' },
  { id: 140, name: 'La Liga',        flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA', key: 'CLE_3' },
  { id: 135, name: 'Serie A',        flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA',   key: 'CLE_4' },
  { id: 78,  name: 'Bundesliga',     flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL',   key: 'CLE_5' },
];

const SEASON = 2024;

async function fetchTopScorers(leagueId, apiKey) {
  const url = `https://v3.football.api-sports.io/players/topscorers?league=${leagueId}&season=${SEASON}`;
  console.log(`  GET ${url}`);
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log(`  → ${data.results} résultats, erreurs: ${JSON.stringify(data.errors)}`);
  return data;
}

async function fetchTopAssists(leagueId, apiKey) {
  const url = `https://v3.football.api-sports.io/players/topassists?league=${leagueId}&season=${SEASON}`;
  console.log(`  GET ${url}`);
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log(`  → ${data.results} résultats`);
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

function processItem(item, i, league) {
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
  const signal         = calcSignal(goals, assists, games, i);
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
  console.log(`\n📥 ${league.name}...`);
  const apiKey = process.env[league.key];
  if (!apiKey) { console.warn(`  ⚠️  Clé manquante : ${league.key}`); return []; }

  // Récupérer top buteurs ET top passeurs (2 requêtes par ligue)
  const [scorers, assisters] = await Promise.all([
    fetchTopScorers(league.id, apiKey),
    fetchTopAssists(league.id, apiKey),
  ]);

  // Fusionner en évitant les doublons (par player.id)
  const seen = new Map();

  for (const [i, item] of (scorers.response || []).entries()) {
    const p = processItem(item, i, league);
    if (p) seen.set(p.id, p);
  }

  for (const [i, item] of (assisters.response || []).entries()) {
    if (!seen.has(item.player?.id)) {
      const p = processItem(item, i + 20, league);
      if (p) seen.set(p.id, p);
    }
  }

  const players = [...seen.values()].sort((a, b) => b.goals - a.goals);
  console.log(`  ✅ ${players.length} joueurs`);
  return players;
}

async function main() {
  console.log('🚀 Récupération stats — ' + new Date().toISOString());
  const allPlayers = [];
  const errors = [];

  for (const league of LEAGUES) {
    try {
      allPlayers.push(...await fetchLeague(league));
    } catch (err) {
      console.error(`❌ ${league.name} : ${err.message}`);
      errors.push({ league: league.name, error: err.message });
    }
  }

  allPlayers.sort((a, b) => b.goals - a.goals);

  const output = {
    updatedAt: new Date().toISOString(),
    season: SEASON,
    totalPlayers: allPlayers.length,
    errors,
    players: allPlayers,
  };

  fs.writeFileSync('data.json', JSON.stringify(output));
  console.log(`\n✅ data.json — ${allPlayers.length} joueurs`);
  if (errors.length) console.warn(`⚠️  Erreurs :`, errors);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
