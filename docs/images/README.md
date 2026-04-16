# Screenshots for main README

Capture each image at **1920×1080** (or 1600×900 minimum) and save to this folder with the exact filenames below. The root README references them directly.

| File | What to capture | URL |
|---|---|---|
| `hero.png` | Top half of the landing page — hero copy + vault TVL visible | https://beacon.gudman.xyz |
| `landing.png` | Full Atlas dashboard — TVL + 3 strategy cards + recent PnL | https://beacon.gudman.xyz |
| `receipt.png` | A Cascade Receipt row expanded (3 upstream payments + composite hash + anchor tx link) | https://beacon.gudman.xyz (Receipts section) |
| `demo.png` | `/docs.html#demo` — after a successful "Call signal" — JSON response + 3 upstream tx rows populated | https://beacon.gudman.xyz/docs.html#demo |
| `okx-skills.png` | 4 browser tabs tiled: wallet-risk, liquidity-depth, yield-score, mcp — each showing JSON with `okxSkill: "... (enabled)"` | `https://{wallet-risk,liquidity-depth,yield-score,safe-yield}.gudman.xyz/` |

## Tips

- Hard-refresh each page (**Ctrl+Shift+R**) before capturing so the latest bundle loads
- Use the same browser zoom level (100%) for all shots
- Crop out browser chrome if you want tighter framing — keep the URL visible though, it adds credibility
- Optional: add a thin 1px border around each screenshot for polish
- PNG preferred; use `pngquant --quality 70-90` or https://tinypng.com to shrink before committing

## After capturing

```bash
git add docs/images/*.png
git commit -m "add readme screenshots"
git push
```

GitHub will auto-render them on the repo home page.
