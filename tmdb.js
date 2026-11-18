// Shared TMDB helpers used by index.js and poster.js.
const http = require('http');
const https = require('https');
const axios = require('axios');
const { loadImage } = require('@napi-rs/canvas');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// The long "Read Access Token" (starts with ey) goes in a header, the short API key in the URL.
const auth = TMDB_API_KEY.startsWith('ey')
  ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` }, params: {} }
  : { headers: {}, params: { api_key: TMDB_API_KEY } };

// Keep connections to TMDB open between requests, so we don't redo the secure
// handshake (~100-300 ms) on every call.
const agents = {
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 32 })
};

async function tmdbGet(path, params = {}, timeout = 10000) {
  const { data } = await axios.get(`https://api.themoviedb.org/3${path}`, {
    ...agents,
    timeout,
    headers: auth.headers,
    params: { ...auth.params, ...params }
  });
  return data;
}

// Download an image with a time limit (so a stuck download can't hang a render).
async function fetchImage(url, timeout = 8000) {
  const { data } = await axios.get(url, { ...agents, timeout, responseType: 'arraybuffer' });
  return loadImage(Buffer.from(data));
}

// Small in-memory cache with a time limit. It also shares one request between callers
// asking for the same thing at the same time. Lives only while the server is warm.
function memo(fn, ttlMs, maxSize = 500) {
  const cache = new Map(); // key -> { at, promise }
  return (key, ...args) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    if (cache.size >= maxSize) cache.delete(cache.keys().next().value); // drop the oldest
    const promise = fn(...args);
    const entry = { at: Date.now(), promise };
    cache.set(key, entry);
    promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); }); // never remember failures
    return promise;
  };
}

// "Best image first", by a vote-weighted score: each image counts as if it also had
// VOTE_WEIGHT extra votes of VOTE_START stars. An image with only a few votes therefore
// stays near 3, while one with many votes keeps close to its real rating. So 6.7 stars
// from 6 people no longer beats 6.2 stars from 81 people (The Odyssey).
// VOTE_START is 3 because on TMDB one single "like" shows as 3.3 stars and no votes as
// 0: a liked image then beats an unvoted one, and an unvoted one beats a disliked one.
// Ties: more votes, then the sharpest.
const VOTE_WEIGHT = 10;
const VOTE_START = 3;
const score = i => {
  const v = i.vote_count || 0;
  return (v * (i.vote_average || 0) + VOTE_WEIGHT * VOTE_START) / (v + VOTE_WEIGHT);
};
const byBest = (a, b) =>
  score(b) - score(a) ||
  (b.vote_count || 0) - (a.vote_count || 0) ||
  (b.width || 0) - (a.width || 0);

// TMDB's own main image for a title (the one ticked "Primary" on the website) goes
// first in its group, ahead of the score order. Only reorders; never adds an image
// that was filtered out (blurry or in POSTER_SKIP).
function primaryFirst(list, primaryPath) {
  const i = primaryPath ? list.findIndex(x => x.file_path === primaryPath) : -1;
  return i > 0 ? [list[i], ...list.slice(0, i), ...list.slice(i + 1)] : list;
}

// POSTER_SKIP: TMDB images to never use, e.g. a foreign poster marked "No Language".
// Comma-separated file names as TMDB shows them: /b5Z2OHgLWYq84YaYeJTBdXILaIx.jpg
// Works instantly, while a fix on TMDB itself can take a day to reach apps.
const SKIP = new Set(String(process.env.POSTER_SKIP || '').split(',')
  .map(s => s.trim().replace(/^.*\//, '')).filter(Boolean).map(s => `/${s}`));

// Leave out skipped images, and low-resolution uploads (they look blurry) unless
// that's all there is.
function sharpFirst(list, minWidth) {
  list = list.filter(i => !SKIP.has(i.file_path));
  const sharp = list.filter(i => !i.width || i.width >= minWidth);
  return sharp.length ? sharp : list;
}

// Logo preference: English, then language-neutral, then any other (e.g. the original
// Japanese logo for anime). SVGs are skipped because the canvas can't draw them.
function rankLogos(logos) {
  const usable = sharpFirst((logos || []).filter(l => l.file_path && !l.file_path.endsWith('.svg')), 300);
  return [
    ...usable.filter(l => l.iso_639_1 === 'en').sort(byBest),
    ...usable.filter(l => !l.iso_639_1).sort(byBest),
    ...usable.filter(l => l.iso_639_1 && l.iso_639_1 !== 'en').sort(byBest)
  ];
}

module.exports = { auth, tmdbGet, fetchImage, memo, byBest, primaryFirst, sharpFirst, rankLogos };
