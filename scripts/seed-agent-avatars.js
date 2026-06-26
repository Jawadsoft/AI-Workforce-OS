/**
 * Uploads agent avatar images to S3 (or local disk as fallback)
 * and updates AgentTemplate + Agent records in the DB.
 *
 * Run from workspace root:
 *   node scripts/seed-agent-avatars.js
 */

const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.replace(/#.*/,'').trim().split('=')
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '')
  })
}

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

// ── Cloudinary helpers ───────────────────────────────────────────────────
const CLOUD_NAME   = process.env.CLOUDINARY_CLOUD_NAME ?? ''
const CLOUD_KEY    = process.env.CLOUDINARY_API_KEY ?? ''
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET ?? ''
const USE_CLOUDINARY = CLOUD_NAME.length > 0 && CLOUD_KEY.length > 0 && CLOUD_SECRET.length > 0

// Resolve cloudinary from the API package where it was installed
const cloudinaryPath = path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'cloudinary')

if (USE_CLOUDINARY) {
  const { v2: cloudinary } = require(cloudinaryPath)
  cloudinary.config({ cloud_name: CLOUD_NAME, api_key: CLOUD_KEY, api_secret: CLOUD_SECRET })
}

async function uploadFile(srcPath, destFilename) {
  const buffer = fs.readFileSync(srcPath)

  if (USE_CLOUDINARY) {
    const { v2: cloudinary } = require(cloudinaryPath)
    const publicId = destFilename.replace(/\.[^.]+$/, '')
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'ai-workforce/avatars', public_id: publicId, overwrite: true, resource_type: 'image' },
        (err, result) => {
          if (err || !result) return reject(err ?? new Error('Upload failed'))
          resolve(result.secure_url)
        },
      )
      stream.end(buffer)
    })
  }

  // Local fallback
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  fs.copyFileSync(srcPath, path.join(UPLOADS_DIR, destFilename))
  return `/uploads/avatars/${destFilename}`
}

async function main() {
  console.log(USE_CLOUDINARY ? `☁  Uploading to Cloudinary (${CLOUD_NAME})` : `💾  Saving to local disk (Cloudinary not configured)`)

  for (const entry of AVATAR_MAP) {
    const srcPath = path.join(ASSETS_DIR, entry.src)

    if (!fs.existsSync(srcPath)) {
      console.warn(`⚠  Source not found, skipping: ${entry.src}`)
      continue
    }

    const avatarUrl = await uploadFile(srcPath, entry.dest)
    console.log(`✓  ${entry.dest}  →  ${avatarUrl}`)

    const updatedTemplates = await prisma.agentTemplate.updateMany({
      where: { name: { startsWith: entry.agentName } },
      data:  { avatar: avatarUrl },
    })

    const updatedAgents = await prisma.agent.updateMany({
      where: { name: { startsWith: entry.agentName } },
      data:  { avatar: avatarUrl },
    })

    console.log(`   Templates: ${updatedTemplates.count}  |  Agents: ${updatedAgents.count}`)
  }

  console.log('\n✅  All done!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
