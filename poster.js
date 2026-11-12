const { createCanvas, GlobalFonts, Path2D } = require('@napi-rs/canvas');
const path = require('path');
const { tmdbGet, fetchImage, byBest, sharpFirst, rankLogos } = require('./tmdb');
const { opt } = require('./options');

// Two layouts: tall poster and wide backdrop. Everything else is shared.
const LAYOUTS = {
  // S = output pixels per layout unit, so artwork is sharp but sizes stay the same.
  // Poster = 780x1170. Landscape S is set by IMAGE_QUALITY below.
  poster:   { S: 1.3, W: 600, H: 900, providerTop: 26, providerTopRanked: 210, providerSize: 60, metaFont: 30, metaChipH: 50, metaGap: 14, logoMaxW: 0.8, logoMaxH: 0.2, gradTop: 0.55, shiftForTopPill: true, rankFont: 220, rankX: 20, rankY: 0, pillH: 74, pillFont: 38, pillR: 22 },
  backdrop: { S: 2, W: 960, H: 540, providerTop: 24, providerTopRanked: 140, providerSize: 52, metaFont: 26, metaChipH: 44, metaGap: 12, logoMaxW: 0.5, logoMaxH: 0.3, gradTop: 0.35, rankFont: 150, rankX: 30, rankY: 8, pillH: 74, pillFont: 40, pillR: 22 }
};

// IMAGE_QUALITY: high (default) -> landscape 1920x1080, JPEG 92
//                balanced       -> landscape 1280x720, JPEG 85 (about 3x smaller files, for
//                                  when Vercel's free 10 GB "Fast Origin Transfer" runs low)
// Either way we start from TMDB's full-size originals; those downloads don't count toward
// that limit, only the finished image we send does. JPEG_QUALITY (60-95) overrides the JPEG part.
const IMAGE_QUALITY = String(process.env.IMAGE_QUALITY || 'high').toLowerCase() === 'balanced' ? 'balanced' : 'high';
LAYOUTS.backdrop.S = IMAGE_QUALITY === 'high' ? 2 : 4 / 3;

// The look options (pill style and size, rating position, ...) come from options.js:
// .env by default, or the settings code in a /c/<code>/ link from the /configure page.
//   pillSize  scales the status pill: 1 = original size, 0.8 = default, 0.7 = smaller.
//   pillStyle frosted = blurred, tinted glass; glass = "liquid glass" (clear glass that
//             bends the picture at its edges, with a bright rim); color = a solid tab in
//             a colour taken from the artwork.
const PILL_SIZE = () => opt('pillSize');
const PILL_STYLE = () => opt('pillStyle');
// A layout with the pill scaled for the current options.
function layoutFor(kind) {
  const L = { ...LAYOUTS[kind] };
  const k = PILL_SIZE();
  L.pillH = Math.round(L.pillH * k);
  L.pillFont = Math.round(L.pillFont * k);
  L.pillR = Math.round(L.pillR * k);
  return L;
}

// Inter SemiBold = pill text. Bebas Neue = rank numbers.
try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'Inter-SemiBold.ttf'), 'Inter');
  GlobalFonts.registerFromPath(path.join(__dirname, 'BebasNeue-Regular.ttf'), 'BebasNeue');
} catch (e) {
  console.log('Font registration error:', e.message);
}

const getImages = (type, tmdbId) => tmdbGet(`/${type}/${tmdbId}/images`, { include_image_language: 'en,null' });

// POSTER_STYLE decides when to use a textless poster + our own logo above the pill:
//   always (default) -> on every poster, so they all look the same and the genre/rating
//                       line never covers a printed title. If TMDB tags a foreign-text
//                       poster as "no language" by mistake, add it to POSTER_SKIP.
//   logo             -> only on ranked posters (Top 10); others keep the normal poster.
//   original         -> never; always the normal poster.
// Normal poster = best English one, then one in the original language (has the title),
// then textless, then any.
// `images` can be passed in when we already have them (saves a TMDB call).
const POSTER_STYLE = () => opt('posterStyle');

async function getPosterAssets(type, tmdbId, images, ranked = false) {
  const data = images || await getImages(type, tmdbId);
  // Skip blurry uploads within each language group (we draw at 780 px wide), so a smaller
  // English poster still beats a sharp foreign one (e.g. Under Siege: a 500 px English
  // poster vs. 900 px Spanish ones).
  const posters = data.posters || [];
  const group = test => sharpFirst(posters.filter(test), 780).sort(byBest);
  const english = group(p => p.iso_639_1 === 'en');
  const textless = group(p => p.iso_639_1 === null);
  // Posters in another language (e.g. the Japanese poster of an anime) still show the title.
  const foreign = group(p => p.iso_639_1 && p.iso_639_1 !== 'en');
  const logoPaths = logoCandidates(rankLogos(data.logos));

  const style = POSTER_STYLE();
  const useTextless = style === 'always' || (style === 'logo' && ranked);
  if (useTextless && textless[0] && logoPaths.length) {
    return { posterPath: textless[0].file_path, logoPaths };
  }
  const found = (english[0] || foreign[0] || textless[0] || sharpFirst(posters, 780)[0])?.file_path;
  if (found) return { posterPath: found, logoPaths: [] };

  const details = await tmdbGet(`/${type}/${tmdbId}`);
  return { posterPath: details.poster_path, logoPaths: [] };
}

// The best logo plus a few backups in the same language, in case the best one is too
// dark to read on the dark gradient (see loadLogo).
function logoCandidates(logos) {
  const lang = logos[0]?.iso_639_1 || null;
  return logos.filter(l => (l.iso_639_1 || null) === lang).slice(0, 4).map(l => l.file_path);
}

// Backdrop: if the title has an English logo, use a textless backdrop and draw
// the logo on top (looks like a landscape poster). Otherwise use a backdrop
// that already has text, then any backdrop.
async function getBackdropAssets(type, tmdbId, images) {
  const data = images || await getImages(type, tmdbId);
  // Skip blurry uploads within each group (see getPosterAssets).
  const backdrops = data.backdrops || [];
  const logos = rankLogos(data.logos);
  const group = test => sharpFirst(backdrops.filter(test), 1280).sort(byBest);
  const textless = group(b => b.iso_639_1 === null);
  const english = group(b => b.iso_639_1 === 'en');
  const any = group(() => true);

  let backdropPath = null;
  let logoPaths = [];

  if (logos[0] && (textless[0] || any[0])) {
    backdropPath = (textless[0] || any[0]).file_path;
    logoPaths = logoCandidates(logos);
  } else {
    backdropPath = (english[0] || textless[0] || any[0])?.file_path || null;
  }

  if (!backdropPath) {
    const details = await tmdbGet(`/${type}/${tmdbId}`);
    backdropPath = details.backdrop_path;
  }
  return { backdropPath, logoPaths };
}

// PILL_POSITION=top puts the status pill (e.g. "Now Streaming") at the top of POSTERS,
// hanging from the top edge; bottom (default) keeps it at the bottom.
const PILL_POSITION = () => opt('pillPosition');
// LANDSCAPE_PILL_POSITION does the same for landscape art; if unset it follows PILL_POSITION.
// RATING_POSITION=top-right moves the scores (IMDb / TMDB / RT) out of the line under the logo into a
// small dark badge in the top-right corner (level with the provider icon). Note: apps
// like Nuvio draw their "watched" tick in that corner too. Default: bottom.
const RATING_TOP = () => opt('ratingPos') === 'top-right';

// META_CHIP=on puts the genre + rating line on a dark rounded background.
// Default (off) draws just the text with a soft shadow so it stays readable.
const META_CHIP = () => opt('metaChip');
const LANDSCAPE_PILL_POSITION = () => (opt('landscapePill') === 'same' ? PILL_POSITION() : opt('landscapePill'));

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

// "Liquid glass" background for the pill: the picture behind it, lightly blurred and
// bent near the edges like a curved lens (content just outside the edge is pulled in and
// squeezed), plus a little extra brightness and colour. Works on real pixels.
// free = a badge floating on the picture (all four edges bend, and more gently, since
// it is much smaller than the pill) instead of a tab hanging from the top/bottom border.
function drawLiquidGlass(ctx, L, x, y, w, h, r, atTop, free = false) {
  const S = L.S;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const band = h * (free ? 0.3 : 0.5) * S; // how far in from the edge the bending reaches
  const shift = band * 0.75;          // strongest bend, at the very edge
  const m = Math.ceil(shift) + 2;     // extra pixels around the pill we may sample from
  const X0 = Math.max(0, Math.round(x * S) - m), Y0 = Math.max(0, Math.round(y * S) - m);
  const X1 = Math.min(cw, Math.round((x + w) * S) + m), Y1 = Math.min(ch, Math.round((y + h) * S) + m);
  const RW = X1 - X0, RH = Y1 - Y0;

  // Light blur: shrink to a third and scale back up.
  const small = createCanvas(Math.max(1, Math.round(RW / 3)), Math.max(1, Math.round(RH / 3)));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(ctx.canvas, X0, Y0, RW, RH, 0, 0, small.width, small.height);
  const soft = createCanvas(RW, RH);
  const fctx = soft.getContext('2d');
  fctx.imageSmoothingQuality = 'high';
  fctx.drawImage(small, 0, 0, RW, RH);
  const src = fctx.getImageData(0, 0, RW, RH).data;
  const out = ctx.getImageData(X0, Y0, RW, RH);
  let lumSum = 0, lumN = 0;
  const dst = out.data;

  // Pill shape as a rounded rectangle. The edge that touches the picture's border is
  // pushed outside it, so only the three visible edges bend.
  const R = r * S;
  const hw = (w * S) / 2;
  const hh = (h * S) / 2 + (free ? 0 : R);
  const cx = (x + w / 2) * S;
  const cy = free ? (y + h / 2) * S
    : (atTop ? y * S - R : (y + h) * S + R) + (atTop ? hh - R : -(hh - R));
  for (let py = 0; py < RH; py++) {
    for (let px = 0; px < RW; px++) {
      const gx = X0 + px + 0.5, gy = Y0 + py + 0.5;
      const qx = Math.abs(gx - cx) - (hw - R), qy = Math.abs(gy - cy) - (hh - R);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const dist = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - R; // < 0 inside
      if (dist > 0) continue;
      const depth = -dist;
      let sx = gx, sy = gy;
      if (depth < band) {
        // outward direction from the nearest edge
        let nx, ny;
        if (qx > 0 && qy > 0) { const l = Math.hypot(ox, oy) || 1; nx = ox / l; ny = oy / l; }
        else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
        nx *= Math.sign(gx - cx) || 1; ny *= Math.sign(gy - cy) || 1;
        const t = 1 - depth / band;
        const k = shift * t * t;
        sx = gx + nx * k; sy = gy + ny * k;
      }
      const ix = Math.min(RW - 1, Math.max(0, Math.round(sx - X0 - 0.5)));
      const iy = Math.min(RH - 1, Math.max(0, Math.round(sy - Y0 - 0.5)));
      const si = (iy * RW + ix) * 4, di = (py * RW + px) * 4;
      // a touch brighter and more colourful, like real glass catching light
      const rr = src[si], gg = src[si + 1], bb = src[si + 2];
      const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      lumSum += lum; lumN++;
      dst[di] = Math.min(255, (lum + (rr - lum) * 1.25) * 1.06 + 6);
      dst[di + 1] = Math.min(255, (lum + (gg - lum) * 1.25) * 1.06 + 6);
      dst[di + 2] = Math.min(255, (lum + (bb - lum) * 1.25) * 1.06 + 6);
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(out, X0, Y0);
  ctx.restore();
  return lumN ? lumSum / lumN / 255 : 0; // how bright the glass is (0-1)
}

// Shine and rim on top of the liquid glass: a dark wash that gets stronger over bright
// pictures (keeps the white text readable), a bright inner highlight along the top edge,
// and a light rim that fades at the sides.
function drawGlassShine(ctx, x, y, w, h, r, atTop, shape, brightness = 0, free = false) {
  ctx.save();
  shape(ctx, x, y, w, h, r);
  ctx.clip();
  const wash = 0.12 + 0.5 * Math.min(1, Math.max(0, (brightness - 0.2) / 0.4));
  ctx.fillStyle = `rgba(0, 0, 0, ${wash.toFixed(3)})`;
  ctx.fillRect(x, y, w, h);
  // inner highlight: light hits the edge away from the picture border
  const edgeY = atTop ? y + h : y;
  const hl = ctx.createLinearGradient(0, edgeY, 0, atTop ? edgeY - h * 0.55 : edgeY + h * 0.55);
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  hl.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hl;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // rim: bright at the curved corners, softer along the straight parts
  const rim = ctx.createLinearGradient(x, 0, x + w, 0);
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  rim.addColorStop(0.18, 'rgba(255, 255, 255, 0.45)');
  rim.addColorStop(0.5, 'rgba(255, 255, 255, 0.28)');
  rim.addColorStop(0.82, 'rgba(255, 255, 255, 0.45)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
  ctx.save();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  if (free) shape(ctx, x + 1, y + 1, w - 2, h - 2, r);
  else if (atTop) shape(ctx, x + 1, y - 1, w - 2, h, r);
  else shape(ctx, x + 1, y + 1, w - 2, h, r);
  ctx.stroke();
  ctx.restore();
}

// PILL_STYLE=color: a solid tab in a colour taken from the artwork around it (e.g. gold
// on a gold poster, light grey on a pale one, near-black on a dark one), with dark or
// white text, whichever reads better. Measured on the bare artwork, before the dark fade
// and logo are drawn. Returns { fill, text }, or null for the other styles.
function pillColorFor(ctx, L, position) {
  if (PILL_STYLE() !== 'color') return null;
  const S = L.S || 1;
  const w = Math.round(L.W * 0.6 * S);
  const h = Math.round(L.H * 0.18 * S);
  const x = Math.round(L.W * 0.2 * S);
  const y = position === 'top' ? 0 : Math.round(L.H * S) - h;
  const px = ctx.getImageData(x, y, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 7) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  if (!n) return null;
  // average colour -> HSL, a little more colourful and lifted off the background
  let [hue, sat, lig] = rgbToHsl(r / n / 255, g / n / 255, b / n / 255);
  sat = Math.min(1, sat * 1.25);
  lig = lig < 0.5 ? Math.max(0.1, Math.min(0.45, lig + 0.07)) : Math.min(0.86, lig + 0.04);
  const [R, G, B] = hslToRgb(hue, sat, lig);
  // Dark text from mid-tones up (gold, light grey ...): it has more contrast there than
  // white does. Brightness here is as the eye sees it (linear light).
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
  const dark = lum < 0.22;
  return {
    fill: `rgb(${Math.round(R * 255)}, ${Math.round(G * 255)}, ${Math.round(B * 255)})`,
    text: dark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(16, 16, 18, 0.88)',
    dark
  };
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// The status tab at the bottom (or top) centre: frosted glass, liquid glass or a solid
// colour (pillColor, see pillColorFor).
function drawTagPill(ctx, text, L, position = 'bottom', pillColor = null) {
  if (!text) return;
  const label = String(text);

  ctx.save();
  ctx.font = `600 ${L.pillFont}px "Inter"`;
  const textW = ctx.measureText(label).width;

  const pillW = Math.min(L.W - 60, Math.max(textW + 72 * PILL_SIZE(), 230 * PILL_SIZE()));
  const pillH = L.pillH;
  const x = Math.round((L.W - pillW) / 2);
  const atTop = position === 'top';
  const y = atTop ? 0 : L.H - pillH;
  const r = L.pillR;
  const shape = atTop ? roundedBottomRect : roundedTopRect;

  if (pillColor) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = atTop ? 3 : -3;
    ctx.fillStyle = pillColor.fill;
    shape(ctx, x, y, pillW, pillH, r * 0.7);
    ctx.fill();
    ctx.restore();
  } else if (PILL_STYLE() === 'glass') {
    const glassLight = drawLiquidGlass(ctx, L, x, y, pillW, pillH, r, atTop);
    drawGlassShine(ctx, x, y, pillW, pillH, r, atTop, shape, glassLight);
  } else {
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
  }

  // 4. Text
  ctx.fillStyle = pillColor ? pillColor.text : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // clear glass shows more of the picture, so the text gets a stronger shadow there;
  // on a solid colour only white text gets a faint one
  ctx.shadowColor = pillColor ? (pillColor.dark ? 'rgba(0, 0, 0, 0.3)' : 'transparent')
    : PILL_STYLE() === 'glass' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = PILL_STYLE() === 'glass' ? 8 : 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(label, L.W / 2, y + pillH / 2 + 1);
  if (pillColor) {
    // a touch bolder, like the rest of the solid tab
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.7;
    ctx.strokeText(label, L.W / 2, y + pillH / 2 + 1);
  }
  ctx.restore();
}

// TMDB's logo (the stacked "THE MOVIE DB" mark) next to the rating, since the rating is
// TMDB's user score. Shape from the simple-icons set (CC0), on a 24 x 24 grid; drawn in
// TMDB's green-to-blue brand colours.
const TMDB_MARK = new Path2D('M6.62 12a2.291 2.291 0 0 1 2.292-2.295h-.013A2.291 2.291 0 0 1 11.189 12a2.291 2.291 0 0 1-2.29 2.291h.013A2.291 2.291 0 0 1 6.62 12zm10.72-4.062h4.266a2.291 2.291 0 0 0 2.29-2.291 2.291 2.291 0 0 0-2.29-2.296H17.34a2.291 2.291 0 0 0-2.291 2.296 2.291 2.291 0 0 0 2.29 2.29zM2.688 20.645h8.285a2.291 2.291 0 0 0 2.291-2.292 2.291 2.291 0 0 0-2.29-2.295H2.687a2.291 2.291 0 0 0-2.291 2.295 2.291 2.291 0 0 0 2.29 2.292zm10.881-6.354h.81l1.894-4.586H15.19l-1.154 3.008h-.013l-1.135-3.008h-1.154zm4.208 0h1.011V9.705h-1.011zm2.878 0h3.235v-.93h-2.223v-.933h1.99v-.934h-1.99v-.855h2.107v-.934h-3.112zM1.31 7.941h1.01V4.247h1.31v-.895H0v.895h1.31zm3.747 0h1.011V5.959h1.958v1.984h1.011v-4.59h-1.01v1.711H6.061V3.351H5.057zm5.348 0h3.242v-.933H11.41v-.934h1.99v-.933h-1.99v-.856h2.107v-.934h-3.112zM.162 14.296h1.005v-3.52h.013l1.167 3.52h.765l1.206-3.52h.013v3.52h1.011v-4.59H3.82L2.755 12.7h-.013L1.686 9.705H.156zm14.534 6.353h1.641a3.188 3.188 0 0 0 .98-.149 2.531 2.531 0 0 0 .824-.437 2.123 2.123 0 0 0 .567-.713 2.193 2.193 0 0 0 .223-.983 2.399 2.399 0 0 0-.218-1.07 1.958 1.958 0 0 0-.586-.716 2.405 2.405 0 0 0-.873-.392 4.349 4.349 0 0 0-1.046-.13h-1.519zm1.013-3.656h.596a2.26 2.26 0 0 1 .606.08 1.514 1.514 0 0 1 .503.244 1.167 1.167 0 0 1 .34.412 1.28 1.28 0 0 1 .13.587 1.546 1.546 0 0 1-.13.658 1.127 1.127 0 0 1-.347.433 1.41 1.41 0 0 1-.518.238 2.797 2.797 0 0 1-.649.07h-.538zm4.686 3.656h1.88a2.997 2.997 0 0 0 .613-.064 1.735 1.735 0 0 0 .554-.214 1.221 1.221 0 0 0 .402-.39 1.105 1.105 0 0 0 .155-.606 1.188 1.188 0 0 0-.071-.415 1.01 1.01 0 0 0-.204-.34 1.087 1.087 0 0 0-.317-.24 1.297 1.297 0 0 0-.413-.13v-.012a1.203 1.203 0 0 0 .575-.366.962.962 0 0 0 .216-.648 1.081 1.081 0 0 0-.149-.603 1.022 1.022 0 0 0-.389-.354 1.673 1.673 0 0 0-.54-.169 4.463 4.463 0 0 0-.6-.041h-1.712zm1.011-3.734h.687a1.4 1.4 0 0 1 .24.022.748.748 0 0 1 .22.075.432.432 0 0 1 .16.147.418.418 0 0 1 .061.236.47.47 0 0 1-.055.233.433.433 0 0 1-.146.156.62.62 0 0 1-.204.084 1.058 1.058 0 0 1-.23.026h-.745zm0 1.835h.765a1.96 1.96 0 0 1 .266.02 1.015 1.015 0 0 1 .26.07.519.519 0 0 1 .204.152.406.406 0 0 1 .08.26.481.481 0 0 1-.06.253.519.519 0 0 1-.16.168.62.62 0 0 1-.217.09 1.155 1.155 0 0 1-.237.027H21.4z');
function drawTmdbMark(ctx, x, cy, size) {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, cy - size / 2);
  ctx.scale(s, s);
  const grad = ctx.createLinearGradient(0, 0, 24, 0);
  grad.addColorStop(0, '#90cea1');
  grad.addColorStop(1, '#01b4e4');
  ctx.fillStyle = grad;
  ctx.fill(TMDB_MARK);
  ctx.restore();
}

// IMDb and Rotten Tomatoes marks, also from simple-icons (CC0), 24 x 24 grid.
const IMDB_MARK = new Path2D('M22.3781 0H1.6218C.7411.0583.0587.7437.0018 1.5953l-.001 20.783c.0585.8761.7125 1.543 1.5559 1.6191A.337.337 0 0 0 1.6016 24h20.7971a.4579.4579 0 0 0 .0437-.002c.8727-.0768 1.5568-.8271 1.5568-1.7085V1.7098c0-.8914-.696-1.6416-1.584-1.7078A.3294.3294 0 0 0 22.3781 0zm0 .496a1.2144 1.2144 0 0 1 1.1252 1.2139v20.5797c0 .6377-.4875 1.1602-1.1045 1.2145H1.6016c-.5967-.0543-1.0645-.5297-1.1053-1.1258V1.6284C.5371 1.0185 1.0184.5364 1.6217.496h20.7564zM4.7954 8.2603v7.3636H2.8899V8.2603h1.9055zm6.5367 0v7.3636H9.6707v-4.9704l-.6711 4.9704H7.813l-.6986-4.8618-.0066 4.8618h-1.668V8.2603h2.468c.0748.4476.1492.9694.2307 1.5734l.2712 1.8713.4407-3.4447h2.4817zm2.9772 1.3289c.0742.0404.122.108.1417.2034.0279.0953.0345.3118.0345.6442v2.8548c0 .4881-.0345.7867-.0955.8954-.0609.1152-.2304.1695-.5018.1695V9.5211c.204 0 .3457.0205.4211.0681zm-.0211 6.0347c.4543 0 .8006-.0265 1.0245-.0742.2304-.0477.4204-.1357.5694-.2648.1556-.1218.2642-.298.3251-.5219.0611-.2238.1021-.6648.1021-1.3224v-2.5832c0-.6986-.0271-1.1668-.0742-1.4039-.041-.237-.1431-.4543-.3126-.6437-.1695-.1973-.4198-.3324-.7456-.421-.3191-.0808-.8542-.1285-1.7694-.1285h-1.4244v7.3636h2.3051zm5.14-1.7827c0 .3523-.0199.5762-.0544.6708-.033.0947-.1894.1424-.3046.1424-.1086 0-.19-.0477-.2238-.1351-.041-.0887-.0609-.2986-.0609-.6238v-1.9469c0-.3324.0199-.5423.0543-.6237.0338-.0808.1086-.122.2171-.122.1153 0 .2709.0412.3114.1425.041.0947.0609.2986.0609.6032v1.8926zm-2.4747-5.5809v7.3636h1.7157l.1152-.4675c.1556.1894.3251.3324.5152.4271.1828.0881.4608.1357.678.1357.3047 0 .5629-.0748.7802-.237.2165-.1562.3589-.3462.4198-.5628.0543-.2173.0887-.543.0887-.9841v-2.0675c0-.4409-.0139-.7324-.0344-.8681-.0199-.1357-.0742-.2781-.1695-.4204-.1021-.1425-.2437-.251-.4272-.3325-.1834-.0742-.3999-.1152-.6576-.1152-.2172 0-.4952.0477-.6846.1285-.1835.0887-.353.2238-.5086.4007V8.2603h-1.8309z');
const RT_MARK = new Path2D('M5.866 0L4.335 1.262l2.082 1.8c-2.629-.989-4.842 1.4-5.012 2.338 1.384-.323 2.24-.422 3.344-.335-7.042 4.634-4.978 13.148-1.434 16.094 5.784 4.612 13.77 3.202 17.91-1.316C27.26 13.363 22.993.65 10.86 2.766c.107-1.17.633-1.503 1.243-1.602-.89-1.493-3.67-.734-4.556 1.374C7.52 2.602 5.866 0 5.866 0zM4.422 7.217H6.9c2.673 0 2.898.012 3.55.202 1.06.307 1.868.973 2.313 1.904.05.106.092.206.13.305l7.623.008.027 2.912-2.745-.024v7.549l-2.982-.016v-7.522l-2.127.016a2.92 2.92 0 0 1-1.056 1.134c-.287.176-.3.19-.254.264.127.2 2.125 3.642 2.125 3.659l-3.39.019-2.013-3.376c-.034-.047-.122-.068-.344-.084l-.297-.02.037 3.48-3.075-.038zm3.016 2.288l.024.338c.014.186.024.729.024 1.206v.867l.582-.025c.32-.013.695-.049.833-.078.694-.146 1.048-.478 1.087-1.018.027-.378-.063-.636-.303-.87-.318-.309-.761-.416-1.733-.418Z');

// IMDb: yellow badge with the black "IMDb" letters (the letters part of the icon only).
function drawImdbMark(ctx, x, cy, size) {
  const h = size * 0.6, w = size * 1.25;
  const y = cy - h / 2;
  ctx.save();
  ctx.fillStyle = '#f5c518';
  roundedRectPath(ctx, x, y, w, h, h * 0.18);
  ctx.fill();
  ctx.clip();
  ctx.shadowColor = 'transparent'; // a shadow from the letters would darken the badge
  // the letters span x 2.4-21.6, y 8.3-15.6 on the icon's grid
  const k = (w * 0.84) / 19.2;
  ctx.translate(x + w / 2 - 12 * k, cy - 11.94 * k);
  ctx.scale(k, k);
  ctx.fillStyle = '#000000';
  ctx.fill(IMDB_MARK);
  ctx.restore();
}

// Rotten Tomatoes: red tomato when "fresh" (60% or more), green when "rotten".
function drawRtMark(ctx, x, cy, size, fresh) {
  const s = (size * 0.78) / 24;
  ctx.save();
  ctx.translate(x, cy - (size * 0.78) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = fresh ? '#fa320a' : '#0ac855';
  ctx.fill(RT_MARK);
  ctx.restore();
}

const MARK_W = { imdb: 1.25, tmdb: 1, rt: 0.8 };   // mark width, in mark sizes
function drawScoreMark(ctx, r, x, cy, size) {
  if (r.src === 'imdb') drawImdbMark(ctx, x, cy, size);
  else if (r.src === 'rt') drawRtMark(ctx, x, cy, size, r.fresh);
  else drawTmdbMark(ctx, x, cy, size);
}

// A row of scores, "[IMDb] 7.5   [TMDB] 7.4   [RT] 85%". With draw = null it only
// measures. Returns the width.
function scoresRow(ctx, ratings, f, x, cy, drawText) {
  const size = f * 1.5;
  const markGap = f * 0.3;
  const between = f * 0.8;
  let w = 0;
  ratings.forEach((r, i) => {
    if (i) w += between;
    const mw = size * (MARK_W[r.src] || 1);
    if (drawText) drawScoreMark(ctx, r, x + w, cy - 1, size);
    w += mw + markGap;
    if (drawText) drawText(r.text, x + w, cy);
    w += ctx.measureText(r.text).width;
  });
  return w;
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

// Genre + scores ("Science Fiction  •  [IMDb] 7.5  [TMDB] 7.4  [RT] 85%"), centred,
// optionally on a chip. bottomY = where the chip's bottom edge goes. Text is drawn
// slightly bold so it reads well on any artwork. Shrinks to fit when it's too wide.
function drawMetaChip(ctx, L, info, bottomY) {
  const ratings = info?.ratings || [];
  if (!info || (!info.genre && !ratings.length)) return;
  const genre = info.genre ? String(info.genre) : '';
  const dot = genre && ratings.length ? '  \u2022  ' : '';
  const padX = 20;

  ctx.save();
  let f = L.metaFont;
  let genreW, dotW, scoresW, contentW;
  const measure = () => {
    ctx.font = `600 ${f}px "Inter"`;
    genreW = ctx.measureText(genre).width;
    dotW = ctx.measureText(dot).width;
    scoresW = scoresRow(ctx, ratings, f, 0, 0, null);
    contentW = genreW + dotW + scoresW;
  };
  measure();
  const room = L.W - 40 - padX * 2;
  if (contentW > room) { f = Math.floor(f * room / contentW); measure(); }
  const h = Math.round(L.metaChipH * f / L.metaFont);
  const w = contentW + padX * 2;
  const x0 = (L.W - w) / 2;
  const top = bottomY - h;

  if (META_CHIP()) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(12, 12, 16, 0.62)';
    roundedRectPath(ctx, x0, top, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // no chip: a dark shadow behind the text keeps it readable on bright art
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
  }

  // text (faux-bold: fill + thin stroke in the same colour)
  let x = (L.W - contentW) / 2;
  const cy = top + h / 2 + 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.9;
  const boldText = (t, tx, color = '#ffffff') => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.fillText(t, tx, cy);
    const shadow = ctx.shadowColor;
    ctx.shadowColor = 'transparent'; // shadow only once, from the fill
    ctx.strokeText(t, tx, cy);
    ctx.shadowColor = shadow;
  };
  if (genre) { boldText(genre, x); x += genreW; }
  if (dot) { boldText(dot, x, 'rgba(255, 255, 255, 0.7)'); x += dotW; }
  if (ratings.length) scoresRow(ctx, ratings, f, x, cy, (t, tx) => boldText(t, tx));
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
// How bright the lower part of the artwork is (0-1), where the logo and text go.
// Measured on the finished drawing, every 6th pixel is plenty.
function bottomBrightness(ctx, L) {
  const w = Math.round(L.W * L.S);
  const y0 = Math.round(L.H * L.gradTop * L.S);
  const h = Math.round(L.H * L.S) - y0;
  const px = ctx.getImageData(Math.round(w * 0.1), y0, Math.round(w * 0.8), h).data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 6) {
    sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    n++;
  }
  return n ? sum / n : 0;
}

// Dark fade behind the logo. Bright artwork (e.g. A Dog's Perfect Christmas, a pale snowy
// poster) gets a stronger, taller fade so a white logo still stands out; normal and dark
// artwork keep the usual fade.
function drawLogo(ctx, logoImg, L, hasTag, reserveBelow = 0) {
  const bright = Math.min(1, Math.max(0, (bottomBrightness(ctx, L) - 0.35) / 0.3));
  const grad = ctx.createLinearGradient(0, L.H * L.gradTop, 0, L.H);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.45, `rgba(0, 0, 0, ${(0.34 + 0.3 * bright).toFixed(3)})`);
  grad.addColorStop(1, `rgba(0, 0, 0, ${(0.75 + 0.17 * bright).toFixed(3)})`);
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

// Scores badge in the top-right corner: [IMDb] 7.5  [TMDB] 7.4 ... on a dark rounded
// badge, level with the provider icon in the top-left. The badge keeps it readable on
// bright artwork (there's no dark fade at the top).
function drawRatingBadge(ctx, L, ratings, offsetY = 0) {
  const h = Math.round(L.providerSize * 0.8);
  const f = Math.round(h * 0.5);
  const padX = h * 0.28;
  ctx.save();
  ctx.font = `600 ${f}px "Inter"`;
  const w = padX + scoresRow(ctx, ratings, f, 0, 0, null) + padX;
  const x = L.W - (L.rankX + 10) - w;               // same margin as the provider icon
  const y = L.providerTop + (L.providerSize - h) / 2 + offsetY;
  const glass = PILL_STYLE() === 'glass';
  if (glass) {
    // Same liquid glass as the pill, so the two match.
    const light = drawLiquidGlass(ctx, L, x, y, w, h, h * 0.3, false, true);
    drawGlassShine(ctx, x, y, w, h, h * 0.3, false, roundedRectPath, light, true);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'; // clear glass shows the picture, so shade the text
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
  } else {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(12, 12, 16, 0.72)';
    roundedRectPath(ctx, x, y, w, h, h * 0.3);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.8;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  scoresRow(ctx, ratings, f, x + padX, y + h / 2 + 1, (t, tx) => {
    ctx.fillText(t, tx, y + h / 2 + 1);
    ctx.strokeText(t, tx, y + h / 2 + 1);
  });
  ctx.restore();
}

// Pure drawing step (also used by tests with fake images).
// Shared layout for posters and landscape art. Bottom stack, from the bottom edge up:
// [pill] -> [genre/rating chip] -> [title logo]. With the pill on top, the rank number and
// provider icon move down to clear it.
// RANK_STYLE: pill (default) -> the rank goes in the status pill as "Top 1 Today"
//             hash           -> the same, written "#1 Today"
//                                (replacing the status text) and no big number is drawn.
//             number         -> big rank number on the side + the normal status pill.
const RANK_STYLE = () => opt('rankStyle');

function drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition, pillColor }) {
  if (rank && RANK_STYLE() !== 'number') {
    tag = RANK_STYLE() === 'hash' ? `#${rank} Today` : `Top ${rank} Today`;
    rank = null; // no side number; the provider icon moves up into the corner
  }
  const pillTop = pillPosition === 'top' && !!tag;
  const pillBottom = !!tag && !pillTop;
  const topRating = RATING_TOP() && info?.ratings?.length ? info.ratings : null;
  if (topRating) info = { ...info, ratings: [] }; // drawn in the corner instead
  const hasMeta = !!(info && (info.genre || info.ratings?.length));
  const chipBottom = (pillBottom ? L.H - L.pillH : L.H) - L.metaGap;
  const aboveChip = hasMeta ? L.metaChipH + L.metaGap : 0;
  if (logoImg) drawLogo(ctx, logoImg, L, pillBottom, aboveChip + (pillBottom ? 0 : L.metaGap));
  if (hasMeta) drawMetaChip(ctx, L, info, chipBottom);

  // Only portrait posters are narrow enough for a 2-digit rank to hit a top pill,
  // and only the rank (with the icon under it) needs to move.
  const topOffset = pillTop && L.shiftForTopPill && rank ? L.pillH + 4 : 0;
  if (info) drawProviderIcon(ctx, L, info.providerImg, !!rank, topOffset);
  if (rank) drawRank(ctx, rank, L, topOffset);
  if (topRating) drawRatingBadge(ctx, L, topRating, (pillTop && L.shiftForTopPill ? L.pillH + 4 : 0));
  if (tag) drawTagPill(ctx, tag, L, pillTop ? 'top' : 'bottom', pillColor);   // last, so it blurs the finished image
}

function composePoster(posterImg, rank, tag, logoImg = null, info = null) {
  const L = layoutFor('poster');
  const canvas = createCanvas(Math.round(L.W * L.S), Math.round(L.H * L.S));
  const ctx = canvas.getContext('2d');
  ctx.scale(L.S, L.S);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(posterImg, 0, 0, L.W, L.H);
  const pillPosition = PILL_POSITION();
  drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition, pillColor: pillColorFor(ctx, L, pillPosition) });
  return canvas;
}

function composeBackdrop(backdropImg, logoImg, rank, tag, info = null) {
  const L = layoutFor('backdrop');
  const canvas = createCanvas(Math.round(L.W * L.S), Math.round(L.H * L.S));
  const ctx = canvas.getContext('2d');
  ctx.scale(L.S, L.S);
  ctx.imageSmoothingQuality = 'high';
  drawCover(ctx, backdropImg, L);
  const pillPosition = LANDSCAPE_PILL_POSITION();
  drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition, pillColor: pillColorFor(ctx, L, pillPosition) });
  return canvas;
}

// Download the big version of an image, but if it's slow or fails use the smaller one,
// so a render never times out. Vercel caches the finished image, so this download only
// happens about once per title.
async function loadImageWithFallback(bigUrl, smallUrl, timeoutMs = 5000) {
  try {
    return await fetchImage(bigUrl, timeoutMs);
  } catch (e) {
    console.error('Large image slow/failed, using smaller one:', e.message);
    return fetchImage(smallUrl);
  }
}

// There are only a few dozen streaming services, so keep their icons in memory
// instead of downloading the same Netflix icon for every poster.
const providerIcons = new Map();
function loadProviderIcon(logoPath) {
  if (!logoPath) return null;
  if (!providerIcons.has(logoPath)) {
    const p = fetchImage(`https://image.tmdb.org/t/p/w154${logoPath}`)
      .catch(e => { console.error('Provider logo failed:', e.message); providerIcons.delete(logoPath); return null; });
    providerIcons.set(logoPath, p);
  }
  return providerIcons.get(logoPath);
}

function loadOneLogo(logoPath) {
  return loadImageWithFallback(
    `https://image.tmdb.org/t/p/original${logoPath}`,
    `https://image.tmdb.org/t/p/w500${logoPath}`
  ).catch(e => { console.error('Logo load failed:', e.message); return null; });
}

// A pixel counts as "coloured" when its strongest and weakest channels differ a lot
// (red, blue, ...); otherwise it's black, grey or white.
const isColoured = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) >= 60;

// How the logo looks, measured on a small copy:
//   bright   (0-1) average of each visible pixel's brightest colour channel. Using the
//            brightest channel (not brightness as the eye sees it) means a strong red
//            counts as bright: Resident Evil's red logo scores 0.76, black scores 0.
//   coloured (0-1) share of visible pixels that are coloured: 0 for a plain black logo,
//            0.2 for Gachiakuta's black letters with a red outline.
function logoTone(img) {
  const w = 96;
  const h = Math.max(1, Math.round(img.height * w / img.width));
  const ctx = createCanvas(w, h).getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let weight = 0, bright = 0, coloured = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 0.15) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    bright += a * Math.max(r, g, b) / 255;
    if (isColoured(r, g, b)) coloured += a;
    weight += a;
  }
  return weight ? { bright: bright / weight, coloured: coloured / weight } : { bright: 1, coloured: 0 };
}
const isDark = tone => tone.bright < 0.3;

// A black/grey logo redrawn light: its black/grey parts are flipped to white/light grey,
// keeping their shading.
function lightenGreys(img) {
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    if (!isColoured(r, g, b)) {
      px[i] = 255 - r; px[i + 1] = 255 - g; px[i + 2] = 255 - b;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

// Logos sit on a dark gradient, so a plain black logo is almost invisible. The best logo
// is kept as it is when it's bright (e.g. Resident Evil's red one) or when it's dark but
// has its own colours (e.g. Gachiakuta's black letters with a red outline). Only a plain
// black/grey logo is swapped for a light version of it when TMDB has one (e.g. Beast Race
// has black and white logos), or else redrawn light (see lightenGreys).
async function loadLogo(logoPaths) {
  if (!logoPaths?.length) return null;
  const [first, ...rest] = logoPaths;
  const img = await loadOneLogo(first);
  if (!img) return null;
  const tone = logoTone(img);
  if (!isDark(tone) || tone.coloured >= 0.05) return img;
  for (const other of await Promise.all(rest.map(loadOneLogo))) {
    if (other && !isDark(logoTone(other))) return other;
  }
  return lightenGreys(img);
}

// Encode in the background (doesn't block other renders running at the same time).
const JPEG_QUALITY = Math.min(95, Math.max(60,
  Number(process.env.JPEG_QUALITY) || (IMAGE_QUALITY === 'high' ? 92 : 85)));
const toJpeg = canvas => canvas.encode('jpeg', JPEG_QUALITY);

async function generatePoster(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { posterPath, logoPaths } = await getPosterAssets(type, tmdbId, opts.images, !!rank);
    if (!posterPath) throw new Error('Poster not found');
    const info = opts.info || null;
    const [posterImg, logoImg, providerImg] = await Promise.all([
      // Shrinking the full-size original gives a sharper poster than TMDB's w780 copy
      // (which is already compressed once). Falls back to w780 if it's slow.
      loadImageWithFallback(
        `https://image.tmdb.org/t/p/original${posterPath}`,
        `https://image.tmdb.org/t/p/w780${posterPath}`
      ),
      loadLogo(logoPaths),
      loadProviderIcon(info?.providerLogoPath)
    ]);
    // No logo of our own means the poster has its title printed in it (no textless art on
    // TMDB); the genre/scores line would sit on top of that title, so leave it out.
    // Scores in the top-right badge are nowhere near the title, so those stay.
    const ownTitle = logoPaths.length > 0;
    const infoForDraw = info
      ? { genre: ownTitle ? info.genre : null, ratings: ownTitle || RATING_TOP() ? info.ratings : [], providerImg }
      : null;
    return await toJpeg(composePoster(posterImg, rank, tag, logoImg, infoForDraw));
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

async function generateBackdrop(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { backdropPath, logoPaths } = await getBackdropAssets(type, tmdbId, opts.images);
    if (!backdropPath) throw new Error('Backdrop not found');
    const info = opts.info || null;
    const [backdropImg, logoImg, providerImg] = await Promise.all([
      // Full-size original, shrunk to our size; falls back to w1280 if slow.
      loadImageWithFallback(
        `https://image.tmdb.org/t/p/original${backdropPath}`,
        `https://image.tmdb.org/t/p/w1280${backdropPath}`
      ),
      // noLogo: the app lays its own title logo on this image, so don't draw ours too
      opts.noLogo ? null : loadLogo(logoPaths),
      loadProviderIcon(info?.providerLogoPath)
    ]);
    const infoForDraw = info ? { genre: info.genre, ratings: info.ratings || [], providerImg } : null;
    return await toJpeg(composeBackdrop(backdropImg, logoImg, rank, tag, infoForDraw));
  } catch (err) {
    console.error('Error generating backdrop:', err.message);
    if (opts.throwErrors) throw err;   // used by ?debug=1 so you can see the real error
    return null;
  }
}

module.exports = { generatePoster, generateBackdrop, composePoster, composeBackdrop };