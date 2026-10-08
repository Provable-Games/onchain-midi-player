// @ts-check
// Offchain HTML5 parsing follows browser foreign-content, raw-text and plaintext rules.
// Template contents are not document elements; only HTML scripts supply libraries or player data.
import { parse } from "parse5";
const HTML_NS = "http://www.w3.org/1999/xhtml";
function documentElements(html) {
  const elements = [];
  const visit = node => {
    if (node.tagName) elements.push(node);
    // Deliberately exclude template.content, matching document.querySelectorAll.
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true }));
  return elements;
}
function scriptBlock(html, node) {
  const location = node.sourceCodeLocation;
  if (!location?.startTag) return null;
  const start = location.startOffset, end = location.endOffset;
  return { attrs: Object.fromEntries(node.attrs.map(a => [a.name, a.value])),
    text: html.slice(location.startTag.endOffset, location.endTag?.startOffset ?? end),
    start, end, closed: !!location.endTag, html: html.slice(start, end) };
}
export function scriptBlocks(html) {
  return documentElements(html).filter(n => n.tagName === "script" && n.namespaceURI === HTML_NS)
    .map(n => scriptBlock(html, n)).filter(Boolean).sort((a, b) => a.start - b.start);
}
export function requiredBlock(html,id,type) {
  const blocks=scriptBlocks(html).filter(b=>b.attrs.id===id);
  if(blocks.length!==1)throw new Error(`expected one #${id} block, found ${blocks.length}`);
  const block=blocks[0];if(!block.closed||type&&block.attrs.type!==type)throw new Error(`#${id}: wrong type or incomplete script element`);
  return block;
}
// Player data IDs are unique across document elements, not merely across library candidates.
export function requiredDataBlock(html, id) {
  const nodes = documentElements(html).filter(n => n.attrs.some(a => a.name === "id" && a.value === id));
  if (nodes.length !== 1) throw new Error(`expected one #${id} block, found ${nodes.length}`);
  const node = nodes[0], block = scriptBlock(html, node);
  if (node.tagName !== "script" || node.namespaceURI !== HTML_NS || !block?.closed || block.attrs.type !== "text/plain")
    throw new Error(`#${id}: expected a complete HTML text/plain script element`);
  return block;
}
