'use strict'

const store = {
  messages: Object.create(null),
  addMessage(chatId, message) {
    const key = String(chatId || '')
    if (!key || !message?.key?.id) return
    if (!Array.isArray(this.messages[key])) this.messages[key] = []
    this.messages[key].push(message)
    if (this.messages[key].length > 400) this.messages[key] = this.messages[key].slice(-400)
  },
}

module.exports = store
