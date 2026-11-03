document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = 'در حال جستجو و تحلیل صفحه... لطفا صبر کنید.';

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapePackagesFromPage,
        }, (results) => {
            if (chrome.runtime.lastError) {
                console.error("خطای افزونه:", chrome.runtime.lastError.message);
                resultsDiv.innerHTML = `<span style="color:red">خطا در اجرای اسکریپت: ${chrome.runtime.lastError.message}</span>`;
                return;
            }

            if (results && results[0] && results[0].result) {
                const packages = results[0].result.data;
                const logs = results[0].result.logs;

                console.log("--- لاگ‌های دریافت شده از صفحه ---");
                logs.forEach(log => console.log(log));
                console.log("----------------------------------");

                if (packages.length > 0) {
                    displayResults(packages);
                } else {
                    resultsDiv.innerHTML = `
            <div style="color:#d9534f; font-weight:bold; margin-bottom:10px;">بسته‌ای یافت نشد!</div>
            <div style="font-size:12px; color:#555;">
              دلایل احتمالی:<br>
              ۱. در صفحه خرید بسته اینترنت <strong>ایرانسل</strong> یا <strong>همراه اول</strong> نیستید.<br>
              ۲. صفحه هنوز به طور کامل لود نشده است.<br>
              ۳. یک تب فیلتر انتخاب شده که بسته اینترنت ندارد.<br>
              <br>
              <strong>لاگ‌های بررسی صفحه:</strong><br>
              <pre style="background:#eee; padding:5px; border-radius:4px; max-height:150px; overflow-y:auto;">${logs.join('\n')}</pre>
            </div>
          `;
                }
            }
        });
    } catch (error) {
        console.error("خطای کلی:", error);
        resultsDiv.innerHTML = "خطای غیرمنتظره‌ای رخ داد. کنسول افزونه را بررسی کنید.";
    }
});

// این تابع درون صفحه وب (سایت ایرانسل یا همراه اول) اجرا می‌شود
function scrapePackagesFromPage() {
    const logs = [];
    logs.push("شروع اسکن صفحه...");

    const toEnglish = (str) => {
        if (!str) return '';
        const persian = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
        for (let i = 0; i < 10; i++) str = str.replace(persian[i], i);
        return str;
    };

    const foundPackages = new Map();

    // نقشه برچسب مدت‌زمان همراه اول به روز/ساعت (fallback زمانی که عنوان عدد ندارد)
    const badgeToTime = {
        'روزانه': { label: '1 روز',  hours: 24   },
        '3 روزه': { label: '3 روز',  hours: 72   },
        'هفتگی':  { label: '7 روز',  hours: 168  },
        '15 روزه':{ label: '15 روز', hours: 360  },
        'ماهانه': { label: '30 روز', hours: 720  },
        '2 ماهه': { label: '60 روز', hours: 1440 },
        '3 ماهه': { label: '90 روز', hours: 2160 },
    };

    // تابع مشترک برای تجزیه هر کارت (هر دو سایت)
    function parsePackage(rawTitle, rawPrice, isBestSeller, index, fallbackDuration) {
        try {
            const cleanTitle = (rawTitle || '').replace(/\s+/g, ' ').trim();
            // حذف "ریال" تا در نمایش نهایی دوبار تکرار نشود
            const cleanPrice = (rawPrice || '').replace(/\s+/g, ' ').replace(/ریال/g, '').trim();

            const engTitle = toEnglish(cleanTitle).replace(/\u200c/g, ' ');
            const engPrice = toEnglish(cleanPrice).replace(/,/g, '');
            const priceMatch = engPrice.match(/(\d+(?:\.\d+)?)/);
            const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

            // حجم: عدد + گیگ/مگ
            const volMatch = engTitle.match(/(\d+(?:\.\d+)?)\s*(گیگ|مگ)/);
            let volume = 0;
            if (volMatch) {
                volume = parseFloat(volMatch[1]);
                if (volMatch[2] === 'مگ') volume = volume / 1024;
            }

            // مدت: روز/ماه/ساعت
            let timePeriod = 'بدون مدت / متفرقه';
            let sortTime = 9999;

            const timeMatch = engTitle.match(/(\d+)\s*(روزه|روز|ماهه|ماه|ساعته|ساعت)/);
            if (timeMatch) {
                const amount = parseInt(timeMatch[1]);
                const unit = timeMatch[2];
                if (unit === 'روزه' || unit === 'روز') {
                    timePeriod = `${amount} روز`;
                    sortTime = amount * 24;
                } else if (unit === 'ماهه' || unit === 'ماه') {
                    timePeriod = `${amount * 30} روز`;
                    sortTime = amount * 30 * 24;
                } else {
                    timePeriod = `${amount} ساعت`;
                    sortTime = amount;
                }
            } else if (fallbackDuration && badgeToTime[fallbackDuration]) {
                // برای عناوینی مثل «سی روزه» یا «یکروزه» که عدد لاتین ندارند
                timePeriod = badgeToTime[fallbackDuration].label;
                sortTime = badgeToTime[fallbackDuration].hours;
            }

            logs.push(`[مورد ${index + 1}] "${cleanTitle}" | ${cleanPrice} → حجم: ${volume.toFixed(2)}GB، مدت: ${timePeriod}${isBestSeller ? ' | ★ پرفروش' : ''}`);

            if (volume > 0 && price > 0) {
                const uniqueKey = `${volume}-${price}-${timePeriod}`;
                if (!foundPackages.has(uniqueKey)) {
                    foundPackages.set(uniqueKey, {
                        title: cleanTitle,
                        volume: volume,
                        price: price,
                        formattedPrice: cleanPrice,
                        timePeriod: timePeriod,
                        sortTime: sortTime,
                        isBestSeller: isBestSeller,
                        valueScore: (price / volume / 10000) // هزار تومان به ازای هر گیگ
                    });
                } else {
                    logs.push(`   -> تکراری، نادیده گرفته شد.`);
                }
            } else {
                logs.push(`   -> نامعتبر (حجم یا قیمت صفر). حجم: ${volume}, قیمت: ${price}`);
            }
        } catch (err) {
            logs.push(`[مورد ${index + 1}] خطا: ${err.message}`);
        }
    }

    // ==================== ۱) ایرانسل ====================
    const irancellSelectors = [
        '[data-testid="promoOffersPackage"]',
        '[data-testid="offerPackage"]',
    ];

    let irancellCards = [];
    for (const sel of irancellSelectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length > 0) {
            logs.push(`ایرانسل: سلکتور "${sel}" → ${cards.length} کارت پیدا شد.`);
            irancellCards = Array.from(cards);
            break;
        }
    }

    irancellCards.forEach((card, index) => {
        const titleEl = card.querySelector('[data-testid$="-testID-title"]');
        const priceEl = card.querySelector('[data-testid="package-price"]');
        const badgeEl = card.querySelector('[data-testid="new-package-bestSeller-badge"]');
        if (!titleEl || !priceEl) {
            logs.push(`ایرانسل [مورد ${index + 1}] ناقص. عنوان: ${!!titleEl}, قیمت: ${!!priceEl}`);
            return;
        }
        parsePackage(titleEl.textContent, priceEl.textContent, !!badgeEl, index);
    });

    // ==================== ۲) همراه اول ====================
    const hamrahavalCards = document.querySelectorAll('app-package-list-detail');
    if (hamrahavalCards.length > 0) {
        logs.push(`همراه اول: ${hamrahavalCards.length} کارت پیدا شد.`);
    }

    hamrahavalCards.forEach((card, index) => {
        const titleEl = card.querySelector('.title.text-high-priority');
        const priceEl = card.querySelector('.price-info');
        const durationEl = card.querySelector('.duration');

        if (!titleEl || !priceEl) {
            logs.push(`همراه اول [مورد ${index + 1}] ناقص. عنوان: ${!!titleEl}, قیمت: ${!!priceEl}`);
            return;
        }

        // کلون می‌کنیم تا آیکون share را حذف کنیم (متنی تولید نمی‌کند اما برای اطمینان)
        const titleClone = titleEl.cloneNode(true);
        titleClone.querySelectorAll('app-icon, mat-icon, svg').forEach(el => el.remove());
        const rawTitle = titleClone.textContent;

        const rawPrice = priceEl.textContent;
        const fallbackDuration = durationEl
            ? durationEl.textContent.replace(/\s+/g, ' ').trim()
            : null;

        parsePackage(rawTitle, rawPrice, false, index, fallbackDuration);
    });

    logs.push(`اسکن پایان یافت. ${foundPackages.size} بسته معتبر.`);

    return {
        data: Array.from(foundPackages.values()),
        logs: logs
    };
}

// رندر نتایج (بدون تغییر نسبت به قبل)
function displayResults(packages) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    const groups = {};
    packages.forEach(pkg => {
        if (!groups[pkg.timePeriod]) {
            groups[pkg.timePeriod] = { name: pkg.timePeriod, sortTime: pkg.sortTime, items: [] };
        }
        groups[pkg.timePeriod].items.push(pkg);
    });

    const sortedGroups = Object.values(groups).sort((a, b) => a.sortTime - b.sortTime);

    sortedGroups.forEach(group => {
        group.items.sort((a, b) => a.valueScore - b.valueScore);

        const groupTitle = document.createElement('div');
        groupTitle.className = 'group-title';
        groupTitle.textContent = `بسته‌های ${group.name} (${group.items.length} مورد)`;
        resultsDiv.appendChild(groupTitle);

        group.items.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = 'package-card';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'package-title';
            const badges = [];
            if (item.isBestSeller) badges.push('<span class="best-seller-badge">پرفروش</span>');
            if (idx === 0) badges.push('<span class="top-badge">🏆 بهترین</span>');
            titleDiv.innerHTML = badges.join('') + item.title;

            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'package-details';
            detailsDiv.innerHTML = `<span>حجم: ${item.volume.toFixed(2)} GB</span> <span>قیمت: ${item.formattedPrice} ریال</span>`;

            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'value-score';
            scoreDiv.innerHTML = `<strong>ارزش: ${item.valueScore.toFixed(2)}</strong> <span style="font-size:9px; color:#888;">(هزار تومان به ازای هر گیگ - کمتر = بهتر)</span>`;

            card.appendChild(titleDiv);
            card.appendChild(detailsDiv);
            card.appendChild(scoreDiv);
            resultsDiv.appendChild(card);
        });
    });
}
