const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// Two layouts: tall poster and wide backdrop. Everything else is shared.
const LAYOUTS = {
  // S = output pixels per layout unit, so artwork is sharp but sizes stay the same.
  poster:   { S: 1.3, W: 600, H: 900, providerTop: 26, providerTopRanked: 210, providerSize: 60, metaFont: 25, metaChipH: 42, metaGap: 14, logoMaxW: 0.8, logoMaxH: 0.2, gradTop: 0.55, shiftForTopPill: true, rankFont: 220, rankX: 20, rankY: 0, pillH: 74, pillFont: 38, pillR: 22 },
  backdrop: { S: 2, W: 960, H: 540, providerTop: 24, providerTopRanked: 140, providerSize: 52, metaFont: 22, metaChipH: 38, metaGap: 12, logoMaxW: 0.5, logoMaxH: 0.3, gradTop: 0.35, rankFont: 150, rankX: 30, rankY: 8, pillH: 74, pillFont: 40, pillR: 22 }
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

// Logo preference: English, then language-neutral, then any other (e.g. the original
// Japanese logo for anime). Many anime only have a Japanese-tagged logo on TMDB.
function rankLogos(logos) {
  const usable = (logos || []).filter(l => l.file_path && !l.file_path.endsWith('.svg'));
  return [
    ...usable.filter(l => l.iso_639_1 === 'en').sort(byVotes),
    ...usable.filter(l => !l.iso_639_1).sort(byVotes),
    ...usable.filter(l => l.iso_639_1 && l.iso_639_1 !== 'en').sort(byVotes)
  ];
}

// POSTER_STYLE decides when to use a textless poster + our own logo above the pill:
//   logo (default) -> only on ranked posters (Top 10), so the rank number never covers a
//                     printed title. Other posters keep the normal English poster, because
//                     TMDB sometimes tags foreign-text posters as "no language".
//   always         -> on every poster (also unranked ones from the Custom URL).
//   original       -> never; always the normal poster.
// Normal poster = best English one, then textless, then any.
// `images` can be passed in when we already have them (saves a TMDB call).
const POSTER_STYLE = String(process.env.POSTER_STYLE || 'logo').toLowerCase();

async function getPosterAssets(type, tmdbId, images, ranked = false) {
  const data = images || await getImages(type, tmdbId);
  const posters = data.posters || [];
  const english = posters.filter(p => p.iso_639_1 === 'en').sort(byVotes);
  const textless = posters.filter(p => p.iso_639_1 === null).sort(byVotes);
  const logo = rankLogos(data.logos)[0];

  const useTextless = POSTER_STYLE === 'always' || (POSTER_STYLE === 'logo' && ranked);
  if (useTextless && textless[0] && logo) {
    return { posterPath: textless[0].file_path, logoPath: logo.file_path };
  }
  const found = (english[0] || textless[0] || posters[0])?.file_path;
  if (found) return { posterPath: found, logoPath: null };

  const { data: details } = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}`, auth);
  return { posterPath: details.poster_path, logoPath: null };
}

// Backdrop: if the title has an English logo, use a textless backdrop and draw
// the logo on top (looks like a landscape poster). Otherwise use a backdrop
// that already has text, then any backdrop.
async function getBackdropAssets(type, tmdbId, images) {
  const data = images || await getImages(type, tmdbId);
  const backdrops = data.backdrops || [];
  const logos = rankLogos(data.logos);
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

// PILL_POSITION=top puts the status pill (e.g. "Now Streaming") at the top of POSTERS,
// hanging from the top edge; bottom (default) keeps it at the bottom.
const PILL_POSITION = String(process.env.PILL_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom';
// LANDSCAPE_PILL_POSITION does the same for landscape art; if unset it follows PILL_POSITION.
const LANDSCAPE_PILL_POSITION = process.env.LANDSCAPE_PILL_POSITION
  ? (String(process.env.LANDSCAPE_PILL_POSITION).toLowerCase() === 'top' ? 'top' : 'bottom')
  : PILL_POSITION;

function roundedBottomRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.closePath();
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
  const S = L.S || 1;
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(L.W - sx, w + pad * 2);
  const sh = Math.min(L.H - sy, h + pad * 2);
  const pw = Math.max(1, Math.round(sw * S));
  const ph = Math.max(1, Math.round(sh * S));

  const small = createCanvas(Math.max(1, Math.round(pw / (shrink * S))), Math.max(1, Math.round(ph / (shrink * S))));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcCanvas, sx * S, sy * S, sw * S, sh * S, 0, 0, small.width, small.height);

  const big = createCanvas(pw, ph);
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, pw, ph);
  return { canvas: big, sx, sy, sw, sh };
}

// Frosted-glass tab at the bottom centre.
function drawTagPill(ctx, text, L, position = 'bottom') {
  if (!text) return;
  const label = String(text);

  ctx.save();
  ctx.font = `600 ${L.pillFont}px "Inter"`;
  const textW = ctx.measureText(label).width;

  const pillW = Math.min(L.W - 60, Math.max(textW + 72, 230));
  const pillH = L.pillH;
  const x = Math.round((L.W - pillW) / 2);
  const atTop = position === 'top';
  const y = atTop ? 0 : L.H - pillH;
  const r = L.pillR;
  const shape = atTop ? roundedBottomRect : roundedTopRect;

  // 1. Real blur of the image behind the pill
  const { canvas: blurred, sx, sy, sw, sh } = blurRegion(ctx.canvas, L, x, y, pillW, pillH);
  ctx.save();
  shape(ctx, x, y, pillW, pillH, r);
  ctx.clip();
  ctx.drawImage(blurred, sx, sy, sw, sh);

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
  if (atTop) shape(ctx, x + 0.75, y - 0.75, pillW - 1.5, pillH, r);
  else shape(ctx, x + 0.75, y + 0.75, pillW - 1.5, pillH, r);
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

// Five-point star drawn as a shape (doesn't depend on the font having a ★ glyph)
function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Streaming provider icon in the top-left: under the rank number when there is one,
// otherwise in the corner. (The top-right is left free for the app's "watched" tick.)
function drawProviderIcon(ctx, L, img, hasRank, offsetY = 0) {
  if (!img) return;
  const s = L.providerSize;
  const x = L.rankX + 10;
  const y = (hasRank ? L.providerTopRanked : L.providerTop) + offsetY;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, x, y, s, s, s * 0.22);
  ctx.fill(); // shadow under the icon
  ctx.clip();
  ctx.shadowColor = 'transparent';
  ctx.drawImage(img, x, y, s, s);
  ctx.restore();
}

// Genre + rating on a small dark chip ("Science Fiction  •  ★ 8.4"), centred.
// bottomY = where the chip's bottom edge goes. Text is drawn slightly bold so it reads
// well on any artwork.
function drawMetaChip(ctx, L, info, bottomY) {
  if (!info || (!info.genre && !info.rating)) return;
  const f = L.metaFont;
  const h = L.metaChipH;
  const genre = info.genre ? String(info.genre) : '';
  const dot = genre && info.rating ? '  \u2022  ' : '';
  const rating = info.rating ? String(info.rating) : '';

  ctx.save();
  ctx.font = `600 ${f}px "Inter"`;
  const starW = rating ? f * 1.05 : 0;
  const genreW = ctx.measureText(genre).width;
  const dotW = ctx.measureText(dot).width;
  const ratingW = ctx.measureText(rating).width;
  const contentW = genreW + dotW + starW + ratingW;
  const padX = 20;
  const w = Math.min(L.W - 40, contentW + padX * 2);
  const x0 = (L.W - w) / 2;
  const top = bottomY - h;

  // chip
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(12, 12, 16, 0.62)';
  roundedRectPath(ctx, x0, top, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // text (faux-bold: fill + thin stroke in the same colour)
  let x = (L.W - contentW) / 2;
  const cy = top + h / 2 + 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.9;
  const boldText = (t, color) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.fillText(t, x, cy, L.W - 80);
    ctx.strokeText(t, x, cy, L.W - 80);
  };
  if (genre) { boldText(genre, '#ffffff'); x += genreW; }
  if (dot) { boldText(dot, 'rgba(255, 255, 255, 0.7)'); x += dotW; }
  if (rating) {
    ctx.fillStyle = '#ffc93c';
    drawStar(ctx, x + f * 0.42, cy - 1, f * 0.42);
    x += starW;
    boldText(rating, '#ffffff');
  }
  ctx.restore();
}

function drawRank(ctx, rank, L, offsetY = 0) {
  ctx.save();
  ctx.font = `${L.rankFont}px "BebasNeue"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText(`${rank}`, L.rankX, L.rankY + offsetY);
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
function drawLogo(ctx, logoImg, L, hasTag, reserveBelow = 0) {
  const grad = ctx.createLinearGradient(0, L.H * L.gradTop, 0, L.H);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, L.W, L.H);

  const maxW = L.W * L.logoMaxW;
  const maxH = L.H * L.logoMaxH;
  const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
  const w = logoImg.width * scale;
  const h = logoImg.height * scale;
  const bottom = L.H - (hasTag ? L.pillH : 0) - 28 - reserveBelow;
  ctx.drawImage(logoImg, (L.W - w) / 2, bottom - h, w, h);
}

// Pure drawing step (also used by tests with fake images).
// Shared layout for posters and landscape art. Bottom stack, from the bottom edge up:
// [pill] -> [genre/rating chip] -> [title logo]. With the pill on top, the rank number and
// provider icon move down to clear it.
function drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition }) {
  const pillTop = pillPosition === 'top' && !!tag;
  const pillBottom = !!tag && !pillTop;
  const hasMeta = !!(info && (info.genre || info.rating));
  const chipBottom = (pillBottom ? L.H - L.pillH : L.H) - L.metaGap;
  const aboveChip = hasMeta ? L.metaChipH + L.metaGap : 0;
  if (logoImg) drawLogo(ctx, logoImg, L, pillBottom, aboveChip + (pillBottom ? 0 : L.metaGap));
  if (hasMeta) drawMetaChip(ctx, L, info, chipBottom);

  // Only portrait posters are narrow enough for a 2-digit rank to hit a top pill,
  // and only the rank (with the icon under it) needs to move.
  const topOffset = pillTop && L.shiftForTopPill && rank ? L.pillH + 4 : 0;
  if (info) drawProviderIcon(ctx, L, info.providerImg, !!rank, topOffset);
  if (rank) drawRank(ctx, rank, L, topOffset);
  if (tag) drawTagPill(ctx, tag, L, pillTop ? 'top' : 'bottom');   // last, so it blurs the finished image
}

function composePoster(posterImg, rank, tag, logoImg = null, info = null) {
  const L = LAYOUTS.poster;
  const canvas = createCanvas(Math.round(L.W * L.S), Math.round(L.H * L.S));
  const ctx = canvas.getContext('2d');
  ctx.scale(L.S, L.S);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(posterImg, 0, 0, L.W, L.H);
  drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition: PILL_POSITION });
  return canvas;
}

function composeBackdrop(backdropImg, logoImg, rank, tag, info = null) {
  const L = LAYOUTS.backdrop;
  const canvas = createCanvas(Math.round(L.W * L.S), Math.round(L.H * L.S));
  const ctx = canvas.getContext('2d');
  ctx.scale(L.S, L.S);
  ctx.imageSmoothingQuality = 'high';
  drawCover(ctx, backdropImg, L);
  drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition: LANDSCAPE_PILL_POSITION });
  return canvas;
}

// Download an image with a time limit. If the big version is slow or fails, use the
// smaller fallback so the render never times out. Vercel caches the finished image,
// so this download only happens about once per title.
async function loadImageWithFallback(bigUrl, smallUrl, timeoutMs = 5000) {
  try {
    const { data } = await axios.get(bigUrl, { responseType: 'arraybuffer', timeout: timeoutMs });
    return await loadImage(Buffer.from(data));
  } catch (e) {
    console.error('Large image slow/failed, using smaller one:', e.message);
    return loadImage(smallUrl);
  }
}

async function generatePoster(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { posterPath, logoPath } = await getPosterAssets(type, tmdbId, opts.images, !!rank);
    if (!posterPath) throw new Error('Poster not found');
    const info = opts.info || null;
    const [posterImg, logoImg, providerImg] = await Promise.all([
      loadImage(`https://image.tmdb.org/t/p/w780${posterPath}`),
      logoPath
        ? loadImageWithFallback(
            `https://image.tmdb.org/t/p/original${logoPath}`,
            `https://image.tmdb.org/t/p/w500${logoPath}`
          ).catch(e => { console.error('Logo load failed:', e.message); return null; })
        : null,
      info?.providerLogoPath
        ? loadImage(`https://image.tmdb.org/t/p/w154${info.providerLogoPath}`)
            .catch(e => { console.error('Provider logo failed:', e.message); return null; })
        : null
    ]);
    const infoForDraw = info ? { genre: info.genre, rating: info.rating, providerImg } : null;
    return composePoster(posterImg, rank, tag, logoImg, infoForDraw).toBuffer('image/jpeg', 90);
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

async function generateBackdrop(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { backdropPath, logoPath } = await getBackdropAssets(type, tmdbId, opts.images);
    if (!backdropPath) throw new Error('Backdrop not found');
    // Download backdrop, logo and provider icon at the same time.
    const info = opts.info || null;
    const [backdropImg, logoImg, providerImg] = await Promise.all([
      // Full-size backdrop for a sharp 1920x1080 render; falls back to w1280 if slow.
      loadImageWithFallback(
        `https://image.tmdb.org/t/p/original${backdropPath}`,
        `https://image.tmdb.org/t/p/w1280${backdropPath}`
      ),
      logoPath
        ? loadImageWithFallback(
            `https://image.tmdb.org/t/p/original${logoPath}`,
            `https://image.tmdb.org/t/p/w500${logoPath}`
          )
            .catch(e => { console.error('Logo load failed:', e.message); return null; })
        : null,
      info?.providerLogoPath
        ? loadImage(`https://image.tmdb.org/t/p/w154${info.providerLogoPath}`)
            .catch(e => { console.error('Provider logo failed:', e.message); return null; })
        : null
    ]);
    const infoForDraw = info ? { genre: info.genre, rating: info.rating, providerImg } : null;
    return composeBackdrop(backdropImg, logoImg, rank, tag, infoForDraw).toBuffer('image/jpeg', 90);
  } catch (err) {
    console.error('Error generating backdrop:', err.message);
    if (opts.throwErrors) throw err;   // used by ?debug=1 so you can see the real error
    return null;
  }
}

module.exports = { generatePoster, generateBackdrop, composePoster, composeBackdrop };