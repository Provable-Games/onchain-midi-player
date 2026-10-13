import assert from "node:assert/strict";
import {test} from "node:test";
import {ENGINE_PIN,engineSource} from "./engine.mjs";
import {readFileSync} from "node:fs";
import {verifyEngine,verifyLibraries,pageFromInput,normalizeSha256} from "./verify_engine.mjs";
import {fixedFragment,b64,HTML_PREFIX} from "./segments.mjs";
import {tokenPage,fixtureCase} from "./fixture_pages.mjs";
const token=tokenPage(fixtureCase('beast_140bpm'),{fixture:true,dependent:true});
test("separate loader and combined player identities with embedded engine provenance; arbitrary consumer layout and extra libraries accepted",()=>{const v=verifyLibraries(token.html);assert.deepEqual(Object.keys(v.libraries),['gunzip','player']);assert.ok(v.additionalScripts.some(s=>s.id==='composition-fixture'));assert.equal(verifyEngine(token.html).engine.sha256,v.engine.sha256);assert.deepEqual(verifyLibraries(token.html.replace('<title>Onchain music</title>','<title>My NFT</title><meta name="custom" content="自由">')).libraries,v.libraries);assert.match(v.scope,/consumer-owned/);});
test("token URI, JSON, animation URL, raw HTML inputs agree",()=>{const json=JSON.parse(Buffer.from(token.uri.split(',')[1],'base64').toString());for(const input of[token.uri,JSON.stringify(json),json.animation_url,token.html])assert.equal(pageFromInput(Buffer.from(input)),token.html);});
for(const name of['gunzip','player'])test(`missing, duplicate and modified ${name} fail clearly`,()=>{const raw=fixedFragment(name);assert.throws(()=>verifyLibraries(token.html.replace(raw,'')),/found 0/);assert.throws(()=>verifyLibraries(token.html.replace(raw,raw+raw)),/found 2/);const changed=name==='gunzip'?raw.replace('use strict','use stricx'):raw.replace('base64,','base64,!');assert.throws(()=>verifyLibraries(token.html.replace(raw,changed)),/differs|canonical/);});
test("decoy library tags in comments, inert data, template, textarea, SVG art never become selected blocks",()=>{const engine=fixedFragment('player').slice(fixedFragment('player').indexOf('<script')).trimEnd(),decoys=`<!--${engine}--><script type="text/plain">${engine}</script><template>${engine}</template><textarea>${engine}</textarea><svg>${engine}</svg>`;assert.equal(verifyLibraries(decoys+token.html).engine.sha256,verifyEngine(token.html).engine.sha256);assert.throws(()=>verifyLibraries(decoys+token.html.replace(fixedFragment('player'),'')),/found 0/);});
test("corrupt gzip URI rejects with affected engine identity",()=>{const html=token.html.replace(/(id="onchain-midi-player" src="data:application\/gzip;base64,)[^"]+/, '$1AAAA');assert.throws(()=>verifyEngine(html));assert.throws(()=>verifyLibraries(html),/onchain-midi-player/);});
test("normalize SHA256 handles big-endian u256 hexadecimal",()=>{assert.equal(normalizeSha256('0xAB'), '0'.repeat(62)+'ab');assert.throws(()=>normalizeSha256('bad sha'));});
test("HTML5 self-closing SVG permits subsequent libraries; plaintext consumes subsequent markup",()=>{
 const libraries=fixedFragment('gunzip')+fixedFragment('player');
 assert.equal(verifyLibraries('<!doctype html><body><svg/>'+libraries).engine.sha256,verifyEngine(token.html).engine.sha256);
 assert.throws(()=>verifyLibraries('<!doctype html><body><plaintext>'+libraries),/found 0/);
});
test("combined payload reports a separate, exact embedded engine identity",()=>{
 const result=verifyLibraries(token.html);assert.equal(result.engine.length,Buffer.byteLength(engineSource()));assert.equal(result.engine.offset,0);
 assert.equal(result.engine.sha256,ENGINE_PIN.sha256);
 assert.notEqual(result.libraries.player.sha256,result.engine.sha256);
});
