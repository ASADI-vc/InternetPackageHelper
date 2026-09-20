document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = 'در حال جستجو و تحلیل صفحه... لطفا صبر کنید.';

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: scrapePackagesFromPage,
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
              ۱. در صفحه اصلی خرید بسته ایرانسل نیستید.<br>
              ۲. صفحه هنوز به طور کامل لود نشده است.<br>
              ۳. یک تب فیلتر (مثل «مکالمه» یا «رایگان») انتخاب شده که بسته اینترنت ندارد.<br>
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

// این تابع درون صفحه وب (سایت ایرانسل) اجرا می‌شود
function scrapePackagesFromPage() {
    const logs = [];
    logs.push("شروع اسکن صفحه...");

    // تبدیل اعداد فارسی به انگلیسی
    const toEnglish = (str) => {
        if (!str) return '';
        const persian = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
        for (let i = 0; i < 10; i++) str = str.replace(persian[i], i);
        return str;
    };

    const foundPackages = new Map();

    // --- ۱) پیدا کردن کارت‌های بسته ---
    // UI قدیمی:  [data-testid="offerPackage"]
    // UI جدید:   [data-testid="promoOffersPackage"]
    const SELECTORS = [
        '[data-testid="promoOffersPackage"]',
        '[data-testid="offerPackage"]',
    ];

    let packageCards = [];
    for (const sel of SELECTORS) {
        const cards = document.querySelectorAll(sel);
        if (cards.length > 0) {
            logs.push(`سلکتور "${sel}" → ${cards.length} کارت پیدا شد.`);
            packageCards = Array.from(cards);
            break;
        }
    }

    if (packageCards.length === 0) {
        logs.push("هیچ کارت بسته‌ای با سلکتورهای شناخته‌شده پیدا نشد.");
    }
    logs.push(`تعداد کارت‌های کاندید: ${packageCards.length}`);

    // --- ۲) پردازش هر کارت ---
    packageCards.forEach((card, index) => {
        try {
            // عنوان: هر دو UI از الگوی ...-testID-title استفاده می‌کنند
            const titleEl = card.querySelector('[data-testid$="-testID-title"]');
            // قیمت: هر دو UI از package-price استفاده می‌کنند
            const priceEl = card.querySelector('[data-testid="package-price"]');
            // نشان پرفروش (فقط در UI قدیمی)
            const badgeEl = card.querySelector('[data-testid="new-package-bestSeller-badge"]');

            if (!titleEl || !priceEl) {
                logs.push(`[مورد ${index + 1}] ناقص. عنوان: ${!!titleEl}, قیمت: ${!!priceEl}`);
                return;
            }

            const rawTitle = titleEl.textContent.trim();
            const rawPrice = priceEl.textContent.trim();
            const isBestSeller = !!badgeEl;

            const engTitle = toEnglish(rawTitle).replace(/\u200c/g, ' '); // remove ZWNJ
            const engPrice = toEnglish(rawPrice).replace(/,/g, '');
            const price = parseFloat(engPrice);

            // --- حجم: عدد + (گیگ|مگ) — با یا بدون فاصله ---
            // مثال‌ها: ۱۰۰گیگابایت | ۷۵۰مگابایت | ۵۰۰مگ | ۲.۵گیگ
            const volMatch = engTitle.match(/(\d+(?:\.\d+)?)\s*(گیگ|مگ)/);
            let volume = 0;
            if (volMatch) {
                volume = parseFloat(volMatch[1]);
                if (volMatch[2] === 'مگ') volume = volume / 1024; // MB → GB
            }

            // --- مدت زمان: عدد + (روزه|روز|ساعته|ساعت) ---
            // مثال‌ها: ۱۲۰روزه | ۶۰روز | ۳ساعته | ۳۰ روز
            const timeMatch = engTitle.match(/(\d+)\s*(روزه|روز|ساعته|ساعت)/);
            let timePeriod = 'بدون مدت / متفرقه';
            let sortTime = 9999;

            if (timeMatch) {
                const isDay = timeMatch[2].includes('روز');
                const unit = isDay ? 'روز' : 'ساعت';
                const amount = parseInt(timeMatch[1]);
                timePeriod = `${amount} ${unit}`;
                sortTime = isDay ? amount * 24 : amount;
            }

            logs.push(`[مورد ${index + 1}] "${rawTitle}" | ${rawPrice} → حجم: ${volume.toFixed(2)}GB، مدت: ${timePeriod}${isBestSeller ? ' | ★ پرفروش' : ''}`);

            if (volume > 0 && price > 0) {
                const uniqueKey = `${volume}-${price}-${timePeriod}`;
                if (!foundPackages.has(uniqueKey)) {
                    foundPackages.set(uniqueKey, {
                        title: rawTitle,
                        volume: volume,
                        price: price,
                        formattedPrice: rawPrice,
                        timePeriod: timePeriod,
                        sortTime: sortTime,
                        isBestSeller: isBestSeller,
                        // قیمت هر گیگ به هزار تومان
                        valueScore: (price / volume / 10000)
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
    });

    logs.push(`اسکن پایان یافت. ${foundPackages.size} بسته معتبر.`);

    return {
        data: Array.from(foundPackages.values()),
        logs: logs
    };
}

// رندر نتایج
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

    // مرتب‌سازی گروه‌ها از کمترین زمان به بیشترین
    const sortedGroups = Object.values(groups).sort((a, b) => a.sortTime - b.sortTime);

    sortedGroups.forEach(group => {
        // بهترین ارزش در صدر (کمترین قیمت هر گیگ)
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