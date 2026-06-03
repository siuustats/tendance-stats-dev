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

    // Passes décisives — clé = scorerId_goalIndex pour gérer plusieurs buts du même joueur
    const assists = {}; // { "scorerId_goalIndex": { name, id } }
    const goalCount = {}; // compteur de buts par joueur pour l'index

    for (const event of (data.keyEvents || [])) {
      if (!event.scoringPlay) continue;
      const typeStr = (event.type?.type || event.type?.text || '').toLowerCase();
      if (!typeStr.includes('goal') && typeStr !== 'goal') continue;
      const participants = event.participants || [];
      const scorer   = participants[0]?.athlete;
      const assister = participants[1]?.athlete;
      if (!scorer?.id) continue;
      const sid = String(scorer.id);
      goalCount[sid] = (goalCount[sid] || 0) + 1;
      if (assister?.id) {
        const key = sid + '_' + goalCount[sid];
        assists[key] = { id: String(assister.id), name: assister.displayName };
        console.log(`  🎯 ${scorer.displayName} ← ${assister.displayName}`);
      }
    }

    // Passes décisives — source 2 : comp.details (si keyEvents incomplets)
    const comp = data.header?.competitions?.[0] || data.competitions?.[0];
    const goalCount2 = {};
    for (const detail of (comp?.details || data.drives?.previous || [])) {
      if (!detail.scoringPlay) continue;
      if (detail.ownGoal) continue;
      const involved = detail.athletesInvolved || [];
      const scorer   = involved[0];
      const assister = involved[1];
      if (!scorer?.id) continue;
      const sid = String(scorer.id);
      goalCount2[sid] = (goalCount2[sid] || 0) + 1;
      const key = sid + '_' + goalCount2[sid];
      if (assister?.id && !assists[key]) {
        assists[key] = { id: String(assister.id), name: assister.displayName || assister.shortName };
        console.log(`  🎯 [details] ${scorer.displayName} ← ${assister.displayName}`);
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

    // Passeur décisif — chercher la passe correspondant à CE but précis
    const goalIdx = goalsMap[pid] || 1; // goalsMap[pid] vient d'être incrémenté
    const assisterInfo = assists[pid + '_' + goalIdx];
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
    // Priorité : ligue domestique > info par défaut
    // La ligue européenne est stockée dans allLeagueIds mais n'est PAS la ligue principale
    const eurMatch = data.matches.find(m => EUR_IDS.has(m.leagueId));
    let leagueInfo = data.champInfo || info;

    // Construire allLeagueIds : ligue principale + ligues européennes jouées
    const allLeagueIds = new Set([leagueInfo.leagueId]);
    if (eurMatch) {
      data.matches.forEach(m => { if (EUR_IDS.has(m.leagueId)) allLeagueIds.add(m.leagueId); });
    }
    players.push({ ...buildEntry(info, data.matches, leagueInfo), allLeagueIds: [...allLeagueIds] });
  }

  // ── Joueurs CDM (leagueId: 6) — entrées distinctes ───────────────
  for (const [, data] of Object.entries(cdm)) {
    const info = data.info;
    if (!info?.name) continue;
    players.push(buildEntry(info, data.matches, info));
  }

  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}


// ── Génération pages joueurs statiques (SEO) ─────────────────────────────────

// espnId  = ID ESPN du joueur (pour matcher playerMap depuis data.json)
// nation  = sélection nationale CDM (seule info non disponible via ESPN clubs)
// slug    = URL de la page statique
const STAR_PLAYERS = [
  // La Liga
  { espnId: '231388', nation: 'France',       slug: 'kylian-mbappe'        },
  { espnId: '291281', nation: 'Angleterre',   slug: 'jude-bellingham'      },
  { espnId: '235818', nation: 'Uruguay',      slug: 'federico-valverde'    },
  { espnId: '362150', nation: 'Espagne',      slug: 'lamine-yamal'         },
  { espnId: '250465', nation: 'Espagne',      slug: 'pedri'                },
  { espnId: '231050', nation: 'Brésil',       slug: 'raphinha'             },
  { espnId: '323702', nation: 'Espagne',      slug: 'gavi'                 },
  { espnId: '140416', nation: 'France',       slug: 'antoine-griezmann'    },
  { espnId: '312146', nation: 'Espagne',      slug: 'nico-williams'        },
  // Premier League
  { espnId: '173896', nation: 'Égypte',       slug: 'mohamed-salah'        },
  { espnId: '253989', nation: 'Norvège',      slug: 'erling-haaland'       },
  { espnId: '280555', nation: 'Angleterre',   slug: 'bukayo-saka'          },
  { espnId: '198825', nation: 'Angleterre',   slug: 'ollie-watkins'        },
  { espnId: '296395', nation: 'Angleterre',   slug: 'cole-palmer'          },
  { espnId: '235662', nation: 'Suède',        slug: 'alexander-isak'       },
  { espnId: '250787', nation: 'Angleterre',   slug: 'phil-foden'           },
  { espnId: '174980', nation: 'Belgique',     slug: 'leandro-trossard'     },
  { espnId: '283672', nation: 'Belgique',     slug: 'jeremy-doku'          },
  { espnId: '238262', nation: 'Angleterre',   slug: 'declan-rice'          },
  { espnId: '124091', nation: 'Portugal',     slug: 'bruno-fernandes'      },
  { espnId: '231182', nation: 'Allemagne',    slug: 'kai-havertz'          },
  { espnId: '298008', nation: 'France',       slug: 'rayan-cherki'         },
  { espnId: '303748', nation: 'Allemagne',    slug: 'florian-wirtz'        },
  { espnId: '149981', nation: 'Suisse',       slug: 'granit-xhaka'         },
  { espnId: '249524', nation: 'Pays-Bas',     slug: 'cody-gakpo'           },
  // Ligue 1
  { espnId: '328238', nation: 'France',       slug: 'bradley-barcola'      },
  { espnId: '229744', nation: 'France',       slug: 'ousmane-dembele'      },
  { espnId: '345581', nation: 'France',       slug: 'warren-zaire-emery'   },
  { espnId: '286831', nation: 'France',       slug: 'michael-olise'        },
  { espnId: '240233', nation: 'Maroc',        slug: 'achraf-hakimi'        },
  // Bundesliga
  { espnId: '303821', nation: 'Allemagne',    slug: 'jamal-musiala'        },
  { espnId: '190161', nation: 'Allemagne',    slug: 'joshua-kimmich'       },
  { espnId: '170257', nation: 'Allemagne',    slug: 'niclas-fullkrug'      },
  { espnId: '188052', nation: 'Allemagne',    slug: 'jonathan-tah'         },
  { espnId: '220703', nation: 'Algérie',      slug: 'ramy-bensebaini'      },
  // Serie A
  { espnId: '217331', nation: 'France',       slug: 'marcus-thuram'        },
  { espnId: '204441', nation: 'Italie',       slug: 'nicolo-barella'       },
  { espnId: '134947', nation: 'Belgique',     slug: 'kevin-de-bruyne'      },
  { espnId: '235677', nation: 'Serbie',       slug: 'dusan-vlahovic'       },
  { espnId: '309273', nation: 'Danemark',     slug: 'rasmus-hojlund'       },
  { espnId: '76762',  nation: 'Croatie',      slug: 'luka-modric'          },
  // Hors top 5 / non trouvés dans data.json mais connus
  { espnId: '154446', nation: 'Espagne',      slug: 'alvaro-morata'        },
];

function generatePlayerPages(players, photosCache) {
  const fs = require('fs');
  if (!fs.existsSync('players')) fs.mkdirSync('players');

  // Lire photos.json depuis le disque pour avoir TOUTES les photos à jour
  let allPhotos = { ...photosCache };
  try {
    const diskPhotos = JSON.parse(fs.readFileSync('photos.json', 'utf8'));
    allPhotos = { ...allPhotos, ...diskPhotos };
  } catch(e) {}

  const playerMap = {};
  for (const p of players) playerMap[String(p.id)] = p;

  // Badges ligue identiques à index.html
  const LEAGUE_STYLES = {
    'pl':   { bg:'rgba(88,28,200,.25)',   color:'#a78bfa' },
    'l1':   { bg:'rgba(0,80,179,.25)',    color:'#60a5fa' },
    'liga': { bg:'rgba(200,150,0,.25)',   color:'#fbbf24' },
    'sa':   { bg:'rgba(0,100,60,.25)',    color:'#34d399' },
    'bl':   { bg:'rgba(180,30,30,.25)',   color:'#f87171' },
    'cl':   { bg:'rgba(0,20,120,.35)',    color:'#818cf8' },
    'el':   { bg:'rgba(200,80,0,.25)',    color:'#fb923c' },
    'ecl':  { bg:'rgba(0,150,80,.25)',    color:'#6ee7b7' },
  };



  let generated = 0;

  for (const star of STAR_PLAYERS) {
    const p = playerMap[String(star.espnId)];
    if (!p?.name) { console.log('  ⏭️  ' + star.slug + ' — non trouvé dans data.json'); continue; }

    const rawPhoto    = allPhotos[String(star.espnId)] || allPhotos[star.espnId] || p.photo || '';
    // Les photos locales (scrapées Sofascore) ont un chemin relatif "photos/xxx.png"
    // Depuis /players/, il faut remonter d'un niveau → "../photos/xxx.png"
    const photo = rawPhoto.startsWith('photos/') ? '../' + rawPhoto : rawPhoto;
    const goals       = p.totalGoals   || 0;
    const assists     = p.totalAssists || 0;
    const games       = p.totalGames   || 0;
    const avg         = p.avg          || 0;
    const signal      = p.signal       || 0;
    const last5       = p.last5        || [];
    const playerName  = p.name;
    const teamName    = p.teamName     || '';
    const leagueName  = p.leagueName   || '';
    const leagueLabel = p.leagueLabel  || '';
    const leagueCls   = p.leagueCls    || '';
    const allLeagueIds = p.allLeagueIds || [p.leagueId];

    // Badge ligue domestique
    const lgStyle   = LEAGUE_STYLES[leagueCls] || { bg:'rgba(0,229,160,.1)', color:'#00e5a0' };

    // Badges coupes européennes
    const EUR_MAP = { 7:'cl', 5:'el', 20296:'ecl' };
    const EUR_LABEL = { 7:'LDC', 5:'EL', 20296:'ECL' };
    const eurBadges = allLeagueIds
      .filter(id => EUR_MAP[id])
      .map(id => {
        const cls = EUR_MAP[id];
        const st  = LEAGUE_STYLES[cls];
        return `<span class="badge" style="background:${st.bg};color:${st.color}">${EUR_LABEL[id]}</span>`;
      }).join('');

    // Forme récente
    const signalColor = signal > 75 ? '#ff9f43' : signal > 55 ? '#00e5a0' : '#5e81f4';
    const formDots = last5.slice(0,5).map(m => {
      if (m.played === null || m.played === undefined) return '<span class="fd ab">❌</span>';
      if (m.played === false) return '<span class="fd b">🪑</span>';
      const won = m.teamWon;
      const label = won === true ? 'V' : won === false ? 'D' : 'N';
      const bg    = won === true ? 'rgba(0,229,160,.15)' : won === false ? 'rgba(255,80,80,.15)' : 'rgba(30,34,48,.5)';
      const color = won === true ? '#00e5a0' : won === false ? '#ff5050' : '#9ca3af';
      const bord  = won === true ? 'rgba(0,229,160,.25)' : won === false ? 'rgba(255,80,80,.25)' : '#1e2130';
      return `<span style="background:${bg};color:${color};border:1px solid ${bord};width:26px;height:26px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:monospace">${label}</span>`;
    }).join(' ');

    // Nation → lien vers squad.html
    // Normaliser les noms de pays ESPN (anglais) vers le français
    const NATION_EN_TO_FR = {
      'France':'France','Brazil':'Brésil','England':'Angleterre','Uruguay':'Uruguay',
      'Spain':'Espagne','Egypt':'Égypte','Norway':'Norvège','Sweden':'Suède',
      'Belgium':'Belgique','South Korea':'Corée du Sud','Germany':'Allemagne',
      'Switzerland':'Suisse','Nigeria':'Nigeria','Morocco':'Maroc','Italy':'Italie',
      'Argentina':'Argentine','Portugal':'Portugal','Croatia':'Croatie',
      'Netherlands':'Pays-Bas','Denmark':'Danemark','Serbia':'Serbie',
      'Algeria':'Algérie','Austria':'Autriche','Colombia':'Colombie',
      'Mexico':'Mexique','Japan':'Japon','Senegal':'Sénégal','Ghana':'Ghana',
      'Australia':'Australie','Ecuador':'Équateur','Iran':'Iran',
      'Canada':'Canada','Wales':'Pays de Galles','Scotland':'Écosse',
      'Tunisia':'Tunisie','Cameroon':'Cameroun','Costa Rica':'Costa Rica',
      'Saudi Arabia':'Arabie Saoudite','Poland':'Pologne','United States':'États-Unis',
      'Republic of Ireland':'Irlande','Czech Republic':'Tchéquie',
      'South Africa':'Afrique du Sud','Panama':'Panama','Iraq':'Irak',
      'Jordan':'Jordanie','Uzbekistan':'Ouzbékistan','DR Congo':'RD Congo',
      'Cape Verde':'Cap-Vert','New Zealand':'Nouvelle-Zélande','Curacao':'Curaçao',
      "Ivory Coast":"Côte d'Ivoire",'Haiti':'Haïti','Paraguay':'Paraguay',
      'Turkey':'Turquie',
    };
    const nationFr = NATION_EN_TO_FR[star.nation] || star.nation;

    const NATION_IDS = {
      'France':'478','Brésil':'205','Angleterre':'448','Uruguay':'212','Espagne':'164',
      'Égypte':'2620','Norvège':'464','Suède':'466','Belgique':'459','Corée du Sud':'451',
      'Allemagne':'481','Suisse':'475','Nigeria':'2548','Maroc':'2869','Italie':'473',
      'Argentine':'202','Portugal':'482','Croatie':'477','Pays-Bas':'449',
      'Danemark':'451','Serbie':'475','Algérie':'624','Autriche':'474',
      'Colombie':'208','Mexique':'203','Japon':'627','Sénégal':'654',
      'Ghana':'4469','Australie':'628','Équateur':'209','Iran':'469',
      'Canada':'206','Écosse':'580','Tunisie':'659','États-Unis':'660',
      'Arabie Saoudite':'655','Panama':'2659','Irak':'4375','Jordanie':'2917',
      'Ouzbékistan':'2570','RD Congo':'2850','Cap-Vert':'2597',
      "Nouvelle-Zélande":'2666',"Côte d'Ivoire":'4789','Haïti':'2654',
      'Paraguay':'210','Turquie':'465','Bosnie-Herzégovine':'452',
      'Afrique du Sud':'467','Curaçao':'11678','Qatar':'4398','Tchéquie':'450',
    };
    const NATION_ARTICLES = {
      'France':'la','Brésil':'le','Angleterre':"l'",'Uruguay':"l'",'Espagne':"l'",
      'Égypte':"l'",'Norvège':'la','Suède':'la','Belgique':'la','Corée du Sud':'la',
      'Allemagne':"l'",'Suisse':'la','Nigeria':'le','Maroc':'le','Italie':"l'",
      'Argentine':"l'",'Portugal':'le','Croatie':'la','Pays-Bas':'les',
      'Danemark':'le','Serbie':'la','Algérie':"l'",'Autriche':"l'",
      'Colombie':'la','Mexique':'le','Japon':'le','Sénégal':'le',
      'Ghana':'le','Australie':"l'",'Équateur':"l'",'Iran':"l'",
      'Canada':'le','Écosse':"l'",'Tunisie':'la','États-Unis':'les',
      'Arabie Saoudite':"l'",'Panama':'le','Irak':"l'",'Jordanie':'la',
      'Ouzbékistan':"l'",'RD Congo':'la','Cap-Vert':'le',
      'Nouvelle-Zélande':'la',"Côte d'Ivoire":"la",'Haïti':'Haïti',
      'Paraguay':'le','Turquie':'la','Qatar':'le','Tchéquie':'la',
      'Bosnie-Herzégovine':'la','Afrique du Sud':"l'",'Curaçao':'le',
    };
    const nationArticle = NATION_ARTICLES[nationFr] || 'la';
    const nationId  = NATION_IDS[nationFr];
    const nationDisplay = nationId
      ? `<a href="../squad.html?team=${nationId}" style="color:#9ca3af;text-decoration:underline;text-underline-offset:3px">${nationFr}</a>`
      : `<span style="color:#9ca3af">${nationFr}</span>`;
    // Pas d'espace après "l'"
    const nationLink = nationArticle.endsWith("'") ? nationArticle + nationDisplay : nationArticle + ' ' + nationDisplay;

    // Précalculer le tableau JS des joueurs pour le script related côté client
    const allPlayersData = STAR_PLAYERS
      .filter(s => playerMap[String(s.espnId)]?.name)
      .map(s => {
        const rp  = playerMap[String(s.espnId)];
        const raw = allPhotos[String(s.espnId)] || rp?.photo || '';
        const ph  = raw.startsWith('photos/') ? '../' + raw : raw;
        return { slug: s.slug, espnId: s.espnId, name: rp.name, team: rp.teamName || '', photo: ph, signal: rp.signal || 0 };
      });
    // Échapper les caractères qui pourraient casser le template HTML
    const allPlayersJson = JSON.stringify(allPlayersData)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const description = `Stats ${playerName} 2026 — ${goals} buts, ${assists} passes, TendScore ${signal} | ${star.nation} · ${teamName} | Tendance & prédictions CDM 2026`;



    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${playerName} — Stats & Tendance 2026 | TendanceStats</title>
<meta name="description" content="${description}">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${playerName} — Stats & Tendance 2026 | TendanceStats">
<meta property="og:description" content="${description}">
<meta property="og:image" content="https://tendancestats.com/logo.png">
<meta property="og:url" content="https://tendancestats.com/players/${star.slug}.html">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://tendancestats.com/players/${star.slug}.html">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#080a0f;color:#f0f2f8;min-height:100vh}
.topnav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:rgba(8,10,15,.9);backdrop-filter:blur(12px);border-bottom:1px solid #1e2130}
.nav-back{font-size:12px;letter-spacing:2px;color:#9ca3af;text-decoration:none}
.nav-back:hover{color:#00e5a0}
.nav-logo{font-family:'Bebas Neue',sans-serif;font-size:18px;color:#00e5a0;letter-spacing:3px;text-decoration:none;position:absolute;left:50%;transform:translateX(-50%)}
.wrap{max-width:900px;margin:0 auto;padding:0 24px}
.hero{padding:90px 0 32px;text-align:center}
.avatar{width:100px;height:100px;border-radius:50%;overflow:hidden;background:#111318;border:3px solid #1e2130;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:40px}
.avatar img{width:100%;height:100%;object-fit:cover}
.pname{font-family:'Bebas Neue',sans-serif;font-size:42px;letter-spacing:3px;margin-bottom:6px}
.pteam{font-size:14px;color:#9ca3af;margin-bottom:12px}
.badges{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.badge{font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:0.5px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}
.kpi{background:#111318;border:1px solid #1e2130;border-radius:12px;padding:18px;text-align:center}
.kpi-n{font-family:'Bebas Neue',sans-serif;font-size:36px;line-height:1;margin-bottom:4px}
.kpi-l{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px}
.card{background:#111318;border:1px solid #1e2130;border-radius:14px;padding:20px;margin-bottom:16px}
.card-title{font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;color:#9ca3af;margin-bottom:14px;text-transform:uppercase}
.signal-wrap{max-width:320px;margin:10px auto 0}
.signal-row{display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:5px}
.signal-track{height:6px;background:#1e2130;border-radius:3px;overflow:hidden}
.signal-fill{height:6px;border-radius:3px;transition:width .8s ease}
.cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:24px 0}
.cta{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;transition:transform .2s,opacity .2s}
.cta:hover{transform:translateY(-2px);opacity:.9}
.navbar{position:sticky;top:0;z-index:200;background:rgba(8,10,15,0.92);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,0.06);padding:0 24px;height:54px;display:flex;align-items:center;justify-content:space-between;}
.navbar-logo{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:3px;color:#00e5a0;text-decoration:none;text-shadow:0 0 20px rgba(0,229,160,0.3);flex-shrink:0;}
.navbar-links{display:flex;align-items:center;gap:3px;background:rgba(255,255,255,0.05);border-radius:10px;padding:4px;}
.navbar-link{font-size:12px;font-weight:600;padding:6px 14px;border-radius:7px;color:rgba(255,255,255,0.45);letter-spacing:0.3px;text-decoration:none;transition:all .2s;white-space:nowrap;}
.navbar-link:hover{color:rgba(255,255,255,0.8);background:rgba(255,255,255,0.06);}
.navbar-link.gold{color:#d4a843;}
.navbar-link.gold:hover{background:rgba(212,168,67,0.12);color:#d4a843;}
.navbar-sep{width:1px;height:18px;background:rgba(255,255,255,0.1);margin:0 2px;flex-shrink:0;}
.navbar-right{display:flex;align-items:center;gap:10px;flex-shrink:0;}
@media(max-width:520px){.navbar-links{display:none;}}

.cta-primary{background:#00e5a0;color:#080a0f}
.cta-secondary{background:#111318;border:1px solid #1e2130;color:#9ca3af}
.cta-cdm{background:linear-gradient(135deg,#d4a843,#b8902a);color:#080a0f}
footer{border-top:1px solid #1e2130;padding:20px 0;text-align:center;font-size:12px;color:#6b7280;margin-top:40px}
@media(max-width:600px){.kpis{grid-template-columns:repeat(2,1fr)}.pname{font-size:30px}.cta-row{flex-direction:column;align-items:center}}
</style>
</head>
<body>
<nav class="navbar">
  <a href="../index.html" class="navbar-logo">TendanceStats</a>
  <div class="navbar-links">
    <a href="../index.html" class="navbar-link">Accueil</a>
    <a href="../predictions.html" class="navbar-link">Prédictions</a>
    <a href="../index.html#classement" class="navbar-link">Classement</a>
    <div class="navbar-sep"></div>
    <a href="../worldcup.html" class="navbar-link gold">🏆 CDM</a>
  </div>
  <div class="navbar-right"></div>
</nav>

<div class="wrap">
  <div class="hero">
    <div class="avatar">${photo ? `<img src="${photo}" referrerpolicy="no-referrer" onerror="this.outerHTML='⚽'" alt="${playerName}">` : '⚽'}</div>
    <h1 class="pname">${playerName}</h1>
    <div class="pteam">${teamName}</div>
    <div class="badges">
      ${leagueLabel ? `<span class="badge" style="background:${lgStyle.bg};color:${lgStyle.color}">${leagueLabel}</span>` : ''}
      ${eurBadges}
      <span class="badge" style="background:rgba(212,168,67,.15);color:#d4a843">🏆 CDM 2026</span>
    </div>

  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-n" style="color:#00e5a0">${goals}</div><div class="kpi-l">Buts</div></div>
    <div class="kpi"><div class="kpi-n" style="color:#5e81f4">${assists}</div><div class="kpi-l">Passes</div></div>
    <div class="kpi"><div class="kpi-n" style="color:#9ca3af">${games}</div><div class="kpi-l">Matchs</div></div>
    <div class="kpi"><div class="kpi-n" style="color:#ffd32a">${avg}</div><div class="kpi-l">Moy./match</div></div>
  </div>

  ${last5.length ? `<div class="card">
    <div class="card-title">Forme récente — 5 derniers matchs</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${formDots}</div>
  </div>` : ''}

  <div class="cta-row">
    <a href="../player.html?id=${star.espnId}&name=${encodeURIComponent(playerName)}&teamName=${encodeURIComponent(teamName)}&photo=${encodeURIComponent(photo)}" class="cta cta-primary">⚽ ${playerName}</a>
    <a href="../predictions.html" class="cta cta-secondary">🔮 Prédictions clubs</a>
    <a href="../predictions-cdm.html" class="cta cta-secondary">🔮 Prédictions CDM 2026</a>
    <a href="../worldcup.html" class="cta cta-cdm">🏆 CDM 2026</a>
  </div>

  <div class="card">
    <div class="card-title">À propos de ${playerName}</div>
    <p style="font-size:13px;color:#6b7280;line-height:1.8">
      ${playerName} représente ${nationLink} à la <strong style="color:#d4a843">Coupe du Monde 2026</strong> aux États-Unis, Canada et Mexique.
      Actuellement à <strong style="color:#9ca3af">${teamName}</strong> (${leagueName}), il totalise <strong style="color:#00e5a0">${goals} but${goals > 1 ? 's' : ''}</strong>
      et <strong style="color:#5e81f4">${assists} passe${assists > 1 ? 's' : ''} décisive${assists > 1 ? 's' : ''}</strong> cette saison,
      Suivez ses statistiques et nos prédictions pour la CDM 2026 sur TendanceStats.
    </p>
  </div>

  <div class="card" id="related-card">
    <div class="card-title">Autres joueurs à surveiller</div>
    <div id="related-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px"></div>
  </div>

  <div class="card">
    <div class="card-title">Visitez aussi</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
      <a href="../worldcup.html" style="background:#161820;border:1px solid #1e2130;border-radius:10px;padding:14px;text-decoration:none;color:#f0f2f8;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(212,168,67,.4)'" onmouseout="this.style.borderColor='#1e2130'">
        <div style="font-size:20px;margin-bottom:6px">🏆</div>
        <div style="font-size:13px;font-weight:600">CDM 2026</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">Classement & tendances</div>
      </a>
      <a href="../predictions-cdm.html" style="background:#161820;border:1px solid #1e2130;border-radius:10px;padding:14px;text-decoration:none;color:#f0f2f8;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(212,168,67,.4)'" onmouseout="this.style.borderColor='#1e2130'">
        <div style="font-size:20px;margin-bottom:6px">🔮</div>
        <div style="font-size:13px;font-weight:600">Prédictions CDM</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">Qui va briller ?</div>
      </a>
      <a href="../index.html" style="background:#161820;border:1px solid #1e2130;border-radius:10px;padding:14px;text-decoration:none;color:#f0f2f8;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(0,229,160,.3)'" onmouseout="this.style.borderColor='#1e2130'">
        <div style="font-size:20px;margin-bottom:6px">⚽</div>
        <div style="font-size:13px;font-weight:600">Joueurs en forme</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">5 grands championnats</div>
      </a>
      <a href="../predictions.html" style="background:#161820;border:1px solid #1e2130;border-radius:10px;padding:14px;text-decoration:none;color:#f0f2f8;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(0,229,160,.3)'" onmouseout="this.style.borderColor='#1e2130'">
        <div style="font-size:20px;margin-bottom:6px">📈</div>
        <div style="font-size:13px;font-weight:600">Prédictions clubs</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">Prochain match</div>
      </a>

    </div>
  </div>

</div>

<footer>
  <div class="wrap">
    <strong style="color:#f0f2f8">TendanceStats</strong> &nbsp;·&nbsp; Stats ${playerName} 2026 &nbsp;·&nbsp;
    <span style="color:#9ca3af">Données : sources publiques</span> &nbsp;·&nbsp;
    <a href="../index.html" style="color:#6b7280;font-size:11px;text-decoration:none">← Retour à l'accueil</a>
  </div>
</footer>
<div style="text-align:center;padding:12px 24px;font-size:11px;color:#4b5563;border-top:1px solid #111318;">© 2026 TendanceStats. Tous droits réservés.</div>
<script>
(function() {
  const CURRENT = '${star.espnId}';
  const ALL_PLAYERS = ${allPlayersJson};

  const pool = ALL_PLAYERS.filter(p => p.espnId !== CURRENT && p.name);
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const pick = pool.slice(0, 3);

  const grid = document.getElementById('related-grid');
  if (!grid) return;
  grid.innerHTML = pick.map(function(p) {
    var avatar = p.photo
      ? '<img src="' + p.photo + '" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer" onerror="this.style.display=&quot;none&quot;">'
      : '⚽';
    return '<a href="' + p.slug + '.html"'
      + ' style="background:#161820;border:1px solid #1e2130;border-radius:12px;padding:14px;text-decoration:none;color:#f0f2f8;display:flex;align-items:center;gap:10px">'
      + '<div style="width:38px;height:38px;border-radius:50%;overflow:hidden;background:#111318;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px">'
      + avatar
      + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + p.name + '</div>'
      + '<div style="font-size:11px;color:#6b7280">' + p.team + '</div>'
      + '</div>'
      + '</a>';
  }).join('');
})();
</script>
</body>
</html>`;

    fs.writeFileSync(`players/${star.slug}.html`, html);
    generated++;
  }
  console.log(`\n📄 ${generated} pages joueurs générées dans /players/`);
}


// ── Génération sitemap.xml automatique ───────────────────────────────────────

function generateSitemap(starPlayers, playerMap) {
  const today = new Date().toISOString().slice(0, 10);

  const staticPages = [
    { url: 'https://tendancestats.com/',                    priority: '1.0', freq: 'daily'  },
    { url: 'https://tendancestats.com/index.html',          priority: '1.0', freq: 'daily'  },
    { url: 'https://tendancestats.com/worldcup.html',       priority: '0.9', freq: 'daily'  },
    { url: 'https://tendancestats.com/predictions.html',    priority: '0.9', freq: 'daily'  },
    { url: 'https://tendancestats.com/predictions-cdm.html',priority: '0.9', freq: 'daily'  },
    { url: 'https://tendancestats.com/stats-saison-2026.html', priority: '0.8', freq: 'daily' },
    { url: 'https://tendancestats.com/stats-cdm-2026.html', priority: '0.8', freq: 'daily'  },
    { url: 'https://tendancestats.com/squad.html',          priority: '0.7', freq: 'weekly' },
    { url: 'https://tendancestats.com/player.html',         priority: '0.6', freq: 'daily'  },
    { url: 'https://tendancestats.com/player-cdm.html',     priority: '0.6', freq: 'daily'  },
  ];

  // Pages joueurs statiques — uniquement ceux présents dans data.json
  const playerPages = [];
  for (const star of starPlayers) {
    const p = playerMap[String(star.espnId)];
    if (!p?.name) continue; // skip si pas dans data.json
    playerPages.push({
      url: `https://tendancestats.com/players/${star.slug}.html`,
      priority: '0.8',
      freq: 'daily',
    });
  }

  const allPages = [...staticPages, ...playerPages];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  require('fs').writeFileSync('sitemap.xml', xml);
  console.log(`\n🗺️  sitemap.xml généré — ${allPages.length} URLs (${playerPages.length} pages joueurs)`);
}

// ── Récupération photos joueurs CDM via rosters ESPN ─────────────────────────

const CDM_TEAM_IDS = [
  '203','467','451','450',    // Groupe A
  '206','452','4398','475',   // Groupe B
  '205','2869','2654','580',  // Groupe C
  '660','210','628','465',    // Groupe D
  '481','11678','4789','209', // Groupe E
  '449','627','466','659',    // Groupe F
  '459','2620','469','2666',  // Groupe G
  '164','2597','655','212',   // Groupe H
  '478','654','4375','464',   // Groupe I
  '202','624','474','2917',   // Groupe J
  '482','2850','2570','208',  // Groupe K
  '448','477','4469','2659',  // Groupe L
];

// CDM_TEAM_NAMES : ID ESPN → nom de l'équipe nationale
const CDM_TEAM_NAMES = {
  '203':'Mexique','467':'Afrique du Sud','451':'Corée du Sud','450':'Tchéquie',
  '206':'Canada','452':'Bosnie-Herzégovine','4398':'Qatar','475':'Suisse',
  '205':'Brésil','2869':'Maroc','2654':'Haïti','580':'Écosse',
  '660':'États-Unis','210':'Paraguay','628':'Australie','465':'Turquie',
  '481':'Allemagne','11678':'Curaçao','4789':"Côte d'Ivoire",'209':'Équateur',
  '449':'Pays-Bas','627':'Japon','466':'Suède','659':'Tunisie',
  '459':'Belgique','2620':'Égypte','469':'Iran','2666':'Nouvelle-Zélande',
  '164':'Espagne','2597':'Cap-Vert','655':'Arabie Saoudite','212':'Uruguay',
  '478':'France','654':'Sénégal','4375':'Irak','464':'Norvège',
  '202':'Argentine','624':'Algérie','474':'Autriche','2917':'Jordanie',
  '482':'Portugal','2850':'RD Congo','2570':'Ouzbékistan','208':'Colombie',
  '448':'Angleterre','477':'Croatie','4469':'Ghana','2659':'Panama',
};
const CDM_TEAM_FLAGS = {
  '203':'mx','467':'za','451':'kr','450':'cz','206':'ca','452':'ba',
  '4398':'qa','475':'ch','205':'br','2869':'ma','2654':'ht','580':'gb-sct',
  '660':'us','210':'py','628':'au','465':'tr','481':'de','11678':'cw',
  '4789':'ci','209':'ec','449':'nl','627':'jp','466':'se','659':'tn',
  '459':'be','2620':'eg','469':'ir','2666':'nz','164':'es','2597':'cv',
  '655':'sa','212':'uy','478':'fr','654':'sn','4375':'iq','464':'no',
  '202':'ar','624':'dz','474':'at','2917':'jo','482':'pt','2850':'cd',
  '2570':'uz','208':'co','448':'gb-eng','477':'hr','4469':'gh','2659':'pa',
};

async function syncCDMRosters(stored, photosCache) {
  // Vérifier si on doit recharger les rosters (toutes les 48h)
  const lastSync   = stored.cdmRosterSyncAt ? new Date(stored.cdmRosterSyncAt) : null;
  const hoursSince = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : 999;
  const needSync   = hoursSince >= 48;

  if (!needSync) {
    console.log(`\n⏭️  Rosters CDM OK (dernière sync: ${Math.round(hoursSince)}h)`);
    return { photosCache, cdmPlayers: (stored.players || []).filter(p => p.leagueId === 6) };
  }

  // Ne pas marquer de joueurs "absent" avant le début de la CDM (11 juin 2026)
  const cdmStartDate = new Date('2026-06-11');
  const cdmStarted   = new Date() >= cdmStartDate;

  console.log(`\n🌍 Sync rosters CDM (toutes les 48h) — CDM démarrée: ${cdmStarted}...`);
  const rosterMap = {}; // id → { id, name, teamId }
  let fetched = 0;

  for (const teamId of CDM_TEAM_IDS) {
    try {
      await new Promise(r => setTimeout(r, 400));
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${teamId}/roster`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      const athletes = data.athletes || [];
      // Log pour débug : afficher les champs disponibles sur le premier joueur
      if (fetched === 0 && athletes.length > 0) {
        const sample = athletes[0];
        console.log(`  🔍 Structure ESPN (équipe ${teamId}): ${JSON.stringify(Object.keys(sample))}`);
        if (sample.athlete) console.log(`  🔍 athlete keys: ${JSON.stringify(Object.keys(sample.athlete))}`);
        console.log(`  📊 ${athletes.length} joueurs retournés`);
      }
      if (athletes.length > 30) {
        console.log(`  ⚠️  Équipe ${CDM_TEAM_NAMES[teamId] || teamId}: ${athletes.length} joueurs (> 26 attendus)`);
      }
      for (const a of athletes) {
        const id   = String(a.athlete?.id || a.id || '');
        const name = a.athlete?.displayName || a.displayName || a.fullName || '';
        if (!id || !name) continue;
        rosterMap[id] = { id, name, teamId };
      }
      fetched++;
    } catch(e) {
      console.warn(`  ⚠️  Roster CDM ${teamId} indisponible`);
    }
  }
  console.log(`  ✅ ${fetched}/48 rosters — ${Object.keys(rosterMap).length} joueurs`);

  // Joueurs CDM actuels dans data.json
  const existingCdm = (stored.players || []).filter(p => p.leagueId === 6);
  const existingIds = new Set(existingCdm.map(p => String(p.id)));
  const rosterIds   = new Set(Object.keys(rosterMap));

  // 1. Joueurs absents du nouveau roster
  //    - Avant CDM (< 11 juin) : supprimés de data.json (juste un nettoyage ESPN)
  //    - Pendant CDM (>= 11 juin) : marqués cdmStatus:"absent" et conservés avec leurs stats
  let marked = 0, restored = 0, added = 0, removed = 0;
  const toKeep = [];
  for (const p of existingCdm) {
    if (!rosterIds.has(String(p.id))) {
      if (cdmStarted) {
        // CDM commencée → garder avec badge absent
        if (p.cdmStatus !== 'absent') { p.cdmStatus = 'absent'; marked++; }
        toKeep.push(p);
      } else {
        // Avant CDM → supprimer (ESPN nettoie ses listes)
        removed++;
      }
    } else {
      if (p.cdmStatus === 'absent') { delete p.cdmStatus; restored++; }
      toKeep.push(p);
    }
  }
  // Remplacer existingCdm par la liste nettoyée
  existingCdm.length = 0;
  existingCdm.push(...toKeep);

  // 2. Nouveaux joueurs dans le roster → ajouter avec 0 stats
  const newCdmPlayers = [];
  for (const [id, info] of Object.entries(rosterMap)) {
    if (existingIds.has(id)) continue;
    const teamName = CDM_TEAM_NAMES[info.teamId] || info.teamId;
    const flag     = CDM_TEAM_FLAGS[info.teamId]  || '';
    newCdmPlayers.push({
      id, name: info.name, teamName,
      leagueId: 6, leagueName: 'Coupe du Monde',
      leagueFlag: flag, leagueFlagAlt: flag.toUpperCase().slice(0,2),
      leagueCls: 'cdm', leagueLabel: 'CDM',
      photo: photosCache[id] || '',
      totalGoals: 0, totalAssists: 0, totalGames: 0, avg: 0,
      signal: 0, trendScore: 0, recent_goals: 0, recent_assists: 0,
      hot: false, last5: [],
    });
    added++;
  }

  console.log(`  ➕ ${added} nouveau(x) | ❌ ${marked} absent(s) | ✅ ${restored} réintégré(s) | 🗑️  ${removed} supprimé(s)`);

  // 3. Chercher photos manquantes via Transfermarkt
  const allCdm = [...existingCdm, ...newCdmPlayers];
  const photosMissing = allCdm.filter(p => !photosCache[p.id] && p.cdmStatus !== 'absent');
  let updatedPhotos = photosCache;
  if (photosMissing.length > 0) {
    updatedPhotos = await fetchMissingPhotos(photosMissing, photosCache);
  }

  // Injecter photos dans les nouveaux joueurs
  for (const p of newCdmPlayers) {
    if (!p.photo && updatedPhotos[p.id]) p.photo = updatedPhotos[p.id];
  }

  return {
    photosCache: updatedPhotos,
    cdmPlayers:  allCdm,
    newCdmPlayers,
    syncAt:      new Date().toISOString(),
  };
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
      // Blacklist : ESPN_ID → TM_ID incorrect à rejeter
      const TM_BLACKLIST = {
        '357719': '607223', // Rayan (Bournemouth) ≠ Rayan Cherki
      };

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
          const candidate = exact?.id || results[0]?.id;
          // Rejeter si l'ID est dans la blacklist pour ce joueur ESPN
          const espnId = String(p.id);
          if (candidate && TM_BLACKLIST[espnId] === String(candidate)) {
            console.log(`  ⛔ Photo blacklistée pour ${p.name} (TM ${candidate})`);
          } else {
            playerId = candidate;
          }
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

  const minDays = hasBadEurMatches ? 21 : 14; // fenêtre normale
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
  const LEAGUE_MAX = { 17: 400, 34: 400, 8: 400, 23: 400, 35: 400 }; // PL, L1, Liga, SA, BL
  const DEFAULT_MAX = 120; // LDC, EL, ECL, CDM
  const trimmed = [];
  for (const [leagueId, lm] of Object.entries(byLeague)) {
    lm.sort((a, b) => new Date(b.date) - new Date(a.date));
    const max = LEAGUE_MAX[parseInt(leagueId)] || DEFAULT_MAX;
    trimmed.push(...lm.slice(0, max));
  }

  const players = rebuildPlayers(trimmed);

  // Sync rosters CDM (toutes les 48h) : ajout/retrait joueurs + photos
  const cdmSync = await syncCDMRosters(stored, photosCache);
  let updatedPhotos = await fetchMissingPhotos(players, cdmSync.photosCache);

  // Fusionner joueurs CDM dans la liste (les joueurs clubs ont déjà leurs stats via rebuildPlayers)
  const clubIds = new Set(players.map(p => String(p.id)));
  const cdmOnly = (cdmSync.cdmPlayers || []).filter(p => !clubIds.has(String(p.id)));
  players.push(...cdmOnly);

  if (JSON.stringify(updatedPhotos) !== JSON.stringify(photosCache)) {
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
    updatedAt:          new Date().toISOString(),
    cdmRosterSyncAt:    cdmSync.syncAt || stored.cdmRosterSyncAt || null,
    totalMatches:       trimmed.length,
    totalPlayers:       players.length,
    totalRequests:      LEAGUES.length,
    newMatchesToday:    newMatches.length,
    matches:            trimmed,
    players,
    fixtures,
  }));

  // Générer les pages joueurs statiques pour le SEO
  generatePlayerPages(players, updatedPhotos);

  // Générer le sitemap.xml avec toutes les pages
  const starPlayerMap = {};
  for (const p of players) starPlayerMap[String(p.id)] = p;
  generateSitemap(STAR_PLAYERS, starPlayerMap);

  console.log(`\n✅ ${newMatches.length} match(s) | ${players.length} joueurs | ${LEAGUES.length} requêtes ESPN`);
  if (players.length > 0) console.log(`🏆 Top : ${players[0].name} (trend: ${players[0].trendScore})`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
