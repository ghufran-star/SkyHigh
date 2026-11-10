# Sky High

A light, shared lead tracker for calling agencies. One shared login, used from two phones at once — one person adds numbers, the other calls and updates statuses. Everything syncs within a few seconds.

## What it does
- **Contacts:** agency name, agency rank, owner name, phone, notes
- **One-tap Call** (opens the phone dialer) and **WhatsApp** (opens the chat with a pre-filled message using `{first}`, `{owner}`, `{agency}`, `{me}`)
- **Statuses:** New, No Answer, Call Back, WhatsApp Dropped, Positive, Meeting Booked, Meeting Done, Rejected, Wrong Number. Each change is logged in the contact's history with who made it, and can be undone
- **After a call**, when you come back to the app it asks how the call went. After WhatsApp, it offers to mark the lead "WhatsApp Dropped"
- **Bulk upload** from Excel (.xlsx/.xls), CSV, or rows pasted from a spreadsheet. Columns are matched automatically, and duplicate or invalid numbers are skipped
- Duplicate-number warning when adding a contact, plus "Save & add another" for fast entry
- Search, status filters with counts, sort by rank / newest / updated / A–Z
- Text size A−/A+ (pinch-zoom works too), a header that stays at the top and a bottom bar that stays put, dark mode
- Works offline: changes are queued and sent when the connection comes back. You can install it on the home screen (Share → Add to Home Screen)
- Export to CSV

## Deploy on Railway
1. New Project → Deploy from GitHub → `ghufran-star/SkyHigh`.
2. Add a **PostgreSQL** database to the project. Railway sets `DATABASE_URL` automatically (reference it in the service's variables if it isn't already linked).
3. Set the variable `APP_PASSWORD` to the shared password you both will use.
4. Settings → Networking → Generate Domain. Open it on both phones and sign in.

Without `DATABASE_URL`, the app stores data in a JSON file in `DATA_DIR` (default `./data`). That's fine on a Railway volume, but the data is wiped on redeploy unless you attach one, so use Postgres.

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Shared sign-in password (strongly recommended) |
| `DATABASE_URL` | Postgres connection (Railway sets this) |
| `APP_SECRET` | Optional extra secret for sign-in tokens |
| `PGSSL` | Set `true` if your Postgres needs SSL |

## Run locally
```
npm install
APP_PASSWORD=test npm start   # http://localhost:3000
```
