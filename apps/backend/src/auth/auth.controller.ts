import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthMe, OAuthPlaylist, OAuthPlaylistSummary } from '@ypd/shared';
import { PlaylistIdSchema } from '@ypd/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';

import { AppConfigService } from '../config/app-config.service';
import { AuthService } from './auth.service';
import { SessionId } from './session-id.decorator';
import { OAUTH_STATE_COOKIE, SessionCookieService } from './session-cookie.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookieService,
    private readonly config: AppConfigService,
  ) {}

  @Get('google')
  @ApiOperation({ summary: 'Redirect to Google consent for YouTube read-only access.' })
  async startGoogle(@Res() res: Response): Promise<void> {
    const { url, state } = await this.auth.startGoogleSignIn();
    this.cookies.setOAuthState(res, state);
    res.redirect(302, url);
  }

  @Get('google/callback')
  @ApiOperation({
    summary:
      'Google redirects here with code+state; verifies the oauth_state cookie, sets ypd_session, and bounces to the frontend.',
  })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) throw new BadRequestException('Missing code or state.');
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    const { sessionId } = await this.auth.completeGoogleSignIn(code, state, cookieState);
    this.cookies.clearOAuthState(res);
    this.cookies.setSession(res, sessionId);
    res.redirect(302, this.config.frontendOrigin);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Lightweight signed-in check; 200 always. Does not touch the YouTube Data API.',
  })
  async me(@SessionId() sessionId?: string): Promise<AuthMe> {
    if (!sessionId) return { signedIn: false };
    return { signedIn: await this.auth.hasSession(sessionId) };
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
  @ApiOperation({ summary: 'Clear the session cookie and drop the row + cascaded OAuth account.' })
  async signOut(@SessionId() sessionId: string | undefined, @Res() res: Response): Promise<void> {
    if (sessionId) await this.auth.signOut(sessionId);
    this.cookies.clearSession(res);
    res.status(204).send();
  }

  #require(sessionId: string | undefined): string {
    if (!sessionId) throw new UnauthorizedException('Not signed in.');
    return sessionId;
  }
}
