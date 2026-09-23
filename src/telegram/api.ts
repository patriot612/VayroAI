import type { Env } from '../env';
import type { TgMessage, TgUser } from './types';

export class TelegramApi {
  constructor(private readonly env: Env) {}
  private get base(){ return `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}`; }

  private async call<T=unknown>(method:string, body:Record<string,unknown>):Promise<T>{
    const res=await fetch(`${this.base}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!res.ok) throw new Error(`TELEGRAM_HTTP_${res.status}`);
    const json=await res.json() as {ok:boolean;result?:T;description?:string;error_code?:number};
    if(!json.ok) throw new Error(`TELEGRAM_${json.error_code??'ERR'}:${json.description??'unknown'}`);
    return json.result as T;
  }

  async sendMessage(chatId:number|string,text:string,opts:Record<string,unknown>={}){return this.call<TgMessage>('sendMessage',{chat_id:chatId,text,...opts});}
  async editMessageText(chatId:number|string,messageId:number,text:string,opts:Record<string,unknown>={}){return this.call<TgMessage>('editMessageText',{chat_id:chatId,message_id:messageId,text,...opts});}
  async deleteMessage(chatId:number|string,messageId:number){return this.call<boolean>('deleteMessage',{chat_id:chatId,message_id:messageId});}
  async answerCallback(callbackId:string,text?:string,showAlert=false){return this.call<boolean>('answerCallbackQuery',{callback_query_id:callbackId,text,show_alert:showAlert});}
  async sendPhoto(chatId:number|string,fileId:string,caption?:string,opts:Record<string,unknown>={}){return this.call<TgMessage>('sendPhoto',{chat_id:chatId,photo:fileId,caption,...opts});}
  async copyMessage(targetChatId:number,fromChatId:number,messageId:number,opts:Record<string,unknown>={}){return this.call<{message_id:number}>('copyMessage',{chat_id:targetChatId,from_chat_id:fromChatId,message_id:messageId,...opts});}
  async setMyCommands(commands:Array<{command:string;description:string}>){return this.call<boolean>('setMyCommands',{commands});}
  async setWebhook(url:string,secretToken:string){return this.call<boolean>('setWebhook',{url,secret_token:secretToken,allowed_updates:['message','callback_query'],drop_pending_updates:false});}
  async getMe(){return this.call<TgUser>('getMe',{});}
}

export function isBotBlockedError(err:unknown):boolean{
  const s=String(err);
  return /blocked by the user|user is deactivated|chat not found/i.test(s);
}

export function telegramUserBlockedError(err:unknown):boolean{return isBotBlockedError(err);}
