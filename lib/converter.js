'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || stdout || error.message))
      resolve(true)
    })
  })
}

async function toAudio(buffer, ext = 'mp4') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-audio-'))
  const input = path.join(dir, `input.${String(ext || 'mp4').replace(/^\./, '')}`)
  const output = path.join(dir, 'output.mp3')
  fs.writeFileSync(input, buffer)
  try {
    await runFfmpeg(['-y', '-i', input, output])
    return fs.readFileSync(output)
  } catch {
    return buffer
  }
}

module.exports = { toAudio }
