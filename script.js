/* ============ 回家 · The Road Home — engine & UI ============ */
"use strict";

/* ---------- plan of record ---------- */
const DEFAULTS = {
  currentAge: 56, retireAge: 60, endAge: 95,
  /* her real snapshot. Workplace plans counted as if already rolled over:
     $120k of workplace money is Roth, the rest is pre tax. SERP and 529 excluded. */
  trad: 1292907, roth: 259260, hsa: 33574, brokerage: 60042, cash: 157640,
  college529: 160483, serp: 55576, /* shown for completeness, never counted in the portfolio */
  houseAge: 60, houseNet: 800000,
  spendTo74: 123000, spend75: 94000,
  ret: 6.5, inflation: 2.5, cashYield: 2.8,
  ssAge: 70, ssAnnual: 80400,
  workingTaxable: 270000, workCeiling: 24, gapCeiling: 22, convStop: 70,
  reserveMonths: 18,
};
const STORE_KEY = "road-home-v2";

let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULTS };
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }

let lastChartRows = [];
/* what-if layer for section 5 (not persisted) */
let W = { ret: null, ssAge: null, spendMult: 1, lens: "real" };

/* ---------- tax math (2026 MFJ, held steady in real terms) ---------- */
const BR = [
  { top: 24800, r: 0.10 }, { top: 100800, r: 0.12 }, { top: 211400, r: 0.22 },
  { top: 403550, r: 0.24 }, { top: 512450, r: 0.32 }, { top: 768700, r: 0.35 },
  { top: Infinity, r: 0.37 },
];
const STD = 32200, STD65 = 3300;
function taxOn(t) {
  let tax = 0, prev = 0;
  for (const b of BR) {
    const amt = Math.min(t, b.top) - prev;
    if (amt > 0) tax += amt * b.r;
    prev = b.top;
    if (t <= b.top) break;
  }
  return Math.max(0, tax);
}
function bracketTop(pct) {
  const b = BR.find(x => Math.round(x.r * 100) === pct);
  return b ? b.top : 0;
}
function ssFactor(age) { return age >= 70 ? 1 : age >= 67 ? 0.806 : 0.565; } /* approx vs age 70 */

/* ---------- the engine: one simulation, every section reads it ---------- */
function simulate(opts = {}) {
  const p = { ...S, ...opts };
  const ret = (p.ret) / 100, infl = p.inflation / 100;
  const rr = (1 + ret) / (1 + infl) - 1;                 /* real investment return */
  const crr = (1 + p.cashYield / 100) / (1 + infl) - 1;  /* real cash return */
  const spendMult = opts.spendMult ?? 1;
  const ssAge = opts.ssAge ?? p.ssAge;
  const ssBase = p.ssAnnual * ssFactor(ssAge);

  let trad = p.trad, roth = p.roth, hsa = p.hsa, brok = p.brokerage, cash = p.cash;
  const rows = [];

  for (let a = p.currentAge; a <= p.endAge; a++) {
    const working = a < p.retireAge;
    const ded = STD + (a >= 65 ? STD65 : 0);

    /* contributions */
    if (a === p.houseAge) cash += p.houseNet;

    const ss = a >= ssAge ? ssBase : 0;
    const taxableSS = ss * 0.85;
    const interest = Math.max(0, cash) * (p.cashYield / 100);

    /* conversion */
    let conv = 0;
    const ceil = working ? p.workCeiling : p.gapCeiling;
    if (ceil > 0 && a < p.convStop && trad > 0) {
      const baseTaxable = working
        ? p.workingTaxable
        : Math.max(0, interest + taxableSS - ded);
      conv = Math.min(trad, Math.max(0, bracketTop(ceil) - baseTaxable));
    }
    trad -= conv; roth += conv;

    /* spending, taxes, withdrawals */
    const spend = working ? 0 : (a <= 74 ? p.spendTo74 : p.spend75) * spendMult;
    let rmd = 0;
    if (a >= 75 && trad > 0) rmd = trad / Math.max(6, 24.6 - (a - 75) * 0.8);

    const reserve = (!working && a >= 65) ? (p.reserveMonths / 12) * spend : 0;
    let tradWd = Math.min(trad, rmd), tax = 0, f = null, shortfall = 0;

    for (let pass = 0; pass < 3; pass++) {
      if (working) {
        tax = taxOn(p.workingTaxable + conv) - taxOn(p.workingTaxable);
      } else {
        const gross = Math.max(0, interest + taxableSS + conv + tradWd - ded);
        tax = taxOn(gross);
      }
      let need = spend + tax - ss;
      f = { ss: Math.min(ss, spend + tax), cash: 0, brok: 0, trad: 0, roth: 0 };
      let n = Math.max(0, need);
      f.cash = Math.min(n, Math.max(0, cash - reserve)); n -= f.cash;
      f.brok = Math.min(n, brok); n -= f.brok;
      f.trad = Math.min(n, trad); n -= f.trad;
      f.roth = Math.min(n, roth); n -= f.roth;
      shortfall = n;
      const nw = Math.max(rmd, f.trad);
      if (Math.abs(nw - tradWd) < 1) break;
      tradWd = Math.min(trad, nw);
    }

    cash -= f.cash; brok -= f.brok; roth -= f.roth;
    trad -= tradWd;
    cash += Math.max(0, tradWd - f.trad);   /* extra rmd lands in cash */
    if (working && tax > 0) {               /* conversion tax paid from cash */
      cash -= tax;
      if (cash < 0) { brok += cash; cash = 0; if (brok < 0) brok = 0; }
    }

    /* grow */
    trad *= 1 + rr; roth *= 1 + rr; brok *= 1 + rr; hsa *= 1 + rr;
    cash *= 1 + crr;

    rows.push({
      age: a, year: 2026 + (a - 56), working,
      trad: Math.max(0, trad), roth: Math.max(0, roth), hsa: Math.max(0, hsa),
      brok: Math.max(0, brok), cash: Math.max(0, cash),
      conv, tax, rmd: tradWd >= rmd ? rmd : tradWd, ss, spend, fund: f, shortfall,
      total: Math.max(0, trad) + Math.max(0, roth) + Math.max(0, hsa) + Math.max(0, brok) + Math.max(0, cash),
    });
  }
  return rows;
}

/* ---------- formatting ---------- */
const fmt$ = n => "$" + Math.round(n).toLocaleString("en-US");
const fmtK = n => n >= 1e6 ? "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M"
  : "$" + Math.round(n / 1000) + "k";
const fmtPct = n => (n * 100).toFixed(1) + "%";

/* ============================================================
   ① TIMELINE
============================================================ */
const ERAS = [
  {
    id: 0, from: 56, to: 59, cn: "耕耘", name: "Work & Convert", color: "var(--era1)",
    tip: "Earn, save, and start moving money to the Roth while the paycheck still flows.",
    purpose: "Earn, save, and begin moving money from Traditional to Roth, filling but never passing the 24 percent bracket.",
    actions: "Keep filling the workplace accounts and saving cash, and update the balances on this page as they grow. Convert in stages each November and December after a fresh tax projection, and pay the tax from cash. Finish the Texas will, trust, and powers of attorney, and audit every beneficiary form.",
    watch: "A conversion here costs about 24 cents per dollar. It is only worth it because it erases a much larger tax later, so never drift past the ceiling."
  },
  {
    id: 1, from: 60, to: 64, cn: "黄金", name: "The Golden Window", color: "var(--era2)",
    tip: "Retired, no salary, no Social Security yet. The cheapest tax years of your life.",
    purpose: "The cheapest tax years of your life. No salary, no Social Security yet. Convert the rest of Traditional at low rates while living on cash.",
    actions: "Retire at 60. Sell the house, about $800,000 becomes the cash bridge. Move home to China. Live on cash only, touch nothing else. Convert in stages every year, most of Traditional should be gone by about 62 or 63.",
    watch: "Protect the age 63 tax year. That income sets the first Medicare premiums at 65. And every conversion dollar here starts at the bottom of the brackets, where the first slice is free and the next is taxed at 10 and 12 percent."
  },
  {
    id: 2, from: 65, to: 69, cn: "过渡", name: "Medicare Bridge", color: "var(--era3)",
    tip: "US Medicare begins. Decide what to enroll in from China. Withdrawals may begin.",
    purpose: "US Medicare eligibility arrives in August 2035. Decide what to enroll in, knowing Medicare pays nothing outside the US. Portfolio withdrawals may begin if cash runs low.",
    actions: "Enroll in Part A, it is free. Make a real decision on Part B rather than drifting. Finish any last conversions. From here an 18 month cash reserve is protected, and any withdrawals follow the order: cash, brokerage, Traditional, Roth.",
    watch: "Skipping Part B saves premiums but adds a lifetime late penalty of roughly 10 percent per year skipped if you ever return to the US and want it."
  },
  {
    id: 3, from: 70, to: 74, cn: "收获", name: "Social Security Era", color: "var(--era4)",
    tip: "The reward for waiting. About $80,400 a year begins and covers most spending.",
    purpose: "The reward for waiting until 70. About $80,400 a year begins, in today's dollars, and covers most of the budget. The portfolio mostly rests.",
    actions: "Apply around April 2040 for an August start. Set up withholding. Social Security is paid to US citizens living in China, keep the SSA address and bank details current.",
    watch: "Waiting from 62 to 70 nearly doubles the check, for life, with inflation adjustments. That is why the cash bridge exists: it buys the waiting."
  },
  {
    id: 4, from: 75, to: 95, cn: "传承", name: "RMD Era", color: "var(--era5)",
    tip: "Required withdrawals begin at 75. If the plan worked, there is almost nothing left to require.",
    purpose: "Required minimum distributions begin at 75. If twenty years of conversions did their job, the Traditional account is nearly empty and the required amounts are nearly zero.",
    actions: "Take any small RMD by December 31 each year. Keep the November review going. Let the Roth compound untouched, it is the legacy, tax free to your son with ten more years of tax free growth after that.",
    watch: "This chapter is where the whole strategy pays off, as taxes that simply never happen."
  },
];

const MILESTONES = [
  { age: 56, label: "The plan begins", tip: "2026. First staged conversion, after a fresh tax projection. Beneficiary audit and estate documents start this year." },
  { age: 60, label: "Retire, sell, go home", tip: "2030. Retirement, the house sale, and the move to China. The cash bridge begins carrying everything." },
  { age: 63, label: "The quiet year", tip: "2033. Income this year sets the 2035 Medicare premiums. Keep it calm, no accidental spikes." },
  { age: 65, label: "Medicare", tip: "August 2035. Part A yes, it is free. Part B is a genuine decision from China." },
  { age: 70, label: "Social Security", tip: "August 2040. About $80,400 a year begins, in today's dollars. Apply around April." },
  { age: 75, label: "First RMD", tip: "2045. Required withdrawals begin, and should be close to zero. Take it by December 31." },
];

function buildTimeline() {
  const band = document.getElementById("tlBand");
  band.innerHTML = "";
  const span = 96 - 56;
  ERAS.forEach(e => {
    const yrs = e.to - e.from + 1;
    const el = document.createElement("button");
    el.className = "era";
    el.style.background = e.color;
    el.style.flexGrow = e.id === 4 ? yrs * 0.55 : yrs; /* soften the long last era */
    el.innerHTML = `<span class="cnmark">${e.cn}</span>
      <span class="era-label">${e.name}<small>${e.from} to ${e.to}</small></span>`;
    el.addEventListener("mousemove", ev => showTip(ev, `<b>${e.name} · ${e.from} to ${e.to}</b>${e.tip}`));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("click", () => selectEra(e.id));
    el.addEventListener("focus", ev => showTip(ev, `<b>${e.name}</b>${e.tip}`));
    el.addEventListener("blur", hideTip);
    band.appendChild(el);
  });
  /* milestones positioned over the flexed band */
  const wrap = band.parentElement;
  wrap.querySelectorAll(".milestone").forEach(d => d.remove());
  requestAnimationFrame(() => {
    const kids = [...band.children];
    MILESTONES.forEach(m => {
      const era = ERAS.find(e => m.age >= e.from && m.age <= e.to);
      const el = kids[era.id];
      if (!el) return;
      const frac = (m.age - era.from) / (era.to - era.from + 1);
      const x = el.offsetLeft + frac * el.offsetWidth + 8;
      const dot = document.createElement("span");
      dot.className = "milestone";
      dot.tabIndex = 0;
      dot.style.left = x + "px";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", m.label);
      dot.addEventListener("mousemove", ev => showTip(ev, `<b>Age ${m.age} · ${m.label}</b>${m.tip}`));
      dot.addEventListener("mouseleave", hideTip);
      dot.addEventListener("focus", ev => showTip(ev, `<b>Age ${m.age} · ${m.label}</b>${m.tip}`));
      dot.addEventListener("blur", hideTip);
      wrap.appendChild(dot);
    });
  });
  const axis = document.getElementById("tlAxis");
  axis.innerHTML = ["2026", "2030", "2035", "2040", "2045", "2055", "2065"]
    .map(y => `<span>${y}</span>`).join("");
  selectEra(selectedEra);
}
let selectedEra = 1;

function selectEra(id) {
  selectedEra = id;
  const e = ERAS[id];
  document.querySelectorAll(".era").forEach((el, i) => el.classList.toggle("active", i === id));
  const d = document.getElementById("tlDetail");
  d.style.borderLeftColor = e.color;
  d.innerHTML = `
    <h3><span class="cn">${e.cn}</span> ${e.name} <span class="years">ages ${e.from} to ${e.to}</span></h3>
    <div class="block"><b>What this chapter is for</b>${e.purpose}</div>
    <div class="block"><b>What happens in it</b>${e.actions}</div>
    <div class="block"><b>Worth watching</b>${e.watch}</div>`;
}

/* tooltip */
const tipEl = document.getElementById("tooltip");
function showTip(ev, html) {
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const x = (ev.clientX ?? (ev.target.getBoundingClientRect().left + 10));
  const y = (ev.clientY ?? ev.target.getBoundingClientRect().top);
  const w = tipEl.offsetWidth;
  tipEl.style.left = Math.min(window.innerWidth - w - 12, x + 14) + "px";
  tipEl.style.top = Math.max(8, y - tipEl.offsetHeight - 14) + "px";
}
function hideTip() { tipEl.hidden = true; }

/* ============================================================
   ② CONVERSIONS
============================================================ */
let convMode = "working";

function gapBaseTaxable() {
  /* golden window baseline: interest on the bridge, minus the deduction */
  const interest = (S.cash + S.houseNet) * (S.cashYield / 100);
  return Math.max(0, interest - STD);
}
function convBaseTaxable() { return convMode === "working" ? S.workingTaxable : gapBaseTaxable(); }

function renderLadder() {
  const base = convBaseTaxable();
  const conv = +document.getElementById("convSlider").value;
  const ceil = convMode === "working" ? S.workCeiling : 24;
  const ladder = document.getElementById("ladder");
  const maxShow = 512450;
  ladder.innerHTML = "";
  let prev = 0;
  for (const b of BR) {
    if (prev >= maxShow) break;
    const top = Math.min(b.top, maxShow);
    const width = top - prev;
    const baseIn = Math.max(0, Math.min(base, top) - prev);
    const convIn = Math.max(0, Math.min(base + conv, top) - Math.max(base, prev));
    const row = document.createElement("div");
    row.className = "rung" + (Math.round(b.r * 100) === ceil ? " ceiling" : "");
    row.innerHTML = `
      <span class="rate">${Math.round(b.r * 100)}%</span>
      <span class="bar">
        <span class="fill-base" style="width:${(baseIn / width) * 100}%"></span>
        <span class="fill-conv" style="width:${(convIn / width) * 100}%"></span>
      </span>
      <span class="range">${fmtK(prev)} to ${b.top === Infinity ? "…" : fmtK(top)}</span>`;
    row.addEventListener("mousemove", ev => showTip(ev,
      `<b>${Math.round(b.r * 100)}% bracket</b>Taxable income from ${fmt$(prev)} to ${b.top === Infinity ? "beyond" : fmt$(b.top)}. ${Math.round(b.r * 100) === ceil ? "This is the ceiling. Fill it if it makes sense this year, never pass it." : ""}`));
    row.addEventListener("mouseleave", hideTip);
    ladder.appendChild(row);
    prev = b.top;
  }
  const key = document.createElement("div");
  key.className = "ladder-key";
  key.innerHTML = `<span><span class="key-dot" style="background:var(--slate)"></span>${convMode === "working" ? "Salary income already there" : "Interest income already there"}</span>
    <span><span class="key-dot" style="background:var(--gold)"></span>Your conversion</span>
    <span><span class="key-dot" style="background:none;outline:2px dashed var(--danger);outline-offset:-1px"></span>The ceiling</span>`;
  ladder.appendChild(key);

  const tax = taxOn(base + conv) - taxOn(base);
  document.getElementById("convAmtLabel").textContent = fmt$(conv);
  document.getElementById("convTax").textContent = fmt$(tax);
  document.getElementById("convRate").textContent = conv > 0 ? fmtPct(tax / conv) : "0%";
  const marg = BR.find(b => base + conv <= b.top).r;
  document.getElementById("convMarg").textContent = Math.round(marg * 100) + "%";
  document.getElementById("convBase").textContent = convMode === "working"
    ? `Starting point: about ${fmt$(S.workingTaxable)} of taxable salary income is already on the ladder.`
    : `Starting point: almost nothing. Only about ${fmt$(gapBaseTaxable())} of interest is on the ladder, so your conversion starts at the very bottom.`;
}

function renderConvCompare() {
  const w = taxOn(S.workingTaxable + 100000) - taxOn(S.workingTaxable);
  const g = taxOn(gapBaseTaxable() + 100000) - taxOn(gapBaseTaxable());
  document.getElementById("cmpWork").textContent = fmt$(w);
  document.getElementById("cmpGap").textContent = fmt$(g);
}

function renderConvPayoff() {
  const withPlan = simulate();
  const noConv = simulate({ workCeiling: 0, gapCeiling: 0 });
  const at75 = a => a.find(r => r.age === 75);
  const at95 = a => a[a.length - 1];
  const p75 = at75(withPlan), n75 = at75(noConv);
  const taxesPaid = withPlan.filter(r => r.age < 75).reduce((s, r) => s + (r.working ? r.tax : 0), 0)
    + withPlan.filter(r => !r.working && r.age < 70).reduce((s, r) => s + r.tax, 0);
  const el = document.getElementById("convPayoff");
  el.innerHTML = `
    <li>Traditional balance at 75: <strong>${fmtK(p75.trad)}</strong> with the plan, versus <strong>${fmtK(n75.trad)}</strong> without it.</li>
    <li>First required withdrawal at 75: <strong>${fmtK(p75.rmd)}</strong> versus <strong>${fmtK(n75.rmd)}</strong>, taxed as income every year after.</li>
    <li>Tax free Roth at 95, the legacy: <strong>${fmtK(at95(withPlan).roth)}</strong> versus <strong>${fmtK(at95(noConv).roth)}</strong>.</li>
    <li>Conversion taxes paid along the way, the price of all this: about <strong>${fmtK(taxesPaid)}</strong>.</li>`;
}

/* ============================================================
   ③ INCOME
============================================================ */
const BUCKET_HTML = `
<p class="layer-head">Layer one · What gets sold</p>
<p class="layer-note">Money is organized in three buckets by risk, flowing one way, downhill. Life is
paid from the calmest bucket, and each bucket refills the one below it. Hover anything.</p>
<div class="bucket-flow">
  <div class="bucket growth">
    <h4>Growth Engine <span class="cn">增长</span></h4>
    <p class="b-role">Decades of compounding, left alone</p>
    <span class="b-cap">Lives in</span>
    <div class="chips">
      <span class="chip acct" data-tip="The most precious space she owns. Gains are never taxed, it is touched last, and it passes to her son with ten more tax free years. The highest expected growth belongs here.">Roth</span>
      <span class="chip acct" data-tip="Growth held here has its own superpower: at death the gains are wiped out by the step up in basis. So growth in this account is held until death, not sold late in life.">Individual, the step up sleeve</span>
    </div>
    <span class="b-cap">Holds</span>
    <div class="chips">
      <span class="chip" data-tip="Broad, boring, global stock index funds. The core of the engine.">Stock index funds</span>
      <span class="chip" data-tip="A small, capped position. Highest expected growth, so if held at all it belongs in the Roth where the upside is never taxed.">Bitcoin</span>
      <span class="chip" data-tip="A small diversifier. Note gold is taxed as a collectible in the taxable account, worth confirming placement with the advisor.">Gold</span>
    </div>
    <p class="b-job">The rule: never sold in a bad year. The two buckets downstream exist precisely so this one is never touched under pressure.</p>
  </div>
  <div class="flow-arrow"><span class="fa-line">→</span><span class="fa-cap">refills stable, in good years only</span></div>
  <div class="bucket stable">
    <h4>Stable <span class="cn">稳定</span></h4>
    <p class="b-role">Several years of calm money</p>
    <span class="b-cap">Lives in</span>
    <div class="chips">
      <span class="chip acct" data-tip="The main home of the stable bucket. Treasury ladders and T bills sit here, ready to refill the buffer on a schedule.">Individual</span>
      <span class="chip acct" data-tip="A temporary home. This account is melting into the Roth through conversions, so what waits inside stays calm, keeping each year's conversion amount predictable against the bracket ceiling.">Traditional, while it lasts</span>
    </div>
    <span class="b-cap">Holds</span>
    <div class="chips">
      <span class="chip" data-tip="Short government paper. No drama, real yield, matures on a schedule.">T bills</span>
      <span class="chip" data-tip="A ladder of maturities timed to the years they will be spent, especially 65 to 70.">Treasury ladder</span>
    </div>
    <p class="b-job">Sized to carry roughly 65 to 70, the heavy withdrawal years before Social Security. A bond tent: deepest exactly when a bad market would hurt most.</p>
  </div>
  <div class="flow-arrow"><span class="fa-line">→</span><span class="fa-cap">refills the buffer on a schedule</span></div>
  <div class="bucket buffer">
    <h4>Cash Buffer <span class="cn">现金</span></h4>
    <p class="b-role">Pays for life</p>
    <span class="b-cap">Lives in</span>
    <div class="chips">
      <span class="chip acct" data-tip="The reservoir. High yield savings holding the bridge money and the protected reserve, sending a monthly amount to checking like a self paid paycheck.">HYSA</span>
      <span class="chip acct" data-tip="The faucet. Checking for bills and daily life. Holds a month or two of spending, never more.">Bank of America</span>
    </div>
    <span class="b-cap">Holds</span>
    <div class="chips">
      <span class="chip" data-tip="Plain cash and money market. Its job is availability, not return.">Cash, money market</span>
    </div>
    <p class="b-job">Through 64 this bucket carries everything, that is the bridge. From 65 it holds the protected 18 month reserve. It is allowed to be boring.</p>
  </div>
</div>
<div class="bucket-side">
  <span class="chip acct" data-tip="Triple tax advantaged: deductible in, grows free, tax free out for qualified care. Contributions continue through 64.">HSA</span>
  <p>A small bucket with one job: healthcare. It sits outside the flow, invested for growth, reserved for medical costs.</p>
</div>
<div class="bucket-side">
  <span class="chip acct" data-tip="Nonqualified deferred compensation from Baylor Scott White. It cannot be rolled over or converted. It pays out on its own schedule and is taxed as ordinary income when it does. Confirm the payout timing with HR.">SERP</span>
  <p>About <strong id="cserp"></strong> waits here. It will arrive as taxable income on the employer's schedule, worth knowing which years so it does not collide with a conversion.</p>
</div>
<div class="bucket-side">
  <span class="chip acct" data-tip="The Morgan Stanley 529. Education money with its own beneficiary and its own rules. It is real, it is hers, and it is deliberately not counted anywhere in this plan.">College 529</span>
  <p>Also outside the portfolio. About <strong id="c529"></strong> sits here for education, separate from retirement entirely.</p>
</div>
<p class="layer-head">Layer two · Which tax door it exits through</p>
<p class="layer-note">The buckets decide what gets sold. The order below decides which account the money
technically leaves from, and the two are independent. She can take a withdrawal from the Roth while
actually consuming the stable bucket, by swapping holdings between accounts at the same time. Wrappers
have doors between them. Buckets are what she really owns.</p>`;

function renderBuckets() {
  const sec = document.getElementById("income");
  sec.querySelector(".lede").insertAdjacentHTML("afterend", BUCKET_HTML);
  document.getElementById("c529").textContent = fmt$(S.college529);
  document.getElementById("cserp").textContent = fmt$(S.serp);
  sec.querySelectorAll(".chip[data-tip]").forEach(c => {
    c.addEventListener("mousemove", ev => showTip(ev, `<b>${c.textContent}</b>${c.dataset.tip}`));
    c.addEventListener("mouseleave", hideTip);
  });
}

const FUND_META = [
  { k: "ss", name: "Social Security", color: "var(--plum)" },
  { k: "cash", name: "Cash", color: "var(--mist)" },
  { k: "brok", name: "Brokerage", color: "var(--sand)" },
  { k: "trad", name: "Traditional", color: "var(--slate)" },
  { k: "roth", name: "Roth", color: "var(--gold)" },
];

function renderFunding() {
  const rows = simulate();
  const age = +document.getElementById("ageSlider").value;
  const r = rows.find(x => x.age === age);
  document.getElementById("ageLabel").textContent = `Age ${age} · ${r.year}`;
  const bar = document.getElementById("fundBar");
  const total = FUND_META.reduce((s, m) => s + r.fund[m.k], 0);
  bar.innerHTML = "";
  if (total < 1) {
    bar.innerHTML = `<div class="fund-seg" style="background:var(--mist);width:100%">No withdrawals needed this year</div>`;
  } else {
    FUND_META.forEach(m => {
      const v = r.fund[m.k];
      if (v < 1) return;
      const seg = document.createElement("div");
      seg.className = "fund-seg";
      seg.style.background = m.color;
      seg.style.width = (v / total) * 100 + "%";
      seg.textContent = fmtK(v);
      seg.addEventListener("mousemove", ev => showTip(ev, `<b>${m.name}</b>${fmt$(v)} of this year's ${fmt$(total)} comes from here.`));
      seg.addEventListener("mouseleave", hideTip);
      bar.appendChild(seg);
    });
  }
  document.getElementById("fundLegend").innerHTML = FUND_META.map(m =>
    `<span><span class="key-dot" style="background:${m.color}"></span>${m.name}</span>`).join("");

  const reserveM = r.spend > 0 ? (r.cash / (r.spend / 12)) : 0;
  let note;
  if (age < 65) note = `The bridge years. Everything comes from cash so the portfolio can keep compounding and conversions stay cheap. Cash on hand covers about <strong>${Math.round(reserveM)} months</strong> of spending.`;
  else if (age < 70) note = `Medicare has begun, Social Security has not. The 18 month reserve stays protected, and the gap follows the order. With Traditional already converted away, these years lean on the Roth, which is exactly why those withdrawals are tax free. Cash on hand covers about <strong>${Math.round(reserveM)} months</strong>.`;
  else note = `Social Security covers ${fmt$(r.fund.ss)} of the ${fmt$(r.spend)} budget${r.rmd > 100 ? `, and the required withdrawal is ${fmtK(r.rmd)}` : ", and required withdrawals are near zero"}. The portfolio mostly rests.`;
  if (r.shortfall > 1) note += ` <strong style="color:var(--danger)">Shortfall of ${fmtK(r.shortfall)} this year under these settings.</strong>`;
  document.getElementById("fundNote").innerHTML = note;
}

/* ============================================================
   ⑤ WILL IT LAST
============================================================ */
const LAYERS = [
  { k: "trad", name: "Traditional", color: "#5E7B8F" },
  { k: "roth", name: "Roth", color: "#C39A4B" },
  { k: "hsa", name: "HSA", color: "#6E9987" },
  { k: "brok", name: "Brokerage", color: "#8A6F94" },
  { k: "cash", name: "Cash", color: "#B9C2BC" },
];

function renderChart() {
  const sim = simulate({
    ret: W.ret ?? S.ret,
    ssAge: W.ssAge ?? S.ssAge,
    spendMult: W.spendMult,
  });
  /* the lens: engine runs in today's dollars, the nominal view inflates each year */
  const infl = 1 + S.inflation / 100;
  const rows = sim.map((r, i) => {
    if (W.lens !== "nominal") return r;
    const m = Math.pow(infl, i), o = { ...r };
    ["trad", "roth", "hsa", "brok", "cash", "total", "spend", "ss", "shortfall"]
      .forEach(k => o[k] = r[k] * m);
    return o;
  });
  const svg = document.getElementById("chart");
  const Wd = 960, H = 400, mL = 62, mR = 16, mT = 16, mB = 34;
  const iw = Wd - mL - mR, ih = H - mT - mB;
  const maxV = Math.max(...rows.map(r => r.total)) * 1.08 || 1;
  const x = i => mL + (i / (rows.length - 1)) * iw;
  const y = v => mT + ih - (v / maxV) * ih;

  let acc = rows.map(() => 0);
  let paths = "";
  LAYERS.forEach(L => {
    const upper = rows.map((r, i) => acc[i] + r[L.k]);
    let d = `M ${x(0)} ${y(acc[0])}`;
    rows.forEach((r, i) => d += ` L ${x(i)} ${y(upper[i])}`);
    for (let i = rows.length - 1; i >= 0; i--) d += ` L ${x(i)} ${y(acc[i])}`;
    d += " Z";
    paths += `<path d="${d}" fill="${L.color}" opacity="0.9"><title>${L.name}</title></path>`;
    acc = upper;
  });

  /* gridlines + axis */
  let grid = "";
  const steps = 4;
  for (let g = 0; g <= steps; g++) {
    const v = (maxV / steps) * g, yy = y(v);
    grid += `<line x1="${mL}" y1="${yy}" x2="${Wd - mR}" y2="${yy}" stroke="#E3DFD4" stroke-width="1"/>
      <text x="${mL - 8}" y="${yy + 4}" text-anchor="end" font-size="12" fill="#5A6764">${fmtK(v)}</text>`;
  }
  let marks = "";
  [[60, "Retire"], [65, "Medicare"], [70, "Soc Sec"], [75, "RMDs"]].forEach(([age, lab]) => {
    const i = rows.findIndex(r => r.age === age);
    if (i < 0) return;
    marks += `<line x1="${x(i)}" y1="${mT}" x2="${x(i)}" y2="${mT + ih}" stroke="#22302E" stroke-dasharray="3 4" stroke-width="1" opacity=".45"/>
      <text x="${x(i) + 4}" y="${mT + 14}" font-size="11" fill="#5A6764">${lab} ${age}</text>`;
  });
  let ages = "";
  rows.forEach((r, i) => {
    if (r.age % 5 === 0) ages += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#5A6764">${r.age}</text>`;
  });

  svg.innerHTML = grid + paths + marks + ages +
    `<line id="chartGuide" y1="${mT}" y2="${mT + ih}" stroke="#22302E" stroke-width="1.5" opacity="0" pointer-events="none"/>`;

  /* hover: nearest year breakdown */
  lastChartRows = rows;
  if (!svg.dataset.hover) {
    svg.dataset.hover = "1";
    svg.addEventListener("mousemove", ev => {
      const rows2 = lastChartRows;
      const rect = svg.getBoundingClientRect();
      const vx = (ev.clientX - rect.left) / rect.width * 960;
      let i = Math.round((vx - mL) / iw * (rows2.length - 1));
      i = Math.max(0, Math.min(rows2.length - 1, i));
      const r = rows2[i];
      const g = document.getElementById("chartGuide");
      const gx = mL + (i / (rows2.length - 1)) * iw;
      g.setAttribute("x1", gx); g.setAttribute("x2", gx); g.setAttribute("opacity", ".5");
      const lines = LAYERS.filter(L => r[L.k] > 500).map(L =>
        `${L.name} ${fmtK(r[L.k])}`).join(" · ");
      showTip(ev, `<b>Age ${r.age} · ${r.year} · ${fmtK(r.total)} total</b>${lines}${r.shortfall > 1 ? `<br><span style="color:#E8A79E">Shortfall ${fmtK(r.shortfall)}</span>` : ""}`);
    });
    svg.addEventListener("mouseleave", () => {
      hideTip();
      const g = document.getElementById("chartGuide");
      if (g) g.setAttribute("opacity", "0");
    });
  }

  document.getElementById("chartLegend").innerHTML = LAYERS.map(L =>
    `<span><span class="key-dot" style="background:${L.color}"></span>${L.name}</span>`).join("");

  /* verdict */
  const short = rows.find(r => r.shortfall > 1);
  const v = document.getElementById("verdict");
  if (short) {
    v.className = "verdict bad";
    v.textContent = `Under these settings, money runs short around age ${short.age}. Move something and watch what fixes it.`;
  } else {
    const end = rows[rows.length - 1];
    v.className = "verdict";
    v.textContent = W.lens === "nominal"
      ? `Money lasts through 95 with about ${fmtK(end.total)} remaining in future dollars, ${fmtK(end.roth)} of it in the tax free Roth.`
      : `Money lasts through 95 with about ${fmtK(end.total)} remaining in today's dollars, ${fmtK(end.roth)} of it in the tax free Roth.`;
  }
  /* withdrawal rate context */
  let rateEl = document.getElementById("wdrRate");
  if (!rateEl) {
    rateEl = document.createElement("p");
    rateEl.id = "wdrRate";
    rateEl.className = "fine";
    v.insertAdjacentElement("afterend", rateEl);
  }
  const rRet = rows.find(r => r.age === S.retireAge);
  const rSS = rows.find(r => r.age === (W.ssAge ?? S.ssAge));
  if (rRet && rRet.total > 0) {
    const rate = rRet.spend / rRet.total;
    let txt = `At retirement this asks ${fmt$(rRet.spend)} from about ${fmtK(rRet.total)} of assets, a first year rate of <strong>${fmtPct(rate)}</strong>. The classic rule of thumb says 4% tends to survive thirty years.`;
    if (rSS && rSS.total > 0) {
      const net = Math.max(0, rSS.spend - rSS.ss) / rSS.total;
      txt += ` Once Social Security arrives the portfolio only covers the gap, and the rate falls to <strong>${fmtPct(net)}</strong>.`;
    }
    rateEl.innerHTML = txt;
  } else rateEl.textContent = "";
}

/* ============================================================
   HER NUMBERS panel
============================================================ */
const FIELDS = [
  { g: "Ages" },
  { k: "currentAge", label: "Current age" },
  { k: "retireAge", label: "Retirement age" },
  { k: "ssAge", label: "Social Security age" },
  { k: "convStop", label: "Conversions stop by" },
  { g: "Balances today" },
  { k: "trad", label: "Traditional", money: true },
  { k: "roth", label: "Roth", money: true },
  { k: "hsa", label: "HSA", money: true },
  { k: "brokerage", label: "Brokerage", money: true },
  { k: "cash", label: "Cash", money: true },
  { g: "The house" },
  { k: "houseAge", label: "Sell at age" },
  { k: "houseNet", label: "Net proceeds", money: true },
  { g: "Spending, today's dollars" },
  { k: "spendTo74", label: "Per year through 74", money: true },
  { k: "spend75", label: "Per year from 75", money: true },
  { g: "Assumptions" },
  { k: "inflation", label: "Inflation %", step: 0.5 },
  { k: "cashYield", label: "Cash yield %", step: 0.5 },
  { k: "ssAnnual", label: "Social Security at 70, per year", money: true },
  { k: "workingTaxable", label: "Taxable income while working", money: true },
  { k: "workCeiling", label: "Working conversion ceiling", select: [[24, "24% bracket"], [22, "22% bracket"], [0, "No conversions"]] },
  { k: "gapCeiling", label: "Retirement conversion ceiling", select: [[24, "24% bracket"], [22, "22% bracket"], [12, "12% bracket"], [0, "No conversions"]] },
  { k: "reserveMonths", label: "Protected reserve, months" },
  { g: "Outside the portfolio" },
  { k: "serp", label: "SERP", money: true },
  { k: "college529", label: "College 529", money: true },
];

function buildPanel() {
  const body = document.getElementById("panelBody");
  body.innerHTML = "";
  let group;
  FIELDS.forEach(f => {
    if (f.g) {
      group = document.createElement("div");
      group.className = "panel-group";
      group.innerHTML = `<b>${f.g}</b>`;
      body.appendChild(group);
      return;
    }
    const row = document.createElement("div");
    row.className = "field";
    const id = "f_" + f.k;
    let input;
    if (f.select) {
      input = `<select id="${id}">${f.select.map(([v, t]) =>
        `<option value="${v}" ${S[f.k] == v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    } else {
      input = `<input id="${id}" type="number" step="${f.step ?? (f.money ? 1000 : 1)}" value="${S[f.k]}">`;
    }
    row.innerHTML = `<label for="${id}">${f.label}</label>${input}`;
    group.appendChild(row);
    row.querySelector("input,select").addEventListener("change", e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        S[f.k] = v; save();
        const c = document.getElementById("c529");
        if (c) c.textContent = fmt$(S.college529);
        const sp = document.getElementById("cserp");
        if (sp) sp.textContent = fmt$(S.serp);
        renderAll();
      }
    });
  });
}

function openPanel(open) {
  document.getElementById("panel").hidden = !open;
  document.getElementById("panelScrim").hidden = !open;
}

/* ============================================================
   wiring
============================================================ */
function renderAll() {
  renderLadder();
  renderConvCompare();
  renderConvPayoff();
  renderFunding();
  renderChart();
}

document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
  convMode = b.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("active", x === b));
  const s = document.getElementById("convSlider");
  s.value = convMode === "working" ? Math.min(133000, s.max) : 160000;
  renderLadder();
}));
document.getElementById("convSlider").addEventListener("input", renderLadder);
document.getElementById("ageSlider").addEventListener("input", renderFunding);

document.querySelectorAll("#retSeg [data-ret]").forEach(b => b.addEventListener("click", () => {
  W.ret = +b.dataset.ret;
  document.querySelectorAll("#retSeg .seg-btn").forEach(x => x.classList.toggle("active", x === b));
  renderChart();
}));
document.querySelectorAll("#ssSeg [data-ss]").forEach(b => b.addEventListener("click", () => {
  W.ssAge = +b.dataset.ss;
  document.querySelectorAll("#ssSeg .seg-btn").forEach(x => x.classList.toggle("active", x === b));
  renderChart();
}));
function updateSpendLabel() {
  const m = W.spendMult;
  document.getElementById("spendPct").textContent =
    `${fmt$(S.spendTo74 * m)} a year through 74, then ${fmt$(S.spend75 * m)}`;
}
document.querySelectorAll("#lensSeg [data-lens]").forEach(b => b.addEventListener("click", () => {
  W.lens = b.dataset.lens;
  document.querySelectorAll("#lensSeg .seg-btn").forEach(x => x.classList.toggle("active", x === b));
  renderChart();
}));
document.getElementById("spendSlider").addEventListener("input", e => {
  W.spendMult = +e.target.value / 100;
  updateSpendLabel();
  renderChart();
});

document.getElementById("numbersBtn").addEventListener("click", () => openPanel(true));
document.getElementById("panelClose").addEventListener("click", () => openPanel(false));
document.getElementById("doneBtn").addEventListener("click", () => openPanel(false));
document.getElementById("panelScrim").addEventListener("click", () => openPanel(false));
document.getElementById("resetBtn").addEventListener("click", () => {
  S = { ...DEFAULTS };
  save();
  buildPanel();
  renderAll();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") openPanel(false); });
window.addEventListener("resize", () => buildTimeline());

/* go */
buildTimeline();
renderBuckets();
buildPanel();
updateSpendLabel();
renderAll();