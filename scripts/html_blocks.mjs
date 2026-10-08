// @ts-check
// Offchain HTML5 parsing follows browser foreign-content, raw-text and plaintext rules.
// Template contents are not document scripts; only HTML script elements can supply our libraries.
import { parse } from "parse5";
export function scriptBlocks(html) {
  const blocks = [];
  const visit = node => {
    if (node.tagName === "script" && node.namespaceURI === "http://www.w3.org/1999/xhtml") {
      const location = node.sourceCodeLocation;
      if (location?.startTag) {
        const start = location.startOffset, end = location.endOffset;
        blocks.push({ attrs: Object.fromEntries(node.attrs.map(a => [a.name, a.value])),
          text: html.slice(location.startTag.endOffset, location.endTag?.startOffset ?? end),
          start, end, closed: !!location.endTag, html: html.slice(start, end) });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true }));
  return blocks.sort((a, b) => a.start - b.start);
}
export function requiredBlock(html,id,type) {
  const blocks=scriptBlocks(html).filter(b=>b.attrs.id===id);
  if(blocks.length!==1)throw new Error(`expected one #${id} block, found ${blocks.length}`);
  const block=blocks[0];if(!block.closed||type&&block.attrs.type!==type)throw new Error(`#${id}: wrong type or incomplete script element`);
  return block;
}
