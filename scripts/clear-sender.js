const fs = require('fs'), path = require('path')
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const prisma = new PrismaClient()

const SENDER = process.argv[2] || 'jawadsyed501@gmail.com'

async function main() {
  const d = await prisma.processedEmail.deleteMany({ where: { fromEmail: SENDER } })
  console.log(`Cleared ${d.count} processed records for ${SENDER}`)
}
main().catch(console.error).finally(() => prisma['$disconnect']())
