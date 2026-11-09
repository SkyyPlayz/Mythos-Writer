// One-off generator for e2e/fixtures/story-import.epub — a minimal but REAL
// ePub (valid ZIP with mimetype, META-INF/container.xml, OPF manifest + spine,
// and two XHTML spine documents), used by e2e/story-import-epub.spec.ts
// (SKY-8008; since #1765 driven through the import hub, so it exercises
// electron-main/src/importHub/epub.ts): container.xml → OPF full-path,
// dc:title as the book title, spine reading order, non-XHTML manifest items
// skipped.
//
// SKY-8536 / GH #1097: the OPF lives one directory deeper than its spine
// documents (OEBPS/package/content.opf vs OEBPS/text/*.xhtml), so both spine
// hrefs are parent-relative ("../text/chN.xhtml"). This is the exact archive
// shape that once broke ePub import until spine paths were normalized against
// the OPF directory — every assertion in the spec doubles as end-to-end
// regression coverage for that resolution in importHub/epub.ts.
//
// Run: node e2e/fixtures/build-story-import-epub.cjs
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:identifier id="uid">urn:uuid:sky-8008-story-import-epub</dc:identifier>
    <dc:title>The Epub Import Chronicle</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="../text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="../text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

// H1 = chapter, H2 = scene (two heading levels → splitStoryMarkdown maps them
// straight to chapters/scenes; the story title comes from dc:title above).
const CH1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch 1</title></head><body>
  <h1>The Drowned Archive</h1>
  <h2>Salt in the Stacks</h2>
  <p>The shelves had been underwater for a century, yet the spine order survived the flood intact.</p>
  <p>A second paragraph kept the opening scene honest.</p>
</body></html>`;

const CH2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch 2</title></head><body>
  <h1>The Lantern Road</h1>
  <h2>Ferry at Dusk</h2>
  <p>Chapter two crossed the water with fresh headings, proving the reader walked the spine in order.</p>
</body></html>`;

async function main() {
  const zip = new JSZip();
  // Per the ePub OCF spec the mimetype entry is first and uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/package/content.opf', OPF);
  zip.file('OEBPS/text/ch1.xhtml', CH1);
  zip.file('OEBPS/text/ch2.xhtml', CH2);
  zip.file('OEBPS/package/style.css', 'h1 { page-break-before: always }');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const out = path.join(__dirname, 'story-import.epub');
  fs.writeFileSync(out, buffer);
  console.log(`wrote ${out} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
