import type { Env } from '../env';
import type { User, Model } from '../db/types';
import { TelegramApi, isBotBlockedError } from '../telegram/api';
import { ik, rk } from '../telegram/markup';
import * as repo from '../db/repo';
import { t } from '../i18n';
import { validPage } from '../utils/security';
import { uuid, nowIso } from '../db/db';

export async function adminPanel(api:TelegramApi,db:D1Database,env:Env,user:User){
  const text=t(user.language,'admin_title');
  const kb=ik([
    [{text:'📊 Статистика',callback_data:'admin:stats'},{text:'👥 Пользователи',callback_data:'admin:users'}],
    [{text:'🤖 Модели',callback_data:'admin:models'},{text:'⚙️ Настройки',callback_data:'admin:settings'}],
    [{text:'🚫 Блокировки',callback_data:'admin:blocks'},{text:'📢 Рассылка',callback_data:'admin:broadcast'}]
  ]);
  const msg=await api.sendMessage(user.id,text,{parse_mode:'HTML',reply_markup:kb});await db.prepare('UPDATE users SET ui_message_id=? WHERE id=?').bind(msg.message_id,user.id).run();
}

export async function adminStats(api:TelegramApi,db:D1Database,user:User){
  const queries=await Promise.all([
    repo.countUsers(db),
    db.prepare("SELECT COUNT(*) count FROM users WHERE julianday(created_at)>=julianday('now','-1 day')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) count FROM users WHERE julianday(last_seen_at)>=julianday('now','-1 day')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE kind='ai' AND julianday(created_at)>=julianday('now','-1 day')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE kind='ai' AND julianday(created_at)>=julianday('now','-30 day')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE status='error' AND julianday(created_at)>=julianday('now','-1 day')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) count FROM messages WHERE julianday(expires_at)>julianday('now')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) count,SUM(amount_minor) revenue FROM orders WHERE status='paid'").first<{count:number;revenue:number}>(),
    db.prepare("SELECT COUNT(DISTINCT user_id) count FROM subscriptions WHERE julianday(expires_at)>julianday('now')").first<{count:number}>()
  ]);
  const [total,new24,active24,req24,req30,err24,live,paid,subs]=queries;
  const text=`📊 <b>Статистика</b>\n\nПользователей: ${total}\nНовых за 24ч: ${Number(new24?.count??0)}\nАктивных за 24ч: ${Number(active24?.count??0)}\nAI-запросов 24ч: ${Number(req24?.count??0)}\nAI-запросов 30д: ${Number(req30?.count??0)}\nОшибок 24ч: ${Number(err24?.count??0)}\nЖивых сообщений: ${Number(live?.count??0)}\nОплаченных заказов: ${Number(paid?.count??0)}\nВыручка: ${(Number(paid?.revenue??0)/100).toFixed(2)} RUB\nАктивных подписок: ${Number(subs?.count??0)}`;
  await api.sendMessage(user.id,text,{parse_mode:'HTML',reply_markup:ik([[{text:'← Админ',callback_data:'admin:open'}]])});
}

export async function adminUsers(api:TelegramApi,db:D1Database,user:User,page=1){
  const p=validPage(String(page),1);const rows=await repo.listPendingUsers(db,p,20);let text=`👥 <b>Пользователи · ${p}</b>\n\n`;text+=rows.length?rows.map(x=>`${x.id} ${x.username?`@${x.username}`:''} · ${x.created_at.slice(0,10)}${x.is_blocked?' · 🚫':''}${x.bot_blocked?' · 🔕':''}`).join('\n'):'Пусто';
  const nav=[] as any[];if(p>1)nav.push({text:'←',callback_data:`admin:users:${p-1}`});nav.push({text:'→',callback_data:`admin:users:${p+1}`});
  await api.sendMessage(user.id,text,{parse_mode:'HTML',reply_markup:ik([[{text:'🔎 Карточка /user',callback_data:'admin:hint:user'}],nav,[{text:'← Админ',callback_data:'admin:open'}]])});
}

export async function adminBlocks(api:TelegramApi,db:D1Database,user:User){
  const rows=await db.prepare('SELECT id,username,block_reason FROM users WHERE is_blocked=1 ORDER BY id DESC LIMIT 100').all<{id:number;username:string|null;block_reason:string|null}>();
  let text='🚫 <b>Блокировки</b>\n\n';text+=rows.results?.length?rows.results.map(x=>`${x.id} ${x.username?`@${x.username}`:''}${x.block_reason?` — ${x.block_reason}`:''}`).join('\n'):'Пусто';
  await api.sendMessage(user.id,text,{parse_mode:'HTML',reply_markup:ik([[{text:'← Админ',callback_data:'admin:open'}]])});
}

export async function adminSettings(api:TelegramApi,db:D1Database,user:User){
  const rows=await repo.listSettings(db);let text='⚙️ <b>Настройки</b>\n\n';for(const r of rows)text+=`<code>${r.key}</code> = ${r.value}\n`;text+='\nИзменение: /setting &lt;key&gt; &lt;value&gt;';await api.sendMessage(user.id,text,{parse_mode:'HTML',reply_markup:ik([[{text:'← Админ',callback_data:'admin:open'}]])});}

export async function adminModels(api:TelegramApi,db:D1Database,env:Env,user:User){
  const models=await repo.adminModels(db);let text='🤖 <b>Модели</b>\n\n';for(const m of models){const configured=repo.providerConfigured(m,env);const icon=!m.is_active?'⛔':configured?'✅':'🔑';text+=`${icon} <code>${m.model_key}</code> · ${m.name} · ${m.provider} · ${m.cost}\n`;}
  const buttons=models.map(m=>({text:(m.is_active?'✅ ':'⛔ ')+m.name.slice(0,25),callback_data:`admin:modeltoggle:${encodeURIComponent(m.model_key)}`}));const rows=[];for(let i=0;i<buttons.length;i+=2)rows.push(buttons.slice(i,i+2));rows.push([{text:'← Админ',callback_data:'admin:open'}]);await api.sendMessage(user.id,text,{parse_mode:'HTML',reply_markup:ik(rows)});
}

export async function toggleModel(api:TelegramApi,db:D1Database,key:string){const m=await repo.modelByKey(db,key);if(!m)return api.answerCallback('', '');await db.prepare('UPDATE models SET is_active=? WHERE model_key=?').bind(m.is_active?0:1,key).run();}

export async function startBroadcast(api:TelegramApi,db:D1Database,user:User){
  await db.prepare('INSERT INTO pending_actions(user_id,kind,payload,expires_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at,created_at=excluded.created_at').bind(user.id,'broadcast_content',null,new Date(Date.now()+3600000).toISOString(),nowIso()).run();
  await api.sendMessage(user.id,t(user.language,'broadcast_start'),{parse_mode:'HTML',reply_markup:ik([[{text:'❌ Отмена',callback_data:'broadcast:cancel'}]])});
}

export async function receiveBroadcastContent(api:TelegramApi,db:D1Database,env:Env,user:User,message:any){
  const action=await db.prepare('SELECT * FROM pending_actions WHERE user_id=? AND kind=? AND expires_at>?').bind(user.id,'broadcast_content',nowIso()).first<any>();if(!action)return false;
  const bId=uuid();const photo=Array.isArray(message.photo)&&message.photo.length?message.photo[message.photo.length-1]:null;const messageType=photo?'photo':message.text?'text':'unsupported';if(messageType==='unsupported'){await api.sendMessage(user.id,'Поддерживаются только текст и фото с подписью.');return true;}
  const countRow=await db.prepare('SELECT COUNT(*) count,COALESCE(MAX(id),0) max_id FROM users WHERE is_blocked=0 AND bot_blocked=0').first<{count:number;max_id:number}>();const total=Number(countRow?.count??0);const maxUserId=Number(countRow?.max_id??0);
  const now=nowIso();
  await db.batch([
    db.prepare(`INSERT INTO broadcasts(id,admin_user_id,message_type,text,caption,file_id,source_chat_id,source_message_id,status,total,sent,success,failed,blocked,progress_message_id,last_user_id,max_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(bId,user.id,messageType,message.text??null,message.caption??null,photo?.file_id??null,message.chat.id,message.message_id,'preview',total,0,0,0,0,null,0,maxUserId,now,now),
    db.prepare('DELETE FROM pending_actions WHERE user_id=?').bind(user.id)
  ]);
  const preview=await api.sendMessage(user.id,t(user.language,'broadcast_preview',{count:total}),{parse_mode:'HTML',reply_markup:ik([[{text:'✅ Отправить',callback_data:`broadcast:send:${bId}`},{text:'❌ Отмена',callback_data:`broadcast:cancel:${bId}`}]] )});
  await db.prepare('UPDATE broadcasts SET progress_message_id=?,updated_at=? WHERE id=?').bind(preview.message_id,nowIso(),bId).run();
  return true;
}

export async function cancelBroadcast(api:TelegramApi,db:D1Database,user:User,id?:string){if(id)await db.prepare("DELETE FROM broadcasts WHERE id=? AND admin_user_id=? AND status='preview'").bind(id,user.id).run();await db.prepare("DELETE FROM pending_actions WHERE user_id=? AND kind='broadcast_content'").bind(user.id).run();await api.sendMessage(user.id,t(user.language,'broadcast_cancel'),{parse_mode:'HTML'});}

export async function sendBroadcastBatch(api:TelegramApi,db:D1Database,env:Env,broadcastId:string,batchSize=25){
  const b=await db.prepare('SELECT * FROM broadcasts WHERE id=?').bind(broadcastId).first<any>();if(!b)return;
  if(b.status==='preview')await db.prepare('UPDATE broadcasts SET status=?,updated_at=? WHERE id=?').bind('sending',nowIso(),broadcastId).run();
  const lastUserId=Number(b.last_user_id??0);const maxUserId=Number(b.max_user_id??0);const users=await db.prepare('SELECT id FROM users WHERE id>? AND id<=? AND is_blocked=0 AND bot_blocked=0 ORDER BY id LIMIT ?').bind(lastUserId,maxUserId,batchSize).all<{id:number}>();
  let sent=Number(b.sent),success=Number(b.success),failed=Number(b.failed),blocked=Number(b.blocked),cursor=lastUserId;
  for(const row of users.results??[]){cursor=row.id;sent++;try{
      if(b.source_chat_id && b.source_message_id) await api.copyMessage(row.id,b.source_chat_id,b.source_message_id);
      else if(b.message_type==='photo') await api.sendPhoto(row.id,b.file_id,b.caption??undefined,{parse_mode:'HTML'});
      else await api.sendMessage(row.id,b.text??'',{parse_mode:'HTML'});
      success++;
    }catch(err){failed++;if(isBotBlockedError(err)){blocked++;await db.prepare('UPDATE users SET bot_blocked=1 WHERE id=?').bind(row.id).run();}}
  }
  const total=Number(b.total);const status=sent>=total?'done':'sending';await db.prepare('UPDATE broadcasts SET sent=?,success=?,failed=?,blocked=?,status=?,last_user_id=?,updated_at=? WHERE id=?').bind(sent,success,failed,blocked,status,cursor,nowIso(),broadcastId).run();
  const langUser=await repo.getUser(db,b.admin_user_id);if(langUser){const progress=t(langUser.language,status==='done'?'broadcast_done':'broadcast_running',{sent,total,success,failed});try{if(b.progress_message_id)await api.editMessageText(langUser.id,Number(b.progress_message_id),progress,{parse_mode:'HTML'});else{const m=await api.sendMessage(langUser.id,progress,{parse_mode:'HTML'});await db.prepare('UPDATE broadcasts SET progress_message_id=? WHERE id=?').bind(m.message_id,broadcastId).run();}}catch{}}
  if(status==='done')await db.prepare('DELETE FROM broadcasts WHERE id=?').bind(broadcastId).run();
}

export async function resumeBroadcasts(api:TelegramApi,db:D1Database,env:Env){const rows=await db.prepare("SELECT id FROM broadcasts WHERE status='sending' ORDER BY created_at LIMIT 3").all<{id:string}>();for(const b of rows.results??[])await sendBroadcastBatch(api,db,env,b.id,25);}
