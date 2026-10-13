// @ts-check
import { readFileSync } from "node:fs";
import { sha256,decodeTokenUri } from "./segments.mjs";
import { spliceTokenUri } from "./composition.mjs";
export const FIXTURES = JSON.parse(readFileSync(new URL("../tests/fixtures/data.json",import.meta.url),"utf8"));
export function fixtureCase(name) { const c=FIXTURES.valid.find(c=>c.name===name);if(!c)throw Error(`unknown fixture ${name}`);return c; }
export function tokenPage(c,options={fixture:true}) {
 const uri=spliceTokenUri({mem:c.members,svg:c.svg,d:c.d},options),decoded=decodeTokenUri(uri);
 if(options.fixture && !options.dependent && (uri.length!==c.token_uri.len||sha256(uri)!==c.token_uri.sha256))throw Error("consumer fixture drift");
 return {uri,url:decoded.json.animation_url,html:decoded.html};
}
