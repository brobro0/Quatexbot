import { Telegraf, Markup } from 'telegraf';
import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    assetDetected: { type: Type.STRING },
    timeframeDetected: { type: Type.STRING },
    trend: { type: Type.STRING },
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

bot.start((ctx) => {
  ctx.reply("📊 Quotex AI Vision Bot Ready! আপনার চার্টের পরিষ্কার স্ক্রিনশট পাঠান।");
});

bot.on('photo', async (ctx) => {
  const waitMsg = await ctx.reply("🔍 বিশ্লেষণ করা হচ্ছে... অপেক্ষা করুন...");
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
          { text: "Analyze this Quotex chart strictly for binary options. If uncertain or conflicting, signal NO TRADE." }
        ]
      }],
      config: {
        systemInstruction: "You are a strict technical analyst. Output valid structured JSON only. Signal UP or DOWN only on strong 3+ confluence, else NO TRADE.",
        responseMimeType: 'application/json',
        responseSchema: analysisSchema,
        temperature: 0.1
      }
    });

    const res = JSON.parse(aiResponse.text);
    const signalEmoji = res.finalSignal === 'UP' ? '🟢 ⬆️ UP (CALL)' :
                        res.finalSignal === 'DOWN' ? '🔴 ⬇️ DOWN (PUT)' : '⚪ ⏸️ NO TRADE';

    const text = `🎯 *ANALYSIS REPORT*
