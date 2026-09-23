import type { Env } from '../env';
import type { User, Chat, Model, Plan, Order } from '../db/types';
import * as repo from '../db/repo';
import { t, type Lang } from '../i18n';
import { ik, rk, type InlineKeyboard } from '../telegram/markup';
import { TelegramApi } from '../telegram/api';
import { formatRub } from '../utils/text';

export async function sendOrEditUi(api:TelegramApi,db:D1Database,user:User,text:string,keyboard:InlineKeyboard|undefined,replyRows:string[][],sourceMessageId?:number){
  const opts:Record<string,unknown>={parse_mode:'HTML',disable_web_page_preview:true,...(keyboard?{reply_markup:ik(keyboard)}:{})};
  if(sourceMessageId){
    try{await api.editMessageText(user.id,sourceMessageId,text,opts);await db.prepare('UPDATE users SET ui_message_id=? WHERE id=?').bind(sourceMessageId,user.id).run();await refreshReplyKeyboard(api,user.id,replyRows);return sourceMessageId;}catch{}
  }
  if(user.ui_message_id){
    try{await api.editMessageText(user.id,user.ui_message_id,text,opts);await refreshReplyKeyboard(api,user.id,replyRows);return user.ui_message_id;}catch{}
  }
  const msg=await api.sendMessage(user.id,text,{...opts,reply_markup:keyboard?ik(keyboard):undefined});
  await db.prepare('UPDATE users SET ui_message_id=? WHERE id=?').bind(msg.message_id,user.id).run();
  await refreshReplyKeyboard(api,user.id,replyRows);
  return msg.message_id;
}

async function refreshReplyKeyboard(api:TelegramApi,userId:number,rows:string[][]){
  try{const m=await api.sendMessage(userId,'\u2063',{reply_markup:rk(rows),disable_notification:true});await api.deleteMessage(userId,m.message_id);}catch{}
}

export async function mainMenu(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,sourceMessageId?:number){
  const model=await repo.getUsableModel(db,chat.model_key,env) ?? await repo.getDefaultChatModel(db,env);
  const count=await repo.countLiveMessages(db,chat.id,user.id);
  const text=[t(user.language,'menu_title'),t(user.language,'chat_model',{model:model?.name??chat.model_key}),count? t(user.language,'live_messages',{count}):t(user.language,'no_messages')].join('\n\n');
  const kb=ik([
    [{text:t(user.language,'menu_chat'),callback_data:'chat:open'},{text:t(user.language,'change_model'),callback_data:'models:open'}],
    [{text:t(user.language,'new_chat'),callback_data:'chat:new'},{text:t(user.language,'my_chats'),callback_data:'chats:open'}],
    [{text:t(user.language,'images'),callback_data:'coming:images'},{text:t(user.language,'tools'),callback_data:'tools:open'}],
    [{text:t(user.language,'account'),callback_data:'account:open'},{text:t(user.language,'help'),callback_data:'help:open'}]
  ] as any).inline_keyboard;
  return sendOrEditUi(api,db,user,text,kb,[[t(user.language,'menu_chat'),t(user.language,'new_chat')],[t(user.language,'my_chats'),t(user.language,'account')]],sourceMessageId);
}

export async function modelScreen(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,sourceMessageId?:number){
  const current=await repo.modelByKey(db,chat.model_key);
  const families=await repo.listUsableChatFamilies(db,env);
  let text=[t(user.language,'current_model',{model:current?.name??chat.model_key}),t(user.language,'chat_model_family',{title:chat.title,family:current?.family??'—'}),t(user.language,'daily'),t(user.language,'daily_desc'),t(user.language,'advanced'),t(user.language,'advanced_desc'),t(user.language,'model_cost_note')].join('\n\n');
  const rows=[];for(let i=0;i<families.length;i+=3){rows.push(families.slice(i,i+3).map(f=>({text:f.family,callback_data:`family:${encodeURIComponent(f.family)}`})));}
  rows.push([{text:t(user.language,'back_chat'),callback_data:'chat:open'},{text:t(user.language,'back'),callback_data:'menu:open'}]);
  return sendOrEditUi(api,db,user,text,rows,[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function familyScreen(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,family:string,sourceMessageId?:number){
  const models=await repo.listModelsForFamily(db,env,family);
  const rows=models.map(m=>({text:`${m.tier==='daily'?'💬':'🧠'} ${m.name} · ${m.cost}`,callback_data:`model:set:${encodeURIComponent(m.model_key)}`}));
  const chunks=[];for(let i=0;i<rows.length;i+=2)chunks.push(rows.slice(i,i+2));
  chunks.push([{text:t(user.language,'back'),callback_data:'models:open'}]);
  const text=`<b>${family}</b>\n\n${models.length?models.map(m=>`${m.tier==='daily'?'💬':'🧠'} <b>${m.name}</b> · ${m.cost}`).join('\n'):'—'}`;
  return sendOrEditUi(api,db,user,text,chunks,[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function chatsScreen(api:TelegramApi,db:D1Database,user:User,page=1,sourceMessageId?:number){
  const chats=await repo.listChats(db,user.id,false,page,8);
  let text=t(user.language,'chats_title')+'\n\n'+(chats.length?chats.map((c,i)=>`${i+1}. ${c.title}`).join('\n'):t(user.language,'no_chats'));
  const rows=chats.map(c=>[{text:c.title.slice(0,60),callback_data:`chat:view:${c.id}`}]);
  if(chats.length) rows.push([{text:'🗂 Архив',callback_data:'archive:open'}]);
  rows.push([{text:t(user.language,'back_chat'),callback_data:'chat:open'},{text:t(user.language,'back'),callback_data:'menu:open'}]);
  return sendOrEditUi(api,db,user,text,rows,[[t(user.language,'menu_chat'),t(user.language,'new_chat')]],sourceMessageId);
}

export async function chatActionsScreen(api:TelegramApi,db:D1Database,user:User,chat:Chat,sourceMessageId?:number){
  const text=`<b>${chat.title}</b>\n\n${chat.is_archived?t(user.language,'archive_hint'):t(user.language,'chat_model',{model:chat.model_key})}`;
  const rows=chat.is_archived?[
    [{text:t(user.language,'continue'),callback_data:`chat:continue:${chat.id}`}],[{text:t(user.language,'rename'),callback_data:`chat:rename:${chat.id}`}],[{text:t(user.language,'unarchive'),callback_data:`chat:unarchive:${chat.id}`}],[{text:t(user.language,'delete'),callback_data:`chat:delete:${chat.id}` }],[{text:t(user.language,'back'),callback_data:'archive:open'}]
  ]:[
    [{text:t(user.language,'archive'),callback_data:`chat:archive:${chat.id}`},{text:t(user.language,'rename'),callback_data:`chat:rename:${chat.id}`}],[{text:t(user.language,'delete'),callback_data:`chat:delete:${chat.id}` }],[{text:t(user.language,'back'),callback_data:'chats:open'}]
  ];
  return sendOrEditUi(api,db,user,text,rows,[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function archiveScreen(api:TelegramApi,db:D1Database,user:User,page=1,sourceMessageId?:number){
  const chats=await repo.listChats(db,user.id,true,page,8);
  const text=chats.length?`${t(user.language,'archive_title')}\n\n${t(user.language,'archive_hint')}\n\n${chats.map((c,i)=>`${i+1}. ${c.title}`).join('\n')}`:t(user.language,'archive_title')+'\n\n'+t(user.language,'archive_empty');
  const rows=chats.map(c=>[{text:c.title.slice(0,60),callback_data:`chat:view:${c.id}`}]);
  rows.push([{text:t(user.language,'my_chats'),callback_data:'chats:open'}]);
  rows.push([{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
  return sendOrEditUi(api,db,user,text,rows,[[t(user.language,'menu_chat')]],sourceMessageId);
}

export async function accountScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
  const bal=await repo.getBalance(db,user.id);const stats=await repo.getUserStats(db,user.id);const sub=await db.prepare('SELECT expires_at FROM subscriptions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(user.id,new Date().toISOString()).first<{expires_at:string}>();
  const text=[t(user.language,'account_title'),t(user.language,'free_points',{n:bal.free}),t(user.language,'purchased_points',{n:bal.paid}),t(user.language,'subscription',{status:sub?new Date(sub.expires_at).toLocaleDateString(user.language==='ru'?'ru-RU':'en-US'): '—'}),t(user.language,'tg_id',{id:user.id}),t(user.language,'responses_today',{n:stats.responsesToday}),t(user.language,'total_responses',{n:stats.totalResponses})].join('\n');
  const rows=[[{text:t(user.language,'subscription_points'),callback_data:'plans:open'}],[{text:t(user.language,'orders'),callback_data:'orders:open'}],[{text:t(user.language,'language',{lang:user.language==='ru'?'Русский':'English'}),callback_data:'language:open'}],[{text:t(user.language,'help'),callback_data:'help:open'},{text:t(user.language,'back_chat'),callback_data:'chat:open'}]];
  return sendOrEditUi(api,db,user,text,rows,[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function rolesScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
  const roles=await repo.listRoles(db);const chat=user.current_chat_id?await repo.getChat(db,user.current_chat_id,user.id):null;const rows=roles.map(r=>[{text:user.language==='ru'?r.name_ru:r.name_en,callback_data:`role:set:${r.role_key}`}]);rows.push([{text:t(user.language,'custom_role'),callback_data:'role:custom'}],[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
  return sendOrEditUi(api,db,user,t(user.language,'roles_title')+'\n\n'+t(user.language,'roles_hint')+(chat?.custom_role?`\n\n✏️ ${chat.custom_role.slice(0,200)}`:''),rows,[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function searchScreen(api:TelegramApi,db:D1Database,env:Env,user:User,sourceMessageId?:number){
  const models=await repo.listSearchModels(db,env);const rows=models.map(m=>[{text:`🔎 ${m.name} · ${m.cost}`,callback_data:`search:set:${m.model_key}`}]);rows.push([{text:t(user.language,'search_back'),callback_data:'chat:open'}]);
  return sendOrEditUi(api,db,user,t(user.language,'search_title')+'\n\n'+t(user.language,'search_hint'),models.length?rows:[[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]],[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function plansScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
  const plans=await repo.listPlans(db,'subscription');let text=t(user.language,'plans_title')+'\n\n';const rows=plans.map(p=>{
    let label=user.language==='ru'?p.title_ru:p.title_en;label+=` · ${formatRub(p.price_minor)} ₽`;if(p.plan_key==='sub-1y')label+=`\n${t(user.language,'yearly_month',{monthly:formatRub(p.price_minor/12)})}`;
    return [{text:label,callback_data:`plan:create:${p.plan_key}`}];
  });
  rows.push([{text:'⭐ Баллы',callback_data:'plans:points'}],[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
  return sendOrEditUi(api,db,user,text+plans.map(p=>`${user.language==='ru'?p.title_ru:p.title_en} · ${formatRub(p.price_minor)} ₽`).join('\n'),rows,[[t(user.language,'back_chat')]],sourceMessageId);
}

export async function pointPlansScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const plans=await repo.listPlans(db,'points');const rows=plans.map(p=>[{text:`${user.language==='ru'?p.title_ru:p.title_en} · ${formatRub(p.price_minor)} ₽`,callback_data:`plan:create:${p.plan_key}`}]);rows.push([{text:t(user.language,'back'),callback_data:'plans:open'}]);return sendOrEditUi(api,db,user,`⭐ <b>${user.language==='ru'?'Баллы':'Points'}</b>`,rows,[[t(user.language,'back_chat')]],sourceMessageId);}

export async function ordersScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const size=Number((await repo.getSetting(db,'orders_page_size'))??10);const orders=await repo.listUserOrders(db,user.id,1,size);const text=t(user.language,'orders_title')+'\n\n'+(orders.length?orders.map(o=>`${o.id} · ${formatRub(o.amount_minor)} ₽ · ${o.status}`).join('\n'):t(user.language,'no_orders'));return sendOrEditUi(api,db,user,text,[[{text:t(user.language,'back'),callback_data:'account:open'}]],[[t(user.language,'back_chat')]],sourceMessageId);}
