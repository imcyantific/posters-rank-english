// IMDb and Rotten Tomatoes scores, from MDBList (TMDB only has its own rating).
//
// MDBLIST_API_KEY: free key from https://mdblist.com/preferences (API Key). Without it,
// posters just show the TMDB rating like before.
//
// The free plan allows about 1000 lookups a day, so each title's scores are kept for
// RATINGS_CACHE_DAYS (default 3) and saved to CACHE_DIR/ratings.json, so a restart
// doesn't look them all up again. If MDBList says the day's limit is used up, we stop
// asking until it resets and draw the posters with the scores we have.
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const KEY = process.env.MDBLIST_API_KEY || '';
const BASE = process.env.MDBLIST_BASE || 'https://api.mdblist.com';
const DAY = 86400000;
const KEEP_MS = Math.max(0.5, Number(process.env.RATINGS_CACHE_DAYS) || 3) * DAY;
const RETRY_MS = 6 * 3600000; // a failed or empty lookup is tried again after 6 hours
const FILE = process.env.CACHE_DIR ? path.join(process.env.CACHE_DIR, 'ratings.json') : null;

// "movie:550" -> { at, imdb: '8.4' | null, rt: 79 | null }
const cache = new Map();
const inFlight = new Map();
let pausedUntil = 0;

try {
  if (FILE && fs.existsSync(FILE)) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) cache.set(k, v);
  }
} catch (e) {
  console.error('Ratings cache unreadable, starting fresh:', e.message);
}

let saveTimer = null;
function saveSoon() {
  if (!FILE || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const now = Date.now();
    const keep = {};
    for (const [k, v] of cache) if (now - v.at < KEEP_MS) keep[k] = v;
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.promises.writeFile(tmp, JSON.stringify(keep))
      .then(() => fs.promises.rename(tmp, FILE))
      .catch(e => console.error('Ratings cache save failed:', e.message));
  }, 5000);
  saveTimer.unref?.();
}

function parse(data) {
  const find = src => (data?.ratings || []).find(r => r.source === src);
  const imdb = find('imdb');
  const rt = find('tomatoes');
  return {
    imdb: imdb && Number(imdb.value) > 0 ? Number(imdb.value).toFixed(1) : null,
    rt: rt && rt.value !== null && rt.value !== undefined && Number(rt.value) >= 0 ? Math.round(Number(rt.value)) : null
  };
}

async function lookup(tmdbType, tmdbId, cacheKey) {
  const kind = tmdbType === 'tv' ? 'show' : 'movie';
  try {
    const { data } = await axios.get(`${BASE}/tmdb/${kind}/${tmdbId}`, { params: { apikey: KEY }, timeout: 6000 });
    const out = { at: Date.now(), ...parse(data) };
    cache.set(cacheKey, out);
    saveSoon();
    return out;
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) {
      const reset = Number(e.response.headers?.['x-ratelimit-reset']) * 1000;
      pausedUntil = reset > Date.now() ? reset : Date.now() + 3600000;
      console.error('MDBList daily limit reached; IMDb/RT scores paused until', new Date(pausedUntil).toISOString());
    } else if (status === 401 || status === 403) {
      pausedUntil = Date.now() + 3600000;
      console.error('MDBList refused the key (check MDBLIST_API_KEY):', e.response?.data?.error || status);
    } else if (status === 404) {
      // MDBList doesn't know this title: remember that, so we don't keep asking
      const out = { at: Date.now() - KEEP_MS + RETRY_MS, imdb: null, rt: null };
      cache.set(cacheKey, out);
      saveSoon();
      return out;
    } else {
      console.error(`MDBList lookup failed for ${cacheKey}:`, e.message);
    }
    return cache.get(cacheKey) || null; // an older copy is better than nothing
  }
}

// -> { imdb: '7.5' | null, rt: 85 | null }, or null when there's no key / no data.
async function getExtRatings(tmdbType, tmdbId) {
  if (!KEY || !tmdbId) return null;
  const cacheKey = `${tmdbType === 'tv' ? 'tv' : 'movie'}:${tmdbId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit;
  if (Date.now() < pausedUntil) return hit || null;
  if (!inFlight.has(cacheKey)) {
    inFlight.set(cacheKey, lookup(tmdbType, tmdbId, cacheKey).finally(() => inFlight.delete(cacheKey)));
  }
  return inFlight.get(cacheKey);
}

module.exports = { getExtRatings, hasRatingsKey: () => !!KEY };
