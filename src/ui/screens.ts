import type { Env } from '../env';
import type { User, Chat, Model, Plan } from '../db/types';
import * as repo from '../db/repo';
import { t, type Lang } from '../i18n';
import { ik, rk, type InlineKeyboard } from '../telegram/markup';
import { TelegramApi } from '../telegram/api';
import { escapeHtml, formatRub } from '../utils/text';
import { IMAGE_TEMPLATES } from '../image/service';

function formatDialogDate(value:string, lang:Lang):string{
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return value;
  const locale=lang==='ru'?'ru-RU':lang==='uz'?'uz-UZ':'en-US';
  return new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(d)+' UTC';
}

async function ensurePersistentReplyKeyboard(api:TelegramApi,db:D1Database,user:User){
  const replyRows=[[t(user.language,'menu_chat'),t(user.language,'images')],[t(user.language,'change_model'),t(user.language,'my_chats')],[t(user.language,'tools'),t(user.language,'account')]];
  const existing=Number((user as any).reply_keyboard_message_id??0);
  if(existing>0){
    // If another request currently owns the creation claim, do not create a second hidden anchor.
    const claimAge=(user as any).reply_keyboard_claimed_at?Date.now()-Date.parse(String((user as any).reply_keyboard_claimed_at)):Infinity;
    if(Number.isFinite(claimAge)&&claimAge<30000)return existing;
  }

  const claimAt=new Date().toISOString();
  const claim=await db.prepare(
    `UPDATE users SET reply_keyboard_claimed_at=?
     WHERE id=? AND (reply_keyboard_claimed_at IS NULL OR reply_keyboard_claimed_at<?)`
  ).bind(claimAt,user.id,new Date(Date.now()-30000).toISOString()).run();
  if(Number(claim.meta?.changes??0)!==1){
    return existing>0?existing:null;
  }

  try{
    if(existing>0){try{await api.deleteMessage(user.id,existing)}catch{}}
    const anchor=await api.sendMessage(user.id,'\u2063',{reply_markup:rk(replyRows)});
    await db.prepare('UPDATE users SET reply_keyboard_message_id=?,reply_keyboard_claimed_at=NULL WHERE id=? AND reply_keyboard_claimed_at=?')
      .bind(anchor.message_id,user.id,claimAt).run();
    (user as any).reply_keyboard_message_id=anchor.message_id;
    (user as any).reply_keyboard_claimed_at=null;
    return anchor.message_id;
  }catch(err){
    console.error('reply_keyboard_setup_error',String(err));
    await db.prepare('UPDATE users SET reply_keyboard_claimed_at=NULL WHERE id=? AND reply_keyboard_claimed_at=?').bind(user.id,claimAt).run();
    return existing>0?existing:null;
  }
}

export async function sendOrEditUi(api:TelegramApi,db:D1Database,user:User,text:string,keyboard:InlineKeyboard|undefined,replyRows:string[][]=[],sourceMessageId?:number){
  const opts:Record<string,unknown>={parse_mode:'HTML',disable_web_page_preview:true, ...(keyboard?{reply_markup:ik(keyboard)}:{})};
  const target=sourceMessageId??user.ui_message_id??undefined;
  if(target){
    try{
      await api.editMessageText(user.id,target,text,opts);
      await db.prepare('UPDATE users SET ui_message_id=? WHERE id=?').bind(target,user.id).run();
      return target;
    }catch(err){
      const editError=String(err);
      if(/message is not modified/i.test(editError))return target;
      if(/there is no text in the message|message can't be edited/i.test(editError)){
        if(text.length>4096)throw new Error('TEXT_TOO_LONG');
        try{await api.deleteMessage(user.id,target)}catch{}
      }else{
        // A transient Telegram/network failure must not destroy a valid UI message.
        console.error('ui_edit_error',String(err));
        return target;
      }
    }
  }
  const msg=await api.sendMessage(user.id,text,opts);
  await db.prepare('UPDATE users SET ui_message_id=? WHERE id=?').bind(msg.message_id,user.id).run();
  return msg.message_id;
}

export async function sendHomeBannerUi(api:TelegramApi,db:D1Database,env:Env,user:User,sourceMessageId?:number){
  await ensurePersistentReplyKeyboard(api,db,user);
  const banner=await repo.getSetting(db,'home_banner_file_id');
  const rows:InlineKeyboard=[[{text:t(user.language,'menu_chat'),callback_data:'chat:open'},{text:t(user.language,'change_model'),callback_data:'models:open'}],[{text:t(user.language,'images'),callback_data:'image:open'},{text:t(user.language,'tools'),callback_data:'tools:open'}],[{text:t(user.language,'my_chats'),callback_data:'chats:open'},{text:t(user.language,'account'),callback_data:'account:open'}]];
  const target=sourceMessageId??user.ui_message_id??undefined;
  if(target){try{await api.deleteMessage(user.id,target)}catch{}}
  if(banner){
    try{
      const msg=await api.sendPhoto(user.id,banner,undefined,{reply_markup:ik(rows)});
      await db.prepare('UPDATE users SET ui_message_id=? WHERE id=?').bind(msg.message_id,user.id).run();
      return msg.message_id;
    }catch(err){
      console.error('home_banner_send_error',String(err));
      const message=String(err);
      // Keep a valid banner through transient Telegram/network failures. Clear
      // it only when Telegram explicitly rejects the stored file_id.
      if(/wrong file identifier|file not found|can't parse InputFile/i.test(message)){
        await repo.setSetting(db,'home_banner_file_id','');
      }
    }
  }
  return sendOrEditUi(api,db,user,t(user.language,'welcome'),rows);
}

function chatPageRows(user:User,chats:Chat[],page:number,total:number,kind:'active'|'archive'){const rows=chats.map(c=>[{text:`${c.title.slice(0,52)}`,callback_data:`chat:view:${c.id}`}]);const nav:any[]=[];if(page>1)nav.push({text:t(user.language,'back'),callback_data:`${kind==='active'?'chats':'archive'}:page:${page-1}`});if(page<total)nav.push({text:t(user.language,'next'),callback_data:`${kind==='active'?'chats':'archive'}:page:${page+1}`});if(nav.length)rows.push(nav);return rows}

export async function mainMenu(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,sourceMessageId?:number){
  return sendHomeBannerUi(api,db,env,user,sourceMessageId);
}

export async function modelScreen(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,sourceMessageId?:number){
 const current=await repo.modelByKey(db,chat.model_key,);
 const families=await repo.listUsableChatFamilies(db,env);
 const family=current?.family??families[0]?.family??'—';
 const text=[t(user.language,'current_model',{model:escapeHtml(current?.name??chat.model_key)}),t(user.language,'chat_model_family',{title:escapeHtml(chat.title),family:escapeHtml(family)}),'',t(user.language,'daily'),t(user.language,'daily_desc'),'',''+t(user.language,'advanced'),t(user.language,'advanced_desc'),t(user.language,'model_cost_note')].join('\n');
 const rows:any[]=[];for(let i=0;i<families.length;i+=3)rows.push(families.slice(i,i+3).map(f=>({text:f.family,callback_data:`family:${encodeURIComponent(f.family)}`})));
 if(families.length===0)rows.push([{text:t(user.language,'no_models'),callback_data:'chat:open'}]);
 rows.push([{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function familyScreen(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,family:string,sourceMessageId?:number){
 const models=await repo.listModelsForFamily(db,env,family);
 const current=await repo.modelByKey(db,chat.model_key);
 const text=[t(user.language,'current_model',{model:escapeHtml(current?.name??chat.model_key)}),t(user.language,'chat_model_family',{title:escapeHtml(chat.title),family:escapeHtml(family)}),'',t(user.language,'daily'),t(user.language,'daily_desc'),'',''+t(user.language,'advanced'),t(user.language,'advanced_desc'),t(user.language,'model_cost_note')].join('\n');
 const rows:any[]=models.map(m=>[{text:`${current?.model_key===m.model_key?'✓ ':''}${repo.modelEmoji(m)} ${m.name} · ${m.cost} ${t(user.language,'points_word')}`,callback_data:`model:set:${encodeURIComponent(m.model_key)}`}]);
 rows.push([{text:t(user.language,'back'),callback_data:'models:open'}]);
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
function escape(s:string){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

export async function chatsScreen(api:TelegramApi,db:D1Database,user:User,page=1,sourceMessageId?:number){
 const limit=(await repo.getChatLimits(db)).active; const totalCount=await repo.countChats(db,user.id,false); const size=5; const total=Math.max(1,Math.ceil(totalCount/size)); const p=Math.min(Math.max(1,page),total); const chats=await repo.listChats(db,user.id,false,p,size);
 const rows=chats.map(c=>[{text:`${user.current_chat_id===c.id?'✓ ':''}${c.title.slice(0,52)}`,callback_data:`chat:view:${c.id}`}]);
 rows.push([{text:t(user.language,'archive_title').replace(/<[^>]+>/g,''),callback_data:'archive:open'}],[{text:t(user.language,'new_chat'),callback_data:'chat:new'}],[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
 const text=`<b>${t(user.language,'chats_title')}</b>\n\n${t(user.language,'chats_current',{title:escape(user.current_chat_id?((await repo.getChat(db,user.current_chat_id,user.id))?.title??'—'):'—')})}\n\n${t(user.language,'chats_hint')}\n\nСледующее сообщение: 💬 обычный чат.`;
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function archiveScreen(api:TelegramApi,db:D1Database,user:User,page=1,sourceMessageId?:number){
 const size=5,totalCount=await repo.countChats(db,user.id,true); const total=Math.max(1,Math.ceil(totalCount/size)); const p=Math.min(Math.max(1,page),total); const chats=await repo.listChats(db,user.id,true,p,size);
 const rows=chats.map(c=>[{text:c.title.slice(0,52),callback_data:`chat:view:${c.id}`}]);
 rows.push([{text:t(user.language,'my_chats'),callback_data:'chats:open'}],[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
 const text=`<b>${t(user.language,'archive_title')}</b>\n\n${t(user.language,'archive_hint')}\n\n${t(user.language,'archive_count',{count:totalCount,limit:(await repo.getChatLimits(db)).archive})}`;
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function chatActionsScreen(api:TelegramApi,db:D1Database,user:User,chat:Chat,sourceMessageId?:number){
 const model=await repo.modelByKey(db,chat.model_key); const modelName=model?.name??chat.model_key; const active=await repo.getUser(db,user.id); const activeTitle=active?.current_chat_id?((await repo.getChat(db,active.current_chat_id,user.id))?.title??'—'):'—';
 const updatedAt=chat.last_continued_at??chat.created_at; const text=`💬 <b>${escape(chat.title)}</b>\n${escape(modelName)}\n\nСоздан: ${escape(formatDialogDate(chat.created_at,user.language))}\nОбновлён: ${escape(formatDialogDate(updatedAt,user.language))}\n\nСейчас вы пишете в: ${escape(activeTitle)}\n\nСледующее сообщение: 💬 обычный чат.`;
 const rows:any[]=[];
 if(chat.is_archived){rows.push([{text:'🔄 Восстановить',callback_data:`chat:unarchive:${chat.id}`}]);}
 else{rows.push([{text:'▶️ Продолжить',callback_data:`chat:continue:${chat.id}`}]);}
 rows.push([{text:'📖 Сообщения',callback_data:`chat:messages:${chat.id}`}]);
 rows.push([{text:'✏️ Переименовать',callback_data:`chat:rename:${chat.id}`}]);
 rows.push([{text:chat.is_archived?'🗑 Удалить':'📁 В архив',callback_data:chat.is_archived?`chat:delete:${chat.id}`:`chat:archive:${chat.id}`}]);
 rows.push([{text:chat.is_archived?'← К архиву':'← К диалогам',callback_data:chat.is_archived?'archive:open':'chats:open'}]);
 rows.push([{text:'← В чат',callback_data:'chat:open'}]);
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function chatMessagesScreen(api:TelegramApi,db:D1Database,user:User,chat:Chat,sourceMessageId?:number){
 const model=await repo.modelByKey(db,chat.model_key); const messages=await repo.getLiveMessages(db,chat.id,user.id,6,6000);
 const preview=messages.length?messages.map(m=>`${m.role==='user'?'Вы':'ИИ'}: ${escape(m.content.length>1200?m.content.slice(0,1200)+'…':m.content)}`).join('\n\n'):t(user.language,'no_messages');
 const text=`💬 <b>${escape(chat.title)}</b>\n${escape(model?.name??chat.model_key)}\n\nПоследние сообщения (до 6, длинные тексты сокращены):\n\n${preview}`;
 const rows=[[{text:chat.is_archived?'🔄 Восстановить':'▶️ Продолжить',callback_data:chat.is_archived?`chat:unarchive:${chat.id}`:`chat:continue:${chat.id}`}],[{text:'✏️ Переименовать',callback_data:`chat:rename:${chat.id}`}],[{text:chat.is_archived?'🗑 Удалить':'📁 В архив',callback_data:chat.is_archived?`chat:delete:${chat.id}`:`chat:archive:${chat.id}`}],[{text:chat.is_archived?'← К архиву':'← К диалогам',callback_data:chat.is_archived?'archive:open':'chats:open'}],[{text:'← В чат',callback_data:'chat:open'}]];
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}

export async function accountScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const [bal,stats,sub,active,archived,chatLimits,freeDaily]=await Promise.all([repo.getBalance(db,user.id),repo.getUserStats(db,user.id),repo.getActiveSubscription(db,user.id),repo.countChats(db,user.id,false),repo.countChats(db,user.id,true),repo.getChatLimits(db),repo.getSetting(db,'free_points_daily')]);const limit=sub?.plan?.points&&sub.plan.points>0?sub.plan.points:Number(freeDaily??50);const subText=sub?.plan?t(user.language,'subscription_info',{plan:user.language==='ru'?sub.plan.title_ru:sub.plan.title_en,days:Math.max(0,Math.ceil((new Date(sub.expires_at).getTime()-Date.now())/86400000)),points:sub.plan.points||100}):t(user.language,'subscription_none');const text=[t(user.language,'account_title'),t(user.language,'tg_id',{id:user.id}),t(user.language,'daily_points',{n:bal.free,limit}),t(user.language,'bonus_points',{n:bal.paid}),subText,t(user.language,'dialogs_info',{active,archived,active_limit:chatLimits.active,archive_limit:chatLimits.archive}),t(user.language,'stats_info',{today:stats.responsesToday,total:stats.totalResponses})].join('\n\n');const rows=[[{text:t(user.language,'plans'),callback_data:'plans:open'},{text:t(user.language,'orders'),callback_data:'orders:open'}],[{text:t(user.language,'language',{lang:user.language==='ru'?'Русский':user.language==='uz'?'O‘zbekcha':'English'}),callback_data:'language:open'},{text:t(user.language,'back_chat'),callback_data:'chat:open'}]];return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId)}

export async function rolesScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
 const roles=await repo.listRoles(db); const chat=user.current_chat_id?await repo.getChat(db,user.current_chat_id,user.id):null; const current=chat?.role_key??null;
 const rows=roles.map(r=>{const name=user.language==='ru'?r.name_ru:user.language==='uz'?(r.role_key==='assistant'?'Yordamchi':r.name_en):r.name_en; return [{text:`${current===r.role_key?'✓ ':''}${name}`,callback_data:`role:set:${r.role_key}`}]});
 rows.push([{text:'← Назад',callback_data:'tools:open'}],[{text:'💬 В чат',callback_data:'chat:open'}]);
 const currentName=current?(roles.find(r=>r.role_key===current)?.[user.language==='ru'?'name_ru':'name_en']??''):'';
 const text=`🎭 <b>Роли</b>\n\nВыберите роль для общения с AI.\n\nТекущая роль: ${currentName?escape(currentName):'нет'}`;
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function qwenSettingsScreen(api:TelegramApi,db:D1Database,env:Env,user:User,chat:Chat,sourceMessageId?:number){
 const model=await repo.modelByKey(db,chat.model_key);
 if(!model||model.provider!=='xkiro'||model.model_id!=='qwen/qwen3.8-max:free')return sendOrEditUi(api,db,user,t(user.language,'model_unavailable'),[[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]],[],sourceMessageId);
 const settings=await repo.ensureChatAiSettings(db,user.id,chat.id,model.model_key);
 const reasoning=settings.reasoning_mode==='fast'?t(user.language,'qwen_reasoning_fast'):settings.reasoning_mode==='max'?t(user.language,'qwen_reasoning_max'):t(user.language,'qwen_reasoning_deep');
 const web=settings.web_search_enabled? t(user.language,'qwen_web_search_on'):t(user.language,'qwen_web_search_off');
 const text=[t(user.language,'qwen_settings_title'),t(user.language,'qwen_settings_hint'),t(user.language,'qwen_reasoning_current',{mode:reasoning}),t(user.language,'qwen_web_current',{state:web})].join('\n\n');
 const rows=[
  [{text:`${t(user.language,'qwen_reasoning')} · ${reasoning}`,callback_data:'qwen:reasoning'}],
  [{text:`${t(user.language,'qwen_web_search')} · ${web}`,callback_data:'qwen:web'}],
  [{text:t(user.language,'qwen_reset_settings'),callback_data:'qwen:reset'}],
  [{text:t(user.language,'back_chat'),callback_data:'chat:open'}]
 ];
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}

export async function qwenReasoningScreen(api:TelegramApi,db:D1Database,user:User,chat:Chat,sourceMessageId?:number){
 const model=await repo.modelByKey(db,chat.model_key);if(!model||model.model_id!=='qwen/qwen3.8-max:free')return;
 const settings=await repo.ensureChatAiSettings(db,user.id,chat.id,model.model_key);
 const labels:[string,string][]=[['fast',t(user.language,'qwen_reasoning_fast')],['deep',t(user.language,'qwen_reasoning_deep')],['max',t(user.language,'qwen_reasoning_max')]];
 const rows=labels.map(([key,label])=>[{text:`${settings.reasoning_mode===key?'✅ ':''}${label}`,callback_data:`qwen:setreasoning:${key}`}]);
 rows.push([{text:t(user.language,'back'),callback_data:'qwen:settings'}]);
 return sendOrEditUi(api,db,user,t(user.language,'qwen_reasoning'),rows,[],sourceMessageId);
}

export async function searchScreen(api:TelegramApi,db:D1Database,env:Env,user:User,sourceMessageId?:number){
 const title=t(user.language,'search_title');
 const back=[{text:t(user.language,'search_back'),callback_data:'search:back'}];
 if(Number((await repo.getSetting(db,'feature_search'))??1)===0){return sendOrEditUi(api,db,user,title+'\n\n'+t(user.language,'no_search_models'),[back],[ ],sourceMessageId);}
 const models=await repo.listSearchModels(db,env); if(!models.length)return sendOrEditUi(api,db,user,title+'\n\n'+t(user.language,'no_search_models'),[back],[],sourceMessageId);
 const selected=user.search_model_key?models.find(m=>m.model_key===user.search_model_key):models[0];
 const text=`${selected?escapeHtml(selected.name):'🔎 Поиск'}\n\n🔎 Поиск в интернете · ${selected?.cost??0} ${t(user.language,'points_word')} за запрос\n\nОтправьте вопрос. Ответ содержит\nссылки на источники.\n\nСледующие вопросы тоже будут с\nпоиском.`;
 const rows=models.map(m=>[{text:`${user.search_model_key===m.model_key?'✓ ':''}${repo.modelEmoji(m)} ${escapeHtml(m.name)} · ${m.cost} ${t(user.language,'points_word')}`,callback_data:`search:set:${encodeURIComponent(m.model_key)}`}]);
 rows.push([back[0]],[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}

const planTitle=(u:User,p:Plan)=>u.language==='ru'?p.title_ru:p.title_en;
export async function plansScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const plans=await repo.listPlans(db,'subscription');const wanted=plans.filter(p=>['sub-1w','sub-1m'].includes(p.plan_key));const rows=wanted.map(p=>[{text:`${planTitle(user,p)} · ${formatRub(p.price_minor)} ₽`,callback_data:`plan:detail:${p.plan_key}`}]);rows.push([{text:t(user.language,'all_plans'),callback_data:'plans:all'}],[{text:t(user.language,'orders'),callback_data:'orders:open'}],[{text:t(user.language,'back_chat'),callback_data:'chat:open'}]);return sendOrEditUi(api,db,user,t(user.language,'plans_title')+'\n\n'+wanted.map(p=>`${planTitle(user,p)} · ${formatRub(p.price_minor)} ₽`).join('\n'),rows,[],sourceMessageId)}
export async function allPlansScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const plans=await repo.listPlans(db,'subscription');const rows=plans.map(p=>[{text:`${planTitle(user,p)} · ${formatRub(p.price_minor)} ₽`,callback_data:`plan:detail:${p.plan_key}`}]);rows.push([{text:t(user.language,'orders'),callback_data:'orders:open'}],[{text:t(user.language,'back'),callback_data:'plans:open'}]);return sendOrEditUi(api,db,user,t(user.language,'plans_title'),rows,[],sourceMessageId)}
export async function planDetailsScreen(api:TelegramApi,db:D1Database,user:User,planKey:string,sourceMessageId?:number){const p=await repo.getPlan(db,planKey);if(!p||!p.is_active||p.kind!=='subscription'||!p.duration_days)return;const points=p.points||100;const archive=p.duration_days&&p.duration_days>=30?48:24;const images=t(user.language,'plan_images_yes');const starsEnabled=await repo.isPaymentMethodEnabled(db,'telegram_stars');const stars=starsEnabled?await repo.getPlanPaymentPrice(db,p.plan_key,'telegram_stars'):null;const text=t(user.language,'plan_details',{name:escapeHtml(planTitle(user,p)),price:formatRub(p.price_minor),stars:stars?.amount??'—',points,archive:archive===48?t(user.language,'plan_archive_48'):t(user.language,'plan_archive_24'),images});const rows=[[{text:t(user.language,'buy'),callback_data:`pay:methods:${p.plan_key}`}],[{text:t(user.language,'my_account'),callback_data:'account:open'},{text:t(user.language,'back'),callback_data:'plans:all'}]];return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId)}
export async function paymentMethodsScreen(api:TelegramApi,db:D1Database,user:User,planKey:string,sourceMessageId?:number){
 const p=await repo.getPlan(db,planKey);
 if(!p||!p.is_active||p.kind!=='subscription'||!p.duration_days)return;
 const starsEnabled=await repo.isPaymentMethodEnabled(db,'telegram_stars');
 const stars=starsEnabled?await repo.getPlanPaymentPrice(db,planKey,'telegram_stars'):null;
 const rows:any[]=[];
 if(stars?.amount && stars.currency==='XTR') rows.push([{text:`⭐ Telegram Stars · ${stars.amount}`,callback_data:`pay:stars:${p.plan_key}`}]);
 const unavailable=!rows.length;
 rows.push([{text:t(user.language,'back'),callback_data:`plan:detail:${p.plan_key}`}]);
 const text=t(user.language,'payment_methods_title')+`\n\n`+t(user.language,'payment_methods_hint',{name:escapeHtml(planTitle(user,p))})+(unavailable?`\n\n${t(user.language,'payment_unavailable')}`:'');
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function pointPlansScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){return plansScreen(api,db,user,sourceMessageId)}
export async function ordersScreen(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const orders=await repo.listUserOrders(db,user.id,1,20);const lines=orders.map(o=>{const title=planTitle(user,{title_ru:o.title_ru,title_en:o.title_en} as Plan);const amount=o.currency==='XTR'?`${o.amount_minor} ⭐`:`${formatRub(o.amount_minor)} ${o.currency}`;const status=o.status==='pending'?t(user.language,'pending_order'):o.status==='paid'?t(user.language,'paid_order'):o.status==='expired'?t(user.language,'expired_order'):o.status==='cancelled'?t(user.language,'cancelled_order'):o.status==='refunded'?t(user.language,'refunded_order'):o.status;return `${title} · ${amount} · ${status}`});return sendOrEditUi(api,db,user,t(user.language,'orders_title')+'\n\n'+(lines.join('\n')||t(user.language,'no_orders')),[[{text:t(user.language,'back'),callback_data:'account:open'}]],[],sourceMessageId)}

export function imageTemplates(lang:Lang){return IMAGE_TEMPLATES.map(x=>({id:x.id,name:x.name[lang],description:x.description[lang]}))}
function parseImageCfg(m:Model){try{return JSON.parse(m.config||'{}') as any}catch{return {}}}
function imageOptions(m:Model){const c=parseImageCfg(m);return {aspects:(c.aspect_ratios as string[]|undefined)??['1:1','16:9','9:16','4:3','3:4'],qualities:(c.qualities as string[]|undefined)??['standard','hd'],defaultAspect:c.default_aspect_ratio??'1:1',defaultQuality:c.default_quality??'standard',supportsInputImage:c.supports_input_image===true,emoji:repo.modelEmoji(m)}}
export async function imageModelScreen(api:TelegramApi,db:D1Database,env:Env,user:User,sourceMessageId?:number){
 const paused=Number((await repo.getSetting(db,'feature_image'))??1)===0;
 const models=await repo.listImageModels(db,env);
 if(paused||!models.length)return sendOrEditUi(api,db,user,`${t(user.language,'images_title')}\n\n${t(user.language,'images_dev')}` ,[[{text:t(user.language,'back'),callback_data:'menu:open'}]],[],sourceMessageId);
 const text='🤖 <b>AI модели</b>\n\nВыберите модель для создания\nи редактирования изображений.\n\nДоступные модели:';
 const rows=models.map(m=>[{text:`${repo.modelEmoji(m)} ${m.name}`,callback_data:`image:model:${encodeURIComponent(m.model_key)}`}]);
 rows.push([{text:t(user.language,'back'),callback_data:'menu:open'}]);
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function imageSettingsScreen(api:TelegramApi,db:D1Database,env:Env,user:User,modelKey:string,state:any,sourceMessageId?:number){
 const m=await repo.modelByKey(db,modelKey);if(!m||m.type!=='image'||!m.is_active||!repo.providerConfigured(m,env))return imageModelScreen(api,db,env,user,sourceMessageId);
 const o=imageOptions(m);state.aspect??=o.defaultAspect;state.quality??=o.defaultQuality;state.templateId??=null;state.hasImage=Boolean(state.hasImage);
 const tpl=state.templateId?IMAGE_TEMPLATES.find(x=>x.id===state.templateId):undefined;
 const qualityCost=await repo.imageQualityCost(db,String(state.quality));const cost=m.cost+qualityCost+(state.hasImage?await repo.imageInputCost(db):0);
 const text=t(user.language,'image_settings',{model:escapeHtml(m.name),aspect:escapeHtml(String(state.aspect)),quality:escapeHtml(String(state.quality)),template:escapeHtml(tpl?tpl.name[user.language]:'—'),input:state.hasImage?t(user.language,'input_ready'):t(user.language,'input_none'),cost});
 const rows:InlineKeyboard=[[{text:t(user.language,'aspect'),callback_data:`image:aspect:${encodeURIComponent(modelKey)}`}],[{text:t(user.language,'quality'),callback_data:`image:quality:${encodeURIComponent(modelKey)}`}],[{text:t(user.language,'templates'),callback_data:`image:templates:${encodeURIComponent(modelKey)}`}]];
 if(o.supportsInputImage)rows.push([{text:t(user.language,'add_image'),callback_data:`image:toggle:${encodeURIComponent(modelKey)}`}]);
 rows.push([{text:t(user.language,'continue_image'),callback_data:`image:continue:${encodeURIComponent(modelKey)}`}],[{text:t(user.language,'back'),callback_data:'image:open'}]);
 return sendOrEditUi(api,db,user,text,rows,[],sourceMessageId);
}
export async function imageAspectScreen(api:TelegramApi,db:D1Database,env:Env,user:User,modelKey:string,state:any,sourceMessageId?:number){const m=await repo.modelByKey(db,modelKey);if(!m)return;const o=imageOptions(m);const rows=o.aspects.map(a=>[{text:`${state.aspect===a?'✅ ':''}${a}`,callback_data:`image:setaspect:${encodeURIComponent(modelKey)}:${encodeURIComponent(a)}`}]);rows.push([{text:t(user.language,'back'),callback_data:`image:settings:${encodeURIComponent(modelKey)}`}]);return sendOrEditUi(api,db,user,`📐 <b>Соотношение сторон</b>\n\nВыберите подходящее соотношение сторон для вашего изображения.`,rows,[],sourceMessageId)}
export async function imageQualityScreen(api:TelegramApi,db:D1Database,env:Env,user:User,modelKey:string,state:any,sourceMessageId?:number){const m=await repo.modelByKey(db,modelKey);if(!m)return;const o=imageOptions(m);const rows=o.qualities.map(q=>[{text:`${state.quality===q?'✅ ':''}${q}`,callback_data:`image:setquality:${encodeURIComponent(modelKey)}:${encodeURIComponent(q)}`}] );rows.push([{text:t(user.language,'back'),callback_data:`image:settings:${encodeURIComponent(modelKey)}`}]);return sendOrEditUi(api,db,user,`✨ <b>Качество</b>\n\nВыберите качество изображения.`,rows,[],sourceMessageId)}
export async function imageTemplatesScreen(api:TelegramApi,db:D1Database,env:Env,user:User,modelKey:string,state:any,sourceMessageId?:number){const rows:any[]=IMAGE_TEMPLATES.map(x=>[{text:`${state.templateId===x.id?'✅ ':''}${x.name[user.language]}`,callback_data:`image:usetemplate:${encodeURIComponent(modelKey)}:${x.id}`}]);rows.unshift([{text:`${state.templateId===null?'✅ ':''}🚫 Без шаблона`,callback_data:`image:usetemplate:${encodeURIComponent(modelKey)}:none`}]);rows.push([{text:t(user.language,'back'),callback_data:`image:settings:${encodeURIComponent(modelKey)}`}]);return sendOrEditUi(api,db,user,`🌄 <b>Шаблоны</b>\n\nВыберите готовый шаблон или используйте свой промпт без шаблона.`,rows,[],sourceMessageId)}
export async function imageTemplateScreen(api:TelegramApi,db:D1Database,env:Env,user:User,modelKey:string,templateId:string,state:any,sourceMessageId?:number){return imageTemplatesScreen(api,db,env,user,modelKey,state,sourceMessageId)}
export async function imageAddImageScreen(api:TelegramApi,db:D1Database,env:Env,user:User,modelKey:string,state:any,sourceMessageId?:number){return imageSettingsScreen(api,db,env,user,modelKey,state,sourceMessageId)}
