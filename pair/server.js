const whatsapp = require('../whatsapp')

// This is the single integration point used by the public website and panel.
// It deliberately starts the normal WaSession, so the same persistent auth
// folder, listeners, reconnect logic, status reactions, and owner commands
// are used after pairing; no temporary credentials are discarded.
async function pairNumber(number) {
  return whatsapp.startWebPairingSession(number)
}

module.exports = { pairNumber }
