import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scriptBlocks,requiredDataBlock} from './html_blocks.mjs';
import {splitPage} from '../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs';
const data='<script id="onchain-midi-settings" type="text/plain">1,1,30,40,64,0,0</script><script id="onchain-midi-data" type="text/plain">TVRoZA==</script>';
test('data IDs are unique across all document elements and namespaces',()=>{
 for(const decoy of ['<div id="onchain-midi-data"></div>','<svg><g id="onchain-midi-data"/></svg>','<svg><script id="onchain-midi-data" type="text/plain">bad</script></svg>'])
  for(const html of [decoy+data,data+decoy])assert.throws(()=>splitPage(Buffer.from(html)),/onchain-midi-data.*found 2/);
});
test('unique data must be a complete HTML text/plain script',()=>{
 for(const html of ['<div id="x" type="text/plain">text</div>','<svg><script id="x" type="text/plain">text</script></svg>','<script id="x" type="text/plain">text'])
  assert.throws(()=>requiredDataBlock(html,'x'),/complete HTML text\/plain script/);
});
test('template and raw-text decoys are inert; foreignObject HTML data is usable',()=>{
 assert.equal(splitPage(Buffer.from('<template><div id="onchain-midi-data"></div>'+data+'</template>'+data)).midi,'TVRoZA==');
 assert.equal(splitPage(Buffer.from('<textarea>'+data+'</textarea>'+data)).midi,'TVRoZA==');
 assert.equal(requiredDataBlock('<svg><foreignObject><script id="x" type="text/plain">raw &amp;</script></foreignObject></svg>','x').text,'raw &amp;');
});
test('library selection follows browser namespaces, self-closing foreign content and plaintext',()=>{
 assert.deepEqual(scriptBlocks('<svg><script id="svg"></script><foreignObject><script id="html"></script></foreignObject></svg>').map(b=>b.attrs.id),['html']);
 assert.equal(scriptBlocks('<svg/><script id="html"></script>')[0].attrs.id,'html');
 assert.deepEqual(scriptBlocks('<plaintext><script id="decoy"></script>'),[]);
});
