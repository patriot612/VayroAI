declare interface D1PreparedStatement{bind(...values:unknown[]):D1PreparedStatement;first<T=unknown>():Promise<T|null>;all<T=unknown>():Promise<{results?:T[];success?:boolean;meta?:Record<string,unknown>}>;run():Promise<{success?:boolean;meta?:{changes?:number}&Record<string,unknown>}>}
declare interface D1Database{prepare(query:string):D1PreparedStatement;batch(statements:D1PreparedStatement[]):Promise<Array<{success?:boolean;meta?:{changes?:number}&Record<string,unknown>}>>}
declare interface Ai{run(model:string,input:unknown):Promise<unknown>}
declare interface ExecutionContext{waitUntil(promise:Promise<unknown>):void;passThroughOnException():void}
declare interface ScheduledController{scheduledTime:number;cron:string}
