import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? 'default-encryption-key-32-chars!!'
  return Buffer.from(raw.slice(0, KEY_LENGTH).padEnd(KEY_LENGTH, '0'))
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(text: string): string {
  const [ivHex, encHex] = text.split(':')
  if (!ivHex || !encHex) throw new Error('Invalid encrypted value')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
