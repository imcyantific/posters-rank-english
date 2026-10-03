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

function movieTag(d, t) {
  const rd = dayNum(d.release_date);
  if (rd === null) return 'Coming Soon';
  if (rd > t) return `Coming ${fmt(d.release_date)}`;
  const age = t - rd;
  if (age <= 30) return 'Just Added';
  if (age <= 60) return 'In Theaters';
  return 'Now Streaming';
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

  return 'Now Streaming';
}

function determineTag(details, type) {
  const t = todayNum();
  return type === 'tv' ? tvTag(details || {}, t) : movieTag(details || {}, t);
}

module.exports = { determineTag, dayNum, todayNum };