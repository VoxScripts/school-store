# School Store — Minimal Campus E‑Commerce

A simple e‑commerce for a school student to sell items *inside school*.
- **No customer accounts.** Shoppers add to cart and checkout directly.
- **Admin portal only** to manage items and view orders.
- **Payment options:** Cash (pay to "Shaikh X" in school) or **Card** via Ziina link (amount auto-filled).

## Quick Start
```bash
cp .env.example .env
# edit .env (set Ziina link, admin credentials, etc.)

npm install
npm start
# open http://localhost:3000
# admin portal: http://localhost:3000/admin/login
```
Login with credentials from `.env`.

## Notes
- Products use **image URL** (copy from web or upload somewhere and paste URL).
- All orders are created as **UNPAID**. Mark as **Paid** in Admin after confirming cash or Ziina settlement.
- Ziina redirect uses `ZIINA_BASE_URL?amount=XX.XX`.
