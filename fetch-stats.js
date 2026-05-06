// fetch-stats.js — Tendance Stats
// Source : Flashscore Data Extractor + Flashscore Match Statistic Scraper
// Logique : matchs d'hier → buteurs/passeurs → stockage cumulatif

const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DATA_FILE   = 'data.json';

// IDs Apify des deux actors
const ACTOR_SCORES = 'dataizi-srl~flashscore-data-extractor';     // matchs du jour
const ACTOR_STATS  = 'statanow~flashscore-scraper-match-statistic';                        // stats par match

// Nos ligues à filtrer (noms exacts Flashscore)
const LEAGUE_FILTERS = [
  { filter: 'Champions League', id: 7,  name: 'Ligue des Champions', flag: 'eu',     flagAlt: 'CL', cls: 'cl',  label: 'LDC'  },
  { filter: 'Premier League',   id: 17, name: 'Premier League',      flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { filter: 'Ligue 1',          id: 34, name: 'Ligue 1',             flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { filter: 'LaLiga',           id: 8,  name: 'La Liga',             flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { filter: 'Serie A',          id: 23, name: 'Serie A',             flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { filter: 'Bundesliga',       id: 35, name: 'Bundesliga',          flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
];

// Mots-clés pour identifier nos ligues dans les données Flashscore
const LEAGUE_KEYWORDS = {
  7:  ['champions league', 'uefa champions'],
  17: ['premier league', 'england'],
  34: ['ligue 1', 'france'],
  8:  ['laliga', 'la liga', 'spain'],
  23: ['serie a', 'italy'],
  35: ['bundesliga', 'germany'],
};

let reqCount = 0;

// ── Apify runner ──────────────────────────────────────────────────────────────

async function apifyRun(actorId, input, timeoutSecs = 300) {
  reqCount++;
  console.log(`  [${reqCount}] Apify actor: ${actorId}`);
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=${timeoutSecs}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    console.warn(`  ⚠️  HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const items = await res.json();
  console.log(`  ← ${Array.isArray(items) ? items.length : 1} item(s)`);
  return Array.isArray(items) ? items : [items];
}

// ── Calculs ───────────────────────────────────────────────────────────────────

function calcTrendScore(last5) {
  if (!last5?.length) return 0;
  let score = 0;
  last5.forEach((m, i) => {
    score += (m.goals + m.assists) * (i === 0 ? 1.0 : 0.9);
    if (m.teamWon) score += 0.5;
  });
  if (!last5[0].played) score -= 3;
  const wins = last5.filter(m => m.teamWon).length;
  if (wins >= 4) score += 2; else if (wins >= 3) score += 1;
  return parseFloat(score.toFixed(2));
}

function buildFormDots(last5) {
  return last5.map(m => !m.played ? 'x' : m.goals > 0 ? 'g' : m.assists > 0 ? 'a' : 'x');
}

// ── Charger data.json ─────────────────────────────────────────────────────────

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (e) { console.warn('⚠️  data.json corrompu'); }
  }
  return { matches: [], players: [] };
}

// ── Identifier la ligue depuis le nom Flashscore ──────────────────────────────

function identifyLeague(tournamentName, categoryName) {
  const text = `${tournamentName} ${categoryName}`.toLowerCase();
  for (const [id, keywords] of Object.entries(LEAGUE_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      return LEAGUE_FILTERS.find(l => l.id === parseInt(id));
    }
  }
  return null;
}

// ── Parser le passeur depuis le champ raw ─────────────────────────────────────

function parseAssist(raw) {
  if (!raw) return null;
  const match = raw.match(/\(\s*([^)]+?)\s*\)/);
  if (!match) return null;
  const assist = match[1].trim();
  // Ignorer les parenthèses qui contiennent "Penalty", "Own goal", etc.
  if (['penalty', 'own goal', 'og', 'injury'].some(w => assist.toLowerCase().includes(w))) return null;
  return assist;
}

// ── Extraire buteurs + passeurs depuis les incidents ─────────────────────────

function extractContributions(matchData, league, matchDate) {
  const players = [];
  const homeTeam = matchData.home_team;
  const awayTeam = matchData.away_team;
  const homeParts = matchData.score?.split(' - ') || ['0', '0'];
  const homeScore = parseInt(homeParts[0]) || 0;
  const awayScore = parseInt(homeParts[1]) || 0;
  const incidents = matchData.incidents || [];

  const goalsMap = {}, assistsMap = {}, infoMap = {};

  for (const inc of incidents) {
    if (inc.action !== 'Goal') continue;

    const isHome = inc.side === 'home';
    const team   = isHome ? homeTeam : awayTeam;
    const teamWon = isHome ? homeScore > awayScore : awayScore > homeScore;
    const scorer  = inc.player?.trim();
    const assister = parseAssist(inc.raw);

    if (!scorer) continue;

    // Buteur
    goalsMap[scorer] = (goalsMap[scorer] || 0) + 1;
    if (!infoMap[scorer]) infoMap[scorer] = {
      name: scorer, teamName: team, teamWon,
      leagueId: league.id, leagueName: league.name,
      leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
      leagueCls: league.cls, leagueLabel: league.label,
    };

    // Passeur
    if (assister) {
      assistsMap[assister] = (assistsMap[assister] || 0) + 1;
      if (!infoMap[assister]) infoMap[assister] = {
        name: assister, teamName: team, teamWon,
        leagueId: league.id, leagueName: league.name,
        leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
        leagueCls: league.cls, leagueLabel: league.label,
      };
    }
  }

  const allNames = new Set([...Object.keys(goalsMap), ...Object.keys(assistsMap)]);
  for (const name of allNames) {
    const info = infoMap[name];
    if (!info) continue;
    players.push({
      id:      name.toLowerCase().replace(/\s+/g, '_'),
      name:    info.name,
      photo:   '',
      teamName: info.teamName,
      teamWon:  info.teamWon,
      leagueId: info.leagueId, leagueName: info.leagueName,
      leagueFlag: info.leagueFlag, leagueFlagAlt: info.leagueFlagAlt,
      leagueCls: info.leagueCls, leagueLabel: info.leagueLabel,
      goals:   goalsMap[name]   || 0,
      assists: assistsMap[name] || 0,
      played:  true,
      date:    matchDate,
    });
  }

  return players;
}

// ── Recalculer classement ─────────────────────────────────────────────────────

function rebuildPlayers(matches) {
  const pm = {};
  for (const match of matches) {
    for (const p of (match.players || [])) {
      if (!pm[p.id]) pm[p.id] = { info: p, matches: [] };
      if (p.goals > 0 || p.assists > 0) pm[p.id].info = p;
      pm[p.id].matches.push({
        goals: p.goals, assists: p.assists,
        played: p.played, teamWon: p.teamWon,
        date: p.date || match.date,
      });
    }
  }

  const players = [];
  for (const [, data] of Object.entries(pm)) {
    const info = data.info;
    if (!info?.name) continue;
    data.matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last5          = data.matches.slice(0, 5);
    const trendScore     = calcTrendScore(last5);
    const form           = buildFormDots(last5);
    const recent_goals   = last5.reduce((s, m) => s + m.goals,   0);
    const recent_assists = last5.reduce((s, m) => s + m.assists, 0);
    const totalGoals     = data.matches.reduce((s, m) => s + m.goals,   0);
    const totalAssists   = data.matches.reduce((s, m) => s + m.assists, 0);
    players.push({
      id: info.id, name: info.name, photo: '',
      teamName: info.teamName,
      leagueId: info.leagueId, leagueName: info.leagueName,
      leagueFlag: info.leagueFlag, leagueFlagAlt: info.leagueFlagAlt,
      leagueCls: info.leagueCls, leagueLabel: info.leagueLabel,
      totalGoals, totalAssists, totalGames: data.matches.length,
      avg: data.matches.length > 0 ? parseFloat((totalGoals / data.matches.length).toFixed(2)) : 0,
      recent_goals, recent_assists, trendScore, form, last5,
      signal: Math.min(98, Math.round(50 + trendScore * 10)),
      hot: trendScore > 2 && recent_goals + recent_assists >= 2,
    });
  }
  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());
  if (!APIFY_TOKEN) { console.error('❌ APIFY_TOKEN manquant'); process.exit(1); }

  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  console.log(`📅 Date cible : ${yesterday}`);

  const stored    = loadData();
  const storedIds = new Set((stored.matches || []).map(m => m.fixtureId));
  const newMatches = [];

  // ── Étape 1 : récupérer les matchs terminés hier via Flashscore Data Extractor
  console.log('\n📋 Étape 1 : matchs terminés hier...');
  const scoreItems = await apifyRun(ACTOR_SCORES, {
    extractionMode: 'score_mode',
    targetSports: ['Football (soccer)'],
    daysToFetch: [-1],
    matchStatus: 'Finished',
    leagueTournamentFilter: [],
  }, 300);

  // Filtrer nos ligues et matchs non encore stockés
  const matchesToProcess = [];
  for (const item of scoreItems) {
    const league = identifyLeague(item.tournament_name, item.category_name);
    if (!league) continue;
    if (storedIds.has(item.match_id)) {
      console.log(`  ⏭️  ${item.match_id} déjà stocké`);
      continue;
    }
    matchesToProcess.push({ item, league });
    console.log(`  ✅ ${league.name}: ${item.home_team_name} vs ${item.away_team_name}`);
  }

  if (matchesToProcess.length === 0) {
    console.log('\n😴 Aucun nouveau match — data.json inchangé');
    stored.updatedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(stored));
    return;
  }

  // ── Étape 2 : récupérer les stats de chaque match via Flashscore Match Statistic
  console.log(`\n📋 Étape 2 : stats de ${matchesToProcess.length} match(s)...`);

  for (const { item, league } of matchesToProcess) {
    console.log(`\n  🎮 ${item.home_team_name} vs ${item.away_team_name} (${league.name})`);

    const statsItems = await apifyRun(ACTOR_STATS, {
      match_url: item.match_url,
      matches_per_team: 1,
    }, 120);

    if (!statsItems?.length) {
      console.warn(`  ⚠️  Pas de stats pour ce match`);
      continue;
    }

    // Chercher les incidents du match dans la réponse
    const statsData = statsItems[0];
    let matchIncidents = null;

    // L'actor retourne { home: { matchId: {...} }, away: { matchId: {...} } }
    const allMatches = {
      ...statsData.matches?.home,
      ...statsData.matches?.away,
    };

    // Trouver le match correspondant par ID ou par noms d'équipes
    for (const [, m] of Object.entries(allMatches)) {
      const ht = m.home_team?.toLowerCase() || '';
      const at = m.away_team?.toLowerCase() || '';
      const itemHt = item.home_team_name?.toLowerCase() || '';
      const itemAt = item.away_team_name?.toLowerCase() || '';
      if (
        m.match_id === item.match_id ||
        (ht.includes(itemHt.split(' ')[0]) || at.includes(itemAt.split(' ')[0]))
      ) {
        matchIncidents = m;
        break;
      }
    }

    if (!matchIncidents) {
      // Prendre le premier match disponible
      const first = Object.values(allMatches)[0];
      if (first) matchIncidents = first;
    }

    if (!matchIncidents) {
      console.warn(`  ⚠️  Match non trouvé dans les stats`);
      continue;
    }

    const matchDate = item.match_date
      ? new Date(item.match_date).toISOString()
      : new Date(yesterday).toISOString();

    const players  = extractContributions(matchIncidents, league, matchDate);
    const contribs = players.filter(p => p.goals > 0 || p.assists > 0);

    console.log(`  👥 ${contribs.length} contribution(s):`);
    contribs.forEach(p => console.log(`     ${p.name}: ${p.goals}B ${p.assists}P (${p.teamName})`));

    const homeScore = parseInt(item.match_score_home_goals) || 0;
    const awayScore = parseInt(item.match_score_away_goals) || 0;

    newMatches.push({
      fixtureId:  item.match_id,
      date:       matchDate,
      leagueId:   league.id,
      leagueName: league.name,
      homeTeam:   item.home_team_name,
      awayTeam:   item.away_team_name,
      homeGoals:  homeScore,
      awayGoals:  awayScore,
      players,
    });
  }

  if (newMatches.length === 0) {
    console.log('\n😴 Aucune donnée extraite');
    stored.updatedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(stored));
    return;
  }

  // Fusionner et recalculer
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

  console.log(`\n✅ ${newMatches.length} match(s) | ${players.length} joueurs | ${reqCount} appels Apify`);
  if (players.length > 0) {
    console.log(`🏆 Top tendance : ${players[0].name} (trend: ${players[0].trendScore})`);
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
