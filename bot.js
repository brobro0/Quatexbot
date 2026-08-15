import { Telegraf, Markup } from 'telegraf';
import sharp from 'sharp';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

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
You are an expert, conservative technical analyst for binary options chart screenshots (Quotex).
Analyze this chart screenshot and respond ONLY in the following format (plain text, no code blocks):

SIGNAL: [UP or DOWN or NO TRADE]
CONFIDENCE: [0-100]%
TREND: [Identified Trend]
ASSET_TF: [Pair & Timeframe]
STRUCTURE: [Market structure: HH/HL or LH/LL or Range]
SR_LEVEL: [Key support/resistance context]
CANDLE_ANALYSIS: [Wick rejection / candle body momentum]
REASONING: [1-2 sentences concise institutional reasoning]

Rule: If the signal is conflicting, unclear, or near strong resistance/support in a sideways channel, choose NO TRADE.
`;

    // 1. Fetch available models dynamically for this exact API Key
    const listModelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    const listModelsData = await listModelsRes.json();

    if (listModelsData.error) {
      throw new Error(`Google API Key Error: ${listModelsData.error.message}`);
    }

    // Filter available models that support generateContent
    const validModels = (listModelsData.models || [])
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
      .map(m => m.name.replace('models/', ''));

    // Priority order preference
    const preferred = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro-vision'];
    const chosenModel = preferred.find(p => validModels.includes(p)) || validModels[0];

    if (!chosenModel) {
      throw new Error("আপনার API Key-এর জন্য কোনো অনুমোদিত Gemini মডেল পাওয়া যায়নি।");
    }

    // 2. Execute Vision Request with the active model
    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${GEMINI_API_KEY}`;
    const genRes = await fetch(generateUrl, {
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

    const genData = await genRes.json();

    if (genData.error) {
      throw new Error(`Model (${chosenModel}) Error: ${genData.error.message}`);
    }

    const replyText = genData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!replyText) {
      throw new Error("মডেল থেকে রেসপন্স টেক্সট পাওয়া যায়নি।");
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    
    await ctx.reply(`🎯 *ANALYSIS RESULT* (Model: \`${chosenModel}\`)\n━━━━━━━━━━━━━━━━━━━\n${replyText}\n━━━━━━━━━━━━━━━━━━━`, {
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
    console.error("Bot Execution Error:", error);
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
