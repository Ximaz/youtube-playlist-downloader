-- Anonymous sessions: every visitor gets an opaque Session (no OAuthAccount) so the realtime
-- WebSocket and batch scoping work without sign-in. `tier` drives the (future) paid/free
-- queueing — defaulted to 'paid' for now (no paid mechanism yet). `userAgent` + `ip` are
-- captured at creation as authenticity/audit signals bound to the opaque token. All additive
-- and backfilled by the default, so existing sessions keep working.
ALTER TABLE "Session" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'paid',
ADD COLUMN "userAgent" TEXT,
ADD COLUMN "ip" TEXT;
