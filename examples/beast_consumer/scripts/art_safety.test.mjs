import assert from 'node:assert/strict';import{test}from'node:test';
import{scriptTextSvg,tokenParts}from'./reference.mjs';import{spliceTokenUri}from'../../../scripts/composition.mjs';import{decodeTokenUri}from'../../../scripts/segments.mjs';
test('script-like art survives byte-for-byte inside isolated image; scripts follow it',()=>{const p=tokenParts(1);p.svg=scriptTextSvg(p.name,p.tier);const dec=decodeTokenUri(spliceTokenUri(p));assert.equal(dec.svg,p.svg);assert.ok(!dec.html.includes('window.artInjection'));assert.ok(dec.html.indexOf('beast-bootstrap')>dec.html.indexOf('beast-art'));});
