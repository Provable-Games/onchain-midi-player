import assert from 'node:assert/strict';import {test} from 'node:test';import{mkdtempSync,writeFileSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{MIDI}from'../examples/beast_consumer/scripts/reference.mjs';import{verifyLibraries}from'./verify_engine.mjs';import{splitPage}from'../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs';
test('preview builds complete consumer page with isolated arbitrary art and verified libraries',()=>{const dir=mkdtempSync(join(tmpdir(),'midi-preview-')),midi=join(dir,'score.mid'),art=join(dir,'art.svg'),out=join(dir,'out.html');writeFileSync(midi,MIDI);writeFileSync(art,'<svg xmlns="http://www.w3.org/2000/svg"><script>window.attack=1</script></svg>');const r=spawnSync(process.execPath,['scripts/preview.mjs',midi,'--svg',art,'--out',out],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);const html=readFileSync(out);assert.equal(verifyLibraries(html.toString()).version,'0.5.0');assert.equal(splitPage(html).midi,MIDI.toString('base64'));assert.ok(html.toString().endsWith(' '));});
test('preview rejects invalid MIDI before producing audio/page artifacts',()=>{const dir=mkdtempSync(join(tmpdir(),'midi-preview-')),midi=join(dir,'score.mid');writeFileSync(midi,'bad');const r=spawnSync(process.execPath,['scripts/preview.mjs',midi,'--out',join(dir,'out.html')],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stdout+r.stderr,/midi/i);});

import {buildPreview} from './preview.mjs';
import {DEFAULT_SETTINGS} from './settings_fixtures.mjs';
import {settingsText} from './segments.mjs';
test('preview reports encoded default and custom settings bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'midi-preview-size-')),midi=join(dir,'score.mid');writeFileSync(midi,MIDI);
 const custom={...DEFAULT_SETTINGS,master_vol:123,voices:128};
 for(const settings of [DEFAULT_SETTINGS,custom]){const result=buildPreview({midiArg:midi,settings});
  const encoded=splitPage(result.html).settings;
  assert.equal(encoded,settingsText(settings));
  assert.ok(result.lines.includes(`  SETTINGS: ${Buffer.byteLength(encoded)} bytes`));
  assert.ok(Buffer.byteLength(encoded)>0);
 }
});
