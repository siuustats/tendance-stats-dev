// fetch-stats.js — Tendance Stats
// Stratégie optimisée : 5 dernières journées par ligue → stats de TOUS les joueurs
// Budget : ~70 requêtes/jour pour 5 ligues

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

let reqCount = 0;

async function apiFetch(url) {
  reqCount++;
  console.log(`  [${reqCount}] ${url}`);
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    console.warn(`  ⚠️  Erreurs:`, JSON.stringify(data.errors));
  }
  await new Promise(r => setTimeout(r, 300));
  return data;
}

// ── Calculs ───────────────────────────────────────────────────────────────────

function calcTrendScore(recentMatches) {
  if (!recentMatches || recentMatches.length === 0) return 0;
  let score = 0;
  recentMatches.forEach((m, i) => {
    const weight = i === 0 ? 1.0 : 0.9;
    score += (m.goals + m.assists) * weight;
    if (m.teamWon) score += 0.5;
  });
  if (!recentMatches[0].played) score -= 3;
  const wins = recentMatches.filter(m => m.teamWon).length;
  if (wins >= 4)      score += 2;
  else if (wins >= 3) score += 1;
  return parseFloat(score.toFixed(2));
}

function buildFormDots(recentMatches) {
  return recentMatches.map(m => {
    if (!m.played) return 'x';
    if (m.goals > 0)   return 'g';
    if (m.assists > 0) return 'a';
    return 'x';
  });
}

function calcSeasonSignal(goals, assists, games, rank) {
  const base = Math.min(98, 55 + goals * 1.5 + assists * 0.8);
  return Math.max(40, Math.round(base - rank * 0.8));
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function getTopPlayers(leagueId) {
  const base = `https://v3.football.api-sports.io`;
  const seen = new Map();
  const endpoints = [
    `${base}/players/topscorers?league=${leagueId}&season=${SEASON}`,
    `${base}/players/topscorers?league=${leagueId}&season=${SEASON}&page=2`,
    `${base}/players/topassists?league=${leagueId}&season=${SEASON}`,
    `${base}/players/topassists?league=${leagueId}&season=${SEASON}&page=2`,
  ];
  for (const url of endpoints) {
    const data = await apiFetch(url);
    for (const item of (data.response || [])) {
      const p = item.player;
      if (seen.has(p.id)) continue;
      const s = item.statistics?.find(st => st.league?.id === leagueId) || item.statistics?.[0];
      if (!s) continue;
      const goals   = s.goals?.total       || 0;
      const assists = s.goals?.assists     || 0;
      const games   = s.games?.appearences || 0;
      seen.set(p.id, {
        id: p.id, name: p.name, photo: p.photo,
        teamId:   s.team?.id,
        teamName: s.team?.name || '',
        teamLogo: s.team?.logo || '',
        goals, assists, games,
        avg: games > 0 ? parseFloat((goals / games).toFixed(2)) : 0,
      });
    }
  }
  return [...seen.values()].sort((a, b) => b.goals - a.goals);
}

async function getLast5Fixtures(leagueId) {
  // 1 seule requête pour avoir les 5 derniers matchs de la ligue entière
  const data = await apiFetch(
    `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${SEASON}&last=5&status=FT`
  );
  return data.response || [];
}

async function getFixturePlayers(fixtureId) {
  // 1 requête pour TOUS les joueurs des deux équipes dans ce match
  const data = await apiFetch(
    `https://v3.football.api-sports.io/fixtures/players?fixture=${fixtureId}`
  );
  // Retourne un Map playerId -> { goals, assists, minutes, teamId }
  const playerMap = new Map();
  for (const teamData of (data.response || [])) {
    const teamId = teamData.team?.id;
    for (const p of (teamData.players || [])) {
      const s = p.statistics?.[0];
      if (!s) continue;
      playerMap.set(p.player.id, {
        goals:   s.goals?.total   || 0,
        assists: s.goals?.assists || 0,
        minutes: s.games?.minutes || 0,
        teamId,
      });
    }
  }
  return playerMap;
}

// ── Traitement principal par ligue ────────────────────────────────────────────

async function fetchLeague(league) {
  console.log(`\n📥 ${league.name}`);

  // Étape 1 : stats saison (top buteurs/passeurs)
  const seasonPlayers = await getTopPlayers(league.id);
  console.log(`  📋 ${seasonPlayers.length} joueurs en base saison`);

  // Étape 2 : 5 derniers matchs de la ligue (1 requête)
  const fixtures = await getLast5Fixtures(league.id);
  console.log(`  📅 ${fixtures.length} matchs récupérés`);

  // Étape 3 : stats joueurs pour chaque match (1 req par match = 5 req)
  // Structure : recentStats[playerId] = [{ goals, assists, played, teamWon, date }, ...]
  const recentStats = new Map();

  for (const fixture of fixtures) {
    const fId      = fixture.fixture.id;
    const homeId   = fixture.teams.home.id;
    const awayId   = fixture.teams.away.id;
    const homeGoals = fixture.goals.home ?? 0;
    const awayGoals = fixture.goals.away ?? 0;
    const date     = fixture.fixture.date;

    const playerMap = await getFixturePlayers(fId);

    for (const [playerId, pData] of playerMap) {
      const teamWon = pData.teamId === homeId
        ? homeGoals > awayGoals
        : awayGoals > homeGoals;

      if (!recentStats.has(playerId)) recentStats.set(playerId, []);
      recentStats.get(playerId).push({
        goals:   pData.goals,
        assists: pData.assists,
        played:  pData.minutes > 0,
        teamWon,
        date,
      });
    }
  }

  console.log(`  👥 ${recentStats.size} joueurs avec stats récentes`);

  // Étape 4 : fusionner stats saison + tendance récente
  // On garde tous les joueurs saison ET on ajoute ceux avec stats récentes uniquement
  const allById = new Map();

  // D'abord les joueurs saison
  seasonPlayers.forEach((p, i) => {
    allById.set(p.id, {
      ...p,
      leagueId:      league.id,
      leagueName:    league.name,
      leagueFlag:    league.flag,
      leagueFlagAlt: league.flagAlt,
      leagueCls:     league.cls,
      leagueLabel:   league.label,
      signal:        calcSeasonSignal(p.goals, p.assists, p.games, i),
      recentMatches: [],
      trendScore:    0,
      form:          [],
      recent_goals:  0,
      recent_assists: 0,
    });
  });

  // Ensuite enrichir avec les stats récentes
  for (const [playerId, matches] of recentStats) {
    // Trier du plus récent au plus ancien
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last5 = matches.slice(0, 5);

    const trendScore    = calcTrendScore(last5);
    const form          = buildFormDots(last5);
    const recent_goals   = last5.reduce((s, m) => s + m.goals,   0);
    const recent_assists = last5.reduce((s, m) => s + m.assists, 0);

    if (allById.has(playerId)) {
      // Joueur déjà dans le top saison → enrichir
      const existing = allById.get(playerId);
      allById.set(playerId, {
        ...existing,
        recentMatches: last5,
        trendScore,
        form,
        recent_goals,
        recent_assists,
        hot: trendScore > 2 && last5.filter(m => m.played).length >= 2,
      });
    } else {
      // Joueur avec stats récentes mais pas dans le top saison
      // On l'ajoute uniquement s'il a au moins 1 contribution récente
      if (recent_goals + recent_assists > 0) {
        allById.set(playerId, {
          id: playerId,
          name: `Joueur #${playerId}`,
          photo: '',
          teamName: '', teamLogo: '', teamId: null,
          leagueId:      league.id,
          leagueName:    league.name,
          leagueFlag:    league.flag,
          leagueFlagAlt: league.flagAlt,
          leagueCls:     league.cls,
          leagueLabel:   league.label,
          goals: 0, assists: 0, games: 0, avg: 0,
          signal: 50,
          recentMatches: last5,
          trendScore,
          form,
          recent_goals,
          recent_assists,
          hot: trendScore > 2,
        });
      }
    }
  }

  // Pour les joueurs saison sans stats récentes, leur assigner hot: false
  for (const [id, p] of allById) {
    if (p.recentMatches.length === 0) {
      allById.set(id, { ...p, hot: false });
    }
  }

  const result = [...allById.values()].sort((a, b) => b.trendScore - a.trendScore || b.goals - a.goals);
  const hotCount = result.filter(p => p.hot).length;
  console.log(`  ✅ ${result.length} joueurs | ${hotCount} en forme | top: ${result[0]?.name} (trend: ${result[0]?.trendScore})`);
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());
  if (!API_KEY) { console.error('❌ Clé API manquante (CLE_1)'); process.exit(1); }
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

  // Tri global : trendScore d'abord, puis goals saison
  allPlayers.sort((a, b) => b.trendScore - a.trendScore || b.goals - a.goals);

  const output = {
    updatedAt:     new Date().toISOString(),
    season:        SEASON,
    totalPlayers:  allPlayers.length,
    totalRequests: reqCount,
    errors,
    players:       allPlayers,
  };

  fs.writeFileSync('data.json', JSON.stringify(output));
  console.log(`\n✅ Terminé — ${allPlayers.length} joueurs | ${reqCount} requêtes utilisées`);
  if (errors.length) console.warn(`⚠️  Erreurs:`, errors);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
