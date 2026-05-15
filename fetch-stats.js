// fetch-stats.js — Tendance Stats
// Source : ESPN hidden API (gratuite, sans clé, sans Apify)
// 6 requêtes/soir, 0 coût

const fs = require('fs');
const DATA_FILE = 'data.json';

const LEAGUES = [
  { code: 'eng.1',         id: 17, name: 'Premier League',      flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { code: 'fra.1',         id: 34, name: 'Ligue 1',             flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { code: 'esp.1',         id: 8,  name: 'La Liga',             flag: 'es',     flagAlt: 'ES', cls: 'liga', label: 'Liga' },
  { code: 'ita.1',         id: 23, name: 'Serie A',             flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { code: 'ger.1',         id: 35, name: 'Bundesliga',          flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
  { code: 'uefa.champions',id: 7,  name: 'Ligue des Champions', flag: 'eu',     flagAlt: 'CL', cls: 'cl',  label: 'LDC'  },
  { code: 'uefa.europa',      id: 5,     name: 'Europa League',        flag: 'eu', flagAlt: 'EL',  cls: 'el',  label: 'EL'   },
  { code: 'uefa.europa.conf', id: 20296, name: 'Conference League',    flag: 'eu', flagAlt: 'ECL', cls: 'ecl', label: 'ECL'  },
  { code: 'fifa.world',       id: 6,     name: 'Coupe du Monde',        flag: 'eu', flagAlt: 'CDM', cls: 'cl',  label: 'CDM'  },
];

// ── Calculs ───────────────────────────────────────────────────────────────────

function calcTrendScore(last5) {
  if (!last5?.length) return 0;

  // Poids décroissants : match récent (i=0) pèse 5x plus que le 5ème (i=4)
  const WEIGHTS = [1.0, 0.8, 0.6, 0.4, 0.2];

  let score = 0;
  last5.forEach((m, i) => {
    const w = WEIGHTS[i] ?? 0.2;
    if (!m.played) {
      // Non joué (blessure/suspension) → pénalité légère
      score -= 0.3 * w;
    } else if (m.goals === 0 && m.assists === 0) {
      // Joué sans contribution → pénalité
      score -= 0.4 * w;
    } else {
      // Contribution pondérée par récence (but > passe)
      score += (m.goals * 1.0 + m.assists * 1.0) * w;
    }
    // Bonus victoire pondéré par récence
    if (m.teamWon) score += 0.3 * w;
  });

  return parseFloat(Math.max(0, score).toFixed(2));
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

const TEAM_FIX = {
  'Brighton & Hove Albion': 'Brighton',
  'Internazionale':         'Inter Milan',
  'Liverpool FC':           'Liverpool',
  'Manchester City FC':     'Manchester City',
  'Arsenal FC':             'Arsenal',
  'Chelsea FC':             'Chelsea',
  'Tottenham Hotspur':      'Tottenham',
  'Newcastle United':       'Newcastle United',
  'Aston Villa FC':         'Aston Villa',
  'West Ham United':        'West Ham United',
  'Nottingham Forest':      'Nottingham Forest',
  'Paris Saint-Germain':    'Paris Saint-Germain',
  'Atletico de Madrid':     'Atletico Madrid',
  'Athletic Club':          'Athletic Bilbao',
};
async function fetchFixtures() {
  const fixtures = [];
  const today = new Date();
  const dates = [];
  for (let i = 0; i <= 10; i++) { // i=0 = aujourd'hui inclus
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0,10).replace(/-/g,''));
  }

  for (const league of LEAGUES) {
    if (league.id === 6) continue; // CDM gérée séparément
    for (const date of dates) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.code}/scoreboard?dates=${date}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        for (const event of (data.events || [])) {
          const comp       = event.competitions?.[0];
          const homeComp   = comp?.competitors?.find(c => c.homeAway === 'home');
          const awayComp   = comp?.competitors?.find(c => c.homeAway === 'away');
          const homeName   = homeComp?.team?.displayName || '?';
          const awayName   = awayComp?.team?.displayName || '?';
          fixtures.push({
            id:         event.id,
            date:       event.date,
            leagueId:   league.id,
            leagueLabel:league.label,
            leagueCls:  league.cls,
            homeTeam:   TEAM_FIX[homeName] || homeName,
            awayTeam:   TEAM_FIX[awayName] || awayName,
            homeLogo:   homeComp?.team?.logo || '',
            awayLogo:   awayComp?.team?.logo || '',
          });
        }
      } catch(e) {}
    }
  }
  console.log(`📅 ${fixtures.length} prochain(s) match(s) collecté(s)`);
  return fixtures;
}

async function fetchInjuries(leagueCode) {
  // Tente de récupérer les blessés/suspendus via ESPN injuries endpoint
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/injuries`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return {};
    const data = await res.json();
    // Retourne un map { playerId: { name, status: 'injury'|'suspension'|'other' } }
    const injuries = {};
    for (const item of (data.injuries || [])) {
      const athlete = item.athlete;
      const id = String(athlete?.id || '');
      if (!id) continue;
      const type = (item.type?.name || item.status || '').toLowerCase();
      let status = 'other';
      if (type.includes('injur') || type.includes('ill') || type.includes('day-to-day')) status = 'injury';
      if (type.includes('suspend') || type.includes('ban')) status = 'suspension';
      injuries[id] = { name: athlete?.displayName || '', status };
    }
    if (Object.keys(injuries).length) console.log(`  🏥 ${Object.keys(injuries).length} blessé(s)/suspendu(s) trouvé(s)`);
    return injuries;
  } catch(e) {
    return {};
  }
}

async function fetchSummaryData(leagueCode, eventId, injuries = {}) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${eventId}`;
  await new Promise(r => setTimeout(r, 500));
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return { photos: {}, assists: {} };
    const data = await res.json();

    // Photos + joueurs ayant joué (titulaires + remplaçants entrés) par équipe
    const photos = {};
    const playedByTeam = {}; // { teamName: [{ id, name, photo }] }
    const TEAM_FIX = { 'Brighton & Hove Albion': 'Brighton', 'Internazionale': 'Inter Milan' };

    for (const team of (data.rosters || [])) {
      const rawTeam = team.team?.displayName || team.team?.name || '';
      const fixedTeam = TEAM_FIX[rawTeam] || rawTeam;
      playedByTeam[fixedTeam] = [];

      for (const player of (team.roster || [])) {
        const id       = player.athlete?.id;
        const name     = player.athlete?.displayName || player.athlete?.shortName || '';
        const headshot = player.athlete?.headshot?.href;
        if (id && headshot) photos[id] = headshot;

        // Titulaires + remplaçants entrés → played:true
        // Remplaçants non entrés → played:false (banc)
        // Blessés/suspendus → active:false, reason = 'injury' | 'suspension' | etc.
        const hasPlayed  = player.starter === true || player.subbedIn === true;
        const onBench    = !player.starter && !player.subbedIn && player.active !== false;
        const isAbsent   = player.active === false;
        const absReason  = player.athlete?.status?.type?.name || player.reason || null;
        // Log pour debug — à garder pour identifier les champs ESPN
        if (isAbsent && name) {
          console.log(`    🏥 Absent: ${name} | active=${player.active} reason=${absReason} status=${JSON.stringify(player.athlete?.status?.type)}`);
        }
        const injuryInfo = injuries[String(id)];
        const finalAbsReason = isAbsent ? (absReason || injuryInfo?.status || 'unknown') : (injuryInfo?.status || null);
        if (id && (hasPlayed || onBench || isAbsent)) {
          playedByTeam[fixedTeam].push({
            id: String(id),
            name,
            photo: headshot || '',
            played: hasPlayed ? true : onBench ? false : null,
            absenceReason: (isAbsent || injuryInfo) ? finalAbsReason : null,
          });
        }
      }
      console.log(`  👥 ${fixedTeam} : ${playedByTeam[fixedTeam].length} joueurs ayant joué`);
    }

    // Passes décisives — source 1 : keyEvents (participants[1] = passeur)
    const assists = {}; // { scorerId: { name, id } }

    for (const event of (data.keyEvents || [])) {
      if (!event.scoringPlay) continue;
      const typeStr = (event.type?.type || event.type?.text || '').toLowerCase();
      if (!typeStr.includes('goal') && typeStr !== 'goal') continue;
      const participants = event.participants || [];
      if (participants.length >= 2) {
        const scorer   = participants[0]?.athlete;
        const assister = participants[1]?.athlete;
        if (scorer?.id && assister?.id) {
          assists[String(scorer.id)] = { id: String(assister.id), name: assister.displayName };
          console.log(`  🎯 ${scorer.displayName} ← ${assister.displayName}`);
        }
      }
    }

    // Passes décisives — source 2 : comp.details (athletesInvolved[1] = passeur)
    const comp = data.header?.competitions?.[0] || data.competitions?.[0];
    for (const detail of (comp?.details || data.drives?.previous || [])) {
      if (!detail.scoringPlay) continue;
      if (detail.ownGoal) continue;
      const involved = detail.athletesInvolved || [];
      if (involved.length >= 2) {
        const scorer   = involved[0];
        const assister = involved[1];
        if (scorer?.id && assister?.id && !assists[String(scorer.id)]) {
          assists[String(scorer.id)] = { id: String(assister.id), name: assister.displayName || assister.shortName };
          console.log(`  🎯 [details] ${scorer.displayName} ← ${assister.displayName}`);
        }
      }
    }

    console.log(`  📸 ${Object.keys(photos).length} photo(s) | 🎯 ${Object.keys(assists).length} passe(s)`);
    return { photos, assists, playedByTeam };
  } catch(e) {
    return { photos: {}, assists: {}, playedByTeam: {} };
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
    const rawTeamName = isHome ? homeComp?.team?.displayName : awayComp?.team?.displayName;
    const TEAM_FIX = { 'Brighton & Hove Albion': 'Brighton', 'Internazionale': 'Inter Milan' };
    const teamName = TEAM_FIX[rawTeamName] || rawTeamName;
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
  const pm  = {}; // joueurs club (leagueId !== 6)
  const cdm = {}; // joueurs CDM  (leagueId === 6)
  const CHAMP_IDS = new Set([17, 34, 8, 23, 35]); // PL, L1, Liga, SA, BL

  for (const match of matches) {
    for (const p of (match.players || [])) {
      // ── CDM → bucket séparé ───────────────────────────────────────
      if (p.leagueId === 6) {
        if (!cdm[p.id]) cdm[p.id] = { info: p, matches: [] };
        if (p.goals > 0 || p.assists > 0) cdm[p.id].info = p;
        else if (p.name && (!cdm[p.id].info?.name || cdm[p.id].info.goals === 0)) cdm[p.id].info = p;
        cdm[p.id].matches.push({ goals: p.goals, assists: p.assists, played: p.played, teamWon: p.teamWon, date: p.date || match.date, leagueId: 6 });
        continue;
      }
      // ── Club → bucket normal ──────────────────────────────────────
      if (!pm[p.id]) pm[p.id] = { info: p, champInfo: null, matches: [] };
      if (CHAMP_IDS.has(p.leagueId)) pm[p.id].champInfo = p;
      // Priorité aux entrées avec stats pour les infos joueur
      if (p.goals > 0 || p.assists > 0) pm[p.id].info = p;
      else if (p.name && (!pm[p.id].info?.name || pm[p.id].info.goals === 0)) pm[p.id].info = p;
      pm[p.id].matches.push({ goals: p.goals, assists: p.assists, played: p.played, teamWon: p.teamWon, date: p.date || match.date, leagueId: p.leagueId });
    }
  }

  function buildEntry(info, matches, leagueInfo) {
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last5          = matches.slice(0, 5);
    const trendScore     = calcTrendScore(last5);
    const recent_goals   = last5.reduce((s, m) => s + m.goals,   0);
    const recent_assists = last5.reduce((s, m) => s + m.assists, 0);
    const totalGoals     = matches.reduce((s, m) => s + m.goals,   0);
    const totalAssists   = matches.reduce((s, m) => s + m.assists, 0);
    return {
      id: info.id, name: info.name, photo: info.photo || '',
      teamName: info.teamName,
      leagueId: leagueInfo.leagueId, leagueName: leagueInfo.leagueName,
      leagueFlag: leagueInfo.leagueFlag, leagueFlagAlt: leagueInfo.leagueFlagAlt,
      leagueCls: leagueInfo.leagueCls, leagueLabel: leagueInfo.leagueLabel,
      totalGoals, totalAssists, totalGames: matches.length,
      avg: matches.length > 0 ? parseFloat(((totalGoals + totalAssists) / matches.length).toFixed(2)) : 0,
      recent_goals, recent_assists, trendScore,
      form: buildFormDots(last5), last5,
      signal: Math.min(98, Math.max(0, Math.round(trendScore * 13))),
      hot: trendScore > 2 && recent_goals >= 2,
    };
  }

  const players = [];

  // ── Joueurs club ──────────────────────────────────────────────────
  const EUR_IDS = new Set([7, 5, 20296]); // LDC, Europa, Conference
  for (const [, data] of Object.entries(pm)) {
    const info = data.info;
    if (!info?.name) continue;
    // Priorité : ligue européenne > ligue domestique > info par défaut
    const eurMatch = data.matches.find(m => EUR_IDS.has(m.leagueId));
    let leagueInfo;
    if (eurMatch) {
      // Reconstruire leagueInfo depuis le match européen
      const eurLeague = LEAGUES.find(l => l.id === eurMatch.leagueId);
      leagueInfo = eurLeague ? {
        leagueId: eurLeague.id, leagueName: eurLeague.name,
        leagueFlag: eurLeague.flag, leagueFlagAlt: eurLeague.flagAlt,
        leagueCls: eurLeague.cls, leagueLabel: eurLeague.label,
      } : data.champInfo || info;
    } else {
      leagueInfo = data.champInfo || info;
    }
    players.push(buildEntry(info, data.matches, leagueInfo));
  }

  // ── Joueurs CDM (leagueId: 6) — entrées distinctes ───────────────
  for (const [, data] of Object.entries(cdm)) {
    const info = data.info;
    if (!info?.name) continue;
    players.push(buildEntry(info, data.matches, info));
  }

  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── API-Football : photos des nouveaux joueurs ───────────────────────────────

async function fetchMissingPhotos(players, photosCache) {
  const TM_API = 'https://transfermarkt-api-fiqh.onrender.com';

  // Stratégie de recherche :
  // - undefined  → jamais cherché → toujours retenter
  // - ""         → déjà tenté sans succès → retenter 1x/semaine (au cas où l'API était down)
  // - "https://…" → photo en cache → ignorer
  const oneWeekAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const retrySet = new Set((photosCache.__retried_at
    ? Object.entries(photosCache.__retried_at)
        .filter(([, ts]) => ts > oneWeekAgo)
        .map(([id]) => id)
    : []));

  const missing = players.filter(p => {
    if (!p.name) return false;
    if (photosCache[p.id] === undefined) return true;          // jamais cherché
    if (photosCache[p.id] === '' && !retrySet.has(String(p.id))) return true; // échec ancien → retenter
    return false;
  });
  if (!missing.length) { console.log('✅ Toutes les photos sont en cache'); return photosCache; }

  console.log(`\n📸 Recherche de ${missing.length} photo(s) via Transfermarkt...`);
  const updated = { ...photosCache };

  // ── Wake-up ping + Test de santé ─────────────────────────────────────────
  // Fly.io se met en veille → envoyer un ping d'abord et attendre le réveil
  console.log('  🔔 Wake-up ping Transfermarkt...');
  try {
    const wakeCtrl = new AbortController();
    setTimeout(() => wakeCtrl.abort(), 3000);
    await fetch(`${TM_API}/`, { headers: { 'User-Agent': 'TendanceStats/1.0' }, signal: wakeCtrl.signal });
  } catch(e) {} // on ignore l'erreur du ping, c'est juste pour réveiller l'instance
  await new Promise(r => setTimeout(r, 55000)); // attendre 55s pour le cold start Render (peut prendre 50s+)

  let apiOk = false;
  for (const testName of ['Mbappe', 'Ronaldo', 'Messi']) {
    try {
      const tc = new AbortController();
      const tt = setTimeout(() => tc.abort(), 15000); // 15s pour le cold start
      const tr = await fetch(`${TM_API}/players/search/${testName}`,
        { headers: { 'User-Agent': 'TendanceStats/1.0' }, signal: tc.signal });
      clearTimeout(tt);
      if (tr.ok) { apiOk = true; break; }
    } catch(e) {}
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!apiOk) {
    console.log('  ❌ API Transfermarkt indisponible — photos ignorées');
    return photosCache;
  }
  console.log('  ✅ API Transfermarkt disponible');

  let consecutiveFails = 0;
  let dynamicTimeout = 6000;

  for (const p of missing) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), dynamicTimeout);

      let playerId = null;
      // Chercher uniquement par nom complet — évite les confusions (ex: "Rayan" → Rayan Cherki)
      for (const searchName of [p.name]) {
        try {
          const res = await fetch(
            `${TM_API}/players/search/${encodeURIComponent(searchName)}`,
            { headers: { 'User-Agent': 'TendanceStats/1.0' }, signal: controller.signal }
          );
          if (!res.ok) continue;
          const data = await res.json();
          // Prendre le premier résultat dont le nom correspond exactement ou partiellement
          const results = data.results || [];
          const exact = results.find(r => r.name?.toLowerCase() === searchName.toLowerCase());
          playerId = exact?.id || results[0]?.id;
          if (playerId) break;
          await new Promise(r => setTimeout(r, 300));
        } catch(e) { break; }
      }

      clearTimeout(timeout);
      if (!playerId) {
        updated[p.id] = '';
        if (!updated.__retried_at) updated.__retried_at = { ...(photosCache.__retried_at || {}) };
        updated.__retried_at[String(p.id)] = Date.now();
        consecutiveFails++;
        if (consecutiveFails >= 5) dynamicTimeout = 2000;
        continue;
      }

      consecutiveFails = 0;
      dynamicTimeout = 6000;
      await new Promise(r => setTimeout(r, 300));

      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 6000);
      try {
        const profileRes = await fetch(
          `${TM_API}/players/${playerId}/profile`,
          { headers: { 'User-Agent': 'TendanceStats/1.0' }, signal: c2.signal }
        );
        clearTimeout(t2);
        if (!profileRes.ok) { updated[p.id] = ''; continue; }
        const profile = await profileRes.json();
        const photo = profile.imageUrl;
        updated[p.id] = photo || '';
        if (photo) {
          console.log(`  ✅ ${p.name}`);
          consecutiveFails = 0;
          dynamicTimeout = 6000;
        } else {
          consecutiveFails++;
          if (consecutiveFails >= 5) dynamicTimeout = 2000;
        }
      } catch(e) {
        clearTimeout(t2);
        updated[p.id] = '';
      }
    } catch(e) {
      updated[p.id] = '';
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return updated;
}

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());

  // Charger les données existantes EN PREMIER
  const stored    = loadData();
  const storedIds = new Set((stored.matches || []).map(m => m.fixtureId));

  // IDs des matchs des 3 derniers jours → forcer re-traitement pour récupérer passes manquantes
  // Fenêtre dynamique : depuis le dernier match stocké (ou 7j par défaut) jusqu'à aujourd'hui
  const lastStoredDate = (stored.matches || [])
    .map(m => m.date?.slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop(); // date la plus récente stockée

  // Fenêtre = depuis le dernier match stocké - 1 jour, avec un minimum de 7 jours en arrière
  // Si des matchs LDC/EL/ECL sont mal stockés (<10 joueurs) → étendre à 21 jours pour les récupérer
  const EUR_IDS = new Set([7, 5, 20296]);
  const hasBadEurMatches = (stored.matches || []).some(m =>
    EUR_IDS.has(m.leagueId) && (m.players?.length || 0) < 10
  );

  const minDays = hasBadEurMatches ? 21 : 14;
  if (hasBadEurMatches) console.log(`⚠️  Matchs européens incomplets détectés → fenêtre étendue à ${minDays} jours`);

  const minDaysAgo = new Date();
  minDaysAgo.setDate(minDaysAgo.getDate() - minDays);

  const windowStart = new Date();
  if (lastStoredDate) {
    windowStart.setTime(new Date(lastStoredDate).getTime());
    windowStart.setDate(windowStart.getDate() - 1); // 1 jour de marge UTC
  } else {
    windowStart.setTime(minDaysAgo.getTime());
  }

  // Toujours couvrir au minimum minDays jours en arrière
  if (windowStart > minDaysAgo) {
    windowStart.setTime(minDaysAgo.getTime());
  }

  const recentDates = new Set();
  const cursor = new Date(windowStart);
  while (cursor <= new Date()) {
    recentDates.add(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  console.log(`📅 Fenêtre re-traitement : ${[...recentDates].join(', ')}`);

  const recentIds = new Set(
    (stored.matches || [])
      .filter(m => recentDates.has(m.date?.slice(0, 10)))
      .map(m => m.fixtureId)
  );
  // Retirer les matchs récents des storedIds pour forcer leur mise à jour
  for (const id of recentIds) storedIds.delete(id);
  if (recentIds.size) console.log(`🔄 ${recentIds.size} match(s) récent(s) forcés en re-traitement`);

  // Charger le cache de photos
  let photosCache = {};
  if (fs.existsSync('photos.json')) {
    try { photosCache = JSON.parse(fs.readFileSync('photos.json', 'utf8')); }
    catch(e) { console.warn('⚠️  photos.json corrompu'); }
  }
  console.log(`📸 ${Object.keys(photosCache).length} photo(s) en cache`);

  // Charger les joueurs connus pour conserver photos/noms
  const knownPlayers = stored.knownPlayers || {};
  if (Object.keys(knownPlayers).length) {
    console.log(`👥 ${Object.keys(knownPlayers).length} joueur(s) connus de la saison précédente`);
    for (const [id, p] of Object.entries(knownPlayers)) {
      if (!photosCache[id] && p.photo) photosCache[id] = p.photo;
    }
  }

  // Chercher sur les 3 derniers jours
  const dates = [];
  // Même fenêtre dynamique que recentDates pour le fetch ESPN
  const fetchCursor = new Date(windowStart);
  while (fetchCursor <= new Date()) {
    dates.push(fetchCursor.toISOString().slice(0, 10).replace(/-/g, ''));
    fetchCursor.setDate(fetchCursor.getDate() + 1);
  }
  console.log(`📅 Dates cibles : ${dates.join(', ')}`);
  const newMatches = [];

  for (const league of LEAGUES) {
    console.log(`\n⚽ ${league.name}`);
    const allEvents = [];
    const seenEventIds = new Set();
    for (const date of dates) {
      const evs = await fetchESPN(league.code, date);
      for (const ev of evs) {
        if (!seenEventIds.has(ev.id)) {
          seenEventIds.add(ev.id);
          allEvents.push(ev);
        }
      }
    }
    const events = allEvents;
    console.log(`  📅 ${events.length} match(s)`);
    // Récupérer les blessés/suspendus pour cette ligue
    const leagueInjuries = await fetchInjuries(league.code);

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

      // Récupérer photos, passes et joueurs ayant joué depuis le summary
      const { photos, assists, playedByTeam } = await fetchSummaryData(league.code, fId, leagueInjuries);
      const mergedPhotos = { ...photosCache, ...photos };
      const players  = extractContributions(event, league, mergedPhotos, assists);
      const contribs = players.filter(p => p.goals > 0);
      contribs.forEach(p => console.log(`     ⚽ ${p.name}: ${p.goals}B (${p.teamName})`));

      // Ajouter tous les joueurs ayant joué (starter/subbedIn), même sans stats
      const TEAM_FIX = { 'Brighton & Hove Albion': 'Brighton', 'Internazionale': 'Inter Milan' };
      const matchDate = event.date;
      const homeWon = homeScore > awayScore ? true : homeScore === awayScore ? null : false;
      const awayWon = awayScore > homeScore ? true : awayScore === homeScore ? null : false;
      const alreadyCounted = new Set(players.map(p => String(p.id)));

      for (const [teamName, teamPlayers] of Object.entries(playedByTeam)) {
        const fixedTeam = TEAM_FIX[teamName] || teamName;
        const isHome = (TEAM_FIX[homeName] || homeName) === fixedTeam;
        const teamWon = isHome ? homeWon : awayWon;

        for (const tp of teamPlayers) {
          if (alreadyCounted.has(tp.id)) continue; // déjà compté via buts/passes
          // played:true = a joué, played:false = était sur le banc sans entrer
          players.push({
            id: tp.id,
            name: tp.name,
            photo: mergedPhotos[tp.id] || tp.photo || '',
            teamName: fixedTeam,
            teamWon,
            leagueId: league.id, leagueName: league.name,
            leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
            leagueCls: league.cls, leagueLabel: league.label,
            goals: 0, assists: 0, played: tp.played !== false, date: matchDate,
          });
          alreadyCounted.add(tp.id);
        }
      }
      const noStats = players.filter(p => p.goals === 0 && p.assists === 0).length;
      if (noStats > 0) console.log(`     👟 ${noStats} joueur(s) ajouté(s) sans stats`);

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

  // Supprimer les anciennes versions des matchs re-traités avant de les rajouter
  const reProcessedIds = new Set(newMatches.filter(m => recentIds.has(m.fixtureId)).map(m => m.fixtureId));
  const existingMatches = (stored.matches || []).filter(m => !reProcessedIds.has(m.fixtureId));
  const allMatches = [...existingMatches, ...newMatches];
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

  // Collecter les prochains matchs — exclure ceux déjà joués (présents dans stored.matches)
  const playedIds = new Set(trimmed.map(m => m.fixtureId));
  const nowISO = new Date().toISOString();
  const allFixtures = await fetchFixtures();
  const fixtures = allFixtures.filter(f => !playedIds.has(f.id) && f.date > nowISO);

  fs.writeFileSync(DATA_FILE, JSON.stringify({
    updatedAt:       new Date().toISOString(),
    totalMatches:    trimmed.length,
    totalPlayers:    players.length,
    totalRequests:   LEAGUES.length,
    newMatchesToday: newMatches.length,
    matches:         trimmed,
    players,
    fixtures,
  }));

  console.log(`\n✅ ${newMatches.length} match(s) | ${players.length} joueurs | ${LEAGUES.length} requêtes ESPN`);
  if (players.length > 0) console.log(`🏆 Top : ${players[0].name} (trend: ${players[0].trendScore})`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
