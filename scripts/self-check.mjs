import assert from 'node:assert/strict';
import { analyzePangram, isPangram } from './pangram.mjs';

const pangram = 'The quick brown fox jumps over the lazy dog';
assert.equal(isPangram(pangram), true);
assert.deepEqual(analyzePangram(pangram).missing, []);
assert.equal(isPangram('not a pangram'), false);
assert.deepEqual(analyzePangram('abc').missing.slice(0, 3), ['d', 'e', 'f']);
assert.equal(isPangram('`The quick brown fox jumps over the lazy dog`'), false);

console.log('ok');
