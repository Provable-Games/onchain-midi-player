import {checkMidi} from "../../../player/player.js";
import assert from 'node:assert/strict';import {test}from'node:test';
import{TOKENS,tokenParts,tokenUriSpliced,tokenUriNaive,animationHtml}from'./reference.mjs';
import{decodeTokenUri}from'../../../scripts/segments.mjs';import{verifyLibraries}from'../../../scripts/verify_engine.mjs';
test('each independent example token reference equals direct splicing and runtime nesting',()=>{for(const id of Object.keys(TOKENS)){const uri=tokenUriSpliced(id),p=tokenParts(id),dec=decodeTokenUri(uri);assert.equal(uri,tokenUriNaive(id));assert.equal(dec.svg,p.svg);assert.equal(dec.html,animationHtml(id));assert.equal(verifyLibraries(dec.html).version,'0.5.0');checkMidi(p.midi);}});
