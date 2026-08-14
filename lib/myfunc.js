'use strict'

async function fetchBuffer(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

module.exports = { fetchBuffer }
