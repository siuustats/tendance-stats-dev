// fetch-photos.js — Photos via Transfermarkt API (gratuit, sans clé, sans CORS)
// node fetch-photos.js

const fs = require('fs');

const DATA_FILE   = 'data.json';
const PHOTOS_FILE = 'photos.json';

function loadPlayers() {
  if (!fs.existsSync(DATA_FILE)) { console.error('❌ data.json introuvable'); process.exit(1); }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).players || [];
}

function loadPhotos() {
  if (fs.existsSync(PHOTOS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf8')); } catch(e) {}
  }
  return {};
}

async function getTransfermarktPhoto(name) {
  try {
    // 1. Chercher le joueur par nom
    const searchUrl = `https://transfermarkt-api.fly.dev/players/search/${encodeURIComponent(name)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'TendanceStats/1.0' }
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const playerId = searchData.results?.[0]?.id;
    if (!playerId) return null;

    await new Promise(r => setTimeout(r, 500));

    // 2. Récupérer le profil avec la photo
    const profileUrl = `https://transfermarkt-api.fly.dev/players/${playerId}/profile`;
    const profileRes = await fetch(profileUrl, {
      headers: { 'User-Agent': 'TendanceStats/1.0' }
    });
    if (!profileRes.ok) return null;
    const profile = await profileRes.json();
    return profile.imageUrl || null;
  } catch(e) { return null; }
}

async function main() {
  console.log('🚀 Récupération des photos via Transfermarkt...');
  const players = loadPlayers();
  const photos  = loadPhotos();

  // Trouver les joueurs sans photo valide
  const missing = players.filter(p => {
    const photo = photos[p.id];
    return !photo || photo.includes('sofascore') || photo.includes('espncdn') || photo === '';
  });

  console.log(`📋 ${missing.length} joueur(s) à mettre à jour\n`);

  let updated = 0;
  for (const p of missing) {
    console.log(`🔍 ${p.name}`);
    const photo = await getTransfermarktPhoto(p.name);

    if (photo) {
      photos[p.id] = photo;
      console.log(`✅ ${photo}`);
      fs.writeFileSync(PHOTOS_FILE, JSON.stringify(photos, null, 2));
      updated++;
    } else {
      console.log(`❌ Pas trouvé`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  fs.writeFileSync(PHOTOS_FILE, JSON.stringify(photos, null, 2));
  console.log(`\n✅ ${updated}/${missing.length} photos mises à jour`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
