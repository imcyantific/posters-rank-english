const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Helper function to draw numbers using Canvas vector paths
function drawRankNumber(ctx, rank, x, y) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const num = parseInt(rank, 10);

  if (num === 1) {
    // Number 1
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 12);
    ctx.lineTo(x, y - 22);
    ctx.lineTo(x, y + 22);
    ctx.stroke();
  } else if (num === 2) {
    // Number 2
    ctx.beginPath();
    ctx.arc(x, y - 10, 12, Math.PI, 0, false);
    ctx.lineTo(x - 12, y + 22);
    ctx.lineTo(x + 14, y + 22);
    ctx.stroke();
  } else if (num === 3) {
    // Number 3
    ctx.beginPath();
    ctx.arc(x, y - 11, 11, Math.PI * 1.25, Math.PI * 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 10, 12, -Math.PI * 0.4, Math.PI * 0.85);
    ctx.stroke();
  } else if (num === 4) {
    // Number 4
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 22);
    ctx.lineTo(x + 6, y - 22);
    ctx.lineTo(x - 14, y + 8);
    ctx.lineTo(x + 14, y + 8);
    ctx.stroke();
  } else if (num === 5) {
    // Number 5
    ctx.beginPath();
    ctx.moveTo(x + 12, y - 20);
    ctx.lineTo(x - 10, y - 20);
    ctx.lineTo(x - 10, y - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 8, 14, -Math.PI * 0.7, Math.PI * 0.7);
    ctx.stroke();
  } else if (num === 6) {
    // Number 6
    ctx.beginPath();
    ctx.arc(x, y + 8, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 8);
    ctx.bezierCurveTo(x + 14, y - 12, x + 8, y - 22, x - 2, y - 22);
    ctx.stroke();
  } else if (num === 7) {
    // Number 7
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 20);
    ctx.lineTo(x + 14, y - 20);
    ctx.lineTo(x - 6, y + 22);
    ctx.stroke();
  } else if (num === 8) {
    // Number 8
    ctx.beginPath();
    ctx.arc(x, y - 10, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 10, 13, 0, Math.PI * 2);
    ctx.stroke();
  } else if (num === 9) {
    // Number 9
    ctx.beginPath();
    ctx.arc(x, y - 8, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 8);
    ctx.bezierCurveTo(x + 14, y + 12, x + 8, y + 22, x - 2, y + 22);
    ctx.stroke();
  } else if (num === 10) {
    // Number 10
    const x1 = x - 12;
    const x0 = x + 12;
    
    // Draw 1
    ctx.beginPath();
    ctx.moveTo(x1 - 6, y - 10);
    ctx.lineTo(x1, y - 18);
    ctx.lineTo(x1, y + 18);
    ctx.stroke();

    // Draw 0
    ctx.beginPath();
    ctx.arc(x0, y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
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

    // Overlay English Logo
    if (logoPath) {
      const logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${logoPath}`);
      const logoWidth = 450;
      const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, 720 - logoHeight / 2, logoWidth, logoHeight);
    }

    // Draw Rank Badge
    if (rank) {
      const badgeX = 85;
      const badgeY = 85;
      const radius = 55;

      // Dark circle background
      ctx.fillStyle = 'rgba(15, 15, 15, 0.9)';
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Red border ring
      ctx.strokeStyle = '#e50914';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Vector-drawn white number
      drawRankNumber(ctx, rank, badgeX, badgeY);
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };