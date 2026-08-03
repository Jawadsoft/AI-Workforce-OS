import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'

export interface HelpOverrideInput {
  title?: string
  category?: string
  audience?: string
  summary?: string
  steps?: string[]
  tips?: string[]
  isCustom?: boolean
}

// Cloudinary/local-disk uploads are namespaced by "tenant" — Help Guide content
// is platform-wide (not tenant-scoped), so we use a fixed pseudo-tenant folder.
const HELP_ASSET_NAMESPACE = 'platform-help-guide'

@Injectable()
export class HelpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * Merged content for the tenant-facing Help Guide: every override row plus
   * every image, grouped by articleId. The frontend layers this on top of the
   * static HELP_ARTICLES array from lib/help-content.ts.
   */
  async getMergedContent() {
    const [overrides, images] = await Promise.all([
      this.prisma.helpArticleOverride.findMany({ orderBy: { updatedAt: 'desc' } }),
      this.prisma.helpArticleImage.findMany({ orderBy: { position: 'asc' } }),
    ])

    const imagesByArticle: Record<string, typeof images> = {}
    for (const img of images) {
      if (!imagesByArticle[img.articleId]) imagesByArticle[img.articleId] = []
      imagesByArticle[img.articleId].push(img)
    }

    return {
      overrides: overrides.reduce((acc: Record<string, any>, o) => {
        acc[o.articleId] = o
        return acc
      }, {}),
      images: imagesByArticle,
    }
  }

  async listOverrides() {
    return this.prisma.helpArticleOverride.findMany({ orderBy: { updatedAt: 'desc' } })
  }

  async listImages(articleId: string) {
    return this.prisma.helpArticleImage.findMany({ where: { articleId }, orderBy: { position: 'asc' } })
  }

  async upsertOverride(articleId: string, dto: HelpOverrideInput, updatedById?: string) {
    const data = {
      title: dto.title ?? null,
      category: dto.category ?? null,
      audience: dto.audience ?? null,
      summary: dto.summary ?? null,
      steps: dto.steps ?? undefined,
      tips: dto.tips ?? undefined,
      isCustom: dto.isCustom ?? false,
      updatedById: updatedById ?? null,
    }
    return this.prisma.helpArticleOverride.upsert({
      where: { articleId },
      create: { articleId, ...data },
      update: data,
    })
  }

  async resetOverride(articleId: string) {
    // Custom (super-admin-authored) articles have no static fallback — delete
    // their images too so nothing orphaned lingers in the Help Guide.
    const existing = await this.prisma.helpArticleOverride.findUnique({ where: { articleId } })
    if (!existing) throw new NotFoundException('No override found for this article')

    if (existing.isCustom) {
      const images = await this.prisma.helpArticleImage.findMany({ where: { articleId } })
      await Promise.all(images.map((img) => this.cloudinary.delete(img.url)))
      await this.prisma.helpArticleImage.deleteMany({ where: { articleId } })
    }
    await this.prisma.helpArticleOverride.delete({ where: { articleId } })
    return { success: true }
  }

  async addImage(articleId: string, file: { buffer: Buffer; mimetype: string; originalname: string }, caption?: string) {
    const filename = this.cloudinary.uniqueFilename(file.originalname)
    const url = await this.cloudinary.upload(HELP_ASSET_NAMESPACE, `help-guide/${articleId}`, filename, file.buffer, file.mimetype, 'image')
    const count = await this.prisma.helpArticleImage.count({ where: { articleId } })
    return this.prisma.helpArticleImage.create({
      data: { articleId, url, caption: caption ?? null, position: count },
    })
  }

  async deleteImage(imageId: string) {
    const image = await this.prisma.helpArticleImage.findUnique({ where: { id: imageId } })
    if (!image) throw new NotFoundException('Image not found')
    await this.cloudinary.delete(image.url)
    await this.prisma.helpArticleImage.delete({ where: { id: imageId } })
    return { success: true }
  }
}
