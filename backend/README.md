# Nanda Jewellers

The showroom software is separated into:

```text
Nanda Software/
  frontend/         React + TypeScript + Vite showroom interface
  backend/          API, database, shared package, scripts, configuration and saved data
  scanner/          Expo scanner app
```

The Expo scanner remains in `../scanner`.

## Start the application

Requires Node.js 22.12+ and npm. From PowerShell:

```powershell
cd "D:\Nanda Software\backend"
npm start
```

The start script automatically:

1. Creates missing local environment settings with random database and CSRF secrets, preserving existing settings.
2. Installs dependencies if they are missing.
3. Generates Prisma Client and builds the shared package.
4. Starts persistent local PostgreSQL, connects to an existing server, or starts Docker according to `DATABASE_MODE`.
5. Creates the database if needed and applies committed migrations.
6. Initializes missing business settings and manually configured metal rates.
7. Creates an initial **local development** administrator if none exists. A random password is saved to `.local/initial-admin.txt`; it is never printed to the console.
8. Starts the backend and frontend together.

Open **http://localhost:5173**. Backend health is **http://localhost:4000/api/health**.

Use `localhost:5173`, matching `APP_ORIGIN`. Cookie-authenticated write requests require this exact origin.

Press **Ctrl+C** in the running terminal to stop both applications and the local database instance owned by that command. Existing external databases are not stopped. Inventory, photos and invoices persist between starts.

If setup is interrupted during dependency installation, run `npm install` and then `npm start` again.

## Setup without launching the UI

```powershell
npm run setup
```

This performs environment, dependency, database, migration and initialization work, then stops the local database it started. `npm start` starts it again as needed.

Automatic setup never inserts sample jewellery, fake sales, invoices, customers or employee fixtures. Initial rates default to zero (not configured). Sign in and enter your own rates before issuing invoices.

## Login

The first successful local setup creates:

- Login identifier: `admin@nandajewellers.local`
- Password: the generated value in `.local/initial-admin.txt`

Existing administrators and their passwords are preserved on later runs. Keep the credential file private. Do not commit or share `.env` or `.local`.

For a custom initial administrator, set `CREATE_LOCAL_ADMIN=false` before first setup, keep the database running with `npm run db:start`, and use:

```powershell
npm run admin:create -- --name "Showroom Owner" --email "owner@example.com"
```

That command prompts for a password of at least 12 characters and refuses if an administrator already exists. Automatic account creation is disabled in production; no production password is hardcoded.

## Separate frontend and backend commands

After setup, keep PostgreSQL running in a terminal:

```powershell
npm run db:start
```

Then, in separate terminals at the project root:

```powershell
npm run backend
npm run frontend
```

Or use workspace commands directly:

```powershell
npm run dev --workspace @nanda/backend
npm run dev --workspace @nanda/frontend
```

Both projects use the root `.env`. Browser code receives no database/session secrets. Development API traffic is proxied by Vite.

## Database configuration

The local `.env` has been configured with newly generated secrets. Setup does not rotate existing non-placeholder credentials.

Default configuration:

```dotenv
DATABASE_MODE=embedded
DATABASE_PORT=54329
APP_ORIGIN=http://localhost:5173
PORT=4000
NODE_ENV=development
UPLOAD_DIR=./uploads
SESSION_HOURS=12
INITIAL_GOLD_RATE=0
INITIAL_SILVER_RATE=0
CREATE_LOCAL_ADMIN=true
```

`DATABASE_URL`, `DATABASE_PASSWORD`, and `CSRF_SECRET` are generated locally. Do not paste them into public logs.

**Embedded mode:** real PostgreSQL runs on loopback, with SCRAM authentication, using the npm-installed PostgreSQL binaries. Files persist in `.local/postgres`. Docker/system installation is not required. This is intended for local evaluation/development. Its initial package download requires registry access.

**Docker mode:** set `DATABASE_MODE=docker`; the included Compose file uses `DATABASE_PORT` (default 54329), the generated password and a persistent named volume. Docker Desktop must be running. Use an empty database or deliberately configure the existing database connection; do not point different database backends at unrelated existing data.

**External mode:** set `DATABASE_MODE=external` and `DATABASE_URL` to your already created PostgreSQL database. The script connects without starting or stopping that server. Ensure the migration user has the permissions required to create tables.

Metal rates are **manually configured INR per gram**, not live market prices. `db:init` fills only missing configuration and never overwrites an existing rate.

## Database and maintenance commands

With the database running:

```powershell
npm run db:generate
npm run db:migrate
npm run db:init
npm run photos:cleanup
```

Migrations live in `prisma/migrations`. They enforce stock/weight/quantity constraints, unique barcodes/invoice identifiers, foreign keys and immutable invoice snapshots.

The API attempts expired-session and orphan-photo cleanup hourly. The manual cleanup command removes unattached photo records/files after a 24-hour grace period. Replacing a photo never removes the saved one before a successful save.

Back up PostgreSQL **and** `uploads`. For embedded mode, use PostgreSQL backup tools or stop the database before taking a filesystem backup of its cluster. A database-only backup does not contain product image bytes.

## Build and tests

```powershell
npm run build
npm run typecheck
npm test
```

Integration tests create a unique temporary schema in an explicitly supplied disposable PostgreSQL database; they do not reset normal business data. With a database running:

```powershell
# Use your local DATABASE_URL value; do not publish its password.
$env:TEST_DATABASE_URL="postgresql://nanda:YOUR_LOCAL_PASSWORD@127.0.0.1:54329/nanda?schema=public"
npm run test:integration
Remove-Item Env:TEST_DATABASE_URL
```

Coverage includes zero starting inventory, opening stock/receipts, repeated scans and active bills, no unsaved stock deductions, the ₹9,700 example, idempotent issuance, concurrent final-piece sales, stale quotes, archives, historical snapshots, employee data privacy, decoded uploads, photo replacement/removal/cancellation, SVG generation, PDF reads and session controls.

## Showroom features and pricing

The interface includes Overview, Inventory, Billing, Invoices, Stock activity, and administrator-only Rate settings, Employees and Business settings. Inventory has product photos, table/card views, filters, pagination, a detail drawer and Code 39 label printing/download.

Only gold and silver **base rates** are global. Each product owns its selling surplus in INR/g. Employees have an additional personal gold/silver surplus in INR/g.

- Admin rate = base + product surplus.
- Employee rate = base + product surplus + employee metal surplus.
- Piece price = round to paise(rate × net weight).
- Line amount = round to paise(rate × net weight × integer quantity).
- Invoice total = sum of rounded line amounts.

Rates and weights retain four decimal places. Core pricing uses exact fixed-point decimal arithmetic with BigInt; backend aggregation uses decimal.js and PostgreSQL NUMERIC. Currency formatting preserves large decimal monetary strings without floating-point conversion.

Scanning a jewellery tag adds it to the active bill; repeat scans increase quantity. The backend holds the active bill during scanning, but only a confirmed bill appears in Saved bills. Closing the bill, signing out, or reopening the showroom discards unfinished items. Unsaved items do not reserve or deduct stock. The cashier confirms issuance; the backend verifies fresh prices, availability and identity, and atomically creates an immutable invoice, deducts stock and records sale movements. Retries use issuance keys and draft uniqueness to prevent duplication.

Employee responses omit base rates and surplus breakdowns. Employees see their own invoices; administrators see all invoices. Issued invoices keep original product, seller, customer and business snapshots after later edits or archival.

No GST, making charges, purity conversion, payment tracking, returns or credit notes are calculated. Invoices are not marked Paid or GST Tax Invoice. Dates use Asia/Kolkata.

## Production

```powershell
npm run build
# Set NODE_ENV=production and APP_ORIGIN to your actual HTTPS origin.
npm run start:production
```

Production serves the built frontend and API from Express. Use an externally managed PostgreSQL database and persistent upload storage, configure HTTPS, apply migrations separately, and create the initial administrator explicitly. Do not use generated development credentials as production credentials.

## Verification status

Verified in the current workspace:

- All three committed PostgreSQL migrations are applied; there are no pending migrations.
- Prisma Client generation and business initialization succeeded.
- Backend and frontend TypeScript checks and production builds passed.
- All 43 automated tests passed: 8 showroom unit tests, 22 isolated PostgreSQL integration tests and 13 scanner unit tests.
- Frontend, backend health, local administrator login, dashboard, inventory and logout returned HTTP 200.
- The frontend and backend were started locally. Initial administrator credentials are in .local/initial-admin.txt.

Desktop/mobile visual browser checks, hardware readers, physical printing and scans of printed labels remain unverified. The frontend build emits a bundle-size advisory, which does not block startup.

The Expo phone app supports paired phone-to-desktop scan delivery in addition to copying/sharing. Main showroom scanning also supports a keyboard-wedge scanner or manual entry.

PDFs use built-in Latin fonts and the INR code; non-Latin rendering is not validated. Browser print uses web fonts.

References: [Prisma transactions](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions), [bwip-js](https://github.com/metafloor/bwip-js), [Sharp](https://sharp.pixelplumbing.com/api-constructor/), [embedded PostgreSQL](https://github.com/leinelissen/embedded-postgres).

## Connect the Expo phone scanner

1. Open **Make a bill → Pair phone** on the computer to show the pairing QR.
2. Keep the phone and computer on the same trusted local network.
3. Reload the Expo app and tap **Pair with computer**.
4. Allow camera access and scan the QR. The computer address is included automatically; no code or address needs to be typed.
5. Scan one of the product barcodes. New scans automatically add to the paired cashier’s current draft, which refreshes within two seconds.

The QR is single-use and expires after five minutes. Pairing grants only limited scanning/status/disconnect access for the cashier account. The phone stores its token securely and restores the connection after reopening the app. Saving or closing an unsaved bill keeps the phone paired; the next scan starts a new bill. Disconnecting, signing out, employee deactivation, and password reset revoke access.

Transport retries reuse the same scan event ID so they cannot silently double-add a product. Intentionally scanning again after **Scan next barcode** creates a new event and increases quantity. Unknown, archived and out-of-stock tags are rejected. Stock is never deducted by a phone scan.

The scanner sends no prices, employee IDs or invoice totals. The server uses the paired cashier’s authenticated identity and current pricing. Draft changes during the confirmation dialog close it and require review again.

Expo Go is the native development target. The computer must remain running and its Node API must be reachable on your trusted network. If Windows blocks the connection, allow the appropriate private-network access on your computer or ask your network administrator; this task did not change firewall settings. Use HTTPS for remote or production connections; standalone mobile network policies require separate device testing.

## Explicitly requested demo collection

Five clearly labelled **Demo** products were added at the user's request, each with an AI-generated product photo, a permanent barcode and audited opening stock:

| Product | Metal | Net weight / piece | Surplus / gram | Opening pieces |
|---|---|---:|---:|---:|
| Demo · Gold Solitaire Ring | Gold | 4.250 g | ₹850 | 8 |
| Demo · Gold Rope Chain | Gold | 12.500 g | ₹650 | 5 |
| Demo · Gold Jhumka Earrings | Gold | 8.750 g | ₹950 | 6 |
| Demo · Silver Filigree Ring | Silver | 10.000 g | ₹120 | 12 |
| Demo · Silver Lakshmi Coin | Silver | 10.000 g | ₹40 | 20 |

These are fictional evaluation records, not actual showroom stock. Existing nonzero common rates were preserved. The optional `npm run demo:add` command is explicit and idempotent by demo product name; it is never run on application startup. It does not reset, overwrite or replenish existing demo products. If common rates are unconfigured, that explicit command uses clearly logged, manually entered examples only.

Original generated PNGs and prompt provenance are in [demo-assets](demo-assets/README.md). Product records reference authenticated, optimized WebP images in the regular upload storage.

Verification for this update: 22 PostgreSQL integration tests, 8 showroom unit tests and 13 scanner unit tests passed (43 total). Backend, frontend and Expo TypeScript checks passed; the showroom production builds passed. All five authenticated photo URLs returned HTTP 200 and the LAN backend health check returned HTTP 200. The Android Metro bundle compiled successfully (HTTP 200). Native physical-camera/network and printer tests remain unperformed. Expo lint was attempted but could not install its missing lint dependencies in the tool environment.
