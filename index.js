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
    description: "Top Movies & TV Shows with guaranteed English logos",
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
        poster: `${HOST_URL}/render-poster?type=${tmdbType}&tmdbId=${item.id}&rank=${index + 1}&tag=${encodeURIComponent(tag)}&v=12`
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

module.exports = app;