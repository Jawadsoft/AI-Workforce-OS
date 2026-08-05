/**
 * Comprehensive Agent Prompt Verification & Update Script
 * 
 * This script:
 * 1. Checks ALL agents in the database
 * 2. Compares their prompts and tools with expected values
 * 3. Shows what's missing or outdated
 * 4. Optionally updates them to match current code
 * 
 * Usage:
 *   node verify-and-update-agents.js --check     # Just check, don't update
 *   node verify-and-update-agents.js --update    # Check and update
 *   node verify-and-update-agents.js --force     # Force update all agents
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// ============================================================================
// CURRENT EXPECTED CONFIGURATIONS (based on your local code)
// ============================================================================

const ROLE_CONFIGS = {
  'Field Inspector': {
    requiredTools: ['annotate_damage', 'generate_document', 'crm_update'],
    promptSections: [
      'IMAGE DAMAGE ANNOTATION',
      'annotate_damage',
      'CRITICAL — COUNTING IS MANDATORY',
      'Images persist in conversation memory',
      'PHOTO INSPECTION',
    ],
    criticalPhrases: [
      'YOU MUST CALL annotate_damage',
      'MANDATORY',
      'ALWAYS count and quantify',
    ]
  },
  'Social Media': {
    requiredTools: ['post_to_social', 'regenerate_social_image', 'review_to_post'],
    promptSections: [
      'SOCIAL MEDIA IMAGES',
      'branded by default',
    ],
    criticalPhrases: []
  },
  'Lead Qualification': {
    requiredTools: ['fetch_storm_data', 'crm_search_leads', 'handoff_to_agent'],
    promptSections: [],
    criticalPhrases: []
  },
  'Insurance Specialist': {
    requiredTools: ['generate_document'],
    promptSections: [
      'INSURANCE DOCUMENT DETECTION',
      'SUPPLEMENT ANALYSIS',
    ],
    criticalPhrases: []
  },
}

// Tools that should be in ALL agents
const UNIVERSAL_TOOLS = ['ask_user', 'remember_fact', 'forget_fact']

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

function analyzeAgent(agent) {
  const issues = []
  const warnings = []
  const roleKey = Object.keys(ROLE_CONFIGS).find(key => 
    agent.role?.toLowerCase().includes(key.toLowerCase())
  )
  
  const config = roleKey ? ROLE_CONFIGS[roleKey] : null

  // Check if agent has a prompt
  if (!agent.prompt || agent.prompt.trim().length < 100) {
    issues.push('Prompt is missing or too short')
  }

  // Check role-specific requirements
  if (config) {
    // Check required tools
    const missingTools = config.requiredTools.filter(tool => !agent.tools.includes(tool))
    if (missingTools.length > 0) {
      issues.push(`Missing required tools: ${missingTools.join(', ')}`)
    }

    // Check prompt sections
    if (agent.prompt) {
      const missingSections = config.promptSections.filter(section => 
        !agent.prompt.toLowerCase().includes(section.toLowerCase())
      )
      if (missingSections.length > 0) {
        warnings.push(`Missing prompt sections: ${missingSections.join(', ')}`)
      }

      // Check critical phrases
      const missingPhrases = config.criticalPhrases.filter(phrase => 
        !agent.prompt.includes(phrase)
      )
      if (missingPhrases.length > 0) {
        issues.push(`Missing critical phrases: ${missingPhrases.join(', ')}`)
      }
    }
  }

  // Check universal tools
  const missingUniversal = UNIVERSAL_TOOLS.filter(tool => !agent.tools.includes(tool))
  if (missingUniversal.length > 0) {
    warnings.push(`Missing universal tools: ${missingUniversal.join(', ')}`)
  }

  return { roleKey, config, issues, warnings }
}

function generateUpdatePlan(agent, analysis) {
  const updates = {}
  
  if (!analysis.config) return updates

  // Tools to add
  const toolsToAdd = [
    ...analysis.config.requiredTools,
    ...UNIVERSAL_TOOLS
  ].filter(tool => !agent.tools.includes(tool))

  if (toolsToAdd.length > 0) {
    updates.tools = [...agent.tools, ...toolsToAdd]
  }

  // Prompt updates
  if (analysis.roleKey === 'Field Inspector' && agent.prompt) {
    // Check if needs annotation section
    if (!agent.prompt.includes('IMAGE DAMAGE ANNOTATION')) {
      updates.needsAnnotationSection = true
    }
    // Check if needs counting mandate
    if (!agent.prompt.includes('CRITICAL — COUNTING IS MANDATORY')) {
      updates.needsCountingSection = true
    }
    // Check if needs image persistence info
    if (!agent.prompt.includes('Images persist in conversation memory')) {
      updates.needsImagePersistence = true
    }
  }

  return updates
}

// ============================================================================
// PROMPT UPDATE TEMPLATES
// ============================================================================

const PROMPT_ADDITIONS = {
  imageAnnotation: `

IMAGE DAMAGE ANNOTATION — MARK DAMAGE AUTOMATICALLY:
🔴 **CRITICAL - YOU MUST CALL annotate_damage WHEN ANALYZING DAMAGE PHOTOS** 🔴

✅ You HAVE access to the annotate_damage tool to automatically mark damage spots on raw inspection photos
✅ **MANDATORY**: When you analyze a raw/unmarked roof or property image that contains visible damage, you MUST call annotate_damage
✅ **Images persist in conversation memory** — once uploaded, you can reference them in subsequent messages without asking the user to upload again
✅ If user asks to "reanalyze the image" or "take another look", you already have it — analyze it again without asking for re-upload

**Required workflow when user uploads damage photo:**
1. Analyze the image with your vision capabilities
2. Count and identify all damage spots
3. **IMMEDIATELY call annotate_damage** with coordinates for each damage spot you found
4. THEN provide your text analysis with the annotated image URL

**When to use annotate_damage:**
- User uploads raw roof photo with visible damage → MANDATORY - call annotate_damage
- User asks to "analyze", "mark", "highlight", "circle", or "identify" damage → MANDATORY - call annotate_damage
- This happens AUTOMATICALLY during analysis — you don't need permission or explicit request
`,

  countingMandate: `

**CRITICAL — COUNTING IS MANDATORY:**
When you see hail impacts, wind damage, or missing shingles in a photo, you MUST provide an actual count or range (e.g., "~12-15 hail impacts", "8 missing shingles visible", "approximately 20 impact marks in visible area").
❌ NEVER use vague terms like "multiple", "several", "numerous" without a count
✅ ALWAYS quantify: "~15-20 visible hail impacts", "approximately 10-12 impact marks", "at least 18 visible hits"
`,

  imagePersistence: `
✅ **Images persist in conversation memory** — once uploaded, you can reference them in subsequent messages
✅ If user asks to "look at the image again" or "reanalyze", you already have it — analyze it without asking for re-upload
❌ NEVER say "I cannot see images" or "Please upload the image" if one has already been uploaded in this conversation
`,
}

// ============================================================================
// MAIN VERIFICATION & UPDATE LOGIC
// ============================================================================

async function verifyAndUpdateAgents(options = {}) {
  const { checkOnly = false, forceUpdate = false } = options

  console.log('🔍 Fetching all agents from database...\n')
  
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      name: true,
      role: true,
      tools: true,
      prompt: true,
      tenantId: true,
      status: true,
    },
    orderBy: [
      { tenantId: 'asc' },
      { role: 'asc' },
      { name: 'asc' },
    ]
  })

  console.log(`Found ${agents.length} total agents\n`)
  console.log('=' .repeat(80))

  const results = {
    total: agents.length,
    healthy: 0,
    needsUpdate: 0,
    updated: 0,
    failed: 0,
    byTenant: {},
    byRole: {},
  }

  for (const agent of agents) {
    const analysis = analyzeAgent(agent)
    const updatePlan = generateUpdatePlan(agent, analysis)
    const hasIssues = analysis.issues.length > 0
    const hasWarnings = analysis.warnings.length > 0
    const needsUpdate = hasIssues || Object.keys(updatePlan).length > 0

    // Track stats
    if (!results.byTenant[agent.tenantId]) results.byTenant[agent.tenantId] = 0
    if (!results.byRole[agent.role]) results.byRole[agent.role] = 0
    results.byRole[agent.role]++

    if (!needsUpdate && !hasWarnings) {
      results.healthy++
      continue // Skip healthy agents in output
    }

    results.needsUpdate++
    results.byTenant[agent.tenantId]++

    // Print agent status
    console.log(`\n📋 ${agent.name} — ${agent.role}`)
    console.log(`   Tenant: ${agent.tenantId} | Status: ${agent.status}`)
    console.log(`   Tools: ${agent.tools.length} | Prompt: ${agent.prompt ? `${agent.prompt.length} chars` : 'MISSING'}`)

    if (analysis.issues.length > 0) {
      console.log(`   ❌ Issues:`)
      analysis.issues.forEach(issue => console.log(`      - ${issue}`))
    }

    if (analysis.warnings.length > 0) {
      console.log(`   ⚠️  Warnings:`)
      analysis.warnings.forEach(warning => console.log(`      - ${warning}`))
    }

    if (Object.keys(updatePlan).length > 0) {
      console.log(`   📝 Update Plan:`)
      if (updatePlan.tools) {
        const newTools = updatePlan.tools.filter(t => !agent.tools.includes(t))
        console.log(`      + Add tools: ${newTools.join(', ')}`)
      }
      if (updatePlan.needsAnnotationSection) console.log(`      + Add IMAGE DAMAGE ANNOTATION section`)
      if (updatePlan.needsCountingSection) console.log(`      + Add counting mandate`)
      if (updatePlan.needsImagePersistence) console.log(`      + Add image persistence info`)
    }

    // Perform update if requested
    if (!checkOnly && needsUpdate && (forceUpdate || hasIssues)) {
      try {
        const data = {}
        
        // Update tools
        if (updatePlan.tools) {
          data.tools = updatePlan.tools
        }

        // Update prompt
        if (updatePlan.needsAnnotationSection || updatePlan.needsCountingSection || updatePlan.needsImagePersistence) {
          let updatedPrompt = agent.prompt || ''
          
          // Find insertion point (before DOCUMENT GENERATION if exists)
          const docGenIndex = updatedPrompt.indexOf('DOCUMENT GENERATION')
          const insertIndex = docGenIndex > -1 ? docGenIndex : updatedPrompt.length
          
          const additions = []
          if (updatePlan.needsAnnotationSection) additions.push(PROMPT_ADDITIONS.imageAnnotation)
          if (updatePlan.needsCountingSection) additions.push(PROMPT_ADDITIONS.countingMandate)
          if (updatePlan.needsImagePersistence) additions.push(PROMPT_ADDITIONS.imagePersistence)
          
          updatedPrompt = 
            updatedPrompt.slice(0, insertIndex) +
            additions.join('\n') +
            '\n\n' +
            updatedPrompt.slice(insertIndex)
          
          data.prompt = updatedPrompt
        }

        if (Object.keys(data).length > 0) {
          await prisma.agent.update({
            where: { id: agent.id },
            data,
          })
          console.log(`   ✅ Updated successfully`)
          results.updated++
        }
      } catch (err) {
        console.log(`   ❌ Update failed: ${err.message}`)
        results.failed++
      }
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80))
  console.log('\n📊 SUMMARY\n')
  console.log(`Total agents: ${results.total}`)
  console.log(`✅ Healthy: ${results.healthy}`)
  console.log(`⚠️  Need updates: ${results.needsUpdate}`)
  if (!checkOnly) {
    console.log(`✅ Updated: ${results.updated}`)
    console.log(`❌ Failed: ${results.failed}`)
  }

  console.log('\n📈 By Role:')
  Object.entries(results.byRole)
    .sort((a, b) => b[1] - a[1])
    .forEach(([role, count]) => console.log(`   ${role}: ${count}`))

  console.log('\n🏢 By Tenant:')
  Object.entries(results.byTenant)
    .forEach(([tenant, count]) => console.log(`   ${tenant}: ${count} need(s) update`))

  return results
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const forceUpdate = args.includes('--force')
  const showHelp = args.includes('--help') || args.includes('-h')

  if (showHelp) {
    console.log(`
Agent Verification & Update Tool

Usage:
  node verify-and-update-agents.js [options]

Options:
  --check     Check agents without making changes (dry run)
  --update    Check and update agents that have issues
  --force     Force update ALL agents that need updates (including warnings)
  --help, -h  Show this help message

Examples:
  node verify-and-update-agents.js --check           # Just see what's wrong
  node verify-and-update-agents.js --update          # Fix critical issues
  node verify-and-update-agents.js --force           # Update everything
`)
    process.exit(0)
  }

  const mode = checkOnly ? 'CHECK ONLY' : forceUpdate ? 'FORCE UPDATE' : 'UPDATE'
  console.log(`\n🚀 Starting agent verification (${mode} mode)\n`)

  try {
    const results = await verifyAndUpdateAgents({ 
      checkOnly, 
      forceUpdate 
    })

    if (checkOnly) {
      console.log('\n💡 Run with --update to apply fixes for critical issues')
      console.log('💡 Run with --force to update all agents including warnings')
    } else if (results.updated > 0) {
      console.log('\n⚠️  IMPORTANT: Restart your backend server for changes to take effect!')
    }

    console.log('\n✅ Done!\n')
  } catch (err) {
    console.error('\n❌ Error:', err.message)
    console.error(err.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
