-- =====================================================================
-- 0002_seed.sql — default models, roles, templates, plans.
-- Everything here is editable later WITHOUT code changes (admin commands
-- /addmodel, /setmodel ... or plain SQL). A model is only shown to users
-- when is_active = 1 AND its provider is configured (API key / binding).
-- =====================================================================

-- FREE-TIER models at the time of writing (Sept 2026). Verify quotas in Google AI Studio.
INSERT INTO models (key,name,family,provider,model_id,type,tier,cost,is_active,is_free,supports_text,supports_images,supports_audio,supports_documents,max_input,max_output,config,sort,created_at) VALUES
 ('gemini-3-1-flash-lite','Gemini 3.1 Flash-Lite','Gemini','gemini','gemini-3.1-flash-lite','chat','daily',1,1,1,1,1,1,1,1000000,8192,'{}',10,strftime('%s','now')),
 ('gemini-3-5-flash-lite','Gemini 3.5 Flash-Lite','Gemini','gemini','gemini-3.5-flash-lite','chat','daily',1,1,1,1,1,1,1,1000000,8192,'{}',20,strftime('%s','now')),
 -- Free tier exists but its daily quota is tiny -> kept OFF (advanced tier) until you sell points/subscriptions.
 ('gemini-3-8-flash','Gemini 3.8 Flash','Gemini','gemini','gemini-3.8-flash','chat','advanced',10,0,1,1,1,1,1,1000000,8192,'{}',30,strftime('%s','now')),
 -- Cloudflare Workers AI: no API key, 10,000 free neurons/day (Workers Free plan).
 ('llama-3-1-8b','Llama 3.1 8B','Llama','workers_ai','@cf/meta/llama-3.1-8b-instruct','chat','daily',1,1,1,1,0,0,0,32000,2048,'{"max_tokens":2048}',40,strftime('%s','now')),
 ('llama-3-3-70b','Llama 3.3 70B','Llama','workers_ai','@cf/meta/llama-3.3-70b-instruct-fp8-fast','chat','advanced',10,0,1,1,0,0,0,24000,2048,'{"max_tokens":2048}',50,strftime('%s','now')),
 -- Web search (Gemini "Grounding with Google Search": free tier only on 2.5 Flash / 2.5 Flash-Lite).
 ('search-gemini-2-5-flash-lite','Gemini 2.5 Flash-Lite','Gemini','gemini','gemini-2.5-flash-lite','search','daily',1,1,1,1,0,0,0,1000000,8192,'{}',10,strftime('%s','now')),
 ('search-gemini-2-5-flash','Gemini 2.5 Flash','Gemini','gemini','gemini-2.5-flash','search','daily',2,1,1,1,0,0,0,1000000,8192,'{}',20,strftime('%s','now'));

INSERT INTO roles (key,name_ru,name_en,prompt,sort) VALUES
 ('assistant','Помощник','Assistant','You are a helpful, friendly and precise general-purpose assistant.',10),
 ('editor','Редактор','Editor','You are a careful editor. Improve clarity, style, grammar and structure of the user''s text while preserving meaning and voice. Briefly explain significant changes.',20),
 ('translator','Переводчик','Translator','You are a professional translator. Translate the user''s text accurately and naturally. If the target language is not specified, translate Russian to English and any other language to Russian. Output only the translation unless asked otherwise.',30),
 ('teacher','Учитель','Teacher','You are a patient teacher. Explain step by step in simple language, give short examples and check understanding with a brief question at the end when useful.',40),
 ('programmer','Программист','Programmer','You are a senior software engineer. Give correct, idiomatic, well-explained code and mention edge cases. Use fenced code blocks with a language tag.',50);

INSERT INTO templates (key,category,icon,name_ru,name_en,prompt,sort) VALUES
 ('business-portrait','portrait','📸','Деловой портрет','Business portrait','Professional business headshot of the person in the reference photo, studio lighting, neutral softly blurred background, sharp focus, natural skin, confident friendly expression.',10),
 ('product-photo','product','🛍','Фото товара','Product photo','Clean commercial product photo of the item, centered, soft shadows, seamless white or light-gray studio background, high detail, e-commerce style.',20),
 ('poster','poster','📣','Афиша','Poster','Eye-catching event poster, bold typography, strong visual hierarchy, vibrant colors, balanced composition, space for text.',30),
 ('sticker','social','😎','Стикер','Sticker','Cute die-cut sticker illustration of the subject, thick white outline, flat vivid colors, simple shading, transparent-style clean background.',40),
 ('cover','cover','🎬','Обложка','Cover','Cinematic cover art, dramatic lighting, rich color grading, strong focal point, movie-poster composition, depth of field.',50),
 ('wallpaper','wallpaper','🌄','Обои','Wallpaper','High-resolution phone wallpaper, immersive scenery, harmonious color palette, soft gradients, minimal clutter in the lower third.',60);

-- Subscription plans (prices as shown in the reference UI; edit freely). Amounts are in kopecks.
INSERT INTO plans (key,kind,unit,qty,duration_days,price_minor,currency,is_active,is_featured,sort) VALUES
 ('sub-1w','subscription','week',1,7,19900,'RUB',1,0,10),
 ('sub-1m','subscription','month',1,30,69900,'RUB',1,1,20),
 ('sub-3m','subscription','month',3,90,139900,'RUB',1,0,30),
 ('sub-6m','subscription','month',6,180,239900,'RUB',1,0,40),
 ('sub-1y','subscription','year',1,365,359900,'RUB',1,1,50),
 ('sub-2y','subscription','year',2,730,649900,'RUB',1,0,60);

-- Point packs: quantities from the spec, prices are PLACEHOLDERS -> inactive until you set real prices.
INSERT INTO plans (key,kind,unit,qty,duration_days,price_minor,currency,is_active,is_featured,sort) VALUES
 ('pts-100','points',NULL,100,NULL,9900,'RUB',0,0,110),
 ('pts-500','points',NULL,500,NULL,39900,'RUB',0,0,120),
 ('pts-1000','points',NULL,1000,NULL,69900,'RUB',0,0,130),
 ('pts-5000','points',NULL,5000,NULL,299000,'RUB',0,0,140);
