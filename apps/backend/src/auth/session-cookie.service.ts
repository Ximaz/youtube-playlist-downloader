import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { AppConfigService } from '../config/app-config.service';

export const SESSION_COOKIE = 'ypd_session';
export const OAUTH_STATE_COOKIE = 'ypd_oauth_state';
const OAUTH_STATE_PATH = '/auth';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Owns cookie naming + flag derivation so controllers stay handler-shaped. */
@Injectable()
export class SessionCookieService {
  constructor(private readonly config: AppConfigService) {}

  setSession(res: Response, sessionId: string): void {
    res.cookie(SESSION_COOKIE, sessionId, this.#sessionOptions());
  }

  clearSession(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  setOAuthState(res: Response, state: string): void {
    res.cookie(OAUTH_STATE_COOKIE, state, this.#oauthStateOptions());
  }

  clearOAuthState(res: Response): void {
    res.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });
  }

  #sessionOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.#secure(),
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    };
  }

  #oauthStateOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.#secure(),
      maxAge: OAUTH_STATE_MAX_AGE_MS,
      path: OAUTH_STATE_PATH,
    };
  }

  #secure(): boolean {
    return this.config.publicBaseUrl.startsWith('https://');
  }
}
