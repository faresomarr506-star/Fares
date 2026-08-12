require('dotenv').config()

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.replace(/\/+$/, '')
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function parseNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const port = parseNumber(process.env.PORT, 3000)
const mongodbUri = String(process.env.MONGODB_URI || '').trim()
const hasMongoUri = mongodbUri.length > 0
const websiteUrl =
  normalizeBaseUrl(process.env.WEBSITE_URL) ||
  normalizeBaseUrl(process.env.RENDER_EXTERNAL_URL) ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${String(process.env.RAILWAY_PUBLIC_DOMAIN).trim()}` : '') ||
  `http://localhost:${port}`

const sessionStorageMode = String(
  process.env.SESSION_STORAGE_MODE || (hasMongoUri ? 'database' : 'local')
)
  .trim()
  .toLowerCase()

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  ADMIN_IDS: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  ONLY_ADMINS: parseBoolean(process.env.ONLY_ADMINS, false),

  MONGODB_URI: mongodbUri,
  MONGODB_DB_NAME: String(process.env.MONGODB_DB_NAME || 'fares_bot').trim() || 'fares_bot',
  MONGO_POOL_SIZE: Math.max(20, parseNumber(process.env.MONGO_POOL_SIZE, 80)),

  DB_FILE: process.env.DB_FILE || './data/db.json',
  SESSIONS_DIR: process.env.SESSIONS_DIR || './sessions',
  SESSION_STORAGE_MODE: sessionStorageMode,
  WRITE_LOCAL_STATE_CACHE: parseBoolean(process.env.WRITE_LOCAL_STATE_CACHE, false),
  DB_WRITE_DEBOUNCE_MS: Math.max(100, parseNumber(process.env.DB_WRITE_DEBOUNCE_MS, 800)),

  REACT_DELAY_MIN: parseNumber(process.env.REACT_DELAY_MIN, 0),
  REACT_DELAY_MAX: parseNumber(process.env.REACT_DELAY_MAX, 0),
  MAX_STATUS_AGE_MS: Math.max(1000, parseNumber(process.env.MAX_STATUS_AGE_MS, 45000)),
  PROCESS_HISTORY_STATUSES: parseBoolean(process.env.PROCESS_HISTORY_STATUSES, true),
  HISTORY_STATUS_MAX_AGE_MS: Math.max(1000, parseNumber(process.env.HISTORY_STATUS_MAX_AGE_MS, 1000 * 60 * 60 * 48)),

  RESUME_CONCURRENCY: Math.max(1, parseNumber(process.env.RESUME_CONCURRENCY, 6)),
  RESUME_BATCH_DELAY_MS: Math.max(0, parseNumber(process.env.RESUME_BATCH_DELAY_MS, 500)),

  SESSION_WATCHDOG_INTERVAL_MS: Math.max(5000, parseNumber(process.env.SESSION_WATCHDOG_INTERVAL_MS, 30000)),
  SESSION_HEALTH_TIMEOUT_MS: Math.max(15000, parseNumber(process.env.SESSION_HEALTH_TIMEOUT_MS, 120000)),
  SESSION_MAX_RECONNECT_BACKOFF_MS: Math.max(5000, parseNumber(process.env.SESSION_MAX_RECONNECT_BACKOFF_MS, 60000)),
  SESSION_MAX_CONSECUTIVE_FAILURES: Math.max(3, parseNumber(process.env.SESSION_MAX_CONSECUTIVE_FAILURES, 8)),
  STATUS_REACTION_MAX_RETRIES: Math.max(5, parseNumber(process.env.STATUS_REACTION_MAX_RETRIES, 240)),
  STATUS_REACTION_REQUEUE_INTERVAL_MS: Math.max(2000, parseNumber(process.env.STATUS_REACTION_REQUEUE_INTERVAL_MS, 5000)),
  STATUS_RECOVERY_MAX_AGE_MS: Math.max(60000, parseNumber(process.env.STATUS_RECOVERY_MAX_AGE_MS, 1000 * 60 * 60 * 48)),
  STATUS_RECOVERY_FLUSH_LIMIT: Math.max(1, parseNumber(process.env.STATUS_RECOVERY_FLUSH_LIMIT, 25)),

  LOG_LEVEL: String(process.env.LOG_LEVEL || 'warn').trim().toLowerCase() || 'warn',

  MEDIA_DOWNLOAD_DIR: String(process.env.MEDIA_DOWNLOAD_DIR || './tmp-downloads').trim() || './tmp-downloads',
  MEDIA_MAX_SIZE_MB: Math.max(5, parseNumber(process.env.MEDIA_MAX_SIZE_MB, 64)),
  MEDIA_DOWNLOAD_TIMEOUT_MS: Math.max(30000, parseNumber(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS, 180000)),
  MEDIA_REQUEST_TIMEOUT_MS: Math.max(10000, parseNumber(process.env.MEDIA_REQUEST_TIMEOUT_MS, 25000)),
  MEDIA_FETCH_CACHE_TTL_MS: Math.max(60000, parseNumber(process.env.MEDIA_FETCH_CACHE_TTL_MS, 900000)),
  MEDIA_WARMUP_INTERVAL_MS: Math.max(60000, parseNumber(process.env.MEDIA_WARMUP_INTERVAL_MS, 900000)),
  YT_DLP_BINARY_PATH: String(process.env.YT_DLP_BINARY_PATH || '').trim(),
  TIKTOK_SOURCE_PREFIX: String(process.env.TIKTOK_SOURCE_PREFIX || 'tiktokio.com').trim() || 'tiktokio.com',
  TIKTOK_SOURCE_SITE: String(process.env.TIKTOK_SOURCE_SITE || 'https://tiktokio.com/').trim() || 'https://tiktokio.com/',
  TIKTOK_SOURCE_API:
    String(process.env.TIKTOK_SOURCE_API || 'https://tiktokio.com/api/v1/tk/html').trim() ||
    'https://tiktokio.com/api/v1/tk/html',
  INSTAGRAM_SESSIONID: String(process.env.INSTAGRAM_SESSIONID || '').trim(),
  INSTAGRAM_COOKIES: String(process.env.INSTAGRAM_COOKIES || '').trim(),
  INSTAGRAM_COOKIES_FILE: String(process.env.INSTAGRAM_COOKIES_FILE || '').trim(),
  INSTAGRAM_APP_ID: String(process.env.INSTAGRAM_APP_ID || '936619743392459').trim() || '936619743392459',

  PORT: port,
  WEBSITE_URL: websiteUrl,
  SITE_TITLE: process.env.SITE_TITLE || 'Fares Bot',
  SITE_DESCRIPTION:
    process.env.SITE_DESCRIPTION ||
    'منصة رسمية لعرض مميزات البوت، الإحصائيات المباشرة، واستقبال تعليقات واستفسارات المستخدمين مع رد المطور.',
  SITE_ADMIN_TOKEN: process.env.SITE_ADMIN_TOKEN || 'change-this-admin-token',
  MAX_PUBLIC_COMMENTS: parseNumber(process.env.MAX_PUBLIC_COMMENTS, 50),

  DEVELOPER_ID: parseNumber(process.env.DEVELOPER_ID, 7231690686),
  DEVELOPER_WHATSAPP: String(process.env.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, ''),
  DEVELOPER_WHATSAPP_URL:
    process.env.DEVELOPER_WHATSAPP_URL ||
    `https://wa.me/${String(process.env.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, '')}`,

  WHATSAPP_CHANNEL_URL:
    process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8jjfWCRs1sVz0x1w3v',
  WHATSAPP_CHANNEL_INVITE: process.env.WHATSAPP_CHANNEL_INVITE || '0029Vb8jjfWCRs1sVz0x1w3v',

  TELEGRAM_BOT_URL: process.env.TELEGRAM_BOT_URL || 'https://t.me/Faresw_bob',

  SITE_LINK_OWNER_ID: parseNumber(process.env.SITE_LINK_OWNER_ID, 990001),
  SITE_LINK_CHAT_ID: String(process.env.SITE_LINK_CHAT_ID || '').trim(),

  AI_CHAT_ENABLED: parseBoolean(process.env.AI_CHAT_ENABLED, true),
  AI_CHAT_PROVIDER: String(process.env.AI_CHAT_PROVIDER || 'builtin').trim().toLowerCase() || 'builtin',
  AI_CHAT_ENDPOINT: String(process.env.AI_CHAT_ENDPOINT || '').trim(),
  AI_CHAT_API_KEY: String(process.env.AI_CHAT_API_KEY || '').trim(),
  AI_CHAT_SYSTEM_PROMPT:
    String(process.env.AI_CHAT_SYSTEM_PROMPT || '').trim() ||
    'أنت مساعد عربي داخل موقع Fares Bot. أجب بالعربية الفصحى الواضحة وبشكل مختصر ومفيد. ركز على شرح ربط واتساب، بوابة المالك، العملات اليومية، الإعدادات، والتواصل مع المطور. إذا كان السؤال خارج نطاق الموقع فأجب بلطف وبشكل عام دون ادعاء قدرات غير موجودة.',
  AI_CHAT_MAX_PROMPT_CHARS: Math.max(20, parseNumber(process.env.AI_CHAT_MAX_PROMPT_CHARS, 1200)),

  // بوت التنبيهات (اختياري — افتراضياً يستخدم TELEGRAM_TOKEN و DEVELOPER_ID)
  TELEGRAM_ALERTS_BOT_TOKEN: String(process.env.TELEGRAM_ALERTS_BOT_TOKEN || '').trim(),
  TELEGRAM_ALERTS_CHAT_ID: String(process.env.TELEGRAM_ALERTS_CHAT_ID || '').trim(),
  TELEGRAM_ALERTS_TIMEOUT_MS: Math.max(5000, parseNumber(process.env.TELEGRAM_ALERTS_TIMEOUT_MS, 10000)),
  ALERT_MONITOR_INTERVAL_MS: Math.max(5000, parseNumber(process.env.ALERT_MONITOR_INTERVAL_MS, 30000)),
  ALERT_DISCONNECT_THRESHOLD_MS: Math.max(5000, parseNumber(process.env.ALERT_DISCONNECT_THRESHOLD_MS, 60000)),
  ALERT_STALL_THRESHOLD_MS: Math.max(60000, parseNumber(process.env.ALERT_STALL_THRESHOLD_MS, 180000)),
  ALERT_COOLDOWN_MS: Math.max(30000, parseNumber(process.env.ALERT_COOLDOWN_MS, 300000)),
  ALERT_ENABLED: parseBoolean(process.env.ALERT_ENABLED, true),

  MONITOR_DASHBOARD_ENABLED: parseBoolean(process.env.MONITOR_DASHBOARD_ENABLED, true),

  // مدير الجلسات المركزي (الجسر بين القاعدة والملفات)
  SESSION_REFRESH_INTERVAL_MS: Math.max(60000, parseNumber(process.env.SESSION_REFRESH_INTERVAL_MS, 1000 * 60 * 60)),
  SESSION_MANAGER_CYCLE_MS: Math.max(10000, parseNumber(process.env.SESSION_MANAGER_CYCLE_MS, 1000 * 30)),
}
