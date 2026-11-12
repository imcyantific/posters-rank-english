// Look-and-feel options that can be chosen per install on the /configure page.
//
// A configured install uses links like  https://HOST/c/<code>/manifest.json
// where <code> is the chosen options as base64url JSON. Every request under /c/<code>/
// renders with those options; plain links (no /c/...) use the server's .env values.
// Server-only settings (TMDB key, cache, image quality, POSTER_SKIP, ...) stay in .env.
const { AsyncLocalStorage } = require('async_hooks');

const onOff = (v, def) => {
  const s = String(v ?? '').toLowerCase();
  if (s === 'on' || s === 'true' || s === '1') return true;
  if (s === 'off' || s === 'false' || s === '0') return false;
  return def;
};
const oneOf = (values, def) => v => {
  const s = String(v ?? '').toLowerCase();
  return values.includes(s) ? s : def;
};

// key: short name used in the link code. env: the .env setting it replaces.
const SCHEMA = {
  catalogArt:    { key: 'ca', env: 'CATALOG_ART', def: 'plain', parse: oneOf(['plain', 'poster', 'ranked', 'nologo'], 'plain') },
  heroLogo:      { key: 'hl', env: 'META_LOGO', def: true, parse: v => onOff(v, true) },
  posterStyle:   { key: 'ps', env: 'POSTER_STYLE', def: 'always', parse: oneOf(['always', 'logo', 'original'], 'always') },
  // color = a solid tab in a colour taken from the artwork
  pillStyle:     { key: 'pl', env: 'PILL_STYLE', def: 'frosted', parse: oneOf(['frosted', 'glass', 'color'], 'frosted') },
  pillSize:      { key: 'pz', env: 'PILL_SIZE', def: 0.8, parse: v => Math.min(1.5, Math.max(0.5, Number(v) || 0.8)) },
  pillPosition:  { key: 'pp', env: 'PILL_POSITION', def: 'bottom', parse: oneOf(['bottom', 'top'], 'bottom') },
  // 'same' = follow pillPosition
  landscapePill: { key: 'lp', env: 'LANDSCAPE_PILL_POSITION', def: 'same', parse: oneOf(['same', 'bottom', 'top'], 'same') },
  // pill = "Top 1 Today" in the pill, hash = "#1 Today" in the pill, number = big number
  rankStyle:     { key: 'rs', env: 'RANK_STYLE', def: 'pill', parse: oneOf(['pill', 'hash', 'number'], 'pill') },
  showInfo:      { key: 'in', env: 'POSTER_INFO', def: true, parse: v => onOff(v, true) },
  showMeta:      { key: 'me', env: 'POSTER_META', def: true, parse: v => onOff(v, true) },
  showGenre:     { key: 'ge', env: 'POSTER_GENRE', def: true, parse: v => onOff(v, true) },
  ratingPos:     { key: 'rp', env: 'RATING_POSITION', def: 'bottom',
                   parse: v => (['top-right', 'top', 'topright'].includes(String(v ?? '').toLowerCase()) ? 'top-right' : 'bottom') },
  // Which scores go in the rating line, e.g. "imdb,tmdb,rt" (always drawn in that order).
  // IMDb and Rotten Tomatoes need MDBLIST_API_KEY on the server (see ratings.js).
  ratings:       { key: 'ra', env: 'RATINGS', def: 'imdb,tmdb,rt', parse: v => {
                   const want = String(v ?? '').toLowerCase().split(/[\s,]+/);
                   return ['imdb', 'tmdb', 'rt'].filter(s => want.includes(s)).join(',');
                 } },
  // Movie Top 10 skips titles still only in cinemas (no digital release yet). Shows aren't affected.
  digitalOnly:   { key: 'do', env: 'DIGITAL_ONLY', def: false, parse: v => onOff(v, false) },
  metaChip:      { key: 'mc', env: 'META_CHIP', def: false, parse: v => onOff(v, false) },
  region:        { key: 're', env: 'PROVIDER_REGION', def: 'NZ',
                   parse: v => (/^[a-z]{2}$/i.test(String(v ?? '')) ? String(v).toUpperCase() : 'NZ') }
};

// Defaults from .env (or the built-in default when a setting isn't in .env).
function envDefaults() {
  const out = {};
  for (const [name, o] of Object.entries(SCHEMA)) {
    const raw = process.env[o.env];
    out[name] = raw === undefined || raw === '' ? o.def : o.parse(raw);
  }
  return out;
}
const ENV_DEFAULTS = envDefaults();
const BUILT_IN = Object.fromEntries(Object.entries(SCHEMA).map(([name, o]) => [name, o.def]));

// <code> -> options. Options missing from the code mean the built-in default (not .env),
// so a link always means the same thing. Unknown keys are ignored, bad values fall back.
function decode(code) {
  let raw;
  try {
    raw = JSON.parse(Buffer.from(String(code), 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const out = { ...BUILT_IN };
  for (const [name, o] of Object.entries(SCHEMA)) {
    if (raw[o.key] !== undefined) out[name] = o.parse(raw[o.key]);
  }
  return out;
}

// options -> <code>. Only options that differ from the built-in defaults are written,
// to keep links short. (The /configure page does the same in the browser.)
function encode(opts) {
  const raw = {};
  for (const [name, o] of Object.entries(SCHEMA)) {
    if (opts[name] !== undefined && opts[name] !== o.def) raw[o.key] = opts[name];
  }
  return Buffer.from(JSON.stringify(raw), 'utf8').toString('base64url');
}

// The options for the request being handled right now.
const store = new AsyncLocalStorage();
const current = () => store.getStore() || { opts: ENV_DEFAULTS, prefix: '' };
const opt = name => current().opts[name];
// "/c/<code>" for configured installs, "" otherwise. Put in front of links we hand out.
const prefix = () => current().prefix;

// Express middleware: strips /c/<code> from the URL and runs the rest of the request
// with those options. Must come before the routes and the disk cache (the cache keys on
// the original URL, so each configuration gets its own cached images).
function configMiddleware(req, res, next) {
  const m = /^\/c\/([A-Za-z0-9_-]{1,800})(\/.*)?$/.exec(req.path);
  if (!m) return store.run({ opts: ENV_DEFAULTS, prefix: '' }, next);
  const opts = decode(m[1]);
  if (!opts) return res.status(400).type('text/plain').send('This link has a broken settings code. Make a new one on /configure.');
  const q = req.url.indexOf('?');
  req.url = (m[2] || '/') + (q >= 0 ? req.url.slice(q) : '');
  return store.run({ opts, prefix: `/c/${m[1]}` }, next);
}

module.exports = { SCHEMA, ENV_DEFAULTS, BUILT_IN, decode, encode, opt, prefix, configMiddleware };
