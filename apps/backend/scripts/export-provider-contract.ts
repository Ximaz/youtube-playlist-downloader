/**
 * Generate docs/provider-contract.schema.json from the shared Zod schemas. The output
 * is a single JSON Schema document with one `$defs` entry per provider endpoint, so a
 * provider author in any language can plug it into ajv (TS/JS), datamodel-code-generator
 * (Pydantic), quicktype (Go/Rust/Swift/…), etc.
 *
 * Source of truth:
 * - `VideoMetadata` / `PlaylistMetadata` live in @ypd/shared (the backend validates
 *   provider responses against the SAME schemas at the boundary in
 *   apps/backend/src/providers/provider-client.service.ts).
 * - `ProviderHealth` / `ProviderError` are defined here — they're contract-only
 *   shapes that the backend doesn't currently parse.
 *
 * Run via `pnpm --filter @ypd/backend contract:export`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PlaylistMetadataSchema, VideoMetadataSchema } from '@ypd/shared';
import { z } from 'zod';

const ProviderHealthSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
    version: z.string(),
  })
  .strict();

const ProviderErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum([
        'BAD_REQUEST',
        'VIDEO_NOT_FOUND',
        'PLAYLIST_NOT_FOUND',
        'FORMAT_NOT_FOUND',
        'UPSTREAM_ERROR',
      ]),
      message: z.string(),
    }),
  })
  .strict();

const document = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/ximaz/ypd/docs/provider-contract.schema.json',
  title: 'YPD provider API contract',
  description:
    'Machine-readable companion to docs/provider-api.md. Each entry under $defs is the JSON body shape ' +
    'a provider must produce for the matching endpoint. The backend validates provider responses against ' +
    'these schemas; a contract violation falls through to the next provider in PROVIDER_ORDER.',
  $defs: {
    /** GET /health response. Liveness only — never touches YouTube. */
    ProviderHealth: z.toJSONSchema(ProviderHealthSchema),
    /** GET /videos/:id response. */
    VideoMetadata: z.toJSONSchema(VideoMetadataSchema),
    /** GET /playlists/:id response. */
    PlaylistMetadata: z.toJSONSchema(PlaylistMetadataSchema),
    /** All non-2xx responses share this envelope. */
    ProviderError: z.toJSONSchema(ProviderErrorEnvelopeSchema),
  },
};

const outPath = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'provider-contract.schema.json',
);
writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
