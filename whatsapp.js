const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  initAuthCreds,
  BufferJSON,
  proto,
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const config = require('./config')
const db = require('./db')
const mediaDownloader = require('./media-downloader')

const STATUS_JID = 'status@broadcast'
const sessions = new Map()
const ownJidsByNumber = new Map()
let latestVersionPromise = null
let notifyFn = null
// مرجع لتوليد معرّفات الجلسات بشكل موحّد بين الوحدات
const sessionKeys = require('./lib/session-keys')

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

function canLog(level) {
  const current = LOG_LEVELS[config.LOG_LEVEL] ?? LOG_LEVELS.warn
  const wanted = LOG_LEVELS[level] ?? LOG_LEVELS.info
  return current >= wanted
}

function logInfo(...args) {
  if (canLog('info')) console.log(...args)
}
function logWarn(...args) {
  if (canLog('warn')) console.warn(...args)
}
function logError(...args) {
  if (canLog('error')) console.error(...args)
}

// عداد أعطال إعادة الاتصال لكل جلسة + مهلة فحص الصحة
function computeReconnectBackoff(baseDelayMs, attempt) {
  const cap = config.SESSION_MAX_RECONNECT_BACKOFF_MS
  const exp = baseDelayMs * Math.pow(1.7, Math.max(0, attempt - 1))
  // jitter بسيط (±15%) لتفادي تصادُمحاولات إعادة الاتصال بين الأرقام المتعددة
  const jitter = exp * (0.85 + Math.random() * 0.3)
  return Math.min(cap, Math.max(500, Math.round(jitter)))
}

function setNotifier(fn) {
  notifyFn = fn
}

// حفظ آخر نشاط للـ session في MongoDB بحيث يبقى الـ monitor و session-doctor
// قادرَين على تمييز الأرقام الحقيقية حتى لو لم يصلها حدث بعد restart.
async function heartbeat(number, userId, status = 'alive', extra = {}) {
  try {
    if (!db.isRemoteSessionStorageEnabled || !db.isRemoteSessionStorageEnabled()) return
    const sid = sessionKeys.authSessionIdFor(userId, number)
    await db.applyWaAuthMutations(sid, [{
      fileName: '__heartbeat__.json',
      value: { t: Date.now(), status, ...extra },
      scope: sid,
    }])
  } catch (e) {
    // لا تكسر شيء — هذه نبضة داعمة فقط
  }
}

async function notify(chatId, text) {
  if (!notifyFn || !chatId) return
  try {
    await notifyFn(chatId, text)
  } catch (e) {
    logError('[إشعار]', e.message)
  }
}

const normalizePhone = (number) => String(number || '').replace(/\D/g, '')
const sessionKey = (userId, number) => `${Number(userId)}:${normalizePhone(number)}`
const sessionIdentity = (userId, number) => `${Number(userId)}_${normalizePhone(number)}`
const authSessionIdFor = (userId, number) => `wa_session_${sessionIdentity(userId, number)}`
const legacyAuthSessionIdFor = (number) => `wa_session_${normalizePhone(number)}`
const authFolderFor = (userId, number) => path.join(config.SESSIONS_DIR, sessionIdentity(userId, number))
const legacyAuthFolderFor = (number) => path.join(config.SESSIONS_DIR, normalizePhone(number))
const authCredsFileFor = (userId, number) => path.join(authFolderFor(userId, number), 'creds.json')

function useDatabaseOnlySessionStorage() {
  return config.SESSION_STORAGE_MODE === 'database' && db.isRemoteSessionStorageEnabled()
}

function fixAuthFileName(file) {
  return String(file || '')
    .replace(/\//g, '__')
    .replace(/:/g, '-')
}

async function readLocalAuthData(userId, number, file) {
  const folders = [authFolderFor(userId, number), legacyAuthFolderFor(number)]
  for (const folder of Array.from(new Set(folders))) {
    try {
      const filePath = path.join(folder, fixAuthFileName(file))
      const raw = await fs.promises.readFile(filePath, 'utf8')
      return JSON.parse(raw, BufferJSON.reviver)
    } catch {}
  }
  return null
}

async function writeLocalAuthData(userId, number, file, value) {
  const folder = authFolderFor(userId, number)
  await fs.promises.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, fixAuthFileName(file))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await fs.promises.writeFile(tempPath, JSON.stringify(value, BufferJSON.replacer))
  await fs.promises.rename(tempPath, filePath)
}

async function removeLocalAuthData(userId, number, file) {
  try {
    const filePath = path.join(authFolderFor(userId, number), fixAuthFileName(file))
    await fs.promises.rm(filePath, { force: true })
  } catch {}
}

async function clearLocalAuthFolder(userId, number) {
  try {
    await fs.promises.rm(authFolderFor(userId, number), { recursive: true, force: true })
    await fs.promises.rm(legacyAuthFolderFor(number), { recursive: true, force: true })
  } catch {}
}

async function authStateExists(userId, number) {
  if (db.isRemoteSessionStorageEnabled()) {
    const hasRemote = await db.hasWaAuthSession(authSessionIdFor(userId, number))
    const hasLegacyRemote = await db.hasWaAuthSession(legacyAuthSessionIdFor(number))
    if (hasRemote || hasLegacyRemote) return true
  }
  try {
    await fs.promises.access(authCredsFileFor(userId, number), fs.constants.F_OK)
    return true
  } catch {}
  try {
    await fs.promises.access(path.join(legacyAuthFolderFor(number), 'creds.json'), fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function usePersistentAuthState(userId, number) {
  const sessionId = authSessionIdFor(userId, number)
  const legacySessionId = legacyAuthSessionIdFor(number)
  const scope = typeof db.getSessionScope === 'function'
    ? db.getSessionScope(userId, number)
    : `sessions/${Number(userId)}/${normalizePhone(number)}`
  const dbOnly = useDatabaseOnlySessionStorage()

  if (!dbOnly) {
    await fs.promises.mkdir(authFolderFor(userId, number), { recursive: true })
  }

  const readData = async (file) => {
    if (db.isRemoteSessionStorageEnabled()) {
      const remoteValue = await db.getWaAuthFile(sessionId, file)
      if (remoteValue) return remoteValue
      const legacyRemoteValue = await db.getWaAuthFile(legacySessionId, file)
      if (legacyRemoteValue) return legacyRemoteValue
    }
    return readLocalAuthData(userId, number, file)
  }

  const writeData = async (file, value) => {
    if (!dbOnly) {
      await writeLocalAuthData(userId, number, file, value)
    }
    if (db.isRemoteSessionStorageEnabled()) {
      await db.setWaAuthFile(sessionId, file, value)
    }
  }

  const removeData = async (file) => {
    if (!dbOnly) {
      await removeLocalAuthData(userId, number, file)
    }
    if (db.isRemoteSessionStorageEnabled()) {
      await db.removeWaAuthFile(sessionId, file)
    }
  }

  const creds = (await readData('creds.json')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              out[id] = value
            })
          )
          return out
        },
        set: async (data) => {
          const localTasks = []
          const remoteMutations = []

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              if (!dbOnly) {
                localTasks.push(value ? writeLocalAuthData(userId, number, file, value) : removeLocalAuthData(userId, number, file))
              }
              if (db.isRemoteSessionStorageEnabled()) {
                remoteMutations.push({ fileName: file, value: value ?? null, scope })
              }
            }
          }

          if (localTasks.length) {
            await Promise.all(localTasks)
          }
          if (remoteMutations.length) {
            await db.applyWaAuthMutations(sessionId, remoteMutations)
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds.json', creds)
    },
    removeCreds: async () => {
      await removeData('creds.json')
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getLatestVersion() {
  if (!latestVersionPromise) {
    latestVersionPromise = fetchLatestBaileysVersion()
      .then((result) => result?.version)
      .catch((e) => {
        logWarn('[Baileys version]', e.message)
        return undefined
      })
  }
  return latestVersionPromise
}

function getBrowserProfile() {
  try {
    if (Browsers?.windows) return Browsers.windows('Chrome')
    if (Browsers?.ubuntu) return Browsers.ubuntu('Chrome')
  } catch {}
  return ['Windows', 'Chrome', '122.0.0.0']
}

function getReconnectDelay(statusCode) {
  if (statusCode === DisconnectReason.restartRequired) return 800
  if (statusCode === DisconnectReason.connectionClosed) return 1200
  if (statusCode === DisconnectReason.connectionLost) return 1500
  if (statusCode === DisconnectReason.timedOut) return 2000
  return 3000
}

function getJidServer(value) {
  const raw = String(value || '').trim()
  const at = raw.lastIndexOf('@')
  return at >= 0 ? raw.slice(at + 1).toLowerCase() : ''
}

function isPnUserJid(value) {
  const server = getJidServer(value)
  return server === 's.whatsapp.net' || server === 'c.us' || server === 'hosted'
}

function isLidUserJid(value) {
  const server = getJidServer(value)
  return server === 'lid' || server === 'hosted.lid'
}

function extractUserPart(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withoutServer = raw.replace(/@.*$/, '')
  return withoutServer.split(':')[0].trim()
}

function normalizePossiblePhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isLidUserJid(raw)) return ''
  const userPart = extractUserPart(raw)
  const digits = userPart.replace(/\D/g, '')
  if (digits.length >= 5 && digits.length <= 20) return digits
  if (!raw.includes('@')) {
    const direct = raw.replace(/\D/g, '')
    if (direct.length >= 5 && direct.length <= 20) return direct
  }
  return ''
}

function firstPhoneCandidate(...values) {
  for (const value of values) {
    const phone = normalizePossiblePhone(value)
    if (phone) return phone
  }
  return ''
}

function pickPreferredUserJid(...values) {
  const cleaned = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  for (const value of cleaned) {
    if (isPnUserJid(value)) {
      try { return jidNormalizedUser(value) } catch { return value }
    }
  }

  for (const value of cleaned) {
    if (isLidUserJid(value)) {
      try { return jidNormalizedUser(value) } catch { return value }
    }
  }

  const phone = firstPhoneCandidate(...cleaned)
  if (phone) {
    const pnJid = `${phone}@s.whatsapp.net`
    try { return jidNormalizedUser(pnJid) } catch { return pnJid }
  }

  return cleaned[0] || ''
}

function buildSelfJidCandidates(sock, phoneNumber) {
  const candidates = []
  const pn = firstPhoneCandidate(phoneNumber)
  if (pn) {
    candidates.push(`${pn}@s.whatsapp.net`)
    candidates.push(jidNormalizedUser(`${pn}@s.whatsapp.net`))
  }
  try {
    if (sock?.user?.id) {
      candidates.push(jidNormalizedUser(sock.user.id))
      candidates.push(sock.user.id)
    }
    if (sock?.authState?.creds?.me?.id) {
      candidates.push(jidNormalizedUser(sock.authState.creds.me.id))
      candidates.push(sock.authState.creds.me.id)
    }
  } catch {}
  return Array.from(new Set(candidates.filter(Boolean)))
}

function toNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value.toNumber === 'function') return value.toNumber()
  if (value && typeof value.low === 'number') return value.low
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getMessageTimestampMs(msg) {
  const raw = msg?.messageTimestamp
  const ts = toNumber(raw)
  if (!ts) return 0
  return ts > 1e12 ? ts : ts * 1000
}

async function runInBatches(items, limit, delayMs, worker) {
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit)
    await Promise.allSettled(slice.map((item) => worker(item)))
    if (delayMs > 0 && i + limit < items.length) {
      await sleep(delayMs)
    }
  }
}

// ===================== إصدار كود اقتران معزول (مؤقت) =====================
// هذه الدالة تنشئ مقبس واتساب مستقل تماماً ببيانات اعتماد فارغة ومجلد
// مؤقت منفصل، ثم تطلب كود الاقتران للرقم المستهدف، ثم تُغلق المقبس
// وتنظّف المجلد المؤقت، بدون لمس جلسة المالك الحالية أبداً.
//
// الأسلوب: لكل محاولة، ننشئ مقبساً جديداً ببيانات اعتماد فارغة وننتظر
// حدثَي "qr" و "connection.update" معاً حتى تصل طبقة النقل إلى الحالة
// التي يقبل فيها Baileys نداء requestPairingCode. في حال فشل طلب الكود
// بخطأ "Connection Closed" الناجم عن قطع مبكر، نُعيد المحاولة بمقبس جديد.
async function _createIsolatedPairingSocket(keyStorePath, version) {
  const creds = initAuthCreds()

  const sock = makeWASocket({
    auth: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {}
          for (const id of ids) {
            try {
              const f = path.join(keyStorePath, `${type}-${id}.json`)
              const raw = await fs.promises.readFile(f, 'utf8')
              out[id] = JSON.parse(raw, BufferJSON.reviver)
            } catch {}
          }
          return out
        },
        set: async (data) => {
          for (const cat in data) {
            for (const id in data[cat]) {
              const value = data[cat][id]
              if (!value) continue
              const f = path.join(keyStorePath, `${cat}-${id}.json`)
              try {
                const tmpPath = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
                await fs.promises.writeFile(tmpPath, JSON.stringify(value, BufferJSON.replacer))
                await fs.promises.rename(tmpPath, f)
              } catch {}
            }
          }
        },
      },
    },
    version,
    printQRInTerminal: false,
    browser: getBrowserProfile(),
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // مهم: fireInitQueries=false يمنع مكتبة Baileys من تشغيل استعلامات
    // أولية قد تتسبب في إغلاق الاتصال قبل أن يُستدعى requestPairingCode.
    fireInitQueries: false,
    keepAliveIntervalMs: 20_000,
    defaultQueryTimeoutMs: 60_000,
    connectTimeoutMs: 60_000,
    getMessage: async () => undefined,
    emitOwnEvents: false,
  })

  return sock
}

async function _waitForPairingReady(sock, timeoutMs = 45_000) {
  // ننتظر حتى يصبح المقبس في حالة تسمح بنداء requestPairingCode.
  // بعض إصدارات Baileys تُرجع qr كسلسلة نصية، وبعضها يطلق حدث qr منفصلاً.
  // كذلك قد تصبح الوصلة جاهزة قبل ظهور qr صراحة، لذا نراقب readyState أيضاً.
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(probe)
      cleanup()
      if (err) reject(err)
      else resolve()
    }
    const cleanup = () => {
      try { sock.ev.off('connection.update', onUpdate) } catch {}
      try { sock.ev.off('qr', onQr) } catch {}
      try { sock.ev.off('connection.close', onClose) } catch {}
    }
    const onQr = () => finish()
    const onClose = () => finish(new Error('Connection Closed'))
    const onUpdate = (u) => {
      if (settled) return
      const qr = u?.qr
      if ((typeof qr === 'string' && qr.trim()) || (Array.isArray(qr) && qr.length)) {
        finish()
        return
      }
      if ((u?.connection === 'connecting' || u?.connection === 'open') && sock?.ws?.readyState === 1) {
        finish()
      }
    }
    const probe = setInterval(() => {
      if (settled) return
      if (sock?.ws?.readyState === 1) finish()
    }, 400)
    const timer = setTimeout(() => finish(new Error('انتهت مهلة انتظار جاهزية المقبس')), timeoutMs)
    try { sock.ev.on('connection.update', onUpdate) } catch {}
    try { sock.ev.on('qr', onQr) } catch {}
    try { sock.ev.on('connection.close', onClose) } catch {}
  })
}

async function _destroySocket(sock) {
  if (!sock) return
  try {
    if (typeof sock.end === 'function') sock.end(undefined)
  } catch {}
  try {
    if (sock?.ev?.removeAllListeners) sock.ev.removeAllListeners()
  } catch {}
  // منح المكتبة لحظة لتحرير المؤشرات والملفات قبل الحذف
  await sleep(150)
}

async function requestIsolatedPairingCode(targetNumber) {
  const target = String(targetNumber || '').replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(target)) {
    throw new Error('صيغة الرقم غير صحيحة')
  }

  // مجلد مؤقت مستقل تماماً عن مجلدات جلسات المستخدمين، داخل SESSIONS_DIR
  // نستخدم بادئة "_tmp_pair_" لتمييزه عن الجلسات الفعلية، والوسم يحتوي الرقم
  // المستهدف + طابع زمني + بايتات عشوائية لمنع أي تعارض.
  const sessionTag = `_tmp_pair_${target}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const tempDir = path.join(config.SESSIONS_DIR, sessionTag)
  await fs.promises.mkdir(tempDir, { recursive: true })

  const version = await getLatestVersion()
  const MAX_ATTEMPTS = 3
  let lastError = null

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let pairingSocket = null
      try {
        pairingSocket = await _createIsolatedPairingSocket(tempDir, version)

        // انتظر حتى يصدر المقبس حدث qr أو connection.update بجاهزية الطلب
        try {
          await _waitForPairingReady(pairingSocket, 45_000)
        } catch (e) {
          lastError = e
          await _destroySocket(pairingSocket)
          pairingSocket = null
          // جهّز مجلداً جديداً للمحاولة التالية لتفادي أي بقايا حالة
          try { await fs.promises.rm(tempDir, { recursive: true, force: true }) } catch {}
          await fs.promises.mkdir(tempDir, { recursive: true })
          if (attempt < MAX_ATTEMPTS) continue
          break
        }

        // منح المكتبة مهلة قصيرة لاستكمال init
        await sleep(500)

        // طلب كود الاقتران مع مهلة خاصة وأثر وعزل تام عن مقبس المالك
        const code = await Promise.race([
          pairingSocket.requestPairingCode(target),
          new Promise((_, rej) => setTimeout(() => rej(new Error('انتهت مهلة استلام كود الاقتران')), 30_000)),
        ])

        const codeStr = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '')
        db.incrementMetric('totalPairingCodesIssued', 1)
        return { code: String(code || ''), formatted: codeStr }
      } catch (e) {
        lastError = e
        logWarn(`[عزل .pair] محاولة ${attempt}/${MAX_ATTEMPTS} للرقم ${target} فشلت:`, e?.message || e)
        if (pairingSocket) await _destroySocket(pairingSocket)
      }
    }
    throw lastError || new Error('Connection Closed')
  } finally {
    // إغلاق أي مقبس متبقٍّ
    // (المقبس يُغلق داخلياً في كل محاولة عبر finally)
    // تنظيف المجلد المؤقت بعد لحظة لإتاحة تحرير الملفات على جميع المنصات
    setTimeout(() => {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }, 2000)
  }
}

// ===================== أوامر المالك داخل الرقم المربوط =====================

const PHONE_COMMAND_KEYS = Object.keys(db.DEFAULT_PHONE_SETTINGS || {})

function parsePhoneCommandText(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return null
  const noMentions = text.replace(/@\d+/g, '').trim()
  const m = noMentions.match(/^[.\/#!]+(\S+)/)
  if (!m) return null
  const command = m[1].toLowerCase()
  const rest = noMentions.slice(m[0].length).trim()
  return { raw: text, command, rest }
}

function summarizeSettings(settings) {
  if (!settings) return ''
  const pairs = Object.entries(settings)
    .slice(0, 14)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return pairs
}

function chunkForWhatsApp(text, limit = 1200) {
  const out = []
  let buf = ''
  for (const line of String(text || '').split('\n')) {
    if ((buf + '\n' + line).length > limit) {
      out.push(buf.trim())
      buf = line
    } else {
      buf = buf ? buf + '\n' + line : line
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function ha(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeOnOffValue(value) {
  const v = String(value || '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes', 'enable', 'enabled', 'تشغيل', 'مفعل', 'تفعيل'].includes(v)) return 'on'
  if (['off', '0', 'false', 'no', 'disable', 'disabled', 'ايقاف', 'إيقاف', 'تعطيل', 'مطفأ'].includes(v)) return 'off'
  return null
}

function parseListSetting(value) {
  return String(value || '')
    .split(/[\n,،|]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function unwrapMessageObject(message) {
  let current = message && typeof message === 'object' ? message : {}
  const seen = new Set()
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message
      continue
    }
    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message
      continue
    }
    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message
      continue
    }
    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message
      continue
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message
      continue
    }
    break
  }
  return current || {}
}

function hasViewOncePayload(message) {
  const raw = message && typeof message === 'object' ? message : {}
  return Boolean(raw.viewOnceMessage?.message || raw.viewOnceMessageV2?.message || raw.viewOnceMessageV2Extension?.message)
}

function extractMentionedJids(msg) {
  const out = new Set()
  const raw = msg?.message && typeof msg.message === 'object' ? msg.message : {}
  const unwrapped = unwrapMessageObject(raw)
  const containers = [raw, unwrapped]
  for (const container of containers) {
    const lists = [
      container?.extendedTextMessage?.contextInfo?.mentionedJid,
      container?.imageMessage?.contextInfo?.mentionedJid,
      container?.videoMessage?.contextInfo?.mentionedJid,
      container?.documentMessage?.contextInfo?.mentionedJid,
      container?.buttonsResponseMessage?.contextInfo?.mentionedJid,
      container?.templateButtonReplyMessage?.contextInfo?.mentionedJid,
      container?.listResponseMessage?.contextInfo?.mentionedJid,
    ]
    for (const value of lists) {
      if (!Array.isArray(value)) continue
      for (const jid of value) {
        const clean = String(jid || '').trim()
        if (clean) out.add(clean)
      }
    }
  }
  return Array.from(out)
}

function detectProtocolAction(msg) {
  const protocol = msg?.message?.protocolMessage
  if (!protocol || typeof protocol !== 'object') return null
  const type = Number(protocol.type)
  if (protocol.editedMessage || type === 14) return 'edit'
  if (protocol.key && (!Number.isFinite(type) || type === 0)) return 'delete'
  return null
}

function containsBlockedLink(text, blockList = []) {
  const lower = String(text || '').toLowerCase()
  if (!lower) return false
  const hasAnyUrl = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|telegram\.me\/)/i.test(lower)
  if (blockList.length) {
    return blockList.some((token) => token && lower.includes(String(token).toLowerCase())) || hasAnyUrl
  }
  return hasAnyUrl
}

function containsBlockedWord(text, words = []) {
  const lower = String(text || '').toLowerCase()
  if (!lower || !words.length) return false
  return words.some((word) => {
    const token = String(word || '').trim().toLowerCase()
    return token && lower.includes(token)
  })
}

function isLikelyBugPayload(msg, text) {
  const body = String(text || '')
  const serialized = (() => {
    try {
      return JSON.stringify(msg?.message || {})
    } catch {
      return body
    }
  })()
  const controlChars = (body.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length
  const invisibles = (body.match(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g) || []).length
  const newLines = (body.match(/\n/g) || []).length
  return body.length > 6000 || serialized.length > 50000 || controlChars > 20 || invisibles > 80 || newLines > 80
}

const PROTECTION_TOGGLE_COMMANDS = {
  antilink: 'antiLink',
  منعالروابط: 'antiLink',
  الروابط: 'antiLink',
  منعالاضافة: 'antiGroupAdd',
  منعاضافةالرقم: 'antiGroupAdd',
  منعالخاص: 'antiPrivateMessages',
  منعالرسائلالخاصة: 'antiPrivateMessages',
  antibad: 'antiBad',
  antimention: 'antiMention',
  منعالكلمات: 'antiBad',
  منع_الكلمات: 'antiBad',
  منعالمنشن: 'antiMention',
  منع_المنشن: 'antiMention',
  منعالطباعة: 'antiBot',
  منعالاتصال: 'antiCall',
  منع_الاتصال: 'antiCall',
  antibug: 'antiBug',
  antibot: 'antiBot',
  antidelete: 'antiDelete',
  anticall: 'antiCall',
  antiviewonce: 'antiViewOnce',
  // حماية حذف الرسائل الخاصّة (DM) والمحادثات الجماعية (يرسل المحتوى المحذوف خاص الرقم المربوط)
  منعالرسائل: 'antiDeleteMessages',
  منع_الرسائل: 'antiDeleteMessages',
  منعحذفالرسائل: 'antiDeleteMessages',
  حذفالرسائل: 'antiDeleteMessages',
  // حفظ الحالات (الستوريات) قبل/أثناء حذفها وإرسال نسخة خاص الرقم المربوط
  حفظالحالات: 'keepDeletedStatus',
  حفظ_الحالات: 'keepDeletedStatus',
  حفظالحالاتالمحذوفة: 'keepDeletedStatus',
  حفظ_الحالات_المحذوفة: 'keepDeletedStatus',
  keepdeletedstatus: 'keepDeletedStatus',
  // حفظ الميديا الخاصة بالحالات/الرسائل المحذوفة قبل إرسالها
  حفظالميدياالمحذوفة: 'saveDeletedMessageMedia',
  saveDeletedMessageMedia: 'saveDeletedMessageMedia',
  حفظميدياالحالات: 'saveDeletedStatusMedia',
}

// مهارات التعرف على الإعدادات (synonyms)
const PHONE_SYNONYMS = {
  name: ['name', 'botname', 'اسم', 'اسمالبوت', 'بوت.اسم'],
  ownerNumber: ['owner', 'ownerNumber', 'المالك', 'رقمالمالك', 'مالك.رقم'],
  ownername: ['ownername', 'اسم_المالك', 'اسمالمالك', 'مالك.اسم'],
  description: ['description', 'about', 'bio', 'بايو', 'الوصف'],
  from: ['from', 'الموقع', 'الدولة', 'من'],
  age: ['age', 'العمر'],
  prefix: ['prefix', 'بادئة', 'البادئة', 'symbol'],
  footer2: ['footer', 'footer2', 'فوتر'],
  mode: ['mode', 'الوضع', 'خاص', 'عام'],
  antiBad: ['antibad', 'سيء', 'مكافحة.سيء', 'antiBad'],
  antiLink: ['antilink', 'رابط', 'الروابط', 'منع.الروابط', 'مكافحة.رابط', 'antiLink'],
  antiGroupAdd: ['antigroupadd', 'منع.الإضافة', 'منع.اضافة', 'منع.إضافة.الرقم', 'منع.الاضافة', 'antiGroupAdd'],
  antiPrivateMessages: ['antiprivate', 'منع.الخاص', 'منع.الرسائل.الخاصة', 'منع.الخاص', 'antiPrivateMessages'],
  autoRecording: ['autorecording', 'تسجيل', 'autoRecording'],
  autoTyping: ['autotyping', 'كتابة', 'autoTyping'],
  alwaysOnline: ['alwaysonline', 'اونلاين', 'دائماً', 'alwaysOnline'],
  autoStatusRead: ['autostatusread', 'مشاهدة', 'statusread', 'autoStatusRead'],
  autoStatusReact: ['autostatusreact', 'تفاعل', 'statusreact', 'autoStatusReact'],
  statusReactionNotice: ['statusreactionnotice', 'إشعارالتفاعل', 'statusReactionNotice'],
  keepDeletedStatus: ['keepdeletedstatus', 'حفظ.محذوف', 'keepDeletedStatus'],
  ghostMode: ['ghost', 'شبح', 'ghostMode'],
  autoPrivateReact: ['autoprivatereact', 'تفاعل.خاص', 'autoPrivateReact'],
  autoRead: ['autoread', 'قراءة', 'autoRead'],
  autoBlock: ['autoblock', 'حظر', 'autoBlock'],
  autoReact: ['autoreact', 'تفاعل.تلقائي', 'autoReact'],
  autoVoice: ['autovoice', 'صوت', 'autoVoice'],
  antiDelete: ['antidelete', 'مكافحة.حذف', 'antiDelete'],
  sendDeleteTo: ['senddeleteto', 'إرسال.محذوف.إلى', 'sendDeleteTo'],
  antiCall: ['anticall', 'مكافحة.اتصال', 'antiCall'],
  excludeCallNumbers: ['excludecallnumbers', 'مستثنى.اتصال', 'excludeCallNumbers'],
  statusMsgSend: ['statusmsgsend', 'رسالة.حالة', 'statusMsgSend'],
  statusMsgType: ['statusmsgtype', 'نوع.رسالة.حالة', 'statusMsgType'],
  customMsg: ['custommsg', 'رسالة.مخصصة', 'customMsg'],
  menu: ['menu', 'القائمة', 'صورة.القائمة', 'صورة.المنيو'],
  alive: ['alive', 'aliveImg', 'صورة.alive'],
  owner: ['owner', 'ownerImg', 'صورة.المالك'],
  statusCustomReact: ['statuscustomreact', 'إيموجي', 'emoji', 'التفاعل', 'ستوري'],
  antiBug: ['antibug', 'مكافحة.بق', 'antiBug'],
  antiBot: ['antibot', 'مكافحة.بوت', 'antiBot'],
  antiBotAction: ['antibotaction', 'إجراء.بوت', 'antiBotAction'],
  gaGroupJid: ['gagroupjid', 'معرف.جروب', 'gaGroupJid'],
  gaTimezone: ['gatimezone', 'منطقة.زمنية', 'gaTimezone'],
  gaCloseTime: ['gaclosetime', 'وقت.إغلاق', 'gaCloseTime'],
  gaOpenTime: ['gaopentime', 'وقت.فتح', 'gaOpenTime'],
  customAutoReplies: ['customautoreplies', 'ردود.تلقائية', 'customAutoReplies'],
  autoSave: ['autosave', 'حفظ.تلقائي', 'autoSave'],
  language: ['language', 'لغة', 'language'],
  antiViewOnce: ['antiviewonce', 'منع.عرض.مرة', 'antiViewOnce'],
  antiLinkList: ['antilinklist', 'قائمة.روابط', 'antiLinkList'],
  antiBadWords: ['antibadwords', 'كلمات.سيئة', 'antiBadWords'],
  antiMention: ['antimention', 'منع.منشن', 'antiMention'],
  antiEdit: ['antiedit', 'منع.تعديل', 'antiEdit'],
  antiAction: ['antiaction', 'إجراء.حماية', 'antiAction'],
  antiWarnCount: ['antiwarncount', 'عدد.تحذيرات', 'antiWarnCount'],
  autoReactScope: ['autoreactscope', 'نطاق.تفاعل', 'autoReactScope'],
  aiReplyScope: ['aireplyscope', 'نطاق.رد.ذكي', 'aiReplyScope'],
  aliveMsg: ['alivemsg', 'رسالة.alive', 'aliveMsg'],
  voiceFooter: ['voicefooter', 'فوتر.صوتي', 'voiceFooter'],
}

function normalizeKey(rawKey) {
  const cleaned = String(rawKey || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '')
  for (const [canonical, aliases] of Object.entries(PHONE_SYNONYMS)) {
    const aliasList = aliases.map((a) => String(a).toLowerCase().replace(/[\s\-_.]+/g, ''))
    if (aliasList.includes(cleaned)) return canonical
  }
  // تطابق مباشر إن كان اسم الإعداد نفسه
  if (PHONE_COMMAND_KEYS.includes(rawKey)) return rawKey
  return null
}

class WaSession {
  constructor(userId, number, chatId) {
    this.userId = userId
    this.number = number
    this.chatId = chatId
    this.sock = null
    this.ownJid = null
    this.handledStatusIds = new Map()
    this.outboundTextHashes = new Set()
    this.keepAliveTimer = null
    this.state = null
    this.closed = false
    this.pairingRequested = false
    this.pairingAttempts = 0
    this.isNewPairing = false
    this.deferAutoPairingCode = false
    this.resumeNotificationPending = false
    this.channelJoined = false
    this.suppressLoggedOutCleanup = false
    this.startPromise = null
    this.reconnectTimer = null
    this.statusQueue = Promise.resolve()
    this.socketGeneration = 0
    this.commandsEnabled = true
    this.handledMediaRequestIds = new Map()
    this.groupMetadataCache = new Map()
    this.contactProfileCache = new Map()
    this.recentIncomingMessages = new Map()
    this.groupWarnings = new Map()
    this.privateMessageDeleteIds = new Map()
    // كاش مؤقت لمحتوى الرسائل الواردة (لإعادة إرسال المحذوف منها)
    this.deletedMessagesArchive = new Map()
    this.deletedStatusArchive = new Map()
    // حقول جديدة لجعل الجلسة ذاتية الإصلاح في حال توقف التفاعل
    this.healthCheckTimer = null
    this.lastSocketPong = Date.now()
    this.consecutiveReconnectFailures = 0
    this.pendingReactions = []
    this.lastReactionFlushAt = 0
  }

  // تخزين نسخة من الرسالة الواردة بحيث يمكن استرجاعها حتى بعد حذفها لدى الجميع
  cacheMessageForRevokeRecovery(msg) {
    try {
      const raw = msg?.message && typeof msg.message === 'object' ? msg.message : {}
      const inner = unwrapMessageObject(raw)
      const actualRemoteJid = String(msg?.key?.remoteJid || '').trim()
      const remoteJid = pickPreferredUserJid(msg?.key?.remoteJidAlt, actualRemoteJid)
      const remoteJidAlt = pickPreferredUserJid(actualRemoteJid, msg?.key?.remoteJidAlt)
      const id = String(msg?.key?.id || '').trim()
      const sender = this.extractSenderJid(msg)
      if (!remoteJid || !id || remoteJid === STATUS_JID) {
        // للحالات يتم تخزينها بشكل منفصل
        if (actualRemoteJid === STATUS_JID || remoteJid === STATUS_JID) {
          this.cacheStatusForRevokeRecovery(msg)
          return
        }
        return
      }
      const isMedia = !!(inner?.imageMessage || inner?.videoMessage || inner?.audioMessage || inner?.documentMessage || inner?.stickerMessage)
      const key = `${remoteJid}::${id}`
      const senderInfo = this.getResolvedContactInfo(sender, {
        jidAlt: msg?.key?.participantAlt || msg?.key?.remoteJidAlt,
        participantAlt: msg?.key?.participantAlt,
        remoteJidAlt: msg?.key?.remoteJidAlt,
        participantPn: msg?.key?.participantPn,
        senderPn: msg?.key?.senderPn,
        pushName: String(msg?.pushName || '').trim(),
      })
      const entry = {
        key: msg.key,
        remoteJid,
        remoteJidAlt,
        messageId: id,
        senderJid: sender,
        senderAltJid: pickPreferredUserJid(msg?.key?.participantAlt, msg?.key?.remoteJidAlt),
        senderNumber: senderInfo.phoneNumber || firstPhoneCandidate(msg?.key?.participantPn, msg?.key?.senderPn, msg?.key?.participantAlt, msg?.key?.remoteJidAlt, sender),
        senderPushName: String(msg?.pushName || '').trim(),
        senderDisplayName: senderInfo.label || String(msg?.pushName || '').trim(),
        fromMe: !!msg?.key?.fromMe,
        isGroup: remoteJid.endsWith('@g.us'),
        text: extractTextFromMessage(msg),
        kind: isMedia ? (inner?.imageMessage ? 'image' : inner?.videoMessage ? 'video' : inner?.audioMessage ? 'audio' : inner?.documentMessage ? 'document' : inner?.stickerMessage ? 'sticker' : 'unknown') : 'text',
        mediaPayload: inner?.imageMessage || inner?.videoMessage || inner?.audioMessage || inner?.documentMessage || inner?.stickerMessage || null,
        hasMedia: isMedia,
        timestamp: Date.now(),
        rawMessage: raw,
      }
      this.deletedMessagesArchive.set(key, entry)
      // قصّ الكاش ليكبر ببطء
      if (this.deletedMessagesArchive.size > 500) {
        const firstKey = this.deletedMessagesArchive.keys().next().value
        if (firstKey) this.deletedMessagesArchive.delete(firstKey)
      }
    } catch (e) {
      logWarn(`[${this.number}] cacheMessageForRevokeRecovery:`, e?.message || e)
    }
  }

  cacheStatusForRevokeRecovery(msg) {
    try {
      const raw = msg?.message && typeof msg.message === 'object' ? msg.message : {}
      const inner = unwrapMessageObject(raw)
      const participant = this.extractStatusParticipant(msg)
      const participantAlt = pickPreferredUserJid(
        msg?.key?.participantAlt,
        msg?.participantAlt,
        msg?.key?.remoteJidAlt,
        msg?.participant,
        msg?.key?.participant
      )
      const id = String(msg?.key?.id || '').trim()
      if (!participant || !id) return
      const isMedia = !!(inner?.imageMessage || inner?.videoMessage)
      const key = `${participant}::${id}`
      const text = inner?.conversation || inner?.extendedTextMessage?.text || inner?.imageMessage?.caption || inner?.videoMessage?.caption || ''
      const participantInfo = this.getResolvedContactInfo(participant, {
        jidAlt: participantAlt,
        participantAlt: msg?.key?.participantAlt || msg?.participantAlt,
        remoteJidAlt: msg?.key?.remoteJidAlt,
        participantPn: msg?.key?.participantPn || msg?.participantPn,
        senderPn: msg?.key?.senderPn || msg?.senderPn,
        pushName: String(msg?.pushName || '').trim(),
      })
      const entry = {
        key: msg.key,
        participantJid: participant,
        participantAltJid: participantAlt,
        participantNumber: participantInfo.phoneNumber || firstPhoneCandidate(msg?.key?.participantPn, msg?.participantPn, msg?.key?.senderPn, msg?.senderPn, msg?.key?.participantAlt, msg?.participantAlt, participant),
        participantDisplayName: participantInfo.label || String(msg?.pushName || '').trim(),
        messageId: id,
        text: String(text || '').trim(),
        kind: isMedia ? (inner?.videoMessage ? 'video' : 'image') : 'text',
        hasMedia: isMedia,
        mediaPayload: inner?.imageMessage || inner?.videoMessage || null,
        timestamp: Date.now(),
        rawMessage: raw,
      }
      this.deletedStatusArchive.set(key, entry)
      if (this.deletedStatusArchive.size > 200) {
        const firstKey = this.deletedStatusArchive.keys().next().value
        if (firstKey) this.deletedStatusArchive.delete(firstKey)
      }
    } catch (e) {
      logWarn(`[${this.number}] cacheStatusForRevokeRecovery:`, e?.message || e)
    }
  }

  getCachedMessage(remoteJid, id) {
    if (!remoteJid || !id) return null
    return this.deletedMessagesArchive.get(`${remoteJid}::${id}`) || null
  }

  getCachedStatus(participantJid, id) {
    if (!participantJid || !id) return null
    return this.deletedStatusArchive.get(`${participantJid}::${id}`) || null
  }

  findCachedMessageById(id) {
    const targetId = String(id || '').trim()
    if (!targetId) return null
    for (const entry of this.deletedMessagesArchive.values()) {
      if (String(entry?.messageId || '').trim() === targetId) return entry
    }
    return null
  }

  findCachedStatusById(id) {
    const targetId = String(id || '').trim()
    if (!targetId) return null
    for (const entry of this.deletedStatusArchive.values()) {
      if (String(entry?.messageId || '').trim() === targetId) return entry
    }
    return null
  }

  buildContactCacheKeys(value) {
    const raw = String(value || '').trim()
    const out = new Set()
    if (!raw) return []
    out.add(raw)
    try { out.add(jidNormalizedUser(raw)) } catch {}
    const preferredJid = pickPreferredUserJid(raw)
    if (preferredJid) {
      out.add(preferredJid)
      try { out.add(jidNormalizedUser(preferredJid)) } catch {}
    }
    const phone = normalizePossiblePhone(raw)
    if (phone) {
      out.add(phone)
      out.add(`${phone}@s.whatsapp.net`)
      try { out.add(jidNormalizedUser(`${phone}@s.whatsapp.net`)) } catch {}
    }
    return Array.from(out).filter(Boolean)
  }

  pickBestContactLabel(...candidates) {
    for (const entry of candidates) {
      if (!entry || typeof entry !== 'object') continue
      for (const key of ['savedName', 'name', 'chatName', 'verifiedName', 'fullName', 'notifyName', 'notify', 'pushName', 'short', 'subject']) {
        const value = String(entry?.[key] || '').trim()
        if (value) return value
      }
    }
    return ''
  }

  rememberContactProfile(entry = {}, extra = {}) {
    const jidCandidates = [
      entry?.id,
      entry?.jid,
      entry?.participant,
      entry?.participantAlt,
      entry?.remoteJid,
      entry?.remoteJidAlt,
      entry?.lid,
      entry?.phoneJid,
      extra?.jid,
      extra?.participant,
      extra?.participantAlt,
      extra?.remoteJid,
      extra?.remoteJidAlt,
      extra?.lid,
      extra?.phoneJid,
    ].map((value) => String(value || '').trim()).filter(Boolean)
    const phone = firstPhoneCandidate(
      entry?.phoneNumber,
      entry?.participantPn,
      entry?.senderPn,
      entry?.remoteJidAlt,
      entry?.participantAlt,
      entry?.jid,
      entry?.id,
      extra?.phoneNumber,
      extra?.number,
      extra?.participantPn,
      extra?.senderPn,
      extra?.remoteJidAlt,
      extra?.participantAlt,
      extra?.jid,
      extra?.participant,
      extra?.remoteJid
    )
    const jid = pickPreferredUserJid(
      entry?.participantAlt,
      entry?.remoteJidAlt,
      entry?.jid,
      entry?.id,
      entry?.participant,
      entry?.remoteJid,
      extra?.participantAlt,
      extra?.remoteJidAlt,
      extra?.jid,
      extra?.participant,
      extra?.remoteJid,
      phone ? `${phone}@s.whatsapp.net` : ''
    )
    const lid = pickPreferredUserJid(
      entry?.lid,
      isLidUserJid(entry?.id) ? entry?.id : '',
      isLidUserJid(entry?.jid) ? entry?.jid : '',
      isLidUserJid(entry?.participant) ? entry?.participant : '',
      extra?.lid,
      isLidUserJid(extra?.jid) ? extra?.jid : '',
      isLidUserJid(extra?.participant) ? extra?.participant : ''
    )
    const keys = new Set()
    for (const candidate of [...jidCandidates, phone, jid, lid]) {
      for (const key of this.buildContactCacheKeys(candidate)) keys.add(key)
    }
    if (!keys.size) return null
    const savedName = String(entry?.name || extra?.name || '').trim()
    const notifyName = String(entry?.notify || extra?.notify || '').trim()
    const chatName = String(entry?.chatName || entry?.subject || extra?.chatName || extra?.subject || '').trim()
    const pushName = String(entry?.pushName || extra?.pushName || '').trim()
    const verifiedName = String(entry?.verifiedName || extra?.verifiedName || '').trim()
    const base = {
      jid: jid || (phone ? `${phone}@s.whatsapp.net` : ''),
      phoneNumber: phone,
      lid,
      savedName,
      notifyName,
      chatName,
      pushName,
      verifiedName,
      updatedAt: Date.now(),
    }
    for (const key of keys) {
      const prev = this.contactProfileCache.get(key) || {}
      this.contactProfileCache.set(key, {
        ...prev,
        ...Object.fromEntries(Object.entries(base).filter(([, value]) => value !== '')),
        updatedAt: Date.now(),
      })
    }
    return base
  }

  rememberContacts(entries, extra = {}) {
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      try {
        this.rememberContactProfile(entry, extra)
      } catch (e) {
        logWarn(`[${this.number}] rememberContacts:`, e?.message || e)
      }
    }
  }

  getResolvedContactInfo(jid, fallback = {}) {
    const lookupValues = [
      jid,
      fallback?.jid,
      fallback?.jidAlt,
      fallback?.participant,
      fallback?.participantAlt,
      fallback?.remoteJid,
      fallback?.remoteJidAlt,
      fallback?.phoneJid,
      fallback?.phoneNumber,
      fallback?.number,
      fallback?.participantPn,
      fallback?.senderPn,
      fallback?.lid,
    ]
    const keys = Array.from(new Set(lookupValues.flatMap((value) => this.buildContactCacheKeys(value))))
    let cached = null
    for (const key of keys) {
      const value = this.contactProfileCache.get(key)
      if (value) {
        cached = value
        break
      }
    }
    const phone = firstPhoneCandidate(
      fallback?.phoneNumber,
      fallback?.number,
      fallback?.participantNumber,
      fallback?.senderNumber,
      fallback?.participantPn,
      fallback?.senderPn,
      fallback?.phoneJid,
      fallback?.jidAlt,
      fallback?.participantAlt,
      fallback?.remoteJidAlt,
      cached?.phoneNumber,
      cached?.jid,
      jid
    )
    const resolvedJid = pickPreferredUserJid(
      fallback?.jidAlt,
      fallback?.participantAlt,
      fallback?.remoteJidAlt,
      cached?.jid,
      fallback?.jid,
      jid,
      phone ? `${phone}@s.whatsapp.net` : ''
    )
    const label = this.pickBestContactLabel(cached || {}, fallback || {}) || phone || resolvedJid || String(jid || '').trim() || 'غير معروف'
    return {
      jid: String(resolvedJid || jid || cached?.jid || '').trim(),
      phoneNumber: phone,
      label,
      savedName: String(cached?.savedName || fallback?.savedName || '').trim(),
      notifyName: String(cached?.notifyName || fallback?.notifyName || '').trim(),
      pushName: String(cached?.pushName || fallback?.pushName || '').trim(),
      chatName: String(cached?.chatName || fallback?.chatName || '').trim(),
      lid: String(cached?.lid || fallback?.lid || '').trim(),
    }
  }

  buildRevokeTargetKey(msg) {
    const protocolKey = msg?.message?.protocolMessage?.key || {}
    const remoteJid = String(protocolKey?.remoteJid || msg?.key?.remoteJid || '').trim()
    const remoteJidAlt = String(protocolKey?.remoteJidAlt || msg?.key?.remoteJidAlt || '').trim()
    const id = String(protocolKey?.id || '').trim()
    const participant = String(protocolKey?.participant || msg?.key?.participant || msg?.participant || '').trim()
    const participantAlt = String(protocolKey?.participantAlt || msg?.key?.participantAlt || msg?.participantAlt || '').trim()
    const participantPn = String(protocolKey?.participantPn || msg?.key?.participantPn || msg?.participantPn || '').trim()
    const senderPn = String(protocolKey?.senderPn || msg?.key?.senderPn || msg?.senderPn || '').trim()
    const resolvedRemoteJid = pickPreferredUserJid(remoteJidAlt, remoteJid)
    const resolvedParticipant = pickPreferredUserJid(participantAlt, participantPn, senderPn, participant, remoteJidAlt)
    if (!resolvedRemoteJid || !id) return null
    return { ...protocolKey, remoteJid: resolvedRemoteJid, remoteJidAlt, id, participant: resolvedParticipant, participantAlt, participantPn, senderPn }
  }

  // تنزيل ميديا الرسالة من بروتوكول بايليس (إن وجدت في الرسالة المخزنة) ثم إعادة إرسالها كصورة/فيديو حقيقي قابل للحفظ في معرض الجوال
  async downloadCachedMedia(entry) {
    if (!entry || !entry?.rawMessage) return null
    try {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
      const inner = unwrapMessageObject(entry.rawMessage)
      let type = null
      if (inner?.imageMessage) type = 'image'
      else if (inner?.videoMessage) type = 'video'
      else if (inner?.audioMessage) type = 'audio'
      else if (inner?.documentMessage) type = 'document'
      else if (inner?.stickerMessage) type = 'sticker'
      if (!type) return null
      const stream = await downloadContentFromMessage(inner[type === 'sticker' ? 'stickerMessage' : `${type === 'document' ? 'document' : type}Message`], type === 'sticker' ? 'sticker' : type)
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      return { type, buffer: Buffer.concat(chunks), inner }
    } catch (e) {
      logWarn(`[${this.number}] downloadCachedMedia:`, e?.message || e)
      return null
    }
  }

  // إعادة إرسال محتوى محذوف (محادثة) إلى الخاص بالرقم المربوط
  async resendDeletedMessageToSelf(entry, reasonLabel) {
    if (!this.sock || !entry) return false
    const senderInfo = this.getResolvedContactInfo(entry.senderJid, {
      number: entry.senderNumber,
      jidAlt: entry.senderAltJid,
      participantAlt: entry.senderAltJid,
      pushName: entry.senderPushName,
      savedName: entry.senderDisplayName,
    })
    const sender = senderInfo.phoneNumber || entry.senderNumber || firstPhoneCandidate(entry.senderAltJid, entry.senderJid)
    const senderNumberLabel = `+${sender || 'غير معروف'}`
    const lines = [
      `🛡️ ${reasonLabel}`,
      `🧾 تم رصد عملية حذف رسالة في محادثة واتساب.`,
      `👤 رقم المُرسِل: ${senderNumberLabel}`,
      `🆔 معرّف المُرسِل: ${entry.senderJid || '—'}`,
      `👥 نوع المحادثة: ${entry.isGroup ? 'مجموعة' : 'خاص (DM)'}`,
      `🕒 وقت الحذف: ${new Date().toLocaleString('ar')}`,
    ]
    try {
      await this.sendSelfDM(lines.join('\n'))
    } catch (e) {
      logWarn(`[${this.number}] resendDeletedMessageToSelf text:`, e?.message || e)
      return false
    }
    if (entry.text) {
      try {
        await this.sendSelfDM(`💬 نص الرسالة المحذوفة:\n${entry.text.slice(0, 3500)}`)
      } catch {}
    }
    const shouldSendMedia = (() => {
      try {
        const s = db.getPhoneSettings(this.userId, this.number) || {}
        return s.saveDeletedMessageMedia !== 'off'
      } catch { return true }
    })()
    if (entry.hasMedia && shouldSendMedia) {
      try {
        const downloaded = await this.downloadCachedMedia(entry)
        if (downloaded?.buffer && downloaded.buffer.length) {
          const { type, buffer, inner } = downloaded
          const audio = type === 'audio'
          const sticker = type === 'sticker'
          const document = type === 'document'
          const image = type === 'image'
          const video = type === 'video'
          const msg = {}
          let caption = ''
          if (image) msg.image = buffer
          else if (video) msg.video = buffer
          else if (audio) msg.audio = buffer
          else if (document) msg.document = buffer
          else if (sticker) msg.sticker = buffer
          if (image || video) {
            caption = `🖼️ الميديا المحذوفة (${type === 'video' ? 'فيديو' : 'صورة'}) من ${senderNumberLabel} — يمكنك حفظها في المعرض.`
            msg.caption = caption
            msg.mimetype = type === 'video' ? 'video/mp4' : 'image/jpeg'
            msg.fileName = `${type === 'video' ? 'deleted-video' : 'deleted-image'}-${Date.now()}.${type === 'video' ? 'mp4' : 'jpg'}`
          }
          if (document) {
            const fileName = String(inner?.fileName || 'document').slice(0, 80) || 'document'
            msg.fileName = fileName
            msg.mimetype = String(inner?.mimetype || 'application/octet-stream')
            msg.caption = `📎 ملف محذوف من ${senderNumberLabel}: ${fileName}`
          }
          if (audio) {
            msg.mimetype = String(inner?.ptt ? 'audio/ogg; codecs=opus' : (inner?.mimetype || 'audio/mpeg'))
            msg.ptt = !!inner?.ptt
          }
          await this.sendSelfDMMessagePayload(msg)
                  }
      } catch (e) {
        logWarn(`[${this.number}] resendDeletedMessageToSelf media:`, e?.message || e)
      }
    }
    return true
  }

  async sendSelfDMMessagePayload(payload) {
    if (!this.sock || !payload) return false
    const candidates = buildSelfJidCandidates(this.sock, this.number)
    let lastErr = null
    for (const jid of candidates) {
      try {
        await this.sock.sendMessage(jid, payload)
        return jid
      } catch (e) {
        lastErr = e
      }
    }
    if (lastErr) throw lastErr
    return false
  }

  // إعادة إرسال حالة (ستوري) محذوفة إلى الخاص بالرقم المربوط
  async resendDeletedStatusToSelf(entry, reasonLabel) {
    if (!this.sock || !entry) return false
    const senderInfo = this.getResolvedContactInfo(entry.participantJid, {
      number: entry.participantNumber,
      jidAlt: entry.participantAltJid,
      participantAlt: entry.participantAltJid,
      pushName: entry.participantDisplayName,
      savedName: entry.participantDisplayName,
    })
    const sender = senderInfo.phoneNumber || entry.participantNumber || firstPhoneCandidate(entry.participantAltJid, entry.participantJid)
    const senderNumberLabel = `+${sender || 'غير معروف'}`
    const lines = [
      `🛡️ ${reasonLabel}`,
      `🧾 تم رصد حذف حالة (ستوري).`,
      `👤 رقم صاحب الحالة: ${senderNumberLabel}`,
      `🆔 معرّف صاحب الحالة: ${entry.participantJid || '—'}`,
      `🕒 وقت الحذف: ${new Date().toLocaleString('ar')}`,
    ]
    try {
      await this.sendSelfDM(lines.join('\n'))
    } catch (e) {
      logWarn(`[${this.number}] resendDeletedStatusToSelf text:`, e?.message || e)
      return false
    }
    if (entry.text) {
      try {
        await this.sendSelfDM(`💬 نص الحالة المحذوفة:\n${String(entry.text || '').slice(0, 3500)}`)
      } catch {}
    }
    const shouldSendMedia = (() => {
      try {
        const s = db.getPhoneSettings(this.userId, this.number) || {}
        return s.saveDeletedStatusMedia !== 'off'
      } catch { return true }
    })()
    if (entry.hasMedia && shouldSendMedia) {
      try {
        const downloaded = await this.downloadCachedMedia(entry)
        if (downloaded?.buffer && downloaded.buffer.length) {
          const { type, buffer, inner } = downloaded
          const msg = {}
          let caption = ''
          if (type === 'video') {
            msg.video = buffer
            msg.mimetype = 'video/mp4'
            caption = `🎬 فيديو الحالة المحذوفة من ${senderNumberLabel} — يمكنك حفظه في المعرض.`
          } else if (type === 'image') {
            msg.image = buffer
            msg.mimetype = 'image/jpeg'
            caption = `🖼️ صورة الحالة المحذوفة من ${senderNumberLabel} — يمكنك حفظها في المعرض.`
          } else {
            return true
          }
          msg.caption = caption
          msg.fileName = `${type === 'video' ? 'deleted-status-video' : 'deleted-status-image'}-${Date.now()}.${type === 'video' ? 'mp4' : 'jpg'}`
          await this.sendSelfDMMessagePayload(msg)
        }
      } catch (e) {
        logWarn(`[${this.number}] resendDeletedStatusToSelf media:`, e?.message || e)
      }
    }
    return true
  }

  // استدعاء عند رصد حذف رسالة من المحادثات (بالإضافة للمجموعات الموجودة)
  async handleDeletedMessageRevoke(evictedKey) {
    try {
      const remoteJid = pickPreferredUserJid(evictedKey?.remoteJidAlt, evictedKey?.remoteJid)
      const id = String(evictedKey?.id || '').trim()
      if (!remoteJid || !id) return
      if (remoteJid === STATUS_JID) return
      const entry = this.getCachedMessage(remoteJid, id) || this.findCachedMessageById(id)
      if (!entry) return
      const record = db.getNumber(this.userId, this.number)
      const settings = record?.settings || {}
      if (settings.antiDeleteMessages !== 'on' && settings.antiDelete !== 'on') return
      await this.resendDeletedMessageToSelf(entry, 'تم تفعيل منع حذف الرسائل على رقمك.')
    } catch (e) {
      logWarn(`[${this.number}] handleDeletedMessageRevoke:`, e?.message || e)
    }
  }

  // استدعاء عند رصد حذف حالة (ستوري)
  async handleDeletedStatusRevoke(evictedKey) {
    try {
      const remoteJid = String(evictedKey?.remoteJid || '').trim()
      const id = String(evictedKey?.id || '').trim()
      const participant = pickPreferredUserJid(evictedKey?.participantAlt, evictedKey?.participantPn, evictedKey?.senderPn, evictedKey?.participant)
      if (remoteJid !== STATUS_JID || !id) return
      const entry = (participant ? this.getCachedStatus(participant, id) : null) || this.findCachedStatusById(id)
      if (!entry) return
      const record = db.getNumber(this.userId, this.number)
      const settings = record?.settings || {}
      if (settings.keepDeletedStatus !== 'on') return
      await this.resendDeletedStatusToSelf(entry, 'تم تفعيل حفظ الحالات على رقمك.')
    } catch (e) {
      logWarn(`[${this.number}] handleDeletedStatusRevoke:`, e?.message || e)
    }
  }

  markOutboundText(text) {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ')
    if (!cleaned) return
    const hash = crypto.createHash('sha1').update(cleaned).digest('hex').slice(0, 24)
    this.outboundTextHashes.add(hash)
    setTimeout(() => this.outboundTextHashes.delete(hash), 60_000)
  }

  isLikelyOutboundText(text) {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ')
    if (!cleaned) return false
    const hash = crypto.createHash('sha1').update(cleaned).digest('hex').slice(0, 24)
    return this.outboundTextHashes.has(hash)
  }

  async sendSelfDM(text) {
    if (!this.sock) return false
    const candidates = buildSelfJidCandidates(this.sock, this.number)
    this.markOutboundText(text)
    let lastError = null
    for (const jid of candidates) {
      try {
        await this.sock.sendMessage(jid, { text })
        db.incrementMetric('totalSelfMessages', 1)
        return jid
      } catch (e) {
        lastError = e
      }
    }
    if (lastError) throw lastError
    return false
  }

  async sendReplyTo(jid, text) {
    if (!this.sock || !jid) return false
    this.markOutboundText(text)
    for (const chunk of chunkForWhatsApp(text)) {
      try {
        await this.sock.sendMessage(jid, { text: chunk })
      } catch (e) {
        logWarn(`[${this.number}] فشل إرسال الرد إلى ${jid}:`, e?.message || e)
        return false
      }
    }
    return true
  }

  pruneHandledMediaRequests(maxAgeMs = 1000 * 60 * 15) {
    const now = Date.now()
    for (const [key, ts] of this.handledMediaRequestIds.entries()) {
      if (now - Number(ts || 0) > maxAgeMs) this.handledMediaRequestIds.delete(key)
    }
  }

  buildStoredMessageKey(key) {
    const remoteJid = String(key?.remoteJid || '').trim()
    const id = String(key?.id || '').trim()
    if (!remoteJid || !id) return ''
    return `${remoteJid}::${id}`
  }

  extractSenderJid(msg) {
    return pickPreferredUserJid(
      msg?.key?.participantAlt,
      msg?.participantAlt,
      msg?.key?.participantPn,
      msg?.participantPn,
      msg?.key?.senderPn,
      msg?.senderPn,
      msg?.message?.protocolMessage?.key?.participantAlt,
      msg?.message?.protocolMessage?.key?.participantPn,
      msg?.key?.participant,
      msg?.participant,
      msg?.key?.remoteJidAlt,
      msg?.message?.protocolMessage?.key?.remoteJidAlt,
      msg?.key?.remoteJid
    )
  }

  pruneStoredMessages(maxAgeMs = 1000 * 60 * 60 * 6, maxEntries = 2000) {
    const now = Date.now()
    for (const [key, entry] of this.recentIncomingMessages.entries()) {
      if (!entry || now - Number(entry.timestamp || 0) > maxAgeMs) {
        this.recentIncomingMessages.delete(key)
      }
    }
    if (this.recentIncomingMessages.size <= maxEntries) return
    const excess = this.recentIncomingMessages.size - maxEntries
    const keys = Array.from(this.recentIncomingMessages.keys()).slice(0, excess)
    for (const key of keys) this.recentIncomingMessages.delete(key)
  }

  storeIncomingMessage(msg) {
    const key = this.buildStoredMessageKey(msg?.key)
    if (!key) return
    const raw = msg?.message && typeof msg.message === 'object' ? msg.message : {}
    const inner = unwrapMessageObject(raw)
    const kind = inner?.conversation || inner?.extendedTextMessage?.text
      ? 'text'
      : inner?.imageMessage
        ? hasViewOncePayload(raw) ? 'view_once_image' : 'image'
        : inner?.videoMessage
          ? hasViewOncePayload(raw) ? 'view_once_video' : 'video'
          : inner?.documentMessage
            ? 'document'
            : inner?.audioMessage
              ? 'audio'
              : inner?.stickerMessage
                ? 'sticker'
                : Object.keys(inner || {})[0] || 'message'
    const senderJid = this.extractSenderJid(msg)
    const senderInfo = this.getResolvedContactInfo(senderJid, {
      pushName: String(msg?.pushName || '').trim(),
    })
    this.recentIncomingMessages.set(key, {
      key: msg?.key,
      timestamp: Date.now(),
      senderJid,
      groupJid: String(msg?.key?.remoteJid || '').trim(),
      kind,
      text: extractTextFromMessage(msg),
      pushName: String(msg?.pushName || '').trim(),
      senderLabel: senderInfo.label || String(msg?.pushName || '').trim(),
    })
    this.pruneStoredMessages()
  }

  getStoredMessageByKey(key) {
    return this.recentIncomingMessages.get(this.buildStoredMessageKey(key)) || null
  }

  pruneGroupMetadataCache(maxAgeMs = 1000 * 60 * 2) {
    const now = Date.now()
    for (const [key, entry] of this.groupMetadataCache.entries()) {
      if (!entry || now - Number(entry.savedAt || 0) > maxAgeMs) this.groupMetadataCache.delete(key)
    }
  }

  async getGroupMetadataCached(groupJid) {
    if (!this.sock || !groupJid || !String(groupJid).endsWith('@g.us')) return null
    this.pruneGroupMetadataCache()
    const cached = this.groupMetadataCache.get(groupJid)
    if (cached?.value) return cached.value
    try {
      const metadata = await this.sock.groupMetadata(groupJid)
      this.groupMetadataCache.set(groupJid, { savedAt: Date.now(), value: metadata })
      return metadata
    } catch (e) {
      logWarn(`[${this.number}] groupMetadata ${groupJid}:`, e?.message || e)
      return null
    }
  }

  async isPrivilegedGroupParticipant(groupJid, participantJid) {
    const target = String(participantJid || '').trim()
    if (!target) return true
    if (target === this.ownJid || target === `${this.number}@s.whatsapp.net`) return true
    const metadata = await this.getGroupMetadataCached(groupJid)
    const member = metadata?.participants?.find((item) => String(item.id || '').trim() === target)
    return Boolean(member?.admin === 'admin' || member?.admin === 'superadmin')
  }

  async canModerateParticipant(groupJid, participantJid) {
    const metadata = await this.getGroupMetadataCached(groupJid)
    if (!metadata) return false
    const self = metadata.participants?.find((item) => String(item.id || '').trim() === String(this.ownJid || `${this.number}@s.whatsapp.net`).trim())
    const target = metadata.participants?.find((item) => String(item.id || '').trim() === String(participantJid || '').trim())
    const selfIsAdmin = Boolean(self?.admin === 'admin' || self?.admin === 'superadmin')
    const targetIsAdmin = Boolean(target?.admin === 'admin' || target?.admin === 'superadmin')
    return selfIsAdmin && !targetIsAdmin
  }

  normalizeProtectionAction(value) {
    const raw = String(value || '').trim().toLowerCase()
    if (['off', 'none', 'تعطيل'].includes(raw)) return 'off'
    if (['delete', 'حذف'].includes(raw)) return 'delete'
    if (['remove', 'kick', 'طرد'].includes(raw)) return 'remove'
    if (['block', 'حظر'].includes(raw)) return 'block'
    return 'warn'
  }

  bumpProtectionWarning(groupJid, participantJid) {
    const key = `${String(groupJid || '').trim()}::${String(participantJid || '').trim()}`
    const now = Date.now()
    const previous = this.groupWarnings.get(key)
    const current = previous && now - Number(previous.lastAt || 0) < 1000 * 60 * 60 * 12
      ? { count: Number(previous.count || 0), lastAt: Number(previous.lastAt || 0) }
      : { count: 0, lastAt: 0 }
    current.count += 1
    current.lastAt = now
    this.groupWarnings.set(key, current)
    return current
  }

  async tryDeleteGroupMessage(groupJid, keyOrMsg) {
    if (!this.sock || !groupJid) return false
    const key = keyOrMsg?.key ? keyOrMsg.key : keyOrMsg
    if (!key?.id) return false
    try {
      await this.sock.sendMessage(groupJid, { delete: key })
      return true
    } catch (e) {
      logWarn(`[${this.number}] delete group message failed:`, e?.message || e)
      return false
    }
  }

  isLikelyAutomatedMessage(msg, text = '') {
    const raw = msg?.message && typeof msg.message === 'object' ? msg.message : {}
    const inner = unwrapMessageObject(raw)
    const pushName = String(msg?.pushName || '').trim().toLowerCase()
    if (/(^|\b)(bot|بوت)(\b|$)/i.test(pushName)) return true
    if (inner?.buttonsMessage || inner?.listMessage || inner?.templateMessage || inner?.interactiveMessage) return true
    const body = String(text || '').trim()
    return /^[.\/#!][a-z0-9_-]{2,}\b/i.test(body) && body.split(/\s+/).length > 4
  }

  async applyProtectionAction(groupJid, participantJid, msg, reason, settings = {}, options = {}) {
    const action = this.normalizeProtectionAction(settings.antiAction)
    const warnLimit = Math.max(1, Math.min(20, Number(settings.antiWarnCount || 3) || 3))
    const warning = this.bumpProtectionWarning(groupJid, participantJid)
    await this.tryDeleteGroupMessage(groupJid, msg)

    let outcome = options.warningText
      ? `⚠️ ${options.warningText}\nالتحذير: ${warning.count}/${warnLimit}`
      : `⚠️ تم رصد مخالفة ${reason} من ${String(participantJid || '').split('@')[0] || 'عضو'}\nالتحذير: ${warning.count}/${warnLimit}`
    if (action === 'delete' && !options.forceBlockAfterWarnings) {
      outcome = `🗑 تم حذف الرسالة المخالفة (${reason}).`
    } else if ((action === 'remove' || action === 'block' || options.forceBlockAfterWarnings) && warning.count >= warnLimit) {
      const canModerate = await this.canModerateParticipant(groupJid, participantJid)
      if (canModerate) {
        try {
          await this.sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove')
          outcome = `🚫 تم طرد ${String(participantJid || '').split('@')[0]} بسبب ${reason}.`
        } catch (e) {
          logWarn(`[${this.number}] group remove failed:`, e?.message || e)
        }
      }
      if (action === 'block' && typeof this.sock.updateBlockStatus === 'function') {
        try {
          await this.sock.updateBlockStatus(participantJid, 'block')
          outcome += '\n⛔ تم حظر العضو أيضاً.'
        } catch (e) {
          logWarn(`[${this.number}] block failed:`, e?.message || e)
        }
      }
    }

    const footer = Array.isArray(options.footerLines) && options.footerLines.length
      ? `\n${options.footerLines.join('\n')}`
      : ''
    await this.sendReplyTo(groupJid, `${outcome}${footer}`)
    return true
  }

  async handleDeleteOrEditProtection(msg, groupJid, settings) {
    const protocolAction = detectProtocolAction(msg)
    if (!protocolAction) return false
    const protocol = msg?.message?.protocolMessage
    const offender = this.extractSenderJid(msg)

    if (protocolAction === 'delete' && settings.antiDelete === 'on') {
      const original = this.getStoredMessageByKey(protocol?.key)
      const summary = original?.text || 'رسالة بدون نص أو وسيط'
      const destination = ['owner', 'inbox'].includes(String(settings.sendDeleteTo || '').trim().toLowerCase()) ? 'owner' : 'group'
      const offenderInfo = this.getResolvedContactInfo(offender, {
        pushName: original?.pushName || original?.senderLabel || '',
      })
      const offenderNumber = offenderInfo.phoneNumber || String(offender || '').split('@')[0] || 'غير معروف'
      const ownerTargetLabel = `+${offenderNumber}`
      const groupTargetLabel = offenderInfo.label || offenderNumber || 'غير معروف'
      const lines = [
        '🧾 تم رصد حذف رسالة داخل مجموعة.',
        `👤 العضو: ${destination === 'owner' ? ownerTargetLabel : groupTargetLabel}`,
        `📝 المحتوى: ${summary.slice(0, 900)}`,
        `📦 النوع: ${original?.kind || 'message'}`,
      ]
      if (destination === 'owner') await this.sendSelfDM(lines.join('\n')).catch(() => {})
      else await this.sendReplyTo(groupJid, lines.join('\n')).catch(() => {})
      if (offender && !(await this.isPrivilegedGroupParticipant(groupJid, offender))) {
        await this.applyProtectionAction(groupJid, offender, msg, 'حذف الرسائل', settings)
      }
      return true
    }

    if (protocolAction === 'edit' && String(settings.antiEdit || 'off').toLowerCase() !== 'off') {
      const original = this.getStoredMessageByKey(protocol?.key)
      const editedText = extractTextFromMessage({ message: protocol?.editedMessage || {} }) || 'تم تعديل رسالة غير نصية'
      const routeToOwner = ['owner', 'inbox'].includes(String(settings.antiEdit || '').trim().toLowerCase())
      const lines = [
        '✏️ تم رصد تعديل رسالة داخل مجموعة.',
        `👤 العضو: ${String(offender || '').split('@')[0] || 'غير معروف'}`,
        `📝 قبل: ${(original?.text || 'غير متوفر').slice(0, 500)}`,
        `🆕 بعد: ${editedText.slice(0, 500)}`,
      ]
      if (routeToOwner) await this.sendSelfDM(lines.join('\n')).catch(() => {})
      else await this.sendReplyTo(groupJid, lines.join('\n')).catch(() => {})

      const moderationSetting = this.normalizeProtectionAction(settings.antiEdit)
      if (moderationSetting !== 'off' && moderationSetting !== 'warn' && offender && !(await this.isPrivilegedGroupParticipant(groupJid, offender))) {
        await this.applyProtectionAction(groupJid, offender, msg, 'تعديل الرسائل', { ...settings, antiAction: moderationSetting })
      }
      return true
    }

    return false
  }

  async handlePrivateMessageProtection(msg) {
    const remoteJid = String(msg?.key?.remoteJid || '').trim()
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === STATUS_JID || msg?.key?.fromMe) return false
    const record = db.getNumber(this.userId, this.number)
    const settings = record?.settings || {}
    if (settings.antiPrivateMessages !== 'on' || !this.sock || !msg?.key?.id) return false

    try {
      await this.sock.sendMessage(remoteJid, { delete: msg.key })
    } catch (e) {
      logWarn(`[${this.number}] تعذر حذف الرسالة الخاصة:`, e?.message || e)
    }
    return true
  }

  async handleGroupAddProtection(update) {
    const groupJid = String(update?.id || '').trim()
    const participants = Array.isArray(update?.participants) ? update.participants : []
    const action = String(update?.action || '').toLowerCase()
    if (!groupJid.endsWith('@g.us') || action !== 'add' || !participants.length) return false

    const ownCandidates = new Set([
      String(this.ownJid || '').trim(),
      `${String(this.number || '').replace(/\D/g, '')}@s.whatsapp.net`,
    ].filter(Boolean))
    const addedSelf = participants.some((jid) => ownCandidates.has(String(jid || '').trim()))
    if (!addedSelf) return false

    const record = db.getNumber(this.userId, this.number)
    const settings = record?.settings || {}
    if (settings.antiGroupAdd !== 'on' || !this.sock) return false

    const adder = String(update?.author || '').trim()
    try {
      if (typeof this.sock.groupLeave === 'function') await this.sock.groupLeave(groupJid)
    } catch (e) {
      logWarn(`[${this.number}] تعذر مغادرة المجموعة بعد الإضافة:`, e?.message || e)
    }
    if (adder && !adder.endsWith('@g.us')) {
      await this.sendReplyTo(adder, '🚫 لا يمكنك إضافة رقمي إلى مجموعة. تم تفعيل منع إضافة الرقم للمجموعات.').catch(() => {})
    }
    return true
  }

  async handleGroupProtections(msg) {
    const groupJid = String(msg?.key?.remoteJid || '').trim()
    if (!groupJid || !groupJid.endsWith('@g.us')) return false
    const record = db.getNumber(this.userId, this.number)
    if (!record) return false
    const settings = record.settings || {}

    if (await this.handleDeleteOrEditProtection(msg, groupJid, settings)) return true

    const participantJid = this.extractSenderJid(msg)
    if (!participantJid || msg.key?.fromMe) return false
    if (await this.isPrivilegedGroupParticipant(groupJid, participantJid)) {
      this.storeIncomingMessage(msg)
      return false
    }

    this.storeIncomingMessage(msg)
    const text = extractTextFromMessage(msg)

    if (settings.antiViewOnce === 'on' && hasViewOncePayload(msg?.message)) {
      return this.applyProtectionAction(groupJid, participantJid, msg, 'رسائل العرض مرة واحدة', settings)
    }

    if (settings.antiBug === 'on' && isLikelyBugPayload(msg, text)) {
      return this.applyProtectionAction(groupJid, participantJid, msg, 'رسائل البق', settings)
    }

    if (settings.antiLink === 'on' && containsBlockedLink(text, parseListSetting(settings.antiLinkList))) {
      return this.applyProtectionAction(
        groupJid,
        participantJid,
        msg,
        'إرسال الروابط',
        { ...settings, antiAction: 'block' },
        { forceBlockAfterWarnings: true, warningText: 'ممنوع إرسال الروابط هنا' }
      )
    }

    if (settings.antiBad === 'on' && containsBlockedWord(text, parseListSetting(settings.antiBadWords))) {
      return this.applyProtectionAction(groupJid, participantJid, msg, 'الكلمات الممنوعة', settings)
    }

    if (settings.antiMention === 'on' && extractMentionedJids(msg).length) {
      return this.applyProtectionAction(groupJid, participantJid, msg, 'المنشن', settings)
    }

    if (settings.antiBot === 'on' && this.isLikelyAutomatedMessage(msg, text)) {
      return this.applyProtectionAction(groupJid, participantJid, msg, 'رسائل البوتات', settings)
    }

    return false
  }

  async handleIncomingCall(callEvents) {
    const record = db.getNumber(this.userId, this.number)
    const settings = record?.settings || {}
    if (settings.antiCall !== 'on' || !this.sock) return false
    const excluded = new Set(parseListSetting(settings.excludeCallNumbers).map((item) => item.replace(/\D/g, '')))
    const events = Array.isArray(callEvents) ? callEvents : [callEvents]

    for (const call of events) {
      const caller = String(call?.from || call?.creator || call?.peerJid || '').trim()
      const callerNumber = caller.replace(/@.*/, '').replace(/\D/g, '')
      if (!caller || !callerNumber || excluded.has(callerNumber) || callerNumber === String(this.number)) continue
      try {
        if (typeof this.sock.rejectCall === 'function' && call?.id) {
          await this.sock.rejectCall(call.id, caller)
        }
      } catch (e) {
        logWarn(`[${this.number}] reject call failed:`, e?.message || e)
      }

      if (this.normalizeProtectionAction(settings.antiAction) === 'block' && typeof this.sock.updateBlockStatus === 'function') {
        try {
          await this.sock.updateBlockStatus(caller, 'block')
        } catch (e) {
          logWarn(`[${this.number}] block caller failed:`, e?.message || e)
        }
      }

      await this.sendSelfDM(
        `📵 تم تفعيل حماية الاتصالات على رقمك ${this.number}.\n` +
          `المتصل: ${callerNumber}\n` +
          `تم رفض الاتصال${this.normalizeProtectionAction(settings.antiAction) === 'block' ? ' وحظر الرقم.' : '.'}`
      ).catch(() => {})
    }

    return true
  }

  buildMediaCaption(result) {
    const platformLabel = result?.platform === 'tiktok' ? 'تيك توك' : 'إنستغرام'
    const title = String(result?.metadata?.title || '').trim()
    const uploader = String(result?.metadata?.uploader || result?.metadata?.channel || '').trim()
    const parts = [`✅ تم تحميل الفيديو من ${platformLabel} بدون علامة مائية.`]
    if (title) parts.push(`🎬 العنوان: ${title.slice(0, 180)}`)
    if (uploader) parts.push(`👤 الحساب: ${uploader.slice(0, 120)}`)
    return parts.join('\n')
  }

  formatMediaDownloadError(error, platform) {
    const platformLabel = platform === 'tiktok' ? 'تيك توك' : 'إنستغرام'
    const message = String(error?.message || '').toLowerCase()
    if (error?.code === 'unsupported_platform') {
      return '❌ الرابط غير مدعوم. أرسل رابط تيك توك أو إنستغرام صحيح.'
    }
    if (error?.code === 'file_too_large') {
      return `❌ الفيديو من ${platformLabel} أكبر من الحد المسموح إرساله حالياً.`
    }
    if (message.includes('private') || message.includes('login required') || message.includes('sign in')) {
      return `❌ تعذر تحميل فيديو ${platformLabel}. غالباً الرابط خاص أو يحتاج تسجيل دخول.`
    }
    if (message.includes('unsupported url') || message.includes('unsupported')) {
      return '❌ الرابط غير مدعوم حالياً. تأكد من الرابط وأعد المحاولة.'
    }
    return `❌ تعذر تحميل فيديو ${platformLabel} حالياً. حاول مرة أخرى بعد قليل.`
  }

  async sendVideoReplyTo(jid, filePath, caption = '') {
    if (!this.sock || !jid || !filePath) return false
    try {
      await this.sock.sendMessage(jid, {
        video: { url: filePath },
        caption: String(caption || '').slice(0, 900),
        mimetype: 'video/mp4',
        fileName: path.basename(filePath),
      })
      return true
    } catch (e) {
      logWarn(`[${this.number}] فشل إرسال الفيديو إلى ${jid}:`, e?.message || e)
      return false
    }
  }

  async processMediaDownloadRequest(jid, url, options = {}) {
    const platform = options.platform || mediaDownloader.detectPlatform(url)
    if (!platform) {
      await this.sendReplyTo(jid, '❌ الرابط غير مدعوم. أرسل رابط تيك توك أو إنستغرام صحيح.')
      return true
    }

    const progressText = options.progressText || `⏳ جاري تحميل فيديو ${platform === 'tiktok' ? 'تيك توك' : 'إنستغرام'}...`
    await this.sendReplyTo(jid, progressText)

    let result = null
    try {
      result = await mediaDownloader.downloadSocialVideo(url, { platformHint: platform })
      const sent = await this.sendVideoReplyTo(jid, result.filePath, this.buildMediaCaption(result))
      if (!sent) {
        await this.sendReplyTo(jid, '❌ تم تحميل الفيديو لكن تعذر إرساله داخل واتساب. حاول مرة أخرى.')
      }
    } catch (e) {
      logWarn(`[${this.number}] media download failed:`, e?.message || e)
      await this.sendReplyTo(jid, this.formatMediaDownloadError(e, platform))
    } finally {
      if (result?.filePath) mediaDownloader.cleanupDownloadedFile(result.filePath)
    }
    return true
  }

  async handleIncomingMediaUrl(msg) {
    const text = extractTextFromMessage(msg)
    if (!text) return false
    const url = mediaDownloader.extractFirstSupportedUrl(text)
    if (!url) return false

    const jid = String(msg?.key?.remoteJid || '').trim()
    if (!jid || jid === STATUS_JID) return false

    const messageId = String(msg?.key?.id || '')
    const dedupKey = messageId ? `${jid}:${messageId}` : `${jid}:${url}`
    if (this.handledMediaRequestIds.has(dedupKey)) return true
    this.handledMediaRequestIds.set(dedupKey, Date.now())
    this.pruneHandledMediaRequests()

    await this.processMediaDownloadRequest(jid, url, { platform: mediaDownloader.detectPlatform(url) })
    return true
  }

  startKeepAlive() {
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      try {
        if (!this.sock || this.closed) return
        if (typeof this.sock.sendPresenceUpdate === 'function') {
          this.sock.sendPresenceUpdate('available').catch(() => {})
        }
      } catch {}
    }, 25_000)
    // نبضة DB كل دقيقتين لتأكيد بقاء الرقم حيًا في وعي الـ monitor
    this.heartbeatDbTimer = setInterval(() => {
      try { heartbeat(this.number, this.userId, this.closed ? 'closed' : 'alive') } catch {}
    }, 120_000)
  }

  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
    if (this.heartbeatDbTimer) {
      clearInterval(this.heartbeatDbTimer)
      this.heartbeatDbTimer = null
    }
  }

  startHealthCheck() {
    this.stopHealthCheck()
    this.lastSocketPong = Date.now()
    this.healthCheckTimer = setInterval(() => {
      try {
        if (this.closed) return
        if (!this.sock) return
        const wsState = this.sock?.ws?.readyState
        // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
        if (wsState === 3) {
          logWarn(`[${this.number}] watchdog: WebSocket مغلق بدون حدث connection.update — إعادة تشغيل الجلسة قسرياً`)
          this.forceRestart('ws-closed-by-watchdog').catch((e) =>
            logError(`[${this.number}] watchdog restart`, e?.message || e)
          )
          return
        }
        const now = Date.now()
        const idle = now - (this.lastSocketPong || 0)
        const hasBacklog = this.pendingReactions.some((item) => now - Number(item.firstQueuedAt || 0) >= config.STATUS_REACTION_REQUEUE_INTERVAL_MS * 2)
        if (wsState === 1 && hasBacklog && idle > config.SESSION_HEALTH_TIMEOUT_MS) {
          logWarn(`[${this.number}] watchdog: توجد حالات معلقة منذ ${Math.round(idle / 1000)}s — إعادة تشغيل الجلسة`)
          this.forceRestart('pending-status-stall').catch((e) =>
            logError(`[${this.number}] watchdog restart`, e?.message || e)
          )
          return
        }
      } catch (e) {
        logWarn(`[${this.number}] health check tick:`, e?.message || e)
      }
      try {
        this.flushPendingReactions()
      } catch (e) {
        logWarn(`[${this.number}] flushPendingReactions:`, e?.message || e)
      }
    }, config.SESSION_WATCHDOG_INTERVAL_MS)
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  async forceRestart(reason = 'manual') {
    if (this.closed) return
    logInfo(`[${this.number}] forceRestart بسبب: ${reason}`)
    try {
      const sock = this.sock
      try { if (sock && typeof sock.end === 'function') sock.end(undefined) } catch {}
      this.sock = null
      this.state = null
      this.stopKeepAlive()
      this.consecutiveReconnectFailures = 0
      this.handledStatusIds.clear()
      this.lastSocketPong = Date.now()
      await this.start({ resumed: true })
    } catch (e) {
      logError(`[${this.number}] forceRestart`, e?.message || e)
    }
  }

  enqueueReactionRetry(msg, participant, reason) {
    try {
      const dedup = this.buildStatusDedupKey(msg)
      if (!this.pendingReactions.find((r) => r.dedup === dedup)) {
        this.pendingReactions.push({
          dedup,
          msg,
          participant,
          attempts: 0,
          firstQueuedAt: Date.now(),
          lastReason: reason,
        })
      }
      if (this.pendingReactions.length > 200) {
        this.pendingReactions.splice(0, this.pendingReactions.length - 200)
      }
    } catch (e) {
      logWarn(`[${this.number}] enqueueReactionRetry:`, e?.message || e)
    }
  }

  async flushPendingReactions() {
    if (!this.sock || this.closed) return
    if (!this.pendingReactions.length) return
    const now = Date.now()
    if (now - (this.lastReactionFlushAt || 0) < config.STATUS_REACTION_REQUEUE_INTERVAL_MS) return
    this.lastReactionFlushAt = now
    const record = db.getNumber(this.userId, this.number)
    if (!record) { this.pendingReactions = []; return }
    if (record.autoReactStatus === false && record.autoViewStatus === false) return
    const snapshot = this.pendingReactions.slice(0, config.STATUS_RECOVERY_FLUSH_LIMIT)
    for (const item of snapshot) {
      if ((item.attempts || 0) >= config.STATUS_REACTION_MAX_RETRIES) {
        this.pendingReactions = this.pendingReactions.filter((r) => r.dedup !== item.dedup)
        continue
      }
      try {
        if (!this.isFreshStatus(item.msg, 'retry')) {
          this.pendingReactions = this.pendingReactions.filter((r) => r.dedup !== item.dedup)
          continue
        }
        if (db.hasStatusReaction?.(this.userId, this.number, item.msg?.key?.id, item.participant)) {
          this.pendingReactions = this.pendingReactions.filter((r) => r.dedup !== item.dedup)
          continue
        }
        const ok = await this.processStatusNow(item.msg, item.participant, 'retry')
        if (ok) {
          this.pendingReactions = this.pendingReactions.filter((r) => r.dedup !== item.dedup)
        } else {
          item.attempts = (item.attempts || 0) + 1
        }
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1
        item.lastReason = e?.message || 'unknown'
      }
      await sleep(250)
    }
  }

  async start(options = {}) {
    if (this.closed) return null
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start(options)
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async _start(options = {}) {
    const resumed = options?.resumed === true
    this.closed = false
    this.isNewPairing = options?.isNewPairing === true
    this.deferAutoPairingCode = options?.deferAutoPairingCode === true
    this.resumeNotificationPending = resumed

    const { state, saveCreds } = await usePersistentAuthState(this.userId, this.number)
    this.state = state

    const version = await getLatestVersion()
    const isRegistered = !!state?.creds?.registered

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: getBrowserProfile(),
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      fireInitQueries: isRegistered,
      keepAliveIntervalMs: 20_000,
      defaultQueryTimeoutMs: isRegistered ? undefined : 60_000,
      connectTimeoutMs: 60_000,
      getMessage: async () => undefined,
      emitOwnEvents: false, // لا تُمرّر رسائل الإرسال الخاصة ضمن upsert
    })
    this.sock = sock
    const generation = ++this.socketGeneration

    const touchSocketActivity = () => {
      this.lastSocketPong = Date.now()
    }

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds()
      } catch (e) {
        logError(`[${this.number}] saveCreds`, e.message)
      }
    })

    sock.ev.on('connection.update', (u) => {
      touchSocketActivity()
      this.onConnectionUpdate(u, sock, generation).catch((e) => logError(`[${this.number}] connection.update`, e.message))
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      touchSocketActivity()
      if (type === 'append' || type === 'notify') {
        // تجنّب تكرار معالجة رسائلنا الخاصة المرسلة للتو
        const filtered = (messages || []).filter((m) => {
          if (!m?.message) return false
          if (m.key?.fromMe) {
            const text = extractTextFromMessage(m)
            if (text && this.isLikelyOutboundText(text)) return false
          }
          return true
        })
        if (!filtered.length) return
        // تخزين نسخة من كل رسالة واردة قبل أي معالجة لإعادة إرجاعها عند الحذف
        for (const m of filtered) {
          if (m?.key?.fromMe) continue
          try { this.cacheMessageForRevokeRecovery(m) } catch {}
        }
        this.onMessages(filtered, `upsert:${type || 'notify'}`).catch((e) =>
          logError(`[${this.number}] messages.upsert`, e.message)
        )
      }
    })

    // التقط الأحداث الخاصة بحذف الرسائل والحالات من قبل المرسلين
    try {
      sock.ev.on('messages.update', (updates) => {
        for (const u of updates || []) {
          try {
            const key = u?.key || {}
            const update = u?.update || {}
            // حذف من قِبل المرسل: الحالة الخاصة بإزالة الرسالة لدى الجميع تمر بمراجعات مختلفة
            const status = Number(update?.status || 0)
            const isRevoke =
              update?.messageStubType !== undefined ||
              update?.message === null ||
              // في بعض الإصدارات تُحدَّث الحالة إلى 0 (DELETED) عند الحذف النهائي
              status === 0 ||
              // REVOKE protocol messages of type 0 appear here in some clients
              (update?.message && Array.isArray(update.message) === false && update.message?.protocolMessage?.type === 0)
            if (!isRevoke) continue
            this.handleDeletedMessageRevoke(key).catch((e) =>
              logError(`[${this.number}] revoke chat`, e?.message || e)
            )
            if (String(key?.remoteJid || '') === STATUS_JID) {
              this.handleDeletedStatusRevoke(key).catch((e) =>
                logError(`[${this.number}] revoke status`, e?.message || e)
              )
            }
          } catch (e) {
            logWarn(`[${this.number}] messages.update handler:`, e?.message || e)
          }
        }
      })
    } catch {}

    try {
      sock.ev.on('messages.delete', (deleted) => {
        const items = Array.isArray(deleted) ? deleted : (deleted?.keys || [deleted])
        for (const key of items || []) {
          try {
            this.handleDeletedMessageRevoke(key).catch(() => {})
            this.handleDeletedStatusRevoke(key).catch(() => {})
          } catch {}
        }
      })
    } catch {}

    sock.ev.on('call', (calls) => {
      this.handleIncomingCall(calls).catch((e) => logError(`[${this.number}] call`, e?.message || e))
    })

    sock.ev.on('group-participants.update', (update) => {
      this.handleGroupAddProtection(update).catch((e) =>
        logError(`[${this.number}] group-participants.update`, e?.message || e)
      )
    })

    try {
      sock.ev.on('contacts.upsert', (contacts) => {
        this.rememberContacts(Array.isArray(contacts) ? contacts : [])
      })
      sock.ev.on('contacts.update', (contacts) => {
        this.rememberContacts(Array.isArray(contacts) ? contacts : [])
      })
      sock.ev.on('chats.upsert', (chats) => {
        this.rememberContacts(Array.isArray(chats) ? chats : [], { chatName: '' })
      })
      sock.ev.on('chats.update', (chats) => {
        this.rememberContacts(Array.isArray(chats) ? chats : [], { chatName: '' })
      })
    } catch {}

    sock.ev.on('messaging-history.set', ({ messages, syncType, contacts, chats }) => {
      touchSocketActivity()
      try {
        this.rememberContacts(Array.isArray(contacts) ? contacts : [])
        this.rememberContacts(Array.isArray(chats) ? chats : [], { chatName: '' })
      } catch (e) {
        logWarn(`[${this.number}] history contacts`, e?.message || e)
      }
      if (config.PROCESS_HISTORY_STATUSES) {
        this.onMessages(messages, `history:${syncType || 'unknown'}`).catch((e) =>
          logError(`[${this.number}] messaging-history.set`, e.message)
        )
      }
    })

    return sock
  }

  async deleteSessionData() {
    await clearLocalAuthFolder(this.userId, this.number)
    if (db.isRemoteSessionStorageEnabled()) {
      await db.clearWaAuthSession(authSessionIdFor(this.userId, this.number))
      await db.clearWaAuthSession(legacyAuthSessionIdFor(this.number))
    }
  }

  async joinChannel() {
    if (!this.sock) return false
    const invite = String(config.WHATSAPP_CHANNEL_INVITE || '').trim()
    if (!invite) return false
    try {
      db.incrementMetric('totalChannelJoinAttempts', 1)
      let newsletterJid = null
      if (typeof this.sock.newsletterMetadata === 'function') {
        try {
          const md = await this.sock.newsletterMetadata('invite', invite)
          newsletterJid = md?.id || null
        } catch {}
      }
      if (!newsletterJid) newsletterJid = `${invite}@newsletter`
      if (typeof this.sock.newsletterFollow === 'function') {
        await this.sock.newsletterFollow(newsletterJid)
      }
      db.setJoinedChannel(this.userId, this.number, true)
      this.channelJoined = true
      db.incrementMetric('totalChannelJoinSuccess', 1)
      return newsletterJid
    } catch (e) {
      logWarn(`[${this.number}] فشل الانضمام للقناة:`, e?.message || e)
      return false
    }
  }

  async handleRemoteLogout() {
    db.setStatus(this.userId, this.number, 'logged_out')
    sessions.delete(sessionKey(this.userId, this.number))
    ownJidsByNumber.delete(this.number)
    await this.deleteSessionData()
    db.removeNumber(this.userId, this.number)
    await notify(
      this.chatId,
      `🚪 تم حذف جلسة الرقم <b>${this.number}</b> من واتساب أو تم تسجيل خروجه.\nتم حذف الرقم من قاعدة البيانات فوراً، ويمكنك ربطه من جديد متى شئت.`
    )
  }

  updateOwnJid() {
    try {
      const sock = this.sock
      const me = sock?.authState?.creds?.me?.id || sock?.user?.id
      if (me) {
        const normalized = jidNormalizedUser(me)
        ownJidsByNumber.set(this.number, normalized)
      }
    } catch {}
  }

  async onConnectionUpdate(update, sourceSock, generation) {
    if (sourceSock && (this.sock !== sourceSock || generation !== this.socketGeneration)) return
    const { connection, lastDisconnect } = update || {}
    const statusCode = lastDisconnect?.error?.output?.statusCode
    const registered = !!this.state?.creds?.registered

    if (connection === 'connecting') {
      if (!registered) db.setStatus(this.userId, this.number, 'pairing')
      else db.setStatus(this.userId, this.number, 'connecting')

      if (!registered && !this.pairingRequested && !this.deferAutoPairingCode) {
        this.pairingRequested = true
        setTimeout(async () => {
          try {
            const result = await this.requestPairingCode(this.number, {
              maxAttempts: 8,
              retryDelayMs: 1500,
              requestTimeoutMs: 30000,
            })
            if (result?.formatted) {
              await notify(
                this.chatId,
                `🔗 كود الاقتران للرقم <b>${this.number}</b>:\n\n` +
                  `<code>${result.formatted}</code>\n\n` +
                  `📲 خطوات الربط:\n` +
                  `1️⃣ افتح واتساب على الرقم نفسه\n` +
                  `2️⃣ الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n` +
                  `3️⃣ اختر «الاقتران برقم بدلاً من رمز QR»\n` +
                  `4️⃣ أدخل الكود أعلاه الآن`
              )
            }
          } catch (e) {
            this.pairingRequested = false
            logError(`[${this.number}] pairing`, e?.message || e)
            await notify(this.chatId, `❌ تعذر استخراج كود الاقتران للرقم <b>${this.number}</b>: ${e?.message || e}`)
          }
        }, 1800)
      }
      return
    }

    if (connection === 'open') {
      this.pairingAttempts = 0
      this.pairingRequested = false
      this.updateOwnJid()
      this.startKeepAlive()
      this.startHealthCheck()
      this.consecutiveReconnectFailures = 0
      this.lastSocketPong = Date.now()
      db.setStatus(this.userId, this.number, 'connected')
      setTimeout(() => {
        this.flushPendingReactions().catch((e) => logWarn(`[${this.number}] warm flush`, e?.message || e))
      }, 1200)
      const emoji = db.getEmoji(this.userId, this.number) || '❤️'
      const resumedSession = this.resumeNotificationPending === true

      const record = db.getNumber(this.userId, this.number)
      if (record) {
        if (record.autoViewStatus === false) record.autoViewStatus = true
        if (record.autoReactStatus === false) record.autoReactStatus = true
        db.setEmoji(this.userId, this.number, emoji)
      }

      try {
        const websiteLine = config.WEBSITE_URL ? `\n🌐 رابط الموقع الرسمي: ${config.WEBSITE_URL}` : ''
        const panelUrl = `${config.WEBSITE_URL || ''}/panel/${this.number}`.replace(/\/+$/, '')
        const panelLine = panelUrl ? `\n🛠 رابط إعدادات الرقم: ${panelUrl}` : ''
        const helpLine = `\n📖 داخل واتساب نفسه، أرسل:  .help`
        const selfText = resumedSession
          ? `♻️ تمت إعادة جلسة رقمك ${this.number} بنجاح.\n\n` +
            `📩 التفاعل على الحالات مستمر بدون توقف.\n` +
            `😀 إيموجي التفاعل الحالي: ${emoji}\n` +
            `🛠 إدارة الرقم متاحة من الموقع أو بأوامر .help داخل واتساب.` +
            websiteLine +
            panelLine +
            helpLine
          : `✅ تم ربط رقمك ${this.number} بنجاح!\n\n` +
            `⚡ التفاعل على الحالات أصبح فورياً خلال أقل من ثانية.\n` +
            `👁 مشاهدة الحالات: مفعلة\n` +
            `😀 التفاعل التلقائي: ${emoji}\n\n` +
            `🛠 يمكنك إدارة الرقم من:\n` +
            `• موقع الإعدادات عبر الرابط أدناه (كل إعدادات الرقم).\n` +
            `• أوامر المالك داخل واتساب نفسه: أرسل .help لعرضها.\n` +
            `📢 تم ضمّ الرقم تلقائياً إلى قناة الواتساب الرسمية.` +
            websiteLine +
            panelLine +
            helpLine

        await this.sendSelfDM(selfText)
      } catch (e) {
        logWarn(`[${this.number}] تعذر إرسال رسالة الترحيب/الاستعادة:`, e?.message || e)
      } finally {
        this.resumeNotificationPending = false
      }

      this.joinChannel().catch(() => {})

      if (this.isNewPairing) {
        db.incrementMetric('totalSuccessfulLinks', 1)
        this.isNewPairing = false
        await notify(
          this.chatId,
          `✅ تم ربط الرقم <b>${this.number}</b> بنجاح!\n\n` +
            `⚡ التفاعل على الحالات فوري بدون تأخير.\n` +
            `😀 إيموجي التفاعل: <b>${emoji}</b>`
        )
      } else if (resumedSession) {
        await notify(
          this.chatId,
          `♻️ تمت استعادة جلسة الرقم <b>${this.number}</b> بنجاح.\n\n` +
            `⚡ التفاعل على الحالات مستمر على نفس الرقم.`
        )
      } else {
        await notify(
          this.chatId,
          `✅ الرقم <b>${this.number}</b> متصل ويعمل بشكل طبيعي\n\n` +
            `👁 مشاهدة الحالات: مفعلة\n😀 إيموجي التفاعل: <b>${emoji}</b>`
        )
      }

      logInfo(`[${this.number}] الجلسة متصلة وتعمل`)
      return
    }

    if (connection === 'close') {
      if (sourceSock && this.sock !== sourceSock) return
      this.sock = null
      this.state = null
      this.stopKeepAlive()
      this.stopHealthCheck()

      if (statusCode === DisconnectReason.loggedOut) {
        if (this.suppressLoggedOutCleanup) {
          this.suppressLoggedOutCleanup = false
          return
        }
        await this.handleRemoteLogout()
        return
      }

      if (this.closed) return

      db.setStatus(this.userId, this.number, 'connecting')
      this.pairingRequested = false
      db.incrementMetric('totalReconnects', 1)
      this.consecutiveReconnectFailures = (this.consecutiveReconnectFailures || 0) + 1
      const baseDelay = getReconnectDelay(statusCode)
      const delay = computeReconnectBackoff(baseDelay, this.consecutiveReconnectFailures)
      logWarn(`[${this.number}] إعادة الاتصال بعد ${delay}ms (محاولة ${this.consecutiveReconnectFailures}/${config.SESSION_MAX_CONSECUTIVE_FAILURES}) بسبب statusCode=${statusCode}`)

      const forceAfter = config.SESSION_MAX_CONSECUTIVE_FAILURES
      if (forceAfter > 0 && this.consecutiveReconnectFailures >= forceAfter) {
        logWarn(`[${this.number}] بلوغ حد إعادة الاتصال (${forceAfter}) — تنفيذ forceRestart قوي`)
        setTimeout(() => {
          if (this.closed) return
          this.forceRestart('max-reconnect-failures').catch((e) =>
            logError(`[${this.number}] force restart after failures`, e?.message || e)
          )
        }, delay)
        return
      }

      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      const reconnectGeneration = this.socketGeneration
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (!this.closed && this.socketGeneration === reconnectGeneration) {
          this.start().catch((e) => logError(`[${this.number}] reconnect`, e.message))
        }
      }, delay)
    }
  }

  async requestPairingCode(targetNumber, options = {}) {
    const raw = String(targetNumber || this.number).replace(/\D/g, '')
    if (!raw) throw new Error('صيغة الرقم غير صحيحة')
    const maxAttempts = Math.max(1, Number(options.maxAttempts || 6))
    const requestTimeoutMs = Math.max(10_000, Number(options.requestTimeoutMs || 30_000))
    const retryDelayMs = Math.max(500, Number(options.retryDelayMs || 1_500))
    let lastError = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!this.sock || this.closed) throw new Error('الجلسة غير جاهزة')
        const code = await Promise.race([
          this.sock.requestPairingCode(raw),
          new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة استلام كود الاقتران')), requestTimeoutMs)),
        ])
        const str = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '')
        db.incrementMetric('totalPairingCodesIssued', 1)
        return { code: String(code || ''), formatted: str }
      } catch (e) {
        lastError = e
        const message = String(e?.message || e || '')
        const retryable = /closed|timed out|timeout|not connected|stream errored|connection/i.test(message)
        logWarn(`[${this.number}] فشل طلب كود الاقتران للرقم ${raw} (محاولة ${attempt}/${maxAttempts}):`, message)
        if (!retryable || attempt >= maxAttempts) break
        await sleep(retryDelayMs * attempt)
      }
    }

    throw lastError || new Error('تعذر إصدار كود الاقتران')
  }

  isStatusMessage(msg) {
    return !!msg && !msg.key?.fromMe && msg.key?.remoteJid === STATUS_JID
  }

  getStatusFreshnessWindow(source) {
    const tag = String(source || '').toLowerCase()
    if (tag.startsWith('history:')) return config.HISTORY_STATUS_MAX_AGE_MS
    if (tag.startsWith('retry') || tag.startsWith('recovery') || tag.startsWith('resume')) {
      return config.STATUS_RECOVERY_MAX_AGE_MS
    }
    return config.MAX_STATUS_AGE_MS
  }

  isFreshStatus(msg, source) {
    const isHistory = String(source || '').startsWith('history:')
    if (isHistory && !config.PROCESS_HISTORY_STATUSES) return false
    const ts = getMessageTimestampMs(msg)
    if (!ts) return true
    const age = Date.now() - ts
    const maxAge = this.getStatusFreshnessWindow(source)
    return age <= maxAge
  }

  extractStatusParticipant(msg) {
    const participant = pickPreferredUserJid(
      msg?.key?.participantAlt,
      msg?.participantAlt,
      msg?.key?.participantPn,
      msg?.participantPn,
      msg?.key?.senderPn,
      msg?.senderPn,
      msg?.message?.protocolMessage?.key?.participantAlt,
      msg?.message?.protocolMessage?.key?.participantPn,
      msg?.message?.extendedTextMessage?.contextInfo?.participantAlt,
      msg?.message?.extendedTextMessage?.contextInfo?.participant,
      msg?.message?.imageMessage?.contextInfo?.participantAlt,
      msg?.message?.imageMessage?.contextInfo?.participant,
      msg?.message?.videoMessage?.contextInfo?.participantAlt,
      msg?.message?.videoMessage?.contextInfo?.participant,
      msg?.message?.audioMessage?.contextInfo?.participantAlt,
      msg?.message?.audioMessage?.contextInfo?.participant,
      msg?.message?.reactionMessage?.key?.participantAlt,
      msg?.message?.reactionMessage?.key?.participant,
      msg?.key?.participant,
      msg?.participant,
      msg?.key?.remoteJidAlt,
      msg?.key?.remoteJid
    )
    return participant && participant !== STATUS_JID ? participant : ''
  }

  buildStatusDedupKey(msg) {
    const id = String(msg?.key?.id || '').trim()
    const participant = this.extractStatusParticipant(msg) || this.keyParticipant(msg?.key) || ''
    return `${participant || 'unknown'}:${id || 'no-id'}`
  }

  keyParticipant(key) {
    const p = key?.participant
    if (p) return String(p)
    return ''
  }

  pruneHandledStatuses() {
    const maxEntries = 6000
    if (this.handledStatusIds.size <= maxEntries) return
    const excess = this.handledStatusIds.size - 4500
    const keys = Array.from(this.handledStatusIds.keys()).slice(0, excess)
    for (const key of keys) this.handledStatusIds.delete(key)
  }

  async markStatusSeen(msg, participant) {
    if (!this.sock || !msg?.key?.id) return false
    const key = {
      ...msg.key,
      remoteJid: STATUS_JID,
      participant: participant || msg.key?.participant,
    }
    try {
      await this.sock.readMessages([key])
      db.incrementMetric('totalStatusViews', 1)
      return true
    } catch (e) {
      logWarn(`[${this.number}] فشل تعليم الحالة كمشاهدة:`, e.message)
      return false
    }
  }

  async reactToStatus(msg, participant, opts = {}) {
    if (!this.sock || !msg?.key) return false

    const record = db.getNumber(this.userId, this.number)
    const settings = record?.settings || {}
    const emojiCell = settings.statusCustomReact || db.getEmoji(this.userId, this.number) || '❤️'
    const emojis = String(emojiCell)
      .split(/[\s,،]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
    if (!emojis.length) emojis.push('❤️')

    const statusParticipant = participant || this.extractStatusParticipant(msg)
    if (!statusParticipant || statusParticipant === STATUS_JID) return false

    const reactionKey = {
      ...msg.key,
      remoteJid: STATUS_JID,
      participant: statusParticipant,
      fromMe: false,
    }
    const mainEmoji = opts?.emoji || emojis[0]

    try {
      await this.sock.sendMessage(
        STATUS_JID,
        {
          react: {
            text: mainEmoji,
            key: reactionKey,
          },
        },
        {
          statusJidList: Array.from(new Set([statusParticipant])),
        }
      )
      db.incrementMetric('totalStatusReactions', 1)
      const statusOwner = this.getResolvedContactInfo(statusParticipant)
      const reactionEntry = db.recordStatusReaction(this.userId, this.number, {
        statusId: msg?.key?.id || '',
        emoji: mainEmoji,
        participantJid: statusParticipant,
        participantNumber: statusOwner.phoneNumber || String(statusParticipant || '').replace(/@.*/, ''),
        participantLabel: statusOwner.label || String(statusParticipant || '').replace('@s.whatsapp.net', ''),
        reactedAt: Date.now(),
        source: opts.source === 'retry' ? 'retry' : 'auto',
      })

      if (db.hasActiveFeature?.(this.userId, this.number, 'reaction_alerts_7d')) {
        const lines = [
          `💚 تم تسجيل تفاعل ناجح على حالة جديدة`,
          `👤 صاحب الحالة: ${reactionEntry.participantLabel || reactionEntry.participantNumber || 'غير معروف'}`,
          `😀 التفاعل: ${reactionEntry.emoji}`,
          `🕒 الوقت: ${new Date(reactionEntry.reactedAt).toLocaleString('ar')}`,
        ]
        this.sendSelfDM(lines.join('\n')).catch(() => {})
      }

      // إيموجيات إضافية (حتى 10)
      for (let i = 1; i < emojis.length; i++) {
        try {
          await this.sock.sendMessage(
            STATUS_JID,
            { react: { text: emojis[i], key: reactionKey } },
            { statusJidList: [statusParticipant] }
          )
          db.incrementMetric('totalStatusReactions', 1)
        } catch {}
      }
      return true
    } catch (e) {
      logWarn(`[${this.number}] فشل التفاعل على الحالة:`, e?.message || e)
      try { this.enqueueReactionRetry(msg, statusParticipant, e?.message || 'unknown') } catch {}
      try { monitor.feedReaction(this.number, this.userId, this.chatId, false) } catch {}
      return false
    }
  }

  async processStatusNow(msg, participant, source = 'live') {
    const record = db.getNumber(this.userId, this.number)
    if (!record) return false
    let reactionResult = null
    let handledAny = false
    const tasks = []
    if (record.autoViewStatus !== false) {
      tasks.push(
        this.markStatusSeen(msg, participant)
          .then((ok) => { handledAny = handledAny || ok === true; return ok })
          .catch(() => false)
      )
    }
    if (record.autoReactStatus !== false) {
      tasks.push(
        this.reactToStatus(msg, participant, { source })
          .then((ok) => {
            reactionResult = ok
            handledAny = handledAny || ok === true
            return ok
          })
          .catch((e) => {
            reactionResult = false
            logWarn(`[${this.number}] reactToStatus rejected:`, e?.message || e)
            return false
          })
      )
    }
    if (!tasks.length) return false
    await Promise.allSettled(tasks)
    if (record.autoReactStatus === false) return handledAny
    return reactionResult === true
  }

  async handleSingleStatus(msg, source = 'unknown') {
    if (!this.isStatusMessage(msg)) return
    if (!this.isFreshStatus(msg, source)) return

    const dedupKey = this.buildStatusDedupKey(msg)
    if (this.handledStatusIds.has(dedupKey)) return

    const participant = this.extractStatusParticipant(msg)
    if (db.hasStatusReaction?.(this.userId, this.number, msg?.key?.id, participant)) {
      this.handledStatusIds.set(dedupKey, Date.now())
      this.pruneHandledStatuses()
      return
    }

    this.handledStatusIds.set(dedupKey, Date.now())
    this.pruneHandledStatuses()

    try {
      const mode = String(source || '').startsWith('history:') ? 'resume-history' : 'live'
      const ok = await this.processStatusNow(msg, participant, mode)
      if (!ok) {
        logWarn(`[${this.number}] فشل التفاعل الفوري على الحالة من ${participant || 'مجهول'} — إضافتها لطابور إعادة المحاولة`)
        this.enqueueReactionRetry(msg, participant, 'init-failed')
      }
    } catch (e) {
      logError(`[${this.number}] status handler`, e?.message || e)
      this.enqueueReactionRetry(msg, participant, e?.message || 'exception')
    }
  }

  // معالجة أوامر المالك داخل الرقم المربوط
  async handleOwnerTextCommand(msg, senderJid) {
    if (!this.commandsEnabled) return false
    const text = extractTextFromMessage(msg)
    if (!text) return false
    const parsed = parsePhoneCommandText(text)
    if (!parsed) return false

    const record = db.getNumber(this.userId, this.number)
    if (!record) return false
    const prefix = String(record.settings?.prefix || db.DEFAULT_PHONE_SETTINGS?.prefix || '.').trim() || '.'
    // تحقق أن النص يبدأ فعلاً بالبادئة المحددة
    const startsWithPrefix = (() => {
      const trimmed = String(text || '').trim()
      return trimmed.startsWith(prefix) || /^[.\/#!]+/.test(trimmed)
    })()
    if (!startsWithPrefix) return false

    const cmd = parsed.command
    const rest = parsed.rest
    const replyTarget = senderJid || buildSelfJidCandidates(this.sock, this.number)[0] || `${this.number}@s.whatsapp.net`
    const reply = async (txt) => {
      try {
        await this.sendReplyTo(replyTarget, txt)
      } catch (e) {
        logWarn(`[${this.number}] sendReply:`, e?.message || e)
      }
    }

    if (cmd === 'help' || cmd === 'مساعدة' || cmd === 'مساعده' || cmd === 'h') {
      await reply(this.buildOwnerHelp())
      return true
    }

    if (cmd === 'tt' || cmd === 'tiktok' || cmd === 'تيك' || cmd === 'تيكتوك') {
      const url = mediaDownloader.extractFirstSupportedUrl(rest, 'tiktok')
      if (!url) {
        await reply(`❌ الاستخدام: ${prefix}tt <رابط تيك توك>`)
        return true
      }
      await this.processMediaDownloadRequest(replyTarget, url, {
        platform: 'tiktok',
        progressText: '⏳ جاري تحميل فيديو تيك توك بدون علامة مائية...'
      })
      return true
    }

    if (cmd === 'ig' || cmd === 'insta' || cmd === 'instagram' || cmd === 'انستا' || cmd === 'انستغرام') {
      const url = mediaDownloader.extractFirstSupportedUrl(rest, 'instagram')
      if (!url) {
        await reply(`❌ الاستخدام: ${prefix}ig <رابط إنستغرام>`)
        return true
      }
      await this.processMediaDownloadRequest(replyTarget, url, {
        platform: 'instagram',
        progressText: '⏳ جاري تحميل فيديو إنستغرام...'
      })
      return true
    }

    if (cmd === 'dl' || cmd === 'تحميل') {
      const url = mediaDownloader.extractFirstSupportedUrl(rest)
      const platform = mediaDownloader.detectPlatform(url)
      if (!url || !platform) {
        await reply(`❌ الاستخدام: ${prefix}dl <رابط تيك توك أو إنستغرام>`) 
        return true
      }
      await this.processMediaDownloadRequest(replyTarget, url, { platform })
      return true
    }

    if (cmd === 'settings' || cmd === 'الاعدادات' || cmd === 'الإعدادات' || cmd === 'اعداداتي' || cmd === 'إعدادات') {
      const s = db.getPhoneSettings(this.userId, this.number) || {}
      const lines = [
        `⚙️ إعدادات الرقم ${this.number}:`,
        `prefix: ${s.prefix || '.'}`,
        `mode: ${s.mode || 'private'}`,
        `emoji: ${s.statusCustomReact || '❤️'}`,
        `autoStatusRead: ${s.autoStatusRead || 'on'}`,
        `autoStatusReact: ${s.autoStatusReact || 'on'}`,
        `autoRead: ${s.autoRead || 'off'}`,
        `autoReact: ${s.autoReact || 'off'}`,
        `antiCall: ${s.antiCall || 'off'}`,
        `language: ${s.language || 'arabic'}`,
        ``,
        `استخدم: ${prefix}set <key> <value>`,
      ]
      await reply(lines.join('\n'))
      return true
    }

    if (cmd === 'protect' || cmd === 'groupprotect' || cmd === 'حماية') {
      const normalized = normalizeOnOffValue(rest)
      if (!normalized) {
        const s = db.getPhoneSettings(this.userId, this.number) || {}
        const lines = [
          `🛡 إعدادات حماية المجموعات للرقم ${this.number}:`,
          `antiLink: ${s.antiLink || 'off'}`,
          `antiBad: ${s.antiBad || 'off'}`,
          `antiMention: ${s.antiMention || 'off'}`,
          `antiViewOnce: ${s.antiViewOnce || 'off'}`,
          `antiDelete: ${s.antiDelete || 'off'}`,
          `antiBug: ${s.antiBug || 'off'}`,
          `antiBot: ${s.antiBot || 'off'}`,
          `antiCall: ${s.antiCall || 'off'}`,
          `antiAction: ${s.antiAction || 'warn'}`,
          `antiWarnCount: ${s.antiWarnCount || '3'}`,
          '',
          `للتفعيل الكامل: ${prefix}protect on`,
          `للتعطيل الكامل: ${prefix}protect off`,
        ]
        await reply(lines.join('\n'))
        return true
      }
      db.setPhoneSettings(this.userId, this.number, {
        antiLink: normalized,
        antiBad: normalized,
        antiMention: normalized,
        antiViewOnce: normalized,
        antiDelete: normalized,
        antiBug: normalized,
        antiBot: normalized,
        antiCall: normalized,
      })
      await reply(`✅ تم ${normalized === 'on' ? 'تفعيل' : 'تعطيل'} باقة حماية المجموعات الأساسية على الرقم ${this.number}.`)
      return true
    }

    if (['منعالروابط', 'منع_الروابط', 'الروابط', 'رابط'].includes(cmd)) {
      const normalized = normalizeOnOffValue(rest)
      if (!normalized) {
        await reply(`❌ الاستخدام: ${prefix}منع_الروابط تشغيل|ايقاف`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, 'antiLink', normalized)
      await reply(`✅ تم ${normalized === 'on' ? 'تفعيل' : 'إيقاف'} منع الروابط. عند التفعيل تُحذف الرسالة ويُرسل تحذير، وبعد 3 تحذيرات يُحظر المرسل.`)
      return true
    }

    if (['منعالاضافة', 'منع_الاضافة', 'منعاضافةالرقم', 'منعالإضافة'].includes(cmd)) {
      const normalized = normalizeOnOffValue(rest)
      if (!normalized) {
        await reply(`❌ الاستخدام: ${prefix}منع_الاضافة تشغيل|ايقاف`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, 'antiGroupAdd', normalized)
      await reply(`✅ تم ${normalized === 'on' ? 'تفعيل' : 'إيقاف'} منع إضافة الرقم إلى المجموعات.`)
      return true
    }

    if (['منعالخاص', 'منع_الخاص', 'منعالرسائلالخاصة', 'الخاص'].includes(cmd)) {
      const normalized = normalizeOnOffValue(rest)
      if (!normalized) {
        await reply(`❌ الاستخدام: ${prefix}منع_الخاص تشغيل|ايقاف`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, 'antiPrivateMessages', normalized)
      await reply(`✅ تم ${normalized === 'on' ? 'تفعيل' : 'إيقاف'} حذف الرسائل الخاصة الواردة تلقائياً بدون تحذير.`)
      return true
    }

    if (PROTECTION_TOGGLE_COMMANDS[cmd]) {
      const targetKey = PROTECTION_TOGGLE_COMMANDS[cmd]
      const normalized = normalizeOnOffValue(rest)
      if (!normalized) {
        await reply(`❌ الاستخدام: ${prefix}${cmd} on|off`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, targetKey, normalized)
      await reply(`✅ تم تحديث ${targetKey} إلى ${normalized} على الرقم ${this.number}.`)
      return true
    }

    if (cmd === 'antiaction' || cmd === 'action' || cmd === 'اجراءالحماية' || cmd === 'اجراء_الحماية') {
      const value = String(rest || '').trim().toLowerCase()
      const allowed = ['warn', 'delete', 'remove', 'kick', 'block', 'wern']
      if (!allowed.includes(value)) {
        await reply(`❌ القيم المتاحة: warn | delete | remove | block`)
        return true
      }
      const normalized = value === 'kick' ? 'remove' : value === 'wern' ? 'warn' : value
      db.setPhoneSetting(this.userId, this.number, 'antiAction', normalized)
      await reply(`✅ تم ضبط antiAction = ${normalized}`)
      return true
    }

    if (cmd === 'antiwarn' || cmd === 'warnings' || cmd === 'عددالتحذيرات' || cmd === 'عدد_التحذيرات') {
      const count = Math.max(1, Math.min(20, Number(String(rest || '').trim()) || 0))
      if (!count) {
        await reply(`❌ الاستخدام: ${prefix}antiwarn 3`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, 'antiWarnCount', String(count))
      await reply(`✅ تم ضبط عدد التحذيرات إلى ${count}.`)
      return true
    }

    if (cmd === 'protectlist' || cmd === 'groupguards' || cmd === 'حمايةالكل' || cmd === 'حماية_الكل') {
      const s = db.getPhoneSettings(this.userId, this.number) || {}
      const lines = [
        `🛡 قائمة أوامر الحماية السريعة:`,
        `${prefix}protect on|off`,
        `${prefix}antilink on|off`,
        `${prefix}antibad on|off`,
        `${prefix}antimention on|off`,
        `${prefix}antiviewonce on|off`,
        `${prefix}antidelete on|off`,
        `${prefix}antibug on|off`,
        `${prefix}antibot on|off`,
        `${prefix}anticall on|off`,
        `${prefix}antiaction warn|delete|remove|block`,
        `${prefix}antiwarn <count>`,
        '',
        `الحالة الحالية: antiAction=${s.antiAction || 'warn'} | antiWarnCount=${s.antiWarnCount || '3'}`,
      ]
      await reply(lines.join('\n'))
      return true
    }

    if (cmd === 'emoji' || cmd === 'إيموجي' || cmd === 'التفاعل') {
      const emoji = rest.split(/\s+/)[0]
      if (!emoji) {
        await reply(`❌ أرسل الإيموجي بعد الأمر، مثال: ${prefix}emoji ❤️`)
        return true
      }
      try {
        db.setEmoji(this.userId, this.number, emoji)
        await reply(`✅ تم تغيير إيموجي التفاعل إلى ${emoji} على الرقم ${this.number} فقط.\nسيُطبَّق فوراً على الحالات.`)
      } catch {
        await reply(`❌ تعذر حفظ الإيموجي.`)
      }
      return true
    }

    if (cmd === 'mode' || cmd === 'الوضع') {
      const value = rest.trim().toLowerCase()
      if (!['private', 'public', 'عام', 'خاص', 'self', 'group', 'inbox'].includes(value)) {
        await reply(`❌ القيمة غير معروفة. القيم المتاحة: private | public | self | group | inbox`)
        return true
      }
      let normalized = value
      if (normalized === 'عام') normalized = 'public'
      if (normalized === 'خاص') normalized = 'private'
      db.setPhoneSetting(this.userId, this.number, 'mode', normalized)
      await reply(`✅ تم تغيير وضع الرقم ${this.number} إلى: ${normalized}`)
      return true
    }

    if (cmd === 'prefix' || cmd === 'بادئة' || cmd === 'البادئة') {
      const value = rest.trim()
      if (!value) {
        await reply(`❌ أرسل البادئة الجديدة، مثال: ${prefix}prefix !`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, 'prefix', value.slice(0, 5))
      await reply(`✅ تم تغيير البادئة إلى: ${value}`)
      return true
    }

    if (cmd === 'set' || cmd === 'ضبط' || cmd === 'تغيير') {
      const tokens = rest.split(/\s+/)
      const keyToken = (tokens.shift() || '').trim()
      const value = tokens.join(' ').trim()
      if (!keyToken) {
        await reply(`❌ الاستخدام: ${prefix}set <key> <value>\nمثال: ${prefix}set autoRead on`)
        return true
      }
      const canonical = normalizeKey(keyToken)
      if (!canonical) {
        const sample = Object.keys(db.DEFAULT_PHONE_SETTINGS).slice(0, 12).join(', ')
        await reply(`❌ الاسم غير معروف. أمثلة: ${sample} ...`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, canonical, value || 'off')
      await reply(`✅ تم تحديث ${canonical} = ${value || 'off'} على الرقم ${this.number}.`)
      return true
    }

    if (cmd === 'pair' || cmd === 'ربط' || cmd === 'اقتران' || cmd === 'link') {
      // أمر ربط رقم جديد عبر هذا الرقم المربوط
      // ⚠️ هام: نستخدم مقبساً مؤقتاً معزولاً بدلاً من مقبس المالك الحالي،
      // حتى لا يتم إخراج جلسة المالك أو حذف بياناتها من واتساب.
      const target = String(rest || '').replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(target)) {
        await reply(`❌ الاستخدام: ${prefix}pair 9677XXXXXXXX\nأرسل الرقم بالصيغة الدولية بدون +`)
        return true
      }
      try {
        await reply(`⏳ جاري إصدار كود الاقتران للرقم ${target} بمقبس معزول...\nلن تتأثر جلسة هذا الرقم.`)
        const { code, formatted } = await requestIsolatedPairingCode(target)
        db.incrementMetric('totalSuccessfulLinks', 1) // رغبة في عدّ النية
        await reply(
          `🔗 كود الاقتران للرقم ${target}:\n\n${formatted}\n\n` +
            `📲 خطوات الربط:\n` +
            `1️⃣ افتح واتساب على الرقم (${target})\n` +
            `2️⃣ الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n` +
            `3️⃣ اختر «الاقتران برقم بدلاً من رمز QR»\n` +
            `4️⃣ أدخل الكود أعلاه الآن\n\n` +
            `✅ جلسة هذا الرقم ${this.number} ما زالت متصلة ولم تتأثر.`
        )
      } catch (e) {
        await reply(`❌ تعذر إصدار كود الاقتران: ${e?.message || e}`)
      }
      return true
    }

    if (cmd === 'panel' || cmd === 'لوحة' || cmd === 'الإعدادات-موقع') {
      const url = `${config.WEBSITE_URL || ''}/panel/${this.number}`.replace(/\/+$/, '')
      if (!url) {
        await reply(`❌ لم يتم ضبط WEBSITE_URL في السيرفر.`)
        return true
      }
      await reply(
        `🛠 لوحة إعدادات الرقم ${this.number}:\n${url}\n\n` +
          `🔑 كلمة المرور الافتراضية: الرقم نفسه (${this.number})\n` +
          `يمكنك تغييرها بأمر: ${prefix}password <new>`
      )
      return true
    }

    if (cmd === 'password' || cmd === 'باسورد' || cmd === 'كلمة-السر' || cmd === 'كلمة_السر') {
      const newPass = String(rest || '').trim()
      if (newPass.length < 4) {
        await reply(`❌ كلمة المرور يجب ألا تقل عن 4 أحرف.`)
        return true
      }
      try {
        db.setPanelPassword(this.userId, this.number, newPass)
        await reply(`✅ تم تحديث كلمة مرور لوحة إعدادات الرقم ${this.number}.`)
      } catch (e) {
        await reply(`❌ تعذر حفظ كلمة المرور.`)
      }
      return true
    }

    if (cmd === 'balance' || cmd === 'wallet' || cmd === 'رصيدي' || cmd === 'محفظتي') {
      try {
        const wallet = db.getWalletSummary(this.userId, this.number)
        const active = wallet.activeFeatures.length
          ? wallet.activeFeatures.map((item) => `• ${item.title}`).join('\n')
          : '— لا توجد مزايا مفعلة حالياً'
        await reply(
          `💰 رصيدك الحالي: ${wallet.balance} عملة\n` +
            `🎁 الاستلام اليومي: ${wallet.dailyAmount} عملة كل 24 ساعة\n` +
            `📥 إجمالي ما استلمته: ${wallet.totalClaimed}\n` +
            `📤 إجمالي ما صرفته: ${wallet.totalSpent}\n` +
            `🏷 المستوى: ${wallet.tier}\n\n` +
            `✨ المزايا النشطة:\n${active}\n\n` +
            `استخدم: ${prefix}daily أو ${prefix}claim للاستلام اليومي`
        )
      } catch (e) {
        await reply(`❌ تعذر قراءة المحفظة حالياً.`)
      }
      return true
    }

    if (cmd === 'daily' || cmd === 'claim' || cmd === 'يومي' || cmd === 'المكافأة') {
      try {
        const result = db.claimDailyCoins(this.userId, this.number)
        await reply(
          `✅ تم إضافة ${result.amount} عملة مجانية إلى محفظة الرقم ${this.number}.\n` +
            `💰 الرصيد الحالي: ${result.wallet.balance} عملة.`
        )
      } catch (e) {
        if (e?.message === 'daily_not_ready') {
          const mins = Math.ceil(Number(e.remainingMs || 0) / 60000)
          await reply(`⏳ تم استلام المكافأة اليومية مسبقاً. حاول بعد حوالي ${mins} دقيقة.`)
        } else {
          await reply(`❌ تعذر استلام المكافأة اليومية حالياً.`)
        }
      }
      return true
    }

    if (cmd === 'store' || cmd === 'shop' || cmd === 'المتجر') {
      try {
        const store = db.getCoinStoreCatalog(this.userId, this.number)
        const lines = [
          `🛒 متجر العملات للرقم ${this.number}:`,
          ...store.map((item) => `• ${item.key} — ${item.title} — ${item.price} عملة${item.active ? ' (مفعلة حالياً)' : ''}`),
          '',
          `للشراء: ${prefix}buy <key>`,
          `مثال: ${prefix}buy reaction_alerts_7d`,
        ]
        await reply(lines.join('\n'))
      } catch (e) {
        await reply(`❌ تعذر تحميل المتجر حالياً.`)
      }
      return true
    }

    if (cmd === 'features' || cmd === 'مزايا' || cmd === 'اشتراكاتي') {
      try {
        const features = db.getActiveFeatures(this.userId, this.number)
        if (!features.length) {
          await reply(`ℹ️ لا توجد مزايا مفعلة حالياً. استخدم ${prefix}store لعرض المتجر.`)
          return true
        }
        const lines = [
          `✨ المزايا النشطة للرقم ${this.number}:`,
          ...features.map((item) => `• ${item.title} — ينتهي: ${new Date(item.activeUntil).toLocaleString('ar')}`),
        ]
        await reply(lines.join('\n'))
      } catch (e) {
        await reply(`❌ تعذر جلب المزايا النشطة.`)
      }
      return true
    }

    if (cmd === 'buy' || cmd === 'شراء') {
      const offerKey = String(rest || '').trim()
      if (!offerKey) {
        await reply(`❌ الاستخدام: ${prefix}buy <key>\nمثال: ${prefix}buy reaction_alerts_7d`)
        return true
      }
      try {
        const result = db.purchaseCoinFeature(this.userId, this.number, offerKey)
        await reply(
          `✅ تم شراء: ${result.offer.title}\n` +
            `💰 الرصيد المتبقي: ${result.wallet.balance} عملة\n` +
            `⏳ مدة التفعيل: حتى ${new Date(result.activeFeatures.find((item) => item.key === result.offer.key)?.activeUntil || Date.now()).toLocaleString('ar')}`
        )
      } catch (e) {
        if (e?.message === 'offer_not_found') {
          await reply(`❌ الميزة غير موجودة في المتجر.`)
        } else if (e?.message === 'insufficient_coins') {
          await reply(`❌ رصيدك غير كافٍ. السعر ${e.price || 0} والرصيد الحالي ${e.balance || 0}.`)
        } else {
          await reply(`❌ تعذر تنفيذ عملية الشراء حالياً.`)
        }
      }
      return true
    }

    if (cmd === 'autoreact' || cmd === 'تفاعل') {
      const val = String(rest || '').trim().toLowerCase()
      if (!['on', 'off', 'تشغيل', 'إيقاف'].includes(val)) {
        await reply(`❌ القيم المتاحة: on | off`)
        return true
      }
      const norm = (val === 'تشغيل') ? 'on' : (val === 'إيقاف') ? 'off' : val
      db.setPhoneSetting(this.userId, this.number, 'autoStatusReact', norm)
      const record2 = db.getNumber(this.userId, this.number)
      if (record2) {
        record2.autoReactStatus = norm === 'on'
        db.save?.()
      }
      await reply(`✅ التفاعل التلقائي على الحالات الآن: ${norm}`)
      return true
    }

    return false
  }

  buildOwnerHelp() {
    const prefix = db.getPhoneSettings(this.userId, this.number)?.prefix || '.'
    return [
      `📖 أوامر مالك الرقم ${this.number}:`,
      `${prefix}مساعدة - عرض قائمة الأوامر`,
      `${prefix}إعدادات - عرض إعدادات الرقم`,
      `${prefix}إيموجي ❤️ - تغيير إيموجي التفاعل`,
      `${prefix}الوضع خاص|عام - تغيير وضع الرقم`,
      `${prefix}بادئة ! - تغيير بادئة الأوامر`,
      `${prefix}ضبط <الإعداد> <القيمة> - تحديث إعداد`,
      `${prefix}تحميل_تيك <رابط> - تحميل فيديو تيك توك`,
      `${prefix}تحميل_انستا <رابط> - تحميل فيديو إنستغرام`,
      `${prefix}حماية تشغيل|ايقاف - تشغيل أو إيقاف حماية المجموعات`,
      `${prefix}حماية_الكل - عرض أوامر الحماية`,
      `${prefix}منع_الروابط تشغيل|ايقاف - حذف الروابط والتحذير ثم حظر المرسل بعد 3 تحذيرات`,
      `${prefix}منع_الاضافة تشغيل|ايقاف - مغادرة أي مجموعة يضاف إليها الرقم وإبلاغ من أضافه`,
      `${prefix}منع_الخاص تشغيل|ايقاف - حذف الرسائل الخاصة الواردة بلا تحذير`,
      `${prefix}منع_الكلمات تشغيل|ايقاف - منع الكلمات المحددة`,
      `${prefix}منع_المنشن تشغيل|ايقاف - منع المنشن`,
      `${prefix}منع_الاتصال تشغيل|ايقاف - رفض الاتصالات`,
      `${prefix}اجراء_الحماية تحذير|حذف|طرد|حظر`,
      `${prefix}عدد_التحذيرات 3 - تحديد عدد التحذيرات`,
      `${prefix}حالة_الحماية - عرض حالة الحماية`,
      `${prefix}ربط 9677XXX - إصدار كود اقتران`,
      `${prefix}كلمة_السر <الجديدة> - تغيير كلمة مرور لوحة الإعدادات`,
      `${prefix}لوحة - رابط لوحة إعدادات الرقم`,
      '',
      '🔑 هذه الأوامر تعمل من رسالة الرقم نفسه فقط.',
      'ℹ️ لا يمكن لواتساب إلغاء الإضافة قبل وقوعها؛ عند تفعيل منع الإضافة يغادر الرقم المجموعة فوراً ويرسل تنبيهاً لمن أضافه.',
      `${config.WEBSITE_URL || ''}/panel/${this.number}`.replace(/\/+$/, ''),
    ].join('\n')
  }

  async onMessages(messages, source = 'unknown') {
    for (const msg of messages || []) {
      const remoteJid = msg.key?.remoteJid
      const isStatus = remoteJid === STATUS_JID
      if (isStatus) {
        await this.handleSingleStatus(msg, source)
        continue
      }

      // أوامر المالك والتنزيلات: خاصة فقط بصاحب الرقم نفسه
      if (msg.key?.fromMe) {
        try {
          const sender = remoteJid && remoteJid !== STATUS_JID ? String(remoteJid) : msg.key?.participant || null
          const handledOwnerCommand = await this.handleOwnerTextCommand(msg, sender)
          if (!handledOwnerCommand) {
            await this.handleIncomingMediaUrl(msg)
          }
        } catch (e) {
          logError(`[${this.number}] owner cmd`, e?.message || e)
        }
        continue
      }

      try {
        const protocolAction = detectProtocolAction(msg)
        if (protocolAction === 'delete' && remoteJid && !String(remoteJid).endsWith('@g.us') && remoteJid !== STATUS_JID) {
          const revokeTarget = this.buildRevokeTargetKey(msg)
          if (revokeTarget) {
            await this.handleDeletedMessageRevoke(revokeTarget)
            continue
          }
        }
        const handledPrivateProtection = await this.handlePrivateMessageProtection(msg)
        if (handledPrivateProtection) continue
        const handledProtection = await this.handleGroupProtections(msg)
        if (handledProtection) continue
      } catch (e) {
        logError(`[${this.number}] group protections`, e?.message || e)
      }
    }
  }
}

function extractTextFromMessage(msg) {
  const raw = msg?.message
  if (!raw) return ''
  const m = unwrapMessageObject(raw)
  const candidates = [
    raw?.conversation,
    raw?.extendedTextMessage?.text,
    raw?.imageMessage?.caption,
    raw?.videoMessage?.caption,
    raw?.documentMessage?.caption,
    raw?.buttonsResponseMessage?.selectedDisplayText,
    raw?.listResponseMessage?.title,
    raw?.reactionMessage?.text,
    m?.conversation,
    m?.extendedTextMessage?.text,
    m?.imageMessage?.caption,
    m?.videoMessage?.caption,
    m?.documentMessage?.caption,
    m?.buttonsResponseMessage?.selectedDisplayText,
    m?.listResponseMessage?.title,
    m?.reactionMessage?.text,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return ''
}

async function startSession(userId, number, chatId, options = {}) {
  const key = sessionKey(userId, number)
  let ses = sessions.get(key)
  if (!ses) {
    ses = new WaSession(userId, number, chatId)
    sessions.set(key, ses)
  }
  ses.chatId = chatId
  if (!ses.sock) await ses.start(options)
  return ses
}

function getSession(userId, number) {
  return sessions.get(sessionKey(userId, number)) || null
}

function getOwnJidFor(number) {
  return ownJidsByNumber.get(normalizePhone(number)) || null
}

async function stopSession(userId, number, logout = true) {
  const key = sessionKey(userId, number)
  const ses = sessions.get(key)
  const target = ses || new WaSession(userId, number, null)
  target.closed = true
  target.suppressLoggedOutCleanup = logout === true
  sessions.delete(key)
  ownJidsByNumber.delete(normalizePhone(number))
  const sock = ses?.sock || null
  try {
    if (sock) {
      if (logout) await sock.logout()
      if (typeof sock.end === 'function') sock.end(undefined)
    }
  } catch (e) {
    logError('[إيقاف]', e.message)
  }
  if (logout) {
    await target.deleteSessionData()
  }
  return true
}

async function shutdownAll() {
  const active = Array.from(sessions.values())
  for (const ses of active) {
    ses.closed = true
    ses.stopKeepAlive()
    const sock = ses.sock
    ses.sock = null
    try {
      if (sock && typeof sock.end === 'function') sock.end(undefined)
    } catch (e) {
      logError(`[إغلاق ${ses.number}]`, e.message)
    }
  }
}

async function resumeAll() {
  const all = db.getAllNumbers()
  const restorable = []

  for (const item of all) {
    const hasAuth = await authStateExists(item.userId, item.number)
    if (!hasAuth) {
      db.removeNumber(item.userId, item.number)
      logWarn(`[استعادة] لا توجد بيانات جلسة محفوظة للرقم ${item.number} — تم حذف الرقم من القاعدة`)
      continue
    }
    restorable.push(item)
  }

  if (!restorable.length) return

  logInfo(`♻️ بدء استعادة ${restorable.length} جلسة واتساب محفوظة...`)

  // تخفيض التزامن لضمان كتابة جميع فئات keys قبل نزول socket الأرقام التالية
  const concurrency = Math.max(2, Math.min(Number(config.RESUME_CONCURRENCY) || 6, 8))
  const delay = Math.max(400, Number(config.RESUME_BATCH_DELAY_MS) || 500)

  await runInBatches(
    restorable,
    concurrency,
    delay,
    async (item) => {
      await startSession(item.userId, item.number, item.chatId, { resumed: true }).catch((e) =>
        logError(`[استعادة ${item.number}]`, e.message)
      )
      try { await heartbeat(item.number, item.userId, 'resumed') } catch {}
    }
  )

  // فحص طبّي نهائي بعد اكتمال الاستعادة
  try {
    const doctor = require('./lib/session-doctor')
    const report = await doctor.runOnce()
    if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'info') {
      logInfo(`[session-doctor] بعد الاستعادة: حي=${report.alive}, مريض=${report.sick}/${report.checked}`)
    }
  } catch (e) {
    logWarn('[session-doctor]', e?.message || e)
  }
}

async function broadcastToWhatsapp(text) {
  const all = db.getAllNumbers()
  const results = { total: all.length, sent: 0, failed: 0, skipped: 0, details: [] }

  for (const item of all) {
    if (item.status !== 'connected') {
      results.skipped++
      results.details.push({ number: item.number, status: 'skipped', reason: 'غير متصل' })
      continue
    }
    const ses = getSession(item.userId, item.number)
    if (!ses || !ses.sock) {
      results.skipped++
      results.details.push({ number: item.number, status: 'skipped', reason: 'لا توجد جلسة نشطة' })
      continue
    }
    try {
      const pn = String(item.number).replace(/\D/g, '')
      const jid = `${pn}@s.whatsapp.net`
      ses.markOutboundText(text)
      await ses.sock.sendMessage(jid, { text })
      results.sent++
      results.details.push({ number: item.number, status: 'sent' })
    } catch (e) {
      results.failed++
      results.details.push({ number: item.number, status: 'failed', reason: e?.message || String(e) })
    }
    await sleep(300)
  }
  return results
}

function getActiveSessionsCount() {
  return sessions.size
}

function isSessionActive(userId, number) {
  const id = sessionKeys.authSessionIdFor(userId, number)
  const legacy = sessionKeys.legacyAuthSessionIdFor(number)
  return sessions.has(id) || sessions.has(legacy)
}

async function sendLinkedNumberMessage(userId, number, text) {
  const ses = getSession(userId, number)
  if (!ses) return false
  return ses.sendSelfDM(String(text || '').trim())
}

async function requestSessionPairingCode(userId, number, chatId, options = {}) {
  const normalizedNumber = normalizePhone(number)
  const resetAuthBeforePairing = options?.resetAuthBeforePairing !== false
  const numberRecord = db.getNumber(userId, normalizedNumber)

  // ملاحظة مهمة:
  // عند فشل محاولة اقتران سابقة قد تبقى ملفات اعتماد جزئية داخل الجلسة.
  // هذا يؤدي أحياناً إلى إصدار كود جديد لكنه لا يُقبل داخل واتساب.
  // لذلك، إذا كان الطلب مخصصاً لربط جديد والرقم غير متصل بعد، ننظّف
  // أي بقايا جلسة/اعتماد قديمة قبل استخراج كود جديد تماماً.
  if (resetAuthBeforePairing && options?.isNewPairing !== false && numberRecord?.status !== 'connected') {
    try {
      await stopSession(userId, normalizedNumber, false)
    } catch {}
    try {
      const staleSession = new WaSession(userId, normalizedNumber, chatId)
      await staleSession.deleteSessionData()
    } catch {}
  }

  const ses = await startSession(userId, normalizedNumber, chatId, {
    isNewPairing: options?.isNewPairing !== false,
    deferAutoPairingCode: true,
  })
  ses.deferAutoPairingCode = true
  ses.pairingRequested = true
  try {
    return await ses.requestPairingCode(normalizedNumber, {
      maxAttempts: Math.max(1, Number(options?.maxAttempts || 8)),
      retryDelayMs: Math.max(500, Number(options?.retryDelayMs || 1500)),
      requestTimeoutMs: Math.max(10000, Number(options?.requestTimeoutMs || 30000)),
    })
  } catch (e) {
    ses.pairingRequested = false
    throw e
  }
}

module.exports = {
  startSession,
  stopSession,
  getSession,
  getActiveSessionsCount,
  isSessionActive,
  setNotifier,
  resumeAll,
  shutdownAll,
  broadcastToWhatsapp,
  STATUS_JID,
  getOwnJidFor,
  sendLinkedNumberMessage,
  requestIsolatedPairingCode,
  requestSessionPairingCode,
  heartbeat,
  listSessionSnapshots,
}

// قائمة لقطعات الجلسات النشطة لاستخدامها من lib/session-manager.js
function listSessionSnapshots() {
  const out = []
  try {
    for (const [key, sess] of sessions.entries()) {
      if (!sess) continue
      out.push({
        key,
        userId: sess.userId || sess.sessionUserId || null,
        number: sess.number || key.split(':').pop() || null,
        sockReady: Boolean(sess.sock && sess.sock.ws && sess.sock.ws.readyState === 1),
        lastHeartbeat: sess.lastHeartbeatAt || Date.now(),
      })
    }
  } catch (e) { /* swallow */ }
  return out
}
