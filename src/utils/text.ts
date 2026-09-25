export function escapeHtml(s:string):string{return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;');}
export function escapeHtmlAttr(s:string):string{return escapeHtml(s).replaceAll("'",'&#39;');}

export function markdownToTelegramHtml(input:string):string{
  let s=escapeHtml(input);
  const protectedParts:string[]=[];
  const protect=(html:string)=>{const token=`\u0000T${protectedParts.length}\u0000`;protectedParts.push(html);return token;};

  // Protect code first so later Markdown replacements cannot corrupt code contents.
  s=s.replace(/```(?:[a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g,(_,code)=>protect(`<pre>${code}</pre>`));
  s=s.replace(/`([^`]+)`/g,(_,code)=>protect(`<code>${code}</code>`));

  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/__([^_]+)__/g,'<b>$1</b>');
  s=s.replace(/\*([^*]+)\*/g,'<i>$1</i>');
  s=s.replace(/_([^_]+)_/g,'<i>$1</i>');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2">$1</a>');

  return s.replace(/\u0000T(\d+)\u0000/g,(_,i)=>protectedParts[Number(i)]??'');
}

export function splitTelegramText(text:string,max=3900):string[]{
  if(text.length<=max) return [text];

  type OpenTag={name:string;open:string};
  const out:string[]=[];
  const stack:OpenTag[]=[];
  let chunk='';
  const tokenRe=/(<\/?[a-zA-Z][^>]*>|&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);)/g;

  const closingLength=()=>stack.reduce((n,t)=>n+t.name.length+3,0);
  const openingPrefix=()=>stack.map(t=>t.open).join('');

  const flush=()=>{
    if(!chunk || chunk===openingPrefix()) return;
    let emitted=chunk;
    for(let i=stack.length-1;i>=0;i--) emitted+=`</${stack[i].name}>`;
    out.push(emitted);
    chunk=openingPrefix();
  };

  const appendText=(value:string)=>{
    let rest=value;
    while(rest){
      const room=max-chunk.length-closingLength();
      if(room<=0){flush();continue;}
      if(rest.length<=room){chunk+=rest;return;}
      let cut=rest.lastIndexOf('\n',room);
      if(cut<100) cut=rest.lastIndexOf(' ',room);
      if(cut<1) cut=room;
      chunk+=rest.slice(0,cut);
      rest=rest.slice(cut).trimStart();
      flush();
    }
  };

  let last=0;
  let m:RegExpExecArray|null;
  while((m=tokenRe.exec(text))!==null){
    if(m.index>last) appendText(text.slice(last,m.index));
    const token=m[0];

    if(token.startsWith('</')){
      if(chunk.length+token.length>max) flush();
      chunk+=token;
      const name=token.slice(2,token.indexOf('>')).trim().toLowerCase();
      const idx=stack.map(x=>x.name).lastIndexOf(name);
      if(idx>=0) stack.splice(idx,1);
    }else if(token.startsWith('<')){
      const nameMatch=/^<([a-zA-Z][a-zA-Z0-9]*)\b/.exec(token);
      const selfClosing=/\/\s*>$/.test(token);
      const name=nameMatch?.[1]?.toLowerCase();
      const tracked=Boolean(name&&!selfClosing&&!/^<(?:br|hr|img|meta|input)\b/i.test(token));
      const extraClose=tracked ? name!.length+3 : 0;
      if(chunk.length+token.length+extraClose>max && chunk!==openingPrefix()) flush();
      chunk+=token;
      if(tracked) stack.push({name:name!,open:token});
    }else{
      appendText(token);
    }
    last=tokenRe.lastIndex;
  }

  if(last<text.length) appendText(text.slice(last));
  if(chunk && chunk!==openingPrefix()){
    let emitted=chunk;
    for(let i=stack.length-1;i>=0;i--) emitted+=`</${stack[i].name}>`;
    out.push(emitted);
  }
  return out.length ? out : [text.slice(0,max)];
}

export function formatRub(minor:number):string{const rub=Math.round(minor)/100;return Number.isInteger(rub)?String(rub):rub.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');}

export function isoAfterHours(hours:number):string{return new Date(Date.now()+hours*3600000).toISOString();}
export function isExpired(iso:string):boolean{return Date.parse(iso)<=Date.now();}
