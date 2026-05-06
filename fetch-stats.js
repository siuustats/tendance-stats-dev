// fetch-stats.js — Tendance Stats
// Source : ESPN hidden API (gratuite, sans clé, sans Apify)
// 6 requêtes/soir, 0 coût

const fs = require('fs');
const DATA_FILE = 'data.json';

const LEAGUES = [
  { code: 'eng.1',         id: 17, name: 'Premier League',      flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { code: 'fra.1',         id: 34, name: 'Ligue 1',             flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { code: 'esp.1',         id: 8,  name: 'La Liga',             flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { code: 'ita.1',         id: 23, name: 'Serie A',             flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { code: 'ger.1',         id: 35, name: 'Bundesliga',          flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
  { code: 'uefa.champions',id: 7,  name: 'Ligue des Champions', flag: 'eu',     flagAlt: 'CL', cls: 'cl',  label: 'LDC'  },
];

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

// ── ESPN API ──────────────────────────────────────────────────────────────────

async function fetchESPN(leagueCode, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard?dates=${date}`;
  console.log(`  GET ${url}`);
  await new Promise(r => setTimeout(r, 500));
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!res.ok) { console.warn(`  ⚠️  HTTP ${res.status}`); return []; }
  const data = await res.json();
  return data.events || [];
}

// ── ESPN Summary : photos joueurs depuis le roster ───────────────────────────

async function fetchPlayerPhotos(leagueCode, eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${eventId}`;
  await new Promise(r => setTimeout(r, 500));
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return {};
    const data = await res.json();
    const photos = {};
    for (const team of (data.rosters || [])) {
      for (const player of (team.roster || [])) {
        const id = player.athlete?.id;
        const headshot = player.athlete?.headshot?.href;
        if (id && headshot) photos[id] = headshot;
      }
    }
    console.log(`  📸 ${Object.keys(photos).length} photo(s) trouvée(s)`);
    return photos;
  } catch(e) {
    return {};
  }
}

// ── Extraire les contributions depuis les details ESPN ────────────────────────

function extractContributions(event, league, photos = {}) {
  const players = [];
  const comp     = event.competitions?.[0];
  if (!comp) return players;

  const details  = comp.details || [];
  const date     = event.date;

  // Identifier les équipes et scores
  const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
  const awayComp = comp.competitors?.find(c => c.homeAway === 'away');
  const homeId   = homeComp?.team?.id;
  const homeScore = parseInt(homeComp?.score || 0);
  const awayScore = parseInt(awayComp?.score || 0);

  const goalsMap = {}, infoMap = {};

  for (const detail of details) {
    if (!detail.scoringPlay) continue;
    if (detail.ownGoal) continue;

    const athlete = detail.athletesInvolved?.[0];
    if (!athlete) continue;

    const pid     = athlete.id;
    const name    = athlete.displayName || athlete.shortName;
    const teamId  = detail.team?.id;
    const isHome  = teamId === homeId;
    const teamName = isHome ? homeComp?.team?.displayName : awayComp?.team?.displayName;
    const teamWon  = isHome ? homeScore > awayScore : awayScore > homeScore;

    goalsMap[pid] = (goalsMap[pid] || 0) + 1;
    if (!infoMap[pid]) {
      infoMap[pid] = {
        id: pid, name, photo: photos[pid] || `https://a.espncdn.com/i/headshots/soccer/players/full/${pid}.png`,
        teamName: teamName || '', teamWon,
        leagueId: league.id, leagueName: league.name,
        leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
        leagueCls: league.cls, leagueLabel: league.label,
      };
    }
  }

  for (const [pid, goals] of Object.entries(goalsMap)) {
    const info = infoMap[pid];
    if (!info) continue;
    players.push({ ...info, goals, assists: 0, played: true, date });
  }

  return players;
}

// ── Recalculer classement ─────────────────────────────────────────────────────

function rebuildPlayers(matches) {
  const pm = {};
  for (const match of matches) {
    for (const p of (match.players || [])) {
      if (!pm[p.id]) pm[p.id] = { info: p, matches: [] };
      if (p.goals > 0) pm[p.id].info = p;
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
      teamName: info.teamName,
      leagueId: info.leagueId, leagueName: info.leagueName,
      leagueFlag: info.leagueFlag, leagueFlagAlt: info.leagueFlagAlt,
      leagueCls: info.leagueCls, leagueLabel: info.leagueLabel,
      totalGoals, totalAssists, totalGames: data.matches.length,
      avg: data.matches.length > 0 ? parseFloat((totalGoals / data.matches.length).toFixed(2)) : 0,
      recent_goals, recent_assists, trendScore,
      form: buildFormDots(last5), last5,
      signal: Math.min(98, Math.round(50 + trendScore * 10)),
      hot: trendScore > 2 && recent_goals >= 2,
    });
  }
  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());

  // Chercher sur les 2 derniers jours pour ne rater aucun match
  const dates = [];
  for (let i = 1; i <= 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  console.log(`📅 Dates cibles : ${dates.join(', ')}`);

  const stored     = loadData();
  const storedIds  = new Set((stored.matches || []).map(m => m.fixtureId));
  const newMatches = [];

  for (const league of LEAGUES) {
    console.log(`\n⚽ ${league.name}`);
    const allEvents = [];
    for (const date of dates) {
      const evs = await fetchESPN(league.code, date);
      allEvents.push(...evs);
    }
    const events = allEvents;
    console.log(`  📅 ${events.length} match(s)`);

    for (const event of events) {
      const comp   = event.competitions?.[0];
      const status = comp?.status?.type?.state;
      if (status !== 'post') continue; // seulement les matchs terminés

      const fId    = event.id;
      if (storedIds.has(fId)) { console.log(`  ⏭️  Déjà stocké`); continue; }

      const homeComp  = comp.competitors?.find(c => c.homeAway === 'home');
      const awayComp  = comp.competitors?.find(c => c.homeAway === 'away');
      const homeName  = homeComp?.team?.displayName || '?';
      const awayName  = awayComp?.team?.displayName || '?';
      const homeScore = parseInt(homeComp?.score || 0);
      const awayScore = parseInt(awayComp?.score || 0);

      console.log(`  🎮 ${homeName} ${homeScore}-${awayScore} ${awayName}`);

      // Récupérer les photos depuis le summary
      const photos = await fetchPlayerPhotos(league.code, fId);
      const players  = extractContributions(event, league, photos);
      const contribs = players.filter(p => p.goals > 0);
      contribs.forEach(p => console.log(`     ⚽ ${p.name}: ${p.goals}B (${p.teamName})`));

      newMatches.push({
        fixtureId: fId, date: event.date,
        leagueId: league.id, leagueName: league.name,
        homeTeam: homeName, awayTeam: awayName,
        homeGoals: homeScore, awayGoals: awayScore,
        players,
      });
    }
  }

  if (newMatches.length === 0) {
    console.log('\n😴 Aucun nouveau match');
    stored.updatedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(stored));
    return;
  }

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
    totalRequests:   LEAGUES.length,
    newMatchesToday: newMatches.length,
    matches:         trimmed,
    players,
  }));

  console.log(`\n✅ ${newMatches.length} match(s) | ${players.length} joueurs | ${LEAGUES.length} requêtes ESPN`);
  if (players.length > 0) console.log(`🏆 Top : ${players[0].name} (trend: ${players[0].trendScore})`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
