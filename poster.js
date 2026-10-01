const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Vector SVG paths for number glyphs (1-9, 0)
const NUMBER_PATHS = {
  1: 'M15 15 L35 0 L35 90 L10 90 L10 75 L20 75 L20 15 Z',
  2: 'M10 25 C10 8 45 8 45 25 C45 45 10 65 10 90 L50 90 L50 75 L25 75 L45 50 C50 40 50 20 40 10 C30 0 10 5 10 25 Z',
  3: 'M10 15 L45 15 L25 40 C40 40 50 50 50 65 C50 82 35 90 10 90 L10 75 C25 75 35 70 35 62 C35 52 25 50 10 50 L10 35 L25 25 L10 25 Z',
  4: 'M35 10 L10 55 L35 55 L35 90 L50 90 L50 55 L55 55 L55 40 L50 40 L50 10 Z M35 25 L35 40 L22 40 Z',
  5: 'M45 10 L10 10 L10 40 C20 35 35 35 45 42 C50 50 50 70 40 82 C30 90 15 90 10 80 L10 65 C20 75 35 75 35 65 C35 55 25 52 10 52 L10 25 L45 25 Z',
  6: 'M35 10 C20 10 10 25 10 50 C10 70 20 90 35 90 C50 90 50 65 40 50 C30 40 20 45 20 50 C20 40 25 22 35 22 Z M30 62 C38 62 38 78 30 78 C22 78 22 62 30 62 Z',
  7: 'M10 10 L50 10 L25 90 L10 90 L32 25 L10 25 Z',
  8: 'M30 10 C18 10 12 22 18 36 C10 48 8 70 20 86 C30 94 45 92 50 80 C55 68 48 50 40 40 C48 30 42 10 30 10 Z M28 22 C34 22 34 32 28 32 C22 32 22 22 28 22 Z M30 52 C38 52 38 78 30 78 C22 78 22 52 30 52 Z',
  9: 'M25 90 C40 90 50 75 50 50 C50 30 40 10 25 10 C10 10 10 35 20 50 C30 60 40 55 40 50 C40 60 35 78 25 78 Z M30 38 C22 38 22 22 30 22 C38 22 38 38 30 38 Z',
  0: 'M30 10 C12 10 10 32 10 50 C10 68 12 90 30 90 C48 90 50 68 50 50 C50 32 48 10 30 10 Z M30 24 C35 24 35 40 35 50 C35 60 35 76 30 76 C25 76 25 60 25 50 C25 40 25 24 30 24 Z'
};

async function createRankSvgOverlay(rank) {
  const num = parseInt(rank, 10);
  const isTen = num === 10;
  const width = isTen ? 140 : 85;
  const height = 110;

  let pathSvg = '';
  if (isTen) {
    pathSvg = `
      <path d="${NUMBER_PATHS[1]}" fill="#ffffff" transform="translate(5, 5) scale(0.95)" />
      <path d="${NUMBER_PATHS[0]}" fill="#ffffff" transform="translate(65, 5) scale(0.95)" />
    `;
  } else {
    pathSvg = `<path d="${NUMBER_PATHS[num]}" fill="#ffffff" transform="translate(12, 5) scale(1.05)" />`;
  }

  const svgString = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0.55)" rx="6" />
      <g filter="drop-shadow(2px 2px 3px rgba(0,0,0,0.8))">
        ${pathSvg}
      </g>
    </svg>
  `;

  const svgBase64 = Buffer.from(svgString).toString('base64');
  return await loadImage(`data:image/svg+xml;base64,${svgBase64}`);
}

async function generatePoster(tmdbId, type = 'movie', rank = null, fallbackTitle = '') {
  try {
    const imagesRes = await axios.get(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/images?include_image_language=en,null`,
      { 
        headers: TMDB_API_KEY.startsWith('ey') 
          ? { Authorization: `Bearer ${TMDB_API_KEY}` } 
          : {},
        params: !TMDB_API_KEY.startsWith('ey') ? { api_key: TMDB_API_KEY } : {}
      }
    );

    const posters = imagesRes.data.posters || [];
    const logos = imagesRes.data.logos || [];

    const textlessPoster = posters.find(p => p.iso_639_1 === null);
    const englishPoster = posters.find(p => p.iso_639_1 === 'en');
    const posterPath = textlessPoster?.file_path || englishPoster?.file_path || posters[0]?.file_path;

    const englishLogo = logos.find(l => l.iso_639_1 === 'en');
    const logoPath = englishLogo?.file_path;

    if (!posterPath) throw new Error("Poster not found");

    const canvas = createCanvas(600, 900);
    const ctx = canvas.getContext('2d');

    const posterImg = await loadImage(`https://image.tmdb.org/t/p/w500${posterPath}`);
    ctx.drawImage(posterImg, 0, 0, 600, 900);

    // 1. Overlay English Logo
    if (logoPath) {
      const logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${logoPath}`);
      const logoWidth = 450;
      const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, 720 - logoHeight / 2, logoWidth, logoHeight);
    }

    // 2. Overlay Pure Vector SVG Rank Number
    if (rank) {
      const rankSvgImage = await createRankSvgOverlay(rank);
      ctx.drawImage(rankSvgImage, 0, 0);
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };