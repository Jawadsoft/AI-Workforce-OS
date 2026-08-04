/**
 * Update Field Inspector agents with damage annotation capabilities
 * Run this on production to add annotate_damage tool and update prompts
 * 
 * Usage: node update-field-inspector-prompts.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// New prompt section to add for image annotation
const IMAGE_ANNOTATION_SECTION = `

IMAGE DAMAGE ANNOTATION — MARK DAMAGE AUTOMATICALLY:
🔴 **CRITICAL - YOU MUST CALL annotate_damage WHEN ANALYZING DAMAGE PHOTOS** 🔴

✅ You HAVE access to the annotate_damage tool to automatically mark damage spots on raw inspection photos
✅ **MANDATORY**: When you analyze a raw/unmarked roof or property image that contains visible damage, you MUST call annotate_damage
✅ After identifying damage in an image, IMMEDIATELY call annotate_damage before responding — do not just describe damage in text without marking it visually
✅ **Images persist in conversation memory** — once uploaded, you can reference them in subsequent messages without asking the user to upload again
✅ If user asks to "reanalyze the image" or "take another look", you already have it — analyze it again without asking for re-upload

**Required workflow when user uploads damage photo:**
1. Analyze the image with your vision capabilities
2. Count and identify all damage spots
3. **IMMEDIATELY call annotate_damage** with coordinates for each damage spot you found
4. THEN provide your text analysis with the annotated image URL

**What to pass to annotate_damage:**
- The original image URL (from the uploaded image)
- Array of damage spots with x,y coordinates (0-100, percentage of image width/height)
- Damage type for each spot (hail, wind, missing, structural, general)
- Optional labels (e.g., "Impact #1", "Missing #3")

**The tool returns an annotated image URL with red circles marking each damage spot — you MUST show this to the user**

**When to use annotate_damage:**
- User uploads raw roof photo with visible damage → MANDATORY - call annotate_damage
- User asks to "analyze", "mark", "highlight", "circle", or "identify" damage → MANDATORY - call annotate_damage
- This happens AUTOMATICALLY during analysis — you don't need permission or explicit request to mark damage spots

**How to estimate x,y coordinates:**
- Look at the image and estimate where each damage spot is located as a percentage of the image dimensions
- x=0 is left edge, x=100 is right edge; y=0 is top edge, y=100 is bottom edge
- Example: damage in the center of image → x=50, y=50
- Example: damage in top-right corner → x=80, y=20
- Don't worry about being pixel-perfect — approximate coordinates are fine
`

async function updateFieldInspectors() {
  console.log('🔍 Finding Field Inspector agents...')
  
  // Find all Field Inspector agents
  const inspectors = await prisma.agent.findMany({
    where: {
      OR: [
        { role: { contains: 'Field Inspector', mode: 'insensitive' } },
        { role: { contains: 'Inspector', mode: 'insensitive' } },
        { name: { contains: 'Jared', mode: 'insensitive' } },
      ]
    },
    select: {
      id: true,
      name: true,
      role: true,
      tools: true,
      prompt: true,
      tenantId: true,
    }
  })

  console.log(`Found ${inspectors.length} inspector agent(s)`)

  if (inspectors.length === 0) {
    console.log('❌ No Field Inspector agents found')
    return
  }

  for (const inspector of inspectors) {
    console.log(`\n📝 Updating: ${inspector.name} (${inspector.role})`)
    
    // Check if annotate_damage tool is already present
    const hasAnnotateTool = inspector.tools.includes('annotate_damage')
    const updatedTools = hasAnnotateTool 
      ? inspector.tools 
      : [...inspector.tools, 'annotate_damage']
    
    // Check if prompt already has annotation section
    const hasAnnotationSection = inspector.prompt?.includes('annotate_damage') || 
                                  inspector.prompt?.includes('IMAGE DAMAGE ANNOTATION')
    
    let updatedPrompt = inspector.prompt || ''
    
    if (!hasAnnotationSection) {
      // Find where to insert the annotation section (before DOCUMENT GENERATION if exists)
      const docGenIndex = updatedPrompt.indexOf('DOCUMENT GENERATION')
      if (docGenIndex > -1) {
        updatedPrompt = 
          updatedPrompt.slice(0, docGenIndex) +
          IMAGE_ANNOTATION_SECTION +
          '\n\n' +
          updatedPrompt.slice(docGenIndex)
      } else {
        // If no DOCUMENT GENERATION section, append at the end
        updatedPrompt += IMAGE_ANNOTATION_SECTION
      }
    }

    // Update the agent
    await prisma.agent.update({
      where: { id: inspector.id },
      data: {
        tools: updatedTools,
        prompt: updatedPrompt,
      }
    })

    console.log(`  ✅ Tool added: ${!hasAnnotateTool ? 'YES' : 'Already had it'}`)
    console.log(`  ✅ Prompt updated: ${!hasAnnotationSection ? 'YES' : 'Already had it'}`)
    console.log(`  Tools count: ${updatedTools.length}`)
  }

  console.log(`\n✅ Updated ${inspectors.length} Field Inspector agent(s)`)
  console.log('\n📋 Summary by tenant:')
  
  // Group by tenant
  const byTenant = inspectors.reduce((acc, inspector) => {
    const tid = inspector.tenantId
    if (!acc[tid]) acc[tid] = []
    acc[tid].push(inspector.name)
    return acc
  }, {})

  for (const [tenantId, names] of Object.entries(byTenant)) {
    console.log(`  Tenant ${tenantId}: ${names.join(', ')}`)
  }
}

async function main() {
  console.log('🚀 Starting Field Inspector prompt update...\n')
  
  try {
    await updateFieldInspectors()
    console.log('\n✅ All done! Field Inspectors now have damage annotation capabilities.')
    console.log('\n⚠️  IMPORTANT: Restart your backend server for changes to take effect!')
  } catch (err) {
    console.error('\n❌ Error:', err.message)
    console.error(err.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
