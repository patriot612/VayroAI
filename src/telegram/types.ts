export type TgUser = { id:number; is_bot?:boolean; first_name?:string; username?:string; language_code?:string };
export type TgChat = { id:number; type:string; title?:string };
export type TgMessage = {
  message_id:number;
  from?:TgUser;
  chat:TgChat;
  date:number;
  text?:string;
  caption?:string;
  entities?:unknown[];
  caption_entities?:unknown[];
  photo?:Array<{file_id:string;width:number;height:number;file_unique_id?:string;file_size?:number}>;
};
export type TgCallback = { id:string; from:TgUser; message?:TgMessage; data?:string; inline_message_id?:string };
export type TgUpdate = { update_id:number; message?:TgMessage; callback_query?:TgCallback; edited_message?:TgMessage };
