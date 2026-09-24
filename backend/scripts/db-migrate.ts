import "dotenv/config";
import { migrateUp } from "../src/platform/db/admin.js";

// ADR-0025: applies pending migrations, forward-only, as satis_migrator. An explicit operator
// step: the backend never migrates itself. Start order: Postgres, `npm run db:migrate`, backend.
//   MIGRATOR_DATABASE_URL   postgres://satis_migrator:<password>@localhost:5432/satis

const url = process.env.MIGRATOR_DATABASE_URL?.trim();
if (!url) {
  console.error("MIGRATOR_DATABASE_URL is required (see backend/scripts/db-migrate.ts).");
  process.exit(1);
}
await migrateUp(url, (message) => console.log(message));
console.log("Migrations are up to date.");
