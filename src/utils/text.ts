export function escapeHtml(s:string):string{return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;');}
export function escapeHtmlAttr(s:string):string{return escapeHtml(s).replaceAll("'",'&#39;');}

export function markdownToTelegramHtml(input:string):string{
  let s=escapeHtml(input);
  s=s.replace(/```(?:[a-zA-Z0-9_+-]+)?\n?([\s\S]*?)```/g,(_,code)=>`<pre>${code}</pre>`);
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/__([^_]+)__/g,'<b>$1</b>');
  s=s.replace(/\*([^*]+)\*/g,'<i>$1</i>');
  s=s.replace(/_([^_]+)_/g,'<i>$1</i>');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2">$1</a>');
  return s;
}

export function splitTelegramText(text:string,max=3900):string[]{
  if(text.length<=max) return [text];
  const out:string[]=[]; let rest=text;
  while(rest.length>max){let cut=rest.lastIndexOf('\n',max);if(cut<100)cut=rest.lastIndexOf(' ',max);if(cut<100)cut=max;out.push(rest.slice(0,cut));rest=rest.slice(cut).trimStart();}if(rest)out.push(rest);return out;
}

export function formatRub(minor:number):string{const rub=Math.round(minor)/100;return Number.isInteger(rub)?String(rub):rub.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');}

export function isoAfterHours(hours:number):string{return new Date(Date.now()+hours*3600000).toISOString();}
export function isExpired(iso:string):boolean{return Date.parse(iso)<=Date.now();}
