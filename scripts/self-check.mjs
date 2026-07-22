import assert from 'node:assert/strict';
import { analyzePangram, isPangram } from './pangram.mjs';

const pangram = 'The quick brown fox jumps over the lazy dog';
assert.equal(isPangram(pangram), true);
assert.equal(isPangram('*The* _quick_ ~brown~ fox jumps over the lazy dog'), true);
assert.equal(isPangram('<slack://canvas/C123|The quick brown fox jumps over the lazy dog>'), false);
assert.equal(isPangram('<F123ABC|The quick brown fox jumps over the lazy dog>'), false);
assert.deepEqual(analyzePangram(pangram).missing, []);
assert.equal(isPangram('not a pangram'), false);
assert.deepEqual(analyzePangram('abc').missing.slice(0, 3), ['d', 'e', 'f']);
assert.equal(isPangram('`The quick brown fox jumps over the lazy dog`'), false);

console.log('ok');
