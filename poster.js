const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// Two layouts: tall poster and wide backdrop. Everything else is shared.
const LAYOUTS = {
  poster:   { W: 600, H: 900, rankFont: 220, rankX: 20, rankY: 0, pillH: 74, pillFont: 38, pillR: 22 },
  backdrop: { W: 960, H: 540, rankFont: 150, rankX: 30, rankY: 8, pillH: 74, pillFont: 40, pillR: 22 }
};

// Inter SemiBold = pill text. Bebas Neue = rank numbers.
try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'Inter-SemiBold.ttf'), 'Inter');
  GlobalFonts.registerFromPath(path.join(__dirname, 'BebasNeue-Regular.ttf'), 'BebasNeue');
} catch (e) {
  console.log('Font registration error:', e.message);
}

const auth = TMDB_API_KEY.startsWith('ey')
  ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` }, params: {} }
  : { headers: {}, params: { api_key: TMDB_API_KEY } };

const byVotes = (a, b) => (b.vote_average || 0) - (a.vote_average || 0);

async function getImages(type, tmdbId) {
  const { data } = await axios.get(
    `https://api.themoviedb.org/3/${type}/${tmdbId}/images`,
    { ...auth, params: { ...auth.params, include_image_language: 'en,null' } }
  );
  return data;
}

// Original TMDB poster: best English one, then textless, then any, then default.
async function getPosterPath(type, tmdbId) {
  const data = await getImages(type, tmdbId);
  const posters = data.posters || [];
  const english = posters.filter(p => p.iso_639_1 === 'en').sort(byVotes);
  const textless = posters.filter(p => p.iso_639_1 === null).sort(byVotes);
  const found = (english[0] || textless[0] || posters[0])?.file_path;
  if (found) return found;

  const { data: details } = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}`, auth);
  return details.poster_path;
}

// Backdrop: if the title has an English logo, use a textless backdrop and draw
// the logo on top (looks like a landscape poster). Otherwise use a backdrop
// that already has text, then any backdrop.
async function getBackdropAssets(type, tmdbId) {
  const data = await getImages(type, tmdbId);
  const backdrops = data.backdrops || [];
  const logos = (data.logos || []).filter(l => l.iso_639_1 === 'en').sort(byVotes);
  const textless = backdrops.filter(b => b.iso_639_1 === null).sort(byVotes);
  const english = backdrops.filter(b => b.iso_639_1 === 'en').sort(byVotes);
  const any = [...backdrops].sort(byVotes);

  let backdropPath = null;
  let logoPath = null;

  if (logos[0] && (textless[0] || any[0])) {
    backdropPath = (textless[0] || any[0]).file_path;
    logoPath = logos[0].file_path;
  } else {
    backdropPath = (english[0] || textless[0] || any[0])?.file_path || null;
  }

  if (!backdropPath) {
    const { data: details } = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}`, auth);
    backdropPath = details.backdrop_path;
  }
  return { backdropPath, logoPath };
}

function roundedTopRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Blur the pixels ALREADY on the canvas under the pill (downscale -> upscale).
function blurRegion(srcCanvas, L, x, y, w, h, pad = 40, shrink = 10) {
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(L.W - sx, w + pad * 2);
  const sh = Math.min(L.H - sy, h + pad * 2);

  const small = createCanvas(Math.max(1, Math.round(sw / shrink)), Math.max(1, Math.round(sh / shrink)));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, small.width, small.height);

  const big = createCanvas(sw, sh);
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, sw, sh);
  return { canvas: big, sx, sy };
}

// Frosted-glass tab at the bottom centre.
function drawTagPill(ctx, text, L) {
  if (!text) return;
  const label = String(text);

  ctx.save();
  ctx.font = `600 ${L.pillFont}px "Inter"`;
  const textW = ctx.measureText(label).width;

  const pillW = Math.min(L.W - 60, Math.max(textW + 72, 230));
  const pillH = L.pillH;
  const x = Math.round((L.W - pillW) / 2);
  const y = L.H - pillH;
  const r = L.pillR;

  // 1. Real blur of the image behind the pill
  const { canvas: blurred, sx, sy } = blurRegion(ctx.canvas, L, x, y, pillW, pillH);
  ctx.save();
  roundedTopRect(ctx, x, y, pillW, pillH, r);
  ctx.clip();
  ctx.drawImage(blurred, sx, sy);

  // 2. Glass tint + sheen
  ctx.fillStyle = 'rgba(20, 20, 24, 0.38)';
  ctx.fillRect(x, y, pillW, pillH);
  const sheen = ctx.createLinearGradient(0, y, 0, y + pillH);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, pillW, pillH);
  ctx.restore();

  // 3. Rim
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  roundedTopRect(ctx, x + 0.75, y + 0.75, pillW - 1.5, pillH, r);
  ctx.stroke();

  // 4. Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(label, L.W / 2, y + pillH / 2 + 1);
  ctx.restore();
}

function drawRank(ctx, rank, L) {
  ctx.save();
  ctx.font = `${L.rankFont}px "BebasNeue"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText(`${rank}`, L.rankX, L.rankY);
  ctx.restore();
}

// Draws an image so it fills the whole canvas (crops the overflow).
function drawCover(ctx, img, L) {
  const scale = Math.max(L.W / img.width, L.H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (L.W - w) / 2, (L.H - h) / 2, w, h);
}

// Title logo, centred above the pill, on a soft dark gradient so it stays readable.
function drawLogo(ctx, logoImg, L, hasTag) {
  const grad = ctx.createLinearGradient(0, L.H * 0.35, 0, L.H);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, L.W, L.H);

  const maxW = L.W * 0.5;
  const maxH = L.H * 0.3;
  const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
  const w = logoImg.width * scale;
  const h = logoImg.height * scale;
  const bottom = L.H - (hasTag ? L.pillH : 0) - 28;
  ctx.drawImage(logoImg, (L.W - w) / 2, bottom - h, w, h);
}

// Pure drawing step (also used by tests with fake images).
function composePoster(posterImg, rank, tag) {
  const L = LAYOUTS.poster;
  const canvas = createCanvas(L.W, L.H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(posterImg, 0, 0, L.W, L.H);
  if (rank) drawRank(ctx, rank, L);
  if (tag) drawTagPill(ctx, tag, L);   // last, so it blurs the finished image
  return canvas;
}

function composeBackdrop(backdropImg, logoImg, rank, tag) {
  const L = LAYOUTS.backdrop;
  const canvas = createCanvas(L.W, L.H);
  const ctx = canvas.getContext('2d');
  drawCover(ctx, backdropImg, L);
  if (logoImg) drawLogo(ctx, logoImg, L, !!tag);
  if (rank) drawRank(ctx, rank, L);
  if (tag) drawTagPill(ctx, tag, L);
  return canvas;
}

async function generatePoster(tmdbId, type = 'movie', rank = null, tag = null) {
  try {
    const posterPath = await getPosterPath(type, tmdbId);
    if (!posterPath) throw new Error('Poster not found');
    const posterImg = await loadImage(`https://image.tmdb.org/t/p/w780${posterPath}`);
    return composePoster(posterImg, rank, tag).toBuffer('image/jpeg', 90);
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

async function generateBackdrop(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { backdropPath, logoPath } = await getBackdropAssets(type, tmdbId);
    if (!backdropPath) throw new Error('Backdrop not found');
    const backdropImg = await loadImage(`https://image.tmdb.org/t/p/w1280${backdropPath}`);

    let logoImg = null;
    if (logoPath) {
      try { logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${logoPath}`); }
      catch (e) { console.error('Logo load failed:', e.message); }
    }
    return composeBackdrop(backdropImg, logoImg, rank, tag).toBuffer('image/jpeg', 90);
  } catch (err) {
    console.error('Error generating backdrop:', err.message);
    if (opts.throwErrors) throw err;   // used by ?debug=1 so you can see the real error
    return null;
  }
}

module.exports = { generatePoster, generateBackdrop, composePoster, composeBackdrop };