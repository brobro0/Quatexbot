import { Telegraf, Markup } from 'telegraf';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
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

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GEMINI_API_KEY) {
  console.error("Missing TELEGRAM_BOT_TOKEN or GEMINI_API_KEY");
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const analysisSchema = {
  type: SchemaType.OBJECT,
  properties: {
    assetDetected: { type: SchemaType.STRING },
    timeframeDetected: { type: SchemaType.STRING },
    trend: { type: SchemaType.STRING },
    marketStructure: { type: SchemaType.STRING },
    supportResistanceStatus: { type: SchemaType.STRING },
    candlestickPatterns: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    momentumAndWickAnalysis: { type: SchemaType.STRING },
    indicatorsObserved: { type: SchemaType.STRING },
    evidenceForUp: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    evidenceForDown: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    finalSignal: { type: SchemaType.STRING },
    confidenceScore: { type: SchemaType.INTEGER },
    reasoning: { type: SchemaType.STRING },
    riskNote: { type: SchemaType.STRING }
  },
  required: [
    "assetDetected", "timeframeDetected", "trend", "marketStructure",
    "supportResistanceStatus", "candlestickPatterns", "momentumAndWickAnalysis",
    "indicatorsObserved", "evidenceForUp", "evidenceForDown", "finalSignal",
    "confidenceScore", "reasoning", "riskNote"
  ]
};

const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  systemInstruction: "You are a conservative Technical Analysis Engine for Quotex binary charts. Examine S/R levels, Rejections, Momentum, EMAs. If conflicted return 'NO TRADE'. UP or DOWN only on 3+ confluences.",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: analysisSchema,
    temperature: 0.1
  }
});

bot.start((ctx) => {
  ctx.reply("📊 *Quotex AI Analyzer Active!*\nআপনার চার্টের একটি পরিষ্কার স্ক্রিনশট সেন্ড করুন।", { parse_mode: "Markdown" });
});

bot.on('photo', async (ctx) => {
  const statusMsg = await ctx.reply("🔍 _অ্যানালাইসিস করা হচ্ছে... অপেক্ষা করুন..._", { parse_mode: "Markdown" });

  try {
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const response = await fetch(fileLink.href);
    const buffer = Buffer.from(await response.arrayBuffer());

    const processedBuffer = await sharp(buffer)
      .resize({ width: 1400, fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: processedBuffer.toString('base64')
        }
      },
      "Analyze this Quotex screenshot with strict technical rules."
    ]);

    const res = JSON.parse(result.response.text());

    const signalEmoji = res.finalSignal.toUpperCase() === 'UP' ? '🟢 ⬆️ UP (CALL)' :
                        res.finalSignal.toUpperCase() === 'DOWN' ? '🔴 ⬇️ DOWN (PUT)' : '⚪ ⏸️ NO TRADE';

    const text = 
`🎯 *ANALYSIS RESULT*
━━━━━━━━━━━━━━━━━━━
🚦 *Signal:* *${signalEmoji}*
📊 *Confidence:* *${res.confidenceScore}%*
📈 *Trend:* ${res.trend}
⏱️ *Asset / TF:* ${res.assetDetected || 'Market'} | ${res.timeframeDetected || 'TF'}

🏛️ *Structure:* ${res.marketStructure}
🎯 *S/R Level:* ${res.supportResistanceStatus}
🕯️ *Candles:* ${res.candlestickPatterns.join(', ')} | ${res.momentumAndWickAnalysis}
📉 *Indicators:* ${res.indicatorsObserved}

🟢 *Bullish Factors:*
${res.evidenceForUp.length ? res.evidenceForUp.map(e => ` • ${e}`).join('\n') : ' • None'}

🔴 *Bearish Factors:*
${res.evidenceForDown.length ? res.evidenceForDown.map(e => ` • ${e}`).join('\n') : ' • None'}

🧠 *Reasoning:* ${res.reasoning}
⚠️ *Warning:* ${res.riskNote}
━━━━━━━━━━━━━━━━━━━`;

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Win', 'win'), Markup.button.callback('❌ Loss', 'loss')]
      ])
    });

  } catch (error) {
    console.error(error);
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, "❌ অ্যানালাইসিস ব্যর্থ হয়েছে। চার্টটি পরিষ্কার করে আবার পাঠান।");
  }
});

bot.action(/win|loss/, (ctx) => ctx.answerCbQuery("Result recorded!"));

bot.launch();
console.log("Bot running!");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
