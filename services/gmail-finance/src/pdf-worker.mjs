import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let task;
let result = { status: 'parse_failed', text: '' };
try {
  const packageUrl = import.meta.resolve('pdfjs-dist/package.json');
  task = getDocument({ data: workerData, isEvalSupported: false, useSystemFonts: false, verbosity: 0,
    standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', packageUrl)),
    cMapUrl: fileURLToPath(new URL('./cmaps/', packageUrl)), cMapPacked: true });
  const pdf = await task.promise;
  if (pdf.numPages > 100) result.status = 'page_limit';
  else {
    let text = '';
    for (let page = 1; page <= pdf.numPages; page++) {
      const pageText = await (await pdf.getPage(page)).getTextContent();
      text += `\n[Page ${page}]\n` + pageText.items.map(part => `${part.str || ''}${part.hasEOL ? '\n' : ' '}`).join('');
      if (text.length > 150000) break;
    }
    result = { text, status: text.length > 150000 ? 'text_size_limit' : text.replace(/\[Page \d+\]/g, '').trim() ? 'extracted' : 'needs_ocr' };
  }
} catch (error) { result.status = error.name === 'PasswordException' ? 'locked' : 'parse_failed'; }
finally { if (task) await task.destroy().catch(() => {}); }
parentPort.postMessage(result);
