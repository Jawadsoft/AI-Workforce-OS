import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { v2 as cloudinary } from 'cloudinary'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')
    return agent
  }

  create(tenantId: string, data: {
    name: string
    role: string
    industry: string
    prompt: string
    tools?: string[]
    permissions?: string[]
    avatar?: string
    approvalRules?: any
  }) {
    return this.prisma.agent.create({
      data: {
        tenantId,
        name: data.name,
        role: data.role,
        industry: data.industry as any,
        prompt: data.prompt,
        tools: [...new Set([...(data.tools ?? []), 'create_ticket', 'update_ticket', 'get_my_tickets'])],
        permissions: data.permissions ?? [],
        avatar: data.avatar,
        approvalRules: data.approvalRules ?? {},
        status: 'ACTIVE',
      },
    })
  }

  update(tenantId: string, id: string, data: Partial<{
    name: string
    role: string
    prompt: string
    tools: string[]
    permissions: string[]
    status: string
    avatar: string
    approvalRules: any
  }>) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: data as any,
    })
  }

  activate(tenantId: string, id: string) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: { status: 'ACTIVE' },
    })
  }

  deactivate(tenantId: string, id: string) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: { status: 'INACTIVE' },
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: { status: 'INACTIVE' },
    })
  }

  getTemplates() {
    return this.prisma.agentTemplate.findMany({
      where: { isPublic: true },
      orderBy: { name: 'asc' },
    })
  }

  async installTemplate(tenantId: string, templateId: string) {
    const [template, tenant] = await Promise.all([
      this.prisma.agentTemplate.findUnique({ where: { id: templateId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } }),
    ])
    if (!template) throw new NotFoundException('Template not found')

    // Return existing active agent if already installed — prevents duplicates
    const existing = await this.prisma.agent.findFirst({
      where: { tenantId, templateId },
    })
    if (existing) {
      // Re-activate if it was deactivated
      if (existing.status !== 'ACTIVE') {
        return this.prisma.agent.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
        })
      }
      return existing
    }

    // Use the tenant's own industry so RAG, CRM defaults, and brain context
    // all align correctly — fall back to the template's first industry or OTHER
    const industry = (tenant?.industry ?? template.industries[0] ?? 'OTHER') as any

    return this.prisma.agent.create({
      data: {
        tenantId,
        name: template.name,
        role: template.role,
        industry,
        prompt: template.defaultPrompt,
        tools: template.tools,
        status: 'ACTIVE',
        permissions: ['read_conversations', 'create_tasks'],
        approvalRules: { requireApprovalFor: ['crm_update', 'send_email'] },
        templateId: template.id,
      },
    })
  }

  async uploadAvatar(tenantId: string, agentId: string, file: Express.Multer.File) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')
    if (!file) throw new BadRequestException('No file provided')

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    const filename = `${agentId}-${crypto.randomBytes(6).toString('hex')}${ext}`
    const avatarUrl = await this.storeFile(tenantId, filename, file.buffer, file.mimetype)

    // Clean up previous avatar
    if (agent.avatar) await this.deleteFile(agent.avatar)

    return this.prisma.agent.update({
      where: { id: agentId },
      data: { avatar: avatarUrl },
    })
  }

  // ── Storage helpers: Cloudinary in production, local disk in dev ────

  private useCloudinary(): boolean {
    return !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    )
  }

  private configureCloudinary() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })
  }

  private async storeFile(tenantId: string, filename: string, buffer: Buffer, mimetype: string): Promise<string> {
    if (this.useCloudinary()) {
      this.configureCloudinary()
      // Each tenant gets its own Cloudinary folder: ai-workforce/tenants/<tenantId>/avatars
      const folder = `ai-workforce/tenants/${tenantId}/avatars`
      const publicId = filename.replace(/\.[^.]+$/, '') // Cloudinary manages the extension
      return new Promise((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream(
          { folder, public_id: publicId, overwrite: true, resource_type: 'image' },
          (err, result) => {
            if (err || !result) return reject(err ?? new Error('Cloudinary upload failed'))
            resolve(result.secure_url)
          },
        )
        upload.end(buffer)
      })
    }

    // Local disk fallback for development: uploads/tenants/<tenantId>/avatars/<filename>
    const localKey = path.join('tenants', tenantId, 'avatars', filename)
    const localPath = path.join(process.cwd(), 'uploads', localKey)
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    fs.writeFileSync(localPath, buffer)
    return `/uploads/${localKey.replace(/\\/g, '/')}`
  }

  private async deleteFile(avatarUrl: string): Promise<void> {
    try {
      if (avatarUrl.includes('cloudinary.com')) {
        this.configureCloudinary()
        // Extract public_id from URL: .../upload/v123/ai-workforce/avatars/filename.jpg
        const match = avatarUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/)
        if (match) await cloudinary.uploader.destroy(match[1])
      } else if (avatarUrl.startsWith('/uploads/')) {
        const localPath = path.join(process.cwd(), avatarUrl)
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
      }
    } catch {
      // Non-fatal — cleanup failure should not block the new upload
    }
  }

  async getCRMAccess(tenantId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')
    return this.prisma.agentCRMAccess.findMany({
      where: { agentId },
      include: { connection: { select: { id: true, name: true, provider: true, isActive: true } } },
    })
  }
}
