import { Injectable, Logger } from '@nestjs/common'
import { v2 as cloudinary } from 'cloudinary'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name)
  private configured = false

  private configure() {
    if (this.configured) return
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })
    this.configured = true
  }

  isEnabled(): boolean {
    return !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    )
  }

  /**
   * Upload a file buffer to Cloudinary or local disk.
   *
   * Cloudinary folder structure:
   *   ai-workforce/tenants/<tenantId>/<category>/<filename>
   *
   * @param tenantId  - tenant owning the file
   * @param category  - 'avatars' | 'knowledge' | 'generated-docs'
   * @param filename  - destination filename (with extension)
   * @param buffer    - file content
   * @param mimetype  - MIME type
   * @param resourceType - 'image' | 'raw' (use 'raw' for PDFs/docs)
   */
  async upload(
    tenantId: string,
    category: string,
    filename: string,
    buffer: Buffer,
    mimetype: string,
    resourceType: 'image' | 'raw' = 'raw',
  ): Promise<string> {
    if (this.isEnabled()) {
      this.configure()
      const folder   = `ai-workforce/tenants/${tenantId}/${category}`
      const publicId = filename.replace(/\.[^.]+$/, '') // Cloudinary manages extension

      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, public_id: publicId, overwrite: true, resource_type: resourceType },
          (err, result) => {
            if (err || !result) {
              this.logger.error(`Cloudinary upload failed: ${err?.message}`)
              return reject(err ?? new Error('Upload failed'))
            }
            resolve(result.secure_url)
          },
        )
        stream.end(buffer)
      })
    }

    // ── Local disk fallback (dev only) ──────────────────────────────
    const localKey  = path.join('tenants', tenantId, category, filename)
    const localPath = path.join(process.cwd(), 'uploads', localKey)
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    fs.writeFileSync(localPath, buffer)
    return `/uploads/${localKey.replace(/\\/g, '/')}`
  }

  /**
   * Delete a previously uploaded file by its stored URL.
   * Non-fatal — errors are logged but not thrown.
   */
  async delete(fileUrl: string): Promise<void> {
    if (!fileUrl) return
    try {
      if (fileUrl.includes('cloudinary.com')) {
        this.configure()
        // Extract public_id: everything after /upload/vXXX/ up to (not including) extension
        const match = fileUrl.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^./?]+)?(?:\?|$)/)
        if (match) await cloudinary.uploader.destroy(match[1], { resource_type: 'raw' })
      } else if (fileUrl.startsWith('/uploads/')) {
        const localPath = path.join(process.cwd(), fileUrl)
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
      }
    } catch (err: any) {
      this.logger.warn(`Failed to delete file ${fileUrl}: ${err.message}`)
    }
  }

  /** Generate a unique filename preserving the original extension */
  uniqueFilename(originalName: string): string {
    const ext = path.extname(originalName).toLowerCase()
    return `${crypto.randomUUID()}${ext}`
  }
}
