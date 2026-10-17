/** Geohash base32 encoding, implemented from the public bit-interleaving format. */
const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
export function normalizeGeohash(input: string): string {
  const hash = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(hash)) throw new Error('Invalid geohash');
  return hash;
}
export function encodeGeohash(latitude: number, longitude: number, precision = 5): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180 || !Number.isInteger(precision) || precision < 1 || precision > 12)
    throw new Error('Invalid coordinates or precision');
  const lat = [-90, 90], lon = [-180, 180];
  let hash = '', value = 0;
  for (let bit = 0; bit < precision * 5; bit++) {
    const range = bit % 2 === 0 ? lon : lat, coordinate = bit % 2 === 0 ? longitude : latitude;
    const mid = (range[0] + range[1]) / 2, upper = coordinate >= mid;
    value = (value << 1) | Number(upper); range[upper ? 0 : 1] = mid;
    if (bit % 5 === 4) { hash += alphabet[value]; value = 0; }
  }
  return hash;
}
export function geohashBounds(input: string) {
  const hash = normalizeGeohash(input), lat = [-90, 90], lon = [-180, 180];
  let bit = 0;
  for (const character of hash) for (let mask = 16; mask; mask >>= 1) {
    const range = bit++ % 2 === 0 ? lon : lat;
    range[alphabet.indexOf(character) & mask ? 0 : 1] = (range[0] + range[1]) / 2;
  }
  return { south: lat[0], north: lat[1], west: lon[0], east: lon[1] };
}
