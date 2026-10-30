// TH / EN for the popup and the chart panel (setting `lang`, switch in the popup header).
// Fixed text is looked up by its English wording; sentences with numbers use L(en, th).
export type Lang = "en" | "th";

let lang: Lang = "en";
export const setLang = (l: Lang) => (lang = l);
export const getLang = () => lang;
/** Inline pair for text built at run time. */
export const L = (en: string, th: string) => (lang === "th" ? th : en);
/** Fixed wording: the Thai for an English string, or the English when there is none. */
export const tr = (en: string) => (lang === "th" ? (TH[en] ?? en) : en);

const TH: Record<string, string> = {
  // Popup: home
  "EA Signals": "EA Signals",
  "DEX Screener signals": "สัญญาณบน DEX Screener",
  "Other open pairs": "เหรียญอื่นที่เปิดอยู่",
  All: "ทั้งหมด",
  Signals: "สัญญาณ",
  "Filter pairs": "กรองเหรียญ",
  "Search pairs": "ค้นหาเหรียญ",
  "Alerts on": "เปิดแจ้งเตือน",
  "Alerts off": "ปิดแจ้งเตือน",
  Settings: "ตั้งค่า",
  Theme: "ธีม",
  Language: "ภาษา",
  "Dark theme": "ธีมมืด",
  "Light theme": "ธีมสว่าง",
  Dark: "มืด",
  Light: "สว่าง",
  Back: "กลับ",
  Close: "ปิด",
  // Popup: settings
  Strategy: "กลยุทธ์",
  "One strategy runs on every pair.": "ใช้กลยุทธ์เดียวกับทุกเหรียญ",
  Appearance: "หน้าตา",
  Chart: "กราฟ",
  "Signal pill on chart": "แผงสัญญาณบนกราฟ",
  "Buy checks in the chart's top-right corner; click it for details": "เงื่อนไขซื้อที่มุมขวาบนของกราฟ กดเพื่อดูรายละเอียด",
  "Pill opacity": "ความทึบของแผง",
  "Glass tint behind the panel, 20–88%; lower shows more blur": "ความทึบของกระจก 20–88% ยิ่งต่ำยิ่งเห็นเบลอ",
  "Background blur": "ความเบลอพื้นหลัง",
  "How much the candles behind blur, up to 32px (Off = solid panel)": "เบลอแท่งเทียนด้านหลังได้ถึง 32px (ปิด = แผงทึบ)",
  Off: "ปิด",
  "Open on hover": "เปิดเมื่อชี้เมาส์",
  "Hovering the minimized panel shows the details until you move away": "ชี้เมาส์ที่แผงที่ย่ออยู่ เพื่อดูรายละเอียดจนกว่าจะเลื่อนเมาส์ออก",
  "Buy / sell markers": "เครื่องหมายซื้อ / ขาย",
  "Draw backtest entries and exits on the chart": "วาดจุดเข้าและออกจาก backtest บนกราฟ",
  "STOP line": "เส้น STOP",
  "Show the open trade's stop on the chart": "แสดง stop ของไม้ที่ถืออยู่บนกราฟ",
  "Strategy indicators": "อินดิเคเตอร์ของกลยุทธ์",
  "Add the EMAs, MACD, RSI or volume the strategy uses": "เพิ่ม EMA, MACD, RSI หรือ volume ที่กลยุทธ์ใช้",
  "Calculate from": "คำนวณตั้งแต่",
  "Last 31 days": "31 วันล่าสุด",
  "Pair start": "เริ่มต้นเหรียญ",
  Recalculate: "คำนวณใหม่",
  "Loading…": "กำลังโหลด…",
  "Open a pair's chart first.": "เปิดกราฟของเหรียญก่อน",
  "Signals from a fixed point 31 days back. Loads up to 12 pages.": "สัญญาณนับจากจุดคงที่ย้อนหลัง 31 วัน โหลดได้ถึง 12 หน้า",
  "Signals from the pair's first bar. Loads the whole history once, up to 60 pages.": "สัญญาณนับจากแท่งแรกของเหรียญ โหลดประวัติทั้งหมดครั้งเดียว ได้ถึง 60 หน้า",
  Notifications: "การแจ้งเตือน",
  "Alert when a closed bar gives a buy, a 10% sell or an exit, while the chart tab is open": "แจ้งเมื่อแท่งปิดแล้วให้สัญญาณซื้อ ขาย 10% หรือออก ขณะที่แท็บกราฟเปิดอยู่",
  "Send test notification": "ส่งการแจ้งเตือนทดสอบ",
  "Notifications are blocked for this extension.": "การแจ้งเตือนของ extension นี้ถูกบล็อกอยู่",
  "Backtest signals only, not financial advice.": "เป็นสัญญาณจาก backtest เท่านั้น ไม่ใช่คำแนะนำการลงทุน",
  // Strategy descriptions in the drawer (names stay in English)
  "Buys a 10% fall that closes high": "ซื้อเมื่อร่วง 10% แล้วปิดสูง",
  "Sharp Low, stretched under EMA 50": "Sharp Low ที่ลงไปไกลใต้ EMA 50",
  "Buys a 15% flush with RSI 7 under 25": "ซื้อเมื่อร่วงแรง 15% และ RSI 7 ต่ำกว่า 25",
  "Model score for swing lows, 15m": "คะแนนจากโมเดลหาจุดต่ำ 15m",
  "Buys under the EMAs as MACD turns": "ซื้อใต้ EMA ตอน MACD เริ่มกลับตัว",
  "Deep Dip at 5% size for new pairs": "Deep Dip ขนาด 5% สำหรับเหรียญใหม่",
  "Buys a 1% drop on a volume peak": "ซื้อเมื่อร่วง 1% พร้อม volume สูงสุด",
  "Buys breakouts above the 20-bar high": "ซื้อเมื่อทะลุจุดสูงสุด 20 แท่ง",
  // Chart panel and gate
  Loading: "กำลังโหลด",
  Buy: "ซื้อ",
  Holding: "ถืออยู่",
  "Free ride": "ฟรีไรด์",
  Waiting: "รอ",
  Bought: "ซื้อที่",
  Stop: "Stop",
  "P/L": "กำไร/ขาดทุน",
  Held: "ถือมา",
  Backtest: "Backtest",
  "Next buy zone": "โซนซื้อถัดไป",
  "In zone": "อยู่ในโซน",
  Distance: "ห่าง",
  "wait for MACD turn": "รอ MACD กลับตัว",
  "Stop · Cost back": "Stop · คืนทุน",
  "Buy below": "ซื้อต่ำกว่า",
  "Below now": "ต่ำกว่าแล้ว",
  "Buy above": "ซื้อเหนือ",
  "Waiting for chart data…": "รอข้อมูลกราฟ…",
  "Hide details": "ซ่อนรายละเอียด",
  "Show details": "แสดงรายละเอียด",
  "Move up or down": "เลื่อนขึ้นลง",
  "Drag to move · double-click to reset": "ลากเพื่อย้าย · ดับเบิลคลิกเพื่อรีเซ็ต",
  "History doesn't reach the pair's start yet. Scroll the chart back, or press Recalculate in the popup.": "ประวัติยังไม่ถึงจุดเริ่มของเหรียญ เลื่อนกราฟย้อนหลังไปอีก หรือกด คำนวณใหม่ ใน popup",
  "Under 31 days of history. Scroll the chart back to load more, or press Recalculate in the popup.": "ประวัติยังไม่ถึง 31 วัน เลื่อนกราฟย้อนหลังไปอีกเพื่อโหลดเพิ่ม หรือกด คำนวณใหม่ ใน popup",
  "The extension was reloaded — refresh this page.": "extension ถูกโหลดใหม่ รีเฟรชหน้านี้",
  // Condition short labels
  "Under EMAs": "ใต้ EMA",
  "MACD turn": "MACD กลับตัว",
  RSI: "RSI",
  Support: "แนวรับ",
  "Range low": "ล่างกรอบ",
  "RSI swing low": "RSI ทำจุดต่ำ",
  "Drop + vol peak": "ร่วง + volume สูงสุด",
  "Swing low held": "จุดต่ำยืนได้",
  "Fell 10%": "ร่วง 10%",
  "Fell 15%": "ร่วง 15%",
  "20-bar low": "ต่ำสุด 20 แท่ง",
  "Upper-half close": "ปิดครึ่งบน",
  "2 ATR under EMA 50": "ต่ำกว่า EMA 50 2 ATR",
  "Close above 30%": "ปิดเหนือ 30%",
  "RSI 7 < 25": "RSI 7 < 25",
  "Low score": "คะแนนจุดต่ำ",
  Breakout: "ทะลุ",
  "Volume ×": "Volume ×",
  "Min volume": "Volume ขั้นต่ำ",
  "Trend EMA": "EMA แนวโน้ม",
  "Not extended": "ยังไม่ไกลเกิน",
  "not at support": "ยังไม่ถึงแนวรับ",
  "not yet": "ยังไม่ถึง",
};

const original = new WeakMap<Node, string>();
const ATTRS = ["aria-label", "title", "placeholder"] as const;
/** Translates the fixed text of a page (text nodes and aria-label / title), remembering the English. */
export function translatePage(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest("script, style, [data-no-i18n]")) continue;
    const en = original.get(n) ?? n.nodeValue!.trim();
    if (!en || !(en in TH)) continue;
    original.set(n, en);
    n.nodeValue = n.nodeValue!.replace(n.nodeValue!.trim(), tr(en));
  }
  for (const el of root.querySelectorAll<HTMLElement>(ATTRS.map((a) => `[${a}]`).join(","))) {
    for (const a of ATTRS) {
      const key = a === "title" ? "i18nTitle" : a === "placeholder" ? "i18nPlaceholder" : "i18nAria";
      const en = el.dataset[key] ?? el.getAttribute(a);
      if (!en || !(en in TH)) continue;
      el.dataset[key] = en;
      el.setAttribute(a, tr(en));
    }
  }
}
