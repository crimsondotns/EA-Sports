// Draws a fake 15m candle chart behind the on-chart panel mockups (same shape on every page).
for (const svg of document.querySelectorAll("svg.chart")) {
  const W = 640, H = 300, n = 64;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let p = 120;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const drift = i < 30 ? -1.1 : i < 38 ? -3.2 : 1.6;
    const o = p, c = Math.max(40, o + drift + (rnd() - 0.5) * 7);
    bars.push({ o, c, h: Math.max(o, c) + rnd() * 4, l: Math.min(o, c) - rnd() * 4 - (i === 37 ? 9 : 0) });
    p = c;
  }
  const lo = Math.min(...bars.map((b) => b.l)) - 6, hi = Math.max(...bars.map((b) => b.h)) + 6;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const up = svg.dataset.up || "#26a69a", down = svg.dataset.down || "#ef5350";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = bars.map((b, i) => {
    const x = 8 + i * ((W - 16) / n), col = b.c >= b.o ? up : down;
    return `<line x1="${x + 3}" x2="${x + 3}" y1="${y(b.h)}" y2="${y(b.l)}" stroke="${col}"/><rect x="${x}" width="6" y="${y(Math.max(b.o, b.c))}" height="${Math.max(1, Math.abs(y(b.o) - y(b.c)))}" fill="${col}"/>`;
  }).join("") + `<line x1="0" x2="${W}" y1="${y(bars[37].l * 0.8 + 10)}" y2="${y(bars[37].l * 0.8 + 10)}" stroke="${down}" stroke-dasharray="2 4"/>`;
}
