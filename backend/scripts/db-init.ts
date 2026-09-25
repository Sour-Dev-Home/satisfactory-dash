import "dotenv/config";
import { provisionDatabase } from "../src/platform/db/admin.js";

// ADR-0025: one-time (idempotent) database setup, run by the operator with a Postgres superuser
// URL. Creates the satis_migrator and satis_app roles and the database (builtin C.UTF-8 locale).
//   DATABASE_ADMIN_URL      postgres://postgres:<admin password>@localhost:5432/postgres
//   DB_MIGRATOR_PASSWORD    password to set for satis_migrator (16+ characters)
//   DB_APP_PASSWORD         password to set for satis_app (16+ characters)
//   DB_BACKUP_PASSWORD      optional: also create the read-only satis_backup role (16+ characters)
//   DB_NAME                 optional, default "satis"
// Passwords are never printed. Put the app one into DATABASE_URL in backend/.env.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is required (see backend/scripts/db-init.ts).`);
    process.exit(1);
  }
  return value;
}

const migratorPassword = required("DB_MIGRATOR_PASSWORD");
const appPassword = required("DB_APP_PASSWORD");
if (migratorPassword.length < 16 || appPassword.length < 16) {
  console.error("DB_MIGRATOR_PASSWORD and DB_APP_PASSWORD must each be at least 16 characters.");
  process.exit(1);
}
if (migratorPassword === appPassword) {
  console.error("Use different passwords for the migrator and the app role.");
  process.exit(1);
}

// Optional: the read-only role the nightly backup uses (ADR-0025 decision 7, runbooks/backups.md).
const backupPassword = process.env.DB_BACKUP_PASSWORD?.trim() || undefined;
if (backupPassword !== undefined && (backupPassword.length < 16 || backupPassword === appPassword || backupPassword === migratorPassword)) {
  console.error("DB_BACKUP_PASSWORD must be at least 16 characters and different from the other two.");
  process.exit(1);
}

const database = process.env.DB_NAME?.trim() || "satis";
await provisionDatabase({ adminUrl: required("DATABASE_ADMIN_URL"), database, migratorPassword, appPassword, backupPassword });
console.log(
  `Database "${database}" and roles satis_migrator, satis_app${backupPassword ? ", satis_backup" : ""} are ready. Next: npm run db:migrate`,
);
