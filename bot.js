import { Telegraf, Markup } from 'telegraf';
import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

// Dummy HTTP Server - Render Free Web Service-এর জন্য জরুরি
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Quotex Vision Bot is active and running!\n');
}).listen(PORT, () => {
  console.log(`Web health-check server running on port ${PORT}`);
});

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GEMINI_API_KEY) {
  console.error("Missing TELEGRAM_BOT_TOKEN or GEMINI_API_KEY in environment variables.");
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    assetDetected: { type: Type.STRING },
    timeframeDetected: { type: Type.STRING },
    trend: { type: Type.STRING, enum: ["Strong Uptrend", "Weak Uptrend", "Strong Downtrend", "Weak Downtrend", "Ranging/Sideways", "Unclear"] },
    marketStructure: { type: Type.STRING },
    supportResistanceStatus: { type: Type.STRING },
    candlestickPatterns: { type: Type.ARRAY, items: { type: Type.STRING } },
    momentumAndWickAnalysis: { type: Type.STRING },
    indicatorsObserved: { type: Type.STRING },
    evidenceForUp: { type: Type.ARRAY, items: { type: Type.STRING } },
    evidenceForDown: { type: Type.ARRAY, items: { type: Type.STRING } },
    finalSignal: { type: Type.STRING, enum: ["UP", "DOWN", "NO TRADE"] },
    confidenceScore: { type: Type.INTEGER },
    reasoning: { type: Type.STRING },
    riskNote: { type: Type.STRING }
  },
  required: [
    "assetDetected", "timeframeDetected", "trend", "marketStructure",
    "supportResistanceStatus", "candlestickPatterns", "momentumAndWickAnalysis",
    "indicatorsObserved", "evidenceForUp", "evidenceForDown", "finalSignal",
    "confidenceScore", "reasoning", "riskNote"
  ]
};

const SYSTEM_INSTRUCTION = `
You are a conservative Technical Analysis Engine for Quotex binary charts.
RULES:
1. Examine Market Structure (HH, HL, LH, LL), S/R levels, Rejections, Momentum, EMAs, RSI/MACD.
2. If signals conflict or market is choppy/unclear, return 'NO TRADE'.
3. Signal UP or DOWN ONLY when there are at least 3 solid confluence confirmations.
4. Confidence score (0-100) measures confluence clarity, not guaranteed win rate.
`;

bot.start((ctx) => {
  ctx.reply(
    "📊 *Quotex AI Vision Analyzer-এ স্বাগতম!*\n\n" +
    "আপনার Quotex চার্টের একটি পরিষ্কার স্ক্রিনশট সেন্ড করুন। AI সাথে সাথে টেকনিক্যাল কনফ্লুয়েন্স অ্যানালাইসিস করে সিগন্যাল দেবে।\n\n" +
    "⚠️ *সতর্কতা:* কনফ্লুয়েন্স দুর্বল থাকলে বট 'NO TRADE' দেবে।",
    { parse_mode: "Markdown" }
  );
});

bot.on('photo', async (ctx) => {
  const statusMsg = await ctx.reply("🔍 _চার্ট প্রসেসিং ও ডিপ টেকনিক্যাল অ্যানালাইসিস চলছে... অনুগ্রহ করে অপেক্ষা করুন..._", { parse_mode: "Markdown" });

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

    const base64Data = processedBuffer.toString('base64');

    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
          { text: "Analyze this Quotex screenshot with strict technical rules and output structured JSON." }
        ]
      }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: analysisSchema,
        temperature: 0.1
      }
    });

    const res = JSON.parse(aiResponse.text);

    const signalEmoji = res.finalSignal === 'UP' ? '🟢 ⬆️ UP (CALL)' :
                        res.finalSignal === 'DOWN' ? '🔴 ⬇️ DOWN (PUT)' : '⚪ ⏸️ NO TRADE';

    const upBullets = res.evidenceForUp.length ? res.evidenceForUp.map(e => `  • ${e}`).join('\n') : '  • None';
    const downBullets = res.evidenceForDown.length ? res.evidenceForDown.map(e => `  • ${e}`).join('\n') : '  • None';

    const replyText = 
`🎯 *ANALYSIS RESULT*
━━━━━━━━━━━━━━━━━━━
🚦 *Signal:* *${signalEmoji}*
📊 *Confluence Score:* *${res.confidenceScore}%*
📈 *Trend:* ${res.trend}
⏱️ *Asset / TF:* ${res.assetDetected || 'OTC/Market'} | ${res.timeframeDetected || 'N/A'}

🏛️ *Structure:* ${res.marketStructure}
🎯 *Key Levels (S/R):* ${res.supportResistanceStatus}
🕯️ *Candles & Wick:* ${res.candlestickPatterns.join(', ')} | ${res.momentumAndWickAnalysis}
📉 *Indicators:* ${res.indicatorsObserved}

🟢 *Bullish Factors:*
${upBullets}

🔴 *Bearish Factors:*
${downBullets}

🧠 *Reasoning:*
${res.reasoning}

⚠️ *Risk Note:* ${res.riskNote}
━━━━━━━━━━━━━━━━━━━`;

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    
    await ctx.reply(replyText, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Win', 'outcome_win'),
          Markup.button.callback('❌ Loss', 'outcome_loss'),
          Markup.button.callback('⏭️ Skipped', 'outcome_skip')
        ]
      ])
    });

  } catch (error) {
    console.error("Bot Error:", error);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      "❌ অ্যানালাইসিস ব্যর্থ হয়েছে। চার্টটি পরিষ্কার এবং রিডেবল কি না দেখে আবার পাঠান।"
    );
  }
});

bot.action(/outcome_(.+)/, async (ctx) => {
  const outcome = ctx.match[1].toUpperCase();
  await ctx.answerCbQuery(`Outcome logged: ${outcome}`);
  await ctx.reply(`📝 Trade outcome recorded as: *${outcome}*`, { parse_mode: "Markdown" });
});

bot.launch();
console.log("🚀 Telegram Analyzer Bot is fully initialized!");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
