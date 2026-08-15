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
  res.end('Quotex Bot is Running!\n');
}).listen(PORT, () => {
  console.log(`Port open on ${PORT}`);
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

    // Download & Preprocess image
    const imgResponse = await fetch(fileLink.href);
    const arrayBuffer = await imgResponse.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    const processedBuffer = await sharp(inputBuffer)
      .resize({ width: 1000, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const base64Data = processedBuffer.toString('base64');

    const promptText = `
You are a conservative, expert technical analyst for binary options chart screenshots (Quotex).
Analyze this chart thoroughly and provide output strictly in this format (plain text, no code blocks):

SIGNAL: [UP or DOWN or NO TRADE]
CONFIDENCE: [0-100]%
TREND: [Identified Trend]
ASSET_TF: [Pair & Timeframe]
STRUCTURE: [Market structure: HH/HL or LH/LL or Range]
SR_LEVEL: [Support/Resistance context]
CANDLE_ANALYSIS: [Wick rejection & momentum]
REASONING: [1-2 sentences institutional reasoning]

Rule: If the signal is conflicting, unclear, or in ranging chop, output NO TRADE.
`;

    // Google Interactions API Call with standard multimodal payload
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${GEMINI_API_KEY}`;
    
    const apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        input: [
          {
            role: "user",
            content: [
              {
                type: "image",
                data: base64Data,
                mime_type: "image/jpeg"
              },
              {
                type: "text",
                text: promptText
              }
            ]
          }
        ]
      })
    });

    const data = await apiRes.json();

    if (data.error) {
      throw new Error(data.error.message || "Interactions API Error");
    }

    // Extract text from outputs
    let replyText = "";
    if (data.outputs && Array.isArray(data.outputs)) {
      for (const out of data.outputs) {
        if (out.text) {
          replyText += out.text + "\n";
        } else if (out.content && Array.isArray(out.content)) {
          for (const c of out.content) {
            if (c.text) replyText += c.text + "\n";
          }
        }
      }
    } else if (data.output) {
      replyText = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    }

    replyText = replyText.trim();

    if (!replyText) {
      throw new Error("API থেকে কোনো টেক্সট আউটপুট তৈরি হয়নি।");
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    
    await ctx.reply(`🎯 *ANALYSIS RESULT*\n━━━━━━━━━━━━━━━━━━━\n${replyText}\n━━━━━━━━━━━━━━━━━━━`, {
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
    console.error("Bot Error:", error);
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
console.log("Quotex Telegram Bot is Running!");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
