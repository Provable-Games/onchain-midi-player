#!/usr/bin/env node
import { formatCairo } from "../../../scripts/cairo_format.mjs";
import { writeFileSync } from 'node:fs';
import { cairoByteArrayConst, fixedFragment, sha256, decodeTokenUri } from '../../../scripts/segments.mjs';
import { ownedFragment, naiveTokenUri } from '../../../scripts/composition.mjs';
import { tokenUriSpliced, tokenParts, realBeast, MINTED, ALIGN } from './reference.mjs';
let golden='//! Generated independent JS token/document goldens.\npub const TOKEN_IDS: [u256; 3] = [1, 2, 3];\n';
for(let id=1;id<=4;id++) {
 const parts=tokenParts(id),uri=tokenUriSpliced(id);
 if(uri!==naiveTokenUri(parts,ALIGN))throw new Error('spliced != runtime nesting');
 if(id<4)golden+=cairoByteArrayConst(`token_uri_${id}`,`TOKEN_URI_${id}`,uri,[])+"\n"+cairoByteArrayConst(`svg_${id}`,`SVG_${id}`,parts.svg,[])+"\n";
 else golden+=`pub fn token_uri_4_digest() -> (u32, u256) { (${uri.length}, 0x${sha256(uri)}) }\n`;
}
{const {tokenId,name,tier}=MINTED,parts=tokenParts(tokenId,{name,tier}),uri=tokenUriSpliced(tokenId,{name,tier});
 if(uri!==naiveTokenUri(parts,ALIGN))throw new Error('spliced != runtime nesting');
 golden+=`/// Token ${tokenId}, minted after deployment as ${name}, tier ${tier}: its token_uri's length and SHA-256.\npub fn minted_token_uri_digest() -> (u32, u256) { (${uri.length}, 0x${sha256(uri)}) }\n`;}
for(const name of ['gunzip','player'])golden+=cairoByteArrayConst(name,name.toUpperCase(),fixedFragment(name),[])+"\n";
for(const name of ['head','body','trusted_body','notes','footer'])golden+=cairoByteArrayConst(name,name.toUpperCase(),ownedFragment(name),[])+"\n";
writeFileSync(new URL('../tests/golden.cairo',import.meta.url),formatCairo(golden));
const real=realBeast();writeFileSync(new URL('../src/beast_data.cairo',import.meta.url),formatCairo(cairoByteArrayConst('warlock_svg','WARLOCK_SVG',real.svg,[])+"\n"+cairoByteArrayConst('heaviest_midi','HEAVIEST_MIDI',real.midi,[])+"\n"));
const uri=tokenUriSpliced(1),dec=decodeTokenUri(uri);
for(const [name,value] of [['token_uri.txt',uri+'\n'],['token.json',JSON.stringify(dec.json,null,2)+'\n'],['image.svg',dec.svg],['animation.html',dec.html]])writeFileSync(new URL(`../fixtures/${name}`,import.meta.url),value);
console.log('generated Beast token goldens and consumer pages');
