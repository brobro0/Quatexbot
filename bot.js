import { Telegraf, Markup } from 'telegraf';
import sharp from 'sharp';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// Dummy HTTP Server for Render Free Tier
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Quotex Bot is Live!\n');
}).listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_BOT_TOKEN || !GEMINI_API_KEY) {
  console.error("Missing TELEGRAM_BOT_TOKEN or GEMINI_API_KEY");
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply("📊 *Quotex AI Analyzer Active!*\nআপনার চার্টের একটি পরিষ্কার স্ক্রিনশট সেন্ড করুন।", { parse_mode: "Markdown" });
});

bot.on('photo', async (ctx) => {
  const statusMsg = await ctx.reply("🔍 _অ্যানালাইসিস করা হচ্ছে... অপেক্ষা করুন..._", { parse_mode: "Markdown" });

  try {
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Image download & compression
    const imgResponse = await fetch(fileLink.href);
    const arrayBuffer = await imgResponse.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    const processedBuffer = await sharp(inputBuffer)
      .resize({ width: 1000, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const base64Data = processedBuffer.toString('base64');

    const promptText = `
Act as a strict, institutional technical analyst for binary options chart screenshots (Quotex).
Analyze this chart and output in this exact plain format:

SIGNAL: [UP or DOWN or NO TRADE]
CONFIDENCE: [0-100]%
TREND: [Identified Trend]
ASSET_TF: [Asset & Timeframe]
STRUCTURE: [Market structure: HH/HL or LH/LL or Range]
SR_LEVEL: [Key support/resistance context]
CANDLE_ANALYSIS: [Wick rejection & momentum]
REASONING: [1-2 lines concise institutional logic]

Strict Rule: Conflicting signals, ranging market near center, or weak setups must result in NO TRADE.
`;

    // Dynamic model fallback sequence
    const modelCandidates = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-pro-vision'];
    let resultText = null;
    let apiErrorMsg = null;

    for (const model of modelCandidates) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: 'image/jpeg',
                      data: base64Data
                    }
                  },
                  { text: promptText }
                ]
              }
            ]
          })
        });

        const data = await res.json();

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
          resultText = data.candidates[0].content.parts[0].text.trim();
          break;
        } else if (data.error) {
          apiErrorMsg = data.error.message;
        }
      } catch (err) {
        apiErrorMsg = err.message;
      }
    }

    if (!resultText) {
      throw new Error(apiErrorMsg || "API কী বা মডেলে সমস্যা হচ্ছে।");
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    
    await ctx.reply(`🎯 *ANALYSIS RESULT*\n━━━━━━━━━━━━━━━━━━━\n${resultText}\n━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Win', 'outcome_win'),
          Markup.button.callback('❌ Loss', 'outcome_loss'),
          Markup.button.callback('⏭️ Skip', 'outcome_skip')
        ]
      ])
    });

  } catch (error) {
    console.error("Bot Analysis Error:", error);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `❌ সমস্যা হয়েছে: ${error.message}`
    );
  }
});

bot.action(/outcome_(.+)/, async (ctx) => {
  const outcome = ctx.match[1].toUpperCase();
  await ctx.answerCbQuery(`Outcome logged: ${outcome}`);
  await ctx.reply(`📝 Recorded: *${outcome}*`, { parse_mode: "Markdown" });
});

bot.launch();
console.log("Bot running successfully!");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
