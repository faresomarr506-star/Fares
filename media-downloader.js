const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { Readable } = require('stream')
const { spawnSync } = require('child_process')
const YTDlpWrap = require('yt-dlp-wrap').default
const config = require('./config')

const BIN_DIR = path.join(__dirname, 'bin')
const DEFAULT_BINARY_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
const DEFAULT_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/135.0 Safari/537.36'

const SOURCE_PREFIX = String(config.TIKTOK_SOURCE_PREFIX || 'tiktokio.com').trim() || 'tiktokio.com'
const SOURCE_SITE = String(config.TIKTOK_SOURCE_SITE || 'https://tiktokio.com/').trim() || 'https://tiktokio.com/'
const SOURCE_API =
  String(config.TIKTOK_SOURCE_API || 'https://tiktokio.com/api/v1/tk/html').trim() ||
  'https://tiktokio.com/api/v1/tk/html'
const INSTAGRAM_APP_ID = String(config.INSTAGRAM_APP_ID || '936619743392459').trim() || '936619743392459'
const REQUEST_TIMEOUT_MS = Math.max(10000, Number(config.MEDIA_REQUEST_TIMEOUT_MS || 25000))
const FETCH_CACHE_TTL_MS = Math.max(60000, Number(config.MEDIA_FETCH_CACHE_TTL_MS || 900000))
const WARMUP_INTERVAL_MS = Math.max(60000, Number(config.MEDIA_WARMUP_INTERVAL_MS || 900000))

const SUPPORTED_PATTERNS = {
  tiktok: [
    /https?:\/\/(?:www\.)?tiktok\.com\/[\w\-./?=&%]+/gi,
    /https?:\/\/vm\.tiktok\.com\/[\w\-./?=&%]+/gi,
    /https?:\/\/vt\.tiktok\.com\/[\w\-./?=&%]+/gi,
    /https?:\/\/m\.tiktok\.com\/[\w\-./?=&%]+/gi,
  ],
  instagram: [
    /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w\-.]+[\w\-./?=&%]*/gi,
  ],
}

const fetchCache = new Map()
let binaryReadyPromise = null
let clientPromise = null
let warmupPromise = null
let lastWarmupAt = 0

function cleanupUrl(url) {
  return String(url || '').trim().replace(/[)>\]}'",]+$/g, '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripHtml(value) {
  return normalizeText(decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')))
}

function safeUrl(candidate, baseUrl = SOURCE_SITE) {
  const raw = String(candidate || '').trim()
  if (!raw) return ''
  try {
    if (raw.startsWith('//')) return `https:${raw}`
    return new URL(raw, baseUrl).toString()
  } catch {
    return raw
  }
}

function canonicalInstagramUrl(url) {
  const raw = cleanupUrl(url)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    const normalizedPath = `${parsed.pathname.replace(/\/+$/, '')}/`
    parsed.pathname = normalizedPath
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return raw
  }
}

function detectPlatform(url) {
  const value = cleanupUrl(url).toLowerCase()
  if (/https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|m\.tiktok\.com)\//.test(value)) return 'tiktok'
  if (/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\//.test(value)) return 'instagram'
  return null
}

function extractSupportedSocialUrls(text) {
  const source = String(text || '')
  const matches = []
  for (const patternList of Object.values(SUPPORTED_PATTERNS)) {
    for (const pattern of patternList) {
      const found = source.match(pattern) || []
      for (const item of found) matches.push(cleanupUrl(item))
    }
  }
  return Array.from(new Set(matches.filter((item) => detectPlatform(item))))
}

function extractFirstSupportedUrl(text, platformHint = null) {
  const urls = extractSupportedSocialUrls(text)
  if (!platformHint) return urls[0] || null
  return urls.find((item) => detectPlatform(item) === platformHint) || null
}

function buildRequestHeaders(url, extraHeaders = {}) {
  const lowered = String(url || '').toLowerCase()
  const headers = {
    'User-Agent': DEFAULT_BROWSER_UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Connection: 'keep-alive',
  }

  if (lowered.includes('instagram.com') || lowered.includes('cdninstagram.com') || lowered.includes('fbcdn.net')) {
    headers.Referer = 'https://www.instagram.com/'
    headers.Origin = 'https://www.instagram.com'
    headers['Sec-Fetch-Dest'] = 'video'
    headers['Sec-Fetch-Mode'] = 'no-cors'
    headers['Sec-Fetch-Site'] = 'cross-site'
    const cookieHeader = buildInstagramCookieHeader()
    if (cookieHeader) headers.Cookie = cookieHeader
  } else if (lowered.includes('tiktokio.com')) {
    headers.Referer = SOURCE_SITE
    headers.Origin = SOURCE_SITE.replace(/\/+$/, '')
  }

  return { ...headers, ...extraHeaders }
}

function buildInstagramHeaders(url, extraHeaders = {}) {
  return buildRequestHeaders(url, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'X-IG-App-ID': INSTAGRAM_APP_ID,
    'X-ASBD-ID': '129477',
    ...extraHeaders,
  })
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request_timeout')), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { signal, dispose } = createAbortSignal(timeoutMs)
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal,
    })
  } finally {
    dispose()
  }
}

async function fetchText(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, options, timeoutMs)
  const text = await response.text()
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 220)}`)
    error.status = response.status
    throw error
  }
  return { response, text }
}

function getCachedResult(key) {
  const cached = fetchCache.get(key)
  if (!cached) return null
  if (Date.now() - Number(cached.savedAt || 0) > FETCH_CACHE_TTL_MS) {
    fetchCache.delete(key)
    return null
  }
  return cached.value || null
}

function setCachedResult(key, value) {
  fetchCache.set(key, { savedAt: Date.now(), value })
  for (const [cacheKey, entry] of fetchCache.entries()) {
    if (Date.now() - Number(entry.savedAt || 0) > FETCH_CACHE_TTL_MS) fetchCache.delete(cacheKey)
  }
}

function canExecuteBinary(binaryPath) {
  try {
    const result = spawnSync(binaryPath, ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 15000 })
    return result.status === 0
  } catch {
    return false
  }
}

async function ensureBinaryPath() {
  if (binaryReadyPromise) return binaryReadyPromise
  binaryReadyPromise = (async () => {
    const envBinary = String(config.YT_DLP_BINARY_PATH || '').trim()
    if (envBinary && canExecuteBinary(envBinary)) return envBinary
    if (canExecuteBinary(DEFAULT_BINARY_PATH)) return DEFAULT_BINARY_PATH
    if (canExecuteBinary('yt-dlp')) return 'yt-dlp'

    ensureDirectory(BIN_DIR)
    await YTDlpWrap.downloadFromGithub(DEFAULT_BINARY_PATH)
    try {
      fs.chmodSync(DEFAULT_BINARY_PATH, 0o755)
    } catch {}
    if (!canExecuteBinary(DEFAULT_BINARY_PATH)) {
      throw new Error('تعذر تجهيز yt-dlp على الخادم')
    }
    return DEFAULT_BINARY_PATH
  })().catch((error) => {
    binaryReadyPromise = null
    throw error
  })
  return binaryReadyPromise
}

async function getClient() {
  if (clientPromise) return clientPromise
  clientPromise = ensureBinaryPath()
    .then((binaryPath) => new YTDlpWrap(binaryPath))
    .catch((error) => {
      clientPromise = null
      throw error
    })
  return clientPromise
}

function buildOutputTemplate(platform) {
  const token = `${platform}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  return path.join(config.MEDIA_DOWNLOAD_DIR, `${token}.%(ext)s`)
}

function pickFinalFileFromStdout(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[lines.length - 1] || ''
}

function parseCookieHeader(cookieHeader) {
  const parsed = {}
  for (const part of String(cookieHeader || '').split(';')) {
    if (!part.includes('=')) continue
    const [name, ...rest] = part.split('=')
    const key = String(name || '').trim()
    const value = rest.join('=').trim()
    if (key && value) parsed[key] = value
  }
  return parsed
}

function readInstagramCookieFile(cookieFile) {
  const filePath = String(cookieFile || '').trim()
  if (!filePath || !fs.existsSync(filePath)) return {}
  const text = fs.readFileSync(filePath, 'utf8')
  if (!text.includes('\t') && text.includes('sessionid=')) return parseCookieHeader(text)

  const parsed = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split('\t')
    if (parts.length < 7) continue
    const domain = String(parts[0] || '').toLowerCase()
    const name = String(parts[5] || '').trim()
    const value = String(parts[6] || '').trim()
    if (!domain.includes('instagram.com')) continue
    if (name && value) parsed[name] = value
  }
  return parsed
}

function getInstagramCookieMap() {
  const cookies = {}
  if (config.INSTAGRAM_COOKIES_FILE) {
    try {
      Object.assign(cookies, readInstagramCookieFile(config.INSTAGRAM_COOKIES_FILE))
    } catch {}
  }
  if (config.INSTAGRAM_COOKIES) Object.assign(cookies, parseCookieHeader(config.INSTAGRAM_COOKIES))
  if (config.INSTAGRAM_SESSIONID && !cookies.sessionid) cookies.sessionid = config.INSTAGRAM_SESSIONID
  return cookies
}

function buildInstagramCookieHeader() {
  const map = getInstagramCookieMap()
  const pairs = Object.entries(map)
    .filter(([name, value]) => name && value)
    .map(([name, value]) => `${name}=${value}`)
  return pairs.join('; ')
}

function createInstagramCookieFileForYtDlp() {
  const persistentPath = String(config.INSTAGRAM_COOKIES_FILE || '').trim()
  if (persistentPath && fs.existsSync(persistentPath)) {
    return { cookieFile: persistentPath, cleanup: () => {} }
  }

  const cookieMap = getInstagramCookieMap()
  const entries = Object.entries(cookieMap).filter(([name, value]) => name && value)
  if (!entries.length) return { cookieFile: '', cleanup: () => {} }

  const tempPath = path.join(
    os.tmpdir(),
    `instagram-cookie-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`
  )
  const lines = ['# Netscape HTTP Cookie File']
  for (const [name, value] of entries) {
    lines.push(['.instagram.com', 'TRUE', '/', 'TRUE', '0', name, value].join('\t'))
  }
  fs.writeFileSync(tempPath, `${lines.join('\n')}\n`, 'utf8')
  return {
    cookieFile: tempPath,
    cleanup: () => {
      try {
        fs.unlinkSync(tempPath)
      } catch {}
    },
  }
}

async function warmupTikTokSource(force = false) {
  if (!force && Date.now() - lastWarmupAt < WARMUP_INTERVAL_MS) return
  if (!warmupPromise) {
    warmupPromise = (async () => {
      try {
        await fetchWithTimeout(SOURCE_SITE, { headers: buildRequestHeaders(SOURCE_SITE) }, Math.min(12000, REQUEST_TIMEOUT_MS))
      } catch {}
      lastWarmupAt = Date.now()
    })().finally(() => {
      warmupPromise = null
    })
  }
  await warmupPromise
}

function decodeEscapedUrl(value) {
  const cleaned = String(value || '').trim()
  if (!cleaned) return ''
  const normalized = cleaned.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/gi, '&')
  try {
    return JSON.parse(`"${normalized.replace(/"/g, '\\"')}"`)
  } catch {
    return normalized
  }
}

function extractHtmlPayload(responseText) {
  const rawText = String(responseText || '').trim()
  if (!rawText) return ''
  if (rawText.startsWith('{') && rawText.endsWith('}')) {
    try {
      const data = JSON.parse(rawText)
      if (data && typeof data === 'object') {
        const directMessage = data.message || data.error
        for (const key of ['html', 'data', 'result', 'content']) {
          const value = data[key]
          if (typeof value === 'string' && value.trim()) return value.trim()
          if (value && typeof value === 'object') {
            for (const innerKey of ['html', 'content', 'result']) {
              const innerValue = value[innerKey]
              if (typeof innerValue === 'string' && innerValue.trim()) return innerValue.trim()
            }
          }
        }
        if (directMessage) throw new Error(String(directMessage))
      }
    } catch (error) {
      if (error instanceof SyntaxError) return rawText
      throw error
    }
  }
  return rawText
}

function extractTextError(html) {
  const patterns = [
    /<[^>]*class=["'][^"']*tk-error[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<[^>]*class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<[^>]*class=["'][^"']*error[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<[^>]*class=["'][^"']*text-danger[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  ]
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern)
    if (match?.[1]) {
      const message = stripHtml(match[1])
      if (message) return message
    }
  }
  return ''
}

function getAttr(fragment, attrName) {
  const pattern = new RegExp(`${attrName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i')
  const match = String(fragment || '').match(pattern)
  return match?.[2] ? decodeHtmlEntities(match[2]) : ''
}

function extractMetaContent(html, selectors = []) {
  const source = String(html || '')
  for (const selector of selectors) {
    const match = source.match(selector)
    if (match?.[1]) {
      const value = decodeEscapedUrl(decodeHtmlEntities(match[1]))
      if (value) return value
    }
  }
  return ''
}

function pickFirstTagValue(html, tagName, attrName = '') {
  const source = String(html || '')
  if (attrName) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*${attrName}\\s*=\\s*(["'])([\\s\\S]*?)\\1[^>]*>`, 'i')
    const match = source.match(pattern)
    return match?.[2] ? decodeEscapedUrl(decodeHtmlEntities(match[2])) : ''
  }
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  const match = source.match(pattern)
  return match?.[1] ? stripHtml(match[1]) : ''
}

function parseTikTokHtml(sourceUrl, html) {
  const title =
    normalizeText(
      extractMetaContent(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
      ]) || pickFirstTagValue(html, 'title') || pickFirstTagValue(html, 'h1') || pickFirstTagValue(html, 'h2') || pickFirstTagValue(html, 'h3')
    ) || 'مقطع تيك توك'

  const coverUrl =
    safeUrl(
      extractMetaContent(html, [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
      ]) ||
        pickFirstTagValue(html, 'img', 'src') ||
        pickFirstTagValue(html, 'video', 'poster')
    ) || ''

  const previewVideoUrl =
    safeUrl(
      extractMetaContent(html, [
        /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
      ]) ||
        pickFirstTagValue(html, 'source', 'src') ||
        pickFirstTagValue(html, 'video', 'src')
    ) || ''

  const rawLinks = {}
  const anchorPattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi
  let match = anchorPattern.exec(html)
  while (match) {
    const beforeAttrs = match[1] || ''
    const href = safeUrl(match[3], SOURCE_SITE)
    const afterAttrs = match[4] || ''
    const innerHtml = match[5] || ''
    if (href && !href.toLowerCase().startsWith('javascript:')) {
      const attrs = `${beforeAttrs} ${afterAttrs}`
      const label = normalizeText(
        [
          stripHtml(innerHtml),
          getAttr(attrs, 'title'),
          getAttr(attrs, 'aria-label'),
          getAttr(attrs, 'download'),
          getAttr(attrs, 'class'),
        ]
          .filter(Boolean)
          .join(' ')
      ) || href
      rawLinks[label] = href
    }
    match = anchorPattern.exec(html)
  }

  function pickLink({ requiredAny = [], requiredAll = [], excluded = [], hrefSuffixes = [] } = {}) {
    for (const [label, href] of Object.entries(rawLinks)) {
      const lowered = String(label || '').toLowerCase()
      if (requiredAny.length && !requiredAny.some((token) => lowered.includes(token))) continue
      if (requiredAll.length && !requiredAll.every((token) => lowered.includes(token))) continue
      if (excluded.length && excluded.some((token) => lowered.includes(token))) continue
      if (hrefSuffixes.length && !href.toLowerCase().split('?', 1)[0].endsWith(hrefSuffixes.find((suffix) => href.toLowerCase().split('?', 1)[0].endsWith(suffix)) || '')) continue
      return href
    }
    return ''
  }

  const mp3Url =
    pickLink({ requiredAny: ['mp3', 'audio', 'music'], excluded: ['mp4', 'video'] }) ||
    pickLink({ hrefSuffixes: ['.mp3'] })

  let hdUrl = pickLink({ requiredAny: ['hd', 'high quality', 'high-quality', 'original'], excluded: ['mp3', 'audio'] })
  let noWatermarkUrl = pickLink({ requiredAny: ['without watermark', 'no watermark', 'download without watermark'], excluded: ['mp3', 'audio'] })
  const watermarkUrl = pickLink({ requiredAny: ['with watermark', 'watermark'], excluded: ['without'] })

  if (hdUrl && noWatermarkUrl && hdUrl === noWatermarkUrl) {
    const altNoWatermark = pickLink({
      requiredAny: ['without watermark', 'no watermark', 'download without watermark'],
      excluded: ['hd', 'high quality', 'mp3', 'audio'],
    })
    if (altNoWatermark) noWatermarkUrl = altNoWatermark
  }

  if (!noWatermarkUrl && hdUrl) noWatermarkUrl = hdUrl
  if (!hdUrl && noWatermarkUrl) hdUrl = noWatermarkUrl

  return {
    platform: 'tiktok',
    sourceUrl,
    title,
    coverUrl: coverUrl || null,
    previewVideoUrl: previewVideoUrl || noWatermarkUrl || hdUrl || watermarkUrl || null,
    noWatermarkUrl: noWatermarkUrl || null,
    hdUrl: hdUrl || null,
    mp3Url: mp3Url || null,
    watermarkUrl: watermarkUrl || null,
    rawLinks,
    metadata: {
      title,
    },
  }
}

async function fetchTikTokInfo(tiktokUrl) {
  const cleanUrl = cleanupUrl(tiktokUrl)
  const cacheKey = `tiktok::${cleanUrl}`
  const cached = getCachedResult(cacheKey)
  if (cached) return cached

  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await warmupTikTokSource(attempt > 1)
      const { text } = await fetchText(
        SOURCE_API,
        {
          method: 'POST',
          headers: {
            ...buildRequestHeaders(SOURCE_API, {
              Accept: 'text/plain, text/html, application/json, */*;q=0.8',
              'Content-Type': 'application/json',
            }),
          },
          body: JSON.stringify({ vid: cleanUrl, prefix: SOURCE_PREFIX }),
        },
        REQUEST_TIMEOUT_MS
      )

      const html = extractHtmlPayload(text)
      if (!html) throw new Error('المصدر أعاد نتيجة فارغة أثناء محاولة تجهيز رابط تيك توك.')
      if (html.toLowerCase().includes('tk-error')) {
        throw new Error(extractTextError(html) || 'تعذر جلب بيانات رابط تيك توك من المصدر.')
      }

      const result = parseTikTokHtml(cleanUrl, html)
      if (!result.noWatermarkUrl && !result.hdUrl && !result.previewVideoUrl && !result.watermarkUrl) {
        throw new Error('تمت قراءة نتيجة تيك توك لكن لم يتم العثور على روابط تنزيل صالحة.')
      }

      setCachedResult(cacheKey, result)
      return result
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(attempt * 1000)
    }
  }

  throw new Error(`فشل جلب فيديو تيك توك بعد عدة محاولات: ${lastError?.message || lastError || 'unknown_error'}`)
}

function looksLikeVideoUrl(url) {
  const lowered = String(url || '').toLowerCase()
  return lowered.startsWith('http') &&
    ['.mp4', '.m4v', '.mov', '.webm', 'mime_type=video_mp4', 'video_dashinit', 'cdninstagram.com', 'fbcdn.net']
      .some((token) => lowered.includes(token))
}

function extractDirectVideoUrlsFromText(text) {
  const normalized = String(text || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/gi, '&')
  const found = []
  const matches = normalized.match(/https?:\/\/[^"'\s<>]+/g) || []
  for (const rawUrl of matches) {
    const candidate = rawUrl.trim().replace(/^['"]+|['"]+$/g, '')
    if (looksLikeVideoUrl(candidate)) found.push(candidate)
  }
  return found
}

function collectInstagramVideoUrlsFromObject(payload, collected = []) {
  if (Array.isArray(payload)) {
    for (const item of payload) collectInstagramVideoUrlsFromObject(item, collected)
    return collected
  }
  if (!payload || typeof payload !== 'object') return collected

  for (const [key, value] of Object.entries(payload)) {
    const loweredKey = String(key || '').toLowerCase()
    if (typeof value === 'string') {
      const decoded = decodeEscapedUrl(value)
      if (looksLikeVideoUrl(decoded) && (['url', 'video_url', 'contenturl', 'src', 'playback_url'].includes(loweredKey) || loweredKey.includes('video'))) {
        collected.push(decoded)
      }
      collected.push(...extractDirectVideoUrlsFromText(decoded))
      continue
    }
    collectInstagramVideoUrlsFromObject(value, collected)
  }

  return collected
}

function rankDirectVideoUrl(url) {
  const lowered = String(url || '').toLowerCase()
  let score = 0
  if (lowered.includes('.mp4') || lowered.includes('mime_type=video_mp4')) score += 200
  if (lowered.includes('fbcdn.net') || lowered.includes('cdninstagram.com')) score += 150
  if (lowered.includes('.m3u8')) score -= 180
  score += Math.min(String(url || '').length, 220)
  return score
}

function pickBestDirectVideoUrl(urls) {
  const deduped = []
  const seen = new Set()
  for (const value of urls || []) {
    const candidate = decodeEscapedUrl(value).trim()
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    deduped.push(candidate)
  }
  if (!deduped.length) return ''
  deduped.sort((a, b) => rankDirectVideoUrl(b) - rankDirectVideoUrl(a))
  return deduped[0]
}

function buildInstagramResultFromVideoUrl(sourceUrl, videoUrl, options = {}) {
  const title = normalizeText(options.title || 'Instagram Download') || 'Instagram Download'
  return {
    platform: 'instagram',
    sourceUrl,
    title,
    coverUrl: options.coverUrl || null,
    previewVideoUrl: videoUrl,
    noWatermarkUrl: videoUrl,
    hdUrl: videoUrl,
    mp3Url: null,
    watermarkUrl: null,
    rawLinks: options.rawLinks || { instagram_video: videoUrl },
    metadata: {
      title,
      thumbnail: options.coverUrl || undefined,
      uploader: options.uploader || undefined,
    },
  }
}

function extractInstagramMetaContent(html, patterns) {
  return extractMetaContent(html, patterns)
}

async function fetchInstagramViaWebpage(instagramUrl) {
  const { response, text: html } = await fetchText(
    instagramUrl,
    {
      headers: buildInstagramHeaders(instagramUrl),
    },
    REQUEST_TIMEOUT_MS
  )

  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('video/') && response.url) {
    return buildInstagramResultFromVideoUrl(instagramUrl, response.url, {
      rawLinks: { instagram_response_video: response.url },
    })
  }

  const title =
    normalizeText(
      extractInstagramMetaContent(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
      ]) || pickFirstTagValue(html, 'title')
    ) || 'Instagram Download'

  const coverUrl =
    safeUrl(
      extractInstagramMetaContent(html, [
        /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
      ])
    ) || null

  let videoUrl =
    safeUrl(
      extractInstagramMetaContent(html, [
        /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
      ])
    ) || ''

  if (!videoUrl) {
    for (const pattern of [
      /"video_url":"([^"]+)"/i,
      /"contentUrl":"([^"]+)"/i,
      /"video_versions":\[\{"type":[^\]]*"url":"([^"]+)"/i,
    ]) {
      const match = html.match(pattern)
      if (match?.[1]) {
        videoUrl = decodeEscapedUrl(match[1])
        if (videoUrl) break
      }
    }
  }

  if (!videoUrl) videoUrl = pickBestDirectVideoUrl(extractDirectVideoUrlsFromText(html))
  if (!videoUrl) throw new Error('تعذر استخراج رابط الفيديو من صفحة Instagram مباشرة.')

  return buildInstagramResultFromVideoUrl(instagramUrl, videoUrl, {
    title,
    coverUrl,
    rawLinks: { instagram_meta_video: videoUrl },
  })
}

async function fetchInstagramViaEmbedJson(instagramUrl) {
  const endpoints = [`${instagramUrl}?__a=1&__d=dis`, new URL('embed/captioned/', instagramUrl).toString()]
  let lastError = null

  for (const endpoint of endpoints) {
    try {
      const { text: rawText } = await fetchText(
        endpoint,
        {
          headers: buildInstagramHeaders(endpoint, { Accept: 'application/json,text/plain,*/*' }),
        },
        REQUEST_TIMEOUT_MS
      )

      const payloadText = rawText.startsWith('for (;;);') ? rawText.split('\n').slice(1).join('\n') : rawText
      let parsedPayload = null
      if (/^\s*[\[{]/.test(payloadText)) {
        try {
          parsedPayload = JSON.parse(payloadText)
        } catch {
          parsedPayload = null
        }
      }

      let title = 'Instagram Download'
      let coverUrl = null
      let videoUrl = ''
      const rawLinks = { instagram_embed_endpoint: endpoint }

      if (parsedPayload) {
        const candidates = collectInstagramVideoUrlsFromObject(parsedPayload)
        videoUrl = pickBestDirectVideoUrl(candidates)
        if (videoUrl) rawLinks.instagram_embed_video = videoUrl
      }

      if (!videoUrl) {
        title =
          normalizeText(
            extractInstagramMetaContent(rawText, [
              /<meta[^>]+property=["']og:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
              /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
            ]) || pickFirstTagValue(rawText, 'title')
          ) || title
        coverUrl =
          safeUrl(
            extractInstagramMetaContent(rawText, [
              /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
              /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
            ])
          ) || null
        videoUrl =
          safeUrl(
            extractInstagramMetaContent(rawText, [
              /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
              /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
            ])
          ) || ''
        if (!videoUrl) videoUrl = pickBestDirectVideoUrl(extractDirectVideoUrlsFromText(rawText))
        if (videoUrl) rawLinks.instagram_embed_video = videoUrl
      }

      if (videoUrl) {
        return buildInstagramResultFromVideoUrl(instagramUrl, videoUrl, {
          title,
          coverUrl,
          rawLinks,
        })
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`تعذر استخراج فيديو Instagram من واجهة JSON/Embed: ${lastError?.message || lastError || 'unknown_error'}`)
}

async function fetchInstagramViaInstafix(instagramUrl) {
  const parsed = new URL(instagramUrl)
  const normalizedPath = `${parsed.pathname.replace(/\/+$/, '')}/`
  const candidates = ['www.ddinstagram.com', 'ddinstagram.com', 'd.ddinstagram.com'].map((host) => `https://${host}${normalizedPath}`)

  let lastError = null
  for (const candidateUrl of candidates) {
    try {
      const { response, text: html } = await fetchText(
        candidateUrl,
        {
          headers: buildRequestHeaders(candidateUrl, {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          }),
        },
        REQUEST_TIMEOUT_MS
      )

      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('video/') && response.url) {
        return buildInstagramResultFromVideoUrl(instagramUrl, response.url, {
          rawLinks: { instafix_direct: response.url, instafix_page: candidateUrl },
        })
      }

      const title =
        normalizeText(
          extractInstagramMetaContent(html, [
            /<meta[^>]+property=["']og:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
            /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
          ]) || pickFirstTagValue(html, 'title')
        ) || 'Instagram Download'

      const coverUrl =
        safeUrl(
          extractInstagramMetaContent(html, [
            /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
          ])
        ) || null

      let videoUrl =
        safeUrl(
          extractInstagramMetaContent(html, [
            /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
            /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
          ])
        ) || ''

      if (!videoUrl) videoUrl = pickBestDirectVideoUrl(extractDirectVideoUrlsFromText(html))
      if (videoUrl) {
        return buildInstagramResultFromVideoUrl(instagramUrl, videoUrl, {
          title,
          coverUrl,
          rawLinks: {
            instafix_page: candidateUrl,
            instafix_video: videoUrl,
          },
        })
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`تعذر استخراج فيديو Instagram عبر ddinstagram/InstaFix: ${lastError?.message || lastError || 'unknown_error'}`)
}

function formatHasVideo(fmt) {
  const vcodec = String(fmt?.vcodec || '').toLowerCase()
  return vcodec && vcodec !== 'none'
}

function formatHasAudio(fmt) {
  const acodec = String(fmt?.acodec || '').toLowerCase()
  return acodec && acodec !== 'none'
}

function scoreInstagramVideoFormat(fmt, defaultBase = 0) {
  const fmtUrl = String(fmt?.url || '').trim()
  if (!fmtUrl) return Number.NEGATIVE_INFINITY

  const ext = String(fmt?.ext || '').toLowerCase()
  const protocol = String(fmt?.protocol || '').toLowerCase()
  const height = Number.isFinite(Number(fmt?.height)) ? Number(fmt.height) : 0
  const hasVideo = formatHasVideo(fmt)
  const hasAudio = formatHasAudio(fmt)

  let score = defaultBase + height
  if (hasVideo) score += 400
  if (hasAudio) score += 260
  if (hasVideo && hasAudio) score += 500
  if (ext === 'mp4' || fmtUrl.toLowerCase().split('?', 1)[0].endsWith('.mp4')) score += 150
  if (protocol === 'https' || protocol === 'http') score += 40
  if (protocol.startsWith('m3u8')) score -= 120
  if (!hasVideo) score -= 1000
  else if (!hasAudio) score -= 450
  return score
}

function pickFirstVideoEntry(payload) {
  if (!payload || typeof payload !== 'object') return null

  if (Array.isArray(payload.entries)) {
    for (const entry of payload.entries) {
      const picked = pickFirstVideoEntry(entry)
      if (picked) return picked
    }
  }

  const directUrl = String(payload.url || '').trim()
  if (directUrl && directUrl.toLowerCase().split('?', 1)[0].endsWith('.mp4')) return payload

  if (Array.isArray(payload.formats)) {
    for (const fmt of payload.formats) {
      if (!fmt || typeof fmt !== 'object') continue
      const fmtUrl = String(fmt.url || '').trim()
      const ext = String(fmt.ext || '').toLowerCase()
      const vcodec = String(fmt.vcodec || '').toLowerCase()
      if (fmtUrl && (ext === 'mp4' || fmtUrl.toLowerCase().split('?', 1)[0].endsWith('.mp4') || (vcodec && vcodec !== 'none'))) {
        return payload
      }
    }
  }

  return null
}

function extractInstagramResultFromYtDlp(sourceUrl, info) {
  const entry = pickFirstVideoEntry(info)
  if (!entry) throw new Error('yt-dlp لم يجد فيديو داخل رابط Instagram.')

  const rawLinks = {}
  const rankedFormats = []
  const seenUrls = new Set()

  function addCandidate(label, fmt, defaultBase = 0) {
    const candidateUrl = String(fmt?.url || '').trim()
    if (!candidateUrl || seenUrls.has(candidateUrl)) return
    const score = scoreInstagramVideoFormat(fmt, defaultBase)
    if (!Number.isFinite(score)) return
    seenUrls.add(candidateUrl)
    rawLinks[label] = candidateUrl
    rankedFormats.push([score, candidateUrl])
  }

  const directUrl = String(entry.url || '').trim()
  if (directUrl) {
    addCandidate(
      'instagram_direct',
      {
        url: directUrl,
        ext: entry.ext,
        height: entry.height,
        protocol: entry.protocol,
        vcodec: entry.vcodec,
        acodec: entry.acodec,
      },
      200
    )
  }

  if (Array.isArray(entry.requested_formats)) {
    entry.requested_formats.forEach((fmt, index) => {
      if (fmt && typeof fmt === 'object') addCandidate(`instagram_requested_${index + 1}`, fmt, 120)
    })
  }

  if (Array.isArray(entry.formats)) {
    entry.formats.forEach((fmt, index) => {
      if (fmt && typeof fmt === 'object') addCandidate(`instagram_format_${index + 1}`, fmt, 0)
    })
  }

  rankedFormats.sort((a, b) => b[0] - a[0])
  const videoUrl = rankedFormats[0]?.[1] || ''
  if (!videoUrl) throw new Error('yt-dlp لم يرجع رابط فيديو مباشر صالح.')

  let coverUrl = String(entry.thumbnail || '').trim()
  if (!coverUrl && Array.isArray(entry.thumbnails)) {
    for (const thumb of [...entry.thumbnails].reverse()) {
      const candidate = String(thumb?.url || '').trim()
      if (candidate) {
        coverUrl = candidate
        break
      }
    }
  }

  const title =
    normalizeText(entry.title || entry.description || info?.title || info?.description || 'Instagram Download') ||
    'Instagram Download'

  return buildInstagramResultFromVideoUrl(sourceUrl, videoUrl, {
    title,
    coverUrl: coverUrl || null,
    rawLinks,
    uploader: String(entry.uploader || entry.channel || info?.uploader || info?.channel || '').trim() || undefined,
  })
}

function addYtDlpHeaderArgs(args, headers) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (!value) continue
    args.push('--add-header', `${key}:${value}`)
  }
}

async function runYtDlpJson(url, platform) {
  const client = await getClient()
  const args = [
    url,
    '--dump-single-json',
    '--no-warnings',
    '--skip-download',
    '--no-playlist',
    '--extract-flat',
    'false',
    '--socket-timeout',
    String(Math.max(15, Math.ceil(config.MEDIA_DOWNLOAD_TIMEOUT_MS / 1000))),
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--extractor-retries',
    '3',
  ]

  let cleanupCookieFile = () => {}
  if (platform === 'instagram') {
    addYtDlpHeaderArgs(args, buildInstagramHeaders(url))
    const cookieState = createInstagramCookieFileForYtDlp()
    cleanupCookieFile = cookieState.cleanup
    if (cookieState.cookieFile) args.push('--cookies', cookieState.cookieFile)
  } else {
    addYtDlpHeaderArgs(args, buildRequestHeaders(url))
  }

  try {
    const stdout = await client.execPromise(args)
    return JSON.parse(stdout)
  } finally {
    cleanupCookieFile()
  }
}

function buildDownloadArgs(url, outputTemplate, platform) {
  const args = [
    url,
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '--socket-timeout',
    String(Math.max(15, Math.ceil(config.MEDIA_DOWNLOAD_TIMEOUT_MS / 1000))),
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--extractor-retries',
    '3',
    '--concurrent-fragments',
    '1',
    '--max-filesize',
    `${config.MEDIA_MAX_SIZE_MB}M`,
    '--format',
    'b[ext=mp4][vcodec!=none][acodec!=none][height<=1080]/b[ext=mp4][vcodec!=none][height<=720]/b[vcodec!=none][acodec!=none][height<=1080]/b',
    '--output',
    outputTemplate,
    '--print',
    'after_move:filepath',
  ]

  let cleanupCookieFile = () => {}
  if (platform === 'instagram') {
    addYtDlpHeaderArgs(args, buildInstagramHeaders(url))
    const cookieState = createInstagramCookieFileForYtDlp()
    cleanupCookieFile = cookieState.cleanup
    if (cookieState.cookieFile) args.push('--cookies', cookieState.cookieFile)
  } else {
    addYtDlpHeaderArgs(args, buildRequestHeaders(url))
  }

  return { args, cleanupCookieFile }
}

async function downloadViaYtDlp(url, platform) {
  ensureDirectory(config.MEDIA_DOWNLOAD_DIR)
  const client = await getClient()
  const metadata = await runYtDlpJson(url, platform).catch(() => null)
  const { args, cleanupCookieFile } = buildDownloadArgs(url, buildOutputTemplate(platform), platform)

  try {
    const stdout = await client.execPromise(args)
    const filePath = pickFinalFileFromStdout(stdout)
    if (!filePath || !fs.existsSync(filePath)) {
      const error = new Error('download_failed')
      error.code = 'download_failed'
      throw error
    }

    const stats = fs.statSync(filePath)
    const sizeMb = stats.size / (1024 * 1024)
    if (sizeMb > config.MEDIA_MAX_SIZE_MB) {
      cleanupDownloadedFile(filePath)
      const error = new Error('file_too_large')
      error.code = 'file_too_large'
      error.sizeMb = sizeMb
      throw error
    }

    const response = {
      platform,
      filePath,
      fileSizeBytes: stats.size,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      sourceMethod: 'yt-dlp',
    }

    if (platform === 'instagram' && metadata && typeof metadata === 'object') {
      response.metadata = {
        ...metadata,
        title: metadata.title || metadata.description || 'Instagram Download',
        uploader: metadata.uploader || metadata.channel || '',
      }
    }

    return response
  } finally {
    cleanupCookieFile()
  }
}

async function probeMedia(url) {
  let finalUrl = url
  let contentType = ''
  let contentLength = null

  try {
    const headResponse = await fetchWithTimeout(
      url,
      {
        method: 'HEAD',
        headers: buildRequestHeaders(url),
      },
      Math.min(15000, REQUEST_TIMEOUT_MS)
    )
    if (headResponse.ok) {
      finalUrl = headResponse.url || url
      contentType = String(headResponse.headers.get('content-type') || '').toLowerCase()
      const header = String(headResponse.headers.get('content-length') || '').trim()
      if (/^\d+$/.test(header)) contentLength = Number(header)
    }
  } catch {}

  if (!contentLength || !contentType || contentType.includes('text/html')) {
    try {
      const rangeResponse = await fetchWithTimeout(
        finalUrl,
        {
          headers: buildRequestHeaders(finalUrl, { Range: 'bytes=0-0' }),
        },
        Math.min(20000, REQUEST_TIMEOUT_MS)
      )
      if (rangeResponse.ok) {
        finalUrl = rangeResponse.url || finalUrl
        contentType = String(rangeResponse.headers.get('content-type') || contentType || '').toLowerCase()
        const contentRange = String(rangeResponse.headers.get('content-range') || '')
        if (contentRange.includes('/')) {
          const total = contentRange.split('/').pop().trim()
          if (/^\d+$/.test(total)) contentLength = Number(total)
        }
        if (!contentLength) {
          const header = String(rangeResponse.headers.get('content-length') || '').trim()
          if (/^\d+$/.test(header)) contentLength = Number(header)
        }
        try {
          await rangeResponse.body?.cancel()
        } catch {}
      }
    } catch {}
  }

  return { finalUrl, contentType, contentLength }
}

function inferExtension(url, contentType) {
  const loweredType = String(contentType || '').toLowerCase()
  if (loweredType.includes('video/mp4')) return '.mp4'
  if (loweredType.includes('video/webm')) return '.webm'
  if (loweredType.includes('video/quicktime')) return '.mov'
  if (loweredType.includes('audio/mpeg')) return '.mp3'

  try {
    const pathname = new URL(url).pathname || ''
    const ext = path.extname(pathname)
    if (ext && ext.length <= 6) return ext.toLowerCase()
  } catch {}
  return '.mp4'
}

async function downloadFile(url, suffix, headers = null) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: headers || buildRequestHeaders(url),
    },
    Math.max(30000, config.MEDIA_DOWNLOAD_TIMEOUT_MS)
  )

  if (!response.ok) {
    const preview = await response.text().catch(() => '')
    throw new Error(`تعذر تنزيل الملف: HTTP ${response.status} ${response.statusText} ${preview.slice(0, 180)}`)
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const declaredLength = String(response.headers.get('content-length') || '').trim()
  if (/^\d+$/.test(declaredLength)) {
    const sizeMb = Number(declaredLength) / (1024 * 1024)
    if (sizeMb > config.MEDIA_MAX_SIZE_MB) {
      const error = new Error(`حجم الملف كبير جداً (${sizeMb.toFixed(1)}MB) والحد الحالي ${config.MEDIA_MAX_SIZE_MB}MB.`)
      error.code = 'file_too_large'
      error.sizeMb = sizeMb
      throw error
    }
  }

  if (contentType.includes('text/html') && !String(url).toLowerCase().includes('instagram.com') && !String(url).toLowerCase().includes('cdninstagram.com')) {
    const preview = await response.text().catch(() => '')
    throw new Error(`الرابط أعاد HTML بدل الملف: ${preview.slice(0, 220)}`)
  }

  ensureDirectory(config.MEDIA_DOWNLOAD_DIR)
  const tempPath = path.join(
    config.MEDIA_DOWNLOAD_DIR,
    `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${suffix}`
  )

  let totalBytes = 0
  const output = fs.createWriteStream(tempPath)

  try {
    const readable = Readable.fromWeb(response.body)
    for await (const chunk of readable) {
      totalBytes += chunk.length
      if (totalBytes > config.MEDIA_MAX_SIZE_MB * 1024 * 1024) {
        const error = new Error(`تم إيقاف التحميل لأن الملف تجاوز ${config.MEDIA_MAX_SIZE_MB}MB.`)
        error.code = 'file_too_large'
        throw error
      }
      if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve))
    }
    await new Promise((resolve, reject) => {
      output.end((error) => (error ? reject(error) : resolve()))
    })

    if (totalBytes === 0) throw new Error('تم إنشاء ملف فارغ. رابط التنزيل غير صالح أو انتهت صلاحيته.')
    return { filePath: tempPath, fileSizeBytes: totalBytes, contentType }
  } catch (error) {
    try {
      output.destroy()
    } catch {}
    try {
      fs.unlinkSync(tempPath)
    } catch {}
    throw error
  }
}

async function downloadDirectMedia(directUrl, platform) {
  const probe = await probeMedia(directUrl)
  if (probe.contentLength && probe.contentLength > config.MEDIA_MAX_SIZE_MB * 1024 * 1024) {
    const error = new Error('file_too_large')
    error.code = 'file_too_large'
    error.sizeMb = probe.contentLength / (1024 * 1024)
    throw error
  }

  const targetUrl = probe.finalUrl || directUrl
  const extension = inferExtension(targetUrl, probe.contentType)
  const headers = platform === 'instagram' ? buildRequestHeaders(targetUrl) : buildRequestHeaders(targetUrl)
  return downloadFile(targetUrl, extension, headers)
}

async function fetchInstagramInfo(instagramUrl) {
  const cleanedUrl = canonicalInstagramUrl(instagramUrl)
  const cacheKey = `instagram::${cleanedUrl}`
  const cached = getCachedResult(cacheKey)
  if (cached) return cached

  const hasInstagramAuth = Boolean(
    config.INSTAGRAM_SESSIONID || config.INSTAGRAM_COOKIES || config.INSTAGRAM_COOKIES_FILE
  )

  const attempts = []
  if (hasInstagramAuth) attempts.push(['yt-dlp-auth', async (url) => extractInstagramResultFromYtDlp(url, await runYtDlpJson(url, 'instagram'))])
  attempts.push(['webpage', fetchInstagramViaWebpage])
  attempts.push(['embed/json', fetchInstagramViaEmbedJson])
  attempts.push(['instafix', fetchInstagramViaInstafix])
  if (!hasInstagramAuth) attempts.push(['yt-dlp', async (url) => extractInstagramResultFromYtDlp(url, await runYtDlpJson(url, 'instagram'))])

  const errors = []
  for (const [methodName, method] of attempts) {
    try {
      const result = await method(cleanedUrl)
      setCachedResult(cacheKey, result)
      return result
    } catch (error) {
      errors.push(`${methodName}: ${error?.message || error}`)
    }
  }

  throw new Error(
    'تعذر تجهيز فيديو Instagram بهذا الرابط. تأكد أنه Reel/Post عام وغير خاص ثم جرّب مرة ثانية. ' +
      `تفاصيل المحاولات: ${errors.join(' | ') || 'لا توجد تفاصيل إضافية.'}`
  )
}

async function downloadSocialVideo(url, options = {}) {
  const cleanUrl = cleanupUrl(url)
  const platform = options.platformHint || detectPlatform(cleanUrl)
  if (!platform) {
    const error = new Error('unsupported_platform')
    error.code = 'unsupported_platform'
    throw error
  }

  const directErrors = []

  if (platform === 'tiktok') {
    try {
      const info = await fetchTikTokInfo(cleanUrl)
      const directUrl = info.hdUrl || info.noWatermarkUrl || info.previewVideoUrl || info.watermarkUrl
      if (directUrl) {
        try {
          const downloaded = await downloadDirectMedia(directUrl, platform)
          return {
            platform,
            filePath: downloaded.filePath,
            fileSizeBytes: downloaded.fileSizeBytes,
            metadata: {
              title: info.title,
            },
            sourceMethod: 'tiktokio-direct',
            directUrl,
          }
        } catch (error) {
          directErrors.push(`tiktokio-direct: ${error?.message || error}`)
        }
      }
    } catch (error) {
      directErrors.push(`tiktokio-fetch: ${error?.message || error}`)
    }
  }

  if (platform === 'instagram') {
    try {
      const info = await fetchInstagramInfo(cleanUrl)
      const directUrl = info.hdUrl || info.noWatermarkUrl || info.previewVideoUrl
      if (directUrl) {
        try {
          const downloaded = await downloadDirectMedia(directUrl, platform)
          return {
            platform,
            filePath: downloaded.filePath,
            fileSizeBytes: downloaded.fileSizeBytes,
            metadata: {
              title: info.title,
              thumbnail: info.coverUrl || undefined,
              uploader: info.metadata?.uploader || '',
            },
            sourceMethod: 'instagram-direct',
            directUrl,
          }
        } catch (error) {
          directErrors.push(`instagram-direct: ${error?.message || error}`)
        }
      }
    } catch (error) {
      directErrors.push(`instagram-fetch: ${error?.message || error}`)
    }
  }

  try {
    const fallback = await downloadViaYtDlp(cleanUrl, platform)
    if (directErrors.length) {
      fallback.metadata = {
        ...(fallback.metadata || {}),
        extractor_warnings: directErrors,
      }
    }
    return fallback
  } catch (error) {
    if (directErrors.length) {
      error.message = `${error.message} | ${directErrors.join(' | ')}`
    }
    throw error
  }
}

function cleanupDownloadedFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

module.exports = {
  detectPlatform,
  extractSupportedSocialUrls,
  extractFirstSupportedUrl,
  fetchTikTokInfo,
  fetchInstagramInfo,
  downloadSocialVideo,
  cleanupDownloadedFile,
}
