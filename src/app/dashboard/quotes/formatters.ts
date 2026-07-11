/**
 * 後台報價頁面的顯示格式化（列表與詳情共用）。
 * 純函式，與 React 無關——可獨立測試。
 */

const AMOUNT_FORMATTER = new Intl.NumberFormat("zh-TW");

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 金額：尚未定價（null）顯示破折號，不顯示 NT$ 0 誤導商家。 */
export function formatAmount(amount: number | null): string {
  if (amount === null) {
    return "—";
  }
  return `NT$ ${AMOUNT_FORMATTER.format(amount)}`;
}

/** 時間：DB 存 UTC，後台一律以台北時區顯示（不依伺服器時區）。 */
export function formatDateTime(isoString: string): string {
  const parts = DATE_TIME_FORMATTER.formatToParts(new Date(isoString));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
