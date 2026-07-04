import { GoogleGenAI } from "@google/genai";
import { requireEnv } from "@/lib/env.ts";

/**
 * Gemini client 單例。
 * ⚠️ 僅供伺服器端使用：GEMINI_API_KEY 為機密，不進客戶端 bundle。
 * 用 requireEnv 在此明確要求該變數（env.ts 中它是 optional，缺少時報清楚錯誤）。
 */
let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  return cachedClient;
}
