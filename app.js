const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN not set!');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}

let activeDownloads = {};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `سلام ${msg.from.first_name}! 👋
من بات دانلود موسیقی هستم 🎵
کافیه لینک رو بفرستی تا برات mp3 بفرستم 🚀`
    );
});

bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;

    if (activeDownloads[chatId]) {
        activeDownloads[chatId].kill('SIGINT');
        delete activeDownloads[chatId];
        bot.sendMessage(chatId, 'دانلود لغو شد ❌');
    } else {
        bot.sendMessage(chatId, 'دانلود فعالی نداری.');
    }
});

bot.on('message', async (msg) => {

    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text || text.startsWith('/')) return;

    if (activeDownloads[chatId]) {
        bot.sendMessage(chatId, '⏳ هنوز دانلود قبلی تموم نشده...');
        return;
    }

    let url;
    try {
        url = new URL(text);
    } catch {
        bot.sendMessage(chatId, 'لینک معتبر نیست ❌');
        return;
    }

    const flat = spawn('yt-dlp', [
        '--flat-playlist',
        '--dump-json',
        url.href
    ]);

    let count = 0;

    flat.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        count += lines.length;
    });

    flat.on('close', async () => {

        if (count === 0) {
            bot.sendMessage(chatId, 'چیزی برای دانلود پیدا نشد ❌');
            return;
        }

        if (count > 50) {
            bot.sendMessage(chatId, `❌ این پلی‌لیست ${count} تا آهنگ دارد (حداکثر 50).`);
            return;
        }

        let current = 0;

        const progressMsg = await bot.sendMessage(
            chatId,
            `🎵 شروع دانلود...\n0 از ${count}`
        );

        const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s');

        const ytdlp = spawn('yt-dlp', [
            '-x',
            '--audio-format', 'mp3',
            '--write-thumbnail',
            '--embed-thumbnail',
            '--convert-thumbnails', 'jpg',
            '--add-metadata',
            '--postprocessor-args', 'ffmpeg:-id3v2_version 3',
            '--yes-playlist',
            '-o', outputTemplate,
            url.href
        ]);

        activeDownloads[chatId] = ytdlp;

        let lastFilePath = null;

        ytdlp.stdout.on('data', async (data) => {
            const line = data.toString();

            if (line.includes('[ExtractAudio] Destination:')) {
                const match = line.match(/Destination:\s(.+\.mp3)/);
                if (match) {
                    lastFilePath = match[1];
                }
            }

            if (line.includes('Deleting original file') && lastFilePath) {

                current++;

                try {

                    await bot.editMessageText(
                        `🎵 در حال ارسال...\n${current} از ${count}`,
                        {
                            chat_id: chatId,
                            message_id: progressMsg.message_id
                        }
                    );

                    const thumbnailPath = lastFilePath.replace('.mp3', '.jpg');

                    await bot.sendAudio(
                        chatId,
                        fs.createReadStream(lastFilePath),
                        {
                            thumb: fs.existsSync(thumbnailPath)
                                ? thumbnailPath  // ← فقط مسیر فایل
                                : undefined
                        }
                    );

                    fs.unlinkSync(lastFilePath);
                    if (fs.existsSync(thumbnailPath)) fs.unlinkSync(thumbnailPath);

                    lastFilePath = null;

                } catch (err) {
                    console.error(err);
                }
            }
        });

        ytdlp.on('close', async () => {
            delete activeDownloads[chatId];

            try {
                await bot.editMessageText(
                    `✅ دانلود کامل شد\n${count} از ${count}`,
                    {
                        chat_id: chatId,
                        message_id: progressMsg.message_id
                    }
                );
            } catch (e) {}
        });

    });

});

console.log('Music Bot Running...');