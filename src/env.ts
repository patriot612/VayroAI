export interface Env { DB:D1Database; AI:Ai; TELEGRAM_BOT_TOKEN:string; WEBHOOK_SECRET:string; ADMIN_TELEGRAM_ID:string; GEMINI_API_KEY?:string; OPENAI_API_KEY?:string; ANTHROPIC_API_KEY?:string; DEEPSEEK_API_KEY?:string; KIMI_API_KEY?:string; GROQ_API_KEY?:string; APP_NAME?:string; [key:string]:unknown }
export interface Ai { run(model:string,input:unknown):Promise<unknown> }
