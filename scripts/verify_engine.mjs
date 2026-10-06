#!/usr/bin/env node
// @ts-check
// Verify provider-owned libraries independently. Consumer scripts/layout/art remain untrusted.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { sha256,strictB64Decode,JSON_PREFIX,HTML_PREFIX,MANIFEST_PATH,VERSION,fixedFragment } from "./segments.mjs";
import { requiredBlock,scriptBlocks } from "./html_blocks.mjs";
export function pageFromInput(input) {
  let text=input.toString("utf8");const trimmed=text.trim();
  if(trimmed.startsWith(JSON_PREFIX))text=strictB64Decode(trimmed.slice(JSON_PREFIX.length)).toString("utf8");
  if(text.trim().startsWith("{"))text=JSON.parse(text).animation_url;
  if(typeof text!=="string")throw new Error("missing animation_url");
  if(text.startsWith(HTML_PREFIX))return new TextDecoder("utf-8",{fatal:true}).decode(strictB64Decode(text.slice(HTML_PREFIX.length)));
  if(text.startsWith("data:"))throw new Error("unsupported data URI");return text;
}
const digest=(bytes)=>({sha256:sha256(bytes),length:Buffer.byteLength(bytes)});
export function verifyEngine(html) {
  const block=requiredBlock(html,"onchain-midi-engine","text/javascript+gzip");
  const prefix="data:application/gzip;base64,";
  if(!block.attrs.src?.startsWith(prefix))throw new Error("onchain-midi-engine: wrong gzip data URI");
  const gzip=strictB64Decode(block.attrs.src.slice(prefix.length)),engine=gunzipSync(gzip);
  new TextDecoder("utf-8",{fatal:true}).decode(engine);
  return {gzip:digest(gzip),engine:digest(engine)};
}
export function verifyLibraries(html,version=VERSION) {
  const record=JSON.parse(readFileSync(MANIFEST_PATH,"utf8"))[version];if(!record)throw new Error(`no segment manifest for ${version}`);
  const verified={};
  for(const [name,id] of [["gunzip","onchain-gunzip"],["engine","onchain-midi-engine"],["player","onchain-midi-player"]]){
    const expected=record.artifacts[name],block=requiredBlock(html,id,name==="gunzip"?undefined:"text/javascript+gzip");
    const raw=fixedFragment(name),reference=requiredBlock(raw,id);
    if(block.html!==reference.html)throw new Error(`#${id}: fragment wrapper or library payload differs from ${version}`);
    // Check provider fragment, including attribution and external alignment whitespace, at this occurrence.
    const prefix=raw.slice(0,reference.start),rawStart=block.start-prefix.length;
    const candidate=html.slice(rawStart,rawStart+expected.raw_len);
    if(sha256(candidate)!==expected.raw_sha256)throw new Error(`#${id}: fragment attribution/alignment differs from ${version}`);
    let source=block.text,gzip;
    if(name!=="gunzip"){
      const prefix="data:application/gzip;base64,";if(!block.attrs.src?.startsWith(prefix))throw new Error(`#${id}: invalid gzip URI`);
      gzip=strictB64Decode(block.attrs.src.slice(prefix.length));source=new TextDecoder("utf-8",{fatal:true}).decode(gunzipSync(gzip));
      if(sha256(gzip)!==expected.gzip_sha256||gzip.length!==expected.gzip_len)throw new Error(`#${id}: gzip differs from manifest`);
    }
    if(sha256(source)!==expected.source_sha256||Buffer.byteLength(source)!==expected.source_len)throw new Error(`#${id}: source differs from manifest`);
    verified[name]={id,...digest(source),...(gzip?{gzip:digest(gzip)}:{})};
  }
  return {version,libraries:verified,additionalScripts:scriptBlocks(html).filter(b=>!Object.values(verified).some(v=>v.id===b.attrs.id)).map(b=>({id:b.attrs.id||null,type:b.attrs.type||"classic"})),
    scope:"Verified library identities only; consumer-owned scripts, layout and art are not certified."};
}
export function normalizeSha256(value){const s=value.trim().replace(/^0x/i,"").toLowerCase();if(!/^[0-9a-f]{1,64}$/.test(s))throw new Error("not a SHA-256 in hex");return s.padStart(64,"0");}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),at=args.indexOf("--expect"),expect=at<0?null:normalizeSha256(args.splice(at,2)[1]||"");
 if(args.length!==1)throw new Error("usage: verify_engine.mjs <file | -> [--expect sha256]");
 const html=pageFromInput(readFileSync(args[0]==="-"?0:args[0])),result=verifyLibraries(html);
 if(expect&&result.libraries.engine.sha256!==expect)throw new Error("engine SHA-256 differs from --expect");
 console.log(JSON.stringify(result,null,2));
}
