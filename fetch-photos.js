// fetch-photos.js — Script one-shot pour récupérer les photos depuis API-Football
// A lancer UNE SEULE FOIS pour générer photos.json
// node fetch-photos.js

const fs = require('fs');

const API_KEY  = '3e9f54e72603755f88994308302b2207';
const DATA_FILE  = 'data.json';
const PHOTOS_FILE = 'photos.json';

// Charger les joueurs existants depuis data.json
function loadPlayers() {
  if (!fs.existsSync(DATA_FILE)) { console.error('❌ data.json introuvable'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return data.players || [];
}

// Charger les photos existantes
function loadPhotos() {
  if (fs.existsSync(PHOTOS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf8')); }
    catch(e) {}
  }
  return {};
}

// Rechercher un joueur sur API-Football par nom
async function searchPlayer(name) {
  const url = `https://v3.football.api-sports.io/players?search=${encodeURIComponent(name)}&season=2024`;
  const res = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY,
      'x-rapidapi-host': 'v3.football.api-sports.io'
    }
  });
  if (!res.ok) { console.warn(`  ⚠️  HTTP ${res.status} pour ${name}`); return null; }
  const data = await res.json();
  const results = data.response || [];
  if (!results.length) return null;
  // Prendre le premier résultat
  return results[0]?.player?.photo || null;
}

async function main() {
  console.log('🚀 Récupération des photos...');
  const players = loadPlayers();
  const photos  = loadPhotos();

  console.log(`📋 ${players.length} joueur(s) à traiter`);

  let updated = 0;
  for (const p of players) {
    const espnId = p.id;
    // Sauter si déjà une photo ESPN valide ou déjà dans photos.json
    if (photos[espnId]) { console.log(`  ⏭️  ${p.name} — déjà en cache`); continue; }

    console.log(`  🔍 Recherche: ${p.name}`);
    const photo = await searchPlayer(p.name);

    if (photo) {
      photos[espnId] = photo;
      console.log(`  ✅ ${p.name} → ${photo}`);
      updated++;
    } else {
      console.log(`  ❌ ${p.name} — pas trouvé`);
    }

    // Respecter le rate limit API-Football (10 req/min sur plan gratuit)
    await new Promise(r => setTimeout(r, 6500));
  }

  fs.writeFileSync(PHOTOS_FILE, JSON.stringify(photos, null, 2));
  console.log(`\n✅ ${updated} nouvelle(s) photo(s) | Total: ${Object.keys(photos).length}`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
