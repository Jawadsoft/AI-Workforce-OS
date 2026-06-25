const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '../.env')

function parseValue(value) {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1)
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)
  }

  return trimmed.replace(/\s+#.*$/, '')
}

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (!m) return

    const key = m[1].trim()
    if (process.env[key] !== undefined) return

    process.env[key] = parseValue(m[2])
  })
}

module.exports = { envPath }
