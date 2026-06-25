/**
 * Copies agent avatar images into apps/api/uploads/avatars/
 * and updates AgentTemplate + Agent records in the DB.
 *
 * Run from workspace root:
 *   node scripts/seed-agent-avatars.js
 */

const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

const ASSETS_DIR = [
  'C:\\Users\\Syed\\.cursor\\projects',
  'c-Users-Syed-Documents-GitHub-DealerIQ-AI-Workforce-OS',
  'assets',
].reduce((a, b) => path.join(a, b))

const UPLOADS_DIR = path.join(__dirname, '..', 'apps', 'api', 'uploads', 'avatars')

const PFX = 'c__Users_Syed_AppData_Roaming_Cursor_User_workspaceStorage_56982b78113353e5aa20b452a97fd465_images_'

// Map: first word of agent name → source image filename (partial match is fine)
const AVATAR_MAP = [
  { agentName: 'Jared',   src: `${PFX}Jared-78cbfeca-3b15-4724-ba45-09c121714988.png`,  dest: 'jared.png'   },
  { agentName: 'Kevin',   src: `${PFX}Kevin-7f2ab694-e690-43e2-bcfe-017bd26d9f37.png`,  dest: 'kevin.png'   },
  { agentName: 'Leo',     src: `${PFX}Leo-003367f0-a286-4c04-bb67-163ae460a3cb.png`,    dest: 'leo.png'     },
  { agentName: 'Jackie',  src: `${PFX}Jackie-6603c504-366f-4f48-ad63-112826911497.png`, dest: 'jackie.png'  },
  { agentName: 'Rosier',  src: `${PFX}Rosier-a4d12e8b-9e2b-476c-a5ed-59f81c56ff50.png`,dest: 'rosier.png'  },
  { agentName: 'Will',    src: `${PFX}Will-347b93c7-53e1-485e-a8bd-79e06d99d8a0.png`,   dest: 'will.png'    },
  { agentName: 'Arturo',  src: `${PFX}Arturo-2ac7f1f7-3e7f-40a3-a167-cbefa3de9d8f.png`,dest: 'arturo.png'  },
  { agentName: 'Charlie', src: `${PFX}Charlie-d6915975-d75d-4758-ba0b-4ec819da9980.png`,dest: 'charlie.png' },
  // Image filename says "Chris" but the agent is "Cris"
  { agentName: 'Cris',    src: `${PFX}Chris-b2d7820f-3486-45cb-948c-d819a9cf5355.png`,  dest: 'cris.png'    },
  { agentName: 'Eric',    src: `${PFX}Eric-a91688b1-3833-4067-ac01-9a900150fa16.png`,   dest: 'eric.png'    },
  { agentName: 'Hanna',   src: `${PFX}Hanna-423a94fa-81b9-457d-87fa-344cab1454ac.png`,  dest: 'hanna.png'   },
  // Nora uses the Jackie image (same role — Customer Intake Specialist)
  { agentName: 'Nora',    src: `${PFX}Jackie-6603c504-366f-4f48-ad63-112826911497.png`, dest: 'nora.png'    },
]

async function main() {
  // 1 — ensure uploads dir exists
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })

  for (const entry of AVATAR_MAP) {
    const srcPath  = path.join(ASSETS_DIR, entry.src)
    const destPath = path.join(UPLOADS_DIR, entry.dest)
    const avatarUrl = `/uploads/avatars/${entry.dest}`

    // Copy image
    if (!fs.existsSync(srcPath)) {
      console.warn(`⚠  Source not found, skipping: ${entry.src}`)
      continue
    }
    fs.copyFileSync(srcPath, destPath)
    console.log(`✓  Copied  ${entry.dest}`)

    // Update AgentTemplate rows whose name starts with this agent name
    const updatedTemplates = await prisma.agentTemplate.updateMany({
      where: { name: { startsWith: entry.agentName } },
      data:  { avatar: avatarUrl },
    })

    // Update Agent rows whose name starts with this agent name
    const updatedAgents = await prisma.agent.updateMany({
      where: { name: { startsWith: entry.agentName } },
      data:  { avatar: avatarUrl },
    })

    console.log(`   Templates updated: ${updatedTemplates.count}  |  Agents updated: ${updatedAgents.count}`)
  }

  console.log('\n✅  All done!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
