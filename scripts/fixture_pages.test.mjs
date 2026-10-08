import assert from 'node:assert/strict';import{test}from'node:test';
import{FIXTURES,fixtureCase,tokenPage}from'./fixture_pages.mjs';import{verifyLibraries}from'./verify_engine.mjs';
test('all consumer-owned fixture pages match independently generated Cairo digests',()=>{for(const c of FIXTURES.valid){const p=tokenPage(c);assert.equal(p.uri.length,c.token_uri.len);assert.equal(Buffer.byteLength(p.html),c.animation_html.len);assert.equal(verifyLibraries(p.html).version,FIXTURES.version);}});
test('fixture lookup rejects unknown input',()=>assert.throws(()=>fixtureCase('absent'),/unknown fixture/));
