#!/usr/bin/env node
// Decodes any token_uri (for example one captured from the Cairo contract) into its layers.
//
// Usage: node scripts/decode.mjs <token_uri.txt | -> [out_dir]
//   Reads the token_uri string from a file (or stdin with "-"), checks every base64 layer is
//   canonical standard base64 and the JSON is valid UTF-8, and writes to out_dir (default: the
//   current directory):
//     image.svg, animation.html   the decoded bytes, unchanged (image.svg only when the image is a
//                                 base64 SVG data URI; any other image is reported, not written)
//     token.json                  the parsed JSON, pretty-printed as UTF-8

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTokenUriLayers } from '../../../scripts/page.mjs';

const [src, outDir = '.'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/decode.mjs <token_uri.txt | -> [out_dir]');
  process.exit(2);
}
// A token_uri is ASCII; decodeTokenUri rejects anything else.
const uri = readFileSync(src === '-' ? 0 : src, 'utf8').trim();
const { json, svgBytes, htmlBytes } = decodeTokenUriLayers(uri);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'token.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');
// No SVG image: remove an image.svg left from an earlier token, so it is never compared with this one.
if (svgBytes) writeFileSync(join(outDir, 'image.svg'), svgBytes);
else rmSync(join(outDir, 'image.svg'), { force: true });
writeFileSync(join(outDir, 'animation.html'), htmlBytes);
console.log(`name: ${json.name}`);
const image = svgBytes ? `${svgBytes.length} bytes of SVG` : `${JSON.stringify(String(json.image).slice(0, 60))} (not a base64 SVG data URI; not written)`;
console.log(`image: ${image}; animation_url: ${htmlBytes.length} bytes of HTML`);
console.log(`wrote token.json, ${svgBytes ? 'image.svg, ' : ''}animation.html to ${outDir}`);
