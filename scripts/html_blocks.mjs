// @ts-check
// Conservative HTML script tokenizer: skip comments, raw-text elements, SVG/MathML and template
// contents. Offchain checks select actual document scripts instead of regex-searching art/data.
export function scriptBlocks(html) {
  const blocks=[]; let at=0; const inert=[];
  const tags=/<(?:!--[\s\S]*?--\s*|!doctype[^>]*|\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*)>/g;
  while(at<html.length){tags.lastIndex=at;const m=tags.exec(html);if(!m)break;
    const comment=html.indexOf("<!--",at);
    if(comment>=0 && comment<=m.index){const end=html.indexOf("-->",comment+4);if(end<0)break;at=end+3;continue;}
    at=tags.lastIndex;
    const text=m[0];if(/^<!/i.test(text))continue;
    const t=/^<(\/?)\s*([\w:-]+)/.exec(text);if(!t)continue;
    const closing=!!t[1],name=t[2].toLowerCase();
    if(closing){if(inert[inert.length-1]===name)inert.pop();continue;}
    if(["template","svg","math"].includes(name)){inert.push(name);continue;}
    const attrs={};for(const a of text.slice(t[0].length,-1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4]??"";
    if(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"].includes(name)){
      const end=new RegExp(`<\\/${name}\\s*>`,"ig");end.lastIndex=at;const close=end.exec(html);const contentEnd=close?.index??html.length;
      if(name==="script"&&!inert.length)blocks.push({attrs,text:html.slice(at,contentEnd),start:m.index,end:close?end.lastIndex:html.length,closed:!!close,html:html.slice(m.index,close?end.lastIndex:html.length)});
      at=close?end.lastIndex:html.length;
    }
  }
  return blocks;
}
export function requiredBlock(html,id,type) {
  const blocks=scriptBlocks(html).filter(b=>b.attrs.id===id);
  if(blocks.length!==1)throw new Error(`expected one #${id} block, found ${blocks.length}`);
  const block=blocks[0];if(!block.closed||type&&block.attrs.type!==type)throw new Error(`#${id}: wrong type or incomplete script element`);
  return block;
}
