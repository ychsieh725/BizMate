/**
 * slug 生成：優先用商家帳號 email 前綴，清洗後太短則改用隨機詞組。
 * isTaken 由呼叫端注入（實際查 DB），本模組不碰網路，可獨立測試。
 */

export const ADJECTIVES = [
  "swift", "brave", "calm", "eager", "gentle",
  "happy", "jolly", "kind", "lively", "merry",
  "nimble", "proud", "quiet", "rapid", "sunny",
  "tidy", "vivid", "warm", "witty", "zesty",
] as const;

export const NOUNS = [
  "fox", "otter", "panda", "eagle", "tiger",
  "koala", "falcon", "dolphin", "lynx", "heron",
  "badger", "wren", "orca", "puma", "raven",
  "seal", "hawk", "ibis", "mole", "yak",
] as const;

const EMAIL_PREFIX_MAX_LENGTH = 20;
const MIN_VALID_PREFIX_LENGTH = 3;
const SUFFIX_RETRY_ATTEMPTS = 5;
const RANDOM_FALLBACK_ATTEMPTS = 5;

function randomIndex(random: () => number, length: number): number {
  return Math.floor(random() * length);
}

function randomDigits(random: () => number, length: number): string {
  const max = 10 ** length;
  return String(randomIndex(random, max)).padStart(length, "0");
}

/** 清洗 email 前綴：轉小寫、只保留 [a-z0-9]，截斷至安全長度。 */
export function sanitizeEmailPrefix(email: string): string {
  const prefix = email.split("@")[0] ?? "";
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, EMAIL_PREFIX_MAX_LENGTH);
}

/** 完全隨機的形容詞-名詞-4 位數字組合，當清洗結果太短時的 fallback。 */
export function randomSlugBase(random: () => number = Math.random): string {
  const adjective = ADJECTIVES[randomIndex(random, ADJECTIVES.length)];
  const noun = NOUNS[randomIndex(random, NOUNS.length)];
  return `${adjective}-${noun}-${randomDigits(random, 4)}`;
}

/** slug 候選基底：優先用清洗後的 email 前綴，太短（< 3 字元）則用隨機詞組。 */
export function slugBaseFromEmail(
  email: string,
  random: () => number = Math.random,
): string {
  const cleaned = sanitizeEmailPrefix(email);
  return cleaned.length >= MIN_VALID_PREFIX_LENGTH
    ? cleaned
    : randomSlugBase(random);
}

/**
 * 產生唯一 slug。基底撞了先加數字後綴重試，仍撞改完全隨機詞組重試；
 * 全部撞光（機率上不可能）則拋出例外，由呼叫端轉為系統錯誤回應。
 */
export async function generateUniqueSlug(
  email: string,
  isTaken: (candidate: string) => Promise<boolean>,
  random: () => number = Math.random,
): Promise<string> {
  const base = slugBaseFromEmail(email, random);
  if (!(await isTaken(base))) {
    return base;
  }

  for (let i = 0; i < SUFFIX_RETRY_ATTEMPTS; i++) {
    const candidate = `${base}-${randomDigits(random, 3)}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  for (let i = 0; i < RANDOM_FALLBACK_ATTEMPTS; i++) {
    const candidate = randomSlugBase(random);
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error("無法產生唯一 slug（重試次數已達上限）");
}
