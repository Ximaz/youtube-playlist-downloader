-- Capture the OpenID profile (name + picture) from the Google id_token at sign-in, so the
-- navbar can render the real account without a separate Google userinfo round-trip.
-- Nullable: sessions predating the `profile` scope (and accounts with no picture) keep working.
ALTER TABLE "OAuthAccount" ADD COLUMN "name" TEXT,
ADD COLUMN "picture" TEXT;
