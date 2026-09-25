# File storage — Cloudinary

Every photo and document is stored on **Cloudinary**, behind the `StorageDriver` interface
(`src/modules/storage`). Services call `put / read / remove / urlFor` and never know which
driver is active.

## Public vs private

Decided by the storage key, in `storage-keys.ts`:

| Key | Cloudinary delivery | URL given to the app |
|---|---|---|
| `listings/…`, `categories/…`, `vendors/<id>/logo/…`, `talent/<id>/public/…` | `upload` (public CDN) | Cloudinary CDN URL: fast, transformable |
| everything else: IDs, business documents, receipts, agreements, signed scans, reference files | `authenticated` | `/api/v1/files/<key>`, permission-checked, then fetched with a 5-minute signed download URL |

A private file never gets a Cloudinary URL a browser could forward. Images are `image`
resources; PDFs, Word files and agreement text are `raw`. Everything sits under
`CLOUDINARY_FOLDER` (e.g. `eskista-dev`, `eskista-prod`), so environments stay apart.

## Setup

1. In `.env`: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   (Cloudinary Console → Settings → API Keys). Remove `STORAGE_DRIVER=local` or set it to
   `cloudinary`. With the credentials set, Cloudinary is the default.
2. Copy existing local files across, keeping their keys: `pnpm storage:migrate`.
   Idempotent; the database is untouched.
3. Restart the API. The boot log says `File storage: cloudinary`.

Production refuses to start on local disk. The seed writes its demo documents locally and
syncs them to Cloudinary when it is configured.

The API secret is server-only. The frontend never uploads to Cloudinary directly: uploads go
through the API, which validates type and size and decides public or private.
