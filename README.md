# Internet Package Analyzer

Browser extension (Chrome / Edge / Brave / Firefox 115+) that scrapes mobile
internet packages from **Irancell** and **Hamrahaval**, ranks them by
cost‑per‑GB, stores a history, and compares the two operators side by side.

## Features

- **Analyze** – groups packages by duration, sorts by value (thousand Toman/GB,
  lower = better), 🏆 marks the best in each group.
- **History** – auto‑saves each scrape with operator + timestamp (up to 100,
  duplicates skipped).
- **Compare** – pick two snapshots; matching packages are paired by duration
  and volume (±20 %). The cheaper per GB is highlighted.

## Install

- **Chrome/Edge/Brave**: `chrome://extensions/` → Developer mode →
  *Load unpacked* → select this folder.
- **Firefox (testing)**: `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on…* → `manifest.json`.

## Usage

1. Open the internet package page on MyIrancell or MyMCI.
2. Click the extension → **استخراج و تحلیل بسته‌ها**.
3. Use the **مقایسه** and **تاریخچه** tabs for comparison and history.

## Notes

- Prices are in Rial as displayed; no conversion.
- Selectors are site‑specific — if a site's markup changes, update
  `scrapePackagesFromPage` in `popup.js`.
- No data leaves the browser (`chrome.storage.local` only).

## Files

`manifest.json` · `popup.html` · `popup.js`

## License

M

# Irancell web extension helper to chose best internet package

## How to use:

- First clone the repo

```shell
  git clone https://gitlab.chabokan.net/asadi/InternetPackageHelperWebExt
```

- Go to browser extensions page
- Enable developer mode
- Load unpacked
  - select this project root folder
- Pin extension
- In MyIrancell web app in internet package section click on the extension and see the packages analysis

## Browser support

- Chrome / Edge / Brave — Manifest V3, load unpacked
- Firefox 115+ — Manifest V3

## Firefox installation

For testing:

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on…"
3. Select `manifest.json`

For permanent installation, sign the extension via `web-ext sign`
or upload to addons.mozilla.org.
