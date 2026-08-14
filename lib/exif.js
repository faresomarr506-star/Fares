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

async function writeExifImg(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-exif-img-'))
  const input = path.join(dir, 'input.png')
  const output = path.join(dir, 'output.webp')
  fs.writeFileSync(input, buffer)
  await runFfmpeg(['-y', '-i', input, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000', '-c:v', 'libwebp', '-preset', 'default', '-loop', '0', '-vsync', '0', '-pix_fmt', 'yuva420p', output])
  return output
}

async function writeExifVid(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-exif-vid-'))
  const input = path.join(dir, 'input.mp4')
  const output = path.join(dir, 'output.webp')
  fs.writeFileSync(input, buffer)
  await runFfmpeg(['-y', '-i', input, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000', '-c:v', 'libwebp', '-preset', 'default', '-loop', '0', '-vsync', '0', '-pix_fmt', 'yuva420p', output])
  return output
}

module.exports = { writeExifImg, writeExifVid }
