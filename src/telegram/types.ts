export type TgUser = { id:number; is_bot?:boolean; first_name?:string; username?:string; language_code?:string };
export type TgFile = { file_id:string; file_unique_id:string; file_size?:number; file_path?:string };
export type TgChat = { id:number; type:string; title?:string };
export type TgSuccessfulPayment = {
  currency:string;
  total_amount:number;
  invoice_payload:string;
  telegram_payment_charge_id:string;
  provider_payment_charge_id?:string;
  subscription_expiration_date?:number;
  is_recurring?:true;
  is_first_recurring?:true;
};
export type TgPreCheckoutQuery = {
  id:string;
  from:TgUser;
  currency:string;
  total_amount:number;
  invoice_payload:string;
};
export type TgMessage = {
  message_id:number;
  from?:TgUser;
  chat:TgChat;
  date:number;
  text?:string;
  caption?:string;
  entities?:unknown[];
  caption_entities?:unknown[]; document?:{file_id:string;file_name?:string;mime_type?:string;file_size?:number}; voice?:{file_id:string;duration:number;mime_type?:string;file_size?:number};
  photo?:Array<{file_id:string;width:number;height:number;file_unique_id?:string;file_size?:number}>;
  successful_payment?:TgSuccessfulPayment;
};
export type TgCallback = { id:string; from:TgUser; message?:TgMessage; data?:string; inline_message_id?:string };
export type TgUpdate = { update_id:number; message?:TgMessage; callback_query?:TgCallback; pre_checkout_query?:TgPreCheckoutQuery; edited_message?:TgMessage };
