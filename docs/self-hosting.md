# Self-hosting SignSeen

SignSeen is AGPL-3.0 open source. This guide runs the production stack —
Django API behind **gunicorn**, the Next.js app as a **production build**,
Postgres, and Caddy for automatic HTTPS — on one Linux host with Docker.
It is the same shape as the hosted deployment at getsignseen.com.

> The base `docker-compose.yml` is a **development** stack (Django's dev
> server, Next dev mode, a throwaway secret). Never expose it to the
> internet as-is; always layer `docker-compose.prod.yml` on top.

## 1. Prerequisites

- A Linux host (2 GB RAM minimum; the LibreOffice/WeasyPrint intake
  converters are the hungry part) with Docker + Docker Compose v2.
- A DNS name pointing at the host (Caddy gets a Let's Encrypt
  certificate for it automatically; ports 80 and 443 must be reachable).

## 2. Configure

```bash
git clone https://github.com/OriginDevIT/SignSeen.git
cd SignSeen
cp .env.prod.example .env.prod
```

Edit `.env.prod`:

| Value | Notes |
|---|---|
| `DOMAIN` | Your public hostname. |
| `POSTGRES_PASSWORD` | Long random password for the bundled Postgres. |
| `DJANGO_SECRET_KEY` | Generate: `python3 -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `FRONTEND_URL` | `https://<DOMAIN>` — used in signing/reset/status links in emails. |
| `EMAIL_*` | An SMTP account for signed-copy delivery and password resets. Without it, mail is logged to the API console and **signers will not receive copies**. |
| `STRIPE_*` | Optional. Leave blank to run free-tier only. For premium: a secret key, a publishable key, one Price ID per plan (monthly/annual), and a webhook signing secret — register the webhook endpoint `https://<DOMAIN>/api/billing/webhook/` in the Stripe dashboard. |
| `GOOGLE_OAUTH_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Optional Google sign-in (same client ID in both). |
| `NEXT_PUBLIC_GHL_CHAT_WIDGET_ID` | Optional GoHighLevel support-chat widget. |
| `PREMIUM_STORAGE_BYTES` | Premium storage cap (default 5 GB). |

## 3. Launch

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.prod up --build -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.prod logs -f api web caddy
```

Migrations run on API startup. Open `https://<DOMAIN>` — you should see
the app, with a valid certificate once Caddy finishes provisioning
(under a minute on first boot).

## 4. Schedule the daily jobs

Three management commands keep the data lifecycle honest. Run them from
cron on the host (times are examples):

```cron
# Expired pending documents (free tier: 30-day window) + orphan cleanup
15 3 * * * cd /path/to/SignSeen && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod exec -T api python manage.py cleanup_expired
# Expiring-soon alerts for premium senders
30 3 * * * cd /path/to/SignSeen && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod exec -T api python manage.py send_expiry_alerts
# Billing lifecycle: suspended 180d -> expired; expired 180d -> documents purged
45 3 * * * cd /path/to/SignSeen && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod exec -T api python manage.py enforce_billing_lifecycle
```

## 5. Backups

Two things matter: the database and the media volume (uploaded
documents, signed PDFs, witness photos).

```bash
# Database
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.prod exec -T db pg_dump -U signseen signseen > signseen-$(date +%F).sql
# Media volume
docker run --rm -v signseen_media:/data -v "$PWD":/backup alpine \
  tar czf /backup/signseen-media-$(date +%F).tar.gz -C /data .
```

(The media volume name is `<project>_media`; check `docker volume ls`.)
Keep backups off the host, and test a restore before you need one:
load the dump into a scratch Postgres and point a local stack at it.

## 6. Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.prod up --build -d
```

## 7. Security checklist

The production overlay already sets: `DJANGO_DEBUG=0`, a required
secret key, host allow-listing to your domain, HSTS (1 year), secure
session/CSRF cookies, `X-Frame-Options: DENY`, and TLS via Caddy with
the API trusting its `X-Forwarded-Proto`.

Built into the app:

- **URL→PDF intake is SSRF-guarded.** Any URL the server is asked to
  render must resolve only to public addresses (loopback, private,
  link-local/metadata, and reserved ranges are refused), subresource
  fetches are validated the same way, and redirects are refused — the
  URL you give must be the final one. Residual risk: DNS can change
  between the check and the fetch (rebinding). For a deployment that
  allows untrusted senders, add egress firewall rules denying the
  container network access to private ranges and the cloud metadata
  address as the outer layer.
- **Login is brute-force throttled** per email+IP (default: 10 failures
  per 15 minutes, then HTTP 429 until the window lapses;
  `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_FAILURE_WINDOW_SECONDS`).
- Uploads are size-capped (25 MB documents, 5 MB images) and documents
  are type-checked at intake (PDF/DOC/DOCX/URL only).
- Passwords are stored as salted hashes; signing links use unguessable
  tokens; the Stripe webhook verifies signatures.

Your part:

- Never set `URL_FETCH_ALLOW_PRIVATE=1` in production (it disables the
  SSRF guard for local development).
- Keep the host, Docker, and the repo checkout updated.
- Restrict who can read `.env.prod` — it holds every secret.
- If you enable billing, use **live** Stripe keys only in production,
  and confirm the webhook endpoint shows successful deliveries in the
  Stripe dashboard after your first test purchase.
