// fetch-stats.js — Tendance Stats
// Source : football-data.org v4 (gratuit, saison en cours)
// Logique : matchs du jour → buts/assists par joueur → stockage cumulatif

const fs = require('fs');

const API_KEY   = process.env.CLE_1;
const DATA_FILE = 'data.json';

const LEAGUES = [
  { code: 'FL1', id: 2015, name: 'Ligue 1',        flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { code: 'PL',  id: 2021, name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { code: 'PD',  id: 2014, name: 'La Liga',        flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { code: 'SA',  id: 2019, name: 'Serie A',        flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { code: 'BL1', id: 2002, name: 'Bundesliga',     flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
  { code: 'CL',  id: 2001, name: 'Ligue des Champions', flag: 'eu',     flagAlt: 'CL', cls: 'cl',  label: 'CL'   },
];

let reqCount = 0;

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(url) {
  reqCount++;
  console.log(`  [${reqCount}] ${url}`);
  await new Promise(r => setTimeout(r, 6500));
  const res  = await fetch(url, {
    headers: { 'X-Auth-Token': API_KEY }
  });
  if (!res.ok) {
    console.warn(`  ⚠️  HTTP ${res.status} : ${res.statusText}`);
    return null;
  }
  const data = await res.json();
  return data;
}

// ── Calculs ───────────────────────────────────────────────────────────────────

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

// ── Charger data.json ─────────────────────────────────────────────────────────

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (e) { console.warn('⚠️  data.json corrompu, on repart de zéro'); }
  }
  return { matches: [], players: {} };
}

// ── Récupérer les matchs terminés aujourd'hui ─────────────────────────────────

async function getTodayMatches(league) {
  const today = new Date().toISOString().slice(0, 10);
  const data  = await apiFetch(
    `https://api.football-data.org/v4/competitions/${league.code}/matches?dateFrom=${today}&dateTo=${today}&status=FINISHED`
  );
  if (!data) return [];
  console.log(`  📅 ${data.matches?.length || 0} match(s) terminé(s)`);
  return data.matches || [];
}

// ── Récupérer le détail d'un match (buts + assists par joueur) ────────────────

async function getMatchDetail(matchId) {
  const data = await apiFetch(`https://api.football-data.org/v4/matches/${matchId}`);
  if (!data) return null;
  return data;
}

// ── Extraire buts et passes d'un match ───────────────────────────────────────

function extractPlayerStats(match, league) {
  const players = [];
  const goals   = match.goals || [];

  // Compteurs par joueur
  const goalsMap   = {};
  const assistsMap = {};
  const playerInfo = {};

  const homeId   = match.homeTeam?.id;
  const homeGoal = match.score?.fullTime?.home ?? 0;
  const awayGoal = match.score?.fullTime?.away ?? 0;

  for (const goal of goals) {
    if (goal.type === 'OWN_GOAL') continue; // ignorer les csc

    const scorer  = goal.scorer;
    const assist  = goal.assist;
    const teamId  = goal.team?.id;
    const teamWon = teamId === homeId ? homeGoal > awayGoal : awayGoal > homeGoal;

    if (scorer?.id) {
      goalsMap[scorer.id]  = (goalsMap[scorer.id]  || 0) + 1;
      playerInfo[scorer.id] = {
        id:       scorer.id,
        name:     scorer.name,
        photo:    '',
        teamId,
        teamName: goal.team?.name || '',
        teamWon,
        leagueId:      league.id,
        leagueName:    league.name,
        leagueFlag:    league.flag,
        leagueFlagAlt: league.flagAlt,
        leagueCls:     league.cls,
        leagueLabel:   league.label,
      };
    }

    if (assist?.id) {
      assistsMap[assist.id] = (assistsMap[assist.id] || 0) + 1;
      // Si le passeur n'est pas encore dans playerInfo
      if (!playerInfo[assist.id]) {
        playerInfo[assist.id] = {
          id:       assist.id,
          name:     assist.name,
          photo:    '',
          teamId,
          teamName: goal.team?.name || '',
          teamWon,
          leagueId:      league.id,
          leagueName:    league.name,
          leagueFlag:    league.flag,
          leagueFlagAlt: league.flagAlt,
          leagueCls:     league.cls,
          leagueLabel:   league.label,
        };
      }
    }
  }

  // Construire la liste finale
  const allIds = new Set([...Object.keys(goalsMap), ...Object.keys(assistsMap)]);
  for (const id of allIds) {
    const info = playerInfo[id];
    if (!info) continue;
    players.push({
      ...info,
      goals:   goalsMap[id]   || 0,
      assists: assistsMap[id] || 0,
      played:  true,
    });
  }

  // Ajouter aussi les joueurs qui ont joué mais sans but/passe (pour le malus "pas joué")
  // On les récupère depuis les lineups si disponibles
  const lineup = match.lineups || [];
  for (const team of lineup) {
    const teamId  = team.team?.id;
    const teamWon = teamId === homeId ? homeGoal > awayGoal : awayGoal > homeGoal;
    for (const p of [...(team.startXI || []), ...(team.substitutes || [])]) {
      const pid = p.player?.id;
      if (!pid || allIds.has(String(pid))) continue;
      // Joueur qui a joué mais n'a pas contribué — on l'enregistre pour le malus forme
      players.push({
        id:       pid,
        name:     p.player?.name || '',
        photo:    '',
        teamId,
        teamName: team.team?.name || '',
        teamWon,
        leagueId:      league.id,
        leagueName:    league.name,
        leagueFlag:    league.flag,
        leagueFlagAlt: league.flagAlt,
        leagueCls:     league.cls,
        leagueLabel:   league.label,
        goals:   0,
        assists: 0,
        played:  true,
      });
    }
  }

  return players;
}

// ── Recalculer le classement depuis l'historique ──────────────────────────────

function rebuildPlayers(matches) {
  const playerMatches = {};

  for (const match of matches) {
    for (const p of (match.players || [])) {
      if (!playerMatches[p.id]) playerMatches[p.id] = { info: null, matches: [] };
      // Garder les infos les plus récentes
      if (p.goals > 0 || p.assists > 0 || !playerMatches[p.id].info) {
        playerMatches[p.id].info = p;
      }
      playerMatches[p.id].matches.push({
        goals:    p.goals,
        assists:  p.assists,
        played:   p.played,
        teamWon:  p.teamWon,
        date:     match.date,
      });
    }
  }

  const players = [];

  for (const [playerId, data] of Object.entries(playerMatches)) {
    const info = data.info;
    if (!info?.name) continue;

    // Trier du plus récent
    data.matches.sort((a, b) => new Date(b.date) - new Date(a.date));

    const last5          = data.matches.slice(0, 5);
    const trendScore     = calcTrendScore(last5);
    const form           = buildFormDots(last5);
    const recent_goals   = last5.reduce((s, m) => s + m.goals,   0);
    const recent_assists = last5.reduce((s, m) => s + m.assists, 0);
    const totalGoals     = data.matches.reduce((s, m) => s + m.goals,   0);
    const totalAssists   = data.matches.reduce((s, m) => s + m.assists, 0);
    const totalGames     = data.matches.length;

    players.push({
      id:            parseInt(playerId),
      name:          info.name,
      photo:         info.photo || '',
      teamName:      info.teamName || '',
      teamLogo:      '',
      leagueId:      info.leagueId,
      leagueName:    info.leagueName,
      leagueFlag:    info.leagueFlag,
      leagueFlagAlt: info.leagueFlagAlt,
      leagueCls:     info.leagueCls,
      leagueLabel:   info.leagueLabel,
      totalGoals,
      totalAssists,
      totalGames,
      avg:           totalGames > 0 ? parseFloat((totalGoals / totalGames).toFixed(2)) : 0,
      recent_goals,
      recent_assists,
      trendScore,
      form,
      last5,
      signal:        Math.min(98, Math.round(50 + trendScore * 10)),
      hot:           trendScore > 2 && recent_goals + recent_assists >= 2,
    });
  }

  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());
  if (!API_KEY) { console.error('❌ Clé API manquante (CLE_1)'); process.exit(1); }
  console.log(`🔑 Clé: ${API_KEY.slice(0, 8)}...`);

  const stored = loadData();
  console.log(`📦 Existant: ${stored.matches?.length || 0} matchs, ${stored.players?.length || 0} joueurs`);

  const storedIds  = new Set((stored.matches || []).map(m => m.fixtureId));
  const newMatches = [];

  for (const league of LEAGUES) {
    console.log(`\n⚽ ${league.name}`);
    const matches = await getTodayMatches(league);

    for (const match of matches) {
      if (storedIds.has(match.id)) {
        console.log(`  ⏭️  Match ${match.id} déjà stocké`);
        continue;
      }

      console.log(`  🎮 ${match.homeTeam.name} ${match.score.fullTime.home}-${match.score.fullTime.away} ${match.awayTeam.name}`);

      // Détail du match pour avoir les buts et assists
      const detail  = await getMatchDetail(match.id);
      if (!detail) continue;

      const players = extractPlayerStats(detail, league);
      console.log(`  👥 ${players.filter(p => p.goals > 0 || p.assists > 0).length} joueurs avec contribution`);

      newMatches.push({
        fixtureId:  match.id,
        date:       match.utcDate,
        leagueId:   league.id,
        leagueName: league.name,
        homeTeam:   match.homeTeam.name,
        awayTeam:   match.awayTeam.name,
        homeGoals:  match.score.fullTime.home,
        awayGoals:  match.score.fullTime.away,
        players,
      });
    }
  }

  if (newMatches.length === 0) {
    console.log('\n😴 Aucun nouveau match — data.json inchangé');
    stored.updatedAt     = new Date().toISOString();
    stored.totalRequests = reqCount;
    fs.writeFileSync(DATA_FILE, JSON.stringify(stored));
    return;
  }

  // Fusionner et garder les 100 derniers matchs par ligue
  const allMatches = [...(stored.matches || []), ...newMatches];
  const byLeague   = {};
  for (const m of allMatches) {
    if (!byLeague[m.leagueId]) byLeague[m.leagueId] = [];
    byLeague[m.leagueId].push(m);
  }
  const trimmed = [];
  for (const lm of Object.values(byLeague)) {
    lm.sort((a, b) => new Date(b.date) - new Date(a.date));
    trimmed.push(...lm.slice(0, 100));
  }

  const players = rebuildPlayers(trimmed);

  fs.writeFileSync(DATA_FILE, JSON.stringify({
    updatedAt:       new Date().toISOString(),
    totalMatches:    trimmed.length,
    totalPlayers:    players.length,
    totalRequests:   reqCount,
    newMatchesToday: newMatches.length,
    matches:         trimmed,
    players,
  }));

  console.log(`\n✅ ${newMatches.length} nouveau(x) match(s) | ${players.length} joueurs | ${reqCount} requêtes`);
  console.log(`🏆 Top tendance : ${players[0]?.name} (trend: ${players[0]?.trendScore})`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
