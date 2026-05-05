// fetch-stats.js — Tendance Stats
// Logique : chaque soir, récupère les matchs du jour et stocke cumulativement

const fs   = require('fs');
const path = require('path');

const API_KEY    = process.env.CLE_1;
const SEASON     = 2024;
const DATA_FILE  = 'data.json';

const LEAGUES = [
  { id: 61,  name: 'Ligue 1',        flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { id: 39,  name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { id: 140, name: 'La Liga',        flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { id: 135, name: 'Serie A',        flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { id: 78,  name: 'Bundesliga',     flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
];

let reqCount = 0;

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(url) {
  reqCount++;
  console.log(`  [${reqCount}] ${url}`);
  await new Promise(r => setTimeout(r, 1500));
  const res  = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    console.warn(`  ⚠️  Erreurs:`, JSON.stringify(data.errors));
  } else {
    console.log(`  ← ${data.results ?? '?'} résultats`);
  }
  return data;
}

// ── Récupérer les matchs terminés aujourd'hui pour une ligue ─────────────────

async function getTodayFixtures(leagueId) {
  // Date d'aujourd'hui au format YYYY-MM-DD
  const today = '2026-05-04'; // DATE TEST — à remettre en dynamique après
  const data  = await apiFetch(
    `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${SEASON}&date=${today}&status=FT`
  );
  return data.response || [];
}

// ── Récupérer les stats de tous les joueurs d'un match ───────────────────────

async function getFixturePlayers(fixtureId) {
  const data = await apiFetch(
    `https://v3.football.api-sports.io/fixtures/players?fixture=${fixtureId}`
  );
  const players = [];
  for (const teamData of (data.response || [])) {
    const teamId   = teamData.team?.id;
    const teamName = teamData.team?.name;
    const teamLogo = teamData.team?.logo;
    for (const p of (teamData.players || [])) {
      const s = p.statistics?.[0];
      if (!s) continue;
      const minutes = s.games?.minutes || 0;
      if (minutes === 0) continue; // N'a pas joué
      players.push({
        id:      p.player.id,
        name:    p.player.name,
        photo:   p.player.photo,
        teamId,
        teamName,
        teamLogo,
        goals:   s.goals?.total   || 0,
        assists: s.goals?.assists || 0,
        minutes,
      });
    }
  }
  return players;
}

// ── Calcul TendScore sur les 5 derniers matchs ────────────────────────────────

function calcTrendScore(last5) {
  if (!last5 || last5.length === 0) return 0;
  let score = 0;
  last5.forEach((m, i) => {
    const weight = i === 0 ? 1.0 : 0.9;
    score += (m.goals + m.assists) * weight;
    if (m.teamWon) score += 0.5;
  });
  if (!last5[0].played) score -= 3;
  const wins = last5.filter(m => m.teamWon).length;
  if (wins >= 4)      score += 2;
  else if (wins >= 3) score += 1;
  return parseFloat(score.toFixed(2));
}

function buildFormDots(last5) {
  return last5.map(m => {
    if (!m.played)     return 'x';
    if (m.goals > 0)   return 'g';
    if (m.assists > 0) return 'a';
    return 'x';
  });
}

// ── Charger / sauvegarder data.json ──────────────────────────────────────────

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.warn('⚠️  data.json corrompu, on repart de zéro');
    }
  }
  return { matches: [], players: {} };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  console.log(`💾 data.json sauvegardé`);
}

// ── Recalculer le classement joueurs depuis l'historique des matchs ───────────

function rebuildPlayers(matches, leagueMap) {
  // Regrouper les matchs par joueur
  const playerMatches = {}; // playerId -> [{ goals, assists, played, teamWon, date, leagueId }]

  for (const match of matches) {
    for (const p of (match.players || [])) {
      if (!playerMatches[p.id]) playerMatches[p.id] = [];
      playerMatches[p.id].push({
        goals:    p.goals,
        assists:  p.assists,
        played:   true,
        teamWon:  p.teamWon,
        date:     match.date,
        leagueId: match.leagueId,
      });
    }
  }

  const players = {};

  for (const [playerId, allMatches] of Object.entries(playerMatches)) {
    // Trier du plus récent au plus ancien
    allMatches.sort((a, b) => new Date(b.date) - new Date(a.date));

    const last5         = allMatches.slice(0, 5);
    const trendScore    = calcTrendScore(last5);
    const form          = buildFormDots(last5);
    const recent_goals   = last5.reduce((s, m) => s + m.goals,   0);
    const recent_assists = last5.reduce((s, m) => s + m.assists, 0);
    const totalGoals     = allMatches.reduce((s, m) => s + m.goals,   0);
    const totalAssists   = allMatches.reduce((s, m) => s + m.assists, 0);
    const totalGames     = allMatches.length;

    // Infos joueur depuis le dernier match
    const lastMatch = matches.find(m => m.players?.some(p => p.id == playerId));
    const pInfo     = lastMatch?.players?.find(p => p.id == playerId);
    const leagueId  = lastMatch?.leagueId;
    const league    = leagueMap[leagueId] || {};

    players[playerId] = {
      id:            parseInt(playerId),
      name:          pInfo?.name   || '',
      photo:         pInfo?.photo  || '',
      teamName:      pInfo?.teamName || '',
      teamLogo:      pInfo?.teamLogo || '',
      leagueId,
      leagueName:    league.name     || '',
      leagueFlag:    league.flag     || '',
      leagueFlagAlt: league.flagAlt  || '',
      leagueCls:     league.cls      || '',
      leagueLabel:   league.label    || '',
      totalGoals,
      totalAssists,
      totalGames,
      avg: totalGames > 0 ? parseFloat((totalGoals / totalGames).toFixed(2)) : 0,
      recent_goals,
      recent_assists,
      trendScore,
      form,
      last5,
      hot: trendScore > 2 && last5.filter(m => m.played).length >= 2,
    };
  }

  return players;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());
  if (!API_KEY) { console.error('❌ Clé API manquante (CLE_1)'); process.exit(1); }
  console.log(`🔑 Clé: ${API_KEY.slice(0, 8)}...`);

  // Charger les données existantes
  const stored = loadData();
  console.log(`📦 Données existantes: ${stored.matches?.length || 0} matchs, ${Object.keys(stored.players || {}).length} joueurs`);

  // Index des matchs déjà stockés pour éviter les doublons
  const storedFixtureIds = new Set((stored.matches || []).map(m => m.fixtureId));

  const leagueMap = Object.fromEntries(LEAGUES.map(l => [l.id, l]));
  const newMatches = [];
  let totalNew = 0;

  // Pour chaque ligue, récupérer les matchs du jour
  for (const league of LEAGUES) {
    console.log(`\n⚽ ${league.name}`);
    const fixtures = await getTodayFixtures(league.id);
    console.log(`  📅 ${fixtures.length} match(s) terminé(s) aujourd'hui`);

    for (const fixture of fixtures) {
      const fId = fixture.fixture.id;

      if (storedFixtureIds.has(fId)) {
        console.log(`  ⏭️  Match ${fId} déjà stocké, on skip`);
        continue;
      }

      const homeId    = fixture.teams.home.id;
      const homeGoals = fixture.goals.home ?? 0;
      const awayGoals = fixture.goals.away ?? 0;
      const date      = fixture.fixture.date;

      console.log(`  🎮 ${fixture.teams.home.name} ${homeGoals}-${awayGoals} ${fixture.teams.away.name}`);

      // Stats des joueurs dans ce match
      const matchPlayers = await getFixturePlayers(fId);

      // Enrichir avec le résultat (victoire/défaite)
      const enriched = matchPlayers.map(p => ({
        ...p,
        teamWon: p.teamId === homeId ? homeGoals > awayGoals : awayGoals > homeGoals,
      }));

      newMatches.push({
        fixtureId:  fId,
        date,
        leagueId:   league.id,
        leagueName: league.name,
        homeTeam:   fixture.teams.home.name,
        awayTeam:   fixture.teams.away.name,
        homeGoals,
        awayGoals,
        players:    enriched,
      });

      totalNew++;
    }
  }

  if (totalNew === 0) {
    console.log('\n😴 Aucun nouveau match aujourd\'hui — data.json inchangé');
    // Mettre à jour juste le timestamp
    stored.updatedAt     = new Date().toISOString();
    stored.totalRequests = reqCount;
    saveData(stored);
    return;
  }

  // Fusionner nouveaux matchs avec l'historique
  const allMatches = [...(stored.matches || []), ...newMatches];

  // Garder seulement les 60 derniers matchs par ligue pour ne pas faire grossir le fichier indéfiniment
  const matchesByLeague = {};
  for (const m of allMatches) {
    if (!matchesByLeague[m.leagueId]) matchesByLeague[m.leagueId] = [];
    matchesByLeague[m.leagueId].push(m);
  }
  const trimmedMatches = [];
  for (const [lid, lMatches] of Object.entries(matchesByLeague)) {
    lMatches.sort((a, b) => new Date(b.date) - new Date(a.date));
    trimmedMatches.push(...lMatches.slice(0, 60)); // garder les 60 derniers matchs
  }

  // Recalculer le classement joueurs
  const players = rebuildPlayers(trimmedMatches, leagueMap);

  // Trier les joueurs par trendScore puis totalGoals
  const playersList = Object.values(players)
    .sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);

  const output = {
    updatedAt:    new Date().toISOString(),
    season:       SEASON,
    totalMatches: trimmedMatches.length,
    totalPlayers: playersList.length,
    totalRequests: reqCount,
    newMatchesToday: totalNew,
    matches:      trimmedMatches,
    players:      playersList,
  };

  saveData(output);
  console.log(`\n✅ Terminé — ${totalNew} nouveau(x) match(s) | ${playersList.length} joueurs | ${reqCount} requêtes`);
  console.log(`🏆 Top tendance: ${playersList[0]?.name} (${playersList[0]?.trendScore}) | Top buteur: ${playersList.sort((a,b) => b.totalGoals - a.totalGoals)[0]?.name}`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
