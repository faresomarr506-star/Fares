const config = require('./config')
const db = require('./db')
const whatsapp = require('./whatsapp')
const monitor = require('./monitor')

let shuttingDown = false

async function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`🛑 [WA SERVICE] تم استلام ${signal} — جاري حفظ الجلسات وإيقاف الخدمة...`)

  const forceExit = setTimeout(() => {
    console.error('⏰ [WA SERVICE] انتهت مهلة الإغلاق — سيتم إنهاء العملية بالقوة')
    process.exit(1)
  }, 8000)

  try {
    try { require('./lib/session-doctor').stop() } catch (e) { console.warn('[wa-service][session-doctor] فشل الإيقاف:', e?.message || e) }
    try { require('./lib/session-manager').stop() } catch (e) { console.warn('[wa-service][session-manager] فشل الإيقاف:', e?.message || e) }
    monitor.stop()
    await whatsapp.shutdownAll()
    await db.close()
    clearTimeout(forceExit)
    process.exit(0)
  } catch (e) {
    clearTimeout(forceExit)
    console.error('[wa-service][shutdown]', e?.message || e)
    process.exit(1)
  }
}

async function main() {
  await db.load()
  try { require('./lib/session-doctor').start() } catch (e) { console.warn('[wa-service][session-doctor] فشل التشغيل:', e?.message || e) }
  try { require('./lib/session-manager').start() } catch (e) { console.warn('[wa-service][session-manager] فشل التشغيل:', e?.message || e) }
  await whatsapp.resumeAll()
  if (config.ALERT_ENABLED) {
    monitor.start()
    console.log('🔔 [WA SERVICE] مراقب التنبيهات يعمل')
  } else {
    console.log('🔕 [WA SERVICE] مراقب التنبيهات معطل')
  }
  console.log('🟢 [WA SERVICE] جلسات واتساب تعمل بدون الاعتماد على بوت تيليجرام')
}

process.once('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((e) => console.error('[wa-service][SIGINT]', e?.message || e))
})
process.once('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((e) => console.error('[wa-service][SIGTERM]', e?.message || e))
})
process.on('uncaughtException', (e) => console.error('[wa-service][خطأ عام]', e?.message || e))
process.on('unhandledRejection', (e) => console.error('[wa-service][خطأ وعد]', e?.message || e))

main().catch((e) => {
  console.error('❌ [WA SERVICE] فشل تشغيل الخدمة:', e?.message || e)
  process.exit(1)
})
