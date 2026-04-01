document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = 'در حال جستجو و تحلیل صفحه... لطفا صبر کنید.';

    try {
        // دریافت تب فعال
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // تزریق اسکریپت
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

                // چاپ لاگ‌های داخل صفحه در کنسول افزونه
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

    // تابع کمکی برای تبدیل اعداد فارسی به انگلیسی
    const toEnglish = (str) => {
        if (!str) return '';
        const persian = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
        for (let i = 0; i < 10; i++) str = str.replace(persian[i], i);
        return str;
    };

    const foundPackages = new Map();

    // پیدا کردن تمام کارت‌های بسته بر اساس کلاس‌ها یا اتریبیوت‌های موجود در فایل HTML
    // در فایل شما، کارت‌ها معمولا در این data-testid قرار دارند:
    let packageCards = document.querySelectorAll('[data-testid="lineItem-promoOffersPackage-Test-ID"]');

    // اگر پیدا نشد، سعی می‌کنیم از طریق عناوین بسته‌ها آن‌ها را پیدا کنیم
    if (packageCards.length === 0) {
        logs.push("کارت‌ها با شناسه lineItem پیدا نشدند. جستجو از طریق عناوین (title)...");
        const titles = document.querySelectorAll('div[data-testid*="-testID-title"]');
        packageCards = Array.from(titles).map(t => t.closest('.css-1dbjc4n.r-1awozwy.r-1loqt21') || t.parentElement.parentElement);
    }

    logs.push(`تعداد المان‌های کاندید برای بررسی: ${packageCards.length}`);

    packageCards.forEach((card, index) => {
        if (!card) return;

        try {
            // پیدا کردن عنوان بسته
            const titleEl = card.querySelector('div[data-testid*="-testID-title"]');
            // پیدا کردن قیمت اصلی
            const priceAmountEl = card.querySelector('[data-testid="package-price-amount"]');

            if (titleEl && priceAmountEl) {
                const rawTitle = titleEl.textContent.trim();
                const rawPrice = priceAmountEl.textContent.trim();

                logs.push(`[مورد ${index + 1}] پیدا شد: ${rawTitle} | قیمت: ${rawPrice}`);

                const engTitle = toEnglish(rawTitle);
                const engPrice = toEnglish(rawPrice).replace(/,/g, '');
                const price = parseFloat(engPrice);

                // استخراج حجم (گیگ یا مگ) از عنوان
                const volMatch = engTitle.match(/(\d+(?:\.\d+)?)\s*(گیگ|مگ)/);
                let volume = 0;
                if (volMatch) {
                    volume = parseFloat(volMatch[1]);
                    if (volMatch[2] === 'مگ') volume = volume / 1024; // تبدیل مگابایت به گیگابایت
                }

                // استخراج مدت زمان از عنوان
                const timeMatch = engTitle.match(/(\d+)\s*(روزه|ساعته|روز|ساعت)/);
                let timePeriod = 'بدون مدت / متفرقه';
                let sortTime = 9999;

                if (timeMatch) {
                    timePeriod = timeMatch[1] + ' ' + timeMatch[2];
                    // محاسبه زمان بر اساس ساعت برای مرتب‌سازی منطقی گروه‌ها
                    sortTime = (timeMatch[2].includes('روز')) ? parseInt(timeMatch[1]) * 24 : parseInt(timeMatch[1]);
                }

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
                            // محاسبه ارزش (RIAL/GB)
                            valueScore: (price / volume / 10000)
                        });
                        logs.push(`   -> با موفقیت استخراج و اضافه شد.`);
                    } else {
                        logs.push(`   -> تکراری بود، نادیده گرفته شد.`);
                    }
                } else {
                    logs.push(`   -> نامعتبر (حجم یا قیمت صفر). حجم: ${volume}, قیمت: ${price}`);
                }
            } else {
                logs.push(`[مورد ${index + 1}] ناقص بود. عنوان: ${!!titleEl}, قیمت: ${!!priceAmountEl}`);
            }
        } catch (err) {
            logs.push(`[مورد ${index + 1}] خطا در پردازش: ${err.message}`);
        }
    });

    logs.push(`اسکن پایان یافت. ${foundPackages.size} بسته معتبر استخراج شد.`);

    return {
        data: Array.from(foundPackages.values()),
        logs: logs
    };
}

// تابع رندر کردن نتایج در پاپ‌آپ
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
        // مرتب‌سازی آیتم‌های هر گروه (بیشترین ارزش در صدر)
        group.items.sort((a, b) => a.valueScore - b.valueScore);

        const groupTitle = document.createElement('div');
        groupTitle.className = 'group-title';
        groupTitle.textContent = `بسته‌های ${group.name} (${group.items.length} مورد)`;
        resultsDiv.appendChild(groupTitle);

        group.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'package-card';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'package-title';
            titleDiv.textContent = item.title;

            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'package-details';
            detailsDiv.innerHTML = `<span>حجم: ${item.volume.toFixed(2)} GB</span> <span>قیمت: ${item.formattedPrice} ریال</span>`;

            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'value-score';
            scoreDiv.innerHTML = `<strong>ارزش: ${item.valueScore.toFixed(2)}</strong> <span style="font-size:9px; color:#888;">(قیمت هر گیگ هزار تومان)</span>`;

            card.appendChild(titleDiv);
            card.appendChild(detailsDiv);
            card.appendChild(scoreDiv);
            resultsDiv.appendChild(card);
        });
    });
}
