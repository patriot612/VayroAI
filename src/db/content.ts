import { all, first } from './client';

export interface RoleRow {
  key: string;
  name_ru: string;
  name_en: string;
  prompt: string;
  is_active: number;
  sort: number;
}

export interface TemplateRow {
  key: string;
  category: string;
  icon: string;
  name_ru: string;
  name_en: string;
  prompt: string;
  is_active: number;
  sort: number;
}

export async function listRoles(db: D1Database): Promise<RoleRow[]> {
  return all<RoleRow>(db, 'SELECT * FROM roles WHERE is_active=1 ORDER BY sort');
}

export async function getRole(db: D1Database, key: string | null | undefined): Promise<RoleRow | null> {
  if (!key) return null;
  return first<RoleRow>(db, 'SELECT * FROM roles WHERE key=?', key);
}

export async function listTemplates(db: D1Database): Promise<TemplateRow[]> {
  return all<TemplateRow>(db, 'SELECT * FROM templates WHERE is_active=1 ORDER BY sort');
}
