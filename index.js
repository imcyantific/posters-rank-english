require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { generatePoster } = require('./poster');

const app = express();
app.use(cors());

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const HOST_URL = process.env.HOST_URL || `http://localhost:${process.env.PORT || 3000}`;

// Helper: Determine dynamic tag (Just Added, New Season, Now Streaming, etc.)
function determineTag(item, type) {
  const releaseDateStr = item.release_date || item.first_air_date;
  if (!releaseDateStr) return 'Now Streaming';

  const releaseDate = new Date(releaseDateStr);
  const now = new Date();
  const diffDays = Math.floor((now - releaseDate) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'Coming Soon';
  } else if (diffDays >= 0 && diffDays <= 30) {
    return 'Just Added';
  } else if (type === 'tv' && diffDays <= 90) {
    return 'New Season';
  } else if (type === 'movie' && diffDays <= 60) {
    return 'In Theaters';
  }

  return 'Now Streaming';
}

// Redirect root URL to manifest.json
app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

// 1. Stremio Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: "com.english.posters.rank",
    version: "1.0.0",
    name: "Top 10 Today (English Posters)",
    description: "Top 10 Movies & TV Shows with original TMDB posters and rank numbers",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { id: "top10_movies", type: "movie", name: "Top 10 Movies Today" },
      { id: "top10_series", type: "series", name: "Top 10 TV Shows Today" }
    ]
  });
});

// 2. Catalog Endpoint
app.get('/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const tmdbType = type === 'series' ? 'tv' : 'movie';

  try {
    const tmdbUrl = `https://api.themoviedb.org/3/trending/${tmdbType}/day`;
    const response = await axios.get(tmdbUrl, {
      headers: TMDB_API_KEY.startsWith('ey') 
        ? { Authorization: `Bearer ${TMDB_API_KEY}` } 
        : {},
      params: !TMDB_API_KEY.startsWith('ey') ? { api_key: TMDB_API_KEY } : {}
    });

    const items = response.data.results.slice(0, 10);

    const metas = items.map((item, index) => {
      const tag = determineTag(item, tmdbType);

      return {
        id: `tmdb:${item.id}`,
        type: type,
        name: item.title || item.name,
        poster: `${HOST_URL}/render-poster?type=${tmdbType}&tmdbId=${item.id}&rank=${index + 1}&tag=${encodeURIComponent(tag)}&v=14`
      };
    });

    res.json({ metas });
  } catch (err) {
    console.error('Error fetching catalog:', err.message);
    res.status(500).json({ metas: [] });
  }
});

// 3. Dynamic Poster Rendering Route
app.get('/render-poster', async (req, res) => {
  const { tmdbId, type, rank, tag } = req.query;

  const imageBuffer = await generatePoster(tmdbId, type, rank, tag);

  if (imageBuffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(imageBuffer);
  } else {
    res.status(404).send('Image generation failed');
  }
});

// Poster Provider Endpoint
app.get('/poster/:id.jpg', async (req, res) => {
  const { id } = req.params;
  let tmdbId = id;
  let type = 'movie';
  let itemData = null;

  try {
    const authHeaders = TMDB_API_KEY.startsWith('ey') 
      ? { Authorization: `Bearer ${TMDB_API_KEY}` } 
      : {};
    const authParams = !TMDB_API_KEY.startsWith('ey') 
      ? { api_key: TMDB_API_KEY } 
      : {};

    // 1. Resolve IMDb ID to TMDB ID if needed
    if (id.startsWith('tt')) {
      const findRes = await axios.get(
        `https://api.themoviedb.org/3/find/${id}?external_source=imdb_id`,
        { headers: authHeaders, params: authParams }
      );

      const movieMatch = findRes.data.movie_results?.[0];
      const tvMatch = findRes.data.tv_results?.[0];

      if (movieMatch) {
        tmdbId = movieMatch.id;
        type = 'movie';
        itemData = movieMatch;
      } else if (tvMatch) {
        tmdbId = tvMatch.id;
        type = 'tv';
        itemData = tvMatch;
      } else {
        return res.status(404).send('Media not found');
      }
    } else {
      // Numerical TMDB ID fallback: fetch details
      try {
        const detailRes = await axios.get(
          `https://api.themoviedb.org/3/movie/${id}`,
          { headers: authHeaders, params: authParams }
        );
        itemData = detailRes.data;
        type = 'movie';
      } catch (e) {
        const tvDetailRes = await axios.get(
          `https://api.themoviedb.org/3/tv/${id}`,
          { headers: authHeaders, params: authParams }
        );
        itemData = tvDetailRes.data;
        type = 'tv';
      }
    }

    // 2. Dynamically determine the context-aware tag
    const dynamicTag = determineTag(itemData, type);

    // 3. Generate artwork with larger frosted pill and dynamic tag
    const imageBuffer = await generatePoster(tmdbId, type, null, dynamicTag);

    if (imageBuffer) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(imageBuffer);
    } else {
      res.status(404).send('Image generation failed');
    }
  } catch (err) {
    console.error('Poster Provider Error:', err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = app;