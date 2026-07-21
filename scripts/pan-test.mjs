import { analyzePangram } from './pangram.mjs';

console.log(JSON.stringify(analyzePangram(process.argv.slice(2).join(' ')), null, 2));
