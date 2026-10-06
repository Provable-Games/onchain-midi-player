// @ts-check
// NFT-owned complete-document reference. Fixed library code is never runtime encoded here.
import { readFileSync } from "node:fs";
import { JSON_PREFIX, HTML_PREFIX, SVG_PREFIX, URL_KEY, b64, blen, padLen, spaces, alignedFragment, segmentFor, fixedFragment, dFragment, decodeTokenUri, decodeTokenUriLayers } from "./segments.mjs";
export { decodeTokenUri, decodeTokenUriLayers };
export const ownedFragment = (name) => readFileSync(new URL(`../examples/beast_consumer/fixtures/${name}.html`,import.meta.url),"utf8");
export const fixtureFragment = (name = "fixture") => readFileSync(new URL(`../tests/fixtures/libraries/${name}.html`,import.meta.url),"utf8");
// Reuse metadata's encoded, quoted image value as the first HTML encoding layer. The complete
// image fragment is still encoded twice; no padded final-image shortcut is spliced into HTML.
export const IMAGE_ELEMENT_PREFIX = '<img id="beast-art" alt=""                                    src="data:image/svg+xml;base64,';
export function imageParts(svg) {
  let value = b64(svg) + '"'; value += spaces(padLen(blen(value),3));
  const raw = alignedFragment(IMAGE_ELEMENT_PREFIX + value + '>');
  return { value, valueB64:b64(value), raw,
    returned:b64(b64(IMAGE_ELEMENT_PREFIX)+b64(value)+b64(raw.slice(blen(IMAGE_ELEMENT_PREFIX)+blen(value)))) };
}
export const artFragment = svg => imageParts(svg).raw;
export const HTML_SPACE_SEGMENT = segmentFor("         ");
/** JS mirrors direct ByteArray splicing, including actual returned-stream word boundaries. */
export function consumerPieces(mem, svg, { midi, settings, d, fixture = false, dependent = false, align = true, artFirst = true, libraries } = {}) {
  const image = imageParts(svg);
  let head = "{" + mem + ',';
  const key = '"image":"' + SVG_PREFIX;
  head += spaces(padLen(blen(head)+blen(key),3));
  if (align) while ((29+(blen(head)+blen(key))/3*4)%31) head += "   ";
  head += key;
  const tail = ',  ' + URL_KEY;
  const open = head + image.value + tail;
  let uri = JSON_PREFIX + b64(head) + image.valueB64 + b64(tail), html = "";
  const boundaries = [];
  const append = (name, raw) => {
    boundaries.push({ name, start:uri.length, residue:uri.length%31, raw_len:blen(raw), returned_len:segmentFor(raw).length });
    uri += segmentFor(raw); html += raw;
  };
  const word = () => { if (align) while (uri.length % 31) { uri += HTML_SPACE_SEGMENT; html += "         "; } };
  append("head", ownedFragment("head")); word();
  for (const [name,raw] of (libraries || [["gunzip",fixedFragment("gunzip")],["engine",fixedFragment("engine")],
    ...(fixture?[["fixture",fixtureFragment()]]:[]),["player",fixedFragment("player")],...(dependent?[["dependent",fixtureFragment("dependent")]]:[])])) {
    word(); append(name,raw);
  }
  append("body",ownedFragment("body"));
  const data = d ?? dFragment(midi,settings).d, art = image.raw;
  const appendArt = () => {
    boundaries.push({name:"art",start:uri.length,residue:uri.length%31,raw_len:blen(art),returned_len:image.returned.length});
    uri += image.returned; html += art;
  };
  if (artFirst) { appendArt(); append("data",data); } else { append("data",data); appendArt(); }
  word(); append("footer",ownedFragment("footer"));
  uri += b64('"}');
  return { uri, html, open, boundaries, d:data, art };
}
export const spliceTokenUri = ({mem,svg,d,midi,settings},options={}) => consumerPieces(mem,svg,{...options,d,midi,settings}).uri;
export const naiveTokenUri = (parts,options={}) => {
  const p=consumerPieces(parts.mem,parts.svg,{...options,d:parts.d,midi:parts.midi,settings:parts.settings});
  return JSON_PREFIX+b64(p.open+b64(p.html)+'"}');
};
export const naiveTokenJson = (parts,options={}) => decodeTokenUri(naiveTokenUri(parts,options)).jsonText;
export const compositionHtml = (parts, options={}) => consumerPieces(parts.mem,parts.svg,{...options,d:parts.d,midi:parts.midi,settings:parts.settings}).html;
