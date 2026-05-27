// EPUB 3 writer — produces a distribution-quality .epub file.
// The output ZIP follows EPUB 3.3: mimetype stored uncompressed first,
// then META-INF/container.xml, then the OEBPS package.

import JSZip from 'jszip';
import { randomUUID } from 'crypto';

function generateUUID(): string {
  return randomUUID();
}

export interface EpubScene {
  id: string;
  title: string;
  prose: string;
}

export interface EpubChapter {
  id: string;
  title: string;
  scenes: EpubScene[];
}

export interface EpubInput {
  title: string;
  author?: string;
  language?: string;
  chapters: EpubChapter[];
}

// ─── HTML helpers ───

function escapedHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function proseToHtml(prose: string): string {
  // Convert plain prose paragraphs to HTML. Each double-newline = paragraph break.
  const paragraphs = prose
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return '<p></p>';
  return paragraphs.map((p) => `<p>${escapedHtml(p.replace(/\n/g, ' '))}</p>`).join('\n');
}

function sceneXhtml(sceneTitle: string, chapterTitle: string, prose: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapedHtml(sceneTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="chapter">
    <h2>${escapedHtml(chapterTitle)}</h2>
    <h3>${escapedHtml(sceneTitle)}</h3>
    ${proseToHtml(prose)}
  </section>
</body>
</html>`;
}

// ─── Package document (content.opf) ───

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface SpineItem {
  idref: string;
}

function buildOpf(
  bookTitle: string,
  author: string,
  language: string,
  uid: string,
  manifestItems: ManifestItem[],
  spineItems: SpineItem[],
): string {
  const manifestXml = manifestItems
    .map((m) => {
      const props = m.properties ? ` properties="${m.properties}"` : '';
      return `    <item id="${m.id}" href="${escapedHtml(m.href)}" media-type="${m.mediaType}"${props}/>`;
    })
    .join('\n');
  const spineXml = spineItems
    .map((s) => `    <itemref idref="${s.idref}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapedHtml(bookTitle)}</dc:title>
    <dc:creator>${escapedHtml(author)}</dc:creator>
    <dc:language>${escapedHtml(language)}</dc:language>
    <dc:identifier id="uid">${escapedHtml(uid)}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
${manifestXml}
  </manifest>
  <spine>
${spineXml}
  </spine>
</package>`;
}

// ─── Navigation document (nav.xhtml) ───

function buildNav(bookTitle: string, chapters: EpubChapter[], sceneFileMap: Map<string, string>): string {
  const tocItems = chapters
    .map((ch) => {
      const sceneLinks = ch.scenes
        .map((sc) => {
          const href = sceneFileMap.get(sc.id) ?? '';
          return `        <li><a href="${escapedHtml(href)}">${escapedHtml(sc.title)}</a></li>`;
        })
        .join('\n');
      return `      <li>
        <span>${escapedHtml(ch.title)}</span>
        <ol>
${sceneLinks}
        </ol>
      </li>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapedHtml(bookTitle)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${tocItems}
    </ol>
  </nav>
</body>
</html>`;
}

// ─── Main export ───

export async function buildEpub(input: EpubInput): Promise<Buffer> {
  const { title, author = 'Unknown', language = 'en', chapters } = input;
  const uid = `urn:uuid:${generateUUID()}`;

  const zip = new JSZip();

  // 1. mimetype — must be uncompressed and first
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // 3. Stylesheet
  const css = `body { font-family: Georgia, serif; line-height: 1.6; margin: 5% 8%; }
h2 { font-size: 1.4em; margin-top: 2em; }
h3 { font-size: 1.1em; font-style: italic; margin-top: 0.5em; }
p { margin: 0.8em 0; text-indent: 1.5em; }
p:first-of-type { text-indent: 0; }`;
  zip.file('OEBPS/style.css', css);

  // 4. Per-scene XHTML + collect manifest / spine items
  const manifestItems: ManifestItem[] = [
    { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
    { id: 'css', href: 'style.css', mediaType: 'text/css' },
  ];
  const spineItems: SpineItem[] = [];
  const sceneFileMap = new Map<string, string>(); // sceneId → href

  let sceneIndex = 0;
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      const fileId = `scene-${sceneIndex}`;
      const href = `scene-${sceneIndex}.xhtml`;
      sceneFileMap.set(scene.id, href);
      zip.file(`OEBPS/${href}`, sceneXhtml(scene.title, chapter.title, scene.prose));
      manifestItems.push({ id: fileId, href, mediaType: 'application/xhtml+xml' });
      spineItems.push({ idref: fileId });
      sceneIndex++;
    }
  }

  // Empty manuscript — produce a placeholder scene so the EPUB is valid
  if (sceneIndex === 0) {
    const href = 'scene-0.xhtml';
    zip.file(
      'OEBPS/scene-0.xhtml',
      sceneXhtml('(empty)', 'Chapter 1', ''),
    );
    manifestItems.push({ id: 'scene-0', href, mediaType: 'application/xhtml+xml' });
    spineItems.push({ idref: 'scene-0' });
  }

  // 5. Navigation document
  zip.file('OEBPS/nav.xhtml', buildNav(title, chapters, sceneFileMap));

  // 6. Package document
  zip.file('OEBPS/content.opf', buildOpf(title, author, language, uid, manifestItems, spineItems));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return buffer;
}
