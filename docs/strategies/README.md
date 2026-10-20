# Strategy ทั้งหมด

กฎที่ใช้กับทุก Strategy:
- ตรวจเงื่อนไขบน**แท่งที่ปิดแล้ว** แล้วซื้อขายที่**ราคาเปิดของแท่งถัดไป**
- Backtest คิด fee 0.3% + slippage 0.5% ต่อข้าง (ไป-กลับประมาณ 1.6%)
- ถือได้ทีละ 1 ไม้ต่อเหรียญ ถ้ายังถือไม้เดิมอยู่ จะไม่ซื้อไม้ใหม่
- วิธีขายที่ใช้ร่วมกันอยู่ใน [exits.md](exits.md)

## ใน extension

| Strategy | ซื้อเมื่อ | ขาย | สถานะ |
|---|---|---|---|
| [Deep Dip](deep-dip.md) | ใต้ EMA + MACD เริ่มงัด + RSI 30–60 + แนวรับ | #3 (15m, 1h) · #1 (กราฟอื่น) | ค่าเริ่มต้น |
| [New Launch](new-launch.md) | เหมือน Deep Dip, ไม้ละ 5% | #1 | เหรียญอายุไม่ถึง 7 วัน |
| [Sharp Low](sharp-low.md) | ร่วง ≥ 10% + low 20 แท่ง + ปิดครึ่งบน | #3 | ทดลอง |
| [Stretched Low](stretched-low.md) | Sharp Low + ต่ำกว่า EMA 50 ≥ 2 ATR | #3 | ทดลอง |
| [Flush Low](flush-low.md) | ร่วง ≥ 15% + RSI 7 < 25 | #3 | ทดลอง |
| [Low Score](low-score.md) | คะแนนโมเดล ≥ −1.52 | #3 | ทดลอง, 15m |
| [Drop + Volume](drop-volume.md) | แท่งดิ่ง ≥ 1% บน volume พีค + แท่งถัดไปไม่หลุด low | #3 | ทดลอง |
| [Volume Breakout](volume-breakout.md) | ทะลุ high 20 แท่ง + volume ≥ 2.5 เท่า | ATR trailing | ไม่แนะนำ |

## เอาออกจาก extension แล้ว (ยังรันใน backtest ได้)

| Strategy | เหตุผล |
|---|---|
| [Quiet Accumulation](quiet-accumulation.md) | แพ้ Deep Dip ทุก timeframe |
| [Range Swing](range-swing.md) | backtest ขาดทุน |

## ผลรวมล่าสุด (15m, 42 เหรียญ, หลัง 1 ก.ย. 2026, ไม่นับเหรียญท็อป, ไม้ละ $880)

| Strategy | กำไร | ไม้ | เหรียญที่กำไร |
|---|---|---|---|
| Flush Low | +$13,651 | 77 | 9/42 |
| Stretched Low | +$13,635 | 84 | 16/42 |
| Sharp Low | +$13,469 | 90 | 15/42 |
| Low Score | +$10,428 | 82 | 10/42 |
| Deep Dip | +$5,656 | 283 | 11/42 |

ทุกตัวเหรียญตรงกลางกำไร $0 และ 31 วันล่าสุด (ตลาดขาลง) ขาดทุน ความต่างระหว่าง 4 ตัวบนสุดอยู่ในระดับ noise

ผลทดสอบเก่าและแบบที่ลองแล้วไม่ใช้ทั้งหมดอยู่ใน [research.md](research.md)
