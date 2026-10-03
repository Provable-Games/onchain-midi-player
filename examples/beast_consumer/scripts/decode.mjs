#!/usr/bin/env node
// Decodes any token_uri (for example one captured from the Cairo contract) into its layers.
//
// Usage: node scripts/decode.mjs <token_uri.txt | -> [out_dir]
//   Reads the token_uri string from a file (or stdin with "-"), checks every base64 layer is
//   canonical standard base64, and writes token.json, image.svg and animation.html to out_dir
//   (default: the current directory).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTokenUri } from './reference.mjs';

const [src, outDir = '.'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/decode.mjs <token_uri.txt | -> [out_dir]');
  process.exit(2);
}
const uri = readFileSync(src === '-' ? 0 : src, 'latin1').trim();
const { json, svg, html } = decodeTokenUri(uri);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'token.json'), JSON.stringify(json, null, 2) + '\n');
writeFileSync(join(outDir, 'image.svg'), svg);
writeFileSync(join(outDir, 'animation.html'), html);
console.log(`name: ${json.name}`);
console.log(`image: ${svg.length} bytes of SVG; animation_url: ${html.length} bytes of HTML`);
console.log(`wrote token.json, image.svg, animation.html to ${outDir}`);
