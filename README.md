# 回家 · The Road Home

An interactive, one page retirement map, built for one person: my mom. It turns a complex retirement workbook into something you can read, touch, and understand.

**Live site:** enable GitHub Pages on this repo (Settings → Pages → deploy from branch, root folder) and it serves as is. No build step, no dependencies.

## What it does

- **Timeline** — forty years in five chapters, with hover details on every era and milestone
- **The Conversion Machine** — a live tax bracket ladder showing why Roth conversions are cheap in some years and expensive in others
- **Where Money Comes From** — the withdrawal order, and a slider showing which accounts fund any given year
- **The China Layer** — what actually changes when retiring abroad: healthcare, Medicare decisions, keeping US accounts running
- **Will It Last** — a projection in today's dollars with adjustable market, Social Security, and spending scenarios

## How it works

Three files, vanilla HTML, CSS, and JS. One projection engine in `script.js` drives every section. All inputs are editable through the **数据 Her numbers** panel and persist in localStorage on the device. Reset returns to the plan of record.

## Honest limits

Everything is in today's dollars with simplified federal tax (2026 married brackets, Social Security modeled as 85 percent taxable). No IRMAA tiers, no capital gains detail, no Monte Carlo. This page teaches the plan and shows its shape. Decimals belong to the CPA and the advisor.