import { all, first, run } from './client';

export interface ModelRow {
  key: string;
  name: string;
  family: string;
  provider: string;
  model_id: string;
  type: string;
  tier: 'daily' | 'advanced';
  cost: number;
  is_active: number;
  is_free: number;
  supports_text: number;
  supports_images: number;
  supports_audio: number;
  supports_documents: number;
  max_input: number | null;
  max_output: number | null;
  config: string;
  sort: number;
  created_at: number;
}

export async function getModel(db: D1Database, key: string | null | undefined): Promise<ModelRow | null> {
  if (!key) return null;
  return first<ModelRow>(db, 'SELECT * FROM models WHERE key=?', key);
}

export async function listModels(db: D1Database, type: string, onlyActive = true): Promise<ModelRow[]> {
  return all<ModelRow>(
    db,
    `SELECT * FROM models WHERE type=? ${onlyActive ? 'AND is_active=1' : ''} ORDER BY sort, name`,
    type,
  );
}

export async function listAllModels(db: D1Database): Promise<ModelRow[]> {
  return all<ModelRow>(db, 'SELECT * FROM models ORDER BY type, sort, name');
}

const EDITABLE = new Set([
  'name',
  'family',
  'provider',
  'model_id',
  'type',
  'tier',
  'cost',
  'is_active',
  'is_free',
  'supports_text',
  'supports_images',
  'supports_audio',
  'supports_documents',
  'max_input',
  'max_output',
  'config',
  'sort',
]);

export async function updateModelField(db: D1Database, key: string, field: string, value: string): Promise<'ok' | 'bad_field' | 'bad_value' | 'not_found'> {
  if (!EDITABLE.has(field)) return 'bad_field';
  let v: string | number | null = value;
  if (['cost', 'is_active', 'is_free', 'supports_text', 'supports_images', 'supports_audio', 'supports_documents', 'max_input', 'max_output', 'sort'].includes(field)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'bad_value';
    v = Math.trunc(n);
  }
  if (field === 'tier' && value !== 'daily' && value !== 'advanced') return 'bad_value';
  if (field === 'family' && !/^[A-Za-z0-9._-]{1,20}$/.test(value)) return 'bad_value';
  if (field === 'config') {
    try {
      JSON.parse(value);
    } catch {
      return 'bad_value';
    }
  }
  const n = await run(db, `UPDATE models SET ${field}=? WHERE key=?`, v, key);
  return n ? 'ok' : 'not_found';
}

export async function insertModel(
  db: D1Database,
  m: { key: string; family: string; provider: string; model_id: string; name: string; tier: string; cost: number; type: string },
  now: number,
): Promise<boolean> {
  const n = await run(
    db,
    `INSERT OR IGNORE INTO models(key,name,family,provider,model_id,type,tier,cost,is_active,is_free,supports_text,config,sort,created_at)
     VALUES(?,?,?,?,?,?,?,?,1,0,1,'{}',100,?)`,
    m.key,
    m.name,
    m.family,
    m.provider,
    m.model_id,
    m.type,
    m.tier,
    m.cost,
    now,
  );
  return n === 1;
}

export async function deleteModel(db: D1Database, key: string): Promise<number> {
  return run(db, 'DELETE FROM models WHERE key=?', key);
}
