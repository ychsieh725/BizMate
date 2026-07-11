/**
 * 驗證 rate limiting 的整合邊界（任務 3.7 驗收）。
 * 執行：npm run verify:ratelimit
 *
 * 補上單元測試的邊界：rateLimit 的單元測試 mock 了 Supabase RPC，此腳本
 * 對真實 Supabase 呼叫 increment_rate_limit，確認固定視窗 + 原子計數的行為：
 * 同一 bucket 前 N 次允許、第 N+1 次擋下（回 429 依據）。
 *
 * 前置：需先套用 migration 0003_rate_limits.sql（建立 rate_limits 表與 RPC）。
 * 使用唯一 bucket（時間戳）避免污染既有計數，驗收後可自行清除該列。
 */
import { checkRateLimit, type RateLimitRule } from "@/lib/rateLimit/rateLimit.ts";

const bucketKey = `verify:${Date.now()}`;
const rule: RateLimitRule = { limit: 3, windowMs: 60 * 60 * 1000 };

async function main(): Promise<void> {
  console.log(`bucket=${bucketKey}，limit=${rule.limit}\n`);

  let allPassed = true;
  for (let attempt = 1; attempt <= rule.limit + 1; attempt++) {
    const { allowed } = await checkRateLimit(bucketKey, rule);
    const expected = attempt <= rule.limit;
    const ok = allowed === expected;
    allPassed = allPassed && ok;
    console.log(
      `第 ${attempt} 次：allowed=${allowed}（預期 ${expected}）${ok ? "✅" : "❌"}`,
    );
  }

  // 5.9：雙桶各自獨立計數——不同 bucketKey 前綴互不影響彼此的計數與上限判斷。
  const ipBucket = `verify:ip:${Date.now()}`;
  const slugBucket = `verify:slug:${Date.now()}`;
  let dualBucketPassed = true;

  for (let attempt = 1; attempt <= rule.limit; attempt++) {
    const { allowed } = await checkRateLimit(ipBucket, rule);
    dualBucketPassed = dualBucketPassed && allowed;
  }
  const { allowed: slugStillAllowed } = await checkRateLimit(slugBucket, rule);
  dualBucketPassed = dualBucketPassed && slugStillAllowed;

  console.log(
    dualBucketPassed
      ? "✅ 雙桶彼此獨立：IP 桶打滿上限不影響 slug 桶（仍允許第一次請求）。"
      : "❌ 雙桶互相干擾——slug 桶不應被 IP 桶的計數影響。",
  );
  allPassed = allPassed && dualBucketPassed;

  console.log(
    allPassed
      ? "\n✅ 限流行為正確：前 N 次允許、第 N+1 次擋下。"
      : "\n❌ 限流行為不符預期——請確認 migration 0003 已套用（RPC 不存在會 fail-open 放行）。",
  );
  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("verify:ratelimit 執行失敗：", error);
  process.exit(1);
});
