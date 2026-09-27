import { Worker } from 'node:worker_threads';

// Untrusted attachments run away from the API event loop with time/memory limits.
export async function extractPdf(content) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
      workerData: new Uint8Array(content), resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
    });
    let done = false;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); void worker.terminate(); resolve(result); };
    const timer = setTimeout(() => finish({ status: 'parse_timeout', text: '' }), 30000);
    worker.once('message', finish);
    worker.once('error', () => finish({ status: 'parse_failed', text: '' }));
    worker.once('exit', () => finish({ status: 'parse_failed', text: '' }));
  });
}
