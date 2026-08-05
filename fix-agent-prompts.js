/**
 * Fix Agent Prompt Issues
 * Addresses HIGH and MEDIUM priority issues from audit:
 * - Hardcoded colleague names
 * - Hardcoded prices
 * - Hardcoded locations
 * - Roofing-specific terminology
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const fixes = {
  // Fix hardcoded colleague names (HIGH priority)
  names: [
    {
      find: /I'm connecting you with Cris/gi,
      replace: "I'm connecting you with our estimator",
    },
    {
      find: /Cris will handle this/gi,
      replace: 'Our estimator will handle this',
    },
    {
      find: /connecting you with Cris/gi,
      replace: 'connecting you with our estimator',
    },
    {
      find: /Jared is notified/gi,
      replace: 'the operations team is notified',
    },
    {
      find: /\bJared\b/g,
      replace: 'the operations manager',
    },
    {
      find: /I'm Jake/gi,
      replace: "I'm your handyman services coordinator",
    },
  ],

  // Fix hardcoded prices (HIGH priority)
  prices: [
    {
      find: /Low \(< \$2,000 recoverable\) \| Medium \(\$2,000–\$8,000\) \| High \(> \$8,000\)/gi,
      replace: 'Refer to the pricing classification guidelines in your knowledge base',
    },
    {
      find: /Low \(< \$2,000\) \| Medium \(\$2,000–\$8,000\) \| High \(> \$8,000\)/gi,
      replace: 'Refer to the pricing classification guidelines in your knowledge base',
    },
    {
      find: /\$2,000–\$8,000/gi,
      replace: '[pricing guidelines - refer to knowledge base]',
    },
  ],

  // Fix hardcoded locations (MEDIUM priority)
  locations: [
    {
      find: /Texas: Dallas \(752xx\), Fort Worth \(761xx\), Houston \(770xx\), San Antonio \(782xx\), Austin \(7\d{2}xx\)/gi,
      replace: 'Our active service areas (refer to knowledge base for current ZIP codes)',
    },
    {
      find: /Dallas \(752xx\)/gi,
      replace: 'our service areas',
    },
    {
      find: /Fort Worth \(761xx\)/gi,
      replace: 'our service areas',
    },
    {
      find: /Houston \(770xx\)/gi,
      replace: 'our service areas',
    },
  ],

  // Fix roofing-specific terminology (MEDIUM priority)
  terminology: [
    {
      find: /Review Kevin's supplement analysis/gi,
      replace: "Review the insurance specialist's analysis",
    },
    {
      find: /prepare a professional Supplement Analysis Report/gi,
      replace: 'prepare a professional analysis report',
    },
    {
      find: /Generate formal supplement/gi,
      replace: 'Generate formal documentation',
    },
    {
      find: /prepare a supplement/gi,
      replace: 'prepare additional documentation',
    },
    {
      find: /the adjuster's estimate/gi,
      replace: "the insurance company's estimate",
    },
    {
      find: /insurance adjuster/gi,
      replace: 'insurance representative',
    },
    {
      find: /Drip edge required by local code/gi,
      replace: 'Required local code compliance items',
    },
    {
      find: /supplement requests/gi,
      replace: 'additional documentation requests',
    },
  ],

  // Fix weak filler phrases (LOW priority)
  fillers: [
    {
      find: /Someone will reach out to you/gi,
      replace: 'Our team will contact you within 24 hours',
    },
  ],
}

async function fixAgentPrompts() {
  console.log('🔧 Starting Agent Prompt Fixes...\n')

  try {
    // Get all agents
    const agents = await prisma.agent.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        prompt: true,
        tenant: {
          select: { name: true },
        },
      },
    })

    console.log(`Found ${agents.length} agents to process\n`)

    let totalChanges = 0
    const changeLog = []

    for (const agent of agents) {
      let updatedPrompt = agent.prompt
      let agentChanges = 0

      // Apply all fixes
      for (const [category, replacements] of Object.entries(fixes)) {
        for (const { find, replace } of replacements) {
          const before = updatedPrompt
          updatedPrompt = updatedPrompt.replace(find, replace)

          if (before !== updatedPrompt) {
            agentChanges++
            totalChanges++
          }
        }
      }

      // Update agent if changes were made
      if (agentChanges > 0) {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { prompt: updatedPrompt },
        })

        const log = {
          tenant: agent.tenant.name,
          agent: `${agent.name} (${agent.role})`,
          changes: agentChanges,
        }

        changeLog.push(log)

        console.log(
          `✅ ${agent.tenant.name} → ${agent.name}: ${agentChanges} fixes applied`
        )
      }
    }

    console.log('\n' + '─'.repeat(60))
    console.log('Summary:')
    console.log(`  Total agents processed: ${agents.length}`)
    console.log(`  Total agents updated: ${changeLog.length}`)
    console.log(`  Total fixes applied: ${totalChanges}`)
    console.log('─'.repeat(60))

    if (changeLog.length > 0) {
      console.log('\nDetailed Changes:')
      for (const log of changeLog) {
        console.log(`  • ${log.tenant} → ${log.agent}: ${log.changes} fixes`)
      }
    }

    console.log('\n✅ All fixes applied successfully!')
    console.log('\n⚠️  NEXT STEPS:')
    console.log('1. Run the audit again: node scripts/audit-agent-prompts')
    console.log('2. Review remaining issues (if any)')
    console.log('3. Test agents to ensure they work correctly')
    console.log('4. Deploy to production\n')
  } catch (error) {
    console.error('❌ Error fixing agent prompts:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the fixes
fixAgentPrompts()
