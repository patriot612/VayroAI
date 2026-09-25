import type { Env } from '../env';
import type { Source } from './types';

type SearxngSearchOptions = {
  language?: string;
  maxResults?: number;
  /** In dedicated Search Mode, send the user's text to the search service unchanged. */
  exactQuery?: boolean;
};

export type WebSearchResult = Source & {
  content: string;
  publishedDate?: string;
  score?: number;
};

function normalizedLanguage(language?: string): string {
  const value = (language ?? '').toLowerCase();
  if (value.startsWith('ru')) return 'ru-RU';
  if (value.startsWith('uz')) return 'uz-UZ';
  if (value.startsWith('en')) return 'en-US';
  return 'all';
}

function clampResults(value: number | undefined): number {
  return Math.max(1, Math.min(10, Math.round(value ?? 5)));
}

const DEFAULT_SEARCH_BASE_URL = 'https://vayroai-searxng.onrender.com';

function searxngUrl(env: Env): string {
  const configured = String(env.SEARXNG_URL ?? '').trim().replace(/\/+$/, '');
  return configured || DEFAULT_SEARCH_BASE_URL;
}

export async function searxngSearch(
  query: string,
  env: Env,
  options: SearxngSearchOptions = {}
): Promise<WebSearchResult[]> {
  const base = searxngUrl(env);
  const cleanQuery = query.replace(/\s+/g, ' ').trim();
  if (!cleanQuery) throw new Error('SEARXNG_EMPTY_QUERY');
  const outgoingQuery = options.exactQuery ? query : cleanQuery;

  const url = new URL(`${base}/search`);
  url.searchParams.set('q', outgoingQuery);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', normalizedLanguage(options.language));
  url.searchParams.set('safesearch', '0');
  url.searchParams.set('pageno', '1');

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'VayroAI-WebSearch/1.0'
      }
    });
  } catch (error) {
    console.error('SEARXNG_SEARCH_ERROR', {
      error: error instanceof Error ? error.message : String(error),
      url: `${base}/search`
    });
    throw new Error('SEARXNG_UNAVAILABLE');
  }

  if (!response.ok) {
    const raw = await response.text();
    console.error('SEARXNG_SEARCH_ERROR', {
      status: response.status,
      response: raw.slice(0, 1500),
      url: `${base}/search`
    });
    if (response.status === 429) throw new Error('SEARXNG_429');
    if (response.status >= 500) throw new Error('SEARXNG_5XX');
    throw new Error(`SEARXNG_${response.status}`);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('SEARXNG_INVALID_RESPONSE');
  }

  const rawResults = Array.isArray(data?.results) ? data.results : [];
  const results: WebSearchResult[] = rawResults
    .map((item: any) => ({
      title: String(item?.title ?? item?.url ?? 'Source').trim(),
      url: String(item?.url ?? '').trim(),
      snippet: item?.content ? String(item.content).slice(0, 800) : undefined,
      content: String(item?.content ?? item?.description ?? '').trim(),
      publishedDate: item?.publishedDate ? String(item.publishedDate) : item?.published_date ? String(item.published_date) : undefined,
      score: typeof item?.score === 'number' ? item.score : undefined
    }))
    .filter((item: WebSearchResult) => item.url && item.content)
    .slice(0, clampResults(options.maxResults));

  if (!results.length) throw new Error('SEARXNG_EMPTY_RESULT');
  return results;
}

export function buildWebSearchContext(results: WebSearchResult[], maxChars = 12000): string {
  const chunks: string[] = [];
  let used = 0;

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const block = [
      `[[${i + 1}]]`,
      `Заголовок: ${result.title}`,
      `URL: ${result.url}`,
      result.publishedDate ? `Дата публикации: ${result.publishedDate}` : '',
      `Содержимое: ${result.content}`
    ].filter(Boolean).join('\n');

    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const trimmed = block.slice(0, Math.max(0, remaining));
    if (!trimmed) break;
    chunks.push(trimmed);
    used += trimmed.length;
  }

  return chunks.join('\n\n');
}

export function webSearchSources(results: WebSearchResult[]): Source[] {
  return results.map(result => ({
    title: result.title,
    url: result.url,
    snippet: result.snippet
  }));
}

export function contextualizeSearchQuery(history: Array<{ role: string; content: string | null }>, currentText: string): string {
  const current = currentText.replace(/\s+/g, ' ').trim();
  if (!current) return current;

  const previousUser = [...history]
    .reverse()
    .find(message => message.role === 'user' && typeof message.content === 'string' && message.content.trim());

  if (!previousUser || current.length > 180) return current;

  const previous = String(previousUser.content).replace(/\s+/g, ' ').trim();
  if (!previous || previous.length > 500) return current;

  return `${previous}\nТекущий уточняющий запрос: ${current}`.slice(0, 1000);
}


export function hasSearchEvidence(answer: string, sourceCount: number): boolean {
  const max = Math.max(0, Math.floor(sourceCount));
  if (!max) return false;
  const matches = answer.match(/\[\[(\d+)\]\]/g) ?? [];
  return matches.some(token => {
    const n = Number(token.replace(/[^0-9]/g, ''));
    return Number.isInteger(n) && n >= 1 && n <= max;
  });
}

export function isSearchInsufficientAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, ' ').trim().toUpperCase();
  return normalized === 'INSUFFICIENT_SEARCH_RESULTS' || normalized === 'SEARCH_UNAVAILABLE' || normalized === 'NO_SEARCH_ANSWER' || normalized.includes('INSUFFICIENT_SEARCH_RESULTS') || normalized.includes('SEARCH_UNAVAILABLE');
}

export function stripSearchEvidenceMarkers(answer: string): string {
  return answer.replace(/\[\[(\d+)\]\]/g, '').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
