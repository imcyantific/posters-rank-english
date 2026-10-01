const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Vector drawing function for large semi-transparent rank numbers
function drawLargeRankNumber(ctx, rank) {
  ctx.save();
  
  // Style matching toptoday.llmayu.com: Light semi-transparent fill with subtle glow
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;

  const num = parseInt(rank, 10);

  // Function to draw individual digits scaled and positioned
  function drawDigit(digit, x, scale = 1.0) {
    ctx.save();
    ctx.translate(x, 180);
    ctx.scale(scale, scale);

    if (digit === 1) {
      ctx.beginPath();
      ctx.moveTo(-15, -70);
      ctx.lineTo(10, -110);
      ctx.lineTo(10, 80);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 2) {
      ctx.beginPath();
      ctx.arc(0, -50, 45, Math.PI, 0, false);
      ctx.lineTo(-45, 80);
      ctx.lineTo(50, 80);
      ctx.lineTo(50, 50);
      ctx.lineTo(-10, 50);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else if (digit === 3) {
      ctx.beginPath();
      ctx.arc(0, -45, 40, Math.PI * 1.2, Math.PI * 0.35);
      ctx.arc(5, 35, 45, -Math.PI * 0.45, Math.PI * 0.85);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 4) {
      ctx.beginPath();
      ctx.moveTo(20, 80);
      ctx.lineTo(20, -100);
      ctx.lineTo(-45, 20);
      ctx.lineTo(45, 20);
      ctx.lineTo(45, 50);
      ctx.lineTo(-15, 50);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else if (digit === 5) {
      ctx.beginPath();
      ctx.moveTo(35, -100);
      ctx.lineTo(-30, -100);
      ctx.lineTo(-35, -15);
      ctx.arc(5, 25, 50, -Math.PI * 0.6, Math.PI * 0.75);
      ctx.lineTo(-30, -15);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 6) {
      // Fixed upright 6
      ctx.beginPath();
      ctx.arc(0, 30, 45, 0, Math.PI * 2);
      ctx.moveTo(42, 10);
      ctx.bezierCurveTo(35, -60, -10, -105, -35, -100);
      ctx.bezierCurveTo(-15, -100, 25, -40, -42, 20);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 7) {
      ctx.beginPath();
      ctx.moveTo(-45, -100);
      ctx.lineTo(45, -100);
      ctx.lineTo(-15, 80);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 8) {
      ctx.beginPath();
      ctx.arc(0, -40, 38, 0, Math.PI * 2);
      ctx.arc(0, 32, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 9) {
      ctx.beginPath();
      ctx.arc(0, -35, 45, 0, Math.PI * 2);
      ctx.moveTo(-42, -15);
      ctx.bezierCurveTo(-35, 55, 10, 100, 35, 95);
      ctx.stroke();
      ctx.fill();
    } else if (digit === 0) {
      ctx.beginPath();
      ctx.arc(0, -10, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }

    ctx.restore();
  }

  // Draw digits based on rank number
  if (num === 10) {
    // Proportional twin placement for 10
    drawDigit(1, 80, 0.95);
    drawDigit(0, 175, 0.95);
  } else {
    drawDigit(num, 90, 1.3);
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

    // Draw Large Semi-transparent Overlay Number (toptoday style)
    if (rank) {
      drawLargeRankNumber(ctx, rank);
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };