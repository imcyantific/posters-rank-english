const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

async function generatePoster(tmdbId, type = 'movie', rank = null, fallbackTitle = '') {
  try {
    // 1. Fetch images explicitly requesting English or neutral/textless art
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

    // Force strictly textless poster (iso_639_1 === null) or strict English poster
    const textlessPoster = posters.find(p => p.iso_639_1 === null);
    const englishPoster = posters.find(p => p.iso_639_1 === 'en');
    const posterPath = textlessPoster?.file_path || englishPoster?.file_path || posters[0]?.file_path;

    // Force strictly English logo
    const englishLogo = logos.find(l => l.iso_639_1 === 'en');
    const logoPath = englishLogo?.file_path;

    if (!posterPath) throw new Error("Poster not found");

    // 2. Setup Canvas (600x900)
    const canvas = createCanvas(600, 900);
    const ctx = canvas.getContext('2d');

    const posterImg = await loadImage(`https://image.tmdb.org/t/p/w500${posterPath}`);
    ctx.drawImage(posterImg, 0, 0, 600, 900);

    // 3. Draw English Logo OR Fallback English Title Text
    if (logoPath) {
      const logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${logoPath}`);
      const logoWidth = 450;
      const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
      
      // Draw logo near the bottom third
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, 720 - logoHeight / 2, logoWidth, logoHeight);
    } else if (fallbackTitle && textlessPoster) {
      // If we used a textless background but no logo PNG exists, write English title text at the bottom
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 10;
      ctx.font = 'bold 36px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fallbackTitle, 300, 800, 500);
      ctx.shadowBlur = 0; // Reset shadow
    }

    // 4. Draw Rank Badge
    if (rank) {
      const badgeX = 85;
      const badgeY = 85;
      const radius = 55;

      // Dark background circle
      ctx.fillStyle = 'rgba(15, 15, 15, 0.9)';
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Red Ring
      ctx.strokeStyle = '#e50914';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Rank Text (#1, #2...)
      ctx.fillStyle = '#ffffff';
      // Fallback cross-platform font declaration
      ctx.font = '900 48px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${rank}`, badgeX, badgeY + 2);
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };