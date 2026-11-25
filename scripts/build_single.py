"""Generate the standalone mobile/desktop HTML with no third-party dependencies."""
from pathlib import Path
import argparse
import base64
import gzip
import json
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    site = Path(__file__).resolve().parents[1] / "docs"
    page = (site / "index.html").read_text(encoding="utf-8")
    data = {"data/" + p.name: json.loads(p.read_bytes())
            for p in sorted((site / "data").iterdir()) if p.suffix in {".json", ".geojson"}}
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    pack = base64.b64encode(gzip.compress(encoded, mtime=0)).decode()
    assets = {"assets/" + p.name: ["image/webp" if p.suffix == ".webp" else "image/jpeg",
                                    base64.b64encode(p.read_bytes()).decode()]
              for p in sorted((site / "assets").iterdir()) if p.is_file()}
    loader = """
window.ATLAS_ASSETS=Object.fromEntries(Object.entries(ASSETS).map(([p,[type,s]])=>[p,URL.createObjectURL(new Blob([Uint8Array.from(atob(s),v=>v.charCodeAt(0))],{type}))]));
window.ATLAS_READY=(async()=>{
 const bytes=Uint8Array.from(atob("PAYLOAD"),v=>v.charCodeAt(0));
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 window.ATLAS_DATA=await new Response(stream).json();
})();
"""
    loader = loader.replace("Object.entries(ASSETS)", "Object.entries(" + json.dumps(assets) + ")")
    loader = loader.replace("PAYLOAD", pack)
    page = page.replace('<link rel="stylesheet" href="style.css">',
                        "<style>" + (site / "style.css").read_text(encoding="utf-8") + "</style>")
    page = page.replace('<script src="icons.js">', "<script>" + loader + '</script><script src="icons.js">')

    def inline(match):
        source = (site / match[1]).read_text(encoding="utf-8")
        if match[1] == "app.js":
            source = source.replace("init().catch(err=>", "window.ATLAS_READY.then(init).catch(err=>")
        return "<script>" + source.replace("</script", "<\\/script") + "</script>"

    page = re.sub(r'<script src="([a-z-]+\.js)"></script>', inline, page)
    args.output.write_text(page, encoding="utf-8")


if __name__ == "__main__":
    main()
