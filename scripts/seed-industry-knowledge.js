/**
 * Seeds industry knowledge packs for ROOFING and CLEANING.
 *
 * Usage:  node scripts/seed-industry-knowledge.js
 *
 * This script:
 *  1. Creates IndustryKnowledgePack records for ROOFING + CLEANING
 *  2. Creates IndustryKnowledgeDoc records with real industry content
 */

require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')

const prisma = new PrismaClient()

// ── Industry knowledge content ────────────────────────────────────────────────

const ROOFING_DOCS = [
  {
    name: 'Roofing Customer Sales Journey',
    category: 'SALES_FLOW',
    agentRoles: ['sales', 'intake', 'estimator', 'handyman', 'customer'],
    content: `
ROOFING CUSTOMER JOURNEY — use this order. Never dump later stages on a first hello.

STAGE 1 — GREET
• Warm intro. Name yourself. One question: what happened, or what do they need?
• Do NOT mention insurance, supplements, Xactimate, ice-and-water shield, or inspection checklists yet.

STAGE 2 — QUALIFY (one question at a time)
• Property address / area
• What they noticed (leak, missing shingles, hail, age of roof)
• Storm/damage? If yes, then ask if they have already filed insurance
• Best callback time

STAGE 3 — BALLPARK
• If company brain has a price, use it
• Else typical installed range from the pricing guide — label it as typical, not a firm quote
• Firm written estimate after inspection
• Do not recite full Xactimate line items unless they ask for a detailed scope

STAGE 4 — BOOK
• Offer a roof inspection / site visit
• Confirm name, address, preferred window
• Log a ticket

HYBRID PRICING: brain price first → else “typically $X–$Y per square” → firm quote after visit.
    `.trim(),
  },
  {
    name: 'GAF Shingle Product Guide',
    category: 'PRODUCTS',
    agentRoles: ['estimator', 'sales', 'intake', 'coordinator'],
    content: `
GAF SHINGLE PRODUCT GUIDE — Key Lines

TIMBERLINE SERIES (Most Popular)
• Timberline HDZ (High Definition Z-Grip) — Premium architectural shingle
  - 130 mph wind warranty, Class 4 impact resistant (SBS modified)
  - Available: Charcoal, Pewter Gray, Weathered Wood, Barkwood, Oyster Gray, Hickory, Black, Hunter Green
  - Coverage: 33.3 sq ft per bundle, 3 bundles per square
  - Typical installed cost: $350–$450 per square (materials + labour, US market 2024–2026)
  - Warranty: Lifetime Ltd + 10-yr SureStart, 25-yr algae resistance

• Timberline CS (Cool Series) — Energy Star rated
  - Reflects solar heat, reduces attic cooling load
  - Available: Barkwood, Charcoal, Oyster Gray
  - Premium over HDZ: +$15–$25 per square

• Timberline AS II — Entry-level architectural
  - 110 mph wind, 25-yr limited warranty
  - Budget option: $280–$350 per square installed

PREMIUM LINES
• Camelot II — Designer heavyweight shingle, layered slate look
  - 130 mph wind, Class A fire
  - Installed: $500–$650 per square
• Grand Sequoia — Extra-thick, wood shake appearance
  - Installed: $480–$600 per square

THREE-TAB (Legacy / Budget)
• Royal Sovereign 3-tab
  - 60 mph wind, 25-yr warranty
  - Installed: $200–$280 per square
  - Note: Most insurers will upgrade to architectural via supplement when replacing 3-tab

SYSTEM COMPONENTS (Full GAF System)
• WeatherWatch Ice & Water Shield — valleys, eaves first 3 courses
• Deck Armor / FeltBuster synthetic underlayment — full deck
• Pro-Start starter strip — eaves and rakes
• Cobra Ridge Vent — continuous ridge ventilation
• Ultra-Flex pipe boots — boots/penetrations
• StormGuard Film Surfaced Ice & Water — extreme climates
• TimberTex / TimberCrest ridge cap — premium finish

SUPPLEMENT TIP: Always specify full GAF Lifetime System components in the scope — this unlocks the Golden Pledge warranty and supports supplement claims when the adjuster's estimate only includes basic shingles.
    `.trim(),
  },
  {
    name: 'Roof Replacement Pricing Guide',
    category: 'PRICING',
    agentRoles: ['estimator', 'sales'],
    content: `
ROOF REPLACEMENT PRICING GUIDE (US Market, 2024–2026)

MATERIAL COST RANGES (per square = 100 sq ft)
• Asphalt 3-tab: $80–$120 materials only
• Architectural (GAF HDZ, Owens Duration): $120–$180 materials only
• Premium architectural (GAF Camelot, Grand Sequoia): $200–$280 materials only
• Metal (standing seam): $400–$700 materials only
• Tile (concrete): $350–$500 materials only

LABOUR COST RANGES (per square)
• Simple gable, low pitch (4/12 or less): $80–$120
• Standard hip roof, moderate pitch (5/12–8/12): $100–$150
• Complex roof, steep pitch (9/12+): $140–$200+
• Add: $15–$30 per square for tear-off of existing shingles (1 layer)
• Add: $30–$60 per square for 2+ layers tear-off

FULL INSTALLED COST ESTIMATES
• 20 squares, simple gable, GAF HDZ: $9,000–$12,000
• 30 squares, standard hip, GAF HDZ: $14,000–$19,500
• 40 squares, standard hip, GAF HDZ: $18,500–$26,000
• 50 squares, complex, GAF HDZ: $24,000–$33,000
• 60 squares, standard, GAF HDZ: $29,000–$40,000

ADDITIONAL LINE ITEMS
• Gutter replacement (per linear foot): $8–$20 (aluminium), $20–$40 (copper)
• Fascia replacement (per linear foot): $6–$12
• Soffit replacement (per sq ft): $4–$8
• Chimney flashing: $200–$500
• Skylight flashing: $300–$500 per unit
• Pipe boot replacement: $50–$80 each
• Drip edge: $3–$5 per linear foot
• Ridge vent: $3–$5 per linear foot

PRICING STRATEGY FOR INSURANCE JOBS
1. Use RCV (Replacement Cost Value) pricing — do not discount to ACV
2. Include all accessories in scope (WeatherWatch, Pro-Start, Cobra Vent, pipe boots)
3. Add a separate line for haul-away and disposal
4. For hail-damaged roofs: always include decking inspection and possible replacement
5. Supplement targets: code upgrades (ice & water shield to full deck), architectural vs 3-tab upgrade, drip edge, starter strip
    `.trim(),
  },
  {
    name: 'Insurance Claims & Supplement Guide',
    category: 'INSURANCE',
    agentRoles: ['estimator', 'insurance', 'sales', 'intake'],
    content: `
ROOFING INSURANCE CLAIMS — COMPLETE GUIDE

KEY TERMS
• ACV (Actual Cash Value): Depreciated value of the old roof. Insurance pays this upfront.
• RCV (Replacement Cost Value): Full cost to replace with new materials. Paid after work is complete.
• Withheld Depreciation: RCV minus ACV. Released when work is done and receipts submitted.
• Deductible: Amount homeowner pays out of pocket (typically $500–$2,500 for roofs).
• Supplement: Additional claim filed when the adjuster's estimate is less than the actual repair cost.
• AOB (Assignment of Benefits): Legal document assigning insurance claim rights to the contractor.
• Xactimate: Software used by adjusters to generate estimates. Standard in US insurance industry.

CLAIM PROCESS (STEP BY STEP)
1. Storm/damage event occurs
2. Homeowner files claim with insurance company
3. Insurance assigns adjuster — inspection within 5–14 days
4. Adjuster produces Xactimate estimate (often underestimates)
5. Contractor reviews adjuster's scope — identify missing items
6. File supplement for additional items not in adjuster's scope
7. Insurance approves/denies supplement (usually 7–21 days)
8. ACV check issued to homeowner (minus deductible)
9. Contractor completes work
10. Contractor submits Certificate of Completion + photos
11. RCV (withheld depreciation) released to homeowner/contractor

COMMON SUPPLEMENT ITEMS (what adjusters miss)
• Architectural shingle upgrade from 3-tab: $40–$80 per square
• Ice and water shield (code in most northern states): $0.50–$1.50/sq ft
• Synthetic underlayment (vs felt): $0.20–$0.40/sq ft
• Starter strips: $0.40–$0.80/linear ft
• Ridge vent: included as upgrade
• Pipe boots: $45–$75 each
• Drip edge: $2–$4/linear ft
• Haul-away / disposal: $200–$600 depending on size
• Detach and reset satellite dishes, solar panels, skylights
• Steep slope premium (9/12+): 10–15% labour increase

HAIL DAMAGE SPECIFICS
• Hail > 1" typically causes shingle granule loss and bruising
• Document with photos before any repair: close-ups of each slope, ruler for size reference
• Look for: soft metal damage (gutters, vents, flashing), window screens, AC fins — these support the claim
• Hail maps (NOAA storm data): use to verify date and size of storm
• Most homeowner policies cover hail damage — check policy for named perils vs open perils

AOB (ASSIGNMENT OF BENEFITS)
• Allows contractor to receive insurance payment directly
• Customer signs AOB at contract signing
• Contractor deals with insurer directly from that point
• Reduces collection risk for contractor
• Note: Some states restrict or ban AOB (Florida partially; Texas limited) — always verify locally

TIMELINE EXPECTATIONS
• Adjuster visit: 5–14 days post-claim filing
• Supplement response: 7–21 days
• Depreciation release after completion: 5–10 business days
• Total: 3–8 weeks from claim filing to final payment
    `.trim(),
  },
  {
    name: 'Roof Inspection & Damage Assessment',
    category: 'PROCESS',
    agentRoles: ['inspector', 'field', 'estimator'],
    content: `
ROOF INSPECTION CHECKLIST — HAIL & STORM DAMAGE

PRE-INSPECTION SETUP
• Confirm storm date and pull NOAA hail map for location
• Note hail size recorded (1" = dime, 1.5" = quarter, 1.75" = golf ball)
• Document address and homeowner contact info

EXTERIOR INSPECTION (GROUND LEVEL FIRST)
□ Soft metals: gutters, downspouts, AC fins, window screens — look for dimpling/dents
□ Fencing, paint, wood surfaces — pitting or bruising indicates large hail
□ Window frames, sills — paint chips or metal dents
□ Photograph all damage from ground before ascending

ROOF INSPECTION (PER SLOPE)
□ Count total squares per slope (measure or estimate from ground + pitch factor)
□ Shingle granule loss — bald spots, granules in gutters
□ Bruising / soft spots — press carefully with thumb on back-side of shingle
□ Cracking or splitting from impact
□ Lifted, displaced or missing shingles (wind damage)
□ Ridge cap damage
□ Flashing condition: chimney, valleys, pipe boots, skylight
□ Fascia and soffit condition
□ Decking visible damage (soft spots indicating rot or wet damage)

DOCUMENTATION
• Minimum 3 photos per slope (wide, mid, close-up of damage)
• Photo date/time stamp should match inspection date
• Mark hail hits with chalk circle for adjuster reference
• Note number of hits per 10 sq ft test square (3+ hits per test square = sufficient density for claim)

REPORT STRUCTURE
1. Property info and inspection date
2. Storm data reference (NOAA)
3. Damage summary by slope (N, S, E, W)
4. Recommended scope of work
5. Photo log with captions
6. Estimated square count

WHEN TO RECOMMEND FULL REPLACEMENT VS REPAIR
• Full replacement: when 3+ hail hits per test square across majority of slopes, shingles > 15 years old, or if granule loss exceeds 30%
• Repair/spot replacement: isolated wind damage on newer roof, < 10% total area affected
    `.trim(),
  },
  {
    name: 'Roofing Industry Terminology',
    category: 'TERMINOLOGY',
    agentRoles: ['intake', 'sales', 'estimator', 'insurance', 'coordinator'],
    content: `
ROOFING TERMINOLOGY GLOSSARY

MEASUREMENTS
• Square: 100 sq ft of roofing area (standard unit for pricing)
• Pitch: Slope expressed as rise/run (e.g., 6/12 = 6 inches rise per 12 inches horizontal)
• Ridge: Horizontal peak where two roof slopes meet
• Valley: Where two roof slopes meet inward (water channel)
• Hip: Sloped roof end (vs gable which is vertical)
• Rake: Sloped edge of a gable roof
• Eave: Lower horizontal edge where roof overhangs the wall
• Fascia: Board at the eave edge, often where gutters attach
• Soffit: Underside of the eave overhang

MATERIALS
• Decking / Sheathing: Plywood or OSB boards nailed to rafters — base for everything
• Underlayment: Felt (15# or 30#) or synthetic — waterproof layer between deck and shingles
• Ice and Water Shield: Self-adhering rubberised membrane — valleys and eaves
• Starter Strip: First course along eaves and rakes — prevents blow-off
• Ridge Cap: Specialised shingles that cover the ridge
• Ridge Vent: Ventilation strip at ridge peak — allows hot air out
• Drip Edge: Metal flashing at eaves and rakes — directs water into gutter
• Flashing: Metal (aluminium, galvanised, lead) at penetrations — prevents water intrusion
• Pipe Boot: Rubber/metal seal around vent pipes

LABOUR TERMS
• Tear-off: Removing old shingles before new installation
• Decking replacement: Replacing damaged plywood/OSB
• Feathering: Blending new shingles into existing for repair work
• Hip and Ridge: Installing ridge cap on hips and ridge

BUSINESS / INSURANCE
• Xactimate: Estimating software used by insurance adjusters (Verisk)
• Xactimate Line Item: Specific cost entry in an adjuster's scope
• Supplement: Additional claim for costs not in original adjuster scope
• RCV: Replacement Cost Value — full new replacement cost
• ACV: Actual Cash Value — RCV minus depreciation
• Depreciation: Reduction based on age/condition (a 15-year-old roof may have 50% depreciation)
• AOB: Assignment of Benefits — homeowner assigns claim rights to contractor
• COC: Certificate of Completion — submitted to insurance to release RCV balance
• Recoverable Depreciation: The withheld amount that comes back after work is done
    `.trim(),
  },
]

const CLEANING_DOCS = [
  {
    name: 'Cleaning Customer Sales Journey',
    category: 'SALES_FLOW',
    agentRoles: ['sales', 'intake', 'estimator', 'handyman', 'customer', 'coordinator'],
    content: `
CLEANING / PROPERTY SERVICES CUSTOMER JOURNEY — follow this order.

STAGE 1 — GREET
• Friendly hello. Name yourself. Ask what they need help with (clean, handyman, or both).
• Do NOT list chemicals, COSHH, full price menus, or insurance.

STAGE 2 — QUALIFY (one question at a time)
• Home or commercial? Rough size (beds/baths or sq ft)
• One-off, regular, end of tenancy, or handyman job?
• Area / postcode
• Preferred day or how soon

STAGE 3 — BALLPARK
• Brain package price if you have one
• Else typical UK range (e.g. 3-bed regular clean, EOT, hourly handyman)
• Say what changes the price (access, extras, frequency)
• Firm quote after confirmed scope or visit for larger jobs

STAGE 4 — BOOK
• Offer a slot. Confirm name, address, time.
• Create a ticket with the right job type (cleaning vs handyman)

One conversation, one booking — never say you will transfer them to another teammate.
    `.trim(),
  },
  {
    name: 'Cleaning Services Pricing Guide',
    category: 'PRICING',
    agentRoles: ['sales', 'estimator', 'intake', 'coordinator'],
    content: `
PROFESSIONAL CLEANING SERVICES — PRICING GUIDE (UK Market, 2024–2026)

DOMESTIC CLEANING (RESIDENTIAL)
Standard Clean (per visit):
• Studio/1-bed flat: £60–£90 (2–3 hrs)
• 2-bed house: £80–£110 (3–4 hrs)
• 3-bed house: £100–£140 (4–5 hrs)
• 4-bed house: £130–£170 (5–6 hrs)
• 5-bed house: £160–£220 (6–7 hrs)

Deep Clean (end of tenancy / first clean) — typically 1.5–2x standard rate:
• 1-bed flat: £150–£200
• 2-bed house: £200–£280
• 3-bed house: £280–£380
• 4-bed house: £380–£480
• 5-bed house: £450–£600

Regular (weekly/fortnightly) — 10–15% discount from one-off rate

ADD-ON SERVICES
• Oven clean: £50–£80
• Fridge clean: £25–£40
• Window cleaning (interior): £30–£60
• Carpet cleaning (per room): £40–£70
• Upholstery cleaning (per piece): £60–£120
• Ironing (per hour): £15–£20

COMMERCIAL CLEANING (per hour or per sq ft)
• Office cleaning: £15–£20/hr (contracted) or £0.08–£0.15/sq ft
• Retail / shop: £16–£22/hr
• School / educational: £14–£18/hr
• Medical / dental: £20–£28/hr (requires specialist products)
• After-build / post-construction: £200–£600 per job depending on size
• Industrial: £18–£25/hr + specialist equipment

SPECIALIST SERVICES
• Floor scrubbing (machine): £0.10–£0.20/sq ft
• Pressure washing (exterior): £150–£400 depending on area
• Window cleaning (exterior, rope access): £2–£5/window
• Gutter cleaning: £100–£250
• Jet wash driveway: £80–£200

MINIMUM CALL-OUT
Most companies set a minimum of 2–3 hours per visit.
    `.trim(),
  },
  {
    name: 'Cleaning Methods & Surface Guide',
    category: 'PROCESS',
    agentRoles: ['operations', 'coordinator', 'estimator'],
    content: `
PROFESSIONAL CLEANING — METHODS & SURFACE GUIDE

FLOOR TYPES & RECOMMENDED METHODS
• Hardwood / engineered wood: Damp mop only, pH-neutral cleaner, no steam, no excess water
• Laminate: Slightly damp mop, no soaking, avoid steam mops
• Ceramic / porcelain tile: Wet mop, tile cleaner, steam effective for grout
• Vinyl / LVT: Damp mop, mild detergent, avoid abrasives
• Natural stone (marble, granite, travertine): pH-neutral ONLY — never acidic cleaners, no vinegar
• Carpet: Vacuum first, spot treat, extraction (hot water extraction = steam cleaning)
• Rubber / safety flooring: Machine scrub with neutral cleaner, avoid solvent-based products

KITCHEN CLEANING PROCESS
1. Remove loose items, soak heavily soiled items
2. Apply oven/degreaser — allow 10–15 min dwell time
3. Clean extractor hood filters (soak in hot water + degreaser)
4. Wipe down all surfaces (top to bottom, back to front)
5. Clean appliances: microwave (steam loosens grease), fridge (remove drawers)
6. Clean oven (with specific oven cleaner — non-caustic preferred in domestic settings)
7. Mop floor last

BATHROOM CLEANING PROCESS
1. Spray limescale remover on taps, showerhead, tiles — allow dwell time
2. Apply toilet cleaner under rim — leave to work
3. Scrub shower/bath with appropriate cleaner (avoid abrasive on acrylic)
4. Wipe down surfaces, mirrors, fixtures
5. Scrub toilet (inside and out)
6. Mop floor

SPECIALIST RUBBER FLOOR SCRUBBING
• Equipment: Ride-on/walk-behind floor scrubber with appropriate pad
• Chemical: pH-neutral or mildly alkaline cleaner (diluted per manufacturer spec)
• Process: Pre-sweep, apply solution, scrub, squeegee, dry pass
• University / sports hall: coordinate access to avoid disruption; often done evenings/weekends
• Post-clean: allow to dry completely before foot traffic (30–60 min)
• Frequency: Monthly for high-traffic sports/gym floors

CLEANING PRODUCT CATEGORIES
• General Purpose: Multi-surface spray (quaternary ammonium based)
• Degreaser: Kitchen/oven cleaner — alkaline, pH 10+
• Limescale Remover: Acidic (citric acid or phosphoric acid) — bathroom/kitchen
• Disinfectant: EN14476 certified for bacteria + viruses (hospitals/schools)
• Floor Cleaner: pH-neutral for most hard floors
• Carpet Cleaner: Low-foam extraction shampoo
• Glass Cleaner: Alcohol-based streak-free

COSHH (UK) — KEY POINTS
• COSHH = Control of Substances Hazardous to Health
• All cleaning chemicals must have Safety Data Sheet (SDS)
• Staff must be trained on chemicals they use
• PPE: gloves, eye protection for concentrated chemicals
• Proper dilution must be followed — concentrated products need correct ratios
• Chemicals must not be mixed (never bleach + ammonia, never bleach + acid)
• Storage: locked COSHH cabinet, labelled, separated from food areas
    `.trim(),
  },
  {
    name: 'Cleaning Industry Terminology',
    category: 'TERMINOLOGY',
    agentRoles: ['intake', 'sales', 'coordinator', 'hr'],
    content: `
PROFESSIONAL CLEANING TERMINOLOGY

SERVICE TYPES
• One-off clean: Single visit, usually deeper scope
• Regular clean: Ongoing scheduled visits (weekly, fortnightly, monthly)
• End of tenancy (EOT): Deep clean when tenant vacates — often to landlord/agent standard
• Move-in clean: Same as EOT but for incoming tenant
• Spring clean: Annual deep clean of entire property
• Post-construction clean: Removing debris, dust, and materials after building work
• Sparkle clean: Light final clean after EOT or post-construction to remove dust settled after initial clean

EQUIPMENT
• HEPA vacuum: High-efficiency particulate air filter — captures fine dust, allergens
• Steam cleaner: High-temp steam for sanitising — tile grout, ovens, mattresses
• Carpet extractor: Machine that injects hot water and extracts it with dissolved soil
• Floor scrubber: Machine (walk-behind or ride-on) for hard floor scrubbing
• Pressure washer: High-pressure water jet for exterior surfaces
• Microfibre cloths: Trap dust and bacteria without chemicals — colour-coded by area (red=toilet, blue=general, yellow=kitchen, green=bathroom surfaces)
• Squeegee: Window/floor water removal tool

CHEMICALS
• Quaternary ammonium (Quat): Broad-spectrum disinfectant — common in GP cleaners
• Hypochlorite (bleach): Strong disinfectant, anti-mould — dilute to 1,000ppm for general, 10,000ppm for blood/bodily fluids
• pH scale: 0 (acid) → 7 (neutral) → 14 (alkaline) — critical for surface compatibility
• Dwell time: Time chemical must remain on surface to be effective
• PPE: Personal Protective Equipment (gloves, goggles, apron)
• COSHH: Control of Substances Hazardous to Health — UK regulation

BUSINESS TERMS
• Contract cleaning: Fixed-price regular service under contract
• SLA (Service Level Agreement): Defines what is cleaned, how often, to what standard
• Quote: Estimated price for a specific scope of work
• Scope of works: Detailed list of what will be cleaned
• DBS check: Criminal record check — required for staff entering homes/schools
• Public liability insurance: Covers damage to client property during cleaning
• Employer liability: Covers staff injuries
    `.trim(),
  },
]

// ── Helper functions ─────────────────────────────────────────────────────────

async function run() {
  console.log('\n\x1b[1m=== Seeding Industry Knowledge Packs ===\x1b[0m\n')

  // ── Roofing Pack ──────────────────────────────────────────────────────────
  console.log('Creating ROOFING pack...')
  let roofingPack = await prisma.industryKnowledgePack.upsert({
    where: { industry: 'ROOFING' },
    create: { industry: 'ROOFING', name: 'Roofing Industry Knowledge Pack', description: 'GAF products, pricing, insurance claims, inspection guides, and terminology for roofing contractors' },
    update: { name: 'Roofing Industry Knowledge Pack' },
  })
  console.log(`  ✔ Pack: ${roofingPack.id}`)

  for (const doc of ROOFING_DOCS) {
    const existing = await prisma.industryKnowledgeDoc.findFirst({
      where: { packId: roofingPack.id, name: doc.name }
    })
    let docRecord
    if (existing) {
      docRecord = await prisma.industryKnowledgeDoc.update({
        where: { id: existing.id },
        data: { content: doc.content, agentRoles: doc.agentRoles }
      })
      console.log(`  ~ Updated: "${doc.name}"`)
    } else {
      docRecord = await prisma.industryKnowledgeDoc.create({
        data: { packId: roofingPack.id, ...doc }
      })
      console.log(`  + Created: "${doc.name}"`)
    }
  }

  // ── Cleaning Pack ─────────────────────────────────────────────────────────
  console.log('\nCreating CLEANING pack...')
  let cleaningPack = await prisma.industryKnowledgePack.upsert({
    where: { industry: 'CLEANING' },
    create: { industry: 'CLEANING', name: 'Cleaning Industry Knowledge Pack', description: 'Pricing, methods, chemicals, COSHH compliance, and terminology for professional cleaning companies' },
    update: { name: 'Cleaning Industry Knowledge Pack' },
  })
  console.log(`  ✔ Pack: ${cleaningPack.id}`)

  for (const doc of CLEANING_DOCS) {
    const existing = await prisma.industryKnowledgeDoc.findFirst({
      where: { packId: cleaningPack.id, name: doc.name }
    })
    let docRecord
    if (existing) {
      docRecord = await prisma.industryKnowledgeDoc.update({
        where: { id: existing.id },
        data: { content: doc.content, agentRoles: doc.agentRoles }
      })
      console.log(`  ~ Updated: "${doc.name}"`)
    } else {
      docRecord = await prisma.industryKnowledgeDoc.create({
        data: { packId: cleaningPack.id, ...doc }
      })
      console.log(`  + Created: "${doc.name}"`)
    }
  }

  console.log('\n\x1b[32m✔ Knowledge packs seeded successfully\x1b[0m')
  console.log('\nNext step: run the embedder to generate vector embeddings:')
  console.log('  node scripts/embed-industry-knowledge.js\n')
}

run()
  .catch(e => { console.error('\x1b[31m✘ Error:\x1b[0m', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
