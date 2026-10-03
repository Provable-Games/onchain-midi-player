#!/usr/bin/env node
// Decodes any token_uri (for example one captured from the Cairo contract) into its layers.
//
// Usage: node scripts/decode.mjs <token_uri.txt | -> [out_dir]
//   Reads the token_uri string from a file (or stdin with "-"), checks every base64 layer is
//   canonical standard base64 and the JSON is valid UTF-8, and writes to out_dir (default: the
//   current directory):
//     image.svg, animation.html   the decoded bytes, unchanged
//     token.json                  the parsed JSON, pretty-printed as UTF-8

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTokenUri } from './reference.mjs';

const [src, outDir = '.'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/decode.mjs <token_uri.txt | -> [out_dir]');
  process.exit(2);
}
// A token_uri is ASCII; decodeTokenUri rejects anything else.
const uri = readFileSync(src === '-' ? 0 : src, 'utf8').trim();
const { json, svgBytes, htmlBytes } = decodeTokenUri(uri);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'token.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');
writeFileSync(join(outDir, 'image.svg'), svgBytes);
writeFileSync(join(outDir, 'animation.html'), htmlBytes);
console.log(`name: ${json.name}`);
console.log(`image: ${svgBytes.length} bytes of SVG; animation_url: ${htmlBytes.length} bytes of HTML`);
console.log(`wrote token.json, image.svg, animation.html to ${outDir}`);
