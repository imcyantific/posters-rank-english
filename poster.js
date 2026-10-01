const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

async function generatePoster(tmdbId, type = 'movie', rank = null) {
  try {
    // 1. Fetch poster & logos from TMDB (forcing English language)
    const imagesRes = await axios.get(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/images?include_image_language=en,null`,
      { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } }
    );

    const posters = imagesRes.data.posters;
    const logos = imagesRes.data.logos;

    // Pick best textless poster (or first available)
    const posterPath = posters.find(p => p.iso_639_1 === null)?.file_path || posters[0]?.file_path;
    // Pick STRICTLY English logo
    const englishLogoPath = logos.find(l => l.iso_639_1 === 'en')?.file_path || logos[0]?.file_path;

    if (!posterPath) throw new Error("Poster not found");

    // 2. Load Images into Canvas
    const posterImg = await loadImage(`https://image.tmdb.org/t/p/w500${posterPath}`);
    
    // Canvas setup (Standard poster dimensions: 600x900)
    const canvas = createCanvas(600, 900);
    const ctx = canvas.getContext('2d');

    // Draw base poster
    ctx.drawImage(posterImg, 0, 0, 600, 900);

    // 3. Overlay English Logo (if available)
    if (englishLogoPath) {
      const logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${englishLogoPath}`);
      const logoWidth = 450;
      const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
      
      // Position logo towards the bottom third
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, 700 - logoHeight / 2, logoWidth, logoHeight);
    }

    // 4. Draw Rank Badge (e.g., "#1")
    if (rank) {
      const badgeX = 85;  // Shift right from left edge
      const badgeY = 85;  // Shift down from top edge
      const radius = 65;  // Scaled down badge size for 600x900 canvas

      // Badge Background Circle
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Red Border Ring
      ctx.strokeStyle = '#e50914';
      ctx.lineWidth = 6;
      ctx.stroke();

      // Rank Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 55px Sans-Serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${rank}`, badgeX, badgeY);
    }
    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };