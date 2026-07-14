#!/usr/bin/env node
// Generate data.json for visor-dual — scrapes agenda + team data + results
// Maintains teams-data.json with auto-updated KO match history and form

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = __dirname;

const ROUND_NAMES = [
  '16avos de final',
  'Octavos de final',
  'Cuartos de final',
  'Semifinal',
  'Final',
];

// ── Team name normalization ────────────────────────
const TEAM_ALIASES = {
  'Costa de Marfil': 'Costa de Marfil', 'Noruega': 'Noruega',
  'Francia': 'Francia', 'Suecia': 'Suecia', 'Suecia ': 'Suecia',
  'México': 'México', 'Mexico': 'México', 'Ecuador': 'Ecuador',
  'Argentina': 'Argentina', 'Brasil': 'Brasil', 'Alemania': 'Alemania',
  'España': 'España', 'Inglaterra': 'Inglaterra', 'Portugal': 'Portugal',
  'Países Bajos': 'Países Bajos', 'Paises Bajos': 'Países Bajos',
  'Holanda': 'Países Bajos', 'Bélgica': 'Bélgica', 'Belgica': 'Bélgica',
  'Croacia': 'Croacia', 'Canadá': 'Canadá', 'Canada': 'Canadá',
  'EE.UU.': 'EE.UU.', 'EEUU': 'EE.UU.', 'Estados Unidos': 'EE.UU.',
  'Japón': 'Japón', 'Japon': 'Japón', 'Marruecos': 'Marruecos',
  'Senegal': 'Senegal', 'Australia': 'Australia', 'Colombia': 'Colombia',
  'Paraguay': 'Paraguay', 'Suiza': 'Suiza', 'Ghana': 'Ghana',
  'Egipto': 'Egipto', 'Cabo Verde': 'Cabo Verde', 'Argelia': 'Argelia',
  'Austria': 'Austria', 'Bosnia H.': 'Bosnia H.', 'RD Congo': 'RD Congo',
  'Sudáfrica': 'Sudáfrica', 'Sudafrica': 'Sudáfrica',
  'Corea del Sur': 'Corea del Sur', 'Rep. Checa': 'Rep. Checa',
  'República Checa': 'Rep. Checa',
  'RD del Congo': 'RD Congo',
  'R.D. Congo': 'RD Congo',
  'EE. UU.': 'EE.UU.',
  'EE.UU. ': 'EE.UU.',
  'Bosnia-Herzegovina': 'Bosnia H.',
  'Bosnia': 'Bosnia H.',
};

function b64decode(str) {
  try { return Buffer.from(str, 'base64').toString('utf-8'); }
  catch { return null; }
}

function normalizeTeam(name, teamData) {
  const clean = name.trim().replace(/\s*$/, '');
  if (teamData[clean]) return clean;
  if (TEAM_ALIASES[clean]) return TEAM_ALIASES[clean];
  for (const key of Object.keys(teamData)) {
    if (clean.includes(key) || key.includes(clean)) return key;
  }
  return null;
}

// ── Timezone conversion ────────────────────────────
function toLocalTime(timeStr) {
  if (!timeStr) return timeStr;
  const p = timeStr.split(':');
  if (p.length < 2) return timeStr;
  let h = (parseInt(p[0]) - 4 + 24) % 24;
  return `${String(h).padStart(2, '0')}:${p[1]}`;
}

// ── Match status from time ─────────────────────────
function getMatchStatus(timeStr) {
  if (!timeStr) return 'upcoming';
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const matchStart = new Date(now);
  matchStart.setHours(h, m, 0, 0);

  const diffMin = (now - matchStart) / 60000;
  if (diffMin < -15) return 'upcoming';
  if (diffMin < 0) return 'live';
  if (diffMin < 105) return 'live';
  if (diffMin < 135) return 'live';
  return 'finished';
}

// ── Team data persistence ──────────────────────────
function loadTeamData() {
  let teams = {};

  // 1. Base data (static seed)
  const basePath = join(REPO_DIR, 'teams-base.json');
  if (existsSync(basePath)) {
    try {
      teams = JSON.parse(readFileSync(basePath, 'utf-8')).teams || {};
      console.log(`[gen] Cargados ${Object.keys(teams).length} equipos base`);
    } catch (e) {
      console.error('[gen] Error leyendo teams-base.json:', e.message);
    }
  }

  // 2. Override with accumulated updates
  const dataPath = join(REPO_DIR, 'teams-data.json');
  if (existsSync(dataPath)) {
    try {
      const updates = JSON.parse(readFileSync(dataPath, 'utf-8')).teams || {};
      let updatedCount = 0;
      for (const [name, data] of Object.entries(updates)) {
        teams[name] = data;
        updatedCount++;
      }
      console.log(`[gen] ${updatedCount} equipos con datos actualizados`);
    } catch (e) {
      console.error('[gen] Error leyendo teams-data.json:', e.message);
    }
  }

  return teams;
}

function persistTeamUpdates(teams, modifiedNames) {
  if (!modifiedNames.length) return;

  const dataPath = join(REPO_DIR, 'teams-data.json');
  // Preserve existing updates for teams not modified this run
  let existing = {};
  if (existsSync(dataPath)) {
    try {
      existing = JSON.parse(readFileSync(dataPath, 'utf-8')).teams || {};
    } catch {}
  }

  for (const name of modifiedNames) {
    if (teams[name]) {
      existing[name] = teams[name];
    }
  }

  writeFileSync(dataPath, JSON.stringify({
    updated: new Date().toISOString(),
    teams: existing,
  }, null, 2));
  console.log(`[gen] teams-data.json guardado (${Object.keys(existing).length} equipos trackeados)`);
}

function formatResultChar(r) {
  if (r === 'w' || r === 'W') return 'V';
  if (r === 'l' || r === 'L') return 'D';
  return 'E';
}

function computeFormDesc(form) {
  const v = form.filter(f => f === 'V').length;
  const e = form.filter(f => f === 'E').length;
  const d = form.filter(f => f === 'D').length;
  return `${v}V ${e}E ${d}D`;
}

// ── Update team after a finished match ─────────────
function updateTeamStats(team, opponent, scoreParts, isHome, roundName) {
  if (!team) return;

  const teamScore = isHome ? parseInt(scoreParts[0]) : parseInt(scoreParts[1]);
  const oppScore = isHome ? parseInt(scoreParts[1]) : parseInt(scoreParts[0]);
  let result;
  if (teamScore > oppScore) result = 'w';
  else if (teamScore < oppScore) result = 'l';
  else result = 'd';

  // Init arrays if needed
  if (!team.ko_matches) team.ko_matches = [];
  if (!team.form) team.form = [];

  // Check if this round was already recorded
  if (team.ko_matches.some(k => k.r === roundName)) {
    console.log(`[gen]   ${roundName} ya registrado para ${team.flag || ''} ${team.best ? '' : ''}`);
    return;
  }

  const scoreStr = isHome
    ? `${teamScore}-${oppScore}`
    : `${oppScore}-${teamScore}`;

  team.ko_matches.push({
    r: roundName,
    o: opponent,
    s: scoreStr,
    res: result,
    x: null,
  });
  console.log(`[gen]   KO registrado: ${roundName} vs ${opponent} ${scoreStr} (${result})`);

  // Update form (prepend newest result)
  team.form.unshift(formatResultChar(result));
  if (team.form.length > 5) team.form = team.form.slice(0, 5);
  team.form_desc = computeFormDesc(team.form);

  // Update status based on round
  if (roundName === 'Final') {
    if (result === 'w') {
      team.status = 'Campeón';
      team.best = `Campeón (${new Date().getFullYear()})`;
    } else {
      team.status = 'Subcampeón';
    }
  } else if (result === 'l') {
    team.status = 'Eliminado';
  } else {
    team.status = 'Clasificado';
  }
}

// ── Determine current round from KO match count ────
function getRoundForTeam(team) {
  const count = (team.ko_matches || []).length;
  if (count >= ROUND_NAMES.length) return null; // already finished all rounds
  return ROUND_NAMES[count];
}

// ── Fetch score from web ───────────────────────────
async function fetchScore(homeTeam, awayTeam) {
  const q = `${encodeURIComponent(homeTeam)} ${encodeURIComponent(awayTeam)} mundial 2026 resultado`;
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const scoreRegex = new RegExp(
      `${homeTeam.substring(0,4)}[^]{0,100}?(\\d+)[–-−](\\d+)[^]{0,100}?${awayTeam.substring(0,4)}|${awayTeam.substring(0,4)}[^]{0,100}?(\\d+)[–-−](\\d+)[^]{0,100}?${homeTeam.substring(0,4)}`,
      'i'
    );
    const m = html.match(scoreRegex);
    if (m) {
      if (m[1] !== undefined && m[2] !== undefined) return `${m[1]}–${m[2]}`;
      if (m[3] !== undefined && m[4] !== undefined) return `${m[4]}–${m[3]}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  // ── Load team data ──
  let teamData = loadTeamData();
  const modifiedTeams = new Set();

  // Also load previous data.json to preserve manually-entered scores
  let prevScores = {};
  const prevPath = join(REPO_DIR, 'data.json');
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf-8'));
      for (const m of prev.matches || []) {
        if (m.score) prevScores[`${m.homeTeam}|${m.awayTeam}|${m.time}`] = m.score;
      }
      console.log(`[gen] Cargados ${Object.keys(prevScores).length} scores previos`);
    } catch {}
  }

  // ── Scrape agenda ──
  console.log('[gen] Scrapeando agenda...');
  const response = await fetch('https://futbol-libres.su/agenda/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VisorDual/2.0)' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();

  const matches = [];
  const liRegex = /<li\s+class="([^"]+)">\s*<a[^>]*>([\s\S]*?)<\/a>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/gi;
  let liMatch;

  while ((liMatch = liRegex.exec(html)) !== null) {
    const category = liMatch[1];
    const titleHtml = liMatch[2].trim();
    const channelsHtml = liMatch[3];

    const timeMatch = titleHtml.match(/<span[^>]*class="t"[^>]*>([^<]+)<\/span>/);
    const time = timeMatch ? toLocalTime(timeMatch[1].trim()) : '';
    const title = titleHtml.replace(/<span[^>]*>.*?<\/span>/g, '').trim();

    let competition = '', homeTeam = '', awayTeam = '';
    const colonIdx = title.indexOf(':');
    if (colonIdx > -1) {
      competition = title.substring(0, colonIdx).trim();
      const rest = title.substring(colonIdx + 1).trim();
      const vsIdx = rest.indexOf(' vs ');
      if (vsIdx > -1) {
        homeTeam = rest.substring(0, vsIdx).trim();
        awayTeam = rest.substring(vsIdx + 4).trim();
      } else { homeTeam = rest; }
    } else {
      const vsIdx = title.indexOf(' vs ');
      if (vsIdx > -1) {
        homeTeam = title.substring(0, vsIdx).trim();
        awayTeam = title.substring(vsIdx + 4).trim();
      }
    }

    const status = getMatchStatus(time);

    // Score: try previous data first, then fetch if finished
    let score = null;
    const scoreKey = `${homeTeam}|${awayTeam}|${time}`;
    if (prevScores[scoreKey]) {
      score = prevScores[scoreKey];
    } else if (status === 'finished') {
      console.log(`[gen] Buscando resultado: ${homeTeam} vs ${awayTeam}...`);
      score = await fetchScore(homeTeam, awayTeam);
      if (score) console.log(`[gen]   → ${score}`);
      else console.log(`[gen]   → sin resultado disponible`);
      await new Promise(r => setTimeout(r, 500));
    }

    // Parse channels
    const channels = [];
    const chanRegex = /<a\s+href="([^"]+)"[^>]*>([^<]+)<span>([^<]+)<\/span><\/a>/gi;
    let chan;
    while ((chan = chanRegex.exec(channelsHtml)) !== null) {
      const url = chan[1];
      const name = chan[2].trim();
      const quality = chan[3].trim();
      let directUrl = null;
      const rMatch = url.match(/[?&]r=([^&]+)/);
      if (rMatch) {
        directUrl = b64decode(rMatch[1]);
      }
      channels.push({ name, quality, eventosUrl: url, streamUrl: directUrl });
    }

    // Look up team data
    const homeKey = normalizeTeam(homeTeam, teamData);
    const awayKey = normalizeTeam(awayTeam, teamData);
    const homeData = homeKey ? teamData[homeKey] : null;
    const awayData = awayKey ? teamData[awayKey] : null;

    // ── Auto-update team stats for finished World Cup matches ──
    if (status === 'finished' && score && (competition === 'Copa Mundial' || category === 'FIFA')) {
      if (homeKey && homeData) {
        const round = getRoundForTeam(homeData);
        if (round) {
          const scoreParts = score.replace('–', '-').split('-').filter(Boolean);
          if (scoreParts.length === 2) {
            updateTeamStats(homeData, awayTeam, scoreParts, true, round);
            modifiedTeams.add(homeKey);
          }
        }
      }
      if (awayKey && awayData) {
        const round = getRoundForTeam(awayData);
        if (round) {
          const scoreParts = score.replace('–', '-').split('-').filter(Boolean);
          if (scoreParts.length === 2) {
            updateTeamStats(awayData, homeTeam, scoreParts, false, round);
            modifiedTeams.add(awayKey);
          }
        }
      }
    }

    matches.push({
      category, competition, homeTeam, awayTeam, time, title, status,
      score,
      channels, homeData, awayData,
    });
  }

  console.log(`[gen] ${matches.length} partidos encontrados`);
  console.log(`[gen] Canales totales: ${matches.reduce((s, m) => s + m.channels.length, 0)}`);

  // Sort by time
  matches.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // ── Persist team updates ──
  if (modifiedTeams.size > 0) {
    persistTeamUpdates(teamData, [...modifiedTeams]);
  }

  // ── Write data.json ──
  const output = {
    updated: new Date().toISOString(),
    date: new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    matches,
  };

  writeFileSync(join(REPO_DIR, 'data.json'), JSON.stringify(output, null, 2));
  console.log('[gen] data.json escrito OK');
}

main().catch(err => {
  console.error('[gen] Error:', err.message);
  process.exit(1);
});
