require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { generatePoster, generateBackdrop } = require('./poster');
const { determineTag } = require('./tags');

const app = express();
app.use(cors());

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const HOST_URL = process.env.HOST_URL || `http://localhost:${process.env.PORT || 3000}`;

// Bump this whenever you redesign the images, so apps fetch fresh copies.
const IMG_VERSION = 19;

// true  = use the IMDb id (tt1234567) when TMDB knows it, like Cinemeta does.
// false = always use tmdb:<id>.
const USE_IMDB_IDS = true;

const tmdb = {
  headers: TMDB_API_KEY.startsWith('ey') ? { Authorization: `Bearer ${TMDB_API_KEY}` } : {},
  params: TMDB_API_KEY.startsWith('ey') ? {} : { api_key: TMDB_API_KEY }
};

async function fetchDetails(tmdbType, tmdbId) {
  const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}`, {
    headers: tmdb.headers,
    params: { ...tmdb.params, append_to_response: 'external_ids,images', include_image_language: 'en,null' }
  });
  return data;
}

// ---------- Metadata for the hero banner (type • genre • year) ----------
function yearOf(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : '';
}

// "2023-" for running shows, "2011-2014" for ended ones, "2024" for movies
function buildReleaseInfo(details, tmdbType) {
  const start = yearOf(details.release_date || details.first_air_date);
  if (!start) return '';
  if (tmdbType !== 'tv') return start;
  const ended = details.status === 'Ended' || details.status === 'Canceled';
  const end = yearOf(details.last_air_date);
  if (ended && end && end !== start) return `${start}-${end}`;
  if (ended) return start;
  return `${start}-`;
}

function pickLogo(details) {
  const best = (details.images?.logos || [])
    .filter(l => l.iso_639_1 === 'en' || l.iso_639_1 === null)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
  return best ? `https://image.tmdb.org/t/p/w500${best.file_path}` : undefined;
}

async function buildMeta(item, index, type, tmdbType, landscape) {
  let details = item; // fallback if the details call fails
  try {
    details = await fetchDetails(tmdbType, item.id);
  } catch (e) {
    console.error(`Details failed for ${item.id}:`, e.message);
  }

  const tag = determineTag(details, tmdbType);
  const imdbId = details.external_ids?.imdb_id || details.imdb_id;
  const genres = (details.genres || []).map(g => g.name);
  const year = yearOf(details.release_date || details.first_air_date);

  const endpoint = landscape ? 'render-backdrop' : 'render-poster';
  const imageUrl = `${HOST_URL}/${endpoint}?type=${tmdbType}&tmdbId=${item.id}&rank=${index + 1}&tag=${encodeURIComponent(tag)}&v=${IMG_VERSION}`;
  const meta = {
    id: USE_IMDB_IDS && imdbId ? imdbId : `tmdb:${item.id}`,
    type,
    name: item.title || item.name,
    poster: imageUrl,
    posterShape: landscape ? 'landscape' : 'poster',
    genres,
    // Newer Stremio-style genre list (some apps read this instead of "genres")
    links: genres.map(g => ({ name: g, category: 'Genres', url: `stremio:///search?search=${encodeURIComponent(g)}` })),
    releaseInfo: buildReleaseInfo(details, tmdbType),
    year,
    released: details.release_date || details.first_air_date || undefined,
    description: details.overview || item.overview || '',
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
  };

  // Landscape cards in Nuvio are drawn from "background", not "poster", so in the
  // landscape catalogs point background at our rendered image (rank + logo + pill).
  // In the normal catalogs, background stays the plain TMDB backdrop for the hero banner.
  if (landscape) meta.background = imageUrl;
  else if (details.backdrop_path) meta.background = `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`;
  const logo = pickLogo(details);
  if (logo) meta.logo = logo;
  return meta;
}

// Redirect root URL to manifest.json
app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

// 1. Stremio Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.english.posters.rank',
    version: '1.1.0',
    name: 'Top 10 Today (English Posters)',
    description: 'Top 10 Movies & TV Shows with original TMDB posters, rank numbers and status tags',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [
      { id: 'top10_movies', type: 'movie', name: 'Top 10 Movies Today' },
      { id: 'top10_series', type: 'series', name: 'Top 10 TV Shows Today' },
      { id: 'top10_movies_landscape', type: 'movie', name: 'Top 10 Movies Today (Landscape)' },
      { id: 'top10_series_landscape', type: 'series', name: 'Top 10 TV Shows Today (Landscape)' }
    ]
  });
});

// 2. Catalog Endpoint (poster + landscape variants)
app.get('/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const tmdbType = type === 'series' ? 'tv' : 'movie';
  const landscape = id.endsWith('_landscape');

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/trending/${tmdbType}/day`, {
      headers: tmdb.headers,
      params: tmdb.params
    });

    const items = response.data.results.slice(0, 10);
    const metas = await Promise.all(
      items.map((item, index) => buildMeta(item, index, type, tmdbType, landscape))
    );

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    res.json({ metas });
  } catch (err) {
    console.error('Error fetching catalog:', err.message);
    res.status(500).json({ metas: [] });
  }
});

function sendImage(res, buffer) {
  if (buffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } else {
    res.setHeader('Cache-Control', 'no-store'); // never let apps cache a failure
    res.status(404).send('Image generation failed');
  }
}

// 3. Dynamic Poster Rendering Route (tall)
app.get('/render-poster', async (req, res) => {
  const { tmdbId, type, rank, tag } = req.query;
  sendImage(res, await generatePoster(tmdbId, type, rank, tag));
});

// 4. Dynamic Backdrop Rendering Route (wide)
app.get('/render-backdrop', async (req, res) => {
  const { tmdbId, type, rank, tag } = req.query;
  sendImage(res, await generateBackdrop(tmdbId, type, rank, tag));
});

// 5. Poster Provider Endpoint (IMDb / TMDB id -> poster with status tag)
app.get('/poster/:id.jpg', async (req, res) => {
  const { id } = req.params;
  let tmdbId = id;
  let type = 'movie';

  try {
    if (id.startsWith('tt')) {
      const findRes = await axios.get(
        `https://api.themoviedb.org/3/find/${id}?external_source=imdb_id`,
        { headers: tmdb.headers, params: tmdb.params }
      );
      const movieMatch = findRes.data.movie_results?.[0];
      const tvMatch = findRes.data.tv_results?.[0];

      if (movieMatch) { tmdbId = movieMatch.id; type = 'movie'; }
      else if (tvMatch) { tmdbId = tvMatch.id; type = 'tv'; }
      else return res.status(404).send('Media not found');
    } else {
      try {
        await axios.get(`https://api.themoviedb.org/3/movie/${id}`, { headers: tmdb.headers, params: tmdb.params });
        type = 'movie';
      } catch (e) {
        type = 'tv';
      }
    }

    // Full details are needed for Premiere / Finale / New Episode tags
    const details = await fetchDetails(type, tmdbId);
    const tag = determineTag(details, type);
    sendImage(res, await generatePoster(tmdbId, type, null, tag));
  } catch (err) {
    console.error('Poster Provider Error:', err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = app;