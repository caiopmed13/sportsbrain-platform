// ══════════════════════════════════════════════════════════════════════════
// Static venue → lat/lng map (top stadiums + NBA arenas)
// Keys are lowercased/normalized. Used by weather + travel enrichment.
// ══════════════════════════════════════════════════════════════════════════

export const VENUES = {
  // Europe — soccer
  'wembley':              { lat: 51.5560, lng: -0.2796, tz: 'Europe/London' },
  'old trafford':         { lat: 53.4631, lng: -2.2913, tz: 'Europe/London' },
  'anfield':              { lat: 53.4308, lng: -2.9608, tz: 'Europe/London' },
  'emirates':             { lat: 51.5549, lng: -0.1084, tz: 'Europe/London' },
  'stamford bridge':      { lat: 51.4817, lng: -0.1910, tz: 'Europe/London' },
  'etihad':               { lat: 53.4831, lng: -2.2004, tz: 'Europe/London' },
  'tottenham hotspur stadium': { lat: 51.6043, lng: -0.0666, tz: 'Europe/London' },
  'camp nou':             { lat: 41.3809, lng:  2.1228, tz: 'Europe/Madrid' },
  'santiago bernabeu':    { lat: 40.4530, lng: -3.6883, tz: 'Europe/Madrid' },
  'metropolitano':        { lat: 40.4362, lng: -3.5995, tz: 'Europe/Madrid' },
  'san siro':             { lat: 45.4781, lng:  9.1240, tz: 'Europe/Rome' },
  'giuseppe meazza':      { lat: 45.4781, lng:  9.1240, tz: 'Europe/Rome' },
  'allianz stadium':      { lat: 45.1096, lng:  7.6413, tz: 'Europe/Rome' },
  'olimpico':             { lat: 41.9339, lng: 12.4547, tz: 'Europe/Rome' },
  'allianz arena':        { lat: 48.2188, lng: 11.6247, tz: 'Europe/Berlin' },
  'signal iduna park':    { lat: 51.4925, lng:  7.4519, tz: 'Europe/Berlin' },
  'parc des princes':     { lat: 48.8414, lng:  2.2530, tz: 'Europe/Paris' },
  'velodrome':            { lat: 43.2699, lng:  5.3959, tz: 'Europe/Paris' },
  'estadio da luz':       { lat: 38.7529, lng: -9.1844, tz: 'Europe/Lisbon' },
  'estadio do dragao':    { lat: 41.1617, lng: -8.5836, tz: 'Europe/Lisbon' },
  'johan cruijff arena':  { lat: 52.3142, lng:  4.9417, tz: 'Europe/Amsterdam' },

  // South America
  'maracana':             { lat: -22.9122, lng: -43.2302, tz: 'America/Sao_Paulo' },
  'morumbi':              { lat: -23.5994, lng: -46.7200, tz: 'America/Sao_Paulo' },
  'allianz parque':       { lat: -23.5275, lng: -46.6782, tz: 'America/Sao_Paulo' },
  'neo quimica arena':    { lat: -23.5453, lng: -46.4742, tz: 'America/Sao_Paulo' },
  'mineirao':             { lat: -19.8656, lng: -43.9711, tz: 'America/Sao_Paulo' },
  'monumental':           { lat: -34.5453, lng: -58.4497, tz: 'America/Argentina/Buenos_Aires' },
  'la bombonera':         { lat: -34.6355, lng: -58.3644, tz: 'America/Argentina/Buenos_Aires' },

  // NBA arenas
  'madison square garden':   { lat: 40.7505, lng: -73.9934, tz: 'America/New_York' },
  'tdBank garden':           { lat: 42.3662, lng: -71.0621, tz: 'America/New_York' },
  'td garden':               { lat: 42.3662, lng: -71.0621, tz: 'America/New_York' },
  'crypto.com arena':        { lat: 34.0430, lng: -118.2673, tz: 'America/Los_Angeles' },
  'chase center':            { lat: 37.7680, lng: -122.3877, tz: 'America/Los_Angeles' },
  'united center':           { lat: 41.8807, lng: -87.6742, tz: 'America/Chicago' },
  'american airlines center': { lat: 32.7905, lng: -96.8103, tz: 'America/Chicago' },
  'kaseya center':           { lat: 25.7814, lng: -80.1870, tz: 'America/New_York' },
  'ball arena':              { lat: 39.7487, lng: -105.0077, tz: 'America/Denver' },
  'phoenix suns arena':      { lat: 33.4457, lng: -112.0712, tz: 'America/Phoenix' },
  'footprint center':        { lat: 33.4457, lng: -112.0712, tz: 'America/Phoenix' },
  'fiserv forum':            { lat: 43.0451, lng: -87.9172, tz: 'America/Chicago' },
  'rocket mortgage fieldhouse': { lat: 41.4965, lng: -81.6882, tz: 'America/New_York' },
  'paycom center':           { lat: 35.4634, lng: -97.5151, tz: 'America/Chicago' },
  'scotiabank arena':        { lat: 43.6434, lng: -79.3791, tz: 'America/Toronto' },
};

// Normalizer for venue-name lookups
export function normVenue(name) {
  return (name || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lookupVenue(name) {
  if (!name) return null;
  const key = normVenue(name);
  if (VENUES[key]) return VENUES[key];
  // Loose contains match
  for (const k of Object.keys(VENUES)) {
    if (key.includes(k) || k.includes(key)) return VENUES[k];
  }
  return null;
}

// Haversine distance in km
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
