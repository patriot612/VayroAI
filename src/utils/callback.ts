export function pack(action:string,...args:(string|number)[]):string{return [action,...args.map(String)].join(':');}
export function unpack(data:string|undefined):{action:string;args:string[]}{if(!data)return{action:'',args:[]};const [action,...args]=data.split(':');return{action,args};}
