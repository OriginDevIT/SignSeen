# SignSeen — Signed. Seen. Sealed.

Open-source electronic signature with a photographic witness. Scan a QR code,
sign on your phone, snap a photo.

Every signature ships with a tamper-evident audit trail: document hash,
server-side timestamp, device session evidence, and an optional photo of the
signer. ESIGN/UETA-compliant. No accounts for signers, no per-envelope fees,
no certificates to install.

## Status

Early prototype — currently at **Phase 0** (project scaffold). Expect rough
edges.

## Quickstart (self-host)

```bash
docker compose up
```

- Web app: http://localhost:3000
- API: http://localhost:8000/api/health/
- Postgres: localhost:5432 (user/password/db: `signseen`)

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
