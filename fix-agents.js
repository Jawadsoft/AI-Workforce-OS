const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TENANT_ID = 'cmpv8kqw40000r5du9348rff3'
const INDUSTRY = 'ROOFING'

// Template IDs to create for ROOFING
const ROOFING_TEMPLATES = [
  'receptionist',
  'sales-assistant',
  'executive-assistant',
  'estimator',
  'inspector',
  'storm-analyst',
  'insurance-assistant',
  'lead-qualification-assistant',
]

async function main() {
  console.log('1. Setting tenant industry to ROOFING...')
  await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: { industry: INDUSTRY },
  })
  console.log('   ✅ Done')

  console.log('\n2. Deactivating all existing agents...')
  const deactivated = await prisma.agent.updateMany({
    where: { tenantId: TENANT_ID },
    data: { status: 'INACTIVE' },
  })
  console.log(`   ✅ Deactivated ${deactivated.count} agents`)

  console.log('\n3. Fetching templates...')
  const templates = await prisma.agentTemplate.findMany({
    where: { id: { in: ROOFING_TEMPLATES } },
  })
  console.log(`   ✅ Found ${templates.length}/${ROOFING_TEMPLATES.length} templates`)

  // Order them correctly
  const ordered = ROOFING_TEMPLATES
    .map(id => templates.find(t => t.id === id))
    .filter(Boolean)

  console.log('\n4. Creating agents one by one...')
  const created = []
  for (const template of ordered) {
    try {
      const agent = await prisma.agent.create({
        data: {
          tenantId: TENANT_ID,
          name: template.name,
          role: template.role,
          industry: INDUSTRY,
          prompt: template.defaultPrompt,
          tools: template.tools,
          avatar: template.avatar ?? null,
          status: 'ACTIVE',
          permissions: ['read_conversations', 'create_tasks'],
          approvalRules: {
            requireApprovalFor: ['crm_update', 'send_email', 'upload_document'],
          },
        },
      })
      created.push(agent)
      console.log(`   ✅ Created: ${agent.name}`)
    } catch (err) {
      console.error(`   ❌ Failed to create ${template.name}: ${err.message}`)
    }
  }

  console.log(`\n✅ Done! Created ${created.length} agents for tenant "${TENANT_ID}"`)
  console.log('\nYour AI team:')
  created.forEach(a => console.log(`  • ${a.name} (${a.role})`))
}

main().catch(console.error).finally(() => prisma.$disconnect())
