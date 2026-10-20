import { parentPort } from 'node:worker_threads';
import { renderMermaid } from '@speajus/mermaid-to-svg';
let queue = Promise.resolve();
parentPort.on('message', request => {
  queue = queue.then(async () => {
    try {
      const result = await renderMermaid(request.source, { theme: request.dark ? 'dark' : 'default', idPrefix: request.prefix });
      parentPort.postMessage({ id: request.id, svg: result.svg });
    } catch (error) {
      parentPort.postMessage({ id: request.id, error: error.message });
    }
  });
});
