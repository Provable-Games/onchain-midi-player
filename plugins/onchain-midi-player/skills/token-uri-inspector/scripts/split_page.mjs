#!/usr/bin/env node
// Split actual complete namespaced data blocks independently of document/art layout.
import { readFileSync,writeFileSync,mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredBlock } from "../../../../../scripts/html_blocks.mjs";
export function splitPage(bytes) {
 const html=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
 const settings=requiredBlock(html,"onchain-midi-settings","text/plain").text;
 const midi=requiredBlock(html,"onchain-midi-data","text/plain").text;
 return {settings,midi};
}
export function run(argv,out=console.log,err=console.error){
 try{if(argv.length<1||argv.length>2)throw new Error("usage: split_page.mjs animation.html [out_dir]");
 const dir=argv[1]||"out",blocks=splitPage(readFileSync(argv[0]));mkdirSync(dir,{recursive:true});
 writeFileSync(`${dir}/settings.txt`,blocks.settings);writeFileSync(`${dir}/midi.b64`,blocks.midi);out("wrote complete settings/MIDI blocks; NFT art is independent");return 0;
 }catch(e){err(e.message);return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=run(process.argv.slice(2));
