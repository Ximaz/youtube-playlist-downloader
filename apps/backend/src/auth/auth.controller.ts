import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthMe, OAuthPlaylist, OAuthPlaylistSummary } from '@ypd/shared';
import { PlaylistIdSchema } from '@ypd/shared';
import { ZodValidationPipe } from 'nestjs-zod';

import { AuthService } from './auth.service';
import { GoogleExchangeDto } from './dto/google-exchange.dto';
import { SessionId } from './session-id.decorator';

/**
 * Pure token API — no cookies, no browser redirects. The Nuxt BFF owns the browser-facing
 * OAuth dance (state cookie + redirects); these endpoints are called server-to-server:
 * `GET /auth/google/url` hands Nuxt the consent URL, `POST /auth/google/exchange` swaps the
 * code for a session token. Everything else authenticates via `Authorization: Bearer <token>`.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('google/url')
  @ApiOperation({
    summary:
      'Build the Google consent URL + CSRF state (PKCE verifier stored server-side). The Nuxt BFF pins `state` as an httpOnly cookie and redirects the browser to `url`.',
  })
  async googleUrl(): Promise<{ url: string; state: string }> {
    return this.auth.startGoogleSignIn();
  }

  @Post('google/exchange')
  @ApiOperation({
    summary:
      'Exchange the OAuth `code` (after Nuxt has verified `state` against its cookie) for a session token. Returns the opaque token the BFF stores in its httpOnly cookie.',
  })
  async googleExchange(@Body() body: GoogleExchangeDto): Promise<{ token: string }> {
    // Nuxt has already validated `state` against its httpOnly cookie; the single-use Valkey
    // verifier (consumed inside completeGoogleSignIn) remains the anti-replay guard.
    const { sessionId } = await this.auth.completeGoogleSignIn(body.code, body.state, body.state);
    return { token: sessionId };
  }

  @Post('session')
  @ApiOperation({
    summary:
      'Create an anonymous session (opaque token) so not-signed-in public users get live progress + session-scoped batches. The Nuxt BFF calls this and stores the token in its httpOnly cookie; User-Agent + client IP (X-Forwarded-For) are captured as authenticity signals.',
  })
  async createSession(
    @Headers('user-agent') userAgent?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ): Promise<{ token: string; tier: string }> {
    const { sessionId, tier } = await this.auth.createSession(userAgent, clientIp(forwardedFor));
    return { token: sessionId, tier };
  }

  @Get('me')
  @ApiOperation({
    summary:
      'Signed-in check + tier + OpenID profile (name/picture) for the navbar; 200 always. Does not touch the YouTube Data API.',
  })
  async me(@SessionId() sessionId?: string): Promise<AuthMe> {
    if (!sessionId) return { signedIn: false };
    return this.auth.getMe(sessionId);
  }

  @Get('playlists')
  @ApiOperation({
    summary:
      "Lightweight summaries (id + title + itemCount) of the user's playlists. One paginated Data API call, no per-playlist items fetch.",
  })
  async playlists(@SessionId() sessionId?: string): Promise<OAuthPlaylistSummary[]> {
    return this.auth.listUserPlaylistSummaries(this.#require(sessionId));
  }

  @Get('playlists/:id')
  @ApiOperation({
    summary:
      'One playlist with its playable (public + unlisted) video ids; fetched lazily when the user picks a row.',
  })
  async playlist(
    @SessionId() sessionId: string | undefined,
    @Param('id', new ZodValidationPipe(PlaylistIdSchema)) id: string,
  ): Promise<OAuthPlaylist> {
    return this.auth.getUserPlaylist(this.#require(sessionId), id);
  }

  @Post('sign-out')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Drop the session row + cascaded OAuth account. The BFF clears its cookie.',
  })
  async signOut(@SessionId() sessionId?: string): Promise<void> {
    if (sessionId) await this.auth.signOut(sessionId);
  }

  #require(sessionId: string | undefined): string {
    if (!sessionId) throw new UnauthorizedException('Not signed in.');
    return sessionId;
  }
}

/** First hop of an `X-Forwarded-For` chain (the real client) — the BFF sets this to the IP it
 *  saw. Returns undefined when absent so the column stays null rather than storing a proxy IP. */
function clientIp(forwardedFor?: string): string | undefined {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first || undefined;
}
