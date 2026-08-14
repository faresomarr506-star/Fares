'use strict'

function extFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return 'jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp'
  return 'jpg'
}

async function uploadImage(buffer, filename = '') {
  const ext = filename.split('.').pop() || extFromBuffer(buffer)
  const form = new FormData()
  form.append('files[]', new Blob([buffer]), `image.${ext}`)
  const res = await fetch('https://telegra.ph/upload', { method: 'POST', body: form })
  const data = await res.json()
  const pathValue = Array.isArray(data) ? data[0]?.src : null
  if (!pathValue) throw new Error('Upload failed')
  return pathValue.startsWith('http') ? pathValue : `https://telegra.ph${pathValue}`
}

module.exports = { uploadImage }
