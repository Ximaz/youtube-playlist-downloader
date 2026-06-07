import { VideoIdSchema } from '@ypd/shared';

/** List delimiters for a pasted blob of URLs: newlines, commas, semicolons and any
 *  whitespace run. Splitting on all of them collapses a CSV / space / semicolon chunk
 *  down to one URL per token. URLs never contain these, so splitting is lossless. */
const SEPARATORS = /[\s,;]+/;

/** Re-flow a pasted blob into one token per line (separators dropped). Pure presentation:
 *  the submit-time parse splits on the same set, so a textarea the user never let us
 *  reformat still yields the right ids. */
export function normalizeUrlText(text: string): string {
  return text
    .split(SEPARATORS)
    .filter((t) => t.length > 0)
    .join('\n');
}

/** Pull the 11-char YouTube video id out of one token (a full URL or a bare id), or null.
 *  Recognizes watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/. A playlist URL
 *  (/playlist?list=…) carries no single video and returns null by design. */
export function extractVideoId(token: string): string | null {
  const t = token.trim();
  if (!t) return null;

  // Bare id (also how a youtu.be path segment validates once sliced out below).
  if (VideoIdSchema.safeParse(t).success) return t;

  let parsed: URL;
  try {
    parsed = new URL(t);
  } catch {
    return null; // neither a URL nor a bare id
  }

  const host = parsed.hostname.replace(/^www\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v');
    } else {
      candidate = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1] ?? null;
    }
  }

  return candidate && VideoIdSchema.safeParse(candidate).success ? candidate : null;
}

/** Parse a textarea blob into a deduped, order-preserving list of video ids.
 *  `skipped` counts non-empty tokens we couldn't resolve to a video id (incl. playlist
 *  URLs); duplicates are folded silently, not counted as skipped. */
export function parseVideoUrls(text: string): { ids: string[]; skipped: number } {
  const seen = new Set<string>();
  const ids: string[] = [];
  let skipped = 0;
  for (const token of text.split(SEPARATORS)) {
    if (!token) continue;
    const id = extractVideoId(token);
    if (!id) {
      skipped++;
    } else if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, skipped };
}
