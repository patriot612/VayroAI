import type { Env } from '../env';
import type { User, Model } from '../db/types';
import { TelegramApi, isBotBlockedError } from '../telegram/api';
import { ik } from '../telegram/markup';
import * as repo from '../db/repo';
import { t } from '../i18n';
import { validPage } from '../utils/security';
import { uuid, nowIso } from '../db/db';
import * as screens from '../ui/screens';
import { escapeHtml } from '../utils/text';
import { validateStarRefund } from '../telegram/stars';

async function ui(api:TelegramApi,db:D1Database,user:User,text:string,rows:any[],sourceMessageId?:number){return screens.sendOrEditUi(api,db,user,text,rows,[],sourceMessageId)}

export async function adminPanel(api:TelegramApi,db:D1Database,env:Env,user:User,sourceMessageId?:number){return ui(api,db,user,t(user.language,'admin_title'),[
 [{text:t(user.language,'admin_stats'),callback_data:'admin:stats'},{text:t(user.language,'admin_users'),callback_data:'admin:users'}],
 [{text:t(user.language,'admin_models'),callback_data:'admin:models'},{text:t(user.language,'admin_prices'),callback_data:'admin:prices'}],
 [{text:t(user.language,'admin_payments'),callback_data:'admin:payments'}],
 [{text:t(user.language,'admin_subs'),callback_data:'admin:subs'},{text:t(user.language,'admin_points'),callback_data:'admin:points'}],
 [{text:t(user.language,'admin_settings'),callback_data:'admin:settings'},{text:t(user.language,'admin_features'),callback_data:'admin:features'}],
 [{text:t(user.language,'banner_admin'),callback_data:'admin:banner'}],
 [{text:t(user.language,'admin_blocks'),callback_data:'admin:blocks'},{text:t(user.language,'admin_broadcast'),callback_data:'admin:broadcast'}]
 ],sourceMessageId)}

const back=(user:User)=>[{text:t(user.language,'admin_back'),callback_data:'admin:open'}];
export async function adminStats(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const [total,new24,active24,req24,req30,err24,live,paid,subs,images,searches,rubRevenue,starsRevenue]=await Promise.all([repo.countUsers(db),db.prepare("SELECT COUNT(*) count FROM users WHERE julianday(created_at)>=julianday('now','-1 day')").first<any>(),db.prepare("SELECT COUNT(*) count FROM users WHERE julianday(last_seen_at)>=julianday('now','-1 day')").first<any>(),db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE kind='ai' AND julianday(created_at)>=julianday('now','-1 day')").first<any>(),db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE kind='ai' AND julianday(created_at)>=julianday('now','-30 day')").first<any>(),db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE status='error' AND julianday(created_at)>=julianday('now','-1 day')").first<any>(),db.prepare("SELECT COUNT(*) count FROM messages WHERE julianday(expires_at)>julianday('now')").first<any>(),db.prepare("SELECT COUNT(*) count FROM orders WHERE status='paid'").first<any>(),db.prepare("SELECT COUNT(DISTINCT user_id) count FROM subscriptions WHERE julianday(expires_at)>julianday('now')").first<any>(),db.prepare("SELECT COUNT(*) count FROM image_generations WHERE status='done' AND julianday(created_at)>=julianday('now','-30 day')").first<any>(),db.prepare("SELECT COUNT(*) count FROM usage_logs WHERE kind='search' AND julianday(created_at)>=julianday('now','-30 day')").first<any>(),db.prepare("SELECT COALESCE(SUM(amount_minor),0) revenue FROM orders WHERE status='paid' AND currency!='XTR'").first<any>(),db.prepare("SELECT COALESCE(SUM(amount_minor),0) revenue FROM orders WHERE status='paid' AND currency='XTR'").first<any>()]);const text=`📊 <b>Статистика</b>\n\nПользователей: ${total}\nНовых 24ч: ${Number(new24?.count??0)}\nАктивных 24ч: ${Number(active24?.count??0)}\nAI-запросов 24ч: ${Number(req24?.count??0)}\nAI-запросов 30д: ${Number(req30?.count??0)}\nОшибок 24ч: ${Number(err24?.count??0)}\nЖивых сообщений: ${Number(live?.count??0)}\nИзображений 30д: ${Number(images?.count??0)}\nПоисков 30д: ${Number(searches?.count??0)}\nОплаченных заказов: ${Number(paid?.count??0)}\nВыручка RUB: ${(Number(rubRevenue?.revenue??0)/100).toFixed(2)}\nВыручка Stars: ${Number(starsRevenue?.revenue??0)} ⭐\nАктивных подписок: ${Number(subs?.count??0)}`;return ui(api,db,user,text,[back(user)],sourceMessageId)}
export async function adminUsers(api:TelegramApi,db:D1Database,user:User,page=1,sourceMessageId?:number){const p=validPage(String(page),1);const rows=await repo.listPendingUsers(db,p,20);let text=`👥 <b>Пользователи · ${p}</b>\n\n`;text+=rows.length?rows.map(x=>`${x.id} ${x.username?`@${x.username}`:''} · ${x.created_at.slice(0,10)}${x.is_blocked?' · 🚫':''}${x.bot_blocked?' · 🔕':''}`).join('\n'):'Пусто';const nav:any[]=[];if(p>1)nav.push({text:'⬅️ Назад',callback_data:`admin:users:${p-1}`});if(rows.length===20)nav.push({text:'Дальше ➡️',callback_data:`admin:users:${p+1}`});return ui(api,db,user,text,[nav,back(user)],sourceMessageId)}
export async function adminBlocks(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const rows=await db.prepare('SELECT id,username,block_reason FROM users WHERE is_blocked=1 ORDER BY id DESC LIMIT 100').all<any>();const text='🚫 <b>Блокировки</b>\n\n'+((rows.results??[]).map(x=>`${x.id} ${x.username?`@${x.username}`:''}${x.block_reason?` — ${x.block_reason}`:''}`).join('\n')||'Пусто');return ui(api,db,user,text,[back(user)],sourceMessageId)}
export async function adminSettings(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const rows=await repo.listSettings(db);const text='⚙️ <b>Настройки</b>\n\n'+rows.map(r=>`<code>${r.key}</code> = ${r.value}`).join('\n')+'\n\n/setting &lt;key&gt; &lt;value&gt;';return ui(api,db,user,text,[back(user)],sourceMessageId)}
export async function adminPrices(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){const plans=await repo.listPlans(db,'subscription');const models=await repo.adminModels(db);const starPrices=await Promise.all(plans.map(async p=>({plan:p,price:await repo.getPlanPaymentPrice(db,p.plan_key,'telegram_stars')})));const qualityKeys=['low','standard','medium','high','ultra','hd'];const qualityPrices=await Promise.all(qualityKeys.map(async q=>({q,price:await repo.imageQualityCost(db,q)})));const inputCost=await repo.imageInputCost(db);const text='💰 <b>Цены</b>\n\nТарифы:\n'+starPrices.map(x=>`${x.plan.plan_key} · ${x.plan.price_minor/100} ${x.plan.currency} · ⭐ ${x.price?.amount??'—'}`).join('\n')+'\n\nМодели:\n'+models.map(m=>`${m.model_key} · ${m.cost} points`).join('\n')+'\n\nКачество изображений:\n'+qualityPrices.map(x=>`${x.q} · +${x.price} points`).join('\n')+`\n\nИсходное изображение: +${inputCost} points\n\nПодписка Stars: /price stars:<plan_key> <stars>\nКачество: /price quality:<quality_key> <price>\nИзображение: /price image_input <price>\nМодель: /price <model_key> <price>`;return ui(api,db,user,text,[back(user)],sourceMessageId)}
export async function adminPayments(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
  const rows=await repo.listAdminStarsPayments(db,20);
  if(!rows.length)return ui(api,db,user,'💳 <b>'+t(user.language,'admin_payments')+'</b>\n\n'+t(user.language,'no_orders'),[back(user)],sourceMessageId);
  const text='💳 <b>'+t(user.language,'admin_payments')+'</b>\n\n'+rows.map(o=>{
    const name=o.username?`@${escapeHtml(o.username)}`:escapeHtml(o.first_name??String(o.user_id));
    const state=o.payment_status==='refunded'?t(user.language,'refund_status_refunded'):o.payment_status==='refund_pending'?t(user.language,'refund_status_pending'):o.refund_error?t(user.language,'refund_status_error'):t(user.language,'refund_status_paid');
    return `<code>${escapeHtml(o.id)}</code> · ${name} · <b>${o.amount_minor} ⭐</b> · ${state}`;
  }).join('\n');
  const buttons:any[]=[];
  for(const o of rows){
    if(o.payment_status==='paid') buttons.push([{text:`↩️ ${o.amount_minor} ⭐ ${o.username?'@'+o.username:o.user_id}`,callback_data:`admin:refund:${o.id}`}]);
    else if(o.payment_status==='refund_pending') buttons.push([{text:`⏳ ${o.amount_minor} ⭐ ${o.username?'@'+o.username:o.user_id}`,callback_data:`admin:refund:${o.id}`}]);
    else if(o.payment_status==='refunded') buttons.push([{text:`✅ ${o.amount_minor} ⭐ ${o.username?'@'+o.username:o.user_id}`,callback_data:`admin:refund:${o.id}`}]);
  }
  buttons.push(back(user));
  return ui(api,db,user,text,buttons,sourceMessageId);
}

export async function adminRefundDetails(api:TelegramApi,db:D1Database,user:User,orderId:string,sourceMessageId?:number){
  const order=await repo.getRefundableStarsOrder(db,orderId);
  const validation=validateStarRefund(order?{order_status:order.status,provider:order.provider,currency:order.currency,payment_status:order.payment_status,charge_id:order.provider_payment_id,user_id:order.user_id}:null);
  if(!order)return ui(api,db,user,'⚠️ '+t(user.language,'not_found'),[back(user)],sourceMessageId);
  const name=order.username?`@${escapeHtml(order.username)}`:escapeHtml(order.first_name??String(order.user_id));
  const status=order.payment_status==='refunded'?t(user.language,'refund_status_refunded'):order.payment_status==='refund_pending'?t(user.language,'refund_status_pending'):order.refund_error?t(user.language,'refund_status_error'):t(user.language,'refund_status_paid');
  const text=`↩️ <b>${t(user.language,'refund_title')}</b>\n\n👤 ${name}\n🆔 <code>${escapeHtml(String(order.user_id))}</code>\n💰 ${order.amount_minor} ⭐\n🧾 <code>${escapeHtml(order.id)}</code>\n📌 ${status}${order.refund_error?`\n⚠️ ${escapeHtml(order.refund_error)}`:''}`;
  const rows:any[]=[];
  if(validation.ok){
    rows.push([{text:t(user.language,'refund_only'),callback_data:`admin:refund_confirm:${order.id}:only`}],[{text:t(user.language,'refund_and_revoke'),callback_data:`admin:refund_confirm:${order.id}:revoke`}]);
  } else if(validation.reason==='already_refunded'){
    rows.push([{text:t(user.language,'refund_status_refunded'),callback_data:'admin:payments'}]);
  } else if(order.payment_status==='refund_pending'){
    rows.push([{text:t(user.language,'refund_busy'),callback_data:'admin:payments'}]);
  }
  rows.push(back(user).map((x:any)=>({...x,callback_data:'admin:payments'})));
  return ui(api,db,user,text,rows,sourceMessageId);
}

export async function refundStars(api:TelegramApi,db:D1Database,user:User,orderId:string,revokeSubscription:boolean,sourceMessageId?:number){
  const order=await repo.getRefundableStarsOrder(db,orderId);
  const validation=validateStarRefund(order?{order_status:order.status,provider:order.provider,currency:order.currency,payment_status:order.payment_status,charge_id:order.provider_payment_id,user_id:order.user_id}:null);
  if(!order){
    await api.sendMessage(user.id,t(user.language,'not_found'),{parse_mode:'HTML'});
    return adminRefundDetails(api,db,user,orderId,sourceMessageId);
  }
  if(!validation.ok){
    const reason=validation.reason;
    await api.sendMessage(user.id,t(user.language,reason==='already_refunded'?'refund_already':reason==='missing_charge'?'refund_unavailable':'refund_invalid'),{parse_mode:'HTML'});
    return adminRefundDetails(api,db,user,orderId,sourceMessageId);
  }
  const claimed=await repo.beginStarsRefund(db,orderId,user.id);
  if(!claimed){
    await api.sendMessage(user.id,t(user.language,'refund_busy'),{parse_mode:'HTML'});
    return adminRefundDetails(api,db,user,orderId,sourceMessageId);
  }
  try{
    await api.refundStarPayment(order.user_id,order.provider_payment_id);
  }catch(err){
    await repo.failStarsRefund(db,orderId,err);
    console.error('telegram_stars_refund_error',{orderId,userId:order.user_id,error:String(err)});
    await api.sendMessage(user.id,t(user.language,'refund_failed'),{parse_mode:'HTML'});
    return adminRefundDetails(api,db,user,orderId,sourceMessageId);
  }
  const finalized=await repo.finalizeStarsRefund(db,orderId,user.id,revokeSubscription);
  if(!finalized){
    console.error('telegram_stars_refund_db_finalize_failed',{orderId,userId:order.user_id});
    await api.sendMessage(user.id,t(user.language,'refund_db_pending'),{parse_mode:'HTML'});
    return adminRefundDetails(api,db,user,orderId,sourceMessageId);
  }
  try{await api.sendMessage(user.id,t(user.language,'refund_success'),{parse_mode:'HTML'});}catch{}
  const target=await repo.getUser(db,order.user_id);
  if(target){
    try{await api.sendMessage(target.id,t(target.language,'refund_user_notice',{amount:order.amount_minor,revoked:revokeSubscription?(target.language==='ru'?' Подписка отменена.':target.language==='uz'?' Obuna bekor qilindi.':' The subscription was revoked.'):''}),{parse_mode:'HTML'});}catch{}
  }
  try{await db.prepare('INSERT INTO usage_logs(id,user_id,kind,model_key,status,error_code,points,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(uuid(),user.id,'admin_action',`stars_refund:${orderId}:${revokeSubscription?'revoke':'only'}`,'ok',null,0,0,nowIso()).run();}catch{}
  return adminPayments(api,db,user,sourceMessageId);
}

export async function adminSubs(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){return ui(api,db,user,'⭐ <b>Подписки</b>\n\n/grantsub &lt;ID|@username&gt; &lt;plan_key&gt;',[[{text:'/grantsub',callback_data:'admin:hint:grantsub'}],back(user)],sourceMessageId)}
export async function adminPoints(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){return ui(api,db,user,'🎁 <b>Бонусные баллы</b>\n\n/grantpoints &lt;ID|@username&gt; &lt;amount&gt;\n/takepoints &lt;ID|@username&gt; &lt;amount&gt;',[[{text:'/grantpoints',callback_data:'admin:hint:grantpoints'}],back(user)],sourceMessageId)}
export async function adminFeatures(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
 const starsEnabled=await repo.isPaymentProviderEnabled(db,'telegram_stars');
 const text=[
  `⏯ <b>${t(user.language,'admin_features')}</b>`,
  '',
  `/pause image|search|chat`,
  `/resume image|search|chat`,
  '',
  t(user.language,'admin_payment_methods'),
  `${t(user.language,'admin_payment_stars')}: ${t(user.language,starsEnabled?'admin_payment_enabled':'admin_payment_disabled')}`,
 ].join('\\n');
 const rows=[
  [{text:`${starsEnabled?'⛔':'✅'} ${t(user.language,'admin_payment_stars')}`,callback_data:'admin:paymenttoggle:telegram_stars'}],
  [back(user)[0]],
 ];
 return ui(api,db,user,text,rows,sourceMessageId);
}

export async function togglePaymentMethod(api:TelegramApi,db:D1Database,provider:string){
 if(provider!=='telegram_stars') return {ok:false,reason:'not_found'} as const;
 const enabled=await repo.isPaymentProviderEnabled(db,provider);
 await repo.setPaymentMethodEnabled(db,provider,!enabled);
 return {ok:true,enabled:!enabled} as const;
}
export async function adminModels(api:TelegramApi,db:D1Database,env:Env,user:User,sourceMessageId?:number){const models=await repo.adminModels(db);const text='🤖 <b>Модели</b>\n\n'+models.map(m=>`${m.is_active?'✅':'⛔'} ${repo.modelEmoji(m)} <code>${m.model_key}</code> · ${m.name} · ${m.type} · ${m.cost}`).join('\n')+'\n\nДобавление:\n/addmodel key|family|provider|model_id|name|tier|cost|type|emoji|is_free';const buttons:any[]=[];for(const m of models)buttons.push([{text:`${m.is_active?'⛔':'✅'} ${m.name.slice(0,24)}`,callback_data:`admin:modeltoggle:${encodeURIComponent(m.model_key)}`},{text:`🗑 ${m.name.slice(0,18)}`,callback_data:`admin:modeldelete:${encodeURIComponent(m.model_key)}`}]);buttons.push(back(user));return ui(api,db,user,text,buttons,sourceMessageId)}
export async function toggleModel(api:TelegramApi,db:D1Database,key:string){const m=await repo.modelByKey(db,key);if(!m)return {ok:false,reason:'not_found'} as const;if(m.is_active&&await repo.modelIsDefault(db,key))return {ok:false,reason:'default_model'} as const;await db.prepare('UPDATE models SET is_active=? WHERE model_key=?').bind(m.is_active?0:1,key).run();return {ok:true} as const}
export async function deleteModel(api:TelegramApi,db:D1Database,key:string){const m=await repo.modelByKey(db,key);if(!m)return {ok:false,reason:'not_found'} as const;if(await repo.modelIsDefault(db,key))return {ok:false,reason:'default_model'} as const;if(await repo.modelUsedByChat(db,key))return {ok:false,reason:'in_use'} as const;await db.prepare('DELETE FROM models WHERE model_key=?').bind(key).run();return {ok:true} as const}

export async function startBroadcast(api:TelegramApi,db:D1Database,user:User){await db.prepare('INSERT INTO pending_actions(user_id,kind,payload,expires_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at,created_at=excluded.created_at').bind(user.id,'broadcast_content',null,new Date(Date.now()+3600000).toISOString(),nowIso()).run();await api.sendMessage(user.id,t(user.language,'broadcast_start'),{parse_mode:'HTML',reply_markup:ik([[{text:'❌ Отмена',callback_data:'broadcast:cancel'}]])})}
export async function receiveBroadcastContent(api:TelegramApi,db:D1Database,env:Env,user:User,message:any){const action=await db.prepare('SELECT * FROM pending_actions WHERE user_id=? AND kind=? AND expires_at>?').bind(user.id,'broadcast_content',nowIso()).first<any>();if(!action)return false;const bId=uuid();const photo=Array.isArray(message.photo)&&message.photo.length?message.photo[message.photo.length-1]:null;const type=photo?'photo':message.text?'text':'unsupported';if(type==='unsupported'){await api.sendMessage(user.id,'Поддерживаются только текст и фото с подписью.');return true}const countRow=await db.prepare('SELECT COUNT(*) count,COALESCE(MAX(id),0) max_id FROM users WHERE is_blocked=0 AND bot_blocked=0').first<any>();const total=Number(countRow?.count??0),maxUserId=Number(countRow?.max_id??0),now=nowIso();await db.batch([db.prepare(`INSERT INTO broadcasts(id,admin_user_id,message_type,text,caption,file_id,source_chat_id,source_message_id,status,total,sent,success,failed,blocked,progress_message_id,last_user_id,max_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(bId,user.id,type,message.text??null,message.caption??null,photo?.file_id??null,message.chat.id,message.message_id,'preview',total,0,0,0,0,null,0,maxUserId,now,now),db.prepare('DELETE FROM pending_actions WHERE user_id=?').bind(user.id)]);const preview=await api.sendMessage(user.id,t(user.language,'broadcast_preview',{count:total}),{parse_mode:'HTML',reply_markup:ik([[{text:'✅ Отправить',callback_data:`broadcast:send:${bId}`},{text:'❌ Отмена',callback_data:`broadcast:cancel:${bId}`}]] )});await db.prepare('UPDATE broadcasts SET progress_message_id=?,updated_at=? WHERE id=?').bind(preview.message_id,nowIso(),bId).run();return true}
export async function cancelBroadcast(api:TelegramApi,db:D1Database,user:User,id?:string){if(id)await db.prepare("DELETE FROM broadcasts WHERE id=? AND admin_user_id=? AND status='preview'").bind(id,user.id).run();await db.prepare("DELETE FROM pending_actions WHERE user_id=? AND kind='broadcast_content'").bind(user.id).run();await api.sendMessage(user.id,t(user.language,'broadcast_cancel'))}
export async function sendBroadcastBatch(api:TelegramApi,db:D1Database,env:Env,broadcastId:string,batchSize=25){
  const claimTime=nowIso();
  const claimed=await db.prepare("UPDATE broadcasts SET status='processing',updated_at=? WHERE id=? AND (status='sending' OR (status='processing' AND updated_at<?))").bind(claimTime,broadcastId,new Date(Date.now()-5*60000).toISOString()).run();
  if(Number(claimed.meta?.changes??0)!==1)return;
  const b=await db.prepare('SELECT * FROM broadcasts WHERE id=? AND status=?').bind(broadcastId,'processing').first<any>();
  if(!b)return;
  const users=await db.prepare('SELECT id FROM users WHERE id>? AND id<=? AND is_blocked=0 AND bot_blocked=0 ORDER BY id LIMIT ?').bind(Number(b.last_user_id??0),Number(b.max_user_id??0),batchSize).all<any>();
  let sent=Number(b.sent),success=Number(b.success),failed=Number(b.failed),blocked=Number(b.blocked),cursor=Number(b.last_user_id??0);
  for(const row of users.results??[]){cursor=row.id;sent++;try{if(b.source_chat_id&&b.source_message_id)await api.copyMessage(row.id,b.source_chat_id,b.source_message_id);else if(b.message_type==='photo')await api.sendPhoto(row.id,b.file_id,b.caption??undefined,{parse_mode:'HTML'});else await api.sendMessage(row.id,b.text??'',{parse_mode:'HTML'});success++}catch(err){failed++;if(isBotBlockedError(err)){blocked++;await db.prepare('UPDATE users SET bot_blocked=1 WHERE id=?').bind(row.id).run()}}}
  const done=users.results?.length===0||sent>=Number(b.total);const finalStatus=done?'done':'sending';
  await db.prepare("UPDATE broadcasts SET sent=?,success=?,failed=?,blocked=?,status=?,last_user_id=?,updated_at=? WHERE id=? AND status='processing'").bind(sent,success,failed,blocked,finalStatus,cursor,nowIso(),broadcastId).run();
  if(done)await db.prepare("DELETE FROM broadcasts WHERE id=? AND status='done'").bind(broadcastId).run();
}
export async function resumeBroadcasts(api:TelegramApi,db:D1Database,env:Env){const staleProcessing=new Date(Date.now()-5*60000).toISOString();const rows=await db.prepare("SELECT id FROM broadcasts WHERE status='sending' OR (status='processing' AND updated_at<?) ORDER BY created_at LIMIT 3").bind(staleProcessing).all<{id:string}>();for(const b of rows.results??[])await sendBroadcastBatch(api,db,env,b.id,25)}

export async function adminBanner(api:TelegramApi,db:D1Database,user:User,sourceMessageId?:number){
  const current=await repo.getSetting(db,'home_banner_file_id');
  const text=`${t(user.language,'banner_admin')}\n\n${current?'✅ Баннер установлен.':'⚪ Баннер не установлен.'}`;
  return ui(
    api,
    db,
    user,
    text,
    [
      [{text:t(user.language,'banner_upload'),callback_data:'admin:banner_upload'}],
      [{text:t(user.language,'banner_preview'),callback_data:'admin:banner_preview'}],
      [{text:t(user.language,'banner_delete'),callback_data:'admin:banner_delete'}],
      back(user)
    ],
    sourceMessageId
  );
}
