#!/usr/bin/env node
// Generate data.json for visor-dual — scrapes agenda + team data

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = __dirname;
const DATA_DIR = join(REPO_DIR, '..', 'dashboard');

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

async function main() {
  // ── Load team data ──
  let teamData = {};
  const koPath = join(DATA_DIR, 'data_ko.json');
  if (existsSync(koPath)) {
    try {
      teamData = JSON.parse(readFileSync(koPath, 'utf-8')).teams || {};
      console.log(`[gen] Cargados ${Object.keys(teamData).length} equipos`);
    } catch (e) {
      console.error('[gen] Error leyendo data_ko.json:', e.message);
    }
  } else {
    console.warn('[gen] data_ko.json no encontrado en', koPath);
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
    const time = timeMatch ? timeMatch[1].trim() : '';
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

    matches.push({
      category, competition, homeTeam, awayTeam, time, title,
      channels, homeData, awayData,
    });
  }

  console.log(`[gen] ${matches.length} partidos encontrados`);
  console.log(`[gen] Canales totales: ${matches.reduce((s, m) => s + m.channels.length, 0)}`);

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
