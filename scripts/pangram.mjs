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
    .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[@#!][A-Z0-9][^>]*>/g, ' ')
    .replace(/<![^>]+>/g, ' ')
    .replace(/(^|\n)>\s?/g, '$1')
    .replace(/[*_~]/g, '');
}
