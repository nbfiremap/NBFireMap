/* =========================================================================
   NBFireMap - Utilities Module
   Pure utility functions with no side effects
   ========================================================================= */

// Compass direction conversion
const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','S','SSW','SW','WSW','W','WNW','NW','NNW','N'];
const degToCompass = (deg) => Number.isFinite(deg) ? COMPASS_16[Math.round((((deg % 360)+360)%360) / 22.5)] : '—';

// Number formatting
const toNum = (v, d=1) => (v==null || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d });

// Date/time formatting
const ATLANTIC_TZ = 'America/Moncton';
const fmtDateTime = (ms) => ms == null ? '—' : new Date(+ms).toLocaleString(undefined, { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });

const fmtDateTimeTz = (ms, tz = ATLANTIC_TZ) =>
  ms == null ? '—' : new Date(+ms).toLocaleString(undefined, {
    year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', timeZone: tz
  });

const fmtDateTZ = (ms, tz=ATLANTIC_TZ) => ms == null ? '—' : new Date(+ms).toLocaleDateString(undefined, { year:'numeric', month:'2-digit', day:'2-digit', timeZone: tz });

// Date comparisons (in a TZ) - Advanced version
const ymdInTz = (ms, tz = ATLANTIC_TZ) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (k) => +parts.find(p => p.type === k)?.value;
  return { y: get('year'), m: get('month'), d: get('day') };
};

const sameYMD = (a, b, tz = ATLANTIC_TZ) => {
  if (a == null || b == null) return false;
  const A = ymdInTz(a, tz), B = ymdInTz(b, tz);
  return A.y === B.y && A.m === B.m && A.d === B.d;
};

const startOfTodayUTCfromTz = (tz = ATLANTIC_TZ) => {
  const t = ymdInTz(Date.now(), tz);
  return Date.UTC(t.y, t.m - 1, t.d);
};

// String normalization
const norm = (s) => (s || '').toString().trim().toLowerCase();

// HTML escaping
const escHTML = (s) => (s??'').toString().replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// Responsive detection
const isMobile = () => innerWidth < 768;

// Export utilities object
window.NBFireMapUtils = {
  degToCompass,
  toNum,
  fmtDateTime,
  fmtDateTimeTz,
  fmtDateTZ,
  ymdInTz,
  sameYMD,
  startOfTodayUTCfromTz,
  norm,
  escHTML,
  isMobile,
  ATLANTIC_TZ
};