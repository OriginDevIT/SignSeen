# Staging deployment (GCP)

A real-URL test rig for SignSeen: same compose stack as local dev, plus
Caddy for automatic HTTPS. This is a **staging** box, not production —
data is ephemeral and the web/API run dev servers.

## What you need

- A GCP project with billing enabled (the VM below fits the free tier).
- DNS control for `getsignseen.com` (one A record).

## 1. Create the VM

GCP Console → Compute Engine → Create instance:

- Name: `signseen-staging`
- Region/zone: `us-central1-a` (free-tier eligible)
- Machine type: `e2-micro` (2 shared vCPU, 1 GB RAM — free tier)
- Boot disk: 30 GB balanced (free tier covers 30 GB)
- Firewall: check **Allow HTTP traffic** and **Allow HTTPS traffic**

Note: 1 GB RAM is tight with LibreOffice + Next.js + Postgres. Fine for
testing; if it's sluggish, bump to `e2-small` (~$13/mo).

## 2. Point DNS at it

Add an A record: `staging.getsignseen.com` → the VM's external IP.
(Use a different hostname here only if you change `STAGING_DOMAIN`.)

## 3. Prepare the VM

SSH in and install Docker + git:

```bash
sudo apt-get update && sudo apt-get install -y git
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in so the docker group applies
```

Clone and check out the code:

```bash
git clone https://github.com/OriginDevIT/SignSeen.git
cd SignSeen
git checkout phase-2-intake-breadth   # or main, once merged
```

## 4. Configure

```bash
cp .env.staging.example .env.staging
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
# paste the output as DJANGO_SECRET_KEY in .env.staging
```

## 5. Launch

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml \
  --env-file .env.staging up --build -d
```

First build takes a while (LibreOffice layer). Then:

- `https://staging.getsignseen.com` → web app
- `https://staging.getsignseen.com/api/health/` → API check

Caddy provisions the Let's Encrypt certificate automatically on first
request (DNS must already resolve).

## 6. Run the manual tests

Follow `docs/manual-test-script.md`, replacing `localhost` URLs with the
staging hostname. Phone testing works with no LAN tricks — you're on a
real domain.

## Caveats (staging, not prod)

- **Ephemeral data**: uploads, signed PDFs, and the database live on the
  VM's disk / Docker volumes. A rebuild or `down -v` wipes them.
- **Dev servers**: both API (`runserver`) and web (`next dev`) run in dev
  mode. Production gets gunicorn + `next build`/`next start` later.
- **Cost**: ~$0 on the free tier (e2-micro, 30 GB disk, minimal egress).
- **Updates**: `git pull && docker compose ... up --build -d` redeploys.
