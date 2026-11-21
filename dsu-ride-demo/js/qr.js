// Decorative, deterministic QR-style pattern for the scan screen. Not a real, scannable QR code.
import { escapeHtml } from './html.js';

export function qrSvg(seed) {
  let h = 7;
  for (const ch of seed) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  let cells = '';
  for (let y = 0; y < 17; y++) {
    for (let x = 0; x < 17; x++) {
      const finder = (x < 6 && y < 6) || (x > 10 && y < 6) || (x < 6 && y > 10);
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      if (!finder && (h >>> 16) % 2) cells += `<rect x="${x * 8}" y="${y * 8}" width="8" height="8"/>`;
    }
  }
  const finderAt = (x, y) =>
    `<rect x="${x + 2}" y="${y + 2}" width="44" height="44" fill="none" stroke="#171f1c" stroke-width="8"/>` +
    `<rect x="${x + 16}" y="${y + 16}" width="16" height="16"/>`;
  return (
    `<svg viewBox="0 0 136 136" width="100%" fill="#171f1c" role="img" aria-label="QR code on scooter ${escapeHtml(seed)}">` +
    `${cells}${finderAt(0, 0)}${finderAt(88, 0)}${finderAt(0, 88)}</svg>`
  );
}
