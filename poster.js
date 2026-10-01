const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Generate SVG buffer for rank number to bypass OS font requirements
async function createRankSvgOverlay(rank) {
  const isTen = parseInt(rank, 10) === 10;
  const width = isTen ? 200 : 150;
  const height = 180;
  
  const svgString = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0.45)" />
      <text 
        x="${width / 2}" 
        y="125" 
        font-family="Impact, Arial Black, sans-serif" 
        font-size="140" 
        font-weight="bold" 
        fill="#ffffff" 
        text-anchor="middle"
        style="filter: drop-shadow(3px 3px 5px rgba(0,0,0,0.8));"
      >${rank}</text>
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

    // 2. Overlay SVG Rank Number (Guaranteed Vercel Compatibility)
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