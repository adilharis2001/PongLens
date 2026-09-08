# PongLens email previews

Generate the development-only light/dark gallery:

```bash
npm run email:preview
```

The ignored output is written to `build/email-preview/index.html`. It contains
synthetic names, links, jobs, purchases, and operational data only.

Send one sample of every current email state to a checked-in administrator:

```bash
npm run email:send-samples -- --to adilharis2001@gmail.com
```

Add `--dry-run` to enumerate the catalog without reading a credential or
contacting Resend. The command never creates product records or triggers real
auth, billing, coaching, upload, beta, or digest events.
