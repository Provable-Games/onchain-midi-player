#!/usr/bin/env node
// Split actual complete namespaced data blocks independently of document/art layout.
import { readFileSync,writeFileSync,mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredDataBlock } from "../../../../../scripts/html_blocks.mjs";
export function splitPage(bytes) {
 const html=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
 const settings=requiredDataBlock(html,"onchain-midi-settings").text;
 const midi=requiredDataBlock(html,"onchain-midi-data").text;
 return {settings,midi};
}
export function run(argv,out=console.log,err=console.error){
 if(argv.length<1||argv.length>2){err("usage: split_page.mjs animation.html [out_dir]");return 2;}
 const dir=argv[1]||"out",input=resolve(argv[0]);
 if(["settings.txt","midi.b64"].some(name=>resolve(dir,name)===input)){
  err("output would overwrite the input page");return 2;
 }
 try{const blocks=splitPage(readFileSync(input));mkdirSync(dir,{recursive:true});
 writeFileSync(`${dir}/settings.txt`,blocks.settings);writeFileSync(`${dir}/midi.b64`,blocks.midi);out("wrote complete settings/MIDI blocks; NFT art is independent");return 0;
 }catch(e){err(e.message);return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=run(process.argv.slice(2));
