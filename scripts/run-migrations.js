/**
 * Run pending migrations against any Postgres database.
 *
 * Usage (local .env DATABASE_URL):
 *   node scripts/run-migrations.js
 *
 * Usage (Render / remote DB):
 *   DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node scripts/run-migrations.js
 *
 * The script tracks which migrations it has already applied in the standard
 * Prisma _prisma_migrations table, so it is safe to re-run — already-applied
 * migrations are skipped automatically.
 */

require('./load-env')
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.join(__dirname, '../prisma/migrations')

// Only the three new migrations that need to run on Render.
// Safe to add more here later — they run in the order listed.
const PENDING_MIGRATIONS = [
  '20260626013000_add_industry_knowledge',
  '20260626015200_add_missing_operational_tables',
  '20260627000000_add_social_voice_features',
]

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('❌  DATABASE_URL is not set. Add it to .env or pass it as an env var.')
    process.exit(1)
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('render.com') || dbUrl.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : false,
  })

  await client.connect()
  console.log('✅  Connected to database')
  console.log()

  // Ensure the Prisma migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id                      VARCHAR(36)  PRIMARY KEY,
      checksum                VARCHAR(64)  NOT NULL,
      finished_at             TIMESTAMPTZ,
      migration_name          TEXT         NOT NULL,
      logs                    TEXT,
      rolled_back_at          TIMESTAMPTZ,
      started_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      applied_steps_count     INTEGER      NOT NULL DEFAULT 0
    )
  `)

  // Fetch already-applied migrations
  const { rows: applied } = await client.query(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
  )
  const appliedNames = new Set(applied.map(r => r.migration_name))

  let ran = 0
  let skipped = 0

  for (const migrationName of PENDING_MIGRATIONS) {
    if (appliedNames.has(migrationName)) {
      console.log(`⏭️   Skipping  ${migrationName}  (already applied)`)
      skipped++
      continue
    }

    const sqlFile = path.join(MIGRATIONS_DIR, migrationName, 'migration.sql')
    if (!fs.existsSync(sqlFile)) {
      console.error(`❌  SQL file not found: ${sqlFile}`)
      process.exit(1)
    }

    const sql = fs.readFileSync(sqlFile, 'utf8')
    const id = require('crypto').randomUUID()

    console.log(`⏳  Running   ${migrationName} ...`)

    await client.query('BEGIN')
    try {
      await client.query(sql)

      // Mark as applied in Prisma's tracking table
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES ($1, $2, NOW(), $3, 1)`,
        [id, 'manual', migrationName]
      )

      await client.query('COMMIT')
      console.log(`✅  Applied   ${migrationName}`)
      ran++
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`❌  Failed    ${migrationName}`)
      console.error('   ', err.message)
      console.error()
      console.error('   The transaction was rolled back — no partial changes were written.')
      console.error('   Fix the error and re-run this script.')
      await client.end()
      process.exit(1)
    }
  }

  await client.end()

  console.log()
  console.log('═══════════════════════════════════════')
  console.log(`✅  Done — ${ran} applied, ${skipped} skipped`)
  console.log('═══════════════════════════════════════')
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
