// ==================== Constants ====================
const STORAGE_KEY = 'snapshots';
const MAX_SNAPSHOTS = 100;
const OPERATOR_NAMES = {
    irancell:   'ایرانسل',
    hamrahaval: 'همراه اول',
    unknown:    'نامشخص',
};

// ==================== Tabs ====================
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', async () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

        if (tab.dataset.tab === 'compare') await renderComparison();
        if (tab.dataset.tab === 'history') await renderHistory();
    });
});

// ==================== Storage helpers (callback style → works in Chrome & Firefox) ====================
function storageGet(key) {
    return new Promise(resolve => chrome.storage.local.get([key], r => resolve(r[key] || [])));
}
function storageSet(key, value) {
    return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
}
async function loadSnapshots() { return storageGet(STORAGE_KEY); }

async function saveSnapshot(snapshot) {
    let snapshots = await loadSnapshots();
    snapshots.push(snapshot);
    if (snapshots.length > MAX_SNAPSHOTS) {
        snapshots = snapshots.slice(-MAX_SNAPSHOTS);
    }
    await storageSet(STORAGE_KEY, snapshots);
}

// ==================== Formatting ====================
function formatDate(ts) {
    try {
        return new Intl.DateTimeFormat('fa-IR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        }).format(new Date(ts));
    } catch (e) {
        return new Date(ts).toLocaleString('fa-IR');
    }
}

// ==================== Analyze button ====================
document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = 'در حال جستجو و تحلیل صفحه... لطفا صبر کنید.';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapePackagesFromPage,     // ← 'func' (works in Chrome AND Firefox)
        }, async (results) => {
            if (chrome.runtime.lastError) {
                console.error("خطای افزونه:", chrome.runtime.lastError.message);
                resultsDiv.innerHTML = `<span style="color:red">خطا در اجرای اسکریپت: ${chrome.runtime.lastError.message}</span>`;
                return;
            }
            if (!results || !results[0] || !results[0].result) return;

            const { data: packages, logs, operator } = results[0].result;

            console.log("--- لاگ‌های دریافت شده از صفحه ---");
            logs.forEach(log => console.log(log));
            console.log("----------------------------------");

            if (packages.length === 0) {
                resultsDiv.innerHTML = `
                    <div style="color:#d9534f; font-weight:bold; margin-bottom:10px;">بسته‌ای یافت نشد!</div>
                    <div style="font-size:12px; color:#555;">
                      دلایل احتمالی:<br>
                      ۱. در صفحه خرید بسته اینترنت <strong>ایرانسل</strong> یا <strong>همراه اول</strong> نیستید.<br>
                      ۲. صفحه هنوز به طور کامل لود نشده است.<br>
                      ۳. یک تب فیلتر انتخاب شده که بسته اینترنت ندارد.<br>
                      <br><strong>لاگ‌های بررسی صفحه:</strong><br>
                      <pre style="background:#eee; padding:5px; border-radius:4px; max-height:150px; overflow-y:auto;">${logs.join('\n')}</pre>
                    </div>`;
                return;
            }

            // ---- Save snapshot (dedupe: same operator + identical data < 5 min old) ----
            const existing = await loadSnapshots();
            const recentSameOp = existing.filter(s =>
                s.operator === operator && (Date.now() - s.timestamp) < 5 * 60 * 1000
            );
            const isDuplicate = recentSameOp.some(s =>
                JSON.stringify(s.packages) === JSON.stringify(packages)
            );

            if (!isDuplicate) {
                await saveSnapshot({
                    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                    operator,
                    timestamp: Date.now(),
                    dateLabel: formatDate(Date.now()),
                    packages,
                });
                console.log(`ذخیره شد: ${OPERATOR_NAMES[operator]} — ${formatDate(Date.now())}`);
            } else {
                console.log('داده تکراری، ذخیره نشد.');
            }

            displayResults(packages, operator, isDuplicate);
        });
    } catch (error) {
        console.error("خطای کلی:", error);
        resultsDiv.innerHTML = "خطای غیرمنتظره‌ای رخ داد. کنسول افزونه را بررسی کنید.";
    }
});

// ==================== Injected scraper (runs in page) ====================
function scrapePackagesFromPage() {
    const logs = ["شروع اسکن صفحه..."];

    const toEnglish = (str) => {
        if (!str) return '';
        const persian = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
        for (let i = 0; i < 10; i++) str = str.replace(persian[i], i);
        return str;
    };

    const foundPackages = new Map();

    const badgeToTime = {
        'روزانه': { label: '1 روز',  hours: 24   },
        '3 روزه': { label: '3 روز',  hours: 72   },
        'هفتگی':  { label: '7 روز',  hours: 168  },
        '15 روزه':{ label: '15 روز', hours: 360  },
        'ماهانه': { label: '30 روز', hours: 720  },
        '2 ماهه': { label: '60 روز', hours: 1440 },
        '3 ماهه': { label: '90 روز', hours: 2160 },
    };

    function parsePackage(rawTitle, rawPrice, isBestSeller, index, fallbackDuration) {
        try {
            const cleanTitle = (rawTitle || '').replace(/\s+/g, ' ').trim();
            const cleanPrice = (rawPrice || '').replace(/\s+/g, ' ').replace(/ریال/g, '').trim();

            const engTitle = toEnglish(cleanTitle).replace(/\u200c/g, ' ');
            const engPrice = toEnglish(cleanPrice).replace(/,/g, '');
            const priceMatch = engPrice.match(/(\d+(?:\.\d+)?)/);
            const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

            const volMatch = engTitle.match(/(\d+(?:\.\d+)?)\s*(گیگ|مگ)/);
            let volume = 0;
            if (volMatch) {
                volume = parseFloat(volMatch[1]);
                if (volMatch[2] === 'مگ') volume = volume / 1024;
            }

            let timePeriod = 'بدون مدت / متفرقه';
            let sortTime = 9999;

            const timeMatch = engTitle.match(/(\d+)\s*(روزه|روز|ماهه|ماه|ساعته|ساعت)/);
            if (timeMatch) {
                const amount = parseInt(timeMatch[1]);
                const unit = timeMatch[2];
                if (unit === 'روزه' || unit === 'روز') {
                    timePeriod = `${amount} روز`; sortTime = amount * 24;
                } else if (unit === 'ماهه' || unit === 'ماه') {
                    timePeriod = `${amount * 30} روز`; sortTime = amount * 30 * 24;
                } else {
                    timePeriod = `${amount} ساعت`; sortTime = amount;
                }
            } else if (fallbackDuration && badgeToTime[fallbackDuration]) {
                timePeriod = badgeToTime[fallbackDuration].label;
                sortTime  = badgeToTime[fallbackDuration].hours;
            }

            logs.push(`[${index + 1}] "${cleanTitle}" | ${cleanPrice} → ${volume.toFixed(2)}GB، ${timePeriod}${isBestSeller ? ' ★' : ''}`);

            if (volume > 0 && price > 0) {
                const key = `${volume}-${price}-${timePeriod}`;
                if (!foundPackages.has(key)) {
                    foundPackages.set(key, {
                        title: cleanTitle,
                        volume, price,
                        formattedPrice: cleanPrice,
                        timePeriod, sortTime, isBestSeller,
                        valueScore: price / volume / 10000, // هزار تومان به ازای هر گیگ
                    });
                } else {
                    logs.push(`   → تکراری`);
                }
            } else {
                logs.push(`   → نامعتبر`);
            }
        } catch (err) {
            logs.push(`[${index + 1}] خطا: ${err.message}`);
        }
    }

    // ---- Operator detection ----
    let operator = 'unknown';
    const hamrahavalCards = document.querySelectorAll('app-package-list-detail');

    if (hamrahavalCards.length > 0) {
        operator = 'hamrahaval';
        logs.push(`همراه اول: ${hamrahavalCards.length} کارت`);
        hamrahavalCards.forEach((card, i) => {
            const titleEl    = card.querySelector('.title.text-high-priority');
            const priceEl    = card.querySelector('.price-info');
            const durationEl = card.querySelector('.duration');
            if (!titleEl || !priceEl) { logs.push(`همراه اول [${i + 1}] ناقص`); return; }

            const titleClone = titleEl.cloneNode(true);
            titleClone.querySelectorAll('app-icon, mat-icon, svg').forEach(el => el.remove());

            parsePackage(
                titleClone.textContent,
                priceEl.textContent,
                false, i,
                durationEl ? durationEl.textContent.replace(/\s+/g, ' ').trim() : null
            );
        });
    } else {
        const irancellSelectors = ['[data-testid="promoOffersPackage"]', '[data-testid="offerPackage"]'];
        let irancellCards = [];
        for (const sel of irancellSelectors) {
            const cards = document.querySelectorAll(sel);
            if (cards.length > 0) {
                logs.push(`ایرانسل: "${sel}" → ${cards.length} کارت`);
                irancellCards = Array.from(cards);
                operator = 'irancell';
                break;
            }
        }
        irancellCards.forEach((card, i) => {
            const titleEl = card.querySelector('[data-testid$="-testID-title"]');
            const priceEl = card.querySelector('[data-testid="package-price"]');
            const badgeEl = card.querySelector('[data-testid="new-package-bestSeller-badge"]');
            if (!titleEl || !priceEl) { logs.push(`ایرانسل [${i + 1}] ناقص`); return; }
            parsePackage(titleEl.textContent, priceEl.textContent, !!badgeEl, i);
        });
    }

    logs.push(`پایان. ${foundPackages.size} بسته معتبر. اپراتور: ${operator}`);

    return { data: Array.from(foundPackages.values()), logs, operator };
}

// ==================== Display results (Analyze tab) ====================
function displayResults(packages, operator, isDuplicate) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    const status = document.createElement('div');
    status.className = 'status-msg ' + (isDuplicate ? 'dup' : 'ok');
    status.textContent = isDuplicate
        ? `⚠️ داده تکراری (${OPERATOR_NAMES[operator]}) — ذخیره نشد.`
        : `✅ ${packages.length} بسته از ${OPERATOR_NAMES[operator]} ذخیره شد.`;
    resultsDiv.appendChild(status);

    const groups = {};
    packages.forEach(p => {
        if (!groups[p.timePeriod]) groups[p.timePeriod] = { name: p.timePeriod, sortTime: p.sortTime, items: [] };
        groups[p.timePeriod].items.push(p);
    });

    Object.values(groups).sort((a, b) => a.sortTime - b.sortTime).forEach(group => {
        group.items.sort((a, b) => a.valueScore - b.valueScore);

        const title = document.createElement('div');
        title.className = 'group-title';
        title.textContent = `بسته‌های ${group.name} (${group.items.length} مورد)`;
        resultsDiv.appendChild(title);

        group.items.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = 'package-card';

            const t = document.createElement('div');
            t.className = 'package-title';
            const badges = [];
            if (item.isBestSeller) badges.push('<span class="best-seller-badge">پرفروش</span>');
            if (idx === 0) badges.push('<span class="top-badge">🏆 بهترین</span>');
            t.innerHTML = badges.join('') + item.title;

            const d = document.createElement('div');
            d.className = 'package-details';
            d.innerHTML = `<span>حجم: ${item.volume.toFixed(2)} GB</span> <span>قیمت: ${item.formattedPrice} ریال</span>`;

            const s = document.createElement('div');
            s.className = 'value-score';
            s.innerHTML = `<strong>ارزش: ${item.valueScore.toFixed(2)}</strong> <span style="font-size:9px; color:#888;">(هزار تومان/گیگ — کمتر = بهتر)</span>`;

            card.appendChild(t); card.appendChild(d); card.appendChild(s);
            resultsDiv.appendChild(card);
        });
    });
}

// ==================== Compare tab ====================
async function renderComparison() {
    const compareResults = document.getElementById('compareResults');
    const controls       = document.getElementById('compareControls');
    const selectA        = document.getElementById('compareA');
    const selectB        = document.getElementById('compareB');

    const snapshots = await loadSnapshots();

    if (snapshots.length === 0) {
        compareResults.innerHTML = '<div class="empty-msg">هنوز هیچ داده‌ای ذخیره نشده.<br>ابتدا از تب «تحلیل» صفحه را استخراج کنید.</div>';
        controls.style.display = 'none';
        return;
    }
    if (snapshots.length === 1) {
        compareResults.innerHTML = '<div class="empty-msg">فقط یک اسنپ‌شات ذخیره شده.<br>برای مقایسه به حداقل دو اسنپ‌شات (از دو اپراتور یا دو تاریخ) نیاز است.</div>';
        controls.style.display = 'none';
        return;
    }

    // Populate dropdowns
    selectA.innerHTML = '';
    selectB.innerHTML = '';
    snapshots.forEach(s => {
        const label = `${OPERATOR_NAMES[s.operator]} — ${s.dateLabel} (${s.packages.length} بسته)`;
        const oa = document.createElement('option'); oa.value = s.id; oa.textContent = label; selectA.appendChild(oa);
        const ob = document.createElement('option'); ob.value = s.id; ob.textContent = label; selectB.appendChild(ob);
    });

    // Default A = latest overall; B = latest from a different operator (fallback: previous snapshot)
    const latest = snapshots[snapshots.length - 1];
    selectA.value = latest.id;
    const otherOp = snapshots.slice().reverse().find(s => s.operator !== latest.operator);
    selectB.value = otherOp ? otherOp.id : snapshots[snapshots.length - 2].id;

    controls.style.display = 'block';

    selectA.onchange = () => runComparison(snapshots, selectA.value, selectB.value);
    selectB.onchange = () => runComparison(snapshots, selectA.value, selectB.value);

    runComparison(snapshots, selectA.value, selectB.value);
}

function runComparison(snapshots, idA, idB) {
    const out = document.getElementById('compareResults');
    const a = snapshots.find(s => s.id === idA);
    const b = snapshots.find(s => s.id === idB);

    if (!a || !b) { out.innerHTML = '<div class="empty-msg">داده‌ای برای مقایسه یافت نشد.</div>'; return; }
    if (a.id === b.id) { out.innerHTML = '<div class="empty-msg">دو طرف مقایسه یکسان هستند.</div>'; return; }

    const groupA = groupByPeriod(a.packages);
    const groupB = groupByPeriod(b.packages);
    const allPeriods = new Set([...Object.keys(groupA), ...Object.keys(groupB)]);

    // Sort periods by sortTime (unknown last)
    const periodSort = {};
    [...a.packages, ...b.packages].forEach(p => periodSort[p.timePeriod] = p.sortTime);
    const sortedPeriods = [...allPeriods].sort((x, y) => (periodSort[x] ?? 9999) - (periodSort[y] ?? 9999));

    let html = '';
    let matchCount = 0;

    sortedPeriods.forEach(period => {
        const aPkgs = (groupA[period] || []).slice();
        const bPkgs = (groupB[period] || []).slice();
        const usedB = new Set();
        const pairs = [];

        // Greedy: for each A package find the closest-volume unmatched B
        aPkgs.forEach(aPkg => {
            let bestIdx = -1, bestDiff = Infinity;
            for (let i = 0; i < bPkgs.length; i++) {
                if (usedB.has(i)) continue;
                const bPkg = bPkgs[i];
                const maxV = Math.max(aPkg.volume, bPkg.volume);
                const diff = Math.abs(aPkg.volume - bPkg.volume);
                const tolerance = Math.max(maxV * 0.20, 3); // ±20% or 3 GB, whichever larger
                if (diff <= tolerance && diff < bestDiff) {
                    bestDiff = diff; bestIdx = i;
                }
            }
            if (bestIdx >= 0) {
                usedB.add(bestIdx);
                pairs.push({ a: aPkg, b: bPkgs[bestIdx] });
            } else {
                pairs.push({ a: aPkg, b: null });
            }
        });
        for (let i = 0; i < bPkgs.length; i++) if (!usedB.has(i)) pairs.push({ a: null, b: bPkgs[i] });

        if (pairs.length === 0) return;

        html += `<div class="compare-group">`;
        html += `<div class="compare-group-title">مدت: ${period} (${pairs.length} مورد)</div>`;

        pairs.forEach(pair => {
            if (pair.a && pair.b) matchCount++;

            const aVal = pair.a ? pair.a.valueScore : Infinity;
            const bVal = pair.b ? pair.b.valueScore : Infinity;
            const aWins = pair.a && pair.b && aVal < bVal - 0.01;
            const bWins = pair.a && pair.b && bVal < aVal - 0.01;
            const tie   = pair.a && pair.b && !aWins && !bWins;

            html += `<div class="compare-row">`;

            // --- Side A ---
            if (pair.a) {
                html += `<div class="compare-side ${aWins ? 'winner' : ''}">`;
                html += aWins
                    ? `<div class="compare-side-label"><span class="win-badge">🏆 ارزان‌تر</span></div>`
                    : tie
                        ? `<div class="compare-side-label">مساوی</div>`
                        : `<div class="compare-side-label">${OPERATOR_NAMES[a.operator]}</div>`;
                html += `<div class="compare-side-title">${pair.a.volume.toFixed(2)} GB</div>`;
                html += `<div class="compare-side-price">${pair.a.formattedPrice} ریال</div>`;
                html += `<div class="compare-side-value">ارزش: ${pair.a.valueScore.toFixed(2)}</div>`;
                html += `</div>`;
            } else {
                html += `<div class="compare-side empty">—</div>`;
            }

            // --- Side B ---
            if (pair.b) {
                html += `<div class="compare-side ${bWins ? 'winner' : ''}">`;
                html += bWins
                    ? `<div class="compare-side-label"><span class="win-badge">🏆 ارزان‌تر</span></div>`
                    : tie
                        ? `<div class="compare-side-label">مساوی</div>`
                        : `<div class="compare-side-label">${OPERATOR_NAMES[b.operator]}</div>`;
                html += `<div class="compare-side-title">${pair.b.volume.toFixed(2)} GB</div>`;
                html += `<div class="compare-side-price">${pair.b.formattedPrice} ریال</div>`;
                html += `<div class="compare-side-value">ارزش: ${pair.b.valueScore.toFixed(2)}</div>`;
                html += `</div>`;
            } else {
                html += `<div class="compare-side empty">—</div>`;
            }

            html += `</div>`;
        });

        html += `</div>`;
    });

    if (!html) {
        out.innerHTML = '<div class="empty-msg">هیچ بسته‌ای در این دو اسنپ‌شات وجود ندارد.</div>';
        return;
    }

    const summary = `<div class="status-msg" style="background:#fffbea; border:1px solid #ffcc00; color:#333;">
        📊 <strong>${OPERATOR_NAMES[a.operator]}</strong> (${a.dateLabel})
        ↔ <strong>${OPERATOR_NAMES[b.operator]}</strong> (${b.dateLabel})
        <br>جفت‌های مشابه: ${matchCount}
    </div>`;

    out.innerHTML = summary + html;
}

function groupByPeriod(packages) {
    const r = {};
    packages.forEach(p => {
        if (!r[p.timePeriod]) r[p.timePeriod] = [];
        r[p.timePeriod].push(p);
    });
    return r;
}

// ==================== History tab ====================
async function renderHistory() {
    const out      = document.getElementById('historyResults');
    const clearBtn = document.getElementById('clearHistoryBtn');

    const snapshots = await loadSnapshots();

    if (snapshots.length === 0) {
        out.innerHTML = '<div class="empty-msg">تاریخچه خالی است.</div>';
        clearBtn.style.display = 'none';
        return;
    }

    const sorted = snapshots.slice().sort((a, b) => b.timestamp - a.timestamp);
    let html = `<div style="font-size:11px; color:#666; margin-bottom:8px;">${snapshots.length} اسنپ‌شات</div>`;

    sorted.forEach(s => {
        const best = s.packages.slice().sort((x, y) => x.valueScore - y.valueScore)[0];
        html += `<div class="history-item">
            <div class="history-item-header">
                <span>${OPERATOR_NAMES[s.operator]}</span>
                <span style="font-weight:normal; color:#888;">${s.dateLabel}</span>
            </div>
            <div class="history-item-body">
                ${s.packages.length} بسته
                ${best ? ` | بهترین ارزش: ${best.valueScore.toFixed(2)} (${best.volume.toFixed(2)}GB)` : ''}
            </div>
        </div>`;
    });

    out.innerHTML = html;
    clearBtn.style.display = 'block';
}

document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
    if (!confirm('همه تاریخچه پاک شود؟')) return;
    await storageSet(STORAGE_KEY, []);
    await renderHistory();
});