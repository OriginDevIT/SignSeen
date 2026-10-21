# SignSeen — Signed. Seen. Sealed.

Open-source electronic signature with a photographic witness. Scan a QR code,
sign on your phone, snap a photo.

Every signature ships with a tamper-evident audit trail: document hash,
server-side timestamp, device session evidence, and an optional photo of the
signer. ESIGN/UETA-compliant. No accounts for signers, no per-envelope fees,
no certificates to install.

## Status

Feature-complete and in pre-launch hardening: accounts, freemium tiers
with Stripe billing, multi-signer workflows, signing alerts, custom
branding, document fields, and scripted end-to-end tests are all in.
The hosted service runs at [getsignseen.com](https://getsignseen.com).

## What it does

- **Send** a PDF (or DOC/DOCX, or a web page URL) and get a signing
  link + QR code. Signers never need an account.
- **Sign** on any phone: draw a signature, place fields, and — when the
  sender requests it — snap a witness photo with the front camera.
- **Sealed**: the signed PDF carries a completion certificate and a
  hash-chained audit record (timestamps, device evidence, photo check),
  so tampering is detectable.
- **Freemium**: free = 1 pending document, 30 days, 1 signer, 100 MB,
  attribution mark. Premium adds storage (5 GB), multi-signer, status
  tracking + alerts, and custom branding.

## Quickstart (development)

```bash
docker compose up
```

- Web app: http://localhost:3000
- API: http://localhost:8000/api/health/
- Postgres: localhost:5432 (user/password/db: `signseen`)

## Self-hosting (production)

See **[docs/self-hosting.md](docs/self-hosting.md)** — production
compose overlay (gunicorn + built frontend + Caddy HTTPS), the full
environment reference, daily lifecycle jobs, backups, and the security
checklist.

## Development

### Backend (Django + DRF)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest        # run tests
python manage.py runserver
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm test                # vitest
npm run dev
```

## Contributing

Pull requests welcome. CI runs the backend and frontend test suites on every
PR — please keep them green.

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
