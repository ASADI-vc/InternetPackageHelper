"""Build store submission ZIPs from the shared extension source."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    files = [manifest["action"]["default_popup"], "popup.js", *manifest["icons"].values()]
    contents = {name: (ROOT / name).read_bytes() for name in files}

    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    for browser in ("chrome", "firefox"):
        browser_manifest = manifest.copy()
        if browser == "chrome":
            browser_manifest.pop("browser_specific_settings")

        package = output / f"internet-package-analyzer-{version}-{browser}.zip"
        with ZipFile(package, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(browser_manifest, indent=4) + "\n")
            for name, data in contents.items():
                archive.writestr(name, data)
        print(package)


if __name__ == "__main__":
    main()
