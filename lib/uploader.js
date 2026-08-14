'use strict'

const fs = require('fs')
const path = require('path')

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.ogg') return 'audio/ogg'
  return 'application/octet-stream'
}

async function TelegraPh(filePath) {
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('files[]', new Blob([buffer], { type: contentTypeFor(filePath) }), path.basename(filePath))
  const res = await fetch('https://telegra.ph/upload', { method: 'POST', body: form })
  const data = await res.json()
  const src = Array.isArray(data) ? data[0]?.src : null
  if (!src) throw new Error('Telegraph upload failed')
  return src.startsWith('http') ? src : `https://telegra.ph${src}`
}

async function UploadFileUgu(filePath) {
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('files[]', new Blob([buffer], { type: contentTypeFor(filePath) }), path.basename(filePath))
  const res = await fetch('https://uguu.se/upload.php', { method: 'POST', body: form })
  const data = await res.json().catch(() => null)
  const files = data?.files || []
  const url = files[0]?.url || files[0]?.src || data?.url
  if (!url) throw new Error('UGUU upload failed')
  return { url }
}

module.exports = { UploadFileUgu, TelegraPh }
