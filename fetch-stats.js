// fetch-stats.js — Tendance Stats
// Source : Apify SofaScore Scraper PRO pour tout (matchs + détails)

const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DATA_FILE   = 'data.json';

// URLs SofaScore des pages de résultats par ligue
const LEAGUES = [
  { sofaUrl: 'https://www.sofascore.com/football/tournament/france/ligue-1/34', id: 34,  name: 'Ligue 1',             flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'  },
  { sofaUrl: 'https://www.sofascore.com/football/tournament/england/premier-league/17', id: 17, name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'  },
  { sofaUrl: 'https://www.sofascore.com/football/tournament/spain/laliga/8',     id: 8,   name: 'La Liga',             flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA'},
  { sofaUrl: 'https://www.sofascore.com/football/tournament/italy/serie-a/23',   id: 23,  name: 'Serie A',             flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'  },
  { sofaUrl: 'https://www.sofascore.com/football/tournament/germany/bundesliga/35', id: 35, name: 'Bundesliga',        flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'  },
  { sofaUrl: 'https://www.sofascore.com/football/tournament/europe/uefa-champions-league/7', id: 7, name: 'Ligue des Champions', flag: 'eu', flagAlt: 'CL', cls: 'cl', label: 'LDC'},
];

let reqCount = 0;

// ── Apify runner ──────────────────────────────────────────────────────────────

async function apifyRun(urls) {
  reqCount++;
  console.log(`  [${reqCount}] Apify → ${urls.length} URL(s)`);
  const res = await fetch(
    `https://api.apify.com/v2/acts/azzouzana~sofascore-scraper-pro/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrls: urls }),
    }
  );
  if (!res.ok) {
    console.warn(`  ⚠️  Apify HTTP ${res.status}: ${await res.text()}`);
    return [];
  }
  return await res.json();
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
  if (wins >= 4) score += 2;
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
    catch (e) { console.warn('⚠️  data.json corrompu'); }
  }
  return { matches: [], players: [] };
}

// ── Extraire matchs terminés hier depuis une page ligue ───────────────────────

function extractYesterdayMatches(item, league, yesterday) {
  const matches = [];
  const events  = item?.data?.events || item?.data?.tournament?.events || [];

  for (const ev of events) {
    if (ev.status?.type !== 'finished') continue;
    const evDate = new Date((ev.startTimestamp || 0) * 1000).toISOString().slice(0, 10);
    if (evDate !== yesterday) continue;
    matches.push({
      id:        ev.id,
      slug:      ev.slug,
      customId:  ev.customId,
      homeTeam:  ev.homeTeam?.name,
      awayTeam:  ev.awayTeam?.name,
      homeScore: ev.homeScore?.current ?? 0,
      awayScore: ev.awayScore?.current ?? 0,
      date:      new Date((ev.startTimestamp || 0) * 1000).toISOString(),
      url:       `https://www.sofascore.com/football/match/${ev.slug}/${ev.customId}`,
    });
  }
  return matches;
}

// ── Extraire buteurs + passeurs depuis incidents ───────────────────────────────

function extractContributions(item, league) {
  const players   = [];
  const incidents = item?.data?.incidents || [];
  const ev        = item?.data?.event || {};
  const homeScore = ev.homeScore?.current ?? 0;
  const awayScore = ev.awayScore?.current ?? 0;
  const date      = ev.startTimestamp
    ? new Date(ev.startTimestamp * 1000).toISOString()
    : new Date().toISOString();

  const goalsMap   = {};
  const assistsMap = {};
  const infoMap    = {};

  for (const inc of incidents) {
    if (inc.incidentType !== 'goal') continue;
    if (inc.incidentClass === 'ownGoal') continue;

    const isHome  = inc.isHome;
    const team    = isHome ? ev.homeTeam : ev.awayTeam;
    const teamWon = isHome ? homeScore > awayScore : awayScore > homeScore;

    // Buteur
    if (inc.player?.id) {
      const pid = inc.player.id;
      goalsMap[pid] = (goalsMap[pid] || 0) + 1;
      if (!infoMap[pid]) infoMap[pid] = {
        id: pid, name: inc.player.name,
        photo: `https://api.sofascore.com/api/v1/player/${pid}/image`,
        teamName: team?.name || '', teamWon,
        leagueId: league.id, leagueName: league.name,
        leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
        leagueCls: league.cls, leagueLabel: league.label,
      };
    }

    // Passeur dans shotList
    for (const shot of (inc.shotList || [])) {
      if (shot.eventType !== 'assist') continue;
      if (!shot.player?.id) continue;
      const aid = shot.player.id;
      const team2 = isHome ? ev.homeTeam : ev.awayTeam;
      const won2  = isHome ? homeScore > awayScore : awayScore > homeScore;
      assistsMap[aid] = (assistsMap[aid] || 0) + 1;
      if (!infoMap[aid]) infoMap[aid] = {
        id: aid, name: shot.player.name,
        photo: `https://api.sofascore.com/api/v1/player/${aid}/image`,
        teamName: team2?.name || '', teamWon: won2,
        leagueId: league.id, leagueName: league.name,
        leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
        leagueCls: league.cls, leagueLabel: league.label,
      };
    }
  }

  const allIds = new Set([...Object.keys(goalsMap), ...Object.keys(assistsMap)]);
  for (const id of allIds) {
    const info = infoMap[id];
    if (!info) continue;
    players.push({ ...info, goals: goalsMap[id] || 0, assists: assistsMap[id] || 0, played: true, date });
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
      pm[p.id].matches.push({ goals: p.goals, assists: p.assists, played: p.played, teamWon: p.teamWon, date: p.date || match.date });
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
      id: info.id, name: info.name, photo: info.photo || '',
      teamName: info.teamName || '',
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

  const stored     = loadData();
  const storedIds  = new Set((stored.matches || []).map(m => m.fixtureId));
  const newMatches = [];

  // Étape 1 : scraper les pages de chaque ligue pour trouver les matchs d'hier
  console.log('\n📋 Étape 1 : récupération des matchs d\'hier...');
  const leagueItems = await apifyRun(LEAGUES.map(l => l.sofaUrl));

  const matchesToScrape = []; // { league, match }
  for (const item of leagueItems) {
    // Identifier la ligue depuis l'URL
    const league = LEAGUES.find(l => item.url?.includes(`/${l.id}`) || l.sofaUrl === item.url);
    if (!league) continue;
    const matches = extractYesterdayMatches(item, league, yesterday);
    console.log(`  ${league.name}: ${matches.length} match(s) d'hier`);
    for (const m of matches) {
      if (!storedIds.has(m.id)) matchesToScrape.push({ league, match: m });
    }
  }

  if (matchesToScrape.length === 0) {
    console.log('\n😴 Aucun nouveau match — data.json inchangé');
    stored.updatedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(stored));
    return;
  }

  // Étape 2 : scraper les détails de chaque match
  console.log(`\n📋 Étape 2 : détails de ${matchesToScrape.length} match(s)...`);
  const matchUrls   = matchesToScrape.map(({ match }) => match.url);
  const matchItems  = await apifyRun(matchUrls);

  for (let i = 0; i < matchesToScrape.length; i++) {
    const { league, match } = matchesToScrape[i];
    const detail = matchItems.find(item => item.url?.includes(match.customId)) || matchItems[i];
    if (!detail) { console.warn(`  ⚠️  Pas de détails pour ${match.homeTeam} vs ${match.awayTeam}`); continue; }

    const players = extractContributions(detail, league);
    const contribs = players.filter(p => p.goals > 0 || p.assists > 0);
    console.log(`  🎮 ${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam} → ${contribs.length} contribution(s)`);
    contribs.forEach(p => console.log(`     ${p.name}: ${p.goals}B ${p.assists}P`));

    newMatches.push({ fixtureId: match.id, date: match.date, leagueId: league.id, leagueName: league.name, homeTeam: match.homeTeam, awayTeam: match.awayTeam, homeGoals: match.homeGoals, awayGoals: match.awayGoals, players });
  }

  // Fusionner et recalculer
  const allMatches = [...(stored.matches || []), ...newMatches];
  const byLeague = {};
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
    updatedAt: new Date().toISOString(),
    totalMatches: trimmed.length,
    totalPlayers: players.length,
    totalRequests: reqCount,
    newMatchesToday: newMatches.length,
    matches: trimmed, players,
  }));

  console.log(`\n✅ ${newMatches.length} match(s) | ${players.length} joueurs | ${reqCount} requêtes Apify`);
  if (players.length > 0) console.log(`🏆 Top : ${players[0].name} (trend: ${players[0].trendScore})`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
