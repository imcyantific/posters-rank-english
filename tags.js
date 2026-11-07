// Decides which text goes on the bottom pill.
// Needs the TMDB *details* object (for TV it must include next_episode_to_air,
// last_episode_to_air and seasons, which /tv/{id} returns by default).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> whole days since 1970 (no timezone surprises)
function dayNum(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d) / 86400000;
}

function todayNum() {
  const n = new Date();
  return Math.floor(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) / 86400000);
}

function fmt(dateStr) {
  const [, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

// Streaming / rent / buy offers for one country (falls back to US, then any country).
function offersFor(d, region) {
  const regions = d['watch/providers']?.results || {};
  const r = regions[region] || regions.US || Object.values(regions)[0] || {};
  return { stream: (r.flatrate || []).length > 0, rentBuy: (r.rent || []).length + (r.buy || []).length > 0 };
}

// 136 -> "2h 16m", 45 -> "45m"
function runtime(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function movieTag(d, t, region) {
  const rd = dayNum(d.release_date);
  if (rd === null) return 'Coming Soon';
  if (rd > t) return `Coming ${fmt(d.release_date)}`;
  const age = t - rd;
  if (age <= 30) return 'Just Added';
  if (age <= 60) return 'In Theaters';
  // Up to ~6 months after release: say where it is now.
  if (age <= 180) {
    const { stream, rentBuy } = offersFor(d, region);
    if (stream) return 'Now Streaming';
    if (rentBuy) return 'Rent or Buy';
  }
  // Older films: year + running time, e.g. "1999 · 2h 16m".
  const year = String(d.release_date).slice(0, 4);
  const rt = runtime(d.runtime);
  return rt ? `${year} \u00b7 ${rt}` : year;
}

function tvTag(d, t) {
  const first = dayNum(d.first_air_date);
  const last = d.last_episode_to_air || null;
  const next = d.next_episode_to_air || null;
  const lastDay = last ? dayNum(last.air_date) : null;
  const nextDay = next ? dayNum(next.air_date) : null;

  // 1. Whole show isn't out yet
  if (first !== null && first > t) return `Coming ${fmt(d.first_air_date)}`;
  if (first === null && !last) return 'Coming Soon';

  // 2. A season finale is coming up soon -> "Finale Oct 4"
  if (next && next.episode_type === 'finale' && nextDay !== null && nextDay >= t && nextDay - t <= 14) {
    return `Finale ${fmt(next.air_date)}`;
  }

  // 3. Brand new show (started in the last 14 days) -> "Premiere"
  if (first !== null && t - first <= 14) return 'Premiere';

  // 4. A later season started in the last 21 days -> "New Season"
  if (last && last.season_number > 1) {
    const season = (d.seasons || []).find(s => s.season_number === last.season_number);
    const sDay = season ? dayNum(season.air_date) : null;
    if (sDay !== null && t - sDay >= 0 && t - sDay <= 21) return 'New Season';
  }

  // 5. A season finale just aired
  if (last && last.episode_type === 'finale' && lastDay !== null && t - lastDay >= 0 && t - lastDay <= 3) {
    return 'Finale';
  }

  // 6. An episode aired in the last 7 days -> "New Episode"
  if (lastDay !== null && t - lastDay >= 0 && t - lastDay <= 7) return 'New Episode';

  // 7. A new season starts within 30 days -> "Coming Oct 12"
  if (next && next.episode_number === 1 && nextDay !== null && nextDay > t && nextDay - t <= 30) {
    return `Coming ${fmt(next.air_date)}`;
  }

  // 8. The next episode airs within 7 days -> "New Ep Nov 12"
  if (next && nextDay !== null && nextDay > t && nextDay - t <= 7) return `New Ep ${fmt(next.air_date)}`;

  // 9. A miniseries -> "Limited Series"
  if (d.type === 'Miniseries') return 'Limited Series';

  // 10. Otherwise how many seasons it has -> "6 Seasons"
  const n = d.number_of_seasons || (d.seasons || []).filter(s => s.season_number > 0).length;
  if (n > 0) return n === 1 ? '1 Season' : `${n} Seasons`;
  return 'Now Streaming';
}

// region: whose streaming offers to check (e.g. NZ), for "Now Streaming" vs "Rent or Buy".
function determineTag(details, type, region = 'US') {
  const t = todayNum();
  return type === 'tv' ? tvTag(details || {}, t) : movieTag(details || {}, t, region);
}

module.exports = { determineTag, dayNum, todayNum };