// The art rule (docs/token-uri-layout.md, "Art (SVG) requirements"): the SVG must never contain `</script`, in
// any letter case. In the animation_url page the SVG is the raw text of the last block,
// <script type="text/plain" id="art">, and the HTML parser ends that block at the first
// `</script`: the art is cut short and the rest of the SVG is parsed as page markup. The class never
// sees the SVG, so the rule belongs in the consumer's own tests: assertArtSafe here, and
// tests/test_art_safety.cairo on the contract's rendered SVG. browser_check.mjs shows the same
// failure in Chromium.
//
// Run from examples/beast_consumer:  node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artUrl } from '../../../player/player.js';
import {
  MIDI, TOKENS, animationHtml, assertArtSafe, decodeTokenUri, dFragment, members, naiveTokenUri, page,
  parseArtBlock, renderSvg, settingsFor, spliceTokenUri, tokenParts, unsafeSvg,
} from './reference.mjs';

for (const id of [1, 2, 3]) {
  test(`token ${id}: the SVG is art-safe and the parsed art block is the whole SVG`, () => {
    const { svg } = tokenParts(id);
    assert.equal(assertArtSafe(svg), svg);
    assert.deepEqual(parseArtBlock(animationHtml(id)), { art: svg, rest: '' });
  });
}

/** Token 1 with `svg` as its art, spliced and decoded as a marketplace would. */
function decodedWithArt(svg) {
  const { name, tier } = TOKENS[1];
  const parts = { mem: members(1, name, tier), svg, pageHtml: page(), d: dFragment(MIDI, settingsFor(1)).d };
  const uri = spliceTokenUri(parts);
  // The token_uri itself is still valid: the layout does not depend on the SVG's contents.
  assert.equal(uri, naiveTokenUri(parts));
  return decodeTokenUri(uri);
}

const { name, tier } = TOKENS[1];
const insert = (extra) => renderSvg(name, tier).replace('</svg>', `${extra}</svg>`);
const unsafe = [
  ['a <script> element', unsafeSvg(name, tier), '</script>'],
  ['a comment containing </SCRIPT>', insert('<!-- not a </SCRIPT> tag --><text>leaked</text>'), '</SCRIPT>'],
  ['CDATA containing </Script', insert('<desc><![CDATA[</Script\n>]]></desc>'), '</Script\n'],
];
for (const [label, svg, close] of unsafe) {
  test(`an SVG with ${label} is truncated when the page is decoded and parsed`, () => {
    assert.throws(() => assertArtSafe(svg), /^Error: SVG contains "<\/script"/i);
    const dec = decodedWithArt(svg);
    // The marketplace `image` still decodes to the whole SVG, so the failure does not show there.
    assert.equal(dec.svg, svg);
    assert.ok(dec.html.endsWith(svg));
    // The page's art block ends at the SVG's first `</script`, and the rest is parsed as markup.
    const cut = svg.indexOf(close);
    const { art, rest } = parseArtBlock(dec.html);
    assert.equal(art, svg.slice(0, cut));
    assert.equal(rest, svg.slice(cut));
    assert.match(rest, /<\/svg>$/);
    // The player shows a different (and malformed) image.
    assert.notEqual(artUrl(art), artUrl(svg));
  });
}

test('the leaked rest of a <script> element SVG holds the art as page elements', () => {
  const { rest } = parseArtBlock(decodedWithArt(unsafeSvg(name, tier)).html);
  for (const tag of ['<style>', '<rect ', `class='n'>${name}</text>`, '<foreignObject ']) assert.ok(rest.includes(tag), tag);
});

test('assertArtSafe allows text that only resembles `</script`', () => {
  // XML escapes `<` in text content, so text can only mention the tag, never form it.
  for (const svg of ['<svg><text>&lt;/script&gt;</text></svg>', '<svg><desc>a /script path, &lt;script&gt;</desc></svg>']) {
    assert.equal(assertArtSafe(svg), svg);
    assert.equal(parseArtBlock(`${page()}${dFragment(MIDI, settingsFor(1)).d}${svg}`).art, svg);
  }
});
