const fs = require('fs');
const os = require('os');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');

const ENABLE_PERSISTENT_LOCAL_STORAGE = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.ENABLE_PERSISTENT_LOCAL_STORAGE || 'true').trim().toLowerCase()
);
const STORAGE_ROOT = (() => {
    const projectRoot = process.cwd();
    const runtimeRoot = path.join(projectRoot, '.runtime');
    const forceProjectStorage = !['0', 'false', 'no', 'off'].includes(String(process.env.FORCE_PROJECT_STORAGE || 'true').trim().toLowerCase());
    const candidates = [
        projectRoot,
        process.env.BOT_STORAGE_ROOT,
        process.env.RAILWAY_VOLUME_MOUNT_PATH,
        process.env.RAILWAY_PERSISTENT_DIR,
        process.env.RENDER_DISK_MOUNT_PATH,
        runtimeRoot
    ].map((item) => String(item || '').trim()).filter(Boolean);

    if (forceProjectStorage) {
        return projectRoot;
    }

    if (!ENABLE_PERSISTENT_LOCAL_STORAGE) {
        return runtimeRoot;
    }

    return candidates[0] || projectRoot;
})();
const SESSIONS_ROOT = path.join(STORAGE_ROOT, 'sessions');

const channelInfo = {
    contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363161513685998@newsletter',
            newsletterName: 'KnightBot MD',
            serverMessageId: -1
        }
    }
};

function normalizePhone(value = '') {
    return String(value || '').replace(/\D/g, '').trim();
}

function resolveCurrentSessionDir(sock) {
    const candidates = [
        sock?.user?.id,
        sock?.authState?.creds?.me?.id,
        sock?.user?.lid,
        sock?.authState?.creds?.me?.lid
    ];

    for (const candidate of candidates) {
        const phone = normalizePhone(candidate);
        if (phone) {
            return {
                phone,
                dir: path.join(SESSIONS_ROOT, phone)
            };
        }
    }

    return {
        phone: '',
        dir: path.join(__dirname, '../session')
    };
}

async function clearSessionCommand(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command can only be used by the owner!',
                ...channelInfo
            });
            return;
        }

        const { phone, dir: sessionDir } = resolveCurrentSessionDir(sock);

        if (!fs.existsSync(sessionDir)) {
            await sock.sendMessage(chatId, {
                text: phone
                    ? `❌ Session directory for ${phone} not found!`
                    : '❌ Session directory not found!',
                ...channelInfo
            });
            return;
        }

        let filesCleared = 0;
        let errors = 0;
        const errorDetails = [];

        await sock.sendMessage(chatId, {
            text: phone
                ? `🔍 Optimizing session files for ${phone}...`
                : '🔍 Optimizing session files for better performance...',
            ...channelInfo
        });

        const files = fs.readdirSync(sessionDir);
        let appStateSyncCount = 0;
        let preKeyCount = 0;
        let senderKeyCount = 0;
        let signalSessionCount = 0;

        for (const file of files) {
            if (file.startsWith('app-state-sync-')) appStateSyncCount++;
            if (file.startsWith('pre-key-')) preKeyCount++;
            if (file.startsWith('sender-key-')) senderKeyCount++;
            if (file.startsWith('session-')) signalSessionCount++;
        }

        const keepFiles = new Set([
            'creds.json',
            'session-meta.json',
            'phone-settings-profile.json',
            'phone-settings-credentials.json',
            'phone-settings-meta.json'
        ]);

        for (const file of files) {
            if (keepFiles.has(file)) {
                continue;
            }

            try {
                const filePath = path.join(sessionDir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
                filesCleared++;
            } catch (error) {
                errors++;
                errorDetails.push(`Failed to delete ${file}: ${error.message}`);
            }
        }

        const message = `✅ Session files cleared successfully!\n\n` +
            `📱 Target session: ${phone || 'legacy-default'}\n` +
            `📊 Statistics:\n` +
            `• Total files cleared: ${filesCleared}\n` +
            `• App state sync files found: ${appStateSyncCount}\n` +
            `• Pre-key files found: ${preKeyCount}\n` +
            `• Sender-key files found: ${senderKeyCount}\n` +
            `• Signal session files found: ${signalSessionCount}\n` +
            `• Preserved core files: creds + session metadata + phone settings` +
            (errors > 0 ? `\n\n⚠️ Errors encountered: ${errors}\n${errorDetails.join('\n')}` : '');

        await sock.sendMessage(chatId, {
            text: message,
            ...channelInfo
        });
    } catch (error) {
        console.error('Error in clearsession command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to clear session files!',
            ...channelInfo
        });
    }
}

module.exports = clearSessionCommand;
