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
  { code: 'uefa.europa',   id: 5,  name: 'Europa League',       flag: 'eu',     flagAlt: 'EL', cls: 'el',  label: 'EL'   },
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

async function fetchSummaryData(leagueCode, eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${eventId}`;
  await new Promise(r => setTimeout(r, 500));
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return { photos: {}, assists: {} };
    const data = await res.json();

    // Photos depuis le roster
    const photos = {};
    for (const team of (data.rosters || [])) {
      for (const player of (team.roster || [])) {
        const id = player.athlete?.id;
        const headshot = player.athlete?.headshot?.href;
        if (id && headshot) photos[id] = headshot;
      }
    }

    // Passes décisives depuis keyEvents (participants[1] = passeur)
    const assists = {}; // { scorerId: { name, id } }

    for (const event of (data.keyEvents || [])) {
      if (event.type?.type !== 'goal') continue;
      if (!event.scoringPlay) continue;
      const participants = event.participants || [];
      if (participants.length >= 2) {
        const scorer   = participants[0]?.athlete;
        const assister = participants[1]?.athlete;
        if (scorer?.id && assister?.id) {
          assists[scorer.id] = { id: String(assister.id), name: assister.displayName };
          console.log(`  🎯 ${scorer.displayName} ← ${assister.displayName}`);
        }
      }
    }

    console.log(`  📸 ${Object.keys(photos).length} photo(s) | 🎯 ${Object.keys(assists).length} passe(s)`);
    return { photos, assists };
  } catch(e) {
    return { photos: {}, assists: {} };
  }
}

// ── Extraire les contributions depuis les details ESPN ────────────────────────

function extractContributions(event, league, photos = {}, assists = {}) {
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

  const goalsMap = {}, assistsMap = {}, infoMap = {};

  for (const detail of details) {
    if (!detail.scoringPlay) continue;
    if (detail.ownGoal) continue;

    const athlete = detail.athletesInvolved?.[0];
    if (!athlete) continue;

    const pid      = athlete.id;
    const name     = athlete.displayName || athlete.shortName;
    const teamId   = detail.team?.id;
    const isHome   = teamId === homeId;
    const teamName = isHome ? homeComp?.team?.displayName : awayComp?.team?.displayName;
    const teamWon  = isHome ? (homeScore > awayScore ? true : homeScore === awayScore ? null : false) : (awayScore > homeScore ? true : awayScore === homeScore ? null : false);

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

    // Passeur décisif depuis keyEvents
    const assisterInfo = assists[pid];
    if (assisterInfo) {
      const aid = assisterInfo.id;
      assistsMap[aid] = (assistsMap[aid] || 0) + 1;
      if (!infoMap[aid]) {
        infoMap[aid] = {
          id: aid, name: assisterInfo.name,
          photo: photos[aid] || `https://a.espncdn.com/i/headshots/soccer/players/full/${aid}.png`,
          teamName: teamName || '', teamWon,
          leagueId: league.id, leagueName: league.name,
          leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
          leagueCls: league.cls, leagueLabel: league.label,
        };
      }
    }
  }

  const allIds = new Set([...Object.keys(goalsMap), ...Object.keys(assistsMap)]);
  for (const pid of allIds) {
    const info = infoMap[pid];
    if (!info) continue;
    players.push({ ...info, goals: goalsMap[pid] || 0, assists: assistsMap[pid] || 0, played: true, date });
  }

  return players;
}

// ── Recalculer classement ─────────────────────────────────────────────────────

function rebuildPlayers(matches) {
  const pm = {};
  const CHAMP_IDS = new Set([17, 34, 8, 23, 35]); // PL, L1, Liga, SA, BL

  for (const match of matches) {
    for (const p of (match.players || [])) {
      if (!pm[p.id]) pm[p.id] = { info: p, champInfo: null, matches: [] };
      // Prioriser la ligue championnat pour l'affichage
      if (CHAMP_IDS.has(p.leagueId)) pm[p.id].champInfo = p;
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
    // Utiliser la ligue championnat en priorité
    const leagueInfo = data.champInfo || info;
    players.push({
      id: info.id, name: info.name, photo: info.photo || '',
      teamName: info.teamName,
      leagueId: leagueInfo.leagueId, leagueName: leagueInfo.leagueName,
      leagueFlag: leagueInfo.leagueFlag, leagueFlagAlt: leagueInfo.leagueFlagAlt,
      leagueCls: leagueInfo.leagueCls, leagueLabel: leagueInfo.leagueLabel,
      totalGoals, totalAssists, totalGames: data.matches.length,
      avg: data.matches.length > 0 ? parseFloat(((totalGoals + totalAssists) / data.matches.length).toFixed(2)) : 0,
      recent_goals, recent_assists, trendScore,
      form: buildFormDots(last5), last5,
      signal: Math.min(98, Math.round(50 + trendScore * 10)),
      hot: trendScore > 2 && recent_goals >= 2,
    });
  }
  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── API-Football : photos des nouveaux joueurs ───────────────────────────────

async function fetchMissingPhotos(players, photosCache) {
  // Utiliser Transfermarkt API (gratuit, sans clé, sans CORS)

  const missing = players.filter(p => !photosCache[p.id] && p.name);
  if (!missing.length) { console.log('✅ Toutes les photos sont en cache'); return photosCache; }

  console.log(`\n📸 Recherche de ${missing.length} photo(s) via Transfermarkt...`);
  const updated = { ...photosCache };

  for (const p of missing) {
    console.log(`  🔍 ${p.name}`);
    try {
      // Chercher l'ID Transfermarkt
      // Essayer nom complet puis prénom seul
      let playerId = null;
      for (const searchName of [p.name, p.name.split(' ')[0]]) {
        const searchRes = await fetch(
          `https://transfermarkt-api.fly.dev/players/search/${encodeURIComponent(searchName)}`,
          { headers: { 'User-Agent': 'TendanceStats/1.0' } }
        );
        if (!searchRes.ok) continue;
        const searchData = await searchRes.json();
        playerId = searchData.results?.[0]?.id;
        if (playerId) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (!playerId) { updated[p.id] = ''; console.log(`  ❌ Pas trouvé`); continue; }

      await new Promise(r => setTimeout(r, 500));

      // Récupérer la photo
      const profileRes = await fetch(
        `https://transfermarkt-api.fly.dev/players/${playerId}/profile`,
        { headers: { 'User-Agent': 'TendanceStats/1.0' } }
      );
      if (!profileRes.ok) { updated[p.id] = ''; continue; }
      const profile = await profileRes.json();
      const photo = profile.imageUrl;

      if (photo) {
        updated[p.id] = photo;
        console.log(`  ✅ Photo trouvée`);
      } else {
        updated[p.id] = '';
        console.log(`  ❌ Pas de photo`);
      }
    } catch(e) {
      updated[p.id] = '';
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  return updated;
}

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());

  // Charger le cache de photos API-Football
  let photosCache = {};
  if (fs.existsSync('photos.json')) {
    try { photosCache = JSON.parse(fs.readFileSync('photos.json', 'utf8')); }
    catch(e) { console.warn('⚠️  photos.json corrompu'); }
  }
  console.log(`📸 ${Object.keys(photosCache).length} photo(s) en cache`);

  // Chercher sur les 3 derniers jours pour ne rater aucun match
  // (le script tourne à 21h50 UTC = 23h50 FR, donc aujourd'hui est encore en cours)
  const dates = [];
  for (let i = 0; i <= 2; i++) {
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

      // Récupérer photos et passes depuis le summary
      const { photos, assists } = await fetchSummaryData(league.code, fId);
      // Fusionner photos du summary avec le cache API-Football
      const mergedPhotos = { ...photosCache, ...photos };
      const players  = extractContributions(event, league, mergedPhotos, assists);
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
    console.log('\n😴 Aucun nouveau match — vérification photos manquantes...');
    // Chercher quand même les photos manquantes pour les joueurs existants
    const existingPlayers = rebuildPlayers(stored.matches || []);
    const updatedPhotos = await fetchMissingPhotos(existingPlayers, photosCache);
    if (Object.keys(updatedPhotos).length !== Object.keys(photosCache).length ||
        JSON.stringify(updatedPhotos) !== JSON.stringify(photosCache)) {
      fs.writeFileSync('photos.json', JSON.stringify(updatedPhotos, null, 2));
      console.log('📸 photos.json mis à jour');
    }
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

  // Récupérer les photos manquantes via API-Football
  const updatedPhotos = await fetchMissingPhotos(players, photosCache);
  if (Object.keys(updatedPhotos).length !== Object.keys(photosCache).length) {
    fs.writeFileSync('photos.json', JSON.stringify(updatedPhotos, null, 2));
    console.log(`📸 photos.json mis à jour (${Object.keys(updatedPhotos).length} photos)`);
  }

  // Générer photos-index.json : ID → nom du joueur
  const photosIndex = {};
  for (const p of players) {
    if (p.id && p.name) photosIndex[p.id] = p.name;
  }
  fs.writeFileSync('photos-index.json', JSON.stringify(photosIndex, null, 2));

  // Injecter les photos dans les joueurs
  for (const p of players) {
    if (!p.photo && updatedPhotos[p.id]) p.photo = updatedPhotos[p.id];
  }

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
