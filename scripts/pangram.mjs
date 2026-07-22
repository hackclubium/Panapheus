const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

export function isPangram(text) {
  return analyzePangram(text).ok;
}

export function analyzePangram(text) {
  if (typeof text !== 'string') return { ok: false, letters: [], missing: [...ALPHABET] };
  if (/```|`/.test(text)) return { ok: false, letters: [], missing: [...ALPHABET], reason: 'code' };

  const seen = new Set(stripSlackNoise(text).toLowerCase().match(/[a-z]/g) ?? []);
  const letters = [...ALPHABET].filter((letter) => seen.has(letter));
  const missing = [...ALPHABET].filter((letter) => !seen.has(letter));

  return { ok: missing.length === 0, letters, missing };
}

function stripSlackNoise(text) {
  return text
    .replace(/<[a-z][a-z0-9+.-]*:\/\/[^>]*>/gi, ' ')
    .replace(/<[^>\s|]+\|[^>]*>/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/<[@#!][A-Z0-9][^>]*>/g, ' ')
    .replace(/<![^>]+>/g, ' ')
    .replace(/\b(?=[A-Z0-9]{8,}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, ' ')
    .replace(/(^|\n)>\s?/g, '$1')
    .replace(/[*_~]/g, '');
}
