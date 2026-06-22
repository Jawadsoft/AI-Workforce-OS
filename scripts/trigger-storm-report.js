/**
 * Scrapes NOAA SPC HTML reports and saves storm data to the DB.
 * Run on the server: node scripts/trigger-storm-report.js [YYYY-MM-DD]
 * Example: node scripts/trigger-storm-report.js 2026-06-21
 */
require('./load-env')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function subDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() - n)
  return d
}

function formatNoaa(date) {
  const yy = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

function formatHuman(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ── Fetch NOAA SPC CSV and parse rows ────────────────────────────
// Confirmed URLs:
//   yesterday:  yesterday_hail.csv / yesterday_torn.csv / yesterday_wind.csv
//   historical: 260620_rpts_hail.csv / 260620_rpts_torn.csv / 260620_rpts_wind.csv
// Lat/Lon are ALREADY in decimal degrees — do NOT divide by 100.

function buildCsvUrl(date, type, isYesterday) {
  if (isYesterday) {
    return `https://www.spc.noaa.gov/climo/reports/yesterday_${type}.csv`
  }
  return `https://www.spc.noaa.gov/climo/reports/${formatNoaa(date)}_rpts_${type}.csv`
}

async function fetchCsv(url) {
  console.log(`  Fetching: ${url}`)
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 StormBuddi-AI/1.0' },
      signal: AbortSignal.timeout(20000),
    })
    console.log(`  Status: ${resp.status}`)
    if (!resp.ok) return []
    const text = await resp.text()
    const lines = text.split('\n').filter(l => l.trim())
    console.log(`  Lines: ${lines.length} (first: ${lines[0] || 'none'})`)
    return lines.slice(1).map(l => l.split(',').map(v => v.trim().replace(/^"|"$/g, '')))
  } catch (e) {
    console.error(`  Fetch error: ${e.message}`)
    return []
  }
}

async function fetchAndParse(date, isYesterday) {
  const [hailRows, tornRows, windRows] = await Promise.all([
    fetchCsv(buildCsvUrl(date, 'hail', isYesterday)),
    fetchCsv(buildCsvUrl(date, 'torn', isYesterday)),
    fetchCsv(buildCsvUrl(date, 'wind', isYesterday)),
  ])

  // Hail: Time, Size(100ths inch), Location, County, State, Lat, Lon, Comments
  const hail = hailRows
    .filter(r => r.length >= 7 && /^\d{3,4}$/.test(r[0]))
    .map(r => ({
      time: r[0], size: parseFloat(r[1]) / 100,
      location: r[2] || '', county: r[3] || '', state: r[4] || '',
      lat: parseFloat(r[5]), lon: parseFloat(r[6]),  // already decimal degrees
      comments: r.slice(7).join(' '),
    }))
    .filter(r => !isNaN(r.size) && r.size > 0 && r.state.length === 2)

  // Tornado: Time, F_Scale, Location, County, State, Lat, Lon, Comments
  const tornado = tornRows
    .filter(r => r.length >= 6 && /^\d{3,4}$/.test(r[0]))
    .map(r => ({
      time: r[0], location: r[2] || '', county: r[3] || '', state: r[4] || '',
      lat: parseFloat(r[5]), lon: parseFloat(r[6] || '0'),
      comments: r.slice(7).join(' '),
    }))
    .filter(r => r.state.length === 2)

  // Wind: Time, Speed(mph), Location, County, State, Lat, Lon, Comments
  const wind = windRows
    .filter(r => r.length >= 7 && /^\d{3,4}$/.test(r[0]))
    .map(r => ({
      time: r[0], speed: (r[1] === 'UNK' || r[1] === '') ? 0 : parseFloat(r[1]),
      location: r[2] || '', county: r[3] || '', state: r[4] || '',
      lat: parseFloat(r[5]), lon: parseFloat(r[6] || '0'),
      comments: r.slice(7).join(' '),
    }))
    .filter(r => r.state.length === 2)

  console.log(`  Parsed — hail: ${hail.length}, tornado: ${tornado.length}, wind: ${wind.length}`)
  return { hail, tornado, wind }
}

async function scrapeForTenant(tenantId, tenantName, date) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId }, select: { settings: true, industry: true },
  })
  const settings = tenant?.settings ?? {}
  const brain = settings.brain ?? {}
  const serviceArea = brain.serviceArea ?? brain.serviceStates ?? ''
  const serviceStates = serviceArea
    ? (Array.isArray(serviceArea) ? serviceArea : serviceArea.split(/[,\s]+/)).map(s => s.toUpperCase().trim()).filter(Boolean)
    : []

  console.log(`  Service area: ${serviceStates.length ? serviceStates.join(', ') : 'ALL STATES (none configured)'}`)

  const yesterday = subDays(new Date(), 1)
  const isYesterday = formatNoaa(date) === formatNoaa(yesterday)
  const { hail, tornado, wind } = await fetchAndParse(date, isYesterday)

  let filteredHail = serviceStates.length ? hail.filter(e => serviceStates.includes(e.state)) : hail
  let filteredTornado = serviceStates.length ? tornado.filter(e => serviceStates.includes(e.state)) : tornado
  let filteredWind = serviceStates.length ? wind.filter(e => serviceStates.includes(e.state)) : wind

  // Delete existing for this date
  const start = new Date(date); start.setUTCHours(0, 0, 0, 0)
  const end = new Date(date); end.setUTCHours(23, 59, 59, 999)
  await prisma.stormReport.deleteMany({ where: { tenantId, reportDate: { gte: start, lte: end } } })

  const toCreate = [
    ...filteredHail.map(h => ({ tenantId, reportDate: date, type: 'hail', time: h.time, state: h.state, county: h.county, location: h.location, lat: h.lat || null, lon: h.lon || null, size: h.size, comments: h.comments })),
    ...filteredTornado.map(t => ({ tenantId, reportDate: date, type: 'tornado', time: t.time, state: t.state, county: t.county, location: t.location, lat: t.lat || null, lon: t.lon || null, size: null, comments: t.comments })),
    ...filteredWind.map(w => ({ tenantId, reportDate: date, type: 'wind', time: w.time, state: w.state, county: w.county, location: w.location, lat: w.lat || null, lon: w.lon || null, size: w.speed > 0 ? w.speed : null, comments: w.comments })),
  ]

  if (toCreate.length) {
    await prisma.stormReport.createMany({ data: toCreate })
    console.log(`  ✅ Saved ${toCreate.length} reports (${filteredHail.length} hail, ${filteredTornado.length} tornado, ${filteredWind.length} wind)`)
    const largestHail = filteredHail.reduce((m, h) => Math.max(m, h.size), 0)
    if (largestHail > 0) console.log(`  Largest hail: ${largestHail.toFixed(2)}"`)
  } else {
    console.log(`  ℹ️  No reports in service area (total events nationwide: ${hail.length} hail, ${tornado.length} tornado, ${wind.length} wind)`)
  }
}

async function main() {
  const dateArg = process.argv[2]
  const date = dateArg ? new Date(dateArg) : subDays(new Date(), 1)
  console.log(`\n Storm Report Scraper`)
  console.log(`Date: ${formatHuman(date)}\n`)

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true }, select: { id: true, name: true },
  })
  console.log(`Found ${tenants.length} tenant(s)\n`)

  for (const t of tenants) {
    console.log(`Tenant: ${t.name}`)
    await scrapeForTenant(t.id, t.name, date)
    console.log()
  }

  console.log('Done! Arturo can now answer storm questions in chat.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
