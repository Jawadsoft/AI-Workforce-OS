import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { AppModule } from './app.module'
import * as fs from 'fs'
import * as path from 'path'

async function bootstrap() {
  const port = process.env.PORT ?? 3001
  const useHttps = process.env.HTTPS === 'true'

  let httpsOptions: { key: Buffer; cert: Buffer } | undefined
  if (useHttps) {
    const certPath = path.resolve(process.cwd(), '../../certs/cert.pem')
    const keyPath = path.resolve(process.cwd(), '../../certs/key.pem')
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, httpsOptions ? { httpsOptions } : {})

  // Serve uploaded files (avatars, etc.) as static assets
  const uploadsDir = path.join(process.cwd(), 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' })

  app.setGlobalPrefix('api/v1')

  app.enableCors({
    origin: (origin, callback) => {
      // Allow all origins for public widget endpoints (no credentials needed)
      // Allow known origins for authenticated endpoints
      const allowed = [
        'http://localhost:3000',
        'https://localhost:3000',
        'http://192.168.1.55:3000',
        'https://192.168.1.55:3000',
        process.env.FRONTEND_URL ?? 'http://localhost:3000',
      ]
      if (!origin || allowed.includes(origin)) {
        callback(null, true)
      } else {
        // Allow external origins (widget embedded on tenant websites)
        callback(null, true)
      }
    },
    credentials: true,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Workforce OS API')
    .setDescription('Multi-Tenant AI Employee Platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  const protocol = httpsOptions ? 'https' : 'http'
  await app.listen(port, '0.0.0.0')
  console.log(`API running on ${protocol}://localhost:${port}`)
  console.log(`API on network: ${protocol}://192.168.1.55:${port}`)
  console.log(`Swagger docs: ${protocol}://localhost:${port}/api/docs`)
}

bootstrap()
