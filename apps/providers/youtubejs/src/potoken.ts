// PO-token (Proof of Origin) acquisition via the SHARED bgutil POT provider sidecar
// (brainicism/bgutil-ytdlp-pot-provider). Generating tokens in-process (BotGuard in jsdom)
// doesn't attest reliably outside a real browser, so the maintained sidecar runs the generator
// and both providers call it. Used only as a PER-VIDEO FALLBACK after a bot-check: mint once,
// reuse across videos (tokens are visitor-bound + live for hours), and cooldown after a failure
// so a down/unconfigured sidecar degrades to "give up → backend falls back" rather than taxing
// every request. POT_PROVIDER_BASE_URL unset ⇒ minting is unavailable (escalation no-ops).
const POT_BASE_URL = (process.env.POT_PROVIDER_BASE_URL ?? '').replace(/\/+$/, '');
const POT_TIMEOUT_MS = Math.max(1_000, Number(process.env.POT_PROVIDER_TIMEOUT_MS ?? 20_000));
const PO_TOKEN_TTL_MS = Math.max(
  60_000,
  Number(process.env.YTJS_POTOKEN_TTL_MS ?? 6 * 60 * 60 * 1000),
);
const MINT_COOLDOWN_MS = Math.max(1_000, Number(process.env.YTJS_POTOKEN_COOLDOWN_MS ?? 60_000));

export interface MintedPoToken {
  poToken: string;
  visitorData: string;
}

export class PoTokenMinter {
  #cached: { token: MintedPoToken; expiresAt: number } | null = null;
  #inflight: Promise<MintedPoToken> | null = null;
  #cooldownUntil = 0;

  /** Fetch (or reuse) a session-bound PO token for `visitorData` from the sidecar. Concurrent
   *  callers share one in-flight request; a recent failure (or no sidecar configured) puts
   *  minting in cooldown so the bot-check fallback fails fast and the backend falls back. */
  async mint(visitorData: string): Promise<MintedPoToken> {
    if (!POT_BASE_URL) throw new Error('POT_PROVIDER_BASE_URL not configured');
    const now = Date.now();
    const cached = this.#cached;
    if (cached && cached.token.visitorData === visitorData && now < cached.expiresAt) {
      return cached.token;
    }
    if (now < this.#cooldownUntil) {
      throw new Error('PO-token minting is in cooldown after a recent failure');
    }
    if (this.#inflight) return this.#inflight;
    this.#inflight = this.#fetchToken(visitorData)
      .then((token) => {
        this.#cached = { token, expiresAt: Date.now() + PO_TOKEN_TTL_MS };
        return token;
      })
      .catch((err: unknown) => {
        this.#cooldownUntil = Date.now() + MINT_COOLDOWN_MS;
        throw err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        this.#inflight = null;
      });
    return this.#inflight;
  }

  async #fetchToken(visitorData: string): Promise<MintedPoToken> {
    // bgutil POT provider HTTP API: POST /get_pot { content_binding } -> { po_token }.
    // content_binding = visitor data binds the token to this session.
    const res = await fetch(`${POT_BASE_URL}/get_pot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content_binding: visitorData }),
      signal: AbortSignal.timeout(POT_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`POT provider returned ${res.status}`);
    }
    // bgutil ≥1.3 returns camelCase (`poToken`); older builds used snake_case (`po_token`).
    const data = (await res.json()) as { poToken?: string; po_token?: string };
    const poToken = data.poToken ?? data.po_token;
    if (!poToken) throw new Error('POT provider response had no poToken');
    return { poToken, visitorData };
  }
}

/** Process-wide singleton — one token cache per provider replica. */
export const poTokenMinter = new PoTokenMinter();
