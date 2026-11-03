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