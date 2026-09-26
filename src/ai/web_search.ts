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
  options: SearxngSearchOptions = {},
  signal?: AbortSignal
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
      },
      signal
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

function sanitizeSearchData(value: string): string {
  // Source/query data are untrusted. Remove citation-looking tokens and the
  // structural tags we add below so a page or query cannot forge trusted
  // citations or close our delimiters.
  return value
    .replace(/\[\[\s*\d+\s*\]\]/g, '[source-marker-removed]')
    .replace(/<\/?WEB_SEARCH_RESULTS_UNTRUSTED\b[^>]*>/gi, '[search-boundary-removed]')
    .replace(/<\/?WEB_SOURCE\b[^>]*>/gi, '[source-boundary-removed]')
    .replace(/<\/?SEARCH_QUERY_UNTRUSTED\b[^>]*>/gi, '[query-boundary-removed]');
}

export function buildWebSearchContext(results: WebSearchResult[], maxChars = 12000): string {
  const chunks: string[] = [];
  let used = 0;

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const block = [
      `<WEB_SOURCE id="${i + 1}">`,
      `[[${i + 1}]]`,
      `Заголовок: ${sanitizeSearchData(result.title)}`,
      `URL: ${sanitizeSearchData(result.url)}`,
      result.publishedDate ? `Дата публикации: ${sanitizeSearchData(result.publishedDate)}` : '',
      `Содержимое: ${sanitizeSearchData(result.content)}`,
      `</WEB_SOURCE>`
    ].filter(Boolean).join('\n');

    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const trimmed = block.slice(0, Math.max(0, remaining));
    if (!trimmed) break;
    chunks.push(trimmed);
    used += trimmed.length;
  }

  if (!chunks.length) return '';
  return `<WEB_SEARCH_RESULTS_UNTRUSTED>\n${chunks.join('\n\n')}\n</WEB_SEARCH_RESULTS_UNTRUSTED>`;
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


function isStructuralSearchLine(line: string): boolean {
  const value = line.replace(/[`*_>]/g, '').trim();
  if (!value) return true;
  if (!value.includes('\n') && /^#{1,6}\s+/.test(value)) return true;
  if (/^(?:[-*_]){3,}$/.test(value)) return true;
  if (/^(?:источники|sources|manbalar)\s*:?$/i.test(value)) return true;
  // Short section labels such as "Кратко:" / "Итог:" are structure, not facts.
  if (value.length <= 80 && /^[^.!?]{1,78}:$/.test(value)) return true;
  if (/^(?:кратко|итог|вывод|по найденным источникам|согласно найденным данным)\s*[:\-]?$/i.test(value)) return true;
  if (/^(?:briefly|in summary|conclusion|according to the sources|based on the sources)\s*[:\-]?$/i.test(value)) return true;
  if (/^(?:qisqacha|xulosa|manbalarga ko['’‘]ra|topilgan manbalarga ko['’‘]ra)\s*[:\-]?$/i.test(value)) return true;
  return false;
}

function containsDisallowedSelfDescription(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:^|[\s(])я\s+(?:являюсь|это)\s+(?:языков(?:ая|ой)\s+модель|искусственн(?:ый|ая)\s+интеллект|ии\s*|чат-бот|AI\b)/i,
    /(?:^|[\s(])я\s*[\u2014\u2013-]\s*(?:языков(?:ая|ой)\s+модель|искусственн(?:ый|ая)\s+интеллект|ии\s*|чат-бот|AI\b|модель|ассистент)/i,
    /\bI\s+(?:am|'m)\s+(?:an?\s+)?(?:AI|artificial intelligence|language model|chatbot|assistant)\b/i,
    /\bmen\s+(?:sun['’‘]?iy\s+intellekt|til\s+modeli|AI\s+modeli|chatbot|assistent)\b/i
  ];
  return patterns.some(pattern => pattern.test(normalized));
}

function substantiveLineLength(value: string): number {
  return value
    .replace(/\[\[\s*\d+\s*\]\]/g, '')
    .replace(/[`*_>#]/g, '')
    .replace(/^[•●▪◦*-]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function hasTrustedCitation(value: string, sourceCount: number): boolean {
  const matches = value.match(/\[\[\s*(\d+)\s*\]\]/g) ?? [];
  return matches.some(token => {
    const n = Number(token.replace(/\D/g, ''));
    return Number.isInteger(n) && n >= 1 && n <= sourceCount;
  });
}

export function hasSearchEvidence(answer: string, sourceCount: number): boolean {
  const max = Math.max(0, Math.floor(sourceCount));
  const normalizedAnswer = String(answer ?? '').trim();
  if (!max || !normalizedAnswer) return false;
  if (containsDisallowedSelfDescription(normalizedAnswer)) return false;

  const matches = normalizedAnswer.match(/\[\[\s*(\d+)\s*\]\]/g) ?? [];
  if (!matches.length) return false;
  for (const token of matches) {
    const match = token.match(/\d+/);
    const n = match ? Number(match[0]) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > max) return false;
  }

  const blocks = normalizedAnswer.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  let groundedBlockCount = 0;

  for (const block of blocks) {
    const lines = block.split(/\n/).map(line => line.trim()).filter(Boolean);
    const substantiveLines = lines.filter(line => !isStructuralSearchLine(line));
    if (!substantiveLines.length) continue;

    // Models sometimes put the citation on its own final line. Treat that as
    // grounding the immediately preceding factual line/block, without weakening
    // the requirement that every factual block has a trusted source marker.
    const blockHasCitation = hasTrustedCitation(block, max);
    const isListBlock = substantiveLines.some(line => /^(?:[-*•●▪◦]|\d+[.)])\s+/.test(line));
    const linesToCheck = isListBlock ? substantiveLines : [block];

    for (let i = 0; i < linesToCheck.length; i += 1) {
      const line = linesToCheck[i];
      if (isStructuralSearchLine(line)) continue;
      const length = substantiveLineLength(line);
      const hasCitation = hasTrustedCitation(line, max);
      const citationOnFollowingLine = !hasCitation && i + 1 < linesToCheck.length && hasTrustedCitation(linesToCheck[i + 1], max);
      if (length < 8 && !hasCitation && !citationOnFollowingLine) continue;
      groundedBlockCount += 1;
      if (isListBlock) {
        if (!hasCitation && !citationOnFollowingLine) return false;
      } else if (!hasCitation && !blockHasCitation) {
        return false;
      }
    }
  }

  return groundedBlockCount > 0;
}

export function isSearchInsufficientAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, ' ').trim().toUpperCase();
  return normalized === 'INSUFFICIENT_SEARCH_RESULTS' || normalized === 'SEARCH_UNAVAILABLE' || normalized === 'NO_SEARCH_ANSWER' || normalized.includes('INSUFFICIENT_SEARCH_RESULTS') || normalized.includes('SEARCH_UNAVAILABLE');
}

export function stripSearchEvidenceMarkers(answer: string): string {
  // Compatibility helper. Search Mode deliberately keeps [[N]] markers visible.
  return answer;
}
